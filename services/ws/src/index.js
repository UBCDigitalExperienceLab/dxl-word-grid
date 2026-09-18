/**
 * word-grid WebSocket Lambda.
 *
 * API Gateway (WebSocket) routes every frame here. This is the cloud port of
 * the original in-memory server.js: room state lives in DynamoDB (see store.js)
 * and messages are pushed to players through the API Gateway Management API.
 *
 * Routes:
 *   $connect    — record the raw connection (no room yet)
 *   $disconnect — remove the player from their room, close/relist as needed
 *   $default    — game messages: host, join, start, find, again, endcheck
 *
 * Round timer: Lambda cannot hold a setTimeout across invocations, so rounds
 * end lazily. Each client runs its own countdown and, when it hits zero, sends
 * `{ action: "endcheck" }`. Any find after endAt also triggers finalisation.
 */
import { randomBytes } from "node:crypto";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { DIFFICULTIES, generateGrid, scoreGame, validateFind } from "@dxl/word-grid-engine";
import { getWordSet } from "./words.js";
import {
  putRoom,
  getRoom,
  roomExists,
  patchRoom,
  deleteRoom,
  putPlayer,
  getPlayer,
  listPlayers,
  deletePlayer,
  addFind,
  putConnection,
  getConnection,
  deleteConnection,
} from "./store.js";

const MAX_PLAYERS = 6;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PLAYER_COLORS = ["#ffffff", "#9bb8d0", "#d7e3ee", "#6e93b5", "#eef3f8", "#3d6a8f"];

function makeId() {
  return randomBytes(6).toString("hex");
}

function makeCode() {
  let code = "";
  for (let i = 0; i < 4; i += 1) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

async function uniqueCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = makeCode();
    if (!(await roomExists(code))) return code;
  }
  return makeCode();
}

// ── Management API (server → client push) ──────────────────────────

function mgmt(event) {
  const { domainName, stage } = event.requestContext;
  return new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`,
  });
}

async function post(client, connectionId, payload) {
  try {
    await client.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(payload)),
      }),
    );
    return true;
  } catch (err) {
    // 410 Gone → stale connection; caller decides whether to prune.
    if (err?.$metadata?.httpStatusCode === 410) return false;
    return false;
  }
}

function sendTo(client, connectionId, payload) {
  return post(client, connectionId, payload);
}

async function broadcast(client, players, payload) {
  await Promise.all(
    players
      .filter((p) => p.connectionId)
      .map((p) => post(client, p.connectionId, payload)),
  );
}

// ── Public shapes (mirror server.js) ───────────────────────────────

function publicPlayers(players) {
  return players.map(({ id, name, color }) => ({ id, name, color }));
}

function rankingsOf(players) {
  return scoreGame(
    players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      words: [...(player.finds ?? [])],
    })),
  ).rankings;
}

function joinUrlFor(code) {
  const base = process.env.PUBLIC_URL?.replace(/\/+$/, "");
  return base ? `${base}/?code=${code}` : `?code=${code}`;
}

function lobbyPayload(room, players) {
  return {
    type: "lobby",
    code: room.code,
    hostId: room.hostId,
    size: room.size,
    durationSec: room.durationSec,
    difficulty: room.difficulty,
    players: publicPlayers(players),
    joinUrl: joinUrlFor(room.code),
    qrDataUrl: "",
  };
}

// ── Handlers ───────────────────────────────────────────────────────

async function handleHost(client, connectionId, message) {
  const name = String(message.name ?? "").trim().slice(0, 18);
  const size = Number(message.size);
  const durationSec = Number(message.durationSec);
  const difficulty = String(message.difficulty ?? "medium");
  if (!name) return sendTo(client, connectionId, { type: "error", message: "Enter your name." });
  if (![8, 10, 12, 15].includes(size)) {
    return sendTo(client, connectionId, { type: "error", message: "Pick a board size." });
  }
  if (![60, 120, 180, 300].includes(durationSec)) {
    return sendTo(client, connectionId, { type: "error", message: "Pick a round length." });
  }
  if (!DIFFICULTIES[difficulty]) {
    return sendTo(client, connectionId, { type: "error", message: "Pick a difficulty." });
  }

  const code = await uniqueCode();
  const playerId = makeId();
  const room = {
    code,
    hostId: playerId,
    size,
    durationSec,
    difficulty,
    phase: "lobby",
    grid: null,
    planted: [],
    endAt: 0,
  };
  const player = { id: playerId, name, color: PLAYER_COLORS[0], connectionId, finds: [] };

  await putRoom(room);
  await putPlayer(code, player);
  await putConnection(connectionId, code, playerId);

  await sendTo(client, connectionId, { type: "welcome", playerId, isHost: true });
  await sendTo(client, connectionId, lobbyPayload(room, [player]));
}

async function handleJoin(client, connectionId, message) {
  const name = String(message.name ?? "").trim().slice(0, 18);
  const code = String(message.code ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
  if (!name) return sendTo(client, connectionId, { type: "error", message: "Enter your name." });

  const room = await getRoom(code);
  if (!room) return sendTo(client, connectionId, { type: "error", message: "No room with that code." });
  if (room.phase !== "lobby") {
    return sendTo(client, connectionId, { type: "error", message: "That round already started." });
  }
  const players = await listPlayers(code);
  if (players.length >= MAX_PLAYERS) {
    return sendTo(client, connectionId, { type: "error", message: "That room is full." });
  }
  if (players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return sendTo(client, connectionId, { type: "error", message: "That name is already in the room." });
  }

  const playerId = makeId();
  const player = {
    id: playerId,
    name,
    color: PLAYER_COLORS[players.length % PLAYER_COLORS.length],
    connectionId,
    finds: [],
  };
  await putPlayer(code, player);
  await putConnection(connectionId, code, playerId);

  const all = players.concat(player);
  await sendTo(client, connectionId, { type: "welcome", playerId, isHost: false });
  await broadcast(client, all, lobbyPayload(room, all));
}

async function handleStart(client, connectionId) {
  const conn = await getConnection(connectionId);
  if (!conn) return;
  const room = await getRoom(conn.code);
  if (!room || conn.playerId !== room.hostId) {
    return sendTo(client, connectionId, { type: "error", message: "Only the host can start." });
  }
  if (room.phase !== "lobby") {
    return sendTo(client, connectionId, { type: "error", message: "The round already started." });
  }
  const players = await listPlayers(conn.code);
  if (players.length < 1) {
    return sendTo(client, connectionId, { type: "error", message: "No players in the room." });
  }

  let generated;
  try {
    generated = generateGrid(room.size, [...getWordSet()], Math.random, room.difficulty);
  } catch {
    return sendTo(client, connectionId, { type: "error", message: "Could not build the board. Try again." });
  }

  const endAt = Date.now() + room.durationSec * 1000;
  // Reset finds for a fresh round.
  await Promise.all(players.map((p) => putPlayer(conn.code, { ...p, finds: [] })));
  await patchRoom(conn.code, {
    phase: "play",
    grid: generated.grid,
    planted: generated.placed,
    endAt,
  });

  const fresh = players.map((p) => ({ ...p, finds: [] }));
  await broadcast(client, fresh, {
    type: "round",
    grid: generated.grid,
    endAt,
    durationSec: room.durationSec,
    players: publicPlayers(fresh),
    rankings: rankingsOf(fresh),
  });
}

async function finalize(client, code, room, players) {
  if (room.phase !== "play") return;
  await patchRoom(code, { phase: "results" });
  const rankings = rankingsOf(players);
  await broadcast(client, players, { type: "ended", rankings });
}

async function handleFind(client, connectionId, message) {
  const conn = await getConnection(connectionId);
  if (!conn) return;
  const room = await getRoom(conn.code);
  if (!room || room.phase !== "play") {
    return sendTo(client, connectionId, { type: "find-err", message: "The round is not active." });
  }

  // Lazy timer: if the round is over, finalise instead of accepting the find.
  if (Date.now() >= room.endAt) {
    const players = await listPlayers(conn.code);
    return finalize(client, conn.code, room, players);
  }

  const cells = Array.isArray(message.cells)
    ? message.cells.map((cell) => ({ r: Number(cell.r), c: Number(cell.c) }))
    : [];
  const result = validateFind(room.grid, cells, getWordSet());
  if (!result.ok) {
    return sendTo(client, connectionId, { type: "find-err", message: result.reason });
  }

  const me = await getPlayer(conn.code, conn.playerId);
  if (!me) return;
  if ((me.finds ?? []).includes(result.word)) {
    return sendTo(client, connectionId, {
      type: "find-err",
      message: `You already found ${result.word.toUpperCase()}`,
    });
  }

  await addFind(conn.code, conn.playerId, result.word);
  const players = await listPlayers(conn.code);
  const rankings = rankingsOf(players);
  const row = rankings.find((item) => item.id === conn.playerId);
  const entry = [...(row?.unique ?? []), ...(row?.shared ?? [])].find(
    (item) => item.word === result.word.toUpperCase(),
  );
  const kind = entry?.finderCount === 1 ? "unique" : "shared";

  await sendTo(client, connectionId, {
    type: "find-ok",
    word: result.word.toUpperCase(),
    kind,
    points: entry?.points ?? 0,
    rankings,
  });
  await broadcast(client, players, { type: "scores", rankings });
}

async function handleEndCheck(client, connectionId) {
  const conn = await getConnection(connectionId);
  if (!conn) return;
  const room = await getRoom(conn.code);
  if (!room || room.phase !== "play") return;
  if (Date.now() < room.endAt) return;
  const players = await listPlayers(conn.code);
  await finalize(client, conn.code, room, players);
}

async function handleAgain(client, connectionId) {
  const conn = await getConnection(connectionId);
  if (!conn) return;
  const room = await getRoom(conn.code);
  if (!room || conn.playerId !== room.hostId) {
    return sendTo(client, connectionId, { type: "error", message: "Only the host can play again." });
  }
  const players = await listPlayers(conn.code);
  await Promise.all(players.map((p) => putPlayer(conn.code, { ...p, finds: [] })));
  await patchRoom(conn.code, { phase: "lobby", grid: null, planted: [], endAt: 0 });
  const fresh = players.map((p) => ({ ...p, finds: [] }));
  await broadcast(client, fresh, lobbyPayload({ ...room, phase: "lobby" }, fresh));
}

async function handleDisconnect(client, connectionId) {
  const conn = await getConnection(connectionId);
  await deleteConnection(connectionId);
  if (!conn) return;
  const room = await getRoom(conn.code);
  if (!room) return;
  const leavingHost = conn.playerId === room.hostId;
  await deletePlayer(conn.code, conn.playerId);
  const remaining = await listPlayers(conn.code);

  if (remaining.length === 0 || leavingHost) {
    await broadcast(client, remaining, { type: "closed", message: "The host left the room." });
    await Promise.all(remaining.map((p) => deleteConnection(p.connectionId)));
    await Promise.all(remaining.map((p) => deletePlayer(conn.code, p.id)));
    await deleteRoom(conn.code);
    return;
  }
  if (room.phase === "lobby") {
    await broadcast(client, remaining, lobbyPayload(room, remaining));
  } else {
    await broadcast(client, remaining, { type: "scores", rankings: rankingsOf(remaining) });
  }
}

// ── Entry point ────────────────────────────────────────────────────

export async function handler(event) {
  const { routeKey, connectionId } = event.requestContext;
  const client = mgmt(event);

  if (routeKey === "$connect") return { statusCode: 200 };
  if (routeKey === "$disconnect") {
    await handleDisconnect(client, connectionId);
    return { statusCode: 200 };
  }

  let message;
  try {
    message = JSON.parse(event.body ?? "{}");
  } catch {
    await sendTo(client, connectionId, { type: "error", message: "Bad message." });
    return { statusCode: 200 };
  }

  try {
    switch (message.action ?? message.type) {
      case "host":
        await handleHost(client, connectionId, message);
        break;
      case "join":
        await handleJoin(client, connectionId, message);
        break;
      case "start":
        await handleStart(client, connectionId);
        break;
      case "find":
        await handleFind(client, connectionId, message);
        break;
      case "again":
        await handleAgain(client, connectionId);
        break;
      case "endcheck":
        await handleEndCheck(client, connectionId);
        break;
      case "telemetry":
        // Telemetry intentionally dropped in the cloud build.
        break;
      default:
        await sendTo(client, connectionId, { type: "error", message: "Unknown action." });
    }
  } catch (err) {
    await sendTo(client, connectionId, { type: "error", message: "Something went wrong." });
  }
  return { statusCode: 200 };
}

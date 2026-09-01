import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import QRCode from "qrcode";
import { DIFFICULTIES, generateGrid, scoreGame, validateFind } from "./engine.js";
import {
  addPlayer,
  applyClientEvent,
  closeSession,
  createSession,
  finishRound,
  markPlayerLeft,
  recordEvent,
  recordFind,
  startRound,
} from "./telemetry.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const MAX_PLAYERS = 6;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PLAYER_COLORS = ["#ffffff", "#9bb8d0", "#d7e3ee", "#6e93b5", "#eef3f8", "#3d6a8f"];
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const rooms = new Map();
const sockets = new Map();

const wordText = await readFile(path.join(ROOT, "words.txt"), "utf8");
const wordSet = new Set(
  wordText
    .split(/\s+/)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => /^[a-z]{3,12}$/.test(word)),
);

function lanAddresses() {
  const found = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === "IPv4" && !item.internal) found.push(item.address);
    }
  }
  return found;
}

function makeId() {
  return randomBytes(6).toString("hex");
}

function makeCode() {
  let code = "";
  for (let i = 0; i < 4; i += 1) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return rooms.has(code) ? makeCode() : code;
}

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function publicPlayers(room) {
  return room.players.map(({ id, name, color }) => ({ id, name, color }));
}

function rankingsOf(room) {
  return scoreGame(
    room.players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      words: [...(room.finds.get(player.id) ?? [])],
    })),
  ).rankings;
}

function broadcast(room, payload) {
  for (const player of room.players) send(player.ws, payload);
}

function publicOrigin() {
  const raw = String(process.env.PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  if (raw) return raw;
  const ip = lanAddresses()[0];
  return ip ? `http://${ip}:${PORT}` : `http://127.0.0.1:${PORT}`;
}

function joinOrigin() {
  return publicOrigin();
}

function joinUrlFor(code) {
  return `${joinOrigin()}/?code=${code}`;
}

async function roomShare(code) {
  const joinUrl = joinUrlFor(code);
  try {
    const qrDataUrl = await QRCode.toDataURL(joinUrl, {
      width: 280,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#002145", light: "#ffffff" },
    });
    return { joinUrl, qrDataUrl };
  } catch {
    return { joinUrl, qrDataUrl: "" };
  }
}

function lobbyPayload(room) {
  return {
    type: "lobby",
    code: room.code,
    hostId: room.hostId,
    size: room.size,
    durationSec: room.durationSec,
    difficulty: room.difficulty,
    players: publicPlayers(room),
    joinUrl: room.joinUrl ?? joinUrlFor(room.code),
    qrDataUrl: room.qrDataUrl ?? "",
  };
}

function clearTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function endRound(room) {
  if (room.phase !== "play") return;
  clearTimer(room);
  room.phase = "results";
  const rankings = rankingsOf(room);
  finishRound(room.telemetry, rankings);
  broadcast(room, { type: "ended", rankings });
}

function leaveRoom(ws) {
  const info = sockets.get(ws);
  if (!info) return;
  sockets.delete(ws);
  const room = rooms.get(info.code);
  if (!room) return;
  const leavingHost = info.playerId === room.hostId;
  markPlayerLeft(room.telemetry, info.playerId);
  recordEvent(room.telemetry, "player_left", {
    playerId: info.playerId,
    remaining: room.players.length - 1,
  });
  room.players = room.players.filter((player) => player.id !== info.playerId);
  if (room.players.length === 0 || leavingHost) {
    clearTimer(room);
    for (const player of room.players) {
      send(player.ws, { type: "closed", message: "The host left the room." });
      sockets.delete(player.ws);
      markPlayerLeft(room.telemetry, player.id);
    }
    closeSession(room.telemetry, leavingHost ? "host_left" : "empty");
    rooms.delete(room.code);
    return;
  }
  if (room.phase === "lobby") broadcast(room, lobbyPayload(room));
  else broadcast(room, { type: "scores", rankings: rankingsOf(room) });
}

async function handleHost(ws, message) {
  const name = String(message.name ?? "").trim().slice(0, 18);
  const size = Number(message.size);
  const durationSec = Number(message.durationSec);
  const difficulty = String(message.difficulty ?? "medium");
  if (!name) return send(ws, { type: "error", message: "Enter your name." });
  if (![8, 10, 12, 15].includes(size)) return send(ws, { type: "error", message: "Pick a board size." });
  if (![60, 120, 180, 300].includes(durationSec)) {
    return send(ws, { type: "error", message: "Pick a round length." });
  }
  if (!DIFFICULTIES[difficulty]) return send(ws, { type: "error", message: "Pick a difficulty." });
  leaveRoom(ws);
  const code = makeCode();
  const player = { id: makeId(), name, color: PLAYER_COLORS[0], ws };
  const room = {
    code,
    hostId: player.id,
    size,
    durationSec,
    difficulty,
    phase: "lobby",
    players: [player],
    finds: new Map(),
    grid: null,
    planted: [],
    endAt: 0,
    timer: null,
    telemetry: createSession({
      sessionId: makeId(),
      code,
      difficulty,
      size,
      durationSec,
    }),
    joinUrl: "",
    qrDataUrl: "",
  };
  const share = await roomShare(code);
  room.joinUrl = share.joinUrl;
  room.qrDataUrl = share.qrDataUrl;
  addPlayer(room.telemetry, { id: player.id, name: player.name, isHost: true });
  recordEvent(room.telemetry, "room_created", { difficulty, size, durationSec });
  recordEvent(room.telemetry, "player_joined", { playerId: player.id, isHost: true, playerCount: 1 });
  rooms.set(code, room);
  sockets.set(ws, { code, playerId: player.id });
  send(ws, { type: "welcome", playerId: player.id, isHost: true });
  send(ws, lobbyPayload(room));
}

function handleJoin(ws, message) {
  const name = String(message.name ?? "").trim().slice(0, 18);
  const code = String(message.code ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
  const room = rooms.get(code);
  if (!name) return send(ws, { type: "error", message: "Enter your name." });
  if (!room) return send(ws, { type: "error", message: "No room with that code." });
  if (room.phase !== "lobby") return send(ws, { type: "error", message: "That round already started." });
  if (room.players.length >= MAX_PLAYERS) return send(ws, { type: "error", message: "That room is full." });
  if (room.players.some((player) => player.name.toLowerCase() === name.toLowerCase())) {
    return send(ws, { type: "error", message: "That name is already in the room." });
  }
  leaveRoom(ws);
  const player = {
    id: makeId(),
    name,
    color: PLAYER_COLORS[room.players.length % PLAYER_COLORS.length],
    ws,
  };
  room.players.push(player);
  sockets.set(ws, { code: room.code, playerId: player.id });
  addPlayer(room.telemetry, { id: player.id, name: player.name, isHost: false });
  recordEvent(room.telemetry, "player_joined", {
    playerId: player.id,
    isHost: false,
    playerCount: room.players.length,
  });
  send(ws, { type: "welcome", playerId: player.id, isHost: false });
  broadcast(room, lobbyPayload(room));
}

function handleStart(ws) {
  const info = sockets.get(ws);
  const room = info ? rooms.get(info.code) : null;
  if (!room || info.playerId !== room.hostId) {
    return send(ws, { type: "error", message: "Only the host can start." });
  }
  if (room.phase !== "lobby") return send(ws, { type: "error", message: "The round already started." });
  if (room.players.length < 1) {
    return send(ws, { type: "error", message: "No players in the room." });
  }
  room.phase = "starting";
  const generateStarted = Date.now();
  let generated;
  try {
    generated = generateGrid(room.size, [...wordSet], Math.random, room.difficulty);
  } catch {
    room.phase = "lobby";
    return send(ws, { type: "error", message: "Could not build the board. Try again." });
  }
  room.grid = generated.grid;
  room.planted = generated.placed;
  room.finds = new Map(room.players.map((player) => [player.id, []]));
  room.phase = "play";
  room.endAt = Date.now() + room.durationSec * 1000;
  startRound(room.telemetry, {
    plantedCount: generated.placed.length,
    generateMs: Date.now() - generateStarted,
    playerCount: room.players.length,
  });
  clearTimer(room);
  room.timer = setTimeout(() => endRound(room), room.durationSec * 1000 + 50);
  broadcast(room, {
    type: "round",
    grid: room.grid,
    endAt: room.endAt,
    durationSec: room.durationSec,
    players: publicPlayers(room),
    rankings: rankingsOf(room),
  });
}

function handleFind(ws, message) {
  const info = sockets.get(ws);
  const room = info ? rooms.get(info.code) : null;
  if (!room || room.phase !== "play") {
    if (room) recordFind(room.telemetry, info.playerId, { ok: false, reason: "not_active" });
    return send(ws, { type: "find-err", message: "The round is not active." });
  }
  const cells = Array.isArray(message.cells)
    ? message.cells.map((cell) => ({ r: Number(cell.r), c: Number(cell.c) }))
    : [];
  const result = validateFind(room.grid, cells, wordSet);
  if (!result.ok) {
    recordFind(room.telemetry, info.playerId, { ok: false, reason: result.reason });
    return send(ws, { type: "find-err", message: result.reason });
  }
  const words = room.finds.get(info.playerId) ?? [];
  if (words.includes(result.word)) {
    recordFind(room.telemetry, info.playerId, { ok: false, reason: "duplicate" });
    return send(ws, { type: "find-err", message: `You already found ${result.word.toUpperCase()}` });
  }
  room.finds.set(info.playerId, words.concat(result.word));
  const rankings = rankingsOf(room);
  const row = rankings.find((item) => item.id === info.playerId);
  const entry = [...(row?.unique ?? []), ...(row?.shared ?? [])].find(
    (item) => item.word === result.word.toUpperCase(),
  );
  const kind = entry?.finderCount === 1 ? "unique" : "shared";
  recordFind(room.telemetry, info.playerId, {
    ok: true,
    word: result.word,
    kind,
    length: result.word.length,
  });
  send(ws, {
    type: "find-ok",
    word: result.word.toUpperCase(),
    kind,
    points: entry?.points ?? 0,
    rankings,
  });
  broadcast(room, { type: "scores", rankings });
}

function handleAgain(ws) {
  const info = sockets.get(ws);
  const room = info ? rooms.get(info.code) : null;
  if (!room || info.playerId !== room.hostId) {
    return send(ws, { type: "error", message: "Only the host can play again." });
  }
  clearTimer(room);
  room.phase = "lobby";
  room.grid = null;
  room.finds = new Map();
  room.endAt = 0;
  recordEvent(room.telemetry, "play_again", { playerId: info.playerId });
  broadcast(room, lobbyPayload(room));
}

function handleTelemetry(ws, message) {
  const info = sockets.get(ws);
  const room = info ? rooms.get(info.code) : null;
  if (!room) return;
  applyClientEvent(room.telemetry, info.playerId, message);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.pathname === "/api/info") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      ok: true,
      port: PORT,
      addresses: lanAddresses(),
      publicUrl: publicOrigin(),
    }));
    return;
  }
  let relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (!relative || relative === "") relative = "index.html";
  const top = relative.split(/[/\\]/)[0];
  if (top === "telemetry" || relative === "server.js" || relative === "telemetry.js") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const filePath = path.normalize(path.join(ROOT, relative));
  const resolved = path.resolve(filePath);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(resolved);
    res.writeHead(200, { "Content-Type": MIME[path.extname(resolved)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return send(ws, { type: "error", message: "Bad message." });
    }
    if (message.type === "host") {
      handleHost(ws, message).catch(() => send(ws, { type: "error", message: "Could not create the room." }));
    }
    else if (message.type === "join") handleJoin(ws, message);
    else if (message.type === "start") handleStart(ws);
    else if (message.type === "find") handleFind(ws, message);
    else if (message.type === "again") handleAgain(ws);
    else if (message.type === "telemetry") handleTelemetry(ws, message);
  });
  ws.on("close", () => leaveRoom(ws));
});

function onListen() {
  const extra = lanAddresses().map((ip) => `http://${ip}:${PORT}`).join("  ");
  const published = process.env.PUBLIC_URL ? `  public ${publicOrigin()}` : "";
  console.log(`DxL Word Grid at http://localhost:${PORT}${extra ? `  ${extra}` : ""}${published}`);
}

if (process.env.HOST) server.listen(PORT, process.env.HOST, onListen);
else server.listen(PORT, onListen);

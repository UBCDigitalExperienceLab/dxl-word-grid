import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.TELEMETRY_DIR || path.join(ROOT, "telemetry");
const EVENTS_FILE = path.join(DIR, "events.jsonl");
const ROOMS_FILE = path.join(DIR, "rooms.jsonl");

const ready = mkdir(DIR, { recursive: true });
let writes = Promise.resolve();

function appendJsonl(file, record) {
  writes = writes
    .then(async () => {
      await ready;
      await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
    })
    .catch((error) => {
      console.error("telemetry write failed", error.message);
    });
  return writes;
}

export function createSession({ sessionId, code, difficulty, size, durationSec }) {
  return {
    sessionId,
    code,
    createdAt: Date.now(),
    closedAt: null,
    closeReason: null,
    difficulty,
    size,
    durationSec,
    peakPlayers: 0,
    players: new Map(),
    rounds: [],
    currentRound: null,
    generateMs: [],
  };
}

export function addPlayer(session, { id, name, isHost }) {
  const now = Date.now();
  session.players.set(id, {
    id,
    name,
    isHost: Boolean(isHost),
    joinedAt: now,
    leftAt: null,
    findOk: 0,
    findErr: 0,
    selections: 0,
    visibleMs: 0,
    screens: { lobby: 0, play: 0, results: 0 },
    home: 0,
  });
  session.peakPlayers = Math.max(session.peakPlayers, [...session.players.values()].filter((row) => !row.leftAt).length);
}

export function markPlayerLeft(session, playerId, at = Date.now()) {
  const player = session.players.get(playerId);
  if (player && !player.leftAt) player.leftAt = at;
}

export function recordEvent(session, event, extra = {}) {
  const row = {
    at: new Date().toISOString(),
    sessionId: session.sessionId,
    code: session.code,
    event,
    ...extra,
  };
  appendJsonl(EVENTS_FILE, row);
  return row;
}

export function applyClientEvent(session, playerId, message) {
  const player = session.players.get(playerId);
  if (!player || player.leftAt) return;
  const event = String(message.event ?? "");
  if (event === "selection") {
    player.selections += 1;
    recordEvent(session, "selection", { playerId });
    return;
  }
  if (event === "home") {
    player.home += 1;
    recordEvent(session, "home", { playerId });
    return;
  }
  if (event === "presence") {
    const ms = Math.min(60_000, Math.max(0, Number(message.ms) || 0));
    const screen = String(message.screen ?? "");
    if (ms && (screen === "lobby" || screen === "play" || screen === "results")) {
      player.visibleMs += ms;
      player.screens[screen] += ms;
    }
    return;
  }
  if (event === "screen") {
    const screen = String(message.screen ?? "");
    if (screen === "lobby" || screen === "play" || screen === "results") {
      recordEvent(session, "screen", { playerId, screen });
    }
  }
}

export function startRound(session, { plantedCount, generateMs, playerCount }) {
  session.currentRound = {
    startedAt: Date.now(),
    endedAt: null,
    plantedCount,
    generateMs,
    playerCount,
    finds: 0,
    scores: [],
  };
  session.generateMs.push(generateMs);
  recordEvent(session, "round_started", { plantedCount, generateMs, playerCount });
}

export function finishRound(session, rankings, at = Date.now()) {
  const round = session.currentRound;
  if (!round) return null;
  round.endedAt = at;
  round.elapsedMs = at - round.startedAt;
  round.scores = rankings.map((row) => ({
    id: row.id,
    name: row.name,
    points: row.points,
    wordCount: row.wordCount,
    uniqueCount: row.uniqueCount,
  }));
  session.rounds.push(round);
  session.currentRound = null;
  recordEvent(session, "round_ended", {
    elapsedMs: round.elapsedMs,
    finds: round.finds,
    scores: round.scores,
  });
  return round;
}

export function recordFind(session, playerId, { ok, word, kind, length, reason }) {
  const player = session.players.get(playerId);
  if (ok) {
    if (player) player.findOk += 1;
    if (session.currentRound) session.currentRound.finds += 1;
    recordEvent(session, "find_ok", { playerId, word, kind, length });
    return;
  }
  if (player) player.findErr += 1;
  recordEvent(session, "find_err", { playerId, reason });
}

export function summarizeSession(session, { closeReason, closedAt = Date.now() } = {}) {
  const players = [...session.players.values()].map((player) => {
    const leftAt = player.leftAt ?? closedAt;
    return {
      id: player.id,
      name: player.name,
      isHost: player.isHost,
      joinedAt: new Date(player.joinedAt).toISOString(),
      leftAt: new Date(leftAt).toISOString(),
      msInRoom: Math.max(0, leftAt - player.joinedAt),
      visibleMs: player.visibleMs,
      screens: player.screens,
      findOk: player.findOk,
      findErr: player.findErr,
      selections: player.selections,
      home: player.home,
    };
  });
  const playMs = session.rounds.reduce((sum, round) => sum + (round.elapsedMs ?? 0), 0);
  return {
    sessionId: session.sessionId,
    code: session.code,
    createdAt: new Date(session.createdAt).toISOString(),
    closedAt: new Date(closedAt).toISOString(),
    durationMs: closedAt - session.createdAt,
    closeReason: closeReason ?? session.closeReason,
    difficulty: session.difficulty,
    size: session.size,
    durationSec: session.durationSec,
    peakPlayers: session.peakPlayers,
    playerCount: players.length,
    roundCount: session.rounds.length,
    playMs,
    findOk: players.reduce((sum, row) => sum + row.findOk, 0),
    findErr: players.reduce((sum, row) => sum + row.findErr, 0),
    selections: players.reduce((sum, row) => sum + row.selections, 0),
    players,
    rounds: session.rounds.map((round) => ({
      startedAt: new Date(round.startedAt).toISOString(),
      endedAt: round.endedAt ? new Date(round.endedAt).toISOString() : null,
      elapsedMs: round.elapsedMs ?? null,
      plantedCount: round.plantedCount,
      generateMs: round.generateMs,
      playerCount: round.playerCount,
      finds: round.finds,
      scores: round.scores,
    })),
  };
}

export function closeSession(session, closeReason) {
  const closedAt = Date.now();
  if (session.currentRound) {
    finishRound(session, [], closedAt);
  }
  for (const player of session.players.values()) {
    if (!player.leftAt) player.leftAt = closedAt;
  }
  session.closedAt = closedAt;
  session.closeReason = closeReason;
  const summary = summarizeSession(session, { closeReason, closedAt });
  recordEvent(session, "room_closed", {
    closeReason,
    durationMs: summary.durationMs,
    peakPlayers: summary.peakPlayers,
    roundCount: summary.roundCount,
    findOk: summary.findOk,
  });
  appendJsonl(ROOMS_FILE, summary);
  const seconds = Math.round(summary.durationMs / 1000);
  console.log(
    `[telemetry] room ${summary.code} ${summary.difficulty} ${summary.size}×${summary.size} ${summary.playerCount} players ${summary.roundCount} rounds ${seconds}s → telemetry/rooms.jsonl`,
  );
  return summary;
}

export const paths = { dir: DIR, events: EVENTS_FILE, rooms: ROOMS_FILE };

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addPlayer,
  applyClientEvent,
  createSession,
  finishRound,
  markPlayerLeft,
  recordFind,
  startRound,
  summarizeSession,
} from "./telemetry.js";

test("room summary includes time spent and interactions", () => {
  const session = createSession({
    sessionId: "s1",
    code: "ABCD",
    difficulty: "easy",
    size: 10,
    durationSec: 120,
  });
  session.createdAt = 1_000;
  addPlayer(session, { id: "host", name: "Ada", isHost: true });
  addPlayer(session, { id: "guest", name: "Bea", isHost: false });
  session.players.get("host").joinedAt = 1_000;
  session.players.get("guest").joinedAt = 1_500;

  startRound(session, { plantedCount: 12, generateMs: 40, playerCount: 2 });
  session.currentRound.startedAt = 2_000;
  recordFind(session, "host", { ok: true, word: "cat", kind: "unique", length: 3 });
  recordFind(session, "guest", { ok: false, reason: "not_in_list" });
  applyClientEvent(session, "host", { event: "selection" });
  applyClientEvent(session, "host", { event: "presence", screen: "play", ms: 8_000 });
  finishRound(
    session,
    [
      { id: "host", name: "Ada", points: 9, wordCount: 1, uniqueCount: 1 },
      { id: "guest", name: "Bea", points: 0, wordCount: 0, uniqueCount: 0 },
    ],
    62_000,
  );
  markPlayerLeft(session, "guest", 63_000);

  const summary = summarizeSession(session, { closeReason: "host_left", closedAt: 70_000 });
  assert.equal(summary.code, "ABCD");
  assert.equal(summary.difficulty, "easy");
  assert.equal(summary.peakPlayers, 2);
  assert.equal(summary.roundCount, 1);
  assert.equal(summary.playMs, 60_000);
  assert.equal(summary.findOk, 1);
  assert.equal(summary.findErr, 1);
  assert.equal(summary.selections, 1);
  assert.equal(summary.closeReason, "host_left");
  const host = summary.players.find((row) => row.id === "host");
  const guest = summary.players.find((row) => row.id === "guest");
  assert.equal(host.msInRoom, 69_000);
  assert.equal(host.visibleMs, 8_000);
  assert.equal(host.screens.play, 8_000);
  assert.equal(guest.msInRoom, 61_500);
});

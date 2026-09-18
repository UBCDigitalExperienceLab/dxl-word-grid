import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pathIsLegal,
  applyCellToPath,
  areAdjacent,
  generateGrid,
  lineCells,
  pointsForFinders,
  scoreGame,
} from "./index.js";

test("unique words score length times length", () => {
  const result = scoreGame([
    { id: "a", name: "Ada", color: "#000", words: ["stream"] },
    { id: "b", name: "Bea", color: "#111", words: ["cat"] },
  ]);
  const ada = result.rankings.find((row) => row.id === "a");
  assert.equal(ada.points, 36);
  assert.equal(ada.uniqueCount, 1);
  assert.equal(ada.sharedCount, 0);
});

test("shared words score one point per letter for each finder", () => {
  const result = scoreGame([
    { id: "a", name: "Ada", color: "#000", words: ["cat"] },
    { id: "b", name: "Bea", color: "#111", words: ["cat"] },
  ]);
  assert.equal(result.rankings[0].points, 3);
  assert.equal(result.rankings[1].points, 3);
  assert.equal(result.rankings[0].sharedCount, 1);
});

test("a later shared find drops the earlier unique bonus", () => {
  const before = scoreGame([
    { id: "a", name: "Ada", color: "#000", words: ["ocean"] },
    { id: "b", name: "Bea", color: "#111", words: [] },
  ]);
  const after = scoreGame([
    { id: "a", name: "Ada", color: "#000", words: ["ocean"] },
    { id: "b", name: "Bea", color: "#111", words: ["ocean"] },
  ]);
  assert.equal(before.rankings[0].points, 25);
  assert.equal(after.rankings.find((row) => row.id === "a").points, 5);
});

test("winner is highest points, then unique count", () => {
  const byPoints = scoreGame([
    { id: "a", name: "Ada", color: "#000", words: ["cat", "dog"] },
    { id: "b", name: "Bea", color: "#111", words: ["streams"] },
  ]);
  assert.equal(byPoints.rankings[0].id, "b");
  assert.equal(byPoints.rankings[0].points, 49);

  const byUniques = scoreGame([
    { id: "a", name: "Ada", color: "#000", words: ["cat", "dog", "bat", "hat"] },
    { id: "b", name: "Bea", color: "#111", words: ["stream"] },
  ]);
  assert.equal(byUniques.rankings[0].id, "a");
  assert.equal(byUniques.rankings[0].points, 36);
  assert.equal(byUniques.rankings[0].uniqueCount, 4);
});

test("applyCellToPath snakes, backtracks, and blocks reused cells", () => {
  const start = applyCellToPath([], { r: 1, c: 1 });
  const across = applyCellToPath(start, { r: 1, c: 2 });
  const turn = applyCellToPath(across, { r: 2, c: 3 });
  assert.deepEqual(turn, [
    { r: 1, c: 1 },
    { r: 1, c: 2 },
    { r: 2, c: 3 },
  ]);
  assert.deepEqual(applyCellToPath(turn, { r: 1, c: 2 }), [
    { r: 1, c: 1 },
    { r: 1, c: 2 },
  ]);
  assert.equal(areAdjacent({ r: 0, c: 0 }, { r: 1, c: 1 }), true);
  assert.equal(areAdjacent({ r: 0, c: 0 }, { r: 0, c: 2 }), false);
  assert.equal(applyCellToPath(turn, { r: 1, c: 1 }), null);
});

test("pathIsLegal allows snakes and straight lines", () => {
  assert.equal(
    pathIsLegal(
      [
        { r: 0, c: 0 },
        { r: 0, c: 1 },
        { r: 1, c: 2 },
      ],
      5,
    ),
    true,
  );
  assert.equal(
    pathIsLegal(
      [
        { r: 0, c: 0 },
        { r: 0, c: 1 },
        { r: 0, c: 2 },
      ],
      5,
    ),
    true,
  );
  assert.equal(
    pathIsLegal(
      [
        { r: 0, c: 0 },
        { r: 0, c: 2 },
        { r: 0, c: 4 },
      ],
      5,
    ),
    false,
  );
});

test("lineCells returns a diagonal path", () => {
  const cells = lineCells(0, 0, 2, 2);
  assert.deepEqual(cells, [
    { r: 0, c: 0 },
    { r: 1, c: 1 },
    { r: 2, c: 2 },
  ]);
});

test("generateGrid fills every cell and plants words", () => {
  const words = ["stream", "ocean", "forest", "light", "table", "river", "stone"];
  const { grid, placed } = generateGrid(8, words, () => 0.4);
  assert.equal(grid.length, 8);
  assert.ok(placed.length >= 1);
  assert.ok(grid.every((row) => row.every((cell) => /^[A-Z]$/.test(cell))));
});

test("easy plants shorter words than hard", () => {
  const words = [
    "cat",
    "dog",
    "hat",
    "sun",
    "map",
    "stream",
    "forest",
    "planet",
    "bridge",
    "window",
    "castle",
  ];
  const easy = generateGrid(8, words, () => 0.35, "easy");
  const hard = generateGrid(8, words, () => 0.35, "hard");
  assert.ok(easy.placed.length >= 1);
  assert.ok(easy.placed.every((word) => word.length <= 6));
  assert.ok(hard.placed.every((word) => word.length >= 5));
});

test("unknown difficulty falls back to medium", () => {
  const words = ["stream", "ocean", "forest", "light", "table", "river"];
  const { grid } = generateGrid(8, words, () => 0.4, "unknown");
  assert.ok(grid.every((row) => row.every((cell) => /^[A-Z]$/.test(cell))));
});

test("pointsForFinders distinguishes unique and shared", () => {
  assert.equal(pointsForFinders("word", 1), 16);
  assert.equal(pointsForFinders("feed", 1), 16);
  assert.equal(pointsForFinders("ocean", 1), 25);
  assert.equal(pointsForFinders("word", 2), 4);
});

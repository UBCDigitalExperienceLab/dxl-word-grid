/** Pure game rules: grid generation, line selection, uniqueness scoring. */

export const DIRECTIONS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export const MIN_WORD_LENGTH = 3;
export const SHARED_POINTS_PER_LETTER = 1;

const LETTER_BAG =
  "EEEEEEEEEEEEAAAAAAAAAIIIIIIIIIOOOOOOOONNNNNNRRRRRRTTTTTTLLLLSSSSUUUUDDDDGGGBBCCMMPPFFHHVVWWYYKJXQZ";

export function shuffle(items, rng = Math.random) {
  const next = items.slice();
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function cellsAreAligned(r1, c1, r2, c2) {
  const dr = r2 - r1;
  const dc = c2 - c1;
  if (dr === 0 && dc === 0) return true;
  return dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc);
}

export function lineCells(r1, c1, r2, c2) {
  if (!cellsAreAligned(r1, c1, r2, c2)) return null;
  const dr = Math.sign(r2 - r1);
  const dc = Math.sign(c2 - c1);
  const steps = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1));
  const cells = [];
  for (let i = 0; i <= steps; i += 1) {
    cells.push({ r: r1 + dr * i, c: c1 + dc * i });
  }
  return cells;
}

export function wordFromCells(grid, cells) {
  return cells.map(({ r, c }) => grid[r][c]).join("");
}

export function sameCell(a, b) {
  return a.r === b.r && a.c === b.c;
}

export function areAdjacent(a, b) {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return dr <= 1 && dc <= 1 && (dr !== 0 || dc !== 0);
}

export function pathContains(path, cell) {
  return path.some((item) => sameCell(item, cell));
}

/** Next path after touching `cell`, or null if that cell cannot join the trail. */
export function applyCellToPath(path, cell) {
  if (path.length === 0) return [cell];
  const last = path[path.length - 1];
  if (sameCell(last, cell)) return path;
  const prev = path[path.length - 2];
  if (prev && sameCell(prev, cell)) return path.slice(0, -1);
  if (areAdjacent(last, cell) && !pathContains(path, cell)) {
    return path.concat(cell);
  }
  return null;
}

export function pathIsLegal(cells, size) {
  if (!Array.isArray(cells) || cells.length < MIN_WORD_LENGTH) return false;
  const seen = new Set();
  for (const cell of cells) {
    if (!cell || !Number.isInteger(cell.r) || !Number.isInteger(cell.c)) return false;
    if (cell.r < 0 || cell.c < 0 || cell.r >= size || cell.c >= size) return false;
    const key = `${cell.r},${cell.c}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  const line = lineCells(cells[0].r, cells[0].c, cells[cells.length - 1].r, cells[cells.length - 1].c);
  const isLine =
    line &&
    line.length === cells.length &&
    line.every((cell, index) => sameCell(cell, cells[index]));
  if (isLine) return true;
  for (let i = 1; i < cells.length; i += 1) {
    if (!areAdjacent(cells[i - 1], cells[i])) return false;
  }
  return true;
}

export function validateFind(grid, cells, wordSet) {
  if (!pathIsLegal(cells, grid.length)) return { ok: false, reason: "That path is not allowed." };
  const word = wordFromCells(grid, cells).toLowerCase();
  if (!wordSet.has(word)) return { ok: false, reason: `${word.toUpperCase()} is not in the word list` };
  return { ok: true, word };
}

function canPlace(grid, word, r, c, dr, dc) {
  const size = grid.length;
  const letters = word.toUpperCase().split("");
  const endR = r + dr * (letters.length - 1);
  const endC = c + dc * (letters.length - 1);
  if (endR < 0 || endC < 0 || endR >= size || endC >= size) return false;
  for (let i = 0; i < letters.length; i += 1) {
    const ch = grid[r + dr * i][c + dc * i];
    if (ch && ch !== letters[i]) return false;
  }
  return true;
}

function placeWord(grid, word, rng) {
  const size = grid.length;
  const dirs = shuffle(DIRECTIONS, rng);
  for (const [dr, dc] of dirs) {
    const slots = [];
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (canPlace(grid, word, r, c, dr, dc)) slots.push([r, c]);
      }
    }
    if (slots.length === 0) continue;
    const [r, c] = slots[Math.floor(rng() * slots.length)];
    const letters = word.toUpperCase().split("");
    for (let i = 0; i < letters.length; i += 1) {
      grid[r + dr * i][c + dc * i] = letters[i];
    }
    return true;
  }
  return false;
}

function placeSnakeWord(grid, word, rng) {
  const letters = word.toUpperCase().split("");
  const size = grid.length;
  const starts = [];
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!grid[r][c] || grid[r][c] === letters[0]) starts.push({ r, c });
    }
  }

  for (const start of shuffle(starts, rng).slice(0, 36)) {
    let nodes = 0;
    const path = [];
    const walk = (cell, index) => {
      if (++nodes > 900) return false;
      const existing = grid[cell.r][cell.c];
      if (existing && existing !== letters[index]) return false;
      if (pathContains(path, cell)) return false;
      path.push(cell);
      if (index === letters.length - 1) return true;
      const dirs = shuffle(DIRECTIONS, rng);
      for (const [dr, dc] of dirs) {
        const next = { r: cell.r + dr, c: cell.c + dc };
        if (next.r < 0 || next.c < 0 || next.r >= size || next.c >= size) continue;
        if (walk(next, index + 1)) return true;
      }
      path.pop();
      return false;
    };
    if (walk(start, 0)) {
      path.forEach((cell, i) => {
        grid[cell.r][cell.c] = letters[i];
      });
      return true;
    }
  }
  return false;
}

export function generateGrid(size, wordList, rng = Math.random) {
  const grid = Array.from({ length: size }, () => Array(size).fill(""));
  const usable = wordList.filter(
    (word) => word.length >= 4 && word.length <= Math.min(size, 10),
  );
  const candidates = shuffle(usable, rng);
  const target = Math.min(candidates.length, Math.round(size * 1.7));
  const placed = [];

  for (const word of candidates) {
    if (placed.length >= target) break;
    if (placeWord(grid, word, rng)) placed.push(word.toUpperCase());
  }

  const snakeTarget = Math.min(candidates.length, Math.max(2, Math.round(size * 0.5)));
  let snakes = 0;
  for (const word of candidates) {
    if (snakes >= snakeTarget) break;
    const upper = word.toUpperCase();
    if (placed.includes(upper)) continue;
    if (placeSnakeWord(grid, word, rng)) {
      placed.push(upper);
      snakes += 1;
    }
  }

  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!grid[r][c]) {
        grid[r][c] = LETTER_BAG[Math.floor(rng() * LETTER_BAG.length)];
      }
    }
  }

  return { grid, placed };
}

export function pointsForFinders(word, finderCount) {
  const length = word.length;
  if (finderCount <= 1) return length * length;
  return length * SHARED_POINTS_PER_LETTER;
}

/**
 * @param {{ id: string, name: string, color: string, words: string[] }[]} players
 */
export function scoreGame(players) {
  const finders = new Map();

  for (const player of players) {
    const seen = new Set();
    for (const raw of player.words) {
      const word = raw.toLowerCase();
      if (seen.has(word)) continue;
      seen.add(word);
      if (!finders.has(word)) finders.set(word, []);
      finders.get(word).push(player.id);
    }
  }

  const rankings = players.map((player) => {
    const unique = [];
    const shared = [];
    const seen = new Set();

    for (const raw of player.words) {
      const word = raw.toLowerCase();
      if (seen.has(word)) continue;
      seen.add(word);
      const who = finders.get(word) ?? [player.id];
      const entry = {
        word: word.toUpperCase(),
        length: word.length,
        finderCount: who.length,
        finderIds: who.slice(),
        points: pointsForFinders(word, who.length),
      };
      if (who.length === 1) unique.push(entry);
      else shared.push(entry);
    }

    const byPoints = (a, b) =>
      b.points - a.points || a.word.localeCompare(b.word);
    unique.sort(byPoints);
    shared.sort(byPoints);

    const points = unique.concat(shared).reduce((sum, item) => sum + item.points, 0);

    return {
      id: player.id,
      name: player.name,
      color: player.color,
      unique,
      shared,
      uniqueCount: unique.length,
      sharedCount: shared.length,
      wordCount: unique.length + shared.length,
      points,
    };
  });

  rankings.sort(
    (a, b) =>
      b.points - a.points ||
      b.uniqueCount - a.uniqueCount ||
      b.wordCount - a.wordCount ||
      a.name.localeCompare(b.name),
  );

  return { rankings, finders };
}

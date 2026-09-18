/**
 * Loads the ENABLE word list that ships inside the Lambda bundle.
 *
 * The packaging step (scripts/package-lambdas.mjs) places words.txt at the root
 * of the deployment zip, beside index.js. At runtime Lambda unpacks that to
 * LAMBDA_TASK_ROOT (/var/task), so the list is resolved from there.
 *
 * Note: this module is bundled to CommonJS, where `import.meta` is not
 * available, so the path must not be derived from import.meta.url.
 *
 * Kept as a lazily-initialised singleton so the ~160k-word Set is built once
 * per warm container rather than on every invocation.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let wordSet = null;

function wordsPath() {
  const root = process.env.LAMBDA_TASK_ROOT || process.cwd();
  return path.join(root, "words.txt");
}

export function getWordSet() {
  if (wordSet) return wordSet;
  const text = readFileSync(wordsPath(), "utf8");
  wordSet = new Set(
    text
      .split(/\s+/)
      .map((word) => word.trim().toLowerCase())
      .filter((word) => /^[a-z]{3,12}$/.test(word)),
  );
  return wordSet;
}

/**
 * Downloads the ENABLE word list and writes it to the two places that need it:
 *   apps/web/public/words.txt  — served to the browser for optimistic highlighting
 *   services/ws/src/words.txt  — bundled into the Lambda for authoritative validation
 */
import { writeFile } from "node:fs/promises";

const SOURCE = "https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt";
const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`Could not download word list: ${response.status}`);

const words = [
  ...new Set(
    (await response.text())
      .split(/\s+/)
      .map((word) => word.trim().toLowerCase())
      .filter((word) => /^[a-z]{3,12}$/.test(word)),
  ),
].sort();

const body = `${words.join("\n")}\n`;
const targets = ["../apps/web/public/words.txt", "../services/ws/src/words.txt"];
await Promise.all(targets.map((target) => writeFile(new URL(target, import.meta.url), body)));

console.log(`Wrote ${words.length} words (3–12 letters) from ENABLE to ${targets.length} targets.`);

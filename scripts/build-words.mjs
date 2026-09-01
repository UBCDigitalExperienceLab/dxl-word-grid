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

await writeFile(new URL("../words.txt", import.meta.url), `${words.join("\n")}\n`);
console.log(`Wrote ${words.length} words (3–12 letters) from ENABLE.`);

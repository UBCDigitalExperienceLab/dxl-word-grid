/**
 * Bundles the WebSocket Lambda into dist/lambdas/ws.zip.
 *
 * esbuild inlines the engine workspace package and AWS SDK calls into a single
 * CommonJS index.js, then we copy words.txt beside it (words.js reads it from
 * its own directory at runtime) and zip the two together.
 */
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist", "lambdas");
const wsDir = join(outDir, "ws");

mkdirSync(wsDir, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: [join(root, "services", "ws", "src", "index.js")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: join(wsDir, "index.js"),
  // The AWS SDK v3 is present in the Lambda runtime, but bundling it keeps the
  // version deterministic. Comment the next line out to rely on the runtime copy.
  // external: ["@aws-sdk/*"],
  logLevel: "info",
});

// words.js resolves words.txt relative to its own directory; after bundling
// that directory is dist/lambdas/ws, so the file must sit right next to index.js.
copyFileSync(join(root, "services", "ws", "src", "words.txt"), join(wsDir, "words.txt"));
writeFileSync(join(wsDir, "package.json"), JSON.stringify({ type: "commonjs" }));

const zip = join(outDir, "ws.zip");
execSync(`tar -a -cf "${zip}" -C "${wsDir}" index.js words.txt package.json`, { stdio: "inherit" });
console.log(`wrote ${zip}`);

/**
 * Post-build step for GitHub Pages.
 *
 * Copies the built index.html to 404.html so deep links (e.g. /?code=ABCD after
 * a refresh) still load the app instead of showing the Pages 404 page.
 * Runs after `vite build`, so dist/index.html is guaranteed to exist.
 */
import { copyFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(webRoot, "dist");
const index = resolve(dist, "index.html");

if (!existsSync(index)) {
  throw new Error(`Expected ${index} to exist after the build.`);
}

copyFileSync(index, resolve(dist, "404.html"));
console.log("postbuild: wrote dist/404.html");

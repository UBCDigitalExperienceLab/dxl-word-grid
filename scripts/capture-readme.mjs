import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const origin = process.env.CAPTURE_URL || "http://127.0.0.1:5173";
const outDir = path.resolve("docs");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--hide-scrollbars"],
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 820 },
  deviceScaleFactor: 2,
});
await page.goto(origin, { waitUntil: "networkidle", timeout: 30_000 });
await page.waitForSelector("#screen-setup");
await page.screenshot({ path: path.join(outDir, "setup.png"), type: "png" });

await page.locator("#self-name").fill("Ada");
await page.locator('#setup-form input[name="size"][value="8"]').click();
await page.locator("#host-btn").click();
await page.waitForFunction(() => {
  const code = document.getElementById("lobby-code")?.textContent?.trim();
  return Boolean(code && code !== "----");
});
await page.waitForSelector("#lobby-qr[src]");
await page.screenshot({ path: path.join(outDir, "lobby.png"), type: "png" });

await page.locator("#lobby-start").click();
await page.waitForSelector("#screen-play:not([hidden])");
await page.waitForFunction(() => document.querySelectorAll("#board .cell").length >= 64);
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(outDir, "play.png"), type: "png" });

await browser.close();
console.log("Wrote docs/setup.png, docs/lobby.png, and docs/play.png");

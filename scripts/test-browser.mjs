import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mode = process.argv[2] ?? "ui";
const port = Number(process.env.CLUTCH_TEST_PORT ?? (mode === "ui" ? 3101 : 3102));
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = resolve(root, "test-artifacts", "screenshots");
const reviewDir = resolve(root, ".impeccable", "review");

function loadBrowserPathFromEnvFile() {
  if (process.env.CLUTCH_BROWSER_EXECUTABLE || !existsSync(resolve(root, ".env"))) return;
  const source = readFileSync(resolve(root, ".env"), "utf8");
  const entry = source.split(/\r?\n/).find((line) => /^\s*CLUTCH_BROWSER_EXECUTABLE\s*=/.test(line));
  const value = entry?.replace(/^\s*CLUTCH_BROWSER_EXECUTABLE\s*=\s*/, "").trim().replace(/^(?:"(.*)"|'(.*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
  if (value) process.env.CLUTCH_BROWSER_EXECUTABLE = value;
}

function browserExecutable() {
  const explicit = process.env.CLUTCH_BROWSER_EXECUTABLE?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/microsoft-edge"];
  return candidates.find((candidate) => existsSync(candidate));
}

function startServer() {
  const nextBin = resolve(root, "node_modules", "next", "dist", "bin", "next");
  const server = spawn(process.execPath, [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      CLUTCH_BROWSER_TEST: "1",
      CLUTCH_CONTRACT_ADDRESS: "",
      CLUTCH_RPC_URL: "http://127.0.0.1:1/api",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "",
      NEXT_PUBLIC_RPC_URL: "http://127.0.0.1:1/api",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  return server;
}

async function waitForServer(server) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Local Next.js server exited with code ${server.exitCode}.`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
  }
  server.kill();
  throw new Error(`Timed out waiting for the local app at ${baseUrl}.`);
}

async function runUi(page) {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByRole("heading", { name: "Make your next game count." }).waitFor({ state: "visible", timeout: 15_000 });
  assert.match(await page.title(), /Clutch/);
  assert.equal(await page.getByRole("region", { name: "Quest map" }).count(), 1);
  assert.equal(await page.getByText("NO LIVE REWARDS").count(), 1);

  await page.getByRole("button", { name: "List" }).click();
  assert.equal(await page.getByRole("button", { name: "List" }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: /Blitz Grove Example · no reward PREVIEW/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  assert.equal(await dialog.getByText("Preview only").count(), 2);
  assert.equal(await dialog.getByRole("button", { name: /Join quest|Claim reward/ }).count(), 0);
  await page.getByRole("button", { name: "Close quest details" }).click();

  await page.getByRole("button", { name: "Sponsor a quest" }).click();
  assert.equal(await page.getByRole("heading", { name: "Write a chess quest" }).count(), 1);
  assert.equal(await page.getByText("Connect your wallet to sponsor").count(), 1);
  await page.getByRole("button", { name: "Proof shelf" }).click();
  assert.equal(await page.getByRole("heading", { name: "Proof shelf" }).count(), 1);
  assert.equal(await page.getByText("Connect the public board").count(), 1);

  await page.getByRole("button", { name: "Quest map" }).click();
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(outputDir, "clutch-desktop-1440.png") });
  await page.screenshot({ path: resolve(reviewDir, "desktop.png"), fullPage: true });
  assert.deepEqual(pageErrors, [], `Browser runtime errors: ${pageErrors.join("; ")}`);
  console.log("PASS: wallet-free map, list navigation, reward-free sample details, sponsor gate, and proof shelf.");
  console.log(`Screenshot: ${resolve(outputDir, "clutch-desktop-1440.png")}`);
}

async function runResponsive(page) {
  const widths = [390, 768, 1280, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByRole("heading", { name: "Make your next game count." }).waitFor({ state: "visible", timeout: 15_000 });
    const metrics = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    assert.equal(metrics.horizontalOverflow, false, `${width}px viewport has horizontal overflow: ${JSON.stringify(metrics)}`);
    mkdirSync(outputDir, { recursive: true });
    await page.screenshot({ path: resolve(outputDir, `clutch-${width}.png`) });
    await page.screenshot({ path: resolve(reviewDir, `user-${width}.png`), fullPage: width !== 390 });
    if (width === 390) await page.screenshot({ path: resolve(reviewDir, "mobile.png"), fullPage: true });
    console.log(`PASS: ${width}px responsive layout; document width ${metrics.content}px.`);
  }
}

async function main() {
  if (!["ui", "responsive"].includes(mode)) throw new Error("Use test-browser.mjs ui or test-browser.mjs responsive.");
  loadBrowserPathFromEnvFile();
  const executablePath = browserExecutable();
  if (!executablePath) throw new Error("Chrome/Edge not found. Set CLUTCH_BROWSER_EXECUTABLE to a browser executable.");
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(reviewDir, { recursive: true });
  const server = startServer();
  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    if (mode === "ui") await runUi(page);
    else await runResponsive(page);
  } finally {
    await browser?.close();
    server.kill();
  }
}

main().catch((error) => {
  console.error(`Browser ${mode} check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

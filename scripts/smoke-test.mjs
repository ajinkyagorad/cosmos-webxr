// CDP smoke test: loads the app in headless Chrome (SwiftShader WebGL), waits REAL time,
// captures console messages, evaluates app state, and takes screenshots.
// Usage: node scripts/smoke-test.mjs [url]
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const URL_TO_TEST = process.argv[2] ?? "http://localhost:7100/?mode=desktop";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9222;

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader",
  "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox",
  `--remote-debugging-port=${PORT}`, "--window-size=1280,800", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === "page");
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error("Chrome CDP not reachable");
}

let msgId = 0;
const pending = new Map();
let ws;
const consoleLogs = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description ?? "exception" };
  return r.result?.value;
}

async function main() {
  const target = await getTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve } = pending.get(m.id);
      pending.delete(m.id);
      resolve(m.result);
    } else if (m.method === "Runtime.consoleAPICalled") {
      const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      consoleLogs.push(`[${m.params.type}] ${text}`);
    } else if (m.method === "Runtime.exceptionThrown") {
      consoleLogs.push(`[EXCEPTION] ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
    }
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: URL_TO_TEST });

  console.log("navigated, waiting for boot (real time)…");
  // Poll for boot completion up to 60 s.
  let state = null;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    state = await evaluate(`({
      loadingText: document.getElementById('loading-text')?.textContent,
      overlayHidden: document.getElementById('loading-overlay')?.classList.contains('hidden'),
      landingHidden: document.getElementById('landing')?.classList.contains('hidden'),
      hudHidden: document.getElementById('hud')?.classList.contains('hidden'),
      datasetLine: document.getElementById('dataset-line')?.textContent,
      speed: document.getElementById('speed-value')?.textContent,
      canvases: document.querySelectorAll('canvas').length,
    })`);
    if (state?.overlayHidden) break;
  }
  console.log("STATE:", JSON.stringify(state, null, 2));

  // Let it render a few seconds, then screenshot.
  await sleep(4000);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(new URL("../shot-desktop.png", import.meta.url), Buffer.from(shot.data, "base64"));

  // Fly forward a bit and take another shot (exercise navigation).
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'})); 'ok'`);
  await sleep(3000);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'})); 'ok'`);
  const shot2 = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(new URL("../shot-flight.png", import.meta.url), Buffer.from(shot2.data, "base64"));

  // Test selection + jump programmatically via destination click.
  const destCount = await evaluate(`document.querySelectorAll('.dest-item').length`);
  console.log("destination items:", destCount);

  // Select "Earth" from destinations and hold J to jump (exercises FTL path).
  await evaluate(`document.getElementById('btn-destinations').click(); 'ok'`);
  await sleep(300);
  const clicked = await evaluate(`(() => {
    const items = [...document.querySelectorAll('.dest-item')];
    const el = items.find(i => i.textContent.includes('Earth'));
    if (el) { el.click(); return el.textContent; }
    return null;
  })()`);
  console.log("selected destination:", clicked);
  await sleep(300);
  const targetName = await evaluate(`document.getElementById('target-name')?.textContent`);
  console.log("target panel:", targetName);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyJ'})); 'ok'`);
  await sleep(2000); // charge ~1.1 s then fire
  const midJump = await evaluate(`({
    progress: document.getElementById('jump-progress-fill')?.style.width,
    speed: document.getElementById('speed-value')?.textContent,
  })`);
  console.log("during jump:", JSON.stringify(midJump));
  await sleep(5000); // warp + arrival
  const afterJump = await evaluate(`({
    speed: document.getElementById('speed-value')?.textContent,
  })`);
  console.log("after jump:", JSON.stringify(afterJump));
  const shot3 = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(new URL("../shot-arrival.png", import.meta.url), Buffer.from(shot3.data, "base64"));

  // Toggle layers + settings via HUD buttons.
  await evaluate(`document.getElementById('btn-layers').click(); 'ok'`);
  await sleep(200);
  const layerToggles = await evaluate(`document.querySelectorAll('#layers-list input').length`);
  console.log("layer toggles:", layerToggles);

  console.log("\n--- console logs ---");
  for (const l of consoleLogs) console.log(l);
  if (!consoleLogs.length) console.log("(none)");

  chrome.kill();
  process.exit(0);
}

main().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });

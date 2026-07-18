// Debug: sample nav/universe/head state over time to locate the source of
// residual worldSpeed after motion should have settled.
import { spawn } from "node:child_process";

const URL_TO_TEST = process.argv[2] ?? "http://localhost:7100/?mode=desktop";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9224;

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader",
  "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox",
  `--remote-debugging-port=${PORT}`, "--window-size=1280,800", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let msgId = 0, ws;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) return { error: r.exceptionDetails.exception?.description ?? "exception" };
  return r?.result?.value;
}
async function waitFor(exprStr, timeoutMs = 120000, poll = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await evaluate(exprStr);
    if (v) return v;
    await sleep(poll);
  }
  return null;
}

const SAMPLE = `(() => {
  const { app, nav, THREE } = window.__cosmos;
  const u = app.universe;
  return {
    uPos: u.position.toArray().map(v => +v.toFixed(6)),
    uQuat: u.quaternion.toArray().map(v => +v.toFixed(8)),
    uScale: +u.scale.x.toExponential(6),
    tgtPos: nav.tgtPos.toArray().map(v => +v.toFixed(6)),
    tgtQuat: nav.tgtQuat.toArray().map(v => +v.toFixed(8)),
    targetLog: +nav.targetLog.toFixed(8),
    logScale: +nav.logScale.toFixed(8),
    head: app.camera.getWorldPosition(new THREE.Vector3()).toArray().map(v => +v.toFixed(6)),
    rigQuat: app.rig.quaternion.toArray().map(v => +v.toFixed(8)),
    uniPos: nav.universePos(new THREE.Vector3()).toArray().map(v => +v.toExponential(4)),
    worldSpeed: +nav.worldSpeed.toExponential(4),
    speedUnits: +nav.speedUnits.toExponential(4),
  };
})()`;

async function main() {
  const target = await (async () => {
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json`);
        const t = (await res.json()).find((x) => x.type === "page");
        if (t) return t;
      } catch { /* retry */ }
      await sleep(300);
    }
    throw new Error("CDP unreachable");
  })();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: URL_TO_TEST });
  const booted = await waitFor(`!!window.__cosmos && document.getElementById('loading-overlay')?.classList.contains('hidden')`);
  console.log("booted:", !!booted);

  console.log("\n— idle at home, 6 samples @ 600 ms —");
  for (let i = 0; i < 6; i++) {
    console.log(JSON.stringify(await evaluate(SAMPLE)));
    await sleep(600);
  }

  console.log("\n— after quickJump(Earth) + settle, 4 samples @ 600 ms —");
  await evaluate(`(() => {
    const { selection, nav } = window.__cosmos;
    nav.quickJump(selection['items'].find(s => s.name === 'Earth'));
  })()`);
  await waitFor(`window.__cosmos.nav.jumpState === 'idle'`);
  await sleep(1500);
  for (let i = 0; i < 4; i++) {
    console.log(JSON.stringify(await evaluate(SAMPLE)));
    await sleep(600);
  }

  chrome.kill();
  process.exit(0);
}
main().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });

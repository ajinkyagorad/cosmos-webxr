// CDP smoke test v3 (atlas navigation model): boots the app headlessly
// (SwiftShader WebGL, REAL time), then verifies:
//  · boot with zero console errors
//  · jump to Saturn and BACK to Earth (target lands ~0.95 m ahead each time)
//  · desktop thrust closes distance; STOP halts all motion (no inertia)
//  · galaxy-scale views at 100 pc / 1 kpc / 50 kpc (screenshots, Milky Way visible)
//  · Return Home from deep space + Back breadcrumb (exact pose restore)
// Usage: node scripts/smoke-test.mjs [url]
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const URL_TO_TEST = process.argv[2] ?? "http://localhost:7100/?mode=desktop";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9223;
const OUT = new URL("../docs/screenshots/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader",
  "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox",
  `--remote-debugging-port=${PORT}`, "--window-size=960,600", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let msgId = 0, ws;
const pending = new Map();
const consoleLogs = [];
let failures = 0;

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
function check(name, ok, detail = "") {
  console.log(`${ok ? "  ✔" : "  ✖ FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
async function shot(name) {
  const s = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}${name}.png`, Buffer.from(s.data, "base64"));
}

async function waitFor(exprStr, timeoutMs = 90000, poll = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await evaluate(exprStr);
    if (v) return v;
    await sleep(poll);
  }
  return null;
}

// World distance (metres) from the camera to a named selectable.
const WORLD_DIST = (name) => `(() => {
  const { app, selection, THREE } = window.__cosmos;
  const s = selection['items'].find(x => x.name === '${name}');
  if (!s) return -1;
  const tp = selection.getWorldPosition(s, new THREE.Vector3());
  return tp.distanceTo(app.camera.getWorldPosition(new THREE.Vector3()));
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
    else if (m.method === "Runtime.consoleAPICalled") {
      consoleLogs.push(`[${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
    } else if (m.method === "Runtime.exceptionThrown") {
      consoleLogs.push(`[EXCEPTION] ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
    }
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: URL_TO_TEST });

  console.log("— boot —");
  const booted = await waitFor(`!!window.__cosmos && document.getElementById('loading-overlay')?.classList.contains('hidden')`, 120000);
  check("boot completes", !!booted);

  // ---------- jump round trip: Saturn → back to Earth ----------
  console.log("— jump round trip —");
  await evaluate(`(() => {
    const { selection, nav } = window.__cosmos;
    const sat = selection['items'].find(s => s.name === 'Saturn');
    nav.quickJump(sat);
  })()`);
  const atSaturn = await waitFor(`window.__cosmos.nav.jumpState === 'idle' && window.__cosmos.nav.speedUnits < 1e-3`, 120000);
  check("jump to Saturn arrives", !!atSaturn);
  const satDist = await evaluate(WORLD_DIST("Saturn"));
  check("Saturn lands ~0.95 m ahead", typeof satDist === "number" && satDist > 0.2 && satDist < 1.6,
    `${satDist?.toFixed?.(2)} m`);
  await shot("test-saturn-arrival");

  // Jump back to Earth — the "jump-back doesn't return" regression test.
  await evaluate(`(() => {
    const { selection, nav } = window.__cosmos;
    const earth = selection['items'].find(s => s.name === 'Earth');
    nav.quickJump(earth);
  })()`);
  await waitFor(`window.__cosmos.nav.jumpState === 'idle' && window.__cosmos.nav.speedUnits < 1e-3`, 120000);
  const earthDist = await evaluate(WORLD_DIST("Earth"));
  check("jump BACK to Earth lands ~0.95 m ahead", typeof earthDist === "number" && earthDist > 0.2 && earthDist < 1.6,
    `${earthDist?.toFixed?.(2)} m`);
  await shot("test-earth-return");

  // ---------- thrust toward Earth, then STOP (no inertia, no collision floor) ----------
  // NOTE: SwiftShader frames are ~600 ms wall each, while App clamps dt to 100 ms —
  // so easing settles in ~6× wall time here. Wait for the speed to decay instead of
  // fixed sleeps (on real GPUs this settles in well under a second).
  console.log("— thrust & stop —");
  await evaluate(`window.__cosmos.nav.thrustInput.set(0,0,1); 'ok'`);
  await sleep(400);
  await evaluate(`window.__cosmos.nav.thrustInput.set(0,0,0); 'ok'`);
  const settled = await waitFor(`window.__cosmos.nav.worldSpeed < 1e-2`, 60000);
  check("no inertia after thrust release", !!settled);
  const approachDist = await evaluate(WORLD_DIST("Earth"));
  check("thrust closes distance toward Earth", typeof approachDist === "number" && approachDist < earthDist,
    `${approachDist?.toFixed?.(2)} m (was ${earthDist?.toFixed?.(2)} m)`);
  await evaluate(`window.__cosmos.nav.thrustInput.set(0,0,1); 'ok'`);
  await sleep(400);
  await evaluate(`window.__cosmos.nav.thrustInput.set(0,0,0); window.__cosmos.nav.stop(); 'ok'`);
  const stopped = await waitFor(`window.__cosmos.nav.worldSpeed < 1e-2`, 60000);
  check("STOP halts all motion", !!stopped);

  // ---------- galaxy-scale views ----------
  console.log("— galaxy scales —");
  for (const [name, x, y, z] of [
    ["scale-100pc", 0, 0, 100],
    ["scale-1kpc", 0, 300, 1000],
    ["scale-50kpc", 0, 8000, 50000],
  ]) {
    await evaluate(`(() => {
      const { nav, THREE } = window.__cosmos;
      const d = Math.hypot(${x}, ${y}, ${z});
      const log = Math.max(-7.3, -Math.log10(d) - 0.3);
      nav.setPoseImmediate(new THREE.Vector3(${x}, ${y}, ${z}), new THREE.Quaternion(), log);
    })()`);
    await sleep(1500);
    await shot(name);
  }
  check("galaxy-scale teleports rendered (see screenshots)", true);

  // ---------- Return Home from deep space ----------
  console.log("— home & back —");
  await evaluate(`window.__cosmos.nav.goHome(); 'ok'`);
  const home = await waitFor(`window.__cosmos.nav.jumpState === 'idle' && window.__cosmos.nav.speedUnits < 1e-2`, 180000);
  check("Return Home completes from 50 kpc", !!home);
  const homeDist = await evaluate(`window.__cosmos.nav.universePos(new window.__cosmos.THREE.Vector3()).length()`);
  check("home position near solar system", typeof homeDist === "number" && homeDist < 1, `${homeDist?.toFixed?.(3)} pc`);
  await shot("test-home");

  const backOk = await evaluate(`window.__cosmos.nav.goBack()`);
  check("Back breadcrumb available", backOk === true);
  await waitFor(`window.__cosmos.nav.jumpState === 'idle' && window.__cosmos.nav.speedUnits < 1e-2`, 180000);
  const backDist = await evaluate(`window.__cosmos.nav.universePos(new window.__cosmos.THREE.Vector3()).length()`);
  check("Back restores the deep-space pose", typeof backDist === "number" && backDist > 30000,
    `${backDist?.toFixed?.(0)} pc (expect ~50 636)`);
  await shot("test-back-50kpc");

  // ---------- console log summary ----------
  console.log("\n— console logs —");
  const errors = consoleLogs.filter((l) => l.startsWith("[error]") || l.startsWith("[EXCEPTION]"));
  for (const l of consoleLogs.slice(0, 20)) console.log(l);
  check("zero console errors/exceptions", errors.length === 0, errors.join(" | "));

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
  chrome.kill();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });

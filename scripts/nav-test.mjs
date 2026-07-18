// Pure-math test of the atlas navigation model (no DOM, no WebGL).
// Drives the REAL Navigation class with a stub { camera, universe } app and
// verifies: easing convergence, zoom clamps, desktop thrust, 1:1 grab, and a
// quickJump → goBack pose round-trip.
//
// Run via: npm run test:nav  (bundles TS with esbuild, then executes in node).
import * as THREE from "three";
import { Navigation, LOG_MIN, LOG_MAX, HOME_LOG, HOME_UNI } from "../src/controls/Navigation";

const camera = new THREE.PerspectiveCamera(70, 1, 1e-9, 1e9);
camera.position.set(0, 0, 0);
const universe = new THREE.Group();
const app = { camera, universe, mode: "desktop" };

let failures = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!cond) failures++;
};

const nav = new Navigation(app);
const step = (seconds, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) nav.update(dt, t);
};

// ---- 1. damped easing converges onto targets --------------------------------
nav.zoomLog(-1);
step(3);
const wantScale = Math.pow(10, HOME_LOG - 1);
check(
  "easing converges to target scale",
  Math.abs(universe.scale.x - wantScale) / wantScale < 1e-3,
  `scale=${universe.scale.x.toExponential(4)} want=${wantScale.toExponential(4)}`,
);

// ---- 2. zoom is hard-clamped --------------------------------------------------
nav.zoomLog(100);
check("zoom clamps at LOG_MAX", nav.targetLog === LOG_MAX, `targetLog=${nav.targetLog}`);
nav.zoomLog(-100);
check("zoom clamps at LOG_MIN", nav.targetLog === LOG_MIN, `targetLog=${nav.targetLog}`);
nav.zoomLog(HOME_LOG - LOG_MIN); // return toward home
step(3);

// ---- 3. desktop thrust translates the universe past the user -----------------
const uniBefore = nav.universePos(new THREE.Vector3()).clone();
nav.thrustInput.set(0, 0, 1);
step(1);
nav.thrustInput.set(0, 0, 0);
const uniAfter = nav.universePos(new THREE.Vector3());
check("thrust moves user through universe", uniBefore.distanceTo(uniAfter) > 1e-6,
  `moved ${uniBefore.distanceTo(uniAfter).toExponential(3)} pc`);
check("world speed is reported while moving", nav.worldSpeed > 0,
  `worldSpeed=${nav.worldSpeed.toExponential(3)} m/s`);
step(3); // settle onto target (no inertia: speed must decay to ~0)
check("no inertia after release", nav.worldSpeed < 1e-3,
  `worldSpeed=${nav.worldSpeed.toExponential(3)} m/s`);

// ---- 4. one-hand grab is 1:1 ---------------------------------------------------
const pose = new THREE.Matrix4(); // identity at grab start
nav.startGrab(0, () => pose);
const tgtBefore = nav.tgtPos.clone();
pose.makeTranslation(0.2, 0.05, -0.1); // hand moves 20 cm x, 5 cm y, -10 cm z
step(0.5);
nav.endGrab(0);
step(2);
const delta = nav.tgtPos.clone().sub(tgtBefore);
check(
  "grab moves universe 1:1 with the hand",
  delta.distanceTo(new THREE.Vector3(0.2, 0.05, -0.1)) < 5e-3,
  `delta=(${delta.x.toFixed(4)}, ${delta.y.toFixed(4)}, ${delta.z.toFixed(4)})`,
);

// ---- 5. quickJump → goBack pose round-trip --------------------------------------
nav.setPoseImmediate(HOME_UNI, new THREE.Quaternion(), HOME_LOG);
step(1);
const homeUni = nav.universePos(new THREE.Vector3()).clone();
const fakeTarget = {
  id: "test-star", name: "Test Star", kind: "star",
  position: new THREE.Vector3(500, 40, -300), radiusWorld: 1,
  describe: () => "test",
};
nav.quickJump(fakeTarget);
step(12); // travel dur ≤ 9 s
check("jump completes", nav.jumpState === "idle" && !nav.isTraveling);
// arrival: the target lands at the anchor point 0.95 m ahead of the head (world m).
const targetWorld = universe.localToWorld(fakeTarget.position.clone());
const headWorld = camera.getWorldPosition(new THREE.Vector3());
const worldDist = targetWorld.distanceTo(headWorld);
check("jump arrives with the target ~0.95 m ahead", Math.abs(worldDist - 0.95) < 0.15,
  `worldDist=${worldDist.toFixed(3)} m`);
check("goBack has a breadcrumb", nav.hasBreadcrumbs);
const okBack = nav.goBack();
check("goBack fires", okBack === true);
step(12);
const backUni = nav.universePos(new THREE.Vector3());
const err = backUni.distanceTo(homeUni) / Math.max(homeUni.length(), 1e-9);
check("round-trip returns to the origin pose (<1%)", err < 0.01,
  `err=${(err * 100).toFixed(3)}%  log=${nav.logScale.toFixed(3)} (home ${HOME_LOG})`);
check("log scale restored", Math.abs(nav.logScale - HOME_LOG) < 0.02,
  `logScale=${nav.logScale.toFixed(4)}`);

console.log(failures === 0 ? "\nAll navigation tests passed." : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

// COSMOS WebXR — main bootstrap.
// Loads real datasets, builds scene layers, wires navigation/controls/audio/UI,
// and manages the three entry modes (desktop / VR / passthrough AR).
import * as THREE from "three";
import { App } from "./core/App";
import { loadAllData } from "./data/loaders";
import { settings } from "./ui/Settings";
import { StarField } from "./scene/StarField";
import { MilkyWay } from "./scene/MilkyWay";
import { ExoplanetLayer } from "./scene/Exoplanets";
import { DSOLayer } from "./scene/DSOLayer";
import { CompactLayer } from "./scene/CompactObjects";
import { SolarSystem } from "./scene/SolarSystem";
import { MissionsLayer } from "./scene/Missions";
import { CinematicLayer } from "./scene/CinematicLayer";
import { LabelManager } from "./scene/Labels";
import { Selection, type Selectable } from "./scene/Selection";
import { Navigation, HOME_POS } from "./controls/Navigation";
import { DesktopControls } from "./controls/DesktopControls";
import { XRControls } from "./controls/XRControls";
import { HandControls } from "./controls/HandControls";
import { AudioEngine } from "./audio/AudioEngine";
import { HUD } from "./ui/HUD";
import { WristPanel } from "./ui/WristPanel";
import { Landing } from "./ui/Landing";
import { formatDistancePC, PC_TO_LY } from "./util/astro";
import { GALACTIC_CENTER_PC } from "./scene/MilkyWay";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function boot() {
  const app = new App($("app"));
  const audio = new AudioEngine();

  // ---------- load real datasets ----------
  const data = await loadAllData((msg) => { $("loading-text").textContent = msg; });

  // ---------- scene layers ----------
  $("loading-text").textContent = "Building the universe…";
  const milkyWay = new MilkyWay(app);
  app.universe.add(milkyWay.group);
  app.addUpdatable(milkyWay);

  const solar = new SolarSystem(app);
  app.universe.add(solar.group);
  app.addUpdatable(solar);

  let starField: StarField | null = null;
  if (data.stars.buffer.length >= data.stars.meta.count * 5 && data.stars.meta.count > 0) {
    starField = new StarField(data.stars.buffer, data.stars.meta.count);
    app.universe.add(starField.points);
    app.addUpdatable(starField);
  }

  const exoplanets = new ExoplanetLayer(data.exoplanets);
  app.universe.add(exoplanets.points);

  const dso = new DSOLayer(data.dso);
  app.universe.add(dso.points);

  const compact = new CompactLayer(app, data.compact);
  app.universe.add(compact.group);
  app.addUpdatable(compact);

  const missions = new MissionsLayer(solar, data.missions);
  app.universe.add(missions.group);

  const cinematic = new CinematicLayer();
  app.universe.add(cinematic.group);

  // ---------- labels ----------
  const labels = new LabelManager(app);
  app.universe.add(labels.object);
  app.addUpdatable(labels);
  const labelQueue: Promise<void>[] = [];
  for (const a of solar.getLabelAnchors()) labelQueue.push(labels.add(a.name, a.object, { size: 0.05 }));
  for (const a of missions.getLabelAnchors()) labelQueue.push(labels.add(a.name, a.object, { size: 0.02, color: "#9fd0ff" }));
  // Top ~60 named stars by brightness get labels.
  for (const n of data.stars.meta.names.slice(0, 60)) {
    const i = n.i;
    const b = data.stars.buffer;
    if (i * 5 + 2 < b.length) {
      const anchor = new THREE.Object3D();
      anchor.position.set(b[i * 5], b[i * 5 + 1], b[i * 5 + 2]);
      app.universe.add(anchor);
      labelQueue.push(labels.add(n.n, anchor, { size: 0.25, color: "#ffe9c9" }));
    }
  }
  // Compact objects + named DSOs labels.
  compact.objects.forEach((o, i) => {
    const anchor = new THREE.Object3D();
    anchor.position.copy(compact.positions[i]);
    app.universe.add(anchor);
    labelQueue.push(labels.add(o.n, anchor, { size: 1.2, color: "#ffb0a0" }));
  });
  data.dso.objects.forEach((o, i) => {
    if (!o.cn) return; // only objects with common names
    const anchor = new THREE.Object3D();
    anchor.position.copy(dso.positions[i]);
    app.universe.add(anchor);
    labelQueue.push(labels.add(o.cn, anchor, { size: 2.0, color: "#b0ffc8" }));
  });
  for (const a of cinematic.getLabelAnchors()) labelQueue.push(labels.add(a.name, a.object, { size: 60, color: "#e0c8ff" }));
  // Galactic-center beacon label so the Milky Way stays orientable at kpc scales.
  {
    const gcAnchor = new THREE.Object3D();
    gcAnchor.position.copy(GALACTIC_CENTER_PC);
    app.universe.add(gcAnchor);
    labelQueue.push(labels.add("Milky Way · Galactic Center", gcAnchor, { size: 8, color: "#ffd9a0" }));
  }
  await Promise.allSettled(labelQueue);

  // ---------- selection ----------
  const selection = new Selection(app);
  app.addUpdatable(selection);
  selection.registerMany(solar.toSelectables());
  selection.registerMany(exoplanets.toSelectables());
  selection.registerMany(dso.toSelectables());
  selection.registerMany(compact.toSelectables());
  selection.registerMany(missions.toSelectables());
  selection.registerMany(cinematic.toSelectables());
  // Named stars as selectables (top 400).
  data.stars.meta.names.forEach((n) => {
    const i = n.i, b = data.stars.buffer;
    if (i * 5 + 2 >= b.length) return;
    selection.registerMany([{
      id: `star-${i}`,
      name: n.n,
      kind: "star",
      position: new THREE.Vector3(b[i * 5], b[i * 5 + 1], b[i * 5 + 2]),
      radiusWorld: 0.5,
      describe: () =>
        `<b>${n.n}</b><br>Apparent magnitude: ${n.m.toFixed(2)}${n.s ? `<br>Spectral type: ${n.s}` : ""}<br>` +
        `Distance: ${formatDistancePC(Math.hypot(b[i * 5], b[i * 5 + 1], b[i * 5 + 2]))}<br><span class="dim">HYG 4.0 / Gaia DR3</span>`,
    }]);
  });

  // ---------- navigation & effects ----------
  const nav = new Navigation(app, selection);
  app.addUpdatable(nav);
  // (No fake warp particles: jumps are real accelerated travel through the actual star field.)

  const hud = new HUD(app, nav, selection, audio);
  const desktop = new DesktopControls(app, nav, selection);
  const xr = new XRControls(app, nav, selection);
  const hands = new HandControls(app, nav, xr);
  app.addUpdatable(desktop);
  app.addUpdatable(xr);
  app.addUpdatable(hands);
  const wrist = new WristPanel(app, nav, selection);
  app.addUpdatable(wrist);
  hands.wrist = wrist;

  // Selection picking (desktop click uses camera ray; XR uses controller/pinch ray).
  const pickRay = new THREE.Raycaster();
  const doPick = (raycaster: THREE.Raycaster, tolScale = 1) => {
    const hit = selection.pickFromRay(raycaster, tolScale);
    if (hit) selection.select(hit);
  };
  desktop.onRequestSelect = () => {
    pickRay.ray.origin.copy(app.camera.getWorldPosition(new THREE.Vector3()));
    pickRay.ray.direction.copy(app.camera.getWorldDirection(new THREE.Vector3()));
    doPick(pickRay);
  };
  xr.onSelectRay = (raycaster) => {
    // Wrist panel buttons take priority over world selection.
    const btn = wrist.intersect(raycaster);
    if (btn) { wrist.press(btn); xr.pulse("right", 0.4, 40); return; }
    doPick(raycaster, 1.2);
  };
  // Hand pinch: panel buttons first, then world selection with wider magnetism.
  hands.onPinchRay = (raycaster) => {
    const btn = wrist.intersect(raycaster);
    if (btn) { wrist.press(btn); return; }
    doPick(raycaster, 1.6);
  };
  // Hand aim each frame: panel hover, else cursor at magnetic pick candidate.
  const aimProxy = new THREE.Object3D();
  hands.onAimRay = (raycaster) => {
    const btn = wrist.intersect(raycaster);
    wrist.setHover(btn);
    if (btn !== null) return wrist.mesh;
    const s = selection.pickFromRay(raycaster, 1.6);
    if (s) {
      aimProxy.position.copy(selection.getWorldPosition(s, new THREE.Vector3()));
      return aimProxy;
    }
    return null;
  };

  // Arrival orientation: end every jump facing the destination.
  const _hq = new THREE.Quaternion();
  nav.onOrient = (dir, alpha) => {
    if (app.mode === "desktop") {
      desktop.orientToward(dir, alpha);
    } else {
      // XR: yaw the rig so the headset's forward ends up centered on the target.
      const headFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(app.camera.getWorldQuaternion(_hq));
      const curYaw = Math.atan2(-headFwd.x, -headFwd.z);
      const wantYaw = Math.atan2(-dir.x, -dir.z);
      const dYaw = Math.atan2(Math.sin(wantYaw - curYaw), Math.cos(wantYaw - curYaw));
      app.rig.rotateY(dYaw * alpha);
    }
  };

  // ---------- audio hooks ----------
  nav.onJumpProgress = (state, charge) => {
    $("jump-progress").classList.toggle("hidden", state === "idle");
    $("jump-progress-fill").style.width = `${Math.round(charge * 100)}%`;
    if (state === "charging" && charge === 0) audio.playWarpCharge(1.1);
    if (state === "warping") audio.playWarpWhoosh();
  };
  nav.onArrive = () => {
    audio.playArrivalThump();
    xr.pulse("right", 0.9, 200);
    xr.pulse("left", 0.9, 200);
  };
  wrist.onHover = () => xr.pulse("right", 0.15, 15);

  // ---------- destinations list ----------
  const allDest = buildDestinations(hud, selection, { solar, dso, compact, exoplanets, missions, cinematic });
  wrist.setDestinations(allDest.map((d) => ({ name: d.name, sel: d.sel })));

  // ---------- layer visibility wiring ----------
  const applyLayers = () => {
    if (starField) starField.points.visible = settings.get("layerStars");
    exoplanets.points.visible = settings.get("layerExoplanets");
    dso.points.visible = settings.get("layerDSO");
    missions.group.visible = settings.get("layerMissions");
    compact.group.visible = settings.get("layerCompact");
    cinematic.group.visible = settings.get("layerCinematic");
    // Skybox: toggleable everywhere; hidden by default in passthrough AR (no "bubble").
    milkyWay.sky.visible = settings.get("layerSkybox") && app.mode !== "ar";
    labels.setVisible(settings.get("labels"));
  };
  settings.onChange(() => applyLayers());
  applyLayers();

  // ---------- comfort vignette + per-frame misc ----------
  app.addUpdatable({
    update(dt: number) {
      // Vignette strength from speed (VR default on; desktop follows setting).
      const speedNorm = Math.min(1, nav.speedUnits / (nav.accel * 4 + 1e-9));
      const want = settings.get("vignette") && (app.mode !== "desktop" || speedNorm > 0.5)
        ? speedNorm * 0.85
        : 0;
      app.vignetteStrength += (want - app.vignetteStrength) * Math.min(1, dt * 5);
      // Subtle FOV kick tied to REAL jump velocity (desktop only; FOV changes are
      // uncomfortable and unsupported in XR).
      const peak = nav.jumpPeakSpeed;
      const norm = peak > 0 ? THREE.MathUtils.clamp(nav.speedUnits / peak, 0, 1) : 0;
      const targetFov = 70 * (app.mode === "desktop" ? 1 + 0.14 * norm : 1);
      if (Math.abs(app.camera.fov - targetFov) > 0.05) {
        app.camera.fov += (targetFov - app.camera.fov) * Math.min(1, dt * 4);
        app.camera.updateProjectionMatrix();
      }
      // Audio engine follows real velocity (hum rises as stars genuinely stream past).
      audio.updateEngine(nav.speedUnits, nav.thrustInput.lengthSq() > 0 || nav.braking || nav.jumpState === "warping");
      hud.update(dt);
    },
  });

  // ---------- landing / modes ----------
  const landing = new Landing(app);
  await landing.init(data.manifest, {
    stars: data.stars.meta.count,
    exoplanets: data.exoplanets.count,
    dso: data.dso.count,
  });

  landing.onModeSelected = async (mode) => {
    audio.start(); // user gesture → audio allowed
    hud.show();
    if (mode === "vr" || mode === "ar") {
      const ok = await app.enterXR(mode);
      if (!ok) {
        $("hud-hint").textContent = "XR session failed to start — staying in desktop mode";
      } else {
        wrist.attach(xr.grips[0] ?? app.rig);
        hud.setHint(mode === "vr" ? "VR: sticks to move/turn · trigger thrust · A select · B jump · hold Y home" : "AR: universe in your room · skybox off (toggle in LAYERS)");
      }
    } else {
      hud.setHint("Click to capture mouse · WASD fly · Shift thrust · Space brake · J jump · ⌂ home · H help");
    }
    applyLayers(); // skybox visibility depends on mode (off in AR)
  };
  app.onSessionEnd = () => {
    hud.setHint("Session ended — desktop mode. Click to capture mouse.");
    applyLayers();
  };

  // Optional deep link: ?mode=desktop|vr|ar skips the landing screen.
  // (VR/AR without a user gesture will fail session start and fall back to desktop.)
  const forced = new URLSearchParams(location.search).get("mode");
  if (forced === "desktop" || forced === "vr" || forced === "ar") {
    landing.choose(forced);
  }

  // Start just outside Earth's orbit, looking back toward the Sun (−z).
  app.rig.position.copy(HOME_POS);

  // Test/debug hooks (used by scripts/smoke-test.mjs).
  (window as unknown as { __cosmos: object }).__cosmos = { app, nav, selection, settings, THREE };

  // Hide loading overlay, start loop.
  const overlay = $("loading-overlay");
  overlay.style.opacity = "0";
  setTimeout(() => overlay.classList.add("hidden"), 600);
  app.start();
  console.log("[cosmos] boot complete");
}

function buildDestinations(
  hud: HUD,
  _selection: Selection,
  layers: {
    solar: SolarSystem; dso: DSOLayer; compact: CompactLayer;
    exoplanets: ExoplanetLayer; missions: MissionsLayer; cinematic: CinematicLayer;
  },
): { name: string; cat: string; sel: Selectable; distPC?: number }[] {
  const all: { name: string; cat: string; sel: Selectable; distPC?: number }[] = [];
  const solarSels = layers.solar.toSelectables();
  all.push(...solarSels.map((s) => ({ name: s.name, cat: "SOLAR SYSTEM", sel: s, distPC: undefined })));
  // Famous DSOs.
  const famous = ["M31", "M42", "M45", "M13", "M104", "M51", "M8", "M57", "M1", "M33", "M101", "M16"];
  const dsoSels = layers.dso.toSelectables();
  all.push(
    ...famous
      .map((f) => dsoSels.find((s) => s.id && layers.dso.objects[parseInt(s.id.slice(4))]?.n === f))
      .filter((s): s is Selectable => !!s)
      .map((s) => {
        const o = layers.dso.objects[parseInt(s.id.slice(4))];
        return { name: s.name, cat: "DEEP SKY", sel: s, distPC: o?.d ? o.d / PC_TO_LY : undefined };
      }),
  );
  // Compact objects.
  const compSels = layers.compact.toSelectables();
  all.push(...compSels.map((s, i) => ({
    name: s.name, cat: "EXOTIC", sel: s, distPC: layers.compact.objects[i]?.d_pc,
  })));
  // Notable exoplanet systems.
  const notable = ["TRAPPIST-1 e", "Proxima Centauri b", "Kepler-452 b", "51 Pegasi b", "HD 209458 b", "Kepler-186 f"];
  const exoSels = layers.exoplanets.toSelectables();
  all.push(
    ...notable
      .map((n) => ({ s: exoSels.find((x) => x.name === n), n }))
      .filter((x): x is { s: Selectable; n: string } => !!x.s)
      .map(({ s }) => {
        const idx = parseInt(s.id.slice(4));
        return { name: s.name, cat: "EXOPLANETS", sel: s, distPC: layers.exoplanets.planets[idx]?.d };
      }),
  );
  // Missions.
  const missionSels = layers.missions.toSelectables();
  all.push(
    ...missionSels
      .filter((s) => ["Voyager 1", "Voyager 2", "JWST", "ISS", "New Horizons", "Perseverance"].includes(s.name))
      .map((s) => ({ name: s.name, cat: "MISSIONS", sel: s })),
  );
  // Cinematic (flagged as fiction).
  all.push(
    ...layers.cinematic.toSelectables().slice(0, 6).map((s) => ({ name: s.name, cat: "✦ CINEMATIC (FICTION)", sel: s })),
  );
  hud.addDestinations(all);
  return all;
}

boot().catch((e) => {
  console.error(e);
  $("loading-text").textContent = `Failed to start: ${e.message}`;
});

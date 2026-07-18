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
import { DustVolume, CepheidLayer, GlobularLayer, LocalGroupLayer, ConstellationLayer, TwoMRSLayer } from "./scene/AtlasLayers";
import { StarNameHover } from "./scene/StarNames";
import { HoverChip } from "./scene/HoverChip";
import { CoordinateGrid } from "./scene/CoordinateGrid";
import { CMBLayer, CMB_RADIUS_PC } from "./scene/CMBLayer";
import { DarkHaloLayer } from "./scene/DarkHaloLayer";
import { TravelTrails } from "./scene/TravelTrails";
import { Navigation } from "./controls/Navigation";
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

  // ---------- Milky Way Atlas layers (real dust/disk/halo/Local Group data) ----------
  let dust: DustVolume | null = null;
  if (data.dust) {
    dust = new DustVolume(data.dust.meta, data.dust.buffer);
    app.universe.add(dust.group);
  }
  let cepheids: CepheidLayer | null = null;
  if (data.cepheids) {
    cepheids = new CepheidLayer(data.cepheids.meta, data.cepheids.buffer);
    app.universe.add(cepheids.points);
  }
  let globulars: GlobularLayer | null = null;
  if (data.globulars) {
    globulars = new GlobularLayer(data.globulars.meta, data.globulars.buffer);
    app.universe.add(globulars.points);
  }
  let localGroup: LocalGroupLayer | null = null;
  if (data.galaxies) {
    localGroup = new LocalGroupLayer(data.galaxies);
    app.universe.add(localGroup.points);
  }
  let constellations: ConstellationLayer | null = null;
  if (data.constellations) {
    constellations = new ConstellationLayer(data.constellations);
    app.universe.add(constellations.lines);
  }
  // 2MRS large-scale structure out to ~300 Mpc (D17).
  let twoMRS: TwoMRSLayer | null = null;
  if (data.twoMRS) {
    twoMRS = new TwoMRSLayer(data.twoMRS.meta, data.twoMRS.buffer);
    app.universe.add(twoMRS.points);
  }

  // ---------- cylindrical coordinate grid (C7; toggle, default OFF) ----------
  const grid = new CoordinateGrid();
  app.universe.add(grid.group);

  // ---------- cosmology layers: CMB shell (D13) + NFW dark-matter halo (D14) ----------
  const cmb = new CMBLayer();
  app.universe.add(cmb.mesh);
  app.addUpdatable(cmb);
  const darkHalo = new DarkHaloLayer(app);
  app.universe.add(darkHalo.mesh);
  app.universe.add(darkHalo.labelAnchor);
  app.addUpdatable(darkHalo);

  // ---------- labels (world-space, constant angular size, per-label zoom windows) ----------
  const labels = new LabelManager(app);
  app.addUpdatable(labels);
  const labelQueue: Promise<void>[] = [];
  // Solar-system museum labels only make sense at solar zoom; star names only outside it.
  for (const a of solar.getLabelAnchors()) labelQueue.push(labels.add(a.name, a.object, { size: 0.05, minLog: 0.2 }));
  for (const a of missions.getLabelAnchors()) labelQueue.push(labels.add(a.name, a.object, { size: 0.02, color: "#9fd0ff", minLog: 0.2 }));
  // Top ~60 named stars by brightness get labels.
  for (const n of data.stars.meta.names.slice(0, 60)) {
    const i = n.i;
    const b = data.stars.buffer;
    if (i * 5 + 2 < b.length) {
      const anchor = new THREE.Object3D();
      anchor.position.set(b[i * 5], b[i * 5 + 1], b[i * 5 + 2]);
      app.universe.add(anchor);
      labelQueue.push(labels.add(n.n, anchor, { size: 0.25, color: "#ffe9c9", maxLog: 0.5 }));
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
  for (const a of cinematic.getLabelAnchors()) {
    labelQueue.push(labels.add(a.name, a.object, { size: 60, color: "#e0c8ff", when: () => settings.get("layerCinematic") }));
  }
  // Galactic-center beacon label so the Milky Way stays orientable at kpc scales.
  {
    const gcAnchor = new THREE.Object3D();
    gcAnchor.position.copy(GALACTIC_CENTER_PC);
    app.universe.add(gcAnchor);
    labelQueue.push(labels.add("Milky Way · Galactic Center", gcAnchor, { size: 8, color: "#ffd9a0", minLog: -7, maxLog: -2 }));
  }
  // Spiral-arm labels at galactic zoom (C10): majors brighter.
  for (const arm of milkyWay.armAnchors) {
    const anchor = new THREE.Object3D();
    anchor.position.copy(arm.position);
    app.universe.add(anchor);
    labelQueue.push(labels.add(arm.name, anchor, {
      size: arm.major ? 17 : 13,
      color: arm.major ? "#a8d8ff" : "#7fa8d8",
      minLog: -5.5, maxLog: -2.2,
    }));
  }
  // Galaxy boost auto-labels (C11): majors of the Local Group always carry names.
  if (localGroup) {
    const MAJORS = ["Andromeda (M31)", "Triangulum (M33)", "LMC", "SMC", "M 32", "NGC 205", "IC 10"];
    for (const g of localGroup.galaxies) {
      if (!MAJORS.includes(g.name)) continue;
      const anchor = new THREE.Object3D();
      anchor.position.set(g.pos[0], g.pos[1], g.pos[2]);
      app.universe.add(anchor);
      labelQueue.push(labels.add(g.name, anchor, { size: 25, color: "#d8c9ff", minLog: -7.3, maxLog: -3.0 }));
    }
  }
  // Cosmology labels (D13/D14).
  labelQueue.push(labels.add("Dark matter halo (NFW model)", darkHalo.labelAnchor,
    { size: 60, color: "#9a86ff", minLog: -6, maxLog: -2.6, when: () => settings.get("layerDarkHalo") }));
  {
    const cmbAnchor = new THREE.Object3D();
    cmbAnchor.position.set(0, 0, -CMB_RADIUS_PC * 0.95);
    app.universe.add(cmbAnchor);
    labelQueue.push(labels.add("Cosmic microwave background · 46.5 Gly", cmbAnchor,
      { size: 4e8, color: "#7db4ff", minLog: -7.3, maxLog: -1.6, when: () => settings.get("layerCMB") }));
  }
  // Landmark labels (local clouds / Milky Way / Local Group), each in its zoom window.
  const LANDMARK_LABEL: Record<string, { size: number; color: string; minLog: number; maxLog: number }> = {
    cloud: { size: 4, color: "#ff9a3c", minLog: -4.7, maxLog: 1.2 },
    mw: { size: 30, color: "#6fd6ff", minLog: -6.8, maxLog: -2.4 },
    lg: { size: 200, color: "#c9a7ff", minLog: -7.3, maxLog: -3.8 },
  };
  const landmarkAnchors: { lm: { name: string; pos: [number, number, number]; desc: string; cat: "cloud" | "mw" | "lg" }; anchor: THREE.Object3D }[] = [];
  if (data.landmarks) {
    for (const lm of data.landmarks.landmarks) {
      if (lm.name === "Sun" || lm.name === "Sun + local clouds") continue; // already at home
      const anchor = new THREE.Object3D();
      anchor.position.set(lm.pos[0], lm.pos[1], lm.pos[2]);
      app.universe.add(anchor);
      landmarkAnchors.push({ lm, anchor });
      const st = LANDMARK_LABEL[lm.cat];
      labelQueue.push(labels.add(lm.name, anchor, { size: st.size, color: st.color, minLog: st.minLog, maxLog: st.maxLog }));
    }
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
  if (localGroup) selection.registerMany(localGroup.toSelectables());
  // Landmarks as selectable destinations (radii approximate their real extents).
  const LANDMARK_RADIUS: Record<string, number> = { cloud: 15, mw: 300, lg: 4000 };
  const landmarkDests: { name: string; cat: string; sel: Selectable; distPC?: number }[] = [];
  for (const { lm } of landmarkAnchors) {
    const sel: Selectable = {
      id: `lm-${lm.name}`,
      name: lm.name,
      kind: "landmark",
      position: new THREE.Vector3(lm.pos[0], lm.pos[1], lm.pos[2]),
      radiusWorld: LANDMARK_RADIUS[lm.cat] ?? 50,
      describe: () =>
        `<b>${lm.name}</b>${lm.desc ? `<br>${lm.desc}` : ""}<br>` +
        `Distance: ${formatDistancePC(Math.hypot(lm.pos[0], lm.pos[1], lm.pos[2]))}<br>` +
        `<span class="dim">Published position (see manifest)</span>`,
    };
    selection.registerMany([sel]);
    landmarkDests.push({
      name: lm.name, cat: "LANDMARKS", sel,
      distPC: Math.hypot(lm.pos[0], lm.pos[1], lm.pos[2]),
    });
  }
  // Cosmology destinations (D13/D14): the CMB shell is real and mapped; dark
  // energy is uniform (~68% of the energy density) — there is no map, so the
  // entry is an info note that frames the observable universe instead.
  for (const cosmo of [
    {
      name: "Cosmic microwave background (46.5 Gly)",
      desc: "Afterglow of the Big Bang, 380 000 years after the hot beginning. " +
        "Real NASA/WMAP 9-year map on a shell at 46.5 Gly comoving — the edge of the observable universe.",
    },
    {
      name: "Dark energy — uniform, no map",
      desc: "≈68% of the universe's energy density, driving the uniform accelerated expansion. " +
        "It is the same everywhere, so there is no map — this frame shows the observable universe it expands.",
    },
  ]) {
    const sel: Selectable = {
      id: `cosmo-${cosmo.name}`,
      name: cosmo.name,
      kind: "landmark",
      position: new THREE.Vector3(0, 0, -CMB_RADIUS_PC * 0.95),
      radiusWorld: 5e9, // overview framing (clamps to LOG_MIN)
      describe: () => `<b>${cosmo.name}</b><br>${cosmo.desc}<br><span class="dim">Planck/WMAP cosmology (see manifest)</span>`,
    };
    selection.registerMany([sel]);
    landmarkDests.push({ name: cosmo.name, cat: "COSMOLOGY", sel, distPC: CMB_RADIUS_PC });
  }
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
  const nav = new Navigation(app);
  app.addUpdatable(nav);
  cmb.getLog = () => nav.logScale;
  // Travel trails (D15): fading speed-colored ribbon of the actual flight path.
  const trails = new TravelTrails(app, nav);
  app.scene.add(trails.group);
  app.addUpdatable(trails);
  // (No fake warp particles: travel eases the real universe transform past the user.)

  // Star-name hover tags (desktop look ray / XR controller ray — provider wired below).
  const starNameHover = new StarNameHover(app, data.starNames);
  app.addUpdatable(starNameHover);
  const hoverRaycaster = new THREE.Raycaster();

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

  // Hover ray for star-name tags: desktop look direction, else right controller.
  starNameHover.rayProvider = () => {
    if (app.mode === "desktop") {
      hoverRaycaster.ray.origin.copy(app.camera.getWorldPosition(new THREE.Vector3()));
      hoverRaycaster.ray.direction.copy(app.camera.getWorldDirection(new THREE.Vector3()));
      return hoverRaycaster.ray;
    }
    const ctrl = xr.controllers.find((c) => c.userData.hand === "right") ?? xr.controllers[0];
    if (!ctrl) return null;
    const m = ctrl.matrixWorld;
    hoverRaycaster.ray.origin.setFromMatrixPosition(m);
    hoverRaycaster.ray.direction.set(0, 0, -1).transformDirection(new THREE.Matrix4().extractRotation(m));
    return hoverRaycaster.ray;
  };

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

  // ---------- hover labels (dwell ~0.4 s → info chip) ----------
  const hoverChip = new HoverChip(app);
  app.addUpdatable(hoverChip);
  const hoverBySrc = new Map<string, Selectable | null>();
  let hoverSel: Selectable | null = null;
  let hoverDwell = 0;
  const setHoverCandidate = (src: string, s: Selectable | null) => { hoverBySrc.set(src, s); };
  const effHover = (): Selectable | null =>
    hoverBySrc.get("right") ?? hoverBySrc.get("left") ?? hoverBySrc.get("hand1") ??
    hoverBySrc.get("hand0") ?? hoverBySrc.get("desktop") ?? null;
  app.addUpdatable({
    update(dt: number) {
      const s = settings.get("hoverLabels") ? effHover() : null;
      if (s !== hoverSel) { hoverSel = s; hoverDwell = 0; hoverChip.hide(); }
      else if (s) {
        hoverDwell += dt;
        if (hoverDwell >= 0.4) {
          const wp = selection.getWorldPosition(s, new THREE.Vector3());
          const dUni = selection.getUniPosition(s, new THREE.Vector3())
            .distanceTo(nav.universePos(new THREE.Vector3()));
          hoverChip.show(s.name, formatDistancePC(Math.abs(dUni)), wp);
        }
      }
    },
  });

  // Controller aim each frame: panel hover first, else world pick; the beam ends at
  // the hit point (this is also the hover-label source for controllers).
  xr.onHoverRay = (raycaster, hand) => {
    const btn = wrist.intersect(raycaster);
    if (hand === "right") wrist.setHover(btn, "right");
    if (btn !== null) {
      setHoverCandidate(hand, null);
      const hit = raycaster.intersectObject(wrist.mesh, false)[0];
      return hit ? { point: hit.point } : null;
    }
    const s = selection.pickFromRay(raycaster, 1.4);
    setHoverCandidate(hand, s);
    if (s) return { point: selection.getWorldPosition(s, new THREE.Vector3()) };
    return null;
  };

  // Hand aim each frame: panel hover, else cursor at magnetic pick candidate.
  const aimProxy = new THREE.Object3D();
  hands.onAimRay = (raycaster, handIndex) => {
    const btn = wrist.intersect(raycaster);
    wrist.setHover(btn, `hand${handIndex}`);
    if (btn !== null) { setHoverCandidate(`hand${handIndex}`, null); return wrist.mesh; }
    const s = selection.pickFromRay(raycaster, 1.6);
    setHoverCandidate(`hand${handIndex}`, s);
    if (s) {
      aimProxy.position.copy(selection.getWorldPosition(s, new THREE.Vector3()));
      return aimProxy;
    }
    return null;
  };

  // Desktop reticle hover (pointer-locked look ray).
  app.addUpdatable({
    update() {
      if (app.mode !== "desktop" || document.pointerLockElement !== app.renderer.domElement) {
        setHoverCandidate("desktop", null);
        return;
      }
      pickRay.ray.origin.copy(app.camera.getWorldPosition(new THREE.Vector3()));
      pickRay.ray.direction.copy(app.camera.getWorldDirection(new THREE.Vector3()));
      setHoverCandidate("desktop", selection.pickFromRay(pickRay, 1));
    },
  });

  // (Arrival orientation is handled inside Navigation.beginTravel — the universe yaws
  //  so the destination ends up ahead of the user, in every mode.)

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
  // #35: ONE short pulse per button-enter (0.15 amplitude, 12 ms) — never per-frame.
  wrist.onHover = () => xr.pulse("right", 0.15, 12);

  // ---------- destinations list ----------
  const allDest = buildDestinations(hud, selection, { solar, dso, compact, exoplanets, missions, cinematic });
  hud.addDestinations(landmarkDests);
  const wristDest = [...allDest, ...landmarkDests];
  wrist.setDestinations(wristDest.map((d) => ({ name: d.name, sel: d.sel })));

  // ---------- layer visibility wiring ----------
  const applyLayers = () => {
    if (starField) starField.points.visible = settings.get("layerStars");
    exoplanets.points.visible = settings.get("layerExoplanets");
    dso.points.visible = settings.get("layerDSO");
    missions.group.visible = settings.get("layerMissions");
    compact.group.visible = settings.get("layerCompact");
    cinematic.group.visible = settings.get("layerCinematic");
    if (dust) dust.group.visible = settings.get("layerDust");
    if (cepheids) cepheids.points.visible = settings.get("layerCepheids");
    if (globulars) globulars.points.visible = settings.get("layerGlobulars");
    if (localGroup) localGroup.points.visible = settings.get("layerGalaxies");
    if (constellations) constellations.lines.visible = settings.get("layerConstellations");
    if (twoMRS) twoMRS.points.visible = settings.get("layer2MRS");
    // Skybox: toggleable everywhere; hidden by default in passthrough AR (no "bubble").
    milkyWay.sky.visible = settings.get("layerSkybox") && app.mode !== "ar";
    labels.setVisible(settings.get("labels"));
    // C7 grid / C11 galaxy boost / D16 cinematic accent theme.
    grid.group.visible = settings.get("layerGrid");
    if (localGroup) localGroup.setBoost(settings.get("galaxyBoost"));
    cmb.enabled = settings.get("layerCMB");
    darkHalo.mesh.visible = settings.get("layerDarkHalo");
    document.body.classList.toggle("cinematic-theme", settings.get("layerCinematic"));
  };
  settings.onChange(() => applyLayers());
  applyLayers();

  // Grid band follows the zoom level every frame (rebuilds only on band change).
  app.addUpdatable({
    update() { grid.update(nav.logScale, settings.get("orbitExaggeration")); },
  });

  // ---------- comfort vignette + per-frame misc ----------
  app.addUpdatable({
    update(dt: number) {
      // Vignette strength from REAL eased world speed (VR default on; desktop follows setting).
      const speedNorm = Math.min(1, nav.worldSpeed / 10);
      const want = settings.get("vignette") && (app.mode !== "desktop" || speedNorm > 0.5)
        ? speedNorm * 0.85
        : 0;
      app.vignetteStrength += (want - app.vignetteStrength) * Math.min(1, dt * 5);
      // Subtle FOV kick tied to REAL jump velocity (desktop only, and only while
      // actually warping; FOV changes are uncomfortable and unsupported in XR).
      const peak = Math.max(nav.jumpPeakSpeed, 1e-6);
      const norm = app.mode === "desktop" && nav.jumpState === "warping"
        ? THREE.MathUtils.clamp(nav.worldSpeed / peak, 0, 1)
        : 0;
      const targetFov = 70 * (app.mode === "desktop" ? 1 + 0.14 * norm : 1);
      if (Math.abs(app.camera.fov - targetFov) > 0.05) {
        app.camera.fov += (targetFov - app.camera.fov) * Math.min(1, dt * 4);
        app.camera.updateProjectionMatrix();
      }
      // Audio engine follows real eased motion (hum rises as stars genuinely stream past).
      audio.updateEngine(nav.speedUnits, nav.thrustInput.lengthSq() > 0 || nav.jumpState === "warping");
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
        dust?.setXRMode(true);
        wrist.attach(xr.grips[0] ?? app.rig);
        hud.setHint(mode === "vr"
          ? "VR: left stick fly · right stick turn/zoom · grip grab · trigger select · B jump · hold Y home"
          : "AR: universe in your room · skybox off (toggle in LAYERS)");
      }
    } else {
      hud.setHint("Click to capture mouse · WASD move · scroll zoom · Space stop · J jump · ⌂ home · H help");
    }
    applyLayers(); // skybox visibility depends on mode (off in AR)
  };
  app.onSessionEnd = () => {
    dust?.setXRMode(false);
    hud.setHint("Session ended — desktop mode. Click to capture mouse.");
    applyLayers();
  };

  // Optional deep link: ?mode=desktop|vr|ar skips the landing screen.
  // (VR/AR without a user gesture will fail session start and fall back to desktop.)
  const forced = new URLSearchParams(location.search).get("mode");
  if (forced === "desktop" || forced === "vr" || forced === "ar") {
    landing.choose(forced);
  }

  // Start hovering just off Earth in the museum solar system (Navigation constructor
  // already placed the universe at HOME_UNI/HOME_LOG — the user never moves).

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

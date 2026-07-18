// In-XR panel: full functionality — speed/target, jump, Return Home, Back, destinations
// (paged), all layer toggles (incl. skybox), settings (vignette/turn/music/volume/elevation).
// Attachable to the left wrist or pinched off to float fixed in space (grab again to re-attach).
//
// #36: the panel face is a gently curved slab with real depth, and every button is a
// volumetric "soft cuboid" — a rounded 3D body floating a few mm proud of the face,
// with its label on a per-button face texture. Hover LIFTS the button toward the
// pointer (+3 mm, lerped); a press visibly dips it. The 512×640 canvas remains for
// readouts/headers only — hit testing still uses the same canvas-coordinate rects.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Updatable, App } from "../core/App";
import type { Navigation } from "../controls/Navigation";
import type { Selection, Selectable } from "../scene/Selection";
import { settings } from "./Settings";
import { formatSpeed, formatDistancePC, PC_IN_KM } from "../util/astro";

interface Btn { id: string; label: string; x: number; y: number; w: number; h: number; active?: boolean; dim?: boolean; }
type Tab = "main" | "dest" | "layers" | "settings";

/** One volumetric button: rounded body + label face, pooled across tabs/pages. */
interface Cuboid {
  id: string;
  group: THREE.Group;
  body: THREE.Mesh;
  face: THREE.Mesh;
  faceCanvas: HTMLCanvasElement;
  faceCtx: CanvasRenderingContext2D;
  faceTex: THREE.CanvasTexture;
  sig: string;          // visual signature — face redrawn only when this changes
  z: number;            // current lift (animated)
  baseZ: number;        // rest position incl. panel curvature
  pressedAt: number;    // seconds timestamp of last press (−1 = never)
  seen: boolean;        // rebuilt each update; unseen cuboids are hidden
}

const PANEL_W = 0.24, PANEL_H = 0.3;       // metres
const CANVAS_W = 512, CANVAS_H = 640;      // canvas px ↔ panel metres
const BTN_DEPTH = 0.006;                    // cuboid thickness
const HOVER_LIFT = 0.0035;
const PRESS_DIP = 0.002;
const BEND_K = 0.004;                       // panel curvature: edge dip in metres

/** Panel-face z at local x (gentle cylindrical curve, edges curl away from user). */
const bendZ = (x: number) => -BEND_K * (x / (PANEL_W / 2)) * (x / (PANEL_W / 2));

const LAYER_KEYS: { key: string; label: string }[] = [
  { key: "labels", label: "Labels" },
  { key: "orbits", label: "Orbits" },
  { key: "layerStars", label: "Stars" },
  { key: "layerDust", label: "Dust" },
  { key: "layerCepheids", label: "Cepheids" },
  { key: "layerGlobulars", label: "Globulars" },
  { key: "layerGalaxies", label: "Galaxies" },
  { key: "layerConstellations", label: "Constell." },
  { key: "starNames", label: "Star names" },
  { key: "layerExoplanets", label: "Exoplanets" },
  { key: "layerDSO", label: "Deep-sky" },
  { key: "layerMissions", label: "Missions" },
  { key: "layerCompact", label: "BH/Pulsars" },
  { key: "layerSkybox", label: "Skybox" },
  { key: "layerCMB", label: "CMB shell" },
  { key: "layerDarkHalo", label: "DM halo" },
  { key: "layerGrid", label: "Coord grid" },
  { key: "galaxyBoost", label: "Galaxy boost" },
  { key: "layer2MRS", label: "2MRS" },
  { key: "hoverLabels", label: "Hover labels" },
  { key: "objectInfo", label: "Object info" },
  { key: "trails", label: "Trails" },
  { key: "layerCinematic", label: "✦ Cinematic" },
];

export class WristPanel implements Updatable {
  private app: App;
  private nav: Navigation;
  private selection: Selection;
  mesh: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private buttons: Btn[] = [];
  private hoverBtn: string | null = null;
  private tab: Tab = "main";
  private page = 0;
  private destinations: { name: string; sel: Selectable; cat?: string }[] = [];
  private attachParent: THREE.Object3D | null = null;
  private attachPos = new THREE.Vector3(0.02, 0.06, 0.03);
  private attachRot = new THREE.Euler(-1.1, 0.3, 0.4);
  detached = false;
  onHover: (() => void) | null = null;

  // #36 volumetric button pool
  private cuboids = new Map<string, Cuboid>();
  private unitBox = new RoundedBoxGeometry(1, 1, 1, 4, 0.16);
  private unitPlane = new THREE.PlaneGeometry(1, 1);
  private clockS = 0;

  constructor(app: App, nav: Navigation, selection: Selection) {
    this.app = app;
    this.nav = nav;
    this.selection = selection;
    this.canvas = document.createElement("canvas");
    this.canvas.width = CANVAS_W; this.canvas.height = CANVAS_H;
    this.ctx2d = this.canvas.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;

    // Curved face (slight cylindrical bend for depth, #36).
    const faceGeo = new THREE.PlaneGeometry(PANEL_W, PANEL_H, 20, 1);
    const fp = faceGeo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < fp.count; i++) fp.setZ(i, bendZ(fp.getX(i)));
    faceGeo.computeVertexNormals();
    this.mesh = new THREE.Mesh(
      faceGeo,
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, side: THREE.DoubleSide }),
    );
    this.mesh.visible = false;

    // Backing slab — the dashboard itself is a solid object, not a floating sheet.
    const slab = new THREE.Mesh(
      new RoundedBoxGeometry(PANEL_W + 0.008, PANEL_H + 0.008, 0.005, 3, 0.004),
      new THREE.MeshBasicMaterial({ color: 0x0a1222 }),
    );
    slab.position.z = -0.0035;
    this.mesh.add(slab);
  }

  /** Attach to the left controller grip (called once XR starts). */
  attach(parent: THREE.Object3D) {
    this.attachParent = parent;
    parent.add(this.mesh);
    this.mesh.position.copy(this.attachPos);
    this.mesh.rotation.copy(this.attachRot);
    this.mesh.scale.setScalar(1);
    this.mesh.visible = true;
    this.detached = false;
  }

  /** Detach so it floats fixed in the room (scene-level — the universe moves under
   *  grab/zoom, a pinned panel must not ride it); call again to re-attach to the wrist. */
  togglePin() {
    if (!this.attachParent) return;
    if (!this.detached) {
      this.app.scene.attach(this.mesh); // keeps world transform, pinned in the user frame
      this.detached = true;
    } else {
      this.attachParent.attach(this.mesh);
      this.mesh.position.copy(this.attachPos);
      this.mesh.rotation.copy(this.attachRot);
      this.mesh.scale.setScalar(1);
      this.detached = false;
    }
  }

  setDestinations(items: { name: string; sel: Selectable; cat?: string }[]) {
    this.destinations = items;
  }

  /** Ray (world space) → button id if it hits the panel. */
  intersect(raycaster: THREE.Raycaster): string | null {
    if (!this.mesh.visible) return null;
    const hits = raycaster.intersectObject(this.mesh, false);
    if (!hits.length) return null;
    const uv = hits[0].uv;
    if (!uv) return null;
    const px = uv.x * this.canvas.width;
    const py = (1 - uv.y) * this.canvas.height;
    for (const b of this.buttons) {
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b.id;
    }
    return null;
  }

  press(id: string) {
    const cub = this.cuboids.get(id);
    if (cub) cub.pressedAt = this.clockS; // visible dip (#36)
    if (id.startsWith("tab:")) { this.tab = id.slice(4) as Tab; this.page = 0; return; }
    if (id.startsWith("page:")) {
      const pages = Math.max(1, Math.ceil(this.destinations.length / this.perPage()));
      this.page = (this.page + (id.endsWith("next") ? 1 : pages - 1)) % pages;
      return;
    }
    if (id.startsWith("dest:")) {
      const d = this.destinations[parseInt(id.slice(5))];
      if (d) {
        this.selection.select(d.sel);
        this.nav.quickJump(d.sel); // real-travel jump straight from the panel
        this.tab = "main";
      }
      return;
    }
    if (id.startsWith("layer:")) { settings.toggle(id.slice(6) as never); return; }
    if (id.startsWith("grid:")) {
      settings.set("gridMode", parseInt(id.slice(5)) as never);
      settings.set("layerGrid", true as never);
      return;
    }
    if (id.startsWith("dim:")) { settings.set("distanceDimming", parseInt(id.slice(4)) as never); return; }
    switch (id) {
      case "jump": if (this.selection.target) this.nav.quickJump(this.selection.target); break;
      case "stop": this.nav.stop(); break;
      case "home": this.nav.goHome(); break;
      case "back": this.nav.goBack(); break;
      case "pin": this.togglePin(); break;
      case "set:vignette": settings.toggle("vignette"); break;
      case "set:snapTurn": settings.toggle("snapTurn"); break;
      case "set:music": settings.toggle("ambientMusic"); break;
      case "set:timewarp": settings.set("timeWarp", (settings.get("timeWarp") + 1) % 5); break;
      case "vol:-1": settings.set("masterVolume", Math.max(0, settings.get("masterVolume") - 0.1)); break;
      case "vol:1": settings.set("masterVolume", Math.min(1, settings.get("masterVolume") + 0.1)); break;
      case "elev:-1": settings.set("elevationExaggeration", Math.max(0, settings.get("elevationExaggeration") - 1)); break;
      case "elev:1": settings.set("elevationExaggeration", Math.min(10, settings.get("elevationExaggeration") + 1)); break;
      case "size:-1": settings.set("planetSizeExaggeration", Math.max(50, settings.get("planetSizeExaggeration") / 1.5)); break;
      case "size:1": settings.set("planetSizeExaggeration", Math.min(3000, settings.get("planetSizeExaggeration") * 1.5)); break;
    }
  }

  /**
   * #35: source-aware hover with a re-arm guard. Multiple pointers (right
   * controller + two hands) report hovers every frame; the effective hover is
   * the highest-priority non-null one, so sources can no longer fight and
   * retrigger the haptic every frame. A single pulse fires per button-ENTER,
   * and the same button cannot retrigger until it has been exited.
   */
  private hoverBySrc = new Map<string, string | null>();
  private lastPulseId: string | null = null;
  private hoverRearmed = true;

  setHover(id: string | null, src = "main") {
    this.hoverBySrc.set(src, id);
    const eff = this.hoverBySrc.get("right") ?? this.hoverBySrc.get("hand1") ??
      this.hoverBySrc.get("hand0") ?? this.hoverBySrc.get("main") ?? null;
    if (eff === this.hoverBtn) return;
    this.hoverBtn = eff;
    if (eff === null) { this.hoverRearmed = true; return; } // exited → re-arm
    if (eff !== this.lastPulseId || this.hoverRearmed) {
      this.lastPulseId = eff;
      this.hoverRearmed = false;
      this.onHover?.();
    }
  }

  private perPage() { return 6; }

  /* ------------------------------ rendering ------------------------------ */

  /** D16: accent follows the cinematic theme (red-orange) or default (blue). */
  private get acc(): string { return settings.get("layerCinematic") ? "255,106,53" : "125,180,255"; }
  private get accHex(): string { return settings.get("layerCinematic") ? "#ff7a3c" : "#7db4ff"; }

  /** Register a button for this frame: recessed slot on the 2D face + a volumetric cuboid. */
  private btn(b: Btn) {
    const g = this.ctx2d;
    // Recessed slot (shadow bed the cuboid floats over).
    g.fillStyle = "rgba(2,6,14,0.55)";
    g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 12); g.fill();
    this.buttons.push(b);
    this.queueCuboid(b);
  }

  /* ------------------------- #36 volumetric buttons ------------------------- */

  private queueCuboid(b: Btn) {
    let cub = this.cuboids.get(b.id);
    if (!cub) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(this.unitBox, new THREE.MeshBasicMaterial({ color: 0x16233c }));
      const faceCanvas = document.createElement("canvas");
      const faceCtx = faceCanvas.getContext("2d")!;
      const faceTex = new THREE.CanvasTexture(faceCanvas);
      faceTex.colorSpace = THREE.SRGBColorSpace;
      const face = new THREE.Mesh(this.unitPlane, new THREE.MeshBasicMaterial({
        map: faceTex, transparent: true, depthWrite: false,
      }));
      face.position.z = 0.5001; // just proud of the body front (unit box, scaled)
      group.add(body); group.add(face);
      cub = { id: b.id, group, body, face, faceCanvas, faceCtx, faceTex, sig: "", z: 0, baseZ: 0, pressedAt: -100, seen: false };
      this.cuboids.set(b.id, cub);
      this.mesh.add(group);
    }
    cub.seen = true;

    // Canvas rect → panel-local metres (canvas y down, panel y up).
    const wM = (b.w / CANVAS_W) * PANEL_W, hM = (b.h / CANVAS_H) * PANEL_H;
    const cx = ((b.x + b.w / 2) / CANVAS_W - 0.5) * PANEL_W;
    const cy = (0.5 - (b.y + b.h / 2) / CANVAS_H) * PANEL_H;
    cub.group.position.set(cx, cy, bendZ(cx) + BTN_DEPTH / 2 + 0.0006);
    cub.baseZ = cub.group.position.z;
    if (cub.z === 0) cub.z = cub.baseZ; // first show: start at rest, never sunk
    cub.group.position.z = cub.z;
    cub.group.scale.set(wM, hM, BTN_DEPTH);
    cub.face.position.z = 0.51; // just proud of the body front (in group z-units)

    const hovered = this.hoverBtn === b.id;
    const sig = `${b.label}|${b.active ? 1 : 0}|${b.dim ? 1 : 0}|${hovered ? 1 : 0}|${b.w}x${b.h}|${this.acc}`;
    if (sig !== cub.sig) {
      cub.sig = sig;
      this.drawFace(cub, b, hovered);
    }
    cub.group.visible = true;
  }

  /** Paint the button face: soft vertical gradient + rounded edge + label. */
  private drawFace(cub: Cuboid, b: Btn, hovered: boolean) {
    const SS = 2; // supersample for crisp text
    const w = Math.min(1024, Math.max(64, b.w * SS)), h = Math.min(256, Math.max(48, b.h * SS));
    if (cub.faceCanvas.width !== w || cub.faceCanvas.height !== h) {
      cub.faceCanvas.width = w; cub.faceCanvas.height = h;
    }
    const g = cub.faceCtx;
    g.clearRect(0, 0, w, h);
    const acc = this.acc;
    const grad = g.createLinearGradient(0, 0, 0, h);
    if (hovered) { grad.addColorStop(0, `rgba(${acc},0.72)`); grad.addColorStop(1, `rgba(${acc},0.42)`); }
    else if (b.active) { grad.addColorStop(0, `rgba(${acc},0.46)`); grad.addColorStop(1, `rgba(${acc},0.24)`); }
    else { grad.addColorStop(0, "rgba(52,74,118,0.96)"); grad.addColorStop(1, "rgba(26,38,66,0.96)"); }
    g.fillStyle = grad;
    g.beginPath(); g.roundRect(1, 1, w - 2, h - 2, 10 * SS); g.fill();
    // top sheen + soft edge = "soft cuboid" read without scene lights
    g.fillStyle = "rgba(255,255,255,0.13)";
    g.beginPath(); g.roundRect(2 * SS, 2 * SS, w - 4 * SS, h * 0.34, 8 * SS); g.fill();
    g.strokeStyle = `rgba(${acc},${hovered ? 0.95 : 0.55})`;
    g.lineWidth = hovered ? 2.4 * SS : 1.6 * SS;
    g.beginPath(); g.roundRect(1.5, 1.5, w - 3, h - 3, 10 * SS); g.stroke();
    g.fillStyle = b.dim ? "#8fa3c0" : "#eaf2ff";
    g.font = `${b.active ? 700 : 600} ${23 * SS * (b.h / 58)}px system-ui`;
    g.textAlign = "center"; g.textBaseline = "middle";
    const label = b.label.length > 20 ? b.label.slice(0, 19) + "…" : b.label;
    g.fillText(label, w / 2, h / 2 + 1 * SS);
    cub.faceTex.needsUpdate = true;
    // Body tint follows the face state (darker shade = visible side walls).
    const bodyMat = cub.body.material as THREE.MeshBasicMaterial;
    bodyMat.color.set(hovered ? 0x3d5a8c : b.active ? 0x2c4166 : 0x16233c);
    if (settings.get("layerCinematic")) bodyMat.color.offsetHSL(0.02, 0.08, 0);
  }

  /** Per-frame cuboid lifecycle: hide stale ids, animate hover/press lift. */
  private syncCuboids(dt: number) {
    for (const cub of this.cuboids.values()) {
      if (!cub.seen) { cub.group.visible = false; continue; }
      cub.seen = false;
      const hovered = this.hoverBtn === cub.id;
      const pressT = this.clockS - cub.pressedAt;
      const dip = pressT < 0.22 ? -PRESS_DIP * Math.sin((pressT / 0.22) * Math.PI) : 0;
      const target = cub.baseZ + (hovered ? HOVER_LIFT : 0) + dip;
      cub.z += (target - cub.z) * Math.min(1, dt * 14);
      cub.group.position.z = cub.z;
    }
  }

  update(dt: number, _t: number) {
    if (!this.mesh.visible) return;
    this.clockS += dt;
    const g = this.ctx2d;
    const W = this.canvas.width, H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = "rgba(8,14,28,0.9)";
    g.beginPath(); g.roundRect(0, 0, W, H, 22); g.fill();
    g.strokeStyle = `rgba(${this.acc},0.5)`; g.lineWidth = 2; g.stroke();
    this.buttons = [];

    // Tab bar
    const tabs: [Tab, string][] = [["main", "MAIN"], ["dest", "DEST"], ["layers", "LAYERS"], ["settings", "SET"]];
    tabs.forEach(([id, label], i) => {
      this.btn({ id: `tab:${id}`, label, x: 12 + i * 123, y: 10, w: 116, h: 44, active: this.tab === id });
    });

    if (this.tab === "main") this.renderMain();
    else if (this.tab === "dest") this.renderDest();
    else if (this.tab === "layers") this.renderLayers();
    else this.renderSettings();

    this.tex.needsUpdate = true;
    this.syncCuboids(dt);
  }

  private renderMain() {
    const g = this.ctx2d;
    const spd = formatSpeed(this.nav.speedUnits, this.nav.kmPerUnit);
    g.fillStyle = "#8fa3c0"; g.font = "600 20px system-ui";
    g.fillText("VELOCITY", 18, 88);
    g.fillStyle = "#eaf2ff"; g.font = "700 42px system-ui";
    g.fillText(spd.value, 18, 128);
    g.fillStyle = "#8fa3c0"; g.font = "400 20px system-ui";
    g.fillText(spd.sub, 18, 154);
    g.fillText(this.app.mode.toUpperCase(), 380, 88);

    g.fillStyle = "#8fa3c0"; g.font = "600 20px system-ui";
    g.fillText("TARGET", 18, 200);
    g.fillStyle = this.accHex; g.font = "700 30px system-ui";
    const tname = this.selection.target ? this.selection.target.name : "—";
    g.fillText(tname.length > 20 ? tname.slice(0, 19) + "…" : tname, 18, 234);
    if (this.selection.target) {
      const dUni = this.selection.getUniPosition(this.selection.target, new THREE.Vector3())
        .distanceTo(this.nav.universePos(new THREE.Vector3()));
      g.fillStyle = "#8fa3c0"; g.font = "400 20px system-ui";
      g.fillText(formatDistancePC(Math.abs(dUni)), 18, 262);
      void PC_IN_KM;
    }

    const y = 290, bw = 232, bh = 62, m = 14;
    this.btn({ id: "jump", label: "⟶ JUMP", x: 12, y, w: bw, h: bh, active: !!this.selection.target });
    this.btn({ id: "stop", label: "◼ STOP", x: 12 + bw + m, y, w: bw, h: bh });
    this.btn({ id: "home", label: "⌂ HOME", x: 12, y: y + bh + m, w: bw, h: bh });
    this.btn({ id: "back", label: "⏮ BACK", x: 12 + bw + m, y: y + bh + m, w: bw, h: bh, dim: !this.nav.hasBreadcrumbs });
    this.btn({ id: "pin", label: this.detached ? "📌 Attach to wrist" : "📌 Detach (float)", x: 12, y: y + (bh + m) * 2, w: bw * 2 + m, h: bh, active: this.detached });
    g.fillStyle = "#5c6f8d"; g.font = "400 17px system-ui";
    g.fillText("Pinch-hold on panel = detach/attach", 18, y + (bh + m) * 2 + bh + 40);
  }

  private renderDest() {
    const g = this.ctx2d;
    g.fillStyle = "#8fa3c0"; g.font = "600 19px system-ui";
    const pages = Math.max(1, Math.ceil(this.destinations.length / this.perPage()));
    g.fillText(`DESTINATIONS  ${this.page + 1}/${pages}`, 18, 88);
    const start = this.page * this.perPage();
    const items = this.destinations.slice(start, start + this.perPage());
    // #48: data-source attribution under the header (list is sorted by source).
    const cat = items[0]?.cat;
    if (cat) {
      g.fillStyle = "#5c6f8d"; g.font = "400 16px system-ui";
      g.fillText(cat.toUpperCase(), 18, 106);
    }
    items.forEach((d, i) => {
      this.btn({ id: `dest:${start + i}`, label: d.name, x: 12, y: 116 + i * 64, w: 488, h: 54 });
    });
    this.btn({ id: "page:prev", label: "◀ Prev", x: 12, y: 520, w: 238, h: 56 });
    this.btn({ id: "page:next", label: "Next ▶", x: 262, y: 520, w: 238, h: 56 });
  }

  private renderLayers() {
    const g = this.ctx2d;
    g.fillStyle = "#8fa3c0"; g.font = "600 19px system-ui";
    g.fillText("LAYERS", 18, 88);
    LAYER_KEYS.forEach((l, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      this.btn({
        id: `layer:${l.key}`, label: l.label,
        x: 12 + col * 250, y: 92 + row * 46, w: 238, h: 40,
        active: settings.get(l.key as never) as boolean,
      });
    });
  }

  private renderSettings() {
    const g = this.ctx2d;
    g.fillStyle = "#8fa3c0"; g.font = "600 19px system-ui";
    g.fillText("SETTINGS", 18, 88);
    this.btn({ id: "set:vignette", label: "Vignette", x: 12, y: 106, w: 238, h: 58, active: settings.get("vignette") });
    this.btn({ id: "set:snapTurn", label: "Snap turn", x: 262, y: 106, w: 238, h: 58, active: settings.get("snapTurn") });
    this.btn({ id: "set:music", label: "Music", x: 12, y: 176, w: 238, h: 58, active: settings.get("ambientMusic") });
    const vol = Math.round(settings.get("masterVolume") * 100);
    this.btn({ id: "vol:-1", label: "Vol −", x: 262, y: 176, w: 113, h: 58 });
    this.btn({ id: "vol:1", label: `Vol + ${vol}%`, x: 387, y: 176, w: 113, h: 58 });
    const elev = settings.get("elevationExaggeration").toFixed(0);
    this.btn({ id: "elev:-1", label: "Elev −", x: 12, y: 246, w: 238, h: 58 });
    this.btn({ id: "elev:1", label: `Elev + (${elev}×)`, x: 262, y: 246, w: 238, h: 58 });
    const size = settings.get("planetSizeExaggeration").toFixed(0);
    this.btn({ id: "size:-1", label: "Planet size −", x: 12, y: 316, w: 238, h: 58 });
    this.btn({ id: "size:1", label: `Size + (${size}×)`, x: 262, y: 316, w: 238, h: 58 });
    // A1: simulation-clock time warp (real time ↔ 1 day/s).
    const twShort = ["1× real", "60×", "600×", "1 h/s", "1 day/s"][settings.get("timeWarp")] ?? "1×";
    this.btn({ id: "set:timewarp", label: `Time: ${twShort}`, x: 12, y: 386, w: 488, h: 58 });
    // #37: grid style segmented control (also enables the grid layer).
    const gm = settings.get("gridMode");
    g.fillStyle = "#8fa3c0"; g.font = "600 19px system-ui";
    g.fillText("GRID STYLE", 18, 478);
    ["Cartesian", "Spherical", "Cylindrical"].forEach((label, i) => {
      this.btn({ id: `grid:${i}`, label, x: 12 + i * 166, y: 490, w: 158, h: 52, active: gm === i && settings.get("layerGrid") });
    });
    // #52: distance dimming mode.
    const dm = settings.get("distanceDimming");
    g.fillStyle = "#8fa3c0"; g.font = "600 19px system-ui";
    g.fillText("DISTANCE DIMMING", 18, 570);
    ["None", "Realistic", "Artificial"].forEach((label, i) => {
      this.btn({ id: `dim:${i}`, label, x: 12 + i * 166, y: 582, w: 158, h: 52, active: dm === i });
    });
  }
}

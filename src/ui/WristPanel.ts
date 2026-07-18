// In-XR panel: full functionality — speed/target, jump, Return Home, Back, destinations
// (paged), all layer toggles (incl. skybox), settings (vignette/turn/music/volume/elevation).
// Attachable to the left wrist or pinched off to float fixed in space (grab again to re-attach).
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import type { Navigation } from "../controls/Navigation";
import type { Selection, Selectable } from "../scene/Selection";
import { settings } from "./Settings";
import { formatSpeed, formatDistancePC, PC_IN_KM } from "../util/astro";

interface Btn { id: string; label: string; x: number; y: number; w: number; h: number; active?: boolean; dim?: boolean; }
type Tab = "main" | "dest" | "layers" | "settings";

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
  private destinations: { name: string; sel: Selectable }[] = [];
  private attachParent: THREE.Object3D | null = null;
  private attachPos = new THREE.Vector3(0.02, 0.06, 0.03);
  private attachRot = new THREE.Euler(-1.1, 0.3, 0.4);
  detached = false;
  onHover: (() => void) | null = null;

  constructor(app: App, nav: Navigation, selection: Selection) {
    this.app = app;
    this.nav = nav;
    this.selection = selection;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 512; this.canvas.height = 640;
    this.ctx2d = this.canvas.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.24, 0.3),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, side: THREE.DoubleSide }),
    );
    this.mesh.visible = false;
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

  setDestinations(items: { name: string; sel: Selectable }[]) {
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

  private btn(b: Btn) {
    const g = this.ctx2d;
    g.fillStyle = this.hoverBtn === b.id ? `rgba(${this.acc},0.55)`
      : b.active ? `rgba(${this.acc},0.30)` : "rgba(30,45,75,0.85)";
    g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 10); g.fill();
    g.strokeStyle = `rgba(${this.acc},0.6)`; g.lineWidth = 2; g.stroke();
    g.fillStyle = b.dim ? "#8fa3c0" : "#eaf2ff";
    g.font = "600 23px system-ui";
    g.textAlign = "center";
    const label = b.label.length > 20 ? b.label.slice(0, 19) + "…" : b.label;
    g.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 8);
    g.textAlign = "left";
    this.buttons.push(b);
  }

  update(_dt: number, _t: number) {
    if (!this.mesh.visible) return;
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
    items.forEach((d, i) => {
      this.btn({ id: `dest:${start + i}`, label: d.name, x: 12, y: 106 + i * 66, w: 488, h: 56 });
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
  }
}

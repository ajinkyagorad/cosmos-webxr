// In-XR UI: left-wrist canvas panel (speed + target + quick toggles) and a floating
// reticle info panel. Buttons are clicked with the opposite controller ray (or pinch).
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import type { Navigation } from "../controls/Navigation";
import type { Selection } from "../scene/Selection";
import { settings } from "./Settings";
import { formatSpeed, PC_IN_KM } from "../util/astro";

interface WristButton { id: string; label: string; x: number; y: number; w: number; h: number; }

export class WristPanel implements Updatable {
  private app: App;
  private nav: Navigation;
  private selection: Selection;
  mesh: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private buttons: WristButton[] = [];
  private hoverBtn: string | null = null;
  onHover: (() => void) | null = null;

  constructor(app: App, nav: Navigation, selection: Selection) {
    this.app = app;
    this.nav = nav;
    this.selection = selection;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 512; this.canvas.height = 384;
    this.ctx2d = this.canvas.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.24, 0.18),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, side: THREE.DoubleSide }),
    );
    this.mesh.visible = false;
    this.defineButtons();
  }

  /** Attach to the left controller grip (called once XR starts). */
  attach(parent: THREE.Object3D) {
    parent.add(this.mesh);
    this.mesh.position.set(0.02, 0.06, 0.03);
    this.mesh.rotation.set(-1.1, 0.3, 0.4);
    this.mesh.visible = true;
  }

  private defineButtons() {
    const bw = 150, bh = 54, m = 12;
    this.buttons = [
      { id: "labels", label: "Labels", x: m, y: 250, w: bw, h: bh },
      { id: "orbits", label: "Orbits", x: m + bw + m, y: 250, w: bw, h: bh },
      { id: "music", label: "Music", x: m + (bw + m) * 2, y: 250, w: bw, h: bh },
      { id: "jump", label: "JUMP", x: m, y: 250 + bh + m, w: bw * 2 + m, h: bh },
      { id: "brake", label: "Brake", x: m + (bw + m) * 2, y: 250 + bh + m, w: bw, h: bh },
    ];
  }

  /** Ray (in world space) → button id if it hits the panel. */
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
    switch (id) {
      case "labels": settings.toggle("labels"); break;
      case "orbits": settings.toggle("orbits"); break;
      case "music": settings.toggle("ambientMusic"); break;
      case "jump":
        if (this.selection.target) this.nav.quickJump(this.selection.target);
        break;
      case "brake": this.nav.velocity.multiplyScalar(0.1); break;
    }
  }

  setHover(id: string | null) {
    if (id !== this.hoverBtn) {
      this.hoverBtn = id;
      if (id) this.onHover?.();
    }
  }

  update(_dt: number, _t: number) {
    if (!this.mesh.visible) return;
    const g = this.ctx2d;
    const W = this.canvas.width, H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = "rgba(8,14,28,0.88)";
    g.beginPath();
    g.roundRect(0, 0, W, H, 22);
    g.fill();
    g.strokeStyle = "rgba(125,180,255,0.5)";
    g.lineWidth = 2;
    g.stroke();

    // Speed block
    const spd = formatSpeed(this.nav.speedUnits, this.nav.kmPerUnit);
    g.fillStyle = "#8fa3c0";
    g.font = "600 20px system-ui";
    g.fillText("VELOCITY", 18, 36);
    g.fillStyle = "#eaf2ff";
    g.font = "700 40px system-ui";
    g.fillText(spd.value, 18, 78);
    g.fillStyle = "#8fa3c0";
    g.font = "400 20px system-ui";
    g.fillText(spd.sub, 18, 106);
    g.fillText(this.app.mode.toUpperCase(), 360, 36);

    // Target block
    g.fillStyle = "#8fa3c0";
    g.font = "600 20px system-ui";
    g.fillText("TARGET", 18, 152);
    g.fillStyle = "#7db4ff";
    g.font = "700 30px system-ui";
    const tname = this.selection.target ? this.selection.target.name : "—";
    g.fillText(tname.length > 22 ? tname.slice(0, 21) + "…" : tname, 18, 188);
    if (this.selection.target) {
      const tp = this.selection.getWorldPosition(this.selection.target, new THREE.Vector3());
      const d = tp.distanceTo(this.app.camera.getWorldPosition(new THREE.Vector3()));
      g.fillStyle = "#8fa3c0";
      g.font = "400 20px system-ui";
      g.fillText(`${(d * PC_IN_KM / 1.496e8).toExponential(2)} AU`, 18, 218);
    }

    // Buttons
    for (const b of this.buttons) {
      const active =
        (b.id === "labels" && settings.get("labels")) ||
        (b.id === "orbits" && settings.get("orbits")) ||
        (b.id === "music" && settings.get("ambientMusic"));
      g.fillStyle = this.hoverBtn === b.id ? "rgba(125,180,255,0.5)" : active ? "rgba(125,180,255,0.3)" : "rgba(30,45,75,0.8)";
      g.beginPath();
      g.roundRect(b.x, b.y, b.w, b.h, 10);
      g.fill();
      g.strokeStyle = "rgba(125,180,255,0.6)";
      g.stroke();
      g.fillStyle = "#eaf2ff";
      g.font = "600 24px system-ui";
      g.textAlign = "center";
      g.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 8);
      g.textAlign = "left";
    }
    this.tex.needsUpdate = true;
  }
}

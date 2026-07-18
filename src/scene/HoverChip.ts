// Hover info chip: pointer dwell (~0.4 s) on any selectable shows a small floating
// name + distance chip while the ray stays on it; hides when the ray moves off.
// One pooled canvas sprite, world-space, constant angular size (same formula as labels).
import * as THREE from "three";
import type { Updatable, App } from "../core/App";

export class HoverChip implements Updatable {
  private app: App;
  private sprite: THREE.Sprite;
  private canvas: HTMLCanvasElement;
  private tex: THREE.CanvasTexture;
  private text = "";
  private anchor = new THREE.Vector3(); // world position to float above
  private active = false;
  private wasActive = false;

  constructor(app: App) {
    this.app = app;
    this.canvas = document.createElement("canvas");
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.tex, transparent: true, depthWrite: false, depthTest: false,
    }));
    this.sprite.renderOrder = 40;
    this.sprite.visible = false;
    this.app.scene.add(this.sprite);
  }

  /** Show the chip for a hovered object (call every frame while dwelled). */
  show(name: string, sub: string, worldPos: THREE.Vector3) {
    this.active = true;
    this.anchor.copy(worldPos);
    const key = `${name}|${sub}`;
    if (key !== this.text) {
      this.text = key;
      const g = this.canvas.getContext("2d")!;
      g.font = '600 30px "Segoe UI", system-ui, sans-serif';
      const w = Math.ceil(Math.max(g.measureText(name).width, g.measureText(sub).width)) + 28;
      this.canvas.width = Math.max(w, 64);
      this.canvas.height = sub ? 84 : 52;
      const g2 = this.canvas.getContext("2d")!;
      g2.font = '600 30px "Segoe UI", system-ui, sans-serif';
      g2.lineWidth = 5; g2.lineJoin = "round";
      g2.strokeStyle = "rgba(2,5,10,0.92)";
      g2.strokeText(name, 14, 36);
      g2.fillStyle = "#eaf2ff";
      g2.fillText(name, 14, 36);
      if (sub) {
        g2.font = '400 24px "Segoe UI", system-ui, sans-serif';
        g2.strokeText(sub, 14, 70);
        g2.fillStyle = "#9fb6d8";
        g2.fillText(sub, 14, 70);
      }
      this.tex.needsUpdate = true;
    }
  }

  hide() { this.active = false; }

  update(_dt: number, _t: number) {
    if (this.wasActive !== this.active) {
      this.wasActive = this.active;
      this.sprite.visible = this.active;
      if (!this.active) this.text = "";
    }
    if (!this.active) return;
    const cam = this.app.camera.getWorldPosition(new THREE.Vector3());
    const dist = Math.max(this.anchor.distanceTo(cam), 1e-6);
    const h = THREE.MathUtils.clamp(dist * 0.055, 0.01, 2.5);
    const aspect = this.canvas.width / Math.max(this.canvas.height, 1);
    this.sprite.scale.set(h * aspect, h, 1);
    this.sprite.position.copy(this.anchor);
    this.sprite.position.y += h * 0.9;
  }
}

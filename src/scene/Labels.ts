// In-world labels via troika-three-text (crisp SDF text). Falls back to canvas sprites
// if troika fails to initialize for any reason.
// Labels live at SCENE level (world space, metres) — they follow their anchor's world
// position and keep a constant angular size, independent of the universe log scale.
// Each label can declare a zoom window [minLog, maxLog] so e.g. planet names only
// appear at solar-system zoom and constellation names only at star-field zoom.
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import { settings } from "../ui/Settings";

interface LabelEntry {
  name: string;
  object: THREE.Object3D;
  node: THREE.Object3D;
  baseSize: number;
  minLog: number;
  maxLog: number;
  when?: () => boolean;
}

export class LabelManager implements Updatable {
  private app: App;
  private group = new THREE.Group();
  private labels: LabelEntry[] = [];
  private camPos = new THREE.Vector3();
  private objPos = new THREE.Vector3();

  constructor(app: App) {
    this.app = app;
    this.group.name = "labels";
    this.app.scene.add(this.group); // world space — rides the stationary user frame
  }

  get object() { return this.group; }

  /** Add a text label following `object`. size = text height as a fraction of view
   *  distance (×1000, i.e. legacy baseSize units); minLog/maxLog = zoom window;
   *  when = optional extra visibility predicate (e.g. layer toggle). */
  async add(name: string, object: THREE.Object3D, opts: {
    size?: number; color?: string; minLog?: number; maxLog?: number; when?: () => boolean;
  } = {}) {
    const size = opts.size ?? 0.06;
    let node: THREE.Object3D;
    try {
      const { Text } = await import("troika-three-text");
      const t = new Text();
      t.text = name;
      t.fontSize = 1;
      t.color = new THREE.Color(opts.color ?? "#cfe2ff").getHex();
      t.anchorX = "center";
      t.anchorY = "bottom";
      t.outlineWidth = 0.06;
      t.outlineColor = 0x000000;
      t.outlineOpacity = 0.7;
      t.sync();
      node = t as unknown as THREE.Object3D;
    } catch (e) {
      console.warn("troika-three-text unavailable, using canvas sprite for", name, e);
      node = this.canvasSprite(name, opts.color ?? "#cfe2ff");
    }
    node.visible = false;
    this.group.add(node);
    this.labels.push({
      name, object, node, baseSize: size,
      minLog: opts.minLog ?? -Infinity, maxLog: opts.maxLog ?? Infinity,
      when: opts.when,
    });
  }

  private canvasSprite(text: string, color: string): THREE.Sprite {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 96;
    const g = c.getContext("2d")!;
    g.font = "600 44px 'Segoe UI', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = "black";
    g.shadowBlur = 10;
    g.fillStyle = color;
    g.fillText(text, 256, 48);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    return s;
  }

  setVisible(v: boolean) {
    if (!v) for (const l of this.labels) l.node.visible = false;
  }

  update(_dt: number, _t: number) {
    if (!settings.get("labels")) {
      if (this.labels.some((l) => l.node.visible)) for (const l of this.labels) l.node.visible = false;
      return;
    }
    const logScale = Math.log10(Math.max(this.app.universe.scale.x, 1e-12));
    this.app.camera.getWorldPosition(this.camPos);
    const camQ = this.app.camera.getWorldQuaternion(new THREE.Quaternion());
    for (const l of this.labels) {
      const inWindow = logScale >= l.minLog && logScale <= l.maxLog && (l.when?.() ?? true);
      if (!inWindow) {
        if (l.node.visible) l.node.visible = false;
        continue;
      }
      l.object.getWorldPosition(this.objPos);
      l.node.position.copy(this.objPos);
      const dist = this.objPos.distanceTo(this.camPos);
      // Constant angular size (~3.5% of view distance), capped for extreme distances.
      const s = THREE.MathUtils.clamp(dist * 0.035, 1e-6, l.baseSize * 600);
      l.node.scale.setScalar(s);
      l.node.quaternion.copy(camQ);
      l.node.visible = true;
    }
  }
}

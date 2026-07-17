// In-world labels via troika-three-text (crisp SDF text). Falls back to canvas sprites
// if troika fails to initialize for any reason.
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import { settings } from "../ui/Settings";

interface LabelEntry {
  name: string;
  object: THREE.Object3D;
  node: THREE.Object3D;
  baseSize: number;
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
  }

  get object() { return this.group; }

  /** Add a text label following `object`. baseSize = world height of text at creation scale. */
  async add(name: string, object: THREE.Object3D, opts: { size?: number; color?: string; offsetY?: number } = {}) {
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
    node.visible = settings.get("labels");
    this.group.add(node);
    this.labels.push({ name, object, node, baseSize: size });
    void (opts.offsetY ?? 0);
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
    for (const l of this.labels) l.node.visible = v;
  }

  update(_dt: number, _t: number) {
    if (!settings.get("labels")) return;
    this.app.camera.getWorldPosition(this.camPos);
    this.app.universe.updateMatrixWorld(false);
    for (const l of this.labels) {
      l.object.getWorldPosition(this.objPos);
      // Convert world → universe-local so labels ride the floating origin correctly
      // (label group is parented to the universe).
      l.node.position.copy(this.group.worldToLocal(this.objPos.clone()));
      const dist = this.objPos.distanceTo(this.camPos);
      // Pure distance-proportional sizing: labels keep a constant angular size and never
      // blow up at close range. Capped for extremely far labels.
      const s = THREE.MathUtils.clamp(dist * 0.035, 1e-6, l.baseSize * 600);
      l.node.scale.setScalar(s);
      l.node.quaternion.copy(this.app.camera.getWorldQuaternion(new THREE.Quaternion()));
      // Hide labels that are absurdly far relative to their context.
      l.node.visible = settings.get("labels");
    }
  }
}

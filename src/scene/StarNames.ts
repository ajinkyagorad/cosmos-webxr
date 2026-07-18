// Star-name hover labels (Milky Way Atlas behavior): every frame, the stars with real
// proper names (HYG v4.1, ≤1400 pc) nearest to the hover ray get small floating name
// tags — desktop uses the look direction, XR the controller/hand aim ray.
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import type { StarNamesData } from "../data/types";
import { settings } from "../ui/Settings";

const MAX_SHOWN = 5;
const ANG_LIMIT = 0.05; // rad
const _ray = new THREE.Ray();
const _inv = new THREE.Matrix4();
const _w = new THREE.Vector3();

export class StarNameHover implements Updatable {
  private app: App;
  private stars: StarNamesData["stars"] = [];
  private group = new THREE.Group();
  private cache = new Map<string, THREE.Sprite>();
  /** Set by main: returns the current world-space hover ray (or null). */
  rayProvider: (() => THREE.Ray | null) | null = null;
  enabled = true;

  constructor(app: App, data: StarNamesData | null) {
    this.app = app;
    this.group.name = "star-name-hover";
    this.app.universe.add(this.group); // tags sit at universe-local star positions
    if (data) this.stars = data.stars;
  }

  private makeSprite(text: string): THREE.Sprite {
    const c = document.createElement("canvas");
    const g = c.getContext("2d")!;
    g.font = '600 36px "Segoe UI", system-ui, sans-serif';
    c.width = Math.ceil(g.measureText(text).width) + 20;
    c.height = 52;
    const g2 = c.getContext("2d")!;
    g2.font = '600 36px "Segoe UI", system-ui, sans-serif';
    g2.lineWidth = 6;
    g2.lineJoin = "round";
    g2.strokeStyle = "rgba(2,5,10,0.9)";
    g2.strokeText(text, 10, 38);
    g2.fillStyle = "#dbe4f0";
    g2.fillText(text, 10, 38);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, depthTest: false,
    }));
    s.renderOrder = 25;
    (s as unknown as { aspect: number }).aspect = c.width / c.height;
    return s;
  }

  update(_dt: number, _t: number) {
    for (const s of this.cache.values()) s.visible = false;
    if (!this.enabled || !settings.get("starNames") || !this.rayProvider || !this.stars.length) return;
    const ray = this.rayProvider();
    if (!ray) return;
    // Work in universe-local space (pc) so angular math is scale-independent.
    _ray.copy(ray).applyMatrix4(_inv.copy(this.app.universe.matrixWorld).invert());
    _ray.direction.normalize();
    const hits: [number, StarNamesData["stars"][number]][] = [];
    for (const st of this.stars) {
      _w.set(st.p[0] - _ray.origin.x, st.p[1] - _ray.origin.y, st.p[2] - _ray.origin.z);
      const t = _w.dot(_ray.direction);
      if (t <= 0) continue;
      const perp2 = _w.lengthSq() - t * t;
      const ang = Math.sqrt(Math.max(perp2, 0)) / t;
      if (ang < ANG_LIMIT) hits.push([ang, st]);
    }
    if (!hits.length) return;
    hits.sort((a, b) => a[0] - b[0]);
    // Constant angular tag size in the universe frame (reference formula).
    const s = this.app.universe.scale.x;
    const h = THREE.MathUtils.clamp(0.05 / s, 1e-9, 300);
    for (const [, st] of hits.slice(0, MAX_SHOWN)) {
      let sp = this.cache.get(st.n);
      if (!sp) {
        sp = this.makeSprite(st.n);
        this.cache.set(st.n, sp);
        this.group.add(sp);
      }
      sp.visible = true;
      const aspect = (sp as unknown as { aspect: number }).aspect ?? 3;
      sp.scale.set(h * aspect, h, 1);
      sp.position.set(st.p[0], st.p[1], st.p[2] + h * 0.8);
    }
  }
}

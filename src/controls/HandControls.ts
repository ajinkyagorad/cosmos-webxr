// Hand-tracking controls — Milky Way Atlas semantics:
//   pinch ............ 1:1 grab of the universe (index-fingertip as the grab point)
//   both hands pinch . pinch-stretch (scale) + turn about the hand midpoint
//   quick tap-pinch .. select under the aim cursor / press a wrist-panel button
//   pinch on panel ... panel button press (pinch-hold detaches/re-attaches the panel)
// Visible hand models, stable smoothed aim ray with laser + cursor. Degrades
// gracefully to controllers-only.
import * as THREE from "three";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
import type { Updatable, App } from "../core/App";
import type { Navigation } from "./Navigation";
import type { XRControls } from "./XRControls";
import type { WristPanel } from "../ui/WristPanel";

interface HandRig {
  hand: THREE.Group | null;
  pinching: boolean;        // physically pinching now
  grabbing: boolean;        // pinch is steering the universe (not the panel)
  pinchStart: number;       // seconds timestamp of pinch start
  tipAtStart: THREE.Vector3;
  aimDir: THREE.Vector3;    // low-pass filtered aim direction
  aimOrigin: THREE.Vector3;
  hasAim: boolean;
  laser: THREE.Line;
}

const TAP_MAX_SEC = 0.28;     // pinch shorter than this with little motion = tap (select)
const TAP_MAX_MOVE = 0.02;    // metres of fingertip motion allowed for a tap

export class HandControls implements Updatable {
  private app: App;
  private nav: Navigation;
  private xr: XRControls;
  private rigs: [HandRig, HandRig];
  private cursor: THREE.Mesh;
  private clock = 0;
  wrist: WristPanel | null = null;
  /** Fired with a world-space ray on a tap-pinch (selection / panel press). */
  onPinchRay: ((raycaster: THREE.Raycaster) => void) | null = null;
  /** Fired every frame with each active hand's aim ray (for hover/cursor). */
  private raycaster = new THREE.Raycaster();
  onAimRay: ((raycaster: THREE.Raycaster, handIndex: number) => THREE.Object3D | null) | null = null;

  constructor(app: App, nav: Navigation, xr: XRControls) {
    this.app = app;
    this.nav = nav;
    this.xr = xr;

    const mkLaser = () => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0x9fd0ff, transparent: true, opacity: 0.55,
      }));
      line.visible = false;
      line.frustumCulled = false;
      app.scene.add(line); // world-space line
      return line;
    };

    this.rigs = [
      { hand: null, pinching: false, grabbing: false, pinchStart: 0, tipAtStart: new THREE.Vector3(), aimDir: new THREE.Vector3(0, 0, -1), aimOrigin: new THREE.Vector3(), hasAim: false, laser: mkLaser() },
      { hand: null, pinching: false, grabbing: false, pinchStart: 0, tipAtStart: new THREE.Vector3(), aimDir: new THREE.Vector3(0, 0, -1), aimOrigin: new THREE.Vector3(), hasAim: false, laser: mkLaser() },
    ];

    for (let i = 0; i < 2; i++) {
      const h = this.app.renderer.xr.getHand(i) as unknown as THREE.Group;
      this.rigs[i].hand = h;
      this.app.rig.add(h);
      // Visible hand model (procedural joint spheres — no external assets needed).
      try {
        const factory = new XRHandModelFactory();
        const model = factory.createHandModel(h as never, "spheres");
        h.add(model as unknown as THREE.Object3D);
      } catch {
        this.addFallbackHandViz(h);
      }
    }

    // Cursor dot shown at the magnetic pick candidate under the hand ray.
    this.cursor = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x7db4ff, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.cursor.renderOrder = 70;
    this.cursor.visible = false;
    app.scene.add(this.cursor);
  }

  /** Fallback: tiny spheres on each joint (used if the factory import fails). */
  private addFallbackHandViz(hand: THREE.Group) {
    const joints = (hand as unknown as { joints?: Record<string, THREE.Object3D> }).joints;
    if (!joints) return;
    const mat = new THREE.MeshBasicMaterial({ color: 0xbfd8ff });
    for (const name of Object.keys(joints)) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), mat);
      joints[name].add(s);
    }
  }

  private joints(hand: THREE.Group): Record<string, THREE.Object3D> | undefined {
    return (hand as unknown as { joints?: Record<string, THREE.Object3D> }).joints;
  }

  private jointWorld(hand: THREE.Group, name: string, out: THREE.Vector3): boolean {
    const j = this.joints(hand)?.[name];
    if (!j) return false;
    j.getWorldPosition(out);
    return true;
  }

  /** Grab-point matrix: index fingertip, falling back to the wrist (reference poseMat). */
  private tipMatrix = (rig: HandRig): THREE.Matrix4 | null => {
    if (!rig.hand) return null;
    const js = this.joints(rig.hand);
    const j = js?.["index-finger-tip"] ?? js?.["wrist"];
    return j ? j.matrixWorld : null;
  };

  /** Stable aim: wrist → middle-finger MCP, low-pass filtered; origin slightly forward. */
  private updateAim(rig: HandRig, dt: number): boolean {
    if (!rig.hand) return false;
    const wrist = new THREE.Vector3();
    const mcp = new THREE.Vector3();
    if (!this.jointWorld(rig.hand, "wrist", wrist) || !this.jointWorld(rig.hand, "middle-finger-metacarpal", mcp)) {
      rig.hasAim = false;
      return false;
    }
    const raw = mcp.sub(wrist).normalize();
    if (!rig.hasAim) {
      rig.aimDir.copy(raw);
      rig.hasAim = true;
    } else {
      const k = 1 - Math.exp(-dt * 10);
      rig.aimDir.lerp(raw, k).normalize();
    }
    rig.aimOrigin.copy(wrist).addScaledVector(rig.aimDir, 0.05);
    return true;
  }

  private isPinching(hand: THREE.Group): boolean {
    const tip = new THREE.Vector3(), thumb = new THREE.Vector3();
    if (!this.jointWorld(hand, "index-finger-tip", tip) || !this.jointWorld(hand, "thumb-tip", thumb)) return false;
    return tip.distanceTo(thumb) < 0.022;
  }

  update(dt: number, _t: number) {
    this.clock += dt;
    if (this.app.mode === "desktop") {
      this.cursor.visible = false;
      for (const r of this.rigs) r.laser.visible = false;
      return;
    }
    let anyAim = false;
    let cursorSet = false;

    this.rigs.forEach((rig, i) => {
      if (!rig.hand) return;
      const hasAim = this.updateAim(rig, dt);
      if (!hasAim) {
        rig.laser.visible = false;
        if (rig.grabbing) { this.nav.endGrab(i as 0 | 1); rig.grabbing = false; }
        rig.pinching = false;
        return;
      }
      anyAim = true;

      // Aim ray for picking/hover.
      this.raycaster.ray.origin.copy(rig.aimOrigin);
      this.raycaster.ray.direction.copy(rig.aimDir);

      // Laser line (length up to the cursor/panel or a fixed reach).
      let laserLen = 0.6;
      let hitObj: THREE.Object3D | null = null;
      if (this.onAimRay) hitObj = this.onAimRay(this.raycaster, i);
      if (hitObj) {
        laserLen = rig.aimOrigin.distanceTo(hitObj.getWorldPosition(new THREE.Vector3()));
        if (!cursorSet) {
          this.cursor.position.copy(hitObj.getWorldPosition(new THREE.Vector3()));
          this.cursor.scale.setScalar(Math.max(0.006, laserLen * 0.02));
          this.cursor.visible = true;
          cursorSet = true;
        }
      }
      const positions = rig.laser.geometry.getAttribute("position") as THREE.BufferAttribute;
      positions.setXYZ(0, rig.aimOrigin.x, rig.aimOrigin.y, rig.aimOrigin.z);
      positions.setXYZ(1,
        rig.aimOrigin.x + rig.aimDir.x * laserLen,
        rig.aimOrigin.y + rig.aimDir.y * laserLen,
        rig.aimOrigin.z + rig.aimDir.z * laserLen);
      positions.needsUpdate = true;
      rig.laser.visible = true;

      // ---- pinch: grab the universe · tap = select · on panel = UI ----
      const pinching = this.isPinching(rig.hand);
      if (pinching && !rig.pinching) {
        // pinch start
        rig.pinching = true;
        rig.pinchStart = this.clock;
        this.jointWorld(rig.hand, "index-finger-tip", rig.tipAtStart);
        const panelHit = this.wrist ? this.wrist.intersect(this.raycaster) : null;
        if (panelHit !== null) {
          // Panel press — don't grab (reference suppresses grab while panel-hot).
          rig.grabbing = false;
          this.onPinchRay?.(this.raycaster);
          this.xr.pulse(i === 1 ? "right" : "left", 0.25, 25);
        } else {
          rig.grabbing = true;
          this.nav.startGrab(i as 0 | 1, () => this.tipMatrix(rig));
        }
      } else if (!pinching && rig.pinching) {
        // pinch end
        rig.pinching = false;
        if (rig.grabbing) {
          this.nav.endGrab(i as 0 | 1);
          rig.grabbing = false;
          // Short, still pinch = tap → select under the cursor.
          const held = this.clock - rig.pinchStart;
          const tip = new THREE.Vector3();
          this.jointWorld(rig.hand, "index-finger-tip", tip);
          if (held < TAP_MAX_SEC && tip.distanceTo(rig.tipAtStart) < TAP_MAX_MOVE) {
            this.onPinchRay?.(this.raycaster);
            this.xr.pulse(i === 1 ? "right" : "left", 0.25, 25);
          }
        }
      } else if (pinching && rig.pinching && !rig.grabbing && this.wrist) {
        // Held pinch on the panel → detach/re-attach after 0.6 s.
        if (this.clock - rig.pinchStart > 0.6 && (this.wrist.detached || this.wrist.intersect(this.raycaster) !== null)) {
          this.wrist.togglePin();
          rig.pinchStart = this.clock + 999; // fire once per pinch
          this.xr.pulse(i === 1 ? "right" : "left", 0.5, 60);
        }
      }
    });

    if (!cursorSet) this.cursor.visible = false;
  }
}

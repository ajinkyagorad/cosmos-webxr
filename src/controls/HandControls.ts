// Hand-tracking controls: visible hand models, stable smoothed aim ray with laser + cursor,
// pinch select (with ray magnetism), two-pinch pull-to-fly, open-palm brake,
// pinch-hold on the wrist panel to detach it. Degrades gracefully to controllers-only.
import * as THREE from "three";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
import type { Updatable, App } from "../core/App";
import type { Navigation } from "./Navigation";
import type { XRControls } from "./XRControls";
import type { WristPanel } from "../ui/WristPanel";

interface HandRig {
  hand: THREE.Group | null;
  pinching: boolean;
  pinchHeld: number;
  pinchFired: boolean;
  aimDir: THREE.Vector3;     // low-pass filtered aim direction
  aimOrigin: THREE.Vector3;
  hasAim: boolean;
  laser: THREE.Line;
}

export class HandControls implements Updatable {
  private app: App;
  private nav: Navigation;
  private xr: XRControls;
  private rigs: [HandRig, HandRig];
  private cursor: THREE.Mesh;
  private twoPinchLast = 0;
  wrist: WristPanel | null = null;
  /** Fired with a world-space ray when a pinch begins (for selection). */
  onPinchRay: ((raycaster: THREE.Raycaster) => void) | null = null;
  /** Fired every frame with each active hand's aim ray (for hover/cursor). */
  private raycaster = new THREE.Raycaster();
  /** Latest hover-pick callback supplied by main. */
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
      { hand: null, pinching: false, pinchHeld: 0, pinchFired: false, aimDir: new THREE.Vector3(0, 0, -1), aimOrigin: new THREE.Vector3(), hasAim: false, laser: mkLaser() },
      { hand: null, pinching: false, pinchHeld: 0, pinchFired: false, aimDir: new THREE.Vector3(0, 0, -1), aimOrigin: new THREE.Vector3(), hasAim: false, laser: mkLaser() },
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

  private jointWorld(hand: THREE.Group, name: string, out: THREE.Vector3): boolean {
    const joints = (hand as unknown as { joints?: Record<string, THREE.Object3D> }).joints;
    const j = joints?.[name];
    if (!j) return false;
    j.getWorldPosition(out);
    return true;
  }

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
      // Low-pass filter to kill joint jitter (frame-rate independent).
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

  private isOpenPalm(hand: THREE.Group): boolean {
    const palm = new THREE.Vector3();
    if (!this.jointWorld(hand, "middle-finger-metacarpal", palm)) return false;
    let open = 0;
    for (const j of ["index-finger-tip", "middle-finger-tip", "ring-finger-tip", "pinky-finger-tip"]) {
      const p = new THREE.Vector3();
      if (this.jointWorld(hand, j, p) && p.distanceTo(palm) > 0.12) open++;
    }
    return open >= 3;
  }

  update(dt: number, _t: number) {
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
      if (!hasAim) { rig.laser.visible = false; return; }
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

      // Pinch: start → select via ray (with magnetism); hold on panel → detach toggle.
      const pinching = this.isPinching(rig.hand);
      if (pinching) {
        if (!rig.pinching) {
          rig.pinching = true;
          rig.pinchHeld = 0;
          rig.pinchFired = false;
          this.onPinchRay?.(this.raycaster);
          this.xr.pulse(i === 1 ? "right" : "left", 0.25, 25);
        } else {
          rig.pinchHeld += dt;
          if (rig.pinchHeld > 0.6 && !rig.pinchFired && this.wrist) {
            const btn = this.wrist.intersect(this.raycaster);
            if (btn !== null || this.wrist.detached) {
              rig.pinchFired = true;
              this.wrist.togglePin();
              this.xr.pulse(i === 1 ? "right" : "left", 0.5, 60);
            }
          }
        }
      } else {
        rig.pinching = false;
        rig.pinchHeld = 0;
      }
    });

    if (!cursorSet) this.cursor.visible = false;

    // Two-pinch pull = fly (pull space toward you, speed ∝ pull velocity).
    const bothPinching = this.rigs[0].pinching && this.rigs[1].pinching && anyAim;
    if (bothPinching) {
      const mid = this.rigs[0].aimOrigin.clone().add(this.rigs[1].aimOrigin).multiplyScalar(0.5);
      // Project pull along head forward for intuitive "pull toward face" flight.
      const headQ = this.app.camera.getWorldQuaternion(new THREE.Quaternion());
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(headQ);
      const midHead = mid.clone().sub(this.app.camera.getWorldPosition(new THREE.Vector3()));
      const zNow = midHead.dot(fwd);
      if (this.twoPinchLast !== 0) {
        const pull = zNow - this.twoPinchLast; // negative = pulling toward you
        this.nav.velocity.addScaledVector(fwd, -pull * 14 / Math.max(dt, 1e-3) * dt);
      }
      this.twoPinchLast = zNow;
    } else {
      this.twoPinchLast = 0;
    }

    // Open palm = gentle brake.
    let palmBrake = false;
    for (const r of this.rigs) {
      if (r.hand && !r.pinching && this.isOpenPalm(r.hand)) palmBrake = true;
    }
    if (palmBrake) this.nav.braking = true;
  }
}

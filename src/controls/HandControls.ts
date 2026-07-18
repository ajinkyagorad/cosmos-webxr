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
  meshModel: THREE.Object3D | null; // CDN hand model (null until loaded)
  needsFallback: boolean;   // bake bone-model once CDN model is known-failed
  fallbackBaked: boolean;
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
      // #34: same warm amber as controller beams — one distinct pointer style.
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0xffb347, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      line.visible = false;
      line.frustumCulled = false;
      line.renderOrder = 65;
      app.scene.add(line); // world-space line
      return line;
    };

    this.rigs = [
      { hand: null, pinching: false, grabbing: false, pinchStart: 0, tipAtStart: new THREE.Vector3(), aimDir: new THREE.Vector3(0, 0, -1), aimOrigin: new THREE.Vector3(), hasAim: false, laser: mkLaser(), meshModel: null, needsFallback: false, fallbackBaked: false },
      { hand: null, pinching: false, grabbing: false, pinchStart: 0, tipAtStart: new THREE.Vector3(), aimDir: new THREE.Vector3(0, 0, -1), aimOrigin: new THREE.Vector3(), hasAim: false, laser: mkLaser(), meshModel: null, needsFallback: false, fallbackBaked: false },
    ];

    for (let i = 0; i < 2; i++) {
      const h = this.app.renderer.xr.getHand(i) as unknown as THREE.Group;
      this.rigs[i].hand = h;
      this.app.rig.add(h);
      // #32: real hand models — XRHandModelFactory 'mesh' profile (WebXR hands
      // assets CDN). If it never loads (offline/unsupported), bake a low-poly
      // skinned-look bone+palm model from the live joints — NEVER blob spheres.
      try {
        const factory = new XRHandModelFactory();
        const model = factory.createHandModel(h as never, "mesh");
        h.add(model as unknown as THREE.Object3D);
        this.rigs[i].meshModel = model as unknown as THREE.Object3D;
      } catch {
        this.rigs[i].needsFallback = true;
      }
    }

    // Cursor dot shown at the magnetic pick candidate under the hand ray.
    this.cursor = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 1.0, depthTest: false, blending: THREE.AdditiveBlending }),
    );
    this.cursor.renderOrder = 70;
    this.cursor.visible = false;
    app.scene.add(this.cursor);
  }

  /**
   * #32 fallback: low-poly "skinned-look" hand baked from the live joints —
   * bone capsules along each finger chain + knuckle joints + a palm slab.
   * Baked once (bones are rigid); attached into the joint hierarchy so it
   * follows tracking exactly. Never blob-only spheres.
   */
  private static FINGER_CHAINS: string[][] = [
    ["wrist", "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"],
    ["wrist", "index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip"],
    ["wrist", "middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip"],
    ["wrist", "ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip"],
    ["wrist", "pinky-finger-metacarpal", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip"],
  ];

  private bakeFallbackHand(rig: HandRig): boolean {
    const hand = rig.hand;
    const joints = hand ? this.joints(hand) : undefined;
    if (!hand || !joints?.["wrist"] || !joints["middle-finger-metacarpal"]) return false;
    // Don't bake before tracking has produced real (non-coincident) joint poses.
    const w = new THREE.Vector3(), m = new THREE.Vector3();
    joints["wrist"].getWorldPosition(w);
    joints["middle-finger-metacarpal"].getWorldPosition(m);
    if (w.distanceToSquared(m) < 1e-8) return false;

    const mat = new THREE.MeshStandardMaterial({
      color: 0xd9b48c, roughness: 0.85, metalness: 0.0,
      emissive: 0x2a1a0c, // faint self-light so hands read in deep space
    });
    const up = new THREE.Vector3(0, 1, 0);
    const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

    for (const chain of HandControls.FINGER_CHAINS) {
      for (let k = 0; k + 1 < chain.length; k++) {
        const ja = joints[chain[k]], jb = joints[chain[k + 1]];
        if (!ja || !jb) continue;
        ja.getWorldPosition(tmpA); jb.getWorldPosition(tmpB);
        const local = ja.worldToLocal(tmpB.clone()); // child offset in a's frame
        const len = local.length();
        if (len < 1e-5) continue;
        const r = k === 0 && chain[1].includes("metacarpal") ? 0.006 : 0.0045;
        const bone = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, len, 6), mat);
        bone.position.copy(local).multiplyScalar(0.5);
        bone.quaternion.setFromUnitVectors(up, local.clone().normalize());
        bone.userData.fbHand = true;
        ja.add(bone);
        // Knuckle cap (small, part of the bone look — not a blob hand).
        const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.15, 6, 5), mat);
        cap.userData.fbHand = true;
        jb.add(cap);
      }
    }
    // Palm slab: wrist → middle MCP, flattened box.
    const wrist = joints["wrist"];
    const palmLocal = wrist.worldToLocal(m.clone());
    const palmLen = Math.max(palmLocal.length(), 0.02);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.014, palmLen), mat);
    palm.position.copy(palmLocal).multiplyScalar(0.5);
    palm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), palmLocal.clone().normalize());
    palm.userData.fbHand = true;
    wrist.add(palm);

    rig.fallbackBaked = true;
    return true;
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
    // #32: after 3 s, if the CDN hand mesh never materialized, bake the
    // bone-model fallback from live joints; if it loads late, drop the fallback.
    if (this.clock > 3) {
      for (const rig of this.rigs) {
        if (!rig.hand) continue;
        let hasMesh = false;
        rig.meshModel?.traverse((o) => { if ((o as THREE.Mesh).isMesh) hasMesh = true; });
        if (rig.fallbackBaked && hasMesh) {
          rig.hand.traverse((o) => {
            if (o.userData.fbHand) (o.parent?.remove(o), (o as THREE.Mesh).geometry?.dispose());
          });
          rig.fallbackBaked = false;
        } else if (!rig.fallbackBaked && !hasMesh) {
          this.bakeFallbackHand(rig);
        }
      }
    }
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

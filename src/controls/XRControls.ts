// XR controller controls — Milky Way Atlas semantics on the atlas navigation model:
//   left stick: fly · right stick X: yaw about your head · right stick Y: log-scale zoom
//   grip (squeeze): 1:1 grab · both grips: pinch-scale + yaw · trigger: select
//   A: select · B: jump to selected · X tap/hold: labels/back · Y tap/hold: orbits/home
// Visuals: REAL controller models via XRControllerModelFactory (Quest Touch profiles
// from the WebXR input-profiles CDN; minimal-ring fallback if the profile can't load —
// never capsule stand-ins). Exactly ONE thin beam per connected controller, collinear
// with the selection ray, plus a cursor dot at the actual hit point.
import * as THREE from "three";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import type { Updatable, App } from "../core/App";
import type { Navigation } from "./Navigation";
import type { Selection } from "../scene/Selection";
import { settings } from "../ui/Settings";

/** Result returned by the hover callback: where the beam should end (panel button,
 *  selectable object, or null = free space). */
export interface HoverHit { point: THREE.Vector3; }

// #34: the active pointer ray is a warm AMBER laser (bright, additive glow feel)
// so it never blends into blue-white environment lines (grid, orbits, constellations).
const BEAM_COLOR = 0xffb347;
const CURSOR_COLOR = 0xffd27a;
const BEAM_REACH = 4; // metres when pointing into free space

export class XRControls implements Updatable {
  private app: App;
  private nav: Navigation;
  private selection: Selection;
  controllers: THREE.Group[] = [];
  grips: THREE.Group[] = [];
  private prevButtons: Record<string, boolean> = {};
  private snapReady = true;
  /** Ray used for XR selection. */
  readonly raycaster = new THREE.Raycaster();
  onSelectRay: ((raycaster: THREE.Raycaster) => void) | null = null;
  /** Fired each frame per connected controller: returns the beam's hit point (or null). */
  onHoverRay: ((raycaster: THREE.Raycaster, hand: "left" | "right") => HoverHit | null) | null = null;

  private beams: THREE.Line[] = [];
  private cursor: THREE.Mesh;
  private modelFallbackTimer = 0;

  /** Haptic pulse on one hand (no-op outside a session). */
  pulse(hand: "left" | "right", intensity: number, ms: number) {
    const session = this.app.renderer.xr.getSession?.() as unknown as XRSession | undefined;
    if (!session) return;
    for (let i = 0; i < session.inputSources.length; i++) {
      const src = session.inputSources[i];
      if (src.handedness === hand && src.gamepad?.hapticActuators?.[0]) {
        src.gamepad.hapticActuators[0].pulse(THREE.MathUtils.clamp(intensity, 0, 1), ms).catch(() => {});
      }
    }
  }

  constructor(app: App, nav: Navigation, selection: Selection) {
    this.app = app;
    this.nav = nav;
    this.selection = selection;
    const modelFactory = new XRControllerModelFactory();

    for (let i = 0; i < 2; i++) {
      const c = this.app.renderer.xr.getController(i);
      const g = this.app.renderer.xr.getControllerGrip(i);
      this.controllers.push(c as unknown as THREE.Group);
      this.grips.push(g as unknown as THREE.Group);
      this.app.rig.add(c, g);
      (c as unknown as THREE.Group).addEventListener("connected" as never, (e: unknown) => {
        // #33: WebXR fires 'connected' on controller slots for HAND-TRACKING
        // input sources too (Quest synthesizes a pointer pose per hand). Mark
        // those and never draw a controller beam for them — the hand's own
        // laser in HandControls is the single ray for that hand.
        const src = (e as { data?: { handedness?: string; hand?: unknown } }).data;
        const isHand = !!src?.hand;
        (c as unknown as THREE.Group).userData.hand =
          src?.handedness ?? (i === 1 ? "right" : "left");
        (c as unknown as THREE.Group).userData.isHand = isHand;
        (c as unknown as THREE.Group).userData.connected = !isHand;
      });
      (c as unknown as THREE.Group).addEventListener("disconnected" as never, () => {
        (c as unknown as THREE.Group).userData.connected = false;
      });
      // Real Quest controller model (loads the correct profile from the WebXR
      // input-profiles CDN on 'connected'; stays empty if the fetch fails → ring fallback).
      try {
        (g as unknown as THREE.Group).add(modelFactory.createControllerModel(g as never) as unknown as THREE.Object3D);
      } catch {
        this.addRingFallback(g as unknown as THREE.Group);
      }
      // Grip squeeze = grab the universe (event-driven, like the reference).
      const idx = i as 0 | 1;
      (g as unknown as THREE.Group).addEventListener("squeezestart" as never, () => {
        this.nav.startGrab(idx, () => this.grips[idx].matrixWorld);
      });
      (g as unknown as THREE.Group).addEventListener("squeezeend" as never, () => {
        this.nav.endGrab(idx);
      });
      // Exactly ONE beam per controller (world-space line, updated every frame).
      const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
      const beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({
        color: BEAM_COLOR, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      beam.visible = false;
      beam.frustumCulled = false;
      beam.renderOrder = 65;
      this.app.scene.add(beam);
      this.beams.push(beam);
    }

    // Cursor dot at the actual hit point (panel or object): brighter warm core.
    this.cursor = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: CURSOR_COLOR, transparent: true, opacity: 1.0, depthTest: false, blending: THREE.AdditiveBlending }),
    );
    this.cursor.renderOrder = 70;
    this.cursor.visible = false;
    app.scene.add(this.cursor);

    // Haptics on grab/pinch.
    nav.onGrabStart = (two) => {
      this.pulse("left", two ? 0.6 : 0.4, 40);
      this.pulse("right", two ? 0.6 : 0.4, 40);
    };
    nav.onGrabEnd = () => { this.pulse("left", 0.25, 25); this.pulse("right", 0.25, 25); };
  }

  /** Minimal ring fallback if the profile model never loads (never capsules). */
  private addRingFallback(grip: THREE.Group) {
    if (grip.userData.ringFallback) return;
    grip.userData.ringFallback = true;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.018, 0.003, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0x7db4ff, transparent: true, opacity: 0.7 }),
    );
    ring.position.set(0, 0.02, -0.02);
    ring.rotation.x = Math.PI / 3;
    grip.add(ring);
  }

  private wasPressed(id: string): boolean {
    return !!this.prevButtons[id];
  }

  /** Tap = short action; hold ≥0.9 s = long action (fires once per hold). */
  private holdState: Record<string, { t: number; fired: boolean }> = {};
  private handleHoldButton(
    hand: "left" | "right", btnIdx: number, pressed: boolean, dt: number,
    onTap: () => void, onHold: () => void,
  ) {
    const key = `${hand}:${btnIdx}`;
    const st = (this.holdState[key] ??= { t: 0, fired: false });
    if (pressed) {
      st.t += dt;
      if (st.t >= 0.9 && !st.fired) {
        st.fired = true;
        onHold();
      }
    } else {
      if (st.t > 0 && st.t < 0.5 && !st.fired) onTap();
      st.t = 0;
      st.fired = false;
    }
  }

  /** Update one controller's beam + cursor from its aim ray. Returns hit for hover. */
  private updateBeam(i: number): void {
    const c = this.controllers[i];
    const beam = this.beams[i];
    const active = this.app.mode !== "desktop" && !!c.userData.connected;
    if (!active) { beam.visible = false; return; }
    const m = c.matrixWorld;
    this.raycaster.ray.origin.setFromMatrixPosition(m);
    this.raycaster.ray.direction.set(0, 0, -1).transformDirection(new THREE.Matrix4().extractRotation(m));
    const hand = (c.userData.hand === "left" ? "left" : "right") as "left" | "right";
    const hit = this.onHoverRay?.(this.raycaster, hand) ?? null;
    const origin = this.raycaster.ray.origin;
    const dir = this.raycaster.ray.direction;
    const len = hit ? origin.distanceTo(hit.point) : BEAM_REACH;
    const pos = beam.geometry.getAttribute("position") as THREE.BufferAttribute;
    pos.setXYZ(0, origin.x, origin.y, origin.z);
    pos.setXYZ(1, origin.x + dir.x * len, origin.y + dir.y * len, origin.z + dir.z * len);
    pos.needsUpdate = true;
    beam.visible = true;
    if (hit && i === 1) { // one shared cursor, right hand wins
      this.cursor.position.copy(hit.point);
      this.cursor.scale.setScalar(Math.max(0.006, len * 0.02));
      this.cursor.visible = true;
    }
  }

  update(dt: number, _t: number) {
    if (this.app.mode === "desktop") {
      for (const b of this.beams) b.visible = false;
      this.cursor.visible = false;
      return;
    }
    const session = this.app.renderer.xr.getSession?.() as unknown as XRSession | undefined;

    // Beams follow connected controllers (also outside an active session check so
    // they never linger after session end).
    let anyBeam = false;
    for (let i = 0; i < 2; i++) {
      this.updateBeam(i);
      anyBeam = anyBeam || this.beams[i].visible;
    }
    if (!anyBeam) this.cursor.visible = false;

    // Fallback rings if profile models failed to load (Quest offline etc.).
    this.modelFallbackTimer += dt;
    if (this.modelFallbackTimer > 3) {
      this.modelFallbackTimer = -9999; // check once
      for (const g of this.grips) {
        if (g.userData.connected !== false && g.children.length === 0) this.addRingFallback(g);
      }
    }

    if (!session) return;

    const nextButtons: Record<string, boolean> = {};

    for (let i = 0; i < session.inputSources.length; i++) {
      const src = session.inputSources[i];
      const gp = src.gamepad;
      if (!gp) continue;
      const hand = src.handedness as "left" | "right";
      const ax = gp.axes;
      const bt = gp.buttons;
      const b = (n: number) => !!bt[n]?.pressed;
      const id = (n: number) => `${hand}:${n}`;
      nextButtons[id(0)] = b(0); nextButtons[id(1)] = b(1);
      nextButtons[id(4)] = b(4); nextButtons[id(5)] = b(5);
      const x = ax[2] ?? 0, y = ax[3] ?? 0;

      if (hand === "right") {
        // Right stick X: yaw about the head (smooth, or 45° snap per settings).
        if (settings.get("snapTurn")) {
          if (Math.abs(x) > 0.6) {
            if (this.snapReady) {
              this.nav.yawAboutHead(-Math.sign(x) * THREE.MathUtils.degToRad(45));
              this.snapReady = false;
              this.pulse("right", 0.2, 20);
            }
          } else this.snapReady = true;
        } else {
          this.nav.yawStick(x, dt, settings.get("turnSpeed"));
        }
        // Right stick Y: log-scale zoom (push up = zoom in), hard-clamped.
        this.nav.zoomStick(y, dt);
        // Trigger = select under ray.
        if (b(0) && !this.wasPressed(id(0))) {
          this.castSelectionRay("right");
          this.pulse("right", 0.3, 30);
        }
        // A = select under ray (same as trigger).
        if (b(4) && !this.wasPressed(id(4))) {
          this.castSelectionRay("right");
          this.pulse("right", 0.3, 30);
        }
        // B = jump to selected.
        if (b(5) && !this.wasPressed(id(5)) && this.selection.target) {
          this.nav.quickJump(this.selection.target);
          this.pulse("right", 0.6, 120);
        }
      } else if (hand === "left") {
        // Left stick: fly (head-relative).
        this.nav.flyStick(x, y, dt);
        // Left trigger = select under ray (from the left controller).
        if (b(0) && !this.wasPressed(id(0))) {
          this.castSelectionRay("left");
          this.pulse("left", 0.3, 30);
        }
        // X = labels (tap) / BACK (hold 0.9 s) · Y = orbits (tap) / RETURN HOME (hold 0.9 s)
        this.handleHoldButton("left", 4, b(4), dt,
          () => { settings.toggle("labels"); this.pulse("left", 0.3, 30); },
          () => { if (this.nav.goBack()) { this.pulse("left", 0.8, 150); } });
        this.handleHoldButton("left", 5, b(5), dt,
          () => { settings.toggle("orbits"); this.pulse("left", 0.3, 30); },
          () => { this.nav.goHome(); this.pulse("left", 0.8, 150); });
      }
    }
    this.prevButtons = nextButtons;

    // Jump charge haptic crescendo.
    if (this.nav.jumpState === "charging") {
      this.pulse("right", this.nav.jumpCharge * 0.8, 80);
    }
  }

  /** Cast the selection ray from a controller and notify. */
  castSelectionRay(hand: "left" | "right") {
    const session = this.app.renderer.xr.getSession?.() as unknown as XRSession | undefined;
    if (!session) return;
    const ctrl =
      this.controllers.find((c) => c.userData.hand === hand) ??
      this.controllers[hand === "right" ? 1 : 0] ??
      this.controllers[0];
    if (!ctrl) return;
    const m = ctrl.matrixWorld;
    const origin = new THREE.Vector3().setFromMatrixPosition(m);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(new THREE.Matrix4().extractRotation(m));
    this.raycaster.ray.origin.copy(origin);
    this.raycaster.ray.direction.copy(dir);
    this.onSelectRay?.(this.raycaster);
  }
}

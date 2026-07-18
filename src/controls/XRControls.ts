// XR controller controls — Milky Way Atlas semantics on the atlas navigation model:
//   left stick: fly · right stick X: yaw about your head · right stick Y: log-scale zoom
//   grip (squeeze): 1:1 grab · both grips: pinch-scale + yaw · trigger: select
//   A: select · B: jump to selected · X tap/hold: labels/back · Y tap/hold: orbits/home
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import type { Navigation } from "./Navigation";
import type { Selection } from "../scene/Selection";
import { settings } from "../ui/Settings";

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
    for (let i = 0; i < 2; i++) {
      const c = this.app.renderer.xr.getController(i);
      const g = this.app.renderer.xr.getControllerGrip(i);
      this.controllers.push(c as unknown as THREE.Group);
      this.grips.push(g as unknown as THREE.Group);
      this.app.rig.add(c, g);
      (c as unknown as THREE.Group).addEventListener("connected" as never, (e: unknown) => {
        (c as unknown as THREE.Group).userData.hand =
          (e as { data?: { handedness?: string } }).data?.handedness ?? (i === 1 ? "right" : "left");
      });
      // Grip squeeze = grab the universe (event-driven, like the reference).
      const idx = i as 0 | 1;
      (g as unknown as THREE.Group).addEventListener("squeezestart" as never, () => {
        this.nav.startGrab(idx, () => this.grips[idx].matrixWorld);
      });
      (g as unknown as THREE.Group).addEventListener("squeezeend" as never, () => {
        this.nav.endGrab(idx);
      });
      // Simple visible laser pointer on each controller.
      const laserGeo = new THREE.CylinderGeometry(0.0012, 0.0012, 0.35, 6);
      laserGeo.translate(0, 0, -0.175);
      laserGeo.rotateX(-Math.PI / 2);
      const laser = new THREE.Mesh(laserGeo, new THREE.MeshBasicMaterial({ color: 0x7db4ff, transparent: true, opacity: 0.5 }));
      (c as unknown as THREE.Group).add(laser);
      // Simple controller body so the user sees their controllers.
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.016, 0.07, 4, 10),
        new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.6, metalness: 0.3 }),
      );
      body.rotation.x = Math.PI / 2.6;
      (c as unknown as THREE.Group).add(body);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.02, 0.003, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0x7db4ff, transparent: true, opacity: 0.7 }),
      );
      ring.position.set(0, 0.02, -0.02);
      ring.rotation.x = Math.PI / 3;
      (c as unknown as THREE.Group).add(ring);
    }
    // Haptics on grab/pinch.
    nav.onGrabStart = (two) => {
      this.pulse("left", two ? 0.6 : 0.4, 40);
      this.pulse("right", two ? 0.6 : 0.4, 40);
    };
    nav.onGrabEnd = () => { this.pulse("left", 0.25, 25); this.pulse("right", 0.25, 25); };
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

  update(dt: number, _t: number) {
    if (this.app.mode === "desktop") return;
    const session = this.app.renderer.xr.getSession?.() as unknown as XRSession | undefined;
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

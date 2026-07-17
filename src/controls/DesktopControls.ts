// Desktop controls: pointer-lock mouse look + WASD flight + keys for all features.
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import type { Navigation } from "./Navigation";
import type { Selection } from "../scene/Selection";
import { settings } from "../ui/Settings";

export class DesktopControls implements Updatable {
  private app: App;
  private nav: Navigation;
  private selection: Selection;
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private enabled = false;
  onRequestSelect: (() => void) | null = null;

  constructor(app: App, nav: Navigation, selection: Selection) {
    this.app = app;
    this.nav = nav;
    this.selection = selection;

    const canvas = app.renderer.domElement;
    canvas.addEventListener("click", () => {
      if (this.app.mode !== "desktop") return;
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
      } else {
        this.onRequestSelect?.();
      }
    });
    document.addEventListener("pointerlockchange", () => {
      this.enabled = document.pointerLockElement === canvas;
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.enabled) return;
      this.yaw -= e.movementX * 0.0021;
      this.pitch -= e.movementY * 0.0021;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    });
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.handleKey(e.code);
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      if (e.code === "KeyJ") this.nav.releaseJump();
    });
    window.addEventListener("wheel", (e) => {
      if (this.app.mode !== "desktop") return;
      this.nav.setAccelLog(e.deltaY > 0 ? -1 : 1);
    }, { passive: true });
  }

  private handleKey(code: string) {
    switch (code) {
      case "KeyJ":
        if (this.selection.target) this.nav.startCharge(this.selection.target);
        break;
      case "KeyO":
        settings.toggle("orbits");
        break;
      case "KeyN":
        settings.toggle("labels");
        break;
    }
  }

  update(_dt: number, _t: number) {
    if (this.app.mode !== "desktop") {
      this.nav.thrustInput.set(0, 0, 0);
      return;
    }
    // Apply look orientation: yaw on rig, pitch on camera.
    this.app.rig.quaternion.setFromEuler(new THREE.Euler(0, this.yaw, 0, "YXZ"));
    this.app.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, 0, 0, "YXZ"));

    const f = (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) ? 1 : 0.18;
    const x = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    const y = (this.keys.has("KeyE") ? 1 : 0) - (this.keys.has("KeyQ") ? 1 : 0);
    const z = (this.keys.has("KeyS") ? 1 : 0) - (this.keys.has("KeyW") ? 1 : 0);
    this.nav.thrustInput.set(x * f, y * f, z * f);
    this.nav.braking = this.keys.has("Space");
  }
}

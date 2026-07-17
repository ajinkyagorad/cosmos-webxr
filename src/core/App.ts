// Core renderer / scene / XR-session management + floating origin.
import * as THREE from "three";
import { vignetteTexture } from "../util/textures";

export type AppMode = "desktop" | "vr" | "ar";

export interface Updatable { update(dt: number, elapsed: number): void; }

export class App {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  /** Camera rig — move/rotate this for navigation (camera itself is XR-pose driven). */
  rig = new THREE.Group();
  /** All universe content lives here; floating origin shifts it so the rig stays near 0. */
  universe = new THREE.Group();
  mode: AppMode = "desktop";
  clock = new THREE.Clock();
  private updatables: Updatable[] = [];
  private vignette: THREE.Mesh;
  vignetteStrength = 0;
  onSessionEnd: (() => void) | null = null;
  /** Total floating-origin offset applied so far (for diagnostics). */
  readonly originOffset = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.setClearColor(0x000000, 1);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 1e-4, 3e9);
    this.rig.add(this.camera);
    this.scene.add(this.rig);
    this.scene.add(this.universe);

    // Comfort vignette (camera-space dark edge overlay, opacity driven by speed).
    const vMat = new THREE.MeshBasicMaterial({
      map: vignetteTexture(), transparent: true, opacity: 0, depthTest: false, depthWrite: false,
    });
    this.vignette = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), vMat);
    this.vignette.position.set(0, 0, -0.6);
    this.vignette.renderOrder = 999;
    this.vignette.frustumCulled = false;
    this.camera.add(this.vignette);

    window.addEventListener("resize", () => this.onResize());
    this.renderer.xr.addEventListener("sessionend", () => {
      this.mode = "desktop";
      this.renderer.setClearColor(0x000000, 1);
      document.getElementById("btn-exit-xr")?.classList.add("hidden");
      this.onSessionEnd?.();
    });
  }

  addUpdatable(u: Updatable) { this.updatables.push(u); }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  async sessionSupported(mode: "vr" | "ar"): Promise<boolean> {
    if (!("xr" in navigator) || !navigator.xr) return false;
    try {
      return await navigator.xr.isSessionSupported(mode === "vr" ? "immersive-vr" : "immersive-ar");
    } catch { return false; }
  }

  async enterXR(mode: "vr" | "ar"): Promise<boolean> {
    if (!navigator.xr) return false;
    try {
      const session = await navigator.xr.requestSession(
        mode === "vr" ? "immersive-vr" : "immersive-ar",
        { optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "layers"] },
      );
      await this.renderer.xr.setSession(session as never);
      this.mode = mode;
      if (mode === "ar") {
        // Passthrough: transparent clear so the real world shows through.
        this.renderer.setClearColor(0x000000, 0);
      } else {
        this.renderer.setClearColor(0x000000, 1);
      }
      session.addEventListener("end", () => { this.mode = "desktop"; });
      document.getElementById("btn-exit-xr")?.classList.remove("hidden");
      document.getElementById("btn-exit-xr")?.addEventListener("click", () => session.end(), { once: true });
      return true;
    } catch (e) {
      console.error("XR session failed:", e);
      return false;
    }
  }

  /** Floating origin: keep the rig near 0,0,0 by shifting the universe the other way. */
  private recenter() {
    const p = this.rig.position;
    const d2 = p.lengthSq();
    if (d2 > 32 * 32) {
      this.universe.position.sub(p);
      this.originOffset.add(p);
      this.rig.position.set(0, 0, 0);
    }
  }

  start() {
    let firstFrame = true;
    this.renderer.setAnimationLoop(() => {
      if (firstFrame) { firstFrame = false; console.log("[cosmos] first frame rendered"); }
      const dt = Math.min(this.clock.getDelta(), 0.1);
      const t = this.clock.elapsedTime;
      this.recenter();
      for (const u of this.updatables) u.update(dt, t);
      // vignette fade
      const m = this.vignette.material as THREE.MeshBasicMaterial;
      m.opacity += (this.vignetteStrength - m.opacity) * Math.min(1, dt * 6);
      this.renderer.render(this.scene, this.camera);
    });
  }
}

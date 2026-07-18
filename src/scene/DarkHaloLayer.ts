// Dark matter halo (D14): Navarro–Frenk–White profile, ρ(x) = 1/(x(1+x)²),
// x = r/r_s with r_s = 20 kpc, M_vir ≈ 1e12 M☉, r_vir ≈ 200 kpc, centered on
// the real galactic center. Rendered as a faint raymarched shell (16 steps
// through the analytic density) — visible only when viewing the galaxy from
// outside (~>20 kpc from the GC), so it never fogs the local view.
// Layer name: "Dark matter halo (NFW model)".
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import { GALACTIC_CENTER_PC } from "./MilkyWay";

const R_VIR = 200000;  // pc — virial radius for ~1e12 M☉
const R_S = 20000;     // pc — NFW scale radius

const _cam = new THREE.Vector3();

export class DarkHaloLayer implements Updatable {
  mesh: THREE.Mesh;
  /** Anchor for the "Dark matter halo (NFW model)" label. */
  labelAnchor = new THREE.Object3D();
  private mat: THREE.ShaderMaterial;
  private app: App;

  constructor(app: App) {
    this.app = app;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uCamPos: { value: new THREE.Vector3() }, // camera, halo-local pc
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vLocal;
        void main() {
          vLocal = position; // halo-local pc (mesh sits at the GC, unit scale)
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vLocal;
        uniform vec3 uCamPos;
        uniform float uOpacity;
        const float R = ${R_VIR.toFixed(1)};
        const float RS = ${R_S.toFixed(1)};
        void main() {
          vec3 ro = uCamPos;
          vec3 rd = normalize(vLocal - ro);
          float b = dot(ro, rd);
          float c = dot(ro, ro) - R * R;
          float h = b * b - c;
          if (h < 0.0) discard;
          h = sqrt(h);
          float t0 = max(-b - h, 0.0);
          float t1 = -b + h;
          float dt = (t1 - t0) / 16.0;
          float acc = 0.0;
          for (int i = 0; i < 16; i++) {
            vec3 p = ro + rd * (t0 + (float(i) + 0.5) * dt);
            float x = max(length(p) / RS, 0.05); // soften the central cusp
            acc += dt / (x * (1.0 + x) * (1.0 + x));
          }
          float a = clamp(acc * 2.5e-6, 0.0, 0.35) * uOpacity;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vec3(0.52, 0.42, 1.0), a); // faint blue-violet
        }`,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(R_VIR, 48, 32), this.mat);
    this.mesh.position.copy(GALACTIC_CENTER_PC);
    this.mesh.renderOrder = -30;
    this.mesh.frustumCulled = false;
    this.labelAnchor.position.copy(GALACTIC_CENTER_PC).add(new THREE.Vector3(0, 60000, 0));
  }

  update(_dt: number, _t: number): void {
    this.app.camera.getWorldPosition(_cam);
    this.app.universe.worldToLocal(_cam); // camera in universe-local pc
    const distGC = _cam.distanceTo(GALACTIC_CENTER_PC);
    _cam.sub(GALACTIC_CENTER_PC); // halo-local
    (this.mat.uniforms.uCamPos as { value: THREE.Vector3 }).value.copy(_cam);
    // Fade in only when the user is well outside the halo's dense region
    // (inside ~15 kpc you're within it; full strength past ~35 kpc).
    (this.mat.uniforms.uOpacity as { value: number }).value =
      this.mesh.visible ? THREE.MathUtils.smoothstep(distGC, 15000, 35000) : 0;
  }
}

// Warp effect: star-streak tunnel rendered around the camera during FTL jumps.
import * as THREE from "three";
import type { Updatable } from "../core/App";

export class WarpEffect implements Updatable {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  intensity = 0; // 0..1 driven by Navigation

  constructor(camera: THREE.Camera) {
    const N = 900;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.15 + Math.random() * 0.85;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.sin(a) * r;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 2;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform float uIntensity;
        varying float vA;
        void main() {
          vec3 p = position;
          // Streaks rush past the camera along -z.
          float speed = 2.5 + aSeed * 3.0;
          p.z = mod(p.z + uTime * speed, 2.0) - 1.0;
          // Radial stretch grows with intensity → classic star-stretch warp look.
          float stretch = 1.0 + uIntensity * 6.0;
          vec4 mv = modelViewMatrix * vec4(p.xy, p.z * stretch, 1.0);
          gl_PointSize = (1.5 + aSeed * 2.5) * uIntensity * 160.0 / max(-mv.z, 0.05);
          gl_PointSize = clamp(gl_PointSize, 0.0, 40.0);
          vA = uIntensity * (0.4 + 0.6 * aSeed) * smoothstep(-1.0, 0.2, p.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float a = smoothstep(0.5, 0.0, d) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(0.75, 0.85, 1.0, a);
        }
      `,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Points(geo, this.mat) as unknown as THREE.Mesh;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 100;
    this.mesh.visible = false;
    camera.add(this.mesh);
    this.mesh.position.set(0, 0, -0.01);
    this.mesh.scale.setScalar(2.5);
  }

  update(_dt: number, t: number) {
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uIntensity.value += (this.intensity - this.mat.uniforms.uIntensity.value) * 0.12;
    this.mesh.visible = this.mat.uniforms.uIntensity.value > 0.02;
  }
}

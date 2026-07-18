// Star field: THREE.Points + custom ShaderMaterial.
// Size from magnitude, color from B−V (blackbody-ish ramp), soft sprite, subtle twinkle.
import * as THREE from "three";
import type { Updatable } from "../core/App";
import { colorFromCI } from "../util/astro";

export class StarField implements Updatable {
  points: THREE.Points;
  material: THREE.ShaderMaterial;

  constructor(buffer: Float32Array, count: number) {
    const geo = new THREE.BufferGeometry();
    const stride = 5;
    // Interleaved layout [x,y,z,mag,ci] produced by the data pipeline.
    const interleaved = new THREE.InterleavedBuffer(buffer, stride);
    geo.setAttribute("position", new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
    geo.setAttribute("aMag", new THREE.InterleavedBufferAttribute(interleaved, 1, 3));
    geo.setAttribute("aCi", new THREE.InterleavedBufferAttribute(interleaved, 1, 4));

    // Pre-compute colors from CI on CPU (cheaper than per-vertex branching).
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      colorFromCI(buffer[i * stride + 4], c);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 1.0 },      // global size multiplier
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uCamUni: { value: new THREE.Vector3() },  // camera, universe-local pc (#52)
        uDimMode: { value: 0 },      // 0 none · 1 realistic (1/d²) · 2 artificial
        uDimD0: { value: 10 },       // reference distance (pc): 10 pc = absolute magnitude
      },
      vertexShader: /* glsl */ `
        attribute float aMag;
        attribute float aCi;
        attribute vec3 aColor;
        uniform float uTime;
        uniform float uScale;
        uniform float uPixelRatio;
        uniform vec3 uCamUni;
        uniform float uDimMode;
        uniform float uDimD0;
        varying vec3 vColor;
        varying float vTwinkle;
        float dimFactor(vec3 pos) {
          if (uDimMode < 0.5) return 1.0;
          float d = max(length(pos - uCamUni), 1e-6);
          if (uDimMode < 1.5) return clamp((uDimD0 / d) * (uDimD0 / d), 0.02, 1.0); // physical flux
          return 1.0 / (1.0 + pow(d / uDimD0, 1.5)); // enhanced but readable
        }
        void main() {
          vColor = aColor * dimFactor(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Magnitude → world size (brighter = bigger), gentle curve.
          float sizeWorld = 0.35 * exp(-0.32 * aMag) * uScale;
          // Subtle per-star twinkle (phase hashed from position).
          float phase = fract(sin(dot(position.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
          vTwinkle = 0.82 + 0.18 * sin(uTime * (1.5 + fract(phase) * 2.0) + phase);
          float dist = -mv.z;
          float mscale = length(vec3(modelViewMatrix[0][0], modelViewMatrix[0][1], modelViewMatrix[0][2]));
          float px = sizeWorld * mscale * uPixelRatio * (700.0 / max(dist, 0.001));
          // Cap pixel size; keep a floor so distant stars stay visible.
          gl_PointSize = clamp(px, 1.0, 64.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vTwinkle;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float core = smoothstep(0.5, 0.0, d);
          float glow = smoothstep(0.5, 0.12, d) * 0.6;
          float a = clamp(core + glow, 0.0, 1.0) * vTwinkle;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  update(_dt: number, t: number) {
    this.material.uniforms.uTime.value = t;
  }

  /** #52: distance dimming — camera position (universe-local pc) + mode 0/1/2. */
  setDimming(camUni: THREE.Vector3, mode: number) {
    this.material.uniforms.uCamUni.value.copy(camUni);
    this.material.uniforms.uDimMode.value = mode;
  }
}

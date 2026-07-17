// Black holes & neutron stars: stylized shaders anchored at REAL coordinates.
// Black holes get an analytic accretion-disk billboard; neutron stars get rotating beams.
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import type { CompactData, CompactObject } from "../data/types";
import { radecToVec, formatDistancePC, esc } from "../util/astro";
import { radialSpriteTexture } from "../util/textures";
import type { Selectable } from "./Selection";

const BH_RADIUS = 0.6; // pc — stylized visual size (not physical)

export class CompactLayer implements Updatable {
  group = new THREE.Group();
  private billboards: THREE.Mesh[] = [];
  private pulsars: { beams: THREE.Group; speed: number }[] = [];
  private app: App;
  objects: CompactObject[] = [];
  positions: THREE.Vector3[] = [];

  constructor(app: App, data: CompactData) {
    this.app = app;
    this.objects = data.objects;
    const glowTex = radialSpriteTexture();
    for (const o of data.objects) {
      const pos = radecToVec(o.ra_h * 15, o.dec_d, o.d_pc);
      this.positions.push(pos);
      const holder = new THREE.Group();
      holder.position.copy(pos);
      if (o.t === "black hole") {
        holder.add(this.makeBlackHole());
      } else {
        holder.add(this.makePulsar(glowTex, o.t === "magnetar"));
      }
      this.group.add(holder);
    }
  }

  private makeBlackHole(): THREE.Object3D {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          // Billboard: cancel model rotation, keep position & scale.
          vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float s = length(vec3(modelMatrix[0][0], modelMatrix[0][1], modelMatrix[0][2]));
          mv.xy += (uv * 2.0 - 1.0) * s;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                     mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        void main() {
          float d = length(vUv);
          if (d > 1.0) discard;
          // Event horizon: pure black core with photon ring.
          float horizon = 0.32;
          float ring = smoothstep(0.05, 0.0, abs(d - horizon * 1.25)) * 2.2;
          // Accretion disk: tilted swirl.
          vec2 p = vec2(vUv.x, vUv.y * 3.2); // fake disk tilt
          float rd = length(p);
          float ang = atan(p.y, p.x);
          float swirl = noise(vec2(ang * 3.0 + rd * 14.0 - uTime * 0.6, rd * 8.0));
          float disk = smoothstep(horizon * 1.15, horizon * 1.7, rd) * smoothstep(1.05, 0.55, rd);
          disk *= 0.55 + 0.75 * swirl;
          // Doppler-ish brightness asymmetry.
          disk *= 1.0 + 0.7 * smoothstep(0.0, 0.8, -vUv.x);
          vec3 diskCol = mix(vec3(1.0, 0.75, 0.35), vec3(1.0, 0.95, 0.85), disk);
          float glow = smoothstep(1.0, horizon, d) * 0.35;
          vec3 col = diskCol * disk + vec3(0.6, 0.75, 1.0) * ring + vec3(1.0, 0.8, 0.5) * glow;
          float a = clamp(disk + ring + glow, 0.0, 1.0);
          if (d < horizon) { col = vec3(0.0); a = 1.0; }
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true, depthWrite: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    m.scale.setScalar(BH_RADIUS);
    m.frustumCulled = false;
    this.billboards.push(m);
    return m;
  }

  private makePulsar(glowTex: THREE.Texture, magnetar: boolean): THREE.Object3D {
    const g = new THREE.Group();
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: magnetar ? 0xffb0c0 : 0xb0d0ff, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sprite.scale.setScalar(magnetar ? 0.35 : 0.22);
    g.add(sprite);
    // Two opposing beam cones that rotate like a lighthouse.
    const beams = new THREE.Group();
    const beamMat = new THREE.MeshBasicMaterial({
      color: magnetar ? 0xff90b8 : 0x90c8ff, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    for (const s of [1, -1]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.8, 12, 1, true), beamMat);
      cone.position.y = s * 0.4;
      cone.rotation.z = s > 0 ? 0 : Math.PI;
      beams.add(cone);
    }
    beams.rotation.z = 0.5; // beam axis tilt
    g.add(beams);
    this.pulsars.push({ beams, speed: magnetar ? 0.6 : 3.5 });
    return g;
  }

  update(dt: number, t: number) {
    for (const b of this.billboards) (b.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    for (const p of this.pulsars) p.beams.rotation.y += dt * p.speed;
  }

  toSelectables(): Selectable[] {
    return this.objects.map((o, i) => ({
      id: `compact-${i}`,
      name: o.n,
      kind: "compact",
      position: this.positions[i],
      radiusWorld: BH_RADIUS,
      describe: () =>
        `<b>${esc(o.n)}</b><br>Type: ${esc(o.t)}<br>Distance: ${formatDistancePC(o.d_pc)}<br>${esc(o.note)}<br><span class="dim">Curated published coordinates</span>`,
    }));
  }
}

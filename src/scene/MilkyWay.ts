// Milky Way: equirect skybox sphere (ESA/Gaia all-sky) + galactic dust plane.
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import { radecToVec } from "../util/astro";
import { radialSpriteTexture, proceduralPlanetTexture } from "../util/textures";

// Galactic center (Sgr A*): RA 266.405°, Dec −29.0078°, distance 8.178 kpc (real values).
export const GALACTIC_CENTER_PC = radecToVec(266.405, -29.0078, 8178);
// North galactic pole: RA 192.86°, Dec +27.13° (J2000) — disk plane normal.
const GALACTIC_NORMAL = radecToVec(192.86, 27.13, 1).normalize();

export class MilkyWay implements Updatable {
  group = new THREE.Group();
  sky!: THREE.Mesh;
  private app: App;
  private skyMat!: THREE.MeshBasicMaterial;

  constructor(app: App) {
    this.app = app;
    // --- Skybox sphere with the fetched equirectangular all-sky image ---
    const tex = new THREE.TextureLoader().load(
      "/textures/milkyway.png",
      undefined,
      undefined,
      () => {
        // Fallback: procedural starry gradient (noted in manifest if fetch failed).
        tex.image = proceduralPlanetTexture(0.62).image;
        tex.needsUpdate = true;
      },
    );
    tex.colorSpace = THREE.SRGBColorSpace;
    // Double-sided + depthTest:false + renderOrder first: the sky NEVER occludes anything —
    // it is always painted as a background, inside or outside the sphere.
    const skyMat = new THREE.MeshBasicMaterial({
      map: tex, side: THREE.DoubleSide, depthWrite: false, depthTest: false, fog: false,
      transparent: true,
    });
    skyMat.color.setScalar(0.82); // slightly dimmed so catalog layers stay readable
    this.skyMat = skyMat;
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1e8, 48, 32), skyMat);
    // Align texture so its galactic center sits at RA 266.4°, Dec −29° (see u↔RA derivation
    // in README; SphereGeometry u=0.5 ↔ RA 0 at rotation 0, texture GC at u≈0.5 → rotate −266.4°).
    this.sky.rotation.y = THREE.MathUtils.degToRad(-266.4);
    this.sky.renderOrder = -100;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    // --- Galactic dust plane: additive sprites distributed in a spiral disk around the GC ---
    this.group.add(this.buildDisk());
    this.group.add(this.buildCoreGlow());
  }

  /**
   * The skybox is the view from INSIDE the galaxy. When the camera travels far outside
   * (tens of kpc), fade it out so the procedural spiral disk becomes the galaxy's visual
   * instead of a washed-out all-sky fog. Near home it stays at full strength.
   */
  update(_dt: number, _t: number) {
    const camDist = this.app.rig.position.length(); // ≈ distance from Sun (universe origin)
    const fade = THREE.MathUtils.smoothstep(camDist, 25000, 60000);
    this.skyMat.opacity = 1 - fade * 0.88; // 1.0 near home → 0.12 at ≥60 kpc
  }

  /** Bright galactic-core glow so the Milky Way's center is obvious from outside. */
  private buildCoreGlow(): THREE.Sprite {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialSpriteTexture("rgba(255,235,200,1)", "rgba(255,235,200,0)"),
      color: 0xffe8c8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    s.position.copy(GALACTIC_CENTER_PC);
    s.scale.setScalar(9000); // ~9 kpc core glow
    return s;
  }

  /** Spiral-disk particle system, centered on the real galactic-center position. */
  private buildDisk(): THREE.Points {
    const N = 7000;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const size = new Float32Array(N);
    // Disk basis: normal = north galactic pole; u axis points GC→Sun projected on disk.
    const n = GALACTIC_NORMAL.clone();
    const u = GALACTIC_CENTER_PC.clone().negate().projectOnPlane(n).normalize(); // GC→Sun in-plane
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    const armCount = 4;
    for (let i = 0; i < N; i++) {
      // Log-spiral arms + scatter; radius up to ~17 kpc so the Sun (8.2 kpc) sits inside.
      const r = 16000 * Math.pow(Math.random(), 0.65);
      const arm = i % armCount;
      const theta =
        (arm / armCount) * Math.PI * 2 +
        Math.log(Math.max(r, 400) / 1500) * 1.05 +
        (Math.random() - 0.5) * (0.55 - 0.25 * (r / 16000));
      const thickness = (Math.random() + Math.random() + Math.random() - 1.5) * 260 * (0.4 + r / 16000);
      const px = Math.cos(theta) * r, py = Math.sin(theta) * r;
      const p = new THREE.Vector3()
        .copy(GALACTIC_CENTER_PC)
        .addScaledVector(u, px)
        .addScaledVector(v, py)
        .addScaledVector(n, thickness);
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      // Color: warm/golden toward center, cooler/blue outside (typical galaxy tint).
      const t = Math.min(1, r / 16000);
      const c = new THREE.Color().lerpColors(new THREE.Color(0xffe0b0), new THREE.Color(0x9db8ff), t);
      const dim = 0.25 + 0.75 * Math.random();
      col[i * 3] = c.r * dim; col[i * 3 + 1] = c.g * dim; col[i * 3 + 2] = c.b * dim;
      size[i] = 450 + Math.random() * 1100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: radialSpriteTexture("rgba(255,255,255,0.55)", "rgba(255,255,255,0)") }, uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        uniform float uPixelRatio;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float px = aSize * uPixelRatio * (700.0 / max(-mv.z, 0.001));
          gl_PointSize = clamp(px, 0.5, 256.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        void main() {
          vec4 s = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor, 1.0) * s * 0.38;
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }
}

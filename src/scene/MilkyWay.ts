// Milky Way: equirect skybox sphere (ESA/Gaia all-sky) + galactic dust plane.
// The skybox is camera-following BACKGROUND at scene level (fixed world radius): it does
// not scale with the universe — only its orientation rides the universe quaternion, so
// yawing/grabbing the universe swings the sky exactly like the catalogs.
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import { radecToVec } from "../util/astro";
import { radialSpriteTexture, proceduralPlanetTexture } from "../util/textures";

// Galactic center (Sgr A*): RA 266.405°, Dec −29.0078°, distance 8.178 kpc (real values).
export const GALACTIC_CENTER_PC = radecToVec(266.405, -29.0078, 8178);
// North galactic pole: RA 192.86°, Dec +27.13° (J2000) — disk plane normal.
const GALACTIC_NORMAL = radecToVec(192.86, 27.13, 1).normalize();

const SKY_RADIUS = 1e6; // world metres — constant at every zoom level
const _camPos = new THREE.Vector3();
const _baseQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(-266.4), 0));

export class MilkyWay implements Updatable {
  group = new THREE.Group();
  sky!: THREE.Mesh;
  private app: App;
  private skyMat!: THREE.MeshBasicMaterial;
  /** Label anchors for the spiral arms, filled by buildDisk() (C10). */
  armAnchors: { name: string; major: boolean; position: THREE.Vector3 }[] = [];

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
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 32), skyMat);
    // Align texture so its galactic center sits at RA 266.4°, Dec −29° (see u↔RA derivation
    // in README; SphereGeometry u=0.5 ↔ RA 0 at rotation 0, texture GC at u≈0.5 → rotate −266.4°).
    this.sky.quaternion.copy(_baseQ);
    this.sky.renderOrder = -100;
    this.sky.frustumCulled = false;
    app.scene.add(this.sky); // scene-level: follows the camera, constant world size

    // --- Galactic dust plane: additive sprites distributed in a spiral disk around the GC ---
    this.group.add(this.buildDisk());
    this.group.add(this.buildCoreGlow());
  }

  /**
   * The skybox is the view from INSIDE the galaxy. When the user travels far outside
   * (tens of kpc from the Sun), fade it out so the procedural spiral disk becomes the
   * galaxy's visual instead of a washed-out all-sky fog. Near home it stays at full
   * strength. Orientation rides the universe; position follows the camera.
   */
  update(_dt: number, _t: number) {
    this.app.camera.getWorldPosition(_camPos);
    this.sky.position.copy(_camPos);
    this.sky.quaternion.copy(this.app.universe.quaternion).multiply(_baseQ);
    const uniDist = this.app.universe.worldToLocal(_camPos.clone()).length(); // pc from the Sun
    // Fade begins ~400 pc out (beyond the local bubble) and the skybox is FULLY
    // transparent by ~3 kpc — it must never read as a "wall" when traveling (C9).
    const fade = THREE.MathUtils.smoothstep(uniDist, 400, 3000);
    this.skyMat.opacity = 1 - fade; // 1.0 near home → 0.0 at ≥3 kpc
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

  /**
   * Spiral-disk particle system, centered on the real galactic-center position.
   *
   * Arm model (C10): published log-spiral fit (Vallée 2017 / Reid+2019):
   *   r(θ) = r_ref · exp((θ − θ_ref) · tan(pitch)),  pitch = 12.8°
   * Two MAJOR arms (Scutum–Centaurus, Perseus) + minor arms (Sagittarius–Carina,
   * Norma–Outer) + the Orion–Cygnus spur. r_ref is each arm's galactocentric
   * radius at the Sun's azimuth (θ = 0 along GC→Sun); the Sun (8.15 kpc) sits on
   * the spur by construction. Major arms carry double the particle weight.
   */
  private buildDisk(): THREE.Points {
    interface ArmDef { name: string; rRef: number; thetaRefDeg: number; weight: number; major: boolean }
    const ARMS: ArmDef[] = [
      { name: "Scutum–Centaurus Arm", rRef: 5000, thetaRefDeg: 30, weight: 1.0, major: true },
      { name: "Perseus Arm", rRef: 10000, thetaRefDeg: -10, weight: 1.0, major: true },
      { name: "Sagittarius–Carina Arm", rRef: 6600, thetaRefDeg: 0, weight: 0.55, major: false },
      { name: "Norma–Outer Arm", rRef: 4300, thetaRefDeg: -30, weight: 0.55, major: false },
      { name: "Orion–Cygnus Spur", rRef: 8150, thetaRefDeg: 0, weight: 0.4, major: false },
    ];
    const PITCH = THREE.MathUtils.degToRad(12.8); // Vallée/Reid mean pitch angle
    const TAN_PITCH = Math.tan(PITCH);
    const R_MIN = 2500, R_MAX = 16000;
    const N_ARMS = 7000, N_BG = 1200;
    const N = N_ARMS + N_BG;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const size = new Float32Array(N);
    // Disk basis: normal = north galactic pole; u axis points GC→Sun projected on disk.
    const n = GALACTIC_NORMAL.clone();
    const u = GALACTIC_CENTER_PC.clone().negate().projectOnPlane(n).normalize(); // GC→Sun in-plane
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    const warm = new THREE.Color(0xffe0b0), cool = new THREE.Color(0x9db8ff);
    const c = new THREE.Color();
    const place = (i: number, r: number, theta: number, dimScale: number) => {
      const thickness = (Math.random() + Math.random() + Math.random() - 1.5) * 260 * (0.4 + r / 16000);
      const p = new THREE.Vector3()
        .copy(GALACTIC_CENTER_PC)
        .addScaledVector(u, Math.cos(theta) * r)
        .addScaledVector(v, Math.sin(theta) * r)
        .addScaledVector(n, thickness);
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      // Color: warm/golden toward center, cooler/blue outside (typical galaxy tint).
      const t = Math.min(1, r / 16000);
      c.lerpColors(warm, cool, t);
      const dim = (0.25 + 0.75 * Math.random()) * dimScale;
      col[i * 3] = c.r * dim; col[i * 3 + 1] = c.g * dim; col[i * 3 + 2] = c.b * dim;
      size[i] = 450 + Math.random() * 1100;
    };
    let i = 0;
    for (const arm of ARMS) {
      // Particle count proportional to arm weight; majors denser.
      const count = Math.round((N_ARMS * arm.weight) / ARMS.reduce((s, a) => s + a.weight, 0));
      const thetaRef = THREE.MathUtils.degToRad(arm.thetaRefDeg);
      for (let k = 0; k < count && i < N_ARMS; k++, i++) {
        // Sample radius log-uniformly so inner arms don't crowd out.
        const r = R_MIN * Math.pow(R_MAX / R_MIN, Math.random());
        // Log-spiral azimuth for this radius, plus a Gaussian-ish scatter that
        // widens slightly with radius (arms get fluffier outward).
        const theta =
          thetaRef + Math.log(r / arm.rRef) / TAN_PITCH +
          (Math.random() + Math.random() + Math.random() - 1.5) * (0.16 + 0.1 * (r / 16000));
        place(i, r, theta, arm.major ? 1.0 : 0.72);
      }
      // Label anchor: on the arm near the solar circle so labels sit inside the view.
      const rLab = arm.name.startsWith("Orion") ? 8150 : THREE.MathUtils.clamp(arm.rRef, 6000, 10500);
      const thetaLab = thetaRef + Math.log(rLab / arm.rRef) / TAN_PITCH;
      this.armAnchors.push({
        name: arm.name,
        major: arm.major,
        position: new THREE.Vector3()
          .copy(GALACTIC_CENTER_PC)
          .addScaledVector(u, Math.cos(thetaLab) * rLab)
          .addScaledVector(v, Math.sin(thetaLab) * rLab),
      });
    }
    // Smooth background disk underlay so the galaxy reads as a whole between arms.
    for (; i < N; i++) {
      const r = 16000 * Math.pow(Math.random(), 0.65);
      place(i, r, Math.random() * Math.PI * 2, 0.35);
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
          float mscale = length(vec3(modelViewMatrix[0][0], modelViewMatrix[0][1], modelViewMatrix[0][2]));
          float px = aSize * mscale * uPixelRatio * (700.0 / max(-mv.z, 0.001));
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

// Solar system: textured planets at TRUE real-time positions (JPL Keplerian elements +
// Kepler solver, see src/data/ephemeris.ts), real axial tilts in the equatorial J2000
// frame (ecliptic tilted 23.44° to the celestial equator), elliptical inclined orbit
// lines, Saturn's ring, Earth day/night shader, and a real-direction Moon
// (Schlyter lunar theory; orbit distance compressed for readability — noted in README).
// The simulation clock defaults to REAL TIME (1 s = 1 s); the Time warp setting scales it.
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import { PLANETS, SUN, KM_PER_AU, type PlanetDef } from "../data/solarSystemData";
import {
  planetEclipticAU, planetOrbitEclipticAU, moonEclipticEarthRadii, planetNodeAxisEcliptic,
  centuriesSinceJ2000, ECLIPTIC_TO_EQUATORIAL_Q,
} from "../data/ephemeris";
import { planetTexture, type TextureKind } from "../util/textureCache";
import { settings, TIME_RATES } from "../ui/Settings";
import { esc } from "../util/astro";
import type { Selectable } from "./Selection";

/** Base world scale for the solar system: 1 AU = 0.02 universe-local units (pc).
 *  Scale-chain audit (A2): stars sit at catalog pc; the Sun sits at the origin;
 *  1 pc = 206,264.8 AU, so Proxima Centauri at 1.302 pc = 268,553 AU lands exactly
 *  on its catalog position. Planet radii use the same pc unit with a user
 *  exaggeration factor (default 800×) so they stay visible next to AU-scale orbits;
 *  the Sun uses a smaller factor (15×) or it would swallow Mercury's orbit — the
 *  exaggeration is display-only, positions are always real. */
export const WORLD_PER_AU = 0.02;
const SUN_SIZE_EXAGG = 15;

const _ecl = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _dir = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

interface PlanetNode {
  def: PlanetDef;
  root: THREE.Group;       // positioned by the ephemeris each frame
  mesh: THREE.Mesh;        // spins about its own pole (+Y)
  tiltGroup: THREE.Group;  // orients +Y to the planet's true pole direction
  orbitLine: THREE.LineLoop;
  radiusWorld: number;
  labelAnchor: THREE.Object3D;
  spinRate: number;        // rad per SIMULATED second (signed)
  nodeAxisEcl: THREE.Vector3; // tilt axis: direction of the orbit's ascending node (ecliptic)
}

export class SolarSystem implements Updatable {
  group = new THREE.Group();
  private app: App;
  private planets: PlanetNode[] = [];
  private sun!: THREE.Mesh;
  private earthShader?: THREE.ShaderMaterial;
  private moonNodes: { mesh: THREE.Mesh; parent: PlanetNode; radiusKm: number }[] = [];
  /** Simulation clock (ms since epoch). Starts at the real current date/time. */
  private simMs = Date.now();
  private orbitsBuiltMs = -Infinity;

  constructor(app: App) {
    this.app = app;
    this.group.name = "solar-system";
    this.buildSun();
    for (const def of PLANETS) this.buildPlanet(def);
    this.applySettings();
    settings.onChange((k) => {
      if (k === "planetSizeExaggeration" || k === "orbitExaggeration" || k === "elevationExaggeration" || k === "orbits") {
        this.applySettings();
      }
    });
    this.update(0, 0); // place everything for the real current date before first frame
  }

  /** The simulated date (real time by default). */
  get simDate(): Date { return new Date(this.simMs); }
  get timeRate(): number { return TIME_RATES[Math.round(THREE.MathUtils.clamp(settings.get("timeWarp"), 0, TIME_RATES.length - 1))]; }

  private texDir = "/textures/planets/";

  /** Every texture this system uses — preloaded at boot (#43). */
  textureManifest(): { url: string; hue: number; kind?: TextureKind }[] {
    const defs: { url: string; hue: number; kind?: TextureKind }[] = [
      { url: this.texDir + SUN.texture, hue: SUN.fallbackHue },
    ];
    for (const def of PLANETS) {
      defs.push({ url: this.texDir + def.texture, hue: def.fallbackHue });
      if (def.bump) defs.push({ url: this.texDir + def.bump, hue: def.fallbackHue, kind: "data" });
      if (def.night) defs.push({ url: this.texDir + def.night, hue: 0.6 });
      if (def.ring) defs.push({ url: this.texDir + def.ring.texture, hue: 0.1 });
      for (const m of def.moons ?? []) {
        defs.push({ url: this.texDir + m.texture, hue: 0.1 });
        defs.push({ url: this.texDir + m.texture, hue: 0.1, kind: "data" });
      }
    }
    return defs;
  }

  private buildSun() {
    const tex = planetTexture(this.texDir + SUN.texture, SUN.fallbackHue);
    const r = this.sunRadiusWorld();
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: false, opacity: 1 });
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), mat);
    this.sun.name = "Sun";
    this.group.add(this.sun);
    const light = new THREE.PointLight(0xfff5e0, 2.2, 0, 0);
    this.group.add(light);
    this.group.add(new THREE.AmbientLight(0x334455, 0.55));
  }

  private sunRadiusWorld(): number {
    return (SUN.radiusKm / KM_PER_AU) * WORLD_PER_AU * SUN_SIZE_EXAGG;
  }

  private planetRadiusWorld(def: PlanetDef): number {
    return (def.radiusKm / KM_PER_AU) * WORLD_PER_AU * settings.get("planetSizeExaggeration");
  }

  private buildPlanet(def: PlanetDef) {
    const root = new THREE.Group();
    this.group.add(root);

    const tiltGroup = new THREE.Group();
    root.add(tiltGroup);

    const tex = planetTexture(this.texDir + def.texture, def.fallbackHue);
    let mesh: THREE.Mesh;
    if (def.name === "Earth") {
      mesh = this.buildEarth(tex, def);
    } else {
      // Explicitly opaque: a planet must never render transparent (#44).
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, transparent: false, opacity: 1 });
      if (def.bump) {
        mat.bumpMap = planetTexture(this.texDir + def.bump, def.fallbackHue, "data");
      }
      mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), mat);
    }
    mesh.name = def.name;
    tiltGroup.add(mesh);

    // Saturn's ring (real inner/outer radii).
    if (def.ring) {
      const ringTex = planetTexture(this.texDir + def.ring.texture, 0.1);
      const inner = def.ring.innerKm / def.radiusKm;
      const outer = def.ring.outerKm / def.radiusKm;
      const ringGeo = new THREE.RingGeometry(inner, outer, 96, 1);
      const uv = ringGeo.getAttribute("uv") as THREE.BufferAttribute;
      const posA = ringGeo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        const x = posA.getX(i), y = posA.getY(i);
        const r = Math.sqrt(x * x + y * y);
        uv.setXY(i, (r - inner) / (outer - inner), 0.5);
      }
      const ringMat = new THREE.MeshBasicMaterial({
        map: ringTex, side: THREE.DoubleSide, transparent: true, depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      mesh.add(ring); // inherits planet radius scale
    }

    const node: PlanetNode = {
      def, root, mesh, tiltGroup,
      orbitLine: null as unknown as THREE.LineLoop,
      radiusWorld: 0,
      labelAnchor: new THREE.Object3D(),
      spinRate: (Math.PI * 2) / (def.rotationHours * 3600) * (def.rotationHours < 0 ? -1 : 1),
      nodeAxisEcl: new THREE.Vector3(),
    };
    tiltGroup.add(node.labelAnchor); // not the spinning mesh — labels must not whirl

    // Orbit line (rebuilt from the real elements as the date changes).
    node.orbitLine = new THREE.LineLoop(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x4a6a9a, transparent: true, opacity: 0.45 }),
    );
    node.orbitLine.frustumCulled = false;
    this.group.add(node.orbitLine);

    // Moon(s): real direction from the parent planet (Schlyter theory), orbit
    // distance compressed only for readability (never inside the planet mesh).
    if (def.moons) {
      for (const m of def.moons) {
        const moonTex = planetTexture(this.texDir + m.texture, 0.1);
        const moonMat = new THREE.MeshStandardMaterial({ map: moonTex, roughness: 1, metalness: 0, transparent: false, opacity: 1 });
        moonMat.bumpMap = planetTexture(this.texDir + m.texture, 0.1, "data");
        const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), moonMat);
        moonMesh.name = m.name;
        root.add(moonMesh);
        this.moonNodes.push({ mesh: moonMesh, parent: node, radiusKm: m.radiusKm });
      }
    }

    this.planets.push(node);
  }

  /** Earth: custom day/night mixing shader (night lights appear on the dark side). */
  private buildEarth(dayTex: THREE.Texture, def: PlanetDef): THREE.Mesh {
    const nightTex = planetTexture(this.texDir + (def.night ?? ""), 0.6);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uDay: { value: dayTex },
        uNight: { value: nightTex },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormalW;
        void main() {
          vUv = uv;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uDay;
        uniform sampler2D uNight;
        uniform vec3 uSunDir;
        varying vec2 vUv;
        varying vec3 vNormalW;
        void main() {
          vec3 day = texture2D(uDay, vUv).rgb;
          vec3 night = texture2D(uNight, vUv).rgb;
          float ndl = dot(normalize(vNormalW), normalize(uSunDir));
          float dayMix = smoothstep(-0.08, 0.28, ndl);
          vec3 col = day * max(ndl, 0.06) * 1.15 * dayMix + night * 1.6 * (1.0 - dayMix);
          float rim = pow(1.0 - abs(ndl), 3.0) * 0.15;
          col += vec3(0.3, 0.5, 1.0) * rim * dayMix;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.earthShader = mat;
    return new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), mat);
  }

  /** Re-apply scale settings (planet size / orbit distance / elevation / orbit lines). */
  applySettings() {
    const sizeEx = settings.get("planetSizeExaggeration");
    const elev = settings.get("elevationExaggeration");
    const showOrbits = settings.get("orbits");
    this.sun.scale.setScalar(this.sunRadiusWorld());
    for (const p of this.planets) {
      p.radiusWorld = this.planetRadiusWorld(p.def);
      p.mesh.scale.setScalar(p.radiusWorld);
      p.orbitLine.visible = showOrbits;
      const mat = p.mesh.material as THREE.MeshStandardMaterial;
      if (mat && "bumpScale" in mat && mat.bumpMap) {
        mat.bumpScale = elev * p.radiusWorld * 0.03;
      }
      p.labelAnchor.position.set(0, 1.6 * p.radiusWorld, 0);
    }
    for (const m of this.moonNodes) {
      m.mesh.scale.setScalar((m.radiusKm / KM_PER_AU) * WORLD_PER_AU * sizeEx);
      const mm = m.mesh.material as THREE.MeshStandardMaterial;
      mm.bumpScale = elev * 0.05;
    }
    this.orbitsBuiltMs = -Infinity; // force orbit-line rebuild at the new scale
  }

  /** Rebuild one planet's orbit line from the real elements (ecliptic → equatorial). */
  private rebuildOrbit(p: PlanetNode, T: number) {
    const ex = settings.get("orbitExaggeration");
    const pts = planetOrbitEclipticAU(p.def.name, T, 240);
    const arr = new Float32Array(pts.length * 3);
    pts.forEach((pt, i) => {
      pt.multiplyScalar(WORLD_PER_AU * ex).applyQuaternion(ECLIPTIC_TO_EQUATORIAL_Q);
      arr[i * 3] = pt.x; arr[i * 3 + 1] = pt.y; arr[i * 3 + 2] = pt.z;
    });
    p.orbitLine.geometry.dispose();
    p.orbitLine.geometry = new THREE.BufferGeometry();
    p.orbitLine.geometry.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  }

  getPlanetObject(name: string): THREE.Object3D | undefined {
    if (name === "sun") return this.sun;
    return this.planets.find((p) => p.def.name.toLowerCase() === name.toLowerCase())?.mesh;
  }

  /** Non-spinning anchor for orbiters (tilt group: oriented, but does not rotate with
   *  the planet's sidereal spin), plus the planet's current world radius. */
  getPlanetOrbitAnchor(name: string): { anchor: THREE.Object3D; radiusWorld: number } | undefined {
    const p = this.planets.find((x) => x.def.name.toLowerCase() === name.toLowerCase());
    return p ? { anchor: p.tiltGroup, radiusWorld: p.radiusWorld } : undefined;
  }

  getLabelAnchors(): { name: string; object: THREE.Object3D }[] {
    const out: { name: string; object: THREE.Object3D }[] = [{ name: "Sun", object: this.sun }];
    for (const p of this.planets) out.push({ name: p.def.name, object: p.labelAnchor });
    return out;
  }

  toSelectables(): Selectable[] {
    const items: Selectable[] = [{
      id: "sun", name: "Sun", kind: "star", object: this.sun,
      radiusWorld: this.sunRadiusWorld(), solid: true,
      describe: () => `<b>Sun</b><br>G-type main-sequence star<br>Radius: 695,700 km<br><span class="dim">NASA fact sheet</span>`,
    }];
    for (const p of this.planets) {
      items.push({
        id: `planet-${p.def.name}`, name: p.def.name, kind: "planet", object: p.mesh,
        radiusWorld: p.radiusWorld, solid: true,
        describe: () =>
          `<b>${esc(p.def.name)}</b><br>Radius: ${p.def.radiusKm.toLocaleString()} km<br>` +
          `Semi-major axis: ${p.def.semiMajorAU} AU<br>Axial tilt: ${p.def.tiltDeg}°<br>` +
          `Rotation period: ${p.def.rotationHours} h<br>Orbital period: ${p.def.orbitDays.toLocaleString()} d<br>` +
          `<span class="dim">NASA Planetary Fact Sheet · live JPL Keplerian position</span>`,
      });
    }
    for (const m of this.moonNodes) {
      items.push({
        id: `moon-${m.mesh.name}`, name: m.mesh.name, kind: "moon", object: m.mesh,
        radiusWorld: m.mesh.getWorldScale(new THREE.Vector3()).x, solid: true,
        describe: () => `<b>${esc(m.mesh.name)}</b><br>Radius: ${m.radiusKm.toLocaleString()} km<br>Semi-major axis: 384,400 km<br><span class="dim">NASA fact sheet · live position (Schlyter)</span>`,
      });
    }
    return items;
  }

  update(dt: number, _t: number) {
    // Simulation clock: real time by default; Time warp setting scales it.
    this.simMs += dt * 1000 * this.timeRate;
    const T = centuriesSinceJ2000(this.simMs);
    const ex = settings.get("orbitExaggeration");

    for (const p of this.planets) {
      // True heliocentric position: ecliptic J2000 (AU) → equatorial pc (museum scale).
      planetEclipticAU(p.def.name, T, _ecl);
      _ecl.multiplyScalar(WORLD_PER_AU * ex).applyQuaternion(ECLIPTIC_TO_EQUATORIAL_Q);
      p.root.position.copy(_ecl);

      // True pole orientation: ecliptic north tilted by tiltDeg about the orbit's
      // ascending-node axis, then ecliptic→equatorial. (Approximation noted in README.)
      planetNodeAxisEcliptic(p.def.name, T, p.nodeAxisEcl);
      _pole.copy(Z_AXIS).applyAxisAngle(p.nodeAxisEcl, THREE.MathUtils.degToRad(p.def.tiltDeg));
      _pole.applyQuaternion(ECLIPTIC_TO_EQUATORIAL_Q).normalize();
      p.tiltGroup.quaternion.setFromUnitVectors(Y_AXIS, _pole);
      // Sidereal spin about the pole, at the simulated rate.
      p.mesh.rotation.y += p.spinRate * dt * this.timeRate;
    }

    // Moon: real geocentric direction (ecliptic → equatorial). Distance is the real
    // 384,400 km (scaled like the orbits), floored ONLY by surface clearance of the
    // exaggerated planet + moon meshes — previously floored at 6 parent radii, which
    // with the 800× planet-size exaggeration flung the Moon ~80× too far out.
    // The mesh is a CHILD of the planet root, so its local position is just dir×dist —
    // adding parent.root.position here double-counted Earth's orbit and parked the
    // Moon at ~2 AU (#45).
    moonEclipticEarthRadii(this.simMs, _dir);
    _dir.applyQuaternion(ECLIPTIC_TO_EQUATORIAL_Q).normalize();
    for (const m of this.moonNodes) {
      const realDist = (384400 / KM_PER_AU) * WORLD_PER_AU * ex;
      const moonR = m.mesh.scale.x; // rendered radius (size-exaggerated like the planets)
      const clearance = (m.parent.radiusWorld + moonR) * 1.25;
      const dist = Math.max(realDist, clearance);
      m.mesh.position.copy(_dir).multiplyScalar(dist);
    }

    // Orbit lines follow the slowly-changing elements (rebuild at most every 20 sim-days).
    if (this.simMs - this.orbitsBuiltMs > 20 * 86400000) {
      this.orbitsBuiltMs = this.simMs;
      for (const p of this.planets) this.rebuildOrbit(p, T);
    }

    this.sun.rotation.y += dt * 0.05;
    // Earth shader sun direction.
    if (this.earthShader) {
      const earth = this.getPlanetObject("earth")!;
      const ew = earth.getWorldPosition(new THREE.Vector3());
      const sw = this.sun.getWorldPosition(new THREE.Vector3());
      this.earthShader.uniforms.uSunDir.value.copy(sw.sub(ew).normalize());
    }
  }
}

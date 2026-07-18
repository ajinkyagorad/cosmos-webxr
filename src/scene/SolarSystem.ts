// Solar system: textured planets with real axial tilts, orbit lines, Saturn's ring,
// Earth day/night shader, moon, bump with elevation exaggeration, and scale management.
// Real constants come from src/data/solarSystemData.ts (NASA fact sheets).
import * as THREE from "three";
import type { Updatable, App } from "../core/App";
import { PLANETS, SUN, KM_PER_AU, type PlanetDef } from "../data/solarSystemData";
import { loadTextureWithFallback, proceduralPlanetTexture } from "../util/textures";
import { settings } from "../ui/Settings";
import { esc } from "../util/astro";
import type { Selectable } from "./Selection";

/** Base world scale for the solar system: 1 AU = 0.02 world units (1 world unit = 1 pc
 *  in the galactic frame, so this is already an inherent scale separation — by design). */
export const WORLD_PER_AU = 0.02;
const SUN_SIZE_EXAGG = 15; // Sun radius exaggeration (separate, else it swallows Mercury)
const SIM_HOURS_PER_SEC = 36; // animation clock: 1 real second = 1.5 days

interface PlanetNode {
  def: PlanetDef;
  pivot: THREE.Group;      // orbits the sun
  mesh: THREE.Mesh;        // spins
  tiltGroup: THREE.Group;
  orbitLine: THREE.LineLoop;
  radiusWorld: number;
  orbitWorld: number;
  labelAnchor: THREE.Object3D;
  spinSign: number;
}

export class SolarSystem implements Updatable {
  group = new THREE.Group();
  private app: App;
  private planets: PlanetNode[] = [];
  private sun!: THREE.Mesh;
  private earthShader?: THREE.ShaderMaterial;
  private moonNodes: { mesh: THREE.Mesh; pivot: THREE.Group; def: PlanetDef; radiusKm: number }[] = [];

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
  }

  private texDir = "/textures/planets/";

  private buildSun() {
    const tex = loadTextureWithFallback(this.texDir + SUN.texture, () => proceduralPlanetTexture(SUN.fallbackHue));
    const r = this.sunRadiusWorld();
    const mat = new THREE.MeshBasicMaterial({ map: tex });
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

  private orbitWorld(def: PlanetDef): number {
    return def.semiMajorAU * WORLD_PER_AU * settings.get("orbitExaggeration");
  }

  private buildPlanet(def: PlanetDef) {
    const pivot = new THREE.Group();
    pivot.rotation.y = Math.random() * Math.PI * 2; // arbitrary epoch phase
    this.group.add(pivot);

    const orbitGroup = new THREE.Group();
    pivot.add(orbitGroup);

    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.z = THREE.MathUtils.degToRad(def.tiltDeg); // real axial tilt
    orbitGroup.add(tiltGroup);

    const tex = loadTextureWithFallback(this.texDir + def.texture, () => proceduralPlanetTexture(def.fallbackHue));
    let mesh: THREE.Mesh;
    if (def.name === "Earth") {
      mesh = this.buildEarth(tex, def);
    } else {
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
      if (def.bump) {
        mat.bumpMap = loadTextureWithFallback(this.texDir + def.bump, () => proceduralPlanetTexture(def.fallbackHue));
        (mat.bumpMap as THREE.Texture).colorSpace = THREE.NoColorSpace;
      }
      mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), mat);
    }
    mesh.name = def.name;
    tiltGroup.add(mesh);

    // Saturn's ring (real inner/outer radii).
    if (def.ring) {
      const ringTex = loadTextureWithFallback(this.texDir + def.ring.texture, () => proceduralPlanetTexture(0.1));
      const inner = def.ring.innerKm / def.radiusKm;
      const outer = def.ring.outerKm / def.radiusKm;
      const ringGeo = new THREE.RingGeometry(inner, outer, 96, 1);
      // Remap UVs radially so the strip texture wraps correctly.
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

    // Moon(s)
    if (def.moons) {
      for (const m of def.moons) {
        const moonPivot = new THREE.Group();
        mesh.add(moonPivot); // orbits with planet spin frame (simplified)
        const moonTex = loadTextureWithFallback(this.texDir + m.texture, () => proceduralPlanetTexture(0.1));
        const moonMat = new THREE.MeshStandardMaterial({ map: moonTex, roughness: 1, metalness: 0 });
        moonMat.bumpMap = moonTex;
        (moonMat.bumpMap as THREE.Texture).colorSpace = THREE.NoColorSpace;
        const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), moonMat);
        moonMesh.name = m.name;
        moonPivot.add(moonMesh);
        this.moonNodes.push({ mesh: moonMesh, pivot: moonPivot, def, radiusKm: m.radiusKm });
      }
    }

    // Orbit line
    const seg = 128;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const orbitLine = new THREE.LineLoop(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0x4a6a9a, transparent: true, opacity: 0.45 }),
    );
    this.group.add(orbitLine);

    const labelAnchor = new THREE.Object3D();
    labelAnchor.position.set(0, 1.3, 0);
    mesh.add(labelAnchor);

    this.planets.push({
      def, pivot, mesh, tiltGroup, orbitLine, labelAnchor,
      radiusWorld: 0, orbitWorld: 0,
      spinSign: def.rotationHours < 0 ? -1 : 1,
    });
  }

  /** Earth: custom day/night mixing shader (night lights appear on the dark side). */
  private buildEarth(dayTex: THREE.Texture, def: PlanetDef): THREE.Mesh {
    const nightTex = loadTextureWithFallback(this.texDir + (def.night ?? ""), () => proceduralPlanetTexture(0.6));
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
          // Simple limb darkening/atmosphere rim.
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
      p.orbitWorld = this.orbitWorld(p.def);
      p.mesh.scale.setScalar(p.radiusWorld);
      p.mesh.position.set(0, 0, 0);
      p.tiltGroup.position.set(p.orbitWorld, 0, 0);
      p.orbitLine.scale.setScalar(p.orbitWorld);
      p.orbitLine.visible = showOrbits;
      const mat = p.mesh.material as THREE.MeshStandardMaterial;
      if (mat && "bumpScale" in mat && mat.bumpMap) {
        mat.bumpScale = elev * p.radiusWorld * 0.03;
      }
      p.labelAnchor.position.set(0, 1.6, 0);
    }
    for (const m of this.moonNodes) {
      // Moon lives in planet-mesh local space (1 local unit = planet radius).
      // Orbit radius: 12 parent radii (compressed from real ~60 for readability).
      m.mesh.position.set(12, 0, 0);
      m.mesh.scale.setScalar(m.radiusKm / m.def.radiusKm); // real radius ratio
      const mm = m.mesh.material as THREE.MeshStandardMaterial;
      mm.bumpScale = elev * 0.05;
    }
  }

  getPlanetObject(name: string): THREE.Object3D | undefined {
    if (name === "sun") return this.sun;
    return this.planets.find((p) => p.def.name.toLowerCase() === name.toLowerCase())?.mesh;
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
          `<span class="dim">NASA Planetary Fact Sheet</span>`,
      });
    }
    for (const m of this.moonNodes) {
      items.push({
        id: `moon-${m.mesh.name}`, name: m.mesh.name, kind: "moon", object: m.mesh,
        radiusWorld: m.mesh.getWorldScale(new THREE.Vector3()).x, solid: true,
        describe: () => `<b>${esc(m.mesh.name)}</b><br>Radius: ${m.radiusKm.toLocaleString()} km<br>Semi-major axis: 384,400 km<br><span class="dim">NASA fact sheet</span>`,
      });
    }
    return items;
  }

  update(dt: number, _t: number) {
    // Orbits: rate from real orbital periods at SIM_HOURS_PER_SEC.
    for (const p of this.planets) {
      p.pivot.rotation.y += ((Math.PI * 2) / (p.def.orbitDays * 24)) * SIM_HOURS_PER_SEC * dt;
      p.mesh.rotation.y += p.spinSign * 0.25 * dt; // gentle visual spin (not to scale)
    }
    for (const m of this.moonNodes) m.pivot.rotation.y += dt * 0.3;
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

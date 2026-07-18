// Space missions/probes: sprites + labels at real-world-based positions.
// Earth-orbit & planetary missions are parented to their host bodies (they follow the planets);
// heliocentric/interstellar probes sit in the solar-system frame at published distances.
import * as THREE from "three";
import type { MissionData } from "../data/types";
import { radecToVec, esc, AU_IN_PC } from "../util/astro";
import { probeIconTexture } from "../util/textures";
import { WORLD_PER_AU, type SolarSystem } from "./SolarSystem";
import { settings } from "../ui/Settings";
import { KM_PER_AU, PLANETS } from "../data/solarSystemData";
import type { Selectable } from "./Selection";

export class MissionsLayer {
  group = new THREE.Group();
  private heliocentric: { sprite: THREE.Sprite; distAu: number; raH: number; decD: number }[] = [];

  constructor(solar: SolarSystem, data: MissionData) {
    this.group.name = "missions";
    const tex = probeIconTexture(); // crisp icon — probes are not stars, no glow
    const v = new THREE.Vector3();

    for (const m of data.missions) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: 0xd8ecff, transparent: true, depthWrite: false,
      }));
      sprite.name = m.n;

      if (m.host === "earth" && m.alt_km) {
        // Low Earth orbit: parent to the non-spinning orbit anchor (world units).
        const orb = solar.getPlanetOrbitAnchor("earth");
        if (orb) {
          sprite.position.set((1 + m.alt_km / 6371) * orb.radiusWorld, 0.15 * orb.radiusWorld, 0);
          sprite.scale.setScalar(0.35 * orb.radiusWorld);
          orb.anchor.add(sprite);
        }
      } else if (m.host === "l1" || m.host === "l2") {
        // Sun–Earth L1/L2: parent to the orbit anchor, offset along ±sun direction.
        const orb = solar.getPlanetOrbitAnchor("earth");
        if (orb) {
          sprite.position.set(m.host === "l2" ? 3.2 * orb.radiusWorld : -3.2 * orb.radiusWorld, 0.35 * orb.radiusWorld, 0); // stylized offset
          sprite.scale.setScalar(0.4 * orb.radiusWorld);
          orb.anchor.add(sprite);
        }
      } else if (m.host === "mars" || m.host === "jupiter" || m.host === "saturn") {
        const planet = solar.getPlanetObject(m.host);
        const def = PLANETS.find((p) => p.name.toLowerCase() === m.host);
        if (planet && def) {
          if (m.lat !== undefined && m.lon !== undefined) {
            // Surface mission: place on sphere at real lat/lon.
            const lat = THREE.MathUtils.degToRad(m.lat);
            const lon = THREE.MathUtils.degToRad(m.lon);
            sprite.position.set(
              Math.cos(lat) * Math.cos(lon) * 1.02,
              Math.sin(lat) * 1.02,
              Math.cos(lat) * Math.sin(lon) * 1.02,
            );
          } else {
            sprite.position.set(2.2, 0.8, 0); // orbiter marker above planet
          }
          sprite.scale.setScalar(0.3);
          planet.add(sprite);
        }
      } else if (m.host === "sun" && m.dist_au !== undefined && m.ra_h !== undefined && m.dec_d !== undefined) {
        // Heliocentric / interstellar probe: real distance & sky direction, solar frame.
        this.group.add(sprite);
        this.heliocentric.push({ sprite, distAu: m.dist_au, raH: m.ra_h, decD: m.dec_d });
        sprite.scale.setScalar(Math.max(0.001, m.dist_au * WORLD_PER_AU * 0.08));
      }
      sprite.userData.mission = m;
    }
    this.applyScale();
    settings.onChange((k) => { if (k === "orbitExaggeration") this.applyScale(); });
    void v;
  }

  private applyScale() {
    const v = new THREE.Vector3();
    for (const h of this.heliocentric) {
      radecToVec(h.raH * 15, h.decD, h.distAu * WORLD_PER_AU * settings.get("orbitExaggeration"), v);
      h.sprite.position.copy(v);
    }
  }

  getLabelAnchors(): { name: string; object: THREE.Object3D }[] {
    const out: { name: string; object: THREE.Object3D }[] = [];
    this.group.traverse((o) => {
      if (o instanceof THREE.Sprite && o.userData.mission) out.push({ name: o.userData.mission.n, object: o });
    });
    return out;
  }

  toSelectables(): Selectable[] {
    const out: Selectable[] = [];
    this.group.updateMatrixWorld(true);
    this.group.traverse((o) => {
      if (o instanceof THREE.Sprite && o.userData.mission) {
        const m = o.userData.mission as MissionData["missions"][number];
        out.push({
          id: `mission-${m.n}`, name: m.n, kind: "mission", object: o,
          radiusWorld: Math.max(o.scale.x * 0.5, 1e-5),
          describe: () => {
            const rows = [`<b>${esc(m.n)}</b>`, esc(m.note)];
            if (m.agency) rows.push(`Agency: ${esc(m.agency)}`);
            if (m.status) rows.push(`Status: ${esc(m.status)}`);
            rows.push(`<span class="dim">NASA/ESA published mission data (approximate placement)</span>`);
            return rows.join("<br>");
          },
        });
      }
    });
    return out;
  }
}

// re-export for consumers that need the constant
export { AU_IN_PC, KM_PER_AU };

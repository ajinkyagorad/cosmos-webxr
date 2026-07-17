// Cinematic universes layer — FICTIONAL, clearly segregated, off by default.
// A stylized "galaxy far, far away" plus a couple of comic-cosmic waypoints,
// placed in their own far-offset region. Never mixed into the real catalogs.
import * as THREE from "three";
import { radialSpriteTexture } from "../util/textures";
import { esc } from "../util/astro";
import type { Selectable } from "./Selection";

const REGION_OFFSET = new THREE.Vector3(6_000_000, -1_500_000, 6_000_000); // pc — far from everything real

const WORLDS: { n: string; c: number; note: string }[] = [
  { n: "Tatooine", c: 0xe8c47d, note: "Twin-sun desert world (fiction)" },
  { n: "Hoth", c: 0xcfe8ff, note: "Ice planet (fiction)" },
  { n: "Coruscant", c: 0xfff0c8, note: "City-covered world (fiction)" },
  { n: "Naboo", c: 0x9fd8a8, note: "Verdant world (fiction)" },
  { n: "Mustafar", c: 0xff6a3d, note: "Volcanic world (fiction)" },
  { n: "Dagobah", c: 0x7da87d, note: "Swamp world (fiction)" },
  { n: "Bespin", c: 0xffd8a8, note: "Gas giant, Cloud City (fiction)" },
  { n: "Endor", c: 0x8fd8c8, note: "Forest moon (fiction)" },
  { n: "Kashyyyk", c: 0x6a9a5a, note: "Wroshyr-tree world (fiction)" },
  { n: "Geonosis", c: 0xd8a86a, note: "Ringed desert world (fiction)" },
  { n: "Kamino", c: 0x6ab8d8, note: "Ocean world (fiction)" },
  { n: "Jakku", c: 0xe8d8a0, note: "Graveyard-of-empires desert (fiction)" },
  { n: "Mandalore", c: 0xc8b8a8, note: "Warrior world (fiction)" },
  { n: "Exegol", c: 0x8a7dc8, note: "Storm-shrouded hidden world (fiction)" },
  { n: "Alderaan remnant", c: 0xb8c8d8, note: "Asteroid field (fiction)" },
  { n: "Oa", c: 0x6aff9e, note: "Green beacon at the galaxy's heart (fiction)" },
  { n: "Knowhere", c: 0xd8c8ff, note: "Severed-head mining colony (fiction)" },
  { n: "Apokolips", c: 0xff4d4d, note: "Fire-pit world (fiction)" },
  { n: "Krypton remnant", c: 0x9effd8, note: "Shattered world (fiction)" },
];

export class CinematicLayer {
  group = new THREE.Group();
  private anchors: { name: string; object: THREE.Object3D }[] = [];
  private sprites: THREE.Sprite[] = [];

  constructor() {
    this.group.name = "cinematic-universes";
    const glow = radialSpriteTexture();
    // Stylized mini-galaxy: a spiral of fictional worlds ~6 kpc across, tilted.
    const spread = 6000;
    WORLDS.forEach((w, i) => {
      const arm = i % 3;
      const r = 400 + (i / WORLDS.length) * spread;
      const a = (arm / 3) * Math.PI * 2 + r * 0.0011 + Math.sin(i * 7.3) * 0.4;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glow, color: w.c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      s.position.set(
        REGION_OFFSET.x + Math.cos(a) * r,
        REGION_OFFSET.y + Math.sin(i * 3.1) * 500,
        REGION_OFFSET.z + Math.sin(a) * r,
      );
      s.scale.setScalar(220);
      s.userData.world = w;
      this.group.add(s);
      this.sprites.push(s);
      this.anchors.push({ name: `✦ ${w.n}`, object: s });
    });
    this.group.visible = false; // off by default
  }

  getLabelAnchors() { return this.anchors; }

  toSelectables(): Selectable[] {
    return this.sprites.map((s, i) => ({
      id: `cine-${i}`,
      name: `✦ ${WORLDS[i].n}`,
      kind: "cinematic",
      object: s,
      radiusWorld: 220,
      describe: () =>
        `<b>✦ ${esc(WORLDS[i].n)}</b><br>${esc(WORLDS[i].note)}<br><span class="dim">Cinematic universes layer — fictional, not part of the real catalogs</span>`,
    }));
  }
}

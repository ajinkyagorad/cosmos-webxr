// Planet-texture cache + boot preloader (#43/#44).
//
// Every texture is created ONCE per (url, kind) and starts life backed by a
// procedural placeholder image, so materials are valid from the very first
// frame — a planet can never sit in the empty-texture "transparent/unrendered"
// state while its 2k image downloads. The real image swaps in on arrival;
// on failure the placeholder simply stays. "data" kind (bump/normal maps) gets
// a separate cache entry so its linear colorSpace never corrupts the color map.
import * as THREE from "three";
import { proceduralPlanetTexture } from "./textures";

export type TextureKind = "color" | "data";

interface Entry { tex: THREE.Texture; settled: boolean; }
const cache = new Map<string, Entry>();
const waiters = new Set<() => void>();

function settle(entry: Entry) {
  entry.settled = true;
  for (const f of [...waiters]) f();
}

/** Shared texture: procedural placeholder immediately, real image swapped in on load. */
export function planetTexture(url: string, fallbackHue: number, kind: TextureKind = "color"): THREE.Texture {
  const key = `${kind}|${url}`;
  const hit = cache.get(key);
  if (hit) return hit.tex;

  const fb = proceduralPlanetTexture(fallbackHue);
  const tex = new THREE.Texture(fb.image as HTMLCanvasElement);
  tex.colorSpace = kind === "color" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  const entry: Entry = { tex, settled: false };
  cache.set(key, entry);

  new THREE.ImageLoader().load(
    url,
    (img) => {
      tex.image = img;
      tex.needsUpdate = true;
      settle(entry);
    },
    undefined,
    () => settle(entry), // fetch/decode failed → placeholder stays
  );
  return tex;
}

/**
 * Preload a set of planet textures at boot, reporting (done, total) per file so
 * the landing screen can show real progress. Resolves when every requested
 * texture has settled (success OR failure — placeholders keep planets solid).
 */
export function preloadPlanetTextures(
  defs: { url: string; hue: number; kind?: TextureKind }[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const entries = defs.map((def) => {
    const key = `${def.kind ?? "color"}|${def.url}`;
    planetTexture(def.url, def.hue, def.kind ?? "color");
    return cache.get(key)!;
  });
  const report = () => onProgress?.(entries.filter((e) => e.settled).length, entries.length);
  report();
  if (entries.every((e) => e.settled)) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      report();
      if (entries.every((e) => e.settled)) {
        waiters.delete(check);
        resolve();
      }
    };
    waiters.add(check);
  });
}

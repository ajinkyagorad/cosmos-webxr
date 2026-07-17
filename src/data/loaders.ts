// Loads all committed datasets from public/data.
import type {
  StarsMeta, ExoplanetData, DSOData, MissionData, CompactData, Manifest,
} from "./types";

export interface AllData {
  stars: { meta: StarsMeta; buffer: Float32Array };
  exoplanets: ExoplanetData;
  dso: DSOData;
  missions: MissionData;
  compact: CompactData;
  manifest: Manifest | null;
}

async function fetchJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    console.warn(`[data] failed to load ${url}:`, e);
    return null;
  }
}

export async function loadAllData(onProgress?: (msg: string) => void): Promise<AllData> {
  onProgress?.("Loading star catalog (HYG 4.0 / Gaia)…");
  const starsMeta = await fetchJSON<StarsMeta>("/data/stars.json");
  let starsBuffer = new Float32Array(0);
  if (starsMeta) {
    try {
      const res = await fetch("/data/stars.bin");
      starsBuffer = new Float32Array(await res.arrayBuffer());
    } catch (e) {
      console.warn("[data] stars.bin failed:", e);
    }
  }

  onProgress?.("Loading exoplanets (NASA Exoplanet Archive)…");
  const exoplanets = (await fetchJSON<ExoplanetData>("/data/exoplanets.json")) ?? { count: 0, fields: {}, planets: [] } as unknown as ExoplanetData;

  onProgress?.("Loading deep-sky objects (OpenNGC)…");
  const dso = (await fetchJSON<DSOData>("/data/dso.json")) ?? { count: 0, source: "unavailable", objects: [] } as unknown as DSOData;

  onProgress?.("Loading missions & compact objects…");
  const missions = (await fetchJSON<MissionData>("/data/missions.json")) ?? { basis: "", count: 0, missions: [] };
  const compact = (await fetchJSON<CompactData>("/data/compact.json")) ?? { basis: "", count: 0, objects: [] };
  const manifest = await fetchJSON<Manifest>("/data/manifest.json");

  return {
    stars: { meta: starsMeta ?? { count: 0, layout: "", namedCount: 0, names: [] }, buffer: starsBuffer },
    exoplanets, dso, missions, compact, manifest,
  };
}

// Loads all committed datasets from public/data.
import type {
  StarsMeta, ExoplanetData, DSOData, MissionData, CompactData, Manifest,
  DustMeta, BinMeta, GalaxyData, StarNamesData, ConstellationData, LandmarkData,
} from "./types";

export interface AllData {
  stars: { meta: StarsMeta; buffer: Float32Array };
  exoplanets: ExoplanetData;
  dso: DSOData;
  missions: MissionData;
  compact: CompactData;
  manifest: Manifest | null;
  // Milky Way Atlas layers (all optional — app degrades gracefully)
  dust: { meta: DustMeta; buffer: ArrayBuffer } | null;
  cepheids: { meta: BinMeta; buffer: Float32Array } | null;
  globulars: { meta: BinMeta; buffer: Float32Array } | null;
  galaxies: GalaxyData | null;
  starNames: StarNamesData | null;
  constellations: ConstellationData | null;
  landmarks: LandmarkData | null;
  twoMRS: { meta: BinMeta; buffer: Float32Array } | null;
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

async function fetchBin(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.arrayBuffer();
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
    const buf = await fetchBin("/data/stars.bin");
    if (buf) starsBuffer = new Float32Array(buf);
  }

  onProgress?.("Loading exoplanets (NASA Exoplanet Archive)…");
  const exoplanets = (await fetchJSON<ExoplanetData>("/data/exoplanets.json")) ?? { count: 0, fields: {}, planets: [] } as unknown as ExoplanetData;

  onProgress?.("Loading deep-sky objects (OpenNGC)…");
  const dso = (await fetchJSON<DSOData>("/data/dso.json")) ?? { count: 0, source: "unavailable", objects: [] } as unknown as DSOData;

  onProgress?.("Loading missions & compact objects…");
  const missions = (await fetchJSON<MissionData>("/data/missions.json")) ?? { basis: "", count: 0, missions: [] };
  const compact = (await fetchJSON<CompactData>("/data/compact.json")) ?? { basis: "", count: 0, objects: [] };

  onProgress?.("Loading dust, Cepheids, clusters & Local Group…");
  const [dustMeta, dustBuf, cephMeta, cephBuf, gcMeta, gcBuf] = await Promise.all([
    fetchJSON<DustMeta>("/data/dust_meta.json"),
    fetchBin("/data/dust.bin"),
    fetchJSON<BinMeta>("/data/cepheids.json"),
    fetchBin("/data/cepheids.bin"),
    fetchJSON<BinMeta>("/data/globulars.json"),
    fetchBin("/data/globulars.bin"),
  ]);
  const [galaxies, starNames, constellations, landmarks, manifest] = await Promise.all([
    fetchJSON<GalaxyData>("/data/galaxies.json"),
    fetchJSON<StarNamesData>("/data/starnames.json"),
    fetchJSON<ConstellationData>("/data/constellations.json"),
    fetchJSON<LandmarkData>("/data/landmarks.json"),
    fetchJSON<Manifest>("/data/manifest.json"),
  ]);
  const [mrsMeta, mrsBuf] = await Promise.all([
    fetchJSON<BinMeta>("/data/2mrs.meta.json"),
    fetchBin("/data/2mrs.bin"),
  ]);

  const dust = dustMeta && dustBuf && dustBuf.byteLength >= dustMeta.shape_zyx[0] * dustMeta.shape_zyx[1] * dustMeta.shape_zyx[2]
    ? { meta: dustMeta, buffer: dustBuf } : null;
  const cepheids = cephMeta && cephBuf && cephBuf.byteLength >= cephMeta.count * 16
    ? { meta: cephMeta, buffer: new Float32Array(cephBuf) } : null;
  const globulars = gcMeta && gcBuf && gcBuf.byteLength >= gcMeta.count * 16
    ? { meta: gcMeta, buffer: new Float32Array(gcBuf) } : null;
  const twoMRS = mrsMeta && mrsBuf && mrsBuf.byteLength >= mrsMeta.count * 16
    ? { meta: mrsMeta, buffer: new Float32Array(mrsBuf) } : null;

  return {
    stars: { meta: starsMeta ?? { count: 0, layout: "", namedCount: 0, names: [] }, buffer: starsBuffer },
    exoplanets, dso, missions, compact, manifest,
    dust, cepheids, globulars, galaxies, starNames, constellations, landmarks, twoMRS,
  };
}

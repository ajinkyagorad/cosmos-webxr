// Shared dataset types (mirrors public/data JSON layouts).

export interface StarsMeta {
  count: number;
  layout: string;
  namedCount: number;
  names: { i: number; n: string; m: number; s: string }[];
}

export interface Exoplanet {
  n: string; h: string; ra: number; dec: number; d: number;
  y: number | null; m: string; r: number | null; bm: number | null;
  p: number | null; st: string | null;
}
export interface ExoplanetData { count: number; planets: Exoplanet[]; }

export interface DSO {
  n: string; t: string; ra: number; dec: number; m: number | null;
  s: number | null; d: number | null; cn: string | null;
}
export interface DSOData { count: number; source: string; objects: DSO[]; }

export interface Mission {
  n: string; cat: string; host: string; alt_km?: number; dist_au?: number;
  ra_h?: number; dec_d?: number; lat?: number; lon?: number; note: string;
  agency?: string; status?: string;
}
export interface MissionData { basis: string; count: number; missions: Mission[]; }

export interface CompactObject {
  n: string; t: string; ra_h: number; dec_d: number; d_pc: number; note: string;
}
export interface CompactData { basis: string; count: number; objects: CompactObject[]; }

export interface ManifestDataset {
  name: string; source?: string; url?: string | null; retrieved?: string;
  count?: number; sizeBytes?: number; license?: string; status?: string;
  note?: string; file?: string;
}
export interface Manifest { generated: string; note: string; datasets: ManifestDataset[]; }

/* ---- Milky Way Atlas datasets (scripts/fetch-extra.mjs + fetch_dust.py) ----
   All point data is equatorial J2000 Cartesian pc (Sun at origin), like the rest
   of the app. The dust cube is the exception: it stays galactic and is mounted
   under a rotated group (see GALACTIC_TO_EQUATORIAL_Q in util/astro.ts). */

export interface DustMeta {
  source: string; url: string;
  shape_zyx: [number, number, number];
  extent_pc: { x: [number, number]; y: [number, number]; z: [number, number] };
  frame: string; encoding: string; vmin: number; vmax: number; units: string;
}
export interface BinMeta { count: number; layout: string; source?: string; note?: string; }

export interface GalaxyEntry {
  name: string; pos: [number, number, number]; MV: number; rh: number;
  host: string; ell: number; pa: number;
}
export interface GalaxyData { count: number; galaxies: GalaxyEntry[]; }

export interface StarNameEntry { n: string; p: [number, number, number]; m: number; }
export interface StarNamesData { count: number; stars: StarNameEntry[]; }

export interface ConstellationData {
  count: number; constellations: number;
  segs: [[number, number, number], [number, number, number]][];
  names: { name: string; pos: [number, number, number] }[];
}

export interface Landmark { name: string; pos: [number, number, number]; desc: string; cat: "cloud" | "mw" | "lg"; }
export interface LandmarkData { count: number; landmarks: Landmark[]; }

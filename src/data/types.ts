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

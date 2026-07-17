/**
 * fetch-data.mjs — downloads REAL astronomy datasets into public/data and public/textures.
 * Everything written here is traceable: manifest.json records source, URL, retrieval date,
 * object counts and license notes for every dataset. No fabricated coordinates.
 */
import { writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const DATA = join(ROOT, "public", "data");
const TEX = join(ROOT, "public", "textures");
const TEX_PLANETS = join(TEX, "planets");
for (const d of [DATA, TEX, TEX_PLANETS]) mkdirSync(d, { recursive: true });

const retrieved = new Date().toISOString().slice(0, 10);
const manifest = {
  generated: retrieved,
  note: "All datasets are real, fetched from the sources below or documented well-known catalog values. Fallbacks are explicitly marked.",
  datasets: [],
};
const report = (entry) => {
  manifest.datasets.push(entry);
  console.log(`  ✔ ${entry.name}: ${entry.count ?? entry.sizeBytes ?? ""}`);
};

/* ---------------- helpers ---------------- */
async function download(url, { retries = 2, timeoutMs = 60000 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { "User-Agent": "cosmos-webxr-data-fetch/1.0 (educational)" },
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      console.warn(`  … retry ${i + 1} for ${url} (${e.message})`);
    }
  }
  throw lastErr;
}
function magic(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return "jpeg";
  if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.length > 2 && ((buf[0] === 0x49 && buf[1] === 0x49) || (buf[0] === 0x4d && buf[1] === 0x4d))) return "tiff";
  return "other";
}
/** Minimal CSV parser handling quoted fields. */
function parseCSV(text, delimiter = ",") {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const D2R = Math.PI / 180;

/* ================= 1. STARS — HYG v4.0 (Gaia-derived) ================= */
async function fetchStars() {
  console.log("Stars: HYG v4.0…");
  const url = "https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v40.csv.gz";
  const gz = await download(url, { timeoutMs: 180000 });
  const csv = gunzipSync(gz).toString("utf8");
  const rows = parseCSV(csv);
  const head = rows[0];
  const col = (n) => head.indexOf(n);
  const iRA = col("ra"), iDec = col("dec"), iDist = col("dist"), iMag = col("mag"),
    iCI = col("ci"), iName = col("proper"), iSpect = col("spect");
  const kept = []; // {x,y,z,mag,ci,name?}
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length <= Math.max(iRA, iDec, iDist, iMag)) continue;
    const raH = parseFloat(row[iRA]); // hours
    const dec = parseFloat(row[iDec]); // deg
    const dist = parseFloat(row[iDist]); // pc
    const mag = parseFloat(row[iMag]);
    if (!isFinite(raH) || !isFinite(dec) || !isFinite(dist) || !isFinite(mag) || dist <= 0) continue;
    if (!((dist <= 500 && mag <= 9) || mag <= 6.5)) continue;
    const ra = raH * 15 * D2R;
    const cd = Math.cos(dec * D2R);
    const ci = parseFloat(row[iCI]);
    kept.push({
      x: dist * cd * Math.cos(ra),
      y: dist * cd * Math.sin(ra),
      z: dist * Math.sin(dec * D2R),
      mag, ci: isFinite(ci) ? ci : 0.6,
      name: row[iName] || "", spect: row[iSpect] || "",
    });
  }
  // interleaved Float32: x,y,z,mag,ci
  const arr = new Float32Array(kept.length * 5);
  const names = [];
  kept.forEach((s, i) => {
    arr[i * 5] = s.x; arr[i * 5 + 1] = s.y; arr[i * 5 + 2] = s.z;
    arr[i * 5 + 3] = s.mag; arr[i * 5 + 4] = s.ci;
    if (s.name) names.push({ i, n: s.name, m: +s.mag.toFixed(2), s: s.spect });
  });
  names.sort((a, b) => a.m - b.m);
  writeFileSync(join(DATA, "stars.bin"), Buffer.from(arr.buffer));
  writeFileSync(join(DATA, "stars.json"), JSON.stringify({
    count: kept.length,
    layout: "interleaved-float32 [x(pc),y(pc),z(pc),mag,ci] J2000 equatorial, Sun at origin",
    namedCount: names.length,
    names: names.slice(0, 400),
  }));
  report({
    name: "Stars (HYG v4.0, Gaia-derived)",
    source: "AstroNexus HYG-Database v4.0",
    url, retrieved, count: kept.length,
    namedStars: Math.min(names.length, 400),
    filter: "dist <= 500 pc AND mag <= 9, OR mag <= 6.5 (naked eye) at any distance",
    sizeBytes: statSync(join(DATA, "stars.bin")).size,
    license: "HYG database: public domain / CC-BY-SA 4.0 per repo README",
  });
}

/* ================= 2. EXOPLANETS — NASA Exoplanet Archive ================= */
async function fetchExoplanets() {
  console.log("Exoplanets: NASA Exoplanet Archive TAP…");
  const q = "select pl_name,hostname,ra,dec,sy_dist,disc_year,discoverymethod,pl_rade,pl_bmasse,pl_orbper,st_spectype from ps where default_flag=1";
  const url = `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=${encodeURIComponent(q)}&format=csv`;
  const buf = await download(url, { timeoutMs: 120000 });
  const rows = parseCSV(buf.toString("utf8"));
  const head = rows[0];
  const idx = Object.fromEntries(head.map((h, i) => [h, i]));
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const g = (k) => row[idx[k]] ?? "";
    const ra = parseFloat(g("ra")), dec = parseFloat(g("dec")), dist = parseFloat(g("sy_dist"));
    if (!isFinite(ra) || !isFinite(dec) || !isFinite(dist)) continue;
    out.push({
      n: g("pl_name"), h: g("hostname"), ra: +ra.toFixed(5), dec: +dec.toFixed(5), d: +dist.toFixed(2),
      y: g("disc_year") ? +g("disc_year") : null, m: g("discoverymethod"),
      r: g("pl_rade") ? +g("pl_rade") : null,    // Earth radii
      bm: g("pl_bmasse") ? +g("pl_bmasse") : null, // Earth masses
      p: g("pl_orbper") ? +g("pl_orbper") : null,  // days
      st: g("st_spectype") || null,
    });
  }
  writeFileSync(join(DATA, "exoplanets.json"), JSON.stringify({
    fields: { n: "planet name", h: "host star", ra: "deg J2000", dec: "deg J2000", d: "distance pc", y: "discovery year", m: "discovery method", r: "radius (Earth=1)", bm: "mass (Earth=1)", p: "orbital period days", st: "host spectral type" },
    count: out.length, planets: out,
  }));
  report({
    name: "Exoplanets (confirmed, default parameter set)",
    source: "NASA Exoplanet Archive — Planetary Systems (ps) table",
    url, retrieved, count: out.length,
    sizeBytes: statSync(join(DATA, "exoplanets.json")).size,
    license: "NASA Exoplanet Archive: public data, cite archive",
  });
}

/* ================= 3. DEEP-SKY OBJECTS — OpenNGC (fallback: embedded Messier+) ================= */
// Curated distances (light years) for well-known objects. Real published values.
const DSO_DISTANCES = {
  M1: 6500, M8: 4100, M13: 22200, M16: 7000, M17: 5500, M20: 5200, M27: 1360, M31: 2537000,
  M32: 2490000, M33: 2730000, M42: 1344, M44: 610, M45: 444, M51: 23000000, M57: 2300,
  M63: 37000000, M64: 24000000, M65: 35000000, M66: 35000000, M74: 32000000, M77: 60000000,
  M81: 11800000, M82: 11400000, M83: 15000000, M87: 53500000, M97: 2030, M101: 21000000,
  M104: 29000000, M106: 23500000, M108: 46000000, M109: 83500000, M110: 2690000,
  M3: 33900, M4: 7200, M5: 24500, M15: 33000, M22: 10600, M92: 26700,
  M34: 1500, M35: 2800, M36: 4100, M37: 4500, M38: 4200, M41: 2300, M46: 5400, M47: 1600,
  M48: 1500, M50: 3000, M52: 5000, M67: 2700, M93: 3600, M103: 8500,
  M49: 55900000, M58: 63000000, M59: 55000000, M60: 55000000, M61: 52500000,
  M84: 60000000, M85: 60000000, M86: 52000000, M88: 47000000, M89: 50000000, M90: 58700000,
  M91: 63000000, M94: 16000000, M95: 32600000, M96: 31000000, M98: 44400000, M99: 50000000,
  M100: 55000000, M105: 32000000, M78: 1350, M76: 2500, M24: 10000, M11: 6000, M7: 980, M6: 1600,
  NGC869: 7500, NGC884: 7500, NGC104: 13000, NGC5139: 15800, NGC6397: 7800, NGC6752: 13000,
  NGC7009: 3000, NGC7293: 655, NGC6543: 3300, NGC2392: 2900, NGC3242: 1400, NGC6826: 2200,
  NGC5128: 13000000, NGC253: 11400000, NGC891: 30000000, NGC4565: 40000000, NGC7331: 40000000,
  NGC2403: 8000000, NGC2903: 30000000, NGC6946: 22000000, NGC5128b: 13000000,
  NGC3372: 8500, NGC2070: 160000, NGC2237: 5200, NGC2264: 2500, NGC2244: 5200, NGC7000: 2200,
  NGC6960: 2400, NGC7635: 11000, NGC7023: 1300, NGC4755: 6400, NGC3532: 1300, NGC2516: 1300,
  NGC55: 6500000, NGC300: 6100000, NGC7793: 12700000, NGC1365: 56000000, NGC1316: 62000000,
  NGC4038: 45000000, NGC4039: 45000000, NGC4490: 25000000, NGC1068: 47000000, NGC1300: 61000000,
  NGC362: 28000, NGC2362: 4800, NGC604: 2730000, NGC7319: 300000000, NGC1275: 235000000,
};
// Full Messier catalogue fallback (real catalog coordinates, J2000).
// [m, raHours, decDeg, typeCode, mag, distLy|null, commonName]
const MESSIER = [
  [1,5.575,22.017,"SNR",8.4,6500,"Crab Nebula"],[2,21.558,-0.817,"GCl",6.5,33000,""],[3,13.703,28.383,"GCl",6.2,33900,""],
  [4,16.393,-26.533,"GCl",5.9,7200,""],[5,15.31,2.083,"GCl",5.7,24500,""],[6,17.668,-32.217,"OC",4.2,1600,"Butterfly Cluster"],
  [7,17.898,-34.817,"OC",3.3,980,"Ptolemy's Cluster"],[8,18.063,-24.383,"EN",6.0,4100,"Lagoon Nebula"],[9,17.32,-18.517,"GCl",7.9,25800,""],
  [10,16.952,-4.1,"GCl",6.6,14300,""],[11,18.852,-6.267,"OC",5.8,6000,"Wild Duck Cluster"],[12,16.787,-1.95,"GCl",6.7,15700,""],
  [13,16.695,36.467,"GCl",5.8,22200,"Great Hercules Cluster"],[14,17.627,-3.25,"GCl",7.6,30300,""],[15,21.5,12.167,"GCl",6.2,33000,""],
  [16,18.313,-13.783,"EN",6.0,7000,"Eagle Nebula"],[17,18.347,-16.183,"EN",6.0,5500,"Omega Nebula"],[18,18.332,-17.133,"OC",6.9,4900,""],
  [19,17.043,-26.267,"GCl",7.2,28700,""],[20,18.043,-23.033,"EN",6.3,5200,"Trifid Nebula"],[21,18.077,-22.5,"OC",5.9,4250,""],
  [22,18.607,-23.9,"GCl",5.1,10600,"Great Sagittarius Cluster"],[23,17.947,-19.017,"OC",5.5,2150,""],[24,18.282,-18.483,"OC",4.6,10000,"Sagittarius Star Cloud"],
  [25,18.527,-19.25,"OC",4.6,2000,""],[26,18.753,-9.4,"OC",8.0,5000,""],[27,19.993,22.717,"PN",7.5,1360,"Dumbbell Nebula"],
  [28,18.408,-24.867,"GCl",6.9,17900,""],[29,20.398,38.533,"OC",6.6,4000,""],[30,21.673,-23.183,"GCl",7.2,26100,""],
  [31,0.712,41.267,"GX",3.4,2537000,"Andromeda Galaxy"],[32,0.712,40.867,"GX",8.1,2490000,""],[33,1.565,30.65,"GX",5.7,2730000,"Triangulum Galaxy"],
  [34,2.7,42.783,"OC",5.2,1500,""],[35,6.148,24.333,"OC",5.1,2800,""],[36,5.602,34.133,"OC",6.0,4100,""],
  [37,5.873,32.55,"OC",5.6,4500,""],[38,5.478,35.833,"OC",6.4,4200,""],[39,21.537,48.433,"OC",4.6,825,""],
  [40,12.373,58.083,"DS",8.0,510,"Winnecke 4 (double star)"],[41,6.767,-20.733,"OC",4.5,2300,""],[42,5.59,-5.45,"EN",4.0,1344,"Orion Nebula"],
  [43,5.593,-5.267,"EN",9.0,1600,"De Mairan's Nebula"],[44,8.668,19.983,"OC",3.1,610,"Beehive Cluster"],[45,3.783,24.117,"OC",1.6,444,"Pleiades"],
  [46,7.697,-14.817,"OC",6.1,5400,""],[47,7.61,-14.5,"OC",4.4,1600,""],[48,8.23,-5.8,"OC",5.8,1500,""],
  [49,12.497,8.0,"GX",8.4,55900000,""],[50,7.053,-8.333,"OC",5.9,3000,""],[51,13.498,47.2,"GX",8.4,23000000,"Whirlpool Galaxy"],
  [52,23.403,61.583,"OC",6.9,5000,""],[53,13.215,18.167,"GCl",7.7,58000,""],[54,18.918,-30.483,"GCl",7.7,87400,""],
  [55,19.667,-30.967,"GCl",7.0,17600,""],[56,19.277,30.183,"GCl",8.3,32900,""],[57,18.893,33.033,"PN",8.8,2300,"Ring Nebula"],
  [58,12.628,11.817,"GX",9.7,63000000,""],[59,12.7,11.65,"GX",9.8,55000000,""],[60,12.728,11.55,"GX",8.8,55000000,""],
  [61,12.365,4.467,"GX",9.7,52500000,""],[62,17.02,-30.117,"GCl",6.5,22500,""],[63,13.263,42.033,"GX",8.6,37000000,"Sunflower Galaxy"],
  [64,12.945,21.683,"GX",8.5,24000000,"Black Eye Galaxy"],[65,11.315,13.083,"GX",9.3,35000000,""],[66,11.337,12.983,"GX",8.9,35000000,""],
  [67,8.84,11.817,"OC",6.9,2700,""],[68,12.658,-26.75,"GCl",8.2,33300,""],[69,18.523,-32.35,"GCl",7.7,29700,""],
  [70,18.72,-32.3,"GCl",8.1,29300,""],[71,19.897,18.783,"GCl",8.3,13000,""],[72,20.892,-12.533,"GCl",9.4,53400,""],
  [73,20.982,-12.633,"OC",9.0,2500,"Asterism"],[74,1.612,15.783,"GX",9.1,32000000,"Phantom Galaxy"],[75,20.102,-21.917,"GCl",8.6,67500,""],
  [76,1.707,51.567,"PN",10.1,2500,"Little Dumbbell"],[77,2.712,-0.017,"GX",8.8,60000000,"Squid Galaxy"],[78,5.778,0.05,"EN",8.0,1350,""],
  [79,5.408,-24.55,"GCl",7.7,41000,""],[80,16.283,-22.983,"GCl",7.3,32600,""],[81,9.927,69.067,"GX",6.9,11800000,"Bode's Galaxy"],
  [82,9.93,69.683,"GX",8.4,11400000,"Cigar Galaxy"],[83,13.617,-29.867,"GX",7.5,15000000,"Southern Pinwheel"],[84,12.418,12.883,"GX",9.1,60000000,""],
  [85,12.423,18.183,"GX",9.1,60000000,""],[86,12.437,12.95,"GX",8.9,52000000,""],[87,12.513,12.383,"GX",8.6,53500000,"Virgo A"],
  [88,12.533,14.417,"GX",9.5,47000000,""],[89,12.595,12.55,"GX",9.8,50000000,""],[90,12.613,13.167,"GX",9.5,58700000,""],
  [91,12.59,14.5,"GX",10.2,63000000,""],[92,17.285,43.133,"GCl",6.5,26700,""],[93,7.743,-23.867,"OC",6.2,3600,""],
  [94,12.848,41.117,"GX",8.2,16000000,"Cat's Eye Galaxy"],[95,10.733,11.7,"GX",9.7,32600000,""],[96,10.78,11.817,"GX",9.2,31000000,""],
  [97,11.247,55.017,"PN",9.9,2030,"Owl Nebula"],[98,12.23,14.9,"GX",10.1,44400000,""],[99,12.313,14.417,"GX",9.9,50000000,""],
  [100,12.382,15.817,"GX",9.4,55000000,""],[101,14.053,54.35,"GX",7.9,21000000,"Pinwheel Galaxy"],[102,15.108,55.767,"GX",9.9,50000000,"Spindle Galaxy"],
  [103,1.553,60.7,"OC",7.4,8500,""],[104,12.667,-11.617,"GX",8.0,29000000,"Sombrero Galaxy"],[105,10.797,12.583,"GX",9.3,32000000,""],
  [106,12.317,47.3,"GX",8.4,23500000,""],[107,16.542,-13.05,"GCl",8.1,20900,""],[108,11.192,55.667,"GX",10.0,46000000,""],
  [109,11.96,53.383,"GX",9.8,83500000,""],[110,0.673,41.683,"GX",8.1,2690000,""],
];
const TYPE_MAP = { GX: "galaxy", EN: "emission nebula", PN: "planetary nebula", OC: "open cluster", GCl: "globular cluster", SNR: "supernova remnant", DS: "double star" };

async function fetchDSO() {
  console.log("Deep-sky objects: OpenNGC…");
  const url = "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv";
  let out = [], source = "OpenNGC (mattiaverga/OpenNGC)", usedUrl = url, license = "OpenNGC: CC BY-SA 4.0";
  try {
    const buf = await download(url, { timeoutMs: 120000 });
    const rows = parseCSV(buf.toString("utf8"), ";");
    const head = rows[0].map((h) => h.trim());
    const idx = Object.fromEntries(head.map((h, i) => [h, i]));
    const parseCoord = (v, isRA) => {
      v = (v || "").trim();
      if (!v) return NaN;
      if (v.includes(":")) {
        const p = v.split(":").map(Number);
        const sign = v.startsWith("-") ? -1 : 1;
        const val = Math.abs(p[0]) + (p[1] || 0) / 60 + (p[2] || 0) / 3600;
        return sign * val * (isRA ? 15 : 1);
      }
      return parseFloat(v) * (isRA && Math.abs(parseFloat(v)) <= 24 ? 1 : 1);
    };
    const typeMapNGC = {
      G: "galaxy", GX: "galaxy", Gb: "galaxy", GiP: "galaxy", Sy2: "galaxy", Sy1: "galaxy", "GGroup": "galaxy", GPair: "galaxy", GTrpl: "galaxy",
      PN: "planetary nebula", OC: "open cluster", OCl: "open cluster", Cl: "open cluster", GCl: "globular cluster",
      Nb: "emission nebula", EN: "emission nebula", HII: "emission nebula", RN: "emission nebula", RNe: "emission nebula",
      SNR: "supernova remnant", Kt: "emission nebula", DN: "dark nebula",
    };
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const g = (k) => (idx[k] !== undefined ? row[idx[k]] : "") || "";
      const ra = parseCoord(g("RA"), true), dec = parseCoord(g("Dec"), false);
      if (!isFinite(ra) || !isFinite(dec)) continue;
      const rawName = (g("Name") || "").replace(/\s/g, "");
      const messier = (g("M") || "").trim();
      const name = messier ? `M${messier}` : rawName.toUpperCase().startsWith("NGC") ? rawName.toUpperCase() : rawName.toUpperCase() || g("Identifiers").split(";")[0];
      if (!name) continue;
      const vMag = parseFloat(g("V-Mag") || g("VMag")), bMag = parseFloat(g("B-Mag") || g("BMag"));
      const mag = isFinite(vMag) ? vMag : isFinite(bMag) ? bMag : null;
      if (mag !== null && mag > 15 && !messier) continue; // keep catalog useful & compact
      const t = typeMapNGC[(g("Type") || "").trim()] || "other";
      const size = parseFloat(g("Majax"));
      const key = messier ? `M${messier}` : name.replace(/[^A-Za-z0-9]/g, "");
      out.push({
        n: name, t, ra: +ra.toFixed(5), dec: +dec.toFixed(5), m: mag,
        s: isFinite(size) ? +size.toFixed(1) : null,
        d: DSO_DISTANCES[key] ?? DSO_DISTANCES[name.replace(/[^A-Za-z0-9]/g, "")] ?? null,
        cn: (g("CommonNames") || "").split(";")[0].trim() || null,
      });
    }
    if (out.length < 100) throw new Error(`OpenNGC parse yielded only ${out.length} rows`);
  } catch (e) {
    console.warn(`  ⚠ OpenNGC failed (${e.message}); using embedded Messier fallback`);
    source = "Embedded Messier catalogue (fallback — OpenNGC unreachable)";
    usedUrl = null;
    license = "Messier catalog coordinates: public domain catalog data";
    out = MESSIER.map(([m, raH, dec, t, mag, d, cn]) => ({
      n: `M${m}`, t: TYPE_MAP[t], ra: +(raH * 15).toFixed(5), dec, m: mag, s: null, d, cn: cn || null,
    }));
  }
  writeFileSync(join(DATA, "dso.json"), JSON.stringify({
    fields: { n: "catalog name", t: "category", ra: "deg J2000", dec: "deg J2000", m: "visual mag", s: "major axis arcmin", d: "distance light years (well-known objects only)", cn: "common name" },
    count: out.length, source, objects: out,
  }));
  report({
    name: "Deep-sky objects", source, url: usedUrl, retrieved, count: out.length,
    distances: "Curated published distances for well-known objects; others null",
    sizeBytes: statSync(join(DATA, "dso.json")).size, license,
  });
}

/* ================= 4. MILKY WAY BACKDROP ================= */
async function fetchMilkyWay() {
  console.log("Milky Way backdrop…");
  const candidates = [
    {
      name: "ESA/Gaia DR2 all-sky, equirectangular 2000x1000 (ESA/Gaia/DPAC, CC BY-SA 3.0 IGO)",
      url: "https://sci.esa.int/documents/33580/35361/1567215018748-ESA_Gaia_DR2_AllSky_Brightness_Colour_Cartesian_2000x1000.png/57e638f3-d489-2e0f-fe39-73d952b5b8d3?version=1.0&t=1567215037506&download=true",
      file: "milkyway.jpg", kind: "png", license: "ESA/Gaia/DPAC — CC BY-SA 3.0 IGO",
    },
    {
      name: "Solar System Scope milky way 2k (CC BY 4.0)",
      url: "https://www.solarsystemscope.com/textures/download/2k_stars_milky_way.jpg",
      file: "milkyway.jpg", kind: "jpeg", license: "Solar System Scope — CC BY 4.0",
    },
  ];
  for (const c of candidates) {
    try {
      const buf = await download(c.url, { timeoutMs: 120000 });
      if (magic(buf) !== c.kind) throw new Error(`not a ${c.kind} (magic=${magic(buf)})`);
      writeFileSync(join(TEX, c.file), buf);
      report({ name: `Milky Way backdrop: ${c.name}`, url: c.url, retrieved, sizeBytes: buf.length, license: c.license, status: "fetched" });
      return;
    } catch (e) {
      console.warn(`  ⚠ backdrop candidate failed: ${e.message}`);
    }
  }
  report({ name: "Milky Way backdrop", status: "FALLBACK — procedural gradient+noise generated in-app", license: "n/a (generated)" });
}

/* ================= 5. SOLAR SYSTEM TEXTURES ================= */
async function fetchPlanetTextures() {
  console.log("Planet textures: Solar System Scope…");
  const files = [
    "2k_sun.jpg", "2k_mercury.jpg", "2k_venus_surface.jpg", "2k_earth_daymap.jpg",
    "2k_earth_normal_map.tif", "2k_earth_nightmap.jpg", "2k_moon.jpg", "2k_mars.jpg",
    "2k_jupiter.jpg", "2k_saturn.jpg", "2k_saturn_ring_alpha.png", "2k_uranus.jpg", "2k_neptune.jpg",
  ];
  const base = "https://www.solarsystemscope.com/textures/download/";
  const got = [], failed = [];
  for (const f of files) {
    try {
      const buf = await download(base + f, { timeoutMs: 90000 });
      const k = magic(buf);
      if (k !== "jpeg" && k !== "png" && k !== "tiff") throw new Error(`magic=${k}`);
      writeFileSync(join(TEX_PLANETS, f), buf);
      got.push({ file: f, sizeBytes: buf.length });
    } catch (e) {
      console.warn(`  ⚠ ${f}: ${e.message}`);
      failed.push(f);
    }
  }
  report({
    name: "Solar system body textures (2k)",
    source: "Solar System Scope textures", url: base, retrieved,
    count: got.length, fetched: got, failed,
    license: "Solar System Scope — CC BY 4.0 (https://www.solarsystemscope.com/textures/)",
    note: failed.length ? "Failed items use procedural canvas texture fallback in-app" : undefined,
  });
}

/* ================= 6. MISSIONS (curated, real published values) ================= */
function writeMissions() {
  // Positions are real-world-based approximations from published mission data (see basis).
  const missions = [
    { n: "ISS", cat: "earth-orbit", host: "earth", alt_km: 420, note: "LEO, ~420 km altitude, 51.6° inclination" },
    { n: "Hubble Space Telescope", cat: "earth-orbit", host: "earth", alt_km: 540, note: "LEO ~540 km" },
    { n: "Tiangong", cat: "earth-orbit", host: "earth", alt_km: 390, note: "LEO ~390 km, 41.5° inclination" },
    { n: "JWST", cat: "lagrange", host: "l2", note: "Halo orbit around Sun–Earth L2, ~1.5M km from Earth" },
    { n: "Gaia", cat: "lagrange", host: "l2", note: "Lissajous orbit around Sun–Earth L2" },
    { n: "SOHO", cat: "lagrange", host: "l1", note: "Halo orbit around Sun–Earth L1, ~1.5M km sunward" },
    { n: "Voyager 1", cat: "interstellar", host: "sun", dist_au: 162.7, ra_h: 17.23, dec_d: 12.07, note: "Most distant human-made object; ~162 AU (2024), heading RA~17.2h Dec+12.1°" },
    { n: "Voyager 2", cat: "interstellar", host: "sun", dist_au: 136.3, ra_h: 19.95, dec_d: -55.0, note: "~136 AU (2024), heading RA~20h Dec−55°" },
    { n: "Pioneer 10", cat: "interstellar", host: "sun", dist_au: 136.5, ra_h: 5.2, dec_d: 25.9, note: "~136 AU, toward Aldebaran in Taurus" },
    { n: "Pioneer 11", cat: "interstellar", host: "sun", dist_au: 113.4, ra_h: 18.87, dec_d: -8.8, note: "~113 AU, toward Scutum" },
    { n: "New Horizons", cat: "interstellar", host: "sun", dist_au: 59.5, ra_h: 19.28, dec_d: -20.4, note: "~59 AU (2024) in Kuiper Belt, Sagittarius direction" },
    { n: "Parker Solar Probe", cat: "heliocentric", host: "sun", dist_au: 0.09, ra_h: 4.0, dec_d: 18.0, note: "Inner heliosphere, perihelion ~0.046 AU; placed at representative 0.09 AU" },
    { n: "Juno", cat: "planetary", host: "jupiter", note: "Polar orbit around Jupiter (extended mission)" },
    { n: "Cassini (ended 2017)", cat: "planetary", host: "saturn", note: "Burned up in Saturn atmosphere Sep 2017; marker at Saturn" },
    { n: "Perseverance", cat: "surface", host: "mars", lat: 18.44, lon: 77.45, note: "Jezero Crater, Mars" },
    { n: "Curiosity", cat: "surface", host: "mars", lat: -4.59, lon: 137.44, note: "Gale Crater, Mars" },
    { n: "MAVEN", cat: "planetary", host: "mars", note: "Mars orbiter (areocentric)" },
    { n: "JUICE", cat: "cruise", host: "sun", dist_au: 1.0, ra_h: 10.5, dec_d: 8.0, note: "En route to Jupiter (launched 2023, arrival 2031); representative position" },
    { n: "Psyche", cat: "cruise", host: "sun", dist_au: 1.4, ra_h: 1.5, dec_d: -5.0, note: "En route to asteroid 16 Psyche; representative position" },
    { n: "BepiColombo", cat: "cruise", host: "sun", dist_au: 0.7, ra_h: 6.0, dec_d: 22.0, note: "En route to Mercury (arrival 2026); representative position" },
  ];
  writeFileSync(join(DATA, "missions.json"), JSON.stringify({
    basis: "Real published mission positions/distances, approximated for visualization. Voyager/Pioneer distances are approximate 2024 heliocentric distances (AU) with approximate sky directions (RA hours, Dec deg). Earth-orbit altitudes in km. Cruise missions at representative positions.",
    count: missions.length, missions,
  }));
  report({
    name: "Space missions/probes (curated)", source: "NASA/ESA published mission data (curated)", url: null,
    retrieved, count: missions.length, license: "NASA/ESA public information",
  });
}

/* ================= 7. BLACK HOLES & NEUTRON STARS (curated real coordinates) ================= */
function writeCompactObjects() {
  const objs = [
    { n: "Sagittarius A*", t: "black hole", ra_h: 17.7611, dec_d: -29.0078, d_pc: 8178, note: "Supermassive BH at Galactic center, ~4.15M solar masses (GRAVITY/Keck orbits)" },
    { n: "Cygnus X-1", t: "black hole", ra_h: 19.9728, dec_d: 35.2017, d_pc: 2200, note: "First widely accepted stellar-mass BH, ~21 solar masses" },
    { n: "M87*", t: "black hole", ra_h: 12.5136, dec_d: 12.3911, d_pc: 16400000, note: "SMBH imaged by EHT 2019, ~6.5B solar masses" },
    { n: "GRO J1655-40", t: "black hole", ra_h: 16.9, dec_d: -39.8458, d_pc: 3400, note: "Microquasar X-ray binary" },
    { n: "A0620-00", t: "black hole", ra_h: 6.3789, dec_d: -0.3458, d_pc: 1000, note: "Nearest known BH candidate (X-ray nova)" },
    { n: "Gaia BH1", t: "black hole", ra_h: 9.263, dec_d: -5.18, d_pc: 480, note: "Nearest known BH (Gaia astrometric, 2022), ~10 solar masses" },
    { n: "V404 Cygni", t: "black hole", ra_h: 20.4, dec_d: 33.8667, d_pc: 2400, note: "Microquasar, ~9 solar masses" },
    { n: "Vela Pulsar", t: "neutron star", ra_h: 8.5889, dec_d: -45.1764, d_pc: 294, note: "PSR B0833-45, 89 ms period, Vela SNR" },
    { n: "Crab Pulsar", t: "neutron star", ra_h: 5.5756, dec_d: 22.0145, d_pc: 2000, note: "PSR B0531+21, 33 ms, in Crab Nebula M1" },
    { n: "PSR B1919+21", t: "neutron star", ra_h: 19.3289, dec_d: 21.8839, d_pc: 710, note: "First discovered pulsar (Bell Burnell & Hewish, 1967)" },
    { n: "Geminga", t: "neutron star", ra_h: 6.565, dec_d: 17.7706, d_pc: 250, note: "Nearby radio-quiet gamma-ray pulsar" },
    { n: "SGR 1806-20", t: "magnetar", ra_h: 18.1442, dec_d: -20.4078, d_pc: 13000, note: "Magnetar; 2004 giant flare was brightest event ever observed from outside Solar System" },
    { n: "PSR J0348+0432", t: "neutron star", ra_h: 3.8133, dec_d: 4.7217, d_pc: 2100, note: "~2.0 solar mass pulsar, tests of general relativity" },
  ];
  writeFileSync(join(DATA, "compact.json"), JSON.stringify({
    basis: "Real published coordinates (J2000) and distance estimates from literature; curated.",
    count: objs.length, objects: objs,
  }));
  report({
    name: "Black holes / neutron stars (curated)", source: "Published literature values (curated)", url: null,
    retrieved, count: objs.length, license: "Public astronomical data",
  });
}

/* ================= main ================= */
const steps = {
  stars: fetchStars, exoplanets: fetchExoplanets, dso: fetchDSO,
  milkyway: fetchMilkyWay, textures: fetchPlanetTextures,
  missions: writeMissions, compact: writeCompactObjects,
};
const only = process.argv[2] ? process.argv[2].split(",") : null;
for (const [k, fn] of Object.entries(steps)) {
  if (only && !only.includes(k)) continue;
  try { await fn(); } catch (e) {
    console.error(`✖ ${k} failed: ${e.message}`);
    manifest.datasets.push({ name: k, status: `FAILED: ${e.message}` });
  }
}
writeFileSync(join(DATA, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`\nManifest written: ${manifest.datasets.length} dataset entries.`);

/**
 * fetch-extra.mjs — ports the remaining Milky Way Atlas datasets (reference/extract_data.py)
 * into public/data, converted to this app's coordinate frame (equatorial J2000 Cartesian,
 * 1 unit = 1 pc, Sun at origin; x → RA 0h, y → RA 6h, z → +Dec).
 *
 * The reference app stores these layers in GALACTIC Cartesian coordinates. We compute the
 * same galactic positions (for cross-checking), then rotate them into our equatorial frame
 * with Rᵀ (R is the orthonormal J2000 equatorial→galactic rotation), so every new point
 * layer mixes directly with the existing catalogs. The dust cube (scripts/fetch_dust.py)
 * is the only layer kept in galactic frame — the app mounts it under a rotated group.
 *
 * Datasets:
 *   cepheids.bin/.json    Skowron+2019 classical Cepheids (galactic disk incl. warp)
 *   globulars.bin/.json   Harris + LVDB Milky Way globular clusters (the halo)
 *   galaxies.json         Local Volume Database dwarfs + M31/M33 (real rhalf, M_V, ell, pa)
 *   starnames.json        every proper-named HYG v4.1 star within 1400 pc (hover labels)
 *   constellations.json   Stellarium modern skyculture HIP→HIP segments in true 3D
 *   landmarks.json        named regions: local clouds + MW landmarks + Local Group landmarks
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const DATA = join(ROOT, "public", "data");
mkdirSync(DATA, { recursive: true });
const retrieved = new Date().toISOString().slice(0, 10);

/* ---------------- frame math ---------------- */
const D2R = Math.PI / 180;
// J2000 equatorial → galactic rotation (same matrix as reference/extract_data.py).
const R = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
];
const RT = [
  [R[0][0], R[1][0], R[2][0]],
  [R[0][1], R[1][1], R[2][1]],
  [R[0][2], R[1][2], R[2][2]],
];
const matVec = (M, v) => [
  M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
  M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
  M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
];
/** galactic Cartesian → equatorial J2000 Cartesian (our app frame). */
const eqFromGal = (g) => matVec(RT, g);
/** reference radec_xyz: RA/Dec/deg + d → galactic xyz (via R). */
function galFromRaDec(ra, dec, d) {
  const r = ra * D2R, c = dec * D2R, cd = Math.cos(c);
  const v = [cd * Math.cos(r), cd * Math.sin(r), Math.sin(c)];
  return matVec(R, v).map((x) => x * d);
}
/** reference lb_xyz: galactic l/b/deg + d → galactic xyz. */
function galFromLB(l, b, d) {
  const lr = l * D2R, br = b * D2R, cb = Math.cos(br);
  return [d * cb * Math.cos(lr), d * cb * Math.sin(lr), d * Math.sin(br)];
}
const roundN = (v, n = 2) => v.map((x) => +x.toFixed(n));

// Sanity: orthonormality + the Galactic centre round-trip.
{
  const I = matVec(R, matVec(RT, [1, 2, 3]));
  if (Math.hypot(I[0] - 1, I[1] - 2, I[2] - 3) > 1e-9) throw new Error("R not orthonormal");
  const gcEqu = eqFromGal([8178, 0, -14]);
  const gcDirect = (() => { // our own convention straight from Sgr A* coordinates
    const ra = 266.405 * D2R, dec = -29.0078 * D2R, cd = Math.cos(dec), d = 8178;
    return [d * cd * Math.cos(ra), d * cd * Math.sin(ra), d * Math.sin(dec)];
  })();
  const err = Math.hypot(gcEqu[0] - gcDirect[0], gcEqu[1] - gcDirect[1], gcEqu[2] - gcDirect[2]);
  console.log(`frame check: Galactic centre equatorial ${roundN(gcEqu, 1)} vs direct ${roundN(gcDirect, 1)} (Δ=${err.toFixed(2)} pc)`);
  if (err > 30) throw new Error("frame conversion mismatch");
}

/* ---------------- helpers ---------------- */
async function download(url, { retries = 2, timeoutMs = 120000 } = {}) {
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
const dictRows = (text) => {
  const rows = parseCSV(text);
  const head = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
};

const manifestEntries = [];
const report = (entry) => {
  manifestEntries.push(entry);
  console.log(`  ✔ ${entry.name}: ${entry.count ?? entry.sizeBytes ?? ""}`);
};

/* ================= 1. CEPHEIDS — Skowron+2019 ================= */
async function fetchCepheids() {
  console.log("Cepheids: Skowron+2019 galactic disk map…");
  const url = "https://raw.githubusercontent.com/jskowron/galactic_cepheids/master/data/Data_Table_1.dat";
  const text = (await download(url)).toString("utf8");
  const ceph = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || !line.trim()) continue;
    const p = line.trim().split(/\s+/);
    const D = parseFloat(p[4]);
    if (!(D > 0)) continue;
    const gal = galFromLB(parseFloat(p[2]), parseFloat(p[3]), D);
    const equ = eqFromGal(gal);
    ceph.push([equ[0], equ[1], equ[2], parseFloat(p[6])]); // xyz (pc, equatorial) + extra (age Myr)
  }
  const arr = new Float32Array(ceph.flat());
  writeFileSync(join(DATA, "cepheids.bin"), Buffer.from(arr.buffer));
  writeFileSync(join(DATA, "cepheids.json"), JSON.stringify({
    count: ceph.length,
    layout: "interleaved-float32 [x,y,z (pc, equatorial J2000), ageMyr]",
    source: "Skowron+2019 OGLE classical Cepheids (galactic_cepheids Data_Table_1)",
    note: "Columns l,b,D(pc) converted galactic→equatorial J2000; 4th value = age (Myr) per reference pipeline",
  }, null, 2));
  report({
    name: "Cepheids (Skowron+2019 disk map)", source: "jskowron/galactic_cepheids Data_Table_1",
    url, retrieved, count: ceph.length,
    sizeBytes: statSync(join(DATA, "cepheids.bin")).size,
    license: "Skowron et al. 2019, Science 365, 478 — cite the paper",
  });
}

/* ================= 2. LVDB — globulars + galaxies + LG landmarks ================= */
const LVDB = "https://raw.githubusercontent.com/apace7/local_volume_database/main/data/";
const mwLandmarks = [
  { name: "Sgr A*", pos: roundN(eqFromGal([8178, 0, -14]), 1), desc: "Galactic centre · 26,700 ly", cat: "mw" },
  { name: "Sun + local clouds", pos: [0, 0, 0], desc: "The 2 kpc dust cube sits here", cat: "mw" },
];
let galaxies = [];

async function fetchLVDB() {
  console.log("Globular clusters + Local Group galaxies: Local Volume Database…");
  const lvdb = async (f) => dictRows((await download(LVDB + f)).toString("utf8"));
  const FAMOUS = {
    "NGC 5139": ["Omega Centauri", "Brightest globular cluster"],
    "NGC 104": ["47 Tucanae", ""],
    "NGC 6205": ["M13", "Hercules cluster"],
    "NGC 7078": ["M15", ""],
    "NGC 6121": ["M4", "Nearest globular"],
  };

  // --- globular clusters (halo) ---
  const gcs = [];
  for (const f of ["gc_harris.csv", "gc_mw_new.csv"]) {
    for (const r of await lvdb(f)) {
      const ra = parseFloat(r.ra), dec = parseFloat(r.dec), dm = parseFloat(r.distance_modulus);
      if (!isFinite(ra) || !isFinite(dec) || !isFinite(dm)) continue;
      const gal = galFromRaDec(ra, dec, Math.pow(10, dm / 5 + 1));
      const amv = parseFloat(r.apparent_magnitude_v);
      const mv = isFinite(amv) ? amv - dm : -6;
      const equ = eqFromGal(gal);
      gcs.push([equ[0], equ[1], equ[2], mv]);
      const nm = (r.name ?? "").trim();
      if (FAMOUS[nm]) mwLandmarks.push({ name: FAMOUS[nm][0], pos: roundN(equ, 1), desc: FAMOUS[nm][1], cat: "mw" });
    }
  }
  const gcArr = new Float32Array(gcs.flat());
  writeFileSync(join(DATA, "globulars.bin"), Buffer.from(gcArr.buffer));
  writeFileSync(join(DATA, "globulars.json"), JSON.stringify({
    count: gcs.length,
    layout: "interleaved-float32 [x,y,z (pc, equatorial J2000), M_V]",
    source: "Harris catalog + LVDB (gc_harris.csv, gc_mw_new.csv)",
  }, null, 2));
  report({
    name: "Globular clusters (Harris + LVDB)", source: "apace7/local_volume_database",
    url: LVDB + "gc_harris.csv", retrieved, count: gcs.length,
    sizeBytes: statSync(join(DATA, "globulars.bin")).size,
    license: "LVDB: CC0 / cite Pace+2022; Harris 1996 (2010 ed.)",
  });

  // --- Local Group / Local Volume dwarf galaxies + M31/M33 ---
  galaxies = [];
  for (const [f, host] of [["dwarf_mw.csv", "MW"], ["dwarf_m31.csv", "M31"], ["dwarf_local_field.csv", "LF"], ["dwarf_local_field_distant.csv", "LV"]]) {
    for (const r of await lvdb(f)) {
      const ra = parseFloat(r.ra), dec = parseFloat(r.dec), dm = parseFloat(r.distance_modulus);
      if (!isFinite(ra) || !isFinite(dec) || !isFinite(dm)) continue;
      const d = Math.pow(10, dm / 5 + 1);
      const amv = parseFloat(r.apparent_magnitude_v);
      const MV = isFinite(amv) ? amv - dm : -8;
      const rhRaw = parseFloat(r.rhalf);
      const rh = isFinite(rhRaw) ? Math.max(rhRaw * Math.PI / 180 / 60 * d, 20) : 200;
      const ellRaw = parseFloat(r.ellipticity);
      const ell = isFinite(ellRaw) ? Math.min(Math.max(ellRaw, 0), 0.85) : 0.25;
      const paRaw = parseFloat(r.position_angle);
      const pa = isFinite(paRaw) ? paRaw : 0.0;
      galaxies.push({
        name: (r.name ?? "").trim(), pos: roundN(eqFromGal(galFromRaDec(ra, dec, d)), 0),
        MV: +MV.toFixed(1), rh: Math.round(rh), host, ell: +ell.toFixed(2), pa: +pa.toFixed(1),
      });
    }
  }
  for (const [nm, ra, dec, dk, MV, rh] of [
    ["Andromeda (M31)", 10.6847, 41.2687, 783, -21.5, 6800],
    ["Triangulum (M33)", 23.4621, 30.6599, 869, -18.8, 3000],
  ]) {
    galaxies.push({
      name: nm, pos: roundN(eqFromGal(galFromRaDec(ra, dec, dk * 1000)), 0),
      MV, rh, host: "LG", ell: 0.25, pa: 0,
    });
  }
  writeFileSync(join(DATA, "galaxies.json"), JSON.stringify({
    fields: { name: "galaxy", pos: "[x,y,z] pc equatorial J2000", MV: "absolute V mag", rh: "half-light radius pc", host: "MW|M31|LF|LV|LG", ell: "ellipticity 0–0.85", pa: "position angle deg" },
    count: galaxies.length, galaxies,
  }, null, 1));
  report({
    name: "Local Group / Local Volume galaxies (LVDB + M31/M33)", source: "apace7/local_volume_database",
    url: LVDB + "dwarf_mw.csv", retrieved, count: galaxies.length,
    sizeBytes: statSync(join(DATA, "galaxies.json")).size,
    license: "LVDB: CC0 / cite Pace+2022",
  });
}

/* ================= 3. HYG v4.1 — star names + constellations ================= */
const CONST_NAMES = { And: "Andromeda", Ant: "Antlia", Aps: "Apus", Aqr: "Aquarius", Aql: "Aquila", Ara: "Ara", Ari: "Aries", Aur: "Auriga", Boo: "Bootes", Cae: "Caelum", Cam: "Camelopardalis", Cnc: "Cancer", CVn: "Canes Venatici", CMa: "Canis Major", CMi: "Canis Minor", Cap: "Capricornus", Car: "Carina", Cas: "Cassiopeia", Cen: "Centaurus", Cep: "Cepheus", Cet: "Cetus", Cha: "Chamaeleon", Cir: "Circinus", Col: "Columba", Com: "Coma Berenices", CrA: "Corona Australis", CrB: "Corona Borealis", Crv: "Corvus", Crt: "Crater", Cru: "Crux", Cyg: "Cygnus", Del: "Delphinus", Dor: "Dorado", Dra: "Draco", Equ: "Equuleus", Eri: "Eridanus", For: "Fornax", Gem: "Gemini", Gru: "Grus", Her: "Hercules", Hor: "Horologium", Hya: "Hydra", Hyi: "Hydrus", Ind: "Indus", Lac: "Lacerta", Leo: "Leo", LMi: "Leo Minor", Lep: "Lepus", Lib: "Libra", Lup: "Lupus", Lyn: "Lynx", Lyr: "Lyra", Men: "Mensa", Mic: "Microscopium", Mon: "Monoceros", Mus: "Musca", Nor: "Norma", Oct: "Octans", Oph: "Ophiuchus", Ori: "Orion", Pav: "Pavo", Peg: "Pegasus", Per: "Perseus", Phe: "Phoenix", Pic: "Pictor", Psc: "Pisces", PsA: "Piscis Austrinus", Pup: "Puppis", Pyx: "Pyxis", Ret: "Reticulum", Sge: "Sagitta", Sgr: "Sagittarius", Sco: "Scorpius", Scl: "Sculptor", Sct: "Scutum", Ser: "Serpens", Sex: "Sextans", Tau: "Taurus", Tel: "Telescopium", Tri: "Triangulum", TrA: "Triangulum Australe", Tuc: "Tucana", UMa: "Ursa Major", UMi: "Ursa Minor", Vel: "Vela", Vir: "Virgo", Vol: "Volans", Vul: "Vulpecula" };

async function fetchHygExtras() {
  console.log("HYG v4.1: proper star names + constellation geometry…");
  const hygUrl = "https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv";
  const rows = dictRows((await download(hygUrl, { timeoutMs: 300000 })).toString("utf8"));

  // --- proper-named stars within 1400 pc (hover labels) — HYG x,y,z is already equatorial J2000 pc ---
  const named = [];
  const hipMap = new Map();
  for (const r of rows) {
    const d = parseFloat(r.dist);
    if (!(d > 0)) continue;
    const x = parseFloat(r.x), y = parseFloat(r.y), z = parseFloat(r.z);
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
    if (r.hip) {
      const hip = parseInt(r.hip, 10);
      if (isFinite(hip) && d < 99999) hipMap.set(hip, [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)]);
    }
    if (d <= 1400 && (r.proper ?? "").trim()) {
      named.push({ n: r.proper.trim(), p: [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)], m: +parseFloat(r.mag).toFixed(2) });
    }
  }
  named.sort((a, b) => a.m - b.m);
  writeFileSync(join(DATA, "starnames.json"), JSON.stringify({
    fields: { n: "proper name", p: "[x,y,z] pc equatorial J2000", m: "apparent mag" },
    count: named.length, stars: named,
  }));
  report({
    name: "Proper-named stars (HYG v4.1, ≤1400 pc)", source: "AstroNexus HYG-Database v4.1",
    url: hygUrl, retrieved, count: named.length,
    sizeBytes: statSync(join(DATA, "starnames.json")).size,
    license: "HYG database: public domain / CC-BY-SA 4.0 per repo README",
  });

  // --- constellations (Stellarium modern skyculture, HIP pairs → true 3D segments) ---
  const skyUrl = "https://raw.githubusercontent.com/Stellarium/stellarium/master/skycultures/modern/index.json";
  const sky = JSON.parse((await download(skyUrl)).toString("utf8"));
  const segs = [], cnames = [];
  for (const c of sky.constellations) {
    const abbr = c.id.split(/\s+/).pop();
    const pts = [];
    for (const line of c.lines ?? []) {
      for (let i = 0; i + 1 < line.length; i++) {
        const pa = hipMap.get(line[i]), pb = hipMap.get(line[i + 1]);
        if (pa && pb) { segs.push([pa, pb]); pts.push(pa, pb); }
      }
    }
    if (pts.length) {
      const cen = [0, 0, 0];
      for (const p of pts) { cen[0] += p[0]; cen[1] += p[1]; cen[2] += p[2]; }
      cnames.push({ name: CONST_NAMES[abbr] ?? abbr, pos: cen.map((v) => +(v / pts.length).toFixed(1)) });
    }
  }
  writeFileSync(join(DATA, "constellations.json"), JSON.stringify({
    fields: { segs: "[[[x,y,z],[x,y,z]], …] pc equatorial J2000 (HIP→HIP line segments)", names: "{name, pos (centroid pc)}" },
    count: segs.length, constellations: cnames.length, segs, names: cnames,
  }));
  report({
    name: "Constellation figures (Stellarium modern skyculture + HYG)", source: "Stellarium skycultures/modern",
    url: skyUrl, retrieved, count: segs.length, constellations: cnames.length,
    sizeBytes: statSync(join(DATA, "constellations.json")).size,
    license: "Stellarium sky cultures: GPL-compatible / CC BY-SA; line work © Stellarium contributors",
  });
}

/* ================= 4. Landmarks (merged markers + MW + LG) ================= */
function writeLandmarks() {
  console.log("Landmarks: local clouds + Milky Way + Local Group…");
  const markers = [
    { name: "Sun", pos: [0, 0, 0], desc: "You are here", cat: "cloud" },
    { name: "Orion complex", pos: roundN(eqFromGal(galFromLB(209, -19, 414)), 1), desc: "M42 · Horsehead · Flame — 1350 ly", cat: "cloud" },
    { name: "Taurus clouds", pos: roundN(eqFromGal(galFromLB(172, -15, 140)), 1), desc: "Nearest large star-forming cloud", cat: "cloud" },
    { name: "Ophiuchus", pos: roundN(eqFromGal(galFromLB(353, 17, 140)), 1), desc: "Rho Oph dark clouds", cat: "cloud" },
    { name: "Perseus clouds", pos: roundN(eqFromGal(galFromLB(159, -20, 300)), 1), desc: "NGC 1333 · IC 348", cat: "cloud" },
    { name: "California Neb.", pos: roundN(eqFromGal(galFromLB(160, -12, 470)), 1), desc: "NGC 1499 hydrogen cloud", cat: "cloud" },
    { name: "Cepheus clouds", pos: roundN(eqFromGal(galFromLB(110, 15, 350)), 1), desc: "Cepheus flare region", cat: "cloud" },
    { name: "Chamaeleon", pos: roundN(eqFromGal(galFromLB(300, -16, 180)), 1), desc: "Southern dark clouds", cat: "cloud" },
    { name: "Aquila Rift", pos: roundN(eqFromGal(galFromLB(28, 3, 250)), 1), desc: "Great Rift dust lane", cat: "cloud" },
  ];
  const want = ["LMC", "SMC", "Sagittarius", "Fornax", "Sculptor", "Leo I", "NGC 6822", "Andromeda (M31)", "Triangulum (M33)", "IC 10", "WLM", "Draco", "Sextans"];
  const lg = galaxies
    .filter((g) => want.includes(g.name))
    .map((g) => ({ name: g.name, pos: g.pos, desc: "", cat: "lg" }));
  const all = [...markers, ...mwLandmarks, ...lg];
  writeFileSync(join(DATA, "landmarks.json"), JSON.stringify({
    fields: { name: "landmark", pos: "[x,y,z] pc equatorial J2000", desc: "subtitle", cat: "cloud|mw|lg" },
    count: all.length, landmarks: all,
  }, null, 1));
  report({
    name: "Landmarks (local clouds / Milky Way / Local Group)", source: "Published (l,b,d) positions + LVDB (see extract_data.py provenance)",
    url: null, retrieved, count: all.length,
    sizeBytes: statSync(join(DATA, "landmarks.json")).size,
    license: "Public astronomical data",
  });
}

/* ================= manifest merge ================= */
function mergeManifest() {
  const path = join(DATA, "manifest.json");
  let manifest = { generated: retrieved, note: "", datasets: [] };
  if (existsSync(path)) {
    try { manifest = JSON.parse(readFileSync(path, "utf8")); } catch { /* regen */ }
  }
  const names = new Set(manifestEntries.map((e) => e.name));
  manifest.datasets = (manifest.datasets ?? []).filter((d) => !names.has(d.name));
  manifest.datasets.push(...manifestEntries);
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest updated: ${manifest.datasets.length} dataset entries.`);
}

/* ================= dust manifest entry (cube fetched by scripts/fetch_dust.py) ================= */
function dustManifestEntry() {
  const bin = join(DATA, "dust.bin"), metaPath = join(DATA, "dust_meta.json");
  if (!existsSync(bin) || !existsSync(metaPath)) {
    console.log("dust: dust.bin not present — run `python scripts/fetch_dust.py` (skipping manifest entry)");
    return;
  }
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  report({
    name: "3D dust volume (Leike/Lallement Gaia maps)", source: meta.source,
    url: meta.url, retrieved, count: meta.shape_zyx.reduce((a, b) => a * b, 1),
    sizeBytes: statSync(bin).size,
    note: "uint8 log-encoded density cube kept in galactic Cartesian; mounted under a rotated group in-app",
    license: meta.license,
  });
}

/* ================= main ================= */
const steps = { cepheids: fetchCepheids, lvdb: fetchLVDB, hyg: fetchHygExtras, landmarks: writeLandmarks, dust: dustManifestEntry };
const only = process.argv[2] ? process.argv[2].split(",") : null;
for (const [k, fn] of Object.entries(steps)) {
  if (only && !only.includes(k)) continue;
  try { await fn(); } catch (e) {
    console.error(`✖ ${k} failed: ${e.message}`);
    manifestEntries.push({ name: k, status: `FAILED: ${e.message}` });
  }
}
mergeManifest();

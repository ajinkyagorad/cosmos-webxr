#!/usr/bin/env python3
"""
Reproducible pipeline that builds data/ for the Milky Way Atlas.
All layers come from real observational catalogs:

 1. dust.bin        Leike/Lallement Gaia-based 3D dust density (2000x2000x800 pc)
 2. stars.bin       HYG v4.1: 60k brightest stars within 1400 pc (galactic XYZ)
 3. starnames.json  every proper-named HYG star (hover labels)
 4. cepheids.bin    Skowron+2019 classical Cepheids: the whole disk incl. warp
 5. globulars.bin   Harris + LVDB Milky Way globular clusters (the halo)
 6. galaxies.json   Local Volume Database dwarfs + M31/M33 (real rhalf & M_V)
 7. markers/landmarks: named regions at published (l, b, distance)

deps: pip install numpy msgpack
"""
import base64, csv, io, json, math, re, urllib.request, zlib
from pathlib import Path
import numpy as np, msgpack

OUT = Path(__file__).resolve().parent.parent / "data"
OUT.mkdir(exist_ok=True)
R = np.array([[-0.0548755604,-0.8734370902,-0.4838350155],   # equatorial J2000 -> galactic
              [ 0.4941094279,-0.4448296300, 0.7469822445],
              [-0.8676661490,-0.1980763734, 0.4559837762]])
def radec_xyz(ra, dec, d):
    ra, dec = math.radians(ra), math.radians(dec)
    v = np.array([math.cos(dec)*math.cos(ra), math.cos(dec)*math.sin(ra), math.sin(dec)])
    return (R @ v) * d
def lb_xyz(l, b, d):
    l, b = math.radians(l), math.radians(b)
    return [d*math.cos(b)*math.cos(l), d*math.cos(b)*math.sin(l), d*math.sin(b)]
def get(url): return urllib.request.urlopen(url).read()

# ---------- 1. dust ----------
print("dust: k3d snapshot of Leike/Lallement maps (~19 MB)...")
html = get("https://raw.githubusercontent.com/sb2580/k3d_dust/main/index.html").decode("utf-8","ignore")
blob = max(re.findall(r"'([A-Za-z0-9+/=]{100000,})'", html), key=len)
snap = msgpack.unpackb(zlib.decompress(base64.b64decode(blob)), raw=False, strict_map_key=False)
a = next(o for o in snap["objects"] if o.get("type")=="Volume")["volume"]
vol = np.frombuffer(a["data"], dtype=a["dtype"]).reshape(a["shape"])       # (81,201,201)=(z,y,x)
VMIN, VMAX = 0.02, float(vol.max())
np.round(np.log(np.clip(vol,VMIN,VMAX)/VMIN)/np.log(VMAX/VMIN)*255).astype(np.uint8).tofile(OUT/"dust.bin")
json.dump({"source":"Leike & Ensslin / Lallement 3D dust maps (via sb2580/k3d_dust)",
  "shape_zyx":[81,201,201],"extent_pc":{"x":[-1000,1000],"y":[-1000,1000],"z":[-400,400]},
  "frame":"Galactic Cartesian, Sun at origin, +X to Galactic Center, +Z to N gal pole",
  "encoding":"uint8 log-scale: density = vmin*pow(vmax/vmin, value/255)",
  "vmin":VMIN,"vmax":VMAX,"units":"relative extinction density"}, open(OUT/"dust_meta.json","w"), indent=2)

# ---------- 2+3. stars ----------
print("stars: HYG v4.1 (~34 MB)...")
rows, named = [], []
rd = csv.DictReader(get("https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv").decode().splitlines())
for r in rd:
    try: d, mag = float(r["dist"]), float(r["mag"])
    except ValueError: continue
    if not (0 < d <= 1400): continue
    g = R @ np.array([float(r["x"]), float(r["y"]), float(r["z"])])
    try: ci = float(r["ci"])
    except ValueError: ci = 0.6
    rows.append((g[0],g[1],g[2],mag,ci))
    if r["proper"].strip():
        named.append({"n":r["proper"].strip(),"p":[round(v,2) for v in g],"m":mag})
rows.sort(key=lambda t:t[3]); named.sort(key=lambda s:s["m"])
np.array(rows[:60000],dtype=np.float32).tofile(OUT/"stars.bin")
json.dump(named, open(OUT/"starnames.json","w"))

# ---------- 4. Cepheids ----------
print("cepheids: Skowron+2019 galactic disk map...")
ceph=[]
for line in get("https://raw.githubusercontent.com/jskowron/galactic_cepheids/master/data/Data_Table_1.dat").decode().splitlines():
    if line.startswith("#") or not line.strip(): continue
    p=line.split(); D=float(p[4])
    if D<=0: continue
    ceph.append((*lb_xyz(float(p[2]),float(p[3]),D), float(p[6])))
np.array(ceph,dtype=np.float32).tofile(OUT/"cepheids.bin")

# ---------- 5+6+7. LVDB clusters, galaxies, landmarks ----------
print("clusters + galaxies: Local Volume Database...")
BASE="https://raw.githubusercontent.com/apace7/local_volume_database/main/data/"
def lvdb(f): return list(csv.DictReader(get(BASE+f).decode().splitlines()))
gcs=[]; FAMOUS={'NGC 5139':('Omega Centauri','Brightest globular cluster'),'NGC 104':('47 Tucanae',''),
  'NGC 6205':('M13','Hercules cluster'),'NGC 7078':('M15',''),'NGC 6121':('M4','Nearest globular')}
mw_lm=[{"name":"Sgr A*","pos":[8178,0,-14],"desc":"Galactic centre · 26,700 ly"},
       {"name":"Sun + local clouds","pos":[0,0,0],"desc":"The 2 kpc dust cube sits here"}]
for f in ["gc_harris.csv","gc_mw_new.csv"]:
    for r in lvdb(f):
        try: ra,dec,dm=float(r["ra"]),float(r["dec"]),float(r["distance_modulus"])
        except (ValueError,KeyError): continue
        xyz=radec_xyz(ra,dec,10**(dm/5+1))
        try: mv=float(r["apparent_magnitude_v"])-dm
        except ValueError: mv=-6
        gcs.append((*xyz,mv))
        nm=r.get("name","").strip()
        if nm in FAMOUS: mw_lm.append({"name":FAMOUS[nm][0],"pos":[round(v) for v in xyz],"desc":FAMOUS[nm][1]})
np.array(gcs,dtype=np.float32).tofile(OUT/"globulars.bin")
json.dump(mw_lm, open(OUT/"mw_landmarks.json","w"))

gals=[]
for f,host in [("dwarf_mw.csv","MW"),("dwarf_m31.csv","M31"),
               ("dwarf_local_field.csv","LF"),("dwarf_local_field_distant.csv","LV")]:
    for r in lvdb(f):
        try: ra,dec,dm=float(r["ra"]),float(r["dec"]),float(r["distance_modulus"])
        except (ValueError,KeyError): continue
        d=10**(dm/5+1)
        try: MV=float(r["apparent_magnitude_v"])-dm
        except ValueError: MV=-8
        try: rh=max(float(r["rhalf"])*math.pi/180/60*d,20)
        except ValueError: rh=200
        try: ell=min(max(float(r["ellipticity"]),0),0.85)
        except (ValueError,KeyError): ell=0.25
        try: pa=float(r["position_angle"])
        except (ValueError,KeyError): pa=0.0
        gals.append({"name":r.get("name","").strip(),"pos":[round(v) for v in radec_xyz(ra,dec,d)],
                     "MV":round(MV,1),"rh":round(rh),"host":host,"ell":round(ell,2),"pa":round(pa,1)})
for nm,ra,dec,dk,MV,rh in [("Andromeda (M31)",10.6847,41.2687,783,-21.5,6800),
                            ("Triangulum (M33)",23.4621,30.6599,869,-18.8,3000)]:
    gals.append({"name":nm,"pos":[round(v) for v in radec_xyz(ra,dec,dk*1000)],"MV":MV,"rh":rh,"host":"LG"})
json.dump(gals, open(OUT/"galaxies.json","w"))
want={'LMC','SMC','Sagittarius','Fornax','Sculptor','Leo I','NGC 6822','Andromeda (M31)',
      'Triangulum (M33)','IC 10','WLM','Draco','Sextans'}
json.dump([{"name":x["name"],"pos":x["pos"],"desc":""} for x in gals if x["name"] in want],
          open(OUT/"lg_landmarks.json","w"))

markers=[{"name":"Sun","pos":[0,0,0],"desc":"You are here"},
 {"name":"Orion complex","pos":[round(v) for v in lb_xyz(209,-19,414)],"desc":"M42 · Horsehead · Flame — 1350 ly"},
 {"name":"Taurus clouds","pos":[round(v) for v in lb_xyz(172,-15,140)],"desc":"Nearest large star-forming cloud"},
 {"name":"Ophiuchus","pos":[round(v) for v in lb_xyz(353,17,140)],"desc":"Rho Oph dark clouds"},
 {"name":"Perseus clouds","pos":[round(v) for v in lb_xyz(159,-20,300)],"desc":"NGC 1333 · IC 348"},
 {"name":"California Neb.","pos":[round(v) for v in lb_xyz(160,-12,470)],"desc":"NGC 1499 hydrogen cloud"},
 {"name":"Cepheus clouds","pos":[round(v) for v in lb_xyz(110,15,350)],"desc":"Cepheus flare region"},
 {"name":"Chamaeleon","pos":[round(v) for v in lb_xyz(300,-16,180)],"desc":"Southern dark clouds"},
 {"name":"Aquila Rift","pos":[round(v) for v in lb_xyz(28,3,250)],"desc":"Great Rift dust lane"}]
json.dump({"markers":markers,"stars":[]}, open(OUT/"markers.json","w"), indent=1)
# ---------- constellations (Stellarium modern skyculture, HIP -> 3D) ----------
print("constellations: Stellarium modern skyculture...")
NAMES={'And':'Andromeda','Ant':'Antlia','Aps':'Apus','Aqr':'Aquarius','Aql':'Aquila','Ara':'Ara','Ari':'Aries','Aur':'Auriga','Boo':'Bootes','Cae':'Caelum','Cam':'Camelopardalis','Cnc':'Cancer','CVn':'Canes Venatici','CMa':'Canis Major','CMi':'Canis Minor','Cap':'Capricornus','Car':'Carina','Cas':'Cassiopeia','Cen':'Centaurus','Cep':'Cepheus','Cet':'Cetus','Cha':'Chamaeleon','Cir':'Circinus','Col':'Columba','Com':'Coma Berenices','CrA':'Corona Australis','CrB':'Corona Borealis','Crv':'Corvus','Crt':'Crater','Cru':'Crux','Cyg':'Cygnus','Del':'Delphinus','Dor':'Dorado','Dra':'Draco','Equ':'Equuleus','Eri':'Eridanus','For':'Fornax','Gem':'Gemini','Gru':'Grus','Her':'Hercules','Hor':'Horologium','Hya':'Hydra','Hyi':'Hydrus','Ind':'Indus','Lac':'Lacerta','Leo':'Leo','LMi':'Leo Minor','Lep':'Lepus','Lib':'Libra','Lup':'Lupus','Lyn':'Lynx','Lyr':'Lyra','Men':'Mensa','Mic':'Microscopium','Mon':'Monoceros','Mus':'Musca','Nor':'Norma','Oct':'Octans','Oph':'Ophiuchus','Ori':'Orion','Pav':'Pavo','Peg':'Pegasus','Per':'Perseus','Phe':'Phoenix','Pic':'Pictor','Psc':'Pisces','PsA':'Piscis Austrinus','Pup':'Puppis','Pyx':'Pyxis','Ret':'Reticulum','Sge':'Sagitta','Sgr':'Sagittarius','Sco':'Scorpius','Scl':'Sculptor','Sct':'Scutum','Ser':'Serpens','Sex':'Sextans','Tau':'Taurus','Tel':'Telescopium','Tri':'Triangulum','TrA':'Triangulum Australe','Tuc':'Tucana','UMa':'Ursa Major','UMi':'Ursa Minor','Vel':'Vela','Vir':'Virgo','Vol':'Volans','Vul':'Vulpecula'}
sky = json.loads(get("https://raw.githubusercontent.com/Stellarium/stellarium/master/skycultures/modern/index.json"))
hyg_hip = {}
for r in csv.DictReader(get("https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv").decode().splitlines()):
    if not r["hip"]: continue
    try: d=float(r["dist"])
    except ValueError: continue
    if not (0<d<99999): continue
    g = R @ np.array([float(r["x"]),float(r["y"]),float(r["z"])])
    hyg_hip[int(float(r["hip"]))] = [round(g[0],2),round(g[1],2),round(g[2],2)]
segs=[]; cnames=[]
for c in sky["constellations"]:
    abbr=c["id"].split()[-1]; pts=[]
    for line in c["lines"]:
        for a,b in zip(line,line[1:]):
            pa,pb=hyg_hip.get(a),hyg_hip.get(b)
            if pa and pb: segs.append([pa,pb]); pts+= [pa,pb]
    if pts:
        cen=np.mean(np.array(pts,dtype=float),axis=0)
        cnames.append({"name":NAMES.get(abbr,abbr),"pos":[round(v,1) for v in cen]})
json.dump({"segs":segs,"names":cnames}, open(OUT/"constellations.json","w"))
print("done ->", OUT)

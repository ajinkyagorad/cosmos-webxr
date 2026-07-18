# COSMOS — WebXR Universe Explorer

**Live: [https://cosmos-webxr.pages.dev](https://cosmos-webxr.pages.dev)** — open on desktop, or in
the Meta Quest 3 browser for VR / passthrough AR.

A production-quality universe-exploration web app for **Meta Quest 3 (VR)**, **desktop**, and
**passthrough AR**, built on **real astronomy data** — no fabricated coordinates anywhere in the
real layers.

![Desktop view — solar system against the real Gaia DR2 sky](docs/screenshots/shot-desktop.png)
![FTL flight](docs/screenshots/shot-flight.png)
![Arrival at target](docs/screenshots/shot-arrival.png)

## Quick start

```bash
npm install
npm run dev        # http://localhost:7100 (host mode enabled for Quest browser on LAN)
```

Then open the URL and pick a mode: **Desktop**, **VR**, or **Passthrough AR**.

> WebXR requires HTTPS outside of `localhost`. For Quest 3 on your LAN, either use a
> tunneling service (e.g. `ngrok http 7100`) or deploy to any static HTTPS host.

## Build & deploy

```bash
npm run build      # → dist/ (static site)
npm run preview    # serve the production build locally
```

Deploy `dist/` to any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages…).
The app is fully static: all datasets and textures live under `public/` and are copied verbatim.

### Cloudflare Pages (one command)

The repo includes `wrangler.toml` (`pages_build_output_dir = "dist"`). With
[wrangler](https://developers.cloudflare.com/workers/wrangler/) authenticated
(`npx wrangler login` once):

```bash
npm run deploy     # builds dist/ and deploys to Cloudflare Pages
```

Or connect the GitHub repo in the Cloudflare dashboard (Pages → Connect to Git)
with build command `npm run build` and output directory `dist` for push-to-deploy CI.

Deep links: `?mode=desktop|vr|ar` skips the landing screen (VR/AR still needs a headset).

## Re-fetching the data

```bash
npm run fetch-data        # downloads everything into public/data + public/textures
node scripts/fetch-data.mjs stars,exoplanets   # or just some steps
```

`public/data/manifest.json` records source name, URL, retrieval date, object count, and license
for every dataset, including any fallbacks that were used.

## Data provenance

| Layer | Source | Count | Notes |
|---|---|---|---|
| Stars | [HYG Database v4.0](https://github.com/astronexus/HYG-Database) (Gaia-derived) | **70,659** | Filter: `dist ≤ 500 pc AND mag ≤ 9`, OR `mag ≤ 6.5` naked-eye. Interleaved Float32 `[x,y,z(pc), mag, B−V]` J2000; 400 brightest named stars labeled. |
| Exoplanets | [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/) TAP `ps` (default_flag=1) | **6,197** | Full confirmed-planet default parameter set with discovery method, radius/mass, period, host spectral type. |
| Deep-sky objects | [OpenNGC](https://github.com/mattiaverga/OpenNGC) | **10,640** | NGC/IC + Messier, mag ≤ 15. Distances included for well-known objects (curated published values). Embedded Messier fallback exists if OpenNGC is unreachable. |
| Sky backdrop | [ESA/Gaia DR2 all-sky, equirectangular](https://sci.esa.int/web/gaia/-/60196-gaia-s-sky-in-colour-equirectangular-projection) | 2000×1000 PNG | ESA/Gaia/DPAC, CC BY-SA 3.0 IGO. Fallbacks: Solar System Scope milky way → procedural. |
| Planet textures | [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0) | 13 files | 2k set incl. Earth day/night/normal (TIF→PNG converted), Saturn ring alpha. Procedural fallback per-texture. |
| Solar system constants | NASA Planetary Fact Sheets | 8 planets + Sun + Moon | Radii, semi-major axes, axial tilts, rotation/orbital periods (`src/data/solarSystemData.ts`). |
| Missions | NASA/ESA published mission data (curated) | 20 | ISS, Hubble, JWST, Gaia, SOHO, Voyager 1/2, Pioneer 10/11, New Horizons, Parker Solar Probe, Juno, Cassini, Perseverance, Curiosity, MAVEN, JUICE, Psyche, BepiColombo, Tiangong. Basis stated in `missions.json`. |
| Black holes / neutron stars | Published coordinates (curated) | 13 | Sgr A*, M87*, Cygnus X-1, Gaia BH1, Vela & Crab pulsars, SGR 1806-20 magnetar, … (`compact.json`). |

Total committed data: **≈ 11 MB** (well under the 60 MB budget).

The **Cinematic universes** layer (off by default) is the only fictional content: a segregated
far-offset region of stylized worlds, clearly marked `✦ … (fiction)` in UI, destinations, and
info panels. It never mixes into the real catalogs.

## Architecture

```
src/
  core/App.ts            Renderer (logarithmic depth), camera rig, XR session mgmt, floating origin
  data/                  Loaders, types, NASA solar-system constants
  scene/
    StarField.ts         70k stars: THREE.Points + shader (mag→size, B−V→blackbody, twinkle)
    MilkyWay.ts          Gaia skybox sphere + spiral galactic dust plane (real GC position)
    SolarSystem.ts       Textured planets, real tilts, Saturn ring, Earth day/night shader, Moon
    Exoplanets.ts        Points colored by discovery method
    DSOLayer.ts          10k DSOs: per-type procedural shaders (galaxy/nebula/PN/OC/GCl/SNR)
    CompactObjects.ts    Accretion-disk shader (BHs), rotating beams (pulsars) at real coords
    Missions.ts          Probes parented to real host bodies / heliocentric positions
    CinematicLayer.ts    Fictional overlay (segregated, off by default)
    Labels.ts            troika-three-text SDF labels (canvas-sprite fallback)
    Selection.ts         Angular ray-picking registry + 3D crosshair marker
  controls/
    Navigation.ts        Spaceship physics + REAL-travel FTL, speed caps, breadcrumbs, home
    DesktopControls.ts   Pointer lock, WASD, keys, arrival orientation
    XRControls.ts        Sticks/triggers/buttons, tap-vs-hold buttons, grab-drag, haptics
    HandControls.ts      Hand models, smoothed aim laser + cursor, pinch gestures
  audio/AudioEngine.ts   100% procedural WebAudio (hum, warp, beacon, generative pad)
  ui/                    Landing screen, desktop HUD, full wrist panel, settings store
scripts/fetch-data.mjs   Data pipeline (see above)
scripts/smoke-test.mjs   CDP-driven headless render/interaction/jump test
```

**Scale management & positional precision.** One world unit = 1 parsec in the galactic frame.
The solar system lives at the origin with its own base scale (1 AU = 0.02 units) plus user
exaggeration sliders for orbit distances and planet sizes. A **floating origin re-centers the
universe around the camera every 1 unit** — all rendered coordinates stay tiny, so float32
jitter never appears at any scale (planetary surfaces to Mpc), for every layer (stars, DSOs,
exoplanets, missions, labels) simultaneously. A logarithmic depth buffer plus local-frame speed
conversion (AU-scale near the Sun, pc-scale outside) completes the multiscale pipeline.

**Never get lost.** Speed is hard-capped (2·10⁴ units/s) and further soft-capped by proximity
to the nearest solid body, so you can't zoom into the void. **Return Home** (⌂ button, `Home`
key, hold `Y`, wrist panel) warps you back to the solar system from anywhere; a 20-entry
**breadcrumb** trail (`Backspace`, hold `X`, ⏮ button) backtracks. Jumps track moving targets
live and end with the ship oriented facing the destination. A collision floor at 1.05× radius
keeps you from falling through planets while still allowing near-surface approaches.

**FTL is real travel.** There is no fake warp animation: a jump accelerates the ship along the
real trajectory through the actual catalog star field (the HUD speed readout climbs to
thousands of c, stars genuinely stream past via real parallax), then decelerates on approach.

**Skybox behavior.** The Gaia all-sky map is double-sided with `depthTest:false` and renders
first, so it never occludes anything — inside or outside the sphere. It fades out beyond
~25–60 kpc so the procedural spiral disk (real galactic-plane orientation, core glow at the
true Sgr A* position) becomes the galaxy's visual. In passthrough AR the skybox is OFF by
default (toggleable in LAYERS).

**Skybox alignment.** The Gaia equirectangular map is wrapped on a sphere; with three.js
`SphereGeometry` mapping (`u = 0.5 − RA/2π`), the sphere is rotated −266.4° about Y so the
texture's galactic center sits at the real Sgr A* direction (RA 266.405°, Dec −29.008°).

## Controls & gestures

### Desktop
| Input | Action |
|---|---|
| Click canvas | Capture mouse (pointer lock); click again = select object under reticle |
| Mouse | Look |
| `W A S D` / `Q` `E` | Translate / down / up |
| `Shift` (hold) | Thrust boost |
| `Space` (hold) | Brake |
| Scroll | Adjust max thrust (log scale) |
| `J` (hold) | Charge & FTL-jump to selected target |
| `Home` | Return home (solar system) |
| `Backspace` | Backtrack (breadcrumb) |
| `O` / `N` | Toggle orbits / labels |
| `D` / `L` / `H` / `M` | Destinations / layers / help / mute |

HUD buttons: ⌂ home · ⏮ back · ? help · ✦ destinations · ☰ layers · ⚙ settings · ♪ mute.

### XR controllers
| Input | Action |
|---|---|
| Right stick | Smooth turn (snap-turn in settings) |
| Left stick | Translate / strafe |
| Right trigger | Thrust (analog) |
| Left trigger | Brake |
| `A` | Select object under ray |
| `B` | Jump to selected |
| `X` tap / hold | Toggle labels / **Back** (breadcrumb) |
| `Y` tap / hold | Toggle orbits / **Return Home** |
| Grip + pull | Grab & drag the universe |
| Left wrist | **Full panel**: speed/target, JUMP, BRAKE, HOME, BACK, destinations (paged), all layer toggles (incl. skybox), settings (vignette, snap turn, music, volume, elevation, planet size) |

Haptics: thrust rumble ∝ acceleration, jump-charge crescendo, UI hover ticks, arrival thump.

### Hand tracking (degrades gracefully to controllers)
| Gesture | Action |
|---|---|
| Aim | Visible hand models; smoothed wrist→middle-MCP ray with laser + cursor dot and angular magnetism |
| Pinch | Select under cursor / press panel button |
| Pinch-hold on panel | Detach panel to float in space / re-attach to wrist |
| Two-hand pinch & pull | Fly — pull space toward you (speed ∝ pull velocity) |
| Open palm | Gentle brake |

## Comfort

- Vignette during high speed (ON by default, also in VR)
- Snap-turn or smooth turn; turn-speed slider
- Seated/standing toggle
- All motion is pilot-initiated (no forced camera moves except the jump you trigger)

## Audio (all procedural — no files)

Engine hum pitch/volume follows real speed (it climbs through the jump) · warp charge riser +
whoosh · arrival thump · UI ticks · spatialized HRTF beacon ping on the selected target ·
optional **ambient generative music** — consonant major/minor triads only, 10–16 s attacks,
35–60 s chord changes with 20 s crossfades, warm lowpassed triangle+sine blend, ≤1 ¢ detune,
very low default level. Master volume + mute in settings (`M`) and on the wrist panel.

## Verification

`npm run build` and `npx tsc --noEmit` are both green. A CDP smoke test
(`node scripts/smoke-test.mjs`, requires Chrome) boots the app headlessly and verifies:
boot with zero console errors, a **jump round-trip** (Saturn → back to Earth, arrival within a
few radii, facing the destination), thrust approach with collision floor, galaxy-scale views at
100 pc / 1 kpc / 50 kpc, Return Home from 50 kpc, and breadcrumb Back (see
`docs/screenshots/`).

# Changelog

Versioning: pre-1.0 iterations (`0.x`) per field-test round; **v1.0** when the round-4
backlog in `FEEDBACK.md` is cleared and the app is stable on-device. Deployment is
automatic: every push to `main` builds and deploys via Cloudflare Pages.

## [0.5.0] — 2026-07-18 — Round 4
- Hands: real WebXR hand models (mesh) with a live-baked low-poly fallback; single ray per
  hand (Quest's synthesized hand-pointer on the controller slot no longer double-renders);
  warm-amber pointer beams/cursors distinct from environment lines; ONE haptic pulse per
  wrist-panel button-enter (source-aware hover with re-arm guard) — no more battery drain
- Wrist panel: volumetric "soft cuboid" buttons (rounded 3D bodies, per-button label faces,
  hover lifts +3 mm, press dips), gently curved panel face + solid backing slab
- Coordinate grid: three styles — Cartesian lattice / spherical shells / cylindrical rings —
  via segmented control (HUD settings + wrist panel); widened band radii so the grid is
  visible at every zoom inside each band
- Deep-sky distances FIXED: 6,745 OpenNGC galaxies cross-matched to 2MRS redshift distances
  (scripts/match_dso_2mrs.py, 1.5′ tolerance, median separation 0.002′); objects without any
  real distance are no longer rendered at a fake constant 50 kpc — the equidistant "shell"
  is gone. All named LVDB galaxies within 3 Mpc now labeled (nearest 150)
- Planets: texture cache + boot preload with landing-screen progress; materials always
  opaque and placeholder-backed until the 2k image arrives (no transparent/unrendered
  planets); Moon placed at its real geocentric distance relative to Earth (was double-
  counting Earth's orbit AND floored 80× out by the exaggerated-radius rule)
- Selection: true ray-sphere picking against rendered radii (planets selectable when the
  ray passes through them); hover info chip persists until you look >30° away, dwell on
  another object, or toggle off; exoplanet/star panels add Teq estimate, B−V color index,
  mission agency + status; "Object info panels" toggle
- Zoom: rate grows with distance from home (up to 4×) — Local Group reachable in seconds
- CMB: off by default; when enabled it fades in ONLY beyond ~0.2–0.6 Gpc from the Sun
  (deep intergalactic void), never while parked near an object
- Travel trails: sampled only during go-to warp journeys (object A → B), fine 1-px line,
  speed-colored cool → hot along the path, ~15 s fade; free movement leaves no trail
- Destinations grouped by data source (HUD headers + wrist list sorted with source shown)
- 2MRS sprites: soft gaussian glows (no pixel-quantized squares), ±20 % size jitter
- Distance dimming setting: None / Realistic (physical 1/d² flux, 10 pc reference) /
  Artificial (enhanced but readable) across stars, DSOs, LVDB galaxies, 2MRS
- Catalog galaxies: procedural morphology per galaxy (spiral / barred / elliptical /
  lenticular / irregular by seeded hash), detail rises as you approach

## [0.4.0] — 2026-07-18 — Round 3 (commit 9d8fff3, 9ca800d)
- Real-time JPL ephemeris for planets + Schlyter lunar theory; sim clock defaults to 1× real time, time-warp optional
- Real Quest Touch controller models (XRControllerModelFactory); capsule visuals removed; single collinear laser per pointer; hover-dwell labels
- Coordinate grid (AU/ly/kpc rings, auto-switching); go-to arrivals frame targets at ~30° apparent size
- Skybox fades past local bubble (400 pc → 3 kpc); Milky Way rebuilt with 2 major arms + spurs (Vallée/Reid geometry); galaxy brightness boost (default ON) + major-galaxy labels
- DSO distances: all 110 Messier + ~100 NGC/IC (published values)
- CMB shell (real WMAP 9-yr map) at 46.5 Gly; NFW dark-matter halo (labeled model); 2MRS cosmic web (42,724 galaxies)
- Travel trails (speed-colored, fading); cinematic red-orange theme; no glow blobs on non-stars

## [0.3.0] — 2026-07-18 — Atlas navigation (commit 20eee77)
- Navigation rebuilt: user-centric grab-the-universe model (damped easing, clamped log-scale zoom, grip grab 1:1, two-grip pinch-scale + twist), replacing inertial flight
- 7 atlas layers: Leike/Lallement dust volume (Local Bubble), Cepheids, globulars, Local Volume galaxies, constellations, star names, landmarks
- Git-connected Cloudflare Pages: push-to-deploy CI

## [0.2.0] — 2026-07-17 — Round 1 field-test fixes (commit 5308cb2)
- Precision (floating origin 1-unit recentering); never-get-lost (home, breadcrumbs, speed caps); jump round-trips + arrival orientation; planet close-approach
- Visible hands + controllers; hand-aim smoothing + ray magnetism; full wrist panel (4 tabs) + detachable floating mode; AR skybox off by default
- Real-journey FTL through the catalog; reworked generative music; Elite-style 3D crosshair marker; comfort vignette

## [0.1.0] — 2026-07-17 — Initial release (commit 0a241c4)
- Desktop / VR / passthrough-AR modes; 70,659 HYG stars, 6,197 exoplanets, 10,640 DSOs, Gaia DR2 sky, planet textures, missions, compact objects; cinematic layer; procedural audio; FTL jumps

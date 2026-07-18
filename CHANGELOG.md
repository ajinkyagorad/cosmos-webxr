# Changelog

Versioning: pre-1.0 iterations (`0.x`) per field-test round; **v1.0** when the round-4
backlog in `FEEDBACK.md` is cleared and the app is stable on-device. Deployment is
automatic: every push to `main` builds and deploys via Cloudflare Pages.

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

# COSMOS WebXR — User Field-Test Feedback Log

Running log of owner feedback from Quest 3 / desktop testing. Append-only: new rounds are
added at the bottom; nothing is removed. Status tags: ✅ done · 🚧 in progress · ⬜ open.

---

## Round 1 — first Quest 3 field test (2026-07-17)

1. ✅ Hand not visible when controlling; hands need full visual access so gestures can interface with the left-wrist dashboard.
2. ✅ Jumping far away then jumping back "doesn't come back" (jump round-trip broken).
3. ✅ Music is annoying — should be pleasant.
4. ✅ Zoom-out runs away beyond bounds, position lost → requires page refresh. Precision of all star positions is utmost.
5. ✅ Can't get near planets — approach stops far away; never see planets up close.
6. ✅ Passthrough: sky image is an opaque bubble — make transparent / add disable option.
7. ✅ Settings + jump panel missing from wrist dashboard; provide panel access; allow detaching panel to float in space.
8. ✅ Jump arrival doesn't orient the target in front of the headset — devise trajectory + orientation; "put user in the spacecraft" during travel.
9. ✅ FTL must be real movement through existing stars, not fake star animations — the journey matters.
10. ✅ Ending up outside the skybox → utter darkness; skybox must never obstruct objects inside or outside; continuous unobstructed view of all stars.
11. ✅ Galaxy group not visible; user gets lost in deep space (numerical issues suspected).
12. ✅ Hand pointing not accurate.
13. ✅ Use 3D crosshairs (cube of 8 inward-pointing triangles) for the selected star after arrival.

## Round 2 — controls verdict + reference example (2026-07-17/18)

14. ✅ "Second attempt failure — controlling and navigating got worse." Reference app provided (Fable5 nebula-gallery) with better control: user-centric grab-the-universe model, stick fly, stick-Y clamped zoom, grip grab 1:1, two-grip pinch-scale, eased motion, scale presets. → Navigation rebuilt on that model.
15. ✅ Reference's data pipeline (`extract_data.py`) offered as source: Leike/Lallement dust cube, HYG 60k, Cepheids (Skowron+2019), globulars (Harris+LVDB), Local Volume galaxies, starnames, landmarks, constellation lines. → Integrated as atlas layers.
16. ✅ Deployment flow: GitHub push → Cloudflare auto-build/deploy, NOT direct uploads.

## Round 3 — third field test (2026-07-18)

17. ✅ Pointers confusing: "capsule-based shitty pointers" → use real Quest controller models only.
18. ✅ Each pointer has 2 lines coming out — must be one clean laser indicating the aim point.
19. ✅ Hover on a star should activate its label (settings-based).
20. ✅ Deep-sky objects lack distances — add real distances.
21. ✅ Skybox map should fade/transparent outside the local bubble.
22. ✅ Add CMB at the edge of the universe.
23. ✅ Milky Way drawn with 4 equal arms — not true; update to correct structure.
24. ✅ Go-to should arrive so the object fills a sensible angular field of view (consistent apparent size), in front of the user.
25. ✅ Travel trail option: fading trail star-to-star, color-coded by spaceship speed.
26. ✅ No dark energy/dark matter map at galactic scales.
27. ✅ Galaxies too dim at intergalactic scales — brighten option ON by default.
28. ✅ UI theme → red-orange "rainbow" when cinematic (fictional) content enabled.
29. ✅ Solar system not scaled/placed properly; orbits wrongly placed — must be precise: real position, orientation, phase at current real time; real-time speed by default (time-warp optional); stars mostly stationary.
30. ✅ No glowing blobs for non-stars — suitable graphics per object type.
31. ✅ Cylindrical coordinate option on galactic (and smaller) scales; faint white glowing grid; units ly/pc (smaller units when small scales).

## Round 4 — fourth field test (2026-07-18, voice notes)

### Interaction & Input
32. ✅ Hand tracking renders as black spheres ("blobs") — show properly rendered hands (WebXR hand models).
33. ✅ Hand tracking emits TWO rays from one hand — must be a single pointing ray, consistent with controller behavior. (Controller ray is fine, steady, single.)
34. ✅ Pointer ray needs a distinct color/style to stand out from environmental lines.
35. ✅ Dashboard hover causes CONTINUOUS controller vibration — must be a single tactile pulse per button hover (battery drain).

### Dashboard & UI
36. ✅ Buttons are flat 2D — make volumetric "soft cuboid" buttons: depth, curved/rounded edges, stylish (not classic boxes). Dashboard itself could have depth.
37. ✅ Coordinate control should be a segmented 3-column button: Cartesian / Spherical / Cylindrical. Grid must render correctly at all zoom scales (cylindrical missing at some scales).

### Astronomical Data & Environment
38. ✅ Near Local Group, deep-sky "stars" (galaxies) appear EQUIDISTANT on a constant-radius sphere — radial distances wrong/ignored; fix projection.
39. ✅ Missing labels for nearby cataloged galaxies.
40. ✅ Zoom too slow at extreme distances — optimize rapid scale transitions.
41. ✅ CMB shell visible at close range — distracting; should auto-activate only at large scales (or be off by default) and hide near objects.
42. ⬜ Fictional planets (e.g. Tatooine) positional accuracy noted as placeholder; future: map against established coordinates.
43. ✅ Planet textures slow to load — pre-load locally and cache (few planets; reusable structures).
44. ✅ Planets stay transparent/unrendered even after texture load.
45. ✅ Moon not shown properly relative to Earth — improper positions (exaggeration mismatch).
46. ✅ Raycast fails to select a planet even when the ray is inside its radius.
47. ✅ Movement trails track the HEAD; should trace object-A → object-B trajectory only (go-to journeys, not local movement); too thick → fine line; color-scale by speed along the path.
48. ✅ Destinations lack data-source attribution — group destinations by catalog/provider.
49. ✅ SDSS/2MRS rendering appears as a non-planar "5x5 grid" of squares — verify spatial accuracy.
50. ✅ "Enable info" toggle for objects; exoplanet/star metadata panels (temperature, classification, surface/ground type).
51. ✅ Info panel disappears when user moves slightly — persist while object remains centered/focused.
52. ✅ Distance dimming — three modes: (1) None (current), (2) Realistic (physical magnitude — very faint), (3) Artificial (enhanced dimming with distance, e.g. galaxies).
53. ✅ Catalog galaxies lack visual depth — procedurally generate per-type visuals (spiral/elliptical/lenticular/irregular) with pseudo-random seeded params when approached/selected (no per-galaxy hand-authoring).

### Process
54. ✅ Keep a changelog; versionize releases (v1.0 not yet reached).

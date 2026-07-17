// Real solar-system constants from NASA Planetary Fact Sheets (standard published values).
// https://nssdc.gsfc.nasa.gov/planetary/factsheet/
// radii in km (volumetric mean), semi-major axis in AU, axial tilt in degrees,
// rotation period in hours (negative = retrograde), orbital period in days.

export interface PlanetDef {
  name: string;
  radiusKm: number;
  semiMajorAU: number;
  tiltDeg: number;
  rotationHours: number;
  orbitDays: number;
  texture: string; // file in public/textures/planets (may be missing → procedural fallback)
  fallbackHue: number;
  bump?: string; // optional bump/normal map
  night?: string; // optional night lights
  ring?: { texture: string; innerKm: number; outerKm: number };
  moons?: { name: string; radiusKm: number; distKm: number; texture: string }[];
}

export const SUN = {
  name: "Sun",
  radiusKm: 695700,
  texture: "2k_sun.jpg",
  fallbackHue: 0.09,
};

export const PLANETS: PlanetDef[] = [
  { name: "Mercury", radiusKm: 2439.7, semiMajorAU: 0.387, tiltDeg: 0.03, rotationHours: 1407.6, orbitDays: 88, texture: "2k_mercury.jpg", fallbackHue: 0.08 },
  {
    name: "Venus", radiusKm: 6051.8, semiMajorAU: 0.723, tiltDeg: 177.4, rotationHours: -5832.5, orbitDays: 224.7,
    texture: "2k_venus_surface.jpg", fallbackHue: 0.1,
  },
  {
    name: "Earth", radiusKm: 6371, semiMajorAU: 1.0, tiltDeg: 23.44, rotationHours: 23.9, orbitDays: 365.25,
    texture: "2k_earth_daymap.jpg", fallbackHue: 0.58, bump: "2k_earth_normal_map.png", night: "2k_earth_nightmap.jpg",
    moons: [{ name: "Moon", radiusKm: 1737.4, distKm: 384400, texture: "2k_moon.jpg" }],
  },
  { name: "Mars", radiusKm: 3389.5, semiMajorAU: 1.524, tiltDeg: 25.19, rotationHours: 24.6, orbitDays: 687, texture: "2k_mars.jpg", fallbackHue: 0.05, bump: "2k_mars.jpg" },
  { name: "Jupiter", radiusKm: 69911, semiMajorAU: 5.204, tiltDeg: 3.13, rotationHours: 9.9, orbitDays: 4331, texture: "2k_jupiter.jpg", fallbackHue: 0.09 },
  {
    name: "Saturn", radiusKm: 58232, semiMajorAU: 9.537, tiltDeg: 26.73, rotationHours: 10.7, orbitDays: 10747,
    texture: "2k_saturn.jpg", fallbackHue: 0.12,
    ring: { texture: "2k_saturn_ring_alpha.png", innerKm: 66900, outerKm: 136775 },
  },
  { name: "Uranus", radiusKm: 25362, semiMajorAU: 19.19, tiltDeg: 97.77, rotationHours: -17.2, orbitDays: 30589, texture: "2k_uranus.jpg", fallbackHue: 0.5 },
  { name: "Neptune", radiusKm: 24622, semiMajorAU: 30.07, tiltDeg: 28.32, rotationHours: 16.1, orbitDays: 59800, texture: "2k_neptune.jpg", fallbackHue: 0.62 },
];

export const KM_PER_AU = 149597870.7;

// Cosmic microwave background shell (D13): real NASA/WMAP 9-year map, reprojected
// to equirectangular offline (scripts/fetch_cmb.py), on a sphere at the comoving
// distance of the surface of last scattering, 46.5 Gly = 1.4257e10 pc.
// Never occludes: depthTest off, painted right after the skybox. Fades in only
// once the user zooms far enough out that the shell is inside the far plane.
import * as THREE from "three";
import type { Updatable } from "../core/App";

export const CMB_RADIUS_PC = 46.5e9 / 3.26156; // 46.5 Gly → pc (comoving)
// Same texture-convention yaw as the Milky Way skybox: map center (u=0.5, the
// galactic-center direction in the WMAP galactic-coordinate map) faces the GC.
const _baseQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(-266.4), 0));

export class CMBLayer implements Updatable {
  mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  /** Wired by main after Navigation exists: returns the current eased log scale. */
  getLog: () => number = () => 2.1;
  /** Layer toggle (settings "layerCMB", default ON). */
  enabled = true;

  constructor() {
    const tex = new THREE.TextureLoader().load(
      "/textures/cmb.jpg",
      undefined,
      undefined,
      () => {
        // Procedural fallback (manifest notes when the real map is absent).
        tex.image = proceduralCMBTexture().image;
        tex.needsUpdate = true;
      },
    );
    tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.MeshBasicMaterial({
      map: tex, side: THREE.DoubleSide, depthWrite: false, depthTest: false,
      transparent: true, opacity: 0, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(CMB_RADIUS_PC, 64, 48), this.mat);
    this.mesh.quaternion.copy(_baseQ);
    this.mesh.renderOrder = -99; // after skybox (-100), before all data layers
    this.mesh.frustumCulled = false;
  }

  update(_dt: number, _t: number): void {
    // The shell is 1.4e10 pc away — beyond the far plane until log ≲ −1.5.
    // Fade 0 → 1 across log −1.5 → −2.5 so it never pops.
    const log = this.getLog();
    const fade = 1 - THREE.MathUtils.smoothstep(log, -2.5, -1.5);
    this.mat.opacity = this.enabled ? fade : 0;
    this.mesh.visible = this.mat.opacity > 0.003;
  }
}

/** Procedural 2.725 K speckle fallback if the real map file is missing. */
function proceduralCMBTexture(): THREE.CanvasTexture {
  const w = 1024, h = 512;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0a2a6e"; // ~2.725 K baseline blue
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26000; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const r = 1 + Math.random() * Math.random() * 7;
    const warm = Math.random() > 0.5;
    g.fillStyle = warm
      ? `rgba(255,${90 + (Math.random() * 80) | 0},40,${0.10 + Math.random() * 0.22})`
      : `rgba(30,${90 + (Math.random() * 60) | 0},255,${0.10 + Math.random() * 0.22})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

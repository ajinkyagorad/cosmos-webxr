// Texture loading helpers with procedural fallbacks (used when a fetch failed).
import * as THREE from "three";

const texLoader = new THREE.TextureLoader();

/** Load a texture; on error, generate a procedural stand-in so the app always renders. */
export function loadTextureWithFallback(
  url: string,
  fallback: () => THREE.Texture,
  onFail?: () => void,
): THREE.Texture {
  const tex = texLoader.load(
    url,
    undefined,
    undefined,
    () => {
      onFail?.();
      const fb = fallback();
      tex.image = fb.image;
      tex.needsUpdate = true;
    },
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Procedural planet-ish texture (banded noise) as last-resort fallback. */
export function proceduralPlanetTexture(baseHue: number): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 256;
  const g = c.getContext("2d")!;
  const img = g.createImageData(512, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 512; x++) {
      const lat = (y / 256) * Math.PI;
      const n =
        Math.sin(x * 0.05 + Math.sin(y * 0.11) * 3) * 0.5 +
        Math.sin(y * 0.13 + Math.sin(x * 0.02) * 2) * 0.3 +
        Math.sin((x + y) * 0.021) * 0.2;
      const band = Math.sin(lat * 6 + n) * 0.5 + 0.5;
      const hue = baseHue + n * 0.03;
      const light = 0.25 + band * 0.35;
      const [r, gg, b] = hslToRgb(hue, 0.45, light);
      const i = (y * 512 + x) * 4;
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft radial sprite texture (for glows, markers). */
export function radialSpriteTexture(inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)"): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Dark-edged vignette texture for motion comfort. */
export function vignetteTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(128, 128, 40, 128, 128, 128);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.55, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,1)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

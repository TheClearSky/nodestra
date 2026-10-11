// COPIED from .claude/pages/ad/experiments/hell-src/scene/sky-ramp.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Sky colour ramps for the scene's sky class. The ramp writer is COPIED from
 * hell-04-sky-dome.ts (that file is the owner's experiment and stays
 * untouched): hex stops mixed in OKLab on the CPU into a 256-texel half-float
 * ramp (horizon → zenith). The stops themselves now come from the scene
 * palette (scene/palette.ts); the OKLab helpers below derive tones from it
 * (the sky, clouds, dunes and post classes share them).
 */

import * as THREE from 'three';

export type Stop = { t: number; hex: string };

export function toOklab(c: THREE.Color): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b);
  const m = Math.cbrt(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b);
  const s = Math.cbrt(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function fromOklab([L, a, b]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** An empty 256x1 half-float ramp texture (linear colour). */
export function makeRampTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint16Array(256 * 4), 256, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  return tex;
}

/** Fill the ramp from hex stops (mixed in OKLab). */
export function writeRamp(tex: THREE.DataTexture, stops: Stop[]) {
  const data = tex.image.data as Uint16Array;
  const labs = stops.map((s) => toOklab(new THREE.Color(s.hex)));
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1].t) k++;
    const a = stops[k];
    const b = stops[k + 1];
    const f = THREE.MathUtils.clamp((t - a.t) / Math.max(b.t - a.t, 1e-6), 0, 1);
    const lab = labs[k].map((v, j) => v + (labs[k + 1][j] - v) * f) as [number, number, number];
    const rgb = fromOklab(lab);
    data[i * 4] = THREE.DataUtils.toHalfFloat(rgb[0]);
    data[i * 4 + 1] = THREE.DataUtils.toHalfFloat(rgb[1]);
    data[i * 4 + 2] = THREE.DataUtils.toHalfFloat(rgb[2]);
    data[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  tex.needsUpdate = true;
}

// ── palette-derived tones (OKLab, so a darker / mixed tone keeps its hue) ──

const lin = (hex: string) => new THREE.Color(hex);
const toHex = (rgb: [number, number, number]) => '#' + new THREE.Color(rgb[0], rgb[1], rgb[2]).getHexString();

/** a → b in OKLab, t in 0..1 (sRGB hex in and out). */
export function okMix(a: string, b: string, t: number): string {
  const A = toOklab(lin(a));
  const B = toOklab(lin(b));
  return toHex(fromOklab([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]));
}

/** The same hue at `k` × its OKLab lightness (and `c` × its chroma). */
export function okShade(hex: string, k: number, c = 1): string {
  const [L, a, b] = toOklab(lin(hex));
  return toHex(fromOklab([L * k, a * c, b * c]));
}

/** A colour with the HUE of `hex` at OKLab lightness L and chroma C. */
export function okHue(hex: string, L: number, C: number): string {
  const [, a, b] = toOklab(lin(hex));
  const h = Math.atan2(b, a);
  const has = Math.hypot(a, b) > 1e-4;
  return toHex(fromOklab([L, has ? Math.cos(h) * C : 0, has ? Math.sin(h) * C : 0]));
}

/** sRGB (display) components of a hex, for display-referred shaders. */
export function srgbVec(hex: string, target = new THREE.Vector3()): THREE.Vector3 {
  const n = parseInt(hex.replace('#', ''), 16);
  return target.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

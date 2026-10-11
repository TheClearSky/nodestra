// COPIED from .claude/pages/ad/experiments/hell-src/hell-05-clouds-glsl.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-05 shared cloud shading: palettes, one lighting model used by every
 * cloud family (puffs, slab, ribbons, strata, veils, wisps) so the variants
 * stay comparable, and the deck height field shared by the slab and the
 * matched shadows.
 *
 * Lighting model (research T12):
 *   colour = hue-shifted ramp(lit)          deep → belly → mid → top
 *          + ground bounce on the underside (Eva's red-ground trick)
 *          + silver lining (Henyey-Greenstein toward the hidden sun)
 *          + magic-circle light / glyph print, lightning, storm seams
 *   then fog toward the grade's fog colour (never grey).
 */

import * as THREE from 'three';

export type CloudPalette = {
  label: string;
  top: string;
  mid: string;
  belly: string;
  deep: string;
  /** Light bounced up from the ground into the bellies. */
  bounce: string;
  /** Hue of the cloud shadows on the dunes. */
  shadow: string;
};

/** Measured palettes from MOODBOARD §2.5 plus the crimson night of the owner's sky. */
export const CLOUD_PALETTES: Record<string, CloudPalette> = {
  amber: { label: 'Amber steam', top: '#c08e66', mid: '#9a6338', belly: '#623720', deep: '#3b261a', bounce: '#8a2a14', shadow: '#5e1a0f' },
  evaPink: { label: 'Eva pink', top: '#ecf8f4', mid: '#cecce2', belly: '#c17991', deep: '#8a5a78', bounce: '#c81c2a', shadow: '#82001e' },
  dusk: { label: 'Dusk deck', top: '#e4d1e1', mid: '#cab4c6', belly: '#7e79ad', deep: '#4c4b83', bounce: '#9a4a6a', shadow: '#4c4b83' },
  toxic: { label: 'Toxic sea', top: '#b5bbb2', mid: '#7d857f', belly: '#515a56', deep: '#2e3635', bounce: '#5a4a2a', shadow: '#2e3635' },
  crimson: { label: 'Crimson night', top: '#c0463a', mid: '#7a1c22', belly: '#3a1a3f', deep: '#14050c', bounce: '#9a1410', shadow: '#3a0814' },
};

/** Black storm body; the seams carry the colour. */
export const STORM_PALETTE: Omit<CloudPalette, 'label'> = {
  top: '#4a1a1e',
  mid: '#25090f',
  belly: '#16060c',
  deep: '#070205',
  bounce: '#5a0a0a',
  shadow: '#12040a',
};

export type CloudUniforms = ReturnType<typeof makeCloudUniforms>;

export function makeCloudUniforms(fogColor: THREE.Color) {
  return {
    uTop: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uBelly: { value: new THREE.Color() },
    uDeep: { value: new THREE.Color() },
    uBounce: { value: new THREE.Color() },
    /** Same Color instance as the scene fog, so grade switches follow. */
    uFogCol: { value: fogColor },
    uFogDen: { value: 0.0011 },
    /** 0 plain, 1 ground bounce, 2 + circle glow, 3 + glyph print, 4 + deck parting. */
    uLightMode: { value: 0 },
    /** The magic circle hangs high over the deck, left of the pillar. */
    uCircleC: { value: new THREE.Vector3(-150, 200, 120) },
    uCircleR: { value: 54 },
    uCircleCol: { value: new THREE.Color('#ff2a14') },
    /** 0 off, 1 ridged seams, 2 Worley cracks, 3 lobe crevices, 4 cracks + lightning. */
    uStorm: { value: 0 },
    uHot: { value: 3.2 },
    uEmber: { value: new THREE.Color('#ff3a14') },
    uFlash: { value: 0 },
    uFlashPos: { value: new THREE.Vector3() },
    /** 0 soft, 1 frayed, 2 crisp, 3 scallop, 4 crisp-with-distance. */
    uEdgeMode: { value: 3 },
    /** Cloud time: drift clock that the Motion group can slow or speed. */
    uCT: { value: 0 },
    // Deck height field (slab sea + matched shadows).
    uY0: { value: 16 },
    uY1: { value: 52 },
    uCover: { value: 0.5 },
    uDeckOff: { value: new THREE.Vector2() },
  };
}

export function setPalette(cu: CloudUniforms, p: Omit<CloudPalette, 'label'>) {
  cu.uTop.value.set(p.top);
  cu.uMid.value.set(p.mid);
  cu.uBelly.value.set(p.belly);
  cu.uDeep.value.set(p.deep);
  cu.uBounce.value.set(p.bounce);
}

/** Needs ENV_GLSL first. Declares the cloud uniforms and the shading model. */
export const CLOUD_GLSL = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uBelly;
uniform vec3 uDeep;
uniform vec3 uBounce;
uniform vec3 uFogCol;
uniform float uFogDen;
uniform float uLightMode;
uniform vec3 uCircleC;
uniform float uCircleR;
uniform vec3 uCircleCol;
uniform float uStorm;
uniform float uHot;
uniform vec3 uEmber;
uniform float uFlash;
uniform vec3 uFlashPos;
uniform float uEdgeMode;
uniform float uCT;
uniform float uCel;
// 1 on cloud bodies (puffs, slab, collar) that may carry storm cracks.
uniform float uSeams;

// The clouds' key light: the hidden sun lifted toward the zenith, so tops
// read lit while the camera-facing sides stay in hue-shifted shade.
vec3 cloudKey() { return normalize(vec3(uSunDir.x * 0.6, 0.85, uSunDir.z * 0.6)); }

// Hue-shifted ramp: shade changes hue, not just value (MOODBOARD rule).
vec3 cloudRamp(float l) {
  if (uCel > 0.5) {
    vec3 c = mix(uDeep, uBelly, smoothstep(0.355, 0.37, l));
    c = mix(c, mix(uMid, uTop, 0.55), smoothstep(0.655, 0.67, l));
    return c;
  }
  vec3 c = mix(uDeep, uBelly, smoothstep(0.0, 0.4, l));
  c = mix(c, uMid, smoothstep(0.35, 0.7, l));
  return mix(c, uTop, smoothstep(0.65, 1.0, l));
}

float hgPhase(float g, float mu) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}

// A cheap summoning circle: three rings, turning rune ticks, a hexagram.
// q is in circle units (1 = outer ring).
float sigil(vec2 q, float t) {
  float r = length(q);
  if (r > 1.03) return 0.0;
  float a = atan(q.y, q.x);
  float w = 0.014;
  float g = smoothstep(w * 1.8, 0.0, abs(r - 0.97)) + smoothstep(w, 0.0, abs(r - 0.84)) + smoothstep(w, 0.0, abs(r - 0.52));
  float cells = 40.0;
  float ar = (a + t * 0.12) / 6.2832 * cells;
  float cell = floor(ar);
  float tick = step(0.25, fract(ar)) * step(fract(ar), 0.7) * step(0.35, hash12(vec2(cell, 3.0)));
  float runeH = mix(0.012, 0.04, hash12(vec2(cell, 9.0)));
  g += tick * step(abs(r - 0.905), runeH);
  float rot = -t * 0.08;
  for (int k = 0; k < 6; k++) {
    float th = rot + float(k) * 1.0472;
    float d = abs(dot(q, vec2(cos(th), sin(th))) - 0.42);
    g += smoothstep(w, 0.0, d) * step(r, 0.84);
  }
  return clamp(g, 0.0, 1.0);
}

// Light from the magic circle hanging over the deck (Light group).
vec3 circleLight(vec3 p, vec3 n) {
  if (uLightMode < 1.5) return vec3(0.0);
  vec3 toC = uCircleC - p;
  float d = length(toC);
  float lam = 0.35 + 0.65 * max(dot(n, toC / d), 0.0);
  vec2 rel = (p.xz - uCircleC.xz) / uCircleR;
  // Soft falloff with height: the deck ~190 u below still gets ~40 %.
  float vfall = exp(-abs(toC.y) / 220.0);
  float pool = 1.0 - smoothstep(0.2, 2.4, length(rel));
  vec3 L = uCircleCol * lam * pool * vfall * 2.6;
  // The sigil printed straight down onto the cloud tops (faces that look up).
  if (uLightMode > 2.5) L += uCircleCol * sigil(rel, uTime) * vfall * 3.0 * smoothstep(-0.2, 0.5, n.y);
  return L;
}

// Deck opening under the circle (Light = parting); swirls slowly.
float partMask(vec2 xz) {
  if (uLightMode < 3.5) return 1.0;
  vec2 rel = xz - uCircleC.xz;
  float r = length(rel) / uCircleR;
  float a = atan(rel.y, rel.x);
  float swirl = 0.12 * sin(a * 3.0 + 2.5 / (r + 0.3) - uTime * 0.25);
  return smoothstep(0.75, 1.2, r + swirl);
}

vec2 worley2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash22(i + g);
      o = 0.5 + 0.42 * sin(uCT * 0.08 + 6.2831 * o);
      float d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return vec2(f1, f2);
}

// Crimson tears in black storm clouds; only on the shaded underside/core.
vec3 stormSeams(vec3 p, float r, float lit) {
  if (uStorm < 0.5 || uSeams < 0.5) return vec3(0.0);
  vec2 q = p.xz * 0.025 + vec2(p.y * 0.04, -p.y * 0.02);
  float mode = uStorm > 3.5 ? 2.0 : uStorm;
  float seam;
  if (mode < 1.5) {
    float ridge = 1.0 - abs(2.0 * vnoise(q * 1.6 + uCT * 0.03) - 1.0);
    seam = pow(ridge, 16.0);
  } else if (mode < 2.5) {
    vec2 f = worley2(q * 1.3);
    seam = 1.0 - smoothstep(0.0, 0.07, f.y - f.x);
  } else {
    seam = smoothstep(0.8, 0.98, r);
  }
  seam *= 1.0 - smoothstep(0.3, 0.62, lit);
  float flick = 0.7 + 0.3 * vnoise(vec2(uTime * 2.3, p.x * 0.02 + p.z * 0.01));
  return uEmber * seam * uHot * flick;
}

vec3 flashLight(vec3 p, vec3 n) {
  if (uFlash < 0.001) return vec3(0.0);
  vec3 toF = uFlashPos - p;
  float d2 = dot(toF, toF);
  float lam = 0.3 + 0.7 * max(dot(n, normalize(toF)), 0.0);
  return vec3(1.0, 0.42, 0.5) * uFlash * lam * 3.0 / (1.0 + d2 * 0.00003);
}

vec3 cloudColour(vec3 p, vec3 n, float lit, float r, float thin) {
  vec3 c = cloudRamp(lit);
  if (uLightMode > 0.5) {
    // Ground bounce tints the bellies (Eva's pink bellies over red ground).
    float down = clamp(-n.y * 0.6 + 0.4, 0.0, 1.0);
    c = mix(c, c * 0.45 + uBounce * 0.75, down * (1.0 - lit) * 0.9);
  }
  c += uAmbient * 0.04;
  vec3 v = normalize(p - cameraPosition);
  c += uSunColor * hgPhase(0.72, dot(v, uSunDir)) * thin * 0.9;
  c += circleLight(p, n) + flashLight(p, n) + stormSeams(p, r, lit);
  return c;
}

vec3 cloudFog(vec3 c, vec3 p) {
  float d = length(p - cameraPosition) * uFogDen;
  return mix(c, uFogCol, 1.0 - exp(-d * d));
}
`;

/** Needs ENV_GLSL + CLOUD_GLSL first. The deck height field. */
export const DECK_GLSL = /* glsl */ `
uniform float uY0;
uniform float uY1;
uniform float uCover;
uniform vec2 uDeckOff;
float deckField(vec2 xz) {
  vec2 q = xz * 0.0055 + uDeckOff;
  vec2 w = vec2(vnoise(q * 0.7 + 1.7), vnoise(q * 0.7 + 8.3)) - 0.5;
  return fbm3(q + w * 1.3);
}
float deckTop(vec2 xz) {
  float f = smoothstep(uCover, uCover + 0.3, deckField(xz)) * partMask(xz);
  // Small billows on top of the big masses.
  float b = vnoise(xz * 0.03 + uDeckOff * 4.0);
  return uY0 + (uY1 - uY0) * f * (0.8 + 0.35 * b);
}
`;

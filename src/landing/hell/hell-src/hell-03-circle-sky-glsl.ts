// COPIED from .claude/pages/ad/experiments/hell-src/hell-03-circle-sky-glsl.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-03 shared GLSL: the magic-circle pattern, how a circle is shaded
 * (glow, ink, aerial haze), the red light a circle casts on clouds and
 * ground (a "cookie"), and the cloud fields every material samples.
 *
 * Every carrier (world quad, sky-dome decal, screen overlay) calls the SAME
 * `circlePattern()` + `shadeCircle()`, so the carriers can be compared like
 * for like. Needs ENV_GLSL (lab.ts) before it.
 */

import * as THREE from 'three';

/** Circle look uniforms shared by every material on the page. */
export type CircleUniforms = {
  uLine: { value: THREE.Color };
  uEmber: { value: THREE.Color };
  uCoreHot: { value: THREE.Vector3 };
  uGlowCol: { value: THREE.Color };
  uGlowMode: { value: number };
  uGlowAmt: { value: number };
  uCircleFog: { value: number };
  // the circles that cast light (first four of the layout)
  uLC: { value: THREE.Vector3[] };
  uLN: { value: THREE.Vector3[] };
  uLU: { value: THREE.Vector3[] };
  uLV: { value: THREE.Vector3[] };
  uLP: { value: THREE.Vector4[] };
  uLCount: { value: number };
  uLightAmb: { value: number };
  uLightCookie: { value: number };
  uLightCol: { value: THREE.Color };
  // the cloud slab (a ring/sea of cloud around the pillar)
  uSlabY0: { value: number };
  uSlabY1: { value: number };
  uSlabInner: { value: number };
  uSlabOuter: { value: number };
  uSlabCover: { value: number };
  uSlabCentre: { value: THREE.Vector2 };
  uSlabOn: { value: number };
  /** Tileable fbm generated in code: r = fbm, g/b = warp/detail fbm. */
  tNoise: { value: THREE.Texture };
};

export function makeCircleUniforms(): CircleUniforms {
  const v3 = () => Array.from({ length: 4 }, () => new THREE.Vector3());
  return {
    uLine: { value: new THREE.Color('#5a0a10') },
    uEmber: { value: new THREE.Color('#ff4a2a') },
    uCoreHot: { value: new THREE.Vector3(3.2, 0.7, 0.4) },
    uGlowCol: { value: new THREE.Color('#ff2a1a') },
    uGlowMode: { value: 0 },
    uGlowAmt: { value: 1 },
    uCircleFog: { value: 0.00035 },
    uLC: { value: v3() },
    uLN: { value: v3() },
    uLU: { value: v3() },
    uLV: { value: v3() },
    uLP: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
    uLCount: { value: 0 },
    uLightAmb: { value: 1 },
    uLightCookie: { value: 0 },
    uLightCol: { value: new THREE.Color('#ff3020') },
    uSlabY0: { value: 85 },
    uSlabY1: { value: 140 },
    uSlabInner: { value: 0 },
    uSlabOuter: { value: 400 },
    uSlabCover: { value: 0.45 },
    uSlabCentre: { value: new THREE.Vector2(0, -340) },
    uSlabOn: { value: 0 },
    tNoise: { value: makeNoiseTexture() },
  };
}

/**
 * A 256² tileable value-noise fbm, generated in code once (no image files).
 * Sampling it replaces 3–5 ALU noise calls per cloud pixel: the cloud
 * slices and bank cards are the page's biggest fill cost.
 */
function makeNoiseTexture(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const hash = (x: number, y: number, s: number) => {
    let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const vnoise = (x: number, y: number, period: number, s: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const w = (v: number) => ((v % period) + period) % period;
    const a = hash(w(xi), w(yi), s);
    const b = hash(w(xi + 1), w(yi), s);
    const c = hash(w(xi), w(yi + 1), s);
    const d = hash(w(xi + 1), w(yi + 1), s);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  const fbm = (px: number, py: number, base: number, s: number) => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (let o = 0; o < 4; o++) {
      const period = base << o;
      sum += amp * vnoise((px / size) * period, (py / size) * period, period, s + o * 17);
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = Math.round(fbm(x, y, 8, 1) * 255);
      data[i + 1] = Math.round(fbm(x, y, 8, 2) * 255);
      data[i + 2] = Math.round(fbm(x, y, 16, 3) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export const CIRCLE_GLSL = /* glsl */ `
#define PI 3.14159265
#define TAU 6.28318531
uniform vec3 uLine;
uniform vec3 uEmber;
uniform vec3 uCoreHot;
uniform vec3 uGlowCol;
uniform float uGlowMode;
uniform float uGlowAmt;
uniform float uCircleFog;

vec2 rot2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Phone-wire anti-aliasing: never thinner than ~1.5 px; thinner wanted
// strokes FADE instead of breaking into dashes (grazing ellipses).
float aaStroke(float d, float halfW, float px) {
  float w = max(halfW, px * 0.75);
  float a = 1.0 - smoothstep(w - px, w + px, abs(d));
  return a * (halfW / w);
}

float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// Distance to the edges of a {n/k} star polygon of circumradius R.
// Fold to the nearest chord normal, test that chord and its neighbours.
float starDist(vec2 p, float n, float k, float R) {
  float sector = TAU / n;
  float ai = floor(atan(p.y, p.x) / sector + 0.5);
  float d0 = R * cos(PI * k / n);
  float hl = R * sin(PI * k / n);
  vec2 q0 = rot2(p, -ai * sector);
  vec2 cs = vec2(cos(sector), sin(sector));
  // neighbours: rotate by -sector (forward) and +sector (back), incrementally
  vec2 qa = q0;
  vec2 qb = q0;
  float best = length(vec2(q0.x - d0, max(abs(q0.y) - hl, 0.0)));
  for (int j = 0; j < 2; j++) {
    qa = vec2(cs.x * qa.x + cs.y * qa.y, -cs.y * qa.x + cs.x * qa.y);
    qb = vec2(cs.x * qb.x - cs.y * qb.y, cs.y * qb.x + cs.x * qb.y);
    best = min(best, length(vec2(qa.x - d0, max(abs(qa.y) - hl, 0.0))));
    best = min(best, length(vec2(qb.x - d0, max(abs(qb.y) - hl, 0.0))));
  }
  return best;
}

// One rune: a spine plus strokes picked by the hash bits. q in uv units,
// box half-size (w, h).
float glyphDist(vec2 q, vec2 box, float h) {
  vec2 s = box;
  float d = sdSeg(q, vec2(0.0, -s.y), vec2(0.0, s.y));
  float b1 = step(0.5, fract(h * 2.0));
  float b2 = step(0.5, fract(h * 4.0));
  float b3 = step(0.5, fract(h * 8.0));
  float b4 = step(0.5, fract(h * 16.0));
  float b5 = step(0.5, fract(h * 32.0));
  d = min(d, sdSeg(q, vec2(-s.x, s.y), vec2(s.x, s.y)) + (1.0 - b1) * 9.0);
  d = min(d, sdSeg(q, vec2(-s.x, -s.y), vec2(s.x, -s.y)) + (1.0 - b2) * 9.0);
  d = min(d, sdSeg(q, vec2(-s.x, s.y), vec2(s.x, 0.0)) + (1.0 - b3) * 9.0);
  d = min(d, sdSeg(q, vec2(-s.x, 0.0), vec2(s.x, -s.y)) + (1.0 - b4) * 9.0);
  d = min(d, abs(length(q - vec2(0.0, s.y * 0.2)) - s.x * 0.5) + (1.0 - b5) * 9.0);
  return d;
}

/**
 * The magic circle. uv: circle-plane coords, |uv| = 1 is the outer rim.
 * pxR = one pixel in uv units ACROSS the rings, pxD = for other strokes.
 * Returns x = fine detail cover, y = core stroke cover (outer ring, star),
 * z = distance to the nearest core stroke (for analytic glow), w = black-sun fill.
 */
vec4 circlePattern(vec2 uv, float pxR, float pxD, float t, float seed, float blackSun) {
  float r = length(uv);
  float detail = 0.0;
  float core = 0.0;
  float dCore = 1e5;
  // The seed picks the design: star points, rune count.
  float hs = fract(seed * 0.6180339 + 0.13);
  float n = hs < 0.2 ? 5.0 : (hs < 0.4 ? 6.0 : (hs < 0.6 ? 7.0 : (hs < 0.8 ? 8.0 : 12.0)));
  float k = n < 6.5 ? 2.0 : (n < 8.5 ? 3.0 : 5.0);
  float cells = 2.0 * floor(12.0 + fract(seed * 0.37) * 8.0); // even: atan seam lands on a cell border

  // Outer ring (core) and its thin twin.
  float d = abs(r - 1.0) - 0.010;
  core = max(core, aaStroke(r - 1.0, 0.010, pxR));
  dCore = min(dCore, max(d, 0.0));
  detail = max(detail, aaStroke(r - 0.955, 0.0035, pxR));
  detail = max(detail, aaStroke(r - 0.905, 0.003, pxR));

  // Outer layer turns slowly one way: ticks + rune band.
  vec2 ua = rot2(uv, t * 0.05);
  float aA = atan(ua.y, ua.x);
  if (r > 0.955 && r < 1.0) {
    float ft = (fract(aA / TAU * 120.0) - 0.5) * TAU * r / 120.0; // arc length, not angle
    detail = max(detail, aaStroke(ft, 0.0022, pxD) * smoothstep(0.962, 0.97, r) * smoothstep(0.995, 0.987, r));
  }
  if (r > 0.72 && r < 0.895) {
    float rc = 0.81;
    float ca = aA / TAU * cells;
    float cell = floor(ca);
    float cw = TAU * rc / cells;
    vec2 q = vec2((fract(ca) - 0.5) * cw, r - rc);
    float hg = hash12(vec2(cell, floor(seed * 97.0)));
    detail = max(detail, aaStroke(glyphDist(q, vec2(cw * 0.26, 0.052), hg), 0.0035, pxD));
  }
  float d71 = abs(r - 0.71) - 0.006;
  core = max(core, aaStroke(r - 0.71, 0.006, pxR));
  dCore = min(dCore, max(d71, 0.0));

  // The star counter-rotates.
  vec2 ub = rot2(uv, -t * 0.08 + seed);
  float ds = starDist(ub, n, k, 0.70);
  core = max(core, aaStroke(ds, 0.0055, pxD));
  dCore = min(dCore, max(ds - 0.0055, 0.0));
  // Little rings on the star's vertices.
  float sector = TAU / n;
  float av = atan(ub.y, ub.x) - 0.5 * k * sector;
  float fv = (fract(av / sector + 0.5) - 0.5) * sector;
  vec2 pv = r * vec2(cos(fv), sin(fv)) - vec2(0.70, 0.0);
  detail = max(detail, aaStroke(length(pv) - 0.035, 0.003, pxD));

  // Inner layer turns faster the other way: two rings and a polygon.
  vec2 uc = rot2(uv, t * 0.13 - seed);
  detail = max(detail, aaStroke(r - 0.40, 0.003, pxR));
  detail = max(detail, aaStroke(r - 0.36, 0.0045, pxR));
  float m = (n == 5.0 || n == 7.0) ? 3.0 : 4.0;
  detail = max(detail, aaStroke(starDist(uc, m, 1.0, 0.36), 0.0035, pxD));
  detail = max(detail, aaStroke(r - 0.12, 0.004, pxR));

  // Black sun: a dark disc with a hot rim.
  float fill = 0.0;
  if (blackSun > 0.5) {
    fill = 1.0 - smoothstep(0.22 - pxR, 0.22 + pxR, r);
    core = max(core, aaStroke(r - 0.225, 0.008, pxR));
    dCore = min(dCore, max(abs(r - 0.225) - 0.008, 0.0));
    detail *= step(0.23, r);
  }
  return vec4(detail, core, dCore, fill);
}

/**
 * Shade a pattern sample. r = |uv|, dist = eye distance (aerial haze),
 * power = brightness. Returns PREMULTIPLIED colour: rgb is added, a hides
 * what is behind (dark ink lines, the black sun).
 */
vec4 shadeCircle(vec4 p, float r, float dist, float power) {
  float f = 1.0 - exp(-pow(uCircleFog * dist, 2.0));
  float detail = p.x * (1.0 - smoothstep(0.3, 0.8, f)); // far circles lose glyphs first
  float core = p.y;
  float d = p.z;
  float g;
  if (uGlowMode < 0.5) g = exp(-d * 30.0);                         // neon: tight
  else if (uGlowMode < 1.5) g = 0.03 / (d + 0.03) * 0.6;           // haze: long tail
  else if (uGlowMode < 2.5) {                                      // cel: flat bands (Eva C1419)
    float s = exp(-d * 12.0) * 3.0;
    g = (floor(s) + smoothstep(0.42, 0.58, fract(s))) / 3.0;
  } else g = exp(-d * 45.0);                                       // ink edge
  float wash = smoothstep(1.05, 0.15, r) * 0.06;
  vec3 emit;
  float cover;
  if (uGlowMode > 2.5) {
    // Ink: a dark-red stroke body with a burning edge (value contrast, not hue).
    cover = max(core, detail) * 0.9;
    float edge = max(g - core, 0.0);
    emit = uLine * cover * 0.4 + uGlowCol * edge * 1.4 * uGlowAmt + uEmber * wash * 0.6;
  } else {
    cover = max(core, detail) * 0.3; // a touch of ink keeps lines readable over bright cloud
    emit = uCoreHot * core + uEmber * detail * 1.3 + uGlowCol * g * 0.55 * uGlowAmt + uEmber * wash;
  }
  emit *= 1.0 - p.w * 0.98;
  cover = max(cover, p.w * 0.97);
  // Aerial haze: dim and shift toward the sky hue (never grey).
  emit *= 1.0 - f * 0.7;
  emit = mix(emit, emit * 0.45 + uHaze * 0.25 * max(core, detail), f);
  cover *= 1.0 - f * 0.6;
  float inside = smoothstep(1.3, 1.1, r);
  return vec4(emit * power, cover * min(power, 1.0)) * inside;
}
`;

/** Red light a point receives from the light-casting circles (T10 cookie). */
export const LIGHT_GLSL = /* glsl */ `
uniform vec3 uLC[4];
uniform vec3 uLN[4];
uniform vec3 uLU[4];
uniform vec3 uLV[4];
uniform vec4 uLP[4];
uniform int uLCount;
uniform float uLightAmb;
uniform float uLightCookie;
uniform vec3 uLightCol;

// nrm = receiving surface normal (zero vector = lit from every side).
// Projection is along the circle's normal (an orthographic cookie); the
// rings widen and soften with distance from the plane (a cone).
vec3 circleLight(vec3 w, vec3 nrm) {
  float sum = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uLCount) break;
    vec3 rel = w - uLC[i];
    float h = dot(rel, uLN[i]);
    vec3 q = rel - uLN[i] * h;
    float R = uLP[i].x;
    vec2 uv = vec2(dot(q, uLU[i]), dot(q, uLV[i])) / R;
    float ah = abs(h) / R;
    float spread = 1.0 + ah * 0.5;
    float rr = length(uv) / spread;
    float wd = 0.04 * spread;
    float rings = exp(-pow((rr - 1.0) / wd, 2.0)) + 0.8 * exp(-pow((rr - 0.71) / wd, 2.0)) + 0.6 * exp(-pow((rr - 0.38) / wd, 2.0));
    float ff = 1.0 / (1.0 + ah * ah); // disc form factor R^2 / (h^2 + R^2)
    float pool = exp(-rr * rr * 1.3);
    float facing = 1.0;
    if (dot(nrm, nrm) > 0.0) facing = clamp(dot(nrm, normalize(-rel)) * 0.6 + 0.4, 0.0, 1.0);
    sum += uLP[i].y * ff * facing * (uLightAmb * pool + uLightCookie * rings * smoothstep(1.35, 0.95, rr));
  }
  return uLightCol * sum;
}
`;

/** The cloud slab: a ring / sea of cloud around the pillar, as a density field. */
export const SLAB_GLSL = /* glsl */ `
uniform float uSlabY0;
uniform float uSlabY1;
uniform float uSlabInner;
uniform float uSlabOuter;
uniform float uSlabCover;
uniform vec2 uSlabCentre;
uniform float uSlabOn;
uniform sampler2D tNoise;

float slabDensity(vec3 w) {
  if (uSlabOn < 0.5) return 0.0;
  vec2 d = w.xz - uSlabCentre;
  float rr = length(d);
  float h = (w.y - uSlabY0) / (uSlabY1 - uSlabY0);
  if (h < 0.0 || h > 1.0) return 0.0;
  // Puffy top, flatter belly; fades at the ring's inner and outer edge.
  float profile = smoothstep(0.0, 0.3, h) * smoothstep(1.0, 0.5, h);
  float ring = smoothstep(uSlabInner, uSlabInner + 50.0, rr) * smoothstep(uSlabOuter, uSlabOuter - 140.0, rr);
  // The field slowly turns around the pillar (two texture taps, warped).
  vec2 q = rot2(d, -uTime * 0.012) * 0.0011;
  vec2 warp = texture2D(tNoise, q * 0.6 + 0.31).gb - 0.5;
  float n = texture2D(tNoise, q + warp * 0.18 + h * 0.04).r * 0.8 + texture2D(tNoise, q * 2.7 - warp * 0.3).b * 0.2;
  return smoothstep(uSlabCover, uSlabCover + 0.2, n - (1.0 - ring * profile) * 0.55);
}
`;

/** Mirror of hell-common.ts duneHeight, including the mesh's −2 offset. */
export function duneY(x: number, z: number): number {
  const s = Math.sin(x * 0.018 + Math.sin(z * 0.006) * 2.2) * 6;
  const t = Math.sin((x * 0.6 + z) * 0.01) * 9;
  return Math.max(0, s + t + 4) * 0.8 - 2;
}

/** Premultiplied "ink + light" blending used by every circle carrier (T16). */
export function premultipliedBlend(material: THREE.Material) {
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  material.transparent = true;
  material.depthWrite = false;
}

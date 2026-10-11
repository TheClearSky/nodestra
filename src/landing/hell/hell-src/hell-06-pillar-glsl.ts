// COPIED from .claude/pages/ad/experiments/hell-src/hell-06-pillar-glsl.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-06 shared GLSL: the pillar's uniforms, its fog (scene, height and
 * "crown in cloud"), banded toon stone, the backlit rim, upward light
 * threads, Voronoi lava veins and the analytic line glow.
 *
 * Every snippet expects ENV_GLSL (lab.ts) to be included first.
 */

import * as THREE from 'three';

/** Pillar height in metres (crowns sit on top of it). */
export const H = 560;

/** The stand-in dune height (copy of hell-common's duneHeight, minus the 2 m drop). */
export function duneY(x: number, z: number): number {
  const s = Math.sin(x * 0.018 + Math.sin(z * 0.006) * 2.2) * 6;
  const t = Math.sin((x * 0.6 + z) * 0.01) * 9;
  return Math.max(0, s + t + 4) * 0.8 - 2;
}

/** The pillar stands dead on the centre line, ~420 m from the hero camera. */
export const FOOT = new THREE.Vector3(0, duneY(0, -360), -360);

/** Uniforms every pillar material shares (one object each, so a change reaches all). */
export function makePillarUniforms() {
  return {
    uFoot: { value: FOOT.clone() },
    uH: { value: H },
    // Light colours (linear): white-hot core, coloured fringe, deep halo.
    uCore: { value: new THREE.Color('#fff1ea') },
    uFringe: { value: new THREE.Color('#ff3b30') },
    uHalo: { value: new THREE.Color('#c8102e') },
    // Motion clock: seconds scaled by the Motion switch (no phase jumps).
    uMT: { value: 0 },
    // Fog on the pillar: density multiplier, height fog (a, b), crown-in-cloud height.
    uFogK: { value: 1 },
    uHFogA: { value: 0 },
    uHFogB: { value: 1 / 30 },
    uCloudLo: { value: 1e5 },
    // 1 = the halo splits per colour channel (spectral fringe).
    uSpectral: { value: 0 },
    // Outline thickness in pixels and the screen size it needs.
    uInkPx: { value: 1.6 },
    uRes: { value: new THREE.Vector2(1280, 720) },
  };
}
export type PillarUniforms = ReturnType<typeof makePillarUniforms>;

export const PILLAR_GLSL = /* glsl */ `
uniform vec3 uFoot;
uniform float uH;
uniform vec3 uCore;
uniform vec3 uFringe;
uniform vec3 uHalo;
uniform float uMT;
uniform float uFogK;
uniform float uHFogA;
uniform float uHFogB;
uniform float uCloudLo;
uniform float uSpectral;

#define TAU 6.2831853

/** Same as the stand-in ground (hell-common), so things can sit on it. */
float duneY(vec2 xz) {
  float s = sin(xz.x * 0.018 + sin(xz.y * 0.006) * 2.2) * 6.0;
  float t = sin((xz.x * 0.6 + xz.y) * 0.01) * 9.0;
  return max(0.0, s + t + 4.0) * 0.8 - 2.0;
}

/** How much air lies between the camera and p (0 = none, 1 = all fog). */
float fogAmount(vec3 p) {
  vec3 ro = cameraPosition;
  vec3 d = p - ro;
  float t = length(d);
  vec3 rd = d / max(t, 1e-4);
  float od = t * 0.0016 * uFogK;          // matches the scene's FogExp2
  if (uHFogA > 0.0) {
    // IQ's analytic height fog: density a·exp(-b·y), integrated along the ray.
    float b = uHFogB;
    float y0 = ro.y - uFoot.y;
    float k = rd.y * b;
    od += abs(k) < 1e-5 ? t * uHFogA * exp(-y0 * b) : uHFogA / b * exp(-y0 * b) * (1.0 - exp(-t * k)) / rd.y;
  }
  float f = 1.0 - exp(-od);
  // The crown dissolving into a cloud deck (Re:Zero ep 73).
  f = max(f, smoothstep(uCloudLo, uCloudLo + 120.0, p.y) * 0.94);
  return f;
}

/** The colour of the air in front of p: the sky right behind it, plus haze. */
vec3 fogColour(vec3 p) {
  vec3 rd = normalize(p - cameraPosition);
  vec3 sky = skyGradient(normalize(vec3(rd.x, max(rd.y, 0.015), rd.z)));
  vec3 haze = mix(uHaze, uHorizon, 0.35) + uSunColor * 0.12 * pow(max(dot(rd, uSunDir), 0.0), 6.0);
  return mix(haze, sky, 0.6);
}

/** Opaque surfaces fade TOWARD the air; emissive ones only half as much. */
vec3 fogSolid(vec3 col, vec3 p, float emissive) {
  return mix(col, fogColour(p), fogAmount(p) * (1.0 - 0.5 * emissive));
}

/** Additive light fades by transmittance (never toward the fog colour). */
float fogTrans(vec3 p) {
  return 1.0 - fogAmount(p);
}

/**
 * Banded toon stone (GGXrd-style: own light vector, hard thresholds),
 * with the shade picking up the sky colour on up-facing planes.
 */
vec3 toonStone(vec3 N, vec3 L, vec3 lit, vec3 shade, vec3 deep, float bands) {
  float ndl = dot(N, L);
  float aa = fwidth(ndl) + 1e-4;
  float b1 = smoothstep(0.22 - aa, 0.22 + aa, ndl);
  float b2 = bands > 2.5 ? smoothstep(-0.28 - aa, -0.28 + aa, ndl) : 1.0;
  if (bands < 1.5) { b1 = 0.0; b2 = 0.0; }
  vec3 col = mix(mix(deep, shade, b2), lit, b1);
  // Sky-tinted shade (Re:Zero): shadowed faces that look up take the zenith hue.
  col = mix(col, col * 0.55 + uZenith * 0.9 + uHorizon * 0.25, (1.0 - b1) * clamp(N.y, 0.0, 1.0) * 0.6);
  return col;
}

/** Thin, hard backlit rim: constant-ish width, brighter when looking at the sun. */
vec3 rimLight(vec3 N, vec3 V, float w, vec3 col, float hdr) {
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float rf = smoothstep(1.0 - w, 1.0 - w * 0.55, 1.0 - ndv);
  float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  float side = smoothstep(-0.6, 0.4, dot(N, uSunDir) + 0.25);
  // Flat tops (a block's lid, a deck) seen at a grazing angle are not
  // silhouettes: without this they lit up as solid orange planes.
  float flatTop = 1.0 - smoothstep(0.6, 0.9, N.y);
  return col * rf * mix(0.45, 1.0, back) * side * flatTop * hdr;
}

/**
 * Upward-scrolling vertical light threads in the column's own (angle, height)
 * frame. N lanes wrap seamlessly; the meander is sampled on a circle.
 */
float threads(float u, float y, float t, float N, float wMul) {
  vec2 c = vec2(cos(u * TAU), sin(u * TAU)) * 1.6;
  float x = u * N + 0.7 * (fbm3(c + vec2(y * 0.004, 0.0)) - 0.5) * 2.0
          + 0.15 * sin(y * 0.03 + t * 0.7 + floor(u * N) * 1.7);
  float id = floor(x);
  id = mod(id, N);
  float lane = abs(fract(x) - 0.5);
  float w = mix(0.04, 0.14, hash12(vec2(id, 3.0))) * wMul;
  float line = 1.0 - smoothstep(w * 0.45, w, lane);
  float spd = mix(6.0, 26.0, hash12(vec2(id, 7.0)));          // metres per second, upward
  float ph = fract((y - t * spd) / 170.0 + hash12(vec2(id, 1.0)));
  float bead = smoothstep(0.72, 0.95, ph) * (1.0 - smoothstep(0.95, 1.0, ph));
  return line * (0.35 + 1.8 * bead);
}

/** IQ's exact two-pass Voronoi border distance, wrapping N cells around the shaft. */
float veinDist(vec2 x, float N) {
  vec2 p = floor(x);
  vec2 f = fract(x);
  vec2 mb = vec2(0.0);
  vec2 mr = vec2(0.0);
  float res = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 b = vec2(float(i), float(j));
    vec2 r = b + hash22(mod(p + b, vec2(N, 4096.0))) - f;
    float d = dot(r, r);
    if (d < res) { res = d; mr = r; mb = b; }
  }
  res = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 b = mb + vec2(float(i), float(j));
    vec2 r = b + hash22(mod(p + b, vec2(N, 4096.0))) - f;
    if (dot(mr - r, mr - r) > 1e-5) res = min(res, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return res;
}

/** Closed-form glow of a vertical line light, integrated along a ray (1/(d²+eps²)). */
float lineGlow(vec3 ro, vec3 rd, vec2 axis, float eps, float t0, float t1) {
  vec2 o = ro.xz - axis;
  vec2 v = rd.xz;
  float vv = max(dot(v, v), 1e-6);
  float tc = -dot(o, v) / vv;
  vec2 c = o + v * tc;
  float k = sqrt(dot(c, c) + eps * eps);
  float s = sqrt(vv);
  return (atan(s * (t1 - tc) / k) - atan(s * (t0 - tc) / k)) / (s * k);
}
`;

/** Standard vertex shader: world position, normal, object-space position, uv;
 *  instancing and instance colour supported. Optional phone-wire AA. */
export const BODY_VERT = /* glsl */ `
uniform float uWire;       // > 0: the true radius of a hairline pole (phone-wire AA)
uniform float uFovY;
uniform vec2 uRes;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
varying vec2 vUv;
varying vec3 vInst;
varying float vCover;
void main() {
  vec3 p = position;
  vCover = 1.0;
  if (uWire > 0.0) {
    // Never thinner than ~1.5 px: widen, then fade by the coverage we faked.
    vec3 axisW = (modelMatrix * vec4(0.0, p.y, 0.0, 1.0)).xyz;
    float px = length(cameraPosition - axisW) * 2.0 * tan(uFovY * 0.5) / uRes.y;
    float rDrawn = max(uWire, px * 0.75);
    vCover = uWire / rDrawn;
    p.xz *= rDrawn / uWire;
  }
  vec4 lp = vec4(p, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    lp = instanceMatrix * lp;
    n = mat3(instanceMatrix) * n;
  #endif
  vInst = vec3(1.0);
  #ifdef USE_INSTANCING_COLOR
    vInst = instanceColor;
  #endif
  vLocal = position;
  vUv = uv;
  vec4 wp = modelMatrix * lp;
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// COPIED from .claude/pages/ad/experiments/hell-src/hell-10-particles-and-mist-glsl.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-10 shared bits: the stage layout (camera, pillar, sky-circle stand-in),
 * the dune height in GLSL (for analytic soft particles), and the page's FOG.
 *
 * Fog: one GLSL function `hellFogAmount()` used by EVERY material on this
 * page. The built-in materials (the stand-in dunes, the pillar proxy) get it
 * by patching THREE.ShaderChunk's fog chunks in this file (the patch is
 * page-global, which is fine: each experiment is its own page). Mode 0 is the
 * hell base's plain FogExp2, so nothing changes until a fog variant is picked.
 */

import * as THREE from 'three';
import type { EnvUniforms } from '../env-src/lab';

// ── stage layout ────────────────────────────────────────────────────────

/** Mirror of hell-common.ts duneHeight, INCLUDING the mesh's −2 offset. */
export function duneY(x: number, z: number): number {
  const s = Math.sin(x * 0.018 + Math.sin(z * 0.006) * 2.2) * 6;
  const t = Math.sin((x * 0.6 + z) * 0.01) * 9;
  return Math.max(0, s + t + 4) * 0.8 - 2;
}

/** The pillar proxy's foot (centre of its base, on the sand). */
export const PILLAR = new THREE.Vector3(0, duneY(0, -240), -240);
/** Eye-level camera, ~6.5 m above the sand, looking at the pillar. */
export const CAMERA = new THREE.Vector3(-58, duneY(-58, 40) + 6.5, 40);
export const LOOK = new THREE.Vector3(0, 34, -240);
/** Where the stand-in magic circle hangs (above the pillar). */
export const CIRCLE = new THREE.Vector3(0, 132, -240);

export const DUNE_GLSL = /* glsl */ `
float duneY(vec2 xz) {
  float s = sin(xz.x * 0.018 + sin(xz.y * 0.006) * 2.2) * 6.0;
  float t = sin((xz.x * 0.6 + xz.y) * 0.01) * 9.0;
  return max(0.0, s + t + 4.0) * 0.8 - 2.0;
}
`;

/** Divergence-free 2-D swirl: the curl of an fbm stream function (needs ENV_GLSL). */
export const CURL_GLSL = /* glsl */ `
vec2 curl2(vec2 p) {
  const float e = 0.15;
  float a = fbm3(p + vec2(0.0, e));
  float b = fbm3(p - vec2(0.0, e));
  float c = fbm3(p + vec2(e, 0.0));
  float d = fbm3(p - vec2(e, 0.0));
  return vec2(a - b, -(c - d)) / (2.0 * e);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
`;

// ── fog ─────────────────────────────────────────────────────────────────

export const FOG_MODES = {
  base: 0, // the hell base's FogExp2 (distance only, flat fog colour)
  height: 1, // analytic exponential height fog, sky-tinted, sun lobe
  twoLayer: 2, // thick ground layer + thin high layer, red survives longest
  celBands: 3, // height fog quantised into 4 flat colour bands
  strata: 4, // painted horizontal mist belts (crisp tops, soft bottoms)
  tone: 5, // cel bands whose edges are a manga screen-tone dot pattern
} as const;

export type FogUniforms = {
  uHfMode: { value: number };
  uHfDensity: { value: number };
  uHfFalloff: { value: number };
  uHfBase: { value: number };
  uHfMax: { value: number };
  uHfExp2: { value: number };
  uHfFog: { value: THREE.Color };
  uHfZenith: { value: THREE.Color };
  uHfHorizon: { value: THREE.Color };
  uHfHaze: { value: THREE.Color };
  uHfAmbient: { value: THREE.Color };
  uHfSunColor: { value: THREE.Color };
  uHfSunDir: { value: THREE.Vector3 };
};

/** The fog uniforms share the env colour objects, so grade switches follow. */
export function makeFogUniforms(env: EnvUniforms, fogColor: THREE.Color): FogUniforms {
  return {
    uHfMode: { value: FOG_MODES.height },
    // Ground-level optical depth 1.74 at 1200 m → 17.5 % far contrast.
    uHfDensity: { value: 0.0016 },
    uHfFalloff: { value: 0.012 },
    uHfBase: { value: -2 },
    uHfMax: { value: 0.96 },
    uHfExp2: { value: 0.0016 },
    uHfFog: { value: fogColor },
    uHfZenith: env.uZenith,
    uHfHorizon: env.uHorizon,
    uHfHaze: env.uHaze,
    uHfAmbient: env.uAmbient,
    uHfSunColor: env.uSunColor,
    uHfSunDir: env.uSunDir,
  };
}

/**
 * hellFogAmount(p, px, out colour): how much fog lies between the camera and
 * world point p (0…1), and the colour it fades to. px = gl_FragCoord.xy for
 * dithering (vec2(0) in a vertex shader). hellFog() applies it.
 */
export const FOG_GLSL = /* glsl */ `
uniform float uHfMode;
uniform float uHfDensity;
uniform float uHfFalloff;
uniform float uHfBase;
uniform float uHfMax;
uniform float uHfExp2;
uniform vec3 uHfFog;
uniform vec3 uHfZenith;
uniform vec3 uHfHorizon;
uniform vec3 uHfHaze;
uniform vec3 uHfAmbient;
uniform vec3 uHfSunColor;
uniform vec3 uHfSunDir;

// The sky's own gradient (no sun disc): distant forms fade to the sky BEHIND them.
vec3 hfSky(vec3 d) {
  float h = max(d.y, 0.0);
  vec3 col = mix(uHfHorizon, uHfZenith, smoothstep(0.0, 1.0, pow(h, 0.45)));
  return mix(col, uHfHaze, exp(-h * 12.0) * 0.75);
}

// Interleaved gradient noise (Jimenez): ±½ LSB dither against banding.
float hfIgn(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }

// Optical depth of exponential height fog from the camera to p (iq's closed form).
float hfTau(vec3 p, float density, float falloff, float base) {
  vec3 d = p - cameraPosition;
  float t = max(length(d), 1e-3);
  float k = falloff * d.y;                         // = falloff * rd.y * t
  float g = abs(k) > 1e-4 ? (1.0 - exp(-k)) / k : 1.0;
  return density * exp(-(cameraPosition.y - base) * falloff) * t * g;
}

// Painted mist belts: flat layers, crisp on top, soft underneath.
float hfStrata(float y) {
  float s = 0.0;
  s += 1.0 * smoothstep(-6.0, 4.0, y) * (1.0 - smoothstep(4.0, 5.5, y));
  s += 0.7 * smoothstep(14.0, 30.0, y) * (1.0 - smoothstep(30.0, 33.0, y));
  s += 0.5 * smoothstep(55.0, 85.0, y) * (1.0 - smoothstep(85.0, 90.0, y));
  s += 0.4 * smoothstep(140.0, 190.0, y) * (1.0 - smoothstep(190.0, 198.0, y));
  return s;
}

// 4-step colour ramp for the cel bands: warm near haze → oxblood → violet far.
vec3 hfRamp(float f, vec3 sky) {
  vec3 c = mix(uHfHorizon * 1.15, uHfHaze, smoothstep(0.2, 0.5, f));
  c = mix(c, mix(uHfAmbient * 0.5, sky, 0.5), smoothstep(0.5, 0.85, f));
  return mix(c, sky, smoothstep(0.85, 1.0, f));
}

float hellFogAmount(vec3 p, vec2 px, out vec3 fogCol) {
  vec3 d = p - cameraPosition;
  float dist = length(d);
  vec3 rd = d / max(dist, 1e-3);
  vec3 sky = hfSky(rd);
  float sun = pow(max(dot(rd, normalize(uHfSunDir)), 0.0), 8.0);
  if (uHfMode < 0.5) {                               // 0 · the base FogExp2
    fogCol = uHfFog;
    float e = uHfExp2 * dist;
    return 1.0 - exp(-e * e);
  }
  float tau = hfTau(p, uHfDensity, uHfFalloff, uHfBase);
  fogCol = sky + uHfSunColor * sun * 0.35;
  if (uHfMode < 1.5) {                               // 1 · smooth height fog
    return min(1.0 - exp(-tau), uHfMax) + (hfIgn(px) - 0.5) / 255.0;
  }
  if (uHfMode < 2.5) {                               // 2 · two layers, per-channel
    tau = hfTau(p, uHfDensity * 1.25, uHfFalloff * 1.6, uHfBase)
        + hfTau(p, uHfDensity * 0.3, uHfFalloff * 0.12, uHfBase + 60.0);
    // Red light survives longest: far forms go oxblood before they vanish.
    vec3 tr = exp(-tau * vec3(0.72, 1.0, 1.12));
    float f = min(1.0 - (tr.r + tr.g + tr.b) / 3.0, uHfMax);
    fogCol = mix(sky, uHfHaze, 0.25) * (1.0 - tr) / max(1.0 - (tr.r + tr.g + tr.b) / 3.0, 1e-3) * 0.85
           + uHfSunColor * sun * 0.5;
    return f + (hfIgn(px) - 0.5) / 255.0;
  }
  if (uHfMode < 4.5 && uHfMode > 3.5) {              // 4 · painted strata
    float s = 0.0;
    for (int i = 0; i < 6; i++) {
      float k = (float(i) + 0.5) / 6.0;
      s += hfStrata(mix(cameraPosition.y, p.y, k));
    }
    float tauS = s / 6.0 * min(dist, 2600.0) * 0.0011;
    float f = 1.0 - exp(-(tau * 0.55 + tauS));
    fogCol = mix(sky, uHfHorizon * 1.2 + uHfSunColor * 0.1, clamp(tauS * 0.6, 0.0, 0.5));
    return min(f, uHfMax);
  }
  // 3 · cel bands / 5 · screen-tone bands
  float f = min(1.0 - exp(-tau * 1.15), uHfMax);
  float n = 4.0;
  float x = f * n;
  float edge;
  if (uHfMode < 3.5) {
    edge = smoothstep(0.47, 0.53, fract(x)) ;      // a hair of softness so edges do not alias
  } else {
    // Manga screen tone: the band edge is a 5 px dot grid whose dots grow.
    vec2 cell = fract(px / 5.0) - 0.5;
    float dotR = length(cell) * 1.41;
    edge = step(dotR, smoothstep(0.25, 0.95, fract(x)));
  }
  float fs = (floor(x) + edge) / n;
  fogCol = hfRamp(fs, sky);
  return min(fs, uHfMax);
}

vec3 hellFog(vec3 col, vec3 p, vec2 px) {
  vec3 fc;
  float f = hellFogAmount(p, px, fc);
  return mix(col, fc, clamp(f, 0.0, 1.0));
}
`;

/**
 * Patch three's fog chunks so built-in materials (MeshStandardMaterial etc.)
 * use hellFog(). Must run before the first render. Built-in materials then
 * need the uniforms: call `useHellFog(material, fogUniforms)`.
 */
export function patchFogChunks() {
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  if (C.fog_fragment.includes('hellFog')) return;
  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif
`;
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif
`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${FOG_GLSL}
#endif
`;
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = hellFog(gl_FragColor.rgb, vFogWorld, gl_FragCoord.xy);
#endif
`;
}

export function useHellFog(material: THREE.Material, fog: FogUniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fog);
  };
  material.customProgramCacheKey = () => 'hell10-fog';
  material.needsUpdate = true;
}

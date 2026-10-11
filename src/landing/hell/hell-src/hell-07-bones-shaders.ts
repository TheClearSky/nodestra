// COPIED from .claude/pages/ad/experiments/hell-src/hell-07-bones-shaders.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-07 shaders: the bone material (three looks), its ink hull, the sand,
 * the sky sigil, the pillar stand-in and the rising embers.
 *
 * All of them share one uniform bag (`BoneUniforms`) so a HUD switch changes
 * every mesh at once, and all of them fog themselves (FogExp2 maths copied
 * from three) plus an analytic height-mist band that swallows the bases (T19).
 */

import * as THREE from 'three';
import { ENV_GLSL } from '../env-src/lab';
import type { EnvUniforms } from '../env-src/lab';

export type BoneUniforms = {
  uFogColor: { value: THREE.Color };
  uFogDensity: { value: number };
  uMistAmt: { value: number };
  uMistY: { value: number };
  uFlat: { value: THREE.Vector4 };
  uFlatAmt: { value: number };
  uMat: { value: number }; // 0 toon, 1 painted, 2 silhouette
  uCracks: { value: number };
  uStain: { value: number };
  uEmberAmt: { value: number };
  uEmberCol: { value: THREE.Color };
  uSigilC: { value: THREE.Vector3 };
  uSigilR: { value: number };
  uSigilAmt: { value: number };
  uSigilCol: { value: THREE.Color };
  uBoneLight: { value: THREE.Vector3 };
  uFan: { value: THREE.Vector4 }; // impale point xyz, fan radius (0 = off)
  uGround: { value: THREE.Color };
  uGroundShade: { value: THREE.Color };
  uDrift: { value: number };
  uContact: { value: number };
  uInkPx: { value: number };
  uRes: { value: THREE.Vector2 };
};

export function makeBoneUniforms(): BoneUniforms {
  return {
    uFogColor: { value: new THREE.Color() },
    uFogDensity: { value: 0.0016 },
    uMistAmt: { value: 0 },
    uMistY: { value: 0 },
    uFlat: { value: new THREE.Vector4(0, 0, 120, 260) },
    uFlatAmt: { value: 0.25 },
    uMat: { value: 0 },
    uCracks: { value: 1 },
    uStain: { value: 1 },
    uEmberAmt: { value: 0.35 },
    uEmberCol: { value: new THREE.Color('#ff3a1c') },
    uSigilC: { value: new THREE.Vector3(0, 150, -200) },
    uSigilR: { value: 100 },
    uSigilAmt: { value: 0 },
    uSigilCol: { value: new THREE.Color('#ff1a12') },
    uBoneLight: { value: new THREE.Vector3(0.4, 0.8, 0.2).normalize() },
    uFan: { value: new THREE.Vector4(0, 0, 0, 0) },
    uGround: { value: new THREE.Color() },
    uGroundShade: { value: new THREE.Color() },
    uDrift: { value: 1 },
    uContact: { value: 1 },
    uInkPx: { value: 1.6 },
    uRes: { value: new THREE.Vector2(1280, 720) },
  };
}

/** GLSL shared by every material here (after ENV_GLSL). */
const COMMON_GLSL = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uMistAmt;
uniform float uMistY;
uniform vec4 uFlat;
uniform float uFlatAmt;
uniform float uMat;
uniform float uCracks;
uniform float uStain;
uniform float uEmberAmt;
uniform vec3 uEmberCol;
uniform vec3 uSigilC;
uniform float uSigilR;
uniform float uSigilAmt;
uniform vec3 uSigilCol;
uniform vec3 uBoneLight;
uniform vec4 uFan;
uniform vec3 uGround;
uniform vec3 uGroundShade;

// The stand-in dune formula (hell-common duneHeight), flattened around the bones.
float duneH(vec2 p) {
  float s = sin(p.x * 0.018 + sin(p.y * 0.006) * 2.2) * 6.0;
  float t = sin((p.x * 0.6 + p.y) * 0.01) * 9.0;
  return max(0.0, s + t + 4.0) * 0.8;
}
float groundBase(vec2 p) {
  float k = mix(uFlatAmt, 1.0, smoothstep(uFlat.z, uFlat.w, length(p - uFlat.xy)));
  return duneH(p) * k - 2.0;
}

// three's FogExp2, done in the receiver.
vec3 applyFog(vec3 col, vec3 wp) {
  float d = length(wp - cameraPosition);
  return mix(col, uFogColor, 1.0 - exp(-uFogDensity * uFogDensity * d * d));
}

// iq analytic exponential height fog: a mist band lying on the sand (T19a).
vec3 applyMist(vec3 col, vec3 wp) {
  if (uMistAmt <= 0.0) return col;
  vec3 ro = cameraPosition;
  vec3 rd = wp - ro;
  float dist = length(rd);
  rd /= dist;
  float b = 0.16;
  float a = 0.022 * uMistAmt;
  float amt = abs(rd.y) < 1e-3
    ? a * exp(-(ro.y - uMistY) * b) * dist
    : (a / b) * exp(-(ro.y - uMistY) * b) * (1.0 - exp(-dist * rd.y * b)) / rd.y;
  float wisp = fbm3(wp.xz * 0.018 + vec2(uTime * 0.012, uTime * 0.005));
  amt *= 0.45 + 1.1 * wisp;
  float sunAmt = pow(max(dot(rd, uSunDir), 0.0), 6.0);
  vec3 mc = mix(uFogColor * 1.5 + uAmbient * 0.25, uSunColor * 0.45 + uFogColor, sunAmt * 0.7);
  return mix(col, mc, 1.0 - exp(-max(amt, 0.0)));
}

// The dark-red magic circle: rings, a rotating glyph band, a hexagram.
float ringLine(float r, float R, float w) {
  float fw = fwidth(r) * 1.2 + 1e-4;
  return 1.0 - smoothstep(w, w + fw, abs(r - R));
}
float sigil(vec2 p, float t) {
  float r = length(p);
  if (r > 1.06) return 0.0;
  float a = atan(p.y, p.x);
  float s = ringLine(r, 1.0, 0.012) + ringLine(r, 0.94, 0.005) + ringLine(r, 0.71, 0.009) + ringLine(r, 0.66, 0.004) + ringLine(r, 0.3, 0.007) + ringLine(r, 0.24, 0.003);
  // glyph band between the 0.71 and 0.94 rings, turning slowly
  float cells = 40.0;
  float c = (a + t * 0.12) / 6.2831853 * cells;
  float id = floor(c);
  float f = fract(c);
  float h = hash12(vec2(id, 7.0));
  float rr = (r - 0.73) / 0.19;
  float inBand = step(0.0, rr) * step(rr, 1.0);
  float stroke = (1.0 - smoothstep(0.05, 0.1, abs(f - 0.5 - (h - 0.5) * 0.4))) * step(0.15, rr) * step(rr, 0.85);
  float bar = (1.0 - smoothstep(0.04, 0.08, abs(rr - 0.25 - fract(h * 7.0) * 0.5))) * step(abs(f - 0.5), 0.32);
  float dotm = 1.0 - smoothstep(0.06, 0.11, length(vec2((f - 0.5) * 1.3, rr - 0.86)));
  s += inBand * clamp(stroke * step(0.35, h) + bar * step(h, 0.8) + dotm * step(h, 0.45), 0.0, 1.0);
  // hexagram turning the other way
  float sa = a - t * 0.08;
  float fwr = fwidth(r) * 1.5 + 1e-4; // derivatives outside the loop (D3D warns otherwise)
  for (int k = 0; k < 2; k++) {
    float sector = 2.0943951;
    float aa = mod(sa + float(k) * 1.0471976, sector) - sector * 0.5;
    float dEdge = r * cos(aa) - 0.33;
    s += (1.0 - smoothstep(0.006, 0.006 + fwr, abs(dEdge))) * step(r, 0.665);
  }
  // inner ticks
  float tc = fract((a + t * 0.3) / 6.2831853 * 24.0);
  s += (1.0 - smoothstep(0.04, 0.08, abs(tc - 0.5))) * step(0.245, r) * step(r, 0.295);
  return clamp(s, 0.0, 1.0);
}

// iq exact Voronoi border distance (two passes): even-width crack lines (T15).
float voronoiBorder(vec2 x) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + hash22(n + g) - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
  md = 8.0;
  // 3x3 instead of iq's 5x5 second pass: half the cost, rare tiny gaps only
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 r = g + hash22(n + g) - f;
      if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
    }
  return md;
}
`;

// ── bone material ───────────────────────────────────────────────────────

const BONE_VERT = /* glsl */ `
attribute vec2 aBone;
#ifdef USE_INSTANCING
attribute float aSeed;
#endif
uniform float uSeed;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vObj;
varying vec2 vUv;
varying vec2 vBone;
varying float vSeed;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
  // inverse-transpose for a scaled instance: divide by the squared axis scales
  mat3 im = mat3(instanceMatrix);
  n = im * (n / vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2])));
  vSeed = aSeed;
#else
  vSeed = uSeed;
#endif
  vec4 w = modelMatrix * p;
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  vObj = position;
  vUv = uv;
  vBone = aBone;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const BONE_FRAG = /* glsl */ `
uniform float uCrackScale;
uniform float uSockOn;      // 1 on skull meshes
uniform vec3 uSock;         // socket centre (object space, +x side; mirrored)
uniform vec3 uSockR;        // socket radii (object space)
uniform vec3 uCamObj;       // camera in object space (for the fake cavity)
uniform float uDark;        // 0…1 extra darkening (far LOD)
uniform float uSockAll;     // 1 = every socket glows (hero skulls); 0 = only a few (fields)

// pull a light colour part-way to its grey (k = 1 keeps it, 0 = grey)
vec3 tintLight(vec3 c, float k) { return mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, k); }
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vObj;
varying vec2 vUv;
varying vec2 vBone;
varying float vSeed;

void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uBoneLight);
  vec3 albedo = srgb(vec3(0.765, 0.784, 0.769)) * (0.92 + 0.16 * hash12(vec2(vSeed * 17.0, 3.0)));

  // band colours taken from the light (albedo near-neutral, light colours it).
  // The light is desaturated a little so the bone reads chalky, not red plastic.
  vec3 litC = albedo * (tintLight(uSunColor, 0.6) * 0.95 + uAmbient * 0.6 + uHorizon * 0.25 + 0.05);
  vec3 midC = albedo * (tintLight(uHorizon, 0.7) * 0.55 + tintLight(uSunColor, 0.6) * 0.16 + uAmbient * 0.9 + 0.015);
  vec3 shadowC = albedo * (uAmbient * 1.0 + uHaze * 0.9) + uFogColor * 0.12;

  float ndl = dot(N, L) * 0.5 + 0.5;
  ndl += (N.y - 0.2) * 0.12;                                   // tops fall into light sooner
  float hAbove = vWorld.y - groundBase(vWorld.xz);
  ndl -= (1.0 - smoothstep(0.0, 10.0, hAbove)) * 0.12;         // bases fall into shadow sooner (GGXrd offset)

  vec3 col;
  float fres = 1.0 - max(dot(N, V), 0.0);
  float behind = pow(max(dot(-V, uSunDir), 0.0), 2.0);
  float fwr = fwidth(fres) + 1e-4;

  if (uMat < 0.5) {
    // T9 toon: three flat bands, AA'd edges
    float fw = fwidth(ndl) + 1e-4;
    float lit = smoothstep(0.5 - fw, 0.5 + fw, ndl);
    float hi = smoothstep(0.74 - fw, 0.74 + fw, ndl);
    col = mix(shadowC, midC, lit);
    col = mix(col, litC, hi);
    float rim = smoothstep(0.66 - fwr, 0.66 + fwr, fres) * (0.25 + 0.75 * behind) * (0.35 + 0.65 * max(N.y, 0.0));
    col += uSunColor * albedo * rim * 0.55;
  } else if (uMat < 1.5) {
    // T13 soft painted: wrap light, domain-warped mottling, sky tint on tops
    float wrap = clamp((dot(N, L) + 0.55) / 1.55, 0.0, 1.0);
    vec2 q = vWorld.xz * 0.025 + vec2(vWorld.y * 0.03, 0.0);
    vec2 w1 = vec2(fbm3(q), fbm3(q + vec2(5.2, 1.3)));
    float m = fbm3(q + 3.0 * w1);
    col = mix(shadowC * 1.1, mix(midC, litC, 0.55), wrap);
    col *= 0.8 + 0.4 * m;
    col = mix(col, col * (uAmbient * 2.5 + 0.4), (w1.x - 0.4) * 0.6);
    col += uZenith * 0.25 * max(N.y, 0.0) + uHaze * 0.15 * (1.0 - max(N.y, 0.0));
    col += uSunColor * albedo * pow(fres, 3.0) * behind * 0.5;
  } else {
    // T14 flat silhouette: near the sky's own colour, a hard warm rim
    col = mix(uFogColor, uHorizon, 0.35) * 0.45;
    float rim = smoothstep(0.55 - fwr, 0.55 + fwr, fres) * (0.3 + 0.7 * behind);
    col += uSunColor * rim * 0.42;
  }

  // T12 back-light translucency through thin bone edges
  float trans = pow(clamp(dot(V, -normalize(uSunDir + N * 0.45)), 0.0, 1.0), 4.0) * vBone.y;
  col += uSunColor * albedo * trans * (uMat > 1.5 ? 0.6 : 0.9);

  // T15 cracks: exact Voronoi borders in the bone's own uv, stretched along it
  float crackMask = 0.0;
  if (uCracks > 0.5) {
    vec2 cp = vec2(vUv.x, vUv.y * 0.42) * uCrackScale + vSeed * 17.0;
    cp += (vec2(vnoise(cp * 1.7), vnoise(cp * 1.7 + 4.0)) - 0.5) * 0.35;
    float d = voronoiBorder(cp);
    float fw = fwidth(d) + 1e-4;
    float crack = 1.0 - smoothstep(0.025, 0.025 + fw * 1.2, d);
    crack *= smoothstep(0.52, 0.64, fbm3(cp * 0.23 + 3.0));          // sparse patches, not a net
    crack *= 1.0 - smoothstep(0.08, 0.25, fw);                         // fade before it aliases
    crackMask = crack;
    col = mix(col, shadowC * 0.35, crack * (uMat > 1.5 ? 0.0 : 0.85));
  }

  // T16 base stain + tidemark
  if (uStain > 0.5) {
    float edge = 14.0 * (0.65 + 0.7 * fbm3(vWorld.xz * 0.04 + vWorld.y * 0.02 + vSeed));
    float stain = 1.0 - smoothstep(0.0, edge, hAbove);
    float tide = (1.0 - smoothstep(0.0, 0.7, abs(hAbove - edge * 0.8))) * 0.4;
    col *= mix(1.0, 0.42, stain);
    col = mix(col, col * vec3(0.55, 0.32, 0.25), tide);
  }

  // T8 radial crack fan around an impale point
  if (uFan.w > 0.0) {
    vec2 rad = vWorld.xz - uFan.xz;
    float dist = length(vWorld - uFan.xyz);
    float ang = atan(rad.y, rad.x);
    float spoke = abs(fract(ang * 9.0 / 6.2831853 + vnoise(vec2(dist * 0.15, vSeed)) * 0.35) - 0.5);
    float fan = smoothstep(0.455, 0.49, spoke) * exp(-dist / uFan.w);
    col = mix(col, shadowC * 0.3, fan * 0.9);
    crackMask = max(crackMask, fan);
  }

  // stand-in AO: bone gets darker in the dune's shadow line
  col *= 0.75 + 0.25 * smoothstep(-2.0, 6.0, hAbove);
  col *= 1.0 - uDark;

  // T20 ember sockets: a virtual cavity sphere behind each socket (interior mapping)
  vec3 emis = vec3(0.0);
  float flick = 0.75 + 0.25 * vnoise(vec2(uTime * 1.3, vSeed * 13.0)) + 0.1 * sin(uTime * 7.0 + vSeed);
  if (uSockOn > 0.5) {
    vec3 o = vec3(abs(vObj.x), vObj.yz);
    vec3 e = (o - uSock) / uSockR;
    float inSock = 1.0 - smoothstep(0.85, 1.15, length(e));
    vec3 rd = normalize(vObj - uCamObj);
    rd.x *= sign(vObj.x + 1e-5);
    vec3 oc = o - (uSock - vec3(0.0, 0.0, uSockR.z * 0.6));
    float R = uSockR.y * 1.1;
    float bq = dot(oc, rd);
    float cq = dot(oc, oc) - R * R;
    float tFar = -bq + sqrt(max(bq * bq - cq, 0.0));
    float depth = clamp(tFar / (2.0 * R), 0.0, 1.0);
    col = mix(col, shadowC * 0.15, inSock);
    // in a field only a few skulls keep an ember; the rest stay dark (Eva C1104)
    float pick = max(uSockAll, step(0.84, fract(vSeed * 7.31)));
    emis += uEmberCol * (0.25 + 2.2 * depth * depth) * inSock * flick * uEmberAmt * 2.2 * pick;
    // spill on the brow and cheek around the socket
    emis += uEmberCol * albedo * exp(-max(length(e) - 1.0, 0.0) * 2.5) * (1.0 - inSock) * 0.35 * uEmberAmt * flick * uSockAll; // spill on hero skulls only
  }
  // ember cores: the cracks only glow when the embers blaze (faint keeps them ink)
  emis += uEmberCol * crackMask * smoothstep(0.5, 1.0, uEmberAmt) * 0.9 * flick * (uMat > 1.5 ? 0.5 : 1.0);

  // X1 sigil gobo: the sky circle's pattern projected down on up-facing bone
  if (uSigilAmt > 0.0) {
    vec2 sp = (vWorld.xz - uSigilC.xz) / uSigilR;
    float s = sigil(sp, uTime);
    emis += uSigilCol * s * smoothstep(-0.1, 0.6, N.y) * uSigilAmt * 0.9;
    col += uSigilCol * 0.03 * uSigilAmt * (1.0 - smoothstep(0.8, 1.2, length(sp)));
  }

  col = applyMist(col, vWorld);
  col = applyFog(col, vWorld);
  // emission survives a little haze but not all of it
  float fogK = exp(-uFogDensity * uFogDensity * dot(vWorld - cameraPosition, vWorld - cameraPosition));
  col += emis * (0.3 + 0.7 * fogK);
  if (uDebug > 0.5) col = N * 0.5 + 0.5;
  gl_FragColor = vec4(col, 1.0);
}
`;

const HULL_VERT = /* glsl */ `
attribute vec2 aBone;
uniform float uInkPx;
uniform vec2 uRes;
varying vec3 vWorld;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
  mat3 im = mat3(instanceMatrix);
  n = im * (n / vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2])));
#endif
  vec4 w = modelMatrix * p;
  vWorld = w.xyz;
  vec4 clip = projectionMatrix * viewMatrix * w;
  // push out along the normal in CLIP space: a constant pixel width (T10)
  vec3 nv = mat3(viewMatrix) * normalize(mat3(modelMatrix) * n);
  vec2 dir = (projectionMatrix * vec4(nv, 0.0)).xy;
  float l = length(dir);
  dir = l > 1e-5 ? dir / l : vec2(0.0);
  clip.xy += dir * (uInkPx * aBone.x * 2.0 / uRes) * clip.w;
  gl_Position = clip;
}
`;

const HULL_FRAG = /* glsl */ `
varying vec3 vWorld;
void main() {
  // ink #413637 pulled toward the shadow hue, then fogged like the bone
  vec3 ink = mix(srgb(vec3(0.255, 0.212, 0.216)), uAmbient * 0.3 + uHaze * 0.25, 0.55) * 0.55;
  vec3 col = applyMist(ink, vWorld);
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

export type BoneMaterialOpts = { crackScale?: number; socket?: { c: THREE.Vector3; r: THREE.Vector3 }; seed?: number; dark?: number; sockAll?: number };

export function makeBoneMaterial(env: EnvUniforms, u: BoneUniforms, opts: BoneMaterialOpts = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...env,
      ...u,
      uCrackScale: { value: opts.crackScale ?? 0.3 },
      uSockOn: { value: opts.socket ? 1 : 0 },
      uSock: { value: opts.socket?.c ?? new THREE.Vector3() },
      uSockR: { value: opts.socket?.r ?? new THREE.Vector3(1, 1, 1) },
      uCamObj: { value: new THREE.Vector3() },
      uSeed: { value: opts.seed ?? 0.3 },
      uDark: { value: opts.dark ?? 0 },
      uSockAll: { value: opts.sockAll ?? 1 },
    },
    vertexShader: BONE_VERT,
    fragmentShader: ENV_GLSL + COMMON_GLSL + BONE_FRAG,
  });
}

export function makeHullMaterial(env: EnvUniforms, u: BoneUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...env, ...u },
    vertexShader: HULL_VERT,
    fragmentShader: ENV_GLSL + COMMON_GLSL + HULL_FRAG,
    side: THREE.BackSide,
  });
}

// ── sand ────────────────────────────────────────────────────────────────

const SAND_VERT = /* glsl */ `
attribute float aDriftY;
attribute vec3 aDriftN;
attribute float aContact;
uniform float uDrift;
uniform float uContact;
varying vec3 vWorld;
varying vec3 vN;
varying float vContact;
void main() {
  vec3 p = position;
  p.y = mix(p.y, aDriftY, uDrift);
  vN = normalize(mix(normal, aDriftN, uDrift));
  vContact = aContact * uContact;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const SAND_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
varying float vContact;
void main() {
  float dist = length(vWorld - cameraPosition);
  float near = 1.0 - smoothstep(60.0, 400.0, dist);
  // wind ripples: bands across the wind, bent by noise
  float along = dot(vWorld.xz, uWindDir);
  float rip = sin(along * 0.9 + vnoise(vWorld.xz * 0.05) * 7.0);
  vec3 N = normalize(vN + vec3(uWindDir.x, 0.0, uWindDir.y) * rip * 0.22 * near);
  vec3 L = normalize(uSunDir + vec3(0.0, 0.5, 0.0));
  float ndl = dot(N, L) * 0.5 + 0.5;
  vec3 sand = mix(uGroundShade, uGround, smoothstep(0.42, 0.78, ndl));
  sand *= 0.8 + 0.4 * fbm3(vWorld.xz * 0.012);
  sand += uSunColor * uGround * 0.5 * pow(max(dot(normalize(vN), normalize(uSunDir + vec3(0, 0.15, 0))), 0.0), 3.0);
  sand *= 1.0 - vContact * 0.65;
  vec3 emis = vec3(0.0);
  if (uSigilAmt > 0.0) {
    vec2 sp = (vWorld.xz - uSigilC.xz) / (uSigilR * 0.75);
    float s = sigil(sp * vec2(1.0, 1.0), -uTime * 0.6);
    emis += uSigilCol * s * uSigilAmt * 0.6;
    sand = mix(sand, sand * 0.6 + uSigilCol * 0.04, uSigilAmt * (1.0 - smoothstep(0.9, 1.15, length(sp))));
  }
  vec3 col = applyMist(sand, vWorld);
  col = applyFog(col, vWorld);
  float fogK = exp(-uFogDensity * uFogDensity * dist * dist);
  col += emis * fogK;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function makeSandMaterial(env: EnvUniforms, u: BoneUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...env, ...u },
    vertexShader: SAND_VERT,
    fragmentShader: ENV_GLSL + COMMON_GLSL + SAND_FRAG,
  });
}

// ── the sky sigil (a horizontal disc high above the bones) ──────────────

export function makeSigilMaterial(env: EnvUniforms, u: BoneUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...env, ...u },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      varying vec3 vWorld;
      void main() {
        vP = position.xy;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: ENV_GLSL + COMMON_GLSL + /* glsl */ `
      varying vec2 vP;
      varying vec3 vWorld;
      void main() {
        float r = length(vP);
        float s = sigil(vP, uTime);
        float pulse = 0.85 + 0.15 * sin(uTime * 0.9);
        vec3 lines = uSigilCol * s * 2.2 * pulse;
        vec3 fill = uSigilCol * 0.06 * (1.0 - smoothstep(0.6, 1.05, r)) + uSigilCol * 0.12 * exp(-abs(r - 1.0) * 30.0);
        vec3 col = (lines + fill) * uSigilAmt;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ── pillar stand-in (the pillar experiment owns the real one) ──────────

export function makePillarMaterial(env: EnvUniforms, u: BoneUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...env, ...u },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: ENV_GLSL + COMMON_GLSL + /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWorld);
        float ndl = dot(N, normalize(uBoneLight)) * 0.5 + 0.5;
        vec3 base = srgb(vec3(0.11, 0.09, 0.1));
        vec3 col = mix(base * (uAmbient + uHaze), base * (uSunColor + uHorizon), step(0.62, ndl));
        // blade grooves: thin vertical seams glowing faintly
        float a = atan(vWorld.z - uFan.z, vWorld.x - uFan.x);
        float seam = 1.0 - smoothstep(0.0, 0.06, abs(fract(a * 12.0 / 6.2831853) - 0.5) - 0.44);
        col += uEmberCol * seam * 0.35 * (0.6 + 0.4 * sin(vWorld.y * 0.05 - uTime * 0.8));
        col += uSunColor * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.25;
        // dusty contact band where the bones are skewered
        col *= 1.0 - 0.5 * exp(-abs(vWorld.y - uFan.y) / 10.0) * step(0.001, uFan.w);
        col = applyMist(col, vWorld);
        col = applyFog(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

// ── rising embers (THREE.Points, positions computed in the shader) ──────

export function makeEmberPoints(env: EnvUniforms, u: BoneUniforms, count: number) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) seed[i] = (i * 0.61803398875) % 1;
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = {
    ...env,
    ...u,
    uEmit: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uEmitN: { value: 1 },
    uPx: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform vec4 uEmit[4];   // xyz centre, w spread radius
      uniform float uEmitN;
      uniform float uEmberAmt;
      uniform float uTime;
      uniform float uPx;
      varying float vA;
      void main() {
        float s = aSeed;
        int ei = int(mod(floor(s * 97.0), uEmitN));
        vec4 e = uEmit[ei];
        float life = 7.0 + 5.0 * fract(s * 13.1);
        float age = fract((uTime + s * 61.0) / life);
        vec3 p = e.xyz + vec3((fract(s * 31.7) - 0.5), 0.0, (fract(s * 17.3) - 0.5)) * e.w;
        p.y += age * (30.0 + 25.0 * fract(s * 5.3));
        p.x += sin(uTime * 0.6 + s * 40.0) * 3.0 * age;
        p.z += cos(uTime * 0.5 + s * 23.0) * 2.0 * age;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.2 + 2.2 * fract(s * 7.7)) * uPx * 90.0 / max(-mv.z, 1.0);
        vA = sin(age * 3.14159) * uEmberAmt * (0.5 + 0.5 * sin(uTime * 3.0 + s * 50.0));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uEmberCol;
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(uEmberCol * (1.0 + 2.0 * a * a) * a * vA * 1.4, 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(g, material);
  points.frustumCulled = false;
  points.name = 'embers';
  return { points, uniforms };
}

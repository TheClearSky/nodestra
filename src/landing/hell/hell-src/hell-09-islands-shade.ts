// COPIED from .claude/pages/ad/experiments/hell-src/hell-09-islands-shade.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-09 island MATERIALS: one toon rock shader for every form (strata,
 * Eva ribs + holes, crag caves + drips, causeway speckle, cube ink edges),
 * the cap pools, the stand-in cloud deck, skirt puffs, the seal circle,
 * debris, chains and the pillar proxy.
 *
 * Colours are linear (THREE.Color linearises the sRGB hex). Every material
 * fogs itself toward the GRADE's fog / horizon hue — never toward grey.
 */

import * as THREE from 'three';
import { BILLBOARD_GLSL, ENV_GLSL, type EnvUniforms } from '../env-src/lab';
import { FORM_INDEX, type IslandShape } from './hell-09-islands-forms';

/** Uniforms shared by every island material (one object, many materials). */
export type Shared = {
  uUnder: { value: number }; // 0 skirt · 1 cool · 2 warm uplight · 3 black · 4 seal
  uDetail: { value: number }; // 0 plain · 1 bands · 2 folded · 3 bands + lips
  uCapMode: { value: number }; // 0 none · 1 yellow · 2 lava · 3 crimson
  uCapCol: { value: THREE.Color };
  uCapSpill: { value: number };
  uFogCol: { value: THREE.Color };
  uDeckY: { value: number };
  uHeightFog: { value: number };
  uPalette: { value: number }; // −1 native, else override
  uOverA: { value: THREE.Color };
  uOverB: { value: THREE.Color };
};

export function makeShared(): Shared {
  return {
    uUnder: { value: 0 },
    uDetail: { value: 3 },
    uCapMode: { value: 2 },
    uCapCol: { value: new THREE.Color('#fb6e17') },
    uCapSpill: { value: 0.6 },
    uFogCol: { value: new THREE.Color('#3a0c10') },
    uDeckY: { value: -75 },
    uHeightFog: { value: 1 },
    uPalette: { value: -1 },
    uOverA: { value: new THREE.Color('#3a1418') },
    uOverB: { value: new THREE.Color('#8a3a2a') },
  };
}

/** Native rock palettes per form: [body, highlight / strata / streak]. */
export const NATIVE: Record<string, [string, string]> = {
  mesa: ['#2a2428', '#7a6c48'],
  clover: ['#2c2528', '#7a6c48'],
  cone: ['#221c22', '#6a5040'],
  shell: ['#56648e', '#9a0f22'],
  crag: ['#2f6a64', '#9ad0bc'],
  causeway: ['#5e5048', '#958474'],
  cubes: ['#7a6c74', '#b0a0a6'],
};

// Shared GLSL: the grade fog (distance + the murk under the cloud deck).
const FOG_GLSL = /* glsl */ `
uniform vec3 uFogCol;
uniform float uDeckY;
uniform float uHeightFog;
vec3 gradeFog(vec3 col, vec3 world, float density) {
  vec3 toP = world - cameraPosition;
  float d = length(toP);
  vec3 dir = toP / max(d, 1e-3);
  float f = 1.0 - exp(-d * density);
  vec3 hz = mix(uFogCol, uHorizon, 0.45) + uSunColor * 0.18 * pow(max(dot(dir, uSunDir), 0.0), 6.0);
  col = mix(col, hz, f);
  // Everything under the deck sinks into murk (iq-style height fog, flipped).
  float hf = smoothstep(uDeckY + 18.0, uDeckY - 45.0, world.y) * uHeightFog;
  return mix(col, mix(uFogCol, uHaze, 0.3) * 0.9, hf);
}
// The two flat tones every cloud (deck and skirt puffs) is painted with, so
// the skirts read as the same cloud sea swallowing the island bottoms.
vec3 cloudShade() { return mix(uFogCol, uAmbient, 0.2) * 1.5 + uHaze * 0.8; }
vec3 cloudLit() { return mix(uHaze, uHorizon, 0.55) * 1.9 + uSunColor * 0.08 + uAmbient * 0.12; }
`;

// ── rock ────────────────────────────────────────────────────────────────

const ROCK_VERT = /* glsl */ `
attribute float aSpill;
attribute float aEdge;
#ifdef USE_CUBES
attribute vec2 aCube;
#endif
uniform float uTime;
uniform float uDetail;
uniform float uBandH;
uniform float uWaist;
uniform float uForm;
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vUv;
varying float vSpill;
varying float vEdge;
void main() {
  vec3 p = position;
  vec3 n = normal;
  #ifdef USE_INSTANCING
    p = (instanceMatrix * vec4(p, 1.0)).xyz;
    n = mat3(instanceMatrix) * n;
    #ifdef USE_CUBES
      p.y += sin(uTime * 0.35 + aCube.x) * aCube.y;
    #endif
  #endif
  // Strata lips (T9): every 4th band steps out a little, so the rim light
  // catches a real ledge. Walls only, above the waist, strata forms only.
  float strataForm = (uForm < 2.5 || abs(uForm - 5.0) < 0.5) ? 1.0 : 0.0;
  if (uDetail > 2.5 && strataForm > 0.5 && p.y > uWaist) {
    vec3 nn = normalize(n);
    float wallness = smoothstep(0.55, 0.85, 1.0 - abs(nn.y));
    float saw = 1.0 - fract(p.y / (uBandH * 4.0));
    p.xz += normalize(nn.xz + 1e-5) * uBandH * 0.55 * saw * wallness;
  }
  vLocal = p;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  vUv = uv;
  vSpill = aSpill;
  vEdge = aEdge;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const ROCK_FRAG = /* glsl */ `
${ENV_GLSL}
${FOG_GLSL}
uniform float uTop;
uniform float uWaist;
uniform float uBottom;
uniform float uR;
uniform float uForm;
uniform float uSeed;
uniform float uBandH;
uniform vec2 uShellLH;
uniform vec3 uRockA;
uniform vec3 uRockB;
uniform float uUnder;
uniform float uDetail;
uniform float uCapMode;
uniform vec3 uCapCol;
uniform float uCapSpill;
uniform float uPalette;
uniform vec3 uOverA;
uniform vec3 uOverB;
uniform float uFogDen;
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vUv;
varying float vSpill;
varying float vEdge;

// Arched cave mouths in a (horizontal, vertical) metre grid (Bleach crags).
float caves(vec2 p, float cell) {
  vec2 g = p / vec2(cell, cell * 1.25);
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash12(id + uSeed * 7.0);
  if (h < 0.6) return 0.0;
  vec2 c = (hash22(id + 3.1) - 0.5) * 0.3;
  vec2 q = (f - c) / (0.14 + 0.1 * h);
  float d = q.y > 0.0 ? length(q * vec2(1.0, 0.8)) : abs(q.x);
  return (1.0 - smoothstep(0.85, 1.0, d)) * smoothstep(-1.45, -1.3, q.y);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float topness = smoothstep(0.55, 0.85, N.y);
  float wall = 1.0 - topness;
  float below = clamp((uWaist - vLocal.y) / max(uWaist - uBottom, 1e-3), 0.0, 1.0);
  vec3 rockA = uPalette < -0.5 ? uRockA : uOverA;
  vec3 rockB = uPalette < -0.5 ? uRockB : uOverB;
  vec3 base = rockA;
  float detail = step(0.5, uDetail);
  // Horizontal coordinate on the walls without an atan seam: blend two
  // planar projections by the normal (Golus triplanar weights, pow 4).
  vec2 wN = pow(abs(N.xz) + 1e-4, vec2(4.0));
  wN /= (wN.x + wN.y);
  float sx = vLocal.z;
  float sz = vLocal.x;

  if (uForm < 2.5 || abs(uForm - 5.0) < 0.5) {
    // ── strata (T8): pale broken lines on world-Y bands, wobbled ──
    float yy = vLocal.y / uBandH;
    if (uDetail > 1.5 && uDetail < 2.5) {
      // Folded geology: domain-warped band height (T11).
      vec2 q = vec2(vLocal.x + vLocal.z, vLocal.y) * 0.025;
      vec2 w = vec2(fbm3(q + uSeed), fbm3(q + vec2(5.2, 1.3) + uSeed));
      yy += (fbm3(q * 1.4 + 2.2 * w) - 0.5) * 10.0;
    } else {
      yy += (vnoise(vLocal.xz * 0.035 + uSeed) - 0.5) * 1.6;
    }
    float layer = floor(yy);
    float f = fract(yy);
    float line = smoothstep(0.0, 0.07, f) * (1.0 - smoothstep(0.11, 0.18, f));
    float groove = smoothstep(0.18, 0.26, f) * (1.0 - smoothstep(0.34, 0.48, f));
    float brkA = vnoise(vec2(sx * 0.16, layer * 3.7 + uSeed));
    float brkB = vnoise(vec2(sz * 0.16, layer * 3.7 + uSeed + 9.0));
    float brk = smoothstep(0.3, 0.6, mix(brkA, brkB, wN.y));
    float tone = hash12(vec2(layer, uSeed));
    float major = step(0.75, hash12(vec2(floor(layer / 4.0), uSeed + 2.0)));
    vec3 wallC = rockA * (0.75 + 0.55 * tone);
    wallC = mix(wallC, rockB, line * brk * detail * (0.75 + 0.25 * major));
    wallC *= 1.0 - 0.5 * groove * detail;
    // Tops: speckled, mottled plate (the causeway reads mostly from its top).
    float mott = fbm3(vLocal.xz * 0.06 + uSeed) * 0.7 + hash12(floor(vLocal.xz * 1.3)) * 0.3;
    vec3 topC = mix(rockA * 0.9, rockB * 0.85, smoothstep(0.35, 0.8, mott) * (abs(uForm - 5.0) < 0.5 ? 1.0 : 0.35));
    base = mix(wallC, topC, topness);
    // Causeway: walls fall to black right under the lip (Inuyasha FA).
    if (abs(uForm - 5.0) < 0.5) base *= mix(1.0, smoothstep(-uR * 0.06, -uR * 0.005, vLocal.y), wall);
  } else if (uForm < 3.5) {
    // ── Eva shell: bored holes, contour ribs, red streaks running down ──
    vec2 m = vec2(vUv.x * uShellLH.x, vUv.y * uShellLH.y);
    float rimDark = 1.0;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      vec2 h = hash22(vec2(fi * 3.7, uSeed));
      if (h.x < 0.25) continue;
      vec2 c = vec2((fi + 0.25 + h.y * 0.5) / 6.0 * uShellLH.x, (h.x - 0.55) * 1.0 * uShellLH.y);
      float r = uShellLH.y * (0.12 + 0.12 * h.y);
      float d = length(m - c);
      if (d < r) discard;
      rimDark = min(rimDark, smoothstep(r, r * 1.35, d));
    }
    float rib = sin(vUv.y * 75.0 + sin(vUv.x * 7.0 + uSeed) * 5.0 + vUv.x * 22.0);
    float groove = smoothstep(0.5, 0.95, rib) * detail;
    base = rockA * (1.0 - 0.45 * groove);
    float runs = vnoise(vec2(vUv.x * 95.0, vUv.y * 1.6 + uSeed));
    float red = smoothstep(0.5, 0.72, runs + (vUv.y * 0.5 + 0.5) * 0.6 - 0.32);
    float splat = step(0.86, hash12(floor(m * 0.9))) * 0.8;
    base = mix(base, rockB, clamp(red + splat, 0.0, 1.0) * mix(0.6, 1.0, detail));
    base *= mix(0.12, 1.0, rimDark);
  } else if (uForm < 4.5) {
    // ── crag: vertical drip grooves and arched cave pockets ──
    float dripA = vnoise(vec2(sx * 0.3, vLocal.y * 0.018));
    float dripB = vnoise(vec2(sz * 0.3, vLocal.y * 0.018 + 4.0));
    float drip = mix(dripA, dripB, wN.y);
    base = rockA * mix(1.0, 0.62, smoothstep(0.55, 0.75, drip) * detail);
    base = mix(base, rockB * 0.8, smoothstep(0.68, 0.8, 1.0 - drip) * 0.35 * detail);
    float cell = uR * 0.16;
    float cv = mix(caves(vec2(sx, vLocal.y), cell), caves(vec2(sz + 31.0, vLocal.y), cell), wN.y);
    cv *= (1.0 - topness) * (1.0 - smoothstep(0.0, 0.5, below)) * detail;
    base = mix(base, rockA * 0.06, cv);
  } else {
    // ── cubes: flat faces with an ink edge from the box uv ──
    vec2 e2 = min(vUv, 1.0 - vUv);
    float e = min(e2.x, e2.y);
    base = mix(rockA, rockB, 0.25 * topness);
    base *= mix(0.25, 1.0, smoothstep(0.015, 0.05, e));
  }

  // ── toon light (T13): backlit key, sky/ground fill, tops one band up ──
  float ndl = dot(N, uSunDir);
  float key = 0.5 * smoothstep(-0.02, 0.06, ndl) + 0.5 * smoothstep(0.42, 0.5, ndl);
  vec3 skyFill = uAmbient * 2.4 + uHorizon * 0.5;
  vec3 groundFill = uFogCol * 1.2;
  vec3 fill = mix(groundFill, skyFill, smoothstep(-0.4, 0.6, N.y));
  vec3 light = fill * (0.8 + 0.7 * topness) + uSunColor * key * 0.9 + 0.04;
  vec3 col = base * light;
  // Dark lip line round every flat top (the drawn edge).
  col *= 1.0 - 0.55 * smoothstep(0.86, 0.98, abs(vEdge)) * topness;
  // Fresnel rim on the sun side (T14), stepped for anime crispness.
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  float back = pow(max(dot(-V, uSunDir), 0.0), 1.5);
  col += uSunColor * smoothstep(0.32, 0.4, fres * (0.35 + 0.65 * back)) * 0.5 * (1.0 - below);
  // Cap glow spilling over the lip onto the wall just below it (T22).
  col += uCapCol * uCapSpill * exp(-vSpill / max(uR * 0.06, 1.0)) * wall * (1.0 - below) * step(1.5, uCapMode);

  // ── underside switch (T16) ──
  float face = max(-N.y, 0.0);
  int mode = int(uUnder + 0.5);
  if (mode == 0) {
    // Cloud skirt: dissolve into the cloud colour toward the tip.
    vec3 cloudC = mix(uFogCol * 1.6, uHaze * 1.5, 0.5) + uAmbient * 0.4;
    if (uForm > 3.5 && uForm < 4.5) cloudC = mix(cloudC, uHorizon * 1.4 + 0.04, 0.5); // crag: paler mist
    col = mix(col, cloudC, smoothstep(0.05, 0.85, below) * 0.92);
  } else if (mode == 1) {
    // Cool and unlit: no bounce from below, the mass falls to navy.
    vec3 navy = srgb(vec3(0.07, 0.08, 0.2));
    col = mix(col, navy * (0.55 + 0.6 * face), smoothstep(0.0, 0.7, below));
  } else if (mode == 2) {
    // Warm-red uplight (Hell Verse Lowermost): fire below, stepped bands.
    vec3 hot = mix(srgb(vec3(0.925, 0.545, 0.08)), srgb(vec3(0.69, 0.125, 0.1)), below);
    float band = 0.35 * smoothstep(0.05, 0.15, face) + 0.65 * smoothstep(0.5, 0.6, face);
    col += hot * base * 6.0 * band * (0.4 + 0.6 * below) + hot * 0.05 * smoothstep(0.2, 0.8, below);
  } else if (mode == 3) {
    // Fall to black (Inuyasha).
    col *= pow(1.0 - below, 2.2);
  } else {
    // Seal-borne: the crimson circle underneath washes the belly red.
    vec3 seal = srgb(vec3(0.75, 0.05, 0.12));
    float pulse = 0.8 + 0.2 * sin(uTime * 1.3 + uSeed);
    float band = 0.4 * smoothstep(0.05, 0.15, face) + 0.6 * smoothstep(0.55, 0.62, face);
    col = mix(col, col * 0.4, below);
    col += seal * (base * 5.0 + 0.03) * band * pulse * (0.3 + 0.7 * below);
  }
  col = gradeFog(col, vWorld, uFogDen);
  gl_FragColor = vec4(col, 1.0);
}
`;

export type RockMaterial = THREE.ShaderMaterial & { setPalette?: never };

export function makeRockMaterial(env: EnvUniforms, shared: Shared, shape: IslandShape, seed: number, fogDen: number): THREE.ShaderMaterial {
  const [a, b] = NATIVE[shape.form];
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...env,
      ...shared,
      uTop: { value: shape.top },
      uWaist: { value: shape.waist },
      uBottom: { value: shape.bottom },
      uR: { value: shape.radius },
      uForm: { value: FORM_INDEX[shape.form] },
      uSeed: { value: (seed % 97) * 0.731 },
      uBandH: { value: Math.max(1.0, shape.radius * 0.028) },
      uShellLH: { value: new THREE.Vector2(...(shape.shellLH ?? [1, 1])) },
      uRockA: { value: new THREE.Color(a) },
      uRockB: { value: new THREE.Color(b) },
      uFogDen: { value: fogDen },
    },
    vertexShader: ROCK_VERT,
    fragmentShader: ROCK_FRAG,
  });
  if (shape.cubes) material.defines = { USE_CUBES: '' };
  return material;
}

// ── cap pools (T22) ─────────────────────────────────────────────────────

export function makeCapMaterial(env: EnvUniforms, shared: Shared): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...env, ...shared },
    vertexShader: /* glsl */ `
      attribute float aEdge;
      varying vec3 vWorld;
      varying float vEdge;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vEdge = aEdge;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${FOG_GLSL}
      uniform float uCapMode;
      varying vec3 vWorld;
      varying float vEdge;
      void main() {
        vec3 col;
        float edge = abs(vEdge);
        vec2 p = vWorld.xz;
        if (uCapMode < 1.5) {
          // Poison yellow: flat and unlit — the flatness IS the anime read.
          col = srgb(vec3(0.847, 0.745, 0.0)) * 1.05;
        } else if (uCapMode < 2.5) {
          // Lava: domain-warped churn, hot cracks pushed over the bloom threshold.
          vec2 q = p * 0.045;
          vec2 w = vec2(fbm3(q + vec2(uTime * 0.05, 0.0)), fbm3(q + vec2(5.2, 1.3) - uTime * 0.04));
          float n = fbm3(q * 1.3 + 2.6 * w);
          vec3 crust = srgb(vec3(0.23, 0.04, 0.02));
          vec3 orange = srgb(vec3(0.984, 0.43, 0.09)) * 2.2;
          vec3 core = srgb(vec3(0.996, 0.94, 0.47)) * 3.2;
          col = mix(crust, orange, smoothstep(0.38, 0.62, n));
          col = mix(col, core, smoothstep(0.7, 0.8, n));
          col = mix(col, orange * 1.2, smoothstep(0.75, 1.0, edge) * 0.6);
        } else {
          // Crimson pool: dark red, slow breathing pulse and drifting ripples
          // — the caps echo the magic circles in the sky.
          float d = length(fract(p * 0.012) - 0.5);
          float rip = smoothstep(0.03, 0.0, abs(fract(d * 4.0 - uTime * 0.15) - 0.5) - 0.44);
          float pulse = 0.75 + 0.25 * sin(uTime * 0.9);
          col = srgb(vec3(0.42, 0.02, 0.06)) * (1.4 * pulse) + srgb(vec3(1.0, 0.15, 0.2)) * rip * 0.9;
          col += srgb(vec3(1.0, 0.1, 0.15)) * smoothstep(0.8, 1.0, edge) * 0.8;
        }
        // Thin dark lip between pool and rock.
        col *= 1.0 - 0.7 * smoothstep(0.93, 0.99, edge);
        col = gradeFog(col, vWorld, 0.0009);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
}

// ── stand-in cloud deck (T18, kept simple: the clouds study owns the real one) ──

export function makeDeck(env: EnvUniforms, shared: Shared): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(7000, 7000, 220, 220);
  geometry.rotateX(-Math.PI / 2);
  const deckH = /* glsl */ `
    float deckH(vec2 xz) {
      vec2 q = xz * 0.0042 + vec2(uTime * 0.006, uTime * 0.002);
      float a = fbm3(q);
      float b = 1.0 - abs(2.0 * vnoise(q * 3.1 + 7.0) - 1.0);
      return (a * 0.72 + b * 0.28) * 48.0;
    }
  `;
  // Height and normal are worked out per VERTEX (three noise lookups each)
  // and interpolated; the fragment shader only paints. Doing the finite
  // differences per pixel cost a third of the frame on an integrated GPU.
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env, ...shared },
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      ${deckH}
      uniform float uDeckY;
      varying vec3 vWorld;
      varying vec3 vNrm;
      varying float vHt;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        float e = 12.0;
        float h = deckH(w.xz);
        vNrm = normalize(vec3(h - deckH(w.xz + vec2(e, 0.0)), e, h - deckH(w.xz + vec2(0.0, e))));
        vHt = h / 48.0;
        w.y = uDeckY + h - 24.0;
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${FOG_GLSL}
      varying vec3 vWorld;
      varying vec3 vNrm;
      varying float vHt;
      void main() {
        vec3 n = normalize(vNrm);
        float ht = vHt;
        vec3 V = normalize(cameraPosition - vWorld);
        float l = dot(n, normalize(uSunDir + vec3(0.0, 0.6, 0.0))) * 0.5 + 0.5;
        // Three flat painted bands: trough shade, mid, lit crest. A little
        // value noise wobbles the terminator so the bands read as brushed.
        float lv = l * 0.6 + ht * 0.7 + (vnoise(vWorld.xz * 0.02) - 0.5) * 0.08;
        float band = 0.45 * smoothstep(0.52, 0.56, lv) + 0.55 * smoothstep(0.78, 0.82, lv);
        vec3 c = mix(cloudShade(), cloudLit(), band);
        c *= mix(0.55, 1.0, smoothstep(0.12, 0.4, ht));
        // Silver lining on crests toward the hidden sun.
        c += uSunColor * pow(max(dot(-V, uSunDir), 0.0), 3.0) * smoothstep(0.55, 0.9, ht) * 0.3;
        vec3 toP = vWorld - cameraPosition;
        float d = length(toP);
        float f = 1.0 - exp(-d * 0.0011);
        vec3 hz = mix(uFogCol, uHorizon, 0.55) + uSunColor * 0.2 * pow(max(dot(toP / d, uSunDir), 0.0), 6.0);
        c = mix(c, hz, f);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'deck';
  mesh.frustumCulled = false;
  mesh.renderOrder = -6;
  return mesh;
}

// ── skirt puffs (T17) ───────────────────────────────────────────────────

/** A puff circles its island slowly: (cx, y, cz, size) and (radius, angle, ω, seed). */
export type Puff = { cx: number; y: number; cz: number; size: number; r: number; a: number; w: number; seed: number };

export function makePuffs(env: EnvUniforms, shared: Shared, puffs: Puff[]): THREE.Mesh {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const a = new Float32Array(puffs.length * 4);
  const b = new Float32Array(puffs.length * 4);
  puffs.forEach((p, i) => {
    a.set([p.cx, p.y, p.cz, p.size], i * 4);
    b.set([p.r, p.a, p.w, p.seed], i * 4);
  });
  geometry.setAttribute('aA', new THREE.InstancedBufferAttribute(a, 4));
  geometry.setAttribute('aB', new THREE.InstancedBufferAttribute(b, 4));
  geometry.instanceCount = puffs.length;
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env, ...shared },
    vertexShader: /* glsl */ `
      ${BILLBOARD_GLSL}
      uniform float uTime;
      attribute vec4 aA;
      attribute vec4 aB;
      varying vec2 vUv;
      varying vec3 vCentre;
      varying vec3 vWorld;
      varying float vSeed;
      void main() {
        float ang = aB.y + uTime * aB.z;
        vec3 c = vec3(aA.x + cos(ang) * aB.x, aA.y + sin(uTime * 0.2 + aB.w) * aA.w * 0.05, aA.z + sin(ang) * aB.x);
        vCentre = c;
        vSeed = aB.w;
        vUv = position.xy;
        // Wider than tall: a skirt reads as a cloud bank, round puffs read as bubbles.
        vec3 w = billboard(c, position.xy, vec2(aA.w * 1.7, aA.w * 0.9));
        vWorld = w;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${FOG_GLSL}
      varying vec2 vUv;
      varying vec3 vCentre;
      varying vec3 vWorld;
      varying float vSeed;
      void main() {
        vec2 uv = vUv * 1.15;
        float r = length(uv);
        if (r > 1.12) discard;
        vec2 en = uv * 2.4 + vSeed * 3.0;
        float edgeNoise = (vnoise(en) * 0.65 + vnoise(en * 2.3) * 0.35) - 0.5;
        float alpha = smoothstep(1.0, 0.68, r + edgeNoise * 0.24);
        if (alpha < 0.01) discard;
        float z = sqrt(max(0.0, 1.0 - min(r, 1.0) * min(r, 1.0)));
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 fwd = normalize(cameraPosition - vCentre);
        vec3 n = normalize(right * uv.x + up * uv.y + fwd * z);
        // Lit from above like the deck crests (a puff is a crest of the same
        // cloud sea), with a wobbly painted terminator.
        float l = n.y * 0.5 + 0.62 + edgeNoise * 0.35 + 0.1 * dot(n, uSunDir);
        float band = 0.45 * smoothstep(0.5, 0.54, l) + 0.55 * smoothstep(0.7, 0.74, l);
        vec3 c = mix(cloudShade(), cloudLit(), band);
        vec3 V = normalize(cameraPosition - vWorld);
        // Silver lining toward the hidden sun.
        c += uSunColor * smoothstep(0.55, 0.8, 1.0 - z) * pow(max(dot(-V, uSunDir), 0.0), 3.0) * 0.25;
        c = gradeFog(c, vWorld, 0.0011);
        gl_FragColor = vec4(c, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'puffs';
  return mesh;
}

// ── the seal: a dark red magic circle holding the island up ─────────────

export function makeSealMaterial(env: EnvUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...env, uSpin: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv * 2.0 - 1.0;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      uniform float uSpin;
      varying vec2 vUv;
      varying vec3 vWorld;
      mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
      // iq: signed distance to an equilateral triangle of "radius" r.
      float sdTri(vec2 p, float r) {
        const float k = 1.7320508;
        p.x = abs(p.x) - r;
        p.y = p.y + r / k;
        if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
        p.x -= clamp(p.x, -2.0 * r, 0.0);
        return -length(p) * sign(p.y);
      }
      float ln(float d, float w) { return 1.0 - smoothstep(w * 0.5, w, abs(d)); }
      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;
        float t = uTime;
        vec2 pa = rot(t * 0.12) * vUv;
        vec2 pb = rot(-t * 0.08) * vUv;
        float th = atan(pa.y, pa.x);
        float w = 0.012;
        float m = 0.0;
        m += ln(r - 0.97, w) + ln(r - 0.9, w * 0.7) + ln(r - 0.62, w) + ln(r - 0.3, w * 0.8);
        // Glyph ring: ticks and blocks between the two outer rings.
        float glyph = step(0.5, fract(th * 48.0 / 6.2832)) * step(0.35, hash12(vec2(floor(th * 48.0 / 6.2832), 3.0)));
        m += glyph * step(0.915, r) * step(r, 0.955) * 0.8;
        // Hexagram: two triangles, counter-rotating.
        m += ln(sdTri(pb, 0.53), w);
        m += ln(sdTri(-pb, 0.53), w);
        // Inner runes.
        float th2 = atan(pb.y, pb.x);
        m += step(0.6, fract(th2 * 12.0 / 6.2832)) * step(0.33, r) * step(r, 0.36);
        float pulse = 0.75 + 0.25 * sin(t * 1.3);
        vec3 core = srgb(vec3(0.95, 0.06, 0.1)); // dark red, kept under the bloom knee so it stays red, not pink
        vec3 deep = srgb(vec3(0.45, 0.0, 0.05));
        vec3 col = core * m * 1.5 * pulse + deep * exp(-abs(r - 0.94) * 14.0) * 0.6 + deep * 0.12 * (1.0 - r);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ── debris (T19): GPU-animated fragments orbiting and falling off ───────

export const MAX_ISL = 8;

export function makeDebris(env: EnvUniforms, shared: Shared, count: number, islandOf: (i: number) => number, rnd: () => number) {
  const rock = new THREE.IcosahedronGeometry(1, 0);
  const p = rock.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.7 + rnd() * 0.6), p.getY(i) * (0.6 + rnd() * 0.6), p.getZ(i) * (0.7 + rnd() * 0.6));
  rock.computeVertexNormals();
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = rock.index;
  geometry.setAttribute('position', rock.attributes.position);
  geometry.setAttribute('normal', rock.attributes.normal);
  const d1 = new Float32Array(count * 4);
  const d2 = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const family = i % 2; // 0 orbit, 1 shed
    d1.set([islandOf(i), rnd() * Math.PI * 2, rnd(), rnd()], i * 4);
    d2.set([0.4 + Math.pow(rnd(), 3) * 2.2, 0.6 + rnd() * 0.8, family, rnd() < 0.18 ? 1 : 0], i * 4);
  }
  geometry.setAttribute('aD1', new THREE.InstancedBufferAttribute(d1, 4));
  geometry.setAttribute('aD2', new THREE.InstancedBufferAttribute(d2, 4));
  geometry.instanceCount = count;
  const uIslA = { value: Array.from({ length: MAX_ISL }, () => new THREE.Vector4()) };
  const uIslB = { value: Array.from({ length: MAX_ISL }, () => new THREE.Vector4()) };
  const uMode = { value: 3 };
  const uDrift = { value: new THREE.Vector3(-6, 0, 1) };
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env, ...shared, uIslA, uIslB, uMode, uDrift },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec4 uIslA[${MAX_ISL}];
      uniform vec4 uIslB[${MAX_ISL}];
      uniform float uMode;
      uniform vec3 uDrift;
      attribute vec4 aD1;
      attribute vec4 aD2;
      varying vec3 vWorld;
      varying vec3 vN;
      varying float vHot;
      varying float vLife;
      mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
      mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
      void main() {
        int i = int(aD1.x + 0.5);
        vec4 A = uIslA[i];   // waist centre (world) + footprint radius
        vec4 B = uIslB[i];   // depth to the tip, scale, visible
        float fam = aD2.z;
        float on = B.z * ((fam < 0.5) ? step(0.5, mod(uMode, 2.0)) : step(1.5, uMode));
        float R = A.w;
        float size = aD2.x * R * 0.012 + 0.25;
        vec3 c;
        float s = 1.0;
        float life = 0.0;
        if (fam < 0.5) {
          // A loose ring of rubble circling the waist, slowly sinking and rising.
          float ang = aD1.y + uTime * (0.04 + 0.03 * aD1.w) * (aD1.z > 0.5 ? 1.0 : -1.0) * 0.6;
          float rr = R * (1.05 + aD1.z * 0.45);
          c = A.xyz + vec3(cos(ang) * rr, -B.x * (0.15 + 0.35 * aD1.w) + sin(uTime * 0.3 + aD1.y * 3.0) * R * 0.03, sin(ang) * rr);
        } else {
          // Shedding: leaves the underside, falls with a sideways drift, fades.
          float period = 16.0 / aD2.y;
          life = fract(uTime / period + aD1.w);
          float rr = R * 0.75 * sqrt(aD1.z) * (1.0 - 0.5 * aD1.w);
          vec3 start = A.xyz + vec3(cos(aD1.y) * rr, -B.x * (0.2 + 0.6 * aD1.w), sin(aD1.y) * rr);
          c = start + uDrift * life * 6.0 * (0.4 + aD1.z) + vec3(0.0, -life * life * R * 1.4, 0.0);
          s = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.7, 1.0, life));
        }
        mat3 spin = rotY(uTime * (0.3 + aD1.z) + aD1.y) * rotX(uTime * 0.2 + aD1.w * 6.0);
        vec3 w = c + spin * position * size * s * on;
        vWorld = w;
        vN = spin * normal;
        vHot = aD2.w;
        vLife = life;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${FOG_GLSL}
      varying vec3 vWorld;
      varying vec3 vN;
      varying float vHot;
      varying float vLife;
      void main() {
        vec3 N = normalize(vN);
        float key = step(0.1, dot(N, uSunDir));
        vec3 rock = srgb(vec3(0.13, 0.1, 0.11));
        vec3 col = rock * (uAmbient * 2.4 + uSunColor * key * 0.8 + 0.04);
        // A few embers: hot fragments, cooling as they fall.
        col = mix(col, srgb(vec3(0.984, 0.43, 0.09)) * 2.4 * (1.0 - vLife * 0.7), vHot);
        col = gradeFog(col, vWorld, 0.001);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'debris';
  return { mesh, uIslA, uIslB, uMode, dispose: () => (geometry.dispose(), material.dispose(), rock.dispose()) };
}

// ── chains (T20): iron links or flowing light dashes along a sagging curve ──

export const MAX_CHAINS = 12;

export function makeChains(env: EnvUniforms, shared: Shared, kind: 'iron' | 'light', perChain: number) {
  const unit = kind === 'iron' ? new THREE.TorusGeometry(1, 0.3, 6, 14) : new THREE.BoxGeometry(1, 1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = unit.index;
  geometry.setAttribute('position', unit.attributes.position);
  geometry.setAttribute('normal', unit.attributes.normal);
  const total = MAX_CHAINS * perChain;
  const link = new Float32Array(total * 4);
  for (let c = 0; c < MAX_CHAINS; c++) {
    for (let k = 0; k < perChain; k++) link.set([c, (k + 0.5) / perChain, k % 2, 0], (c * perChain + k) * 4);
  }
  geometry.setAttribute('aLink', new THREE.InstancedBufferAttribute(link, 4));
  geometry.instanceCount = total;
  const uA = { value: Array.from({ length: MAX_CHAINS }, () => new THREE.Vector4()) };
  const uB = { value: Array.from({ length: MAX_CHAINS }, () => new THREE.Vector4()) };
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env, ...shared, uA, uB, uPer: { value: perChain }, uLight: { value: kind === 'light' ? 1 : 0 } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec4 uA[${MAX_CHAINS}];  // island anchor xyz, sag (fraction of span)
      uniform vec4 uB[${MAX_CHAINS}];  // target xyz, visible
      uniform float uPer;
      uniform float uLight;
      attribute vec4 aLink;
      varying vec3 vWorld;
      varying vec3 vN;
      varying float vGlow;
      void main() {
        int c = int(aLink.x + 0.5);
        vec4 A = uA[c];
        vec4 B = uB[c];
        float s = aLink.y;
        // Light dashes flow up the chain toward the island.
        if (uLight > 0.5) s = fract(s - uTime * 0.035);
        vec3 AB = B.xyz - A.xyz;
        float span = length(AB);
        float sag = A.w * span * (1.0 + 0.05 * sin(uTime * 0.4 + float(c)));
        // Parabola ≈ catenary for sag/span ≤ 1/4 (within 2%).
        vec3 P = A.xyz + AB * s - vec3(0.0, 4.0 * sag * s * (1.0 - s), 0.0);
        vec3 T = normalize(AB - vec3(0.0, 4.0 * sag * (1.0 - 2.0 * s), 0.0));
        vec3 B1 = normalize(cross(T, abs(T.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
        vec3 B2 = cross(B1, T);
        float spacing = span / uPer;
        vec3 Y = aLink.z > 0.5 ? B2 : B1;
        vec3 Z = cross(T, Y);
        vec3 lp = position;
        if (uLight > 0.5) lp *= vec3(spacing * 0.55, max(spacing * 0.16, 0.35), max(spacing * 0.16, 0.35));
        else lp *= vec3(spacing / 2.1 * 1.0, spacing / 2.1 * 0.62, spacing / 2.1 * 0.62);
        vec3 w = P + T * lp.x + Y * lp.y + Z * lp.z;
        w = mix(P, w, B.w);
        vWorld = w;
        vN = normalize(T * normal.x + Y * normal.y + Z * normal.z);
        vGlow = 0.35 + 1.6 * pow(0.5 + 0.5 * sin(aLink.y * 60.0 - uTime * 4.0), 8.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${FOG_GLSL}
      uniform float uLight;
      varying vec3 vWorld;
      varying vec3 vN;
      varying float vGlow;
      void main() {
        vec3 col;
        if (uLight > 0.5) {
          col = srgb(vec3(1.0, 0.14, 0.18)) * 1.6 * vGlow;
          col = gradeFog(col, vWorld, 0.0005);
        } else {
          vec3 N = normalize(vN);
          vec3 V = normalize(cameraPosition - vWorld);
          float key = smoothstep(0.0, 0.1, dot(N, uSunDir));
          vec3 iron = srgb(vec3(0.16, 0.13, 0.14));
          col = iron * (uAmbient * 2.2 + uSunColor * key + 0.03);
          col += uSunColor * smoothstep(0.55, 0.65, pow(1.0 - max(dot(N, V), 0.0), 2.0)) * 0.35;
          col = gradeFog(col, vWorld, 0.0011);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = `chains-${kind}`;
  return { mesh, uA, uB };
}

// ── pillar proxy (scale reference on the centre line) ───────────────────

export function makePillar(env: EnvUniforms, shared: Shared): THREE.Mesh {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 40; i++) {
    const y = -200 + (i / 40) * 3400;
    const flare = Math.exp(-(y + 120) / 140) * 60;
    pts.push(new THREE.Vector2(72 + flare, y));
  }
  const geometry = new THREE.LatheGeometry(pts, 48);
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env, ...shared },
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
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${FOG_GLSL}
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 body = srgb(vec3(0.1, 0.08, 0.1));
        vec3 col = body * (uAmbient * 2.0 + 0.03);
        // Mouldings every 120 m so the eye can count the height.
        col *= 1.0 - 0.35 * step(0.92, fract(vWorld.y / 120.0));
        float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
        col += uSunColor * smoothstep(0.5, 0.6, fres) * 0.6;
        col = gradeFog(col, vWorld, 0.0007);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'pillar';
  return mesh;
}

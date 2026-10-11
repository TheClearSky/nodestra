// COPIED from .claude/pages/ad/experiments/hell-src/hell-10-particles-and-mist-sparks.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-10 particles: embers (A1), ash (A2) and near-camera bokeh (A3).
 *
 * All three are INSTANCED QUADS (never THREE.Points: they stall this
 * machine's ANGLE/D3D11 path) with STATELESS motion: every particle's
 * position is a closed function of time and its seeds, so nothing
 * accumulates and any frame can be rendered at any time.
 */

import * as THREE from 'three';
import { ENV_GLSL, seededRandom, type EnvUniforms } from '../env-src/lab';
import { CIRCLE, CURL_GLSL, DUNE_GLSL, FOG_GLSL, PILLAR, type FogUniforms } from './hell-10-particles-and-mist-glsl';

/** A unit quad (corners −1…1) drawn `max` times, each instance with 4 random seeds. */
function seededQuads(max: number, seed: number): THREE.InstancedBufferGeometry {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const rand = seededRandom(seed);
  const seeds = new Float32Array(max * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = max;
  return geo;
}

/** Viewport (drawing-buffer pixels) kept current by onBeforeRender. */
function trackViewport(mesh: THREE.Mesh, viewport: THREE.Vector2) {
  mesh.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(viewport);
  };
}

// ── A1 · embers ─────────────────────────────────────────────────────────

export const EMBER_DESIGNS = {
  dots: 0, // soft round dots, curl wander, flicker, cooling ramp
  streaks: 1, // velocity-stretched sparks (motion-blur look)
  kira: 2, // anime four-point "kira" stars
  vortex: 3, // a share spirals up into the sky circle
  gust: 4, // dots that turn into streaks while a wind gust passes
} as const;

export type Embers = {
  mesh: THREE.Mesh;
  uniforms: Record<string, { value: unknown }>;
  setCount(n: number): void;
  max: number;
};

export function createEmbers(env: EnvUniforms, fog: FogUniforms, max = 5000): Embers {
  const geo = seededQuads(max, 1001);
  const viewport = new THREE.Vector2(1280, 720);
  const uniforms = {
    ...env,
    ...fog,
    uViewport: { value: viewport },
    uDesign: { value: 0 },
    uPillar: { value: PILLAR.clone() },
    uCircle: { value: CIRCLE.clone() },
    uPillarShare: { value: 0.45 }, // share of embers born at the pillar foot / vents
    uVortexShare: { value: 0.0 },
    uBoxCentre: { value: new THREE.Vector2(-20, -110) },
    uBoxSize: { value: new THREE.Vector2(340, 300) },
    uRise: { value: 1.6 }, // m/s
    uLife: { value: 14 }, // s
    uWander: { value: 7 }, // m
    uCool: { value: 1.1 },
    uSize: { value: 0.16 }, // m
    uTrail: { value: 0.05 }, // share of life the streak covers
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      ${DUNE_GLSL}
      ${CURL_GLSL}
      ${FOG_GLSL}
      uniform vec2 uViewport;
      uniform float uDesign;
      uniform vec3 uPillar;
      uniform vec3 uCircle;
      uniform float uPillarShare;
      uniform float uVortexShare;
      uniform vec2 uBoxCentre;
      uniform vec2 uBoxSize;
      uniform float uRise;
      uniform float uLife;
      uniform float uWander;
      uniform float uCool;
      uniform float uSize;
      uniform float uTrail;
      attribute vec4 aSeed;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vShape;
      varying float vStreak;

      // Gust envelope: a sin² bump of W seconds every P seconds, and its
      // running integral (so a gust shoves each ember by exactly the wind it lived through).
      const float GP = 11.0;
      const float GW = 3.5;
      float gustEnv(float t) {
        float u = mod(t, GP);
        if (u > GW) return 0.0;
        float s = sin(3.14159 * u / GW);
        return s * s;
      }
      float gustInt(float t) {
        float u = mod(t, GP);
        float x = min(u / GW, 1.0);
        return floor(t / GP) * GW * 0.5 + GW * (x * 0.5 - sin(6.28318 * x) / 12.566);
      }

      // Where ember (seeds s) is at age a (0…1) of lifetime 'life', at time t.
      vec3 emberPos(vec4 s, float a, float life, float cyc, float t, out float vortex) {
        vec2 r = hash22(s.xy * 91.7 + cyc * 13.1);
        float atPillar = step(s.z, uPillarShare);
        vortex = step(1.0 - uVortexShare, s.z);
        // Spawn: anywhere on the dunes ahead, or a ring/vents around the pillar foot.
        vec2 spread = uBoxCentre + (r - 0.5) * uBoxSize;
        float ang = r.x * 6.2832;
        vec2 ring = uPillar.xz + vec2(cos(ang), sin(ang)) * (20.0 + r.y * r.y * 60.0);
        vec3 p;
        p.xz = mix(spread, ring, atPillar);
        float rise = uRise * mix(0.6, 1.4, s.w) * mix(1.0, 2.0, atPillar);
        p.y = duneY(p.xz) + 0.4 + a * life * rise;
        // Curl-noise wander sampled along the ember's own path: neighbours swirl together.
        float sc = 0.035;
        vec2 cx = curl2(vec2(p.x, p.y - t * 1.2) * sc);
        vec2 cz = curl2(vec2(p.z + 41.0, p.y - t * 1.2) * sc);
        float w = uWander * smoothstep(0.0, 0.35, a);
        p.x += w * cx.x;
        p.z += w * cz.x;
        p.y += w * 0.3 * (cx.y + cz.y);
        // Steady drift downwind, growing with height.
        p.xz += uWindDir * a * life * 0.9;
        if (uDesign > 3.5) {
          // Gust: the wind the ember has lived through, ~16 m/s at the peak.
          p.xz += uWindDir * 16.0 * (gustInt(t) - gustInt(t - a * life));
        }
        if (vortex > 0.5) {
          // Drawn up a tightening helix into the sky circle's centre.
          float h = a;
          float rad = mix(70.0, 4.0, pow(h, 0.7)) * mix(0.7, 1.2, s.w);
          float an = s.w * 6.2832 + h * 9.0 + t * 0.25;
          vec3 v = vec3(uCircle.x + cos(an) * rad, mix(uPillar.y + 2.0, uCircle.y, h), uCircle.z + sin(an) * rad);
          p = mix(p, v, smoothstep(0.0, 0.25, a));
        }
        return p;
      }

      vec3 emberColor(float heat) {
        vec3 cold = vec3(0.16, 0.012, 0.018);          // dark red, nearly gone
        vec3 warm = srgb(vec3(0.984, 0.431, 0.090));   // #fb6e17
        vec3 hot  = srgb(vec3(0.996, 0.941, 0.475));   // #fef079
        vec3 c = mix(cold, warm, smoothstep(0.0, 0.55, heat));
        c = mix(c, hot, smoothstep(0.72, 1.0, heat));
        return c * (0.5 + 3.4 * heat * heat);          // HDR: only hot embers bloom
      }

      void main() {
        vUv = position.xy;
        float t = uTime;
        float life = uLife * mix(0.6, 1.4, aSeed.w);
        float phase = t / life + aSeed.w * 7.13;
        float age = fract(phase);
        float cyc = floor(phase);
        float vortex;
        vec3 p = emberPos(aSeed, age, life, cyc, t, vortex);

        // Heat: cools over life; flickers at ~6-15 Hz.
        float heat = pow(1.0 - age, uCool) * mix(0.7, 1.0, hash12(aSeed.zw * 31.0));
        float flicker = 0.55 + 0.45 * vnoise(vec2(t * mix(6.0, 15.0, aSeed.y), aSeed.w * 50.0));
        vec3 col = emberColor(heat) * flicker;
        if (vortex > 0.5) col = mix(col, srgb(vec3(0.62, 0.05, 0.08)) * 2.6, smoothstep(0.2, 0.9, age));
        float fade = smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.8, 1.0, age));

        vec4 vp = viewMatrix * vec4(p, 1.0);
        vec4 cN = projectionMatrix * vp;
        float depth = max(-vp.z, 0.05);
        fade *= smoothstep(1.0, 3.0, depth);           // near fade (no pop at the lens)
        vec3 fc;
        float fogF = hellFogAmount(p, vec2(0.0), fc);
        col *= (1.0 - fogF);                           // additive: fog only dims

        float focal = projectionMatrix[1][1] * uViewport.y * 0.5;
        // Capped: a near ember never becomes a giant quad (that is the bokeh's job).
        float rPx = clamp(uSize * mix(0.5, 1.6, aSeed.x) * (0.6 + 0.4 * heat) * focal / depth, 1.1, 7.0 * uViewport.y / 720.0);

        float streak = uDesign > 0.5 && uDesign < 1.5 ? 1.0 : 0.0;
        if (uDesign > 3.5) streak = smoothstep(0.15, 0.6, gustEnv(t));
        vStreak = streak;
        vShape = uDesign > 1.5 && uDesign < 2.5 ? 1.0 : 0.0;

        if (streak > 0.01) {
          // Build the quad between where the ember is and where it was a moment ago.
          float trail = uTrail * mix(1.0, 2.5, uDesign > 3.5 ? 1.0 : 0.0);
          float vx;
          vec3 pW = emberPos(aSeed, max(age - trail, 0.0), life, cyc, t - trail * life, vx);
          vec4 cW = projectionMatrix * viewMatrix * vec4(pW, 1.0);
          vec2 sN = cN.xy / cN.w * uViewport * 0.5;
          vec2 sW = cW.xy / max(cW.w, 0.05) * uViewport * 0.5;
          vec2 dir = (sN - sW) * streak;
          float len = max(length(dir), rPx * 2.0);
          vec2 ax = length(dir) > 1e-3 ? dir / length(dir) : vec2(0.0, 1.0);
          vec2 side = vec2(-ax.y, ax.x);
          float width = max(rPx * 0.9, 1.0);
          vec2 offPx = ax * (position.x * 0.5 - 0.5) * len + side * position.y * width;
          cN.xy += offPx / (uViewport * 0.5) * cN.w;
          // A longer streak spreads the same light: dimmer, but never below 35 %.
          fade *= max(clamp(rPx * 2.5 / len, 0.0, 1.0), 0.35);
          if (length(sN - sW) > uViewport.x * 0.4) fade = 0.0;   // hide wrap jumps
        } else {
          float k = vShape > 0.5 ? 3.5 : 1.0;                    // stars need room for their rays
          cN.xy += position.xy * rPx * k / (uViewport * 0.5) * cN.w;
        }
        vColor = col * fade;
        if (fade < 0.002) cN = vec4(2.0, 2.0, 2.0, 1.0);
        gl_Position = cN;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vShape;
      varying float vStreak;
      void main() {
        float a;
        if (vStreak > 0.01) {
          // Across: gaussian; along: head (x=1) brightest, tail tapers.
          float across = exp(-vUv.y * vUv.y * 4.0);
          float along = pow(clamp(vUv.x * 0.5 + 0.5, 0.0, 1.0), 1.5);
          float headDot = exp(-dot(vUv - vec2(0.8, 0.0), vUv - vec2(0.8, 0.0)) * 8.0);
          a = across * mix(1.0, along, vStreak) + headDot * 0.5 * (1.0 - vStreak * 0.3);
          a = mix(1.0 - smoothstep(0.0, 1.0, length(vUv)), a, vStreak);
        } else if (vShape > 0.5) {
          // Four-point star: two crossed exponential rays + a tiny core.
          vec2 q = abs(vUv) * 3.5;
          float rays = exp(-q.x * 9.0) * exp(-q.y * 1.4) + exp(-q.y * 9.0) * exp(-q.x * 1.4);
          float core = exp(-dot(q, q) * 6.0);
          a = rays * 0.9 + core;
        } else {
          float d = length(vUv);
          a = pow(max(1.0 - d, 0.0), 2.0);
        }
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColor * a, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'embers';
  mesh.frustumCulled = false;
  mesh.renderOrder = 40;
  trackViewport(mesh, viewport);
  return {
    mesh,
    uniforms: uniforms as unknown as Record<string, { value: unknown }>,
    max,
    setCount: (n) => {
      geo.instanceCount = Math.min(n, max);
    },
  };
}

// ── A2 · ash ────────────────────────────────────────────────────────────

export const ASH_DESIGNS = {
  flakes: 0, // dark grey-red flakes tumbling down
  cinders: 1, // "hell snow": flakes that burn away from a glowing edge
} as const;

export type Ash = Embers;

export function createAsh(env: EnvUniforms, fog: FogUniforms, max = 3500): Ash {
  const geo = seededQuads(max, 2002);
  const viewport = new THREE.Vector2(1280, 720);
  const uniforms = {
    ...env,
    ...fog,
    uViewport: { value: viewport },
    uDesign: { value: 0 },
    uBoxCentre: { value: new THREE.Vector2(-30, -60) },
    uBoxSize: { value: new THREE.Vector2(260, 260) },
    uLife: { value: 40 }, // s to fall the column
    uDrop: { value: 45 }, // m: height of the column
    uOmega: { value: 1.6 }, // rad/s tumble
    uSlip: { value: 1.4 }, // m/s side slip
    uSize: { value: 0.16 }, // m
    uAshDark: { value: new THREE.Color('#1c1214') },
    uAshLit: { value: new THREE.Color('#5a3a3a') },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      ${DUNE_GLSL}
      ${CURL_GLSL}
      ${FOG_GLSL}
      uniform vec2 uBoxCentre;
      uniform vec2 uBoxSize;
      uniform float uLife;
      uniform float uDrop;
      uniform float uOmega;
      uniform float uSlip;
      uniform float uSize;
      uniform vec3 uAshDark;
      uniform vec3 uAshLit;
      attribute vec4 aSeed;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vAge;
      varying float vSeed;

      // Rodrigues' rotation of v about unit axis k by angle a.
      vec3 rotAxis(vec3 v, vec3 k, float a) {
        float c = cos(a), s = sin(a);
        return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
      }

      void main() {
        vUv = position.xy;
        vSeed = aSeed.w;
        float t = uTime;
        float life = uLife * mix(0.7, 1.3, aSeed.w);
        float phase = t / life + aSeed.w * 5.3;
        float age = fract(phase);
        vAge = age;
        vec2 r = hash22(aSeed.xy * 57.3 + floor(phase) * 7.7);
        vec3 p;
        p.xz = uBoxCentre + (r - 0.5) * uBoxSize;
        float ground = duneY(p.xz);
        p.y = ground + uDrop * (1.0 - age) * mix(0.4, 1.0, aSeed.z) - 0.3;

        // Tumble about a random axis; side slip coupled to the tumble angle
        // (fastest when broadside: the leaf/paper "face-edge-back" read).
        vec3 k = normalize(hash33(aSeed.xyz * 17.0) - 0.5);
        float om = uOmega * mix(0.5, 1.5, aSeed.z);
        float an = aSeed.w * 6.2832 + om * t;
        p.xz += uWindDir * (-(uSlip / om) * cos(an)) + uWindDir * age * life * 0.6;
        vec2 cx = curl2(vec2(p.x, p.y + t * 0.6) * 0.05);
        p.x += cx.x * 3.0;
        p.z += cx.y * 3.0;

        float size = uSize * mix(0.5, 1.8, aSeed.x * aSeed.x);
        vec3 local = rotAxis(vec3(position.xy * size, 0.0), k, an);
        vec3 nrm = rotAxis(vec3(0.0, 0.0, 1.0), k, an);
        vec3 wp = p + local;
        vec3 viewDir = normalize(cameraPosition - wp);

        // Lit face vs dark edge-on; faint red transmission when backlit by the sky.
        float face = abs(dot(nrm, viewDir));
        vec3 col = mix(uAshDark, uAshLit, face * face);
        col += uSunColor * 0.35 * pow(max(dot(-viewDir, uSunDir), 0.0), 4.0) * (1.0 - face);
        col += uHorizon * 0.15;
        vColor = hellFog(col, wp, vec2(0.0));
        float depth = length(cameraPosition - wp);
        vAlpha = smoothstep(0.0, 0.05, age) * smoothstep(0.0, 1.5, p.y - ground) * smoothstep(0.6, 2.0, depth);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      uniform float uDesign;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vAge;
      varying float vSeed;
      void main() {
        // A ragged polygon, not a disc.
        float r = length(vUv);
        float th = atan(vUv.y, vUv.x);
        float edge = 0.72 + 0.28 * vnoise(vec2(cos(th), sin(th)) * 2.5 + vSeed * 13.0);
        float a = 1.0 - smoothstep(edge - 0.08, edge, r);
        vec3 col = vColor;
        if (uDesign > 0.5) {
          // Burn away from the edge: pixels below the threshold are gone,
          // a thin band just above it glows ember-orange (HDR → bloom).
          float n = vnoise(vUv * 3.0 + vSeed * 40.0) * 0.6 + (1.0 - r) * 0.5;
          float th2 = vAge * 1.05;
          if (n < th2) discard;
          float band = 1.0 - smoothstep(0.0, 0.07, n - th2);
          col = mix(col, srgb(vec3(1.0, 0.45, 0.1)) * 4.0, band);
          col += srgb(vec3(0.6, 0.08, 0.04)) * 0.4 * (1.0 - smoothstep(0.0, 0.25, n - th2));
        }
        a *= vAlpha;
        if (a < 0.02) discard;
        gl_FragColor = vec4(col, a * 0.92);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'ash';
  mesh.frustumCulled = false;
  mesh.renderOrder = 35;
  trackViewport(mesh, viewport);
  return {
    mesh,
    uniforms: uniforms as unknown as Record<string, { value: unknown }>,
    max,
    setCount: (n) => {
      geo.instanceCount = Math.min(n, max);
    },
  };
}

// ── A3 · near-camera bokeh ──────────────────────────────────────────────

export const BOKEH_DESIGNS = {
  round: 0, // soft round discs with an "onion ring" rim, ember orange
  hex: 1, // hexagonal aperture with a chromatic fringe, sky red
  flecks: 2, // more, smaller, brighter out-of-focus embers rising past the lens
} as const;

export type Bokeh = { mesh: THREE.Mesh; uniforms: Record<string, { value: unknown }>; setCount(n: number): void };

export function createBokeh(env: EnvUniforms, max = 40): Bokeh {
  const geo = seededQuads(max, 3003);
  const uniforms = {
    ...env,
    uDesign: { value: 0 },
    uAspect: { value: 16 / 9 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      uniform float uDesign;
      attribute vec4 aSeed;
      varying vec2 vUv;
      varying float vA;
      varying vec3 vColor;
      void main() {
        vUv = position.xy;
        float t = uTime;
        // Laid out in VIEW space (a lens effect): 2.5-9 m in front of the eye.
        float z = mix(2.5, 9.0, aSeed.z);
        float halfH = z / projectionMatrix[1][1];
        float halfW = z / projectionMatrix[0][0];
        vec2 drift = vec2(sin(t * 0.13 + aSeed.w * 6.3), sin(t * 0.17 + aSeed.x * 4.1)) * 0.25;
        vec3 v;
        if (uDesign > 1.5) {
          // Flecks rise slowly past the lens and loop.
          float life = mix(9.0, 16.0, aSeed.w);
          float a = fract(t / life + aSeed.y);
          v = vec3((aSeed.x * 2.0 - 1.0) * halfW * 1.05, mix(-1.1, 1.1, a) * halfH, -z);
          v.x += sin(t * 0.7 + aSeed.w * 9.0) * 0.08 * z;
          vA = smoothstep(0.0, 0.15, a) * (1.0 - smoothstep(0.8, 1.0, a));
        } else {
          // Discs keep to the frame's edges (left/right thirds, low corners),
          // so they frame the pillar instead of veiling it.
          float sx = aSeed.x < 0.5 ? -1.0 : 1.0;
          float ex = mix(0.6, 1.0, fract(aSeed.x * 2.0));
          v = vec3(sx * ex * halfW, (aSeed.y * 1.7 - 0.95) * halfH, -z);
          v.xy += drift * z * 0.2;
          vA = 1.0;
        }
        // Circle of confusion: nearer = bigger and dimmer (light spread over
        // the area). Radii are a few % of the frame height, never a wash.
        float coc = uDesign > 1.5 ? mix(0.012, 0.026, aSeed.w) : mix(0.035, 0.085, aSeed.w);
        float r = coc * z * mix(0.7, 1.0, 1.0 - aSeed.z);
        v.xy += position.xy * r;
        float pulse = 0.75 + 0.25 * sin(t * 0.6 + aSeed.w * 20.0);
        vec3 ember = srgb(vec3(0.95, 0.30, 0.07));
        vec3 red = mix(uHorizon, uSunColor, 0.35) * 1.6;
        vColor = uDesign > 0.5 && uDesign < 1.5 ? red : ember;
        vA *= pulse * (uDesign > 1.5 ? 0.45 : 0.16) * mix(1.3, 0.7, aSeed.z);
        gl_Position = projectionMatrix * vec4(v, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uDesign;
      varying vec2 vUv;
      varying float vA;
      varying vec3 vColor;
      float sdHexagon(vec2 p, float r) {   // iq, exact
        const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
        p = abs(p);
        p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
        p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
        return length(p) * sign(p.y);
      }
      float disc(vec2 p, float r, float hex, float soft, float rim) {
        float d = mix(length(p) - r, sdHexagon(p, r * 0.92), hex);
        float body = 1.0 - smoothstep(-soft, soft, d);
        float ring = exp(-abs(d) * 30.0 / r) * rim;
        return body * mix(0.55, 1.0, smoothstep(-r, 0.0, d)) + ring * body + ring * 0.3;
      }
      void main() {
        vec3 c;
        if (uDesign > 1.5) {
          float d = length(vUv);
          c = vec3(pow(max(1.0 - d, 0.0), 1.5)) * 1.3;
        } else if (uDesign > 0.5) {
          // Chromatic: each channel's aperture a hair bigger or smaller.
          float s = 0.03, rim = 0.5;
          c = vec3(disc(vUv, 0.9 * 1.03, 1.0, s, rim), disc(vUv, 0.9, 1.0, s, rim), disc(vUv, 0.9 * 0.97, 1.0, s, rim));
        } else {
          c = vec3(disc(vUv, 0.9, 0.0, 0.05, 0.35));
        }
        c *= vColor * vA;
        if (max(c.r, max(c.g, c.b)) < 0.003) discard;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'bokeh';
  mesh.frustumCulled = false;
  mesh.renderOrder = 90;
  return {
    mesh,
    uniforms: uniforms as unknown as Record<string, { value: unknown }>,
    setCount: (n) => {
      geo.instanceCount = Math.min(n, max);
    },
  };
}

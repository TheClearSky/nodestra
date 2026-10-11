// COPIED from .claude/pages/ad/experiments/hell-src/hell-10-particles-and-mist-air.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-10 air: dust sheets (A4), sand devils (A5), the ground mist pool (A7),
 * the fog wall that makes height fog read against the sky (A8), a stand-in
 * magic circle (for X3/X4) and the screen-space heat haze pass (A6).
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { ENV_GLSL, seededRandom, type EnvUniforms } from '../env-src/lab';
import { CIRCLE, DUNE_GLSL, FOG_GLSL, PILLAR, type FogUniforms } from './hell-10-particles-and-mist-glsl';

type U = Record<string, { value: unknown }>;

/** Dust colour from the grade: lighter than the sand, tinted by the sky. */
const DUST_GLSL = /* glsl */ `
vec3 dustColor(vec3 wp, float density) {
  // Dust is pale air, a little lighter and less saturated than the sand.
  vec3 lift = vec3(0.07, 0.03, 0.03);
  vec3 shade = mix(uHaze, uAmbient, 0.35) * 0.9 + lift * 0.5;
  vec3 lit = mix(uHorizon, uSunColor, 0.25) * 1.3 + lift;
  vec3 col = mix(shade, lit, density);
  vec3 vd = normalize(wp - cameraPosition);
  col += uSunColor * pow(max(dot(vd, normalize(uSunDir)), 0.0), 6.0) * 0.6;   // backlit glow
  return col;
}
`;

// ── A4 · dust sheets ────────────────────────────────────────────────────

export type Dust = { curtains: THREE.Mesh; sheets: THREE.Mesh; uniforms: U };

export function createDust(env: EnvUniforms, fog: FogUniforms): Dust {
  const uniforms = {
    ...env,
    ...fog,
    uSpeed: { value: 2.2 }, // m/s downwind
    uWarp: { value: 1.4 }, // domain-warp strength (0 = straight streaks)
    uCover: { value: 0.42 },
    uCrest: { value: 0 }, // 1 = only spill off the dune crests
  };

  // Curtains: tall-ish vertical cards across the view at several depths.
  const rand = seededRandom(404);
  const cards: THREE.BufferGeometry[] = [];
  const cardZ = [-20, -90, -190]; // three depths: near, mid, far (each full-width card is overdraw)
  cardZ.forEach((z, i) => {
    const width = 420 + rand() * 200;
    const g = new THREE.PlaneGeometry(width, 1, 60, 6);
    g.translate(-40 + (rand() - 0.5) * 80, 0.5, z);
    const n = g.attributes.position.count;
    const card = new Float32Array(n * 4);
    // aCard = (height, index, seed, width), the same for every vertex of the card.
    const h = 10 + i * 6 + rand() * 6;
    const seed = rand();
    for (let v = 0; v < n; v++) card.set([h, i, seed, width], v * 4);
    g.setAttribute('aCard', new THREE.Float32BufferAttribute(card, 4));
    cards.push(g);
  });
  const curtainGeo = mergeGeometries(cards)!;
  const curtainMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      ${DUNE_GLSL}
      attribute vec4 aCard;
      varying vec3 vWorld;
      varying vec2 vUv;
      varying vec4 vCard;
      void main() {
        vUv = uv;
        vCard = aCard;
        vec3 p = position;
        // Bottom buried 1.5 m into the local dune, top 'height' above it.
        p.y = duneY(p.xz) - 1.5 + uv.y * aCard.x;
        vWorld = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${DUNE_GLSL}
      ${FOG_GLSL}
      ${DUST_GLSL}
      uniform float uSpeed;
      uniform float uWarp;
      uniform float uCover;
      varying vec3 vWorld;
      varying vec2 vUv;
      varying vec4 vCard;
      void main() {
        float t = uTime;
        // Long along the wind (x), short vertically; two speeds against repetition.
        vec2 q = vec2(vWorld.x * 0.02 - t * uSpeed * 0.02, vWorld.y * 0.13 + vCard.z * 17.0);
        // Cheap masks first: most of a card's area is faded out before any noise.
        float mask = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.3)  /* clamp: pow(<0) is NaN on D3D */ * smoothstep(0.0, 0.25, vUv.y + 0.1);   // thin, soft top
        mask *= smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);       // soft card ends
        mask *= smoothstep(0.0, 2.5, vWorld.y - duneY(vWorld.xz));                // analytic soft particle
        if (mask < 0.01) discard;
        // Domain warp from two plain value noises (cheaper than two fbm).
        vec2 w = vec2(vnoise(q * 1.7 + vec2(t * 0.05, 0.0)), vnoise(q * 1.7 + vec2(5.2, 1.3) - t * 0.035));
        float n = fbm3(q + uWarp * (w - 0.5));
        float a = smoothstep(uCover, uCover + 0.32, n) * mask * 0.55;
        if (a < 0.004) discard;
        vec3 col = hellFog(dustColor(vWorld, n), vWorld, gl_FragCoord.xy);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const curtains = new THREE.Mesh(curtainGeo, curtainMat);
  curtains.name = 'dust-curtains';
  curtains.frustumCulled = false;
  curtains.renderOrder = 20;

  // Ground sheets: three dune-hugging layers you look across at a grazing angle.
  const layers: THREE.BufferGeometry[] = [];
  [0.5, 1.6, 3.2].forEach((offset, i) => {
    const g = new THREE.PlaneGeometry(760, 520, 120, 90);
    g.rotateX(-Math.PI / 2);
    g.translate(-20, 0, -150);
    const n = g.attributes.position.count;
    g.setAttribute('aLayer', new THREE.Float32BufferAttribute(new Float32Array(n * 2).map((_, k) => (k % 2 ? i : offset)), 2));
    layers.push(g);
  });
  const sheetGeo = mergeGeometries(layers)!;
  const sheetMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      ${DUNE_GLSL}
      uniform float uCrest;
      attribute vec2 aLayer;
      varying vec3 vWorld;
      varying vec2 vLayer;
      varying float vCrest;
      void main() {
        vLayer = aLayer;
        vec3 p = position;
        float g = duneY(p.xz);
        // Crest-ness: high ground on the lee (downwind) side of a ridge.
        float e = 3.0;
        vec2 grad = vec2(duneY(p.xz + vec2(e, 0.0)) - duneY(p.xz - vec2(e, 0.0)),
                         duneY(p.xz + vec2(0.0, e)) - duneY(p.xz - vec2(0.0, e))) / (2.0 * e);
        float crest = smoothstep(3.0, 8.0, g) * smoothstep(0.02, -0.15, dot(grad, uWindDir));
        vCrest = crest;
        // Spilled dust lifts off the crest and hangs downwind.
        p.y = g + aLayer.x + uCrest * crest * (2.0 + aLayer.y * 2.5);
        vWorld = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${FOG_GLSL}
      ${DUST_GLSL}
      uniform float uSpeed;
      uniform float uWarp;
      uniform float uCover;
      uniform float uCrest;
      varying vec3 vWorld;
      varying vec2 vLayer;
      varying float vCrest;
      void main() {
        float t = uTime;
        vec2 across = vec2(-uWindDir.y, uWindDir.x);
        float speed = uSpeed * (1.0 + vLayer.y * 0.35) * (1.0 + uCrest * 1.5);
        vec2 q = vec2(dot(vWorld.xz, uWindDir) * 0.018 - t * speed * 0.018, dot(vWorld.xz, across) * 0.075 + vLayer.y * 3.1);
        // Cheap masks first: the sheet's own edges, the near fade, the crest mask.
        vec2 c = abs(vWorld.xz - vec2(-20.0, -150.0)) / vec2(380.0, 260.0);
        // Fade out near the eye: a sheet seen from above at 10 m is a wash, not dust.
        float mask = (1.0 - smoothstep(0.7, 1.0, max(c.x, c.y))) * smoothstep(25.0, 90.0, length(vWorld - cameraPosition));
        mask *= mix(1.0, vCrest * 1.8, uCrest);
        if (mask < 0.01) discard;
        // Domain warp from two plain value noises (cheaper than two fbm).
        vec2 w = vec2(vnoise(q * 1.6 + vec2(t * 0.04, 0.0)), vnoise(q * 1.6 + vec2(5.2, 1.3) - t * 0.03));
        float n = fbm3(q + uWarp * (w - 0.5));
        float a = smoothstep(uCover, uCover + 0.3, n) * mix(0.3, 0.16, vLayer.y / 2.0) * mask;
        if (a < 0.004) discard;
        vec3 col = hellFog(dustColor(vWorld, n), vWorld, gl_FragCoord.xy);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const sheets = new THREE.Mesh(sheetGeo, sheetMat);
  sheets.name = 'dust-sheets';
  sheets.frustumCulled = false;
  sheets.renderOrder = 19;
  return { curtains, sheets, uniforms: uniforms as unknown as U };
}

// ── A5 · sand devils ────────────────────────────────────────────────────

export type Devil = {
  group: THREE.Group;
  outer: THREE.Mesh;
  inner: THREE.Mesh;
  grains: THREE.Mesh;
  skirt: THREE.Mesh;
  u: { uBase: { value: THREE.Vector3 }; uAlpha: { value: number }; uHeight: { value: number }; uSeed: { value: number } };
};

export function createDevil(env: EnvUniforms, fog: FogUniforms, seed: number): Devil {
  const u = {
    uBase: { value: new THREE.Vector3() },
    uAlpha: { value: 1 },
    uHeight: { value: 70 },
    uSeed: { value: seed },
  };
  const common = {
    ...env,
    ...fog,
    ...u,
    uR0: { value: 1.6 }, // foot radius
    uR1: { value: 13 }, // top radius
    uFlare: { value: 2.2 }, // 1 cone … 3 trumpet
    uTwist: { value: 5.0 }, // rad over the height
    uSway: { value: 9.0 }, // how much the column snakes
  };
  // The column: shared vertex shaping (funnel + twist + snaking axis).
  const SHAPE = /* glsl */ `
    uniform vec3 uBase;
    uniform float uHeight;
    uniform float uSeed;
    uniform float uR0;
    uniform float uR1;
    uniform float uFlare;
    uniform float uTwist;
    uniform float uSway;
    float devilRadius(float h) { return mix(uR0, uR1, pow(h, uFlare)); }
    vec2 devilLean(float h) {
      float t = uTime * 0.3 + uSeed * 10.0;
      return (vec2(vnoise(vec2(h * 2.0 - t, 1.0 + uSeed)), vnoise(vec2(h * 2.0 - t, 7.0 + uSeed))) - 0.5) * uSway * h * 2.0;
    }
  `;
  const tube = (spin: number, radiusScale: number, opacity: number, light: number) => {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 28, 40, true);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...common, uSpin: { value: spin }, uRS: { value: radiusScale }, uOpacity: { value: opacity }, uLight: { value: light } },
      vertexShader: /* glsl */ `
        ${ENV_GLSL}
        ${SHAPE}
        uniform float uSpin;
        uniform float uRS;
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          float h = position.y;
          float r = devilRadius(h) * uRS;
          float an = atan(position.z, position.x) + h * uTwist + uTime * uSpin;
          vec2 lean = devilLean(h);
          vec3 p = uBase + vec3(cos(an) * r + lean.x, h * uHeight, sin(an) * r + lean.y);
          vNormal = vec3(cos(an), 0.0, sin(an));
          vWorld = p;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${ENV_GLSL}
        ${FOG_GLSL}
        ${DUST_GLSL}
        uniform float uSpin;
        uniform float uOpacity;
        uniform float uLight;
        uniform float uAlpha;
        uniform float uSeed;
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec2 vUv;
        void main() {
          float t = uTime;
          // Streaks scroll diagonally; the twisted mesh carries them round the funnel.
          vec2 q = vec2(vUv.x * 7.0 + vUv.y * 2.0 - t * uSpin * 0.35, vUv.y * 3.0 - t * 0.6 + uSeed * 5.0);
          float n = fbm3(q) * 0.65 + fbm3(q * 2.3 + vec2(t * 0.4, 3.0)) * 0.35;
          float ends = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
          vec3 vd = normalize(cameraPosition - vWorld);
          float rim = 1.0 - abs(dot(normalize(vNormal), vd));   // thicker where you look through more dust
          float a = smoothstep(0.32, 0.78, n) * ends * mix(0.25, 1.0, rim) * uOpacity * uAlpha;
          if (a < 0.004) discard;
          vec3 col = dustColor(vWorld, n) * uLight;
          gl_FragColor = vec4(hellFog(col, vWorld, gl_FragCoord.xy), a);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 25;
    return m;
  };
  // Pale against the dark sky (the BL-H devils read white at 30-50 % alpha).
  const outer = tube(0.9, 1.0, 0.5, 1.6);
  const inner = tube(1.9, 0.55, 0.45, 2.1);

  // Grains: a helix of sand specks spiralling up the funnel and spat out at the top.
  const N = 260;
  const gGeo = new THREE.InstancedBufferGeometry();
  gGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  gGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const rand = seededRandom(5000 + seed * 100);
  const s = new Float32Array(N * 4).map(() => rand());
  gGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(s, 4));
  gGeo.instanceCount = N;
  const grainMat = new THREE.ShaderMaterial({
    uniforms: common,
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      ${SHAPE}
      ${FOG_GLSL}
      ${DUST_GLSL}
      uniform float uAlpha;
      attribute vec4 aSeed;
      varying vec2 vUv;
      varying vec4 vCol;
      void main() {
        vUv = position.xy;
        float life = mix(5.0, 9.0, aSeed.w);
        float a = fract(uTime / life + aSeed.x);
        float h = a * 1.05;
        float r = devilRadius(min(h, 1.0)) * mix(0.6, 1.3, aSeed.y) + smoothstep(0.85, 1.05, h) * 14.0 * aSeed.z;
        float an = aSeed.z * 6.2832 + a * life * mix(1.6, 3.0, aSeed.y);
        vec2 lean = devilLean(min(h, 1.0));
        vec3 p = uBase + vec3(cos(an) * r + lean.x, h * uHeight, sin(an) * r + lean.y);
        vec4 vp = viewMatrix * vec4(p, 1.0);
        vp.xy += position.xy * mix(0.06, 0.16, aSeed.w);
        float fade = smoothstep(0.0, 0.1, a) * (1.0 - smoothstep(0.85, 1.0, a)) * uAlpha;
        vCol = vec4(hellFog(dustColor(p, 0.9) * 1.4, p, vec2(0.0)), fade * 0.85);
        gl_Position = projectionMatrix * vp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec4 vCol;
      void main() {
        float a = (1.0 - smoothstep(0.3, 1.0, length(vUv))) * vCol.a;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vCol.rgb, a);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const grains = new THREE.Mesh(gGeo, grainMat);
  grains.frustumCulled = false;
  grains.renderOrder = 26;

  // Skirt: sand whirling round the foot, a flat disc of rotating noise.
  const skirtGeo = new THREE.PlaneGeometry(1, 1, 24, 24);
  skirtGeo.rotateX(-Math.PI / 2);
  const skirtMat = new THREE.ShaderMaterial({
    uniforms: common,
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      ${DUNE_GLSL}
      uniform vec3 uBase;
      uniform float uR0;
      varying vec2 vP;
      varying vec3 vWorld;
      void main() {
        vP = position.xz * 2.0;
        vec3 p = uBase + vec3(position.x, 0.0, position.z) * 34.0;
        p.y = duneY(p.xz) + 0.4 + (1.0 - length(vP)) * 2.0;
        vWorld = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${FOG_GLSL}
      ${DUST_GLSL}
      uniform float uAlpha;
      uniform float uSeed;
      varying vec2 vP;
      varying vec3 vWorld;
      void main() {
        float r = length(vP);
        float th = atan(vP.y, vP.x);
        float n = fbm3(vec2(th * 2.0 + uTime * 1.4 - r * 3.0, r * 5.0 + uSeed * 9.0));
        float a = smoothstep(0.45, 0.8, n) * (1.0 - smoothstep(0.35, 1.0, r)) * smoothstep(0.03, 0.12, r) * 0.55 * uAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(hellFog(dustColor(vWorld, n), vWorld, gl_FragCoord.xy), a);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.frustumCulled = false;
  skirt.renderOrder = 24;

  const group = new THREE.Group();
  group.name = `sand-devil-${seed}`;
  group.add(skirt, outer, inner, grains);
  return { group, outer, inner, grains, skirt, u };
}

// ── A7 · ground mist pool ───────────────────────────────────────────────

export const MIST_DESIGNS = { slices: 0, blobs: 1, march: 2, circleLit: 3 } as const;

export type Mist = { slices: THREE.Mesh; blobs: THREE.Mesh; march: THREE.Mesh; uniforms: U };

const MIST_GLSL = /* glsl */ `
uniform vec3 uPillar;
uniform float uRadius;
uniform float uCircleLit;
uniform float uCirclePulse;
// Pooled at the pillar foot, a slow two-speed creep (0.005-0.02 uv/s).
float mistDensity(vec3 p, float h) {
  vec2 q = p.xz * 0.018 + vec2(uTime * 0.012, uTime * 0.004);
  float n = fbm3(q + h * 0.6) * 0.65 + fbm3(q * 2.3 - uTime * 0.02 + 7.0) * 0.35;
  float pool = exp(-length(p.xz - uPillar.xz) / uRadius);
  return smoothstep(h * 0.7 + 0.2, h * 0.7 + 0.6, n * (0.35 + pool));
}
vec3 mistColor(vec3 p, float h) {
  float glow = exp(-max(length(p.xz - uPillar.xz) - 20.0, 0.0) / 55.0);
  // Paler than the sand and the sky behind it: soft painted air, tinted by the
  // grade (a rose-oxblood veil in the crimson night), never grey.
  vec3 lift = vec3(0.10, 0.035, 0.04);
  vec3 shade = mix(uHaze, uHorizon, 0.5) * 1.1 + lift * 0.6;
  vec3 lit = mix(uHorizon, uSunColor, 0.4) * 1.6 + lift;
  vec3 col = mix(shade, lit, smoothstep(0.0, 1.0, h) * 0.5 + glow * 0.5);
  // Lit from within: the hot pillar foot glows through the underside.
  col += srgb(vec3(1.0, 0.36, 0.1)) * pow(1.0 - h, 2.0) * glow * 0.9;
  // X4: the sky circle's red pulse lights the TOP of the mist.
  col += srgb(vec3(0.75, 0.04, 0.08)) * uCircleLit * smoothstep(0.3, 1.0, h) * (0.6 + 1.6 * uCirclePulse);
  return col;
}
`;

export function createMist(env: EnvUniforms, fog: FogUniforms): Mist {
  const uniforms = {
    ...env,
    ...fog,
    uPillar: { value: PILLAR.clone() },
    uRadius: { value: 85 },
    uCircleLit: { value: 0 },
    uCirclePulse: { value: 0 },
    uBoxMin: { value: new THREE.Vector3(PILLAR.x - 170, PILLAR.y - 0.5, PILLAR.z - 170) },
    uBoxMax: { value: new THREE.Vector3(PILLAR.x + 170, PILLAR.y + 24, PILLAR.z + 170) },
  };

  // (a) depth slices: camera-facing vertical cards stacked in depth through
  // the pool, all sampling one world-space noise field (a fake volume that
  // reads from eye level, where flat horizontal slices would be edge-on).
  const SLICES = 6;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < SLICES; i++) {
    const g = new THREE.PlaneGeometry(2, 1, 1, 1);
    g.translate(0, 0.5, 0);
    g.setAttribute('aK', new THREE.Float32BufferAttribute(new Float32Array(4).fill(i / (SLICES - 1)), 1));
    parts.push(g);
  }
  const sliceMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      ${DUNE_GLSL}
      uniform vec3 uPillar;
      attribute float aK;
      varying vec3 vWorld;
      varying float vK;
      void main() {
        vK = aK;
        // Card centres march from in front of the pillar (toward the eye) to behind it.
        vec2 toCam = normalize(cameraPosition.xz - uPillar.xz);
        vec2 side = vec2(-toCam.y, toCam.x);
        vec2 c = uPillar.xz + toCam * mix(95.0, -80.0, aK);
        vec3 p;
        p.xz = c + side * position.x * 200.0;
        p.y = uPillar.y - 3.0 + position.y * 30.0;
        vWorld = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${DUNE_GLSL}
      ${FOG_GLSL}
      ${MIST_GLSL}
      varying vec3 vWorld;
      varying float vK;
      void main() {
        float ground = duneY(vWorld.xz);
        float y = vWorld.y - uPillar.y;
        float pool = exp(-length(vWorld.xz - uPillar.xz) / uRadius);
        // Cheap masks first: the soft sand contact and the pool's reach.
        float a = smoothstep(0.0, 3.0, vWorld.y - ground) * smoothstep(0.03, 0.2, pool);
        if (a < 0.01) discard;
        // A lobed, airbrushed top: taller near the pillar, creeping slowly sideways.
        vec2 toCam = normalize(cameraPosition.xz - uPillar.xz);
        float u = dot(vWorld.xz, vec2(-toCam.y, toCam.x));
        float lobes = fbm3(vec2(u * 0.025 + uTime * 0.01, vK * 3.7));
        float top = (6.0 + 20.0 * pool) * (0.55 + 0.75 * lobes);
        float h = clamp(y / max(top, 1.0), 0.0, 1.2);
        float body = 1.0 - smoothstep(0.45, 1.0, h);
        // Inner texture: slow two-speed creep (0.005-0.02 uv/s).
        vec2 q = vec2(u * 0.03, y * 0.09) + vec2(uTime * 0.014, -uTime * 0.006) + vK * 5.3;
        float n = fbm3(q) * 0.7 + 0.3;
        a *= body * n * (0.15 + 0.25 * pool);
        a += (hfIgn(gl_FragCoord.xy) - 0.5) / 255.0;
        if (a < 0.004) discard;
        gl_FragColor = vec4(hellFog(mistColor(vWorld, clamp(h, 0.0, 1.0)), vWorld, gl_FragCoord.xy), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const slices = new THREE.Mesh(mergeGeometries(parts)!, sliceMat);
  slices.name = 'mist-slices';
  slices.frustumCulled = false;
  slices.renderOrder = 15;

  // (b) airbrushed blobs: big soft camera-facing sprites in a ring at the foot.
  const B = 56;
  const bGeo = new THREE.InstancedBufferGeometry();
  bGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  bGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const rand = seededRandom(707);
  bGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(B * 4).map(() => rand()), 4));
  bGeo.instanceCount = B;
  const blobMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      ${DUNE_GLSL}
      uniform vec3 uPillar;
      attribute vec4 aSeed;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec4 vS;
      void main() {
        vUv = position.xy;
        vS = aSeed;
        float an = aSeed.x * 6.2832 + uTime * 0.004 * (aSeed.y - 0.5);
        float r = 14.0 + aSeed.y * aSeed.y * 110.0;
        vec3 c = vec3(uPillar.x + cos(an) * r, 0.0, uPillar.z + sin(an) * r);
        float size = mix(16.0, 38.0, aSeed.z) * mix(1.0, 0.7, aSeed.y);
        c.y = duneY(c.xz) + size * 0.25 + aSeed.w * 4.0;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 p = c + right * position.x * size * 1.4 + vec3(0.0, 1.0, 0.0) * position.y * size * 0.55;
        vWorld = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${DUNE_GLSL}
      ${FOG_GLSL}
      ${MIST_GLSL}
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec4 vS;
      void main() {
        // Gaussian body, noisy airbrushed edge over the outer ~20 %, lobed top.
        float r = length(vUv);
        float n = fbm3(vUv * 2.2 + vS.xy * 30.0 + vec2(uTime * 0.015, 0.0));
        float edge = 1.0 - smoothstep(0.55 + n * 0.3, 1.0, r);
        float a = edge * exp(-r * r * 1.6) * 0.5;
        a *= smoothstep(0.0, 3.0, vWorld.y - duneY(vWorld.xz));
        a += (hfIgn(gl_FragCoord.xy) - 0.5) / 255.0;
        if (a < 0.004) discard;
        float h = clamp(vUv.y * 0.5 + 0.5, 0.0, 1.0);
        gl_FragColor = vec4(hellFog(mistColor(vWorld, h), vWorld, gl_FragCoord.xy), a);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const blobs = new THREE.Mesh(bGeo, blobMat);
  blobs.name = 'mist-blobs';
  blobs.frustumCulled = false;
  blobs.renderOrder = 15;

  // (c) a short raymarch through a box: real parallax, analytic density.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const marchMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform vec3 uBoxMin;
      uniform vec3 uBoxMax;
      varying vec3 vWorld;
      void main() {
        vec3 p = mix(uBoxMin, uBoxMax, position + 0.5);
        vWorld = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${DUNE_GLSL}
      ${FOG_GLSL}
      ${MIST_GLSL}
      uniform vec3 uBoxMin;
      uniform vec3 uBoxMax;
      varying vec3 vWorld;
      void main() {
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vWorld - ro);
        vec3 inv = 1.0 / rd;
        vec3 t0 = (uBoxMin - ro) * inv;
        vec3 t1 = (uBoxMax - ro) * inv;
        vec3 tmx = max(t0, t1);
        float tEnter = length(vWorld - ro);
        float tExit = min(min(tmx.x, tmx.y), tmx.z);
        // Stop at the pillar (a vertical cylinder of radius ~20 at the foot).
        vec2 oc = ro.xz - uPillar.xz;
        float a2 = dot(rd.xz, rd.xz);
        float b2 = dot(oc, rd.xz);
        float c2 = dot(oc, oc) - 20.0 * 20.0;
        float disc = b2 * b2 - a2 * c2;
        if (disc > 0.0) {
          float tc = (-b2 - sqrt(disc)) / a2;
          if (tc > tEnter) tExit = min(tExit, tc);
        }
        const int STEPS = 14;
        float span = max(tExit - tEnter, 0.0);
        float dt = span / float(STEPS);
        float T = 1.0;
        vec3 acc = vec3(0.0);
        float j = hfIgn(gl_FragCoord.xy);
        for (int i = 0; i < STEPS; i++) {
          vec3 p = ro + rd * (tEnter + (float(i) + j) * dt);
          float g = duneY(p.xz);
          float h = clamp((p.y - g) / 14.0, 0.0, 1.0);
          if (p.y < g) continue;                      // never under the sand
          float d = mistDensity(p, h) * exp(-h * 2.0) * 0.07;
          float s = exp(-d * dt);
          acc += T * (1.0 - s) * mistColor(p, h);
          T *= s;
          if (T < 0.03) break;
        }
        float a = 1.0 - T;
        if (a < 0.004) discard;
        vec3 col = acc / a;
        gl_FragColor = vec4(hellFog(col, ro + rd * (tEnter + span * 0.5), gl_FragCoord.xy), a);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const march = new THREE.Mesh(boxGeo, marchMat);
  march.name = 'mist-march';
  march.frustumCulled = false;
  march.renderOrder = 15;
  return { slices, blobs, march, uniforms: uniforms as unknown as U };
}

// ── A8 · fog wall: the height fog seen against the sky ──────────────────

/** A far cylinder painted with the fog the camera sees toward the horizon,
 *  so height fog / strata read against the sky dome too (no dome edits). */
export function createFogWall(env: EnvUniforms, fog: FogUniforms): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(2300, 2300, 1400, 64, 1, true);
  geo.translate(0, 690, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...env, ...fog },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${FOG_GLSL}
      varying vec3 vWorld;
      void main() {
        vec3 fc;
        float f = hellFogAmount(vWorld, gl_FragCoord.xy, fc);
        if (f < 0.003) discard;
        gl_FragColor = vec4(fc, clamp(f, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const wall = new THREE.Mesh(geo, mat);
  wall.name = 'fog-wall';
  wall.frustumCulled = false;
  wall.renderOrder = 1;
  return wall;
}

// ── stand-in magic circle (the owner's centrepiece; a proxy only) ───────

export function createCircleProxy(env: EnvUniforms, fog: FogUniforms): { mesh: THREE.Mesh; uPulse: { value: number } } {
  const uPulse = { value: 0 };
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...env, ...fog, uPulse },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      varying vec3 vWorld;
      void main() {
        vP = position.xz * 2.0;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${FOG_GLSL}
      uniform float uPulse;
      varying vec2 vP;
      varying vec3 vWorld;
      float line(float x, float c, float w) { return 1.0 - smoothstep(0.0, w, abs(x - c)); }
      vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c) * p; }
      // Equilateral triangle outline of circumradius R (edges at R/2 from the centre).
      float tri(vec2 p, float R, float w) {
        float m = 0.0;
        for (int k = 0; k < 3; k++) {
          float a = float(k) * 2.0944;
          vec2 n = vec2(cos(a), sin(a));
          float along = dot(p, vec2(-n.y, n.x));
          m = max(m, line(dot(p, n), -R * 0.5, w) * step(abs(along), R * 0.866));
        }
        return m;
      }
      void main() {
        float t = uTime;
        float r = length(vP);
        if (r > 1.0) discard;
        float w = 0.006;
        vec2 po = rot(vP, t * 0.05);
        vec2 pi = rot(vP, -t * 0.09);
        float m = line(r, 0.97, w) + line(r, 0.925, w) + line(r, 0.62, w) + line(r, 0.585, w) + line(r, 0.3, w * 1.5);
        // Rune band: little glyph bars in 72 cells, rotating with the outer ring.
        float tho = atan(po.y, po.x) / 6.2832 + 0.5;
        float cell = floor(tho * 72.0);
        float fx = fract(tho * 72.0);
        float glyph = step(0.35, hash12(vec2(cell, 3.0))) * step(0.2, fx) * step(fx, 0.8);
        float gy = (r - 0.93) / 0.04;
        glyph *= step(0.05, gy) * step(gy, 0.95) * (step(fract(gy * 3.0 + hash12(vec2(cell, 9.0))), 0.45) + step(abs(fx - 0.5), 0.08));
        m += glyph * 0.8;
        // Hexagram counter-rotating inside.
        m += tri(pi, 0.585, w) + tri(rot(pi, 3.1416), 0.585, w);
        // Inner rune ring.
        float thi = atan(pi.y, pi.x) / 6.2832 + 0.5;
        float c2 = floor(thi * 24.0);
        m += step(0.5, hash12(vec2(c2, 1.0))) * line(r, 0.45, 0.02) * step(abs(fract(thi * 24.0) - 0.5), 0.3);
        float glow = exp(-abs(r - 0.6) * 6.0) * 0.08 + exp(-r * 6.0) * 0.25;
        vec3 red = srgb(vec3(0.62, 0.04, 0.07));
        vec3 col = red * (clamp(m, 0.0, 1.0) * (2.2 + 1.6 * uPulse) + glow);
        if (col.r < 0.004) discard;   // additive: skip writing empty pixels
        vec3 fc;
        float f = hellFogAmount(vWorld, vec2(0.0), fc);
        gl_FragColor = vec4(col * (1.0 - f * 0.8), 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'circle-proxy';
  mesh.position.copy(CIRCLE);
  mesh.scale.setScalar(240);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  return { mesh, uPulse };
}

// ── A6 · heat haze (screen-space refraction pass) ───────────────────────

export const HAZE_MODES = { smooth: 1, stepped: 2, chroma: 3, mirage: 4 } as const;

export function createHazePass(): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uMode: { value: 1 },
      uFoot: { value: new THREE.Vector2(0.5, 0.4) },
      uHorizonY: { value: 0.45 },
      uAspect: { value: 16 / 9 },
      uWidth: { value: 0.06 },
      uTall: { value: 0.32 },
      uStrength: { value: 0.0045 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform float uMode;
      uniform vec2 uFoot;
      uniform float uHorizonY;
      uniform float uAspect;
      uniform float uWidth;
      uniform float uTall;
      uniform float uStrength;
      varying vec2 vUv;
      float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float vn(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y);
      }
      void main() {
        float t = uTime;
        vec2 d = vec2((vUv.x - uFoot.x) * uAspect, vUv.y - uFoot.y);
        // Column of rising hot air above the pillar foot + a wide low skirt over the hot sand.
        float m = exp(-d.x * d.x / (uWidth * uWidth)) * smoothstep(-0.04, 0.02, d.y) * (1.0 - smoothstep(0.0, uTall, d.y));
        m += 0.6 * exp(-d.x * d.x / (uWidth * uWidth * 16.0)) * exp(-d.y * d.y / 0.0016);
        vec2 off;
        if (uMode > 3.5) {
          // Ground mirage: a thin band just above the far dune line, shimmering sideways.
          m = exp(-pow((vUv.y - uHorizonY - 0.012) / 0.022, 2.0));
          float row = floor(vUv.y * 360.0);
          off = vec2(sin(row * 1.7 + t * 9.0) * 0.6 + (vn(vec2(row * 0.3, t * 3.0)) - 0.5), (vn(vec2(vUv.x * uAspect * 80.0, t * 2.5)) - 0.5) * 1.5) * uStrength * m;
        } else if (uMode > 1.5 && uMode < 2.5) {
          // Anime "stepped" shimmer: horizontal bands sliding sideways (the Yoshi look).
          float band = floor(vUv.y * 240.0) / 240.0;
          off = vec2(sin(band * 140.0 + t * 7.0) * uStrength * m * 1.1, 0.0);
        } else {
          vec2 q = vec2(vUv.x * uAspect * 38.0, vUv.y * 22.0 - t * 1.6);
          off = (vec2(vn(q), vn(q + 17.3)) - 0.5) * uStrength * 2.0 * m;
        }
        vec4 c;
        if (uMode > 2.5 && uMode < 3.5) {
          // Chromatic: each channel refracts a little differently.
          c = vec4(texture2D(tDiffuse, vUv + off * 0.75).r, texture2D(tDiffuse, vUv + off).g, texture2D(tDiffuse, vUv + off * 1.3).b, 1.0);
        } else {
          c = texture2D(tDiffuse, vUv + off);
        }
        gl_FragColor = c;
      }
    `,
  });
}

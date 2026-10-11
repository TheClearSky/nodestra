// COPIED from .claude/pages/ad/experiments/hell-src/scene/clouds-veils.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Clouds option "veils": thin, drifting fog that passes THROUGH the
 * landscape (2026-10-11: "clouds need to pass through the landscape like
 * fog, thin and mysterious"). The moodboard's veil band (AoT ep 87: "thin
 * veils between camera and skeleton cut its contrast"; Inuyasha's mist band
 * threading between the rocks).
 *
 * Technique: a stack of horizontal slices (a sliced volume). Each slice is a
 * huge flat disc drawing a little streaky noise; a view ray crosses more of
 * them the flatter it runs, so the veils thicken toward the horizon and pool
 * in the dune troughs, and they cut through the bones and the tower as soft
 * horizontal layers (no hard plane edges, no depth texture needed). The
 * noise is in world space and slides downwind, each layer at its own speed,
 * so wisps visibly drift across everything.
 *
 * Round 2 (owner: "mist is a bit overdone and everywhere, it should come as
 * big chunks and move across the scene … have separation from having mist
 * and not having it … turned down a lot"): the wisps now only exist inside
 * BANKS — big patches (~400–700 m) of one coarse noise shared by every
 * layer, so a bank is one body of fog from the sand up, drifting across at
 * 10 m/s with clear air between banks — and the whole is much fainter. A second, sparser band of
 * slices wraps the tower's middle, lit by its glow.
 *
 * Cost: every slice below the eye covers the whole ground, so the noise is
 * a precomputed tileable texture (three fetches per pixel, cheap fades and
 * an early discard first), not procedural fbm.
 */

import * as THREE from 'three';
import { ENV_GLSL, type EnvUniforms } from '../../env-src/lab';

export type VeilUniforms = {
  uVeilT: { value: number };
  uFogCol: { value: THREE.Color };
  uFogDen: { value: number };
  uLit: { value: THREE.Color };
  uShade: { value: THREE.Color };
  uGlow: { value: THREE.Color };
  uAccent: { value: THREE.Color };
  uPillar: { value: THREE.Vector3 };
  uAlpha: { value: number };
};

/** [height, alpha weight, band] for each slice: dense near the sand, a sparse band round the tower's middle. */
const SLICES: [number, number, 0 | 1][] = [
  [3, 1.0, 0], [8, 0.95, 0], [14, 0.85, 0], [22, 0.7, 0], [32, 0.55, 0], [45, 0.4, 0], [60, 0.28, 0],
  [100, 0.35, 1], [124, 0.4, 1], [150, 0.25, 1],
];

/**
 * A tileable value-noise texture: R = fine fbm (the streaks), G = medium
 * (the warp), B = coarse (the banks). Built once on the CPU.
 */
function noiseTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const lattice = (period: number, seed: number) => {
    const v = new Float32Array(period * period);
    let x = seed * 9301 + 49297;
    for (let i = 0; i < v.length; i++) {
      x = (x * 9301 + 49297) % 233280;
      v[i] = x / 233280;
    }
    return v;
  };
  const fbm = (octaves: number, base: number, seed: number) => {
    const out = new Float32Array(size * size);
    let amp = 0.5;
        for (let o = 0; o < octaves; o++) {
      const period = base << o;
      const v = lattice(period, seed + o * 17);
      for (let y = 0; y < size; y++) {
        const fy = (y / size) * period;
        const y0 = Math.floor(fy);
        const ty = fy - y0;
        const sy = ty * ty * (3 - 2 * ty);
        const r0 = (y0 % period) * period;
        const r1 = ((y0 + 1) % period) * period;
        for (let x = 0; x < size; x++) {
          const fx = (x / size) * period;
          const x0 = Math.floor(fx);
          const tx = fx - x0;
          const sx = tx * tx * (3 - 2 * tx);
          const c0 = x0 % period;
          const c1 = (x0 + 1) % period;
          const a = v[r0 + c0] + (v[r0 + c1] - v[r0 + c0]) * sx;
          const b = v[r1 + c0] + (v[r1 + c1] - v[r1 + c0]) * sx;
          out[y * size + x] += (a + (b - a) * sy) * amp;
        }
      }
      amp *= 0.5;
    }
    // Stretch to the full 0..1 range: summed octaves crowd round 0.5,
    // which left the wisps' thresholds almost never crossed.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < out.length; i++) {
      lo = Math.min(lo, out[i]);
      hi = Math.max(hi, out[i]);
    }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo || 1);
    return out;
  };
  const r = fbm(5, 4, 1);
  const g = fbm(3, 4, 2);
  const b = fbm(2, 3, 3);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = r[i] * 255;
    data[i * 4 + 1] = g[i] * 255;
    data[i * 4 + 2] = b[i] * 255;
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** How fast the banks cross the scene (m/s, downwind). */
export const BANK_SPEED = 10;

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${ENV_GLSL}
uniform float uVeilT;
uniform vec3 uFogCol; uniform float uFogDen;
uniform vec3 uLit; uniform vec3 uShade; uniform vec3 uGlow; uniform vec3 uAccent;
uniform vec3 uPillar;
uniform float uAlpha;
uniform float uWeight;
uniform float uBand;
uniform float uSpeed;
uniform vec2 uCentre;
uniform float uRadius;
uniform sampler2D uNoise;
uniform float uBankSpeed;
varying vec3 vWorld;

void main() {
  vec3 p = vWorld;
  vec3 d = p - cameraPosition;
  float dist = length(d);
  // The cheap fades first: nothing right at the lens (a slice you stand
  // under would veil the sky), none past the disc's rim, the far air, and
  // the tower band only round the tower.
  float toTower = length(p.xz - uPillar.xz);
  float fade = smoothstep(25.0, 170.0, dist)
             * (1.0 - smoothstep(uRadius * 0.7, uRadius, length(p.xz - uCentre)))
             * exp(-dist * uFogDen * 0.6);
  if (uBand > 0.5) fade *= 1.0 - smoothstep(110.0, 260.0, toTower);
  if (fade * uWeight * uAlpha < 0.004) discard;
  vec3 rd = d / dist;

  // Downwind drift (+x, a little toward the camera), each layer at its own speed.
  vec2 q = p.xz + vec2(1.0, 0.25) * uVeilT * uSpeed;
  // Neighbouring layers share most of their pattern (a volume, not a stack of decals).
  q += vec2(p.y * 2.3, p.y * 1.1);
  // Slow domain warp: the streaks curl.
  vec2 warp = texture2D(uNoise, q / 2600.0 + 0.37).gg - 0.5;
  q += vec2(warp.x, -warp.y) * 420.0;
  // Streaks: stretched along the wind (one tile = 1500 m x 420 m), broken into wisps.
  float n = texture2D(uNoise, q / vec2(1500.0, 420.0)).r;
  float wisp = smoothstep(0.45, 0.68, n);
  // Banks: big separate patches, the same for every layer (one body of fog
  // per bank), all drifting downwind together. Outside a bank: clear air.
  vec2 qb = p.xz - vec2(1.0, 0.25) * uVeilT * uBankSpeed;
  float bank = smoothstep(0.56, 0.68, texture2D(uNoise, qb / 1700.0 + 0.21).b);
  if (bank < 0.01) discard;
  float a = clamp(bank * (0.35 + 0.65 * wisp) * fade * uWeight * uAlpha, 0.0, 1.0);
  if (a < 0.003) discard;

  // Colour: the air's colour, lighter where thick, a soft sun glow when
  // looking toward it, and the tower's light inside the veils near it.
  // Paler than the air (else they vanish into the haze behind them):
  // the clouds' lit colour, lifted toward white in the thick of a wisp.
  vec3 col = mix(mix(uFogCol, uLit, 0.6), uLit * 1.25 + 0.06, wisp);
  col += uSunColor * 0.35 * pow(max(dot(rd, uSunDir), 0.0), 8.0);
  float near = exp(-toTower / 110.0);
  col += uGlow * near * (uBand > 0.5 ? 0.9 : 0.5) * exp(-max(p.y - 20.0, 0.0) / 140.0);
  // A faint red cast from above on the tower band (the seals overhead).
  col += uAccent * 0.08 * uBand;
  gl_FragColor = vec4(col * a, a);
}
`;

export type Veils = { group: THREE.Group; u: VeilUniforms; update(t: number): void };

export function createVeils(env: EnvUniforms, pillar: THREE.Vector3, eye: THREE.Vector3): Veils {
  const u: VeilUniforms = {
    uVeilT: { value: 0 },
    uFogCol: { value: new THREE.Color() },
    uFogDen: { value: 0.0012 },
    uLit: { value: new THREE.Color() },
    uShade: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uAccent: { value: new THREE.Color() },
    uPillar: { value: pillar.clone() },
    uAlpha: { value: 0.5 },
  };
  const noise = noiseTexture();
  const group = new THREE.Group();
  group.name = 'clouds-veils';
  const centre = new THREE.Vector2(0, -760);
  const radius = 1900;
  const disc = new THREE.CircleGeometry(radius, 64).rotateX(-Math.PI / 2);
  SLICES.forEach(([y, weight, band], i) => {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...env,
        ...u,
        uWeight: { value: weight },
        uBand: { value: band },
        // Lower layers drift slower (shear), 4–9 m/s.
        uSpeed: { value: 4 + (y / 170) * 5 + (i % 3) * 0.6 },
        uCentre: { value: centre },
        uRadius: { value: radius },
        uNoise: { value: noise },
        uBankSpeed: { value: BANK_SPEED },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Premultiplied "over".
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    const mesh = new THREE.Mesh(disc, material);
    mesh.position.set(centre.x, y, centre.y);
    mesh.frustumCulled = false;
    // Far layers (from the eye's height) first; above the seals (renderOrder 0).
    mesh.renderOrder = 3 + (1 - Math.abs(y - eye.y) / 200);
    mesh.name = `veil-${y}`;
    group.add(mesh);
  });
  return {
    group,
    u,
    update(t) {
      u.uVeilT.value = t;
    },
  };
}

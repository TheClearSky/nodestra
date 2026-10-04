// COPIED from .claude/pages/ad/experiments/env-src/river.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * A river glistening in the sun:
 *  - a channel cut into the meadow (`riverHeight`), the water a strip that
 *    follows the river's centre line;
 *  - stylised water: flow-advected noise normals, fresnel sky reflection
 *    (the SAME sky gradient as the dome), dark bank reflections at the
 *    edges, shallow-to-deep colour, painted flow streaks;
 *  - GLITTER, two ways:
 *    · "NOX streaks" — the measured Re:Zero NOX LUX ED sun-glitter as GPU
 *      sprites: every frame each slot samples a fresh point on the water and
 *      keeps it with the probability that some wave facet there reflects the
 *      sun into the eye (Cox–Munk: exp(−tan²θ_h / σ²)), so the glints gather
 *      into the physical glitter path under the sun. Survivors are drawn as
 *      the measured streaks: 28–70 × 1.5–4 px at 480p, fanned 0.105°/px from
 *      the centre, white core + #A0B2BE halo, additive; ~30 % of a frame's
 *      glints persist one more frame at 70 % (lag-1 correlation ≈ 0.35);
 *    · "shader sparkle" — per-pixel: a cell grid on the water with a random
 *      facet per cell, re-rolled every frame, lit only when it mirrors the
 *      sun: fine diamond dust.
 */

import * as THREE from 'three';
import { ENV_GLSL, seededRandom, type EnvUniforms } from './lab';

export const RIVER = { width: 11, waterY: -0.32, bed: -1.0, bank: 2.6 };

export function riverCentre(z: number): number {
  return 2.2 * Math.sin(z * 0.025 + 0.3) + 0.9 * Math.sin(z * 0.07 + 1.0);
}

export const RIVER_GLSL = /* glsl */ `
float riverCentre(float z) { return 2.2 * sin(z * 0.025 + 0.3) + 0.9 * sin(z * 0.07 + 1.0); }
`;

/** Ground height with the channel carved in. */
export function riverHeight(x: number, z: number): number {
  const d = Math.abs(x - riverCentre(z));
  const half = RIVER.width / 2;
  const t = THREE.MathUtils.smoothstep(d, half - 0.6, half + RIVER.bank);
  return THREE.MathUtils.lerp(RIVER.bed, 0, t);
}

export type River = {
  water: THREE.Mesh;
  glints: THREE.Mesh;
  /** 0 off, 1 NOX streaks, 2 shader sparkle, 3 both. */
  setGlitter(mode: number): void;
  /** 0 reflective (fresnel sky), 1 painted (flat anime bands). */
  uWaterStyle: { value: number };
};

export function createRiver(env: EnvUniforms, near: number, far: number, viewHeight: () => number, viewWidth: () => number): River {
  // ── water strip ──
  const along = 900;
  const across = 10;
  const positions: number[] = [];
  const edge: number[] = [];
  const indices: number[] = [];
  const half = RIVER.width / 2 + 0.8;
  for (let i = 0; i <= along; i++) {
    // Denser near the eye.
    const u = i / along;
    const z = near - Math.pow(u, 1.8) * (near - far);
    const c = riverCentre(z);
    for (let j = 0; j <= across; j++) {
      const v = j / across;
      positions.push(c + (v * 2 - 1) * half, RIVER.waterY, z);
      edge.push(v * 2 - 1);
    }
  }
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < across; j++) {
      const a = i * (across + 1) + j;
      const b = a + across + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aAcross', new THREE.Float32BufferAttribute(edge, 1));
  geometry.setIndex(indices);

  const uWaterStyle = { value: 0 };
  const uSparkle = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env, uWaterStyle, uSparkle },
    vertexShader: /* glsl */ `
      attribute float aAcross;
      varying vec3 vWorld;
      varying float vAcross;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vAcross = aAcross;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${RIVER_GLSL}
      uniform float uWaterStyle;
      uniform float uSparkle;
      varying vec3 vWorld;
      varying float vAcross;

      float waves(vec2 p) {
        // Advected downstream (toward +z), two scales crossing.
        float t = uTime;
        vec2 pa = p * vec2(0.9, 0.35) + vec2(0.0, -t * 0.55);
        float a = vnoise(pa) * 0.67 + vnoise(FBM_ROT * pa) * 0.33;
        float b = vnoise(p * vec2(2.3, 1.1) + vec2(t * 0.08, -t * 1.0) + 7.0);
        float c = vnoise(p * vec2(6.0, 3.0) + vec2(-t * 0.2, -t * 1.6));
        return a * 0.6 + b * 0.3 + c * 0.1;
      }

      void main() {
        if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec2 p = vWorld.xz;
        // Flow coordinates (across, along) so streaks follow the bends.
        float c = riverCentre(p.y);
        vec2 q = vec2(p.x - c, p.y);
        float e = 0.06;
        float h0 = waves(q);
        float hx = waves(q + vec2(e, 0.0));
        float hz = waves(q + vec2(0.0, e));
        float dist = length(vWorld - cameraPosition);
        // Calmer far away (and no aliasing shimmer).
        float amp = 0.55 / (1.0 + dist * 0.02);
        vec3 n = normalize(vec3(-(hx - h0) / e * amp, 1.0, -(hz - h0) / e * amp));
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 R = reflect(-V, n);
        R.y = abs(R.y);
        float cosT = max(dot(n, V), 0.0);
        float fresnel = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
        fresnel = mix(fresnel, 1.0, 0.25); // stylised: more sky in it

        float edgeD = abs(vAcross);
        vec3 deep = srgb(vec3(0.10, 0.30, 0.38));
        vec3 shallow = srgb(vec3(0.30, 0.52, 0.44));
        vec3 body = mix(deep, shallow, smoothstep(0.45, 0.95, edgeD));
        body *= 0.75 + 0.35 * h0;

        // Reflection: the sky; the far hills and the dark banks near the edges.
        vec3 sky = skyGradient(R);
        // The sun's own glow in the reflection is the glitter's job.
        sky -= uSunColor * 0.55 * pow(max(dot(R, uSunDir), 0.0), 400.0);
        float hillBand = 1.0 - smoothstep(0.02, 0.07, R.y);
        sky = mix(sky, mix(srgb(vec3(0.33, 0.46, 0.55)), uHaze, 0.35), hillBand * 0.8);
        float bankRefl = smoothstep(0.55, 0.95, edgeD) * (1.0 - smoothstep(30.0, 120.0, dist));
        sky = mix(sky, srgb(vec3(0.10, 0.22, 0.12)), bankRefl * 0.75);

        float sv = cloudShadow(vWorld);
        vec3 col;
        if (uWaterStyle < 0.5) {
          col = mix(body * (uAmbient * 0.6 + uSunColor * 0.5 * sv), sky, fresnel);
        } else {
          // Painted: flat colour bands, reflection only as soft light/dark.
          float band = smoothstep(0.45, 0.5, fresnel + h0 * 0.25);
          col = mix(body * 1.2, mix(body, sky, 0.6) * 1.15, band);
        }
        // Painted flow streaks (anime water's light lines).
        vec2 fs = vec2(q.x * 1.4, q.y * 0.12 - uTime * 0.6);
        float streak = smoothstep(0.72, 0.8, fbm3(fs + vec2(fbm3(fs * 0.5) * 2.0, 0.0)));
        col += uSunColor * streak * 0.12 * sv * (1.0 - smoothstep(10.0, 80.0, dist));
        // Sun: a broad sheen and a sharp core along the glitter path.
        float spec = max(dot(R, uSunDir), 0.0);
        col += uSunColor * (pow(spec, 140.0) * 0.28 + pow(spec, 1500.0) * 1.6) * sv;
        // Bright shore line where the water laps the bank.
        col += uSunColor * smoothstep(0.92, 1.0, edgeD) * 0.15 * sv;

        if (uSparkle > 0.5) {
          // Shader sparkle: random facet per 12 cm cell, re-rolled each frame.
          vec2 cell = floor(p / 0.12);
          vec2 hh = hash22(cell + vec2(uFrame * 0.731, uFrame * 0.293));
          vec2 slope = (hash22(cell * 1.7 + uFrame * 0.117) - 0.5) * 0.7;
          vec3 fn = normalize(vec3(slope.x, 1.0, slope.y));
          float al = max(dot(reflect(-V, fn), uSunDir), 0.0);
          vec2 inCell = fract(p / 0.12) - hh;
          float dot0 = 1.0 - smoothstep(0.0, 0.18, length(inCell * vec2(1.0, 0.45)));
          float spark = smoothstep(0.985, 0.998, al) * dot0;
          col += vec3(1.0, 0.98, 0.94) * spark * 9.0 * sv * (1.0 - smoothstep(60.0, 250.0, dist));
        }
        col = airFade(col, vWorld, 0.0016);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const water = new THREE.Mesh(geometry, material);
  water.frustumCulled = false;

  // ── NOX glitter sprites ──
  const SLOTS = 1500;
  const rnd = seededRandom(91);
  const gGeo = new THREE.InstancedBufferGeometry();
  gGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  gGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const slots = new Float32Array(SLOTS * 2);
  for (let i = 0; i < SLOTS * 2; i++) slots[i] = i + rnd() * 0.01;
  gGeo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slots, 1));
  gGeo.instanceCount = SLOTS * 2;
  const uGlints = { value: 1 };
  const glintMaterial = new THREE.ShaderMaterial({
    uniforms: {
      ...env,
      uSlots: { value: SLOTS },
      uNear: { value: 2.5 },
      uFar: { value: Math.abs(near - far) * 0.6 },
      uWaterY: { value: RIVER.waterY },
      uWidth: { value: RIVER.width },
      uSigma: { value: 0.26 },
      uDensity: { value: 1.0 },
      uViewH: { value: 1000 },
      uViewW: { value: 1600 },
      uGlints,
    },
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      ${RIVER_GLSL}
      attribute float aSlot;
      uniform float uSlots;
      uniform float uNear;
      uniform float uFar;
      uniform float uWaterY;
      uniform float uWidth;
      uniform float uSigma;
      uniform float uDensity;
      uniform float uViewH;
      uniform float uViewW;
      uniform float uGlints;
      varying vec2 vUv;
      varying float vBright;
      void main() {
        vUv = position.xy;
        float slot = floor(aSlot);
        bool prev = slot >= uSlots;
        float f = prev ? uFrame - 1.0 : uFrame;
        float s = mod(slot, uSlots);
        vec2 h1 = hash22(vec2(s * 1.37 + 0.5, f * 0.731 + 3.1));
        vec2 h2 = hash22(vec2(s * 2.11 + 5.3, f * 1.913 + 0.7));
        vec2 h3 = hash22(vec2(s * 0.71 + 9.1, f * 0.377 + 4.4));
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        vBright = 0.0;
        if (uGlints < 0.5) return;
        // Persistence: ~30 % of last frame's glints survive one more frame.
        if (prev && h3.y > 0.3) return;
        // Sample along the view, uniform in 1/distance (≈ uniform on screen).
        float camZ = cameraPosition.z;
        float invD = mix(1.0 / uNear, 1.0 / uFar, h1.x);
        float z = camZ - 1.0 / invD;
        float x = riverCentre(z) + (h1.y - 0.5) * uWidth * 0.9;
        vec3 P = vec3(x, uWaterY, z);
        vec3 V = normalize(cameraPosition - P);
        vec3 H = normalize(uSunDir + V);
        float tan2 = dot(H.xz, H.xz) / max(H.y * H.y, 1e-4);
        float prob = exp(-tan2 / (uSigma * uSigma)) * uDensity * cloudShadow(P);
        if (h2.x > prob) return;
        vec4 clip = projectionMatrix * viewMatrix * vec4(P, 1.0);
        if (clip.w <= 0.0) return;
        // Measured sizes at 854×480, scaled to this viewport; a little
        // smaller with distance.
        float scale = uViewH / 480.0;
        float depthK = clamp(12.0 / length(cameraPosition - P), 0.35, 1.0);
        float L = (28.0 + 42.0 * pow(h2.y, 1.5)) * scale * depthK;
        float W = (1.5 + 2.5 * h3.x) * scale * mix(0.7, 1.0, depthK);
        vec2 ndc = clip.xy / clip.w;
        float px = (ndc.x * 0.5 + 0.5) * uViewW;
        // Fan: 0.105° per (480p) pixel from the centre; the lower end leans out.
        float theta = radians(0.105) * (px - uViewW * 0.5) / scale;
        vec2 half_ = vec2(W * 1.8, L * 0.75);
        vec2 off = position.xy * half_;
        float cs = cos(-theta);
        float sn = sin(-theta);
        off = vec2(cs * off.x - sn * off.y, sn * off.x + cs * off.y);
        clip.xy += off / vec2(uViewW, uViewH) * 2.0 * clip.w;
        // Lift the streak so it sits ON the water, centred a touch above P.
        gl_Position = clip;
        vBright = (0.45 + 0.55 * h1.x) * (prev ? 0.7 : 1.0) * mix(0.45, 1.0, depthK);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOcclusion;
      uniform vec3 uSunColor;
      varying vec2 vUv;
      varying float vBright;
      void main() {
        if (uOcclusion > 0.5 || vBright <= 0.0) discard;
        // Quad spans the halo (w·1.8, L·0.75); the core is (w/2, L/2).
        vec2 haloQ = vUv;
        float halo = max(0.0, 1.0 - length(haloQ)) * (1.0 - abs(vUv.y));
        vec2 coreQ = vUv / vec2(0.5 / 1.8, 0.5 / 0.75);
        float coreR = length(coreQ);
        float core = coreR < 1.0 ? (1.0 - coreR * coreR) : 0.0;
        // Brightest just above the middle (measured 0.45–0.6 along).
        core *= mix(1.0, 0.85, smoothstep(-0.2, 0.6, -vUv.y));
        vec3 haloC = pow(vec3(160.0, 178.0, 190.0) / 255.0, vec3(2.2));
        vec3 col = haloC * halo * 0.28 + vec3(1.0, 0.99, 0.97) * core * 0.95;
        gl_FragColor = vec4(col * uSunColor * vBright * 3.2, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    // The streak extends below its water point on screen, where the water
    // is nearer the eye — a depth test would cut its lower half off.
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const glints = new THREE.Mesh(gGeo, glintMaterial);
  glints.frustumCulled = false;
  glints.renderOrder = 30;
  glints.onBeforeRender = () => {
    glintMaterial.uniforms.uViewH.value = viewHeight();
    glintMaterial.uniforms.uViewW.value = viewWidth();
  };

  return {
    water,
    glints,
    uWaterStyle,
    setGlitter(mode) {
      uGlints.value = mode === 1 || mode === 3 ? 1 : 0;
      uSparkle.value = mode === 2 || mode === 3 ? 1 : 0;
    },
  };
}

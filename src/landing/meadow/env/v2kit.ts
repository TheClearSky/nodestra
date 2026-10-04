// COPIED from .claude/pages/ad/experiments/env-src/v2kit.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * Shared kit for the v2 tree / shadow / grass variant pages:
 *  - the two lights the user asked to compare: BRIGHT DAY (refs 1–2: high
 *    afternoon sun, deep cobalt zenith, pale horizon, no bloom) and MISTY
 *    BACKLIT (ref 3: low sun behind the subject, pink-lavender haze, glow);
 *  - `uMist` + `mistFade()` (aerial perspective that thickens in the mist);
 *  - painted distant hills (a copy of sky.ts's hills that also fade in mist);
 *  - a "veil" post pass (lift + sun glow in the mist; identity on a clear day);
 *  - shot (camera) presets, a "Judge:" line, and the shared meadow slope.
 *
 * Everything is procedural: no image, model or HDRI files.
 */

import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { applyPalette, ENV_GLSL, seededRandom, type EnvUniforms, type Lab, type Palette } from './lab';
import { GodRaysPass } from './godrays';
import type { Cumulus } from './sky';

// ── lights ──────────────────────────────────────────────────────────────

/** Ref 1: high afternoon sun from the upper left, a little behind the tree,
 *  so the canopy's shadow pool falls toward the viewer and to the right. */
export const BRIGHT: Palette = {
  sunDir: new THREE.Vector3(-0.62, 0.72, -0.2),
  sun: '#fff4dc',
  zenith: '#0d4fb8',
  horizon: '#b2dcec',
  haze: '#d6edf2',
  ambient: '#86acd8',
};

/** Ref 3: the sun low behind the subject, a pink-cream haze, lavender shade. */
export const MISTY: Palette = {
  sunDir: new THREE.Vector3(-0.2, 0.2, -0.96),
  sun: '#ffe2c2',
  zenith: '#8ea6cf',
  horizon: '#f3d8cc',
  haze: '#efdcdc',
  ambient: '#b0a3c8',
};

export type LightMode = 'bright' | 'misty';

export type KitUniforms = EnvUniforms & { uMist: { value: number } };

export const MIST_GLSL = /* glsl */ `
uniform float uMist;
/** Aerial perspective; in the mist it thickens and glows toward the sun. */
vec3 mistFade(vec3 col, vec3 worldPos) {
  vec3 d = worldPos - cameraPosition;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-4);
  float dens = mix(0.0016, 0.0055, uMist);
  float f = 1.0 - exp(-dist * dens);
  float sunSide = pow(max(dot(dir, uSunDir), 0.0), mix(6.0, 5.0, uMist));
  vec3 hazeCol = mix(uHaze, uHorizon, 0.35) + uSunColor * mix(0.12, 0.22, uMist) * sunSide;
  return mix(col, hazeCol, f);
}
`;

/** Both ENV and MIST helpers (every v2 material starts with this). */
export const KIT_GLSL = ENV_GLSL + MIST_GLSL;

// ── the meadow slope (shared by all v2 pages) ──────────────────────────

/** The ground rises gently to the right and away from the viewer (the river
 *  side of ref 1 is to the left, downhill). Bounded to ±3 m by tanh. */
export function slopeHeight(x: number, z: number): number {
  const s = 3.0 * Math.tanh((0.085 * x - 0.045 * z) / 3.0);
  return s + 0.3 * Math.sin(0.21 * x + 0.3) * Math.sin(0.17 * z) * Math.exp(-(x * x + z * z) / 9000);
}
export const SLOPE_GLSL = /* glsl */ `
float tanh_(float x) { float e = exp(2.0 * clamp(x, -9.0, 9.0)); return (e - 1.0) / (e + 1.0); }
float groundH(vec2 xz) {
  float s = 3.0 * tanh_((0.085 * xz.x - 0.045 * xz.y) / 3.0);
  return s + 0.3 * sin(0.21 * xz.x + 0.3) * sin(0.17 * xz.y) * exp(-dot(xz, xz) / 9000.0);
}
`;

// ── URL helpers ─────────────────────────────────────────────────────────

/** Read `?v=group:id` before the lab exists (the initial camera etc.). */
export function urlVariant(group: string, fallback: string): string {
  const v = new URLSearchParams(location.search).get('v') ?? '';
  for (const pair of v.split(',')) {
    const [g, id] = pair.split(':');
    if (g === group && id) return id;
  }
  return fallback;
}

// ── the kit ─────────────────────────────────────────────────────────────

export type Shot = { id: string; label: string; eye: THREE.Vector3; look: THREE.Vector3; fov: number };

export type Kit = {
  u: KitUniforms;
  mode: () => LightMode;
  /** Set one named line of the Judge text (the page shows them joined). */
  judge(key: string, text: string): void;
  addLight(options: { initial: LightMode; clouds?: Cumulus; onChange?: (mode: LightMode) => void }): void;
  addShots(shots: Shot[], initial: string, onChange?: (shot: Shot) => void): void;
  rays: GodRaysPass;
};

export function createKit(lab: Lab): Kit {
  const u = Object.assign(lab.env, { uMist: { value: 0 } }) as KitUniforms;
  let mode: LightMode = 'bright';

  // Judge line, appended to the lab's note box (hidden by ?clean like the HUD).
  const judgeLines = new Map<string, string>();
  const judgeEl = document.createElement('div');
  judgeEl.style.marginTop = '5px';
  judgeEl.style.color = '#f3e2b8';
  document.querySelector('.env-note')?.append(judgeEl);
  const judge = (key: string, text: string) => {
    judgeLines.set(key, text);
    judgeEl.innerHTML = `<b>Judge:</b> ${[...judgeLines.values()].join(' ')}`;
  };

  // Post: god rays (misty only) and the veil (insert order: rays before veil).
  const veil = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uSun: { value: new THREE.Vector2(0.5, 0.5) },
      uAspect: { value: 1.6 },
      uMist: u.uMist,
      uHaze: u.uHaze,
      uSunColor: u.uSunColor,
      uSunVisible: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 uSun;
      uniform float uAspect;
      uniform float uMist;
      uniform vec3 uHaze;
      uniform vec3 uSunColor;
      uniform float uSunVisible;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        vec3 col = c.rgb;
        vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
        float r = length(d);
        float glow = (exp(-r * 2.0) * 0.5 + exp(-r * 7.0) * 0.55) * uSunVisible;
        // Mist: a milky lift of the darks, then the sun's veiling glow.
        col = mix(col, uHaze * 0.8, uMist * 0.06);
        col += uSunColor * vec3(1.0, 0.88, 0.82) * glow * uMist * 0.28;
        gl_FragColor = vec4(col, c.a);
      }
    `,
  });
  lab.addPass(veil);
  const rays = new GodRaysPass(lab.scene, lab.camera, lab.env);
  rays.params.gain = 0.35;
  // The 4× MSAA occlusion target stalls this GPU (Intel UHD, ANGLE D3D11) a
  // few seconds after the pass is enabled, down to 0 fps (env-02 too). The
  // occlusion buffer is blurred anyway, so it does not need MSAA.
  rays.occlusion.samples = 0;
  lab.addPass(rays);
  const bloom = lab.composer.passes.find((p) => p instanceof UnrealBloomPass) as UnrealBloomPass | undefined;

  const sunScreen = new THREE.Vector3();
  const forward = new THREE.Vector3();
  lab.onFrame(() => {
    sunScreen.copy(u.uSunDir.value).multiplyScalar(1000).add(lab.camera.position).project(lab.camera);
    lab.camera.getWorldDirection(forward);
    veil.uniforms.uSun.value.set(sunScreen.x * 0.5 + 0.5, sunScreen.y * 0.5 + 0.5);
    veil.uniforms.uAspect.value = lab.camera.aspect;
    veil.uniforms.uSunVisible.value = THREE.MathUtils.smoothstep(forward.dot(u.uSunDir.value), 0.0, 0.4);
  });

  return {
    u,
    rays,
    mode: () => mode,
    judge,
    addLight({ initial, clouds, onChange }) {
      lab.addVariants({
        id: 'light',
        label: 'Light',
        options: [
          { id: 'bright', label: 'Bright day (refs 1–2)' },
          { id: 'misty', label: 'Misty backlit (ref 3)' },
        ],
        initial,
        onChange: (id) => {
          mode = id as LightMode;
          const misty = mode === 'misty';
          applyPalette(u, misty ? MISTY : BRIGHT);
          u.uMist.value = misty ? 1 : 0;
          u.uCloudShadow.value = misty ? 0 : 0.6;
          rays.enabled = misty;
          if (bloom) {
            // Ref 1 has no bloom; ref 3 is all soft glow.
            bloom.strength = misty ? 0.16 : 0.1;
            bloom.radius = misty ? 0.7 : 0.4;
            bloom.threshold = misty ? 0.97 : 1.0;
          }
          clouds?.visible(!misty);
          onChange?.(mode);
          judge(
            'light',
            misty
              ? 'Misty: does the sun glow THROUGH the subject (rim light, haze) without washing it out?'
              : 'Bright: flat painted blocks, cobalt sky, no glow — as ref 1.',
          );
        },
      });
    },
    addShots(shots, initial, onChange) {
      lab.addVariants({
        id: 'shot',
        label: 'Shot',
        options: shots.map((s) => ({ id: s.id, label: s.label })),
        initial,
        onChange: (id) => {
          const shot = shots.find((s) => s.id === id)!;
          lab.camera.fov = shot.fov;
          lab.camera.updateProjectionMatrix();
          // Before start() the camera is the one createLab was given.
          window.__env?.setCamera([shot.eye.x, shot.eye.y, shot.eye.z], [shot.look.x, shot.look.y, shot.look.z]);
          onChange?.(shot);
        },
      });
    },
  };
}

// ── distant hills (copy of sky.ts createHills that also fades in the mist) ──

export type HillLayer = { distance: number; height: number; roughness: number; color: string; haze: number; trees?: boolean; seed: number };

export function defaultHillsV2(): HillLayer[] {
  return [
    { distance: 950, height: 210, roughness: 0.5, color: '#7aa0c8', haze: 0.45, seed: 3 },
    { distance: 560, height: 85, roughness: 0.45, color: '#4c8197', haze: 0.3, trees: true, seed: 5 },
    { distance: 300, height: 30, roughness: 0.42, color: '#3d7347', haze: 0.16, trees: true, seed: 9 },
  ];
}

export function createHillsV2(u: KitUniforms, layers: HillLayer[], centreAzimuth = 0, span = Math.PI * 1.4): THREE.Group {
  const group = new THREE.Group();
  for (const layer of layers) {
    const rnd = seededRandom(layer.seed);
    const segments = 600;
    const phase = Array.from({ length: 8 }, () => rnd() * 100);
    const ridge = (s: number) => {
      let h = 0;
      let amp = 1;
      let freq = 1.2;
      for (let o = 0; o < 6; o++) {
        const v = 1 - Math.abs(Math.sin(s * freq * Math.PI * 2 + phase[o]));
        h += amp * v * v;
        amp *= layer.roughness;
        freq *= 2.13;
      }
      let trees = 0;
      if (layer.trees) {
        const k = s * 1400;
        trees = Math.abs(Math.sin(k + phase[6])) * 0.6 + Math.abs(Math.sin(k * 1.73 + phase[7])) * 0.4;
      }
      return h * 0.6 + trees * 0.025;
    };
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const s = i / segments;
      const a = centreAzimuth + (s - 0.5) * span;
      const x = Math.sin(a) * layer.distance;
      const z = -Math.cos(a) * layer.distance;
      positions.push(x, -30, z, x, ridge(s) * layer.height, z);
      uvs.push(s, 0, s, 1);
      if (i < segments) {
        const k = i * 2;
        indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...u,
        uColor: { value: new THREE.Color(layer.color) },
        uHazeAmt: { value: layer.haze },
        uTop: { value: layer.height },
        uForest: { value: layer.trees ? 1 : 0 },
        uArc: { value: layer.distance * span },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying float vV;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vV = uv.x;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        ${KIT_GLSL}
        uniform vec3 uColor;
        uniform float uHazeAmt;
        uniform float uTop;
        uniform float uForest;
        uniform float uArc;
        varying vec3 vWorld;
        varying float vV;
        void main() {
          if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          vec3 dir = normalize(vWorld - cameraPosition);
          float low = 1.0 - smoothstep(-5.0, uTop * 0.9, vWorld.y);
          vec3 c = uColor;
          vec2 q = vec2(vV * uArc, vWorld.y) / max(uTop, 1.0) * vec2(1.0, 2.2) * 1.6;
          vec2 sunQ = normalize(vec2(-uSunDir.x, uSunDir.y) + 1e-4) * 0.12;
          float lit = clamp((fbm(q) - fbm(q + sunQ)) * 5.0 + 0.5, 0.0, 1.0);
          c *= mix(0.8, 1.16, lit);
          if (uForest > 0.5) c *= mix(0.84, 1.06, smoothstep(0.35, 0.65, fbm(q * 5.0)));
          c = mix(c, c * 1.22 + uSunColor * 0.05, smoothstep(uTop * 0.45, uTop, vWorld.y) * 0.5);
          float sunSide = pow(max(dot(dir, uSunDir), 0.0), mix(4.0, 2.0, uMist));
          vec3 hazeCol = mix(uHaze, uHorizon, 0.3) + uSunColor * mix(0.15, 0.4, uMist) * sunSide;
          float amt = clamp(uHazeAmt + low * 0.35, 0.0, 1.0);
          // In the mist the ranges become flat paper cut-outs in the haze.
          amt = mix(amt, clamp(0.55 + uHazeAmt * 0.8 + low * 0.2, 0.0, 0.97), uMist);
          c = mix(c, hazeCol, amt);
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -4;
    group.add(mesh);
  }
  return group;
}

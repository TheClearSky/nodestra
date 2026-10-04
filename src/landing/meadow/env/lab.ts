// COPIED from .claude/pages/ad/experiments/env-src/lab.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * Shared harness for the environment experiments (env-01 … env-04):
 * renderer + composer, the shared "environment" uniforms (sun, sky, wind),
 * GLSL noise / wind / sky helpers, a drag-to-look camera with the piano's
 * idle wander, a variant HUD and a fps probe for the Playwright checks.
 *
 * Everything is procedural: no image, model or HDRI files anywhere.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';

// ── deterministic randomness (same layout on every visit) ───────────────

export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── shared uniforms ─────────────────────────────────────────────────────

export type EnvUniforms = {
  uTime: { value: number };
  /** Rendered frame counter — the glitter re-randomises on it. */
  uFrame: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uZenith: { value: THREE.Color };
  uHorizon: { value: THREE.Color };
  uHaze: { value: THREE.Color };
  uAmbient: { value: THREE.Color };
  uBreeze: { value: number };
  uWindDir: { value: THREE.Vector2 };
  /** 1 while rendering the god-ray occlusion buffer: sky = sun mask, all else black. */
  uOcclusion: { value: number };
  /** 0…1: how strongly drifting cloud shadows darken the ground. */
  uCloudShadow: { value: number };
  /** Debug view switch (?debug=1): materials may show raw terms. */
  uDebug: { value: number };
};

export type Palette = {
  sunDir: THREE.Vector3;
  sun: string;
  zenith: string;
  horizon: string;
  haze: string;
  ambient: string;
};

export const MIDDAY: Palette = {
  sunDir: new THREE.Vector3(-0.62, 0.42, -0.66),
  sun: '#fff1d6',
  zenith: '#1f63d1',
  horizon: '#a9d9f2',
  haze: '#dceff7',
  ambient: '#8fb0d8',
};

/** Late afternoon: low warm sun, peach horizon, lavender shade. */
export const GOLDEN: Palette = {
  sunDir: new THREE.Vector3(-0.55, 0.16, -0.82),
  sun: '#ffc68a',
  zenith: '#3a63b0',
  horizon: '#f1cfa6',
  haze: '#f6dcc2',
  ambient: '#9b93c4',
};

/** Blue hour after sunset: the sky still lit, the land in cool shade. */
export const DUSK: Palette = {
  sunDir: new THREE.Vector3(-0.6, 0.03, -0.8),
  sun: '#ff9a6a',
  zenith: '#24356e',
  horizon: '#e7a483',
  haze: '#c99aa2',
  ambient: '#6f6fa6',
};

export function makeEnvUniforms(palette: Palette): EnvUniforms {
  return {
    uTime: { value: 0 },
    uFrame: { value: 0 },
    uSunDir: { value: palette.sunDir.clone().normalize() },
    uSunColor: { value: new THREE.Color(palette.sun) },
    uZenith: { value: new THREE.Color(palette.zenith) },
    uHorizon: { value: new THREE.Color(palette.horizon) },
    uHaze: { value: new THREE.Color(palette.haze) },
    uAmbient: { value: new THREE.Color(palette.ambient) },
    uBreeze: { value: 1 },
    uWindDir: { value: new THREE.Vector2(1, 0.3).normalize() },
    uOcclusion: { value: 0 },
    uCloudShadow: { value: 1 },
    uDebug: { value: Number(new URLSearchParams(location.search).get('debug') ?? 0) },
  };
}

export function applyPalette(env: EnvUniforms, palette: Palette) {
  env.uSunDir.value.copy(palette.sunDir).normalize();
  env.uSunColor.value.set(palette.sun);
  env.uZenith.value.set(palette.zenith);
  env.uHorizon.value.set(palette.horizon);
  env.uHaze.value.set(palette.haze);
  env.uAmbient.value.set(palette.ambient);
}

// ── GLSL helpers ────────────────────────────────────────────────────────

/** Declarations + noise + wind + sky gradient. Colours are linear (THREE.Color
 *  converts the sRGB hex); `srgb()` converts inline sRGB constants. */
export const ENV_GLSL = /* glsl */ `
uniform float uTime;
uniform float uFrame;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uAmbient;
uniform float uBreeze;
uniform vec2 uWindDir;
uniform float uOcclusion;
uniform float uCloudShadow;
uniform float uDebug;

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
const mat2 FBM_ROT = mat2(1.6, 1.2, -1.2, 1.6);
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = FBM_ROT * p; a *= 0.5; }
  return s / 0.96875;
}
float fbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = FBM_ROT * p; a *= 0.5; }
  return s / 0.875;
}

/**
 * The breeze at a ground point: a steady push, a slow sway, quick flutter,
 * and GUSTS — a low-frequency noise field blown downwind at ~7 m/s, so
 * visible waves roll across the meadow. Returns the lean (in blade heights)
 * and the gust strength 0…1 (used for the pale "silver wave" sheen).
 */
vec2 windAt(vec2 xz, float t, out float gust) {
  vec2 q = xz * 0.045 - uWindDir * t * 0.32;
  float g = fbm3(q + vec2(3.1, 1.7));
  gust = smoothstep(0.46, 0.8, g) * uBreeze;
  float sway = 0.5 + 0.5 * sin(t * 1.3 + dot(xz, vec2(0.21, 0.13)));
  float flutter = sin(t * 6.3 + xz.x * 3.1 + xz.y * 2.3) * 0.035 + sin(t * 9.1 + xz.y * 4.7) * 0.02;
  float s = uBreeze * (0.14 + 0.1 * sway) + gust * 0.75;
  vec2 across = vec2(-uWindDir.y, uWindDir.x);
  return uWindDir * s + across * flutter * (0.4 + uBreeze);
}

/** Shadows of the cumulus drifting over the land (~2 m/s): big soft
 *  patches of shade, the oldest trick for depth in an anime field. */
float cloudShadow(vec3 p) {
  vec2 q = p.xz * 0.028 - uWindDir * uTime * 0.05;
  float n = fbm3(q + vec2(7.0, 2.0));
  return mix(1.0, mix(0.32, 1.0, smoothstep(0.36, 0.48, n)), uCloudShadow);
}

/** The anime sky gradient (no clouds): deep zenith, pale cyan-white horizon,
 *  a soft sun glow. Used by the dome AND by the water's reflection. */
vec3 skyGradient(vec3 d) {
  float h = d.y;
  float up = pow(clamp(h, 0.0, 1.0), 0.45);
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 1.0, up));
  col = mix(col, uHaze, exp(-max(h, 0.0) * 12.0) * 0.75);
  float mu = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (0.08 * pow(mu, 4.0) + 0.22 * pow(mu, 32.0) + 0.6 * pow(mu, 400.0));
  if (h < 0.0) col = mix(uHaze, uHaze * 0.9, clamp(-h * 6.0, 0.0, 1.0));
  return col;
}

/** Aerial perspective: distant things fade into the horizon haze. */
vec3 airFade(vec3 col, vec3 worldPos, float density) {
  float dist = length(worldPos - cameraPosition);
  float f = 1.0 - exp(-dist * density);
  vec3 dir = normalize(worldPos - cameraPosition);
  vec3 hazeCol = mix(uHaze, uHorizon, 0.35) + uSunColor * 0.12 * pow(max(dot(dir, uSunDir), 0.0), 6.0);
  return mix(col, hazeCol, f);
}
`;

/** Vertex snippet: billboarded quad corner → world position (for sprites). */
export const BILLBOARD_GLSL = /* glsl */ `
vec3 billboard(vec3 centre, vec2 corner, vec2 size) {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  return centre + right * corner.x * size.x + up * corner.y * size.y;
}
`;

// ── lab harness ─────────────────────────────────────────────────────────

export type VariantOption = { id: string; label: string };
export type VariantGroup = {
  id: string;
  label: string;
  options: VariantOption[];
  initial: string;
  onChange: (id: string) => void;
};

export type LabOptions = {
  title: string;
  /** Short explanation shown bottom-left (HTML allowed). */
  note: string;
  palette: Palette;
  camera: { position: THREE.Vector3; look: THREE.Vector3; fov?: number; far?: number };
  bloom?: { strength: number; radius: number; threshold: number };
  exposure?: number;
};

export type Lab = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  env: EnvUniforms;
  pixelRatio: number;
  /** Insert a pass after the render pass (before bloom). */
  addPass(pass: Pass): void;
  /** Called every frame before the composer renders. */
  onFrame(cb: (t: number, dt: number) => void): void;
  /** Called once per frame BEFORE the composer, after onFrame (pre-renders). */
  onPreRender(cb: () => void): void;
  onResize(cb: (w: number, h: number) => void): void;
  addVariants(group: VariantGroup): void;
  start(): void;
};

declare global {
  interface Window {
    __env?: {
      ready: boolean;
      setVariant(group: string, id: string): void;
      measureFps(ms: number): Promise<number>;
      frames(): number;
      setWander(on: boolean): void;
      setTime(seconds: number | null): void;
      setCamera(position: [number, number, number], look: [number, number, number]): void;
    };
  }
}

export function createLab(canvas: HTMLCanvasElement, options: LabOptions): Lab {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(pixelRatio);
  // Khronos PBR Neutral keeps hue + saturation (anime palettes) where ACES
  // shifts and desaturates. The colour grade itself is another study.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = options.exposure ?? 1.0;

  const scene = new THREE.Scene();
  const env = makeEnvUniforms(options.palette);
  const camera = new THREE.PerspectiveCamera(options.camera.fov ?? 40, 1, 0.1, options.camera.far ?? 4000);

  // MSAA in the composer target: grass blades and leaf cards alias badly
  // without it (alpha-to-coverage also needs it).
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloomParams = options.bloom ?? { strength: 0.45, radius: 0.55, threshold: 0.92 };
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), bloomParams.strength, bloomParams.radius, bloomParams.threshold);
  const output = new OutputPass();
  composer.addPass(bloom);
  composer.addPass(output);

  // ── camera: drag to look, idle wander (as the piano stage) ──
  // The camera turns IN PLACE (a slow handheld pan), so far look targets do
  // not swing the eye sideways.
  const eyePos = options.camera.position.clone();
  const base = new THREE.Spherical().setFromVector3(options.camera.look.clone().sub(eyePos));
  const orbit = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0 };
  const wanderPhase = [0.3, 1.9, 4.1, 2.6];
  let wanderOn = true;
  let wanderWeight = 1;
  const pointers = new Map<number, { x: number; y: number }>();
  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    const k = 1.6 / Math.max(canvas.clientWidth, 1);
    orbit.targetYaw = THREE.MathUtils.clamp(orbit.targetYaw - (e.clientX - last.x) * k, -0.6, 0.6);
    orbit.targetPitch = THREE.MathUtils.clamp(orbit.targetPitch + (e.clientY - last.y) * k, -0.25, 0.3);
    last.x = e.clientX;
    last.y = e.clientY;
  });
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  const spherical = new THREE.Spherical();
  const lookDir = new THREE.Vector3();
  const lookPoint = new THREE.Vector3();
  const placeCamera = (t: number) => {
    orbit.yaw += (orbit.targetYaw - orbit.yaw) * 0.08;
    orbit.pitch += (orbit.targetPitch - orbit.pitch) * 0.08;
    wanderWeight += ((wanderOn ? 1 : 0) - wanderWeight) * 0.02;
    const [a, b, c, d] = wanderPhase;
    const wy = wanderWeight * (0.035 * Math.sin(t * 0.13 + a) + 0.018 * Math.sin(t * 0.071 + b));
    const wp = wanderWeight * (0.01 * Math.sin(t * 0.09 + c) + 0.006 * Math.sin(t * 0.053 + d));
    spherical.set(1, base.phi - orbit.pitch - wp, base.theta + orbit.yaw + wy);
    camera.position.copy(eyePos);
    camera.position.y += wanderWeight * 0.03 * Math.sin(t * 0.21 + b);
    lookDir.setFromSpherical(spherical);
    camera.lookAt(lookPoint.copy(camera.position).add(lookDir));
  };

  // ── HUD ──
  const hud = document.createElement('div');
  hud.className = 'env-hud';
  const fpsEl = document.createElement('div');
  fpsEl.className = 'env-fps';
  const note = document.createElement('div');
  note.className = 'env-note';
  note.innerHTML = `<b>${options.title}</b> · ${options.note}`;
  document.body.append(hud, fpsEl, note);
  if (new URLSearchParams(location.search).has('clean')) document.body.classList.add('clean');
  addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('clean');
  });
  const groups = new Map<string, { group: VariantGroup; buttons: Map<string, HTMLButtonElement> }>();
  const setVariant = (groupId: string, id: string) => {
    const entry = groups.get(groupId);
    if (!entry) throw new Error(`no variant group ${groupId}`);
    if (!entry.buttons.has(id)) throw new Error(`no variant ${groupId}:${id}`);
    for (const [key, button] of entry.buttons) button.setAttribute('aria-pressed', String(key === id));
    entry.group.onChange(id);
  };

  // ── loop ──
  const frameCallbacks: ((t: number, dt: number) => void)[] = [];
  const preRender: (() => void)[] = [];
  const resizeCallbacks: ((w: number, h: number) => void)[] = [];
  let frames = 0;
  let fixedTime: number | null = null;
  let previous = performance.now();
  const start = previous;
  let fpsWindowStart = previous;
  let fpsWindowFrames = 0;
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - previous) / 1000);
    previous = now;
    const t = fixedTime ?? (now - start) / 1000;
    env.uTime.value = t;
    env.uFrame.value = (env.uFrame.value + 1) % 100000;
    frames++;
    fpsWindowFrames++;
    if (now - fpsWindowStart > 1000) {
      fpsEl.textContent = `${Math.round((fpsWindowFrames * 1000) / (now - fpsWindowStart))} fps`;
      fpsWindowStart = now;
      fpsWindowFrames = 0;
    }
    placeCamera(t);
    for (const cb of frameCallbacks) cb(t, dt);
    for (const cb of preRender) cb();
    composer.render(dt);
  };

  const resize = () => {
    const w = innerWidth;
    const h = innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    for (const cb of resizeCallbacks) cb(w * pixelRatio, h * pixelRatio);
  };
  addEventListener('resize', resize);

  return {
    renderer,
    scene,
    camera,
    composer,
    env,
    pixelRatio,
    addPass(pass) {
      composer.insertPass(pass, 1);
    },
    onFrame(cb) {
      frameCallbacks.push(cb);
    },
    onPreRender(cb) {
      preRender.push(cb);
    },
    onResize(cb) {
      resizeCallbacks.push(cb);
    },
    addVariants(group) {
      const row = document.createElement('div');
      row.className = 'env-row';
      const label = document.createElement('span');
      label.textContent = group.label;
      row.append(label);
      const buttons = new Map<string, HTMLButtonElement>();
      for (const option of group.options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = option.label;
        button.dataset.variant = `${group.id}:${option.id}`;
        button.onclick = () => setVariant(group.id, option.id);
        buttons.set(option.id, button);
        row.append(button);
      }
      hud.append(row);
      groups.set(group.id, { group, buttons });
      setVariant(group.id, group.initial);
    },
    start() {
      // URL ?v=group:id,group:id picks variants (screenshots, links).
      const v = new URLSearchParams(location.search).get('v');
      if (v) for (const pair of v.split(',')) {
        const [g, id] = pair.split(':');
        if (g && id) setVariant(g, id);
      }
      // ?hide=name,name hides named objects (performance bisection).
      const hide = new URLSearchParams(location.search).get('hide');
      if (hide) for (const name of hide.split(',')) {
        const object = scene.getObjectByName(name);
        if (object) object.visible = false;
      }
      resize();
      renderer.setAnimationLoop(frame);
      window.__env = {
        ready: true,
        setVariant,
        frames: () => frames,
        setWander(on) {
          wanderOn = on;
          wanderWeight = on ? wanderWeight : 0;
        },
        setTime(seconds) {
          fixedTime = seconds;
        },
        setCamera(position, look) {
          eyePos.set(...position);
          base.setFromVector3(new THREE.Vector3(...look).sub(eyePos));
        },
        measureFps(ms) {
          return new Promise((resolve) => {
            let n = 0;
            const t0 = performance.now();
            const tick = () => {
              n++;
              const elapsed = performance.now() - t0;
              if (elapsed >= ms) resolve((n * 1000) / elapsed);
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
        },
      };
    },
  };
}

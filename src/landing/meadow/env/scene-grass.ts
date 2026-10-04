// COPIED from .claude/pages/ad/experiments/env-src/scene-grass.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * The meadow grass for the instrument scenes, behind ONE small adapter.
 *
 * The user rejected every per-blade grass (blades shadow each other).
 * `cardgrass.ts` (plane-scattered painted clump cards, ground-normal
 * shading, no self-shadow) is the grass now, with the grass agent's
 * recommended settings: C1 'cross' design, density mid (×1), gusty breeze.
 * grass2.ts's G1 is kept as `placeholderGrass` for comparison only
 * (`?grass2` on the page URL).
 *
 * The scenes only ever call `createSceneGrass`; which grass is drawn is the
 * one `IMPL` line below.
 */

import * as THREE from 'three';
import type { KitUniforms } from './v2kit';
import type { ShadowUniforms } from './shadow';
import { createGrass2 } from './grass2';
import { createCardGrass, type FlowerKind } from './cardgrass';
import { fanSampler } from './meadow';

export type SceneGrassSpec = {
  u: KitUniforms;
  /** The tree's shadow field (shadow.ts uniforms; one texture fetch). */
  shadow: ShadowUniforms;
  heightAt: (x: number, z: number) => number;
  /** The wide shot's eye and gaze (the grass fills its view). */
  eye: [number, number];
  /** Heading of the gaze: 0 = looking to −z, positive towards +x. */
  yaw: number;
  /** Ground where nothing may grow (river, far bank, trunk, instrument). */
  reject: (x: number, z: number) => boolean;
  flowers: FlowerKind[];
  /** 1 = the module's default amount (URL ?grass= overrides). */
  density: number;
};

/** A capsule (xz) the grass parts round: bends away and lies down. */
export type GrassPress = { a: THREE.Vector2; b: THREE.Vector2; r: number; strength: number };

export type SceneGrass = {
  /** Shown on the page's honest label. */
  label: string;
  update(t: number, dt: number): void;
  /** Where the grass is pressed down this frame (≤ 4 capsules). */
  press(caps: GrassPress[]): void;
  /** Instance counts (tests). */
  stats?(): unknown;
  dispose(): void;
};

// ── grass that parts round a moving object ──────────────────────────────
// cardgrass.ts places its cards once; a moving instrument instead BENDS the
// cards and flowers near it (their roots stay). Injected into cardgrass's
// own ShaderMaterials at runtime (the module file is not edited).
const MAXPRESS = 4;
const PRESS_GLSL = /* glsl */ `
#define SCENE_PRESS ${MAXPRESS}
uniform float uSceneKeep;   // cards kept (quality)
uniform float uSceneFlowers; // flowers kept (quality)
uniform vec4 uPressA[SCENE_PRESS];
uniform vec4 uPressR[SCENE_PRESS]; // radius, strength
uniform int uPressN;
/** (away-direction xz, strength 0…1) for a root at p. */
vec3 scenePress(vec2 p) {
  vec3 best = vec3(0.0);
  for (int i = 0; i < SCENE_PRESS; i++) {
    if (i >= uPressN) break;
    vec2 a = uPressA[i].xy;
    vec2 b = uPressA[i].zw;
    vec2 pa = p - a;
    vec2 ba = b - a;
    float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    vec2 q = pa - ba * t;
    float d = length(q);
    float k = (1.0 - smoothstep(uPressR[i].x, uPressR[i].x + 0.45, d)) * uPressR[i].y;
    if (k > best.z) best = vec3(q / max(d, 1e-3), k);
  }
  return best;
}
`;
type PressUniforms = { uPressA: { value: THREE.Vector4[] }; uPressR: { value: THREE.Vector4[] }; uPressN: { value: number } };

/** Quality knobs shared by every cardgrass instance (scene-quality.ts):
 *  instances whose hash is above the kept fraction collapse in the vertex
 *  shader (no fragments), so the runtime can thin without a rebuild. */
export const grassQuality = { uSceneKeep: { value: 1 }, uSceneFlowers: { value: 1 } };
const KEEP_CARD = 'if (fract(seed * 91.7 + 0.37) > uSceneKeep) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }';
const KEEP_FLOWER = 'if (fract(seed * 57.3 + 0.71) > uSceneFlowers * uFlowerShare) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }';
function makePress(group: THREE.Object3D, flowerScale = 1, flowerShare = 1): { uniforms: PressUniforms; press(caps: GrassPress[]): void } {
  const uniforms: PressUniforms = {
    uPressA: { value: Array.from({ length: MAXPRESS }, () => new THREE.Vector4()) },
    uPressR: { value: Array.from({ length: MAXPRESS }, () => new THREE.Vector4()) },
    uPressN: { value: 0 },
  };
  group.traverse((obj) => {
    const m = (obj as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
    if (!m || !(m as THREE.ShaderMaterial).isShaderMaterial) return;
    let vs = m.vertexShader;
    const card = vs.includes('vec2 bend = wind * bendK;');
    const flower = vs.includes('float h = aInfo.x;');
    if (!card && !flower) return;
    vs = vs.replace('void main() {', `${PRESS_GLSL}\nuniform float uFlowerShare;\nvoid main() {`);
    if (card) vs = vs.replace('vec2 bend = wind * bendK;', `${KEEP_CARD} vec2 bend = wind * bendK; vec3 pr = scenePress(root.xz); bend += pr.xy * pr.z * 1.4; h *= 1.0 - 0.82 * pr.z;`);
    else vs = vs.replace('float h = aInfo.x;', `${KEEP_FLOWER} float h = aInfo.x; vec3 pr = scenePress(root.xz); bend += pr.xy * pr.z * 1.4; h *= 1.0 - 0.75 * pr.z;`);
    if (flower && flowerScale !== 1) vs = vs.replace('float size = aInfo.y * fade;', `float size = aInfo.y * fade * ${flowerScale.toFixed(3)};`);
    m.vertexShader = vs;
    Object.assign(m.uniforms, uniforms, grassQuality, { uFlowerShare: { value: flowerShare } });
    m.needsUpdate = true;
  });
  return {
    uniforms,
    press(caps) {
      uniforms.uPressN.value = Math.min(caps.length, MAXPRESS);
      caps.slice(0, MAXPRESS).forEach((c, i) => {
        uniforms.uPressA.value[i].set(c.a.x, c.a.y, c.b.x, c.b.y);
        uniforms.uPressR.value[i].set(c.r, c.strength, 0, 0);
      });
    },
  };
}

/** Placed (not nominal) instance counts of a cardgrass group. */
function placed(group: THREE.Object3D) {
  let cards = 0;
  let flowers = 0;
  let triangles = 0;
  group.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.InstancedBufferGeometry | undefined;
    if (!g?.isInstancedBufferGeometry) return;
    const n = g.instanceCount;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    triangles += n * tris;
    if (g.attributes.aInfo) flowers += n;
    else cards += n;
  });
  return { cards, flowers, triangles };
}

/** cardgrass.ts — the grass agent's recommended C1 settings. */
function cardGrass(scene: THREE.Scene, spec: SceneGrassSpec): SceneGrass {
  const grass = createCardGrass(scene, {
    uniforms: spec.u,
    terrain: { heightAt: spec.heightAt },
    area: { eye: spec.eye, yaw: spec.yaw, halfAngle: 1.15, near: 0.6, far: 85, reject: spec.reject },
    shadowField: spec.shadow,
    design: 'cross',
    density: spec.density,
    flowers: spec.flowers,
    breeze: 'gusty',
    tufts: { count: 26, near: 2.5, far: 12 },
    seed: 41,
    // Layer 1: kept out of the river's mirror (it renders layer 0 only).
    layer: 1,
  });
  grass.setLight('bright');
  // A light sprinkle across the meadow; the patches carry the colour.
  const press = makePress(grass.group, 1, 0.45);
  return {
    label: 'grass = cardgrass C1 cross (painted clump cards)',
    update: (t, dt) => grass.update(t, dt),
    press: press.press,
    stats: () => placed(grass.group),
    dispose: () => grass.dispose(),
  };
}

/**
 * Wildflower PATCHES across the meadow (ref 1's drifts): one more cardgrass
 * instance, flowers only (a handful of cards, no ground, no tufts), whose
 * flowers are kept to a seeded set of ragged elliptical patches of varied
 * size and density inside the wide shot's view. cardgrass places a fixed
 * number of flowers per set, so they crowd into the patches; its own drift
 * noise (a different phase per set) varies the mix from patch to patch.
 */
export function createFlowerPatches(scene: THREE.Scene, spec: SceneGrassSpec, o: { count: number; seed: number; flowers: FlowerKind[] }): SceneGrass {
  let state = o.seed >>> 0;
  const rnd = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  type Patch = { x: number; z: number; ax: THREE.Vector2; a: number; b: number; keep: number; phase: number };
  const patches: Patch[] = [];
  let guard = 0;
  while (patches.length < o.count && guard++ < o.count * 80) {
    // Spread over the view, 3…36 m from the eye, biased near (the far ones
    // are small on screen; ref 1's drifts crowd the foreground).
    const r = 3 + 33 * Math.pow(rnd(), 1.25);
    const ang = spec.yaw + (rnd() * 2 - 1) * 0.95;
    const x = spec.eye[0] + Math.sin(ang) * r;
    const z = spec.eye[1] - Math.cos(ang) * r;
    if (spec.reject(x, z)) continue;
    // Bigger patches further away (they read as drifts), small ones near.
    const size = (0.8 + 2.2 * rnd()) * (0.75 + r / 32);
    if (patches.some((p) => Math.hypot(p.x - x, p.z - z) < (p.a + size) * 0.9)) continue;
    const t = rnd() * Math.PI;
    patches.push({ x, z, ax: new THREE.Vector2(Math.cos(t), Math.sin(t)), a: size, b: size * (0.45 + 0.4 * rnd()), keep: 0.5 + 0.5 * rnd(), phase: rnd() * 6.28 });
  }
  const hash = (x: number, z: number) => {
    const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const inPatch = (x: number, z: number) => {
    for (const p of patches) {
      const dx = x - p.x;
      const dz = z - p.z;
      const u = (dx * p.ax.x + dz * p.ax.y) / p.a;
      const v = (-dx * p.ax.y + dz * p.ax.x) / p.b;
      if (u * u + v * v > 1.7) continue;
      const ang = Math.atan2(v, u);
      const edge = 1 + 0.2 * Math.sin(ang * 4 + p.phase) + 0.1 * Math.sin(ang * 9 + p.phase * 2);
      const d = Math.hypot(u, v) / edge;
      // Dense heart, thinning edge; each patch its own density.
      if (d < 1 && hash(x, z) < p.keep * (1 - 0.55 * d * d)) return true;
    }
    return false;
  };
  const grass = createCardGrass(scene, {
    uniforms: spec.u,
    terrain: { heightAt: spec.heightAt },
    area: { eye: spec.eye, yaw: spec.yaw, halfAngle: 1.15, near: 2.5, far: 64, reject: (x, z) => !inPatch(x, z) || spec.reject(x, z) },
    shadowField: spec.shadow,
    design: 'cross',
    density: 0.02,
    flowers: o.flowers,
    breeze: 'gusty',
    tufts: { count: 0 },
    ground: false,
    // Keep the far patches' flowers (cardgrass fades them by `far`).
    fade: [90, 140],
    seed: o.seed + 5,
    layer: 1,
  });
  grass.setLight('bright');
  const press = makePress(grass.group, 1.8);
  return {
    label: `flower patches = ${patches.length} drifts`,
    update: (t, dt) => grass.update(t, dt),
    press: press.press,
    stats: () => placed(grass.group),
    dispose: () => grass.dispose(),
  };
}

/**
 * A FLOWERBED: a second cardgrass instance whose cards and flowers are kept
 * inside one ellipse (the module places a fixed number of flowers per set,
 * so a small area makes them dense). No ground (the meadow's is under it),
 * no tufts. `eye`/`yaw` aim its fan at the bed from a viewpoint ≥ 6 m away
 * (inside 5 m of its eye cardgrass thins the cards).
 */
export function createFlowerBed(
  scene: THREE.Scene,
  spec: SceneGrassSpec,
  bed: { centre: THREE.Vector2; axis: THREE.Vector2; radii: [number, number]; eye: [number, number] },
): SceneGrass {
  const dx = bed.centre.x - bed.eye[0];
  const dz = bed.centre.y - bed.eye[1];
  const dist = Math.hypot(dx, dz);
  const across = new THREE.Vector2(-bed.axis.y, bed.axis.x);
  const inside = (x: number, z: number) => {
    const px = x - bed.centre.x;
    const pz = z - bed.centre.y;
    const a = (px * bed.axis.x + pz * bed.axis.y) / bed.radii[0];
    const b = (px * across.x + pz * across.y) / bed.radii[1];
    // A ragged painted edge, not a clean ellipse.
    const edge = 1 + 0.18 * Math.sin(Math.atan2(b, a) * 5 + 1.3) + 0.08 * Math.sin(Math.atan2(b, a) * 11);
    return a * a + b * b < edge * edge;
  };
  const reach = Math.max(...bed.radii);
  const grass = createCardGrass(scene, {
    uniforms: spec.u,
    terrain: { heightAt: spec.heightAt },
    area: {
      eye: bed.eye,
      yaw: Math.atan2(dx, -dz),
      halfAngle: Math.atan2(reach, dist) * 1.3,
      near: Math.max(5.5, dist - reach - 0.5),
      far: (dist + reach + 0.5) / 0.6,
      reject: (x, z) => !inside(x, z) || spec.reject(x, z),
    },
    shadowField: spec.shadow,
    design: 'cross',
    // Almost no extra cards: at a grazing view they would hide the heads.
    density: 0.04,
    flowers: spec.flowers,
    breeze: 'gusty',
    tufts: { count: 0 },
    ground: false,
    // cardgrass derives its fade band from the fan's far edge, which here
    // would fade the bed's flowers out at ~10 m: keep them all in.
    fade: [90, 140],
    seed: 77,
    layer: 1,
  });
  grass.setLight('bright');
  // Bigger heads than the meadow's scattered ones: the bed reads at ~12 m.
  const press = makePress(grass.group, 1.7);
  return {
    label: 'flowerbed = cardgrass flowers kept to one patch',
    update: (t, dt) => grass.update(t, dt),
    stats: () => placed(grass.group),
    press: press.press,
    dispose: () => grass.dispose(),
  };
}

/** For comparison only: grass2.ts G1 painted lime (rejected look). */
function placeholderGrass(scene: THREE.Scene, spec: SceneGrassSpec): SceneGrass {
  const fan = fanSampler(spec.eye, spec.yaw, 0.95, 0.8, 80);
  const disc = (rnd: () => number): [number, number] => {
    const r = 17 * Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    return [Math.cos(a) * r + 3, Math.sin(a) * r + 3];
  };
  const grass = createGrass2(spec.u, {
    count: Math.round(170_000 * spec.density),
    seed: 9,
    place: (rnd) => {
      const s = rnd() < 0.6 ? fan(rnd) : disc(rnd);
      return s && !spec.reject(s[0], s[1]) ? s : null;
    },
    heightAt: spec.heightAt,
    bladeHeight: [0.15, 0.38],
    flowers: { count: 1100 },
    shadow: spec.shadow,
    ground: { centre: [-4, 8], extent: 1200 },
  });
  grass.setStyle('painted');
  grass.setFlowers(spec.flowers.includes('petals') ? 'petals' : 'daisy');
  scene.add(grass.group);
  return {
    label: 'grass = grass2 G1 (the REJECTED per-blade look, ?grass2 comparison)',
    update() {},
    press() {},
    dispose() {
      scene.remove(grass.group);
      grass.dispose();
    },
  };
}

// ── the one line that picks the grass ──
const IMPL: (scene: THREE.Scene, spec: SceneGrassSpec) => SceneGrass = new URLSearchParams(location.search).has('grass2') ? placeholderGrass : cardGrass;

export function createSceneGrass(scene: THREE.Scene, spec: SceneGrassSpec): SceneGrass {
  return IMPL(scene, spec);
}

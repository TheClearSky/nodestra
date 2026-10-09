// COPIED from .claude/pages/ad/experiments/env-src/scene-guitar-stage.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * SCENE 1 — the guitar under the oak (the user's picks, 2026-10-04):
 * T1 Ghibli oak + falling leaves, gusty breeze, S3 pool + sparse spots,
 * W1 cel river with star sparkles, bright afternoon, and the dreadnought
 * (gtr-guitar.ts, natural finish) lying on its back in the sunny grass in
 * front of the shade — where ref 1's picnic blanket is.
 *
 * "Play the guitar" (2026-10-04 rework): the camera tours in UNDER the
 * shade while the guitar MOVES into it (scene-guitar-moves.ts: glide /
 * magic / slide, picked by `?v=move:<id>` or the HUD). The end frame looks
 * over the guitar: trunk + crown on the right third with falling leaves
 * against the bright meadow, a wildflower bed in the middle, the sparkling
 * river, hills and sky beyond. The guitar's shadow stamp, grass parting and
 * its own light (masked by the tree's shadow field, so it reads as shaded
 * with the odd sun spot) follow it every frame.
 *
 * The guitar wears the "hand-painted anime" look: gtr-03's hybrid material
 * (PBR lacquer gloss kept, the diffuse terminator softened into an anime
 * ramp, a warm rim) under a cool painted fill (hemisphere light) — no
 * outlines. Strings: the real-speed blur band (gtr-02 "B") at a distance,
 * the slow-motion standing wave ("A") once the tour has landed close.
 *
 * Same API shape as the app's piano stage (src/landing/stageScene.ts):
 * resize / setLive / setLiveKey / dispose, so it can move there later.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildGuitar, makeFingerer, type Guitar, type MeshRole } from '../gtr-guitar';
import { makeSky, envFromScene, SHINKAI_SKY } from '../gtr-common';
import { createWorld, type StampCapsule, type World } from './scene-world';
import { createRig, type Rig, type View } from './scene-rig';
import { heightAt } from './scene-terrain';
import { createMoteCloud } from './scene-motes';
import { createFlutter } from './scene-flutter';
import { sceneQuality, createAdaptive } from './scene-quality';
import { grassQuality } from './scene-grass';
import { MOVE_T, MOVES, REST, leaningPose, lyingPose, movePose, type MoveId, type MoveSetup, type Pose } from './scene-guitar-moves';
import { createRenderGate } from '../../renderGate';

export type InstrumentScene = {
  resize(width: number, height: number): void;
  /** Draw one frame immediately (see the implementation). */
  renderNow(): void;
  /** Live: the camera tours in to the instrument; off: back to the wide shot. */
  setLive(live: boolean): void;
  /** A key (0 = A0 … 87 = C8) pressed or released. */
  setLiveKey(key: number, down: boolean): void;
  dispose(): void;
  /** Test hooks (Playwright): stop the loop, render one frame at a time. */
  debug: {
    world: World;
    rig: Rig;
    stop(): void;
    /** One frame at time t (s), advancing the simulations by dt (default 1/60). */
    renderAt(t: number, dt?: number): void;
    tour(progress: number): void;
    /** Flyby mode: hold a back-off from tour progress `from`, `s` of the way. */
    back?(from: number, s: number): void;
    /** Sakura: force the organ's arrival `a` / departure `d` (a < 0 = off). */
    organ?(a: number, d: number): void;
  };
  /** 'random' (a move picked on every Play) or a fixed move id (the
   *  guitar's moves; the sakura organ's arrivals). */
  setMove?(id: string): void;
  /** The move that runs / ran on the current Play. */
  currentMove?(): string;
  /** The quality tier in use, for the HUD. */
  quality(): string;
};

export type SceneOptions = { reducedMotion: boolean };

/** Where the guitar starts (its body centre): in the sun in front of the
 *  pool, as before the rework. */
const NECK0 = new THREE.Vector2(-1, -0.25).normalize();
const START = { x: 1.6 + NECK0.x * 0.45, z: 11.2 + NECK0.y * 0.45 };
/** The end frame: a seated eye in the shade at the crown's outer edge,
 *  10.5 m from the trunk, looking (heading −75°, towards the sun and its
 *  glitter on the river) over the guitar: trunk on the right third, the
 *  crown's underside across the top, the flowerbed in the sunlit sliver
 *  beyond the shade, then river, hills and sky. */
const END_CAM = { x: 9.27, z: 4.93, eye: 0.9, heading: -75, pitch: -6 };
/** Slide ends leaning on the trunk: the same line of sight from 5.5 m, so
 *  the guitar + trunk are the anchor on the right third, the canopy
 *  overhead, the flowers and the river to the left. */
const SLIDE_CAM = { dist: 5.5, eye: 1.0, pitch: -3 };

/** `?eye=x,y,z&look=x,y,z&fov=n` and `?ceye=…&clook=…` (guitar frame) override the views (tuning). */
const vecParam = (name: string, fallback: THREE.Vector3) => {
  const v = new URLSearchParams(location.search).get(name)?.split(',').map(Number);
  return v && v.length === 3 && v.every(Number.isFinite) ? new THREE.Vector3(v[0], v[1], v[2]) : fallback;
};

// ── the painted-anime guitar look (copy of gtr-03's `hybrid`) ───────────

const RAMP = /* glsl */ `
  float animeRamp(float x) { return smoothstep(-0.02, 0.22, x) * (0.88 + 0.12 * smoothstep(0.3, 0.9, x)); }
`;
const MAP_DETAIL = /* glsl */ `
#ifdef USE_MAP
  vec4 texSharp = texture2D( map, vMapUv );
  vec4 texSoft = texture2D( map, vMapUv, 3.0 );
  diffuseColor *= mix( texSoft, texSharp, uDetail );
#endif
`;
const DETAIL: Partial<Record<MeshRole, number>> = { top: 0.6, back: 0.6, sides: 0.6, neck: 0.6, veneer: 0.6, fingerboard: 0.6, bridge: 0.6, pickguard: 0.7 };
const rimColor = { value: new THREE.Color(1.0, 0.86, 0.66) };

/** The tree's shade on the guitar: its sun light is masked by the shadow
 *  field (the tree's own, before the guitar's stamp) at each fragment. */
type ShadeUniforms = { tSceneField: { value: THREE.Texture }; uSceneFieldRect: { value: THREE.Vector4 }; uSceneSun: { value: THREE.Vector3 }; uSceneGround: { value: number } };
const SHADE_PARS = /* glsl */ `
uniform sampler2D tSceneField;
uniform vec4 uSceneFieldRect;
uniform vec3 uSceneSun;
uniform float uSceneGround;
varying vec3 vSceneWorld;
float sceneSunVis() {
  float above = max(vSceneWorld.y - uSceneGround, 0.0);
  vec2 xz = vSceneWorld.xz - uSceneSun.xz / max(uSceneSun.y, 0.08) * above;
  vec2 uv = (xz - uSceneFieldRect.xy) * uSceneFieldRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
  return mix(0.18, 1.0, texture2D(tSceneField, uv).r);
}
`;
/** Patch a physical shader: world position varying + sun masked by the field. */
function shadeShader(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown> }, shade: ShadeUniforms, pars?: string) {
  Object.assign(shader.uniforms, shade);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vSceneWorld;')
    .replace('#include <project_vertex>', '#include <project_vertex>\n  vSceneWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  const chunk = (pars ?? THREE.ShaderChunk.lights_physical_pars_fragment)
    .replace('vec3 irradiance = dotNL * directLight.color;', 'vec3 irradiance = dotNL * directLight.color * sceneSunVis();')
    .replace('vec3 ccIrradiance = dotNLcc * directLight.color;', 'vec3 ccIrradiance = dotNLcc * directLight.color * sceneSunVis();');
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', `${SHADE_PARS}\n${chunk}`);
}

function painted(base: THREE.Material, role: MeshRole, shade: ShadeUniforms): THREE.Material {
  if (!(base instanceof THREE.MeshStandardMaterial)) return base;
  const m = base.clone();
  const uniforms = {
    uRim: { value: 1 },
    uRimColor: rimColor,
    uDetail: { value: Math.min(1, (DETAIL[role] ?? 0.75) + 0.25) },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const pars = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      'vec3 irradiance = dotNL * directLight.color;',
      `vec3 irradiance = animeRamp( dot( geometryNormal, directLight.direction ) ) * directLight.color * sceneSunVis();
       {
         float fres = 1.0 - saturate(dot(geometryNormal, geometryViewDir));
         float rim = smoothstep(0.55, 0.9, fres) * smoothstep(-0.15, 0.25, dot(geometryNormal, directLight.direction));
         reflectedLight.directDiffuse += directLight.color * rim * uRim * 0.25 * uRimColor * sceneSunVis();
       }`,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', MAP_DETAIL)
      .replace('#include <common>', `#include <common>\nuniform float uDetail;\nuniform float uRim;\nuniform vec3 uRimColor;\n${RAMP}`);
    shadeShader(shader, shade, pars);
  };
  m.customProgramCacheKey = () => `scene-painted-${(base as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial ? 'p' : 's'}`;
  return m;
}

export function createGuitarScene(canvas: HTMLCanvasElement, options: SceneOptions): InstrumentScene {
  const params = new URLSearchParams(location.search);

  // ── the end frame (camera) and the guitar's poses ──
  const h = THREE.MathUtils.degToRad(END_CAM.heading);
  const dir = new THREE.Vector2(Math.sin(h), -Math.cos(h)); // xz, heading 0 = −z
  const camEye = new THREE.Vector3(END_CAM.x, heightAt(END_CAM.x, END_CAM.z) + END_CAM.eye, END_CAM.z);
  const pitch = THREE.MathUtils.degToRad(END_CAM.pitch);
  const camLook = camEye.clone().add(new THREE.Vector3(dir.x * Math.cos(pitch), Math.sin(pitch), dir.y * Math.cos(pitch)).multiplyScalar(12));
  // The guitar lies 2.8 m in front of that eye (clear of the key overlay),
  // its neck turned 34° left: a leading line towards the flowers and river.
  const left = new THREE.Vector2(dir.y, -dir.x);
  const endXZ = new THREE.Vector2(END_CAM.x, END_CAM.z).addScaledVector(dir, 2.8).addScaledVector(left, 0.25);
  const endNeck = dir.clone().multiplyScalar(Math.cos(0.6)).addScaledVector(left, Math.sin(0.6));
  // Leaning on the trunk's side that faces the end camera.
  const towardsCam = new THREE.Vector2(END_CAM.x, END_CAM.z).normalize();
  const setup: MoveSetup = {
    start: lyingPose(heightAt, START.x, START.z, NECK0),
    end: lyingPose(heightAt, endXZ.x, endXZ.y, endNeck),
    lean: leaningPose(heightAt, towardsCam.clone().multiplyScalar(1.12), towardsCam),
    preLean: lyingPose(heightAt, towardsCam.x * 1.55, towardsCam.y * 1.55, towardsCam.clone().negate()),
    heightAt,
  };
  // A random move on every Play, out of all three, WEIGHTED (2026-10-05,
  // Deepak: "guitar only ever does slide and lean animation in the demo,
  // make magic more likely (50%), and glide (30%) and slide and lean 20%");
  // `?v=move:<id>` fixes one (testing), as does the HUD.
  const WEIGHTS: readonly (readonly [MoveId, number])[] = [
    ['magic', 0.5],
    ['glide', 0.3],
    ['slide', 0.2],
  ];
  const randomMove = (): MoveId => {
    let r = Math.random();
    for (const [id, weight] of WEIGHTS) {
      r -= weight;
      if (r < 0) return id;
    }
    return WEIGHTS[0][0];
  };
  let forcedMove: MoveId | null = (() => {
    const v = (params.get('v') ?? '').split(',').find((p) => p.startsWith('move:'))?.slice(5);
    return MOVES.some((m) => m.id === v) ? (v as MoveId) : null;
  })();
  const pickMove = (): MoveId => forcedMove ?? randomMove();
  let move: MoveId = pickMove();
  // The move in play, on the canvas — tests and devtools read it there.
  const showMove = () => {
    canvas.dataset.move = move;
  };
  showMove();

  // ── the guitar: holder origin = body centre on the soundboard plane ──
  const holder = new THREE.Group();
  const guitar: Guitar = buildGuitar('dreadnought', { finish: 'natural' });
  guitar.group.rotation.x = -Math.PI / 2;
  guitar.group.position.z = 0.45;
  holder.add(guitar.group);
  const pose: Pose = { pos: setup.start.pos.clone(), quat: setup.start.quat.clone() };
  const applyPose = () => {
    holder.position.copy(pose.pos);
    holder.quaternion.copy(pose.quat);
    holder.updateMatrixWorld(true);
  };
  applyPose();
  const local = (x: number, y: number, z: number) => guitar.group.localToWorld(new THREE.Vector3(x, y, z));

  // Footprint capsules (guitar frame: x across, y tail → head, z up off the top).
  const FOOT: { a: [number, number]; b: [number, number]; r: number }[] = [
    { a: [0, 0.12], b: [0, 0.2], r: 0.19 },
    { a: [0, 0.2], b: [0, 0.36], r: 0.142 },
    { a: [0, 0.36], b: [0, 0.44], r: 0.138 },
    { a: [0, 0.5], b: [0, 0.87], r: 0.03 },
    { a: [0, 0.9], b: [0, 1.04], r: 0.045 },
  ];
  /** World capsules of the current pose (the top's centre line, raised to
   *  the body's middle; heights above the ground at each end). */
  const footprint = (): StampCapsule[] =>
    FOOT.map((f) => {
      const a = local(f.a[0], f.a[1], -0.06);
      const b = local(f.b[0], f.b[1], -0.06);
      return {
        a: new THREE.Vector2(a.x, a.z),
        b: new THREE.Vector2(b.x, b.z),
        r: f.r,
        ha: Math.max(0, a.y - heightAt(a.x, a.z)) + 0.06,
        hb: Math.max(0, b.y - heightAt(b.x, b.z)) + 0.06,
      };
    });
  const startCaps = footprint();
  // The grass is never cut: it parts round the guitar (and round the
  // camera's seat as it lands) in the shader, every frame.
  // ── views ──
  const wide: View = {
    eye: vecParam('eye', new THREE.Vector3(4.5, heightAt(4.5, 22) + 3.9, 22)),
    look: vecParam('look', new THREE.Vector3(-3.95, 3.9, 0)),
    fov: Number(params.get('fov') ?? 52),
  };
  const close: View = { eye: vecParam('ceye', camEye), look: vecParam('clook', camLook), fov: Number(params.get('cfov') ?? 56) };
  const slideXZ = new THREE.Vector2(END_CAM.x, END_CAM.z).normalize().multiplyScalar(SLIDE_CAM.dist);
  const slideEye = new THREE.Vector3(slideXZ.x, heightAt(slideXZ.x, slideXZ.y) + SLIDE_CAM.eye, slideXZ.y);
  const sp = THREE.MathUtils.degToRad(SLIDE_CAM.pitch);
  const closeSlide: View = {
    eye: slideEye,
    look: slideEye.clone().add(new THREE.Vector3(dir.x * Math.cos(sp), Math.sin(sp), dir.y * Math.cos(sp)).multiplyScalar(10)),
    fov: 56,
  };
  const closeFor = (id: MoveId) => (id === 'slide' && !params.has('ceye') ? closeSlide : close);

  // The flowerbed: in the sun at the shade's edge, between the guitar and
  // the river, in the middle of the end frame.
  const bedCentre = new THREE.Vector2(END_CAM.x, END_CAM.z).addScaledVector(dir, 12.5).addScaledVector(left, 1.2);
  const quality = sceneQuality();
  const tier = quality.params;
  const world = createWorld({
    canvas,
    quality: tier,
    patches: { count: 44, seed: 17, flowers: ['daisy', 'tiny'] },
    tree: 'oak',
    flowers: ['daisy', 'tiny'],
    wideEye: wide.eye,
    wideLook: wide.look,
    flowerBed: { centre: bedCentre, axis: dir.clone(), radii: [2.8, 5.4], eye: [END_CAM.x, END_CAM.z], flowers: ['daisy', 'tiny'] },
  });
  const { renderer, scene, camera } = world;
  // The stamp must cover the whole path (start, ends, the arcs' reach).
  const cover = { min: new THREE.Vector2(Infinity, Infinity), max: new THREE.Vector2(-Infinity, -Infinity) };
  for (const p of [setup.start.pos, setup.end.pos, setup.lean.pos, setup.preLean.pos]) {
    cover.min.min(new THREE.Vector2(p.x - 3.5, p.z - 3.5));
    cover.max.max(new THREE.Vector2(p.x + 3.5, p.z + 3.5));
  }
  world.setStamps(startCaps, cover);
  world.mirror.hide.push(holder);
  scene.add(holder);

  // ── the guitar's lights: sun (tight shadow map following the guitar:
  //    the strings' shadows on the top), cool painted fill, sky reflections ──
  const sunDir = world.u.uSunDir.value.clone();
  const sun = new THREE.DirectionalLight(new THREE.Color('#fff4dc'), 2.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -0.75;
  sc.right = sc.top = 0.75;
  sc.near = 2.5;
  sc.far = 5.5;
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.004;
  const placeSun = () => {
    sun.target.position.copy(holder.position);
    sun.position.copy(holder.position).addScaledVector(sunDir, 4);
    sun.target.updateMatrixWorld();
  };
  placeSun();
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xb4ccff, 0x6f8a44, 1.05));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const envScene = new THREE.Scene();
  envScene.add(makeSky({ ...SHINKAI_SKY, zenith: new THREE.Color(0x0d4fb8), horizon: new THREE.Color(0xb2dcec) }, sunDir, 0.3).mesh);
  const environment = envFromScene(renderer, envScene, 0.05);
  scene.environment = environment;
  scene.environmentIntensity = 0.7;
  // Lighter textures: gtr-guitar paints 2048-px canvases for close-up
  // inspection; half that is plenty here (the iGPU shares system memory).
  const slimmed = new Set<THREE.Texture>();
  for (const part of guitar.parts) {
    const m = part.mesh.material as THREE.MeshStandardMaterial;
    for (const t of [m.map, m.bumpMap]) {
      if (!t || slimmed.has(t)) continue;
      slimmed.add(t);
      const img = t.image as HTMLCanvasElement | undefined;
      t.anisotropy = 4;
      if (!img || !(img instanceof HTMLCanvasElement)) continue;
      const k = 1024 / Math.max(img.width, img.height);
      if (k >= 1) continue;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      const g = c.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, c.width, c.height);
      t.image = c;
      t.needsUpdate = true;
    }
  }
  const shade: ShadeUniforms = {
    tSceneField: { value: world.field.texture },
    uSceneFieldRect: { value: world.field.rect },
    uSceneSun: { value: sunDir },
    uSceneGround: { value: heightAt(pose.pos.x, pose.pos.z) },
  };
  const paintedCache = new Map<THREE.Material, THREE.Material>();
  for (const part of guitar.parts) {
    const base = part.mesh.material as THREE.Material;
    if (part.role === 'string') {
      // Keeps its motion shader; the sun on it is masked by the shade too.
      const prev = base.onBeforeCompile.bind(base);
      base.onBeforeCompile = (shader, r) => {
        prev(shader, r);
        shadeShader(shader, shade);
      };
      const key = base.customProgramCacheKey.bind(base);
      base.customProgramCacheKey = () => `${key()}-shade`;
      base.needsUpdate = true;
      continue;
    }
    if (!paintedCache.has(base)) paintedCache.set(base, painted(base, part.role, shade));
    part.mesh.material = paintedCache.get(base)!;
  }
  // Fewer draw calls: static parts sharing a material are merged (94 → 47).
  {
    guitar.group.updateMatrixWorld(true);
    const inv = guitar.group.matrixWorld.clone().invert();
    const byMaterial = new Map<THREE.Material, THREE.Mesh[]>();
    for (const part of guitar.parts) {
      if (part.role === 'string') continue;
      const mat = part.mesh.material as THREE.Material;
      if (!byMaterial.has(mat)) byMaterial.set(mat, []);
      byMaterial.get(mat)!.push(part.mesh);
    }
    for (const [mat, meshes] of byMaterial) {
      if (meshes.length < 2) continue;
      const geos = meshes.map((m) => m.geometry.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld)));
      const sig = (g: THREE.BufferGeometry) => `${g.index ? 'i' : 'n'}|${Object.keys(g.attributes).sort().join(',')}|${Object.keys(g.morphAttributes).length}`;
      const merged = geos.every((g) => sig(g) === sig(geos[0])) ? mergeGeometries(geos) : null;
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.role = meshes[0].userData.role;
      guitar.group.add(mesh);
      for (const m of meshes) m.visible = false;
    }
  }

  // ── gold motes at the pluck (gtr-02), pluck flashes, fret glows ──
  const MOTES = 260;
  const cloud = createMoteCloud(MOTES, { color: new THREE.Color(3.2, 2.4, 1.3), pixelRatio: world.pixelRatio });
  const moteVel = new Float32Array(MOTES * 3);
  const moteLife = new Float32Array(MOTES);
  const moteMax = new Float32Array(MOTES).fill(1);
  scene.add(cloud.mesh);
  let nextMote = 0;
  const soundboardUp = new THREE.Vector3();
  const emit = (at: THREE.Vector3, count: number) => {
    soundboardUp.set(0, 1, 0).applyQuaternion(holder.quaternion);
    for (let k = 0; k < count; k++) {
      const i = nextMote;
      nextMote = (nextMote + 1) % MOTES;
      const rise = 0.04 + Math.random() * 0.08;
      cloud.position.set([at.x + (Math.random() - 0.5) * 0.02, at.y + 0.003, at.z + (Math.random() - 0.5) * 0.03], i * 3);
      moteVel.set([(Math.random() - 0.5) * 0.05 + soundboardUp.x * rise, soundboardUp.y * rise, (Math.random() - 0.5) * 0.05 + soundboardUp.z * rise], i * 3);
      moteMax[i] = moteLife[i] = 1.2 + Math.random() * 1.3;
      cloud.size[i] = 3 + Math.random() * 6;
    }
  };
  // World-sized motes for the moves (the magic ring, landing sparkle).
  const MAGIC = 500;
  const magic = createMoteCloud(MAGIC, { color: new THREE.Color(3.6, 2.8, 1.5), pixelRatio: world.pixelRatio, scale: 70, minPx: 1.8 });
  const magicVel = new Float32Array(MAGIC * 3);
  const magicLife = new Float32Array(MAGIC);
  const magicMax = new Float32Array(MAGIC).fill(1);
  const magicBase = new Float32Array(MAGIC);
  scene.add(magic.mesh);
  let nextMagic = 0;
  const emitMagic = (at: THREE.Vector3, vel: THREE.Vector3, life: number, size: number) => {
    const i = nextMagic;
    nextMagic = (nextMagic + 1) % MAGIC;
    magic.position.set([at.x, at.y, at.z], i * 3);
    magicVel.set([vel.x, vel.y, vel.z], i * 3);
    magicMax[i] = magicLife[i] = life;
    magicBase[i] = size;
  };
  const leaves = createFlutter(world.u, { count: 220, colorA: '#7fb43a', colorB: '#c9d65a', size: 0.055, groundAt: heightAt });
  scene.add(leaves.mesh);
  world.mirror.hide.push(cloud.mesh, magic.mesh, leaves.mesh);

  const glowTexture = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,226,170,0.6)');
    grad.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const touchMat = new THREE.SpriteMaterial({ map: glowTexture, color: new THREE.Color(2.2, 1.8, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const sprite = () => {
    const s = new THREE.Sprite(touchMat.clone());
    s.visible = false;
    s.renderOrder = 51;
    scene.add(s);
    return s;
  };
  const touches = Array.from({ length: 6 }, () => ({ sprite: sprite(), until: 0, born: 0 }));
  for (const t of touches) t.sprite.scale.setScalar(0.012);
  const flashes = Array.from({ length: 6 }, () => ({ sprite: sprite(), born: -10 }));
  const landGlow = { sprite: sprite(), born: -10 };
  (landGlow.sprite.material as THREE.SpriteMaterial).color.setRGB(1.6, 1.3, 0.8);

  // ── playing ──
  const clock = { t: 0 };
  const fingerer = makeFingerer(guitar.spec.frets);
  const heldKeys = new Map<number, number>(); // stage key → string
  const play = (string: number, fret: number) => {
    guitar.pluck(string, fret, 1, clock.t);
    const s = guitar.strings[string];
    const at = guitar.group.localToWorld(s.pluckAt.clone());
    emit(at, Math.max(4, Math.round(14 * tier.particles)));
    const f = flashes[string];
    f.sprite.position.copy(at);
    f.born = clock.t;
    f.sprite.visible = true;
    const touch = touches[string];
    if (fret > 0) {
      const lay = guitar.layout;
      const y = lay.fretY(fret) + (lay.fretY(fret - 1) - lay.fretY(fret)) * 0.35;
      const u = (y - lay.saddleY) / (lay.nutY - lay.saddleY);
      touch.sprite.position.copy(local(lay.stringX(string, u), y, lay.fretTop + 0.002));
      touch.sprite.visible = true;
      touch.born = clock.t;
      touch.until = Infinity;
    } else touch.sprite.visible = false;
    renderer.shadowMap.needsUpdate = true;
  };
  const lift = (string: number) => {
    guitar.release(string, clock.t, true);
    touches[string].until = clock.t + 0.08;
  };

  // ── camera ──
  const rig = createRig(canvas, camera, {
    wide,
    close: closeFor(move),
    bends: [[0.12, -0.12], [0.62, -0.14]],
    seconds: 7,
    dollyShare: 0.9,
    reducedMotion: options.reducedMotion,
    groundAt: heightAt,
    clearance: [1.2, 0.55],
  });

  // ── the move, driven by the tour's progress ──
  let lastU = -1;
  let fxClock = 0;
  const prevPos = new THREE.Vector3().copy(pose.pos);
  const travel = new THREE.Vector3();
  const seat = new THREE.Vector2();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const updateMove = (u: number, t: number, dt: number) => {
    if (u === lastU) return;
    const forward = u > lastU && lastU >= 0;
    const wasU = lastU;
    lastU = u;
    movePose(move, u, setup, pose);
    applyPose();
    placeSun();
    renderer.shadowMap.needsUpdate = true;
    const caps = footprint();
    world.setStamps(caps);
    shade.uSceneGround.value = heightAt(pose.pos.x, pose.pos.z);
    const ground = heightAt(pose.pos.x, pose.pos.z);
    const lifted = Math.max(0, pose.pos.y - ground - REST);
    // The grass parts under it: flat where it lies, wider while hovering low.
    const strength = move === 'slide' ? 1 : 1 - THREE.MathUtils.smoothstep(lifted, 0.35, 1.1);
    seat.set(camera.position.x, camera.position.z);
    const widen = 0.06 + Math.min(lifted, 0.6) * 0.5;
    const press = [
      // body (lower → upper bout) and neck + head
      { a: caps[0].a, b: caps[2].b, r: 0.2 + widen, strength },
      { a: caps[3].a, b: caps[4].b, r: 0.05 + widen, strength },
      // the camera's seat once it is low (no cards in the lens)
      { a: seat, b: seat, r: 0.55, strength: 1 - THREE.MathUtils.smoothstep(camera.position.y - heightAt(camera.position.x, camera.position.z), 1.3, 2.2) },
    ];
    world.grass.press(press);
    world.bed?.press(press);
    world.patches?.press(press);

    travel.subVectors(pose.pos, prevPos);
    const speed = dt > 0 ? travel.length() / dt : 0;
    if (travel.lengthSq() > 1e-8) travel.normalize();
    prevPos.copy(pose.pos);
    if (!forward) return;
    fxClock += dt;
    const flying = u > MOVE_T.begin && u < MOVE_T.land;
    if (move === 'glide' && flying && fxClock > 0.07 && speed > 0.3) {
      fxClock = 0;
      // A few leaves swirl in its wake.
      tmp.copy(pose.pos).addScaledVector(travel, -0.55).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.15, (Math.random() - 0.5) * 0.4));
      tmp2.set(-travel.x * 0.8 + (Math.random() - 0.5), 0.6 + Math.random() * 0.5, -travel.z * 0.8 + (Math.random() - 0.5));
      leaves.emit(tmp, tmp2);
    }
    if (move === 'magic' && lifted > 0.08) {
      // The ring: gold motes (and the odd leaf) circling it.
      for (let k = 0; k < (tier.particles < 0.7 ? 2 : 3); k++) {
        const ang = t * 3.2 + (k / 3) * Math.PI * 2 + Math.random() * 0.3;
        tmp.set(Math.cos(ang) * 0.8, -0.1 + Math.random() * 0.25, Math.sin(ang) * 0.8).add(pose.pos);
        tmp2.set(-Math.sin(ang) * 1.3, 0.15 + Math.random() * 0.2, Math.cos(ang) * 1.3);
        emitMagic(tmp, tmp2, 0.9 + Math.random() * 0.5, 0.5 + Math.random() * 0.6);
      }
      if (fxClock > 0.12) {
        fxClock = 0;
        const ang = t * 3.2 + Math.random() * 6.28;
        tmp.set(Math.cos(ang) * 0.85, 0.1, Math.sin(ang) * 0.85).add(pose.pos);
        tmp2.set(-Math.sin(ang) * 1.6, 0.9, Math.cos(ang) * 1.6);
        leaves.emit(tmp, tmp2, 2.2);
      }
    }
    if (move === 'slide' && flying && fxClock > 0.09 && speed > 0.4) {
      fxClock = 0;
      tmp.copy(pose.pos).addScaledVector(travel, -0.5).setY(ground + 0.15);
      tmp2.set((Math.random() - 0.5) * 1.2, 1.0 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2);
      leaves.emit(tmp, tmp2, 1.8);
    }
    // Landing: a soft glow + a puff of motes and leaves.
    if (wasU < MOVE_T.land && u >= MOVE_T.land) {
      landGlow.born = t;
      landGlow.sprite.visible = move === 'magic';
      landGlow.sprite.position.copy(pose.pos);
      const n = Math.round((move === 'magic' ? 60 : 18) * tier.particles);
      for (let k = 0; k < n; k++) {
        const ang = Math.random() * Math.PI * 2;
        tmp.set(Math.cos(ang) * 0.5, 0.05, Math.sin(ang) * 0.5).add(pose.pos);
        tmp2.set(Math.cos(ang) * (0.5 + Math.random()), 0.3 + Math.random() * 0.6, Math.sin(ang) * (0.5 + Math.random()));
        emitMagic(tmp, tmp2, 1.2 + Math.random(), 0.4 + Math.random() * 0.6);
      }
      for (let k = 0; k < 6; k++) {
        const ang = Math.random() * Math.PI * 2;
        tmp.set(Math.cos(ang) * 0.6, 0.2, Math.sin(ang) * 0.6).add(pose.pos);
        leaves.emit(tmp, tmp2.set(Math.cos(ang) * 0.8, 1.0, Math.sin(ang) * 0.8), 2.0);
      }
    }
  };

  let stringMode: 0 | 1 = 1;
  guitar.setStringMode(1);
  const step = (t: number, dt: number) => {
    clock.t = t;
    rig.update(t);
    const u = rig.progress();
    updateMove(u, t, dt);
    // B (blur band) while it travels and from afar, A (slow-motion standing
    // wave) once it has landed and the camera has nearly settled.
    const want = u > MOVE_T.settle + 0.01 ? 0 : 1;
    if (want !== stringMode) {
      stringMode = want;
      guitar.setStringMode(want);
      renderer.shadowMap.needsUpdate = true;
    }
    guitar.update(t);
    if (stringMode === 0 && guitar.strings.some((s) => s.uniforms.uAmp.value > 0 && t - s.uniforms.uPluckT.value < 5 && s.uniforms.uDamp.value > 0)) {
      renderer.shadowMap.needsUpdate = true;
    }
    for (let i = 0; i < MOTES; i++) {
      if (moteLife[i] <= 0) {
        cloud.alpha[i] = 0;
        continue;
      }
      moteLife[i] -= dt;
      const k = i * 3;
      cloud.position[k] += (moteVel[k] + Math.sin(t * 1.7 + i) * 0.01) * dt;
      cloud.position[k + 1] += moteVel[k + 1] * dt;
      cloud.position[k + 2] += (moteVel[k + 2] + Math.cos(t * 1.3 + i) * 0.01) * dt;
      moteVel[k + 1] *= 0.995;
      const age = 1 - moteLife[i] / moteMax[i];
      cloud.alpha[i] = Math.sin(Math.PI * Math.min(1, age * 1.4)) * (0.6 + 0.4 * Math.sin(t * 9 + i));
    }
    cloud.commit();
    for (let i = 0; i < MAGIC; i++) {
      if (magicLife[i] <= 0) {
        magic.alpha[i] = 0;
        continue;
      }
      magicLife[i] -= dt;
      const k = i * 3;
      magic.position[k] += magicVel[k] * dt;
      magic.position[k + 1] += magicVel[k + 1] * dt;
      magic.position[k + 2] += magicVel[k + 2] * dt;
      magicVel[k] *= 0.97;
      magicVel[k + 2] *= 0.97;
      const age = 1 - magicLife[i] / magicMax[i];
      magic.alpha[i] = Math.sin(Math.PI * Math.min(1, age * 1.2)) * (0.7 + 0.3 * Math.sin(t * 11 + i));
      magic.size[i] = magicBase[i];
    }
    magic.commit();
    leaves.update(t, dt);
    for (const f of flashes) {
      const a = t - f.born;
      f.sprite.visible = a < 0.3;
      f.sprite.scale.setScalar(0.004 + a * 0.03);
      (f.sprite.material as THREE.SpriteMaterial).opacity = 0.35 * Math.max(0, 1 - a / 0.3) ** 2;
    }
    {
      const a = t - landGlow.born;
      if (landGlow.sprite.visible && a > 0.9) landGlow.sprite.visible = false;
      landGlow.sprite.scale.setScalar(0.4 + a * 2.6);
      (landGlow.sprite.material as THREE.SpriteMaterial).opacity = 0.55 * Math.max(0, 1 - a / 0.9) ** 2;
    }
    for (const touch of touches) {
      if (!touch.sprite.visible) continue;
      const fade = t > touch.until ? Math.max(0, 1 - (t - touch.until) / 0.15) : 1;
      (touch.sprite.material as THREE.SpriteMaterial).opacity = fade * (0.5 + 0.1 * Math.sin((t - touch.born) * 10));
      if (fade <= 0) touch.sprite.visible = false;
    }
    world.render(t, dt);
  };

  // Particles: the oak's falling leaves scale with the tier.
  {
    const g = world.tree.falling.geometry as THREE.InstancedBufferGeometry;
    g.instanceCount = Math.max(8, Math.round(g.instanceCount * tier.particles));
  }
  const adaptive = createAdaptive(
    (r) => {
      grassQuality.uSceneKeep.value = r.grassKeep;
      grassQuality.uSceneFlowers.value = tier.flowers * r.flowerKeep;
      world.setPixelScale(r.prScale);
      world.setMaxSamples(r.maxSamples);
    },
    { enabled: !quality.guess.forced && !options.reducedMotion && !params.has('noadapt') },
  );

  let previous = performance.now();
  /** The scene's own clock (s): it advances only while frames are drawn, so
   *  a scene stopped by its render gate carries on where it stopped. */
  let elapsed = 0;
  const MIN_FRAME_MS = 1000 / 61;
  const frame = () => {
    const now = performance.now();
    if (now - previous < MIN_FRAME_MS) return;
    // Real elapsed time (capped at 0.25 s): a stalled GPU slows the frame
    // rate, not the leaves, motes and moves.
    const dt = Math.min(0.25, (now - previous) / 1000);
    previous = now;
    elapsed += dt;
    adaptive.frame(now);
    step(elapsed, dt);
  };
  // Reduced motion: one still frame whenever something changes.
  const still = () => step(clock.t || 2.0, 0);
  rig.onStill(still);
  // The loop runs only while the render gate is open: tab visible and the
  // canvas in the screen's view (src/landing/renderGate.ts; the debug
  // `stop()` closes it as the owner). Reopening restarts the frame clock one
  // frame back, so the scene carries on where it stopped.
  let looping = false;
  const syncLoop = () => {
    const run = !options.reducedMotion && gate.isOpen();
    if (run === looping) return;
    looping = run;
    if (run) previous = performance.now() - 1000 / 60;
    renderer.setAnimationLoop(run ? frame : null);
  };
  const gate = createRenderGate(canvas, syncLoop);
  syncLoop();

  return {
    resize(width, height) {
      world.resize(width, height);
      if (options.reducedMotion) still();
    },
    /** Draw one frame now, outside the loop's frame cap. The landing calls
     *  it after `resize`, behind its black: a fresh or resized canvas is
     *  transparent, and on a 120/144 Hz screen the cap skips the loop's
     *  first frames, so "two frames later" could still be an empty canvas
     *  (the piano stage showed through it). This frame also compiles every
     *  shader, behind the black rather than after it lifts. */
    renderNow() {
      if (options.reducedMotion) {
        still();
        return;
      }
      step(elapsed, 0);
      previous = performance.now();
    },
    setLive(live) {
      // A new move on every Play — only from the sunny start (a Play during
      // the way back keeps the move it is undoing).
      if (live && rig.progress() < 0.02) {
        const next = pickMove();
        if (next !== move) {
          move = next;
          rig.setClose(closeFor(move));
          lastU = -1;
        }
        showMove();
      }
      rig.setLive(live);
      if (options.reducedMotion) still();
    },
    setLiveKey(key, down) {
      if (key < 0 || key > 87) return;
      if (down) {
        if (heldKeys.has(key)) return;
        const fing = fingerer(key + 21, new Set(heldKeys.values()));
        if (!fing) return;
        heldKeys.set(key, fing.string);
        play(fing.string, fing.fret);
      } else {
        const s = heldKeys.get(key);
        if (s === undefined) return;
        heldKeys.delete(key);
        if (![...heldKeys.values()].includes(s)) lift(s);
      }
      if (options.reducedMotion) still();
    },
    setMove(id) {
      if (id === 'random') {
        forcedMove = null;
        return;
      }
      if (!MOVES.some((m) => m.id === id)) return;
      forcedMove = id as MoveId;
      move = forcedMove;
      showMove();
      rig.setClose(closeFor(move));
      lastU = -1; // re-pose at the current progress
      if (options.reducedMotion) still();
    },
    currentMove: () => `${MOVES.find((m) => m.id === move)?.label ?? move}${forcedMove ? '' : ' (random)'}`,
    quality: () => `${tier.tier}${adaptive.label()}`,
    dispose() {
      gate.dispose();
      renderer.setAnimationLoop(null);
      rig.dispose();
      guitar.dispose();
      cloud.dispose();
      magic.dispose();
      leaves.dispose();
      glowTexture.dispose();
      environment.dispose();
      sun.shadow.map?.dispose();
      world.dispose();
    },
    debug: {
      world,
      rig,
      stop: () => gate.setPaused(true),
      renderAt: (t, dt = 1 / 60) => step(t, dt),
      tour: (p) => rig.debugSet(p),
    },
  };
}

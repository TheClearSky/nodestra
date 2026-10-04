// COPIED from .claude/pages/ad/experiments/env-src/scene-world.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * The shared meadow world of the two instrument scenes (ref 1's
 * composition): bright afternoon sky + painted cumulus + hazy hills, one
 * big tree on the slope, the S3 "pool + sparse spots" shadow field, the W1
 * cel river with star sparkles on the left, and the meadow grass (through
 * the scene-grass adapter).
 *
 * The grade is the "hand-painted anime" pick: Khronos Neutral tone mapping,
 * a light bloom (only true highlights: sparkles, glints, motes), and a soft
 * painterly grade (cool shadows, faintly warm lights). No outlines, no
 * flare, no halation, no grain.
 *
 * Optional SHADOW STAMPS: an object lying in the grass (the guitar) needs
 * its own soft shadow ON the blades. The tree's shadow field is a texture
 * the grass samples; each frame it is copied into a slightly larger target
 * with the object's footprint shadow (capsules, offset along the sun) and a
 * contact AO stamped in, and the grass is pointed at the copy.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { makeEnvUniforms } from './lab';
import { BRIGHT, createHillsV2, defaultHillsV2, type KitUniforms } from './v2kit';
import { createCumulus, createSkyDome, defaultClouds } from './sky';
import { createShadowField, type ShadowField } from './shadow';
import { createOak, type PaintedTree } from './tree2';
import { createSakura } from './sakura';
import { createMirror, type Mirror } from './water2';
import type { Env2 } from './v2-kit';
import { createSceneSparkles, createSceneWater } from './scene-water';
import { createFlowerBed, createFlowerPatches, createSceneGrass, grassQuality, type SceneGrass } from './scene-grass';
import type { TierParams } from './scene-quality';
import type { FlowerKind } from './cardgrass';
import { WATER_Y, heightAt, riverDistance, riverX } from './scene-terrain';

export type SceneEnv = KitUniforms & Env2;

/** A capsule footprint in world xz (a→b, radius), `height` above the ground. */
export type StampCapsule = {
  a: THREE.Vector2;
  b: THREE.Vector2;
  r: number;
  /** Height above the ground at a and at b. */
  ha: number;
  hb: number;
  /** 0…1 contact darkening (default 1). */
  contact?: number;
};

export type WorldOptions = {
  canvas: HTMLCanvasElement;
  tree: 'oak' | 'sakura';
  flowers: FlowerKind[];
  /** The wide shot's eye and look (grass is densest in its view). */
  wideEye: THREE.Vector3;
  wideLook: THREE.Vector3;
  /** Extra places the grass must not grow (an instrument's footprint). */
  keepOut?: (x: number, z: number) => boolean;
  /** Grass density 0…1 (URL ?grass= overrides). */
  density?: number;
  /** Quality tier (scene-quality.ts). */
  quality: TierParams;
  /** Wildflower drifts across the meadow. */
  patches?: { count: number; seed: number; flowers: FlowerKind[] };
  /** A dense wildflower patch (cardgrass flowers kept to one ellipse). */
  flowerBed?: { centre: THREE.Vector2; axis: THREE.Vector2; radii: [number, number]; eye: [number, number]; flowers: FlowerKind[] };
};

export type World = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  u: SceneEnv;
  tree: PaintedTree;
  shadow: ShadowField;
  grass: SceneGrass;
  bed: SceneGrass | null;
  patches: SceneGrass | null;
  /** Runtime quality: scale the pixel ratio (≤ 1 of the tier's cap). */
  setPixelScale(scale: number): void;
  /** Runtime quality: cap the main target's MSAA samples. */
  setMaxSamples(max: number): void;
  /** Every grass layer's instance counts (tests / report). */
  grassStats(): Record<string, unknown>;
  mirror: Mirror;
  pixelRatio: number;
  /** The objects whose shadows are stamped into the field: the first call
   *  sizes the stamp (field ∪ `cover`), later calls move the capsules. */
  setStamps(caps: StampCapsule[], cover?: { min: THREE.Vector2; max: THREE.Vector2 }): void;
  /** The tree's own field BEFORE the stamps (for lighting the stamped object). */
  field: { texture: THREE.Texture; rect: THREE.Vector4 };
  render(t: number, dt: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
};

export function createWorld(o: WorldOptions): World {
  const renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: false, powerPreference: 'high-performance' });
  const prCap = Math.min(window.devicePixelRatio || 1, o.quality.prCap);
  let pixelRatio = prCap;
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.25, 4000);
  camera.layers.enable(1); // grass2 draws its blades + ground on layer 1

  const u = Object.assign(makeEnvUniforms(BRIGHT), {
    uMist: { value: 0 },
    uMistY: { value: WATER_Y },
    uCherry: { value: 0 },
  }) as SceneEnv;
  u.uCloudShadow.value = 0.6; // v2kit's bright day
  u.uBreeze.value = 1.6; // "Gusty"

  // ── sky, clouds, hills ──
  const dome = createSkyDome(u);
  scene.add(dome.mesh);
  const clouds = createCumulus(u, defaultClouds(), o.wideEye);
  scene.add(clouds.mesh);
  scene.add(createHillsV2(u, defaultHillsV2()));
  // v2kit's hills span ±126° round −z; the sakura's flyby looks the other
  // way (towards +z), where the ring ended in a cut edge. A back arc (other
  // seeds) closes it, overlapping the front ring's ends by ~4°.
  scene.add(createHillsV2(u, defaultHillsV2().map((l) => ({ ...l, seed: l.seed + 40 })), Math.PI, Math.PI * 0.65));

  // ── the tree + its shadow field (S3) ──
  const tree = o.tree === 'oak' ? createOak(u) : createSakura(u);
  scene.add(tree.group);
  // Port of cardgrass's KEEP_ALPHA fix: the leaf / blossom cards use
  // alpha-to-coverage, which also leaves alpha < 1 in the colour buffer; the
  // canvas then composites it with the page (teal speckle in the crown, and
  // stripes where the additive S3 shafts reset alpha). Colour replaces as
  // opaque; destination alpha is never written.
  tree.group.traverse((obj) => {
    const m = (obj as THREE.Mesh).material as THREE.Material | undefined;
    if (!m || !m.alphaToCoverage) return;
    Object.assign(m, {
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.ZeroFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    m.needsUpdate = true;
  });
  // 512² (256² on the low tier): the S3 pool is soft and its spots are
  // 0.5–1 m discs (1024² cost 4× the GPU time for no visible gain here).
  // Sakura only: under the crown the bark falls to its darkest tone
  // (#0e0a0c), so twig ends showing between blossom cards read as jagged
  // BLACK holes. Lift the shade tones to a plum-grey that sits with the
  // blossom shade (#8f6e8e); the lit tone keeps the twisting limbs dark.
  if (o.tree === 'sakura') {
    tree.group.traverse((obj) => {
      const m = (obj as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (!m?.uniforms?.uDark) return;
      m.uniforms.uDark.value.set('#4a3742');
      m.uniforms.uMid.value.set('#5f4650');
    });
  }
  const shadow = createShadowField(renderer, u, o.quality.field);
  shadow.setMode('spots');
  shadow.setCanopy(tree.canopy, tree.clumps);
  scene.add(shadow.shafts);

  // ── shadow stamps (see the header) ──
  const fieldTexture = shadow.uniforms.tShadow.value;
  const fieldRect = shadow.uniforms.uShadowRect.value.clone(); // minX, minZ, 1/sx, 1/sz
  const MAXCAPS = 8;
  const capsA = Array.from({ length: MAXCAPS }, () => new THREE.Vector4());
  const capsR = Array.from({ length: MAXCAPS }, () => new THREE.Vector4());
  const capN = { value: 0 };
  let stamp: { target: THREE.WebGLRenderTarget; quad: FullScreenQuad; material: THREE.ShaderMaterial } | null = null;
  const writeCaps = (caps: StampCapsule[]) => {
    capN.value = Math.min(caps.length, MAXCAPS);
    caps.slice(0, MAXCAPS).forEach((c, i) => {
      capsA[i].set(c.a.x, c.a.y, c.b.x, c.b.y);
      capsR[i].set(c.r, c.ha, c.hb, c.contact ?? 1);
    });
  };
  /** First call: build the stamp over the field ∪ `cover` (min/max xz).
   *  Later calls only move the capsules (cheap: uniforms). */
  const setStamps = (caps: StampCapsule[], cover?: { min: THREE.Vector2; max: THREE.Vector2 }) => {
    writeCaps(caps);
    if (stamp) return;
    let minX = fieldRect.x;
    let minZ = fieldRect.y;
    let maxX = minX + 1 / fieldRect.z;
    let maxZ = minZ + 1 / fieldRect.w;
    if (cover) {
      minX = Math.min(minX, cover.min.x);
      minZ = Math.min(minZ, cover.min.y);
      maxX = Math.max(maxX, cover.max.x);
      maxZ = Math.max(maxZ, cover.max.y);
    }
    const sun = u.uSunDir.value;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tField: { value: fieldTexture },
        uField: { value: fieldRect },
        uRect: { value: new THREE.Vector4(minX, minZ, maxX - minX, maxZ - minZ) },
        uOff: { value: new THREE.Vector2(-sun.x / sun.y, -sun.z / sun.y) },
        uCaps: { value: capsA },
        uCapR: { value: capsR },
        uCapN: capN,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        #define MAXCAPS ${MAXCAPS}
        uniform sampler2D tField;
        uniform vec4 uField;
        uniform vec4 uRect;
        uniform vec2 uOff;
        uniform vec4 uCaps[MAXCAPS];
        uniform vec4 uCapR[MAXCAPS]; // radius, height at a, height at b, contact
        uniform int uCapN;
        varying vec2 vUv;
        float capsule(vec2 p, vec2 a, vec2 b, float r) {
          vec2 pa = p - a;
          vec2 ba = b - a;
          float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
          return length(pa - ba * h) - r;
        }
        void main() {
          vec2 xz = uRect.xy + vUv * uRect.zw;
          vec2 fuv = (xz - uField.xy) * uField.zw;
          vec3 f = (fuv.x < 0.0 || fuv.y < 0.0 || fuv.x > 1.0 || fuv.y > 1.0) ? vec3(1.0, 0.0, 0.0) : texture2D(tField, fuv).rgb;
          float shade = 0.0;
          float contact = 0.0;
          for (int i = 0; i < MAXCAPS; i++) {
            if (i >= uCapN) break;
            vec4 c = uCaps[i];
            vec4 rh = uCapR[i];
            // The shadow of a segment at heights (ha, hb) is the segment
            // shifted along the sun by those heights; tested at half and full
            // height so it starts at the object's base. Softer when lifted.
            float lift = min(rh.y, rh.z);
            float soft = 0.035 + 0.12 * smoothstep(0.2, 1.5, lift);
            for (int j = 0; j < 2; j++) {
              float k = j == 0 ? 0.5 : 1.0;
              float d = capsule(xz, c.xy + uOff * rh.y * k, c.zw + uOff * rh.z * k, rh.x);
              shade = max(shade, (1.0 - smoothstep(-0.015, soft, d)) * mix(1.0, 0.55, smoothstep(0.3, 2.0, lift)));
            }
            float dc = capsule(xz, c.xy, c.zw, rh.x);
            contact = max(contact, (1.0 - smoothstep(0.0, 0.22, dc)) * rh.w * (1.0 - smoothstep(0.05, 0.45, lift)));
          }
          f.r *= 1.0 - shade * 0.92;
          f.b = max(f.b, contact * 0.55);
          gl_FragColor = vec4(f, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    const target = new THREE.WebGLRenderTarget(1024, 1024, { type: THREE.UnsignedByteType, depthBuffer: false });
    target.texture.generateMipmaps = false;
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.magFilter = THREE.LinearFilter;
    stamp = { target, quad: new FullScreenQuad(material), material };
    shadow.uniforms.tShadow.value = target.texture;
    shadow.uniforms.uShadowRect.value.set(minX, minZ, 1 / (maxX - minX), 1 / (maxZ - minZ));
  };

  // ── the river (W1 cel + stars) ──
  const mirror = createMirror(renderer, scene, camera, WATER_Y, 0.4);
  const water = createSceneWater(u, mirror, 60, -460);
  const sparkles = createSceneSparkles(u, () => renderer.domElement.width, () => renderer.domElement.height);
  scene.add(water, sparkles);
  // The tree never reflects into frame (it stands 25 m from the river):
  // keep it, and anything else added with `mirrorSkip`, out of the mirror.
  mirror.hide.push(water, sparkles, shadow.shafts, tree.group);

  // ── grass (scene-grass adapter → cardgrass): fills the wide shot's view ──
  const reject = (x: number, z: number) => {
    // Grass right down to the waterline (ref 2), never in the water.
    if (riverDistance(x, z) < 9 && heightAt(x, z) < WATER_Y + 0.06) return true;
    // The far bank stays a painted plain (refs 1–2): no cards across the river.
    if (x < riverX(z) - 5) return true;
    if (Math.hypot(x, z) < 0.6) return true; // the trunk
    return o.keepOut?.(x, z) ?? false;
  };
  const density = Number(new URLSearchParams(location.search).get('grass') ?? (o.density ?? 1) * o.quality.grass);
  const grassSpec = {
    u,
    shadow: shadow.uniforms,
    heightAt,
    eye: [o.wideEye.x, o.wideEye.z] as [number, number],
    yaw: Math.atan2(o.wideLook.x - o.wideEye.x, -(o.wideLook.z - o.wideEye.z)),
    reject,
    flowers: o.flowers,
    density,
  };
  const grass = createSceneGrass(scene, grassSpec);
  const bed = o.flowerBed && !new URLSearchParams(location.search).has('grass2')
    ? createFlowerBed(scene, { ...grassSpec, flowers: o.flowerBed.flowers }, o.flowerBed)
    : null;
  const patches = o.patches && !new URLSearchParams(location.search).has('grass2') ? createFlowerPatches(scene, grassSpec, o.patches) : null;
  grassQuality.uSceneFlowers.value = o.quality.flowers;

  // ── post: render → light bloom → (painted grade + Neutral tone map +
  //    sRGB in ONE pass) ──
  // Measured on this Intel UHD at 1600×1000: the post chain alone cost
  // ~22 ms with an empty scene; the grade was its own HalfFloat full-screen
  // pass. It now runs inside the OutputPass's shader (same maths, before the
  // tone map, as before), and bloom runs at the tier's resolution (half on
  // medium, off on low — its threshold is 0.98: only glints and sparkles).
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: o.quality.samples });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.14, 0.42, 0.98);
  if (o.quality.bloom > 0) {
    const setBloomSize = bloom.setSize.bind(bloom);
    bloom.setSize = (w: number, h: number) => setBloomSize(Math.max(2, Math.round(w * o.quality.bloom)), Math.max(2, Math.round(h * o.quality.bloom)));
    composer.addPass(bloom);
  }
  const output = new OutputPass();
  output.material.fragmentShader = output.material.fragmentShader.replace(
    'gl_FragColor = texture2D( tDiffuse, vUv );',
    `gl_FragColor = texture2D( tDiffuse, vUv );
      {
        vec3 col = gl_FragColor.rgb;
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        // Painted: shadows lean cool blue, lights faintly warm, a touch richer.
        col *= mix(vec3(0.93, 0.98, 1.07), vec3(1.0), smoothstep(0.02, 0.3, l));
        col *= mix(vec3(1.0), vec3(1.025, 1.0, 0.965), smoothstep(0.45, 1.1, l));
        col = mix(vec3(l), col, 1.06);
        gl_FragColor.rgb = max(col, 0.0);
      }`,
  );
  composer.addPass(output);

  let size = { w: 0, h: 0 };
  const resize = (width: number, height: number) => {
    if (width === 0 || height === 0) return;
    size = { w: width, h: height };
    renderer.setPixelRatio(pixelRatio);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    mirror.setSize(width * pixelRatio, height * pixelRatio);
  };

  return {
    renderer,
    scene,
    camera,
    composer,
    u,
    tree,
    shadow,
    grass,
    bed,
    patches,
    setPixelScale(scale) {
      const next = Math.max(0.5, prCap * scale);
      if (Math.abs(next - pixelRatio) < 1e-3) return;
      pixelRatio = next;
      if (size.w) resize(size.w, size.h);
    },
    setMaxSamples(max) {
      const n = Math.min(o.quality.samples, max);
      for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
        if (rt.samples === n) continue;
        rt.samples = n;
        rt.dispose(); // re-allocated with the new sample count on next use
      }
    },
    grassStats() {
      return { grass: grass.stats?.(), bed: bed?.stats?.(), patches: patches?.stats?.(), keep: { cards: grassQuality.uSceneKeep.value, flowers: grassQuality.uSceneFlowers.value } };
    },
    mirror,
    get pixelRatio() {
      return pixelRatio;
    },
    setStamps,
    field: { texture: fieldTexture, rect: fieldRect },
    resize,
    render(t, dt) {
      u.uTime.value = t;
      u.uFrame.value = (u.uFrame.value + 1) % 100000;
      grass.update(t, dt);
      bed?.update(t, dt);
      patches?.update(t, dt);
      shadow.update();
      if (stamp) {
        const previous = renderer.getRenderTarget();
        renderer.setRenderTarget(stamp.target);
        stamp.quad.render(renderer);
        renderer.setRenderTarget(previous);
      }
      mirror.update();
      composer.render(dt);
    },
    dispose() {
      grass.dispose();
      bed?.dispose();
      patches?.dispose();
      tree.dispose();
      const materials = new Set<THREE.Material>();
      scene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        if (mesh.material) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
      });
      for (const m of materials) m.dispose();
      if (stamp) {
        stamp.target.dispose();
        stamp.material.dispose();
        stamp.quad.dispose();
      }
      bloom.dispose();
      composer.dispose();
      target.dispose();
      renderer.dispose();
      // Release the GL context now, not at garbage collection: the landing
      // makes a new scene (and context) on every scene switch, and browsers
      // cap live contexts (~16; fewer on phones).
      renderer.forceContextLoss();
    },
  };
}

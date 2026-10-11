// COPIED from .claude/pages/ad/experiments/hell-src/scene/bones.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Bones: the remains of the colossal creature, mid-ground left of the pillar
 * (from hell-07-bones).
 *
 * Four of hell-07's designs, the ones its review rated strongest that work
 * from the shared camera, each a different silhouette:
 *   nave   — an arched ribcage on a crowned spine (default)
 *   whole  — the whole crouched skeleton seen side-on, skull and limbs
 *   skull  — one colossal fanged skull sunk to the jaw, glowing sockets
 *   spires — no ribs: rows of dorsal spikes of creatures buried in the sand
 * (hell-07's "inside the vault" needs its own camera; its skull field and
 * pillar-pierced designs were rated weak.)
 *
 * The look is hell-07's default for every design: toon 3-band + inverted-hull
 * ink, crack lines + base stain, faint embers. Its shaders are IMPORTED
 * read-only from hell-07-bones-shaders.ts; the design recipes are COPIED into
 * bones-designs.ts. Designs are built on first use and kept.
 */

import * as THREE from 'three';
import { makeBoneMaterial, makeBoneUniforms, makeEmberPoints, makeHullMaterial } from '../hell-07-bones-shaders';
import { BEAST_SOCKET, buildNave, buildSkull, buildSpires, buildWhole, type BoneMats, type Design } from './bones-designs';
import type { AssetFactory, AssetOption } from './contract';
import type { ScenePalette } from './palette';

/**
 * The bone colours come from the palette (bone.lit / bone.shade). hell-07's
 * bone shader has a fixed chalk albedo, a fixed ink and a rust tidemark, so
 * on OUR material instances (before their first compile) those constants are
 * swapped for uniforms. The experiment's module is untouched.
 */
const BONE_TINT_GLSL = 'uniform vec3 uBoneLit;\nuniform vec3 uBoneShade;\nuniform vec3 uTide;\n';
const BONE_SWAPS: [string, string][] = [
  // the albedo: near-neutral, the light colours it (MOODBOARD bone table)
  ['vec3 albedo = srgb(vec3(0.765, 0.784, 0.769))', 'vec3 albedo = uBoneLit'],
  // the shadow band: the palette's bone shade, tinted by the ambient (a hue, never black-red)
  ['vec3 shadowC = albedo * (uAmbient * 1.0 + uHaze * 0.9) + uFogColor * 0.12;', 'vec3 shadowC = uBoneShade * 0.8 + albedo * (uAmbient * 0.45 + uHaze * 0.2) + uFogColor * 0.05;'],
  // the sand's tidemark (was a fixed rust)
  ['col = mix(col, col * vec3(0.55, 0.32, 0.25), tide);', 'col = mix(col, col * uTide, tide);'],
];
const HULL_SWAPS: [string, string][] = [
  // ink: the bone's shade pulled toward the shadow hue (was a fixed #413637)
  ['vec3 ink = mix(srgb(vec3(0.255, 0.212, 0.216)),', 'vec3 ink = mix(uBoneShade,'],
];

function swapShader(m: THREE.ShaderMaterial, swaps: [string, string][], tint: Record<string, { value: unknown }>) {
  let fs = m.fragmentShader;
  for (const [from, to] of swaps) {
    if (!fs.includes(from)) console.error(`[bones] shader text not found, colour not swapped: ${from}`);
    fs = fs.split(from).join(to);
  }
  m.fragmentShader = BONE_TINT_GLSL + fs;
  Object.assign(m.uniforms, tint);
  m.needsUpdate = true;
  return m;
}

const OPTIONS: AssetOption[] = [
  {
    id: 'nave',
    label: 'Ribcage nave',
    description: 'A cathedral of bone: twelve flat rib bands a side arching out of the sand from a half-buried spine crowned with knobbed spikes.',
    source: 'hell-07 design:nave (ribs:barrel, material:toon, weather:stain)',
  },
  {
    id: 'whole',
    label: 'Whole skeleton',
    description: 'The entire crouched creature side-on: a long spine with a crown of curved spikes, ribcage, knuckled limbs, shoulder blades and an open-jawed skull.',
    source: 'hell-07 design:whole',
  },
  {
    id: 'skull',
    label: 'Fanged skull',
    description: 'One colossal beast skull sunk to the jaw, its sockets lit by an ember cavity, a trail of buried vertebrae behind it. A single heavy mass, no ribs.',
    source: 'hell-07 design:skull',
  },
  {
    id: 'spires',
    label: 'Spire forest',
    description: 'No ribs or skull: rows of knobbed and thorn dorsal spikes jut from the sand where whole creatures lie buried — a vertical comb of bone.',
    source: 'hell-07 design:spires (re-laid in the bones footprint)',
  },
];

type Recipe = {
  build: (mats: BoneMats) => Design;
  /** Where hell-07's camera stood, as atan2(x, z) in the design frame. */
  camAngle: number;
  /** Size in the scene (hell-07 framed each design closer than this camera). */
  scale: number;
  /** Shift in the design frame, to centre the design on LAYOUT.bones. */
  shift: [number, number];
  /** Ember glow (hell-07: 0.35 faint … 1 blazing). */
  embers: number;
};

const RECIPES: Record<string, Recipe> = {
  // hell-07 nave camera (35, 40) seen from its centre (-70, -215); a little smaller so its head stays clear of the pillar.
  nave: { build: (m) => buildNave(m, 30), camAngle: Math.atan2(105, 255), scale: 0.82, shift: [-10, 0], embers: 0.35 },
  // whole camera (10, 60), centre (-40, -240). Its spine is ~300 m long: scaled down to fit.
  whole: { build: buildWhole, camAngle: Math.atan2(50, 300), scale: 0.6, shift: [15, 0], embers: 0.35 },
  // skull camera (30, 40), centre (-45, -165); smaller: hell-07 framed it close up.
  skull: { build: buildSkull, camAngle: Math.atan2(75, 205), scale: 0.85, shift: [25, 10], embers: 0.6 },
  // laid out for this scene, camera along +Z.
  spires: { build: buildSpires, camAngle: 0, scale: 1, shift: [0, 0], embers: 0.35 },
};

export const create: AssetFactory = ({ lab, scene, camera, layout, palette }) => {
  // ── shared uniforms and materials (hell-07's, imported) ──
  const U = makeBoneUniforms();
  // The bone shader's own ground is hell-07's stand-in dune formula; make it
  // flat (groundBase = -2 everywhere): the dunes class keeps the bones' bed
  // at groundY, so the stain and contact shadow sit at the sand line.
  U.uFlat.value.set(layout.bones.x, layout.bones.z, 1e5, 2e5);
  U.uFlatAmt.value = 0;
  U.uMistAmt.value = 0;
  U.uMistY.value = layout.groundY;
  U.uSigilAmt.value = 0; // the circles class owns the sky circles
  U.uMat.value = 0; // toon 3-band + ink
  U.uCracks.value = 1;
  U.uStain.value = 1;

  // ── colour: bone.lit / bone.shade, the embers' colour, the sand's stain ──
  const tint = {
    uBoneLit: { value: new THREE.Color() },
    uBoneShade: { value: new THREE.Color() },
    uTide: { value: new THREE.Color() },
  };
  palette.subscribe((p: ScenePalette) => {
    tint.uBoneLit.value.set(p.bone.lit);
    tint.uBoneShade.value.set(p.bone.shade);
    // the tidemark: a darker band, half grey, half the sand's shade (scaled to its brightest channel)
    const s = new THREE.Color(p.sand.shade);
    const peak = Math.max(s.r, s.g, s.b, 1e-4);
    tint.uTide.value.setRGB(0.45, 0.45, 0.45).lerp(s.multiplyScalar(0.55 / peak), 0.4);
    U.uEmberCol.value.set(p.glow.embers);
  });

  const mats: BoneMats = {
    bone: swapShader(makeBoneMaterial(lab.env, U, { crackScale: 0.32 }), BONE_SWAPS, tint),
    hull: swapShader(makeHullMaterial(lab.env, U), HULL_SWAPS, tint),
    skull: () => swapShader(makeBoneMaterial(lab.env, U, { crackScale: 0.32, socket: BEAST_SOCKET, seed: 0.71 }), BONE_SWAPS, tint),
  };

  const root = new THREE.Group();
  root.name = 'bones';
  scene.add(root);

  const embers = makeEmberPoints(lab.env, U, 200);
  root.add(embers.points);

  // The scene camera looks at the bones from this side (atan2(x, z)).
  const [cx, , cz] = layout.camera.position;
  const view = Math.atan2(cx - layout.bones.x, cz - layout.bones.z);

  type Built = { wrap: THREE.Group; design: Design; emit: THREE.Vector4[] };
  const cache = new Map<string, Built>();

  function build(id: string): Built {
    const r = RECIPES[id];
    const design = r.build(mats);
    design.group.position.set(r.shift[0], 0, r.shift[1]);
    // wrap: onto LAYOUT.bones, turned so this camera sees it from hell-07's side
    const wrap = new THREE.Group();
    wrap.name = `bones-${id}`;
    wrap.position.set(layout.bones.x, layout.groundY, layout.bones.z);
    wrap.rotation.y = view - r.camAngle;
    wrap.scale.setScalar(r.scale);
    wrap.add(design.group);
    wrap.updateMatrixWorld(true);
    const emit = design.emit.slice(0, 4).map((e) => {
      const p = new THREE.Vector3(e.x, e.y, e.z).applyMatrix4(design.group.matrixWorld);
      return new THREE.Vector4(p.x, p.y, p.z, e.w * r.scale);
    });
    return { wrap, design, emit };
  }

  let current = '';
  let shown: Built | null = null;

  function setOption(id: string) {
    if (!RECIPES[id]) return;
    let b = cache.get(id);
    if (!b) {
      b = build(id);
      cache.set(id, b);
    }
    if (shown && shown !== b) root.remove(shown.wrap);
    if (shown !== b) root.add(b.wrap);
    shown = b;
    current = id;
    U.uEmberAmt.value = RECIPES[id].embers;
    embers.uniforms.uEmitN.value = Math.max(1, b.emit.length);
    b.emit.forEach((e, i) => embers.uniforms.uEmit.value[i].copy(e));
  }
  setOption(OPTIONS[0].id);

  // the ink width is in pixels
  const setSize = (w: number, h: number) => {
    U.uRes.value.set(w, h);
    U.uInkPx.value = 1.5 * lab.pixelRatio;
    embers.uniforms.uPx.value = h / 720;
  };
  setSize(innerWidth * lab.pixelRatio, innerHeight * lab.pixelRatio);
  lab.onResize(setSize);

  const camObj = new THREE.Vector3();
  const inv = new THREE.Matrix4();

  return {
    id: 'bones',
    label: 'Bones',
    options: OPTIONS,
    setOption,
    update() {
      // fog follows whatever the sky class sets
      const fog = scene.fog as THREE.FogExp2 | null;
      if (fog) {
        U.uFogColor.value.copy(fog.color);
        U.uFogDensity.value = fog.density;
      }
      // the bones' own key light (GGXrd): above and beside the grade's sun
      const s = lab.env.uSunDir.value;
      U.uBoneLight.value.set(s.x + 0.55, 0.78, s.z * 0.3 + 0.3).normalize();
      // socket cavities need the camera in each skull's object space
      if (shown) {
        for (const m of shown.design.skulls) {
          inv.copy(m.matrixWorld).invert();
          camObj.copy(camera.position).applyMatrix4(inv);
          (m.material as THREE.ShaderMaterial).uniforms.uCamObj.value.copy(camObj);
        }
      }
    },
    params() {
      const r = RECIPES[current];
      return {
        design: current,
        material: 'toon 3-band + ink',
        weathering: 'cracks + base stain',
        ribs: current === 'nave' || current === 'whole' ? 'barrel 12' : '-',
        embers: r.embers,
        scale: r.scale,
        yawDeg: Math.round(THREE.MathUtils.radToDeg(view - r.camAngle)),
      };
    },
  };
};

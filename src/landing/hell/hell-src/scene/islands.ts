// COPIED from .claude/pages/ad/experiments/hell-src/scene/islands.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Islands: the floating islands up in the sky round the pillar (from
 * hell-09-islands), one island at each LAYOUT.islands slot.
 *
 * Four looks, each a different silhouette AND a different way of staying up:
 *   tiers   — stepped clover-leaf tiers in charcoal rock, dark silhouettes
 *             with every ledge lip glowing with lava, embers shedding (default)
 *   seal    — inverted cones with hanging spikes, each held up by a turning
 *             dark-red magic circle, crimson pools on top
 *   shell   — Eva-style twisted shells bored through with holes, cool navy
 *             bellies, a ring of rubble orbiting each one
 *   chained — pale ash-bone mesas that do not move, held down by iron
 *             chains anchored in the sand
 * (hell-09's crag and cube cluster were rated weak; its causeway needs a high
 * camera to read, so it is left out.)
 *
 * The forms and every shader are IMPORTED read-only from hell-09's helper
 * modules (hell-09-islands-forms.ts, hell-09-islands-shade.ts); only the
 * placement, the per-look settings and the motion live here. A look is built
 * on first use and kept, so switching back is instant.
 */

import * as THREE from 'three';
import { seededRandom } from '../hell-common';
import { buildForm, type FormId, type IslandShape } from '../hell-09-islands-forms';
import {
  MAX_CHAINS,
  makeCapMaterial,
  makeChains,
  makeDebris,
  makeRockMaterial,
  makeSealMaterial,
  makeShared,
} from '../hell-09-islands-shade';
import type { AssetFactory, AssetOption } from './contract';
import type { ScenePalette } from './palette';

const OPTIONS: AssetOption[] = [
  {
    id: 'tiers',
    label: 'Lava tiers',
    description: 'Stepped clover-leaf tiers in charcoal rock, seen from below as dark silhouettes: every ledge lip glows with the lava pooled on it, the bellies fall to black and embers shed off them.',
    source: 'hell-09 design:clover caps:lava under:black colour:charcoal strata:lips debris:shed',
  },
  {
    id: 'seal',
    label: 'Seal-borne spikes',
    description: 'Inverted cones — a short crown over a long ridged taper with hanging spikes — each held up by a slowly turning dark-red magic circle that washes its belly red.',
    source: 'hell-09 design:cone under:seal caps:crimson',
  },
  {
    id: 'shell',
    label: 'Eva shells',
    description: 'Alien twisted shells in blue-grey with contour ribs, red streaks and see-through holes, cool navy undersides and a ring of rubble orbiting each.',
    source: 'hell-09 design:shell under:cool debris:orbit',
  },
  {
    id: 'chained',
    label: 'Chained mesas',
    description: 'Tall pale ash-bone mesas with banded walls and cool navy bellies, no glow, perfectly still, each held down by two iron chains anchored in the sand.',
    source: 'hell-09 design:mesa colour:ash under:cool strata:bands chains:iron-ground motion:still',
  },
];

/** A palette colour, scaled (linear): [role, multiplier]. */
type Ref = [(p: ScenePalette) => string, number];
const lit: Ref[0] = (p) => p.stone.lit;
const shade: Ref[0] = (p) => p.stone.shade;
const rim: Ref[0] = (p) => p.stone.rim;
const bone: Ref[0] = (p) => p.bone.lit;
const circles: Ref[0] = (p) => p.glow.circles;

type Recipe = {
  form: FormId;
  /** One seed per LAYOUT.islands slot (picked for a good silhouette). */
  seeds: number[];
  /** Island radius = slot size × this (some forms are taller than wide). */
  size: number;
  /** Rock colours [body, strata / streak], from the palette (hell-09 tuned them under a red key). */
  rock: [Ref, Ref];
  /** hell-09 underside: 1 cool unlit · 3 fall to black · 4 seal-borne. */
  under: number;
  /** Wall detail: 0 plain · 1 bands · 2 folded · 3 bands + lips. */
  detail: number;
  /** Cap pools: mode (0 none · 2 lava · 3 crimson), glow spill. Lava is the embers' colour, crimson the circles'. */
  caps: [number, number];
  /** Debris: 0 off · 1 orbiting ring · 2 shedding. */
  debris: number;
  chains: boolean;
  /** Bob + slow yaw strength (0 = still). */
  motion: number;
  /** Yaw of island i (the shells lie across the view, long side shown). */
  yaw: (i: number, seed: number) => number;
};

const RECIPES: Record<string, Recipe> = {
  // charcoal rock (the stone's dark), strata picked out in the stone's rim colour
  tiers: { form: 'clover', seeds: [41, 23, 37, 11], size: 1, rock: [[shade, 0.55], [rim, 0.35]], under: 3, detail: 3, caps: [2, 0.45], debris: 2, chains: false, motion: 1, yaw: (_, s) => s * 0.37 },
  seal: { form: 'cone', seeds: [53, 23, 67, 11], size: 0.85, rock: [[shade, 0.5], [lit, 0.8]], under: 4, detail: 3, caps: [3, 0.6], debris: 0, chains: false, motion: 1, yaw: (_, s) => s * 0.37 },
  // Eva shells: the lit stone, with a few dark-red streaks (the circles' red, kept small)
  shell: { form: 'shell', seeds: [41, 23, 37, 11], size: 0.75, rock: [[lit, 1.3], [circles, 0.45]], under: 1, detail: 3, caps: [0, 0], debris: 1, chains: false, motion: 1, yaw: (i) => (i % 2 ? 0.3 : -0.25) },
  // pale ash-bone mesas: the bone colour
  chained: { form: 'mesa', seeds: [41, 23, 37, 11], size: 1, rock: [[bone, 0.4], [bone, 0.75]], under: 1, detail: 1, caps: [0, 0], debris: 0, chains: true, motion: 0, yaw: (_, s) => s * 0.37 },
};

/**
 * Rock fog density. hell-09 used 0.0009; these islands hang 650–1000 m out,
 * where that much haze washed them into the red sky. Thinner haze up here
 * keeps their dark value (MOODBOARD §2.4: value contrast).
 */
const ROCK_FOG = 0.0006;

type Island = {
  group: THREE.Group;
  shape: IslandShape;
  base: THREE.Vector3;
  yaw0: number;
  phase: number;
  period: number;
  amp: number;
  yawRate: number;
  seal?: THREE.Mesh;
};

type Look = { root: THREE.Group; update(t: number): void; paint(p: ScenePalette): void };

/**
 * hell-09's shaders have their glow and underside colours as constants. On
 * OUR material instances (before the first compile) those constants are
 * swapped for these uniforms, set from the palette; the experiment's module
 * is untouched. [shader text, replacement]; a text that is not in a given
 * shader is simply skipped (each list is checked against the material kind).
 */
const TINT_GLSL = 'uniform vec3 uUnderCol;\nuniform vec3 uSealCol;\nuniform vec3 uLavaCrust;\nuniform vec3 uLavaHot;\nuniform vec3 uLavaCore;\nuniform vec3 uPoolDeep;\nuniform vec3 uPoolHot;\nuniform vec3 uDebrisRock;\nuniform vec3 uIron;\n';
const SWAPS: Record<'rock' | 'cap' | 'seal' | 'debris' | 'chains', [string, string][]> = {
  rock: [
    // cool unlit bellies fall to the fog's dark, not a fixed navy
    ['vec3 navy = srgb(vec3(0.07, 0.08, 0.2));', 'vec3 navy = uUnderCol;'],
    // the seal under the island washes the belly in the circles' red
    ['vec3 seal = srgb(vec3(0.75, 0.05, 0.12));', 'vec3 seal = uSealCol;'],
  ],
  cap: [
    ['vec3 crust = srgb(vec3(0.23, 0.04, 0.02));', 'vec3 crust = uLavaCrust;'],
    ['vec3 orange = srgb(vec3(0.984, 0.43, 0.09)) * 2.2;', 'vec3 orange = uLavaHot * 2.2;'],
    ['vec3 core = srgb(vec3(0.996, 0.94, 0.47)) * 3.2;', 'vec3 core = uLavaCore * 3.2;'],
    ['srgb(vec3(0.42, 0.02, 0.06))', 'uPoolDeep'],
    ['srgb(vec3(1.0, 0.15, 0.2))', 'uPoolHot'],
    ['srgb(vec3(1.0, 0.1, 0.15))', 'uPoolHot'],
  ],
  seal: [
    ['vec3 core = srgb(vec3(0.95, 0.06, 0.1));', 'vec3 core = uSealCol * 1.7;'],
    ['vec3 deep = srgb(vec3(0.45, 0.0, 0.05));', 'vec3 deep = uSealCol * 0.33;'],
  ],
  debris: [
    ['vec3 rock = srgb(vec3(0.13, 0.1, 0.11));', 'vec3 rock = uDebrisRock;'],
    ['srgb(vec3(0.984, 0.43, 0.09)) * 2.4', 'uLavaHot * 2.4'],
  ],
  chains: [['vec3 iron = srgb(vec3(0.16, 0.13, 0.14));', 'vec3 iron = uIron;']],
};

function tintUniforms() {
  const c = () => ({ value: new THREE.Color() });
  return { uUnderCol: c(), uSealCol: c(), uLavaCrust: c(), uLavaHot: c(), uLavaCore: c(), uPoolDeep: c(), uPoolHot: c(), uDebrisRock: c(), uIron: c() };
}
type Tint = ReturnType<typeof tintUniforms>;

function swapShader<M extends THREE.ShaderMaterial>(m: M, kind: keyof typeof SWAPS, tint: Tint): M {
  let fs = m.fragmentShader;
  for (const [from, to] of SWAPS[kind]) {
    if (!fs.includes(from)) console.error(`[islands] ${kind} shader text not found, colour not swapped: ${from}`);
    fs = fs.split(from).join(to);
  }
  m.fragmentShader = TINT_GLSL + fs;
  Object.assign(m.uniforms, tint);
  m.needsUpdate = true;
  return m;
}

const WHITE = new THREE.Color(1, 1, 1);
const ref = (out: THREE.Color, [role, k]: Ref, p: ScenePalette) => out.set(role(p)).multiplyScalar(k);

export const create: AssetFactory = ({ lab, scene, layout, palette }) => {
  const env = lab.env;
  const eye = new THREE.Vector3(...layout.camera.position);
  const world = new THREE.Group();
  world.name = 'islands';
  scene.add(world);

  function build(recipe: Recipe): Look {
    const root = new THREE.Group();
    // hell-09's shared uniforms, one set per look (each look keeps its own settings).
    const shared = makeShared();
    shared.uUnder.value = recipe.under;
    // The rock colours always come from the palette (hell-09's override slot).
    shared.uPalette.value = 1;
    shared.uDetail.value = recipe.detail;
    shared.uCapMode.value = recipe.caps[0];
    shared.uCapSpill.value = recipe.caps[1];
    // No stand-in cloud deck here: switch off hell-09's under-the-deck murk.
    shared.uHeightFog.value = 0;
    shared.uDeckY.value = -1e4;
    const tint = tintUniforms();
    const paint = (p: ScenePalette) => {
      ref(shared.uOverA.value, recipe.rock[0], p);
      ref(shared.uOverB.value, recipe.rock[1], p);
      // The glow spilling over the cap lip: lava = embers, crimson pool = circles.
      shared.uCapCol.value.set(recipe.caps[0] === 3 ? p.glow.circles : p.glow.embers);
      shared.uFogCol.value.set(p.fog.color);
      // Cool unlit bellies: the stone's shade sinking into the fog, dark.
      tint.uUnderCol.value.set(p.stone.shade).lerp(new THREE.Color(p.fog.color), 0.5).multiplyScalar(0.3);
      tint.uSealCol.value.set(p.glow.circles).multiplyScalar(0.7);
      tint.uLavaHot.value.set(p.glow.embers);
      tint.uLavaCrust.value.set(p.glow.embers).multiplyScalar(0.05);
      tint.uLavaCore.value.set(p.glow.embers).lerp(WHITE, 0.6);
      tint.uPoolDeep.value.set(p.glow.circles).multiplyScalar(0.2);
      tint.uPoolHot.value.set(p.glow.circles).multiplyScalar(1.3);
      tint.uDebrisRock.value.set(p.stone.shade).multiplyScalar(0.5);
      tint.uIron.value.set(p.stone.shade).lerp(new THREE.Color(0.03, 0.03, 0.03), 0.5);
    };
    paint(palette.current());
    const capMaterial = swapShader(makeCapMaterial(env, shared), 'cap', tint);
    const sealMaterial = recipe.under === 4 ? swapShader(makeSealMaterial(env), 'seal', tint) : null;
    const sealGeometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);

    const islands: Island[] = layout.islands.map((slot, i) => {
      const seed = recipe.seeds[i % recipe.seeds.length];
      const R = Math.round(slot.size * recipe.size);
      const shape = buildForm(recipe.form, R, seed);
      const group = new THREE.Group();
      group.add(new THREE.Mesh(shape.rock, swapShader(makeRockMaterial(env, shared, shape, seed, ROCK_FOG), 'rock', tint)));
      if (shape.caps && recipe.caps[0] > 0) group.add(new THREE.Mesh(shape.caps, capMaterial));
      // The slot marks the island's middle: its top sits half its height above.
      const base = new THREE.Vector3(slot.x, slot.y - (shape.top + shape.bottom) / 2, slot.z);
      const rnd = seededRandom(seed * 13 + 5);
      const yaw0 = recipe.yaw(i, seed);
      group.position.copy(base);
      group.rotation.y = yaw0;
      root.add(group);
      const island: Island = {
        group,
        shape,
        base,
        yaw0,
        phase: rnd() * Math.PI * 2,
        period: 8 + rnd() * 7,
        amp: Math.max(0.15, (shape.top - shape.bottom) * 0.008),
        yawRate: (rnd() - 0.5) * 0.012,
      };
      if (sealMaterial) {
        // The seal: a dark-red circle 1.3× the footprint just under the tip,
        // tipped a little toward the camera so it reads from down here.
        const seal = new THREE.Mesh(sealGeometry, sealMaterial);
        const r = shape.radius * 1.3;
        seal.scale.set(r, 1, r);
        seal.rotation.x = -0.45;
        root.add(seal);
        island.seal = seal;
      }
      return island;
    });

    // Debris (hell-09 T19): 70 GPU-animated fragments per island.
    let debris: ReturnType<typeof makeDebris> | null = null;
    if (recipe.debris > 0) {
      const per = 70;
      debris = makeDebris(env, shared, islands.length * per, (i) => Math.floor(i / per), seededRandom(31));
      swapShader(debris.mesh.material as THREE.ShaderMaterial, 'debris', tint);
      debris.uMode.value = recipe.debris;
      root.add(debris.mesh);
    }

    // Iron chains to the ground (hell-09 T20): two per island, on its left and
    // right as seen from the camera, landing a little outside its footprint.
    if (recipe.chains) {
      const chains = makeChains(env, shared, 'iron', 45);
      swapShader(chains.mesh.material as THREE.ShaderMaterial, 'chains', tint);
      root.add(chains.mesh);
      root.updateMatrixWorld(true);
      let c = 0;
      for (const island of islands) {
        const g = island.base;
        const R = island.shape.radius;
        const towardEye = new THREE.Vector3(eye.x - g.x, 0, eye.z - g.z).normalize();
        for (const side of [-1, 1]) {
          if (c >= MAX_CHAINS) break;
          const across = new THREE.Vector3(-towardEye.z, 0, towardEye.x).multiplyScalar(side);
          const aim = g.clone().addScaledVector(towardEye, R * 0.5).addScaledVector(across, R);
          const a = waistAnchor(island, aim);
          const out = a.clone().sub(g).setY(0).normalize();
          const end = a.clone().addScaledVector(out, R * 0.9).setY(layout.groundY - 3);
          chains.uA.value[c].set(a.x, a.y, a.z, 0.025);
          chains.uB.value[c].set(end.x, end.y, end.z, 1);
          c++;
        }
      }
      for (let k = c; k < MAX_CHAINS; k++) chains.uB.value[k].w = 0;
    }

    world.add(root);

    const update = (t: number) => {
      const fog = scene.fog as THREE.FogExp2 | null;
      if (fog) shared.uFogCol.value.copy(fog.color);
      const k = recipe.motion;
      islands.forEach((island, i) => {
        // Bob and slow yaw (hell-09 T21), each island out of phase.
        const w = (Math.PI * 2 * t) / island.period + island.phase;
        const g = island.group;
        g.position.set(island.base.x, island.base.y + island.amp * k * Math.sin(w), island.base.z);
        g.rotation.set(0.005 * k * Math.sin(w * 0.7 + 1), island.yaw0 + island.yawRate * k * t, 0.005 * k * Math.sin(w * 0.55 + 2));
        const s = island.shape;
        if (island.seal) island.seal.position.set(g.position.x, g.position.y + s.bottom - s.radius * 0.12, g.position.z);
        if (debris) {
          debris.uIslA.value[i].set(g.position.x, g.position.y + s.waist, g.position.z, s.radius);
          debris.uIslB.value[i].set(s.waist - s.bottom, 1, 1, 0);
        }
      });
    };
    update(0);
    return { root, update, paint };
  }

  /** Point on the island's waist ring facing `toward` (world), in world space. */
  function waistAnchor(island: Island, toward: THREE.Vector3): THREE.Vector3 {
    const local = island.group.worldToLocal(toward.clone());
    const th = Math.atan2(local.z, local.x);
    const ring = island.shape.waistRing;
    const i = Math.floor(((((th / (Math.PI * 2)) % 1) + 1) % 1) * ring.length) % ring.length;
    const r = ring[i] * 0.92;
    const out = new THREE.Vector3(Math.cos(th) * r, island.shape.waist + island.shape.radius * 0.04, Math.sin(th) * r);
    return island.group.localToWorld(out);
  }

  const looks = new Map<string, Look>();
  let current = OPTIONS[0].id;
  let active: Look | null = null;
  palette.subscribe((p) => {
    for (const look of looks.values()) look.paint(p);
  });

  const setOption = (id: string) => {
    if (!RECIPES[id]) return;
    current = id;
    let look = looks.get(id);
    if (!look) {
      look = build(RECIPES[id]);
      looks.set(id, look);
    }
    for (const [key, l] of looks) l.root.visible = key === id;
    active = look;
  };
  setOption(current);

  return {
    id: 'islands',
    label: 'Islands',
    options: OPTIONS,
    setOption,
    update: (t) => active?.update(t),
    params: () => {
      const r = RECIPES[current];
      return {
        form: r.form,
        underside: ['cloud skirt', 'cool unlit', 'warm', 'fall to black', 'seal'][r.under],
        rock: `${r.rock[0][1]}×role / ${r.rock[1][1]}×role (palette)`,
        caps: ['none', 'yellow', 'lava', 'crimson'][r.caps[0]],
        debris: ['off', 'orbit', 'shed'][r.debris],
        chains: r.chains ? 'iron to ground' : 'off',
        motion: r.motion > 0 ? 'bob + slow yaw' : 'still',
        sizeScale: r.size,
        seeds: r.seeds.join(','),
      };
    },
  };
};

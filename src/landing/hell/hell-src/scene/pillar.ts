// COPIED from .claude/pages/ad/experiments/hell-src/scene/pillar.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Pillar: the one tall vertical on the centre line (body, crown, base glow).
 *
 * A castle (new for this scene, 2026-10-11: "the tower is too simple, all 4
 * of them … make it like a castle … a very important structure") and four of
 * HELL-06's designs, the ones its review rated strongest:
 *   citadel — a many-part castle keep: bastion, gatehouse, hall, drum, keep,
 *             belfry and spire, lit windows and banners (scene/pillar-citadel.ts)
 *   sigil   — a thin obsidian shaft through three turning magic circles
 *   veined  — a thick faceted column with pulsing lava veins and an ember crown
 *   chained — a pale glowing tower held down by crawling chains of light
 *   ruin    — a broken, leaning stump with ember edges and a floating chunk
 *
 * The building blocks (stone / light / halo / sigil / mist / hull materials)
 * are IMPORTED read-only from hell-06-pillar-parts.ts; the design recipes are
 * COPIED from hell-06-pillar.ts. hell-06 builds its pillar around its own
 * foot (FOOT, H = 560 m); here each design is built the same way inside a
 * wrapper that moves FOOT onto LAYOUT.pillar and scales it to the scene.
 * Shaders that work in world units (halo, mist, chains) get scene-unit sizes.
 */

import * as THREE from 'three';
import { seededRandom } from '../hell-common';
import { FOOT, H, makePillarUniforms } from '../hell-06-pillar-glsl';
import {
  coneGeometry,
  instanced,
  latheBody,
  makeHalo,
  makeHull,
  makeLight,
  makeMist,
  makeSigils,
  makeStone,
  spikeMatrices,
  type Profile,
  type StoneOptions,
} from '../hell-06-pillar-parts';
import type { AssetFactory, AssetOption } from './contract';
import type { ScenePalette } from './palette';
import { makeSceneChains } from './pillar-chains';
import { buildCitadel, CITADEL_TONE, CITADEL_TOP, TERRACE } from './pillar-citadel';
import { pianoHandle } from './piano-toon';
import { buildVampireSynth } from './vampire-synth';

/** The citadels' scale in the scene (local units → metres). */
export const CITADEL_SCALE = 0.88;
/** The piano's pedestal on the roof terrace (roof variant): its height above the terrace floor, metres. */
export const PLATFORM_HEIGHT = 8;
/** The piano stage in world metres, from the layout's pillar foot: the pedestal's top centre. */
export function pianoStage(foot: { x: number; y: number; z: number }) {
  return new THREE.Vector3(foot.x + TERRACE.seal.x * CITADEL_SCALE, foot.y + TERRACE.y * CITADEL_SCALE + PLATFORM_HEIGHT, foot.z + TERRACE.seal.z * CITADEL_SCALE);
}

const OPTIONS: AssetOption[] = [
  {
    id: 'citadel',
    label: 'Citadel',
    description: 'A castle keep built from hundreds of stone parts: a battered bastion with eight round towers, a lit gatehouse, a buttressed hall hung with red banners, a turreted drum, a tall keep with flying buttresses, and an open glowing belfry under a spire with a beacon.',
    source: 'new (scene/pillar-citadel.ts), hell-06 stone/ink/light materials; shapes after Re:Zero Pleiades watchtower + Las Noches',
  },
  {
    id: 'citadelRoof',
    label: 'Citadel — roof terrace',
    description: 'The citadel made to be flown through: a real gate tunnel, a hollow hall with a portal, a hollow drum and keep with galleries and a spiral of lanterns, the belfry’s ring of light, and a roof terrace with an oculus in place of the spire — a grand piano stands on an inlaid red seal under the sky.',
    source: 'scene/pillar-citadel.ts { roof: true } + scene/piano-toon.ts (hell-30 FLIGHT.md)',
  },
  {
    id: 'sigil',
    label: 'Sigil-pierced shaft',
    description: 'A thin obsidian shaft running out of frame, pierced by three counter-rotating dark-red magic circles that glow where they cut it.',
    source: 'hell-06 design:sigil',
  },
  {
    id: 'veined',
    label: 'Veined lava column',
    description: 'A thick faceted dark column on a stone plinth, lava veins pulsing up it, crowned by a ring of ember-tipped spikes.',
    source: 'hell-06 design:veined',
  },
  {
    id: 'chained',
    label: 'Chained light tower',
    description: 'A shorter pale, glowing painted tower held down by a fan of dashed light chains whose links crawl up to its top.',
    source: 'hell-06 design:chained',
  },
  {
    id: 'ruin',
    label: 'Leaning ruin',
    description: 'A broken stump leaning 10°, snapped at mid-height with glowing ember edges and lit slit windows, a chunk of it floating beside the break.',
    source: 'hell-06 design:ruin',
  },
];

const smooth = THREE.MathUtils.smoothstep;

/**
 * Stone tones relative to the palette's stone role (linear multipliers):
 * lit = stone.lit × [0], shade = stone.shade × [1], deep = stone.shade × [2];
 * the rim is always stone.rim. hell-06 tuned each design under a red key
 * light; only the relations between the designs are kept (an obsidian sigil
 * shaft, a paler ruin).
 */
type Tone = [number, number, number];
const TONE = {
  spike: [1.0, 0.85, 0.3] as Tone,
  sigil: [0.8, 0.7, 0.22] as Tone,
  veined: [0.9, 0.85, 0.3] as Tone,
  block: [0.85, 0.75, 0.25] as Tone,
  ruin: [1.6, 1.3, 0.5] as Tone,
};

/** A glow trio (core / fringe / halo) as the hell-06 shaders read it. */
type Glow = { uCore: { value: THREE.Color }; uFringe: { value: THREE.Color }; uHalo: { value: THREE.Color } };
const glowTrio = (): Glow => ({ uCore: { value: new THREE.Color() }, uFringe: { value: new THREE.Color() }, uHalo: { value: new THREE.Color() } });
const WHITE = new THREE.Color(1, 1, 1);

/** Fills a trio from one role colour: a near-white core, the colour itself at the fringe, a deeper halo. */
function setGlow(g: Glow, hex: string, coreWhite: number, haloK: number) {
  g.uFringe.value.set(hex);
  g.uCore.value.set(hex).lerp(WHITE, coreWhite);
  g.uHalo.value.set(hex).multiplyScalar(haloK);
}

/** Stone options without the colours (those come from the palette). */
type StoneLook = Omit<StoneOptions, 'lit' | 'shade' | 'deep' | 'rim'>;

/** The experiment's fog density (its shaders assume FogExp2 0.0016). */
const BASE_FOG = 0.0016;

type Built = {
  group: THREE.Group;
  scale: number;
  base: 'mist' | 'block';
  frame?: (t: number) => void;
  /** Height of the top of the design (scene metres above the foot). */
  top: number;
};

export const create: AssetFactory = ({ lab, scene, camera, layout, palette }) => {
  const env = lab.env;
  const P = makePillarUniforms();
  // Glows: the pillar's own (P: column, veins, windows, halo, mist, chains),
  // the magic circles' (the sigil discs and their bands on the shaft) and the
  // embers' (the veined design's ember crown).
  const circleGlow = glowTrio();
  const emberGlow = glowTrio();
  /** Every stone material with its tone, and every ink hull: re-coloured on a palette change. */
  const stones: { m: THREE.ShaderMaterial; tone: Tone }[] = [];
  const hulls: THREE.ShaderMaterial[] = [];
  const foot = new THREE.Vector3(layout.pillar.x, layout.groundY, layout.pillar.z);
  P.uFoot.value.copy(foot);
  // uH stays H: the shaders compare it with OBJECT-space heights (experiment units).
  const fov = { value: THREE.MathUtils.degToRad(camera.fov) };
  /** The citadel's fog: thinner than the shared pillar fog, so the castle keeps its presence. */
  const citadelFogK = { value: 1 };
  const CITADEL_FOG = 0.65;

  /** A stone material in a palette tone, optionally on another glow trio than the pillar's. */
  const stone = (o: StoneLook, tone: Tone, glow?: Glow) => {
    const black = '#000';
    const m = makeStone(env, P, { ...o, lit: black, shade: black, deep: black, rim: black }, fov);
    if (glow) Object.assign(m.uniforms, glow);
    stones.push({ m, tone });
    paintStone(m, tone, palette.current());
    return m;
  };
  const hull = () => {
    const m = makeHull(env, P);
    hulls.push(m);
    paintHull(m, palette.current());
    return m;
  };

  function paintStone(m: THREE.ShaderMaterial, tone: Tone, p: ScenePalette) {
    const u = m.uniforms;
    (u.uLit.value as THREE.Color).set(p.stone.lit).multiplyScalar(tone[0]);
    (u.uShade.value as THREE.Color).set(p.stone.shade).multiplyScalar(tone[1]);
    (u.uDeep.value as THREE.Color).set(p.stone.shade).multiplyScalar(tone[2]);
    (u.uRimCol.value as THREE.Color).set(p.stone.rim);
    // The inside of the hollow (snapped) shell: the deepest stone.
    (u.uInterior.value as THREE.Color).set(p.stone.shade).multiplyScalar(0.12);
  }
  function paintHull(m: THREE.ShaderMaterial, p: ScenePalette) {
    // Ink: the stone's own shadow, nearly black (never black-red).
    (m.uniforms.uInk.value as THREE.Color).set(p.stone.shade).multiplyScalar(0.18);
  }
  function paint(p: ScenePalette) {
    // The pillar's light: a near-white core, the palette's pillar glow at the edge.
    setGlow(P, p.glow.pillar, 0.55, 0.5);
    // The circles' fringe runs a little hotter than their halo (hell-06: #ff3b30 over #c8102e).
    setGlow(circleGlow, p.glow.circles, 0.9, 0.75);
    circleGlow.uFringe.value.multiplyScalar(1.3);
    setGlow(emberGlow, p.glow.embers, 0.6, 0.5);
    for (const s of stones) paintStone(s.m, s.tone, p);
    for (const h of hulls) paintHull(h, p);
  }
  palette.subscribe(paint);
  /** A lathe body with an ink hull sharing its geometry. */
  function body(geo: THREE.BufferGeometry, mat: THREE.Material, ink = true): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, mat));
    if (ink) g.add(new THREE.Mesh(geo, hull()));
    return g;
  }

  /** Moves the experiment's FOOT onto the scene's foot and scales it by s. */
  function wrapper(s: number): THREE.Group {
    const w = new THREE.Group();
    w.scale.setScalar(s);
    w.position.copy(foot).addScaledVector(FOOT, -s);
    return w;
  }

  /** The halo draws in world units (it ignores its parent), so scale its sizes. */
  function halo(prof: Profile, top: number, spread: number, fall: number, gain: number, s: number): THREE.Mesh {
    return makeHalo(env, P, (y) => prof(y / s) * s, top * s, spread * s, fall * s, gain);
  }

  /** The mist pool, sized in scene metres. Its floor sits a little above the
   *  ground so it rises over the dunes' dish lip (which hides the very foot). */
  function mist(R: number, height: number, coreR: number): THREE.Mesh {
    const m = makeMist(env, P, R, height, coreR);
    const floor = layout.groundY + 5;
    m.position.set(foot.x, floor, foot.z);
    const u = (m.material as THREE.ShaderMaterial).uniforms;
    u.uFloorY.value = floor;
    u.uTopY.value = floor + height;
    return m;
  }

  /** A dark stone plinth at the foot (experiment units, inside the wrapper). */
  function block(r: number): THREE.Group {
    const w = Math.max(20, r * 2.4);
    const h = Math.max(30, r * 1.3);
    const geo = new THREE.CylinderGeometry(w * 0.8, w, h, 4, 1).rotateY(Math.PI / 4).toNonIndexed();
    geo.computeVertexNormals();
    geo.translate(0, h / 2 - 8, 0);
    const blk = body(geo, stone({ rimW: 0.3, rimHDR: 1.2, contact: 0.5 }, TONE.block));
    blk.position.copy(FOOT);
    return blk;
  }

  // ── the designs (recipes copied from hell-06-pillar.ts) ───────────────

  const designs: Record<string, () => Built> = {
    citadel() {
      const g = new THREE.Group();
      const c = buildCitadel({
        env,
        P,
        palette,
        stone: (tone) => {
          const m = stone({ rimW: 0.22, rimHDR: 1.3, contact: 0.5 }, CITADEL_TONE[tone]);
          m.uniforms.uFogK = citadelFogK;
          return m;
        },
        hull: () => {
          const m = hull();
          m.uniforms.uFogK = citadelFogK;
          return m;
        },
        fogK: citadelFogK,
      });
      // 0.88: the whole silhouette, spire and beacon, stays inside the frame.
      const s = CITADEL_SCALE;
      c.group.position.copy(foot);
      c.group.scale.setScalar(s);
      g.add(c.group, mist(120, 18, 35));
      return { group: g, scale: s, base: 'mist', top: CITADEL_TOP * s, frame: c.frame };
    },
    citadelRoof() {
      const g = new THREE.Group();
      const s = CITADEL_SCALE;
      const c = buildCitadel(
        {
          env,
          P,
          palette,
          stone: (tone) => {
            const m = stone({ rimW: 0.22, rimHDR: 1.3, contact: 0.5 }, CITADEL_TONE[tone]);
            m.uniforms.uFogK = citadelFogK;
            return m;
          },
          hull: () => {
            const m = hull();
            m.uniforms.uFogK = citadelFogK;
            return m;
          },
          fogK: citadelFogK,
        },
        { roof: true },
      );
      c.group.position.copy(foot);
      c.group.scale.setScalar(s);
      // The instrument on a small, tall pedestal over the seal (above the parapet,
      // so the dunes and the sky are all around it), in metres.
      const stage = pianoStage(foot);
      const pedestal = new THREE.Group();
      pedestal.position.set(stage.x, stage.y - PLATFORM_HEIGHT, stage.z);
      const pedStone = (tone: keyof typeof CITADEL_TONE) => {
        const m = stone({ rimW: 0.25, rimHDR: 1.2, contact: 0 }, CITADEL_TONE[tone]);
        m.uniforms.uFogK = citadelFogK;
        return m;
      };
      const pedHull = () => {
        const m = hull();
        m.uniforms.uFogK = citadelFogK;
        return m;
      };
      const drum = (rTop: number, rBottom: number, y0: number, y1: number, tone: keyof typeof CITADEL_TONE) => {
        const geo = new THREE.CylinderGeometry(rTop, rBottom, y1 - y0, 16).toNonIndexed();
        geo.computeVertexNormals();
        geo.translate(0, (y0 + y1) / 2, 0);
        const mesh = new THREE.Mesh(geo, pedStone(tone));
        const ink = new THREE.Mesh(geo, pedHull());
        mesh.frustumCulled = ink.frustumCulled = false;
        pedestal.add(mesh, ink);
      };
      drum(4.8, 4.8, 0, 0.5, 'wall');
      drum(4.0, 4.0, 0.5, 1.0, 'trim');
      drum(1.9, 2.3, 1.0, 6.6, 'wall');
      for (const y of [2.5, 5.2]) drum(2.5, 2.5, y, y + 0.25, 'trim');
      drum(3.7, 1.9, 6.6, 7.6, 'trim');
      drum(3.9, 3.9, 7.6, PLATFORM_HEIGHT, 'wall');
      // A glowing seal ring on the pedestal's top, in the circles' colour.
      const sealCol = { value: new THREE.Color() };
      palette.subscribe((pp) => sealCol.value.set(pp.glow.circles).multiplyScalar(1.6));
      const sealMat = new THREE.ShaderMaterial({
        uniforms: { uCol: sealCol },
        vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 uCol; void main() { gl_FragColor = vec4(uCol, 1.0); }',
      });
      for (const [r0, r1] of [[3.25, 3.4], [2.3, 2.38]]) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 64).rotateX(-Math.PI / 2), sealMat);
        ring.position.y = PLATFORM_HEIGHT + 0.01;
        ring.frustumCulled = false;
        pedestal.add(ring);
      }
      // The Vampire Synth (owner: "have vampire synth demo on it … make a
      // procedural model that is appropriate"): it replaces the grand piano.
      const piano = buildVampireSynth(env, P, fov, citadelFogK);
      piano.group.position.set(stage.x, stage.y, stage.z + 0.6);
      pianoHandle.current = piano;
      // A lower, fainter foot mist than the plain citadel's: the drone flies through it to the gate.
      g.add(c.group, pedestal, piano.group, mist(110, 10, 22));
      let last = 0;
      const frame = (t: number) => {
        c.frame(t);
        piano.update(Math.min(0.1, Math.max(0, t - last)));
        last = t;
      };
      return { group: g, scale: s, base: 'mist', top: TERRACE.y * s, frame };
    },
    sigil() {
      // LAYOUT height: the shaft runs past the top of the frame, as in hell-06.
      const s = layout.pillar.height / H;
      const R = 16;
      const prof: Profile = (y) => R * (1 + 0.8 * Math.exp(-Math.max(y, 0) / 30));
      // The discs sit a little lower than in hell-06, so the top one stays in frame.
      const ys: [number, number, number] = [0.24 * H, 0.46 * H, 0.68 * H];
      const g = new THREE.Group();
      const w = wrapper(s);
      // The bands where the discs pierce the shaft glow in the circles' colour.
      const b = body(latheBody(prof, -20, H * 1.02, 48), stone({ rimW: 0.3, rimHDR: 1.8, sigilY: ys }, TONE.sigil, circleGlow));
      const sigils = makeSigils(env, P, [
        { y: ys[0], r: 90, dir: 1 },
        { y: ys[1], r: 125, dir: -0.8 },
        { y: ys[2], r: 165, dir: 0.6 },
      ]);
      // The discs are magic circles: they take the circles' glow, not the pillar's.
      sigils.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
        if (m?.uniforms) Object.assign(m.uniforms, circleGlow);
      });
      b.add(sigils);
      b.position.copy(FOOT);
      w.add(b);
      g.add(w, halo(prof, H * 1.02, 40, 14, 0.35, s), mist(72, 34, 28 * s));
      return { group: g, scale: s, base: 'mist', top: H * 1.02 * s };
    },
    veined() {
      // Smaller than the others so the ember crown stays inside the frame.
      const s = 0.44;
      const top = H * 0.9;
      const prof: Profile = (y) => 34 - 9 * (y / H) + 6 * smooth(y, top - 26, top - 14);
      const o: StoneLook = { rimW: 0.25, rimHDR: 1.4, vein: { amount: 1, n: 10, squash: 0.55, width: 0.08, radius: 30 } };
      const g = new THREE.Group();
      const w = wrapper(s);
      const b = body(latheBody(prof, -20, top, 8, 160, true), stone(o, TONE.veined));
      // Ember cap: a ring of short glowing spikes, in the embers' colour.
      b.add(instanced(coneGeometry(5), stone({ rimW: 0.3, rimHDR: 1.2, tipGlow: 1.6 }, TONE.spike, emberGlow), hull(), spikeMatrices([
        { n: 9, y: top - 6, radius: 26, h: 34, w: 5, tilt: 14, jitter: 0.5 },
        { n: 1, y: top - 2, radius: 0, h: 60, w: 9, tilt: 0, jitter: 0 },
      ], 8)));
      b.position.copy(FOOT);
      w.add(b, block(34));
      g.add(w, halo(prof, top * 1.02, 45, 18, 0.45, s));
      return { group: g, scale: s, base: 'block', top: (top + 58) * s };
    },
    chained() {
      const s = layout.pillar.height / H;
      const top = H * 0.72;
      const prof: Profile = (y) => (30 - 7 * (y / top)) * Math.sqrt(Math.max(0.0, 1 - smooth(y, top - 30, top) ** 2 * 0.85)) + 10 * Math.exp(-Math.max(y, 0) / 20);
      const g = new THREE.Group();
      const w = wrapper(s);
      const b = new THREE.Group();
      b.add(new THREE.Mesh(latheBody(prof, -20, top), makeLight(env, P, { threads: 18, coreHDR: 1.6, solid: 0.65, threadW: 1.4 })));
      b.add(instanced(coneGeometry(5), stone({ rimW: 0.3, rimHDR: 1.2, tipGlow: 2.2 }, TONE.spike), hull(), spikeMatrices([{ n: 6, y: top - 12, radius: 12, h: 30, w: 3, tilt: 22, jitter: 0.6 }], 4)));
      b.position.copy(FOOT);
      w.add(b, block(40));
      g.add(w, halo(prof, top * 1.04, 85, 26, 1.1, s));
      g.add(makeSceneChains(env, P, {
        foot,
        scale: s,
        summitY: (top - 18) * s,
        count: 11,
        seed: 77,
        groundY: layout.groundY,
        // No chain lands on the bones (or right under the camera).
        avoid: [
          { x: layout.bones.x, z: layout.bones.z, r: layout.bones.length * 0.75 },
          { x: layout.camera.position[0], z: layout.camera.position[2], r: 140 },
        ],
        fovY: fov,
      }));
      return { group: g, scale: s, base: 'block', top: (top + 20) * s };
    },
    ruin() {
      const s = layout.pillar.height / H;
      const top = H * 0.62;
      const prof: Profile = (y) => 42 - 7 * (Math.max(y, 0) / top);
      const o: StoneLook = { rimW: 0.28, rimHDR: 1.5, snap: { y: 0.5 * H, amp: 26 }, windows: 1.2, side: THREE.DoubleSide };
      const g = new THREE.Group();
      const w = wrapper(s);
      const inner = new THREE.Group();
      inner.position.copy(FOOT);
      w.add(inner);
      const lean = new THREE.Group();
      lean.rotation.z = THREE.MathUtils.degToRad(-10);
      // No ink hull here: the hull cannot follow the snapped top, and drew the
      // unbroken column as a dark ghost above the break against a bright sky.
      lean.add(body(latheBody(prof, -30, top, 72), stone(o, TONE.ruin), false));
      inner.add(lean);
      // A detached chunk floating beside the break, and debris at the foot.
      const rand = seededRandom(17);
      const rock = new THREE.IcosahedronGeometry(1, 1);
      const p = rock.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.8 + rand() * 0.4), p.getY(i) * (0.8 + rand() * 0.4), p.getZ(i) * (0.8 + rand() * 0.4));
      const rockGeo = rock.toNonIndexed();
      rockGeo.computeVertexNormals();
      const rockMat = stone({ rimW: 0.3, rimHDR: 1.4 }, TONE.ruin);
      const chunk = body(rockGeo, rockMat);
      chunk.scale.set(26, 40, 24);
      inner.add(chunk);
      // Debris on the flat dish around the foot (the scene's ground is flat there).
      const debris: THREE.Matrix4[] = [];
      for (let i = 0; i < 46; i++) {
        const a = rand() * Math.PI * 2;
        const d = 50 + rand() * 140;
        const sz = 3 + rand() * 12;
        debris.push(new THREE.Matrix4().compose(
          new THREE.Vector3(Math.cos(a) * d, (rand() - 0.6) * sz, Math.sin(a) * d),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3)),
          new THREE.Vector3(sz, sz * (0.6 + rand()), sz),
        ));
      }
      inner.add(instanced(rockGeo, rockMat, hull(), debris));
      g.add(w, mist(108, 34, 42 * s));
      const frame = (t: number) => {
        chunk.position.set(140 + Math.sin(t * 0.21) * 3, 0.5 * H + 40 + Math.sin(t * 0.33) * 6, 20);
        chunk.rotation.set(0.3 + t * 0.03, t * 0.05, 0.2);
      };
      frame(0);
      return { group: g, scale: s, base: 'mist', top: top * s, frame };
    },
  };

  // ── build on first use, then just show / hide ─────────────────────────

  const root = new THREE.Group();
  root.name = 'pillar';
  scene.add(root);
  const built = new Map<string, Built>();
  let current = OPTIONS[0].id;

  function show(id: string) {
    let b = built.get(id);
    if (!b) {
      b = designs[id]();
      b.group.name = `pillar-${id}`;
      root.add(b.group);
      built.set(id, b);
    }
    for (const [key, d] of built) d.group.visible = key === id;
  }
  show(current);

  // The ink line and the wire AA need the drawing-buffer size.
  lab.onResize((w, h) => P.uRes.value.set(w, h));
  P.uRes.value.set(innerWidth * lab.pixelRatio, innerHeight * lab.pixelRatio);

  return {
    id: 'pillar',
    label: 'Pillar',
    options: OPTIONS,
    setOption(id) {
      if (!designs[id]) return;
      current = id;
      show(id);
    },
    update(_t, dt) {
      // Motion clock (no phase jumps), shared by every pillar material.
      P.uMT.value += dt;
      built.get(current)?.frame?.(P.uMT.value);
      fov.value = THREE.MathUtils.degToRad(camera.fov);
      // The pillar's own fog follows the scene's fog (the sky class may change it).
      const fog = scene.fog as THREE.FogExp2 | null;
      P.uFogK.value = fog && 'density' in fog ? fog.density / BASE_FOG : 1;
      citadelFogK.value = P.uFogK.value * CITADEL_FOG;
    },
    params() {
      const b = built.get(current);
      return {
        design: current,
        scale: Number((b?.scale ?? 0).toFixed(3)),
        topMetres: Math.round(b?.top ?? 0),
        base: b?.base ?? '',
        lightCore: `#${P.uCore.value.getHexString()}`,
        lightFringe: `#${P.uFringe.value.getHexString()}`,
        lightHalo: `#${P.uHalo.value.getHexString()}`,
      };
    },
  };
};

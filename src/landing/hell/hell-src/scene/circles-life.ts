// COPIED from .claude/pages/ad/experiments/hell-src/scene/circles-life.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Circles option "living seal": the hell-02 lifecycle loop in the scene sky.
 *
 * Each circle draws itself on, ignites white-hot, turns and pulses, starts
 * to fail (flicker), then vanishes by burning, shattering or un-drawing
 * (picked per cycle), and rests before the next cycle.
 *
 * The shaders are IMPORTED read-only from hell-02-circle-motion-glsl.ts. The
 * timing, geometry and rig below are COPIED from hell-02-circle-motion.ts
 * (that module is the experiment's page and must not be imported), trimmed
 * to the lifecycle program.
 */

import * as THREE from 'three';
import { seededRandom } from '../hell-common';
import {
  BAKE_FRAG,
  BAKE_VERT,
  CIRCLE_FRAG as HELL02_CIRCLE_FRAG,
  CIRCLE_VERT,
  SHARD_FRAG,
  SNAP_EXTENT,
  SPARK_FRAG,
  SPARK_VERT,
} from '../hell-02-circle-motion-glsl';
import type { ScenePalette } from './palette';

/**
 * hell-02's layer shader with one fix, patched in this COPY only: during the
 * draw-on, the pen-tip glow exp(-(P - uRing) * ...) overflows to Infinity on
 * the not-yet-drawn side (where it is multiplied by 0), giving NaN pixels that
 * the bloom spreads over the whole frame (a blank canvas). Clamping the
 * exponent's argument to >= 0 changes nothing where the glow is visible.
 */
const PEN_TIP = 'exp(-(P - uRing) * TAU * r * 30.0)';
if (!HELL02_CIRCLE_FRAG.includes(PEN_TIP)) console.error('[circles] hell-02 pen-tip expression not found; draw-on may flash NaN');
const PATCHED_FRAG = HELL02_CIRCLE_FRAG.replace(PEN_TIP, 'exp(-max(P - uRing, 0.0) * TAU * r * 30.0)');

/**
 * Colour, also patched in our COPIES only: hell-02 picks its line / halo /
 * hot colours from fixed constants (palette(uColour, ...)); here they are
 * uniforms derived from the scene palette's circles colour (scene/palette.ts),
 * so the circles follow the palette without a recompile. The sparks and the
 * charred line take the same colours.
 */
const COLOUR_GLSL = 'uniform vec3 uLineCol;\nuniform vec3 uHaloCol;\nuniform vec3 uHotCol;\n';
const PALETTE_CALL = 'palette(uColour, lineCol, haloCol, hotCol);';
const PALETTE_UNIFORMS = 'lineCol = uLineCol; haloCol = uHaloCol; hotCol = uHotCol;';
function colourSwap(src: string, swaps: [string, string][]): string {
  for (const [from] of swaps) if (!src.includes(from)) console.error(`[circles] hell-02 colour text not found: ${from}`);
  return COLOUR_GLSL + swaps.reduce((s, [from, to]) => s.split(from).join(to), src);
}
const CIRCLE_FRAG = colourSwap(PATCHED_FRAG, [
  [PALETTE_CALL, PALETTE_UNIFORMS],
  ['vec3(0.5, 0.02, 0.01) * charred', 'uHaloCol * 1.2 * charred'],
]);
const SHARD_COLOUR_FRAG = colourSwap(SHARD_FRAG, [[PALETTE_CALL, PALETTE_UNIFORMS]]);
const SPARK_COLOUR_FRAG = colourSwap(SPARK_FRAG, [['mix(vec3(0.9, 0.05, 0.02), vec3(5.0, 2.0, 0.7), vHeat * vHeat)', 'mix(uLineCol * 0.72, uHotCol * 1.6, vHeat * vHeat)']]);

type CircleColours = { uLineCol: { value: THREE.Color }; uHaloCol: { value: THREE.Color }; uHotCol: { value: THREE.Color } };

/**
 * hell-02's "blood red" set, re-expressed around the palette's circles colour
 * C (linear): for C = #e0182a it gives back hell-02's own values
 * (line 1.25/0.06/0.045, halo 0.42/0.018/0.022, hot 3.2/0.75/0.22). The small
 * warm offsets are the white-hot ember core of an igniting line.
 */
function setCircleColours(u: CircleColours, p: ScenePalette) {
  const c = new THREE.Color(p.glow.circles);
  u.uLineCol.value.copy(c).multiplyScalar(1.68).add(new THREE.Color(0, 0.05, 0.015));
  u.uHaloCol.value.copy(c).multiplyScalar(0.56).add(new THREE.Color(0, 0.015, 0.008));
  u.uHotCol.value.copy(c).multiplyScalar(2.7).add(new THREE.Color(1.2, 0.73, 0.17));
}

const TAU = Math.PI * 2;
const LAYERS = 6;
/** Inner ring's speed in rad/s; the others follow the ratios (hell-02 "planned"). */
const BASE = 0.32;
const RATIOS = [1, -0.6, 0.35, -0.22, 0.15, -0.1];

// ── small maths (copied) ────────────────────────────────────────────────
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mod = (x: number, m: number) => ((x % m) + m) % m;
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
const easeOutQuad = (x: number) => 1 - (1 - x) * (1 - x);
const easeInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;
const hash1 = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
/** Quick inhale, slow exhale: 0.72..1. */
const breath = (t: number, period: number) => {
  const x = mod(t / period, 1);
  const v = x < 0.3 ? easeOutCubic(x / 0.3) : 1 - easeInOutSine((x - 0.3) / 0.7);
  return 0.72 + 0.28 * v;
};

// ── per-frame state the lifecycle fills ─────────────────────────────────
type State = {
  spin: number;
  scrollSpeed: number[];
  reveal: number[];
  star: number;
  glyphT: number;
  erode: number;
  pulseR: number;
  pulseAmp: number;
  breath: number;
  flash: number;
  shockR: number;
  shockAmp: number;
  burn: number;
  burnStart: number;
  burnDur: number;
  shatter: number;
  crack: number;
  fill: number;
  flicker: number;
  gain: number;
  swell: number;
};

function newState(): State {
  return {
    spin: 1, scrollSpeed: [0, 0], reveal: Array(LAYERS).fill(1), star: 1, glyphT: 1e3, erode: 2, pulseR: 0,
    pulseAmp: 0, breath: 1, flash: 0, shockR: 0, shockAmp: 0, burn: 0, burnStart: 0, burnDur: -1, shatter: 0,
    crack: 0, fill: 0, flicker: 0, gain: 1, swell: 0,
  };
}
const DEFAULTS = newState();
/** Back to defaults in place (no new arrays). */
function resetState(s: State) {
  const { scrollSpeed, reveal } = s;
  Object.assign(s, DEFAULTS);
  s.scrollSpeed = scrollSpeed;
  s.reveal = reveal;
  scrollSpeed.fill(0);
  reveal.fill(1);
}

// ── phases (copied from hell-02) ────────────────────────────────────────

/** Rings trace by angle with a stagger, then star strokes, then glyph pops. */
function drawOn(s: State, c: number, t0: number, ringDur: number, stagger: number, starAt: number, starDur: number, glyphAt: number) {
  for (let k = 0; k < LAYERS; k++) s.reveal[k] = easeInOutCubic(clamp01((c - t0 - stagger * k) / ringDur));
  s.star = clamp01((c - starAt) / starDur);
  s.glyphT = c - glyphAt;
}

/** White-hot for ~0.1 s, exponential cool-down, a shock ring, spin kick. */
function ignite(s: State, age: number) {
  if (age < 0) return;
  s.flash = age < 0.1 ? 1 : Math.exp(-(age - 0.1) * 3.5);
  s.shockR = easeOutCubic(clamp01(age / 1.6)) * 1.55;
  s.shockAmp = Math.exp(-age * 1.6) * 1.4;
  s.spin *= 1 + 2.5 * Math.exp(-age * 1.2);
  s.swell = 0.35 * s.flash;
}

/** An outward light wave every `period` seconds. */
function pulse(s: State, c: number, period: number, amp: number) {
  const ph = mod(c / period, 1);
  s.pulseR = mix(-0.1, 1.25, easeOutQuad(ph));
  s.pulseAmp = (1 - ph) * amp;
  if (s.pulseR > 0.95) {
    s.shockR = Math.max(s.shockR, s.pulseR);
    s.shockAmp = Math.max(s.shockAmp, (1 - ph) * 0.35);
  }
}

/** The full lifecycle: draw → ignite → spin + pulse → fail → vanish → rest. */
function lifecycle(s: State, c: number, run: number, cycle: number, index: number) {
  drawOn(s, c, 0.2, 0.8, 0.22, 1.7, 1.5, 3.1);
  const ig = 4.5;
  ignite(s, c - ig);
  const holdEnd = cycle - 9.5;
  const vs = cycle - 7.5; // vanish start
  if (c > ig + 1.5 && c < holdEnd) {
    pulse(s, c - ig - 1.5, 4, 0.8);
    s.breath = breath(c, 5.3);
  }
  s.scrollSpeed[0] = 0.22;
  s.scrollSpeed[1] = -0.1;
  if (c > holdEnd && c < vs + 0.5) s.flicker = clamp01((c - holdEnd) / 2) * 0.45;
  // Each cycle picks its own vanish, so the circles show a mix: burn (uneven
  // noise) or shatter (breaking glass). The spiral un-draw is retired (owner,
  // 2026-10-11: "remove spiral"); its branch below is kept but never picked.
  const mode = (Math.floor(run / cycle) + index) % 2;
  if (mode === 0) {
    s.burnStart = vs;
    s.burnDur = 2.6;
    s.burn = Math.min(1.08, Math.max(0, (c - vs) / 2.6));
    if (c > vs) s.spin *= Math.max(0.06, 1 - (c - vs) / 2);
  } else if (mode === 1) {
    s.crack = clamp01((c - (vs - 0.6)) / 0.6);
    s.shatter = clamp01((c - vs) / 2.6);
    s.fill = 1;
    if (c > vs) s.spin = 0;
  } else if (c > vs) {
    s.erode = 1.12 - 1.16 * easeInOutSine(clamp01((c - vs) / 2.5));
  }
  if (c > cycle - 4.5) s.gain = 0; // rest: an empty sky matters
}

// ── geometry (copied) ───────────────────────────────────────────────────

/** Annular-sector shards with jittered, shared boundaries. */
function buildShards(seed: number): THREE.BufferGeometry {
  const rand = seededRandom(seed);
  const radii = [0, 0.17, 0.35, 0.53, 0.72, 0.88, 1.07];
  const wedges = [4, 7, 10, 13, 17, 21];
  const wob = radii.map(() => ({ a: rand() * TAU, b: rand() * TAU, k1: 3 + Math.floor(rand() * 4), k2: 7 + Math.floor(rand() * 5) }));
  const boundary = (b: number, ang: number) => {
    if (b === 0) return 0;
    if (b === radii.length - 1) return radii[b];
    const w = wob[b];
    return radii[b] + 0.022 * Math.sin(ang * w.k1 + w.a) + 0.012 * Math.sin(ang * w.k2 + w.b);
  };
  const pos: number[] = [];
  const cen: number[] = [];
  const rnd: number[] = [];
  const edge: number[] = [];
  for (let b = 0; b < wedges.length; b++) {
    const n = wedges[b];
    const off = rand() * TAU;
    const angles: number[] = [];
    for (let j = 0; j < n; j++) angles.push(off + ((j + (rand() - 0.5) * 0.5) * TAU) / n);
    angles.push(angles[0] + TAU);
    for (let j = 0; j < n; j++) {
      const a0 = angles[j];
      const a1 = angles[j + 1];
      const poly: [number, number][] = [];
      const arc = (bi: number, from: number, to: number) => {
        const sub = Math.max(2, Math.ceil(Math.abs(to - from) * radii[bi] * 18));
        for (let i = 0; i <= sub; i++) {
          const a = mix(from, to, i / sub);
          const r = boundary(bi, a);
          poly.push([Math.cos(a) * r, Math.sin(a) * r]);
        }
      };
      if (b === 0) poly.push([0, 0]);
      else arc(b, a0, a1);
      arc(b + 1, a1, a0);
      let cx = 0;
      let cy = 0;
      for (const [x, y] of poly) {
        cx += x;
        cy += y;
      }
      cx /= poly.length;
      cy /= poly.length;
      const r3 = [rand(), rand(), rand()];
      const push = (x: number, y: number, e: number) => {
        pos.push(x, y, 0);
        cen.push(cx, cy);
        rnd.push(...r3);
        edge.push(e);
      };
      for (let i = 0; i < poly.length; i++) {
        const [x0, y0] = poly[i];
        const [x1, y1] = poly[(i + 1) % poly.length];
        push(cx, cy, 0);
        push(x0, y0, 1);
        push(x1, y1, 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCentroid', new THREE.Float32BufferAttribute(cen, 2));
  g.setAttribute('aRand', new THREE.Float32BufferAttribute(rnd, 3));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  return g;
}

/** Spark rest positions on the circle's lines (rings + pentagram strokes). */
function buildSparks(seed: number, count: number): THREE.BufferGeometry {
  const rand = seededRandom(seed);
  const ringRadii = [0.215, 0.3, 0.345, 0.385, 0.49, 0.66, 0.765, 0.805, 0.845, 0.935, 0.968, 0.995];
  const star = (j: number) => {
    const a = Math.PI / 2 - (TAU * j) / 5;
    return [0.66 * Math.cos(a), 0.66 * Math.sin(a)];
  };
  const rest: number[] = [];
  const rnd: number[] = [];
  const kind: number[] = [];
  for (let i = 0; i < count; i++) {
    if (rand() < 0.78) {
      const r = ringRadii[Math.floor(rand() * ringRadii.length)] + (rand() - 0.5) * 0.01;
      const a = rand() * TAU;
      rest.push(Math.cos(a) * r, Math.sin(a) * r);
      kind.push(0);
    } else {
      const s = Math.floor(rand() * 5);
      const [ax, ay] = star((2 * s) % 5);
      const [bx, by] = star((2 * s + 2) % 5);
      const h = rand();
      rest.push(mix(ax, bx, h), mix(ay, by, h));
      kind.push(1);
    }
    rnd.push(rand(), rand(), rand());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aRest', new THREE.Float32BufferAttribute(rest, 2));
  g.setAttribute('aRand', new THREE.Float32BufferAttribute(rnd, 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  return g;
}

/** Annulus each layer mesh covers (layer 3 holds the star, so it is a disc). */
const LAYER_SPAN: [number, number][] = [
  [0, 0.3],
  [0.22, 0.42],
  [0.31, 0.56],
  [0, 0.8],
  [0.69, 0.87],
  [0.78, 1.06],
];
/** Script bands: which layer, its radii, glyph cells, and which scroll it uses. */
const BANDS: Record<number, { r0: number; r1: number; cells: number; id: number }> = {
  2: { r0: 0.385, r1: 0.49, cells: 22, id: 1 },
  5: { r0: 0.845, r1: 0.935, cells: 44, id: 2 },
};
const FLICKER_SEGS = [8, 12, 11, 15, 18, 22];

/** Draw the design once into one small polar texture per layer (copied bake). */
function bakeLayers(renderer: THREE.WebGLRenderer): THREE.Texture[] {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uBakeLayer: { value: 0 },
      uR0: { value: 0 },
      uR1: { value: 1 },
      uPx: { value: 0.003 },
      uSeed: { value: 1.618 },
      uTime: { value: 0 },
    },
    vertexShader: BAKE_VERT,
    fragmentShader: BAKE_FRAG,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const previous = renderer.getRenderTarget();
  const textures = LAYER_SPAN.map(([r0, r1], k) => {
    const width = TAU * r1 > 2.5 ? 2048 : 1024;
    const texel = (TAU * r1) / width;
    const height = Math.min(512, Math.ceil((r1 - r0) / texel));
    const target = new THREE.WebGLRenderTarget(width, height, {
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
    });
    material.uniforms.uBakeLayer.value = k;
    material.uniforms.uR0.value = r0;
    material.uniforms.uR1.value = r1;
    material.uniforms.uPx.value = Math.max(texel, (r1 - r0) / height, 0.0028);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    return target.texture;
  });
  renderer.setRenderTarget(previous);
  material.dispose();
  quad.geometry.dispose();
  return textures;
}

const FX_SMALL = new THREE.CircleGeometry(1.06, 96);
const FX_LARGE = new THREE.CircleGeometry(1.6, 128);

const premultiplied = {
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
} as const;

// ── one circle (the hell-02 Rig, trimmed) ───────────────────────────────

class Rig {
  readonly root = new THREE.Group();
  readonly U: Record<string, { value: any }>;
  readonly fx: THREE.Mesh;
  readonly layerMeshes: THREE.Mesh[] = [];
  readonly shards: THREE.Mesh;
  readonly sparks: THREE.Points;
  private readonly snapScene = new THREE.Scene();
  private readonly snapCamera = new THREE.OrthographicCamera(-SNAP_EXTENT, SNAP_EXTENT, SNAP_EXTENT, -SNAP_EXTENT, -1, 1);
  private snap: THREE.WebGLRenderTarget | null = null;
  private readonly theta = new Float64Array(LAYERS);
  private readonly scroll = [0, 0];
  readonly cycle: number;
  private readonly state = newState();
  private readonly scratch = newState();
  private lastRun = 0;

  constructor(
    readonly index: number,
    env: Record<string, { value: unknown }>,
    pixelRatio: number,
    textures: THREE.Texture[],
    colour: number,
    colours: CircleColours,
  ) {
    const seed = index + 1;
    this.cycle = index === 0 ? 30 : 24 + Math.floor(hash1(index * 3.7) * 11);
    this.U = {
      uSeed: { value: seed * 1.618 },
      uTheta: { value: new Float32Array(LAYERS) },
      uGhostStep: { value: new Float32Array(LAYERS) },
      uGhostAmt: { value: new Float32Array(LAYERS) },
      uScroll: { value: new Float32Array(2) },
      uReveal: { value: new Float32Array(LAYERS).fill(1) },
      uStar: { value: 1 },
      uGlyphT: { value: 1e3 },
      uErode: { value: 2 },
      uErodeField: { value: 0 },
      uPulseR: { value: 0 },
      uPulseAmp: { value: 0 },
      uBreath: { value: 1 },
      uFlash: { value: 0 },
      uShockR: { value: 0 },
      uShockAmp: { value: 0 },
      uBurn: { value: 0 },
      uFlicker: { value: 0 },
      uClock: { value: 0 },
      uCrack: { value: 0 },
      uFill: { value: 0 },
      uGain: { value: 1 },
      uSwell: { value: 0 },
      uCursor: { value: 0 },
      uColour: { value: colour },
      uShatter: { value: 0 },
      uBurnStart: { value: 0 },
      uBurnDur: { value: -1 },
      uProgT: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      ...colours,
    };
    const material = (layer: number) => {
      const [r0, r1] = layer < LAYERS ? LAYER_SPAN[layer] : [0, 1];
      const band = BANDS[layer];
      const own = {
        uLayer: { value: layer },
        uTex: { value: textures[Math.min(layer, LAYERS - 1)] },
        uR0: { value: r0 },
        uR1: { value: r1 },
        uCells: { value: band ? band.cells : 0 },
        uBandV: { value: band ? ((band.r0 + band.r1) / 2 - r0) / (r1 - r0) : 0 },
        uBandHalfV: { value: band ? (band.r1 - band.r0) / 2 / (r1 - r0) : 0 },
        uBandId: { value: band ? band.id : 0 },
        uSegs: { value: FLICKER_SEGS[layer] ?? 8 },
      };
      return new THREE.ShaderMaterial({
        uniforms: { ...env, ...this.U, ...own },
        vertexShader: CIRCLE_VERT,
        fragmentShader: CIRCLE_FRAG,
        fog: false,
        ...premultiplied,
      });
    };

    // The fx disc (pulse fill, flash glow, shock rings) is larger than the circle.
    this.fx = new THREE.Mesh(FX_SMALL, material(6));
    const snapGroup = new THREE.Group();
    for (let k = 0; k < LAYERS; k++) {
      const [r0, r1] = LAYER_SPAN[k];
      const geo = r0 === 0 ? new THREE.CircleGeometry(r1, 96) : new THREE.RingGeometry(r0, r1, 96, 1);
      const mat = material(k);
      this.layerMeshes.push(new THREE.Mesh(geo, mat));
      snapGroup.add(new THREE.Mesh(geo, mat)); // twin for the shatter snapshot
    }
    this.snapScene.add(snapGroup);
    this.shards = new THREE.Mesh(
      buildShards(seed * 97),
      new THREE.ShaderMaterial({
        uniforms: { ...this.U, uSnap: { value: null } },
        vertexShader: CIRCLE_VERT,
        fragmentShader: SHARD_COLOUR_FRAG,
        defines: { SHARD: '' },
        ...premultiplied,
      }),
    );
    this.shards.visible = false;
    this.sparks = new THREE.Points(
      buildSparks(seed * 31, 1800),
      new THREE.ShaderMaterial({
        uniforms: { ...env, ...this.U },
        vertexShader: SPARK_VERT,
        fragmentShader: SPARK_COLOUR_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      }),
    );
    for (const o of [this.fx, this.shards, this.sparks, ...this.layerMeshes]) o.frustumCulled = false;
    this.root.add(this.fx, ...this.layerMeshes, this.shards, this.sparks);
    this.root.name = `circle-life-${index}`;
  }

  /** Golden-ratio time offset so the circles never line up. */
  private offset() {
    return this.index === 0 ? 0 : mod(this.index * 0.618034, 1) * this.cycle;
  }

  private evaluate(run: number, s: State) {
    const t = run + this.offset();
    resetState(s);
    const local = mod(t, this.cycle);
    lifecycle(s, local, t, this.cycle, this.index);
    return local;
  }

  /** Integrate ring angles and script scroll from lastRun to run. */
  private integrate(run: number, reset: boolean) {
    let from = this.lastRun;
    if (reset || run < from || run - from > 0.5) {
      this.theta.fill(0);
      this.scroll[0] = this.scroll[1] = 0;
      from = 0;
    }
    while (from < run - 1e-9) {
      const dt = Math.min(1 / 60, run - from);
      const s = this.scratch;
      this.evaluate(from, s);
      for (let k = 0; k < LAYERS; k++) this.theta[k] += BASE * RATIOS[k] * s.spin * dt;
      this.scroll[0] += s.scrollSpeed[0] * dt;
      this.scroll[1] += s.scrollSpeed[1] * dt;
      from += dt;
    }
    this.lastRun = run;
  }

  update(run: number, reset: boolean) {
    this.integrate(run, reset);
    const s = this.state;
    const local = this.evaluate(run, s);
    const U = this.U;
    const theta = U.uTheta.value as Float32Array;
    for (let k = 0; k < LAYERS; k++) theta[k] = mod(this.theta[k], TAU);
    const scroll = U.uScroll.value as Float32Array;
    scroll[0] = mod(this.scroll[0], TAU);
    scroll[1] = mod(this.scroll[1], TAU);
    (U.uReveal.value as Float32Array).set(s.reveal);
    U.uStar.value = s.star;
    U.uGlyphT.value = s.glyphT > 50 ? 1e3 : s.glyphT;
    U.uErode.value = s.erode;
    U.uPulseR.value = s.pulseR;
    U.uPulseAmp.value = s.pulseAmp;
    U.uBreath.value = s.breath;
    U.uFlash.value = s.flash;
    U.uShockR.value = s.shockR;
    U.uShockAmp.value = s.shockAmp;
    U.uBurn.value = s.burn;
    U.uBurnStart.value = s.burnStart;
    U.uBurnDur.value = s.burnDur;
    U.uProgT.value = local;
    U.uFlicker.value = s.flicker;
    U.uClock.value = run + this.offset();
    U.uCrack.value = s.crack;
    U.uShatter.value = s.shatter;
    U.uFill.value = s.fill;
    U.uGain.value = s.gain;
    U.uSwell.value = s.swell;

    const useShards = s.shatter > 0 || s.crack > 0;
    this.fx.visible = s.pulseAmp > 0.01 || s.flash > 0.001 || s.shockAmp > 0.01 || s.burn > 0;
    this.fx.geometry = s.shockAmp > 0.01 ? FX_LARGE : FX_SMALL;
    this.shards.visible = useShards;
    this.sparks.visible = s.burnDur > 0;
    for (const mesh of this.layerMeshes) mesh.visible = !useShards;
  }

  /** Shatter: render the six layers flat-on into a texture the shards carry away. */
  bakeSnapshot(renderer: THREE.WebGLRenderer, force = false) {
    if (!force && !this.shards.visible) return;
    if (!this.snap) {
      this.snap = new THREE.WebGLRenderTarget(1024, 1024, { type: THREE.HalfFloatType, depthBuffer: false });
      (this.shards.material as THREE.ShaderMaterial).uniforms.uSnap.value = this.snap.texture;
    }
    const previous = renderer.getRenderTarget();
    const clear = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.snap);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.snapScene, this.snapCamera);
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clear, clearAlpha);
  }
}

export type LifeSeal = {
  group: THREE.Group;
  /** Restart the loop from the draw-on. `cycles` whole cycles in, so the
   *  vanish (burn / shatter, picked per cycle) can differ. */
  restart(cycles?: number): void;
  update(dt: number): void;
  /** Take the circles' colour from the palette. */
  recolour(p: ScenePalette): void;
};

/**
 * The living seal: a main circle plus two smaller ones, each on its own
 * golden-ratio-staggered lifecycle. `places` are [centre, radius] pairs;
 * every circle faces `eye`. colour: 0 blood red, 1 ember, 2 black-red ink.
 */
export function createLifeSeal(
  renderer: THREE.WebGLRenderer,
  env: Record<string, { value: unknown }>,
  pixelRatio: number,
  places: [THREE.Vector3, number][],
  eye: THREE.Vector3,
  colour: number,
): LifeSeal {
  const textures = bakeLayers(renderer);
  const group = new THREE.Group();
  group.name = 'circles-life';
  const colours: CircleColours = { uLineCol: { value: new THREE.Color() }, uHaloCol: { value: new THREE.Color() }, uHotCol: { value: new THREE.Color() } };
  const rigs = places.map(([position, radius], i) => {
    const rig = new Rig(i, env, pixelRatio, textures, colour, colours);
    rig.root.position.copy(position);
    rig.root.scale.setScalar(radius);
    rig.root.lookAt(eye);
    group.add(rig.root);
    return rig;
  });
  let run = 0;
  let reset = true;
  let warmed = false;
  return {
    group,
    restart(cycles = 0) {
      run = cycles * rigs[0].cycle;
      reset = true;
    },
    recolour(p) {
      setCircleColours(colours, p);
    },
    update(dt) {
      if (!warmed) {
        // Compile the snapshot program once, not at the first shatter.
        rigs[0].bakeSnapshot(renderer, true);
        warmed = true;
      }
      if (!reset) run += Math.min(dt, 0.1);
      for (const rig of rigs) {
        rig.update(run, reset);
        rig.bakeSnapshot(renderer);
      }
      reset = false;
    },
  };
}

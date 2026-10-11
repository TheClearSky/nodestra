// COPIED from .claude/pages/ad/experiments/hell-src/hell-01-circle-designs-designs.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-01 design grammar: what a magic circle is made of, as plain data.
 *
 * A circle is a list of LAYERS (rings, stars, glyph bands, satellites…),
 * each a few numbers. The same list feeds the live SDF shader (packed into
 * uniform arrays, so a new seed never recompiles a shader) and the Canvas2D
 * bake (drawn with paths), so one seed draws the same circle either way.
 *
 * Units: the circle's outer radius is 1.0. Widths are HALF widths.
 */

import { seededRandom } from '../env-src/lab';

// ── layer kinds (the shader switches on these numbers) ─────────────────

export const L = {
  RING: 0,
  RING2: 1, // double ring: two hairlines `gap` either side of r
  BAND: 2, // filled band with a hot core line (Eva Door of Guf)
  STAR: 3, // star polygon {n/m} drawn as chords
  GLYPHS: 4, // band of stroke-alphabet glyphs
  SATS: 5, // satellite circles at the star tips
  TICKS: 6,
  SPOKES: 7,
  BEADS: 8,
  MOONS: 9, // crescents
  POLY: 10, // regular polygon outline
  CENTRE: 11,
  DASH: 12, // ring that is always dashed
  ATLAS: 13, // band of Canvas2D glyphs (kanji / runes) from the atlas texture
  ARCS: 14, // broken ring: arcs with gaps
} as const;

/** Centre motifs (M7). */
export const C = { NONE: 0, BLACKSUN: 1, EYE: 2, VORTEX: 3, SEAL: 4, KANJI: 5, HEX: 6 } as const;

export type Layer = {
  type: number;
  r: number;
  w: number;
  /** Brightness of the hot core for this layer (weight contrast in light). */
  inten?: number;
  /** Type-specific parameters (see each helper). */
  p?: [number, number, number, number];
  rot?: number;
  /** Radians per second while "turning". */
  spin?: number;
  seed?: number;
};

export type Design = { name: string; layers: Layer[]; centreR: number };

// ── line weights ──
export const HAIR = 0.0026;
export const MED = 0.0055;
export const BOLD = 0.011;

// ── helpers that build layers ──────────────────────────────────────────

const ring = (r: number, w: number, inten = 1, spin = 0): Layer => ({ type: L.RING, r, w, inten, spin });
const ring2 = (r: number, gap: number, w: number, inten = 1): Layer => ({ type: L.RING2, r, w, inten, p: [gap, 0, 0, 0] });
const dashRing = (r: number, w: number, count: number, duty = 0.5, spin = 0): Layer => ({ type: L.DASH, r, w, spin, p: [count, duty, 0, 0] });
const arcs = (r: number, w: number, count: number, gap: number, rot = 0, spin = 0): Layer => ({ type: L.ARCS, r, w, rot, spin, p: [count, gap, 0, 0] });
const band = (r: number, halfWidth: number, inten: number, seed: number, spin = 0): Layer => ({ type: L.BAND, r, w: halfWidth, inten, seed, spin });
const star = (R: number, n: number, m: number, w: number, rot = 0, spin = 0, inten = 1): Layer => ({ type: L.STAR, r: R, w, inten, rot, spin, p: [n, m, 0, 0] });
/** Weave: `under` passes beneath the {n/mOver} star of the same circle (a gap is cut where they cross). */
const under = (l: Layer, mOver: number, wOver: number): Layer => ({ ...l, p: [l.p![0], l.p![1], mOver, wOver] });
const poly = (R: number, n: number, w: number, rot = 0, spin = 0): Layer => ({ type: L.POLY, r: R, w, rot, spin, p: [n, 0, 0, 0] });
/** Glyph band centred on r, `h` tall; `density` = share of cells holding a glyph; `dots` = separators. */
const glyphs = (r: number, h: number, w: number, seed: number, density = 1, dots = 0, spin = 0): Layer => ({
  type: L.GLYPHS, r, w, seed, spin, p: [h, cellsFor(r, h), density, dots],
});
const atlasBand = (r: number, h: number, set: number, seed: number, density = 1, spin = 0): Layer => ({
  type: L.ATLAS, r, w: 0, seed, spin, p: [h, cellsFor(r, h, 1.0), density, set],
});
/** flags: 1 glyph inside, 2 double ring, 4 small triangle, 8 no ring. */
const sats = (R: number, count: number, size: number, flags: number, w: number, seed: number, rot = 0, spin = 0): Layer => ({
  type: L.SATS, r: R, w, seed, rot, spin, p: [count, size, flags, 0],
});
/** len < 0 points inward; every `longEvery`-th tick is 2.2× long. */
const ticks = (r: number, count: number, len: number, longEvery: number, w: number, spin = 0, inten = 0.8): Layer => ({
  type: L.TICKS, r, w, spin, inten, p: [count, len, longEvery, 0],
});
const spokes = (count: number, rIn: number, rOut: number, w: number, rot = 0, spin = 0): Layer => ({
  type: L.SPOKES, r: (rIn + rOut) / 2, w, rot, spin, p: [count, rIn, rOut, 0],
});
const beads = (r: number, count: number, size: number, alternate: boolean, open: boolean, w: number, rot = 0, spin = 0): Layer => ({
  type: L.BEADS, r, w, rot, spin, p: [count, size, alternate ? 1 : 0, open ? 1 : 0],
});
const moons = (r: number, count: number, size: number, w: number, rot = 0, spin = 0): Layer => ({
  type: L.MOONS, r, w, rot, spin, p: [count, size, 0.42, 0],
});
export const centre = (kind: number, R: number, w = MED, seed = 1): Layer => ({ type: L.CENTRE, r: R, w, seed, p: [kind, 0, 0, 0] });

/** Whole number of roughly square glyph cells round a band (no seam). */
function cellsFor(r: number, h: number, aspect = 0.9): number {
  return Math.max(6, Math.round((2 * Math.PI * r) / (h * aspect)));
}

// Star-polygon geometry (research T3): rings placed here make the star TOUCH them.
export const innerPolyR = (R: number, n: number, m: number) => R * Math.cos((Math.PI * m) / n);
export const innerVertR = (R: number, n: number, m: number) => innerPolyR(R, n, m) / Math.cos((Math.PI * (m - 1)) / n);

/** How far from its radius a layer can draw (the shader skips it beyond). */
export function reachOf(l: Layer): number {
  const p = l.p ?? [0, 0, 0, 0];
  switch (l.type) {
    case L.RING2: return p[0] + l.w;
    case L.STAR: case L.POLY: return l.r + l.w;
    case L.GLYPHS: case L.ATLAS: return p[0] * 0.55 + l.w;
    case L.SATS: return p[1] * 1.15 + l.w;
    case L.TICKS: return Math.abs(p[1]) * 2.3 + l.w;
    case L.SPOKES: return (p[2] - p[1]) / 2 + l.w;
    case L.BEADS: return p[1] + l.w;
    case L.MOONS: return p[1] * 1.1 + l.w;
    case L.CENTRE: return l.r + (p[0] === C.BLACKSUN ? 0.55 : l.w);
    default: return l.w;
  }
}

// ── the presets (each one a fixed grammar; the seed varies glyphs and details) ──

type Rnd = () => number;
const pick = <T>(rnd: Rnd, xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

/** Classic summoning: 3 rings + hexagram + one rune band + 6 satellites. */
function classic(rnd: Rnd, s: number): Design {
  const R = 0.78;
  const rot = Math.PI / 2;
  return {
    name: 'Classic summoning',
    centreR: 0.2,
    layers: [
      ring(0.975, BOLD, 1.1),
      ring(0.945, HAIR, 0.7),
      glyphs(0.905, 0.066, 0.0042, s + 1, 0.94, 1, 0.045),
      ring(0.865, HAIR, 0.7),
      ring(R, MED),
      star(R, 6, 2, MED, rot, -0.035),
      sats(R, 6, 0.082, 1 | 2, HAIR * 1.2, s + 2, rot, -0.035),
      ring(innerPolyR(R, 6, 2), HAIR, 0.7, 0.02),
      ticks(innerPolyR(R, 6, 2), 36, -0.018, 6, HAIR, 0.02),
      centre(rnd() < 0.5 ? C.HEX : C.NONE, 0.2, HAIR * 1.3, s),
    ],
  };
}

/** Pentagram seal: double outer ring with a script band inside it, {5/2}, a bead chain. */
function pentagram(rnd: Rnd, s: number): Design {
  const R = 0.875;
  const rot = rnd() < 0.7 ? -Math.PI / 2 : Math.PI / 2; // inverted (point down) reads "hell"
  const ip = innerPolyR(R, 5, 2);
  return {
    name: 'Pentagram seal',
    centreR: ip * 0.62,
    layers: [
      ring2(0.952, 0.03, HAIR * 1.2, 0.9),
      glyphs(0.952, 0.044, 0.0028, s + 3, 0.97, 0, 0.03),
      ring(R, BOLD),
      star(R, 5, 2, MED, rot, -0.02),
      moons(0.66, 5, 0.045, HAIR * 1.1, rot + Math.PI / 5, -0.02),
      ring(ip, MED, 0.9, 0.04),
      beads(ip * 0.84, 20, 0.009, true, false, HAIR, 0, 0.04),
      centre(C.NONE, ip * 0.62, HAIR, s),
    ],
  };
}

/** Heptagram: {7/3} + {7/2} together, 7 satellites each holding its own seeded glyph. */
function heptagram(rnd: Rnd, s: number): Design {
  const R = 0.79;
  const rot = Math.PI / 2;
  const ip = innerPolyR(R, 7, 3);
  return {
    name: 'Heptagram',
    centreR: 0.15,
    layers: [
      ring(0.978, BOLD),
      ring(0.952, HAIR, 0.7),
      ticks(0.952, 84, -0.02, 6, HAIR, 0.03),
      arcs(0.885, MED * 0.8, 7, 0.32, rot + Math.PI / 7, 0.03),
      ring(R, MED),
      // {7/2} woven UNDER {7/3}: a gap is cut wherever the two cross.
      under(star(R, 7, 2, HAIR * 1.6, rot, -0.025, 0.75), 3, MED),
      star(R, 7, 3, MED, rot, -0.025),
      sats(R, 7, 0.088, 1 | 2, HAIR * 1.2, s + 4, rot, -0.025),
      ring(ip, HAIR, 0.8),
      centre(pick(rnd, [C.EYE, C.EYE, C.HEX]), 0.15, HAIR * 1.4, s),
    ],
  };
}

/** Clockwork (FMA transmutation grammar): tick rings, spoke wheel, nested squares at 45°. */
function clockwork(rnd: Rnd, s: number): Design {
  const sq = 0.84;
  const inner = sq * Math.cos(Math.PI / 4); // circle inscribed in the squares
  return {
    name: 'Clockwork',
    centreR: 0.13,
    layers: [
      ring(0.988, HAIR, 0.8),
      ticks(0.988, 180, -0.016, 5, HAIR * 0.8, 0.05),
      ring(0.958, HAIR, 0.8),
      ring(0.935, MED),
      ticks(0.935, 60, -0.028, 5, HAIR, -0.08),
      dashRing(0.89, HAIR * 1.2, 96, 0.55, 0.12),
      poly(sq, 4, MED, 0, -0.03),
      poly(sq, 4, MED, Math.PI / 4, -0.03),
      beads(0.765, 8, 0.016, false, true, HAIR, Math.PI / 8, -0.03),
      ring(inner, MED, 1, 0.06),
      star(inner, 6, 2, HAIR * 1.2, Math.PI / 2, 0.06, 0.6),
      spokes(pick(rnd, [12, 16, 24]), 0.2, inner * 0.5, HAIR, 0, -0.1),
      ring(inner * 0.5, HAIR, 0.8, -0.1),
      ticks(0.2, 48, 0.014, 4, HAIR * 0.8, -0.1),
      ring(0.2, MED),
      centre(C.HEX, 0.13, HAIR, s),
    ],
  };
}

/** Black-sun sigil: black disc, flickering crimson corona as the inner ring, sparse glyphs. */
function blackSun(rnd: Rnd, s: number): Design {
  return {
    name: 'Black sun',
    centreR: 0.27,
    layers: [
      ring(0.975, HAIR, 0.7),
      ticks(0.975, 36, -0.03, 3, HAIR, 0.015),
      arcs(0.84, MED, 3, 0.22, rnd() * 6.28, -0.02),
      ring(0.66, HAIR, 0.5),
      glyphs(0.585, 0.095, 0.0042, s + 5, 0.36, 0, 0.025),
      dashRing(0.51, HAIR, 60, 0.35, -0.03),
      centre(C.BLACKSUN, 0.27, HAIR, s),
    ],
  };
}

/** Eva Door of Guf: stacked bands of varied width, no star, hot white core lines. */
function evaBands(rnd: Rnd, s: number): Design {
  // Door of Guf: about 8 bands of clearly different widths with dark gaps,
  // one or two "lead" bands much brighter than the rest (the frame's white
  // band), thin hairlines in some gaps.
  const layers: Layer[] = [];
  const widths = [0.07, 0.016, 0.045, 0.01, 0.03, 0.06, 0.02, 0.038];
  const lead = Math.floor(rnd() * 3) + 1; // which band is the brightest
  let r = 0.985;
  let i = 0;
  while (r > 0.46 && i < 11) {
    const wd = pick(rnd, widths);
    const hw = wd / 2;
    const inten = i === lead || (i === lead + 4 && rnd() < 0.6) ? 1.25 : 0.35 + rnd() * 0.5;
    layers.push(band(r - hw, hw, inten, s + i * 7, (rnd() - 0.5) * 0.08));
    r -= wd + 0.008 + rnd() * 0.014;
    if (rnd() < 0.35) {
      layers.push(ring(r + 0.004, HAIR * 0.7, 0.5));
    }
    i++;
  }
  layers.push(ring(r - 0.01, HAIR, 0.6));
  return { name: 'Eva bands', centreR: 0.3, layers };
}

/** Stroke-alphabet glyphs: big runes built stroke by stroke on a small grid. */
function strokes(rnd: Rnd, s: number): Design {
  return {
    name: 'Stroke alphabet',
    centreR: 0.21,
    layers: [
      ring2(0.968, 0.011, HAIR * 1.2),
      glyphs(0.86, 0.13, 0.0065, s + 6, 1, 1, 0.035),
      ring(0.785, MED),
      ring(0.77, HAIR, 0.6),
      glyphs(0.68, 0.075, 0.0038, s + 7, 0.85, 0, -0.05),
      ring(0.625, HAIR, 0.7),
      sats(0.44, 6, 0.075, 1 | 8, 0.0045, s + 8, Math.PI / 2, 0.02),
      ring(0.29, HAIR, 0.7),
      centre(C.SEAL, 0.21, 0.006, s),
    ],
  };
}

/** Kanji atlas: Canvas2D-drawn kanji round the rim, a hanko seal in the middle. */
function kanji(rnd: Rnd, s: number): Design {
  const R = 0.8;
  const ip = innerPolyR(R, 8, 3);
  return {
    name: 'Kanji atlas',
    centreR: 0.2,
    layers: [
      ring2(0.968, 0.009, HAIR),
      atlasBand(0.885, 0.11, 0, s + 9, 1, 0.03),
      ring(R, BOLD),
      star(R, 8, 3, MED, Math.PI / 8, -0.02),
      ring(ip, MED, 1, -0.02),
      atlasBand(ip - 0.042, 0.05, 1, s + 10, 1, 0.05),
      ring(ip - 0.075, HAIR, 0.7),
      poly(0.215, 4, HAIR * 1.5, Math.PI / 4),
      centre(C.KANJI, 0.15, HAIR, s),
    ],
  };
}

/** Seeded design grammar (research T15): pick ONE symmetry order, then lock radii to it. */
function randomDesign(rnd: Rnd, s: number): Design {
  const n = pick(rnd, [5, 6, 6, 7, 8, 9, 12]);
  const ms: Record<number, number[]> = { 5: [2], 6: [2], 7: [2, 3], 8: [3, 2], 9: [2, 4], 12: [5, 4] };
  const m = pick(rnd, ms[n]);
  const rot = pick(rnd, [Math.PI / 2, -Math.PI / 2, 0, Math.PI / n]);
  const spinStar = (rnd() - 0.5) * 0.08;
  const layers: Layer[] = [];
  // frame
  const frame = Math.floor(rnd() * 3);
  let top = 0.97;
  if (frame === 0) { layers.push(ring2(0.955, 0.022, HAIR * 1.2)); top = 0.93; }
  if (frame === 1) { layers.push(ring(0.975, BOLD), ring(0.95, HAIR, 0.7)); top = 0.94; }
  if (frame === 2) { layers.push(ring(0.975, MED), ticks(0.975, n * pick(rnd, [6, 10, 12]), -0.022, pick(rnd, [3, 5, 6]), HAIR, (rnd() - 0.5) * 0.1)); top = 0.94; }
  const R = 0.66 + rnd() * 0.16;
  // a glyph band between the frame and the star circle when there is room (one band per 0.15 r)
  const room = top - R;
  if (room > 0.09 && rnd() < 0.8) {
    const h = Math.min(room * 0.62, 0.11);
    const mid = R + room / 2;
    layers.push(rnd() < 0.15 ? atlasBand(mid, h, pick(rnd, [0, 1, 2]), s + 11, 0.9 + rnd() * 0.1, (rnd() - 0.5) * 0.1)
      : glyphs(mid, h, h * 0.055, s + 11, rnd() < 0.25 ? 0.4 : 0.95, rnd() < 0.4 ? 1 : 0, (rnd() - 0.5) * 0.1));
    layers.push(ring(mid - h * 0.62, HAIR, 0.7));
  }
  layers.push(ring(R, pick(rnd, [MED, BOLD, HAIR * 1.4])));
  const starW = pick(rnd, [MED, HAIR * 1.4]);
  const other = ms[n].filter((x) => x !== m);
  // Sometimes a second star of the same order, woven under the first.
  if (other.length && rnd() < 0.4) layers.push(under(star(R, n, other[0], HAIR * 1.2, rot, spinStar, 0.6), m, starW));
  layers.push(star(R, n, m, starW, rot, spinStar));
  if (rnd() < 0.35) layers.push(poly(R, n, HAIR, rot, spinStar));
  const ip = innerPolyR(R, n, m);
  if (rnd() < 0.65) {
    const arc = R * Math.sin(Math.PI / n);
    const size = Math.min(arc * 0.6, pick(rnd, [0.07, 0.09, 0.11]));
    layers.push(sats(R, n, size, (rnd() < 0.6 ? 1 : 0) | (rnd() < 0.4 ? 2 : 0) | (rnd() < 0.2 ? 4 : 0), HAIR * 1.2, s + 12, rot, spinStar));
  }
  if (rnd() < 0.55) {
    const mid = (R + ip) / 2;
    if (rnd() < 0.5) layers.push(moons(mid, n, Math.min(0.05, (R - ip) * 0.25), HAIR * 1.1, rot + Math.PI / n, spinStar));
    else layers.push(beads(mid, n * pick(rnd, [1, 2]), 0.012, true, rnd() < 0.5, HAIR, rot + Math.PI / n, spinStar));
  }
  layers.push(ring(ip, pick(rnd, [HAIR, MED]), 0.9, (rnd() - 0.5) * 0.1));
  if (ip > 0.3 && rnd() < 0.5) layers.push(ticks(ip, n * pick(rnd, [4, 6, 8]), -0.02, 2, HAIR, (rnd() - 0.5) * 0.1));
  if (ip > 0.32 && rnd() < 0.5) layers.push(glyphs(ip - 0.06, 0.06, 0.0034, s + 13, 0.9, 0, (rnd() - 0.5) * 0.12), ring(ip - 0.1, HAIR, 0.6));
  const cR = Math.min(ip * 0.55, 0.24);
  const kind = pick(rnd, [C.NONE, C.BLACKSUN, C.EYE, C.VORTEX, C.SEAL, C.HEX, C.HEX, C.KANJI]);
  layers.push(centre(kind, cR, HAIR * 1.3, s));
  return { name: `Random {${n}/${m}}`, centreR: cR, layers };
}

export const DESIGNS: Record<string, { label: string; build: (rnd: Rnd, seed: number) => Design }> = {
  classic: { label: 'Classic', build: classic },
  pentagram: { label: 'Pentagram', build: pentagram },
  heptagram: { label: 'Heptagram', build: heptagram },
  clockwork: { label: 'Clockwork', build: clockwork },
  blacksun: { label: 'Black sun', build: blackSun },
  eva: { label: 'Eva bands', build: evaBands },
  strokes: { label: 'Stroke runes', build: strokes },
  kanji: { label: 'Kanji atlas', build: kanji },
  random: { label: 'Random', build: randomDesign },
};

/** Build a design for a seed, optionally swapping its centre (M7 switch). */
export function buildDesign(id: string, seed: number, centreKind: number | null): Design {
  const rnd = seededRandom(seed * 7919 + 17);
  const design = DESIGNS[id].build(rnd, seed);
  if (centreKind !== null) {
    design.layers = design.layers.filter((l) => l.type !== L.CENTRE);
    if (centreKind !== C.NONE) design.layers.push(centre(centreKind, design.centreR, centreKind === C.SEAL ? 0.006 : HAIR * 1.3, seed));
  }
  return design;
}

// ── stroke alphabet (research T7) ───────────────────────────────────────

export type AlphabetMode = 'rune3' | 'script4' | 'sym4';
export type Alphabet = {
  grid: number;
  /** Edge table: [x0, y0, x1, y1] in glyph space (−0.4…0.4); dots have a == b. */
  edges: [number, number, number, number][];
  /** Ordered edge indices per glyph (stroke order = drawing order). */
  glyphs: number[][];
  /** Packed for the shader: 2 ints per glyph, 5 × 6-bit edge ids each, 63 = none. */
  packed: Int32Array;
  flat: Float32Array;
};

export const MAX_EDGES = 58;
export const GLYPH_COUNT = 64;

export function makeAlphabet(seed: number, mode: AlphabetMode): Alphabet {
  const grid = mode === 'rune3' ? 3 : 4;
  const pos = (i: number) => ((i / (grid - 1)) - 0.5) * 0.8;
  const edges: [number, number, number, number][] = [];
  const nodesOf: [number, number][] = [];
  const index = new Map<string, number>();
  const adj: { e: number; to: number }[][] = Array.from({ length: grid * grid }, () => []);
  const node = (i: number, j: number) => j * grid + i;
  const addEdge = (a: number, b: number) => {
    const [ai, aj] = [a % grid, Math.floor(a / grid)];
    const [bi, bj] = [b % grid, Math.floor(b / grid)];
    const e = edges.length;
    edges.push([pos(ai), pos(aj), pos(bi), pos(bj)]);
    nodesOf.push([a, b]);
    index.set(`${Math.min(a, b)}-${Math.max(a, b)}`, e);
    adj[a].push({ e, to: b });
    adj[b].push({ e, to: a });
  };
  for (let j = 0; j < grid; j++) for (let i = 0; i < grid; i++) {
    if (i + 1 < grid) addEdge(node(i, j), node(i + 1, j));
    if (j + 1 < grid) addEdge(node(i, j), node(i, j + 1));
    if (i + 1 < grid && j + 1 < grid) addEdge(node(i, j), node(i + 1, j + 1));
    if (i + 1 < grid && j - 1 >= 0) addEdge(node(i, j), node(i + 1, j - 1));
  }
  const dotBase = edges.length;
  for (let k = 0; k < grid * grid; k++) {
    const x = pos(k % grid), y = pos(Math.floor(k / grid));
    edges.push([x, y, x, y]);
    nodesOf.push([k, k]);
  }
  const mirror = (e: number): number | undefined => {
    const [a, b] = nodesOf[e];
    const m = (k: number) => node(grid - 1 - (k % grid), Math.floor(k / grid));
    if (a === b) return dotBase + m(a);
    return index.get(`${Math.min(m(a), m(b))}-${Math.max(m(a), m(b))}`);
  };

  const rnd = seededRandom(seed * 131 + (grid === 3 ? 7 : mode === 'sym4' ? 99 : 3));
  const seen = new Set<string>();
  const glyphs: number[][] = [];
  for (let attempt = 0; attempt < 6000 && glyphs.length < GLYPH_COUNT; attempt++) {
    const used = new Set<number>();
    const order: number[] = [];
    const visited: number[] = [];
    let at = Math.floor(rnd() * grid * grid);
    visited.push(at);
    const target = grid === 3 ? 3 + Math.floor(rnd() * 3) : mode === 'sym4' ? 2 + Math.floor(rnd() * 3) : 4 + Math.floor(rnd() * 4);
    for (let guard = 0; order.length < target && guard < 40; guard++) {
      if (order.length > 0 && rnd() < 0.18) at = visited[Math.floor(rnd() * visited.length)]; // pen lift
      const options = adj[at].filter((o) => !used.has(o.e));
      if (!options.length) { at = Math.floor(rnd() * grid * grid); continue; }
      const o = options[Math.floor(rnd() * options.length)];
      used.add(o.e);
      order.push(o.e);
      at = o.to;
      visited.push(at);
    }
    let strokes = order;
    if (mode === 'sym4') {
      strokes = [];
      for (const e of order) {
        strokes.push(e);
        const me = mirror(e);
        if (me !== undefined && !used.has(me)) { used.add(me); strokes.push(me); }
      }
    }
    if (rnd() < 0.3) {
      const free = [...Array(grid * grid).keys()].filter((k) => !visited.includes(k));
      if (free.length) strokes.push(dotBase + free[Math.floor(rnd() * free.length)]);
    }
    strokes = strokes.slice(0, 10);
    // Legibility rules: ≥ 3 strokes, spans ≥ 2×2 nodes, ≤ 1 diagonal crossing, no duplicates.
    const lines = strokes.filter((e) => e < dotBase);
    if (lines.length < 3) continue;
    const touched = lines.flatMap((e) => nodesOf[e]);
    const xs = touched.map((k) => k % grid), ys = touched.map((k) => Math.floor(k / grid));
    if (Math.max(...xs) - Math.min(...xs) < 1 || Math.max(...ys) - Math.min(...ys) < 1) continue;
    let crossings = 0;
    for (const e of lines) {
      const [a, b] = nodesOf[e];
      const ai = a % grid, aj = Math.floor(a / grid), bi = b % grid, bj = Math.floor(b / grid);
      if (ai !== bi && aj !== bj && bj > aj) {
        // the other diagonal of the same cell
        const other = index.get(`${Math.min(node(ai, bj), node(bi, aj))}-${Math.max(node(ai, bj), node(bi, aj))}`);
        if (other !== undefined && lines.includes(other)) crossings++;
      }
    }
    if (crossings > 1) continue;
    const key = [...strokes].sort((a, b) => a - b).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    glyphs.push(strokes);
  }
  while (glyphs.length < GLYPH_COUNT) glyphs.push(glyphs[glyphs.length % Math.max(1, glyphs.length)] ?? [0, 1, 2]);

  const packed = new Int32Array(GLYPH_COUNT * 2);
  glyphs.forEach((strokes, g) => {
    for (let half = 0; half < 2; half++) {
      let word = 0;
      for (let k = 0; k < 5; k++) {
        const e = strokes[half * 5 + k] ?? 63;
        word |= (e & 63) << (6 * k);
      }
      packed[g * 2 + half] = word;
    }
  });
  const flat = new Float32Array(MAX_EDGES * 4);
  edges.forEach((e, i) => flat.set(e, i * 4));
  return { grid, edges, glyphs, packed, flat };
}

// ── the shader's hash, in JS (so the Canvas bake picks the same glyph per cell) ──

const f = Math.fround;
const fract = (x: number) => f(x - Math.floor(x));
export function hash12(x: number, y: number): number {
  let p0 = fract(f(x * f(0.1031)));
  let p1 = fract(f(y * f(0.1031)));
  let p2 = fract(f(x * f(0.1031)));
  const d = f(f(p0 * f(p1 + f(33.33))) + f(f(p1 * f(p2 + f(33.33))) + f(p2 * f(p0 + f(33.33)))));
  p0 = f(p0 + d); p1 = f(p1 + d); p2 = f(p2 + d);
  return fract(f(f(p0 + p1) * p2));
}

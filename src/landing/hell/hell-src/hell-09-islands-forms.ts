// COPIED from .claude/pages/ad/experiments/hell-src/hell-09-islands-forms.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-09 island FORMS: CPU geometry builders, run once at load.
 *
 * Every island is built in its own local space with its flat top at y = 0
 * and its mass hanging below. Most forms are "tier lofts" (research T1+T2):
 * a stack of rings whose outline is a radius per angle, r(θ). Sections that
 * should meet at a hard crease (top / wall / ledge / underside) get their
 * own vertices, so the toon light breaks crisply at every ledge lip.
 *
 * Extra per-vertex data for the shader:
 *   aSpill — metres below the nearest tier top above (lava glow spill);
 *   aEdge  — 0 in the middle of a flat top, ±1 at its rim (dark lip line);
 *   uv     — only the Eva shell uses it (along-length, across-height).
 */

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { seededRandom } from '../env-src/lab';

export type FormId = 'mesa' | 'clover' | 'cone' | 'shell' | 'crag' | 'causeway' | 'cubes';
export const FORM_INDEX: Record<FormId, number> = { mesa: 0, clover: 1, cone: 2, shell: 3, crag: 4, causeway: 5, cubes: 6 };

export type IslandShape = {
  form: FormId;
  /** The rock mass (for cubes: one unit box, instanced by `cubes`). */
  rock: THREE.BufferGeometry;
  /** Flat pools on the tier tops (null when the form has none). */
  caps: THREE.BufferGeometry | null;
  cubes?: { matrices: Float32Array; phases: Float32Array; count: number };
  top: number;
  waist: number;
  bottom: number;
  /** Footprint radius (metres). */
  radius: number;
  /** Radius of the waist ring per angle (N samples, absolute metres). */
  waistRing: Float32Array;
  /** Eva shell: length and half-height in metres (for hole / rib scale). */
  shellLH?: [number, number];
};

const TAU = Math.PI * 2;

// ── a tiny geometry accumulator ─────────────────────────────────────────

type Ring = { y: number; r: ArrayLike<number>; spill?: number; edge?: number; dy?: ArrayLike<number> };

class Mesher {
  pos: number[] = [];
  uv: number[] = [];
  spill: number[] = [];
  edge: number[] = [];
  idx: number[] = [];

  vertex(x: number, y: number, z: number, spill = 999, edge = 0, u = 0, v = 0): number {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    this.spill.push(spill);
    this.edge.push(edge);
    return this.pos.length / 3 - 1;
  }

  /**
   * A loft section: rings listed in SURFACE ORDER (from the top centre,
   * outward, down, then inward to the bottom tip). With that order the
   * triangles (a_i, a_i+1, b_i) face outward: tangent × down = outward.
   */
  section(rings: Ring[]) {
    const n = rings[0].r.length;
    const start = this.pos.length / 3;
    for (const ring of rings) {
      for (let i = 0; i < n; i++) {
        const th = (i / n) * TAU;
        const r = ring.r[i];
        this.vertex(r * Math.cos(th), ring.y + (ring.dy ? ring.dy[i] : 0), r * Math.sin(th), ring.spill ?? 999, ring.edge ?? 0, i / n, 0);
      }
    }
    for (let k = 0; k < rings.length - 1; k++) {
      for (let i = 0; i < n; i++) {
        const a = start + k * n + i;
        const a1 = start + k * n + ((i + 1) % n);
        const b = a + n;
        const b1 = a1 + n;
        this.idx.push(a, a1, b, a1, b1, b);
      }
    }
  }

  /** A downward-pointing cone (a hanging spike), then rotated to `dir`. */
  spike(base: THREE.Vector3, dir: THREE.Vector3, radius: number, length: number, sides = 6) {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
    const start = this.pos.length / 3;
    const v = new THREE.Vector3();
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * TAU;
      v.set(Math.cos(a) * radius, 0, Math.sin(a) * radius).applyQuaternion(q).add(base);
      this.vertex(v.x, v.y, v.z);
    }
    v.set(0, -length, 0).applyQuaternion(q).add(base);
    const tip = this.vertex(v.x, v.y, v.z);
    for (let j = 0; j < sides; j++) this.idx.push(start + j, start + ((j + 1) % sides), tip);
  }

  /** Append an indexed geometry (positions only) as its own section. */
  append(g: THREE.BufferGeometry) {
    const start = this.pos.length / 3;
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) this.vertex(p.getX(i), p.getY(i), p.getZ(i));
    const index = g.index!;
    for (let i = 0; i < index.count; i++) this.idx.push(start + index.getX(i));
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aSpill', new THREE.Float32BufferAttribute(this.spill, 1));
    g.setAttribute('aEdge', new THREE.Float32BufferAttribute(this.edge, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// ── outlines r(θ) (research T1) ──────────────────────────────────────────

const N = 128;

function normalise(r: Float32Array): Float32Array {
  let max = 0;
  for (const v of r) max = Math.max(max, v);
  for (let i = 0; i < r.length; i++) r[i] /= max;
  return r;
}

/** A short Fourier sum with random phases: organic lobes plus fine wobble. */
function fourier(rnd: () => number, lobes: number, depth: number, wobble: number, n = N): Float32Array {
  const p = Array.from({ length: 6 }, () => rnd() * TAU);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU;
    r[i] =
      1 +
      depth * Math.sin(lobes * th + p[0]) +
      depth * 0.45 * Math.sin(2 * lobes * th + p[1]) +
      wobble * (0.5 * Math.sin(7 * th + p[2]) + 0.3 * Math.sin(11 * th + p[3]) + 0.2 * Math.sin(17 * th + p[4]));
  }
  return normalise(r);
}

/** iq's polynomial smooth minimum. */
function smin(a: number, b: number, k: number): number {
  k *= 4;
  const h = Math.max(k - Math.abs(a - b), 0);
  return Math.min(a, b) - (h * h * 0.25) / k;
}

/**
 * A clover outline: a smooth union of 3–6 round lobes around a core disc,
 * cast to r(θ) by bisecting the 2D SDF along each ray (research T1, option 2).
 */
function clover(rnd: () => number, lobes: number, k: number, n = N): Float32Array {
  const circles: [number, number, number][] = [[0, 0, 0.5]];
  for (let j = 0; j < lobes; j++) {
    const a = (j / lobes) * TAU + (rnd() - 0.5) * 0.6;
    const d = 0.4 + rnd() * 0.16;
    circles.push([Math.cos(a) * d, Math.sin(a) * d, 0.3 + rnd() * 0.14]);
  }
  const sdf = (x: number, z: number) => {
    let d = 1e9;
    for (const [cx, cz, cr] of circles) d = smin(d, Math.hypot(x - cx, z - cz) - cr, k);
    return d;
  };
  const p1 = rnd() * TAU;
  const p2 = rnd() * TAU;
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU;
    const c = Math.cos(th);
    const s = Math.sin(th);
    let lo = 0;
    let hi = 1.6;
    for (let it = 0; it < 16; it++) {
      const mid = (lo + hi) / 2;
      if (sdf(c * mid, s * mid) < 0) lo = mid;
      else hi = mid;
    }
    r[i] = lo * (1 + 0.025 * Math.sin(13 * th + p1) + 0.012 * Math.sin(23 * th + p2));
  }
  return normalise(r);
}

/** A long slab outline: an elongated superellipse with chipped edges. */
function slab(rnd: () => number, width: number, n = 192): Float32Array {
  const p = Array.from({ length: 4 }, () => rnd() * TAU);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU;
    const c = Math.abs(Math.cos(th));
    const s = Math.abs(Math.sin(th)) / width;
    const e = 3.2;
    let v = Math.pow(Math.pow(c, e) + Math.pow(s, e), -1 / e);
    v *= 1 + 0.03 * Math.sin(29 * th + p[0]) + 0.02 * Math.sin(47 * th + p[1]) + 0.05 * Math.sin(5 * th + p[2]) * c;
    r[i] = v;
  }
  return normalise(r);
}

const scaled = (c: ArrayLike<number>, s: number, add = 0) => Float32Array.from(c, (v) => v * s + add);

/** Smooth angular noise, −1…1 (a few random sines). */
function angNoise(rnd: () => number, n = N, base = 3): Float32Array {
  const p = Array.from({ length: 4 }, () => rnd() * TAU);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU;
    out[i] = 0.5 * Math.sin(base * th + p[0]) + 0.3 * Math.sin((base * 2 + 1) * th + p[1]) + 0.2 * Math.sin((base * 4 + 3) * th + p[2]);
  }
  return out;
}

// ── the tier loft (research T2) ──────────────────────────────────────────

type TierPlan = {
  /** Outline of each tier, top first, in units of R (≤ 1). */
  contours: Float32Array[];
  /** Riser (wall) height of each tier, in units of R. */
  risers: number[];
  /** Underside depth in units of R, its taper power and jaggedness. */
  under: { depth: number; power: number; jag: number; lobes: number; hang?: number };
  /** Spikes hanging from the underside (inverted cone). */
  spikes?: number;
  /** Width of the dark rock lip left round each cap pool (units of R). */
  lip: number;
};

function tieredIsland(form: FormId, R: number, plan: TierPlan, rnd: () => number): IslandShape {
  const n = plan.contours[0].length;
  const rock = new Mesher();
  const caps = new Mesher();
  const zero = new Float32Array(n);
  const ringStep = Math.max(0.8, R * 0.025);
  let y = 0;
  let tierTop = 0;
  // Top fan of the first tier.
  const c0 = scaled(plan.contours[0], R);
  rock.section([
    { y: 0, r: zero, spill: 0, edge: 0 },
    { y: 0, r: c0, spill: 0, edge: 1 },
  ]);
  caps.section([
    { y: 0, r: zero, edge: 0 },
    { y: 0, r: scaled(c0, 1, -plan.lip * R), edge: 1 },
  ]);
  let wallBottom = c0;
  for (let t = 0; t < plan.contours.length; t++) {
    const top = t === 0 ? c0 : scaled(plan.contours[t], R);
    // Wall: rings every ~2.5% of R; a slight outward batter and per-ring jitter.
    const h = plan.risers[t] * R;
    const rings: Ring[] = [];
    const steps = Math.max(2, Math.ceil(h / ringStep));
    const jit = angNoise(rnd, n, 4);
    for (let k = 0; k <= steps; k++) {
      const f = k / steps;
      const ry = y - h * f;
      const amp = 0.012 * (rnd() - 0.3);
      rings.push({
        y: ry,
        r: Float32Array.from(top, (v, i) => v * (1 + 0.035 * f + amp * jit[i]) + (k === 0 ? 0 : 0)),
        spill: tierTop - ry,
      });
    }
    rock.section(rings);
    y -= h;
    wallBottom = Float32Array.from(rings[rings.length - 1].r);
    // Ledge out to the next tier's outline.
    if (t < plan.contours.length - 1) {
      const next = Float32Array.from(plan.contours[t + 1], (v, i) => Math.max(v * R, wallBottom[i] + R * 0.06));
      plan.contours[t + 1] = scaled(next, 1 / R);
      rock.section([
        { y, r: wallBottom, spill: 0, edge: -1 },
        { y, r: next, spill: 0, edge: 1 },
      ]);
      caps.section([
        { y, r: scaled(wallBottom, 1, plan.lip * R * 0.5), edge: -1 },
        { y, r: scaled(next, 1, -plan.lip * R), edge: 1 },
      ]);
      tierTop = y;
    }
  }
  const waist = y;
  // Underside: taper to a tip, ridged outline and a jagged, uneven depth.
  const u = plan.under;
  const ridgePhase = rnd() * TAU;
  const warp = angNoise(rnd, n, 3);
  const under: Ring[] = [];
  const steps = 14;
  for (let k = 0; k <= steps; k++) {
    const f = k / steps;
    const ridge = Float32Array.from({ length: n }, (_, i) => {
      const th = (i / n) * TAU;
      return Math.pow(Math.abs(Math.sin((u.lobes * th) / 2 + ridgePhase + warp[i] * 0.8)), 0.7);
    });
    under.push({
      y: waist - u.depth * R * Math.pow(f, 0.9),
      r: Float32Array.from(wallBottom, (v, i) => (k === steps ? 0 : v * Math.pow(1 - f, u.power) * (1 - u.jag * f * (1 - ridge[i])))),
      dy: Float32Array.from(ridge, (v, i) => -(u.hang ?? 0) * R * f * f * Math.pow(v, 6) * (0.6 + 0.4 * warp[i])),
    });
  }
  rock.section(under);
  // Hanging spikes (the inverted cone).
  for (let s = 0; s < (plan.spikes ?? 0); s++) {
    const i = Math.floor(rnd() * n);
    const th = (i / n) * TAU;
    const f = 0.3 + rnd() * 0.45;
    const rr = wallBottom[i] * Math.pow(1 - f, u.power) * 0.85;
    const base = new THREE.Vector3(Math.cos(th) * rr, waist - u.depth * R * f, Math.sin(th) * rr);
    const dir = new THREE.Vector3(Math.cos(th) * 0.25, -1, Math.sin(th) * 0.25);
    spikesAt(rock, base, dir, R * (0.04 + rnd() * 0.05), R * (0.2 + rnd() * 0.45));
  }
  return {
    form,
    rock: rock.build(),
    caps: caps.build(),
    top: 0,
    waist,
    bottom: waist - u.depth * R * 1.05 - (u.hang ?? 0) * R,
    radius: R,
    waistRing: Float32Array.from(wallBottom),
  };
}

function spikesAt(m: Mesher, base: THREE.Vector3, dir: THREE.Vector3, radius: number, length: number) {
  m.spike(base, dir, radius, length, 6);
}

// ── the forms ───────────────────────────────────────────────────────────

/** Stratified flat-topped mesa (Hell Verse L3): tall risers, one or two ledges. */
export function mesa(R: number, seed: number): IslandShape {
  const rnd = seededRandom(seed);
  const top = fourier(rnd, 3 + Math.floor(rnd() * 3), 0.06, 0.06);
  const mid = fourier(rnd, 3 + Math.floor(rnd() * 2), 0.07, 0.05);
  return tieredIsland(
    'mesa',
    R,
    {
      contours: [scaled(top, 0.8), scaled(mid, 1.0)],
      risers: [0.34, 0.26],
      under: { depth: 0.55, power: 0.8, jag: 0.3, lobes: 7 },
      lip: 0.03,
    },
    rnd,
  );
}

/** Terraced clover-leaf tiers: 3–5 stepped levels with wavy contour edges. */
export function cloverTiers(R: number, seed: number): IslandShape {
  const rnd = seededRandom(seed);
  const tiers = 3 + Math.floor(rnd() * 3);
  const contours: Float32Array[] = [];
  const risers: number[] = [];
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    contours.push(scaled(clover(rnd, 3 + Math.floor(rnd() * 3), 0.04 + rnd() * 0.05), 0.42 + 0.58 * f));
    risers.push(t === tiers - 1 ? 0.26 : 0.06 + rnd() * 0.04);
  }
  return tieredIsland('clover', R, { contours, risers, under: { depth: 0.5, power: 0.85, jag: 0.35, lobes: 9 }, lip: 0.025 }, rnd);
}

/** Inverted cone: a short flat-topped crown over a long ridged taper with hanging spikes. */
export function invertedCone(R: number, seed: number): IslandShape {
  const rnd = seededRandom(seed);
  const top = fourier(rnd, 5, 0.05, 0.1);
  return tieredIsland(
    'cone',
    R,
    {
      contours: [top],
      risers: [0.14],
      under: { depth: 1.45, power: 0.75, jag: 0.55, lobes: 11, hang: 0.35 },
      spikes: 10 + Math.floor(rnd() * 6),
      lip: 0.04,
    },
    rnd,
  );
}

/** Flat causeway slab (Inuyasha FA): a long thin plate, crisp lip, nothing else. */
export function causeway(R: number, seed: number): IslandShape {
  const rnd = seededRandom(seed);
  const outline = slab(rnd, 0.26 + rnd() * 0.08);
  return tieredIsland(
    'causeway',
    R,
    {
      contours: [outline],
      risers: [0.05],
      under: { depth: 0.07, power: 0.6, jag: 0.15, lobes: 21 },
      lip: 0.015,
    },
    rnd,
  );
}

// 3D value noise for the crag lobes (CPU).
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(fx);
  const v = s(fy);
  const w = s(fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

/**
 * Eroded crag (Bleach ep 147): a heap of noise-displaced lobes, tall rounded
 * shoulders stacked on a core (research T5). Caves and drips are shader work.
 */
export function crag(R: number, seed: number): IslandShape {
  const rnd = seededRandom(seed);
  const m = new Mesher();
  const lobes: { c: THREE.Vector3; s: THREE.Vector3 }[] = [];
  lobes.push({ c: new THREE.Vector3(0, -0.5 * R, 0), s: new THREE.Vector3(0.78, 0.62, 0.72).multiplyScalar(R) });
  lobes.push({ c: new THREE.Vector3(0, -1.0 * R, 0), s: new THREE.Vector3(0.5, 0.45, 0.48).multiplyScalar(R) });
  const shoulders = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < shoulders; i++) {
    const a = (i / shoulders) * TAU + rnd() * 0.6;
    const d = R * (0.45 + rnd() * 0.2);
    const r = R * (0.32 + rnd() * 0.16);
    lobes.push({ c: new THREE.Vector3(Math.cos(a) * d, -R * (0.45 + rnd() * 0.25), Math.sin(a) * d), s: new THREE.Vector3(r, r * (1.1 + rnd() * 0.4), r) });
  }
  const peaks = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < peaks; i++) {
    const a = rnd() * TAU;
    const d = R * rnd() * 0.35;
    const r = R * (0.24 + rnd() * 0.12);
    lobes.push({ c: new THREE.Vector3(Math.cos(a) * d, -R * (0.05 + rnd() * 0.15), Math.sin(a) * d), s: new THREE.Vector3(r, r * (1.5 + rnd() * 0.6), r) });
  }
  let maxY = -1e9;
  let minY = 1e9;
  const geos: THREE.BufferGeometry[] = [];
  for (const lobe of lobes) {
    let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 3);
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    g = mergeVertices(g);
    const p = g.attributes.position as THREE.BufferAttribute;
    const o = rnd() * 50;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const d = 1 + 0.2 * (noise3(x * 1.8 + o, y * 1.8, z * 1.8) - 0.5) + 0.08 * (noise3(x * 4.5, y * 4.5 + o, z * 4.5) - 0.5);
      // Squash the very top a little so peaks read as worn domes.
      const yy = y > 0.6 ? 0.6 + (y - 0.6) * 0.7 : y;
      const X = lobe.c.x + x * d * lobe.s.x;
      const Y = lobe.c.y + yy * d * lobe.s.y;
      const Z = lobe.c.z + z * d * lobe.s.z;
      p.setXYZ(i, X, Y, Z);
      maxY = Math.max(maxY, Y);
      minY = Math.min(minY, Y);
    }
    geos.push(g);
  }
  for (const g of geos) {
    g.translate(0, -maxY, 0);
    m.append(g);
  }
  const height = maxY - minY;
  const waist = -height * 0.62;
  return {
    form: 'crag',
    rock: m.build(),
    caps: null,
    top: 0,
    waist,
    bottom: -height,
    radius: R,
    waistRing: new Float32Array(N).fill(R * 0.85),
  };
}

/**
 * Eva C1477 shell: a long, twisted, rounded slab swept along a wavy spine
 * (a tube whose cross-section is a squashed superellipse). Ribs, red streaks
 * and the bored holes are drawn in the shader from its uv.
 */
export function evaShell(R: number, seed: number): IslandShape {
  const rnd = seededRandom(seed);
  const U = 150;
  const W = 48;
  const L = 2.3 * R;
  const A = 0.32 * R;
  const ph = Array.from({ length: 6 }, () => rnd() * TAU);
  const m = new Mesher();
  const start = 0;
  const up = new THREE.Vector3(0, 1, 0);
  const C = (uu: number) => new THREE.Vector3((uu - 0.5) * L, 0, A * Math.sin(TAU * 1.1 * uu + ph[0]));
  let maxY = -1e9;
  let minY = 1e9;
  for (let iu = 0; iu <= U; iu++) {
    const uu = iu / U;
    const c = C(uu);
    const t = C(Math.min(1, uu + 0.001)).sub(C(Math.max(0, uu - 0.001))).normalize();
    const side = new THREE.Vector3(-t.z, 0, t.x).normalize();
    const lean = 0.5 * Math.sin(TAU * 0.8 * uu + ph[1]);
    const e = Math.max(Math.pow(Math.max(Math.sin(Math.PI * uu), 0), 0.35), 0.04);
    const H = R * (0.75 + 0.28 * Math.sin(Math.PI * uu * 2.1 + ph[2])) * e;
    const T = R * (0.1 + 0.06 * Math.sin(uu * 9 + ph[3])) * Math.sqrt(e);
    const yOff = R * 0.18 * Math.sin(uu * 5 + ph[4]);
    for (let iw = 0; iw < W; iw++) {
      const a = (iw / W) * TAU;
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      const v = Math.sign(sn) * Math.pow(Math.abs(sn), 0.5);
      let sx = T * Math.sign(cs) * Math.pow(Math.abs(cs), 0.35);
      const sy = H * v;
      sx += R * 0.22 * Math.sin(Math.PI * (v * 0.5 + 0.5) * 1.2 + uu * 5 + ph[5]);
      const X = sx * Math.cos(lean) - sy * Math.sin(lean);
      const Y = sx * Math.sin(lean) + sy * Math.cos(lean);
      const P = c.clone().addScaledVector(side, X).addScaledVector(up, Y + yOff);
      m.vertex(P.x, P.y, P.z, 999, 0, uu, v);
      maxY = Math.max(maxY, P.y);
      minY = Math.min(minY, P.y);
    }
  }
  for (let iu = 0; iu < U; iu++) {
    for (let iw = 0; iw < W; iw++) {
      const a = start + iu * W + iw;
      const a1 = start + iu * W + ((iw + 1) % W);
      const b = a + W;
      const b1 = a1 + W;
      m.idx.push(a, b, a1, a1, b, b1);
    }
  }
  for (let i = 1; i < m.pos.length; i += 3) m.pos[i] -= maxY;
  const g = m.build();
  // Make sure the winding faces outward (flip if the average normal points in).
  const p = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  let score = 0;
  const centre = new THREE.Vector3(0, -(maxY - minY) / 2, 0);
  for (let i = 0; i < p.count; i += 7) {
    const iu = Math.floor(i / W) / U;
    const cc = C(iu).add(centre);
    score += (p.getX(i) - cc.x) * nrm.getX(i) + (p.getY(i) - cc.y) * nrm.getY(i) + (p.getZ(i) - cc.z) * nrm.getZ(i);
  }
  if (score < 0) {
    const idx = g.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const b = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, b);
    }
    g.computeVertexNormals();
  }
  const height = maxY - minY;
  return {
    form: 'shell',
    rock: g,
    caps: null,
    top: 0,
    waist: -height * 0.6,
    bottom: -height,
    radius: R,
    waistRing: new Float32Array(N).fill(R * 0.7),
    shellLH: [L, height * 0.5],
  };
}

/**
 * Floating cube cluster (Hell Verse first level): hewn blocks packed in a
 * lens — flat on top, tapering below — each with a small snapped tilt.
 */
export function cubeCluster(R: number, seed: number): IslandShape {
  const rnd = seededRandom(seed);
  const count = Math.min(170, Math.floor(50 + R * 1.1));
  const matrices = new Float32Array(count * 16);
  const phases = new Float32Array(count * 2);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  let minY = 0;
  for (let i = 0; i < count; i++) {
    const rr = R * Math.sqrt(rnd());
    const a = rnd() * TAU;
    const edge = rr / R;
    const depth = R * 0.85 * (1 - edge * edge) + R * 0.08;
    const y = -Math.pow(rnd(), 1.6) * depth;
    const size = R * (0.06 + rnd() * 0.14) * (1 - 0.45 * (-y / (R * 0.9))) * (i < 8 ? 1.6 : 1);
    const snap = (v: number) => Math.round(v / 0.07) * 0.07;
    e.set(snap((rnd() - 0.5) * 0.3), rnd() * TAU, snap((rnd() - 0.5) * 0.3));
    q.setFromEuler(e);
    pos.set(Math.cos(a) * rr, y - size * 0.5, Math.sin(a) * rr);
    scl.set(size * (0.8 + rnd() * 0.5), size * (0.7 + rnd() * 0.5), size * (0.8 + rnd() * 0.5));
    m.compose(pos, q, scl);
    m.toArray(matrices, i * 16);
    phases[i * 2] = rnd() * TAU;
    phases[i * 2 + 1] = R * (0.004 + rnd() * 0.012) * (0.3 + edge);
    minY = Math.min(minY, y - size);
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.setAttribute('aSpill', new THREE.Float32BufferAttribute(new Float32Array(box.attributes.position.count).fill(999), 1));
  box.setAttribute('aEdge', new THREE.Float32BufferAttribute(new Float32Array(box.attributes.position.count), 1));
  return {
    form: 'cubes',
    rock: box,
    caps: null,
    cubes: { matrices, phases, count },
    top: 0,
    waist: minY * 0.45,
    bottom: minY,
    radius: R,
    waistRing: new Float32Array(N).fill(R * 0.8),
  };
}

export function buildForm(form: FormId, R: number, seed: number): IslandShape {
  switch (form) {
    case 'mesa':
      return mesa(R, seed);
    case 'clover':
      return cloverTiers(R, seed);
    case 'cone':
      return invertedCone(R, seed);
    case 'shell':
      return evaShell(R, seed);
    case 'crag':
      return crag(R, seed);
    case 'causeway':
      return causeway(R, seed);
    case 'cubes':
      return cubeCluster(R, seed);
  }
}

// COPIED from .claude/pages/ad/experiments/hell-src/hell-07-bones-geo.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-07 geometry kit: everything the bones are made of, built once at load.
 *
 * - `BoneBuilder` collects triangles from several parts into ONE geometry
 *   (one draw call per mesh) with the attribute set the bone shader reads:
 *   position, normal, uv (in world-ish units, for the crack field) and
 *   aBone = (ink width 0…1, thinness 0…1 for back-light translucency).
 * - `addSweep`  : a flattened tube swept along a list of sections (ribs).
 * - `addLathe`  : a revolved profile (vertebrae, knobbed spikes, limb bones).
 * - `surfaceNets`: meshes a signed distance function once (the skulls).
 * - `beastSkull` / `humanSkull`: the two skull SDFs.
 *
 * Nothing here runs per frame.
 */

import * as THREE from 'three';

// ── tiny vector helpers on plain numbers (fast SDF evaluation) ─────────

const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);

function smin(a: number, b: number, k: number): number {
  // iq polynomial smooth minimum, k in distance units
  k *= 4;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

function sdEllipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number): number {
  const k0 = len3(x / rx, y / ry, z / rz);
  const k1 = len3(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return (k0 * (k0 - 1)) / Math.max(k1, 1e-6);
}

function sdCapsule(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r: number,
): number {
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  return len3(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}

/** iq round cone between two points (fangs, horns). */
function sdRoundCone(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r1: number, r2: number,
): number {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

// ── skull SDFs (object space: snout toward +z, up +y, about 1 unit big) ─

export type SkullOptions = { jaw: number; chips: boolean };

/** A fanged beast skull (Inuyasha Tomb / Hell Verse gate): a compact
 *  braincase, a heavy brow over big slanted sockets, cheek arches, a crest,
 *  and a long tapering snout over an open jaw full of fangs. */
export function beastSkull(opts: SkullOptions): (x: number, y: number, z: number) => number {
  const ca = Math.cos(opts.jaw);
  const sa = Math.sin(opts.jaw);
  // chips: small random bites out of the edges (weathering "chips")
  const rand = mulberry(77);
  const chips: number[][] = [];
  if (opts.chips) {
    for (let i = 0; i < 9; i++) {
      chips.push([(rand() - 0.5) * 1.4, 0.5 + rand() * 1.1, -1 + rand() * 2.8, 0.09 + rand() * 0.12]);
    }
  }
  return (x, y, z) => {
    const ax = Math.abs(x);
    // braincase behind the eyes
    let d = sdEllipsoid(x, y - 0.95, z + 0.45, 0.68, 0.6, 0.85);
    // heavy brow ridge over the sockets (gives the angry read)
    d = smin(d, sdCapsule(ax, y, z, 0.0, 1.2, 0.38, 0.5, 1.1, 0.5, 0.15), 0.14);
    // snout: two round cones side by side = a wide, flat-topped muzzle tapering to the nose
    d = smin(d, sdRoundCone(ax, y, z, 0.18, 0.8, 0.3, 0.12, 0.64, 2.05, 0.36, 0.2), 0.24);
    // cheek arches standing out from the braincase
    d = smin(d, sdCapsule(ax, y, z, 0.7, 0.74, -0.4, 0.5, 0.62, 0.72, 0.12), 0.1);
    // sagittal crest along the top, sweeping back
    d = smin(d, sdCapsule(x, y, z, 0, 1.52, 0.1, 0, 1.3, -1.2, 0.09), 0.2);
    // big slanted eye sockets, nostrils
    d = smax(d, -sdEllipsoid(ax - 0.4, y - 0.93 - (ax - 0.4) * 0.35, z - 0.58, 0.26, 0.21, 0.4), 0.05);
    d = smax(d, -sdEllipsoid(ax - 0.1, y - 0.74, z - 2.12, 0.08, 0.1, 0.2), 0.03);
    // upper fangs along the jaw line; the 2nd from the front is a long canine
    for (let k = 0; k < 6; k++) {
      const tz = 1.95 - k * 0.28;
      const tx = 0.25 + (1.95 - tz) * 0.12;
      const L = k === 1 ? 0.6 : 0.24 - k * 0.015;
      d = Math.min(d, sdRoundCone(ax, y, z, tx, 0.5, tz, tx - 0.03, 0.5 - L, tz + 0.04, 0.07, 0.008));
    }
    // mandible, rotated about the hinge (jaw open)
    const qy0 = y - 0.45;
    const qz0 = z + 0.35;
    const my = qy0 * ca + qz0 * sa;
    const mz = -qy0 * sa + qz0 * ca;
    let m = sdCapsule(ax, my, mz, 0.55, 0, 0, 0.22, -0.06, 2.1, 0.13);
    m = smin(m, sdCapsule(ax, my, mz, 0.0, -0.08, 2.12, 0.22, -0.06, 2.1, 0.13), 0.08);
    m = smin(m, sdCapsule(ax, my, mz, 0.55, 0, 0.05, 0.52, 0.36, 0.25, 0.09), 0.08);
    for (let k = 0; k < 5; k++) {
      const tz = 1.95 - k * 0.3;
      const tx = 0.2 + k * 0.05;
      const L = k === 1 ? 0.42 : 0.17;
      m = Math.min(m, sdRoundCone(ax, my, mz, tx, 0.04, tz, tx - 0.02, 0.04 + L, tz - 0.03, 0.06, 0.008));
    }
    d = Math.min(d, m);
    for (const [cx, cy, cz, r] of chips) d = smax(d, -len3(x - cx, y - cy, z - cz) + r, 0.03);
    return d;
  };
}

/** A round human-ish skull (Eva C1104): big cranium, short face, row of teeth. */
export function humanSkull(): (x: number, y: number, z: number) => number {
  return (x, y, z) => {
    const ax = Math.abs(x);
    let d = sdEllipsoid(x, y - 0.2, z + 0.1, 0.82, 0.8, 0.95);
    d = smin(d, sdEllipsoid(x, y + 0.36, z - 0.38, 0.6, 0.52, 0.55), 0.25);
    d = smin(d, sdCapsule(ax, y, z, 0.55, -0.32, 0.38, 0.66, -0.22, -0.12, 0.12), 0.12);
    d = smin(d, sdEllipsoid(x, y + 0.8, z - 0.5, 0.42, 0.2, 0.36), 0.1);
    d = smax(d, -sdEllipsoid(ax - 0.3, y + 0.08, z - 0.74, 0.25, 0.23, 0.32), 0.05);
    d = smax(d, -sdEllipsoid(x, y + 0.42, z - 0.86, 0.11, 0.16, 0.25), 0.04);
    // tooth gap line
    d = smax(d, -sdEllipsoid(x, y + 0.82, z - 0.82, 0.38, 0.025, 0.12), 0.01);
    return d;
  };
}

// ── surface nets mesher ─────────────────────────────────────────────────

export type SdfMesh = { positions: Float32Array; normals: Float32Array; indices: Uint32Array };

/** Naive surface nets (0fps): one vertex per sign-changing cell at the mean
 *  of its edge crossings, one quad per sign-changing grid edge. Normals come
 *  from the SDF gradient (iq tetrahedron), so a coarse net still shades smooth. */
export function surfaceNets(
  f: (x: number, y: number, z: number) => number,
  min: [number, number, number],
  max: [number, number, number],
  step: number,
): SdfMesh {
  const nx = Math.ceil((max[0] - min[0]) / step) + 1;
  const ny = Math.ceil((max[1] - min[1]) / step) + 1;
  const nz = Math.ceil((max[2] - min[2]) / step) + 1;
  const val = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        val[i + nx * (j + ny * k)] = f(min[0] + i * step, min[1] + j * step, min[2] + k * step);

  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cell = new Int32Array(cx * cy * cz).fill(-1);
  const pos: number[] = [];
  // the 12 cube edges as corner-index pairs (corner bit 0 = x, 1 = y, 2 = z)
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < cz; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = val[i + (c & 1) + nx * (j + ((c >> 1) & 1) + ny * (k + ((c >> 2) & 1)))];
          cv[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of edges) {
          const va = cv[a], vb = cv[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += (a & 1) + ((b & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          n++;
        }
        cell[i + cx * (j + cy * k)] = pos.length / 3;
        pos.push(min[0] + (i + sx / n) * step, min[1] + (j + sy / n) * step, min[2] + (k + sz / n) * step);
      }

  const idx: number[] = [];
  const C = (i: number, j: number, k: number) => cell[i + cx * (j + cy * k)];
  const quad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    idx.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v0 = val[i + nx * (j + ny * k)] < 0;
        // x edge: cells (i, j-1..j, k-1..k)
        if (i < cx && j > 0 && k > 0 && j < cy && k < cz && v0 !== val[i + 1 + nx * (j + ny * k)] < 0)
          quad(C(i, j, k), C(i, j - 1, k), C(i, j - 1, k - 1), C(i, j, k - 1));
        if (j < cy && i > 0 && k > 0 && i < cx && k < cz && v0 !== val[i + nx * (j + 1 + ny * k)] < 0)
          quad(C(i, j, k), C(i - 1, j, k), C(i - 1, j, k - 1), C(i, j, k - 1));
        if (k < cz && i > 0 && j > 0 && i < cx && j < cy && v0 !== val[i + nx * (j + ny * (k + 1))] < 0)
          quad(C(i, j, k), C(i - 1, j, k), C(i - 1, j - 1, k), C(i, j - 1, k));
      }

  // analytic normals from the SDF gradient
  const positions = new Float32Array(pos);
  const normals = new Float32Array(pos.length);
  const h = step * 0.5;
  for (let v = 0; v < pos.length; v += 3) {
    const x = pos[v], y = pos[v + 1], z = pos[v + 2];
    const a = f(x + h, y - h, z - h);
    const b = f(x - h, y - h, z + h);
    const c = f(x - h, y + h, z - h);
    const d = f(x + h, y + h, z + h);
    const gx = a - b - c + d, gy = -a - b + c + d, gz = -a + b - c + d;
    const l = len3(gx, gy, gz) || 1;
    normals[v] = gx / l;
    normals[v + 1] = gy / l;
    normals[v + 2] = gz / l;
  }
  return { positions, normals, indices: new Uint32Array(idx) };
}

// ── the builder ─────────────────────────────────────────────────────────

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

export class BoneBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  bone: number[] = [];
  idx: number[] = [];

  vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, ink: number, thin: number): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.bone.push(ink, thin);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }

  /** Final geometry. Every triangle is re-wound to agree with its vertex
   *  normals, so the builders never have to care about winding. */
  geometry(): THREE.BufferGeometry {
    const P = this.pos, N = this.nor, I = this.idx;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
      const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
      const sx = N[a] + N[b] + N[c], sy = N[a + 1] + N[b + 1] + N[c + 1], sz = N[a + 2] + N[b + 2] + N[c + 2];
      if (fx * sx + fy * sy + fz * sz < 0) {
        const tmp = I[t + 1];
        I[t + 1] = I[t + 2];
        I[t + 2] = tmp;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aBone', new THREE.Float32BufferAttribute(this.bone, 2));
    g.setIndex(I);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export type Section = { c: THREE.Vector3; a: THREE.Vector3; w: number; h: number };

/**
 * Sweep a flattened tube through `secs` (T1 ribbon ribs). `a` is the WIDE
 * axis of the band (the spine axis for a rib), so the frame is known and
 * never flips (no Frenet). Optional caps; a `jag` > 0 splinters the end cap
 * (a broken rib end, T17).
 */
export function addSweep(
  b: BoneBuilder,
  secs: Section[],
  ring: number,
  opts: { capStart?: number; capEnd?: number; seed?: number; thinTip?: boolean } = {},
) {
  const tangent = new THREE.Vector3();
  const A = new THREE.Vector3();
  const N = new THREE.Vector3();
  const rand = mulberry(opts.seed ?? 1);
  let arc = 0;
  const base = b.pos.length / 3;
  const frames: { A: THREE.Vector3; N: THREE.Vector3; t: THREE.Vector3 }[] = [];
  for (let i = 0; i < secs.length; i++) {
    const s = secs[i];
    const prev = secs[Math.max(0, i - 1)].c;
    const next = secs[Math.min(secs.length - 1, i + 1)].c;
    tangent.subVectors(next, prev).normalize();
    A.copy(s.a).addScaledVector(tangent, -s.a.dot(tangent)).normalize();
    N.crossVectors(tangent, A).normalize();
    frames.push({ A: A.clone(), N: N.clone(), t: tangent.clone() });
    if (i > 0) arc += s.c.distanceTo(secs[i - 1].c);
    const perim = Math.PI * 2 * Math.sqrt((s.w * s.w + s.h * s.h) / 2);
    const tAlong = i / (secs.length - 1);
    for (let j = 0; j <= ring; j++) {
      const th = (j / ring) * Math.PI * 2;
      const c = Math.cos(th), sn = Math.sin(th);
      _p.copy(s.c).addScaledVector(A, c * s.w).addScaledVector(N, sn * s.h);
      _n.copy(A).multiplyScalar(c / s.w).addScaledVector(N, sn / s.h).normalize();
      // thin = band edges (and the tip) glow when back-lit
      const edge = Math.pow(Math.abs(c), 6) * (s.w > s.h * 1.6 ? 1 : 0.35);
      const thin = Math.min(1, 0.15 + edge * 0.8 + (opts.thinTip ? tAlong * tAlong * 0.4 : 0));
      b.vert(_p, _n, (j / ring) * perim, arc, 1, thin);
    }
  }
  const R = ring + 1;
  for (let i = 0; i < secs.length - 1; i++)
    for (let j = 0; j < ring; j++) {
      const a = base + i * R + j;
      b.tri(a, a + R, a + 1);
      b.tri(a + 1, a + R, a + R + 1);
    }
  // caps: >0 = rounded nub (that length), <0 = jagged break (that jag size)
  const cap = (end: boolean, kind: number) => {
    const s = secs[end ? secs.length - 1 : 0];
    const f = frames[end ? secs.length - 1 : 0];
    const dir = f.t.clone().multiplyScalar(end ? 1 : -1);
    const ringStart = base + (end ? secs.length - 1 : 0) * R;
    if (kind < 0) {
      // splinter: move the rim vertices back and forth along the bone
      const jag = -kind;
      const rim: number[] = [];
      for (let j = 0; j <= ring; j++) {
        const id = ringStart + j;
        const off = j === ring ? rim[0] : (rand() - 0.35) * jag;
        rim.push(off);
        b.pos[id * 3] += dir.x * off;
        b.pos[id * 3 + 1] += dir.y * off;
        b.pos[id * 3 + 2] += dir.z * off;
      }
      // a fan to a sunken centre, with its own flat normals
      const centre = s.c.clone().addScaledVector(dir, -jag * 0.3);
      const ci = b.vert(centre, dir, 0, 0, 0.6, 0.5);
      const first = b.pos.length / 3;
      for (let j = 0; j <= ring; j++) {
        const id = ringStart + j;
        _p.set(b.pos[id * 3], b.pos[id * 3 + 1], b.pos[id * 3 + 2]);
        b.vert(_p, dir, b.uv[id * 2], b.uv[id * 2 + 1], 0.6, 0.5);
      }
      for (let j = 0; j < ring; j++) b.tri(ci, first + j, first + j + 1);
    } else if (kind > 0) {
      // rounded nub: a few shrinking rings then a pole
      const steps = 3;
      let prev = ringStart;
      for (let q = 1; q <= steps; q++) {
        const ang = (q / steps) * Math.PI * 0.5;
        const sc = Math.cos(ang);
        const ad = Math.sin(ang) * kind;
        const rowStart = b.pos.length / 3;
        for (let j = 0; j <= ring; j++) {
          const th = (j / ring) * Math.PI * 2;
          const c = Math.cos(th), sn = Math.sin(th);
          _p.copy(s.c).addScaledVector(f.A, c * s.w * sc).addScaledVector(f.N, sn * s.h * sc).addScaledVector(dir, ad);
          _n.copy(f.A).multiplyScalar((c / s.w) * sc).addScaledVector(f.N, (sn / s.h) * sc).addScaledVector(dir, Math.sin(ang) / Math.max(s.h, 0.01)).normalize();
          b.vert(_p, _n, 0, 0, 1, 0.6);
        }
        for (let j = 0; j < ring; j++) {
          b.tri(prev + j, rowStart + j, prev + j + 1);
          b.tri(prev + j + 1, rowStart + j, rowStart + j + 1);
        }
        prev = rowStart;
      }
    }
  };
  if (opts.capStart) cap(false, opts.capStart);
  if (opts.capEnd) cap(true, opts.capEnd);
}

/** Revolve a profile [(radius, height)…] about +Y, then place it with `m`. */
export function addLathe(
  b: BoneBuilder,
  profile: [number, number][],
  segs: number,
  m: THREE.Matrix4,
  opts: { ink?: number; thin?: number; uvScale?: number } = {},
) {
  _m3.getNormalMatrix(m);
  const base = b.pos.length / 3;
  const uvScale = opts.uvScale ?? 1;
  const scale = new THREE.Vector3().setFromMatrixScale(m);
  const sAvg = (scale.x + scale.y + scale.z) / 3;
  let arc = 0;
  for (let k = 0; k < profile.length; k++) {
    const [r, y] = profile[k];
    const [r0, y0] = profile[Math.max(0, k - 1)];
    const [r1, y1] = profile[Math.min(profile.length - 1, k + 1)];
    let nx = y1 - y0;
    let ny = -(r1 - r0);
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    if (k > 0) arc += Math.hypot(r - r0, y - y0);
    for (let j = 0; j <= segs; j++) {
      const ph = (j / segs) * Math.PI * 2;
      const c = Math.cos(ph), s = Math.sin(ph);
      _p.set(r * c, y, r * s).applyMatrix4(m);
      _n.set(nx * c, ny, nx * s).applyMatrix3(_m3).normalize();
      b.vert(_p, _n, (j / segs) * Math.PI * 2 * Math.max(r, 0.3) * sAvg * uvScale, arc * sAvg * uvScale, opts.ink ?? 1, opts.thin ?? 0.2);
    }
  }
  const R = segs + 1;
  for (let k = 0; k < profile.length - 1; k++)
    for (let j = 0; j < segs; j++) {
      const a = base + k * R + j;
      b.tri(a, a + R, a + 1);
      b.tri(a + 1, a + R, a + R + 1);
    }
}

/** Place an SDF mesh with matrix `m`; uv from a spherical wrap (seam at the back). */
export function addSdf(b: BoneBuilder, mesh: SdfMesh, m: THREE.Matrix4, uvScale: number) {
  _m3.getNormalMatrix(m);
  const base = b.pos.length / 3;
  const P = mesh.positions, N = mesh.normals;
  for (let v = 0; v < P.length; v += 3) {
    const x = P[v], y = P[v + 1], z = P[v + 2];
    _p.set(x, y, z).applyMatrix4(m);
    _n.set(N[v], N[v + 1], N[v + 2]).applyMatrix3(_m3).normalize();
    b.vert(_p, _n, Math.atan2(x, z) * 1.2 * uvScale, y * uvScale, 1, 0.2);
  }
  for (let i = 0; i < mesh.indices.length; i++) b.idx.push(base + mesh.indices[i]);
}

/** Build a matrix that maps +Y (0…1) onto the segment a→b, radius scale r. */
export function segmentMatrix(a: THREE.Vector3, bPt: THREE.Vector3, r: number, rollUp = new THREE.Vector3(0, 0, 1)): THREE.Matrix4 {
  const y = new THREE.Vector3().subVectors(bPt, a);
  const L = y.length();
  y.normalize();
  let x = new THREE.Vector3().crossVectors(y, rollUp);
  if (x.lengthSq() < 1e-6) x = new THREE.Vector3().crossVectors(y, new THREE.Vector3(1, 0, 0));
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return new THREE.Matrix4().makeBasis(x.multiplyScalar(r), y.multiplyScalar(L), z.multiplyScalar(r)).setPosition(a);
}

// ── profiles (x = radius, y = height 0…1 unless noted) ─────────────────

/** Knobbed dorsal spike: shaft, waist, bulb (≈1.8× shaft) and a point (AoT SP2). */
export const SPIKE_KNOB: [number, number][] = [
  [0.01, -0.05], [1, -0.05], [0.95, 0.05], [0.7, 0.2], [0.5, 0.45], [0.46, 0.62], [0.8, 0.7], [0.88, 0.75], [0.7, 0.81], [0.35, 0.9], [0.0, 1],
];
/** Plain curved thorn spike (Hell Verse). */
export const SPIKE_THORN: [number, number][] = [
  [0.01, -0.05], [1, -0.05], [0.85, 0.1], [0.6, 0.35], [0.38, 0.6], [0.18, 0.85], [0.0, 1],
];
/** Vertebra spool: fat rims, a waist. */
export const SPOOL: [number, number][] = [
  [0.01, 0], [0.85, 0], [1.05, 0.08], [1.0, 0.2], [0.68, 0.38], [0.62, 0.5], [0.68, 0.62], [1.0, 0.8], [1.05, 0.92], [0.85, 1], [0.01, 1],
];
/** Limb bone: knuckled ends (epiphyses), slim shaft. */
export const LIMB: [number, number][] = [
  [0.01, -0.04], [0.9, -0.02], [1.45, 0.04], [1.5, 0.1], [1.05, 0.2], [0.72, 0.34], [0.66, 0.5], [0.72, 0.66], [1.05, 0.8], [1.5, 0.9], [1.45, 0.96], [0.9, 1.02], [0.01, 1.04],
];
/** A unit sphere profile (knobs, joints, scapulae when squashed). */
export const SPHERE: [number, number][] = Array.from({ length: 9 }, (_, i) => {
  const a = -Math.PI / 2 + (i / 8) * Math.PI;
  return [Math.max(0.001, Math.cos(a)), Math.sin(a)] as [number, number];
});

/** Same PRNG as lab.seededRandom (kept local so this file stands alone). */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

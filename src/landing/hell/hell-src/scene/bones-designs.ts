// COPIED from .claude/pages/ad/experiments/hell-src/scene/bones-designs.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * The bone designs for the full scene (hell-20), COPIED and trimmed from
 * hell-07-bones.ts (that file stays untouched). The geometry helpers (sweeps,
 * lathes, the skull SDF + surface nets) are IMPORTED read-only from
 * hell-07-bones-geo.ts.
 *
 * Each design is built in its own "design frame": the bones' centre at the
 * origin, the sand at y = 0. For the three designs taken from hell-07 the
 * frame is that experiment's world shifted so its centre is at the origin,
 * so their yaw and composition stay exactly as tuned there. `camAngle` says
 * where the experiment's camera stood (atan2(x, z) in the frame); the adapter
 * turns the frame so the scene camera sees the bones from that same side.
 *
 * Changes from hell-07: no sand mesh or drifts (the dunes class owns the
 * ground), no chips / pierce / upturned paths (not used by these options),
 * and the spire forest is re-laid inside the bones' footprint.
 */

import * as THREE from 'three';
import {
  BoneBuilder, LIMB, SPHERE, SPIKE_KNOB, SPIKE_THORN, SPOOL,
  addLathe, addSweep, beastSkull, mulberry, segmentMatrix, surfaceNets,
} from '../hell-07-bones-geo';
import type { Section, SdfMesh } from '../hell-07-bones-geo';

export type BoneMats = {
  bone: THREE.ShaderMaterial;
  hull: THREE.ShaderMaterial;
  /** A fresh skull material (ember-socket cavity on). */
  skull: () => THREE.ShaderMaterial;
};

export type Design = {
  /** Everything, in the design frame. */
  group: THREE.Group;
  /** Ember emitters in the design frame: xyz centre, w spread. */
  emit: THREE.Vector4[];
  /** Skull meshes (their socket cavity needs the camera in object space). */
  skulls: THREE.Mesh[];
  /** Ink hulls (the outline pass of each bone mesh). */
  hulls: THREE.Object3D[];
};

/** Beast skull socket (object space), as in hell-07. */
export const BEAST_SOCKET = { c: new THREE.Vector3(0.4, 0.93, 0.58), r: new THREE.Vector3(0.26, 0.21, 0.4) };

// ── rib rhythm: hell-07 "barrel 12" (its default) ───────────────────────

type RibStyle = { n: number; p: number; w: number; h: number; phiMax: number; grow: boolean; lean: number };
const BARREL: RibStyle = { n: 12, p: 1.0, w: 3.4, h: 1.15, phiMax: 1.92, grow: false, lean: 0.25 };

// ── small helpers ───────────────────────────────────────────────────────

function newDesign(): Design {
  return { group: new THREE.Group(), emit: [], skulls: [], hulls: [] };
}

/** A bone mesh and its ink hull sharing one geometry. */
function boneMesh(d: Design, geo: THREE.BufferGeometry, parent: THREE.Object3D, mats: BoneMats) {
  const m = new THREE.Mesh(geo, mats.bone);
  const h = new THREE.Mesh(geo, mats.hull);
  m.name = 'bones';
  h.name = 'ink';
  parent.add(m, h);
  d.hulls.push(h);
  return m;
}

let beastCache: SdfMesh | null = null;
function beastMesh(): SdfMesh {
  // meshed once (it takes a moment), only when a design with a skull is built
  if (!beastCache) beastCache = surfaceNets(beastSkull({ jaw: 0.5, chips: false }), [-1.0, -1.1, -1.5], [1.0, 1.8, 2.45], 0.04);
  return beastCache;
}

function sdfGeometry(mesh: SdfMesh, uvScale: number): THREE.BufferGeometry {
  const b = new BoneBuilder();
  const P = mesh.positions;
  const N = mesh.normals;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let v = 0; v < P.length; v += 3) {
    p.set(P[v], P[v + 1], P[v + 2]);
    n.set(N[v], N[v + 1], N[v + 2]);
    b.vert(p, n, Math.atan2(P[v], P[v + 2]) * 1.2 * uvScale, P[v + 1] * uvScale, 1, 0.2);
  }
  b.idx = Array.from(mesh.indices);
  return b.geometry();
}

function skullMesh(d: Design, matrix: THREE.Matrix4, parent: THREE.Object3D, scale: number, mats: BoneMats) {
  const geo = sdfGeometry(beastMesh(), scale);
  const m = new THREE.Mesh(geo, mats.skull());
  const h = new THREE.Mesh(geo, mats.hull);
  m.name = 'skull';
  h.name = 'ink';
  for (const o of [m, h]) {
    o.matrixAutoUpdate = false;
    o.matrix.copy(matrix);
  }
  parent.add(m, h);
  d.hulls.push(h);
  d.skulls.push(m);
  return m;
}

function beastMatrix(pos: THREE.Vector3, scale: number, yaw: number, pitch: number, roll: number) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  return new THREE.Matrix4().compose(pos, q, new THREE.Vector3(scale, scale, scale));
}

function socketWorld(m: THREE.Matrix4): THREE.Vector3[] {
  return [-1, 1].map((s) => new THREE.Vector3(BEAST_SOCKET.c.x * s, BEAST_SOCKET.c.y, BEAST_SOCKET.c.z).applyMatrix4(m));
}

function spineSampler(pts: [number, number][]) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)), false, 'centripetal');
  const table = curve.getSpacedPoints(400);
  const yAt = (x: number) => {
    let best = table[0];
    for (const p of table) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
    return best.y;
  };
  return { curve, yAt };
}

// ── the ribcage (hell-07 buildCage, arched ribs only) ───────────────────
// Local frame: spine along +X (head end), up +Y, sides ±Z.

type CageOpts = {
  length: number;
  span: number;       // rib half-width at the widest
  seed: number;
  sinkY: number;      // where the rib tips end (below the sand)
  spine: [number, number][]; // (x, y) control points, tail → head
  spikes: 'crown' | 'none';
  spikeH: number;
  noSpine?: boolean;  // ribs only (the caller builds its own spine)
};

function buildCage(b: BoneBuilder, o: CageOpts) {
  const rng = mulberry(o.seed);
  const st = BARREL;
  const n = st.n;
  const L = o.length;
  const spine = spineSampler(o.spine);

  // ribs: swept flattened bands arching from the spine down into the sand
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n; // 0 head … 1 tail
    const x = L / 2 - L * u;
    const env = Math.pow(Math.sin(Math.PI * (0.1 + 0.82 * u)), 0.6) * (1 - 0.22 * u);
    for (const side of [-1, 1]) {
      rng(); // (hell-07 rolls here for a missing rib; kept so the seed gives the same cage)
      const jit = 1 + (rng() - 0.5) * 0.08;
      const secs: Section[] = [];
      const SEG = 30;
      const top = spine.yAt(x);
      const spanK = o.span * (0.55 + 0.45 * env) * jit;
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG;
        const phi = 0.1 + t * (st.phiMax - 0.1);
        const drop = (1 - Math.cos(phi)) / (1 - Math.cos(st.phiMax));
        const px = x - st.lean * drop * spanK * 0.45;
        const py = top - 1.5 - (top - 1.5 - o.sinkY) * drop;
        const pz = side * spanK * Math.pow(Math.sin(phi), st.p);
        const taper = 1 - 0.38 * t;
        secs.push({ c: new THREE.Vector3(px, py, pz), a: new THREE.Vector3(1, 0, 0), w: st.w * taper * (0.8 + 0.3 * env), h: st.h * (1 - 0.2 * t) * (0.85 + 0.25 * env) });
      }
      addSweep(b, secs, 12, { capStart: 0, capEnd: 0, seed: k * 5 + side, thinTip: true });
    }
  }

  // vertebrae: spools along the spine, plus a crown of knobbed dorsal spikes
  const curve = spine.curve;
  const K = o.noSpine ? 0 : Math.round(n * 2.2 + 14);
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  for (let i = 0; i < K; i++) {
    const t = (i + 0.5) / K;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const segLen = curve.getLength() / K;
    const along = Math.abs(p.x) / (L / 2 + 40);
    const vr = 3.0 * (1 - 0.45 * Math.min(1, Math.max(0, -p.x / (L / 2 + 60))));
    tmpA.copy(p).addScaledVector(tan, -segLen * 0.42);
    tmpB.copy(p).addScaledVector(tan, segLen * 0.42);
    addLathe(b, SPOOL, 10, segmentMatrix(tmpA, tmpB, vr), { thin: 0.1 });
    if (o.spikes === 'none' || i % 2 === 1) continue;
    // the crown fans out from the shoulders (AoT ep 80)
    const shoulder = Math.exp(-(((p.x - L * 0.18) / (L * 0.5)) ** 2));
    const H = o.spikeH * (0.3 + 0.7 * shoulder) * (0.85 + rng() * 0.3) * (1 - 0.3 * along);
    const up = new THREE.Vector3(-tan.y, tan.x, 0).normalize();
    if (up.y < 0) up.negate();
    const fan = (p.x - L * 0.18) / L;
    const dir = up.clone().addScaledVector(tan, fan * 1.1 - 0.25).normalize();
    const base = p.clone().addScaledVector(up, vr * 0.6);
    addLathe(b, SPIKE_KNOB, 9, segmentMatrix(base, base.clone().addScaledVector(dir, H), 1.1 + H * 0.05), { thin: 0.3 });
  }
}

// ── the designs ─────────────────────────────────────────────────────────

/** hell-07 design:nave — the arched ribcage, head swung toward the camera. */
export function buildNave(mats: BoneMats, spikeH: number): Design {
  const d = newDesign();
  const local = new THREE.Group();
  local.position.set(0, -0.5, 0);
  local.rotation.y = -0.35; // the ribs overlap into arches, not a fence
  const b = new BoneBuilder();
  const L = 170;
  buildCage(b, {
    length: L, span: 40, seed: 7, sinkY: -9,
    spine: [[-L / 2 - 80, -12], [-L / 2 - 30, 22], [-L / 2 + 10, 40], [0, 52], [L / 2 - 20, 50], [L / 2 + 20, 30], [L / 2 + 60, -12]],
    spikes: 'crown', spikeH,
  });
  boneMesh(d, b.geometry(), local, mats);
  d.group.add(local);
  d.emit.push(new THREE.Vector4(0, 0, 0, 50));
  return d;
}

/** hell-07 design:whole — the crouched creature: spine, crown, ribs, limbs, skull. */
export function buildWhole(mats: BoneMats): Design {
  const d = newDesign();
  const local = new THREE.Group();
  local.position.set(0, -0.5, 0);
  local.rotation.y = -0.12;
  local.updateMatrixWorld(true);
  const b = new BoneBuilder();
  const L = 120;
  const spine: [number, number][] = [[-200, -10], [-165, 8], [-125, 32], [-80, 52], [-30, 62], [10, 60], [40, 52], [68, 44], [90, 36]];
  // the ribcage hangs from the thoracic span, centred at x ≈ -25
  buildCage(b, {
    length: L, span: 30, seed: 31, sinkY: -7,
    spine: spine.map(([x, y]) => [x + 25, y]) as [number, number][],
    spikes: 'none', spikeH: 0, noSpine: true,
  });
  const ribGeo = b.geometry();
  ribGeo.translate(-25, 0, 0);
  // the rest: spine with a crown of curved spikes, limbs, scapulae, pelvis
  const r2 = new BoneBuilder();
  const sp = spineSampler(spine);
  const K = 46;
  const rng = mulberry(41);
  for (let i = 0; i < K; i++) {
    const t = (i + 0.5) / K;
    const p = sp.curve.getPointAt(t);
    const tan = sp.curve.getTangentAt(t);
    const segLen = sp.curve.getLength() / K;
    const vr = 1.6 + 2.0 * Math.min(1, t * 1.6);
    addLathe(r2, SPOOL, 10, segmentMatrix(p.clone().addScaledVector(tan, -segLen * 0.42), p.clone().addScaledVector(tan, segLen * 0.42), vr));
    const shoulder = Math.exp(-(((p.x - 15) / 45) ** 2));
    const H = 6 + 34 * shoulder + 5 * rng();
    const up = new THREE.Vector3(-tan.y, tan.x, 0).normalize();
    if (up.y < 0) up.negate();
    const secs: Section[] = [];
    const r0 = 0.9 + H * 0.045;
    for (let s = 0; s <= 10; s++) {
      const q = s / 10;
      const c = p.clone().addScaledVector(up, vr * 0.6 + q * H).addScaledVector(tan, -q * q * H * (0.5 + 0.3 * shoulder));
      const rr = Math.max(0.05, r0 * (1 - q * 0.95));
      secs.push({ c, a: new THREE.Vector3(0, 0, 1), w: rr, h: rr });
    }
    addSweep(r2, secs, 8, { capEnd: 0.3, seed: i });
  }
  const limb = (pts: [number, number, number][], r: number) => {
    for (let i = 0; i < pts.length - 1; i++) {
      addLathe(r2, LIMB, 10, segmentMatrix(new THREE.Vector3(...pts[i]), new THREE.Vector3(...pts[i + 1]), r * (1 - i * 0.18)));
    }
  };
  for (const s of [-1, 1]) {
    limb([[35, 40, s * 20], [48, 14, s * 27], [40, 2, s * 27], [56, -1, s * 29]], 2.6);
    limb([[-85, 40, s * 16], [-48, 14, s * 27], [-88, 4, s * 28], [-70, -1, s * 30]], 2.9);
    const scap = new THREE.Matrix4().compose(new THREE.Vector3(30, 46, s * 18), new THREE.Quaternion().setFromEuler(new THREE.Euler(s * 0.25, 0, -0.5)), new THREE.Vector3(9, 16, 1.6));
    addLathe(r2, SPHERE, 14, scap, { thin: 0.8 });
    const pelv = new THREE.Matrix4().compose(new THREE.Vector3(-88, 44, s * 12), new THREE.Quaternion().setFromEuler(new THREE.Euler(s * 0.4, 0, 0.6)), new THREE.Vector3(14, 10, 2));
    addLathe(r2, SPHERE, 14, pelv, { thin: 0.8 });
  }
  boneMesh(d, ribGeo, local, mats);
  boneMesh(d, r2.geometry(), local, mats);
  // the skull at the neck end, jaw open, facing forward and a little to us
  const head = beastMatrix(new THREE.Vector3(106, 30, 4), 23, Math.PI / 2 - 0.45, 0.22, 0);
  skullMesh(d, head, local, 23, mats);
  d.group.add(local);
  local.updateMatrixWorld(true);
  const headW = new THREE.Matrix4().multiplyMatrices(local.matrixWorld, head);
  for (const s of socketWorld(headW)) d.emit.push(new THREE.Vector4(s.x, s.y, s.z, 3));
  return d;
}

/** hell-07 design:skull — one colossal beast skull sunk to the jaw. */
export function buildSkull(mats: BoneMats): Design {
  const d = newDesign();
  const S = 34;
  // three-quarter view: the snout points right and toward the camera
  const m = beastMatrix(new THREE.Vector3(0, 0.06 * S, 0), S, 0.9, 0.05, 0.12);
  skullMesh(d, m, d.group, S, mats);
  // a few buried vertebrae with knobbed spikes trailing away behind it
  const b = new BoneBuilder();
  const rng = mulberry(5);
  for (let i = 0; i < 7; i++) {
    const x = -70 - i * 13 + rng() * 4;
    const z = -50 - i * 9;
    const y = 0.5;
    addLathe(b, SPOOL, 10, segmentMatrix(new THREE.Vector3(x, y, z), new THREE.Vector3(x - 7, y + 1.2, z - 5), 3.4 - i * 0.2));
    addLathe(b, SPIKE_KNOB, 9, segmentMatrix(new THREE.Vector3(x - 3, y + 2, z - 2), new THREE.Vector3(x - 8, y + 20 - i * 2, z - 4), 1.2));
  }
  boneMesh(d, b.geometry(), d.group, mats);
  for (const s of socketWorld(m)) d.emit.push(new THREE.Vector4(s.x, s.y, s.z, 4));
  return d;
}

/** hell-07 design:spires, re-laid for the scene: rows of dorsal spikes of
 *  buried creatures inside the bones' footprint. Frame: camera toward +Z,
 *  +X is screen right, so the rows recede diagonally and stay left of the pillar. */
export function buildSpires(mats: BoneMats): Design {
  const d = newDesign();
  const rng = mulberry(61);
  type Inst = { m: THREE.Matrix4; seed: number };
  const knob: Inst[] = [];
  const thorn: Inst[] = [];
  const add = (x: number, z: number, H: number, lean: number, kind: 'k' | 't') => {
    const r = 1.6 + H * 0.035;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * lean, rng() * 6.28, (rng() - 0.5) * lean));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, -8, z), q, new THREE.Vector3(r, H + 8, r));
    (kind === 'k' ? knob : thorn).push({ m, seed: rng() });
  };
  // dorsal lines, shrinking toward each tail
  const rows = [
    { x0: -125, z0: 25, x1: 75, z1: -45, n: 16, H: 66 },
    { x0: -35, z0: -110, x1: 115, z1: -150, n: 11, H: 52 },
    { x0: -165, z0: -50, x1: -70, z1: -175, n: 10, H: 78 },
  ];
  for (const row of rows) {
    for (let i = 0; i < row.n; i++) {
      const t = i / (row.n - 1);
      const x = THREE.MathUtils.lerp(row.x0, row.x1, t) + Math.sin(t * 5) * 8;
      const z = THREE.MathUtils.lerp(row.z0, row.z1, t);
      const H = row.H * (0.25 + 0.75 * Math.sin(Math.PI * (0.15 + 0.7 * t))) * (0.8 + rng() * 0.3);
      add(x, z, H, 0.35, i % 4 === 3 ? 't' : 'k');
    }
  }
  // scattered singles in the same footprint
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng());
    add(Math.cos(a) * rr * 140 - 20, Math.sin(a) * rr * 110 - 60, 16 + rng() * 34, 0.4, rng() < 0.5 ? 'k' : 't');
  }
  const mk = (profile: [number, number][], list: Inst[]) => {
    const b = new BoneBuilder();
    addLathe(b, profile, 12, new THREE.Matrix4(), { thin: 0.35, uvScale: 6 });
    const geo = b.geometry();
    const seeds = new Float32Array(list.length);
    list.forEach((s, i) => (seeds[i] = s.seed));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    for (const mat of [mats.bone, mats.hull]) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((s, i) => im.setMatrixAt(i, s.m));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.name = mat === mats.hull ? 'ink' : 'spires';
      d.group.add(im);
      if (mat === mats.hull) d.hulls.push(im);
    }
  };
  mk(SPIKE_KNOB, knob);
  mk(SPIKE_THORN, thorn);
  d.emit.push(new THREE.Vector4(-30, 0, -60, 150));
  return d;
}

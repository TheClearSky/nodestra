// COPIED from .claude/pages/ad/experiments/env-src/scene-guitar-moves.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * The guitar's moves from its sunny spot into the oak's shade, for the
 * "Play the guitar" tour. Each move is a PURE function of the tour's
 * progress u (0 … 1, linear in time; the camera eases on its own curve), so
 * Leave — the tour played backwards — returns the guitar to its start.
 *
 *  glide — lifts a little, floats along a soft banked arc, settles into the
 *          shade with a gentle bounce;
 *  magic — rises straight up, is carried in a slow spiral (ring of gold
 *          motes + leaves, drawn by the stage), descends, glows on landing;
 *  slide — slides and spins along the grass (the grass bends as it passes),
 *          then hops up and comes to rest LEANING on the trunk.
 *
 * Timing (u): the move runs 0.10 → 0.84 (lands just before the camera
 * settles at 1.0); the glide's bounce dies out by 0.94; the strings switch
 * to the slow-motion view after that.
 *
 * Holder frame: origin = the guitar's body centre on the soundboard plane;
 * +y = soundboard normal; −z = towards the head.
 */

import * as THREE from 'three';

export type MoveId = 'glide' | 'magic' | 'slide';
export const MOVES: { id: MoveId; label: string }[] = [
  { id: 'glide', label: 'Glide' },
  { id: 'magic', label: 'Magic' },
  { id: 'slide', label: 'Slide + lean' },
];
export const MOVE_T = { begin: 0.1, land: 0.84, settle: 0.94 };

/** Back of the body above the soil when lying (depthTail + 2 cm of grass). */
export const REST = 0.142;
const UP = new THREE.Vector3(0, 1, 0);

export type Pose = { pos: THREE.Vector3; quat: THREE.Quaternion };

const smoother = (x: number) => {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const clamp01 = (x: number) => THREE.MathUtils.clamp(x, 0, 1);

export function groundNormal(heightAt: (x: number, z: number) => number, x: number, z: number): THREE.Vector3 {
  const e = 0.25;
  return new THREE.Vector3(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
}

/** Lying on its back at (x, z), the neck pointing along `neck` (xz). */
export function lyingPose(heightAt: (x: number, z: number) => number, x: number, z: number, neck: THREE.Vector2): Pose {
  const n = groundNormal(heightAt, x, z);
  const yaw = Math.atan2(-neck.x, -neck.y);
  const quat = new THREE.Quaternion().setFromUnitVectors(UP, n).multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
  return { pos: new THREE.Vector3(x, heightAt(x, z), z).addScaledVector(n, REST), quat };
}

/** Standing on its tail at `base` (xz), leaning back by `lean` rad towards
 *  `-towardsCam` (the trunk), soundboard facing `towardsCam`. */
export function leaningPose(heightAt: (x: number, z: number) => number, base: THREE.Vector2, towardsCam: THREE.Vector2, lean = 0.38): Pose {
  const hc = new THREE.Vector3(towardsCam.x, 0, towardsCam.y).normalize();
  const neckDir = UP.clone().multiplyScalar(Math.cos(lean)).addScaledVector(hc, -Math.sin(lean));
  const n = hc.clone().multiplyScalar(Math.cos(lean)).addScaledVector(UP, Math.sin(lean));
  const zAxis = neckDir.clone().negate();
  const xAxis = new THREE.Vector3().crossVectors(n, zAxis);
  const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, n, zAxis));
  const pos = new THREE.Vector3(base.x, heightAt(base.x, base.y) + 0.01, base.y).addScaledVector(neckDir, 0.45).addScaledVector(n, 0.122);
  return { pos, quat };
}

export type MoveSetup = {
  start: Pose;
  end: Pose; // lying in the shade (glide, magic)
  lean: Pose; // leaning on the trunk (slide)
  /** Lying, tail out, neck towards the trunk: where the slide hops up from. */
  preLean: Pose;
  heightAt: (x: number, z: number) => number;
};

const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

/** Writes the guitar's pose at tour progress u. */
export function movePose(id: MoveId, u: number, m: MoveSetup, out: Pose): void {
  const a = clamp01((u - MOVE_T.begin) / (MOVE_T.land - MOVE_T.begin));
  const P0 = m.start.pos;
  if (id === 'glide') {
    const P2 = m.end.pos;
    const s = smoother(a);
    const travel = v1.subVectors(P2, P0).setY(0).normalize();
    // Arc towards +x (the camera's side), 1.3 m up at the control point.
    const side = v2.crossVectors(UP, travel);
    if (side.x < 0) side.negate();
    const P1 = P0.clone().add(P2).multiplyScalar(0.5).addScaledVector(UP, 1.3).addScaledVector(side, 1.4);
    const w = 1 - s;
    out.pos.set(0, 0, 0).addScaledVector(P0, w * w).addScaledVector(P1, 2 * w * s).addScaledVector(P2, s * s);
    // Gentle bounce after landing (dies out by MOVE_T.settle).
    const b = clamp01((u - MOVE_T.land) / (MOVE_T.settle - MOVE_T.land));
    if (b > 0 && b < 1) out.pos.y += 0.07 * Math.abs(Math.sin(3 * Math.PI * b)) * (1 - b) * (1 - b);
    out.quat.slerpQuaternions(m.start.quat, m.end.quat, smoother((s - 0.1) / 0.8));
    // Bank into the arc and lift the nose a touch while airborne.
    const air = Math.sin(Math.PI * s);
    q1.setFromAxisAngle(travel, -0.32 * air);
    q2.setFromAxisAngle(side, 0.12 * air);
    out.quat.premultiply(q2).premultiply(q1);
    return;
  }
  if (id === 'magic') {
    const P2 = m.end.pos;
    const H = 1.3;
    const travel = v1.subVectors(P2, P0).setY(0).normalize();
    const side = v2.crossVectors(UP, travel);
    const TURNS = 1.25;
    if (a < 0.22) {
      const r = smoother(a / 0.22);
      out.pos.copy(P0).addScaledVector(UP, H * r);
      out.quat.setFromAxisAngle(UP, 0.6 * r).multiply(m.start.quat);
    } else if (a < 0.8) {
      const w = smoother((a - 0.22) / 0.58);
      const phi = 2 * Math.PI * TURNS * w;
      const R = 1.1 * Math.sin(Math.PI * w);
      out.pos.lerpVectors(P0, P2, w).addScaledVector(UP, H).addScaledVector(side, R * Math.sin(phi)).addScaledVector(travel, R * (1 - Math.cos(phi)) * 0.5);
      q1.slerpQuaternions(m.start.quat, m.end.quat, w);
      out.quat.setFromAxisAngle(UP, 0.6 + phi).multiply(q1);
      // A slow wobble, as if floating on the motes.
      q2.setFromAxisAngle(travel, 0.12 * Math.sin(4 * Math.PI * w));
      out.quat.premultiply(q2);
    } else {
      const d = smoother((a - 0.8) / 0.2);
      out.pos.copy(P2).addScaledVector(UP, H * (1 - d));
      q1.setFromAxisAngle(UP, 0.6 + 2 * Math.PI * TURNS).multiply(m.end.quat);
      out.quat.slerpQuaternions(q1, m.end.quat, d);
    }
    return;
  }
  // slide
  const L = m.preLean.pos;
  if (a < 0.8) {
    const w = smoother(a / 0.8);
    const travel = v1.subVectors(L, P0).setY(0);
    const len = travel.length();
    travel.normalize();
    const side = v2.crossVectors(UP, travel);
    if (side.x < 0) side.negate();
    // A soft S across the grass.
    const c1 = P0.clone().addScaledVector(travel, len * 0.35).addScaledVector(side, 1.6);
    const c2 = L.clone().addScaledVector(travel, -len * 0.35).addScaledVector(side, -1.2);
    const k = 1 - w;
    const x = k * k * k * P0.x + 3 * k * k * w * c1.x + 3 * k * w * w * c2.x + w * w * w * L.x;
    const z = k * k * k * P0.z + 3 * k * k * w * c1.z + 3 * k * w * w * c2.z + w * w * w * L.z;
    // On the grass all the way, with one full spin on the way.
    out.pos.set(x, m.heightAt(x, z) + REST, z);
    q1.slerpQuaternions(m.start.quat, m.preLean.quat, w);
    out.quat.setFromAxisAngle(UP, 2 * Math.PI * w).multiply(q1);
  } else {
    const v = smoother((a - 0.8) / 0.2);
    out.pos.lerpVectors(L, m.lean.pos, v).addScaledVector(UP, 0.3 * Math.sin(Math.PI * v));
    out.quat.slerpQuaternions(m.preLean.quat, m.lean.quat, v);
  }
}

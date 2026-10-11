// COPIED from .claude/pages/ad/experiments/hell-src/scene/clouds-heaps.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Clouds class: cluster builders for the billboard puff layers of
 * hell-05-clouds (its puff layer is imported read-only; these builders are
 * laid out for the shared scene, where the camera stands on the ground).
 *
 *   buildHeap   flat-based cumulus heap (COPIED from hell-05-clouds-puffs,
 *               where it is not exported; sizes passed in)
 *   buildTower  a tall cumulus tower: stacked lobes, a cauliflower crown and
 *               an optional anvil (new, same puff conventions)
 *   seaBank / stormWall / celTowers  where each option puts its clusters
 */

import * as THREE from 'three';
import { seededRandom } from '../../env-src/lab';
import type { Cluster } from '../hell-05-clouds-puffs';

type Puff = { x: number; y: number; z: number; r: number };

/** Pack puffs into a cluster: far puffs first (the camera looks toward −z). */
function toCluster(own: Puff[], anchor: THREE.Vector3, width: number, seed: number, base: number): Cluster {
  own.sort((a, b) => a.z - b.z);
  const centre = new THREE.Vector3();
  for (const p of own) centre.add(new THREE.Vector3(p.x, p.y, p.z));
  centre.divideScalar(Math.max(own.length, 1));
  const local: number[] = [];
  for (const p of own) local.push(p.x, p.y, p.z, p.r);
  return { anchor: anchor.clone(), local, centre, base, seed: (seed % 997) / 997, data: [anchor.x, anchor.z, anchor.y], width };
}

/** Flat, wide cumulus heap: base footprint, a ridge of domes, buds on top (hell-05 copy). */
export function buildHeap(anchor: THREE.Vector3, width: number, height: number, seed: number): Cluster {
  const rnd = seededRandom(seed);
  const own: Puff[] = [];
  const rBase = Math.max(height * 0.6, width * 0.075);
  const across = Math.max(3, Math.round(width / (rBase * 1.3)));
  const deep = Math.max(1, Math.round((width * 0.45) / (rBase * 1.5)));
  for (let i = 0; i < across; i++) {
    for (let j = 0; j < deep; j++) {
      const u = (i / Math.max(across - 1, 1) - 0.5) * width + (rnd() - 0.5) * rBase * 0.6;
      const v = (deep === 1 ? 0 : j / (deep - 1) - 0.5) * width * 0.45 + (rnd() - 0.5) * rBase * 0.6;
      const e = (u / (width * 0.5)) ** 2 + (v / (width * 0.23)) ** 2;
      if (e > 1.15) continue;
      const r = rBase * (0.8 + rnd() * 0.4) * (1 - 0.3 * Math.min(e, 1));
      own.push({ x: u, y: r * 0.45, z: v, r });
    }
  }
  // Domes along a gently wandering ridge, tallest near the middle.
  const domes = Math.max(2, Math.round(across * 0.55));
  let ridgeZ = (rnd() - 0.5) * width * 0.1;
  for (let i = 0; i < domes; i++) {
    const u = (i / Math.max(domes - 1, 1) - 0.5) * width * 0.7 + (rnd() - 0.5) * rBase;
    const mid = 1 - Math.abs(u / (width * 0.35));
    const r = rBase * (0.9 + rnd() * 0.45) * (0.65 + 0.45 * Math.max(mid, 0));
    own.push({ x: u, y: rBase * 0.6 + r * 0.5 * Math.max(mid, 0.2), z: ridgeZ, r });
    ridgeZ += (rnd() - 0.5) * rBase * 0.6;
  }
  // Buds on the upper surfaces: the cauliflower.
  for (const parent of own.slice()) {
    const buds = parent.y > rBase * 0.7 ? 2 + Math.floor(rnd() * 2) : Math.floor(rnd() * 1.6);
    for (let i = 0; i < buds; i++) {
      const theta = rnd() * Math.PI * 2;
      const phi = rnd() * 1.1;
      own.push({
        x: parent.x + Math.sin(phi) * Math.cos(theta) * parent.r * 0.7,
        y: parent.y + Math.cos(phi) * parent.r * 0.7,
        z: parent.z + Math.sin(phi) * Math.sin(theta) * parent.r * 0.7,
        r: parent.r * (0.42 + rnd() * 0.18),
      });
    }
  }
  // Keep the heap low: no puff rises above ~1.2 × the heap height.
  for (const p of own) {
    const lid = height * 1.2 - p.r * 0.8;
    if (p.y > lid) p.y = Math.max(lid, p.r * 0.3);
  }
  return toCluster(own, anchor, width, seed, 0);
}

/**
 * A tall cumulus tower: rings of puffs stacked up a column that narrows to a
 * waist and swells into a cauliflower crown; `anvil` (0–1) spreads the top
 * sideways like a thunderhead. Only the camera-facing 240° of each ring is
 * built (the back is hidden anyway).
 */
export function buildTower(anchor: THREE.Vector3, width: number, height: number, seed: number, anvil = 0): Cluster {
  const rnd = seededRandom(seed);
  const own: Puff[] = [];
  const r0 = width * 0.18;
  let y = r0 * 0.4;
  let level = 0;
  while (y < height) {
    const u = y / height;
    const waist = 1 - 0.32 * Math.sin(Math.min(u, 0.85) * Math.PI * 0.9);
    const spread = anvil * THREE.MathUtils.smoothstep(u, 0.72, 1) * 0.9;
    const rad = width * 0.5 * (waist + spread) * (0.9 + rnd() * 0.15);
    const pr = r0 * (1.05 - 0.4 * u) * (1 + spread * 0.4);
    const count = Math.max(4, Math.round((rad * 4.2 * 0.62) / (pr * 1.05)));
    for (let i = 0; i < count; i++) {
      const theta = (i / (count - 1) - 0.5) * 4.2 + (rnd() - 0.5) * 0.25;
      own.push({
        x: Math.sin(theta) * rad + (rnd() - 0.5) * pr * 0.4,
        y: y + (rnd() - 0.5) * pr * 0.5,
        z: Math.cos(theta) * rad * 0.6,
        r: pr * (0.8 + rnd() * 0.45),
      });
    }
    // A core puff on every other ring fills the gaps between the lobes
    // (kept small: big core quads are most of a tower's fill cost).
    if (level++ % 2 === 0) own.push({ x: (rnd() - 0.5) * pr * 0.4, y, z: 0, r: rad * 0.62 });
    y += pr * (0.72 + rnd() * 0.12);
  }
  // Crown: buds over the top hemisphere.
  const topRad = width * 0.5 * (0.72 + anvil * 0.9);
  const buds = 9 + Math.round(anvil * 6);
  for (let i = 0; i < buds; i++) {
    const theta = (rnd() - 0.5) * 3.6;
    const phi = rnd() * 1.2;
    const pr = r0 * (0.55 + rnd() * 0.3);
    own.push({
      x: Math.sin(theta) * Math.sin(phi) * topRad,
      y: height + Math.cos(phi) * pr * 0.9 - (1 - anvil) * pr * 0.3,
      z: Math.cos(theta) * Math.sin(phi) * topRad * 0.6,
      r: pr,
    });
  }
  return toCluster(own, anchor, width, seed, 0);
}

/**
 * Height of the far ground under a cloud: the scene's dunes rise into hazy
 * ranges ~150 m high toward the horizon (to hide it), so far clouds sit on
 * top of them instead of behind them. On flat ground the clouds just float.
 */
export function farLift(x: number, z: number, eye: THREE.Vector3): number {
  const d = Math.hypot(x - eye.x, z - eye.z);
  return 165 * THREE.MathUtils.smoothstep(d, 450, 1500);
}

/** Option "sea": a dense cumulus sea burying the far plain behind the pillar. */
export function seaBank(groundY: number, span: number, eye: THREE.Vector3): Cluster[] {
  const rnd = seededRandom(5101);
  const out: Cluster[] = [];
  // Rows from just behind the circles' foot out to the horizon; farther rows bigger.
  const rows = [
    { z: -760, n: 9, w: 150, h: 34 },
    { z: -940, n: 9, w: 200, h: 44 },
    { z: -1130, n: 8, w: 260, h: 56 },
    { z: -1340, n: 7, w: 330, h: 70 },
    { z: -1560, n: 6, w: 420, h: 86 },
  ];
  rows.forEach((row, k) => {
    for (let i = 0; i < row.n; i++) {
      const x = -span + ((i + 0.2 + rnd() * 0.6) / row.n) * span * 2;
      const z = row.z + (rnd() - 0.5) * 120;
      const w = row.w * (0.75 + rnd() * 0.5);
      out.push(buildHeap(new THREE.Vector3(x, groundY + farLift(x, z, eye) + 4 + k * 3 + rnd() * 6, z), w, row.h * (0.8 + rnd() * 0.4), Math.floor(rnd() * 1e6)));
    }
  });
  return out;
}

/** Option "storm": a wall of towering black thunderheads on the horizon. */
export function stormWall(groundY: number, span: number, eye: THREE.Vector3): Cluster[] {
  const rnd = seededRandom(6607);
  const out: Cluster[] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const x = -span + ((i + 0.25 + rnd() * 0.5) / n) * span * 2;
    const z = -1380 - rnd() * 380;
    const h = 150 + rnd() * 150;
    const w = 240 + rnd() * 120;
    out.push(buildTower(new THREE.Vector3(x, groundY + farLift(x, z, eye) - 20, z), w, h, Math.floor(rnd() * 1e6), rnd() < 0.5 ? 0.55 + rnd() * 0.4 : 0));
  }
  // Low heaps between the towers' feet: one continuous wall.
  for (let i = 0; i < 7; i++) {
    const x = -span + ((i + rnd()) / 7) * span * 2;
    const z = -1250 - rnd() * 200;
    out.push(buildHeap(new THREE.Vector3(x, groundY + farLift(x, z, eye) - 10, z), 360 + rnd() * 160, 70 + rnd() * 30, Math.floor(rnd() * 1e6)));
  }
  return out;
}

/**
 * Option "cel": cumulus towers framing the frame's sides, far back, outside
 * the islands (which sit ~20° either side of the pillar).
 */
export function celTowers(groundY: number, eye: THREE.Vector3): Cluster[] {
  const at = (x: number, z: number, dy: number) => new THREE.Vector3(x, groundY + farLift(x, z, eye) + dy, z);
  return [
    buildTower(at(-860, -1450, -20), 320, 440, 41011, 0),
    buildTower(at(900, -1560, -20), 360, 480, 42023, 0.25),
    buildTower(at(420, -1800, -20), 210, 250, 43037, 0),
    buildHeap(at(-420, -1350, -6), 320, 60, 44041),
  ];
}

// COPIED from .claude/pages/ad/experiments/env-src/tree2.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * T1 "Ghibli oak" (ref 1): one big rounded deciduous crown built from
 * painted leaf CLUMPS on a thick trunk with a root flare.
 *
 *  - Clumps sit on an ellipsoidal shell (Fibonacci points + jitter), bigger
 *    at the top; the bottom-centre is left open so the limbs show through,
 *    with a few dark filler clumps inside so the crown never reads hollow.
 *  - Every clump gets its own twig from the nearest main limb, so the
 *    branches you glimpse in the gaps really lead to the foliage.
 *  - Leaves: camera-facing cards with the canvas "leaf stamp" atlas, each
 *    stamp lit as ONE flat dab (see foliage.ts): 5 painted tones from
 *    blue-green undersides to lime-yellow tops.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seededRandom } from './lab';
import type { KitUniforms } from './v2kit';
import {
  buildCards,
  createBarkMaterial,
  createFalling,
  createFoliageMaterial,
  makeCanopyUniforms,
  makeLeafAtlas,
  taperedTube,
  type CanopyUniforms,
  type Clump,
} from './foliage';

export type PaintedTree = {
  group: THREE.Group;
  clumps: Clump[];
  canopy: CanopyUniforms;
  falling: THREE.Mesh;
  dispose(): void;
};

export function createOak(u: KitUniforms, seed = 11): PaintedTree {
  const rnd = seededRandom(seed);
  const group = new THREE.Group();
  group.name = 'oak';

  const crownC = new THREE.Vector3(0.2, 7.9, 0);
  const crownR = new THREE.Vector3(7.4, 4.6, 6.6);

  // ── lobes (the big painted masses) → clumps on their upper/outer faces ──
  type Lobe = { centre: THREE.Vector3; radius: number; hang?: boolean };
  const lobes: Lobe[] = [];
  const shell = new THREE.Vector3(5.0, 2.6, 4.4);
  const addLobe = (az: number, el: number, radius: number, reach = 1, hang = false) => {
    const d = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    lobes.push({ centre: new THREE.Vector3(d.x * shell.x, d.y * shell.y, d.z * shell.z).multiplyScalar(reach).add(crownC), radius, hang });
  };
  addLobe(0, Math.PI / 2, 2.7, 0.85);
  for (let i = 0; i < 5; i++) addLobe((i / 5) * Math.PI * 2 + 0.3 + (rnd() - 0.5) * 0.5, 0.55 + rnd() * 0.25, 2.3 + rnd() * 0.5, 0.9 + rnd() * 0.15);
  for (let i = 0; i < 7; i++) addLobe((i / 7) * Math.PI * 2 + (rnd() - 0.5) * 0.5, -0.18 - rnd() * 0.3, 2.0 + rnd() * 0.5, 0.95 + rnd() * 0.2);
  // Low hanging masses inside the ring: they half-hide the limbs.
  for (let i = 0; i < 6; i++) addLobe((i / 6) * Math.PI * 2 + 0.7 + (rnd() - 0.5) * 0.4, -0.8, 1.7 + rnd() * 0.3, 0.7, true);
  const clumps: Clump[] = [];
  for (const lobe of lobes) {
    const outward = lobe.centre.clone().sub(crownC).normalize();
    const n = lobe.hang ? 4 : 7;
    for (let k = 0; k < n; k++) {
      const dir = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1 + 0.55, rnd() * 2 - 1).addScaledVector(outward, 0.6).normalize();
      const centre = lobe.centre.clone().addScaledVector(dir, lobe.radius * (0.45 + rnd() * 0.3));
      clumps.push({ centre, radius: 0.95 + rnd() * 0.45, lobe });
    }
  }

  // ── trunk, limbs (one per lower lobe), twigs (one per clump) ──
  const trunkTop = new THREE.Vector3(0.1, 2.9, 0.05);
  const trunk = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.4, 0),
    new THREE.Vector3(0.05, 1.0, 0.0),
    new THREE.Vector3(-0.05, 2.0, 0.04),
    trunkTop,
  ]);
  const parts: THREE.BufferGeometry[] = [
    taperedTube(trunk, 56, 32, (t, a) => {
      const base = THREE.MathUtils.lerp(0.68, 0.52, t);
      // Root flare: buttress lobes that sink into the ground.
      const flare = Math.exp(-t * 9) * 0.8 * Math.pow(0.5 + 0.5 * Math.cos(a * 5 + 0.6), 2.0);
      const bark = 1 + 0.04 * Math.sin(a * 11 + t * 9) + 0.025 * Math.sin(a * 23);
      return (base + flare) * bark;
    }),
  ];
  type Limb = { curve: THREE.CatmullRomCurve3; samples: THREE.Vector3[] };
  const limbs: Limb[] = [];
  const sampleOf = (curve: THREE.CatmullRomCurve3, from: number) => Array.from({ length: 16 }, (_, k) => curve.getPointAt(from + (k / 15) * (1 - from)));
  // Five main limbs (vase form): out of the fork toward the upper lobes.
  lobes.forEach((lobe, li) => {
    if (li < 1 || li > 5) return;
    const out = lobe.centre.clone().sub(crownC).setY(0).normalize();
    const start = trunkTop.clone().add(new THREE.Vector3(out.x * 0.2, -0.3 + rnd() * 0.3, out.z * 0.2));
    const end = lobe.centre.clone().lerp(crownC, 0.2);
    // A smooth vase arc: the limb spreads early (horizontal ∝ t^0.6) while it
    // climbs steadily, with a little sinuous wander.
    const flat = end.clone().sub(start).setY(0);
    const rise = end.y - start.y;
    const wander = new THREE.Vector3(-out.z, 0, out.x);
    const pts = [0, 0.2, 0.45, 0.7, 1].map((t) =>
      start
        .clone()
        .addScaledVector(flat, Math.pow(t, 0.6))
        .add(new THREE.Vector3(0, rise * Math.pow(t, 1.25), 0))
        .addScaledVector(wander, Math.sin(t * Math.PI) * (rnd() - 0.5) * 0.8),
    );
    const curve = new THREE.CatmullRomCurve3(pts);
    parts.push(taperedTube(curve, 36, 14, (t) => THREE.MathUtils.lerp(0.34, 0.07, Math.pow(t, 0.75))));
    limbs.push({ curve, samples: sampleOf(curve, 0.3) });
  });
  // Lower + hanging lobes branch off the nearest limb, curving down and out.
  const mains = limbs.slice();
  lobes.forEach((lobe, li) => {
    if (li <= 5) return;
    let best = Infinity;
    let from = new THREE.Vector3();
    let fromK = 0;
    for (const limb of mains) {
      limb.samples.forEach((p, k) => {
        if (k > 9) return;
        const d = p.distanceToSquared(lobe.centre);
        if (d < best) {
          best = d;
          from = p;
          fromK = k;
        }
      });
    }
    const end = lobe.centre.clone().lerp(from, 0.2);
    const mid = from.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.45, 0));
    const curve = new THREE.CatmullRomCurve3([from, mid, end]);
    const r0 = THREE.MathUtils.lerp(0.16, 0.1, fromK / 9);
    parts.push(taperedTube(curve, 20, 10, (t) => THREE.MathUtils.lerp(r0, 0.04, t)));
    limbs.push({ curve, samples: sampleOf(curve, 0.4) });
  });
  for (const c of clumps) {
    let best = Infinity;
    let from = new THREE.Vector3();
    let fromT = 0;
    for (const limb of limbs) {
      limb.samples.forEach((s, k) => {
        const d = s.distanceToSquared(c.centre);
        if (d < best) {
          best = d;
          from = s;
          fromT = k / 15;
        }
      });
    }
    const to = c.centre.clone().lerp(from, 0.3);
    const bend = from.clone().lerp(to, 0.5).add(new THREE.Vector3((rnd() - 0.5) * 0.5, 0.35, (rnd() - 0.5) * 0.5));
    const twig = new THREE.CatmullRomCurve3([from, bend, to]);
    const r0 = THREE.MathUtils.lerp(0.11, 0.05, fromT);
    parts.push(taperedTube(twig, 12, 7, (t) => THREE.MathUtils.lerp(r0, 0.015, t)));
  }
  const barkGeometry = mergeGeometries(parts);
  for (const p of parts) p.dispose();

  const canopy = makeCanopyUniforms(clumps, { a: new THREE.Vector3(0, 0, 0), b: trunkTop, r: [0.68, 0.52] }, { centre: crownC, radii: crownR });

  const barkMaterial = createBarkMaterial(u, canopy, {
    dark: '#2b2c2c',
    mid: '#55493f',
    lit: '#8f7a62',
    moss: '#4f6e34',
    stripes: 0,
  });
  const bark = new THREE.Mesh(barkGeometry, barkMaterial);
  group.add(bark);

  // ── leaves ──
  const atlas = makeLeafAtlas('oak', seed * 7 + 1);
  const cards = buildCards(clumps, rnd, { density: 34, size: [0.6, 0.9], flatten: 0.85, shell: 4 });
  const leafMaterial = createFoliageMaterial(u, canopy, atlas, {
    tones: ['#0d3b3b', '#1b5a44', '#438c3e', '#86bc40', '#cfe06a'],
    steps: [0.25, 0.41, 0.57, 0.73],
    glow: '#c8f070',
    trans: 0.9,
    eye: '#000000',
    weights: [0.25, 0.32, 0.45],
    lift: 0.45,
    jitter: 0.09,
    occlusion: 0.9,
    floor: 0.0,
    soften: 0.0,
  });
  const leaves = new THREE.Mesh(cards, leafMaterial);
  leaves.frustumCulled = false;
  group.add(leaves);

  const falling = createFalling(u, {
    count: 36,
    min: new THREE.Vector3(crownC.x - crownR.x * 0.7, 5.0, crownC.z - crownR.z * 0.7),
    max: new THREE.Vector3(crownC.x + crownR.x * 0.7, 10.0, crownC.z + crownR.z * 0.7),
    colorA: '#7fb43a',
    colorB: '#c9d65a',
    size: 0.07,
    fallSpeed: 0.9,
    shape: 0,
    seed: seed + 5,
  });
  group.add(falling);

  return {
    group,
    clumps,
    canopy,
    falling,
    dispose() {
      barkGeometry.dispose();
      barkMaterial.dispose();
      cards.dispose();
      leafMaterial.dispose();
      atlas.dispose();
      falling.geometry.dispose();
      (falling.material as THREE.Material).dispose();
    },
  };
}

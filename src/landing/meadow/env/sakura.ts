// COPIED from .claude/pages/ad/experiments/env-src/sakura.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * T2 "Sakura" (ref 3): pink/white blossom masses on dark, twisting,
 * gnarled branches.
 *
 *  - A short leaning trunk splits into four long limbs that arch OUT and
 *    droop (the Somei-Yoshino umbrella); each limb is a Catmull-Rom curve
 *    with a random-walk wobble (gnarl), branching twice more.
 *  - Blossoms gather ALONG the outer branches as flattened clumps, so the
 *    crown is a set of layered clouds with dark branches showing between.
 *  - Blossom cards use the canvas five-petal atlas; tones run from a mauve
 *    shade to white, with a high ambient floor (blossoms stay luminous) and
 *    strong backlit translucency (the glow of ref 3).
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
  type Clump,
} from './foliage';
import type { PaintedTree } from './tree2';

export function createSakura(u: KitUniforms, seed = 21): PaintedTree {
  const rnd = seededRandom(seed);
  const group = new THREE.Group();
  group.name = 'sakura';
  const parts: THREE.BufferGeometry[] = [];
  const clumps: Clump[] = [];

  /** A gnarled curve: from `start` along `dir` for `length`, drooping by
   *  `droop`, wobbling by `wobble` at each of `n` knots. */
  const gnarl = (start: THREE.Vector3, dir: THREE.Vector3, length: number, droop: number, wobble: number, n = 6, minY = -Infinity) => {
    const pts = [start.clone()];
    const d = dir.clone().normalize();
    const p = start.clone();
    const step = length / (n - 1);
    for (let i = 1; i < n; i++) {
      const t = i / (n - 1);
      // Bend the heading a little at each knot (random walk) and droop.
      d.add(new THREE.Vector3((rnd() - 0.5) * wobble, (rnd() - 0.5) * wobble * 0.6 - droop * t * 0.5, (rnd() - 0.5) * wobble)).normalize();
      p.addScaledVector(d, step);
      if (p.y < minY) {
        p.y = minY;
        d.y = Math.max(d.y, 0.1);
        d.normalize();
      }
      pts.push(p.clone());
    }
    return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  };

  // Trunk: short, leaning, twisting.
  const trunk = gnarl(new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(0.25, 1, 0.1), 3.0, 0, 0.35, 5);
  const trunkTop = trunk.getPointAt(1);
  parts.push(
    taperedTube(trunk, 48, 26, (t, a) => {
      const base = THREE.MathUtils.lerp(0.36, 0.25, t);
      const flare = Math.exp(-t * 8) * 0.55 * Math.pow(0.5 + 0.5 * Math.cos(a * 4 + 1.1), 2);
      // Gnarled: lumpy burrs and twisting ridges.
      const twist = 1 + 0.07 * Math.sin(a * 3 + t * 14) + 0.05 * Math.sin(a * 7 - t * 9);
      return (base + flare) * twist;
    }),
  );

  const addClump = (centre: THREE.Vector3, radius: number) => {
    if (clumps.length < 126) clumps.push({ centre, radius });
  };

  const LIMBS = 6;
  for (let i = 0; i < LIMBS; i++) {
    const az = (i / LIMBS) * Math.PI * 2 + 0.4 + (rnd() - 0.5) * 0.6;
    // Limbs arch out wide and level off (the umbrella crown).
    const rise = 0.32 + rnd() * 0.4;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(rise), Math.sin(rise), Math.sin(az) * Math.cos(rise));
    const start = trunk.getPointAt(0.82 + rnd() * 0.15);
    const len = 5.0 + rnd() * 1.6;
    const limb = gnarl(start, dir, len, 0.22, 0.6, 8, 2.4);
    parts.push(taperedTube(limb, 48, 14, (t, a) => THREE.MathUtils.lerp(0.22, 0.04, Math.pow(t, 0.8)) * (1 + 0.08 * Math.sin(a * 3 + t * 20))));
    addClump(limb.getPointAt(1).add(new THREE.Vector3(0, 0.5, 0)), 1.2 + rnd() * 0.3);
    const branches = 4;
    for (let b = 0; b < branches; b++) {
      const at = 0.3 + (b / branches) * 0.6 + rnd() * 0.08;
      const from = limb.getPointAt(at);
      const tangent = limb.getTangentAt(at);
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).multiplyScalar(rnd() < 0.5 ? -1 : 1);
      const bDir = tangent.clone().multiplyScalar(0.6).add(side.multiplyScalar(0.7)).add(new THREE.Vector3(0, 0.35 + rnd() * 0.5, 0));
      const bLen = 1.6 + rnd() * 1.6;
      const branch = gnarl(from, bDir, bLen, 0.25, 0.7, 5, 2.0);
      const r0 = THREE.MathUtils.lerp(0.14, 0.06, at);
      parts.push(taperedTube(branch, 20, 8, (t) => THREE.MathUtils.lerp(r0, 0.02, t)));
      addClump(branch.getPointAt(1).add(new THREE.Vector3(0, 0.4, 0)), 1.1 + rnd() * 0.4);
      addClump(branch.getPointAt(0.55).add(new THREE.Vector3(0, 0.45, 0)), 0.7 + rnd() * 0.3);
      const twigs = 2;
      for (let k = 0; k < twigs; k++) {
        const tat = 0.35 + rnd() * 0.55;
        const tFrom = branch.getPointAt(tat);
        const tDir = new THREE.Vector3(rnd() - 0.5, 0.2 + rnd() * 0.6, rnd() - 0.5);
        const twig = gnarl(tFrom, tDir, 0.7 + rnd() * 0.8, 0.3, 0.8, 4, 1.8);
        parts.push(taperedTube(twig, 10, 6, (t) => THREE.MathUtils.lerp(0.035, 0.01, t)));
        addClump(twig.getPointAt(1).add(new THREE.Vector3(0, 0.2, 0)), 0.6 + rnd() * 0.3);
      }
    }
    // Blossom also hugs the outer half of the limb itself.
    for (let k = 0; k < 2; k++) addClump(limb.getPointAt(0.62 + k * 0.18).add(new THREE.Vector3(0, 0.55, 0)), 0.75 + rnd() * 0.3);
  }
  const barkGeometry = mergeGeometries(parts);
  for (const p of parts) p.dispose();

  // Crown bounds (for the spherised shading).
  const box = new THREE.Box3();
  for (const c of clumps) box.union(new THREE.Sphere(c.centre, c.radius).getBoundingBox(new THREE.Box3()));
  const crownC = box.getCenter(new THREE.Vector3());
  const crownR = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const canopy = makeCanopyUniforms(clumps, { a: new THREE.Vector3(0, 0, 0), b: trunkTop, r: [0.46, 0.32] }, { centre: crownC, radii: crownR });

  const barkMaterial = createBarkMaterial(u, canopy, {
    dark: '#0e0a0c',
    mid: '#251b1e',
    lit: '#4e3d3c',
    moss: '#3b4630',
    stripes: 1,
  });
  group.add(new THREE.Mesh(barkGeometry, barkMaterial));

  const atlas = makeLeafAtlas('sakura', seed * 5 + 3);
  const cards = buildCards(clumps, rnd, { density: 36, size: [0.45, 0.66], flatten: 0.72, shell: 2.2 });
  const blossomMaterial = createFoliageMaterial(u, canopy, atlas, {
    tones: ['#8f6e8e', '#c3889f', '#eeb0c4', '#f9d6e1', '#fff3f5'],
    steps: [0.2, 0.36, 0.54, 0.72],
    glow: '#fff0e8',
    trans: 0.7,
    eye: '#d45a86',
    weights: [0.45, 0.25, 0.3],
    lift: 0.35,
    jitter: 0.14,
    occlusion: 0.75,
    floor: 0.25,
    soften: 0.04,
  });
  const blossoms = new THREE.Mesh(cards, blossomMaterial);
  blossoms.frustumCulled = false;
  group.add(blossoms);

  const falling = createFalling(u, {
    count: 320,
    min: new THREE.Vector3(crownC.x - crownR.x * 0.9, 3.0, crownC.z - crownR.z * 0.9),
    max: new THREE.Vector3(crownC.x + crownR.x * 0.9, crownC.y + crownR.y * 0.5, crownC.z + crownR.z * 0.9),
    colorA: '#f6c6d6',
    colorB: '#fff2f5',
    size: 0.03,
    fallSpeed: 0.45,
    shape: 1,
    seed: seed + 9,
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
      blossomMaterial.dispose();
      atlas.dispose();
      falling.geometry.dispose();
      (falling.material as THREE.Material).dispose();
    },
  };
}

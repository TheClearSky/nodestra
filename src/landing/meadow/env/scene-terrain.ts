// COPIED from .claude/pages/ad/experiments/env-src/scene-terrain.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * The land shared by the two instrument scenes (scene-guitar, scene-sakura).
 *
 * World layout (ref 1, the Ghibli meadow): the tree stands at the origin on
 * v2kit's meadow slope, which rises to the right and away from the viewer.
 * The river runs behind it on the LEFT, from the left edge of the wide shot
 * towards the hazy hills, across a flat floodplain.
 *
 *  - Near the tree the ground IS `slopeHeight` (shadow.ts evaluates the
 *    crown's shadow on that exact surface, so the two must agree there).
 *  - Further out the slope fades away and a smooth max keeps the land at
 *    least a little above the water (the floodplain of ref 1).
 *  - The river channel is carved round `riverX(z)`, the same profile as
 *    river.ts (bed 0.68 m below the water, banks from 4.9 m to 8.1 m out).
 *
 * `TERRAIN_GLSL` repeats the same maths for the water's shoreline line.
 */

import * as THREE from 'three';
import { slopeHeight } from './v2kit';

/** The water surface level. */
export const WATER_Y = -1.55;
/** Half width of the water strip (the banks hide its edges). */
export const WATER_HALF = 7.6;

/** The river's centre line: x for a given z (it curves gently). */
export function riverX(z: number): number {
  return -28.0 + 0.25 * z + 4.0 * Math.sin(z * 0.035 + 1.2);
}

function smax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + (h * h * k) / 4;
}

/** The land without the river channel. */
export function landHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const slope = slopeHeight(x, z) * (1 - THREE.MathUtils.smoothstep(r, 60, 170));
  const plain = WATER_Y + 0.42 + 0.22 * Math.sin(x * 0.07 + 0.5) * Math.sin(z * 0.05 + 1.1);
  return smax(slope, plain, 0.8);
}

/** Ground height with the river channel carved in. */
export function heightAt(x: number, z: number): number {
  const d = Math.abs(x - riverX(z));
  const t = THREE.MathUtils.smoothstep(d, 4.9, 8.1);
  return THREE.MathUtils.lerp(WATER_Y - 0.68, landHeight(x, z), t);
}

/** Distance from the river's centre line (for keeping grass out of it). */
export function riverDistance(x: number, z: number): number {
  return Math.abs(x - riverX(z));
}

/** The same terrain in GLSL. Needs nothing but its own uniforms-free maths. */
export const TERRAIN_GLSL = /* glsl */ `
float sceneRiverX(float z) { return -28.0 + 0.25 * z + 4.0 * sin(z * 0.035 + 1.2); }
float sceneTanh(float x) { float e = exp(2.0 * clamp(x, -9.0, 9.0)); return (e - 1.0) / (e + 1.0); }
float sceneSlope(vec2 xz) {
  float s = 3.0 * sceneTanh((0.085 * xz.x - 0.045 * xz.y) / 3.0);
  return s + 0.3 * sin(0.21 * xz.x + 0.3) * sin(0.17 * xz.y) * exp(-dot(xz, xz) / 9000.0);
}
float sceneSmax(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return max(a, b) + h * h * k / 4.0;
}
float sceneLand(vec2 xz) {
  float r = length(xz);
  float slope = sceneSlope(xz) * (1.0 - smoothstep(60.0, 170.0, r));
  float plain = ${WATER_Y.toFixed(4)} + 0.42 + 0.22 * sin(xz.x * 0.07 + 0.5) * sin(xz.y * 0.05 + 1.1);
  return sceneSmax(slope, plain, 0.8);
}
float sceneHeight(vec2 xz) {
  float d = abs(xz.x - sceneRiverX(xz.y));
  float t = smoothstep(4.9, 8.1, d);
  return mix(${(WATER_Y - 0.68).toFixed(4)}, sceneLand(xz), t);
}
`;

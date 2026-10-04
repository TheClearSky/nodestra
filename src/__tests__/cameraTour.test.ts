import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeCameraTour } from '../landing/cameraTour';
import type { PlaceTour, TourWaypoint } from '../landing/cameraTour';

// The landing's "Play the piano" tour (Deepak's views, 2026-09-27; the far
// view past the end dropped 2026-09-28 — the path crossed itself) with a
// stand-in scene: audience seat 9.6 from its look point, close views 3.461.
const TOUR: TourWaypoint[] = [
  [0, 0],
  [-0.548, -0.061],
  [-0.739, 0.02],
  [-0.736, -0.245],
];
const seat = new THREE.Vector3(0.1, 1.72, 0);
const close = new THREE.Vector3(-0.652, 0.943, 0.673);
const place: PlaceTour = (turn, rise, near, out) => {
  out.look.lerpVectors(seat, close, near);
  out.position
    .setFromSpherical(new THREE.Spherical(9.6 + (3.461 - 9.6) * near, 1.5 + rise, turn))
    .add(out.look);
};

function segmentsCross(
  [a, b]: [number[], number[]],
  [c, d]: [number[], number[]],
): boolean {
  const side = (p: number[], q: number[], r: number[]) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

describe('camera tour', () => {
  const tour = makeCameraTour(TOUR, place);

  it('starts at the audience seat and ends exactly at the final view', () => {
    expect(tour.at(0)).toEqual({ turn: 0, rise: 0, near: 0 });
    expect(tour.at(1)).toEqual({ turn: -0.736, rise: -0.245, near: 1 });
  });

  it('is fully close in before the orbit part', () => {
    expect(tour.stateAt(0.4).near).toBe(1);
    expect(tour.stateAt(0.2).near).toBeGreaterThan(0);
    expect(tour.stateAt(0.2).near).toBeLessThan(1);
  });

  it('never crosses itself', () => {
    const path: number[][] = [];
    for (let i = 0; i <= 300; i++) {
      const { turn, rise } = tour.at(i / 300);
      path.push([turn, rise]);
    }
    const crossings: string[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      for (let j = i + 2; j < path.length - 1; j++) {
        if (segmentsCross([path[i], path[i + 1]], [path[j], path[j + 1]])) {
          crossings.push(`${i}×${j}`);
        }
      }
    }
    expect(crossings).toEqual([]);
  });

  it('moves at a steady perceived pace (no lurch)', () => {
    const pose = { position: new THREE.Vector3(), look: new THREE.Vector3() };
    const previous = { position: new THREE.Vector3(), look: new THREE.Vector3() };
    const steps: number[] = [];
    const count = 200;
    for (let i = 0; i <= count; i++) {
      const { turn, rise, near } = tour.at(i / count);
      place(turn, rise, near, pose);
      if (i > 0) {
        steps.push(
          (pose.position.distanceTo(previous.position) + pose.look.distanceTo(previous.look)) /
            pose.position.distanceTo(pose.look),
        );
      }
      previous.position.copy(pose.position);
      previous.look.copy(pose.look);
    }
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    for (const step of steps) expect(step / mean).toBeGreaterThan(0.8);
    for (const step of steps) expect(step / mean).toBeLessThan(1.2);
  });

  it('stays within the angles the views span', () => {
    for (let i = 0; i <= 400; i++) {
      const { turn, rise } = tour.at(i / 400);
      expect(turn).toBeLessThanOrEqual(1e-9);
      expect(turn).toBeGreaterThanOrEqual(-0.74);
      expect(rise).toBeLessThanOrEqual(0.021);
      expect(rise).toBeGreaterThanOrEqual(-0.246);
    }
  });
});

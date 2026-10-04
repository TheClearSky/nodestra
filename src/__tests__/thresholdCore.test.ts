/**
 * thresholdCore oracles — Schmitt-trigger tables: rise at
 * threshold + hysteresis/2, fall at threshold − hysteresis/2, HOLD in
 * between; hysteresis 0 degrades to a plain comparator.
 */

import { describe, expect, it } from 'vitest';
import {
  createThresholdState,
  processThresholdBlock,
  processThresholdSample,
} from '../soundDefinitions/thresholdCore';

function run(xs: number[], threshold: number, hysteresis: number): number[] {
  const state = createThresholdState();
  return xs.map((x) =>
    processThresholdSample(state, x, threshold, hysteresis),
  );
}

describe('thresholdCore', () => {
  it('acts as a plain comparator with zero hysteresis', () => {
    expect(run([0, 0.4, 0.5, 0.6, 0.5, 0.49], 0.5, 0)).toEqual([
      0, 0, 1, 1, 0, 0,
    ]);
  });

  it('holds through chatter inside the hysteresis band (both directions)', () => {
    // T = 0.5, H = 0.2 → rise at ≥ 0.6, fall at ≤ 0.4.
    const xs = [0.45, 0.55, 0.45, 0.55, 0.7, 0.55, 0.45, 0.41, 0.4, 0.55, 0.6];
    expect(run(xs, 0.5, 0.2)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1]);
  });

  it('starts LOW: a lane already above threshold fires its rising edge on sample one', () => {
    expect(run([0.9, 0.9], 0.5, 0.2)).toEqual([1, 1]);
  });

  it('treats negative hysteresis as its magnitude', () => {
    expect(run([0.59, 0.6, 0.41, 0.4], 0.5, -0.2)).toEqual([0, 1, 1, 0]);
  });

  it('block form matches the per-sample form', () => {
    const xs = [0.1, 0.7, 0.5, 0.3, 0.65, 0.44, 0.2];
    const perSample = run(xs, 0.5, 0.1);
    const state = createThresholdState();
    const out = new Float32Array(xs.length);
    processThresholdBlock(state, xs, out, 0.5, 0.1);
    expect([...out]).toEqual(perSample);
  });
});

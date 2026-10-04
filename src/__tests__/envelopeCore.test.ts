/**
 * envelopeCore oracles — per-mode edge tables against the closed-form
 * math the module PINS (linear attack; exponential
 * decay/release with EXP_SETTLE = ln(100) and end-of-duration snap).
 * Sample rate 1000 throughout: 1 sample = 1 ms, durations land on
 * exact sample counts.
 */

import { describe, expect, it } from 'vitest';
import {
  createEnvelopeState,
  EXP_SETTLE,
  processEnvelopeBlock,
  processEnvelopeSample,
} from '../soundDefinitions/envelopeCore';
import type {
  EnvelopeParams,
  EnvelopeState,
} from '../soundDefinitions/envelopeCore';

const SR = 1000;
const DT = 1 / SR;

function run(
  params: EnvelopeParams,
  gates: ArrayLike<number>,
  state: EnvelopeState = createEnvelopeState(),
): { levels: number[]; state: EnvelopeState } {
  const levels: number[] = [];
  for (let i = 0; i < gates.length; i += 1) {
    levels.push(processEnvelopeSample(state, params, gates[i] >= 0.5, DT));
  }
  return { levels, state };
}

function gateSeq(...runs: [value: 0 | 1, count: number][]): number[] {
  const out: number[] = [];
  for (const [value, count] of runs) {
    for (let i = 0; i < count; i += 1) out.push(value);
  }
  return out;
}

const HIGH_PARAMS: EnvelopeParams = {
  attackSec: 0.1,
  decaySec: 0.2,
  sustain: 0.5,
  releaseSec: 0.1,
  mode: 'high',
};

describe('envelopeCore — high (classic gate) mode', () => {
  it('runs linear attack, exponential decay to a SNAPPED sustain, hold, exponential release to idle', () => {
    // 10 low, 500 high, 200 low.
    const { levels } = run(HIGH_PARAMS, gateSeq([0, 10], [1, 500], [0, 200]));
    // Idle before the first rise.
    expect(levels[9]).toBe(0);
    // Attack sample k has elapsed k+1 ms → linear k+1/100.
    expect(levels[10 + 49]).toBeCloseTo(0.5, 10); // elapsed 50 ms
    expect(levels[10 + 98]).toBeCloseTo(0.99, 10);
    // Attack completes at elapsed 100 ms → that sample snaps to 1
    // and enters decay.
    expect(levels[10 + 99]).toBe(1);
    // Decay closed form: 0.5 + 0.5·exp(−EXP_SETTLE·t/0.2).
    const decayStart = 10 + 100;
    expect(levels[decayStart + 99]).toBeCloseTo(
      0.5 + 0.5 * Math.exp((-EXP_SETTLE * 0.1) / 0.2),
      10,
    );
    // Snap to sustain EXACTLY at the nominal duration, then hold.
    expect(levels[decayStart + 199]).toBe(0.5);
    expect(levels[10 + 480]).toBe(0.5);
    // Release: 0.5·exp(−EXP_SETTLE·t/0.1), then snap 0 → idle.
    const releaseStart = 510;
    expect(levels[releaseStart + 49]).toBeCloseTo(
      0.5 * Math.exp((-EXP_SETTLE * 0.05) / 0.1),
      10,
    );
    expect(levels[releaseStart + 99]).toBe(0);
    expect(levels[releaseStart + 150]).toBe(0);
  });

  it('fires NO edge at initialization: a gate held high from sample 0 never sounds', () => {
    const { levels } = run(HIGH_PARAMS, gateSeq([1, 300]));
    expect(Math.max(...levels)).toBe(0);
  });

  it('retriggers the attack FROM THE CURRENT LEVEL during release', () => {
    const gates = gateSeq([0, 5], [1, 400], [0, 50], [1, 200]);
    const { levels } = run(HIGH_PARAMS, gates);
    // 50 ms into release from sustain 0.5:
    const atRetrigger = 0.5 * Math.exp((-EXP_SETTLE * 0.05) / 0.1);
    expect(levels[454]).toBeCloseTo(atRetrigger, 10);
    // First attack sample after re-rise: from ≈ atRetrigger toward 1.
    expect(levels[455]).toBeCloseTo(
      atRetrigger + (1 - atRetrigger) * (1 / 100),
      10,
    );
    // Full attackSec later it reaches peak again.
    expect(levels[455 + 99]).toBe(1);
  });

  it('zero attack jumps straight to peak; zero release cuts to idle', () => {
    const params: EnvelopeParams = { ...HIGH_PARAMS, attackSec: 0, releaseSec: 0 };
    const { levels } = run(params, gateSeq([0, 2], [1, 300], [0, 3]));
    expect(levels[2]).toBe(1);
    expect(levels[302]).toBe(0);
  });
});

describe('envelopeCore — one-shot modes', () => {
  const ONE_SHOT: EnvelopeParams = {
    attackSec: 0.05,
    decaySec: 0.1,
    sustain: 0.4,
    releaseSec: 0.05,
    mode: 'rising',
  };

  it('rising: a 1-sample pulse runs the FULL A → D-to-sustain → R cycle', () => {
    const { levels } = run(ONE_SHOT, gateSeq([0, 5], [1, 1], [0, 300]));
    expect(levels[5 + 24]).toBeCloseTo(0.5, 10); // mid-attack
    expect(levels[5 + 49]).toBe(1); // attack complete
    // Decay knee snaps to the SUSTAIN LEVEL at decaySec…
    expect(levels[5 + 50 + 99]).toBe(0.4);
    // …then releases immediately (no hold) and idles.
    expect(levels[5 + 150 + 49]).toBe(0);
    expect(levels[250]).toBe(0);
  });

  it('rising: holding the gate high adds NO sustain hold, and the fall edge does not fire', () => {
    const { levels } = run(ONE_SHOT, gateSeq([0, 5], [1, 400], [0, 100]));
    // Cycle is over by 5 + 200; still-high gate keeps it at 0.
    expect(levels[300]).toBe(0);
    expect(levels[398]).toBe(0);
    // The 1→0 edge at 405 fires nothing in rising mode.
    expect(Math.max(...levels.slice(405))).toBe(0);
  });

  it('falling: only the 1→0 edge fires', () => {
    const params: EnvelopeParams = { ...ONE_SHOT, mode: 'falling' };
    const { levels } = run(params, gateSeq([0, 5], [1, 100], [0, 300]));
    expect(Math.max(...levels.slice(0, 105))).toBe(0);
    expect(levels[105 + 49]).toBe(1); // attack completes after the fall
  });

  it('any: both edges fire, and a mid-cycle edge retriggers from the current level', () => {
    const params: EnvelopeParams = { ...ONE_SHOT, mode: 'any' };
    // Rise at 5 (fires), fall at 5+30 mid-attack (retriggers).
    const { levels } = run(params, gateSeq([0, 5], [1, 30], [0, 300]));
    const atEdge = 30 / 50; // linear attack level when the fall lands
    expect(levels[34]).toBeCloseTo(atEdge, 10);
    expect(levels[35]).toBeCloseTo(atEdge + (1 - atEdge) * (1 / 50), 10);
    expect(levels[35 + 49]).toBe(1);
  });
});

describe('envelopeCore — low (inverted gate) mode', () => {
  it('attacks on the gate FALLING edge and releases on the rise; init fires nothing', () => {
    const params: EnvelopeParams = { ...HIGH_PARAMS, mode: 'low' };
    const { levels } = run(params, gateSeq([1, 10], [0, 400], [1, 200]));
    // Gate high from init: silent (no init edge).
    expect(levels[9]).toBe(0);
    // Fall at 10 → attack.
    expect(levels[10 + 99]).toBe(1);
    // Sustain by 10 + 300.
    expect(levels[350]).toBe(0.5);
    // Rise at 410 → release → idle.
    expect(levels[410 + 99]).toBe(0);
  });
});

describe('envelopeCore — block form', () => {
  it('matches the per-sample form exactly for a Float32Array gate (≥ 0.5 = true)', () => {
    const gates = gateSeq([0, 7], [1, 250], [0, 150]);
    const noisy = Float32Array.from(gates, (g) => (g ? 0.9 : 0.1));
    const perSample = run(HIGH_PARAMS, gates).levels;
    const state = createEnvelopeState();
    const out = new Float32Array(noisy.length);
    processEnvelopeBlock(state, HIGH_PARAMS, noisy, out, SR);
    for (let i = 0; i < out.length; i += 1) {
      expect(out[i]).toBeCloseTo(perSample[i], 6);
    }
  });
});

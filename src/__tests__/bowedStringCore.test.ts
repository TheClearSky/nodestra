/**
 * bowedStringCore oracles.
 *
 * The decisive test for a bowed string is not a waveform match — it is
 * whether the model produces HELMHOLTZ MOTION: exactly one slip per period,
 * with the string sticking to the bow for the remaining (1 − β) of the cycle.
 * That is a property of the stick/slip census, which the core tracks, so the
 * oracles assert it directly rather than inferring it from the audio.
 */

import { describe, expect, it } from 'vitest';
import {
  createBowedStringState,
  frictionMu,
  frictionMuSlope,
  MU_FLOOR,
  MU_STATIC,
  oversamplingFor,
  processBowedStringBlock,
  resetBowedStringCensus,
  solveSlip,
} from '../soundDefinitions/bowedStringCore';
import type {
  BowedStringParams,
  FrictionModel,
} from '../soundDefinitions/bowedStringCore';

const SR = 48000;

function params(overrides: Partial<BowedStringParams> = {}): BowedStringParams {
  return {
    positionBeta: 0.127,
    force: 0.35,
    impedance: 0.363,
    frictionModel: 'thermal',
    attackSec: 0.06,
    releaseSec: 0.08,
    vibratoRateHz: 0,
    vibratoCents: 0,
    noise: 0,
    ...overrides,
  };
}

type Measurement = {
  stickFraction: number;
  slipsPerPeriod: number;
  rms: number;
  temperature: number;
  finite: boolean;
};

function bow(
  config: BowedStringParams,
  hz = 196,
  seconds = 1.0,
): Measurement {
  const state = createBowedStringState(SR);
  const total = Math.round(SR * seconds);
  const block = new Float32Array(128);
  const hzArray = new Float32Array([hz]);
  const amp = new Float32Array([0.8]);
  const gate = new Float32Array([1]);
  const tail = new Float32Array(total);
  let written = 0;
  let finite = true;
  let censusReset = false;
  while (written < total) {
    if (!censusReset && written > total * 0.6) {
      resetBowedStringCensus(state);
      censusReset = true;
    }
    finite =
      processBowedStringBlock(state, config, hzArray, amp, gate, block, SR) &&
      finite;
    const take = Math.min(block.length, total - written);
    tail.set(block.subarray(0, take), written);
    written += take;
  }
  const census = state.stickSamples + state.slipSamples;
  const oversampling = oversamplingFor(config.frictionModel);
  const periods = census / ((oversampling * SR) / hz);
  const from = Math.round(total * 0.6);
  let sumSquares = 0;
  for (let i = from; i < total; i += 1) sumSquares += tail[i] * tail[i];
  return {
    stickFraction: census > 0 ? state.stickSamples / census : 0,
    slipsPerPeriod: periods > 0 ? state.slipOnsets / periods : 0,
    rms: Math.sqrt(sumSquares / (total - from)),
    temperature: state.temperature,
    finite,
  };
}

/** Force at which each model sits inside its own Helmholtz window (P7). */
const HELMHOLTZ_FORCE: Record<FrictionModel, number> = {
  bowTable: 0.7,
  frictionCurve: 0.15,
  thermal: 0.2,
};

describe('bowedStringCore — the friction laws', () => {
  it('frictionMu reproduces Smith & Woodhouse (2000) eq. (2)', () => {
    const exact = (v: number): number =>
      0.4 * Math.exp(-v / 0.01) + 0.45 * Math.exp(-v / 0.1) + 0.35;
    for (const v of [0, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 1.9]) {
      expect(frictionMu(v)).toBeCloseTo(exact(v), 3);
      expect(frictionMu(-v)).toBeCloseTo(exact(v), 3);
    }
    // The two anchors the thermal model's mu(T) line is built on.
    expect(MU_STATIC).toBeCloseTo(1.2, 12);
    expect(MU_FLOOR).toBeCloseTo(0.35, 12);
    expect(frictionMu(0)).toBeCloseTo(1.2, 3);
    expect(frictionMu(5)).toBeCloseTo(0.35, 6);
  });

  it('frictionMuSlope matches the analytic derivative and is never positive', () => {
    const exact = (v: number): number =>
      (-0.4 / 0.01) * Math.exp(-v / 0.01) + (-0.45 / 0.1) * Math.exp(-v / 0.1);
    for (const v of [0.002, 0.02, 0.2, 1.0]) {
      expect(frictionMuSlope(v)).toBeCloseTo(exact(v), 1);
      expect(frictionMuSlope(v)).toBeLessThanOrEqual(0);
    }
  });

  it('oversampling follows Woodhouse 2003 §2.3 (5 us curve models, 20 us thermal)', () => {
    expect(oversamplingFor('bowTable')).toBe(4);
    expect(oversamplingFor('frictionCurve')).toBe(4);
    expect(oversamplingFor('thermal')).toBe(2);
    // 48 kHz / 4 = 5.2 us; / 2 = 10.4 us. Both inside the published limits.
    expect(1e6 / (SR * 4)).toBeLessThan(5.3);
    expect(1e6 / (SR * 2)).toBeLessThan(20);
  });

  it('solveSlip returns a root of g(u) = 2 Z0 (u - w) + mu(|u|) N sign(u)', () => {
    const impedance = 0.363;
    const normalForce = 0.5;
    // solveSlip is only defined where the string cannot stick, i.e. where the
    // load line clears the vertical sticking segment:
    //   |2*Z0*w| > mu_static*N   ->   |w| > 1.2*0.5/(2*0.363) = 0.826 m/s
    const stickLimit = (MU_STATIC * normalForce) / (2 * impedance);
    for (const w of [-3, -2, -1.2, 1.2, 2, 3]) {
      expect(Math.abs(w)).toBeGreaterThan(stickLimit);
      const u = solveSlip(w, normalForce, impedance, 0);
      const residual =
        2 * impedance * (u - w) +
        frictionMu(u) * normalForce * (u >= 0 ? 1 : -1);
      expect(Math.abs(residual)).toBeLessThan(0.02);
    }
  });

  it('solveSlip stays bounded at the extreme knob corners', () => {
    // Low impedance x high force is where a naive table would run out of
    // domain: the roots scale as mu*N/(2*Z0), reaching metres per second.
    for (const impedance of [0.05, 0.363, 1]) {
      for (const force of [0.05, 1.5]) {
        const u = solveSlip(-0.5, force, impedance, 0);
        expect(Number.isFinite(u)).toBe(true);
        expect(Math.abs(u)).toBeLessThan(50);
      }
    }
  });
});

describe('bowedStringCore — Helmholtz motion', () => {
  for (const model of [
    'bowTable',
    'frictionCurve',
    'thermal',
  ] as FrictionModel[]) {
    it(`${model} reaches Helmholtz motion inside its own force window`, () => {
      // Tested AS SHIPPED — with the vibrato and bow noise the instruments
      // actually carry. Verifying a clean model that nobody plays would miss
      // exactly the interaction that made these sound scratchy: bow noise
      // adds slip events, so the usable force window moves once it is on.
      const measurement = bow(
        params({
          frictionModel: model,
          force: HELMHOLTZ_FORCE[model],
          vibratoRateHz: 5.5,
          vibratoCents: 12,
          noise: 0.4,
        }),
      );
      expect(measurement.finite).toBe(true);
      // Exactly one slip per period is the definition of Helmholtz motion.
      expect(measurement.slipsPerPeriod).toBeGreaterThan(0.7);
      expect(measurement.slipsPerPeriod).toBeLessThan(1.5);
      // The string sticks for (1 - beta) of the cycle; beta = 0.127 here.
      expect(measurement.stickFraction).toBeGreaterThan(0.75);
      expect(measurement.stickFraction).toBeLessThan(0.95);
      // and it is actually making sound
      expect(measurement.rms).toBeGreaterThan(0.05);
    });
  }

  it('the thermal model settles in the temperature band the paper reports', () => {
    // Woodhouse 2003 fig. 6 reports 17-31 degC above ambient during Helmholtz
    // motion. WITHOUT the convection term this runs away past 110 degC, mu
    // pins at its floor and the string never sticks at all.
    const measurement = bow(
      params({ frictionModel: 'thermal', force: HELMHOLTZ_FORCE.thermal }),
    );
    expect(measurement.temperature).toBeGreaterThan(0);
    expect(measurement.temperature).toBeLessThan(60);
  });

  it('no model produces a non-finite sample anywhere in the knob space', () => {
    for (const model of [
      'bowTable',
      'frictionCurve',
      'thermal',
    ] as FrictionModel[]) {
      for (const force of [0, 0.5, 1]) {
        for (const impedance of [0.05, 1]) {
          for (const positionBeta of [0.03, 0.4]) {
            const measurement = bow(
              params({ frictionModel: model, force, impedance, positionBeta }),
              440,
              0.25,
            );
            expect(measurement.finite).toBe(true);
            expect(Number.isFinite(measurement.rms)).toBe(true);
          }
        }
      }
    }
  });

  it('an unbowed string is silent, and bowing then stopping rings down', () => {
    const state = createBowedStringState(SR);
    const block = new Float32Array(128);
    const hz = new Float32Array([196]);
    const amp = new Float32Array([0.8]);
    const low = new Float32Array([0]);
    const high = new Float32Array([1]);
    const config = params({ frictionModel: 'thermal', force: 0.2 });
    for (let i = 0; i < 50; i += 1) {
      processBowedStringBlock(state, config, hz, amp, low, block, SR);
    }
    let silent = 0;
    for (const sample of block) silent = Math.max(silent, Math.abs(sample));
    expect(silent).toBeLessThan(1e-6);

    for (let i = 0; i < 400; i += 1) {
      processBowedStringBlock(state, config, hz, amp, high, block, SR);
    }
    let bowed = 0;
    for (const sample of block) bowed = Math.max(bowed, Math.abs(sample));
    expect(bowed).toBeGreaterThan(0.01);

    // Bow off: the string must ring DOWN, not stop dead.
    for (let i = 0; i < 800; i += 1) {
      processBowedStringBlock(state, config, hz, amp, low, block, SR);
    }
    let after = 0;
    for (const sample of block) after = Math.max(after, Math.abs(sample));
    expect(after).toBeLessThan(bowed * 0.9);
  });

  it('bow noise adds broadband energy without destabilising the string', () => {
    const quiet = bow(
      params({ frictionModel: 'thermal', force: 0.2, noise: 0 }),
    );
    const noisy = bow(
      params({ frictionModel: 'thermal', force: 0.2, noise: 0.6 }),
    );
    expect(noisy.finite).toBe(true);
    // Still bowing, still sticking most of the cycle.
    expect(noisy.stickFraction).toBeGreaterThan(0.6);
    expect(noisy.rms).toBeGreaterThan(quiet.rms * 0.3);
  });

  it('the watchdog resets instead of circulating NaN', () => {
    const state = createBowedStringState(SR);
    const block = new Float32Array(128);
    const hz = new Float32Array([196]);
    const amp = new Float32Array([0.8]);
    const gate = new Float32Array([1]);
    const config = params();
    processBowedStringBlock(state, config, hz, amp, gate, block, SR);
    state.bridgeY1 = Number.NaN;
    const ok = processBowedStringBlock(state, config, hz, amp, gate, block, SR);
    expect(ok).toBe(false);
    for (let i = 0; i < 10; i += 1) {
      processBowedStringBlock(state, config, hz, amp, gate, block, SR);
      for (const sample of block) expect(Number.isFinite(sample)).toBe(true);
    }
  });
});

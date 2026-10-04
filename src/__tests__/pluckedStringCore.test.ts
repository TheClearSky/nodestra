/**
 * pluckedStringCore oracles — the closed-form maths the module PINS, plus
 * rendered-signal checks of pitch, decay and articulation.
 *
 * Where a quantity has a closed form (Lagrange coefficients, phase delays,
 * per-trip loop gain, the pluck comb's harmonic weighting) the oracle checks
 * the closed form EXACTLY. Rendered-signal measurements (T60 from a decay fit)
 * are held to a loose tolerance on purpose: measuring a T60 from a finite
 * window with an excitation transient in it is worth ±15 %, not ±3 %.
 */

import { describe, expect, it } from 'vitest';
import {
  allpassPhaseDelay,
  createPluckedStringState,
  lagrange5,
  loopFilterPhaseDelay,
  loopGainForT60,
  loopPoleForBrightness,
  processPluckedStringBlock,
} from '../soundDefinitions/pluckedStringCore';
import type { PluckedStringParams } from '../soundDefinitions/pluckedStringCore';

const SR = 48000;

const BASE: PluckedStringParams = {
  positionBeta: 0.2,
  brightness: 0.6,
  decaySec: 7,
  stiffness: 0,
  polarization: 0,
  octave: 0,
  pickStyle: 'nail',
  dampOnRelease: true,
};

/** Render `seconds` of audio, plucking once at t = 0 via a gate edge. */
function render(
  params: PluckedStringParams,
  hz: number,
  seconds: number,
  amp = 1,
): Float32Array {
  const state = createPluckedStringState(SR);
  const total = Math.round(SR * seconds);
  const output = new Float32Array(total);
  const block = new Float32Array(128);
  const hzArray = new Float32Array([hz]);
  const ampArray = new Float32Array([amp]);
  const low = new Float32Array([0]);
  const high = new Float32Array([1]);
  // One block low so the machine observes a real edge (no pluck at init).
  processPluckedStringBlock(state, params, hzArray, ampArray, low, block, SR);
  let written = 0;
  let first = true;
  while (written < total) {
    processPluckedStringBlock(
      state,
      params,
      hzArray,
      ampArray,
      first ? high : high,
      block,
      SR,
    );
    first = false;
    const take = Math.min(block.length, total - written);
    output.set(block.subarray(0, take), written);
    written += take;
  }
  return output;
}

/**
 * Frequency of the spectral peak nearest `target`, by a fine DFT scan.
 *
 * NOT autocorrelation: an unnormalised autocorrelation is biased toward short
 * lags (fewer overlapping terms at long lags) and reported this core as 55
 * cents sharp when a direct spectral scan shows it is exact.
 */
function measurePeak(
  signal: Float32Array,
  target: number,
  start: number,
  length: number,
  centsSpan = 120,
): number {
  // Coarse-to-fine: three 81-point passes reach 0.02-cent resolution for
  // ~240 DFT evaluations instead of the ~2400 a single fine pass would need.
  let centre = target;
  let span = centsSpan;
  for (let pass = 0; pass < 3; pass += 1) {
    let best = -1;
    let bestFrequency = centre;
    const steps = 81;
    for (let i = 0; i < steps; i += 1) {
      const cents = -span + (2 * span * i) / (steps - 1);
      const frequency = centre * 2 ** (cents / 1200);
      const magnitude = harmonicMagnitude(signal, frequency, start, length);
      if (magnitude > best) {
        best = magnitude;
        bestFrequency = frequency;
      }
    }
    centre = bestFrequency;
    span = (2 * span) / (steps - 1);
  }
  return centre;
}

/** Magnitude of one harmonic over a Hann-windowed frame. */
function harmonicMagnitude(
  signal: Float32Array,
  frequency: number,
  start: number,
  length: number,
): number {
  let real = 0;
  let imaginary = 0;
  const omega = (2 * Math.PI * frequency) / SR;
  for (let n = 0; n < length; n += 1) {
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * n) / length));
    const sample = signal[start + n] * window;
    real += sample * Math.cos(omega * n);
    imaginary -= sample * Math.sin(omega * n);
  }
  return Math.hypot(real, imaginary);
}

describe('pluckedStringCore — closed-form oracles', () => {
  it('lagrange5 matches the product formula and is a partition of unity', () => {
    const taps = new Float64Array(5);
    for (const d of [2, 2.0158, 2.5, 2.999]) {
      lagrange5(d, taps);
      let sum = 0;
      for (let k = 0; k < 5; k += 1) {
        let expected = 1;
        for (let j = 0; j < 5; j += 1) {
          if (j !== k) expected *= (d - j) / (k - j);
        }
        expect(taps[k]).toBeCloseTo(expected, 12);
        sum += taps[k];
      }
      expect(sum).toBeCloseTo(1, 12);
    }
  });

  it('lagrange5 reproduces an integer delay exactly', () => {
    const taps = new Float64Array(5);
    lagrange5(2, taps);
    expect(taps[2]).toBeCloseTo(1, 12);
    expect(taps[0]).toBeCloseTo(0, 12);
    expect(taps[4]).toBeCloseTo(0, 12);
  });

  it('loopGainForT60 inverts to the requested decay', () => {
    for (const [f0, t60] of [
      [110, 7],
      [440, 3],
      [82.41, 9],
    ] as const) {
      const gain = loopGainForT60(f0, t60);
      // after f0*t60 trips the amplitude must be 10^-3
      const decades = f0 * t60 * Math.log10(gain);
      expect(decades).toBeCloseTo(-3, 10);
    }
  });

  it('loopFilterPhaseDelay is exact, and the w->0 shortcut is NOT', () => {
    const a = -0.77;
    // At DC the exact value equals the shortcut.
    expect(loopFilterPhaseDelay(a, 0)).toBeCloseTo(-a / (1 + a), 12);
    // At 1760 Hz the shortcut is far off — this is why the core uses omega0.
    const omega = (2 * Math.PI * 1760) / SR;
    const exact = loopFilterPhaseDelay(a, omega);
    const shortcut = -a / (1 + a);
    expect(Math.abs(exact - shortcut)).toBeGreaterThan(0.5);
    // Independent recomputation of the exact formula.
    const phase = Math.atan2(a * Math.sin(omega), 1 + a * Math.cos(omega));
    expect(exact).toBeCloseTo(-phase / omega, 12);
  });

  it('allpassPhaseDelay is 1 sample when the pole is 0', () => {
    const omega = (2 * Math.PI * 1000) / SR;
    expect(allpassPhaseDelay(0, omega)).toBeCloseTo(1, 6);
    expect(allpassPhaseDelay(0, 0)).toBeCloseTo(1, 12);
  });

  it('loopPoleForBrightness spans the documented range', () => {
    expect(loopPoleForBrightness(0)).toBeCloseTo(-0.85, 12);
    expect(loopPoleForBrightness(1)).toBeCloseTo(-0.3, 12);
    expect(loopPoleForBrightness(0.6)).toBeCloseTo(-0.52, 12);
    // clamped
    expect(loopPoleForBrightness(-5)).toBeCloseTo(-0.85, 12);
    expect(loopPoleForBrightness(5)).toBeCloseTo(-0.3, 12);
  });

  it('every Brightness setting leaves the fundamental audible', () => {
    // A one-pole loop filter couples darkness to sustain: the darker the
    // pole, the more even the FUNDAMENTAL is attenuated per trip, so the
    // Decay knob cannot be honoured at the dark end. That is physical (a
    // heavily damped string really does die fast) — what must not happen is
    // the degenerate case measured at pole -0.95, where an A4 sat 72 dB down
    // and the string was inaudible at every Decay setting.
    for (const brightness of [0, 0.5, 1]) {
      const pole = loopPoleForBrightness(brightness);
      const omega = (2 * Math.PI * 440) / SR;
      const perTrip =
        (1 + pole) /
        Math.sqrt(1 + pole * pole + 2 * pole * Math.cos(omega));
      expect(perTrip).toBeGreaterThan(0.94);
      // ⇒ an A4's fundamental always rings for at least ~0.25 s.
      const t60 = -3 / (440 * Math.log10(perTrip));
      expect(t60).toBeGreaterThan(0.2);
    }
  });
});

describe('pluckedStringCore — rendered behaviour', () => {
  it('does not sound until it observes a gate edge (no pluck at init)', () => {
    const state = createPluckedStringState(SR);
    const block = new Float32Array(128);
    const high = new Float32Array([1]);
    // Gate is HIGH from the very first sample: the pinned rule says silence.
    for (let i = 0; i < 40; i += 1) {
      processPluckedStringBlock(
        state,
        BASE,
        new Float32Array([220]),
        new Float32Array([1]),
        high,
        block,
        SR,
      );
      for (const sample of block) expect(sample).toBe(0);
    }
  });

  it('tunes to the requested pitch within 1 cent', () => {
    for (const hz of [110, 220, 440, 880]) {
      const signal = render(BASE, hz, 0.7);
      const measured = measurePeak(signal, hz, Math.round(SR * 0.1), 16384);
      const cents = 1200 * Math.log2(measured / hz);
      expect(Math.abs(cents)).toBeLessThan(1);
    }
  });

  it('Octave transposes by exact whole octaves and never detunes', () => {
    // `Hz` cannot be scaled upstream (the `gain` node takes `audio`, not
    // `signal`), so the transpose lives here. Whole octaves only: a
    // fractional value must ROUND, never bend the pitch.
    // Three octaves, not five: down / unity / up proves the law, and each
    // extra one renders another 0.7 s of audio. At five this test took 3.5 s
    // of synthesis and timed out under a loaded full-suite run while passing
    // in 658 ms alone — the result is deterministic, so that was wall clock,
    // not flakiness. Exhaustive rounding/clamping is covered byte-exactly by
    // the next test, which is far cheaper.
    for (const octave of [-2, 0, 2]) {
      const expected = 220 * 2 ** octave;
      const signal = render({ ...BASE, octave }, 220, 0.7);
      const measured = measurePeak(
        signal,
        expected,
        Math.round(SR * 0.1),
        16384,
      );
      const cents = 1200 * Math.log2(measured / expected);
      expect(Math.abs(cents)).toBeLessThan(1);
    }
  });

  it('Octave rounds fractional values and clamps beyond +/-3', () => {
    // Asserted by BYTE IDENTITY rather than by measuring pitch. If 0.4 really
    // rounds to 0 the two renders are the same computation, so they must match
    // sample for sample — a far stronger claim than "within a cent", and it
    // avoids estimating a 27.5 Hz peak from a frame that holds ~4.7 cycles
    // (which is what a first version of this test tried, and it read 5 cents
    // off purely as a measurement limit).
    const render220 = (octave: number) => render({ ...BASE, octave }, 220, 0.4);
    expect(Array.from(render220(0.4))).toEqual(Array.from(render220(0)));
    expect(Array.from(render220(0.6))).toEqual(Array.from(render220(1)));
    // Beyond the range it clamps rather than running the loop out of bounds.
    expect(Array.from(render220(-9))).toEqual(Array.from(render220(-3)));
    expect(Array.from(render220(12))).toEqual(Array.from(render220(3)));
  });

  it('stays in tune across the whole Brightness range', () => {
    // The loop filter's phase delay grows sharply as the pole approaches -1;
    // using the omega->0 shortcut instead of the exact value would detune the
    // darkest settings by hundreds of cents.
    for (const brightness of [0, 0.3, 0.6, 1]) {
      const signal = render({ ...BASE, brightness }, 440, 0.5);
      const measured = measurePeak(signal, 440, Math.round(SR * 0.05), 8192);
      expect(Math.abs(1200 * Math.log2(measured / 440))).toBeLessThan(1);
    }
  });

  it('decays faster at high harmonics than at the fundamental', () => {
    const hz = 110;
    const signal = render({ ...BASE, brightness: 0.4 }, hz, 3);
    const frame = 8192;
    const early = Math.round(SR * 0.2);
    const late = Math.round(SR * 1.6);
    const ratios: number[] = [];
    for (const k of [1, 3, 8]) {
      const a = harmonicMagnitude(signal, hz * k, early, frame);
      const b = harmonicMagnitude(signal, hz * k, late, frame);
      ratios.push(b / Math.max(a, 1e-12));
    }
    // h1 must survive better than h3, and h3 better than h8.
    expect(ratios[0]).toBeGreaterThan(ratios[1]);
    expect(ratios[1]).toBeGreaterThan(ratios[2]);
    // The fundamental must still be alive after 1.6 s. With T60 = 7 s the
    // closed form predicts 10^(-3*1.6/7) = 0.206, so require > 0.15.
    expect(ratios[0]).toBeGreaterThan(0.15);
  });

  it('the fundamental T60 tracks the Decay knob', () => {
    const hz = 110;
    for (const decaySec of [2, 6]) {
      const signal = render({ ...BASE, decaySec }, hz, decaySec * 0.6);
      const frame = 8192;
      const t0 = Math.round(SR * 0.2);
      const t1 = Math.round(SR * decaySec * 0.5);
      const a = harmonicMagnitude(signal, hz, t0, frame);
      const b = harmonicMagnitude(signal, hz, t1, frame);
      const elapsed = (t1 - t0) / SR;
      const measured = (-60 * elapsed) / (20 * Math.log10(b / a));
      expect(measured).toBeGreaterThan(decaySec * 0.7);
      expect(measured).toBeLessThan(decaySec * 1.4);
    }
  });

  it('the pluck comb follows |sin(k*pi*beta)| — h5 and h10 nulled at beta=0.2', () => {
    const hz = 110;
    const signal = render({ ...BASE, positionBeta: 0.2, brightness: 1 }, hz, 0.5);
    const frame = 16384;
    const start = Math.round(SR * 0.02);
    const magnitudes = [1, 2, 3, 4, 5, 6].map((k) =>
      harmonicMagnitude(signal, hz * k, start, frame),
    );
    // The comb is checked DIFFERENTIALLY below (same harmonic, two pluck
    // positions). Comparing a harmonic against its own NEIGHBOURS does not
    // work here: the bridge-force integrator tilts the spectrum -6 dB per
    // octave, so h6 is already below h4 before the comb acts, which masks
    // the notch.
    const nulled = harmonicMagnitude(signal, hz * 5, start, frame);
    const offNull = harmonicMagnitude(
      render({ ...BASE, positionBeta: 0.13, brightness: 1 }, hz, 0.5),
      hz * 5,
      start,
      frame,
    );
    expect(nulled).toBeLessThan(offNull * 0.5);
    // The notch is PARTIAL by design: a real pluck has finite width, so
    // COMB_DEPTH < 1 and the contact is spread over a short span. An ideal
    // point pluck put h5 at -72 dB where the Iowa A2 measures -6.8 dB, and
    // that surgical regularity is part of what made the model sound
    // synthetic and struck rather than plucked.
    expect(nulled).toBeGreaterThan(offNull * 0.02);
    // h1..h4 all sit on the comb's shoulders, so none of them may collapse.
    // (They are NOT ranked by sin(k*pi*beta) alone: the bridge-force
    // integrator tilts the spectrum -6 dB/octave, which is why the Iowa
    // reference measures h1 and h2 as the loudest partials.)
    // Predicted: comb sin(k*pi*0.2) = -4.6, -0.4, -0.4, -4.6 dB, plus the
    // integrator's -6 dB/octave = 0, -6.0, -9.5, -12.0 dB, so h4 lands about
    // 12 dB under h1. Require every shoulder harmonic within 20 dB of the
    // loudest — enough to catch a collapsed partial, loose enough to allow
    // the tilt the physics demands.
    const shoulder = magnitudes.slice(0, 4);
    const loudest = Math.max(...shoulder);
    for (const magnitude of shoulder) {
      expect(magnitude).toBeGreaterThan(loudest * 0.1);
    }
  });

  it('moving the pluck position moves the comb null', () => {
    const hz = 110;
    const frame = 16384;
    const start = Math.round(SR * 0.02);
    // beta = 0.25 nulls h4; beta = 0.2 does not. Same harmonic, two
    // positions — so the spectral tilt cancels out of the comparison.
    const nulled = harmonicMagnitude(
      render({ ...BASE, positionBeta: 0.25, brightness: 1 }, hz, 0.5),
      hz * 4,
      start,
      frame,
    );
    const offNull = harmonicMagnitude(
      render({ ...BASE, positionBeta: 0.2, brightness: 1 }, hz, 0.5),
      hz * 4,
      start,
      frame,
    );
    // Measured −5.3 dB at the shipped comb depth.
    expect(nulled).toBeLessThan(offNull * 0.6);
  });

  it('damp on release silences the string; without it the string rings on', () => {
    const state = createPluckedStringState(SR);
    const block = new Float32Array(128);
    const hz = new Float32Array([220]);
    const amp = new Float32Array([1]);
    const low = new Float32Array([0]);
    const high = new Float32Array([1]);
    const params = { ...BASE, dampOnRelease: true };
    processPluckedStringBlock(state, params, hz, amp, low, block, SR);
    for (let i = 0; i < 200; i += 1) {
      processPluckedStringBlock(state, params, hz, amp, high, block, SR);
    }
    let ringing = 0;
    for (const sample of block) ringing = Math.max(ringing, Math.abs(sample));
    expect(ringing).toBeGreaterThan(1e-4);
    // release, then let the 10 ms ramp finish
    for (let i = 0; i < 40; i += 1) {
      processPluckedStringBlock(state, params, hz, amp, low, block, SR);
    }
    let damped = 0;
    for (const sample of block) damped = Math.max(damped, Math.abs(sample));
    expect(damped).toBeLessThan(ringing * 0.02);
  });

  it('stiffness pushes upper partials sharp (inharmonicity)', () => {
    const hz = 110;
    const frame = 16384;
    const start = Math.round(SR * 0.05);
    const settings = { brightness: 1, positionBeta: 0.13, decaySec: 7 };
    const flat = render({ ...BASE, ...settings, stiffness: 0 }, hz, 0.6);
    const stiff = render({ ...BASE, ...settings, stiffness: 3e-5 }, hz, 0.6);
    const flat8 = measurePeak(flat, hz * 8, start, frame, 60);
    const stiff8 = measurePeak(stiff, hz * 8, start, frame, 60);
    // Without stiffness partial 8 is harmonic; with it, it must be sharper.
    expect(Math.abs(1200 * Math.log2(flat8 / (hz * 8)))).toBeLessThan(2);
    expect(stiff8).toBeGreaterThan(flat8);
    // And the fundamental must NOT move.
    const stiff1 = measurePeak(stiff, hz, start, frame, 60);
    expect(Math.abs(1200 * Math.log2(stiff1 / hz))).toBeLessThan(3);
  });

  it('the watchdog resets the string instead of circulating NaN', () => {
    const state = createPluckedStringState(SR);
    const block = new Float32Array(128);
    const hz = new Float32Array([220]);
    const amp = new Float32Array([1]);
    const low = new Float32Array([0]);
    const high = new Float32Array([1]);
    processPluckedStringBlock(state, BASE, hz, amp, low, block, SR);
    processPluckedStringBlock(state, BASE, hz, amp, high, block, SR);
    // Poison the loop the way a bad parameter would. (Poisoning a buffer cell
    // that the read taps have not reached yet would not surface this block.)
    state.vertical.loopY1 = Number.NaN;
    const ok = processPluckedStringBlock(state, BASE, hz, amp, high, block, SR);
    expect(ok).toBe(false);
    // and it recovers: every later sample is finite
    for (let i = 0; i < 10; i += 1) {
      processPluckedStringBlock(state, BASE, hz, amp, high, block, SR);
      for (const sample of block) expect(Number.isFinite(sample)).toBe(true);
    }
  });

  it('is reentrant: two states rendered interleaved match rendering alone', () => {
    const solo = render(BASE, 220, 0.2);
    const a = createPluckedStringState(SR);
    const b = createPluckedStringState(SR);
    const blockA = new Float32Array(128);
    const blockB = new Float32Array(128);
    const hz = new Float32Array([220]);
    const hzB = new Float32Array([330]);
    const amp = new Float32Array([1]);
    const low = new Float32Array([0]);
    const high = new Float32Array([1]);
    processPluckedStringBlock(a, BASE, hz, amp, low, blockA, SR);
    processPluckedStringBlock(b, BASE, hzB, amp, low, blockB, SR);
    const total = Math.round(SR * 0.2);
    const interleaved = new Float32Array(total);
    let written = 0;
    while (written < total) {
      processPluckedStringBlock(a, BASE, hz, amp, high, blockA, SR);
      processPluckedStringBlock(b, BASE, hzB, amp, high, blockB, SR);
      const take = Math.min(blockA.length, total - written);
      interleaved.set(blockA.subarray(0, take), written);
      written += take;
    }
    for (let i = 0; i < total; i += 1) {
      expect(interleaved[i]).toBeCloseTo(solo[i], 6);
    }
  });
});

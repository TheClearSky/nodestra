import { describe, expect, it } from 'vitest';
import {
  applyStrokeSegment,
  dftToPeriodicCoefficients,
  effectiveHarmonics,
  noisePreset,
  normalizeSamples,
  sawPreset,
  sinePreset,
  smoothSamples,
  squarePreset,
  trianglePreset,
  WAVEFORM_HARMONICS,
  WAVEFORM_SAMPLE_COUNT,
} from '@/soundDefinitions/waveformMath';

function magnitude(
  coefficients: { real: Float32Array; imag: Float32Array },
  harmonic: number,
): number {
  return Math.hypot(
    coefficients.real[harmonic],
    coefficients.imag[harmonic],
  );
}

describe('dftToPeriodicCoefficients oracles', () => {
  // N=8 pure sine drawing (a hand-computed oracle).
  const sineDrawing = Array.from({ length: 8 }, (_, n) =>
    Math.sin((2 * Math.PI * n) / 8),
  );

  it('drawn sine ⇒ exactly {imag[1]=1, real[1]=0}', () => {
    const { real, imag } = dftToPeriodicCoefficients(sineDrawing, 96);
    expect(imag[1]).toBeCloseTo(1, 6);
    expect(real[1]).toBeCloseTo(0, 6);
  });

  it('all 2 ≤ k ≤ K_eff bins ≈ 0 for the sine drawing', () => {
    const coefficients = dftToPeriodicCoefficients(sineDrawing, 96);
    for (let k = 2; k < coefficients.real.length; k++) {
      expect(magnitude(coefficients, k)).toBeLessThan(1e-6);
    }
  });

  it('K clamps to floor((N−1)/2) — aliased bins never emitted', () => {
    // With N=8 and K=96 unclamped, imag[7] would be exactly −1 (aliasing).
    const { real, imag } = dftToPeriodicCoefficients(sineDrawing, 96);
    expect(effectiveHarmonics(8, 96)).toBe(3);
    expect(real.length).toBe(4); // bins 0..3 only — no bin 7 exists
    expect(imag.length).toBe(4);
  });

  it('drawn cosine ⇒ {real[1]=1, imag[1]=0}', () => {
    const cosineDrawing = Array.from({ length: 8 }, (_, n) =>
      Math.cos((2 * Math.PI * n) / 8),
    );
    const { real, imag } = dftToPeriodicCoefficients(cosineDrawing, 96);
    expect(real[1]).toBeCloseTo(1, 6);
    expect(imag[1]).toBeCloseTo(0, 6);
  });

  it('DC is dropped: a constant drawing produces silence, index 0 forced 0', () => {
    const constantDrawing = new Array<number>(64).fill(0.5);
    const coefficients = dftToPeriodicCoefficients(constantDrawing, 96);
    expect(coefficients.real[0]).toBe(0);
    expect(coefficients.imag[0]).toBe(0);
    for (let k = 1; k < coefficients.real.length; k++) {
      expect(magnitude(coefficients, k)).toBeLessThan(1e-6);
    }
  });

  it('Parseval sanity on the sine: Σ(real²+imag²)/2 ≈ mean(y²)', () => {
    const coefficients = dftToPeriodicCoefficients(sineDrawing, 96);
    let spectralEnergy = 0;
    for (let k = 1; k < coefficients.real.length; k++) {
      spectralEnergy +=
        (coefficients.real[k] ** 2 + coefficients.imag[k] ** 2) / 2;
    }
    const timeEnergy =
      sineDrawing.reduce((sum, y) => sum + y * y, 0) / sineDrawing.length;
    expect(spectralEnergy).toBeCloseTo(timeEnergy, 6);
  });

  it('production shape: N=256 with K=96 keeps all 96 bins', () => {
    expect(effectiveHarmonics(WAVEFORM_SAMPLE_COUNT, WAVEFORM_HARMONICS)).toBe(
      96,
    );
  });
});

describe('applyStrokeSegment — fast-stroke gap interpolation', () => {
  it('fills every index between two events linearly', () => {
    const samples = new Array<number>(8).fill(0);
    const next = applyStrokeSegment(samples, 0, 0, 4, 1);
    expect(next[0]).toBeCloseTo(0, 9);
    expect(next[1]).toBeCloseTo(0.25, 9);
    expect(next[2]).toBeCloseTo(0.5, 9);
    expect(next[3]).toBeCloseTo(0.75, 9);
    expect(next[4]).toBeCloseTo(1, 9);
    expect(next[5]).toBe(0); // untouched beyond the stroke
  });

  it('right-to-left strokes interpolate identically', () => {
    const samples = new Array<number>(8).fill(0);
    const next = applyStrokeSegment(samples, 4, 1, 0, 0);
    expect(next[2]).toBeCloseTo(0.5, 9);
  });

  it('clamps values into [−1, 1] and NaN to 0', () => {
    const samples = new Array<number>(4).fill(0);
    expect(applyStrokeSegment(samples, 0, 5, 0, 5)[0]).toBe(1);
    expect(applyStrokeSegment(samples, 1, -7, 1, -7)[1]).toBe(-1);
    expect(applyStrokeSegment(samples, 2, Number.NaN, 2, Number.NaN)[2]).toBe(
      0,
    );
  });

  it('does not mutate the input array', () => {
    const samples = new Array<number>(8).fill(0);
    applyStrokeSegment(samples, 0, 0, 7, 1);
    expect(samples.every((value) => value === 0)).toBe(true);
  });
});

describe('normalize + smooth', () => {
  it('normalizeSamples scales the peak to exactly 1 preserving sign', () => {
    const normalized = normalizeSamples([0.5, -0.25, 0.1]);
    expect(normalized[0]).toBeCloseTo(1, 9);
    expect(normalized[1]).toBeCloseTo(-0.5, 9);
  });

  it('normalizeSamples leaves silence untouched', () => {
    expect(normalizeSamples([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('smoothSamples averages circularly across the cycle boundary', () => {
    const impulseAtZero = [1, 0, 0, 0, 0, 0, 0, 0];
    const smoothed = smoothSamples(impulseAtZero, 1);
    expect(smoothed[0]).toBeCloseTo(1 / 3, 9);
    expect(smoothed[1]).toBeCloseTo(1 / 3, 9);
    expect(smoothed[7]).toBeCloseTo(1 / 3, 9); // wraps to neighbor index 0
    expect(smoothed[4]).toBeCloseTo(0, 9);
  });

  it('radius larger than the cycle stays finite (true modulo)', () => {
    const smoothed = smoothSamples([1, 0, 0, 0], 6);
    // The whole point of the true modulo: a negative index would be NaN.
    expect(smoothed.every((value) => Number.isFinite(value))).toBe(true);
    // A 13-wide window over a 4-cycle sees the impulse 3 or 4 times
    // depending on position; the smoothing conserves total energy.
    for (const value of smoothed) {
      expect([3 / 13, 4 / 13]).toContainEqual(value);
    }
    const total = smoothed.reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1, 9);
  });
});

describe('presets — harmonic signatures at N=256', () => {
  it('sine preset is spectrally pure: m1 ≈ 1, everything else ≈ 0', () => {
    const coefficients = dftToPeriodicCoefficients(sinePreset(), 96);
    expect(magnitude(coefficients, 1)).toBeCloseTo(1, 6);
    for (let k = 2; k <= 96; k++) {
      expect(magnitude(coefficients, k)).toBeLessThan(1e-6);
    }
  });

  it('square preset: odd harmonics with m1 ≈ 4/π, m1/m3 ≈ 3, evens ≈ 0', () => {
    const coefficients = dftToPeriodicCoefficients(squarePreset(), 96);
    expect(magnitude(coefficients, 1)).toBeCloseTo(4 / Math.PI, 2);
    expect(
      magnitude(coefficients, 1) / magnitude(coefficients, 3),
    ).toBeCloseTo(3, 1);
    expect(magnitude(coefficients, 2)).toBeLessThan(1e-3);
  });

  it('saw preset: all harmonics with m1 ≈ 2/π, m1/m2 ≈ 2', () => {
    const coefficients = dftToPeriodicCoefficients(sawPreset(), 96);
    expect(magnitude(coefficients, 1)).toBeCloseTo(2 / Math.PI, 2);
    expect(
      magnitude(coefficients, 1) / magnitude(coefficients, 2),
    ).toBeCloseTo(2, 1);
  });

  it('triangle preset: odd harmonics with m1 ≈ 8/π², m1/m3 ≈ 9, evens ≈ 0', () => {
    const coefficients = dftToPeriodicCoefficients(trianglePreset(), 96);
    expect(magnitude(coefficients, 1)).toBeCloseTo(8 / Math.PI ** 2, 2);
    expect(
      magnitude(coefficients, 1) / magnitude(coefficients, 3),
    ).toBeCloseTo(9, 0);
    expect(magnitude(coefficients, 2)).toBeLessThan(1e-3);
  });

  it('noise preset uses the injected RNG and stays within [−1, 1]', () => {
    let calls = 0;
    const noise = noisePreset(16, () => {
      calls++;
      return 0.75;
    });
    expect(calls).toBe(16);
    expect(noise.every((value) => value === 0.5)).toBe(true);
  });

  it('every preset emits exactly WAVEFORM_SAMPLE_COUNT samples in range', () => {
    for (const preset of [
      sinePreset(),
      squarePreset(),
      sawPreset(),
      trianglePreset(),
      noisePreset(),
    ]) {
      expect(preset.length).toBe(WAVEFORM_SAMPLE_COUNT);
      expect(preset.every((value) => value >= -1 && value <= 1)).toBe(true);
    }
  });
});

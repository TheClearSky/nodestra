/**
 * Pure waveform arithmetic for the drawn-oscillator pipeline.
 *
 * The ONLY file with DSP math in it; everything here is deterministic and
 * unit-tested against hand-computed oracles. No Tone/Web Audio imports.
 */

/** Samples per drawn cycle: N = 256. */
const WAVEFORM_SAMPLE_COUNT = 256;

/** Harmonics requested from the DFT: K = 96, Nyquist-safe. */
const WAVEFORM_HARMONICS = 96;

function clampSample(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

/**
 * Effective harmonic count for an N-sample cycle. Bins above
 * floor((N−1)/2) alias back onto lower bins (on an N=8 sine, k=7
 * evaluates to exactly −imag[1]) — they must never be emitted.
 */
function effectiveHarmonics(sampleCount: number, harmonics: number): number {
  return Math.min(harmonics, Math.floor((sampleCount - 1) / 2));
}

/**
 * DFT of one drawn cycle → PeriodicWave coefficient arrays.
 *
 * Convention (verified against Tone's own `_inverseFFT`): real[k]
 * multiplies cos(k·2πft), imag[k] multiplies sin(k·2πft).
 *
 *   real[k] = (2/N) · Σ y[n]·cos(2πkn/N)
 *   imag[k] = (2/N) · Σ y[n]·sin(2πkn/N)
 *
 * Index 0 (DC) is forced to 0 — a drawing's vertical offset is not sound.
 * Arrays are length K_eff+1 with K_eff = effectiveHarmonics(N, harmonics).
 */
function dftToPeriodicCoefficients(
  samples: readonly number[],
  harmonics: number = WAVEFORM_HARMONICS,
): { real: Float32Array; imag: Float32Array } {
  const sampleCount = samples.length;
  const harmonicCount = effectiveHarmonics(sampleCount, harmonics);
  const real = new Float32Array(harmonicCount + 1);
  const imag = new Float32Array(harmonicCount + 1);
  for (let harmonic = 1; harmonic <= harmonicCount; harmonic++) {
    let realSum = 0;
    let imagSum = 0;
    for (let n = 0; n < sampleCount; n++) {
      const angle = (2 * Math.PI * harmonic * n) / sampleCount;
      realSum += samples[n] * Math.cos(angle);
      imagSum += samples[n] * Math.sin(angle);
    }
    real[harmonic] = (2 / sampleCount) * realSum;
    imag[harmonic] = (2 / sampleCount) * imagSum;
  }
  return { real, imag };
}

/**
 * Write one pointer-stroke segment into a copy of the samples array,
 * linearly interpolating every index between the two events — fast strokes
 * must not leave gaps.
 */
function applyStrokeSegment(
  samples: readonly number[],
  fromIndex: number,
  fromValue: number,
  toIndex: number,
  toValue: number,
): number[] {
  const next = samples.slice();
  const lastIndex = samples.length - 1;
  let i0 = Math.round(Math.min(Math.max(fromIndex, 0), lastIndex));
  let i1 = Math.round(Math.min(Math.max(toIndex, 0), lastIndex));
  let v0 = clampSample(fromValue);
  let v1 = clampSample(toValue);
  if (i1 < i0) {
    [i0, i1] = [i1, i0];
    [v0, v1] = [v1, v0];
  }
  if (i0 === i1) {
    next[i0] = v1;
    return next;
  }
  for (let i = i0; i <= i1; i++) {
    const t = (i - i0) / (i1 - i0);
    next[i] = v0 + (v1 - v0) * t;
  }
  return next;
}

/** Peak-normalize to |y|max = 1 (no-op on silence). */
function normalizeSamples(samples: readonly number[]): number[] {
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  if (peak < 1e-9) return samples.slice();
  return samples.map((value) => value / peak);
}

/**
 * Circular moving-average smoothing (the cycle wraps — index 0 neighbors
 * index N−1). Window = 2·radius + 1.
 */
function smoothSamples(samples: readonly number[], radius: number = 2): number[] {
  const sampleCount = samples.length;
  const smoothed = new Array<number>(sampleCount);
  const window = 2 * radius + 1;
  for (let i = 0; i < sampleCount; i++) {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset++) {
      // True positive modulo — `(i + offset + N) % N` goes negative when
      // radius > N and JS `%` preserves sign.
      const index =
        (((i + offset) % sampleCount) + sampleCount) % sampleCount;
      sum += samples[index];
    }
    smoothed[i] = sum / window;
  }
  return smoothed;
}

// ── Presets: seed shapes for the editable canvas ──

function sinePreset(sampleCount: number = WAVEFORM_SAMPLE_COUNT): number[] {
  return Array.from({ length: sampleCount }, (_, n) =>
    Math.sin((2 * Math.PI * n) / sampleCount),
  );
}

function squarePreset(sampleCount: number = WAVEFORM_SAMPLE_COUNT): number[] {
  return Array.from({ length: sampleCount }, (_, n) =>
    n < sampleCount / 2 ? 1 : -1,
  );
}

/** Rising ramp −1 → +1 (visually standard; DC offset is dropped by the DFT). */
function sawPreset(sampleCount: number = WAVEFORM_SAMPLE_COUNT): number[] {
  return Array.from(
    { length: sampleCount },
    (_, n) => -1 + (2 * n) / sampleCount,
  );
}

function trianglePreset(sampleCount: number = WAVEFORM_SAMPLE_COUNT): number[] {
  return Array.from({ length: sampleCount }, (_, n) =>
    n < sampleCount / 2
      ? -1 + (4 * n) / sampleCount
      : 3 - (4 * n) / sampleCount,
  );
}

/** Random noise in [−1, 1]; RNG injectable for deterministic tests. */
function noisePreset(
  sampleCount: number = WAVEFORM_SAMPLE_COUNT,
  random: () => number = Math.random,
): number[] {
  return Array.from({ length: sampleCount }, () => random() * 2 - 1);
}

export {
  WAVEFORM_SAMPLE_COUNT,
  WAVEFORM_HARMONICS,
  clampSample,
  effectiveHarmonics,
  dftToPeriodicCoefficients,
  applyStrokeSegment,
  normalizeSamples,
  smoothSamples,
  sinePreset,
  squarePreset,
  sawPreset,
  trianglePreset,
  noisePreset,
};

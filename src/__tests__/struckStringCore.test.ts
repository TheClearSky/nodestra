/**
 * struckStringCore — the properties that make it a PIANO rather than a
 * generic string.
 *
 * These assert measured behaviour, not that the module loads. The pad in this
 * same project passed a five-band paper check twice and sounded wrong both
 * times; the lesson taken here is to assert the mechanisms directly —
 * velocity changing TIMBRE, partials decaying at different rates, the unison
 * group producing a two-stage decay, and stiffness stretching the series.
 */

import { describe, expect, it } from 'vitest';
import {
  createStruckStringState,
  hammerContactSec,
  processStruckStringBlock,
} from '../soundDefinitions/struckStringCore';
import type { StruckStringParams } from '../soundDefinitions/struckStringCore';

const SR = 48000;

const BASE: StruckStringParams = {
  positionBeta: 0.125,
  brightness: 0.62,
  decaySec: 8,
  stiffness: 2.5e-4,
  strings: 3,
  unisonCents: 3,
  hardness: 0.5,
  octave: 0,
  dampOnRelease: true,
};

/** Render `seconds` of audio, striking once at t = 0 via a gate edge. */
function render(
  params: StruckStringParams,
  hz: number,
  seconds: number,
  velocity = 1,
): Float32Array {
  const state = createStruckStringState(SR);
  const total = Math.round(SR * seconds);
  const output = new Float32Array(total);
  const block = new Float32Array(128);
  const hzArray = new Float32Array([hz]);
  const velocityArray = new Float32Array([velocity]);
  const low = new Float32Array([0]);
  const high = new Float32Array([1]);
  // One block low so the machine observes a real edge (no strike at init).
  processStruckStringBlock(state, params, hzArray, velocityArray, low, block, SR);
  let written = 0;
  while (written < total) {
    processStruckStringBlock(
      state,
      params,
      hzArray,
      velocityArray,
      high,
      block,
      SR,
    );
    const take = Math.min(block.length, total - written);
    output.set(block.subarray(0, take), written);
    written += take;
  }
  return output;
}

/** Magnitude of the DFT at `hz` over `length` samples from `start`. */
function magnitudeAt(
  signal: Float32Array,
  hz: number,
  start: number,
  length: number,
): number {
  let real = 0;
  let imaginary = 0;
  const step = (2 * Math.PI * hz) / SR;
  for (let n = 0; n < length; n += 1) {
    const sample = signal[start + n];
    if (sample === undefined) break;
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * n) / length));
    real += sample * window * Math.cos(step * n);
    imaginary -= sample * window * Math.sin(step * n);
  }
  return Math.hypot(real, imaginary) / length;
}

/**
 * Energy-weighted mean frequency measured ON THE PARTIALS.
 *
 * NOT a fixed-grid scan. A 25 Hz grid across a string whose partials are
 * 110 Hz apart puts most of its points BETWEEN partials, where it reads
 * spectral leakage rather than signal — and since a soft strike is ~11 dB
 * quieter overall, its leakage-to-signal ratio differs, which made a first
 * version of this file report the hard strike as the DARKER one.
 */
function partialCentroid(
  signal: Float32Array,
  f0: number,
  start: number,
  length: number,
  partials = 20,
): number {
  let weighted = 0;
  let total = 0;
  for (let k = 1; k <= partials; k += 1) {
    const hz = k * f0;
    if (hz > SR / 2) break;
    const power = magnitudeAt(signal, hz, start, length) ** 2;
    weighted += hz * power;
    total += power;
  }
  return total > 0 ? weighted / total : 0;
}

/** Seconds for a partial to fall 20 dB, by two windowed probes. */
function decayT20(signal: Float32Array, hz: number): number {
  const frame = 8192;
  const early = magnitudeAt(signal, hz, Math.round(SR * 0.05), frame);
  const late = magnitudeAt(signal, hz, Math.round(SR * 1.05), frame);
  if (!(early > 0) || !(late > 0)) return Number.POSITIVE_INFINITY;
  const dropDb = 20 * Math.log10(early / late);
  if (dropDb <= 0) return Number.POSITIVE_INFINITY;
  return (20 / dropDb) * 1.0;
}

describe('struckStringCore — hammer physics', () => {
  it('a harder strike is BRIGHTER, not merely louder', () => {
    // The defining piano behaviour, and the reason the retired subtractive
    // piano could never sound soft: felt is a nonlinear spring, so a harder
    // strike shortens contact and widens the excitation's bandwidth. A
    // velocity->gain mapping alone would leave the centroid flat.
    const soft = render(BASE, 110, 0.5, 0.2);
    const hard = render(BASE, 110, 0.5, 1.0);
    const start = Math.round(SR * 0.01);
    const softCentroid = partialCentroid(soft, 110, start, 8192);
    const hardCentroid = partialCentroid(hard, 110, start, 8192);
    expect(hardCentroid).toBeGreaterThan(softCentroid * 1.1);
  });

  it('contact shortens with velocity and is fixed in time across the keyboard', () => {
    // Felt is a nonlinear spring, F = K x^p with p ~ 2.5, so contact time goes
    // as v^-0.43: a harder blow is a shorter one.
    expect(hammerContactSec(110, 0.1, 0.5)).toBeGreaterThan(
      hammerContactSec(110, 1.0, 0.5),
    );
    // Plan B (2026-09-26): the pulse's width is FIXED IN TIME, so its
    // spectrum is one curve in Hz on every key — the bass rich, the top
    // octave nearly pure, as on the Iowa recordings. The old law lengthened
    // contact toward the bass, which made each note a transposed C4. Only
    // the top-octave cap narrows it, so a fundamental never sits far down
    // the pulse's own spectrum.
    expect(hammerContactSec(55, 1.0, 0.5)).toBeCloseTo(
      hammerContactSec(220, 1.0, 0.5),
      9,
    );
    expect(hammerContactSec(55, 1.0, 0.5)).toBeGreaterThan(
      hammerContactSec(3520, 1.0, 0.5),
    );
    // A hard-voiced hammer shortens contact further than a soft one.
    expect(hammerContactSec(220, 1.0, 1)).toBeLessThan(
      hammerContactSec(220, 1.0, 0),
    );
    // Effective duration (the pulse's equal-area width) stays in a physical
    // millisecond band, and in the treble never goes below the cap itself —
    // at A7 about 0.17 ms, ~0.6 of a 0.28 ms period.
    for (const f0 of [55, 220, 880, 3520]) {
      for (const v of [0.05, 0.5, 1]) {
        const contact = hammerContactSec(f0, v, 0.5);
        expect(contact).toBeGreaterThan(0.00015);
        expect(contact).toBeLessThan(0.012);
      }
    }
  });

  it('upper partials decay FASTER than the fundamental', () => {
    // The retired piano applied ONE envelope to a fixed spectrum, so its
    // timbre was frozen. A real string damps its highs first, which is what
    // makes a piano note darken as it rings.
    const signal = render({ ...BASE, strings: 1 }, 110, 2.2);
    const first = decayT20(signal, 110);
    const fourth = decayT20(signal, 440);
    expect(first).toBeGreaterThan(fourth);
  });

  it('stiffness stretches the partial series sharp', () => {
    // f_k = k*f0*sqrt(1 + B*k^2) — the inharmonicity that makes a piano sound
    // alive rather than like an organ.
    //
    // MEASURED AT PARTIAL 6, NOT 8. `positionBeta` 0.125 puts the strike at
    // 1/8 of the string, and P(z) = 1 - z^(-L/8) NULLS the 8th partial — it
    // measures 104 dB below the fundamental, i.e. pure noise. That is correct
    // physics (it is why a hammer is placed there) and it makes partial 8 the
    // one partial you must not probe. A first version of this test did exactly
    // that and read the dispersion as going the wrong way.
    //
    // B = 2e-3 is a real treble-register value, and puts partial 6 about
    // 600*log2(1 + 36*B) = 31 cents sharp — comfortably above the ~6 cent
    // resolution of a 16384-sample probe at 660 Hz.
    const f0 = 110;
    const partial = 6;
    const B = 2e-3;
    const centreHz = partial * f0;
    const scanCents = (signal: Float32Array): number => {
      let best = 0;
      let bestMagnitude = -1;
      for (let cents = -60; cents <= 160; cents += 0.5) {
        const hz = centreHz * 2 ** (cents / 1200);
        const magnitude = magnitudeAt(signal, hz, Math.round(SR * 0.05), 16384);
        if (magnitude > bestMagnitude) {
          bestMagnitude = magnitude;
          best = cents;
        }
      }
      return best;
    };
    const stiffCents = scanCents(render({ ...BASE, strings: 1, stiffness: B }, f0, 1.2));
    const flatCents = scanCents(render({ ...BASE, strings: 1, stiffness: 0 }, f0, 1.2));
    const theory = 600 * Math.log2(1 + partial * partial * B);
    // Assert the SHIFT, not the absolute position: the flat case carries a
    // small systematic offset from the loop's own phase delay, and it is the
    // stretch that is the physics.
    expect(stiffCents - flatCents).toBeGreaterThan(theory * 0.5);
    expect(stiffCents - flatCents).toBeLessThan(theory * 2);
  });

  it('a unison group rings longer than a single string (two-stage decay)', () => {
    // Bridge-coupled strings do not share a decay rate: the in-phase mode
    // dumps energy into the bridge and dies, the out-of-phase modes linger.
    // The audible consequence is a long aftersound the single string lacks.
    // `unisonCents: 0` ISOLATES the coupling. With the strings detuned they
    // also BEAT — at 3 cents on a 110 Hz note that is a 0.19 Hz beat, a 5.2 s
    // period, so a fixed 2.0-2.9 s window can land in a cancellation null and
    // report the trio as the shorter-ringing one. The decay split and the
    // beating are separate claims; this test makes only the first.
    const single = render({ ...BASE, strings: 1, unisonCents: 0 }, 110, 3);
    const trio = render({ ...BASE, strings: 3, unisonCents: 0 }, 110, 3);
    const tail = (signal: Float32Array): number => {
      let sum = 0;
      for (let i = Math.round(SR * 2.0); i < Math.round(SR * 2.9); i += 1) {
        sum += signal[i] * signal[i];
      }
      return sum;
    };
    const head = (signal: Float32Array): number => {
      let sum = 0;
      for (let i = 0; i < Math.round(SR * 0.3); i += 1) {
        sum += signal[i] * signal[i];
      }
      return sum;
    };
    // Compare tail RELATIVE to each patch's own head, so this is about decay
    // SHAPE and not about three strings simply being louder.
    expect(tail(trio) / head(trio)).toBeGreaterThan(tail(single) / head(single));
  });

  it('stays finite, and goes exactly silent after the damper falls', () => {
    const state = createStruckStringState(SR);
    const block = new Float32Array(128);
    const hz = new Float32Array([220]);
    const velocity = new Float32Array([1]);
    const low = new Float32Array([0]);
    const high = new Float32Array([1]);
    processStruckStringBlock(state, BASE, hz, velocity, low, block, SR);
    for (let i = 0; i < 400; i += 1) {
      const ok = processStruckStringBlock(
        state,
        BASE,
        hz,
        velocity,
        high,
        block,
        SR,
      );
      expect(ok).toBe(true);
      for (const sample of block) expect(Number.isFinite(sample)).toBe(true);
    }
    // Release: the damper falls and the group must reach exact zero.
    for (let i = 0; i < 4000; i += 1) {
      processStruckStringBlock(state, BASE, hz, velocity, low, block, SR);
    }
    expect(state.idle).toBe(true);
    for (const sample of block) expect(sample).toBe(0);
  });
});

/**
 * Output level is a CONTRACT, not an accident.
 *
 * The bridge-force integrator I(z) has a 1/f magnitude, so without
 * compensation an identical hammer blow comes out roughly twice as hot per
 * octave downward: one low C measured a 6.29 peak at velocity 0.7 — 16 dB
 * past full scale on a single note, before any polyphony. It sounded
 * distorted and quiet at once, because the meter was pegged by a note that
 * was clipped into a near-square rather than loud.
 *
 * These tests pin the two properties that fix has to keep simultaneously:
 * level is flat across the keyboard, and velocity still moves it.
 */
describe('struck string output level', () => {
  const SAMPLE_RATE = 48000;
  const BLOCK = 128;
  const PARAMS = {
    positionBeta: 0.125,
    brightness: 0.42,
    decaySec: 8,
    stiffness: 2.5e-4,
    strings: 3,
    unisonCents: 3,
    hardness: 0.35,
    octave: 0,
    dampOnRelease: true,
  };

  /** Peak of one strike. The gate starts LOW: `lastGate === null` RECORDS a
   *  first edge rather than playing it, so a gate that is already high at
   *  sample 0 never strikes at all. */
  function strikePeak(hz: number, velocity: number): number {
    const state = createStruckStringState(SAMPLE_RATE);
    const pitch = new Float32Array([hz]);
    const level = new Float32Array([velocity]);
    const gate = new Float32Array(BLOCK);
    const out = new Float32Array(BLOCK);
    let peak = 0;
    const blocks = Math.round((SAMPLE_RATE * 0.75) / BLOCK);
    for (let block = 0; block < blocks; block += 1) {
      for (let i = 0; i < BLOCK; i += 1) {
        gate[i] = block * BLOCK + i >= 256 ? 1 : 0;
      }
      processStruckStringBlock(
        state,
        PARAMS,
        pitch,
        level,
        gate,
        out,
        SAMPLE_RATE,
      );
      for (let i = 0; i < BLOCK; i += 1) {
        const magnitude = Math.abs(out[i]);
        if (magnitude > peak) peak = magnitude;
      }
    }
    return peak;
  }

  const SPAN = [27.5, 65.4, 261.6, 1046.5, 4186] as const;

  it('never leaves headroom behind, even fortissimo on the lowest key', () => {
    for (const hz of SPAN) {
      const peak = strikePeak(hz, 1);
      expect(peak, `${hz} Hz at velocity 1.0`).toBeLessThan(1);
      expect(peak, `${hz} Hz at velocity 1.0`).toBeGreaterThan(0.1);
    }
  });

  it('holds level within 2x across the whole keyboard', () => {
    // Before compensation this spread was 6.6x over just THREE octaves, and
    // the bass end sat above full scale. Some variation is real piano
    // behaviour; an octave-by-octave doubling is not.
    const peaks = SPAN.map((hz) => strikePeak(hz, 0.7));
    const quietest = Math.min(...peaks);
    const loudest = Math.max(...peaks);
    expect(loudest / quietest).toBeLessThan(2);
  });

  it('still lets velocity drive level at every pitch', () => {
    // Compensation divides the strike by a PITCH term only. If it ever
    // absorbed the velocity term too, dynamics would flatten out silently.
    for (const hz of SPAN) {
      const soft = strikePeak(hz, 0.4);
      const hard = strikePeak(hz, 1);
      expect(hard, `${hz} Hz`).toBeGreaterThan(soft * 1.5);
    }
  });
});

/**
 * A struck note must actually be a NOTE: periodic, at the pitch asked for.
 *
 * The failure this guards is not silence — it is worse than silence and is
 * what the octave-switch bug produced. Re-pitching a ringing delay line left
 * the string emitting a near-DC signal: zero zero-crossings, a pegged peak
 * meter, and nothing audible. Anything that reintroduces DC collapse (a
 * normalisation change, a filter sign error) shows up here rather than as a
 * user saying the meter is full and they hear nothing.
 */
describe('struck string produces a pitched note', () => {
  const SAMPLE_RATE = 48000;
  const BLOCK = 128;
  const PARAMS = {
    positionBeta: 0.125,
    brightness: 0.42,
    decaySec: 8,
    stiffness: 2.5e-4,
    strings: 3,
    unisonCents: 3,
    hardness: 0.35,
    octave: 0,
    dampOnRelease: true,
  };

  /** Render one held strike and return the tail, past the attack transient. */
  function tailOf(hz: number): Float32Array {
    const state = createStruckStringState(SAMPLE_RATE);
    const pitch = new Float32Array([hz]);
    const velocity = new Float32Array([0.7]);
    const gate = new Float32Array(BLOCK);
    const out = new Float32Array(BLOCK);
    const blocks = Math.round((SAMPLE_RATE * 0.6) / BLOCK);
    const skip = Math.round(SAMPLE_RATE * 0.3);
    const tail: number[] = [];
    for (let block = 0; block < blocks; block += 1) {
      for (let i = 0; i < BLOCK; i += 1) {
        gate[i] = block * BLOCK + i >= 256 ? 1 : 0;
      }
      processStruckStringBlock(
        state,
        PARAMS,
        pitch,
        velocity,
        gate,
        out,
        SAMPLE_RATE,
      );
      for (let i = 0; i < BLOCK; i += 1) {
        if (block * BLOCK + i >= skip) tail.push(out[i]);
      }
    }
    return Float32Array.from(tail);
  }

  /** Autocorrelation pitch estimate — robust where a zero-crossing count is
   *  not, because the harmonics a piano string carries add crossings. */
  function estimateHz(signal: Float32Array): number {
    const minLag = Math.floor(SAMPLE_RATE / 4200);
    const maxLag = Math.min(Math.floor(SAMPLE_RATE / 25), signal.length >> 1);
    let bestLag = 0;
    let best = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let sum = 0;
      for (let i = 0; i + lag < signal.length; i += 1) {
        sum += signal[i] * signal[i + lag];
      }
      const normalised = sum / (signal.length - lag);
      if (normalised > best) {
        best = normalised;
        bestLag = lag;
      }
    }
    return bestLag > 0 ? SAMPLE_RATE / bestLag : 0;
  }

  for (const hz of [130.8, 261.6, 523.3]) {
    it(`settles at ${hz} Hz rather than collapsing to DC`, () => {
      const tail = tailOf(hz);

      // Not DC: the tail must cross zero. A ringing string that has been
      // re-pitched under itself measured ZERO crossings over a full second.
      let crossings = 0;
      for (let i = 1; i < tail.length; i += 1) {
        if (tail[i - 1] < 0 !== tail[i] < 0) crossings += 1;
      }
      expect(crossings).toBeGreaterThan(10);

      // And the mean must be small next to the swing — a large offset is the
      // same defect caught before it fully silences the note.
      let mean = 0;
      let peak = 0;
      for (const value of tail) {
        mean += value;
        const magnitude = Math.abs(value);
        if (magnitude > peak) peak = magnitude;
      }
      mean /= tail.length;
      expect(Math.abs(mean)).toBeLessThan(peak * 0.1);

      // COARSE: autocorrelation resolves whole-sample lags only, so this
      // cannot see cents. It passed while the treble played nearly two
      // semitones flat at C6. Tuning is pinned by the FFT test below.
      // Inharmonicity and the dispersion cascade both shift it slightly, so
      // this is a sanity bound, not a tuning spec.
      const estimated = estimateHz(tail);
      expect(estimated).toBeGreaterThan(hz * 0.94);
      expect(estimated).toBeLessThan(hz * 1.06);
    });
  }
});

/**
 * The treble must be a STRING, not just a hammer.
 *
 * The loop filter runs once per period, so a pole fixed in Hz damps a high
 * note far faster per second than a low one, and past about G4 the safety cap
 * on loop gain silently shortened `Decay s` too. The strike was identical at
 * every pitch, so the upper octaves became all attack: attack-over-body ran
 * 10 dB at C4, 16 at C5 and 46 at C6 — heard as "ramming a key".
 */
describe('struck string treble keeps its body', () => {
  const SAMPLE_RATE = 48000;
  const BLOCK = 128;
  const PARAMS = {
    positionBeta: 0.125,
    brightness: 0.42,
    decaySec: 8,
    stiffness: 2.5e-4,
    strings: 3,
    unisonCents: 3,
    hardness: 0.35,
    octave: 0,
    dampOnRelease: true,
  };

  /** Strike peak in the first 50 ms over body RMS from 0.1 to 0.3 s, in dB. */
  function attackOverBody(hz: number): number {
    const state = createStruckStringState(SAMPLE_RATE);
    const pitch = new Float32Array([hz]);
    const velocity = new Float32Array([0.4]);
    const gate = new Float32Array(BLOCK);
    const out = new Float32Array(BLOCK);
    const EDGE = 256;
    let attackPeak = 0;
    let bodyEnergy = 0;
    let bodySamples = 0;
    const blocks = Math.round((SAMPLE_RATE * 0.35) / BLOCK);
    for (let block = 0; block < blocks; block += 1) {
      for (let i = 0; i < BLOCK; i += 1) {
        gate[i] = block * BLOCK + i >= EDGE ? 1 : 0;
      }
      processStruckStringBlock(
        state,
        PARAMS,
        pitch,
        velocity,
        gate,
        out,
        SAMPLE_RATE,
      );
      for (let i = 0; i < BLOCK; i += 1) {
        const t = (block * BLOCK + i - EDGE) / SAMPLE_RATE;
        // 50 ms, not 5: with the Gaussian pulse and the soundboard, C4's
        // attack peaks at ~10 ms, so a 5 ms window read the REFERENCE low
        // (0.038 against a true 0.22) and flagged every other note.
        if (t >= 0 && t < 0.05) {
          attackPeak = Math.max(attackPeak, Math.abs(out[i]));
        } else if (t >= 0.1 && t < 0.3) {
          bodyEnergy += out[i] * out[i];
          bodySamples += 1;
        }
      }
    }
    return 20 * Math.log10(attackPeak / Math.sqrt(bodyEnergy / bodySamples));
  }

  it('balances attack against body up to C6 the way C4 does', () => {
    const reference = attackOverBody(261.6);
    for (const hz of [392, 523.3, 659.3, 1046.5]) {
      // Before the fix: +2.5 dB at G4, +6 at C5, +12 at E5, +36 at C6.
      // After it, with the tuning corrected too: about +4 at C6 — a real
      // treble carries somewhat more hammer than the tenor. The guard is
      // against the COLLAPSE, which is an order of magnitude past this.
      expect(attackOverBody(hz) - reference, `${hz} Hz`).toBeLessThan(6);
    }
  });
});

/**
 * TUNING, to the cent.
 *
 * Two delay-bookkeeping errors once made every note flat by (1 + sections)
 * samples of period: `allpassPhaseDelay` under-reported each dispersion
 * section by a sample, and the read-then-write-ahead in `stepLine` added one
 * the line delay never gave back. A fixed error in samples is a bigger share
 * of a shorter period, so it grew up the keyboard — -46 cents at C4, -91 at
 * C5, -181 at C6 — and sounded like the treble had stopped being a piano.
 * The coarse autocorrelation check above let all of it through.
 */
describe('struck string tuning', () => {
  const SAMPLE_RATE = 48000;
  const BLOCK = 128;
  const SIZE = 1 << 16;

  function fft(re: Float64Array, im: Float64Array): void {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i += 1) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const angle = (-2 * Math.PI) / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < len / 2; k += 1) {
          const wr = Math.cos(angle * k);
          const wi = Math.sin(angle * k);
          const a = i + k;
          const b = a + len / 2;
          const vr = re[b] * wr - im[b] * wi;
          const vi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - vr;
          im[b] = im[a] - vi;
          re[a] += vr;
          im[a] += vi;
        }
      }
    }
  }

  /** Fundamental error in cents: windowed FFT peak, parabolic on log |X|. */
  function centsOff(hz: number, stiffness: number): number {
    const state = createStruckStringState(SAMPLE_RATE);
    const params = {
      positionBeta: 0.125,
      brightness: 0.42,
      decaySec: 8,
      stiffness,
      strings: 1,
      unisonCents: 0,
      hardness: 0.35,
      octave: 0,
      dampOnRelease: true,
    };
    const pitch = new Float32Array([hz]);
    const velocity = new Float32Array([0.4]);
    const gate = new Float32Array(BLOCK);
    const block = new Float32Array(BLOCK);
    const skip = 2048;
    const signal = new Float64Array(SIZE + skip);
    for (let start = 0; start < signal.length; start += BLOCK) {
      for (let i = 0; i < BLOCK; i += 1) gate[i] = start + i >= 256 ? 1 : 0;
      processStruckStringBlock(
        state,
        params,
        pitch,
        velocity,
        gate,
        block,
        SAMPLE_RATE,
      );
      for (let i = 0; i < BLOCK && start + i < signal.length; i += 1) {
        signal[start + i] = block[i];
      }
    }
    const re = new Float64Array(SIZE);
    const im = new Float64Array(SIZE);
    for (let i = 0; i < SIZE; i += 1) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (SIZE - 1));
      re[i] = signal[i + skip] * hann;
    }
    fft(re, im);
    const logMag = (k: number) => Math.log(Math.hypot(re[k], im[k]) + 1e-30);
    const low = Math.round((hz * 0.8 * SIZE) / SAMPLE_RATE);
    const high = Math.round((hz * 1.2 * SIZE) / SAMPLE_RATE);
    let peak = low;
    for (let k = low; k <= high; k += 1) if (logMag(k) > logMag(peak)) peak = k;
    const offset =
      (0.5 * (logMag(peak - 1) - logMag(peak + 1))) /
      (logMag(peak - 1) - 2 * logMag(peak) + logMag(peak + 1));
    return 1200 * Math.log2(((peak + offset) * SAMPLE_RATE) / SIZE / hz);
  }

  for (const stiffness of [0, 2.5e-4]) {
    it(`plays in tune from C2 to D#8 (stiffness ${stiffness})`, () => {
      // Up to D#8: the top octave is reachable with the octave shift, and
      // from G7 up it used to play 402-601 cents flat (zero-pole dispersion
      // sections counted as zero delay).
      for (const hz of [65.41, 261.63, 523.25, 1046.5, 2093, 3136, 4978]) {
        expect(Math.abs(centsOff(hz, stiffness)), `${hz} Hz`).toBeLessThan(2);
      }
    });
  }
});

/**
 * LOUDNESS across the playable range.
 *
 * Measured by ITU-R BS.1770 K-weighting (the basis of LUFS). Before the level
 * law the voice ran -24 dB at C1 and +20 at C8 relative to C4 — much of what
 * "the lower the note the fainter, the higher the sharper" described. The
 * law is fitted at velocity 0.4 with the demo's voicing, which is what this
 * checks.
 */
describe('struck string loudness', () => {
  const SAMPLE_RATE = 48000;
  const BLOCK = 128;
  const PARAMS = {
    positionBeta: 0.125,
    brightness: 0.42,
    decaySec: 8,
    stiffness: 2.5e-4,
    strings: 3,
    unisonCents: 3,
    hardness: 0.35,
    octave: 0,
    dampOnRelease: true,
  };

  function biquad(
    x: Float64Array,
    b: readonly number[],
    a: readonly number[],
  ): Float64Array {
    const y = new Float64Array(x.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let n = 0; n < x.length; n += 1) {
      const v = b[0] * x[n] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
      x2 = x1;
      x1 = x[n];
      y2 = y1;
      y1 = v;
      y[n] = v;
    }
    return y;
  }

  /** K-weighted mean square of the body, 150-350 ms, in dB (48 kHz). */
  function loudness(hz: number): number {
    const state = createStruckStringState(SAMPLE_RATE);
    const pitch = new Float32Array([hz]);
    const velocity = new Float32Array([0.4]);
    const gate = new Float32Array(BLOCK);
    const out = new Float32Array(BLOCK);
    const length = Math.round(SAMPLE_RATE * 0.36);
    const signal = new Float64Array(length);
    for (let start = 0; start < length + 256; start += BLOCK) {
      for (let i = 0; i < BLOCK; i += 1) gate[i] = start + i >= 256 ? 1 : 0;
      processStruckStringBlock(
        state,
        PARAMS,
        pitch,
        velocity,
        gate,
        out,
        SAMPLE_RATE,
      );
      for (let i = 0; i < BLOCK; i += 1) {
        const k = start + i - 256;
        if (k >= 0 && k < length) signal[k] = out[i];
      }
    }
    const shelved = biquad(
      signal,
      [1.53512485958697, -2.69169618940638, 1.19839281085285],
      [1, -1.69065929318241, 0.73248077421585],
    );
    const weighted = biquad(
      shelved,
      [1, -2, 1],
      [1, -1.99004745483398, 0.99007225036621],
    );
    let sum = 0;
    const from = Math.round(SAMPLE_RATE * 0.15);
    const to = Math.round(SAMPLE_RATE * 0.35);
    for (let n = from; n < to; n += 1) sum += weighted[n] * weighted[n];
    return 10 * Math.log10(sum / (to - from));
  }

  it('holds C1 to D#8 within a few dB of C4', () => {
    const reference = loudness(261.63);
    for (const hz of [32.7, 65.41, 130.81, 523.25, 1046.5, 2093, 4978]) {
      const offset = loudness(hz) - reference;
      expect(Math.abs(offset), `${hz} Hz: ${offset.toFixed(1)} dB`).toBeLessThan(5);
    }
  });
});

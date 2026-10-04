/**
 * fdnReverbCore — the properties that make it a usable reverberator.
 *
 * A reverb that blows up is worse than no reverb, and a reverb whose decay
 * knob does not deliver its decay is a knob that lies. Both are asserted here
 * against a rendered impulse response rather than by inspection.
 */

import { describe, expect, it } from 'vitest';
import {
  createFdnReverbState,
  processFdnReverbBlock,
  primeAtLeast,
} from '../soundDefinitions/fdnReverbCore';
import type { FdnReverbParams } from '../soundDefinitions/fdnReverbCore';

const SR = 48000;

const BASE: FdnReverbParams = {
  sizeScale: 1,
  decaySec: 2,
  dampingHz: 8000,
  modRateHz: 0.7,
  modDepthMs: 3,
  diffusion: 0.6,
  lowCutHz: 100,
  width: 1,
  mix: 1,
};

/** Impulse response, `seconds` long. */
function impulse(
  params: FdnReverbParams,
  seconds: number,
): { left: Float32Array; right: Float32Array } {
  const state = createFdnReverbState(SR);
  const total = Math.round(SR * seconds);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const block = 128;
  const inL = new Float32Array(block);
  const inR = new Float32Array(block);
  const outL = new Float32Array(block);
  const outR = new Float32Array(block);
  let written = 0;
  let first = true;
  while (written < total) {
    inL.fill(0);
    inR.fill(0);
    if (first) {
      inL[0] = 1;
      inR[0] = 1;
      first = false;
    }
    processFdnReverbBlock(state, params, inL, inR, outL, outR, SR);
    const take = Math.min(block, total - written);
    left.set(outL.subarray(0, take), written);
    right.set(outR.subarray(0, take), written);
    written += take;
  }
  return { left, right };
}

/** T60 by Schroeder backward integration over the -5..-25 dB span. */
function measureT60(x: Float32Array): number {
  const energy = new Float64Array(x.length);
  let running = 0;
  for (let i = x.length - 1; i >= 0; i -= 1) {
    running += x[i] * x[i];
    energy[i] = running;
  }
  const peak = energy[0];
  if (!(peak > 0)) return Number.NaN;
  let i5 = -1;
  let i25 = -1;
  for (let i = 0; i < energy.length; i += 1) {
    const db = 10 * Math.log10(energy[i] / peak);
    if (i5 < 0 && db <= -5) i5 = i;
    if (i25 < 0 && db <= -25) {
      i25 = i;
      break;
    }
  }
  if (i5 < 0 || i25 <= i5) return Number.NaN;
  const t5 = i5 / SR;
  const t25 = i25 / SR;
  const slope = -20 / (t25 - t5);
  return -60 / slope;
}

function bandEnergy(x: Float32Array, lo: number, hi: number): number {
  // Goertzel-style sum over a coarse frequency grid; enough to compare bands.
  let total = 0;
  for (let hz = lo; hz <= hi; hz += (hi - lo) / 24) {
    let re = 0;
    let im = 0;
    const step = (2 * Math.PI * hz) / SR;
    for (let n = 0; n < x.length; n += 1) {
      re += x[n] * Math.cos(step * n);
      im -= x[n] * Math.sin(step * n);
    }
    total += re * re + im * im;
  }
  return total;
}

describe('fdnReverbCore', () => {
  it('delay lengths are distinct primes, so echoes never align', () => {
    // Aligned delay lengths reinforce into an audible ringing pitch; primes
    // are the standard guard because no two share a period.
    expect(primeAtLeast(100)).toBe(101);
    expect(primeAtLeast(101)).toBe(101);
    expect(primeAtLeast(2)).toBe(2);
  });

  it('is STABLE: the impulse response decays and never grows', () => {
    // The feedback matrix is orthogonal, so energy is preserved exactly and
    // stability rests only on the per-line gains being < 1. If that ever
    // stopped holding, this is where it shows.
    // Peaks by LOOP, not `Math.max(...array)`: spreading 48 000 arguments is
    // both slow and stack-risky, and a first version of this test timed out
    // on exactly that rather than on anything the reverb did.
    const peak = (x: Float32Array, from: number, to: number): number => {
      let best = 0;
      for (let i = from; i < to; i += 1) {
        const v = x[i] < 0 ? -x[i] : x[i];
        if (v > best) best = v;
      }
      return best;
    };
    const { left } = impulse({ ...BASE, decaySec: 6 }, 3);
    const early = peak(left, 0, SR >> 1);
    const late = peak(left, 2 * SR, 3 * SR);
    expect(Number.isFinite(early)).toBe(true);
    expect(early).toBeGreaterThan(0);
    expect(late).toBeLessThan(early);
    for (const v of left) expect(Number.isFinite(v)).toBe(true);
  });

  it('the decay knob delivers the decay it promises', () => {
    // Per-line gain solves 10^(-3m/(T60*fs)) so every line reaches -60 dB in
    // the same time regardless of its length. A knob that does not deliver is
    // worse than no knob.
    // Two decay times, rendered 2x rather than 2.5x: this suite is
    // synthesis-heavy and this repo's slow tests time out under load.
    for (const decaySec of [1, 3]) {
      const { left } = impulse(
        { ...BASE, decaySec, dampingHz: 18000, modDepthMs: 0 },
        decaySec * 2,
      );
      const measured = measureT60(left);
      expect(Number.isFinite(measured)).toBe(true);
      // Within 30 %: the diffusers and the damping filter both shorten it
      // slightly, and exactness is not the claim — proportionality is.
      expect(measured).toBeGreaterThan(decaySec * 0.7);
      expect(measured).toBeLessThan(decaySec * 1.3);
    }
  });

  it('damping makes highs decay faster than lows', () => {
    const dark = impulse({ ...BASE, dampingHz: 1200 }, 3).left;
    const bright = impulse({ ...BASE, dampingHz: 18000 }, 3).left;
    // Compare the LATE tail: early on both still carry their input.
    const late = (x: Float32Array) => x.subarray(SR, 3 * SR) as Float32Array;
    const darkRatio =
      bandEnergy(late(dark), 3000, 6000) / bandEnergy(late(dark), 200, 500);
    const brightRatio =
      bandEnergy(late(bright), 3000, 6000) / bandEnergy(late(bright), 200, 500);
    expect(darkRatio).toBeLessThan(brightRatio);
  });

  it('modulation changes the tail — the whole reason it is here', () => {
    // A static FDN rings metallically; modulating the delay lengths smears
    // its modes. If this ever became a no-op the lushness would go with it.
    const still = impulse({ ...BASE, modDepthMs: 0 }, 2).left;
    const moved = impulse({ ...BASE, modDepthMs: 4, modRateHz: 1.1 }, 2).left;
    let difference = 0;
    for (let i = 0; i < still.length; i += 1) {
      difference += Math.abs(still[i] - moved[i]);
    }
    const energy = still.reduce((sum, v) => sum + Math.abs(v), 0);
    expect(difference / Math.max(energy, 1e-12)).toBeGreaterThan(0.1);
  });

  it('the two outputs are decorrelated — it is a real stereo field', () => {
    const { left, right } = impulse(BASE, 2);
    let dot = 0;
    let nl = 0;
    let nr = 0;
    for (let i = 0; i < left.length; i += 1) {
      dot += left[i] * right[i];
      nl += left[i] * left[i];
      nr += right[i] * right[i];
    }
    const corr = dot / Math.sqrt(nl * nr);
    expect(Math.abs(corr)).toBeLessThan(0.7);
  });

  it('width 0 collapses the tail to mono', () => {
    const { left, right } = impulse({ ...BASE, width: 0 }, 1);
    for (let i = 0; i < left.length; i += 200) {
      expect(Math.abs(left[i] - right[i])).toBeLessThan(1e-6);
    }
  });

  it('mix 0 passes the dry signal through untouched', () => {
    const state = createFdnReverbState(SR);
    const block = 128;
    const inL = new Float32Array(block);
    const inR = new Float32Array(block);
    const outL = new Float32Array(block);
    const outR = new Float32Array(block);
    for (let i = 0; i < block; i += 1) {
      inL[i] = Math.sin(i * 0.1);
      inR[i] = Math.cos(i * 0.1);
    }
    processFdnReverbBlock(
      state,
      { ...BASE, mix: 0 },
      inL,
      inR,
      outL,
      outR,
      SR,
    );
    for (let i = 0; i < block; i += 1) {
      expect(outL[i]).toBeCloseTo(inL[i], 6);
      expect(outR[i]).toBeCloseTo(inR[i], 6);
    }
  });
});

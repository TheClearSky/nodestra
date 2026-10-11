import { describe, expect, it } from 'vitest';
import { createAdaptive, isTier, pickTier, readTuning, TIERS } from '../landing/meadow/env/scene-quality';
import type { Rung, TierSignals } from '../landing/meadow/env/scene-quality';

// The meadow scenes' quality (the guitar under the oak, the sakura): the
// startup guess, the URL knobs, and the runtime ladder (the piano stage's
// own machine, with the meadows' rungs).

const NVIDIA = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Laptop GPU (0x00002860) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const INTEL_UHD = 'ANGLE (Intel, Intel(R) UHD Graphics (0x0000A788) Direct3D11 vs_5_0 ps_5_0, D3D11)';

const desktop: TierSignals = {
  gpu: NVIDIA,
  cores: 16,
  memory: 8,
  screenWidth: 1280,
  screenHeight: 800,
  devicePixelRatio: 1,
  coarsePointer: false,
};

describe('pickTier (meadows)', () => {
  it('keeps a capable desktop at HIGH', () => {
    expect(pickTier(desktop)).toMatchObject({ params: TIERS.high, reasons: ['capable GPU'], forced: false });
  });

  it('reads "Apple GPU" as a phone only on a touch-first device (Safari names a Mac the same)', () => {
    expect(pickTier({ ...desktop, gpu: 'Apple GPU' }).params.tier).toBe('high');
    expect(pickTier({ ...desktop, gpu: 'Apple GPU', coarsePointer: true }).params.tier).toBe('low');
    expect(pickTier({ ...desktop, gpu: 'Apple A15 GPU' }).params.tier).toBe('low');
  });

  it('still steps an integrated GPU down once (the meadows\' own rule, open question Q9)', () => {
    expect(pickTier({ ...desktop, gpu: INTEL_UHD })).toMatchObject({ params: { tier: 'medium' }, reasons: ['integrated GPU'] });
  });

  it('obeys ?quality= only for a real tier name', () => {
    expect(pickTier({ ...desktop, forced: 'low' })).toMatchObject({ forced: true, params: TIERS.low });
    for (const bad of ['__proto__', 'toString', 'constructor', 'ultra', '']) {
      expect(isTier(bad)).toBe(false);
      expect(pickTier({ ...desktop, forced: bad })).toMatchObject({ forced: false, params: TIERS.high });
    }
  });
});

describe('readTuning (meadow URL knobs)', () => {
  it('keeps values inside the ranges the scenes can draw', () => {
    expect(readTuning('?pr=50&samples=16&bloom=7&grass=100000')).toEqual({ pr: 2, samples: 4, bloom: 1, grass: 1.5 });
    expect(readTuning('?pr=0.1&samples=-3&bloom=-1&grass=-2')).toEqual({ pr: 0.5, samples: 0, bloom: 0, grass: 0 });
  });

  it('takes MSAA samples to the nearest of 0, 2 and 4', () => {
    expect(readTuning('?samples=1.2').samples).toBe(2);
    expect(readTuning('?samples=3.5').samples).toBe(4);
    expect(readTuning('?samples=0.4').samples).toBe(0);
  });

  it('passes values in range through, and ignores what is not a number', () => {
    expect(readTuning('?pr=1.25&bloom=0.5&grass=0.8&samples=2')).toEqual({ pr: 1.25, samples: 2, bloom: 0.5, grass: 0.8 });
    expect(readTuning('?pr=abc&grass=&bloom=Infinity')).toEqual({ pr: undefined, samples: undefined, bloom: undefined, grass: undefined });
    expect(readTuning('')).toEqual({ pr: undefined, samples: undefined, bloom: undefined, grass: undefined });
  });
});

describe('createAdaptive (meadows)', () => {
  /** Frames `ms` apart for `seconds` after `from`; returns the end time. */
  const run = (adaptive: ReturnType<typeof createAdaptive>, from: number, ms: number, seconds: number, capped = false) => {
    let t = from;
    while (t < from + seconds * 1000) {
      t += ms;
      adaptive.frame(t, capped);
    }
    return t;
  };

  it('applies rung 0 at creation, so a new scene never inherits the last scene\'s rung', () => {
    const applied: Rung[] = [];
    createAdaptive((r) => applied.push(r), { enabled: true });
    expect(applied).toEqual([{ grassKeep: 1, flowerKeep: 1, prScale: 1, maxSamples: 4 }]);
    // Also with adaptation off (a forced tier): the shared uniforms are still reset.
    const forced: Rung[] = [];
    createAdaptive((r) => forced.push(r), { enabled: false });
    expect(forced).toHaveLength(1);
  });

  it('does not step down on a 144 Hz screen whose frames the 61 fps cap holds back', () => {
    // The cap renders every third 144 Hz vsync: 20.8 ms apart, every one capped.
    const adaptive = createAdaptive(() => {}, { enabled: true });
    run(adaptive, 0, 20.8, 120, true);
    expect(adaptive.rung()).toBe(0);
    expect(adaptive.label()).toBe('');
  });

  it('does step down when the same 20.8 ms is load (no frame was skipped)', () => {
    const applied: Rung[] = [];
    const adaptive = createAdaptive((r) => applied.push(r), { enabled: true });
    run(adaptive, 0, 20.8, 12);
    expect(adaptive.rung()).toBe(1);
    expect(applied.at(-1)).toEqual({ grassKeep: 0.8, flowerKeep: 0.85, prScale: 1, maxSamples: 4 });
  });

  it('warms up from its first frame, not from its creation', () => {
    const adaptive = createAdaptive(() => {}, { enabled: true });
    // The scene was made long before its first frame (a slow chunk, a shader
    // compile): its first seconds are still warm-up.
    let t = run(adaptive, 100_000, 60, 3.9);
    t = run(adaptive, t, 16.7, 30);
    expect(adaptive.rung()).toBe(0);
  });

  it('forgets the window when the loop starts again (reset)', () => {
    const adaptive = createAdaptive(() => {}, { enabled: true });
    let t = run(adaptive, 0, 16.7, 9);
    adaptive.reset();
    t += 60_000; // stopped for a minute (off screen, hidden tab)
    t = run(adaptive, t, 40, 3.5); // shader re-uploads right after: warm-up
    run(adaptive, t, 16.7, 20);
    expect(adaptive.rung()).toBe(0);
  });
});

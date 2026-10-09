import { describe, expect, it } from 'vitest';
import { STAGE_TIERS, createStageAdaptive, pickStageTier, stageLadder } from '../landing/stageQuality';
import type { StageSignals } from '../landing/stageQuality';

// Renderer strings as browsers report them (Chrome's ANGLE strings; Safari
// masks every Apple GPU as "Apple GPU").
const NVIDIA = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Laptop GPU (0x00002860) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const INTEL_UHD = 'ANGLE (Intel, Intel(R) UHD Graphics (0x0000A788) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const SWIFTSHADER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
const ADRENO = 'Adreno (TM) 650';

const desktop: StageSignals = {
  gpu: NVIDIA,
  cores: 32,
  memory: 8,
  screenWidth: 1280,
  screenHeight: 800,
  devicePixelRatio: 1,
  coarsePointer: false,
};
const phone: StageSignals = {
  gpu: ADRENO,
  cores: 8,
  memory: 8,
  screenWidth: 390,
  screenHeight: 844,
  devicePixelRatio: 3,
  coarsePointer: true,
};

describe('pickStageTier', () => {
  it('keeps a capable desktop at HIGH — the stage as it always was', () => {
    const guess = pickStageTier(desktop);
    expect(guess.params.tier).toBe('high');
    expect(guess.params).toEqual(STAGE_TIERS.high);
    expect(STAGE_TIERS.high).toMatchObject({ prCap: 1.75, bloom: 1, shadowMap: 2048, dust: 700, motes: 220, antialias: true });
    expect(guess.reasons).toEqual(['capable GPU']);
  });

  it('takes mobile and software GPUs to LOW', () => {
    expect(pickStageTier(phone).params.tier).toBe('low');
    expect(pickStageTier({ ...desktop, gpu: SWIFTSHADER }).params.tier).toBe('low');
    expect(pickStageTier({ ...desktop, gpu: 'llvmpipe (LLVM 15.0.7, 256 bits)' }).params.tier).toBe('low');
    expect(pickStageTier({ ...desktop, gpu: 'Mali-G78 MP14' }).params.tier).toBe('low');
  });

  it('keeps an integrated GPU at HIGH on an ordinary screen', () => {
    // Deepak's Intel UHD, 1280×800 @1 (1.0 M px): 41–46 fps on HIGH.
    const guess = pickStageTier({ ...desktop, gpu: INTEL_UHD });
    expect(guess.params.tier).toBe('high');
    expect(pickStageTier({ ...desktop, gpu: 'AMD Radeon(TM) Graphics' }).params.tier).toBe('high');
    // 1920×1080 @1 (2.1 M px) is still under the integrated bar.
    expect(pickStageTier({ ...desktop, gpu: INTEL_UHD, screenWidth: 1920, screenHeight: 1080 }).params.tier).toBe('high');
  });

  it('steps an integrated GPU down once above ~2.5 M px', () => {
    // Deepak's laptop panel: 1707×1067 @1.5 = 4.1 M px, 12.5 fps on HIGH.
    const laptop = { ...desktop, gpu: INTEL_UHD, screenWidth: 1707, screenHeight: 1067, devicePixelRatio: 1.5 };
    const guess = pickStageTier(laptop);
    expect(guess.params.tier).toBe('medium');
    expect(guess.reasons).toEqual(['4.1 M px on an integrated GPU']);
    // The same screen on a discrete GPU stays HIGH (under 4.5 M).
    expect(pickStageTier({ ...laptop, gpu: NVIDIA }).params.tier).toBe('high');
    // Intel's discrete Arc cards are not integrated.
    expect(pickStageTier({ ...laptop, gpu: 'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics, D3D11)' }).params.tier).toBe('high');
  });

  it('never demotes an integrated GPU twice for one big screen', () => {
    // 2560×1440 @2 = 14.7 M px: over both bars, still one step.
    const guess = pickStageTier({ ...desktop, gpu: INTEL_UHD, screenWidth: 2560, screenHeight: 1440, devicePixelRatio: 2 });
    expect(guess.params.tier).toBe('medium');
    expect(guess.reasons).toHaveLength(1);
  });

  it('counts few cores OR little memory as one step, not two', () => {
    expect(pickStageTier({ ...desktop, cores: 4 }).params.tier).toBe('medium');
    expect(pickStageTier({ ...desktop, memory: 4 }).params.tier).toBe('medium');
    expect(pickStageTier({ ...desktop, cores: 4, memory: 2 }).params.tier).toBe('medium');
  });

  it('steps a very large screen down once', () => {
    // 2560×1440 CSS px at DPR 2 → 14.7 M px.
    const guess = pickStageTier({ ...desktop, screenWidth: 2560, screenHeight: 1440, devicePixelRatio: 2 });
    expect(guess.params.tier).toBe('medium');
    expect(guess.reasons[0]).toMatch(/M px/);
    // 1707×1067 at DPR 1.5 (a 2560×1600 laptop panel) → 4.1 M: no step.
    expect(pickStageTier({ ...desktop, screenWidth: 1707, screenHeight: 1067, devicePixelRatio: 1.5 }).params.tier).toBe('high');
  });

  it('holds a touch-first device to MEDIUM at most', () => {
    expect(pickStageTier({ ...desktop, coarsePointer: true }).params.tier).toBe('medium');
  });

  it('reads "Apple GPU" as a phone only on a touch-first device', () => {
    // Safari on an M-series Mac and on an iPhone report the same string.
    expect(pickStageTier({ ...desktop, gpu: 'Apple GPU' }).params.tier).toBe('high');
    expect(pickStageTier({ ...phone, gpu: 'Apple GPU' }).params.tier).toBe('low');
  });

  it('combines steps down to LOW and no further', () => {
    const guess = pickStageTier({ ...desktop, gpu: INTEL_UHD, cores: 4, screenWidth: 2560, screenHeight: 1440, devicePixelRatio: 2 });
    expect(guess.params.tier).toBe('low');
    expect(guess.reasons).toEqual(['4 cores', '14.7 M px on an integrated GPU']);
  });

  it('obeys ?quality= and ignores a bad value', () => {
    expect(pickStageTier({ ...phone, forced: 'high' })).toMatchObject({ forced: true, params: { tier: 'high' } });
    expect(pickStageTier({ ...desktop, forced: 'low' }).params.tier).toBe('low');
    expect(pickStageTier({ ...desktop, forced: 'ultra' })).toMatchObject({ forced: false, params: { tier: 'high' } });
  });

  it('treats an unknown GPU string as capable', () => {
    expect(pickStageTier({ ...desktop, gpu: '' }).params.tier).toBe('high');
  });
});

describe('stageLadder', () => {
  it('starts at the tier itself: HIGH on a DPR 2 screen is pixel ratio 1.75', () => {
    const ladder = stageLadder(STAGE_TIERS.high, 2);
    expect(ladder[0]).toEqual({ pixelRatio: 1.75, bloom: 1, dust: 700, motes: 220 });
  });

  it('steps pixel ratio, then bloom resolution, then bloom off, then particles', () => {
    const ladder = stageLadder(STAGE_TIERS.high, 2);
    expect(ladder.map((l) => [+l.pixelRatio.toFixed(4), l.bloom, l.dust, l.motes])).toEqual([
      [1.75, 1, 700, 220],
      [1.4875, 1, 700, 220],
      [1.225, 1, 700, 220],
      [1.225, 0.5, 700, 220],
      [1.225, 0, 700, 220],
      [1.225, 0, 350, 110],
    ]);
  });

  it('leaves out steps that change nothing (LOW has no bloom to turn down)', () => {
    const ladder = stageLadder(STAGE_TIERS.low, 3);
    expect(ladder.map((l) => [+l.pixelRatio.toFixed(4), l.bloom, l.dust, l.motes])).toEqual([
      [1, 0, 220, 110],
      [0.85, 0, 220, 110],
      [0.7, 0, 220, 110],
      [0.7, 0, 110, 55],
    ]);
  });

  it('never goes below pixel ratio 0.5, nor above the screen', () => {
    for (const level of stageLadder(STAGE_TIERS.low, 0.6)) expect(level.pixelRatio).toBeGreaterThanOrEqual(0.5);
    expect(stageLadder(STAGE_TIERS.high, 1)[0].pixelRatio).toBe(1);
  });
});

describe('createStageAdaptive', () => {
  /** Frames `ms` apart for `seconds` after `from`; returns the end time. */
  const run = (adaptive: ReturnType<typeof createStageAdaptive>, from: number, ms: number, seconds: number, capped = false) => {
    let t = from;
    const end = from + seconds * 1000;
    while (t < end) {
      t += ms;
      adaptive.frame(t, capped);
    }
    return t;
  };

  it('stays put at 60 fps', () => {
    const applied: number[] = [];
    const adaptive = createStageAdaptive(5, (l) => applied.push(l), { enabled: true });
    run(adaptive, 0, 16.7, 60);
    expect(adaptive.level()).toBe(0);
    expect(applied).toEqual([]);
  });

  it('waits out the warm-up, then steps down after three slow windows', () => {
    const applied: number[] = [];
    const adaptive = createStageAdaptive(5, (l) => applied.push(l), { enabled: true });
    // Warm-up (4 s) + three 2 s windows = 10 s for the first step.
    let t = run(adaptive, 0, 33, 9.5);
    expect(applied).toEqual([]);
    t = run(adaptive, t, 33, 1);
    expect(applied).toEqual([1]);
    run(adaptive, t, 33, 60);
    expect(adaptive.level()).toBe(4); // the bottom, and no further
    expect(applied).toEqual([1, 2, 3, 4]);
    expect(adaptive.label()).toBe(' · auto −4');
  });

  it('ignores sporadic hitches (the median decides)', () => {
    const adaptive = createStageAdaptive(5, () => {}, { enabled: true });
    let t = 0;
    for (let i = 0; i < 4000; i++) {
      t += i % 5 === 0 ? 120 : 16.7; // a 120 ms hitch every fifth frame
      adaptive.frame(t);
    }
    expect(adaptive.level()).toBe(0);
  });

  it('does not take a 144 Hz screen\'s capped cadence for slowness', () => {
    // The 61 fps cap renders every third 144 Hz vsync: 20.8 ms apart.
    const adaptive = createStageAdaptive(5, () => {}, { enabled: true });
    run(adaptive, 0, 20.8, 60, true);
    expect(adaptive.level()).toBe(0);
    // The same cadence WITHOUT skipped frames is load.
    const loaded = createStageAdaptive(5, () => {}, { enabled: true });
    run(loaded, 0, 20.8, 12);
    expect(loaded.level()).toBe(1);
  });

  it('steps back up after 12 s at the vsync cap, and makes a level it had to leave again the ceiling', () => {
    const applied: number[] = [];
    const adaptive = createStageAdaptive(5, (l) => applied.push(l), { enabled: true });
    let t = run(adaptive, 0, 33, 10.5); // → level 1
    t = run(adaptive, t, 33, 6.5); // → level 2
    expect(adaptive.level()).toBe(2);
    t = run(adaptive, t, 16.7, 15); // smooth → back up to 1
    expect(adaptive.level()).toBe(1);
    t = run(adaptive, t, 33, 8); // level 1 is too much after all → 2, which is now the ceiling
    expect(adaptive.level()).toBe(2);
    run(adaptive, t, 16.7, 120); // smooth for two minutes: never back to 1
    expect(adaptive.level()).toBe(2);
    expect(applied).toEqual([1, 2, 1, 2]);
  });

  it('does nothing when disabled (a forced tier)', () => {
    const adaptive = createStageAdaptive(5, () => {}, { enabled: false });
    run(adaptive, 0, 50, 60);
    expect(adaptive.level()).toBe(0);
  });

  it('does not count a pause as a slow frame, and warms up again after it', () => {
    const adaptive = createStageAdaptive(5, () => {}, { enabled: true });
    let t = run(adaptive, 0, 16.7, 5);
    adaptive.reset();
    t += 30_000; // hidden for 30 s
    // Two slow-looking seconds right after coming back are warm-up.
    t = run(adaptive, t, 40, 3);
    run(adaptive, t, 16.7, 10);
    expect(adaptive.level()).toBe(0);
  });
});

// COPIED from .claude/pages/ad/experiments/env-src/scene-quality.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Quality tiers for the instrument scenes: a startup guess from cheap
 * signals, then runtime adaptation from measured frame times.
 *
 * Startup (`?quality=low|medium|high` forces a tier):
 *  - WebGL renderer string of the GPU a high-performance context gets (the
 *    scenes ask for one; on a dual-GPU laptop a default context names the
 *    other GPU): mobile GPUs (Mali, Adreno, PowerVR, Apple's mobile GPUs) →
 *    low; integrated (Intel, AMD APU "Radeon(TM) Graphics", "Vega 8") → one
 *    step down; software (SwiftShader, llvmpipe) → low. Safari names every
 *    Apple GPU "Apple GPU", a Mac's and an iPhone's alike, so that string is
 *    a phone's only on a touch-first device (the piano stage's rule);
 *  - navigator.hardwareConcurrency ≤ 4, navigator.deviceMemory ≤ 4 → one
 *    step down each (at most one in total);
 *  - screen pixels × DPR² above ~4.5 M → one step down;
 *  - coarse pointer (phones, tablets) → at most medium.
 *
 * Runtime: a ladder of finer levels inside the tier's own ceiling (grass
 * cards kept, flowers kept, pixel-ratio scale, MSAA). The ladder's machine is
 * the piano stage's own (`createStageAdaptive` in src/landing/stageQuality.ts):
 * after a 4 s warm up from the first frame, the MEDIAN frame interval of
 * every 2 s window is checked (sporadic hitches don't count): three windows
 * in a row over budget (> 18.5 ms) → one level down; 12 s at the vsync cap
 * (< 17.4 ms) → one level up. A level that had to be left again within 20 s
 * of stepping up becomes the new ceiling (no oscillation). An interval
 * stretched by the loop's own frame cap is not counted as slow, and the
 * window starts again after the loop was stopped.
 */

import { createStageAdaptive, isStageTier, probeGpu } from '../../stageQuality';
import type { StageSignals } from '../../stageQuality';

export type Tier = 'high' | 'medium' | 'low';

export type TierParams = {
  tier: Tier;
  /** Pixel-ratio cap. */
  prCap: number;
  /** Grass card density at creation (cardgrass `density`). */
  grass: number;
  /** Flowers kept (0…1, thinned in the shader). */
  flowers: number;
  /** Shadow field resolution. */
  field: number;
  /** Falling leaves / petals, bursts, motes (0…1). */
  particles: number;
  /** Bloom resolution scale (0 = off). */
  bloom: number;
  /** MSAA samples of the main target (cards use alpha-to-coverage). */
  samples: number;
};

export const TIERS: Record<Tier, TierParams> = {
  high: { tier: 'high', prCap: 1.5, grass: 1.0, flowers: 1.0, field: 512, particles: 1.0, bloom: 1, samples: 4 },
  medium: { tier: 'medium', prCap: 1.0, grass: 0.72, flowers: 0.8, field: 512, particles: 0.8, bloom: 0.5, samples: 2 },
  low: { tier: 'low', prCap: 0.75, grass: 0.42, flowers: 0.5, field: 256, particles: 0.5, bloom: 0, samples: 2 },
};

export type TierGuess = { params: TierParams; reasons: string[]; forced: boolean; gpu: string };

/** Everything the startup guess looks at (the piano stage's signals). */
export type TierSignals = StageSignals;

/** A `?quality=` value that names a tier (and nothing else: not
 *  `__proto__`, not `toString`). */
export function isTier(value: unknown): value is Tier {
  return isStageTier(value);
}

/** The startup tier for these signals. */
export function pickTier(signals: TierSignals): TierGuess {
  const { gpu } = signals;
  if (isTier(signals.forced)) return { params: TIERS[signals.forced], reasons: ['forced by ?quality'], forced: true, gpu };
  const reasons: string[] = [];
  let level = 2; // 2 high, 1 medium, 0 low
  // Safari reports every Apple GPU as "Apple GPU" — an iPhone's and an M2
  // Mac's alike. Only a touch-first device is taken for a phone or tablet.
  const appleMobile = /apple gpu/i.test(gpu) && signals.coarsePointer;
  if (/mali|adreno|powervr|apple a\d|sgx|tegra/i.test(gpu) || appleMobile) {
    level = 0;
    reasons.push('mobile GPU');
  } else if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) {
    level = 0;
    reasons.push('software renderer');
  } else if (/intel|radeon\(tm\) graphics|vega \d|uhd|iris/i.test(gpu)) {
    level -= 1;
    reasons.push('integrated GPU');
  }
  const cores = signals.cores ?? 8;
  const memory = signals.memory ?? 8;
  if (cores <= 4 || memory <= 4) {
    level -= 1;
    reasons.push(cores <= 4 ? `${cores} cores` : `${memory} GB memory`);
  }
  const dpr = Math.min(signals.devicePixelRatio || 1, 2);
  const pixels = signals.screenWidth * signals.screenHeight * dpr * dpr;
  if (pixels > 4.5e6) {
    level -= 1;
    reasons.push(`${(pixels / 1e6).toFixed(1)} M px`);
  }
  if (signals.coarsePointer && level > 1) {
    level = 1;
    reasons.push('touch device');
  }
  const tier: Tier = level >= 2 ? 'high' : level === 1 ? 'medium' : 'low';
  if (!reasons.length) reasons.push('capable GPU');
  return { params: TIERS[tier], reasons, forced: false, gpu };
}

/** The scenes' tier on this device (reads the browser). */
export function detectTier(): TierGuess {
  return pickTier({
    gpu: probeGpu(),
    cores: navigator.hardwareConcurrency,
    memory: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
    screenWidth: screen.width,
    screenHeight: screen.height,
    devicePixelRatio: window.devicePixelRatio || 1,
    coarsePointer: matchMedia('(pointer: coarse)').matches,
    forced: new URLSearchParams(location.search).get('quality'),
  });
}

/** One rung of the runtime ladder (multipliers on the tier's params;
 *  `maxSamples` caps the MSAA — measured as the biggest single cost on an
 *  Intel UHD: 4× → 2× saved ~11 ms of 56 at 1600×1000, 2× → 0 ~16 ms). */
export type Rung = { grassKeep: number; flowerKeep: number; prScale: number; maxSamples: number };
const LADDER: Rung[] = [
  { grassKeep: 1, flowerKeep: 1, prScale: 1, maxSamples: 4 },
  { grassKeep: 0.8, flowerKeep: 0.85, prScale: 1, maxSamples: 4 },
  { grassKeep: 0.7, flowerKeep: 0.75, prScale: 0.9, maxSamples: 2 },
  { grassKeep: 0.55, flowerKeep: 0.6, prScale: 0.8, maxSamples: 2 },
  { grassKeep: 0.45, flowerKeep: 0.5, prScale: 0.7, maxSamples: 2 },
  // Last resort: no MSAA (card edges alias; still the same scene).
  { grassKeep: 0.45, flowerKeep: 0.5, prScale: 0.7, maxSamples: 0 },
];

export type Adaptive = {
  /**
   * Call once per RENDERED frame with performance.now(). `capped`: the loop
   * skipped at least one animation frame since the last render because of
   * its own 61 fps cap, so this interval is the cap's, not load (on a 144 Hz
   * screen the cap renders every third vsync, 20.8 ms apart).
   */
  frame(now: number, capped?: boolean): void;
  /** Forget the running window (the loop stopped and starts again): the gap
   *  is not a slow frame, and the first frames back warm up again. */
  reset(): void;
  rung(): number;
  label(): string;
};

/**
 * The scene's ladder. Rung 0 is applied at once: the grass uniforms are
 * shared by every scene the chunk makes (`grassQuality`), so a new scene must
 * not inherit the rung the previous one had stepped down to.
 */
export function createAdaptive(apply: (r: Rung) => void, options: { enabled: boolean }): Adaptive {
  const ladder = createStageAdaptive(LADDER.length, (level) => apply(LADDER[level]), options);
  apply(LADDER[0]);
  return {
    frame: ladder.frame,
    reset: ladder.reset,
    rung: ladder.level,
    label: ladder.label,
  };
}

/** The tuning knobs a URL may set (tests and measurements). */
export type Tuning = { samples?: number; pr?: number; bloom?: number; grass?: number };

/** `?samples=&pr=&bloom=&grass=`, validated: MSAA samples become 0, 2 or 4
 *  (the nearest), the pixel-ratio cap stays within 0.5–2, the bloom scale
 *  within 0–1 and the grass density within 0–1.5; a value that is not a
 *  number is ignored. A crafted link must not be able to allocate a giant
 *  drawing buffer or millions of grass cards. */
export function readTuning(search: string): Tuning {
  const q = new URLSearchParams(search);
  const num = (k: string): number | undefined => {
    const raw = q.get(k);
    if (raw === null || raw.trim() === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const clamp = (n: number | undefined, min: number, max: number) => (n === undefined ? undefined : Math.min(max, Math.max(min, n)));
  const samples = num('samples');
  return {
    samples: samples === undefined ? undefined : [0, 2, 4].reduce((best, n) => (Math.abs(n - samples) < Math.abs(best - samples) ? n : best)),
    pr: clamp(num('pr'), 0.5, 2),
    bloom: clamp(num('bloom'), 0, 1),
    grass: clamp(num('grass'), 0, 1.5),
  };
}

/** The stage's tier (detected once per page). */
export function sceneQuality(): { guess: TierGuess; params: TierParams } {
  const guess = detectTier();
  // Tuning overrides (tests): ?samples=&pr=&bloom= (validated: readTuning).
  const tuning = readTuning(location.search);
  const params = { ...guess.params, samples: tuning.samples ?? guess.params.samples, prCap: tuning.pr ?? guess.params.prCap, bloom: tuning.bloom ?? guess.params.bloom };
  return { guess, params };
}

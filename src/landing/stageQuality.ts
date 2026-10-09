/**
 * Quality tiers for the piano stage (`stageScene.ts`): a startup guess from
 * cheap signals, then runtime adaptation from measured frame times. The
 * design follows the meadow scenes' `scene-quality.ts` (in the ad
 * experiments), written fresh for the stage's own costs.
 *
 * Why (2026-10-09, Deepak: "the landing page lags really hard on phone and
 * less powerful devices"): the stage drew the same frame everywhere — pixel
 * ratio up to 1.75, a full-resolution bloom, a 2048² spot shadow, 700 dust
 * motes. Measured with the phone emulated (390×844 @3×, CPU throttled 4×):
 * ~26 fps for the landing hero on this laptop's Intel UHD, under 1 fps on
 * software WebGL; and 12.5 fps for the hero at the laptop's own screen size
 * (1707×1067 @1.5×) on the same Intel UHD.
 *
 * Startup (`?quality=low|medium|high` forces a tier and turns the runtime
 * adaptation off, so a forced tier is what is measured):
 *  - WebGL renderer string: mobile GPUs (Mali, Adreno, PowerVR, Apple's
 *    mobile GPUs) → low; software (SwiftShader, llvmpipe) → low; integrated
 *    (Intel, AMD APU "Radeon(TM) Graphics", "Vega 8") → one step down;
 *  - navigator.hardwareConcurrency ≤ 4 or navigator.deviceMemory ≤ 4 → one
 *    step down (one in total);
 *  - screen pixels × DPR² above ~4.5 M → one step down;
 *  - coarse pointer (phones, tablets) → at most medium.
 *
 * Runtime: a ladder of finer levels inside the tier (pixel-ratio scale →
 * bloom resolution → bloom off → fewer particles). After a 4 s warm up, the
 * MEDIAN rendered-frame interval of every 2 s window is checked (sporadic
 * hitches don't count): three windows in a row over budget (> 18.5 ms) →
 * one level down; 12 s at the vsync cap (< 17.4 ms) → one level up. A level
 * that had to be left again within 20 s of stepping up becomes the new
 * ceiling, so the stage never oscillates between two levels.
 */

type StageTier = 'high' | 'medium' | 'low';

type StageTierParams = {
  tier: StageTier;
  /** Pixel-ratio cap. */
  prCap: number;
  /** Bloom resolution scale (1 = full, 0 = off). */
  bloom: number;
  /** Spot shadow map size (the map is rendered once, so this is memory and
   *  sampling cost, not a per-frame pass). */
  shadowMap: number;
  /** Dust motes in the main beam. */
  dust: number;
  /** Motes rising from struck strings (a ring buffer). */
  motes: number;
  /** MSAA on the canvas. The composer draws the scene into its own
   *  (non-multisampled) targets, so the canvas only ever receives the final
   *  full-screen pass: antialias there smooths no edge and costs a
   *  multisampled back buffer plus a resolve every frame. Kept on HIGH only,
   *  so HIGH stays exactly what it was. */
  antialias: boolean;
};

const STAGE_TIERS: Record<StageTier, StageTierParams> = {
  high: { tier: 'high', prCap: 1.75, bloom: 1, shadowMap: 2048, dust: 700, motes: 220, antialias: true },
  medium: { tier: 'medium', prCap: 1.25, bloom: 0.5, shadowMap: 1024, dust: 420, motes: 160, antialias: false },
  low: { tier: 'low', prCap: 1.0, bloom: 0, shadowMap: 512, dust: 220, motes: 110, antialias: false },
};

/** Everything the startup guess looks at — plain data, so it can be tested. */
type StageSignals = {
  /** Unmasked WebGL renderer string ('' when unavailable). */
  gpu: string;
  cores?: number;
  /** navigator.deviceMemory (GB, Chromium only). */
  memory?: number;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  coarsePointer: boolean;
  /** The `?quality=` search parameter, if any. */
  forced?: string | null;
};

type StageTierGuess = { params: StageTierParams; reasons: string[]; forced: boolean; gpu: string };

const MOBILE_GPU = /mali|adreno|powervr|apple a\d|sgx|tegra|videocore/i;
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i;
const INTEGRATED_GPU = /intel|radeon\(tm\) graphics|vega \d|uhd|iris/i;
/** Intel's discrete cards ("Arc(TM) A770") — not the "Arc(TM) Graphics"
 *  integrated into Meteor Lake. */
const DISCRETE_INTEL = /arc\(tm\) a\d/i;

function isStageTier(value: unknown): value is StageTier {
  return value === 'high' || value === 'medium' || value === 'low';
}

/** The startup tier for these signals. */
function pickStageTier(signals: StageSignals): StageTierGuess {
  const { gpu } = signals;
  if (isStageTier(signals.forced)) {
    return { params: STAGE_TIERS[signals.forced], reasons: ['forced by ?quality'], forced: true, gpu };
  }
  const reasons: string[] = [];
  let level = 2; // 2 high, 1 medium, 0 low
  // Safari reports every Apple GPU as "Apple GPU" — an iPhone's and an M2
  // Mac's alike. Only a touch-first device is taken for a phone or tablet.
  const appleMobile = /apple gpu/i.test(gpu) && signals.coarsePointer;
  if (MOBILE_GPU.test(gpu) || appleMobile) {
    level = 0;
    reasons.push('mobile GPU');
  } else if (SOFTWARE_GPU.test(gpu)) {
    level = 0;
    reasons.push('software renderer');
  } else if (INTEGRATED_GPU.test(gpu) && !DISCRETE_INTEL.test(gpu)) {
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
  const tier: StageTier = level >= 2 ? 'high' : level === 1 ? 'medium' : 'low';
  if (reasons.length === 0) reasons.push('capable GPU');
  return { params: STAGE_TIERS[tier], reasons, forced: false, gpu };
}

/** The renderer string of the GPU a high-performance context would get —
 *  the stage asks for one, and on a dual-GPU laptop a default context may
 *  name the other GPU. */
function probeGpu(): string {
  try {
    const canvas = document.createElement('canvas');
    const attributes: WebGLContextAttributes = { powerPreference: 'high-performance' };
    const gl = (canvas.getContext('webgl2', attributes) ?? canvas.getContext('webgl', attributes)) as
      | WebGLRenderingContext
      | null;
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return gpu;
  } catch {
    return '';
  }
}

/** The stage's tier on this device (reads the browser). */
function detectStageTier(): StageTierGuess {
  return pickStageTier({
    gpu: probeGpu(),
    cores: navigator.hardwareConcurrency,
    memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    screenWidth: screen.width,
    screenHeight: screen.height,
    devicePixelRatio: window.devicePixelRatio || 1,
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    forced: new URLSearchParams(location.search).get('quality'),
  });
}

// ── the runtime ladder ──────────────────────────────────────────────────

/** One level of the ladder, in absolute settings. */
type StageLevel = {
  pixelRatio: number;
  /** Bloom resolution scale (0 = off). */
  bloom: number;
  dust: number;
  motes: number;
};

/** Each step relative to the tier: pixel ratio first (the cost is all fill
 *  rate), then the bloom's resolution, then the bloom itself, then half the
 *  particles. */
const LADDER_STEPS: readonly { prScale: number; bloomScale: number; particles: number }[] = [
  { prScale: 1, bloomScale: 1, particles: 1 },
  { prScale: 0.85, bloomScale: 1, particles: 1 },
  { prScale: 0.7, bloomScale: 1, particles: 1 },
  { prScale: 0.7, bloomScale: 0.5, particles: 1 },
  { prScale: 0.7, bloomScale: 0, particles: 1 },
  { prScale: 0.7, bloomScale: 0, particles: 0.5 },
];

/** Below this the stage is a smear; the ladder never goes lower. */
const MIN_PIXEL_RATIO = 0.5;

/** The tier's ladder on this screen. A step that changes nothing here
 *  (the bloom steps on LOW, where the bloom is already off) is left out, so
 *  stepping down never wastes three windows on a no-op. */
function stageLadder(params: StageTierParams, devicePixelRatio: number): StageLevel[] {
  const base = Math.min(devicePixelRatio || 1, params.prCap);
  const levels: StageLevel[] = [];
  for (const step of LADDER_STEPS) {
    const level: StageLevel = {
      // Level 0 is exactly the tier (no rounding: HIGH stays as it was).
      pixelRatio: step.prScale === 1 ? base : Math.max(MIN_PIXEL_RATIO, base * step.prScale),
      bloom: params.bloom * step.bloomScale,
      dust: Math.round(params.dust * step.particles),
      motes: Math.round(params.motes * step.particles),
    };
    const previous = levels[levels.length - 1];
    if (
      previous &&
      Math.abs(previous.pixelRatio - level.pixelRatio) < 1e-3 &&
      previous.bloom === level.bloom &&
      previous.dust === level.dust &&
      previous.motes === level.motes
    ) {
      continue;
    }
    levels.push(level);
  }
  return levels;
}

/** Frame-time budget: over this median a window is "slow" (60 Hz + 10 %). */
const SLOW_MS = 18.5;
/** Under this median a window is "at the vsync cap". */
const SMOOTH_MS = 17.4;
const WARM_UP_MS = 4000;
const WINDOW_MS = 2000;
const SLOW_WINDOWS = 3;
const SMOOTH_FOR_MS = 12000;
const CEILING_WITHIN_MS = 20000;

type StageAdaptive = {
  /**
   * Call once per RENDERED frame. `capped`: the loop skipped at least one
   * animation frame since the last render because of its own 61 fps cap —
   * the browser was keeping up, so this interval is the cap's, not load.
   * (On a 144 Hz screen the cap renders every third vsync, 20.8 ms apart;
   * without this, a fast desktop would read as a slow one.)
   */
  frame(now: number, capped?: boolean): void;
  /** Forget the running window (after a pause or a hidden tab): the gap is
   *  not a slow frame, and the first frames back warm up again. */
  reset(): void;
  level(): number;
  /** '' at full quality, ' · auto −N' below it. */
  label(): string;
};

function createStageAdaptive(
  levels: number,
  apply: (level: number) => void,
  options: { enabled: boolean },
): StageAdaptive {
  let level = 0;
  let ceiling = 0; // the best level allowed (0 = the tier itself)
  const intervals: number[] = [];
  let last = -1;
  let startedAt = -1;
  let windowStart = -1;
  let slow = 0;
  let smoothSince = -1;
  let steppedUpAt = -Infinity;
  const set = (next: number) => {
    const clamped = Math.max(ceiling, Math.min(levels - 1, next));
    if (clamped === level) return;
    level = clamped;
    apply(level);
  };
  return {
    frame(now, capped = false) {
      if (startedAt < 0) {
        startedAt = now;
        windowStart = now;
      }
      if (last >= 0) {
        const interval = now - last;
        intervals.push(capped ? Math.min(interval, 1000 / 60) : interval);
      }
      last = now;
      if (!options.enabled || levels < 2) return;
      if (now - startedAt < WARM_UP_MS) {
        // Shader compiles and the first uploads: not the stage's pace.
        intervals.length = 0;
        windowStart = now;
        return;
      }
      if (now - windowStart < WINDOW_MS) return;
      windowStart = now;
      const sorted = intervals.splice(0).sort((a, b) => a - b);
      if (sorted.length < 4) return;
      const median = sorted[sorted.length >> 1];
      if (median > SLOW_MS) {
        slow++;
        smoothSince = -1;
        if (slow >= SLOW_WINDOWS && level < levels - 1) {
          // Left again soon after a step up: that level is too much here.
          if (now - steppedUpAt < CEILING_WITHIN_MS) ceiling = level + 1;
          set(level + 1);
          slow = 0;
        }
      } else {
        slow = 0;
        if (median < SMOOTH_MS) {
          if (smoothSince < 0) smoothSince = now;
          if (now - smoothSince > SMOOTH_FOR_MS && level > ceiling) {
            set(level - 1);
            steppedUpAt = now;
            smoothSince = now;
          }
        } else smoothSince = -1;
      }
    },
    reset() {
      intervals.length = 0;
      last = -1;
      startedAt = -1;
      windowStart = -1;
      slow = 0;
      smoothSince = -1;
    },
    level: () => level,
    label: () => (level === 0 ? '' : ` · auto −${level}`),
  };
}

export { STAGE_TIERS, pickStageTier, detectStageTier, stageLadder, createStageAdaptive };
export type { StageTier, StageTierParams, StageSignals, StageTierGuess, StageLevel, StageAdaptive };

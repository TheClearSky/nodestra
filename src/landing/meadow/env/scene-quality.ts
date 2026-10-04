// COPIED from .claude/pages/ad/experiments/env-src/scene-quality.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * Quality tiers for the instrument scenes: a startup guess from cheap
 * signals, then runtime adaptation from measured frame times.
 *
 * Startup (`?quality=low|medium|high` forces a tier):
 *  - WebGL renderer string: mobile GPUs (Mali, Adreno, PowerVR, Apple's
 *    mobile GPUs) → low; integrated (Intel, AMD APU "Radeon(TM) Graphics",
 *    "Vega 8") → one step down; software (SwiftShader, llvmpipe) → low;
 *  - navigator.hardwareConcurrency ≤ 4, navigator.deviceMemory ≤ 4 → one
 *    step down each (at most one in total);
 *  - screen pixels × DPR² above ~4.5 M → one step down;
 *  - coarse pointer (phones, tablets) → at most medium.
 *
 * Runtime: a ladder of finer levels inside the tier's own ceiling (grass
 * cards kept, flowers kept, pixel-ratio scale). Every 2 s (after a 4 s warm
 * up) the MEDIAN frame interval is checked (sporadic hitches don't count):
 * three windows in a row over budget (> 18.5 ms) → one level down; 12 s at
 * the vsync cap (< 17.4 ms) → one level up. A level that had to be left
 * again within 20 s of stepping up becomes the new ceiling (no oscillation).
 */

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

export function detectTier(): TierGuess {
  const forced = new URLSearchParams(location.search).get('quality') as Tier | null;
  let gpu = '';
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    gpu = '';
  }
  if (forced && forced in TIERS) return { params: TIERS[forced], reasons: ['forced by ?quality'], forced: true, gpu };
  const reasons: string[] = [];
  let level = 2; // 2 high, 1 medium, 0 low
  if (/mali|adreno|powervr|apple gpu|apple a\d|sgx|tegra/i.test(gpu)) {
    level = 0;
    reasons.push('mobile GPU');
  } else if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) {
    level = 0;
    reasons.push('software renderer');
  } else if (/intel|radeon\(tm\) graphics|vega \d|uhd|iris/i.test(gpu)) {
    level -= 1;
    reasons.push('integrated GPU');
  }
  const cores = navigator.hardwareConcurrency ?? 8;
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  if (cores <= 4 || memory <= 4) {
    level -= 1;
    reasons.push(cores <= 4 ? `${cores} cores` : `${memory} GB memory`);
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixels = screen.width * screen.height * dpr * dpr;
  if (pixels > 4.5e6) {
    level -= 1;
    reasons.push(`${(pixels / 1e6).toFixed(1)} M px`);
  }
  if (matchMedia('(pointer: coarse)').matches && level > 1) {
    level = 1;
    reasons.push('touch device');
  }
  const tier: Tier = level >= 2 ? 'high' : level === 1 ? 'medium' : 'low';
  if (!reasons.length) reasons.push('capable GPU');
  return { params: TIERS[tier], reasons, forced: false, gpu };
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
  /** Call once per rendered frame with performance.now(). */
  frame(now: number): void;
  rung(): number;
  label(): string;
};

export function createAdaptive(apply: (r: Rung) => void, options: { enabled: boolean }): Adaptive {
  let rung = 0;
  let ceiling = 0; // the best rung allowed (0 = full)
  const intervals: number[] = [];
  let last = -1;
  const startedAt = performance.now();
  let windowStart = startedAt;
  let bad = 0;
  let goodSince = -1;
  let steppedUpAt = -Infinity;
  const set = (next: number) => {
    rung = Math.max(ceiling, Math.min(LADDER.length - 1, next));
    apply(LADDER[rung]);
  };
  return {
    frame(now) {
      if (last >= 0) intervals.push(now - last);
      last = now;
      if (!options.enabled || now - startedAt < 4000 || now - windowStart < 2000) return;
      windowStart = now;
      const sorted = intervals.splice(0).sort((a, b) => a - b);
      if (sorted.length < 4) return;
      const median = sorted[sorted.length >> 1];
      if (median > 18.5) {
        bad++;
        goodSince = -1;
        if (bad >= 3 && rung < LADDER.length - 1) {
          // Left again soon after a step up: that rung is too much here.
          if (now - steppedUpAt < 20000) ceiling = rung + 1;
          set(rung + 1);
          bad = 0;
        }
      } else {
        bad = 0;
        if (median < 17.4) {
          if (goodSince < 0) goodSince = now;
          if (now - goodSince > 12000 && rung > ceiling) {
            set(rung - 1);
            steppedUpAt = now;
            goodSince = now;
          }
        } else goodSince = -1;
      }
    },
    rung: () => rung,
    label: () => (rung === 0 ? '' : ` · auto −${rung}`),
  };
}

/** The stage's tier (detected once per page). */
export function sceneQuality(): { guess: TierGuess; params: TierParams } {
  const guess = detectTier();
  // Tuning overrides (tests): ?samples=&pr=&bloom=
  const q = new URLSearchParams(location.search);
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  const params = { ...guess.params, samples: num('samples') ?? guess.params.samples, prCap: num('pr') ?? guess.params.prCap, bloom: num('bloom') ?? guess.params.bloom };
  return { guess, params };
}

/**
 * fdnReverbCore — a Feedback Delay Network reverberator with modulated delay
 * lines and frequency-dependent decay.
 *
 * PURE and dependency-free by contract (same rule as the instrument cores):
 * no imports, no Tone, no DOM, and `sampleRate` is always a PARAMETER. This
 * exact module is consumed by the AudioWorklet wrapper, the vitest oracles and
 * the offline render bridge, so they can never drift apart.
 *
 * WHY THIS EXISTS. The app's `reverb` node is `Tone.Reverb` — a convolution
 * against a FIXED decaying-noise impulse response. It has no delay network, so
 * there is nothing to modulate, and no way to set decay per frequency band.
 * The reference bed this project is chasing measures at a direct-to-reverberant
 * ratio of ~0 dB (the first 50 ms of a note carries no more energy than the
 * following 350 ms), so the reverb IS most of what is heard, and approximating
 * it was not going to be enough.
 *
 * STRUCTURE (Jot & Chaigne 1991; see `samples/references/papers/`):
 *
 *      in ─► [low cut] ─► [diffusion allpasses] ─┐
 *                                                 ▼
 *          ┌────────────► z^-m₁ ─► g₁·H₁(z) ──┐  (+)
 *          │  ┌─────────► z^-m₂ ─► g₂·H₂(z) ──┤   │
 *      A ──┤  │   ...                          ├───┘
 *          │  └─────────► z^-m₈ ─► g₈·H₈(z) ──┤
 *          └──────────────────────────────────┘
 *                     │
 *                     └─► c_L, c_R ─► out
 *
 *   A       8x8 orthogonal feedback matrix (Hadamard, applied as a fast
 *           Walsh-Hadamard transform then scaled by 1/sqrt(8)). Orthogonal
 *           means it preserves energy EXACTLY, so stability depends only on
 *           the attenuations gᵢ being < 1 — there is no way to tune this into
 *           a blow-up.
 *   mᵢ      delay lengths, nudged to distinct PRIMES so their echo patterns do
 *           not align and reinforce into a ringing pitch.
 *   gᵢ      per-line attenuation solving for a common T60 regardless of length:
 *           gᵢ = 10^(-3·mᵢ / (T60·fs)).
 *   Hᵢ(z)   one-pole lowpass in each feedback path, so highs decay faster than
 *           lows the way a real room's air and surfaces behave.
 *
 * THE MODULATION IS THE POINT. A static FDN rings metallically — its modes sit
 * at fixed frequencies and beat against each other. Modulating each delay
 * length with a slow sinusoid at a DIFFERENT PHASE per line smears those modes
 * and is what produces the lush, chorused tail this is being built for. Valhalla
 * DSP describes Supermassive's modulation as exactly this: a multi-phase
 * sinusoidal oscillator on the delay lengths.
 *
 * PINNED SEMANTICS
 * - The feedback matrix is orthogonal and NOT user-tunable. Density is exposed
 *   as INPUT DIFFUSION (a cascade of allpasses) instead, which is how the
 *   classic designs do it and which cannot destabilise the loop.
 * - Modulated reads use linear interpolation. It costs a little high end, and
 *   the alternative (allpass interpolation) is dispersive under modulation,
 *   which audibly warbles.
 * - Delay lengths are re-derived only when a parameter changes, never per
 *   sample: finding primes is trial division and belongs nowhere near the
 *   audio loop.
 */

type FdnReverbParams = {
  /** Scales every delay length; the room's size. */
  sizeScale: number;
  /** T60 at low frequency, seconds. */
  decaySec: number;
  /** One-pole cutoff in each feedback path. Lower = highs die sooner. */
  dampingHz: number;
  /** Delay-modulation rate, Hz. */
  modRateHz: number;
  /** Delay-modulation depth, milliseconds. */
  modDepthMs: number;
  /** 0..1 input diffusion (density). */
  diffusion: number;
  /** High-pass on the network input, so lows do not muddy the tail. */
  lowCutHz: number;
  /** 0..1 stereo spread of the output taps. */
  width: number;
  /** 0..1 dry/wet. */
  mix: number;
};

const LINES = 8;
const LINE_BUFFER = 16384;
const LINE_MASK = LINE_BUFFER - 1;
const DIFFUSERS = 4;
const DIFFUSER_BUFFER = 2048;
const DIFFUSER_MASK = DIFFUSER_BUFFER - 1;

/**
 * Base delay lengths in milliseconds, spread roughly 1:3 and deliberately
 * irregular. They are nudged to primes at build time; starting from an
 * irregular set keeps the primes far apart rather than clustered.
 */
const BASE_MS = [23.7, 29.3, 34.1, 41.9, 48.3, 56.7, 63.1, 71.3];
/** Diffuser lengths, also prime-nudged. Short, and mutually coprime. */
const DIFFUSER_MS = [4.7, 7.3, 11.1, 16.9];

type FdnReverbState = {
  sampleRate: number;
  lines: Float32Array[];
  writeIndex: number;
  /** One-pole memory per feedback path. */
  damp: Float64Array;
  /** Scratch for the Walsh-Hadamard butterflies; avoids per-sample allocation. */
  mix: Float64Array;
  diffusers: Float32Array[];
  diffuserIndex: number;
  diffuserDelay: Int32Array;
  /** Modulation phase per line, spread so no two lines move together. */
  phase: Float64Array;
  /** Cached derived coefficients, rebuilt only when params change. */
  delaySamples: Float64Array;
  gain: Float64Array;
  dampCoeff: number;
  lowCutZ: number;
  lowCutCoeff: number;
  /** The parameter set the cache was built from. */
  cachedKey: string;
  idle: boolean;
  silentSamples: number;
};

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function flush(value: number): number {
  return value > -1e-30 && value < 1e-30 ? 0 : value;
}

function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let d = 3; d * d <= n; d += 2) {
    if (n % d === 0) return false;
  }
  return true;
}

/** Nearest prime at or above `n`, so lengths stay distinct and coprime. */
function primeAtLeast(n: number): number {
  let candidate = Math.max(2, Math.floor(n));
  while (!isPrime(candidate)) candidate += 1;
  return candidate;
}

function createFdnReverbState(sampleRate: number): FdnReverbState {
  const lines: Float32Array[] = [];
  for (let i = 0; i < LINES; i += 1) lines.push(new Float32Array(LINE_BUFFER));
  const diffusers: Float32Array[] = [];
  for (let i = 0; i < DIFFUSERS; i += 1) {
    diffusers.push(new Float32Array(DIFFUSER_BUFFER));
  }
  const phase = new Float64Array(LINES);
  for (let i = 0; i < LINES; i += 1) {
    // Evenly spread phases: a multi-phase oscillator, so the lines never
    // sweep together (which would sound like one big pitch wobble).
    phase[i] = (2 * Math.PI * i) / LINES;
  }
  return {
    sampleRate,
    lines,
    writeIndex: 0,
    damp: new Float64Array(LINES),
    mix: new Float64Array(LINES),
    diffusers,
    diffuserIndex: 0,
    diffuserDelay: new Int32Array(DIFFUSERS),
    phase,
    delaySamples: new Float64Array(LINES),
    gain: new Float64Array(LINES),
    dampCoeff: 0,
    lowCutZ: 0,
    lowCutCoeff: 0,
    cachedKey: '',
    idle: true,
    silentSamples: 0,
  };
}

function resetFdnReverb(state: FdnReverbState): void {
  for (const line of state.lines) line.fill(0);
  for (const d of state.diffusers) d.fill(0);
  state.writeIndex = 0;
  state.diffuserIndex = 0;
  state.damp.fill(0);
  state.lowCutZ = 0;
  state.idle = true;
  state.silentSamples = 0;
}

/** Rebuild the derived coefficients. Called only when a parameter changes. */
function rebuild(state: FdnReverbState, params: FdnReverbParams): void {
  const { sampleRate } = state;
  const size = clamp(params.sizeScale, 0.1, 4);
  const t60 = Math.max(0.05, params.decaySec);

  for (let i = 0; i < LINES; i += 1) {
    const raw = (BASE_MS[i] * size * sampleRate) / 1000;
    // Cap so the modulated read can never run past the buffer.
    const m = primeAtLeast(clamp(raw, 32, LINE_BUFFER * 0.45));
    state.delaySamples[i] = m;
    // Same T60 for every line regardless of its length: a longer line is
    // traversed fewer times per second, so it needs LESS attenuation per pass.
    state.gain[i] = 10 ** ((-3 * m) / (t60 * sampleRate));
  }
  for (let i = 0; i < DIFFUSERS; i += 1) {
    const raw = (DIFFUSER_MS[i] * size * sampleRate) / 1000;
    state.diffuserDelay[i] = primeAtLeast(
      clamp(raw, 8, DIFFUSER_BUFFER * 0.45),
    );
  }

  // One-pole lowpass coefficient for the feedback damping.
  const damping = clamp(params.dampingHz, 200, 20000);
  state.dampCoeff = Math.exp((-2 * Math.PI * damping) / sampleRate);
  // One-pole high-pass on the network input.
  const lowCut = clamp(params.lowCutHz, 10, 2000);
  state.lowCutCoeff = Math.exp((-2 * Math.PI * lowCut) / sampleRate);
}

function keyOf(params: FdnReverbParams): string {
  return `${params.sizeScale}|${params.decaySec}|${params.dampingHz}|${params.lowCutHz}`;
}

/** Orthogonal 8-point Hadamard mix, in place, via butterflies. */
function hadamard(v: Float64Array): void {
  for (let span = 1; span < LINES; span <<= 1) {
    for (let i = 0; i < LINES; i += span << 1) {
      for (let j = i; j < i + span; j += 1) {
        const a = v[j];
        const b = v[j + span];
        v[j] = a + b;
        v[j + span] = a - b;
      }
    }
  }
  // 1/sqrt(8) makes the transform orthogonal, so the network neither grows
  // nor loses energy on its own and stability rests purely on the gains.
  const scale = 1 / Math.sqrt(LINES);
  for (let i = 0; i < LINES; i += 1) v[i] *= scale;
}

/**
 * Render one block. `inL`/`inR` and `outL`/`outR` are the same length.
 * Returns false if the watchdog had to reset the network.
 */
function processFdnReverbBlock(
  state: FdnReverbState,
  params: FdnReverbParams,
  inL: Float32Array,
  inR: Float32Array,
  outL: Float32Array,
  outR: Float32Array,
  sampleRate: number,
): boolean {
  state.sampleRate = sampleRate;
  const key = keyOf(params);
  if (key !== state.cachedKey) {
    rebuild(state, params);
    state.cachedKey = key;
  }

  const frames = outL.length;
  const wet = clamp(params.mix, 0, 1);
  const dry = 1 - wet;
  const width = clamp(params.width, 0, 1);
  const diffusion = clamp(params.diffusion, 0, 1) * 0.7;
  const modDepth = (clamp(params.modDepthMs, 0, 50) * sampleRate) / 1000;
  const modStep = (2 * Math.PI * clamp(params.modRateHz, 0, 10)) / sampleRate;
  const { mix, damp, lines, delaySamples, gain } = state;
  const dampCoeff = state.dampCoeff;

  let blockPeak = 0;

  for (let n = 0; n < frames; n += 1) {
    const dryL = inL[n];
    const dryR = inR[n];
    let input = 0.5 * (dryL + dryR);

    // One-pole high-pass: keep the low end out of the network.
    state.lowCutZ = input + state.lowCutCoeff * state.lowCutZ;
    input -= (1 - state.lowCutCoeff) * state.lowCutZ;

    // Input diffusion: a cascade of allpasses. This is "density" — it spreads
    // a single impulse into a burst before the network ever sees it.
    for (let d = 0; d < DIFFUSERS; d += 1) {
      const buf = state.diffusers[d];
      const read =
        (state.diffuserIndex - state.diffuserDelay[d] + DIFFUSER_BUFFER) &
        DIFFUSER_MASK;
      const delayed = buf[read];
      const v = input - diffusion * delayed;
      buf[state.diffuserIndex] = v;
      input = delayed + diffusion * v;
    }

    // Read every delay line at its modulated position.
    for (let i = 0; i < LINES; i += 1) {
      state.phase[i] += modStep;
      if (state.phase[i] > 2 * Math.PI) state.phase[i] -= 2 * Math.PI;
      const offset = delaySamples[i] + modDepth * Math.sin(state.phase[i]);
      const readPos = state.writeIndex - offset + LINE_BUFFER;
      const base = Math.floor(readPos);
      const frac = readPos - base;
      const a = lines[i][base & LINE_MASK];
      const b = lines[i][(base + 1) & LINE_MASK];
      mix[i] = a + (b - a) * frac;
    }

    // Two decorrelated taps BEFORE mixing, so L and R see different lines.
    let wetL = 0;
    let wetR = 0;
    for (let i = 0; i < LINES; i += 1) {
      if (i % 2 === 0) wetL += mix[i];
      else wetR += mix[i];
    }
    const norm = Math.sqrt(2 / LINES);
    wetL *= norm;
    wetR *= norm;
    // Width 0 collapses to mono, 1 keeps the taps fully separated.
    const mid = 0.5 * (wetL + wetR);
    wetL = mid + (wetL - mid) * width;
    wetR = mid + (wetR - mid) * width;

    // Feedback: attenuate, damp, then mix orthogonally.
    for (let i = 0; i < LINES; i += 1) {
      const attenuated = mix[i] * gain[i];
      // One-pole lowpass, unity gain at DC so it only removes highs.
      damp[i] = attenuated * (1 - dampCoeff) + damp[i] * dampCoeff;
      mix[i] = flush(damp[i]);
    }
    hadamard(mix);

    state.writeIndex = (state.writeIndex + 1) & LINE_MASK;
    state.diffuserIndex = (state.diffuserIndex + 1) & DIFFUSER_MASK;
    for (let i = 0; i < LINES; i += 1) {
      lines[i][state.writeIndex] = flush(mix[i] + input);
    }

    outL[n] = dry * dryL + wet * wetL;
    outR[n] = dry * dryR + wet * wetR;
    const magnitude = Math.abs(outL[n]) + Math.abs(outR[n]);
    if (magnitude > blockPeak) blockPeak = magnitude;
  }

  // Watchdog: a non-finite sample would circulate in the network forever.
  if (!Number.isFinite(outL[frames - 1]) || !Number.isFinite(outR[frames - 1])) {
    resetFdnReverb(state);
    outL.fill(0);
    outR.fill(0);
    return false;
  }

  state.silentSamples = blockPeak < 1e-9 ? state.silentSamples + frames : 0;
  state.idle = state.silentSamples > sampleRate;
  return true;
}

export {
  createFdnReverbState,
  processFdnReverbBlock,
  resetFdnReverb,
  primeAtLeast,
  LINES,
};
export type { FdnReverbParams, FdnReverbState };

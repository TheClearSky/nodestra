/**
 * modalBodyCore — an instrument body as a parallel bank of 2-pole
 * resonators, plus a broadband direct-field path.
 *
 * PURE and dependency-free by contract (same rule as envelopeCore): no
 * imports, no Tone, no DOM, and `sampleRate` is a PARAMETER. The mode tables
 * are passed IN — the core never imports a preset module, so the Node render
 * bridge and vitest can drive it unchanged.
 *
 * Why a modal bank: the standard modal expansion of any vibration transfer
 * function (Woodhouse 2014 eq. 3) is a sum of 2-pole terms, so this IS the
 * discrete realization of the measured bridge admittance, not an imitation of
 * it. Välimäki et al. 2006 §9.3 makes the same reduction for real-time use.
 *
 * Why a direct-field path: Woodhouse 2014 §3.3.3 decomposes the bridge
 * admittance as Y = Y_dir + Y_rev — a broadband "direct field" (what an
 * infinite plate would do) plus the resonant reverberant field. A bank of a
 * few resonators alone has deep unphysical valleys between its modes; the
 * direct term fills them, which is both correct and what makes the body sound
 * like wood rather than a filter bank.
 *
 * PINNED SEMANTICS
 * - Each mode is normalised to `db` AT ITS OWN CENTRE FREQUENCY. Without this
 *   the `db` column means nothing: a bare 2-pole's peak gain is ≈1/(1−r), and
 *   across a guitar preset r ranges from 0.9996 (100 Hz, Q 16.5) to 0.973
 *   (2500 Hz, Q 6) — a 64 dB spread that would swamp the authored levels.
 * - Mode decay follows T60 = ln(1000)·Q/(π·f) = 2.1987·Q/f. ONE constant,
 *   used everywhere.
 */

type BodyMode = {
  /** Modal frequency in Hz (before Scale). */
  hz: number;
  /** Quality factor — sets both bandwidth and ring time. */
  q: number;
  /** Level of this mode at its own centre frequency, in dB. */
  db: number;
};

type ModalBodyParams = {
  modes: readonly BodyMode[];
  /** Multiplies every modal frequency (body size). */
  scale: number;
  /** Overrides the FIRST mode's frequency (the air/Helmholtz mode); 0 = off. */
  airHz: number;
  /** 0 = dry string, 1 = fully radiated. */
  mix: number;
  /** Broadband direct-field level in dB (Woodhouse's Y_dir). */
  directDb: number;
};

type ModalBodyState = {
  /** Per-mode biquad coefficients and memory, flat for cache friendliness. */
  gain: Float64Array;
  a1: Float64Array;
  a2: Float64Array;
  y1: Float64Array;
  y2: Float64Array;
  /**
   * IDLE: the input is silent AND every mode memory is already exactly zero,
   * so the bank can be skipped. Skipping is then the identity, not an
   * approximation — this core has no noise or LFO state, so nothing moves
   * while it rests.
   */
  /** Last applied configuration, for the allocation-free change test. */
  lastSampleRate: number;
  lastScale: number;
  lastAirHz: number;
  lastDirectDb: number;
  lastModeCount: number;
  lastModes: Float64Array;
  idle: boolean;
  /** Consecutive samples with zero input whose every mode write was 0. */
  zeroSamples: number;
  wokeThisBlock: boolean;
  /** Input history for the (1 − z⁻²) numerator, shared by every mode. */
  x1: number;
  x2: number;
  count: number;
  directGain: number;
  mix: number;
  /** Signature of the parameters the coefficients were built from. */
};

const MAX_MODES = 16;
/** ln(1000)/π — the ONE constant relating Q to T60. */
const T60_PER_Q = Math.log(1000) / Math.PI;

function createModalBodyState(): ModalBodyState {
  return {
    gain: new Float64Array(MAX_MODES),
    a1: new Float64Array(MAX_MODES),
    a2: new Float64Array(MAX_MODES),
    y1: new Float64Array(MAX_MODES),
    y2: new Float64Array(MAX_MODES),
    lastSampleRate: -1,
    lastScale: -1,
    lastAirHz: -1,
    lastDirectDb: -1,
    lastModeCount: -1,
    lastModes: new Float64Array(MAX_MODES * 3),
    idle: false,
    zeroSamples: 0,
    wokeThisBlock: false,
    x1: 0,
    x2: 0,
    count: 0,
    directGain: 0,
    mix: 1,
  };
}

/** T60 of a mode, seconds. */
function modeT60(hz: number, q: number): number {
  return (T60_PER_Q * q) / hz;
}

/**
 * Magnitude of the bare 2-pole 1/(1 + a1 z⁻¹ + a2 z⁻²) at `omega`.
 * Kept for the oracles, which use it to show WHY normalisation is required.
 */
function twoPoleMagnitude(a1: number, a2: number, omega: number): number {
  const real = 1 + a1 * Math.cos(omega) + a2 * Math.cos(2 * omega);
  const imaginary = -(a1 * Math.sin(omega) + a2 * Math.sin(2 * omega));
  const denominator = Math.hypot(real, imaginary);
  return denominator > 1e-12 ? 1 / denominator : 0;
}

/**
 * Magnitude of the RESONATOR ACTUALLY USED, (1 − z⁻²)/(1 + a1 z⁻¹ + a2 z⁻²).
 *
 * The (1 − z⁻²) numerator is not cosmetic. Woodhouse 2014 eq. (3) gives the
 * modal expansion with an `iω` numerator:
 *   H(x,y,ω) = Σ iω·u_n(x)u_n(y) / (ω_n² + 2iωω_n ζ_n − ω²)
 * so a body's response is ZERO at DC. An all-pole section is instead MAXIMAL
 * there: the 100 Hz / Q 16.5 guitar mode alone has a DC gain of 5833, and the
 * bank's total is ~6600. Fed a plucked excitation it would emit a large
 * subsonic thump and a DC offset on every note. The zeros at z = ±1 put
 * |H| = 0 at both DC and Nyquist, which is what the physics says.
 */
function resonatorMagnitude(a1: number, a2: number, omega: number): number {
  const denominatorReal = 1 + a1 * Math.cos(omega) + a2 * Math.cos(2 * omega);
  const denominatorImaginary = -(
    a1 * Math.sin(omega) +
    a2 * Math.sin(2 * omega)
  );
  const denominator = Math.hypot(denominatorReal, denominatorImaginary);
  if (denominator < 1e-12) return 0;
  // numerator 1 − e^{-2jω}
  const numerator = Math.hypot(1 - Math.cos(2 * omega), Math.sin(2 * omega));
  return numerator / denominator;
}

/* ======================================================================== *
 *  IDLE COST — denormal guard + a non-destructive idle short-circuit.
 *
 *  This was the WORST offender in the whole engine: 0.28 % of a core while
 *  sounding, 3.03 % once its input went silent — 10.8x — and it sits in BOTH
 *  the guitar and the violin, so 16 released voices cost about half a core on
 *  the body alone.
 *
 *  The cause is subnormals, but NOT float32 ones: nothing in this file is
 *  float32. `y1`/`y2` are Float64Array, and after a few seconds of silence all
 *  11 violin modes park at ~1.2e-321 — subnormal against the FLOAT64 boundary
 *  2.2250738585072014e-308 — where arithmetic leaves the hardware fast path.
 *  Flushing alone takes released to 0.29 % (1.02x).
 *
 *  See `.claude/plans/idle-voice-cpu.md`.
 * ======================================================================== */

/**
 * Flush to EXACT zero below this — above BOTH subnormal boundaries.
 *
 * Applied inline at the resonator, to BOTH memories of a section at once
 * rather than through a scalar helper: a two-pole section has to be collapsed
 * as one state (see the note at its use).
 */
const DENORMAL_FLOOR = 1e-18;

/**
 * Settled samples required before the bank may idle. Only the two-sample input
 * history and the mode memories are read back, so a handful of samples would
 * do; 64 is cheap hysteresis against a signal that dips through zero.
 */
const IDLE_SETTLE_SAMPLES = 64;

/**
 * Does this input block carry any non-zero sample?
 *
 * The length is taken from the ARRAY, not the frame count, and the test is an
 * exact `!== 0`. Both matter. The input arrives as length 1 (constant across
 * the quantum) or length 128, and reading past the end of a length-1 array
 * yields `undefined` — for which `undefined !== 0` is **true**, so a scan
 * written `for (i < frames)` would wake every block and the body would never
 * idle at all. A threshold instead of `!== 0` would be worse: this node's
 * input is a decaying string, and no threshold can be chosen that upstream is
 * guaranteed to exceed.
 *
 * `NaN !== 0` is true, so a NaN input wakes the bank and the watchdog can trip.
 * `-0 !== 0` is false, which is correct: -0 carries no signal.
 */
function anyInputNonZero(input: ArrayLike<number>): boolean {
  for (let i = 0; i < input.length; i += 1) {
    if (input[i] !== 0) return true;
  }
  return false;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Rebuild the biquad coefficients if anything changed. Cheap enough to call
 * per block; the change test makes it free when nothing moved.
 */
/**
 * Field-by-field comparison against the last configuration, allocation-free.
 *
 * Deliberately compares every mode's `hz`/`q`/`db` rather than the array's
 * identity: a caller that rebuilds an equivalent preset array each block would
 * otherwise force a full recompute forever.
 */
function configurationChanged(
  state: ModalBodyState,
  params: ModalBodyParams,
  sampleRate: number,
  scale: number,
): boolean {
  if (
    state.lastSampleRate !== sampleRate ||
    state.lastScale !== scale ||
    state.lastAirHz !== params.airHz ||
    state.lastDirectDb !== params.directDb ||
    state.lastModeCount !== params.modes.length
  ) {
    return true;
  }
  for (let index = 0; index < params.modes.length; index += 1) {
    const mode = params.modes[index];
    const base = index * 3;
    if (
      state.lastModes[base] !== mode.hz ||
      state.lastModes[base + 1] !== mode.q ||
      state.lastModes[base + 2] !== mode.db
    ) {
      return true;
    }
  }
  return false;
}

function rememberConfiguration(
  state: ModalBodyState,
  params: ModalBodyParams,
  sampleRate: number,
  scale: number,
): void {
  state.lastSampleRate = sampleRate;
  state.lastScale = scale;
  state.lastAirHz = params.airHz;
  state.lastDirectDb = params.directDb;
  state.lastModeCount = params.modes.length;
  const limit = Math.min(params.modes.length, MAX_MODES);
  for (let index = 0; index < limit; index += 1) {
    const mode = params.modes[index];
    const base = index * 3;
    state.lastModes[base] = mode.hz;
    state.lastModes[base + 1] = mode.q;
    state.lastModes[base + 2] = mode.db;
  }
}

function configureModalBody(
  state: ModalBodyState,
  params: ModalBodyParams,
  sampleRate: number,
): void {
  const scale = clamp(params.scale, 0.25, 4);
  state.mix = clamp(params.mix, 0, 1);
  // Has anything the coefficients depend on actually changed?
  //
  // Compared FIELD BY FIELD, not by building a signature string. The string
  // form cost one array from `.map()`, one string per mode, a `.join()` and an
  // outer template — about 13 allocations per block per body, i.e. ~78 000 per
  // second across a 16-voice demo, ON THE AUDIO THREAD, and it ran before its
  // own early-return so it was paid even when nothing had changed. Garbage on
  // the render thread buys periodic GC pauses, and a pause past the 2.67 ms
  // quantum deadline is an underrun.
  if (!configurationChanged(state, params, sampleRate, scale)) return;
  rememberConfiguration(state, params, sampleRate, scale);

  const nyquist = sampleRate * 0.5;
  let count = 0;
  for (let index = 0; index < params.modes.length && count < MAX_MODES; index += 1) {
    const mode = params.modes[index];
    // `Air Hz` overrides the FIRST mode only — that is the air/Helmholtz
    // resonance, the one a player thinks of as "the body note".
    const frequency =
      index === 0 && params.airHz > 0 ? params.airHz : mode.hz * scale;
    // Modes above (or at) Nyquist cannot be realised — drop them rather than
    // aliasing them down into the audible range.
    if (!(frequency > 0) || frequency >= nyquist * 0.98) continue;
    const q = Math.max(0.5, mode.q);
    const omega = (2 * Math.PI * frequency) / sampleRate;
    const r = Math.exp(-omega / (2 * q));
    const a1 = -2 * r * Math.cos(omega);
    const a2 = r * r;
    const peak = resonatorMagnitude(a1, a2, omega);
    const target = 10 ** (mode.db / 20);
    state.a1[count] = a1;
    state.a2[count] = a2;
    state.gain[count] = peak > 0 ? target / peak : 0;
    state.y1[count] = 0;
    state.y2[count] = 0;
    count += 1;
  }
  state.count = count;
  state.directGain = 10 ** (params.directDb / 20);
}

function resetModalBody(state: ModalBodyState): void {
  // A watchdog reset must leave the bank AWAKE with a clear counter.
  state.idle = false;
  state.wokeThisBlock = false;
  state.zeroSamples = 0;
  state.y1.fill(0);
  state.y2.fill(0);
  state.x1 = 0;
  state.x2 = 0;
}

/**
 * Render one block. Returns false if the bank went non-finite and was reset
 * (a resonator bank is recursive, so a single NaN would ring forever).
 */
function processModalBodyBlock(
  state: ModalBodyState,
  params: ModalBodyParams,
  input: ArrayLike<number>,
  out: Float32Array,
  sampleRate: number,
): boolean {
  // IDLE FAST PATH — ahead of `configureModalBody`, so an idle bank does not
  // even pay its change test.
  //
  // A `params` change that lands while idle is therefore applied on WAKE, not
  // on arrival. That is harmless: idle output is 0 regardless of any parameter,
  // and `configureModalBody` clears the mode memories itself when the
  // configuration changes.
  state.wokeThisBlock = false;
  if (state.idle) {
    if (!anyInputNonZero(input)) {
      out.fill(0);
      return true;
    }
    state.idle = false;
    state.wokeThisBlock = true;
    state.zeroSamples = 0;
  }

  // The collapse below is needed ONLY when the bank is undriven — a mode that
  // is being excited every sample cannot park. Deciding once per block, from a
  // predicate already needed for the idle path, keeps the flush off the
  // SOUNDING path entirely: paying it per mode per sample cost +30 % there,
  // which is the wrong trade for a polyphonic engine (a 16-voice chord while
  // sounding is the peak-load case, and the idle path is where the slack was).
  const settling = !anyInputNonZero(input);

  configureModalBody(state, params, sampleRate);
  const frames = out.length;
  const { count, gain, a1, a2, y1, y2, directGain, mix } = state;
  const dry = 1 - mix;

  for (let i = 0; i < frames; i += 1) {
    const x = input.length === 1 ? input[0] : input[i];
    // (1 − z⁻²) numerator, shared across the bank.
    const excitation = x - state.x2;
    state.x2 = state.x1;
    state.x1 = x;
    // The direct field takes the SAME zeros: a plate radiates nothing at DC
    // either, and feeding it `x` leaked a standing offset (measured 0.28 for
    // a unit DC input at the violin preset's -11 dB direct level).
    let wet = directGain * excitation;
    let allZero = settling && state.x1 === 0 && state.x2 === 0;
    for (let m = 0; m < count; m += 1) {
      const y = gain[m] * excitation - a1[m] * y1[m] - a2[m] * y2[m];
      y2[m] = y1[m];
      y1[m] = y;
      wet += y;
      if (!settling) continue;
      // Collapse the resonator's BOTH memories together, and only when both
      // are tiny.
      //
      // Flushing just `y` does not work and is worse than not flushing at all:
      // with `y` forced to 0 while `y2` still holds an unflushed value, the
      // next sample computes -a2*y2, which is back above the floor. The mode
      // then ping-pongs across the threshold forever instead of decaying —
      // measured parking at 2.27e-18 and still ringing after 120 s, where the
      // unflushed model had decayed to 1e-321. A two-pole section has to be
      // treated as one state, not two numbers.
      if (
        y1[m] > -DENORMAL_FLOOR &&
        y1[m] < DENORMAL_FLOOR &&
        y2[m] > -DENORMAL_FLOOR &&
        y2[m] < DENORMAL_FLOOR
      ) {
        y1[m] = 0;
        y2[m] = 0;
      } else {
        allZero = false;
      }
    }
    out[i] = mix * wet + dry * x;

    // The quiet test is on the STATE, not on `out`. `out = mix*wet + dry*x`,
    // and Mix is an input that reaches 0 — at Mix 0 the output is identically
    // the dry input, so a silent output would say nothing about how loudly the
    // bank is ringing.
    state.zeroSamples = allZero ? state.zeroSamples + 1 : 0;
  }

  // Watchdog BEFORE the idle decision; `resetModalBody` clears both idle fields.
  if (!Number.isFinite(out[frames - 1])) {
    resetModalBody(state);
    out.fill(0);
    return false;
  }

  // There is no delay line here, so the only read-back is the two-sample input
  // history plus the mode memories, all of which this counter has just
  // observed at exactly zero.
  if (!state.wokeThisBlock && state.zeroSamples >= IDLE_SETTLE_SAMPLES) {
    // Sets a FLAG and writes no state.
    state.idle = true;
  }
  return true;
}

/**
 * Magnitude response of a configured bank at `frequency`, for oracles and for
 * the offline fit tool. Returns the linear magnitude including Mix.
 */
function modalBodyMagnitude(
  state: ModalBodyState,
  frequency: number,
  sampleRate: number,
): number {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const cos1 = Math.cos(omega);
  const sin1 = Math.sin(omega);
  const cos2 = Math.cos(2 * omega);
  const sin2 = Math.sin(2 * omega);
  // numerator N = 1 − e^{-2jω}, applied to the modes AND the direct field.
  const numeratorReal = 1 - cos2;
  const numeratorImaginary = sin2;
  let real = state.directGain * numeratorReal;
  let imaginary = state.directGain * numeratorImaginary;
  for (let m = 0; m < state.count; m += 1) {
    const denominatorReal = 1 + state.a1[m] * cos1 + state.a2[m] * cos2;
    const denominatorImaginary = -(state.a1[m] * sin1 + state.a2[m] * sin2);
    const magnitudeSquared =
      denominatorReal * denominatorReal +
      denominatorImaginary * denominatorImaginary;
    if (magnitudeSquared < 1e-24) continue;
    // gain · N / D, as a complex number
    const scale = state.gain[m] / magnitudeSquared;
    real +=
      scale *
      (numeratorReal * denominatorReal + numeratorImaginary * denominatorImaginary);
    imaginary +=
      scale *
      (numeratorImaginary * denominatorReal - numeratorReal * denominatorImaginary);
  }
  // The dry path is real and in phase with the input, so it adds to the
  // real part only.
  const dry = 1 - state.mix;
  return Math.hypot(real * state.mix + dry, imaginary * state.mix);
}

export {
  configureModalBody,
  createModalBodyState,
  MAX_MODES,
  modalBodyMagnitude,
  modeT60,
  processModalBodyBlock,
  resetModalBody,
  resonatorMagnitude,
  T60_PER_Q,
  twoPoleMagnitude,
};
export type { BodyMode, ModalBodyParams, ModalBodyState };

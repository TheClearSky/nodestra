/**
 * pluckedStringCore — a dual-polarization digital-waveguide (single delay
 * loop) plucked string.
 *
 * PURE and dependency-free by contract: this exact module is consumed by the
 * AudioWorklet wrapper (bundled into public/pluckedString.worklet.js), by the
 * vitest oracles, and by the offline render bridge, so they can never drift
 * apart. No imports, no Tone, no DOM, and `sampleRate` is always a PARAMETER
 * — never the worklet's ambient global (which does not exist in Node).
 *
 * Structure (Välimäki 2006 §7.5 eq. 45, fig. 21; Karjalainen/Välimäki/Tolonen
 * CMJ 1998 fig. 20), run once per polarization:
 *
 *     excitation ─► [comb P(z)] ─►(+)─► z^-N ─► Lagrange ─► Hl(z) ─► Ap(z) ─┬─► out
 *                                  ▲                                          │
 *                                  └──────────────────────────────────────────┘
 *
 *   Hl(z) = g(1+a)/(1+a·z⁻¹)   loop filter: g sets the fundamental's decay,
 *                              a sets how much faster the highs die.
 *   Ap(z)                      cascade of first-order allpasses = stiffness
 *                              dispersion (partials go progressively sharp).
 *   P(z) = 1 − z^(−Dp)         pluck-position comb, Dp = β·L.
 *
 * PINNED SEMANTICS
 * - `P(z) = 1 − z^(−Dp)` with `Dp = β·L` is the ONLY form that reproduces the
 *   textbook harmonic weighting |sin(k·π·β)| exactly. The sum form
 *   `0.5 + 0.5·z^(−Dp)`, and the delay `2·β·L`, are both wrong; verified
 *   numerically against sin(kπβ) for β ∈ {0.10, 0.15, 0.20, 0.35}.
 * - The loop filter's phase delay is computed EXACTLY at the played pitch,
 *   `D_lf = −atan2(a·sin ω₀, 1 + a·cos ω₀)/ω₀`, never by the ω→0 shortcut
 *   `−a/(1+a)`: at a = −0.77 the shortcut is −43 cents at 1760 Hz, and at
 *   a = −0.95 it is −700 cents.
 * - `N = floor(L_line) − 2` with `frac = L_line − N − 2` keeps the 5-tap
 *   Lagrange read at D ∈ [2,3), the numerically well-behaved region. Outside
 *   [1,4) a Lagrange interpolator can have |H| > 1 and the loop can grow.
 * - No pluck fires at initialization: the machine idles until it observes a
 *   real gate transition (the same rule envelopeCore pins).
 * - Excitation is rendered ONCE per pluck into a buffer (raised cosine →
 *   dynamics-shaping one-pole → comb), so nothing per-sample depends on the
 *   pluck history.
 */

type PickStyle = 'finger' | 'nail';

type PluckedStringParams = {
  /** Pluck position as a fraction of string length from the bridge. */
  positionBeta: number;
  /** 0 = very dark (highs die at once), 1 = bright. */
  brightness: number;
  /** T60 of the fundamental, seconds. */
  decaySec: number;
  /** Inharmonicity B: partials sit at k·f0·√(1+B·k²). */
  stiffness: number;
  /** 0 = one polarization, 1 = maximum detune/decay split. */
  polarization: number;
  /**
   * Whole-octave transpose of the Hz input, −3..+3 (mirrors `jetFlute`).
   *
   * A voice's RANGE is part of what it is. The keyboard's home window is
   * C4–D♯5; a piano's characteristic register is two octaves below that, and
   * `Hz` cannot be scaled upstream because `gain` takes `audio`, not `signal`
   * — transposing without this input costs a `toAudio → gain → toSignal`
   * round trip. Whole octaves only, so the transpose can never detune.
   */
  octave: number;
  pickStyle: PickStyle;
  /** Gate ↓ damps the string over DAMP_SEC instead of letting it ring. */
  dampOnRelease: boolean;
};

type PolarizationState = {
  buffer: Float32Array;
  writeIndex: number;
  /** Loop-filter memory. */
  loopY1: number;
  /** Allpass cascade memories (input/output per section). */
  apX: Float64Array;
  apY: Float64Array;
  /** Per-instance Lagrange scratch — the core must stay reentrant. */
  lagrange: Float64Array;
};

type PluckedStringState = {
  sampleRate: number;
  bufferSize: number;
  bufferMask: number;
  vertical: PolarizationState;
  horizontal: PolarizationState;
  /** Rendered excitation for the current pluck, and how far it has played. */
  excitation: Float32Array;
  excitationLength: number;
  excitationPos: number;
  /** Amplitude split of the current pluck between the two polarizations. */
  excVerticalGain: number;
  excHorizontalGain: number;
  /** Raw gate of the previous sample; null = pre-init (no edge at start). */
  lastGate: boolean | null;
  /**
   * IDLE: silent AND every state value already exactly zero, so the loop can
   * be skipped as an identity.
   *
   * The quiet test REQUIRES the gate to be low. That is load-bearing: this
   * core triggers on a RISING EDGE, and `lastGate` is only written inside the
   * loop, so entering idle with `lastGate === true` would mean the wake scan
   * fires on a gate that was already high, no transition is seen,
   * `renderExcitation` never runs, and the string stays silent until the user
   * releases and presses again.
   */
  idle: boolean;
  zeroSamples: number;
  wokeThisBlock: boolean;
  /**
   * Peak |out| of the previous block, used to ARM the denormal flush.
   *
   * The flush costs ~18 comparisons per sample here (loop filter, 4 allpass
   * sections x 2 polarizations, both buffer writes, the integrator), which
   * measured +27 % on the SOUNDING path — the peak-load case for a polyphonic
   * instrument. State can only park subnormal once the string is essentially
   * silent, so the flush is armed a block late, from a level at which nothing
   * can yet be within 20 orders of magnitude of the subnormal range.
   */
  lastBlockPeak: number;
  /** Multiplies the loop gain; ramps to 0 on release when damping. */
  dampGain: number;
  damping: boolean;
  /** Bridge-force integrator memory (Välimäki 2006 eq. 45's I(z)). */
  integratorY1: number;
};

/** Lowest pitch the delay lines must accommodate. */
const MIN_HZ = 20;
const MAX_HZ = 8000;
/** Damp-on-release ramp (Laurson et al. 2001 use ~10 ms before a re-pluck). */
const DAMP_SEC = 0.01;
/**
 * Pluck contact times: a fingertip is slower than a nail.
 *
 * These are SHORT on purpose, and the burst is NOT where the pluck's softness
 * comes from. Välimäki 2006 §7.3: "the acceleration variable is favourable,
 * because an impulse is useful as a single sample excitation" — the burst
 * approximates that impulse, and the dynamics-shaping filter supplies the
 * level-dependent colour. Letting the burst do both jobs darkens the model
 * twice: a raised cosine of duration T nulls at 2/T, so a 6 ms "finger" nulls
 * at 333 Hz (h3 of an A2 at −47 dB) and even 1.2 ms nulls at 1.7 kHz, which
 * measured −16.7 dB/octave against a real guitar's −4.9. At these widths the
 * nulls sit at 5.7 kHz and 13 kHz, out of the way.
 */
const PICK_SEC: Record<PickStyle, number> = { finger: 0.00035, nail: 0.00015 };
/**
 * Erkut et al. 2000's calibrated pluck-shaping filter, as a THREE-point law.
 *
 * The paper derives forte and piano by deconvolving against the FORTISSIMO
 * excitation, so ff is the unshaped reference (pole 0, gain 1) and forte is
 * already a 541 Hz lowpass. Mapping Amp = 1 to *forte* — the obvious reading —
 * makes the loudest available pluck dull: measured tilt −20.3 dB/octave
 * against a real guitar's −4.9, with h9 forty dB down where the recording has
 * it six dB down. Amp = 1 must be fortissimo.
 *
 * Anchors: (Amp, pole, gain). Erkut's measured gains gf/gp are kept rather
 * than normalised away, so dynamics change level as well as colour.
 */
const SHAPE_ANCHORS: ReadonlyArray<readonly [number, number, number]> = [
  [0.25, -0.9944, 0.4842],
  [0.6, -0.9292, 0.5403],
  [1, 0, 1],
];
/** Apoyando vs tirando: Laurson et al. measure tirando ≈3.5 dB weaker. */
const PICK_GAIN: Record<PickStyle, number> = {
  finger: 10 ** (-3.5 / 20),
  nail: 1,
};
/** Max first-order allpass sections available for dispersion. */
const MAX_DISPERSION_SECTIONS = 4;

/**
 * Depth of the pluck-position comb. 1.0 would be an ideal POINT pluck with
 * infinitely deep nulls — measured at −72 dB for h5 at β = 0.2, where the
 * Iowa A2 has that partial at −6.8 dB. A real finger has width, so the
 * notches are only partial, and that surgical regularity is part of what made
 * the model read as synthetic.
 *
 * Tuned against the notch depth AND the overall tilt (deeper is better on
 * both counts until the comb starts eating the spectrum):
 *   depth 0.68   h5 −9.4 dB   h4 −3.3 dB   tilt −10.1 dB/oct
 *   depth 0.80   h5 −11.7     h4 −4.3      tilt −10.3
 *   depth 0.90   h5 −13.8     h4 −5.3      tilt −10.7   ← shipped
 * (notch = the harmonic with the pluck ON its null versus a position that
 * does not null it, which cancels the spectral tilt out of the comparison.)
 */
const COMB_DEPTH = 0.9;

/**
 * The two polarizations are released from very slightly different points —
 * a fingertip is not a knife edge — which smears the comb further and stops
 * the nulls from being identical in both planes.
 */
const POLARIZATION_PLUCK_OFFSET = 0.025;

/**
 * Bridge-force integrator, the I(z) factor of Välimäki 2006 eq. (45):
 * "HB(z) = I(z) approximates integration (1/s in the Laplace domain) to
 * obtain the force at the bridge."
 *
 * Without it the output is not bridge force and the spectrum is tilted
 * +6 dB/octave — h10 twenty dB too loud relative to h1, which is precisely
 * the metallic ring the old Karplus–Strong demo suffered from. Leaky so that
 * no DC can accumulate in the recursion.
 */
const INTEGRATOR_POLE = 0.999;
/** Normalised to unity gain at 1 kHz / 48 kHz. */
const INTEGRATOR_REFERENCE_OMEGA = (2 * Math.PI * 1000) / 48000;

function createPolarization(
  bufferSize: number,
  sections: number,
): PolarizationState {
  return {
    buffer: new Float32Array(bufferSize),
    writeIndex: 0,
    loopY1: 0,
    apX: new Float64Array(sections),
    apY: new Float64Array(sections),
    lagrange: new Float64Array(5),
  };
}

/**
 * Allocate a string. `sampleRate` fixes the delay-line length needed for
 * MIN_HZ; the excitation buffer must hold the burst plus the comb delay.
 */
function createPluckedStringState(sampleRate: number): PluckedStringState {
  const needed = Math.ceil(sampleRate / MIN_HZ) + 8;
  let bufferSize = 1;
  while (bufferSize < needed) bufferSize *= 2;
  // Burst + the longest comb delay (β ≤ 0.5 of the lowest note's loop) + the
  // shaping filter's tail.
  const excitationCapacity =
    Math.ceil(sampleRate * PICK_SEC.finger) +
    Math.ceil(sampleRate / MIN_HZ) +
    2048;
  return {
    sampleRate,
    bufferSize,
    bufferMask: bufferSize - 1,
    vertical: createPolarization(bufferSize, MAX_DISPERSION_SECTIONS),
    horizontal: createPolarization(bufferSize, MAX_DISPERSION_SECTIONS),
    excitation: new Float32Array(excitationCapacity),
    excitationLength: 0,
    excitationPos: 0,
    excVerticalGain: 0,
    excHorizontalGain: 0,
    lastGate: null,
    idle: false,
    zeroSamples: 0,
    wokeThisBlock: false,
    lastBlockPeak: 1,
    dampGain: 1,
    damping: false,
    integratorY1: 0,
  };
}

/* ======================================================================== *
 *  IDLE COST — denormal guard + a non-destructive idle short-circuit.
 *
 *  Measured 0.43 % of a core sounding and 4.85 % once the note had decayed —
 *  11.4x, the worst ratio in the engine alongside the body.
 *
 *  Both float boundaries are crossed: the polarization buffers are Float32Array
 *  (boundary 1.1754943508222875e-38, parking at 1.401e-45 with `Damp: off`)
 *  while `loopY1` and `integratorY1` are plain numbers that park at -4.94e-324
 *  and 2.465e-321 against the FLOAT64 boundary 2.2250738585072014e-308.
 *  `integratorY1` is the slow one: the bridge integrator's pole is 0.999.
 *
 *  NOTE this core was previously believed to be cheap already. It was not —
 *  it had been measured with the wrong parameter names, which left the string
 *  unexcited and silent. A silent render is fast and proves nothing.
 *
 *  See `.claude/plans/idle-voice-cpu.md`.
 * ======================================================================== */

/** Flush to EXACT zero below this — above BOTH subnormal boundaries. */
const DENORMAL_FLOOR = 1e-18;

function flush(value: number): number {
  // NaN fails both comparisons and passes through, so the watchdog still sees it.
  return value > -DENORMAL_FLOOR && value < DENORMAL_FLOOR ? 0 : value;
}

/** Extra settled samples on top of the loop's read-back distance. */
const IDLE_MARGIN_SAMPLES = 8;

/**
 * Arm the denormal flush once the previous block peaked below this.
 *
 * -180 dBFS: already far under the 24-bit noise floor, yet twenty orders of
 * magnitude above the float32 subnormal boundary, so nothing can reach the
 * subnormal range within the one block of lag this introduces.
 */
const FLUSH_ARM_LEVEL = 1e-9;

/**
 * Is any sample of this gate block high? Length taken from the ARRAY (it may
 * be 1 or 128), and the whole block is scanned because `thresholdCore` can
 * emit a gate that rises and falls inside a single quantum.
 */
function anyGateHigh(gate: ArrayLike<number>): boolean {
  for (let i = 0; i < gate.length; i += 1) {
    if (gate[i] >= 0.5) return true;
  }
  return false;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Per-trip loop gain that makes the fundamental decay 60 dB in `t60`
 * seconds: G^(f0·t60) = 10⁻³.
 *
 * This is the gain the WHOLE loop must have. The loop filter already
 * contributes |Hl(ω₀)| < 1, so `loopGainCompensated` divides it out —
 * otherwise the Decay knob under-delivers by 3 % at the default Brightness
 * and by far more at the dark end, where the knob would be inoperative.
 */
function loopGainForT60(f0: number, t60: number): number {
  if (t60 <= 0) return 0;
  return 10 ** (-3 / (f0 * t60));
}

/** |Hl(ω)| for the loop filter g(1+a)/(1+a·z⁻¹), with g factored out. */
function loopFilterMagnitude(a: number, omega: number): number {
  return (
    (1 + a) / Math.sqrt(1 + a * a + 2 * a * Math.cos(omega))
  );
}

/** The `g` that delivers `t60` at `f0` GIVEN the loop filter's own loss. */
function loopGainCompensated(
  f0: number,
  t60: number,
  a: number,
  omega0: number,
): number {
  const target = loopGainForT60(f0, t60);
  const filter = loopFilterMagnitude(a, omega0);
  if (!(filter > 1e-9)) return 0;
  // Never let the compensated loop reach or exceed unity — that would be a
  // string that never decays, or grows.
  return Math.min(0.999999, target / filter);
}

/**
 * Brightness 0..1 → the loop filter's pole. Dark = highs die fast.
 *
 * The dark end stops at −0.85, NOT −0.95: at −0.95 the one-pole attenuates
 * even the fundamental to |Hl| ≈ 0.66 per trip, so the string dies in
 * milliseconds whatever the Decay knob says (measured: 72 dB below the same
 * pluck at Brightness 0.6). −0.85 is the darkest pole that still leaves a
 * playable, in-tune string.
 */
function loopPoleForBrightness(brightness: number): number {
  return -0.85 + 0.55 * clamp(brightness, 0, 1);
}

/** EXACT phase delay of Hl(z) = g(1+a)/(1+a·z⁻¹) at ω (samples). */
function loopFilterPhaseDelay(a: number, omega: number): number {
  if (omega <= 0) return -a / (1 + a);
  const phase = Math.atan2(a * Math.sin(omega), 1 + a * Math.cos(omega));
  return -phase / omega;
}

/** Phase delay of one first-order allpass (a + z⁻¹)/(1 + a·z⁻¹) at ω. */
function allpassPhaseDelay(a: number, omega: number): number {
  if (omega <= 0) return (1 - a) / (1 + a);
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  // numerator a + e^{-jw}, denominator 1 + a e^{-jw}
  const numeratorPhase = Math.atan2(-sin, a + cos);
  const denominatorPhase = Math.atan2(-a * sin, 1 + a * cos);
  let phase = numeratorPhase - denominatorPhase;
  while (phase > 0) phase -= 2 * Math.PI;
  return -phase / omega;
}

/**
 * Dispersion coefficient for a target inharmonicity.
 *
 * The pole is NEGATIVE: only a < 0 gives a phase delay that FALLS with
 * frequency, which is what makes upper partials go sharp. (A positive pole
 * does the opposite; verified numerically.) Solved by bisection so that
 * partial k = 8 lands on k·f0·√(1+B·k²).
 *
 * The achievable dispersion is bounded — a cascade of first-order sections
 * cannot deliver an arbitrary delay drop without also eating an arbitrary
 * amount of the loop delay — so this saturates at MIN_DISPERSION_POLE and the
 * caller must be prepared for a smaller B than requested. That limit is the
 * documented cap on the Stiffness knob.
 */
const MIN_DISPERSION_POLE = -0.95;

function dispersionCoefficient(
  stiffness: number,
  f0: number,
  sampleRate: number,
  sections: number,
): number {
  if (stiffness <= 0 || sections <= 0) return 0;
  const k = 8;
  const omegaK = (2 * Math.PI * k * f0) / sampleRate;
  if (omegaK >= Math.PI) return 0;
  const omega0 = (2 * Math.PI * f0) / sampleRate;
  const wanted =
    (sampleRate / f0) * (1 - 1 / Math.sqrt(1 + stiffness * k * k));
  const dropAt = (pole: number): number =>
    sections *
    (allpassPhaseDelay(pole, omega0) - allpassPhaseDelay(pole, omegaK));
  if (dropAt(MIN_DISPERSION_POLE) <= wanted) return MIN_DISPERSION_POLE;
  // drop is monotonically DECREASING in the pole (0 → no drop).
  let low = MIN_DISPERSION_POLE;
  let high = 0;
  for (let i = 0; i < 50; i += 1) {
    const mid = 0.5 * (low + high);
    if (dropAt(mid) < wanted) high = mid;
    else low = mid;
  }
  return 0.5 * (low + high);
}

/**
 * Pluck-shaping filter at a given dynamic level, interpolated between
 * Erkut's three anchors in the log domain.
 */
function interpolateShape(level: number): { pole: number; gain: number } {
  const first = SHAPE_ANCHORS[0];
  const last = SHAPE_ANCHORS[SHAPE_ANCHORS.length - 1];
  if (level <= first[0]) return { pole: first[1], gain: first[2] };
  if (level >= last[0]) return { pole: last[1], gain: last[2] };
  for (let i = 0; i < SHAPE_ANCHORS.length - 1; i += 1) {
    const [aLevel, aPole, aGain] = SHAPE_ANCHORS[i];
    const [bLevel, bPole, bGain] = SHAPE_ANCHORS[i + 1];
    if (level > bLevel) continue;
    const t = (level - aLevel) / (bLevel - aLevel);
    // corner = 1 − |pole|, interpolated geometrically
    const cornerA = 1 - Math.abs(aPole);
    const cornerB = 1 - Math.abs(bPole);
    const corner = Math.exp(
      Math.log(cornerA) + t * (Math.log(cornerB) - Math.log(cornerA)),
    );
    const gain = Math.exp(
      Math.log(aGain) + t * (Math.log(bGain) - Math.log(aGain)),
    );
    return { pole: -(1 - corner), gain };
  }
  return { pole: last[1], gain: last[2] };
}

/** 5-tap Lagrange coefficients for fractional delay `d` (taps k = 0..4). */
function lagrange5(d: number, out: Float64Array): void {
  for (let i = 0; i < 5; i += 1) {
    let h = 1;
    for (let j = 0; j < 5; j += 1) {
      if (j !== i) h *= (d - j) / (i - j);
    }
    out[i] = h;
  }
}

/**
 * Render one pluck into `state.excitation`: a raised-cosine contact burst,
 * through the dynamics-shaping one-pole, through the pluck-position comb.
 */
function renderExcitation(
  state: PluckedStringState,
  params: PluckedStringParams,
  f0: number,
  amp: number,
): void {
  const { sampleRate } = state;
  const loopLength = sampleRate / f0;
  const beta = clamp(params.positionBeta, 0.02, 0.5);
  // FRACTIONAL: rounding Dp to an integer moves the nulls off the harmonics
  // (β = 0.2 at A2 gives Dp = 87.27, and rounding puts the first null at
  // k = 5.015 instead of 5, filling in what should be a deep notch).
  const combDelay = Math.max(1, beta * loopLength);
  const combWhole = Math.floor(combDelay);
  const combFrac = combDelay - combWhole;
  const pickSamples = Math.max(
    2,
    Math.round(sampleRate * PICK_SEC[params.pickStyle]),
  );
  // 1. raised-cosine contact burst, 2. dynamics shaping (Erkut 2000).
  const level = clamp(amp, 0, 4);
  // Interpolate the shaping filter between Erkut's three measured anchors.
  // `1 − |pole|` (the filter's corner) and the gain both move in the log
  // domain — a pole is not a perceptually linear coordinate.
  const shape = interpolateShape(Math.min(1, level));
  const shapePole = shape.pole;
  const shapeGain = (1 + shapePole) * shape.gain;
  // The shaping one-pole has a long tail (τ ≈ 1/(1−|a|), up to ~180 samples
  // at the piano setting). Truncating it would leave a step edge whose
  // broadband energy FILLS the comb notches — measured as an 11 dB notch
  // where the physics demands 25+ dB.
  const shapeTail = Math.ceil(8 / Math.max(1e-3, 1 + shapePole));
  const total = Math.min(
    state.excitation.length,
    pickSamples +
      combWhole +
      Math.round(combDelay * POLARIZATION_PLUCK_OFFSET) +
      shapeTail +
      2,
  );
  const scratch = state.excitation;
  scratch.fill(0, 0, total);
  let shaped = 0;
  for (let n = 0; n < total; n += 1) {
    const raw =
      n < pickSamples
        ? 0.5 * (1 - Math.cos((2 * Math.PI * n) / pickSamples))
        : 0;
    shaped = shapeGain * raw - shapePole * shaped;
    scratch[n] = shaped;
  }
  // 3. pluck-position comb  P(z) = 1 − depth·z^(−Dp), fractional, applied in
  //    place from the end (only earlier samples are read, so this is safe).
  //
  //    `depth` < 1 because a real pluck is not a point. A finger or nail has
  //    width, so the excitation is smeared over a short span of the string
  //    and the nulls fill in: the Iowa A2 measures h5 at −6.8 dB, where an
  //    ideal comb puts it at −72 dB. Perfect nulls are what made the model
  //    sound synthetic and struck rather than plucked.
  //    Two taps straddling Dp model that width directly: the contact spans a
  //    short length of string, so the reflected image is spread rather than
  //    a single point.
  const spread = Math.max(1, Math.round(combDelay * POLARIZATION_PLUCK_OFFSET));
  const nearWhole = Math.max(1, combWhole - spread);
  const farWhole = combWhole + spread;
  for (let n = total - 1; n > farWhole; n -= 1) {
    const a = scratch[n - combWhole];
    const b = scratch[n - combWhole - 1];
    const centre = a + (b - a) * combFrac;
    const near = scratch[n - nearWhole];
    const far = scratch[n - farWhole];
    scratch[n] -= COMB_DEPTH * (0.6 * centre + 0.2 * near + 0.2 * far);
  }
  // 4. level law and normalisation. The comb's peak gain is 2.
  const gain = (0.5 * PICK_GAIN[params.pickStyle] * level ** 1.5) / 1;
  for (let n = 0; n < total; n += 1) scratch[n] *= gain;

  state.excitationLength = total;
  state.excitationPos = 0;
  // Pick direction: tirando drives mostly the vertical (bridge-coupled)
  // polarization; the split widens with the Polarization knob.
  const split = 0.5 + 0.1 * clamp(params.polarization, 0, 1);
  state.excVerticalGain = split;
  state.excHorizontalGain = 1 - split;
}

type PolarizationCoefficients = {
  integerDelay: number;
  lagrange: Float64Array;
  loopGain: number;
  loopPole: number;
  dispersionPole: number;
  dispersionSections: number;
  outputGain: number;
};

function computeCoefficients(
  state: PluckedStringState,
  params: PluckedStringParams,
  f0: number,
  isHorizontal: boolean,
  scratch: Float64Array,
): PolarizationCoefficients {
  const { sampleRate } = state;
  const polarization = clamp(params.polarization, 0, 1);
  // The horizontal polarization is slightly detuned and decays more slowly:
  // together they give the two-stage decay and slow beating of a real note.
  const detune = isHorizontal ? 1 + 0.002 * polarization : 1;
  const pitch = clamp(f0 * detune, MIN_HZ, MAX_HZ);
  const omega0 = (2 * Math.PI * pitch) / sampleRate;

  const loopPole = loopPoleForBrightness(params.brightness);
  const baseGain = loopGainCompensated(
    pitch,
    Math.max(0.02, params.decaySec),
    loopPole,
    omega0,
  );
  const loopGain = isHorizontal ? baseGain ** 0.6 : baseGain;

  const totalDelay = sampleRate / pitch;
  // A dispersion cascade also ADDS delay at f0; it must never eat so much of
  // the loop that the delay line cannot express the pitch (which would clamp
  // and detune the note). Shed sections until it fits.
  let sections = params.stiffness > 0 ? MAX_DISPERSION_SECTIONS : 0;
  let dispersionPole = 0;
  let apDelay = 0;
  while (sections > 0) {
    dispersionPole = dispersionCoefficient(
      params.stiffness,
      pitch,
      sampleRate,
      sections,
    );
    apDelay = sections * allpassPhaseDelay(dispersionPole, omega0);
    if (apDelay <= 0.25 * totalDelay) break;
    sections -= 1;
    dispersionPole = 0;
    apDelay = 0;
  }

  const filterDelay = loopFilterPhaseDelay(loopPole, omega0);
  let lineDelay = totalDelay - filterDelay - apDelay;
  const maxDelay = state.bufferSize - 8;
  lineDelay = clamp(lineDelay, 6, maxDelay);

  const integerDelay = Math.floor(lineDelay) - 2;
  const frac = lineDelay - integerDelay - 2;
  lagrange5(2 + frac, scratch);

  return {
    integerDelay,
    lagrange: scratch,
    loopGain,
    loopPole,
    dispersionPole,
    dispersionSections: sections,
    outputGain: isHorizontal ? 0.5 : 1,
  };
}

function stepPolarization(
  polar: PolarizationState,
  coefficients: PolarizationCoefficients,
  input: number,
  mask: number,
  dampGain: number,
  /** Arm the denormal flush — see FLUSH_ARM_LEVEL. Off while sounding. */
  flushing: boolean,
): number {
  const {
    integerDelay,
    lagrange,
    loopGain,
    loopPole,
    dispersionPole,
    dispersionSections,
  } = coefficients;
  const { buffer, writeIndex } = polar;
  const base = writeIndex - integerDelay;
  let read =
    lagrange[0] * buffer[base & mask] +
    lagrange[1] * buffer[(base - 1) & mask] +
    lagrange[2] * buffer[(base - 2) & mask] +
    lagrange[3] * buffer[(base - 3) & mask] +
    lagrange[4] * buffer[(base - 4) & mask];

  // Loop filter Hl(z) = g(1+a)/(1+a z^-1), with the damp ramp folded in.
  const gain = loopGain * dampGain;
  const raw = gain * (1 + loopPole) * read - loopPole * polar.loopY1;
  const filtered = flushing ? flush(raw) : raw;
  polar.loopY1 = filtered;
  read = filtered;

  // Dispersion: cascade of first-order allpasses (a + z^-1)/(1 + a z^-1).
  for (let s = 0; s < dispersionSections; s += 1) {
    const x = read;
    const raw = dispersionPole * x + polar.apX[s] - dispersionPole * polar.apY[s];
    const y = flushing ? flush(raw) : raw;
    polar.apX[s] = flushing ? flush(x) : x;
    polar.apY[s] = y;
    read = y;
  }

  buffer[writeIndex & mask] = flushing ? flush(read + input) : read + input;
  polar.writeIndex = writeIndex + 1;
  return read;
}

function resetPolarization(polar: PolarizationState): void {
  polar.buffer.fill(0);
  polar.loopY1 = 0;
  polar.apX.fill(0);
  polar.apY.fill(0);
}

/** Clear every resonating state (used by the NaN watchdog). */
function resetPluckedString(state: PluckedStringState): void {
  // A watchdog reset must leave the string AWAKE with a clear counter.
  // NOTE `lastGate` is deliberately NOT cleared here (it never was): clearing
  // it would manufacture a spurious rising edge on the next block.
  state.idle = false;
  state.wokeThisBlock = false;
  state.zeroSamples = 0;
  state.lastBlockPeak = 1;
  resetPolarization(state.vertical);
  resetPolarization(state.horizontal);
  state.excitationLength = 0;
  state.excitationPos = 0;
  state.dampGain = 1;
  state.damping = false;
  state.integratorY1 = 0;
}

/**
 * Render one block. `hz`, `amp` and `gate` may each be length 1 (constant for
 * the quantum) or the same length as `out`. Returns true if the block was
 * finite; false means the watchdog reset the string.
 */
function processPluckedStringBlock(
  state: PluckedStringState,
  params: PluckedStringParams,
  hz: ArrayLike<number>,
  amp: ArrayLike<number>,
  gate: ArrayLike<number>,
  out: Float32Array,
  sampleRate: number,
): boolean {
  state.sampleRate = sampleRate;
  const frames = out.length;
  const hzConstant = hz.length === 1;
  const ampConstant = amp.length === 1;
  // IDLE FAST PATH. Entry required every state value to be exactly zero, so
  // emitting zeros is what the loop provably computes. It sits after the
  // worklet's `stopped` check (trap #19), which is the caller's.
  state.wokeThisBlock = false;
  if (state.idle) {
    if (!anyGateHigh(gate)) {
      out.fill(0);
      return true;
    }
    state.idle = false;
    state.wokeThisBlock = true;
    // Clearing the counter on wake is load-bearing: a stale count carried into
    // the waking block could re-enter idle at that block's end and erase the
    // excitation that had just been rendered — and since `lastGate` would then
    // already be true, no second edge would ever fire.
    state.zeroSamples = 0;
  }

  // Arm the flush only once the string is essentially silent — see
  // FLUSH_ARM_LEVEL. Paying it per write while sounding measured +27 %.
  const flushing = state.lastBlockPeak < FLUSH_ARM_LEVEL;
  let blockPeak = 0;

  const gateConstant = gate.length === 1;

  // Whole octaves only, so the transpose can never detune anything. Applied
  // BEFORE the MIN_HZ/MAX_HZ clamp, so a transposed pitch is range-checked at
  // the value the loop will actually run at.
  const octaveScale = 2 ** Math.round(clamp(params.octave, -3, 3));

  const firstHz = clamp(hz[0] * octaveScale, MIN_HZ, MAX_HZ);
  const vertical = computeCoefficients(
    state,
    params,
    firstHz,
    false,
    state.vertical.lagrange,
  );
  const horizontal = computeCoefficients(
    state,
    params,
    firstHz,
    true,
    state.horizontal.lagrange,
  );

  const dampStep = 1 / Math.max(1, DAMP_SEC * sampleRate);
  const mask = state.bufferMask;
  // |I(e^{jω})| = g/|1 − λ·e^{-jω}|; solve g for unity at the reference.
  const referenceOmega = (INTEGRATOR_REFERENCE_OMEGA * 48000) / sampleRate;
  const integratorGain = Math.hypot(
    1 - INTEGRATOR_POLE * Math.cos(referenceOmega),
    INTEGRATOR_POLE * Math.sin(referenceOmega),
  );

  for (let i = 0; i < frames; i += 1) {
    const gateValue = (gateConstant ? gate[0] : gate[i]) >= 0.5;
    if (state.lastGate === null) {
      state.lastGate = gateValue;
    } else if (gateValue !== state.lastGate) {
      state.lastGate = gateValue;
      if (gateValue) {
        const level = ampConstant ? amp[0] : amp[i];
        const pitch = clamp(
          (hzConstant ? hz[0] : hz[i]) * octaveScale,
          MIN_HZ,
          MAX_HZ,
        );
        renderExcitation(state, params, pitch, level);
        state.damping = false;
        state.dampGain = 1;
      } else if (params.dampOnRelease) {
        state.damping = true;
      }
    }

    if (state.damping && state.dampGain > 0) {
      state.dampGain = Math.max(0, state.dampGain - dampStep);
    }

    let drive = 0;
    if (state.excitationPos < state.excitationLength) {
      drive = state.excitation[state.excitationPos];
      state.excitationPos += 1;
    }

    const v = stepPolarization(
      state.vertical,
      vertical,
      drive * state.excVerticalGain,
      mask,
      state.dampGain,
      flushing,
    );
    const h = stepPolarization(
      state.horizontal,
      horizontal,
      drive * state.excHorizontalGain,
      mask,
      state.dampGain,
      flushing,
    );
    const bridge = v * vertical.outputGain + h * horizontal.outputGain;
    // I(z): integrate to bridge force, leaky and gain-normalised at 1 kHz.
    const integrated =
      integratorGain * bridge + INTEGRATOR_POLE * state.integratorY1;
    state.integratorY1 = flushing ? flush(integrated) : integrated;
    out[i] = state.integratorY1;
    const magnitude =
      state.integratorY1 < 0 ? -state.integratorY1 : state.integratorY1;
    if (magnitude > blockPeak) blockPeak = magnitude;

    // `gateValue` must be false here — see the note on `idle` in the state
    // type. The excitation must also be spent, or a pluck rendered but not yet
    // fully read out could be skipped.
    state.zeroSamples =
      !gateValue &&
      v === 0 &&
      h === 0 &&
      state.integratorY1 === 0 &&
      state.excitationPos >= state.excitationLength
        ? state.zeroSamples + 1
        : 0;
  }

  // Idle decision comes after the watchdog below.
  // Watchdog: a non-finite sample would circulate in the delay line forever.
  state.lastBlockPeak = blockPeak;

  const last = out[frames - 1];
  if (!Number.isFinite(last)) {
    resetPluckedString(state);
    out.fill(0);
    return false;
  }

  // Idle only once the settle run exceeds the loop's read-back distance, so
  // every readable slot was written as exact zero. Both polarizations share a
  // buffer length, and the allpass cascade adds its own group delay.
  if (
    !state.wokeThisBlock &&
    state.zeroSamples >=
      Math.max(vertical.integerDelay, horizontal.integerDelay) +
        MAX_DISPERSION_SECTIONS +
        IDLE_MARGIN_SAMPLES
  ) {
    // Sets a FLAG and writes no state.
    state.idle = true;
  }
  return true;
}

export {
  allpassPhaseDelay,
  createPluckedStringState,
  dispersionCoefficient,
  lagrange5,
  loopFilterPhaseDelay,
  loopGainForT60,
  loopPoleForBrightness,
  MAX_HZ,
  MIN_HZ,
  processPluckedStringBlock,
  resetPluckedString,
};
export type { PickStyle, PluckedStringParams, PluckedStringState };

/**
 * struckStringCore — a digital-waveguide PIANO string group: one to three
 * bridge-coupled unison strings driven by a felt hammer.
 *
 * PURE and dependency-free by contract (same rule as `pluckedStringCore`,
 * `bowedStringCore` and `modalBodyCore`): no imports, no Tone, no DOM, and
 * `sampleRate` is always a PARAMETER. This exact module is consumed by the
 * AudioWorklet wrapper, the vitest oracles and the offline render bridge, so
 * they can never drift apart.
 *
 * The STRING is the same object `pluckedStringCore` models, and the waveguide
 * math here is ported from it deliberately rather than shared — the cores are
 * import-free by contract, so duplication is the house pattern:
 *
 *     excitation ─► [comb P(z)] ─►(+)─► z^-N ─► Lagrange ─► Hl(z) ─► Ap(z) ─┬─► out
 *                                  ▲                                          │
 *                                  └──────────────────────────────────────────┘
 *
 *   Hl(z) = g(1+a)/(1+a·z⁻¹)   loop filter: g sets the fundamental's decay,
 *                              a sets how much faster the highs die.
 *   Ap(z)                      allpass cascade = stiffness dispersion, which
 *                              puts partial k at k·f0·√(1+B·k²) — the piano's
 *                              defining inharmonicity.
 *   P(z) = 1 − z^(−Dp)         strike-position comb, Dp = β·L.
 *
 * WHAT MAKES IT A PIANO RATHER THAN A GUITAR
 *
 * 1. THE HAMMER, and specifically its CONTACT TIME. Piano felt is a nonlinear
 *    spring, F = C⁻¹·Δy^p with p ≈ 2–3, so striking harder makes the felt
 *    behave STIFFER, which SHORTENS the contact. A raised-cosine force pulse
 *    of duration T has its first spectral null at 2/T, so contact time is
 *    directly a lowpass corner:
 *
 *        soft  τ ≈ 4 ms  → null at  500 Hz → few partials, dark
 *        hard  τ ≈ 1 ms  → null at 2000 Hz → many partials, bright
 *
 *    That is why a soft piano note is not a quiet loud one: dynamics change
 *    the SPECTRUM, not just the level. Contact times follow Askenfelt &
 *    Jansson's measurements — roughly 2–4 ms in the bass, 1–2 ms in the
 *    midrange, under 1 ms in the treble — shortening with velocity as about
 *    v^−0.25.
 *
 *    NOTE THE DELIBERATE REVERSAL. `pluckedStringCore`'s header warns that
 *    letting the excitation burst carry the dynamics "darkens the model
 *    twice", and uses a 0.35 ms burst plus a separate shaping filter instead.
 *    That is right for a PLUCK, where contact is genuinely near-instantaneous.
 *    For a hammer the millisecond-scale contact IS the physics, and
 *    band-limiting the excitation is the mechanism being modelled, not an
 *    artifact of it.
 *
 * 2. THE UNISON GROUP. A piano key drives two or three strings tuned a few
 *    cents apart and coupled through the bridge. Their in-phase motion drives
 *    the bridge hard and dies fast; their out-of-phase motion barely moves it
 *    and lingers. The audible result is the piano's signature TWO-STAGE
 *    decay — a prompt sound, then a much longer aftersound — plus slow
 *    beating. Modelled here as N loops at slightly different lengths whose
 *    decay rates differ, summed at the bridge.
 *
 * PINNED SEMANTICS (inherited from pluckedStringCore, same reasons)
 * - The loop filter's phase delay is computed EXACTLY at the played pitch,
 *   never by the ω→0 shortcut.
 * - `N = floor(L_line) − 2` with `frac = L_line − N − 2` keeps the 5-tap
 *   Lagrange read at D ∈ [2,3), the numerically well-behaved region.
 * - No strike fires at initialization: the machine idles until it observes a
 *   real gate transition.
 * - Excitation is rendered ONCE per strike into a buffer, so nothing
 *   per-sample depends on the strike history.
 */

type StruckStringParams = {
  /** Strike point as a fraction of string length from the bridge. A real
   *  piano hammer lands near 1/8, which nulls the 8th partial. */
  positionBeta: number;
  /** 0 = very dark (highs die at once), 1 = bright. */
  brightness: number;
  /** T60 of the fundamental, seconds. */
  decaySec: number;
  /** Inharmonicity B: partials sit at k·f0·√(1+B·k²). */
  stiffness: number;
  /** Strings in the unison group, 1–3. */
  strings: number;
  /** Total detune spread across the group, in cents. */
  unisonCents: number;
  /** Hammer felt hardness, 0 = soft/old, 1 = hard/new. Scales contact time. */
  hardness: number;
  /** Whole-octave transpose of the Hz input, −3..+3. */
  octave: number;
  /** Gate ↓ drops the damper onto the strings instead of letting them ring. */
  dampOnRelease: boolean;
};

type StringLineState = {
  buffer: Float32Array;
  writeIndex: number;
  loopY1: number;
  apX: Float64Array;
  apY: Float64Array;
  lagrange: Float64Array;
};

type StruckStringState = {
  sampleRate: number;
  bufferSize: number;
  bufferMask: number;
  lines: StringLineState[];
  excitation: Float32Array;
  excitationLength: number;
  excitationPos: number;
  /** Per-string share of the strike, index-aligned with `lines`. */
  lineGain: Float64Array;
  lastGate: boolean | null;
  damping: boolean;
  dampGain: number;
  integratorY1: number;
  /** Soundboard biquad memory: [x1, x2, y1, y2] per section, 2 sections. */
  soundboard: Float64Array;
  /** Soundboard biquad coefficients [b0,b1,b2,a1,a2] per section. */
  soundboardCoefficients: Float64Array;
  idle: boolean;
  zeroSamples: number;
  wokeThisBlock: boolean;
  lastBlockPeak: number;
};

const MIN_HZ = 20;
const MAX_HZ = 8000;
/** Damper fall time. A piano damper is felt on a moving string, not a mute. */
const DAMP_SEC = 0.12;
const MAX_DISPERSION_SECTIONS = 4;
const MIN_DISPERSION_POLE = -0.95;
/** Samples `stepLine` adds by writing one slot past where it read. */
const READ_WRITE_OFFSET = 1;
const MAX_STRINGS = 3;
/** Leaky integrator turning bridge velocity into force; gain-normalised. */
const INTEGRATOR_POLE = 0.999;
/** Normalised to unity gain at 1 kHz / 48 kHz. */
const INTEGRATOR_REFERENCE_OMEGA = (2 * Math.PI * 1000) / 48000;

/** The integrator numerator g, solved for unity gain at the 1 kHz reference.
 *  `1 - INTEGRATOR_POLE` would be 0.001 — a 60 dB cut, not a gain. */
function integratorNumerator(sampleRate: number): number {
  const omega = (INTEGRATOR_REFERENCE_OMEGA * 48000) / sampleRate;
  return Math.hypot(
    1 - INTEGRATOR_POLE * Math.cos(omega),
    INTEGRATOR_POLE * Math.sin(omega),
  );
}

/**
 * |I(e^{jw})| at `hz` — unity at 1 kHz, rising 6 dB per octave BELOW it.
 *
 * I(z) is an integrator, so its magnitude goes as 1/f. That is correct for
 * turning string velocity into bridge force, but it means an identical hammer
 * blow leaves a bass note vastly hotter at the OUTPUT than a treble one.
 * Measured on one note at velocity 0.7, before compensation:
 *
 *   65.4 Hz peak 6.286   130.8 Hz 3.599   261.6 Hz 1.931   523.3 Hz 0.955
 *
 * — a 2x drop per octave, matching this function to within 10 %, and a low C
 * clipping 16 dB past full scale on its own before any polyphony. Dividing
 * those peaks by this magnitude flattens them to 0.41 / 0.47 / 0.51 / 0.50.
 */
function integratorMagnitude(hz: number, sampleRate: number): number {
  const omega = (2 * Math.PI * clamp(hz, MIN_HZ, MAX_HZ)) / sampleRate;
  return (
    integratorNumerator(sampleRate) /
    Math.hypot(
      1 - INTEGRATOR_POLE * Math.cos(omega),
      INTEGRATOR_POLE * Math.sin(omega),
    )
  );
}
/** Extra settled samples on top of the loop's read-back distance. */
const IDLE_MARGIN_SAMPLES = 8;
const FLUSH_ARM_LEVEL = 1e-8;

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function flush(value: number): number {
  return value > -1e-30 && value < 1e-30 ? 0 : value;
}

function anyGateHigh(gate: ArrayLike<number>): boolean {
  for (let i = 0; i < gate.length; i += 1) {
    if (gate[i] >= 0.5) return true;
  }
  return false;
}

function loopGainForT60(f0: number, t60: number): number {
  if (t60 <= 0) return 0;
  return 10 ** (-3 / (f0 * t60));
}

function loopFilterMagnitude(a: number, omega: number): number {
  return (1 + a) / Math.sqrt(1 + a * a + 2 * a * Math.cos(omega));
}

/** The note the Brightness knob is voiced at. At and below it, the loop
 *  filter `loopPoleForBrightness` names is used exactly as it always was. */
const BRIGHTNESS_REFERENCE_HZ = 261.63;
/** The loop may never reach unity: a lossless loop rings forever and
 *  accumulates any error. */
const MAX_LOOP_GAIN = 0.999999;
/**
 * Hammer pulse: a Gaussian whose width is FIXED IN TIME, so its spectrum is a
 * fixed curve in Hz — the same darkness on every key, as a felt hammer gives.
 * `HAMMER_SIGMA_SEC` is the width at velocity 1 and hardness 0.5; velocity and
 * hardness still scale it, so dynamics keep changing the colour.
 * Calibrated so C4 reproduces the voicing it had before this pulse existed.
 */
const HAMMER_SIGMA_SEC = 0.0002547;
/**
 * Felt stiffness exponent p in F = K x^p. Contact time of a mass on such a
 * spring scales as v^(-(p-1)/(p+1)); measured piano felt has p ~ 2.2-3.5
 * (Hall; Stulov; Giordano), so 2.5 -> exponent -0.43. The previous -0.25
 * amounted to p ~ 1.7, softer than any real hammer, and is part of why
 * velocity barely changed the timbre. `HAMMER_SIGMA_SEC` was re-anchored with
 * it so velocity 0.4 — the piano demo's setting — is unchanged.
 */
const FELT_EXPONENT = 2.5;
/** Pulse gain, calibrated so C4 keeps its level. */
const HAMMER_PULSE_GAIN = 42;
/**
 * How far down its own spectrum a note's FUNDAMENTAL may sit. The strike is
 * normalised at f0, so a treble note far out on the Gaussian's slope would
 * need an enormous gain — and that gain would also lift every non-resonant
 * scrap of the pulse into a thump. Past this point the pulse narrows instead.
 */
const MAX_FUNDAMENTAL_LOSS_DB = 10;
/** 20 log10(e) * 2 pi^2 — |P(f)| of a Gaussian of width s is exp(-2 pi^2 s^2 f^2). */
const GAUSSIAN_DB_PER_S2F2 = 8.685889638 * 2 * Math.PI * Math.PI;

/**
 * The soundboard: a FIXED response in Hz, the one part of a piano's tone that
 * does not move with the note. Fitted against Iowa MIS piano recordings,
 * C2-C7, 2026-09-26.
 *
 * A real bass note's fundamental is WEAKER than its overtones (C2's 2nd
 * partial +13 dB, C3's +16), because a soundboard radiates low frequencies
 * poorly. Without this the bass was all fundamental and the hammer was
 * buried 30 dB under it. 4th-order highpass, 180 Hz: the fit's best, and it
 * moves C4 by under 1 dB.
 *
 * There is deliberately NO lowpass. One at 1300 Hz fitted the treble's
 * spectrum best, but it cuts a treble FUNDAMENTAL (C7 -17 dB, C8 -40) while
 * passing the strike's own burst, so the top octaves became all attack:
 * peak-over-body 35 dB at C7 and 50 at C8, against 16 on the real C7. The
 * treble's darkness comes from the loop instead, which strips a high note's
 * overtones within milliseconds while its fundamental rings on.
 */
const SOUNDBOARD_HIGHPASS_HZ = 180;
/** Butterworth 4th order as two biquads: Q of each section. */
const BUTTERWORTH4_Q = [0.5411961, 1.3065630] as const;

/** The one-pole whose magnitude at `omega` is `magnitude` (DC gain 1).
 *  |H|^2 = m^2 gives (1 - m^2) a^2 + 2 (1 - m^2 cos w) a + (1 - m^2) = 0,
 *  whose roots multiply to 1 — exactly one is inside the unit circle. */
function poleForMagnitude(magnitude: number, omega: number): number {
  if (!(magnitude < 1)) return 0;
  const m2 = magnitude * magnitude;
  const quadratic = 1 - m2;
  const linear = 1 - m2 * Math.cos(omega);
  const discriminant = linear * linear - quadratic * quadratic;
  if (!(quadratic > 0) || !(discriminant >= 0)) return 0;
  return (-linear + Math.sqrt(discriminant)) / quadratic;
}

/**
 * The loop-filter pole for THIS pitch: the Brightness knob's pole, flattened
 * only as far as `Decay s` requires.
 *
 * The filter runs once per period, so above about G4 the fundamental itself
 * sits on its slope, and holding `Decay s` would need a loop gain above 1 —
 * which the safety cap in `loopGainCompensated` silently refused, so a C6
 * decayed in 0.17 s against the 8 s asked for. This flattens the pole just
 * enough that the fundamental can reach `Decay s`.
 *
 * It deliberately does NOT otherwise re-voice the loop by pitch. Two earlier
 * versions did (constant loss per second at 2 kHz, then per harmonic) and
 * both made the treble a transposed tenor. Against the Iowa recordings the
 * treble's overtones die FASTER than the tenor's, which a pole fixed per trip
 * already does; what fixes the keyboard-wide balance is the hammer and the
 * soundboard, both fixed in Hz.
 */
function loopPoleForPitch(
  brightness: number,
  pitch: number,
  t60: number,
  sampleRate: number,
): number {
  const reference = loopPoleForBrightness(brightness);
  const omega0 = (2 * Math.PI * pitch) / sampleRate;
  const reachable = poleForMagnitude(
    loopGainForT60(pitch, t60) / MAX_LOOP_GAIN,
    omega0,
  );
  return clamp(Math.max(reference, reachable), reference, 0);
}

function loopGainCompensated(
  f0: number,
  t60: number,
  a: number,
  omega0: number,
): number {
  const target = loopGainForT60(f0, t60);
  const filter = loopFilterMagnitude(a, omega0);
  if (!(filter > 1e-9)) return 0;
  return Math.min(MAX_LOOP_GAIN, target / filter);
}

function loopPoleForBrightness(brightness: number): number {
  return -0.85 + 0.55 * clamp(brightness, 0, 1);
}

function loopFilterPhaseDelay(a: number, omega: number): number {
  if (omega <= 0) return -a / (1 + a);
  const phase = Math.atan2(a * Math.sin(omega), 1 + a * Math.cos(omega));
  return -phase / omega;
}

function allpassPhaseDelay(a: number, omega: number): number {
  // No early return for a === 0: (0 + z^-1) / (1 + 0) is z^-1, ONE sample,
  // not nothing. Reporting 0 there is what put the top of the keyboard up to
  // six semitones flat (below).
  if (omega <= 0) return (1 - a) / (1 + a);
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const phase = Math.atan2(-(1 - a * a) * sin, (1 + a * a) * cos + 2 * a);
  // -phase / omega, and nothing else. This used to subtract a further sample
  // (`(-phase - omega) / omega`), disagreeing with its own DC branch above.
  // Every dispersion section then under-reported its delay by one sample, the
  // loop ran `sections` samples long, and the string played FLAT — by an
  // amount that grows up the keyboard, because a fixed error in samples is a
  // larger share of a shorter period: with 4 sections, -36 cents at C4 and
  // -143 at C6. `dispersionCoefficient` only uses differences of this
  // function, so the inharmonicity it designs is unchanged.
  return -phase / omega;
}

/**
 * Dispersion coefficient for a target inharmonicity, solved so partial 8
 * lands on 8·f0·√(1+64B). The pole is NEGATIVE: only a < 0 gives a phase
 * delay that FALLS with frequency, which is what sends upper partials sharp.
 * Saturates at MIN_DISPERSION_POLE — a cascade of first-order sections cannot
 * deliver an arbitrary delay drop — so the caller must accept a smaller B
 * than asked for at the very bottom of the keyboard.
 */
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
  const wanted = (sampleRate / f0) * (1 - 1 / Math.sqrt(1 + stiffness * k * k));
  const dropAt = (pole: number): number =>
    sections * (allpassPhaseDelay(pole, omega0) - allpassPhaseDelay(pole, omegaK));
  if (dropAt(MIN_DISPERSION_POLE) <= wanted) return MIN_DISPERSION_POLE;
  let low = MIN_DISPERSION_POLE;
  let high = 0;
  for (let i = 0; i < 50; i += 1) {
    const mid = 0.5 * (low + high);
    if (dropAt(mid) < wanted) high = mid;
    else low = mid;
  }
  return 0.5 * (low + high);
}

/** 5-tap Lagrange interpolator centred so the read sits at D ∈ [2,3). */
function lagrange5(delay: number, out: Float64Array): void {
  for (let n = 0; n < 5; n += 1) {
    let coefficient = 1;
    for (let k = 0; k < 5; k += 1) {
      if (k === n) continue;
      coefficient *= (delay - k) / (n - k);
    }
    out[n] = coefficient;
  }
}

/**
 * The Gaussian hammer pulse's width (standard deviation), in seconds.
 *
 * FIXED IN TIME across the keyboard, so the strike's spectrum is one curve in
 * Hz — plan B's "brightness band pinned in absolute frequency". Every earlier
 * law scaled contact with pitch (sqrt, then with the period), which made each
 * note a transposed C4: a bass strike with almost no overtones and a buried
 * hammer, a treble strike as bright as the tenor. A real piano's bass is rich
 * and its top octave nearly pure; a fixed band in Hz is what does that.
 *
 * Velocity and hardness still scale it: a softer or felt-ier blow is a wider
 * pulse and a darker note, not merely a quieter one.
 *
 * The only pitch dependence is the cap: a fundamental may not sit more than
 * MAX_FUNDAMENTAL_LOSS_DB down the pulse's spectrum, so at the very top the
 * pulse narrows rather than demanding an enormous normalising gain.
 */
function hammerWidthSec(f0: number, velocity: number, hardness: number): number {
  const velocityTerm =
    clamp(velocity, 0.02, 1) ** (-(FELT_EXPONENT - 1) / (FELT_EXPONENT + 1));
  const hardnessTerm = 1.35 - 0.7 * clamp(hardness, 0, 1);
  const width = HAMMER_SIGMA_SEC * velocityTerm * hardnessTerm;
  const pitch = clamp(f0, MIN_HZ, MAX_HZ);
  const cap = Math.sqrt(
    MAX_FUNDAMENTAL_LOSS_DB / (GAUSSIAN_DB_PER_S2F2 * pitch * pitch),
  );
  return Math.min(width, cap);
}

/**
 * Level law: dB added to each strike so every key lands at the same
 * LOUDNESS, measured the way loudness is standardised for program material
 * (ITU-R BS.1770 K-weighting, the basis of LUFS), anchored at C4.
 *
 * One value every 3 semitones from C1 (index 0) to D#8, smoothed over +/-3
 * semitones, measured on the finished voice at velocity 0.4 with the demo's
 * settings. Without it loudness ran -24 dB at C1, +7 at C6 and +20 at C8 —
 * 44 dB, most of what "the lower the note the fainter, the higher the
 * sharper" was describing. The strike is normalised at the fundamental, but
 * the soundboard removes the bass fundamental and the treble carries its
 * energy where hearing is most sensitive; neither is visible to a
 * fundamental-only normaliser. Other Brightness / Hardness settings shift
 * these values a little; they are a law for the voicing, not for every knob.
 */
const LEVEL_LAW_FIRST_SEMITONE = -36;
const LEVEL_LAW_STEP_SEMITONES = 3;
const LEVEL_LAW_DB = [
  22.41, 20.82, 17.84, 15.18, 12.88, 10.88,
  9.13, 7.75, 6.65, 5.31, 3.39, 1.47,
  -0.00, -1.27, -2.51, -3.71, -4.92, -5.84,
  -6.65, -6.93, -6.90, -6.75, -6.86, -7.54,
  -8.83, -11.64, -16.40, -21.69, -22.53, -20.93,
] as const;

function levelLawGain(f0: number): number {
  const semitone = 12 * Math.log2(clamp(f0, MIN_HZ, MAX_HZ) / BRIGHTNESS_REFERENCE_HZ);
  const position =
    (semitone - LEVEL_LAW_FIRST_SEMITONE) / LEVEL_LAW_STEP_SEMITONES;
  const last = LEVEL_LAW_DB.length - 1;
  const clamped = clamp(position, 0, last);
  const index = Math.min(last - 1, Math.floor(clamped));
  const fraction = clamped - index;
  const db =
    LEVEL_LAW_DB[index] + (LEVEL_LAW_DB[index + 1] - LEVEL_LAW_DB[index]) * fraction;
  return 10 ** (db / 20);
}

/** The pulse's effective contact duration — its equal-area rectangle,
 *  sigma * sqrt(2 pi). Kept for the tests and for comparison with the
 *  measured contact times in the literature (~1-4 ms). */
function hammerContactSec(
  f0: number,
  velocity: number,
  hardness: number,
): number {
  return hammerWidthSec(f0, velocity, hardness) * Math.sqrt(2 * Math.PI);
}

function createLine(bufferSize: number, sections: number): StringLineState {
  return {
    buffer: new Float32Array(bufferSize),
    writeIndex: 0,
    loopY1: 0,
    apX: new Float64Array(sections),
    apY: new Float64Array(sections),
    lagrange: new Float64Array(5),
  };
}

/** RBJ biquads: a 4th-order Butterworth highpass as two sections, packed
 *  as [b0,b1,b2,a1,a2] x 2. */
function soundboardCoefficients(sampleRate: number): Float64Array {
  const out = new Float64Array(10);
  let slot = 0;
  const design = (hz: number, q: number) => {
    const w = (2 * Math.PI * Math.min(hz, 0.45 * sampleRate)) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    const b1 = -(1 + cos);
    const b0 = (1 + cos) / 2;
    out[slot] = b0 / a0;
    out[slot + 1] = b1 / a0;
    out[slot + 2] = b0 / a0;
    out[slot + 3] = (-2 * cos) / a0;
    out[slot + 4] = (1 - alpha) / a0;
    slot += 5;
  };
  for (const q of BUTTERWORTH4_Q) design(SOUNDBOARD_HIGHPASS_HZ, q);
  return out;
}

function createStruckStringState(sampleRate: number): StruckStringState {
  const bufferSize = 4096;
  const lines: StringLineState[] = [];
  for (let i = 0; i < MAX_STRINGS; i += 1) {
    lines.push(createLine(bufferSize, MAX_DISPERSION_SECTIONS));
  }
  return {
    sampleRate,
    bufferSize,
    bufferMask: bufferSize - 1,
    lines,
    excitation: new Float32Array(Math.ceil(sampleRate * 0.05)),
    excitationLength: 0,
    excitationPos: 0,
    lineGain: new Float64Array(MAX_STRINGS),
    lastGate: null,
    damping: false,
    dampGain: 1,
    integratorY1: 0,
    soundboard: new Float64Array(8),
    soundboardCoefficients: soundboardCoefficients(sampleRate),
    // LOAD-BEARING `false`. `lastGate` is only ever written inside the render
    // loop, and the idle fast path returns BEFORE that loop. Starting idle
    // would make the first all-low block return early with `lastGate` still
    // null, so the following rising edge would be recorded rather than played
    // and the very first strike would be swallowed.
    idle: false,
    zeroSamples: 0,
    wokeThisBlock: false,
    lastBlockPeak: 0,
  };
}

function resetStruckString(state: StruckStringState): void {
  for (const line of state.lines) {
    line.buffer.fill(0);
    line.writeIndex = 0;
    line.loopY1 = 0;
    line.apX.fill(0);
    line.apY.fill(0);
  }
  state.excitationLength = 0;
  state.excitationPos = 0;
  state.lineGain.fill(0);
  // `lastGate` is deliberately NOT cleared: clearing it would send the next
  // block down the `lastGate === null` branch, which RECORDS an edge instead
  // of playing it — swallowing a strike the player actually made.
  state.damping = false;
  state.dampGain = 1;
  state.integratorY1 = 0;
  state.soundboard.fill(0);
  state.idle = false;
  state.zeroSamples = 0;
  state.lastBlockPeak = 0;
}

/**
 * Render one strike into the excitation buffer: a Gaussian force pulse of the
 * velocity-dependent width, through the strike-position comb.
 *
 * Normalised at the FUNDAMENTAL: divided by both the output integrator's
 * magnitude there and the pulse's own spectrum there, so every key's
 * fundamental lands at a comparable level and only the overtones — which the
 * fixed pulse and soundboard shape — differ from key to key.
 *
 * A Gaussian, not the raised cosine it replaced: a raised cosine has hard
 * spectral nulls, and with its width fixed in time those nulls swept across
 * the treble's fundamentals note by note — measured, the fundamental jumped
 * 11.7 -> 23.1 dB from B5 to C6 and 5.7 -> 17.1 from F#6 to G6. A Gaussian's
 * spectrum falls smoothly, so neighbouring keys stay neighbours.
 */
function renderStrike(
  state: StruckStringState,
  params: StruckStringParams,
  f0: number,
  velocity: number,
): void {
  const { sampleRate } = state;
  const hit = clamp(velocity, 0, 4);
  const width = hammerWidthSec(f0, Math.min(1, hit), params.hardness);
  const widthSamples = Math.max(0.5, width * sampleRate);
  const half = Math.ceil(4 * widthSamples);
  const pulseLength = 2 * half + 1;

  const fundamentalLoss = Math.exp(
    -2 * Math.PI * Math.PI * width * width * f0 * f0,
  );
  const level =
    (HAMMER_PULSE_GAIN * hit * levelLawGain(f0)) /
    (integratorMagnitude(f0, sampleRate) * fundamentalLoss);

  // Comb delay: the strike point reflects, arriving beta*L later.
  const beta = clamp(params.positionBeta, 0.02, 0.5);
  const combDelay = Math.max(1, Math.round((beta * sampleRate) / f0));

  const total = Math.min(state.excitation.length, pulseLength + combDelay + 2);
  state.excitation.fill(0, 0, total);
  // Unit-area pulse, so the gain above means the same thing at any width.
  const area = widthSamples * Math.sqrt(2 * Math.PI);
  for (let n = 0; n < pulseLength; n += 1) {
    const x = (n - half) / widthSamples;
    const scaled = (Math.exp(-0.5 * x * x) / area) * level;
    if (n < total) state.excitation[n] += scaled;
    // P(z) = 1 - z^(-Dp): the inverted reflection from the strike point.
    const combIndex = n + combDelay;
    if (combIndex < total) state.excitation[combIndex] -= scaled;
  }
  state.excitationLength = total;
  state.excitationPos = 0;
}

type LineCoefficients = {
  integerDelay: number;
  lagrange: Float64Array;
  loopGain: number;
  loopPole: number;
  dispersionPole: number;
  dispersionSections: number;
};

function computeLineCoefficients(
  state: StruckStringState,
  params: StruckStringParams,
  f0: number,
  index: number,
  count: number,
): LineCoefficients {
  const { sampleRate } = state;
  const line = state.lines[index];

  // Unison spread, symmetric about the nominal pitch. With `count` strings the
  // offsets run from −half to +half of `unisonCents`.
  const spread = count > 1 ? index / (count - 1) - 0.5 : 0;
  const cents = spread * clamp(params.unisonCents, 0, 60);
  const pitch = clamp(f0 * 2 ** (cents / 1200), MIN_HZ, MAX_HZ);
  const omega0 = (2 * Math.PI * pitch) / sampleRate;

  const loopPole = loopPoleForPitch(
    params.brightness,
    pitch,
    Math.max(0.02, params.decaySec),
    sampleRate,
  );
  const baseGain = loopGainCompensated(
    pitch,
    Math.max(0.02, params.decaySec),
    loopPole,
    omega0,
  );
  // THE TWO-STAGE DECAY. Bridge-coupled unison strings do not share a decay
  // rate: the in-phase mode drives the bridge and dies fast, the out-of-phase
  // modes barely move it and ring on. Giving the outer strings a slower loop
  // (a gain raised to a power < 1 is closer to unity) reproduces the prompt-
  // sound / aftersound split without simulating the bridge admittance itself.
  const exponent = count > 1 ? 1 - 0.45 * Math.abs(spread) * 2 : 1;
  const loopGain = baseGain ** exponent;

  const totalDelay = sampleRate / pitch;
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
    if (dispersionPole === 0) {
      // Nothing to disperse: from about G7 up, the 8th partial the design
      // targets is past Nyquist and `dispersionCoefficient` returns 0. Four
      // sections at pole 0 are then four bare unit delays that were counted
      // as zero delay — the note played 402 cents flat at G7, 518 at C8 and
      // 601 at D#8, all reachable with the octave shift. Drop them.
      sections = 0;
      apDelay = 0;
      break;
    }
    apDelay = sections * allpassPhaseDelay(dispersionPole, omega0);
    if (apDelay <= 0.25 * totalDelay) break;
    sections -= 1;
    dispersionPole = 0;
    apDelay = 0;
  }

  const filterDelay = loopFilterPhaseDelay(loopPole, omega0);
  // `stepLine` reads at `writeIndex - integerDelay` and then writes one slot
  // AHEAD, so every loop carries one sample the line delay must give back.
  // Unaccounted, it made every note flat by one sample of period: -10 cents
  // at C4, -38 at C6, even with stiffness off.
  let lineDelay = totalDelay - filterDelay - apDelay - READ_WRITE_OFFSET;
  lineDelay = clamp(lineDelay, 6, state.bufferSize - 8);

  const integerDelay = Math.floor(lineDelay) - 2;
  const frac = lineDelay - integerDelay - 2;
  lagrange5(2 + frac, line.lagrange);

  return {
    integerDelay,
    lagrange: line.lagrange,
    loopGain,
    loopPole,
    dispersionPole,
    dispersionSections: sections,
  };
}

function stepLine(
  line: StringLineState,
  coefficients: LineCoefficients,
  drive: number,
  mask: number,
  dampGain: number,
  flushing: boolean,
): number {
  const { buffer } = line;
  const read = (line.writeIndex - coefficients.integerDelay) & mask;
  const l = coefficients.lagrange;
  let sample =
    l[0] * buffer[read & mask] +
    l[1] * buffer[(read - 1) & mask] +
    l[2] * buffer[(read - 2) & mask] +
    l[3] * buffer[(read - 3) & mask] +
    l[4] * buffer[(read - 4) & mask];

  // Loop filter Hl(z) = g(1+a)/(1+a z⁻¹).
  const a = coefficients.loopPole;
  const filtered =
    coefficients.loopGain * (1 + a) * sample - a * line.loopY1;
  line.loopY1 = flushing ? flush(filtered) : filtered;
  sample = line.loopY1;

  // Allpass cascade: stiffness dispersion.
  const pole = coefficients.dispersionPole;
  for (let s = 0; s < coefficients.dispersionSections; s += 1) {
    const x = sample;
    const y = pole * x + line.apX[s] - pole * line.apY[s];
    line.apX[s] = x;
    line.apY[s] = flushing ? flush(y) : y;
    sample = line.apY[s];
  }

  const written = (sample + drive) * dampGain;
  line.writeIndex = (line.writeIndex + 1) & mask;
  buffer[line.writeIndex] = flushing ? flush(written) : written;
  return sample;
}

/**
 * Render one block. `hz`, `velocity` and `gate` may each be length 1
 * (constant for the quantum) or the same length as `out`. Returns false if
 * the watchdog had to reset the string.
 */
function processStruckStringBlock(
  state: StruckStringState,
  params: StruckStringParams,
  hz: ArrayLike<number>,
  velocity: ArrayLike<number>,
  gate: ArrayLike<number>,
  out: Float32Array,
  sampleRate: number,
): boolean {
  if (state.sampleRate !== sampleRate) {
    state.soundboardCoefficients = soundboardCoefficients(sampleRate);
  }
  state.sampleRate = sampleRate;
  const frames = out.length;
  const hzConstant = hz.length === 1;
  const velocityConstant = velocity.length === 1;
  const gateConstant = gate.length === 1;

  state.wokeThisBlock = false;
  if (state.idle) {
    if (!anyGateHigh(gate)) {
      out.fill(0);
      return true;
    }
    state.idle = false;
    state.wokeThisBlock = true;
    state.zeroSamples = 0;
  }

  const flushing = state.lastBlockPeak < FLUSH_ARM_LEVEL;
  let blockPeak = 0;

  const octaveScale = 2 ** Math.round(clamp(params.octave, -3, 3));
  const count = clamp(Math.round(params.strings), 1, MAX_STRINGS);
  const firstHz = clamp(hz[0] * octaveScale, MIN_HZ, MAX_HZ);

  const coefficients: LineCoefficients[] = [];
  for (let i = 0; i < count; i += 1) {
    coefficients.push(computeLineCoefficients(state, params, firstHz, i, count));
  }

  const mask = state.bufferMask;
  const dampStep = 1 / Math.max(1, DAMP_SEC * sampleRate);
  // The damper's gain is applied on every trip round the string, so like the
  // loop filter it compounds f0 times a second. Released at the same moment,
  // a C7 was choked to -40 dB in 20 ms and a C2 took 102 ms, halving roughly
  // every octave — "the higher the note, the faster it ends". Raising the
  // per-trip gain to REFERENCE/f0 makes the per-SECOND damping above the
  // reference note equal to the reference's; below it nothing changes.
  const dampExponent =
    firstHz > BRIGHTNESS_REFERENCE_HZ ? BRIGHTNESS_REFERENCE_HZ / firstHz : 1;
  // Equal share, energy-normalised so string count changes loudness only as
  // much as physics says it should (√N, not N).
  const share = 1 / Math.sqrt(count);
  const integratorGain = integratorNumerator(sampleRate);

  for (let i = 0; i < frames; i += 1) {
    const gateValue = (gateConstant ? gate[0] : gate[i]) >= 0.5;
    if (state.lastGate === null) {
      state.lastGate = gateValue;
    } else if (gateValue !== state.lastGate) {
      state.lastGate = gateValue;
      if (gateValue) {
        const level = velocityConstant ? velocity[0] : velocity[i];
        const pitch = clamp(
          (hzConstant ? hz[0] : hz[i]) * octaveScale,
          MIN_HZ,
          MAX_HZ,
        );
        renderStrike(state, params, pitch, level);
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

    const damperGain =
      state.damping && dampExponent !== 1
        ? state.dampGain ** dampExponent
        : state.dampGain;

    let bridge = 0;
    for (let s = 0; s < count; s += 1) {
      bridge += stepLine(
        state.lines[s],
        coefficients[s],
        drive * share,
        mask,
        damperGain,
        flushing,
      );
    }

    const integrated =
      integratorGain * bridge * share + INTEGRATOR_POLE * state.integratorY1;
    state.integratorY1 = flushing ? flush(integrated) : integrated;

    // The soundboard: fixed in Hz, the same for every key.
    let voiced = state.integratorY1;
    const board = state.soundboard;
    const k = state.soundboardCoefficients;
    let boardSilent = true;
    for (let section = 0; section < 2; section += 1) {
      const m = section * 4;
      const c = section * 5;
      const y =
        k[c] * voiced +
        k[c + 1] * board[m] +
        k[c + 2] * board[m + 1] -
        k[c + 3] * board[m + 2] -
        k[c + 4] * board[m + 3];
      board[m + 1] = board[m];
      board[m] = voiced;
      board[m + 3] = board[m + 2];
      board[m + 2] = flushing ? flush(y) : y;
      voiced = board[m + 2];
      if (
        board[m] !== 0 ||
        board[m + 1] !== 0 ||
        board[m + 2] !== 0 ||
        board[m + 3] !== 0
      ) {
        boardSilent = false;
      }
    }
    out[i] = voiced;
    const magnitude = voiced < 0 ? -voiced : voiced;
    if (magnitude > blockPeak) blockPeak = magnitude;

    let allZero = state.integratorY1 === 0 && boardSilent;
    if (allZero) {
      for (let s = 0; s < count; s += 1) {
        if (state.lines[s].loopY1 !== 0) {
          allZero = false;
          break;
        }
      }
    }
    state.zeroSamples =
      !gateValue && allZero && state.excitationPos >= state.excitationLength
        ? state.zeroSamples + 1
        : 0;
  }

  state.lastBlockPeak = blockPeak;

  const last = out[frames - 1];
  if (!Number.isFinite(last)) {
    resetStruckString(state);
    out.fill(0);
    return false;
  }

  // Idle only once the settle run exceeds the loop's read-back distance, so
  // every readable slot was written as exact zero. The allpass cascade adds
  // its own group delay on top of the longest line.
  let longestDelay = 0;
  for (const coefficient of coefficients) {
    if (coefficient.integerDelay > longestDelay) {
      longestDelay = coefficient.integerDelay;
    }
  }
  if (
    !state.wokeThisBlock &&
    state.zeroSamples >=
      longestDelay + MAX_DISPERSION_SECTIONS + IDLE_MARGIN_SAMPLES
  ) {
    // Sets a FLAG and writes no state. Calling `resetStruckString` here would
    // be wrong twice over: it clears buffers the idle fast path already proved
    // are all zero, and it flips `idle` back to false.
    state.idle = true;
  }
  return true;
}

export {
  createStruckStringState,
  processStruckStringBlock,
  resetStruckString,
  hammerContactSec,
  loopGainForT60,
  loopPoleForBrightness,
};
export type { StruckStringParams, StruckStringState };

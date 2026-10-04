/**
 * bowedStringCore — a two-segment digital-waveguide bowed string with THREE
 * interchangeable friction models.
 *
 * PURE and dependency-free by contract (same rule as envelopeCore): no
 * imports, no Tone, no DOM, `sampleRate` is a PARAMETER.
 *
 * Structure (Woodhouse 2014 §2.2; Woodhouse 2003 §2.3). Two delay lines carry
 * VELOCITY waves; the bow sits between them at β of the string length from
 * the bridge:
 *
 *      (−1)                        BOW                     bridge (loss, −1)
 *  nut ◄──── neck delay (1−β)L ─────┬───── bridge delay βL ─────► out
 *      ─────────────────────────►   │   ◄──────────────────────
 *                              ┌────┴─────┐
 *      v_h = r_bridge + r_nut ─┤ friction ├─ f, v satisfying BOTH:
 *                              └────┬─────┘   (4) v = v_h + f/(2·Z₀)
 *                                   │         (5) f = µ·N·sign(v_b − v) slipping
 *                                   │             v = v_b, |f| ≤ µ·N  sticking
 *      to_bridge = r_nut + f/(2Z₀),  to_nut = r_bridge + f/(2Z₀)
 *      out = to_bridge   (the outgoing wave ∝ transverse bridge force)
 *
 * THE THREE MODELS
 *   'bowTable'      Synthesis ToolKit's explicit table. Cheapest, single-
 *                   valued, no hysteresis, no flattening.
 *   'frictionCurve' Smith & Woodhouse (2000) eq. (2), the MEASURED
 *                   steady-sliding curve, resolved by the Friedlander
 *                   construction with hysteresis (stay on your branch until
 *                   it vanishes) — this is what produces the flattening
 *                   effect.
 *   'thermal'       Woodhouse (2003). Friction depends on CONTACT
 *                   TEMPERATURE, not sliding speed. More "benign": Helmholtz
 *                   motion establishes far more reliably.
 *
 * PINNED SEMANTICS (each learned the hard way from a prototype that failed)
 * - The thermal heat balance MUST include convection. Woodhouse eq. (1)
 *   balances heat input against conduction, convection (cold rosin sweeping
 *   through the contact) AND storage. With conduction alone the contact runs
 *   to ~110 °C, µ pins at its 0.35 floor and the string NEVER STICKS — no
 *   stick-slip, no Helmholtz motion, no violin. With convection the measured
 *   stick fraction is 0.85 against the theoretical 1 − β = 0.873, and the
 *   contact temperature sits at 5–32 °C against the paper's reported 17–31 °C.
 * - The thermal state MUST use exact exponential integration. The fastest
 *   fitted pole is 1 µs while dt at ×2 oversampling is 10.4 µs, so explicit
 *   Euler (dt/τ ≈ 10 > 1) diverges immediately.
 * - Oversampling is not optional. Woodhouse 2003 §2.3 reports the required
 *   time step as 5 µs for the friction-curve model and 20 µs for the thermal
 *   model; 48 kHz gives 20.8 µs.
 * - The friction-curve solve is warm-started from the previous sample's
 *   solution. That IS the hysteresis rule: continuity is maintained until the
 *   branch ceases to exist.
 */

type FrictionModel = 'bowTable' | 'frictionCurve' | 'thermal';

type BowedStringParams = {
  /** Bow position as a fraction of string length from the bridge. */
  positionBeta: number;
  /** 0..1 → normal bow force in newtons (× MAX_FORCE_N). */
  force: number;
  /**
   * Transverse wave impedance of the string, Ns/m. `0` (or anything not
   * positive) means DERIVE IT FROM THE PITCH BEING PLAYED, per block, by the
   * equal-tension law — which is what every real patch wants, since the Hz
   * input is a live signal there.
   */
  impedance: number;
  frictionModel: FrictionModel;
  /** Bow-speed ramp on gate ↑, seconds (Guettler: acceleration from rest). */
  attackSec: number;
  /** Bow-lift ramp on gate ↓, seconds. */
  releaseSec: number;
  vibratoRateHz: number;
  vibratoCents: number;
  /** 0..1 — finite-bow-width differential slipping, heard as bow noise. */
  noise: number;
};

type BowedStringState = {
  sampleRate: number;
  bridgeLine: Float32Array;
  nutLine: Float32Array;
  writeIndex: number;
  size: number;
  mask: number;
  /** Bridge reflection filter memory. */
  bridgeY1: number;
  /** Bow velocity ramp state. */
  bowVelocity: number;
  lastGate: boolean | null;
  /** Previous slip solution — the warm start that carries hysteresis. */
  lastU: number;
  /** Thermal model: one state per fitted exponential of the √t kernel. */
  heat: Float64Array;
  /**
   * Per-block thermal coefficients, allocated ONCE.
   *
   * These were `new Float64Array(12)` twice per block, unconditionally — even
   * for the non-thermal models that never read them. On the AUDIO THREAD that
   * is ~12 000 allocations/s for a 16-voice violin, and a released violin never
   * idles, so the churn never stops. Garbage on the render thread buys periodic
   * GC pauses, and a pause past the 2.67 ms quantum deadline is an underrun.
   */
  heatDecay: Float64Array;
  heatGain: Float64Array;
  vibratoPhase: number;
  noiseState: number;
  noiseSeed: number;
  /** Oversampled output history feeding the decimation FIR. */
  decimation: Float64Array;
  decimationIndex: number;
  /** Diagnostics for the oracles: is the bow sticking this sample? */
  sticking: boolean;
  /** Contact temperature in °C above ambient (thermal model only). */
  temperature: number;
  /**
   * Stick/slip census over the oversampled samples. The regime of a bowed
   * string is DEFINED by these, so classifying from them is exact where
   * classifying from the waveform (Woodhouse 2003's Appendix, which must work
   * on measured data) can mistake Schelleng ripples for extra slips.
   */
  stickSamples: number;
  slipSamples: number;
  slipOnsets: number;
};

const MIN_HZ = 20;
const MAX_HZ = 8000;
/** Force knob 1.0 → this many newtons on the REFERENCE string. */
const MAX_FORCE_N = 1.5;

/**
 * The impedance the Force knob is calibrated against — the violin G string
 * (Woodhouse 2014 §5.1: 0.363 Ns/m at 196 Hz).
 */
const REFERENCE_IMPEDANCE = 0.363;
/** The pitch that reference string plays open — a violin G3. */
const REFERENCE_HZ = 196;

/**
 * String impedance for a pitch, by the equal-tension law: a set of strings
 * designed at roughly equal tension has Z = T / (2 L f0), so Z is proportional
 * to 1 / f0. Anchored on Woodhouse's published G-string value.
 *
 * WHY THIS LIVES IN THE CORE AND RUNS PER BLOCK. The same law used to be
 * applied ONCE, at node construction, from the `Hz` knob's static value — and
 * the moment `Hz` was driven by anything (the keyboard bus, a timeline lane,
 * i.e. every real patch), that knob was undefined and the impedance fell back
 * to the G3 reference for the life of the node. The Schelleng force scaling
 * built on it (see `scaledNormalForce`) was therefore INERT in every played
 * patch, including the shipped violin group. A D6 at G3's force sits far past
 * Schelleng's maximum for that pitch, and an over-pressed bow is the raucous,
 * buzzing "bagpipe" tone the ear test reported twice. Found by the 2026-09-12
 * implementation review (INT-F3); the fix is to derive from the pitch the
 * block is actually playing.
 */
function impedanceForPitch(hz: number): number {
  if (!(hz > 0)) return REFERENCE_IMPEDANCE;
  return clamp((REFERENCE_IMPEDANCE * REFERENCE_HZ) / hz, 0.05, 1);
}

/**
 * Schelleng's playable force window scales with the string's wave impedance:
 * both the minimum force (∝ Z₀·v_b/β²) and the maximum (∝ Z₀·v_b/β) are
 * proportional to Z₀. With the equal-tension law Z₀ ∝ 1/f, so a FIXED normal
 * force walks straight out of the window as the player goes up the
 * fingerboard.
 *
 * Measured before this scaling, sweeping 196 → 784 Hz at each model's own
 * default force: `frictionCurve` fell SILENT above 440 Hz (the string stuck
 * permanently), `thermal` collapsed into double and multiple slipping above
 * 330 Hz, and `bowTable` lost Helmholtz motion at the top. That is what a
 * listener hears as "jittery and muffled" on some keys and not others.
 *
 * Scaling the force with Z₀ keeps the bow at the same RELATIVE position in
 * the Schelleng triangle at every pitch — which is also what a real player
 * does, pressing harder on the lower, heavier strings.
 */
function scaledNormalForce(force: number, impedance: number): number {
  return force * MAX_FORCE_N * (impedance / REFERENCE_IMPEDANCE);
}

/**
 * A bow GESTURE, not just a bow speed.
 *
 * A violinist does not change loudness by moving the bow faster alone: soft
 * playing is a slow, light bow near the fingerboard (flautando — hollow and
 * flutey), and loud playing is a fast, heavy bow near the bridge (ponticello
 * — bright and shrill). Woodhouse 2014 §5.1: "a brighter tone containing more
 * high-frequency content can be produced by bowing closer to the bridge and
 * consequently pressing harder", because bow force sharpens the Helmholtz
 * corner (Cremer) and β sets the ripple pattern.
 *
 * Driving all three from the one expression input is what gives the
 * instrument a range instead of a single fixed timbre — the difference
 * between a violin and a drone. `Amp` is the Phase C contract's expression
 * input, so it is the natural carrier.
 *
 * The spans are deliberately conservative: Schelleng's playable window
 * NARROWS towards the bridge, so pushing β too low would trade tone for
 * scratchiness. Verified across Amp × pitch that Helmholtz motion holds.
 */
const GESTURE_BETA_SOFT = 0.145;
const GESTURE_BETA_LOUD = 0.115;
const GESTURE_FORCE_SOFT = 0.85;
const GESTURE_FORCE_LOUD = 1.2;

function gestureBeta(baseBeta: number, expression: number): number {
  const e = expression < 0 ? 0 : expression > 1 ? 1 : expression;
  // Scale the soft/loud span around whatever the Position knob is set to.
  const span = GESTURE_BETA_SOFT + (GESTURE_BETA_LOUD - GESTURE_BETA_SOFT) * e;
  return baseBeta * (span / 0.127);
}

function gestureForce(baseForce: number, expression: number): number {
  const e = expression < 0 ? 0 : expression > 1 ? 1 : expression;
  return (
    baseForce * (GESTURE_FORCE_SOFT + (GESTURE_FORCE_LOUD - GESTURE_FORCE_SOFT) * e)
  );
}

// ── Smith & Woodhouse (2000) eq. (2): the measured steady-sliding curve ──
// µ(V) = 0.4·exp(−V/0.01) + 0.45·exp(−V/0.1) + 0.35   (V in m/s)
const MU_A = 0.4;
const MU_A_SCALE = 0.01;
const MU_B = 0.45;
const MU_B_SCALE = 0.1;
const MU_FLOOR = 0.35;
/** µ at zero sliding speed = 1.20, the limit of sticking friction. */
const MU_STATIC = MU_A + MU_B + MU_FLOOR;

/**
 * Tabulated µ(V) and dµ/dV. The curve is FIXED — it depends on no runtime
 * parameter — so the table is built once at module load and costs nothing per
 * sample. (Calling Math.exp three times per solver iteration, at ×4
 * oversampling across 16 voices, would be ~28 M exp/s.)
 */
const MU_TABLE_SIZE = 8192;
const MU_TABLE_MAX = 2.0;
const MU_TABLE_STEP = MU_TABLE_MAX / (MU_TABLE_SIZE - 1);
const MU_VALUES = new Float64Array(MU_TABLE_SIZE);
const MU_SLOPES = new Float64Array(MU_TABLE_SIZE);
for (let i = 0; i < MU_TABLE_SIZE; i += 1) {
  const v = i * MU_TABLE_STEP;
  const fast = MU_A * Math.exp(-v / MU_A_SCALE);
  const slow = MU_B * Math.exp(-v / MU_B_SCALE);
  MU_VALUES[i] = fast + slow + MU_FLOOR;
  MU_SLOPES[i] = -fast / MU_A_SCALE - slow / MU_B_SCALE;
}

/** Interpolated µ(|v|). */
function frictionMu(speed: number): number {
  const v = speed < 0 ? -speed : speed;
  if (v >= MU_TABLE_MAX) return MU_FLOOR;
  const x = v / MU_TABLE_STEP;
  const i = x | 0;
  const frac = x - i;
  return MU_VALUES[i] + (MU_VALUES[i + 1] - MU_VALUES[i]) * frac;
}

/** Interpolated dµ/dV at |v| (always ≤ 0). */
function frictionMuSlope(speed: number): number {
  const v = speed < 0 ? -speed : speed;
  if (v >= MU_TABLE_MAX) return 0;
  const x = v / MU_TABLE_STEP;
  const i = x | 0;
  const frac = x - i;
  return MU_SLOPES[i] + (MU_SLOPES[i + 1] - MU_SLOPES[i]) * frac;
}

// ── Woodhouse (2003) Table I: thermal properties ──
/** Effusivity √(kρc) of string + bow, J/(m²·K·√s). */
const EFFUSIVITY_TOTAL = 2050 + 450;
/**
 * Contact radius at 1 N normal load. Area ∝ force, so force CANCELS in q.
 *
 * Woodhouse 2003 uses 250 µm, but with an explicit caveat: it is an informed
 * guess for a rosin-coated PERSPEX ROD bowing a string, and "some of these
 * values are quite uncertain". A real bow is many fine hair contacts rather
 * than one rod-sized patch, so a smaller effective radius is the more
 * faithful choice — and it matters audibly, because the thermal lag relative
 * to the period is what rounds the Helmholtz corner and sets the brightness.
 *
 * Measured at force 0.2 across 196–784 Hz (harmonic tilt in dB/octave; the
 * real violin measures −1.1 at G3 and −8.8 at A4):
 *   250 µm   −4.8  −13.8  −21.3  −23.1    Helmholtz throughout
 *   150 µm   −3.7   −9.0  −19.0  −23.4    Helmholtz throughout   ← shipped
 *    90 µm   −5.8   −9.8  −18.6  −23.2    Helmholtz throughout
 *    60 µm   −9.4  −15.7  −21.8  −51.8    BREAKS DOWN — 60 °C, no Helmholtz
 */
const CONTACT_RADIUS = 150e-6;
const CONTACT_AREA = Math.PI * CONTACT_RADIUS * CONTACT_RADIUS;
/** µ falls ~linearly from its static value to its floor by +40 °C (fig. 3). */
const THERMAL_KNEE_C = 40;
const THERMAL_SLOPE = (MU_STATIC - MU_FLOOR) / THERMAL_KNEE_C;

/**
 * The half-space conduction kernel 1/√(πt), approximated by a sum of
 * exponentials so it can run as a bank of one-poles. Non-negative
 * least-squares fit over 5 µs–200 ms; max relative error 0.13 %.
 * (Six poles gave 9.2 %, which would have missed the oracle.)
 */
const HEAT_TAUS = new Float64Array([
  1.0e-6, 3.511192e-6, 1.232847e-5, 4.328761e-5, 1.519911e-4, 5.336699e-4,
  1.873817e-3, 6.579332e-3, 2.31013e-2, 8.111308e-2, 2.848036e-1, 1.0,
]);
const HEAT_AMPS = new Float64Array([
  4.002047e2, 2.117044e2, 1.141783e2, 6.068789e1, 3.244343e1, 1.730616e1,
  9.230233, 4.936049, 2.617889, 1.457234, 4.40892e-1, 1.120291,
]);

/** Internal oversampling per friction model (Woodhouse 2003 §2.3). */
function oversamplingFor(model: FrictionModel): number {
  return model === 'thermal' ? 2 : 4;
}

/**
 * Windowed-sinc decimation filter. Dropping every OS-th sample without one
 * would fold the whole band between fs/2 and OS·fs/2 — which a stick-slip
 * nonlinearity fills with energy — straight back into the audio band.
 */
function buildDecimator(oversampling: number): Float64Array {
  const taps = 4 * oversampling + 1;
  const centre = (taps - 1) / 2;
  const cutoff = 0.45 / oversampling; // cycles/sample at the INNER rate
  const coefficients = new Float64Array(taps);
  let sum = 0;
  for (let n = 0; n < taps; n += 1) {
    const x = n - centre;
    const sinc =
      x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (taps - 1)));
    coefficients[n] = sinc * window;
    sum += coefficients[n];
  }
  for (let n = 0; n < taps; n += 1) coefficients[n] /= sum;
  return coefficients;
}

const DECIMATOR_2 = buildDecimator(2);
const DECIMATOR_4 = buildDecimator(4);
/** Ring size for the decimator history (power of two, ≥ the longest FIR). */
const DECIMATION_HISTORY = 32;
const DECIMATION_MASK = DECIMATION_HISTORY - 1;

/* ======================================================================== *
 *  IDLE COST — the denormal guard.
 *
 *  Releasing a key only drops a gate; the processor keeps running until Stop.
 *  As the model decays its state falls below the smallest NORMAL float and
 *  parks SUBNORMAL, where arithmetic leaves the hardware fast path. BOTH
 *  boundaries are crossed here, and the float64 one does the damage:
 *      float32  1.1754943508222875e-38   `bridgeLine` / `nutLine`
 *      float64  2.2250738585072014e-308  `heat` and `decimation` (Float64Array),
 *                                        `bridgeY1`, `lastU`
 *  Measured after release: 7 of 9 `heat` entries subnormal, parked at 9.88e-324.
 *  Cost: 1.39 % of a core sounding, 3.31 % released — 2.4x. Flushing alone
 *  brings released to 1.24 % (0.89x), i.e. cheaper than sounding.
 *
 *  THIS CORE DELIBERATELY HAS NO IDLE SHORT-CIRCUIT. With the bow lifted the
 *  friction solver takes the stick branch every sample, which makes the nut
 *  recirculation unity-gain and NON-INVERTING, so `nutLine` holds a standing
 *  wave indefinitely — measured 0.239 after 30 s of silence while the output
 *  is 5.6e-17, because the output is taken from `toBridge` alone. That state
 *  is real and the next note uses it: clearing it moved the second note by
 *  maxAbsDiff 1.515 and its onset rms by +38 %. So this voice never reaches
 *  the "all state already zero" condition, never idles, and the guard alone
 *  carries it. See `.claude/plans/idle-voice-cpu.md`.
 * ======================================================================== */

/** Flush to EXACT zero below this — above BOTH subnormal boundaries. */
const DENORMAL_FLOOR = 1e-18;

function flush(value: number): number {
  // NaN fails both comparisons and passes through, so the watchdog still sees it.
  return value > -DENORMAL_FLOOR && value < DENORMAL_FLOOR ? 0 : value;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Bridge-reflection targets, from the Iowa violin PIZZICATO recordings: with
 * the bow off the string the loop decays at exactly this rate, so plucked
 * measurements calibrate the bowed model's losses. Measured T60 was 1.5–2.9 s
 * for the fundamental and 0.1–0.4 s from the 4th harmonic up.
 */
const BRIDGE_T60_F0 = 2.2;
const BRIDGE_T60_H4 = 0.45;

/**
 * Solve the bridge one-pole Hb(z) = g(1+a)/(1+a·z⁻¹) for the two measured
 * decay times. `a` is found by matching the RATIO of per-trip gains at f0 and
 * 4·f0, then `g` sets the absolute level.
 *
 * Note the filter runs at the OVERSAMPLED rate, so `innerRate` — not the
 * context rate — is what the frequencies are normalised against.
 */
function bridgeCoefficients(
  f0: number,
  innerRate: number,
  out: { gain: number; pole: number },
): void {
  const gainF0 = 10 ** (-3 / (f0 * BRIDGE_T60_F0));
  const gainH4 = 10 ** (-3 / (4 * f0 * BRIDGE_T60_H4));
  const targetRatio = gainH4 / gainF0;
  const c1 = Math.cos((2 * Math.PI * f0) / innerRate);
  const c4 = Math.cos((2 * Math.PI * 4 * f0) / innerRate);
  const ratioAt = (a: number): number =>
    Math.sqrt(
      (1 + a * a + 2 * a * c1) / Math.max(1e-12, 1 + a * a + 2 * a * c4),
    );
  let low = -0.999;
  let high = 0;
  if (targetRatio >= 1) {
    out.pole = 0;
    out.gain = gainF0;
    return;
  }
  for (let i = 0; i < 60; i += 1) {
    const mid = 0.5 * (low + high);
    if (ratioAt(mid) < targetRatio) low = mid;
    else high = mid;
  }
  const pole = 0.5 * (low + high);
  out.pole = pole;
  out.gain =
    (gainF0 * Math.sqrt(1 + pole * pole + 2 * pole * c1)) / (1 + pole);
}

function createBowedStringState(sampleRate: number): BowedStringState {
  // Sized for the highest oversampling factor at the lowest pitch.
  const needed = Math.ceil((sampleRate * 4) / MIN_HZ) + 8;
  let size = 1;
  while (size < needed) size *= 2;
  return {
    sampleRate,
    bridgeLine: new Float32Array(size),
    nutLine: new Float32Array(size),
    writeIndex: 0,
    size,
    mask: size - 1,
    bridgeY1: 0,
    bowVelocity: 0,
    lastGate: null,
    lastU: 0,
    heat: new Float64Array(HEAT_TAUS.length),
    heatDecay: new Float64Array(HEAT_TAUS.length),
    heatGain: new Float64Array(HEAT_TAUS.length),
    vibratoPhase: 0,
    noiseState: 0,
    noiseSeed: 22222,
    decimation: new Float64Array(DECIMATION_HISTORY),
    decimationIndex: 0,
    sticking: true,
    temperature: 0,
    stickSamples: 0,
    slipSamples: 0,
    slipOnsets: 0,
  };
}

/** Zero the stick/slip census (call before a measurement window). */
function resetBowedStringCensus(state: BowedStringState): void {
  state.stickSamples = 0;
  state.slipSamples = 0;
  state.slipOnsets = 0;
}

function resetBowedString(state: BowedStringState): void {
  state.bridgeLine.fill(0);
  state.nutLine.fill(0);
  state.bridgeY1 = 0;
  state.bowVelocity = 0;
  state.lastU = 0;
  state.heat.fill(0);
  state.decimation.fill(0);
  state.sticking = true;
  state.temperature = 0;
}

/** Linear-interpolated read `delay` samples back. */
function readDelay(
  line: Float32Array,
  writeIndex: number,
  delay: number,
  mask: number,
): number {
  const whole = delay | 0;
  const frac = delay - whole;
  const a = line[(writeIndex - whole) & mask];
  const b = line[(writeIndex - whole - 1) & mask];
  return a + (b - a) * frac;
}

/**
 * Solve  g(u) = 2·Z₀·(u − w) + µ(|u|)·N·sign(u) = 0  for the slipping branch,
 * warm-started from `u0`. The warm start is not an optimisation: it IS the
 * Friedlander hysteresis rule — the solution stays on its branch until that
 * branch stops existing, which is what makes the note play flat as bow force
 * rises.
 */
function solveSlip(
  w: number,
  normalForce: number,
  impedance: number,
  u0: number,
): number {
  const twoZ = 2 * impedance;
  // Every root lies within |f| ≤ µ_static·N of the line, i.e. this bracket.
  const reach = (MU_STATIC * normalForce) / twoZ;
  const low = w - reach;
  const high = w + reach;
  let u = clamp(u0, low, high);
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const sign = u >= 0 ? 1 : -1;
    const g = twoZ * (u - w) + frictionMu(u) * normalForce * sign;
    const derivative = twoZ + normalForce * frictionMuSlope(u);
    if (Math.abs(g) < 1e-12) break;
    // Guard the multivalued region where the derivative passes through zero.
    const step = Math.abs(derivative) > 1e-9 ? g / derivative : g / twoZ;
    const next = clamp(u - step, low, high);
    if (Math.abs(next - u) < 1e-14) {
      u = next;
      break;
    }
    u = next;
  }
  return u;
}

/**
 * Render one block at the context rate. `hz`, `gate` and `amp` may be length
 * 1 (constant across the quantum) or `out.length`.
 *
 * Returns false if the string went non-finite and was reset.
 */
function processBowedStringBlock(
  state: BowedStringState,
  params: BowedStringParams,
  hz: ArrayLike<number>,
  amp: ArrayLike<number>,
  gate: ArrayLike<number>,
  out: Float32Array,
  sampleRate: number,
): boolean {
  state.sampleRate = sampleRate;
  const frames = out.length;
  const model = params.frictionModel;
  const oversampling = oversamplingFor(model);
  const innerRate = sampleRate * oversampling;
  const dt = 1 / innerRate;

  const baseBeta = clamp(params.positionBeta, 0.02, 0.45);
  // Impedance follows the pitch the block is playing unless a knob pins it.
  // `hz[0]` is the pre-vibrato pitch for the block; vibrato is a few cents and
  // is applied below, so it does not belong in the impedance.
  const blockHz = clamp(hz.length === 1 ? hz[0] : hz[0], MIN_HZ, MAX_HZ);
  const impedance =
    params.impedance > 0
      ? clamp(params.impedance, 0.02, 4)
      : impedanceForPitch(blockHz);
  const twoZ = 2 * impedance;
  // The bow GESTURE follows the expression input: soft = slow, light, near
  // the fingerboard; loud = fast, heavy, near the bridge. Read once per
  // block — β and the force both feed coefficients that are not per-sample.
  const expression = clamp(amp.length === 1 ? amp[0] : amp[0], 0, 1);
  const beta = clamp(gestureBeta(baseBeta, expression), 0.02, 0.45);
  const normalForce = scaledNormalForce(
    clamp(gestureForce(params.force, expression), 0, 1.5),
    impedance,
  );
  const noiseAmount = clamp(params.noise, 0, 1);
  const vibratoDepth = 2 ** (clamp(params.vibratoCents, 0, 200) / 1200) - 1;
  const vibratoStep = (2 * Math.PI * Math.max(0, params.vibratoRateHz)) / innerRate;

  // Bridge reflection: a one-pole loss, inverting. Its coefficients come from
  // the measured Iowa pizzicato decays rather than from a Q anchor — a
  // body-free Q of 500 (Woodhouse's cello simulation, which explicitly
  // excludes the instrument body) gives tails 2–13× longer than the
  // recordings.
  const bridge = { gain: 0.999, pole: -0.35 };
  const referencePitch = clamp(hz[0], MIN_HZ, MAX_HZ);
  bridgeCoefficients(referencePitch, innerRate, bridge);
  const bridgeGain = bridge.gain;
  const bridgePole = bridge.pole;
  // The reflection filter sits INSIDE the loop, so its phase delay must come
  // out of the delay lines or the note plays flat — up to 10.6 cents on the
  // E string if it is ignored.
  const referenceOmega = (2 * Math.PI * referencePitch) / innerRate;
  const bridgePhaseDelay =
    referenceOmega > 0
      ? -Math.atan2(
          bridgePole * Math.sin(referenceOmega),
          1 + bridgePole * Math.cos(referenceOmega),
        ) / referenceOmega
      : -bridgePole / (1 + bridgePole);

  const attackStep = 1 / Math.max(1, params.attackSec * innerRate);
  const releaseStep = 1 / Math.max(1, params.releaseSec * innerRate);

  // Thermal precomputation: exact exponential integration coefficients.
  // Reused buffers — see the note on `heatDecay` in the state type.
  const heatDecay = state.heatDecay;
  const heatGain = state.heatGain;
  if (model === 'thermal') {
    for (let i = 0; i < HEAT_TAUS.length; i += 1) {
      const decay = Math.exp(-dt / HEAT_TAUS[i]);
      heatDecay[i] = decay;
      heatGain[i] = HEAT_AMPS[i] * HEAT_TAUS[i] * (1 - decay);
    }
  }

  const { mask } = state;
  const maxDelay = state.size - 4;

  const decimator = oversampling === 2 ? DECIMATOR_2 : DECIMATOR_4;

  for (let i = 0; i < frames; i += 1) {
    // The gate is a LEVEL here (bow on the string), not an edge trigger.
    const gateHigh = (gate.length === 1 ? gate[0] : gate[i]) >= 0.5;
    state.lastGate = gateHigh;

    const level = clamp(amp.length === 1 ? amp[0] : amp[i], 0, 4);
    // STK's bow-speed law; the ramp keeps every start Guettler-legal
    // (acceleration from rest, never a step).
    const targetVelocity = gateHigh ? 0.03 + 0.2 * level : 0;
    const pitch = clamp(hz.length === 1 ? hz[0] : hz[i], MIN_HZ, MAX_HZ);

    for (let k = 0; k < oversampling; k += 1) {
      // Bow velocity ramp.
      if (state.bowVelocity < targetVelocity) {
        state.bowVelocity = Math.min(
          targetVelocity,
          state.bowVelocity + attackStep * (0.03 + 0.2 * level),
        );
      } else if (state.bowVelocity > targetVelocity) {
        state.bowVelocity = Math.max(
          targetVelocity,
          state.bowVelocity - releaseStep * (0.03 + 0.2 * level),
        );
      }

      // Vibrato modulates the sounding length.
      state.vibratoPhase += vibratoStep;
      if (state.vibratoPhase > 2 * Math.PI) state.vibratoPhase -= 2 * Math.PI;
      const vibrato = 1 + vibratoDepth * Math.sin(state.vibratoPhase);
      const loop = clamp(
        innerRate / (pitch * vibrato) - bridgePhaseDelay,
        8,
        maxDelay,
      );
      const bridgeDelay = Math.max(2, beta * loop);
      const nutDelay = Math.max(2, (1 - beta) * loop);

      // Reflections: both terminations invert; the bridge is lossy.
      const bridgeRaw = readDelay(
        state.bridgeLine,
        state.writeIndex,
        bridgeDelay,
        mask,
      );
      state.bridgeY1 = flush(
        bridgeGain * (1 + bridgePole) * bridgeRaw - bridgePole * state.bridgeY1,
      );
      const reflectedBridge = -state.bridgeY1;
      const reflectedNut = -readDelay(
        state.nutLine,
        state.writeIndex,
        nutDelay,
        mask,
      );
      const historyVelocity = reflectedBridge + reflectedNut;

      // Finite bow width → differential slipping at the ribbon edges: part of
      // the contact slips while part still sticks, so the friction force
      // fluctuates DURING SLIP. Modulating the bow SPEED instead (the obvious
      // shortcut) is both the wrong mechanism and far too weak — a 2 % speed
      // wobble yields ~0.003 % noise power, against the 13–33 % measured in
      // real arco notes.
      state.noiseSeed = (state.noiseSeed * 1103515245 + 12345) & 0x7fffffff;
      const white = state.noiseSeed / 0x3fffffff - 1;
      state.noiseState = 0.92 * state.noiseState + 0.08 * white;
      const bowVelocity = state.bowVelocity;

      const w = historyVelocity - bowVelocity;
      const wasSticking = state.sticking;
      let inject = 0;

      if (model === 'bowTable') {
        // Synthesis ToolKit's explicit table (slope = 5 − 4·force).
        const deltaV = -w;
        const slope = 5 - 4 * clamp(params.force, 0, 1);
        let rho = (Math.abs((deltaV + 0.001) * slope) + 0.75) ** -4;
        if (rho > 0.98) rho = 0.98;
        else if (rho < 0.01) rho = 0.01;
        inject = rho * deltaV;
        state.sticking = rho > 0.9;
      } else if (model === 'frictionCurve') {
        const stickForce = -twoZ * w;
        if (Math.abs(stickForce) <= MU_STATIC * normalForce) {
          inject = -w;
          state.lastU = 0;
          state.sticking = true;
        } else {
          const u = solveSlip(w, normalForce, impedance, state.lastU);
          state.lastU = flush(u);
          inject = u - w;
          state.sticking = false;
        }
      } else {
        // Thermal: µ is a function of contact temperature only.
        let temperature = 0;
        for (let h = 0; h < state.heat.length; h += 1) {
          temperature += state.heat[h];
        }
        temperature /= EFFUSIVITY_TOTAL;
        state.temperature = temperature;
        const mu = Math.max(
          MU_FLOOR,
          MU_STATIC - THERMAL_SLOPE * temperature,
        );
        const stickForce = -twoZ * w;
        let force: number;
        let relativeSpeed: number;
        if (Math.abs(stickForce) <= mu * normalForce) {
          force = stickForce;
          relativeSpeed = 0;
          state.sticking = true;
        } else {
          force = mu * normalForce * (w < 0 ? 1 : -1);
          const velocity = historyVelocity + force / twoZ;
          relativeSpeed = Math.abs(bowVelocity - velocity);
          state.sticking = false;
        }
        inject = force / twoZ;
        // Heat balance (Woodhouse 2003 eq. 1). Normal force cancels because
        // the contact area is taken proportional to it.
        const heatFlux = (mu * relativeSpeed) / CONTACT_AREA;
        for (let h = 0; h < state.heat.length; h += 1) {
          state.heat[h] = state.heat[h] * heatDecay[h] + heatGain[h] * heatFlux;
        }
        // Flush the bank ONLY with the bow off — i.e. exactly when it is
        // decaying toward the subnormal range and parking there.
        //
        // This 12-pole loop runs at 2x oversampling and is the hottest code in
        // the repo; flushing unconditionally would add ~1.15 M comparisons per
        // second per voice to the SOUNDING path for no benefit, because while
        // the bow is on the poles are re-driven every sample and never park.
        // `bowVelocity` reaches EXACTLY 0 via `Math.max`, so this test is exact.
        if (state.bowVelocity === 0) {
          for (let h = 0; h < state.heat.length; h += 1) {
            state.heat[h] = flush(state.heat[h]);
          }
        }
        if (relativeSpeed > 1e-9) {
          // Convection: cold rosin sweeps through the contact and carries the
          // heat away. WITHOUT this term the contact runs away to ~110 °C, µ
          // pins at its floor and the string never sticks at all.
          const sweep = Math.exp(
            (-relativeSpeed / (2 * CONTACT_RADIUS)) * dt,
          );
          for (let h = 0; h < state.heat.length; h += 1) {
            state.heat[h] *= sweep;
          }
        }
      }

      if (state.sticking) state.stickSamples += 1;
      else {
        state.slipSamples += 1;
        if (wasSticking) state.slipOnsets += 1;
        // Differential slipping perturbs the friction only while slipping.
        if (noiseAmount > 0) {
          // Scale kept LOW on purpose. Differential slipping should add a
          // breath of roughness, not extra slip events: measured at 196 Hz,
          // a 0.9 scale took the friction-curve model from 1.01 slips per
          // period (textbook Helmholtz) to 4.02, and the thermal model to
          // 1.44. That reads as scratch and a reedy buzz, not bow noise.
          const wobble = 1 + 0.25 * noiseAmount * state.noiseState;
          inject *= wobble < 0.5 ? 0.5 : wobble > 1.5 ? 1.5 : wobble;
        }
      }

      const toBridge = reflectedNut + inject;
      const toNut = reflectedBridge + inject;
      state.bridgeLine[state.writeIndex & mask] = flush(toBridge);
      state.nutLine[state.writeIndex & mask] = flush(toNut);
      state.writeIndex += 1;
      state.decimation[state.decimationIndex & DECIMATION_MASK] = flush(toBridge);
      state.decimationIndex += 1;
    }
    // Anti-alias, then take one sample per group.
    let filtered = 0;
    for (let t = 0; t < decimator.length; t += 1) {
      filtered +=
        decimator[t] *
        state.decimation[(state.decimationIndex - 1 - t) & DECIMATION_MASK];
    }
    out[i] = filtered;
  }

  if (!Number.isFinite(out[frames - 1])) {
    resetBowedString(state);
    out.fill(0);
    return false;
  }
  return true;
}

export {
  createBowedStringState,
  frictionMu,
  frictionMuSlope,
  MAX_FORCE_N,
  MAX_HZ,
  MIN_HZ,
  MU_FLOOR,
  MU_STATIC,
  oversamplingFor,
  processBowedStringBlock,
  REFERENCE_IMPEDANCE,
  impedanceForPitch,
  scaledNormalForce,
  resetBowedString,
  resetBowedStringCensus,
  solveSlip,
  THERMAL_KNEE_C,
};
export type { BowedStringParams, BowedStringState, FrictionModel };

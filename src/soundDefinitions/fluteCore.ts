/**
 * fluteCore — a jet-driven air column (the "closed air simulation" of an
 * open flute bore), after the classic waveguide flute model.
 *
 * PURE and dependency-free by contract (same rule as envelopeCore): no
 * imports, no Tone, no DOM, `sampleRate` is a PARAMETER.
 *
 * PHYSICS. A flute is a linear resonator driven by a NONLINEAR jet, which is
 * the same shape of problem as the bowed string — only the excitation
 * differs. Välimäki et al. 2006 §7.8.4: an air jet leaves the flue slit,
 * crosses the embouchure hole and strikes the labium; the pressure wave
 * inside the bore deflects the jet, and with the right bore length and jet
 * velocity that coupling becomes a self-sustained oscillation. §11.1.2 gives
 * the jet flow as U(Δh) = W·b·V·(tanh(Δh/b) + 1) — a saturating
 * nonlinearity — and notes that "a signal delay is inserted prior to the
 * nonlinearity for modelling the time it takes for the jet flow to travel
 * across the embouchure hole".
 *
 *        breath ──►(+)──► jet delay ──► jet nonlinearity ──►(+)──┐
 *                   ▲                                        ▲   │
 *                   │ −jetReflection            endReflection│   ▼
 *                   └──────────── reflection filter ◄────────┴── bore delay
 *                                    (−, lossy)                    │
 *                                                                  ▼ out
 *
 * The structure and its constants follow the Synthesis ToolKit's `Flute`,
 * archived verbatim at `samples/references/stk/` so every number here is
 * checkable — an earlier review could not verify the STK constants used by
 * the bowed string because the source was not on disk.
 *
 * PINNED SEMANTICS
 * - The jet nonlinearity is the CUBIC `y = x·(x² − 1)` clipped to ±1. It is
 *   the odd-symmetric saturating curve that makes the jet flip between the
 *   two sides of the labium; a plain tanh does not produce the same
 *   register behaviour.
 * - A DC blocker sits AFTER the nonlinearity. The cubic is not zero-mean, so
 *   without it the bore accumulates a standing offset and the tone collapses.
 * - Blowing HARDER overblows to the next register on its own. That is not
 *   scripted: it falls out of the jet delay being a fixed RATIO of the bore,
 *   so the loop's stable mode changes with drive.
 */

type PipeMode = 'open' | 'closed';

type FluteParams = {
  /**
   * How many sign inversions the wave meets per round trip — see the OPEN
   * PIPE block above. `open` is a flute; `closed` is the stopped-pipe
   * (clarinet-like) model kept from the first implementation.
   */
  pipe: PipeMode;
  /**
   * OPEN: the jet transit delay as a fraction of the PERIOD.
   * CLOSED: as a fraction of the bore delay. Sets the register balance.
   */
  jetRatio: number;
  /** 0..1 — breath turbulence. A flute is famously breathy; this is most of
   *  its character. */
  noise: number;
  vibratoRateHz: number;
  /** Vibrato depth as a fraction of breath pressure. */
  vibratoDepth: number;
  /** Reflection back into the jet, 0..1. */
  jetReflection: number;
  /** Reflection from the open end back down the bore, 0..1. */
  endReflection: number;
  /**
   * OPEN only. How far the jet is aimed off the labium edge, scaling y0.
   *
   * This is the flute's main timbre control and it has no analogue in the
   * closed model: y0 is the ONLY thing that breaks the tanh's odd symmetry,
   * and without asymmetry there are no even harmonics at all. `Jet Refl`
   * cannot do it — jetGain is back-solved as share/(g0*jetRefl), so
   * jetGain*jetRefl is invariant and changing Jet Refl moves only the output
   * LEVEL, leaving the spectrum bit-identical (measured across 0.05..0.8).
   * 1 = the fitted embouchure; lower is breathier and purer, higher is
   * reedier.
   */
  embouchure: number;
  /**
   * OPEN only. The TONE-HOLE LATTICE CUTOFF, in Hz. 0 disables it.
   *
   * Benade's mechanism, and the one piece of flute physics the first open
   * pipe had no representation of: a real flute is not a plain tube but a
   * tube with a lattice of open holes, and above a cutoff set by the hole
   * geometry the lattice stops reflecting and simply radiates. So the bore's
   * loss corner is a FIXED FREQUENCY, not a fixed multiple of the played
   * pitch — which is why the reference's spectral centroid barely moves
   * across the whole range while its harmonic richness collapses in the top
   * octave (measured h2: -6.1 dB low register, -18.2 high).
   *
   * Applied as `min(toneHoleHz, lossRatio*f0)`, so it can only ever ADD
   * damping. Register stability can therefore only improve, never degrade.
   */
  toneHoleHz: number;
  /**
   * OPEN only. 1 or 2 cascaded loss poles: 6 or 12 dB/octave.
   *
   * A real flute's spectrum falls off a CLIFF past the cutoff — measured at
   * C5 mezzo-forte, h5 -22.8 dB then h6 -38.7, a 16 dB drop across 0.58 of
   * an octave. One pole gives 3.5 dB there and cannot make that shape; the
   * leftover upper harmonics are most of what reads as brassy.
   */
  lossPoles: number;
  /**
   * Whole-octave transpose applied to the Hz input, −3..+3.
   *
   * A voice's RANGE is part of what it is. The keyboard's home window is
   * C4–D♯5, which for a concert flute is its lowest, weakest octave — the
   * breathy bottom, not the register anyone pictures. The shipped flute sits
   * at +2 so the home window lands on C6–D♯7, where a flute actually sings
   * and where this model is at its purest. The longhorn stays at 0: a long
   * tube belongs at the bottom.
   *
   * Applied to the pitch, NOT hidden in the tuning: `Hz` still means Hz, and
   * `Octave 0` plays exactly what it is given.
   */
  octave: number;
  /** Breath onset, seconds. */
  attackSec: number;
  /** Breath release, seconds. */
  releaseSec: number;
};

type FluteState = {
  sampleRate: number;
  bore: Float32Array;
  jet: Float32Array;
  size: number;
  mask: number;
  boreIndex: number;
  jetIndex: number;
  /** Previous bore output — the reflection is taken from it, not from the
   *  sample being written this tick. */
  boreLastOut: number;
  /** Reflection one-pole memory. */
  filterY1: number;
  /** DC blocker memories. */
  dcX1: number;
  dcY1: number;
  breath: number;
  vibratoPhase: number;
  noiseState: number;
  /** Separate state for the additive air noise. */
  airState: number;
  /** Bandpassed turbulence injected INTO the loop (see OPEN_BREATH_NOISE). */
  turbState: number;
  turbPrev: number;
  /** Seconds since the gate rose — drives the vibrato's onset delay. */
  noteAge: number;
  /** Slow random walk on the vibrato rate, so it is never metronomic. */
  rateDrift: number;
  /** Radiation filter memory: last end pressure, and the two smoothing poles. */
  radPrev: number;
  radLp1: number;
  radLp2: number;
  noiseSeed: number;
  /** OPEN pipe: previous jet source, for the d/dt that IS the source. */
  jetPrev: number;
  /** OPEN pipe: one-pole smoothing that band-limits that d/dt. */
  jetLowpass: number;
  /** OPEN pipe: second loss pole, when the bore rolls off at 12 dB/oct. */
  filterY2: number;
  designPoles: number;
  /**
   * IDLE: the voice is silent AND every state value is already exactly zero,
   * so the loop can be skipped. Skipping is then algebraically the identity,
   * not an approximation — see the IDLE COST block.
   */
  idle: boolean;
  /**
   * Set for the block in which the voice woke, so it cannot idle again at that
   * block's end. This is NOT hypothetical: the settle threshold scales with the
   * loop delay, and at 2 kHz it is ~38 samples — well under one 128-sample
   * quantum — so a woken block could otherwise reach it and re-idle.
   */
  wokeThisBlock: boolean;
  /**
   * Consecutive samples whose every state write was exactly zero, with the
   * gate low. Idle is permitted once this exceeds the loop's read-back
   * distance, at which point every readable slot was written as exact zero.
   */
  zeroSamples: number;
  /**
   * OPEN pipe: the design is a dozen transcendentals, so it is recomputed
   * only when the pitch or the blowing level actually moves. `designHz < 0`
   * means "nothing cached yet".
   */
  designHz: number;
  designAmp: number;
  designPole: number;
  designGain: number;
  designJetGain: number;
  designNorm: number;
  designBore: number;
  designJet: number;
  designOffset: number;
  designSlope: number;
};

const MIN_HZ = 20;
const MAX_HZ = 8000;

/**
 * STK's `Flute` constants, from the archived source. The reflection pole is
 * written sample-rate-relative exactly as STK does, so the filter keeps its
 * intended cutoff rather than its intended coefficient.
 */
const FILTER_POLE_BASE = 0.7;
const FILTER_POLE_RATE_TERM = 0.1 * 22050;
/** STK's DC blocker: (1 − z⁻¹)/(1 − 0.99·z⁻¹). */
const DC_POLE = 0.99;
/** Output trim, as STK. */
const OUTPUT_GAIN = 0.3;
/** How much of the Breath knob perturbs blowing PRESSURE. Kept small: see
 *  the note at its use — pressure noise turns into random pitch FM. */
const PRESSURE_NOISE = 0.02;
/** How much of the Breath knob becomes ADDITIVE air noise at the output —
 *  the audible breathiness, which cannot destabilise the oscillator. */
const AIR_NOISE = 0.18;
/**
 * The PLAYABLE BREATH WINDOW.
 *
 * A jet-driven pipe does not sound at ANY breath pressure — it has both a
 * threshold and a ceiling, and outside them it is simply silent (a real
 * flute breaks up when overblown too). Amp is therefore mapped ONTO the
 * playable window rather than used as a raw pressure, so every Amp setting
 * speaks. Without that the flute was silent at ordinary Amp values, and the
 * little that came out was breath noise — whose odd-harmonic spectrum read
 * as a clarinet rather than a flute.
 *
 * Measured rms at C5 across the mapped range (Amp 0 → 0.25 → 0.5 → 0.75 → 1):
 *   0.115  0.179  0.243  0.307  0.370      — a clean monotonic ramp
 *
 * NOTE the window MOVES with the tuning correction below: before it was
 * applied the threshold sat near 0.7, after it near 0.85. Re-measure this
 * window whenever the loop's delay budget changes.
 */
const BREATH_MIN = 0.9;
const BREATH_MAX = 1.15;

/**
 * Empirical tuning correction, in samples, fitted against the RENDERED pitch
 * at 196/262/349/523/698/1047/1397 Hz.
 *
 * The naive delay budget (`SR/f − filterPhaseDelay − 1`) drifts from +24
 * cents at G3 to −40 cents at F6, because the jet path is a feed-forward
 * branch rather than a term in a simple series loop — its delay and the DC
 * blocker's large low-frequency phase lead both perturb the resonance in a
 * way no single constant captures. STK's own source notes "the tuning is
 * still not perfect but I'm not sure why".
 *
 * Fitted as `A + B/f + C/f²`; residual is within 1.9 cents across the whole
 * range, against 8.9 cents for a 1/f fit and 24-40 cents uncorrected.
 */
const TUNE_A = -1.4;
const TUNE_B = 185.8;
const TUNE_C = 149167.5;
/**
 * Bore-length tuning. STK writes `lastFrequency = frequency * 0.66666` with
 * the comment "We're overblowing here", i.e. the delay is set 1.5× longer
 * than a naive half-wavelength and the tube speaks a register up. The
 * constant is CALIBRATED here against the rendered pitch rather than trusted
 * — see the oracle, which holds the model to 5 cents at 262/523/1047 Hz.
 */
const BORE_TUNING = 0.66666;

/* ======================================================================== *
 *  THE OPEN PIPE — a flute, rather than a stopped pipe.
 *
 *  WHY THIS EXISTS. The model above is a CLOSED pipe. STK sets the bore to
 *  1.5 periods (`frequency * 0.66666`, "we're overblowing here") and reflects
 *  with ONE inversion, so the tube's own fundamental is f/3 and the note we
 *  hear is its THIRD mode. Every mode is an odd multiple of f/3, so the only
 *  ones landing on a harmonic of the sounding pitch are the ODD ones: the
 *  even harmonics have no mode to live in and sit ~20 dB down. Measured
 *  even-minus-odd: ours -12.3 dB, a real flute +5. That is a stopped pipe --
 *  a clarinet's harmonic series, not a flute's.
 *
 *  THE LOOP. Pressure waves; both ends open, so BOTH reflect with -1 and the
 *  round trip is net non-inverting -- every harmonic is a mode.
 *
 *      bl ──►[H(z) lossy one-pole]──► fy ──► refl = -fy   (far end, -1)
 *                                             │
 *             ┌──── direct: endRefl * (-refl) ┘           (mouth end, -1)
 *             ▼
 *   (+)◄── d/dt[ breath * tanh(slope*(delayed - y0)) ] ◄──[jet delay tau]◄──┐
 *    │                                                                       │
 *    └──►[bore delay D]──► bl                    drive = -jetRefl*refl ──────┘
 *
 *      L(z) = H(z) z^-D [ endRefl + A (1 - z^-1) z^-(tau-1) ]
 *
 *  FOUR THINGS THAT ARE NOT OPTIONAL, each measured (samples/analysis/
 *  open_pipe*.mjs, stages 1-12):
 *
 *  1. THE SOURCE IS A DERIVATIVE. Euphonics 11.8.1 gives the jet source as
 *     d/dt[tanh((eta - y0)/b)] and its phase balance as
 *     arg(Y) + pi/2 - omega*tau = 2*m*pi, i.e. tau = T/4 at a resonance.
 *     Without the derivative the model locks to the mode nearest SR/(2*tau),
 *     i.e. tau = T/2 -- a factor of two out. (1 - z^-1) supplies exactly the
 *     missing +pi/2, and being zero at DC it IS the DC blocker, so the
 *     separate blocker is gone rather than patched.
 *  2. THE JET OFFSET y0 MAKES THE EVEN HARMONICS. tanh is odd, so a drive
 *     swinging about zero yields odd harmonics ONLY -- measured h2 at -103 dB
 *     with h3 at -20. y0 is the offset between the jet centreline and the
 *     labium edge; it turns the saturated wave into a pulse of duty d, whose
 *     harmonics go as sin(k*pi*d)/k. d = 0.25 gives h2 = -3 dB, which is what
 *     a real flute does at forte.
 *  3. y0 MUST TRACK THE BLOWING. Duty is set by the RATIO y0/A of offset to
 *     drive amplitude, so a FIXED y0 drives d toward 0.5 as you blow harder
 *     and KILLS the evens -- measured h2 going -12 -> -17 dB where the real
 *     flute goes -18 -> -3. So Amp drives y0 (and, mildly, the loop gain).
 *  4. THE OUTPUT IS THE RADIATED WAVE. What leaves the open end is the
 *     transmitted wave bl + R(bl) = (1 - H) bl, a HIGHPASS, because radiation
 *     efficiency rises with frequency. Taking the internal circulating wave
 *     instead costs about 4-6 dB across h2..h4. Same reason `stringBody`
 *     exists: the resonator stores, something else radiates.
 *
 *  STABILITY, exactly. The direct reflection path contains no nonlinearity,
 *  so it must be a contraction on its own. |H| peaks at DC with |H(0)| = 1,
 *  so the whole condition is endRefl < 1 -- every divergence seen while
 *  deriving this was endRefl crossing 1.
 * ======================================================================== */

/**
 * Loop lowpass cutoff, as a MULTIPLE of the played pitch.
 *
 * Pitch-tracking rather than fixed: a short pipe makes more round trips per
 * second, so per-trip loss for a given decay time scales with f. It also
 * keeps mode 1 the highest-gain mode at every pitch, which is what stops the
 * register wandering — at cutoffs of 8*f0 and above the model jumped octaves
 * (measured 1179 cents at lossRatio 8).
 */
const OPEN_LOSS_RATIO = 4;
/**
 * Floor under the tone-hole cutoff, as a multiple of the played pitch.
 *
 * A real flute's top notes ARE close to their lattice cutoff — which is why
 * they sound nearly like a whistle — but a waveguide needs SOME room above f0
 * or the loop cannot sustain a tone at all. At 1568 Hz an unfloored 2.6 kHz
 * cutoff lands at 1.66*f0 and the model fell apart (h4 -9.3, h5 -9.7 dB, i.e.
 * no recognisable harmonic ladder at all).
 */
const OPEN_TONE_HOLE_MIN_RATIO = 2.2;
/** Open-end reflection magnitude. MUST stay < 1: see STABILITY above. */
const OPEN_END_REFLECTION = 0.95;
/** tanh sharpness, 1/b in Euphonics' notation. */
const OPEN_JET_SLOPE = 1;
/**
 * Small-signal loop gain at f0. A saturating loop settles where its gain
 * returns to 1, so this number alone sets how deep into the tanh it runs, and
 * therefore how rich the tone is. Just above 1 is a near-sine; far above is a
 * square. Amp interpolates across this range.
 */
const OPEN_EXCESS_MIN = 1.02;
const OPEN_EXCESS_MAX = 1.09;
/**
 * Jet offset y0 at Amp 0 and Amp 1 — the duty-cycle control of point 3, and
 * the only source of even harmonics in the whole model.
 *
 * Fitted against the Iowa reference at C5: around y0 ~ 1.1-1.4 the
 * model reaches even-minus-odd +4.0 dB against the real flute's +5.8, where
 * y0 ~ 0.4 gives -0.2 dB (evens and odds equal — audibly not a flute).
 *
 * The range is narrow and only mildly amp-dependent, because the equilibrium
 * DRIVE amplitude barely moves with Amp (share and settledShare scale
 * together), so duty cycle is essentially y0's business alone. An earlier
 * 0.2..0.95 ramp compounded with the embouchure knob and fell off a cliff
 * into silence once g0 hit its floor.
 */
const OPEN_OFFSET_MIN = 0.55;
const OPEN_OFFSET_MAX = 1.05;
/**
 * Floor under the tanh's operating-point slope.
 *
 * `jetGain` is back-solved as share/(g0*jetRefl), and g0 = slope/cosh^2(slope*y0)
 * COLLAPSES as the jet is aimed further off the edge — so without a floor the
 * compensation explodes and the loop leaves the regime its linearisation was
 * derived in. Measured: rms 0.42 -> 22.3 as the offset went past ~1.4 at full
 * blow. Physically the floor says what the maths cannot: aim far enough off
 * the labium and the jet stops driving the pipe, rather than driving it
 * infinitely hard.
 */
const OPEN_JET_SLOPE_FLOOR = 0.15;
/**
 * Pitch vibrato depth at `Vib Depth` 1, in cents peak. MEASURED before this
 * existed: with vibrato on the BLOWING only, a C5 at depth 0.16 swung 2.4
 * cents and 3 dB — a note that stands dead still, which is what the ear test
 * called "synth flute" and "alien". A flautist's vibrato is diaphragm-driven
 * and moves pitch by tens of cents alongside the level, so depth 0.16 here
 * gives 16 cents peak (32 cents peak-to-peak) plus the existing blowing
 * modulation. It is applied to the BORE and JET read lengths together, so the
 * loop's phase balance (jet ~ a quarter period) is preserved through the
 * cycle and the design cache never has to be rebuilt per sample.
 */
const OPEN_VIBRATO_CENTS = 100;

/**
 * AUDIBLE BREATH TURBULENCE, INJECTED INTO THE LOOP.
 *
 * `OPEN_TURBULENCE` (0.004) exists only to break the all-zeros fixed point —
 * it is a seed, not a sound. Everything a listener heard as "breath" was
 * `AIR_NOISE`, added at the OUTPUT, after the bore. That is the wrong place
 * and it is why the flute read as "alien and artificial": output noise is a
 * hiss laid over a tone, while a real flute's noise is turbulence at the
 * mouth that the bore then colours, so its energy piles up AT the resonances
 * and moves with the fingering.
 *
 * Every reference implementation injects at the mouth and scales BY the
 * blowing: STK's `Flute` is
 *     breathPressure += breathPressure * (noiseGain_ * noise + ...)
 * with `noiseGain_ = 0.15` (verified in thestk/stk `Flute.h` / `Flute.cpp`).
 * Verge models it as an additional pressure jump at the mouth and measures
 * the result as "small bumps between the tone components … at frequencies
 * corresponding to the passive resonances of the pipe"; Rajan et al. measured
 * exactly that on a real Indian bamboo flute — noise peaking near the current
 * fundamental, different per note, independent of octave.
 *
 * SCALED BY THE SQUARE of the blowing, not linearly: the dipole source goes
 * as u², which is why a real flute is breathier the harder it is blown and
 * nearly clean at pianissimo. That dynamic behaviour is free here, and it is
 * half of what "static" sounded like.
 *
 * The turbulence is band-limited (a one-pole difference either side) rather
 * than white: raw white excites every spurious high mode of the waveguide,
 * which is a different kind of artificial.
 */
const OPEN_BREATH_NOISE = 0.19;
/**
 * What radiates straight out of the embouchure without passing through the
 * bore. MEASURED to the same recipe used on the references (4096-pt Hann,
 * inter-harmonic bins 1-4 kHz, relative to h1): the Iowa concert flute sits at
 * -53 dB and the bansuri at -29 dB. At 0.05 this path measured -61.9 dB —
 * BELOW the analysis leakage floor, i.e. inaudible, which is why turning the
 * Breath knob moved the measured floor by only 1.8 dB across its whole range.
 * x8 in amplitude puts Breath 0.3 on the concert-flute figure and leaves the
 * top of the knob heading toward the bansuri's.
 */
const OPEN_DIRECT_AIR = 0.4;

/**
 * VIBRATO THAT IS PLAYED RATHER THAN APPLIED.
 *
 * A vibrato that starts at full depth on the same sample as the note, at a
 * rate accurate to the millihertz forever, is a synthesiser. Real vibrato
 * begins after the tone has settled and grows in — flute-lv2 ships a 50 ms
 * wait and a 500 ms fade; Vauthrin measured about half a second of straight
 * tone first — and its rate wanders by a few percent.
 */
const VIBRATO_ONSET_SEC = 0.11;
const VIBRATO_FADE_SEC = 0.42;
/** Peak fractional wander of the vibrato rate (a slow random walk). */
const VIBRATO_RATE_DRIFT = 0.07;

/**
 * NO TONE-HOLE VENT HERE — and the reason is worth keeping.
 *
 * Fast slurred runs sounded "alien and weird", so the bore was briefly damped
 * at each pitch move to kill the old standing wave. It did shorten the pitch
 * transition, and it was wrong: MEASURED against 309 fast transitions in a
 * real bansuri recording, the damping produced a slope of 26.7 dB per 10 ms
 * where the real instrument's steepest is 1.42, spread over 197 ms instead of
 * 58. A listener described it exactly — "sudden stops, like someone putting a
 * finger on the end of the flute after every note".
 *
 * Moving the dip to the jet source and shaping it with cascaded smoothers
 * fixed the slope but never the SHAPE, because of something the core cannot
 * do: the real dip bottoms out 6 ms BEFORE the pitch moves. A player's breath
 * eases before the fingers arrive. The core only learns of a pitch change
 * after it has happened, so it can only ever produce a late dip — measured,
 * every variant was flat until the move and then drifted down.
 *
 * Articulation is a PLAYER GESTURE WITH ANTICIPATION, not an acoustic
 * consequence of the tube, so it belongs in the score, where the next note's
 * time is known. See `fluteSoloNotes`' run helper. What is left here is the
 * acoustics: without any vent the pitch transition measures 87-90 ms against
 * the real instrument's 75, which is close and honest.
 *
 * (An earlier claim that the model took 116 ms was inflated: vibrato was on,
 * and it contaminates a pitch-slope detector. Measure transitions with
 * `vibratoDepth: 0`.)
 */
/**
 * RADIATION. What the model computes at the open end is the PRESSURE there;
 * what a listener hears is what the end RADIATES, and an open pipe end
 * radiates the time derivative of its volume flow — a +6 dB/octave tilt — up
 * to where the tone-hole lattice takes over and radiation efficiency levels
 * off. Without this stage the flute was measured 12-13 dB too dark on h2-h4
 * at ff against the Iowa recordings, and read as a "synth flute": a jet
 * pipe's operating point alone cannot produce the real instrument's dominant
 * 2nd harmonic (swept: every raise of jet offset, excess or slope either
 * saturated, detuned by 83 cents, or died).
 *
 * Fitted by sweep against `samples/analysis/flute_targets.json`:
 *   derivative, unity gain at OPEN_RADIATION_HZ, then two one-pole lowpasses
 *   at OPEN_RADIATION_CUTOFF_HZ. Measured after (dB rel h1, model / Iowa):
 *     G4 mf   h2 -4.3 / -2.8    h3 -10.9 / -14.5
 *     G4 ff   h2 -4.4 / +3.4    h3  -6.9 /  -3.0    h4  -9.6 / -10.1
 *     D6 ff   h2 -13.6 / -15.6  h3 -21.1 / -25.7   h4 -25.1 / -36.2
 * from -7.6 / -10.1 / -12.1 at G4 ff before. The ff low-register h2 stays ~8
 * dB short: that dominant 2nd is the one thing this loop cannot make.
 */
const OPEN_RADIATION_HZ = 400;
const OPEN_RADIATION_CUTOFF_HZ = 1000;
/**
 * The radiation stage runs ONLY when the tone-hole lattice is active, i.e.
 * for the flute. The Longhorn (`Tone Hole Hz` 0) is a plain tube that was
 * auditioned and kept AS IT WAS; the lowpass half of this stage would also
 * purify its top register, which is the flute's signature and not the
 * longhorn's, and changing an approved instrument is not this fix's job.
 */
/**
 * Headroom the jet is allowed ABOVE what sustaining the loop requires.
 *
 * A real jet can only put so much energy into the pipe. Without a limit, a
 * low End Refl asks the jet to supply the ENTIRE loop — at the clamp floor
 * with full blow the model reached rms 2.9 and jumped to the 2nd and 3rd
 * registers — because the design linearises the tanh at its operating point
 * and that stops being true once the drive is many times its knee.
 *
 * Expressed as headroom above `settledShare` rather than as an absolute
 * share, because how much the jet must supply just to sustain depends on how
 * lossy the bore is. An absolute cap is only ever right for one loss setting:
 * tuned for the 6 dB/oct bore, it left the 12 dB/oct one unable to reach
 * unity gain at all, and the flute went silent at 1110-1176 Hz.
 */
const OPEN_MAX_JET_HEADROOM = 0.15;
/**
 * Jet turbulence. Not decoration: with a purely acoustic drive the all-zeros
 * state is a FIXED POINT and the model is silent to machine precision. A real
 * jet is turbulent and that turbulence is what starts the note.
 */
const OPEN_TURBULENCE = 0.004;
/** Output trim, so the open pipe sits at the same level as the closed one. */
const OPEN_OUTPUT_GAIN = 0.25;

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/* ======================================================================== *
 *  IDLE COST — why a silent voice used to cost MORE than a sounding one.
 *
 *  Releasing a key only drops a gate; the processor keeps being invoked every
 *  128 samples until Stop or a new Run. That would merely be wasteful, except
 *  that as the loop decays its state falls below the smallest NORMAL float and
 *  gets stuck SUBNORMAL, where arithmetic leaves the hardware fast path and
 *  runs about an order of magnitude slower.
 *
 *  TWO boundaries matter, and this model crosses both:
 *      float32 (the Float32Array delay lines)  1.1754943508222875e-38
 *      float64 (every plain-number scalar)     2.2250738585072014e-308
 *  Measured after release: `bore` parks at 1.401e-44 in all 8192 slots (float32
 *  subnormal) and `jetLowpass` at 4.94e-324 (float64 subnormal).
 *
 *  These are true FIXED POINTS, not slow decay: on the subnormal grid the
 *  spacing is absolute, so round-to-nearest-even maps 0.95 x 10ulp = 9.5ulp
 *  back onto 10ulp. The bore is bit-identical from t = 2 s to t = 120 s.
 *  Measured cost: 0.39 % of a core sounding, 0.88 % released — 2.3x.
 *
 *  See `.claude/plans/idle-voice-cpu.md`.
 * ======================================================================== */

/**
 * Flush to EXACT zero below this. ~-360 dBFS, and above BOTH subnormal
 * boundaries above, so state can never reach either range.
 *
 * Applied on WRITE — one compare per write. NOT by scanning the delay lines
 * per block: `bore` + `jet` is 16 384 slots, and scanning them every block
 * costs more than the denormals did (measured).
 *
 * Flushing on write is enough for a delay line because only positions within
 * `delay` of the write pointer are ever read, and the pointer advances one per
 * sample, so the read region refreshes within `delay` samples. Memory beyond
 * that is never touched, and untouched subnormals cost nothing — the penalty
 * is on arithmetic, not storage.
 */
const DENORMAL_FLOOR = 1e-18;

function flush(value: number): number {
  // NaN fails both comparisons and passes through unchanged, so the watchdog
  // still sees it.
  return value > -DENORMAL_FLOOR && value < DENORMAL_FLOOR ? 0 : value;
}

/**
 * Extra settled samples required before the voice may go idle, on top of the
 * loop's own read-back distance.
 */
const IDLE_MARGIN_SAMPLES = 8;

/**
 * Advance the state that keeps moving even when the model is silent.
 *
 * Mirrors, exactly, the noise and vibrato updates the render loops perform per
 * sample. Kept adjacent to them: if either loop's RNG or vibrato handling
 * changes, this must change with it, or a voice's first note after idle will
 * silently diverge from what it would otherwise have played.
 */
function advanceRestState(
  state: FluteState,
  params: FluteParams,
  frames: number,
  sampleRate: number,
): void {
  const vibratoStep =
    (2 * Math.PI * Math.max(0, params.vibratoRateHz)) / sampleRate;
  for (let i = 0; i < frames; i += 1) {
    state.noiseSeed = (state.noiseSeed * 1103515245 + 12345) & 0x7fffffff;
    const white = state.noiseSeed / 0x3fffffff - 1;
    state.noiseState = 0.85 * state.noiseState + 0.15 * white;
    state.airState = 0.6 * state.airState + 0.4 * white;
    // EVERY recursive generator the render loop advances must be advanced
    // here too, with the SAME arithmetic, or the trajectory a note resumes on
    // depends on how long the voice happened to be idle — and the note is no
    // longer bit-identical. The turbulence pair and the vibrato-rate walk were
    // added 2026-09-14 and omitted here; the idle oracle caught it at a
    // divergence of 1.22, which is not subtle.
    state.turbState = 0.7 * state.turbState + 0.3 * white;
    state.turbPrev = state.turbState;
    state.rateDrift = clamp(
      0.9995 * state.rateDrift + 0.0005 * white * 12,
      -1,
      1,
    );
    state.vibratoPhase +=
      vibratoStep * (1 + VIBRATO_RATE_DRIFT * state.rateDrift);
    if (state.vibratoPhase > 2 * Math.PI) state.vibratoPhase -= 2 * Math.PI;
  }
  // The gate is low throughout a rest, so the note age is 0 — the next note
  // gets its vibrato onset delay from the start, as it must.
  state.noteAge = 0;
}

/**
 * Is any sample of this gate block high?
 *
 * The gate arrives as length 1 (constant across the quantum) or length 128
 * (automated) — `worklet-globals.d.ts` — so the scan length is the ARRAY's,
 * not the frame count. Reading `gate[i]` past the end of a length-1 array
 * yields `undefined`, and `undefined >= 0.5` is `false`, which would be correct
 * here by accident; the body's `!== 0` test has the mirror hazard where
 * `undefined !== 0` is TRUE, so the length is taken explicitly in both.
 *
 * The whole block must be scanned, not just `gate[0]`: `thresholdCore`'s
 * per-sample Schmitt can emit a gate that rises and falls inside one quantum.
 */
function anyGateHigh(gate: ArrayLike<number>): boolean {
  for (let i = 0; i < gate.length; i += 1) {
    if (gate[i] >= 0.5) return true;
  }
  return false;
}

/**
 * An open end reflects nearly ALL of a pressure wave — a real flute bore is
 * 0.9..0.99 — so the knob is clamped to a physical range rather than the raw
 * 0..1. It also has to be: the jet is asked to supply whatever share of the
 * loop gain the passive path does not, so a low reflection demands an
 * enormous jet gain and the model saturates into a roar (measured peaks of
 * 232 at End Refl 0.5). And it must stay strictly below 1, because the direct
 * path holds no nonlinearity and |H| peaks at 1, so endRefl < 1 IS the
 * stability condition.
 */
function clampOpenEndReflection(value: number): number {
  return clamp(value, 0.9, 0.995);
}

/**
 * Phase delay in samples of `(1-p)/(1 - p z^-1)`, POSITIVE — a lowpass delays.
 *
 * NOTE this is NOT `onePolePhaseDelay` below, which returns the NEGATIVE of a
 * phase delay (it computes atan2(-p sin w, ...) where the phase delay is
 * atan2(+p sin w, ...) / w). The closed model then SUBTRACTS it, i.e. adds
 * delay, and its empirical `A + B/f + C/f^2` correction was silently
 * absorbing the error. The open model needs the real thing, because its whole
 * tuning is analytic.
 */
function lossPhaseDelay(pole: number, omega: number): number {
  if (omega <= 0) return pole / (1 - pole);
  return Math.atan2(pole * Math.sin(omega), 1 - pole * Math.cos(omega)) / omega;
}

function createFluteState(sampleRate: number): FluteState {
  const needed = Math.ceil(sampleRate / MIN_HZ) * 2 + 8;
  let size = 1;
  while (size < needed) size *= 2;
  return {
    sampleRate,
    bore: new Float32Array(size),
    jet: new Float32Array(size),
    size,
    mask: size - 1,
    boreIndex: 0,
    jetIndex: 0,
    boreLastOut: 0,
    filterY1: 0,
    dcX1: 0,
    dcY1: 0,
    breath: 0,
    vibratoPhase: 0,
    noiseState: 0,
    airState: 0,
    turbState: 0,
    turbPrev: 0,
    noteAge: 0,
    rateDrift: 0,
    radPrev: 0,
    radLp1: 0,
    radLp2: 0,
    noiseSeed: 99991,
    jetPrev: 0,
    jetLowpass: 0,
    filterY2: 0,
    designPoles: 1,
    idle: false,
    wokeThisBlock: false,
    zeroSamples: 0,
    designHz: -1,
    designAmp: -1,
    designPole: 0,
    designGain: 0,
    designJetGain: 0,
    designNorm: 0,
    designBore: 0,
    designJet: 0,
    designOffset: 0,
    designSlope: OPEN_JET_SLOPE,
  };
}

/**
 * Solve the open pipe's loop for one (pitch, blowing level).
 *
 * Everything here follows from the loop written in the OPEN PIPE block:
 *   A'    = excess/|H(f0)| - endRefl            the jet branch's share
 *   psi   = pi/2 - w0/2 - w0(tau-1)             its phase, incl. the d/dt
 *   theta = -arg(endRefl + A' e^{j psi})        the bracket's phase
 *   D     = T - theta/w0 - phaseDelay(H)
 *
 * There is no empirical correction term: measured -2.6 to +0.4 cents over
 * 196-1397 Hz. (The closed model needs `A + B/f + C/f^2` fitted at seven
 * pitches to reach a comparable figure.)
 */
function designOpenPipe(
  state: FluteState,
  params: FluteParams,
  hz: number,
  level: number,
  sampleRate: number,
): void {
  const omega = (2 * Math.PI * hz) / sampleRate;
  const period = sampleRate / hz;
  // Pitch-tracking loss, optionally capped by the tone-hole lattice cutoff.
  // `min` is deliberate: the lattice can only remove more high frequencies,
  // never fewer, so it cannot loosen the damping that holds the register.
  const trackingCutoff = OPEN_LOSS_RATIO * hz;
  const cutoff =
    params.toneHoleHz > 0
      ? clamp(
          params.toneHoleHz,
          OPEN_TONE_HOLE_MIN_RATIO * hz,
          trackingCutoff,
        )
      : trackingCutoff;
  const poles = params.lossPoles >= 2 ? 2 : 1;
  const pole = Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  const gain = 1 - pole;
  const onePole =
    gain / Math.hypot(1 - pole * Math.cos(omega), pole * Math.sin(omega));
  const magnitude = poles === 2 ? onePole * onePole : onePole;

  const endReflection = clampOpenEndReflection(params.endReflection);
  const jetReflection = clamp(params.jetReflection, 0.05, 1);
  const excess = OPEN_EXCESS_MIN + (OPEN_EXCESS_MAX - OPEN_EXCESS_MIN) * level;
  const offset =
    clamp(params.embouchure, 0.2, 1.3) *
    (OPEN_OFFSET_MIN + (OPEN_OFFSET_MAX - OPEN_OFFSET_MIN) * level);
  const slope = OPEN_JET_SLOPE;
  // tanh's slope at the operating point, which is where the loop gain lives.
  const cosh = Math.cosh(slope * offset);
  const jetSlopeAtOffset = Math.max(OPEN_JET_SLOPE_FLOOR, slope / (cosh * cosh));

  // The jet branch's share of the loop gain. Kept strictly positive: at or
  // below zero the passive path alone would have to sustain the oscillation,
  // which it cannot (endRefl < 1), and the flute would be silent.
  // What the jet must supply just to SUSTAIN (loop gain exactly 1). Anything
  // above this is the excess that drives saturation, and it is only that
  // excess which ever ran away — so the cap is headroom above sustain, not an
  // absolute share. An absolute cap silently killed the model wherever the
  // loss was heavier than the value it was tuned at: with two poles at
  // 1110-1176 Hz the capped share could not reach unity gain and the flute
  // went silent at EVERY Amp (rms 3.1e-3, identical across the knob).
  const settledShare = Math.max(1e-4, 1 / magnitude - endReflection);
  const share = clamp(
    excess / magnitude - endReflection,
    1e-4,
    settledShare + OPEN_MAX_JET_HEADROOM,
  );
  const jetDelay = clamp(params.jetRatio * period, 1, state.size - 4);
  // The jet source is band-limited (see OPEN_JET_SLOPE_FLOOR's neighbour, the
  // note on the smoothing filter), so its own phase lag belongs in psi.
  const smoothing = lossPhaseDelay(pole, omega);
  const psi =
    Math.PI / 2 - omega / 2 - omega * (jetDelay - 1) - omega * smoothing;
  // The bracket's phase must be evaluated at the share the loop actually
  // SETTLES at, not the small-signal one. A saturating loop settles where its
  // gain is exactly 1, so the jet is contributing 1/|H| - endRefl there,
  // whatever `excess` was designed for. Using the small-signal share instead
  // made the tuning depend on Amp — measured -0.7 cents at Amp 0 drifting to
  // -11.9 at Amp 1, i.e. the volume knob bent the pitch.
  const theta = -Math.atan2(
    settledShare * Math.sin(psi),
    endReflection + settledShare * Math.cos(psi),
  );

  state.designHz = hz;
  state.designAmp = level;
  state.designPole = pole;
  state.designGain = gain;
  // The smoothing filter is in the jet branch too, so its f0 magnitude has to
  // be divided out here or the branch would land short of its design share.
  state.designJetGain = share / (jetSlopeAtOffset * jetReflection * magnitude);
  state.designNorm = 1 / (2 * Math.sin(omega / 2));
  state.designPoles = poles;
  state.designBore = clamp(
    period - theta / omega - poles * lossPhaseDelay(pole, omega),
    4,
    state.size - 4,
  );
  state.designJet = jetDelay;
  state.designOffset = offset;
  state.designSlope = slope;
}

function resetFlute(state: FluteState): void {
  state.bore.fill(0);
  state.jet.fill(0);
  state.boreLastOut = 0;
  state.filterY1 = 0;
  state.dcX1 = 0;
  state.dcY1 = 0;
  state.breath = 0;
  state.jetPrev = 0;
  state.jetLowpass = 0;
  state.filterY2 = 0;
  state.designHz = -1;
  // A watchdog reset must leave the voice AWAKE and the counter clear, or a
  // NaN caught in the same block that met the settle criterion could strand
  // the voice idle. NOTE `noiseSeed` is deliberately NOT reset here — Phase D
  // trap 17a: the open pipe's all-zeros state is a FIXED POINT, and the LCG is
  // the only thing that breaks it.
  state.idle = false;
  state.wokeThisBlock = false;
  state.zeroSamples = 0;
}

/** Linear-interpolated read `delay` samples back from `index`. */
function readDelay(
  line: Float32Array,
  index: number,
  delay: number,
  mask: number,
): number {
  const whole = delay | 0;
  const frac = delay - whole;
  const a = line[(index - whole) & mask];
  const b = line[(index - whole - 1) & mask];
  return a + (b - a) * frac;
}

/**
 * The jet nonlinearity: an odd, saturating cubic. This is what turns a
 * steady breath into an oscillation — the same role the friction curve plays
 * for the bowed string.
 */
function jetTable(x: number): number {
  const y = x * (x * x - 1);
  return y > 1 ? 1 : y < -1 ? -1 : y;
}

/** Phase delay of the one-pole reflection filter, in samples. */
function onePolePhaseDelay(pole: number, omega: number): number {
  if (omega <= 0) return pole / (1 - pole);
  // H(z) = (1 - pole) / (1 - pole z^-1)
  const phase = Math.atan2(
    -pole * Math.sin(omega),
    1 - pole * Math.cos(omega),
  );
  return phase / omega;
}

/**
 * Render one block. `hz`, `amp` and `gate` may each be length 1 (constant
 * across the quantum) or the same length as `out`.
 *
 * Returns false if the model went non-finite and was reset — a jet-driven
 * loop is recursive, so a single NaN would circulate forever.
 */
function processFluteBlock(
  state: FluteState,
  params: FluteParams,
  hz: ArrayLike<number>,
  amp: ArrayLike<number>,
  gate: ArrayLike<number>,
  out: Float32Array,
  sampleRate: number,
): boolean {
  state.sampleRate = sampleRate;

  // IDLE FAST PATH — ahead of the pipe dispatch, so ONE machine serves both
  // paths and a `Pipe` change while idle cannot strand the voice. It sits
  // after the worklet's own `stopped` check (trap #19), which is the caller's.
  //
  // Entry required every state value to be exactly zero already, so emitting
  // zeros here is not an approximation of the loop — it is what the loop
  // provably computes.
  state.wokeThisBlock = false;
  if (state.idle) {
    if (!anyGateHigh(gate)) {
      out.fill(0);
      // The loop is skipped, but the NOISE AND VIBRATO trajectories are not.
      //
      // They are the only state that keeps moving while the model is at rest,
      // and freezing them would make the next note depend on how long the key
      // was up — measured maxAbsDiff 1.92 against a peak of 1.28, i.e. a
      // completely different note. Advancing them here costs a few operations
      // per sample instead of the loop's ~50, and makes the skip an exact
      // identity rather than an approximation: every state value is then
      // precisely what the full loop would have produced.
      advanceRestState(state, params, out.length, sampleRate);
      return true;
    }
    state.idle = false;
    state.wokeThisBlock = true;
    // The counter MUST be cleared on wake. A stale count carried into the
    // waking block can re-trigger idle in the very block that woke it.
    state.zeroSamples = 0;
  }

  if (params.pipe === 'open') {
    return processOpenPipeBlock(state, params, hz, amp, gate, out, sampleRate);
  }
  const frames = out.length;
  const { mask } = state;

  const filterPole = FILTER_POLE_BASE - FILTER_POLE_RATE_TERM / sampleRate;
  const filterGain = 1 - filterPole;
  const jetRatio = clamp(params.jetRatio, 0.05, 0.9);
  const noiseAmount = clamp(params.noise, 0, 1);
  // Whole octaves only, so the transpose can never detune anything.
  const octaveScale = 2 ** Math.round(clamp(params.octave, -3, 3));
  const vibratoDepth = clamp(params.vibratoDepth, 0, 1);
  const jetReflection = clamp(params.jetReflection, 0, 1);
  // The closed topology wants a much lower reflection than the open one, and
  // above 0.5 IT NEVER STOPS SOUNDING.
  //
  // Measured peak 6 s after the gate drops, with `breath` exactly 0 — i.e. the
  // loop sustaining itself purely from the reflection path:
  //     End Refl  0.50 -> 0.0e+0 .. 6.8e-8   decays  ✓
  //               0.60 -> 1.6e-1 .. 2.7e-1   STUCK NOTE
  //               0.85 -> 6.2e-1 .. 7.2e-1   STUCK NOTE at ~90% of level
  //
  // 0.5 was this path's own default until the node's default was raised to
  // 0.95 for the OPEN pipe (where an open end really does reflect nearly
  // everything). That raise made a stuck note reachable from the UI by
  // switching `Pipe` to `closed`, so the closed path pins its own ceiling
  // rather than inheriting a default meant for the other topology.
  const endReflection = clamp(params.endReflection, 0, 0.5);
  const vibratoStep =
    (2 * Math.PI * Math.max(0, params.vibratoRateHz)) / sampleRate;
  const attackStep = 1 / Math.max(1, params.attackSec * sampleRate);
  const releaseStep = 1 / Math.max(1, params.releaseSec * sampleRate);
  const maxDelay = state.size - 4;

  for (let i = 0; i < frames; i += 1) {
    const gateHigh = (gate.length === 1 ? gate[0] : gate[i]) >= 0.5;
    const level = clamp(amp.length === 1 ? amp[0] : amp[i], 0, 4);
    const pitch = clamp(
      (hz.length === 1 ? hz[0] : hz[i]) * octaveScale,
      MIN_HZ,
      MAX_HZ,
    );

    // Breath pressure ramps — a flute speaks on an air onset, not a step.
    // Amp maps onto the playable window so every setting speaks; loudness
    // comes from the output gain below, since rms is nearly flat across the
    // window itself.
    const expression = clamp(level, 0, 1);
    const target = gateHigh
      ? BREATH_MIN + (BREATH_MAX - BREATH_MIN) * expression
      : 0;
    // The ramp rate is FULL-SCALE per second, not scaled by the target — at
    // Amp 0 a level-scaled step is zero, so the breath never rose and the
    // flute stayed silent at its own minimum setting.
    if (state.breath < target) {
      state.breath = Math.min(target, state.breath + attackStep * BREATH_MAX);
    } else if (state.breath > target) {
      state.breath = Math.max(target, state.breath - releaseStep * BREATH_MAX);
    }

    // Bore length. The reflection filter sits in the loop, so its phase
    // delay comes out of the delay line or the flute plays flat.
    const sounding = pitch * BORE_TUNING;
    const omega = (2 * Math.PI * sounding) / sampleRate;
    const boreDelay = clamp(
      sampleRate / sounding -
        onePolePhaseDelay(filterPole, omega) -
        1 +
        (TUNE_A + TUNE_B / pitch + TUNE_C / (pitch * pitch)),
      4,
      maxDelay,
    );
    const jetDelay = clamp(boreDelay * jetRatio, 1, maxDelay);

    // Breath turbulence and vibrato modulate the pressure, as STK does:
    // both scale WITH the breath, so a silent flute is silent.
    state.noiseSeed = (state.noiseSeed * 1103515245 + 12345) & 0x7fffffff;
    const white = state.noiseSeed / 0x3fffffff - 1;
    state.noiseState = 0.85 * state.noiseState + 0.15 * white;
    state.vibratoPhase += vibratoStep;
    if (state.vibratoPhase > 2 * Math.PI) state.vibratoPhase -= 2 * Math.PI;
    // Breath noise has TWO jobs and they must not be conflated.
    //
    // Modulating the blowing PRESSURE (STK's noiseGain 0.15) does not just
    // add hiss: in a jet pipe the oscillation frequency depends on blowing
    // pressure, so pressure noise becomes random FM. Measured at C5, pitch
    // wander against the noise setting:
    //     0.00 -> SD 0.5 cents, range  2 cents
    //     0.15 -> SD 4.7 cents, range 35 cents   (a third of a semitone!)
    //     0.25 -> SD 7.8 cents, range 58 cents
    // A third of a semitone of random warble is heard as "jittery".
    //
    // So the pressure term is kept TINY, and the audible breathiness is put
    // back where it belongs — as additive air noise at the output.
    const breathPressure =
      state.breath *
      (1 +
        PRESSURE_NOISE * noiseAmount * state.noiseState +
        vibratoDepth * Math.sin(state.vibratoPhase));

    // Reflection from the far end: lossy one-pole, inverting.
    state.filterY1 = flush(
      filterGain * state.boreLastOut + filterPole * state.filterY1,
    );
    const reflected = -state.filterY1;

    // Jet path: pressure difference across the embouchure, delayed by the
    // jet's travel time, then through the nonlinearity.
    let pressure = breathPressure - jetReflection * reflected;
    state.jet[state.jetIndex & mask] = flush(pressure);
    state.jetIndex += 1;
    pressure = readDelay(state.jet, state.jetIndex, jetDelay, mask);
    const shaped = jetTable(pressure);
    // DC blocker AFTER the nonlinearity — the cubic is not zero-mean.
    const blocked = shaped - state.dcX1 + DC_POLE * state.dcY1;
    // `dcX1` is a one-sample memory rather than a recursive one, but it is READ
    // in arithmetic every sample, and the subnormal penalty is on arithmetic,
    // not storage — so it is flushed too.
    state.dcX1 = flush(shaped);
    state.dcY1 = flush(blocked);
    pressure = blocked + endReflection * reflected;

    // Into the bore.
    state.bore[state.boreIndex & mask] = flush(pressure);
    state.boreIndex += 1;
    state.boreLastOut = flush(
      readDelay(state.bore, state.boreIndex, boreDelay, mask),
    );
    // Dynamics live here: rms barely moves across the breath window, so Amp
    // has to reach the output too or the flute would have no dynamic range.
    // Additive air noise — the breathiness a listener actually hears, and
    // the one place it can be loud without touching the pitch. Scaled by the
    // breath so a silent flute is silent.
    state.airState = 0.6 * state.airState + 0.4 * white;
    out[i] =
      OUTPUT_GAIN *
      (0.35 + 0.65 * expression) *
      (state.boreLastOut + AIR_NOISE * noiseAmount * state.breath * state.airState);
  }

  if (!Number.isFinite(out[frames - 1])) {
    resetFlute(state);
    out.fill(0);
    return false;
  }
  return true;
}

/**
 * The OPEN pipe — a flute. See the OPEN PIPE block for the derivation; this
 * is only its transcription.
 *
 * Amp does NOT become a raw blowing pressure here. It interpolates the loop's
 * design (gain excess + jet offset), which is what the closed model's
 * empirical BREATH_MIN/BREATH_MAX window was groping towards. Stating it as
 * loop gain rather than pressure means every Amp is above threshold BY
 * CONSTRUCTION and the window can no longer drift when the delay budget
 * changes — the trap noted on BREATH_MIN cannot recur here.
 */
function processOpenPipeBlock(
  state: FluteState,
  params: FluteParams,
  hz: ArrayLike<number>,
  amp: ArrayLike<number>,
  gate: ArrayLike<number>,
  out: Float32Array,
  sampleRate: number,
): boolean {
  const frames = out.length;
  const { mask } = state;
  const noiseAmount = clamp(params.noise, 0, 1);
  // Whole octaves only, so the transpose can never detune anything.
  const octaveScale = 2 ** Math.round(clamp(params.octave, -3, 3));
  const vibratoDepth = clamp(params.vibratoDepth, 0, 1);
  const vibratoStep =
    (2 * Math.PI * Math.max(0, params.vibratoRateHz)) / sampleRate;
  const radiates = params.toneHoleHz > 0;
  const radiationGain = sampleRate / (2 * Math.PI * OPEN_RADIATION_HZ);
  const radiationK =
    1 - Math.exp((-2 * Math.PI * OPEN_RADIATION_CUTOFF_HZ) / sampleRate);
  const attackStep = 1 / Math.max(1, params.attackSec * sampleRate);
  const releaseStep = 1 / Math.max(1, params.releaseSec * sampleRate);
  const jetReflection = clamp(params.jetReflection, 0.05, 1);
  const endReflection = clampOpenEndReflection(params.endReflection);

  for (let i = 0; i < frames; i += 1) {
    const gateHigh = (gate.length === 1 ? gate[0] : gate[i]) >= 0.5;
    const level = clamp(amp.length === 1 ? amp[0] : amp[i], 0, 1);
    const pitch = clamp(
      (hz.length === 1 ? hz[0] : hz[i]) * octaveScale,
      MIN_HZ,
      MAX_HZ,
    );

    // Breath still ramps: a flute speaks on an air onset, not a step. Here it
    // scales the jet SOURCE, so the loop gain crosses its threshold partway
    // up the ramp — the note starts a moment after the gate, as a real one
    // does, without that being scripted anywhere.
    const target = gateHigh ? 1 : 0;
    if (state.breath < target) {
      state.breath = Math.min(target, state.breath + attackStep);
    } else if (state.breath > target) {
      state.breath = Math.max(target, state.breath - releaseStep);
    }

    // The design is a dozen transcendentals; recompute only when it moved.
    // A glide recomputes per sample, which is what the closed model already
    // costs, and a held note recomputes once.
    if (
      state.designHz < 0 ||
      Math.abs(pitch - state.designHz) > state.designHz * 1e-4 ||
      Math.abs(level - state.designAmp) > 1e-3
    ) {
      designOpenPipe(state, params, pitch, level, sampleRate);
    }

    state.noiseSeed = (state.noiseSeed * 1103515245 + 12345) & 0x7fffffff;
    const white = state.noiseSeed / 0x3fffffff - 1;
    state.noiseState = 0.85 * state.noiseState + 0.15 * white;
    // Note age drives the vibrato's onset; it restarts on every gate rise.
    state.noteAge = gateHigh ? state.noteAge + 1 / sampleRate : 0;
    const vibratoOnset =
      state.noteAge <= VIBRATO_ONSET_SEC
        ? 0
        : Math.min(1, (state.noteAge - VIBRATO_ONSET_SEC) / VIBRATO_FADE_SEC);
    // A slow random walk on the rate, so two seconds of vibrato never repeat.
    state.rateDrift = clamp(
      0.9995 * state.rateDrift + 0.0005 * white * 12,
      -1,
      1,
    );
    state.vibratoPhase +=
      vibratoStep * (1 + VIBRATO_RATE_DRIFT * state.rateDrift);
    if (state.vibratoPhase > 2 * Math.PI) state.vibratoPhase -= 2 * Math.PI;
    // Vibrato modulates the BLOWING, not the bore length. In a jet pipe that
    // reads as the amplitude-and-timbre vibrato a flute actually has, and it
    // cannot become the random pitch FM that made the closed model "jittery".
    const vibratoSin = Math.sin(state.vibratoPhase) * vibratoOnset;
    const blowing = state.breath * (1 + vibratoDepth * vibratoSin);
    // Pitch vibrato: shorter loop = higher pitch, so both read lengths are
    // DIVIDED by the ratio. See OPEN_VIBRATO_CENTS.
    const vibratoRatio =
      2 ** ((OPEN_VIBRATO_CENTS * vibratoDepth * vibratoSin) / 1200);

    // Far end: open, so it inverts.
    state.filterY1 = flush(
      state.designGain * state.boreLastOut + state.designPole * state.filterY1,
    );
    if (state.designPoles === 2) {
      state.filterY2 = flush(
        state.designGain * state.filterY1 + state.designPole * state.filterY2,
      );
    }
    const filtered =
      state.designPoles === 2 ? state.filterY2 : state.filterY1;
    const reflected = -filtered;

    // The jet is deflected by the mouth acoustic field, and carries its own
    // turbulence — which is also what seeds the oscillation from silence.
    // Turbulence at the mouth: band-limited noise, scaled by the SQUARE of the
    // blowing, entering the jet exactly where the acoustic perturbation does.
    // The bore downstream is what turns it into breath rather than hiss.
    state.turbState = 0.7 * state.turbState + 0.3 * white;
    const turbulence = state.turbState - state.turbPrev * 0.55;
    state.turbPrev = state.turbState;
    // THE JET SPEED IS NOT `blowing`. In the open-pipe model `state.breath`
    // always ramps to 1 and the DYNAMICS live in the loop design (gain excess
    // and jet offset), so scaling the turbulence by `blowing` alone made it
    // constant — measured: noise-to-tone FELL from -36 to -48 dB as the note
    // got louder, the opposite of a real flute, which is breathier the harder
    // it is blown (Re 3100 at mf to 7300 at ff). `level` is what tracks the
    // blowing here, so the u^2 law is applied to it.
    const jetSpeed = blowing * (0.25 + 0.75 * level);
    const drive = flush(
      -jetReflection * reflected +
        blowing * OPEN_TURBULENCE * state.noiseState +
        jetSpeed * jetSpeed * OPEN_BREATH_NOISE * noiseAmount * turbulence,
    );
    state.jet[state.jetIndex & mask] = drive;
    state.jetIndex += 1;
    const delayed = readDelay(
      state.jet,
      state.jetIndex,
      state.designJet / vibratoRatio,
      mask,
    );

    const jetFlow =
      blowing *
      Math.tanh(state.designSlope * (delayed - state.designOffset));
    // The source is d/dt of the jet flow (Euphonics 11.8.1). Being zero at DC
    // it is also the DC blocker, so there is no separate one.
    const derivative = jetFlow - state.jetPrev;
    state.jetPrev = flush(jetFlow);
    // ...band-limited. A bare first difference rises 6 dB/octave FOREVER, so
    // the jet branch eventually outweighs the passive one: at rho = 1/4 the
    // branch turns constructive again at h5, where its loop gain reached 1.25
    // and the 5th harmonic self-oscillated (measured h5 at +62 dB, register
    // jumping to x2/x3). A jet cannot follow arbitrarily fast fluctuations, so
    // the source is smoothed by the SAME one-pole the bore uses — no new
    // constant, and the branch flattens off at ~4x instead of growing without
    // bound, which puts h5's loop gain back at 0.83.
    state.jetLowpass = flush(
      state.designGain * derivative + state.designPole * state.jetLowpass,
    );
    const source = state.designJetGain * state.designNorm * state.jetLowpass;

    // Mouth end: open too, so it inverts as well — TWO inversions per round
    // trip, which is the whole point. This is the one line that separates a
    // flute from a clarinet.
    const intoBore = flush(source + endReflection * -reflected);
    state.bore[state.boreIndex & mask] = intoBore;
    state.boreIndex += 1;
    const previous = state.boreLastOut;
    state.boreLastOut = flush(
      readDelay(state.bore, state.boreIndex, state.designBore / vibratoRatio, mask),
    );

    // What radiates is what LEAVES the open end: incident + reflected.
    state.airState = 0.6 * state.airState + 0.4 * white;
    const endPressure = previous - filtered;
    let heard = endPressure;
    if (radiates) {
      const radiated = (endPressure - state.radPrev) * radiationGain;
      state.radPrev = flush(endPressure);
      state.radLp1 = flush(state.radLp1 + radiationK * (radiated - state.radLp1));
      state.radLp2 = flush(state.radLp2 + radiationK * (state.radLp1 - state.radLp2));
      heard = state.radLp2;
    }
    out[i] =
      OPEN_OUTPUT_GAIN *
      // A trace of direct jet noise still radiates from the embouchure without
      // passing through the bore, but it is now the minority: the breath a
      // listener hears comes from the in-loop turbulence above.
      (heard +
        OPEN_DIRECT_AIR *
          noiseAmount *
          jetSpeed *
          jetSpeed *
          state.airState);

    // Count samples whose every recursive write was exactly zero. `breath` is
    // included because it gates both noise terms; once it is 0 and the lines
    // are 0, the loop is at rest.
    state.zeroSamples =
      !gateHigh &&
      state.breath === 0 &&
      intoBore === 0 &&
      drive === 0 &&
      state.boreLastOut === 0 &&
      state.filterY1 === 0 &&
      state.filterY2 === 0 &&
      state.jetLowpass === 0 &&
      state.jetPrev === 0
        ? state.zeroSamples + 1
        : 0;
  }

  // Watchdog BEFORE the idle decision: a reset must not be overridden by a
  // stale settle count, and `resetFlute` clears both idle fields.
  if (!Number.isFinite(out[frames - 1])) {
    resetFlute(state);
    out.fill(0);
    return false;
  }

  // Idle only once every readable slot was written as exact zero — i.e. the
  // settle run exceeds the loop's own read-back distance. `wokeThisBlock`
  // keeps a voice that woke in this very block from idling again at its end.
  if (
    !state.wokeThisBlock &&
    state.zeroSamples >=
      state.designBore + state.designJet + IDLE_MARGIN_SAMPLES
  ) {
    // Sets a FLAG and writes no state. Nothing is destroyed because, by the
    // entry condition, there is nothing left to destroy.
    state.idle = true;
  }
  return true;
}

export {
  BORE_TUNING,
  createFluteState,
  jetTable,
  lossPhaseDelay,
  MAX_HZ,
  MIN_HZ,
  onePolePhaseDelay,
  OPEN_END_REFLECTION,
  OPEN_EXCESS_MAX,
  OPEN_EXCESS_MIN,
  OPEN_LOSS_RATIO,
  OPEN_OFFSET_MAX,
  OPEN_OFFSET_MIN,
  processFluteBlock,
  resetFlute,
};
export type { FluteParams, FluteState, PipeMode };

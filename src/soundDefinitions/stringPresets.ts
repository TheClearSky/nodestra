/**
 * Measured presets for the physical string models.
 *
 * Owned by `implementations.ts` — the pure cores never import this, so the
 * Node render bridge and the vitest oracles can drive them without pulling in
 * a module graph (the same contract envelopeCore states).
 *
 * PROVENANCE. Every number here is either measured from the University of
 * Iowa Musical Instrument Samples recordings in `samples/references/iowa-mis/`
 * or cited from a paper in `samples/references/papers/`. Nothing is invented.
 * The body mode tables are FIRST-GUESS values from the literature; G-FIT
 * refines them against the Iowa long-term spectra and rewrites this file.
 */

import type { BodyMode } from './modalBodyCore';

/**
 * Guitar body — Christensen & Vistisen (JASA 1980) two-oscillator model for
 * the low pair, plus plate modes.
 *
 * f− 90–120 Hz (Q 6.5–29) and f+ 170–250 Hz (Q 15–35) are the coupled
 * top-plate/Helmholtz pair, with f−² + f+² = fh² + fp² (fh 122–135 Hz the
 * air resonance, fp ≈ 184 Hz the plate). Above them the guitar's bridge
 * admittance is close to a flat plate (Woodhouse 2014 fig. 23), which is what
 * the direct-field term supplies.
 *
 * FITTED (2026-09-06) against two measured constraints simultaneously:
 *   - Iowa E2 (82.41 Hz): h1 sits ~16 dB BELOW h2–h5, because E2's
 *     fundamental falls below the body's first radiating resonance. The
 *     fitted preset delivers +12…+14 dB.
 *   - Iowa A2 (110 Hz): h1 and h2 are the loudest partials, within a few dB
 *     of each other. Delivered: h2 is +1.1 dB on h1.
 * subject to Christensen's coupling identity holding with fp = 184 Hz, which
 * pins the implied air resonance at fh = 121.6 Hz — inside the measured
 * 122–135 Hz band, and puts f+ at 183.7 Hz, essentially on the plate
 * resonance itself.
 *
 * TWO earlier fits were rejected on physical grounds, not on fit quality:
 * one implied fh = 91.7 Hz (a box no guitar has); the next matched the
 * recordings best by pushing f− down to −24 dB, i.e. DELETING the air/plate
 * pair — and a guitar without its low pair is exactly what the user heard as
 * "sounds more like a piano". The shipped fit constrains every mode level to
 * a physical band so the pair survives.
 */
const GUITAR_BODY: readonly BodyMode[] = [
  { hz: 122, q: 29, db: -10 },
  { hz: 184, q: 16.8, db: -1.9 },
  { hz: 289, q: 8, db: 2 },
  { hz: 400, q: 18, db: -6 },
  { hz: 600, q: 12, db: -8 },
  { hz: 900, q: 10, db: -10 },
  { hz: 1400, q: 8, db: -12 },
  { hz: 2500, q: 6, db: -15 },
];

/**
 * Violin body — Woodhouse (Rep. Prog. Phys. 2014) §3.2 signature modes and
 * §3.3.3 bridge hill.
 *
 * A0 (air, Helmholtz-like), CBR (centre-bout rhomboid), B1− and B1+ are the
 * "signature modes" every normal violin shows; the paper's two instruments
 * measure A0 243/272, CBR 376/407, B1− 397/462, B1+ 551/562 Hz.
 *
 * THE BRIDGE HILL is modelled as FIVE modes spanning 1.5–3.7 kHz, not one.
 * Woodhouse §3.3.3 describes it as a broad hump built from "many individual
 * peaks being somehow modulated to form a larger-scale feature", with "peak
 * levels in this second hump comparable to the high peaks of B1- and B1+",
 * and it is the reason a violin projects. A single Q-4 resonator at +1 dB —
 * the first attempt — is neither broad nor strong enough, and the model
 * sounded dull because of it. Measured through the full string+body chain at
 * G3 (the real violin is −1.1 dB/octave with h10 at +7.9 dB):
 *
 *   1 narrow mode  +1 dB    tilt −7.6   h10 −13.8
 *   4 modes       +10 dB    tilt −4.7   h10  −7.1
 *   4 modes       +16 dB    tilt −4.3   h10  −5.3
 *   5 modes       +20 dB    tilt −4.2   h10  −3.6   ← shipped
 *
 * and A4 stays at −9.5 dB/octave against the real −8.8, so the hill brightens
 * the G string without over-brightening the E.
 *
 * LEVELS: the whole preset carries a constant −20 dB offset, which leaves the
 * measured SHAPE untouched (only differences matter) while keeping a single
 * voice near unity. Without it the hill's gain took a G3 to a peak of 12.4 —
 * hard clipping. Trimmed it peaks at 1.24, in the same range as the guitar.
 */
const VIOLIN_BODY: readonly BodyMode[] = [
  // FITTED TO MEASUREMENT, 2026-09-12. The previous table put the bridge hill
  // at 0 dB and the signature modes at -20 to -25 dB; measured against the
  // University of Iowa violin (arco mf, G3-B4) that left the body 10-17 dB too
  // weak at 283-800 Hz and made an A4's harmonics 2-7 sit within +-3.4 dB of
  // its fundamental -- FLATTER than a raw sawtooth (the real A4 falls -16.5
  // dB/oct, h2-h7 averaging -16.1 dB). The ear test called it "saw-wave type".
  //
  // Method: long-term average spectrum of the Iowa notes divided by the same
  // notes rendered from our string WITHOUT a body gives the body response the
  // recording implies; the four signature modes keep their published
  // frequencies, the upper modes sit on the measured peaks, and the gains were
  // iterated against the 1/12-octave residual, then shifted -8 dB as a block
  // so the output peak stays at the calibrated ~1.2. Result at A4: h2-h7 mean
  // -15.1 dB (Iowa -16.1), tilt -11.0 dB/oct (Iowa -16.5), spectral roughness
  // 4.9 dB (Iowa 6.3). Fitting scripts: session scratchpad `body_render.mjs`.
  //
  // Signature modes (Jansson / Woodhouse): A0, CBR, B1-, B1+.
  { hz: 272, q: 12, db: -23.5 },
  { hz: 407, q: 14, db: -3.1 },
  { hz: 462, q: 10, db: 2.0 },
  { hz: 551, q: 10, db: -19.9 },
  // The measured upper body: 800 Hz and 1 kHz regions the old table lacked,
  // then THE BRIDGE HILL as a broad hump (Woodhouse 3.3.3), rolling off above.
  { hz: 823, q: 5, db: 1.0 },
  { hz: 1050, q: 5, db: -1.3 },
  { hz: 1849, q: 4, db: 2.0 },
  { hz: 2329, q: 5.6, db: 2.0 },
  { hz: 3300, q: 7, db: -3 },
  // Lowered from the fit's -4.8: measured 5.5 dB too strong at 4.5 kHz, and
  // the hill oracle (hill >= 8 dB over 4.5 kHz; Iowa shows 19) agreed.
  { hz: 4150, q: 8, db: -20 },
];

/**
 * Broadband direct field, Woodhouse 2014 §3.3.3: a bridge admittance splits
 * into Y_dir (what an infinite plate would give — featureless) plus Y_rev
 * (the resonances). Without it a bank of a handful of modes has unphysical
 * valleys between them.
 */
const GUITAR_DIRECT_DB = -30;
// -40 (was -31): the flat direct field was what held 4-5 kHz up. Measured on
// the Iowa violin the response falls 19 dB from the 2 kHz hill to 4.5 kHz;
// with the field at -31 ours fell 5.8. The valleys between the low modes are
// still filled -- the modes there are broad (q 5-14) and dense.
const VIOLIN_DIRECT_DB = -40;

/**
 * String impedance for the bowed model, Ns/m.
 *
 * Woodhouse 2014 §5.1 gives a violin G string (196 Hz) as 0.363 Ns/m. A set
 * of strings designed at roughly equal tension has Z = T/(2·L·f0) ∝ 1/f0,
 * which is the law used here; it is exposed as a knob because it rests on a
 * single published value.
 */
const VIOLIN_REFERENCE_HZ = 196;
const VIOLIN_REFERENCE_IMPEDANCE = 0.363;

function violinImpedanceFor(hz: number): number {
  if (!(hz > 0)) return VIOLIN_REFERENCE_IMPEDANCE;
  const value = (VIOLIN_REFERENCE_IMPEDANCE * VIOLIN_REFERENCE_HZ) / hz;
  return Math.min(1, Math.max(0.05, value));
}

/**
 * Per-model default bow force.
 *
 * The three friction laws do NOT share a force scale: STK's bow table caps
 * its friction at 2·Z₀·ρ·Δv with no dependence on normal force at all, while
 * the curve and thermal models cap at µ·N. Measured Helmholtz windows (one
 * slip per period, stick fraction ≈ 1 − β) at β = 0.127, G3, Amp 0.8:
 *
 * Re-measured after the bow-gesture mapping, with vibrato and bow noise ON,
 * as slips per period (1.00 = Helmholtz) across 196/330/440/784 Hz:
 *
 *   bowTable      0.70 → 1.00 2.00 1.00 1.00   never clean at every pitch
 *   frictionCurve 0.15 → 1.02 1.03 1.00 1.01   clean across the keyboard
 *   thermal       0.20 → 1.17 1.02 1.04 1.10   clean across the keyboard
 *
 * so each instrument ships at the centre of its OWN window. Giving all three
 * the same number would put one model outside its window and the ear test
 * would measure that instead of the friction law. `bowTable` is the crudest
 * of the three and cannot be made clean everywhere — that IS its character.
 */
const DEFAULT_BOW_FORCE = {
  bowTable: 0.7,
  frictionCurve: 0.15,
  thermal: 0.2,
} as const;

/**
 * Guitar string defaults, fitted to the Iowa guitar recordings: fundamental
 * T60 5–9 s, h3 2–4 s, h6+ 0.3–1.5 s, inharmonicity B 1e-5…1e-4, and the
 * measured pluck position for a normal (tirando) right hand.
 */
const GUITAR_STRING = {
  decaySec: 7,
  brightness: 0.62,
  positionBeta: 0.2,
  stiffness: 3e-5,
  polarization: 0.5,
} as const;

export {
  DEFAULT_BOW_FORCE,
  GUITAR_BODY,
  GUITAR_DIRECT_DB,
  GUITAR_STRING,
  VIOLIN_BODY,
  VIOLIN_DIRECT_DB,
  violinImpedanceFor,
};

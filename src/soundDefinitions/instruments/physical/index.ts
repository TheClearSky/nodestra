/**
 * Physically-modelled string instruments (Phase D).
 *
 * HAND-WRITTEN, and deliberately in its own directory with its own barrel:
 * `tools/recipes-to-nodegroups.ts` sweeps `instruments/` and DELETES every
 * `inst_*.ts` that is not in its own ship set, then rewrites
 * `instruments/index.ts` wholesale. Anything living beside the generated
 * modules would vanish on the next routine regeneration. `nodeCatalog.ts`
 * merges both barrels.
 *
 * Each instrument is a node group over the Phase D fundamental nodes, obeying
 * the Phase C instrument contract: boundary inputs Hz (signal) · Gate
 * (boolSignal) · Amp (signal), one audio output, no reverb or delay inside.
 *
 * The three violins differ ONLY in their friction model and in the bow force
 * that centres each model in its own measured Helmholtz window (the models do
 * not share a force scale — see stringPresets.DEFAULT_BOW_FORCE). They exist
 * so the friction laws can be compared by ear.
 */

import type { InstrumentSpec } from '../groupBuilder';
import { buildInstrumentType } from '../groupBuilder';
import { DEFAULT_BOW_FORCE, GUITAR_STRING } from '../../stringPresets';

const STRINGS_COLOR = '#7c2d12';

const BOUNDARY_INPUTS = [
  { name: 'Hz', dataType: 'signal', maxConnections: 1 },
  { name: 'Gate', dataType: 'boolSignal', maxConnections: 1 },
  { name: 'Amp', dataType: 'signal', maxConnections: 1 },
] as const;

const BOUNDARY_OUTPUTS = [{ name: 'Out', dataType: 'audio' }] as const;

function guitarSpec(): InstrumentSpec {
  return {
    id: 'inst_guitarPM',
    name: 'Guitar (physical)',
    family: 'Strings',
    headerColor: STRINGS_COLOR,
    inputs: [...BOUNDARY_INPUTS],
    outputs: [...BOUNDARY_OUTPUTS],
    nodes: [
      {
        id: 'string',
        type: 'pluckedString',
        x: -420,
        y: 0,
        values: {
          Position: GUITAR_STRING.positionBeta,
          Brightness: GUITAR_STRING.brightness,
          'Decay s': GUITAR_STRING.decaySec,
          Stiffness: GUITAR_STRING.stiffness,
          Polarization: GUITAR_STRING.polarization,
          Pick: 'finger',
          Damp: 'on',
        },
      },
      {
        id: 'body',
        type: 'stringBody',
        x: 60,
        y: 0,
        values: { Preset: 'guitar', Scale: 1, 'Air Hz': 0, Mix: 1 },
      },
    ],
    edges: [
      { from: '$in', output: 'Hz', to: 'string', input: 'Hz' },
      { from: '$in', output: 'Gate', to: 'string', input: 'Gate' },
      { from: '$in', output: 'Amp', to: 'string', input: 'Amp' },
      { from: 'string', output: 'Out', to: 'body', input: 'In' },
      { from: 'body', output: 'Out', to: '$out', input: 'Out' },
    ],
  };
}

function violinSpec(
  id: string,
  name: string,
  friction: keyof typeof DEFAULT_BOW_FORCE,
): InstrumentSpec {
  return {
    id,
    name,
    family: 'Strings',
    headerColor: STRINGS_COLOR,
    inputs: [...BOUNDARY_INPUTS],
    outputs: [...BOUNDARY_OUTPUTS],
    nodes: [
      {
        id: 'string',
        type: 'bowedString',
        x: -420,
        y: 0,
        values: {
          Friction: friction,
          Force: DEFAULT_BOW_FORCE[friction],
          Position: 0.127,
          Impedance: 0,
          'Attack ms': 60,
          'Release ms': 80,
          'Vib Rate Hz': 5.5,
          'Vib Cents': 12,
          Noise: 0.4,
        },
      },
      {
        id: 'body',
        type: 'stringBody',
        x: 60,
        y: 0,
        values: { Preset: 'violin', Scale: 1, 'Air Hz': 0, Mix: 1 },
      },
    ],
    edges: [
      { from: '$in', output: 'Hz', to: 'string', input: 'Hz' },
      { from: '$in', output: 'Gate', to: 'string', input: 'Gate' },
      { from: '$in', output: 'Amp', to: 'string', input: 'Amp' },
      { from: 'string', output: 'Out', to: 'body', input: 'In' },
      { from: 'body', output: 'Out', to: '$out', input: 'Out' },
    ],
  };
}

/**
 * A jet-driven pipe needs no body node: unlike a string, its resonator IS the
 * instrument. The bore is the air column, so the jet-flute node is the whole
 * voice. (It still has to RADIATE, but for a pipe that is the transmitted
 * wave at the open end, which `fluteCore` takes as its output — no separate
 * radiating structure the way a string needs a body.)
 *
 * `Pipe: open` is what both of these have in common. The first version was a
 * CLOSED pipe — STK's stopped-tube geometry — whose even harmonics sat about
 * 20 dB below the odd ones: a clarinet's harmonic series, not a flute's.
 *
 * TWO instruments come off this node, and the difference between them is the
 * TONE-HOLE LATTICE (Benade). See `toneHoleHz` in fluteCore.
 */

/**
 * LONGHORN — a plain open tube. Deepak's verdict on the first open pipe was
 * "flute sounds like a longhorn", so it is named for what it is: no tone-hole
 * lattice, a 6 dB/oct bore loss, and a fast onset, which together give a
 * sustained tone that is equally rich at EVERY pitch (h2 ≈ −8 dB from 262 Hz
 * to 1568 Hz, where a real flute falls from −6.1 to −18.2). That is an
 * alphorn's behaviour, not a flute's — a long plain tube is exactly what an
 * alphorn is, so the model is right, it was just the wrong instrument.
 *
 * Its parameters are pinned here EXPLICITLY, so it keeps this sound even
 * though the node's own defaults have since moved to the flute's.
 */
function longhornSpec(): InstrumentSpec {
  return {
    id: 'inst_flutePM',
    name: 'Longhorn (physical)',
    family: 'Winds',
    headerColor: '#0e7490',
    inputs: [...BOUNDARY_INPUTS],
    outputs: [...BOUNDARY_OUTPUTS],
    nodes: [
      {
        id: 'pipe',
        type: 'jetFlute',
        x: -220,
        y: 0,
        values: {
          Pipe: 'open',
          'Jet Ratio': 0.25,
          Embouchure: 1,
          // A plain tube: no lattice, and the gentle 6 dB/oct loss.
          'Tone Hole Hz': 0,
          'Loss Poles': 1,
          // A long tube belongs at the bottom of the keyboard.
          Octave: 0,
          Breath: 0.15,
          'Vib Rate Hz': 5.925,
          'Vib Depth': 0.05,
          'Jet Refl': 0.5,
          'End Refl': 0.95,
          'Attack ms': 40,
          'Release ms': 50,
        },
      },
    ],
    edges: [
      { from: '$in', output: 'Hz', to: 'pipe', input: 'Hz' },
      { from: '$in', output: 'Gate', to: 'pipe', input: 'Gate' },
      { from: '$in', output: 'Amp', to: 'pipe', input: 'Amp' },
      { from: 'pipe', output: 'Out', to: '$out', input: 'Out' },
    ],
  };
}

/**
 * FLUTE — the same open pipe with the three things that make a flute a flute
 * rather than a long tube, each measured against the Iowa nonvib reference:
 *
 * - **A tone-hole lattice** at 2.6 kHz. A flute is a tube with a lattice of
 *   open holes; above a cutoff set by their geometry the lattice stops
 *   reflecting and radiates instead. Because that corner is a FIXED
 *   FREQUENCY, the top octave sits near it and goes pure while the low
 *   register stays rich — the register dependence the Longhorn has none of.
 *   Measured h2: −9.9 dB at 262 Hz → −14.3 at 1047 → −20.8 at 1568, against
 *   the real flute's −6.1 (low) → −18.2 (high).
 * - **A 12 dB/oct bore loss.** The real spectrum falls off a cliff past the
 *   cutoff (C5 mf: h5 −22.8 → h6 −38.7, 16 dB in 0.58 of an octave). One
 *   pole manages 3.5 dB there; the harmonics it leaves behind are most of
 *   what reads as brassy. Two poles took h6 from −26.0 to −30.2.
 * - **A flute's onset.** Measured on the reference: median **274 ms** from
 *   onset to 90 % of steady level (range 29–525). The Longhorn's 40 ms is
 *   nearly seven times faster, and a fast onset on a sustained harmonic tone
 *   is exactly how a brass attack reads.
 *
 * Plus audible vibrato, which a real flute always has and which a steady
 * sustained tone conspicuously lacks.
 */
function fluteSpec(): InstrumentSpec {
  return {
    id: 'inst_flutePM_lattice',
    name: 'Flute (physical)',
    family: 'Winds',
    headerColor: '#0e7490',
    inputs: [...BOUNDARY_INPUTS],
    outputs: [...BOUNDARY_OUTPUTS],
    nodes: [
      {
        id: 'pipe',
        type: 'jetFlute',
        x: -220,
        y: 0,
        values: {
          Pipe: 'open',
          'Jet Ratio': 0.25,
          Embouchure: 0.85,
          'Tone Hole Hz': 2600,
          'Loss Poles': 2,
          // The home window is C4-D#5 — a concert flute's weakest octave.
          // +2 puts it at C6-D#7, where a flute sings.
          Octave: 2,
          Breath: 0.3,
          'Vib Rate Hz': 5.5,
          'Vib Depth': 0.1,
          'Jet Refl': 0.5,
          'End Refl': 0.95,
          'Attack ms': 90,
          'Release ms': 90,
        },
      },
    ],
    edges: [
      { from: '$in', output: 'Hz', to: 'pipe', input: 'Hz' },
      { from: '$in', output: 'Gate', to: 'pipe', input: 'Gate' },
      { from: '$in', output: 'Amp', to: 'pipe', input: 'Amp' },
      { from: 'pipe', output: 'Out', to: '$out', input: 'Out' },
    ],
  };
}

const inst_guitarPM = buildInstrumentType(guitarSpec());
/**
 * The id stays `inst_flutePM` although the instrument is now called
 * Longhorn: ids are PERMANENT, so saved projects that already reference it
 * keep working. Same rule the thermal violin follows — only its display name
 * changed. The new flute therefore needs a NEW id, suffixed with the feature
 * that distinguishes it, exactly as `_thermal` does.
 */
const inst_flutePM = buildInstrumentType(longhornSpec());
const inst_flutePM_lattice = buildInstrumentType(fluteSpec());

/**
 * The thermal friction model WON the A/B/C ear test (user, 2026-09-06:
 * "c sounds best"), so it is the shipped violin and the other two variants
 * are gone. The `bowedString` NODE still offers all three friction models on
 * its Friction enum — the losers were dropped as instruments, not as physics.
 *
 * The id keeps its `_thermal` suffix on purpose: ids are permanent, so saved
 * projects that already reference this instrument keep working. Only the
 * display name changed.
 */
const inst_violinPM_thermal = buildInstrumentType(
  violinSpec('inst_violinPM_thermal', 'Violin (physical)', 'thermal'),
);

const physicalInstrumentNodeTypes = {
  inst_guitarPM,
  inst_violinPM_thermal,
  inst_flutePM,
  inst_flutePM_lattice,
};

export { physicalInstrumentNodeTypes };

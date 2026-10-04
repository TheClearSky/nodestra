/**
 * Programmatic probe/demo graphs: composed with
 * `constructNodeOfType` and swapped in via REPLACE_STATE through the dev
 * handle `window.__probe(name)`.
 */

import { constructNodeOfType } from '@theclearsky/react-blender-nodes';
import { makeTimelineCurveRef } from '@theclearsky/react-blender-nodes-timeline';
import type {
  CurvePoint,
  SideInterp,
  TimelineCurve,
  TimelineDocument,
} from '@theclearsky/react-blender-nodes-timeline';
import {
  allowedConversionsBetweenDataTypes,
  soundDataTypes,
} from './dataTypes';
// The merged catalog: probe/demo builders can place generated
// instrument groups too, not only base nodes.
import type { SoundCatalogNodeTypeId } from './nodeCatalog';
import { soundNodeTypes } from './nodeCatalog';
import { effectNodeTypes } from './effects';
import { KEY_ORDER, keyLabel } from '../audio/keyMap';
import { GUITAR_STRING } from './stringPresets';
import {
  normalizeSamples,
  sawPreset,
  smoothSamples,
  squarePreset,
  trianglePreset,
  WAVEFORM_SAMPLE_COUNT,
} from './waveformMath';
import type { WaveformValue } from './valueTypes';
import { initialSoundState } from './demoState';

type ProbeState = typeof initialSoundState;
type ProbeNode = ReturnType<typeof constructNodeOfType>;

type NodeSpec = {
  id: string;
  type: SoundCatalogNodeTypeId;
  x: number;
  y: number;
  /** Input values to seed post-construction (knobs, enums, waveforms). */
  values?: Record<string, unknown>;
};

type EdgeSpec = {
  from: string;
  output: string;
  to: string;
  input: string;
};

function buildState(nodes: NodeSpec[], edges: EdgeSpec[]): ProbeState {
  const constructed = new Map<string, ProbeNode>();
  for (const spec of nodes) {
    const node = constructNodeOfType(
      soundDataTypes,
      spec.type,
      soundNodeTypes,
      spec.id,
      { x: spec.x, y: spec.y },
    );
    if (spec.values) {
      for (const [inputName, value] of Object.entries(spec.values)) {
        const input = (node.data.inputs ?? []).find(
          (candidate) => candidate.name === inputName,
        );
        if (!input) {
          throw new Error(`probe graph: no input "${inputName}" on ${spec.id}`);
        }
        (input as { value: unknown }).value = value;
      }
    }
    constructed.set(spec.id, node);
  }

  const stateEdges = edges.map((edge, index) => {
    const source = constructed.get(edge.from);
    const target = constructed.get(edge.to);
    if (!source || !target) throw new Error('probe graph: unknown node id');
    const sourceHandle = (source.data.outputs ?? []).find(
      (candidate) => candidate.name === edge.output,
    );
    const targetHandle = (target.data.inputs ?? []).find(
      (candidate) => candidate.name === edge.input,
    );
    if (!sourceHandle || !targetHandle) {
      throw new Error(
        `probe graph: missing handle ${edge.from}.${edge.output} → ${edge.to}.${edge.input}`,
      );
    }
    return {
      id: `probe-edge-${index}`,
      source: edge.from,
      sourceHandle: sourceHandle.id,
      target: edge.to,
      targetHandle: targetHandle.id,
      // Host stories convention — plain edges render as ReactFlow's default
      // thin dark bezier; this keys the host's handle-colored edge.
      type: 'configurableEdge' as const,
    };
  });

  return {
    ...initialSoundState,
    nodes: [...constructed.values()],
    edges: stateEdges,
    enableComplexTypeChecking: true,
    enableCycleChecking: true,
    allowedConversionsBetweenDataTypes,
  } as ProbeState;
}

const squareWave: WaveformValue = { kind: 'waveform', samples: squarePreset() };
const sawWave: WaveformValue = { kind: 'waveform', samples: sawPreset() };
const triangleWave: WaveformValue = {
  kind: 'waveform',
  samples: trianglePreset(),
};

/** Narrow pulse (duty-cycled square) — quill-pluck/string-machine timbres
 *  (harpsichord = pulse-width; Solina leans narrow pulse). */
function narrowPulse(dutyFraction: number): WaveformValue {
  const edge = Math.round(WAVEFORM_SAMPLE_COUNT * dutyFraction);
  return {
    kind: 'waveform',
    samples: Array.from({ length: WAVEFORM_SAMPLE_COUNT }, (_, n) =>
      n < edge ? 1 : -1,
    ),
  };
}

/** Heavily-smoothed square — the rounded, hollow Moog-ish wave used as
 *  the second oscillator layer in the Hollow Bloom patch. */
const roundedSquareWave: WaveformValue = {
  kind: 'waveform',
  samples: smoothSamples(squarePreset(), 6),
};

/** A wave whose DFT IS the given harmonic amplitude series — first-
 *  principles spectra drawn directly (tabla's Raman modes, piano partials). */
function harmonicWave(amplitudes: readonly number[]): WaveformValue {
  const samples = Array.from({ length: WAVEFORM_SAMPLE_COUNT }, (_, n) => {
    let value = 0;
    for (let k = 0; k < amplitudes.length; k++) {
      value +=
        amplitudes[k] *
        Math.sin((2 * Math.PI * (k + 1) * n) / WAVEFORM_SAMPLE_COUNT);
    }
    return value;
  });
  return { kind: 'waveform', samples: normalizeSamples(samples) };
}

/** Raman (Nature, 1920): the syahi-loaded tabla membrane's resonances form
 *  a HARMONIC series. The "na" rim stroke SUPPRESSES the fundamental —
 *  the 2nd harmonic dominates — and the upper modes decay much faster than
 *  the ring, so the spectrum is split across two decay branches. */
const tablaRingLowWave = harmonicWave([0.3, 1, 0.5, 0, 0]);
const tablaRingHighWave = harmonicWave([0, 0, 0.8, 0.7, 0.5]);

/** Piano-ish decaying partial series (subtractive approximation — true
 *  piano partials are inharmonically stretched — a known limit). */
const pianoWave = harmonicWave([1, 0.5, 0.33, 0.25, 0.2, 0.16, 0.12, 0.1]);

// ── Dreamy pad: measured partial tables ──────────────────────────────
//
// The seven levels measured off the reference bed (h1 0, h2 −0.6, h3 −0.9,
// h4 −5.6, h5 −22.2, h6 −19.2, h7 −46.7 dB) are held BYTE-EXACT here. What
// makes them reproduce the measured band split is the VOICING: as one note at
// 86 Hz the table misses the five-band energy split by up to 26 percentage
// points, but voiced as a root–fifth–octave chord it lands within 0.28 pp.
// The table was never wrong; it was never one note.
// See `samples/analysis/reports/dreamy-reference-findings.md` and `plan-modal.md`.
//
// Each partial is split between a MONO CENTRE osc and a HARD-PANNED PAIR, and
// that split is solved rather than tuned. For centre amplitude c and pair
// amplitude w carrying incoherent signals, the LR correlation of a band works
// out to exactly the centre's share of that band's power:
//
//     r = c² / (c² + 2w²)      so      c = a·√r,   w = a·√((1−r)/2)
//
// which leaves c² + 2w² = a² — total power per partial unchanged, so the band
// split survives the stereo placement untouched. r is the MEASURED correlation
// of the band each partial falls in: 0.667 below 250 Hz, 0.262 from 250–1000.
// That is why partials 3 and 4 differ between v1 and v2/v3 — at those pitches
// they cross the 250 Hz boundary into the wider band.
// ── What the reference bed ACTUALLY is ───────────────────────────────
//
// Peak-picked from `samples/dreamy-pad-TARGET-0to22.wav` at a 1.35 Hz bin
// (script `samples/analysis/reference/pad_vs_target.py` + the peak scan):
//
//     Hz     87.5  109.0  130.5  165.5  175.0  219.4  262.4  329.7
//     %       7.27   1.19   6.73   5.39   3.22   2.02   6.59   2.02
//     ratio  1.000  1.246  1.492  1.891  2.000  2.508  3.000  3.769
//
// Those ratios are a MAJOR-SEVENTH CHORD voiced across two octaves —
// root, major third (1.26), fifth (1.50), major seventh (1.89), then the
// octave and its third, fifth and seventh. Root ~87.5 Hz, i.e. about F2.
//
// THE MISTAKE THIS REPLACES. The first version was built from a "measured
// partial table" (h2 -0.6 dB, h3 -0.9 dB ...) taken to be one voice's
// harmonic series, then voiced as root+fifth+octave. Two things were wrong:
//   1. That table was never a partial table. It was these chord tones read
//      as harmonics of an assumed ~86 Hz fundamental. The findings file had
//      already flagged the evidence — `harmonic_to_floor` came out NEGATIVE,
//      meaning more energy BETWEEN the assumed harmonics than on them, which
//      is the signature of a chord — and the table was used anyway.
//   2. Root+fifth+octave with no third is a power chord. It measured fine
//      against five coarse bands and sounded like a hollow organ, which is
//      exactly what a bare fifth stack is.
// Third-octave comparison of the old build against the target: 0.05 % where
// the target had 21.10 % (157 Hz), and 14.10 % where the target had 0.15 %
// (397 Hz). The five-band metric averaged straight over both.
//
// Intervals are `Detune` in CENTS off one shared pitch, not eight pitch
// chains: an equal-tempered ratio is a constant cent offset regardless of
// which key is held, so this costs zero extra nodes and stays in tune
// everywhere.
const PAD_CHORD: ReadonlyArray<{ cents: number; level: number; note: string }> = [
  { cents: 0, level: 1.0, note: 'root' },
  { cents: 400, level: 0.405, note: 'major third' },
  { cents: 700, level: 0.962, note: 'fifth' },
  { cents: 1100, level: 0.861, note: 'major seventh' },
  { cents: 1200, level: 0.665, note: 'octave' },
  { cents: 1600, level: 0.527, note: 'third + octave' },
  { cents: 1900, level: 0.952, note: 'fifth + octave' },
  { cents: 2300, level: 0.527, note: 'seventh + octave' },
];

/**
 * The struck-string piano into its hall.
 *
 * Halo / shimmer / chorus variants of this lived here briefly and were
 * removed 2026-09-21: side by side, every one of them was worse than the
 * plain instrument. Kept as a note so they are not re-derived from scratch —
 * the research behind them is under `research/`.
 */
function buildPianoGraph(): ProbeState {

  const voices = KEY_ORDER.map((_key, index) => ({
    id: `pn-v${index}`,
    type: 'struckString' as const,
    x: index % 2 === 0 ? 700 : 1060,
    y: Math.floor(index / 2) * 240,
    values: {
      // A real hammer lands near 1/8 of the string, which nulls the 8th
      // partial — the strike point IS part of the piano's spectrum.
      Position: 0.125,
      // 0.42, down from the core's 0.62 default: at 0.62 this read "sharp
      // like a guitar", which is fair — the waveguide is shared with
      // `pluckedString` and a bright loop filter is a guitar's signature.
      // Brightness sets how fast highs die in the loop.
      Brightness: 0.42,
      'Decay s': 8,
      // Inharmonicity B in the tenor register; a piano's climbs toward both
      // ends of the keyboard.
      Stiffness: 0.00025,
      // Three strings a few cents apart: the unison group is what gives a
      // piano its two-stage decay and slow beating.
      Strings: 3,
      'Unison c': 3,
      // Softer felt than the default 0.5 — longer contact, darker strike.
      Hardness: 0.35,
      Octave: 0,
      Damp: 'on',
      // 0.4, down from 0.7 — about 4.6 dB softer.
      //
      // This is a LEVEL change and the comment should not pretend
      // otherwise. In principle velocity sets hammer contact time and so
      // changes timbre; measured on this instrument at C4 it barely does,
      // because there is almost nothing up there to remove. Energy above
      // 800 Hz is 0.01 % of the total at velocity 0.7 and 0.00 % at 0.3,
      // while RMS moves 6.4 dB over the same span. The strike is already
      // as dark as this voicing gets, so velocity is effectively the
      // volume control here.
      //
      // It is also the ONLY touch control the QWERTY keyboard can reach:
      // `allKeys` emits Gate and Hz per key and nothing else, so every
      // note fires at whatever this constant says. Playing softly for real
      // needs a velocity source — a MIDI keyboard, or a timeline curve
      // driving this input.
      Velocity: 0.4,
    },
  }));

  return buildState(
    [
      { id: 'pn-keys', type: 'allKeys', x: 40, y: 900 },
      ...voices,
      { id: 'pn-mix', type: 'mix', x: 1440, y: 900 },
      {
        id: 'pn-trim',
        type: 'gain',
        x: 1700,
        y: 900,
        // 1.0. Measured on the real chain with a four-note voicing: RMS
        // 0.0521 at the old 0.6 against 0.1135 here, about 7 dB louder,
        // with the four-note peak at 0.62 and an eight-note peak at 0.98
        // so only the densest chords reach `pn-limit` at all.
        values: { Gain: 1 },
      },
      {
        id: 'pn-hall',
        type: 'fdnReverb',
        x: 1960,
        y: 900,
        // The FDN, not `reverb`. `Tone.Reverb` is a convolution against a
        // FIXED decaying-noise impulse response: nothing to modulate, and no
        // per-band decay. Both are what the reference's reverb is made of.
        //
        // Measured on the reference (`piano_effects.py`): the
        // direct-to-reverberant ratio across all five nominated windows is
        // 0.6, 0.6, -0.0, -0.2 and -0.0 dB — the first 50 ms of a note
        // carries no more energy than the following 350 ms. A dry piano is
        // strongly positive there. So the reverb IS most of what is heard,
        // and `Mix` is high by measurement rather than by taste.
        values: {
          // Here `Decay s` genuinely IS T60 — the per-line gains solve for
          // it — unlike `reverb`, where it is the IR length and the real
          // T60 is 1.3038*ln(D+1).
          'Decay s': 7,
          // 2.2. The base delays are 23.7-71.3 ms, so this spreads them to
          // 52-157 ms: the wash builds over a longer window instead of
          // answering the attack immediately, which is most of what reads
          // as a big dreamy space rather than a room.
          Size: 2.2,
          // Dark: the reference window carries ~2 % of its energy above
          // 1 kHz.
          'Damping Hz': 2800,
          // The lushness. A static FDN rings metallically; sweeping the
          // delay lengths smears its modes.
          'Mod Rate Hz': 0.6,
          // 0.5 ms, NOT 4. Pitch deviation from a swept delay is
          // depth_samples * 2*pi*rate / fs, so at 0.6 Hz:
          //   0.5 ms ->  3.3 cents      2 ms -> 13.0 cents
          //   1   ms ->  6.5 cents      4 ms -> 25.9 cents
          // 4 ms was a quarter-semitone warble — heard as "wobbly, almost
          // cartoonish", and correctly so. 1 ms sits at 6.5 cents: audible
          // shimmer, well short of a warble.
          'Mod Depth ms': 1,
          Diffusion: 0.85,
          // Keep the piano's own low end out of the wash.
          'Low Cut Hz': 150,
          Width: 1,
          // 0.55. Cutting this to 0.3 was a mistake, and the reason is
          // one I could not have argued from the reverb alone: MIX IS ALSO
          // THE WIDTH CONTROL HERE. All 16 voices sum to a MONO signal, so
          // the dry path has no stereo at all and only the FDN's taps do.
          // Measured L/R correlation of the finished chain, where 1.0 is
          // mono and 0 is fully decorrelated:
          //
          //   Mix 0.30 -> 0.583      Mix 0.50 -> 0.191
          //   Mix 0.55 -> 0.320      Mix 0.70 -> 0.124
          //
          // At 0.3 roughly seventy per cent of what reaches the ear is
          // dead centre, which is exactly the "very narrow" it sounded.
          Mix: 0.55,
        },
      },
      {
        id: 'pn-limit',
        type: 'limiter',
        x: 2220,
        y: 900,
        // THE FIX FOR "distorts completely". 16 voices sum, and the render
        // meter pegging while the sound stays faint is what a clipped,
        // mostly-reverb signal looks like. A limiter bounds the sum instead
        // of letting it wrap.
        values: { 'Threshold dB': -1 },
      },
      {
        id: 'pn-render',
        type: 'render',
        x: 2480,
        y: 920,
        values: { 'Level dB': 0 },
      },
    ],
    [
      ...voices.flatMap((voice, index) => [
        {
          from: 'pn-keys',
          output: `${keyLabel(KEY_ORDER[index])} Hz`,
          to: voice.id,
          input: 'Hz',
        },
        {
          from: 'pn-keys',
          output: `${keyLabel(KEY_ORDER[index])} Gate`,
          to: voice.id,
          input: 'Gate',
        },
      ]),
      ...voices.map((voice) => ({
        from: voice.id,
        output: 'Out',
        to: 'pn-mix',
        input: 'In',
      })),
      { from: 'pn-mix', output: 'Out', to: 'pn-trim', input: 'In' },
      { from: 'pn-trim', output: 'Out', to: 'pn-hall', input: 'In' },
      { from: 'pn-hall', output: 'Out', to: 'pn-limit', input: 'In' },
      { from: 'pn-limit', output: 'Out', to: 'pn-render', input: 'In' },
    ],
  );
}

/**
 * One voice per key on the QWERTY row, into a short bus — the shape the
 * landing scenes play (2026-10-04: "Play the guitar" under the oak and the
 * Starry Pad under the sakura, next to "Play the piano"). The bus follows the
 * solo tails (`buildSoloGraph`): optional body, optional chorus, makeup gain,
 * reverb, a 30 Hz highpass, then a limiter, because sixteen-plus voices sum.
 */
function buildPerKeyGraph(
  prefix: string,
  voice: (index: number) => { type: SoundCatalogNodeTypeId; values: Record<string, unknown> },
  tail: {
    body?: 'guitar' | 'violin';
    chorus?: { rate: number; depth: number; wet: number };
    busGain: number;
    reverbDecay: number;
    reverbWet: number;
    renderDb: number;
  },
): ProbeState {
  const nodes: NodeSpec[] = [{ id: `${prefix}-keys`, type: 'allKeys', x: 40, y: 900 }];
  const edges: EdgeSpec[] = [];
  KEY_ORDER.forEach((key, index) => {
    const id = `${prefix}-v${index}`;
    const { type, values } = voice(index);
    nodes.push({ id, type, x: index % 2 === 0 ? 700 : 1060, y: Math.floor(index / 2) * 240, values });
    edges.push(
      { from: `${prefix}-keys`, output: `${keyLabel(key)} Hz`, to: id, input: 'Hz' },
      { from: `${prefix}-keys`, output: `${keyLabel(key)} Gate`, to: id, input: 'Gate' },
      { from: id, output: 'Out', to: `${prefix}-mix`, input: 'In' },
    );
  });
  nodes.push({ id: `${prefix}-mix`, type: 'mix', x: 1440, y: 900 });
  let last = `${prefix}-mix`;
  const chain = (node: NodeSpec) => {
    nodes.push(node);
    edges.push({ from: last, output: 'Out', to: node.id, input: 'In' });
    last = node.id;
  };
  if (tail.body !== undefined) chain({ id: `${prefix}-body`, type: 'stringBody', x: 1700, y: 900, values: { Preset: tail.body, Mix: 1 } });
  if (tail.chorus !== undefined) {
    chain({ id: `${prefix}-chorus`, type: 'chorus', x: 1700, y: 1120, values: { 'Rate Hz': tail.chorus.rate, Depth: tail.chorus.depth, Wet: tail.chorus.wet } });
  }
  chain({ id: `${prefix}-makeup`, type: 'gain', x: 1960, y: 900, values: { Gain: tail.busGain } });
  chain({ id: `${prefix}-verb`, type: 'reverb', x: 2220, y: 900, values: { 'Decay s': tail.reverbDecay, 'PreDelay s': 0.02, Wet: tail.reverbWet } });
  chain({ id: `${prefix}-out`, type: 'filter', x: 2480, y: 900, values: { Type: 'highpass', Freq: 30, Q: 0.7 } });
  chain({ id: `${prefix}-limit`, type: 'limiter', x: 2740, y: 900, values: { 'Threshold dB': -1 } });
  chain({ id: `${prefix}-render`, type: 'render', x: 3000, y: 920, values: { 'Level dB': tail.renderDb } });
  return buildState(nodes, edges);
}

/**
 * The guitar the landing's "Play the guitar" plays: the Instrument library's
 * physical guitar string (`GUITAR_STRING`) picked with a nail, one per key,
 * into the shared guitar body. Tail as the "Back Porch Run" solo (a small
 * room: a steel-string wants a room, not a hall), so the scene sounds like
 * the guitar the app's demos already use.
 */
function buildGuitarKeysGraph(): ProbeState {
  return buildPerKeyGraph(
    'gk',
    () => ({
      type: 'pluckedString',
      values: {
        Position: GUITAR_STRING.positionBeta,
        Brightness: GUITAR_STRING.brightness,
        'Decay s': GUITAR_STRING.decaySec,
        Stiffness: GUITAR_STRING.stiffness,
        Polarization: GUITAR_STRING.polarization,
        Damp: 'on',
        Pick: 'nail',
      },
    }),
    { body: 'guitar', busGain: 24, reverbDecay: 1.6, reverbWet: 0.18, renderDb: -5 },
  );
}

/**
 * The Starry Pad, one voice per key — what the landing's sakura scene plays
 * (Deepak: "starry pad set to a lower octave, will decide the instrument
 * later"; the scene shifts the keyboard down an octave, this graph stays at
 * the keyboard's octave). Tail as the "Starfield" solo minus its cutoff ride.
 */
function buildStarryPadKeysGraph(): ProbeState {
  return buildPerKeyGraph(
    'sp',
    () => ({ type: 'inst_starryPad' as SoundCatalogNodeTypeId, values: {} }),
    { chorus: { rate: 0.3, depth: 0.7, wet: 0.45 }, busGain: 3, reverbDecay: 5.5, reverbWet: 0.55, renderDb: -7 },
  );
}

function buildDreamyPadGraph(): ProbeState {
  // One shared, transposed pitch feeds every chord tone, and each interval is
  // a constant `Detune` in CENTS. An equal-tempered ratio is the same number
  // of cents at any pitch, so the voicing holds on every key and costs zero
  // extra nodes — where per-voice pitch chains would have cost three each.
  const voices = PAD_CHORD.map((voice, index) => ({
    id: `pd-v${index}`,
    type: 'oscillator' as const,
    x: 1060,
    y: 60 + index * 150,
    values: {
      Shape: 'sine' as const,
      Detune: voice.cents,
      Level: voice.level,
    },
  }));

  return buildState(
    [
      { id: 'pd-key', type: 'keyboardPitch', x: 40, y: 660 },
      // x0.25 puts the chord in the reference's register. The target root is
      // ~87.5 Hz (about F2) and the keyboard's home window is C4-D#5, so
      // holding F4 (349.2 Hz) lands the root on 87.3 Hz. `gain` takes AUDIO,
      // hence the toAudio/toSignal round trip.
      { id: 'pd-rootA', type: 'toAudio', x: 300, y: 660 },
      { id: 'pd-rootG', type: 'gain', x: 540, y: 660, values: { Gain: 0.25 } },
      { id: 'pd-rootS', type: 'toSignal', x: 780, y: 660 },
      ...voices,
      { id: 'pd-mix', type: 'mix', x: 1400, y: 660 },
      {
        id: 'pd-env',
        type: 'adsr',
        x: 1660,
        y: 660,
        // 21 ms attack is the measured 10-90 % rise. Sustain 1: the bed holds
        // while a key is down. Gate UNCONNECTED = legacy keyboard-bus mode.
        values: {
          'Attack s': 0.021,
          'Decay s': 0.35,
          Sustain: 1,
          'Release s': 2.5,
        },
      },
      {
        id: 'pd-chorus',
        type: 'chorus',
        x: 1920,
        y: 660,
        // `Tone.Chorus` is inherently STEREO, so this supplies the width that
        // an earlier build spent six hand-panned nodes on, AND the movement a
        // stack of static sines has none of. Slow and deep: 0.5 Hz is under
        // the rate you hear as vibrato, which keeps it a wash.
        values: { 'Rate Hz': 0.5, 'Delay ms': 12, Depth: 0.7, Wet: 0.55 },
      },
      // A master sum before the hall. Kept from the short-lived "deep onset"
      // variant so anything added later can join the tail without passing
      // through the chorus.
      { id: 'pd-master', type: 'mix', x: 2180, y: 660 },
      {
        id: 'pd-hall',
        type: 'reverb',
        x: 2440,
        y: 660,
        // `Decay s` 8 is a real T60 of 2.86 s — T60 = 1.3038*ln(D+1), see the
        // law documented on the reverb node in `effectTable.ts`.
        values: { 'Decay s': 8, 'PreDelay s': 0.04, Wet: 0.5 },
      },
      {
        id: 'pd-render',
        type: 'render',
        x: 2700,
        y: 680,
        values: { 'Level dB': -8 },
      },
    ],
    [
      { from: 'pd-key', output: 'Hz', to: 'pd-rootA', input: 'In' },
      { from: 'pd-rootA', output: 'Out', to: 'pd-rootG', input: 'In' },
      { from: 'pd-rootG', output: 'Out', to: 'pd-rootS', input: 'In' },
      ...voices.map((voice) => ({
        from: 'pd-rootS',
        output: 'Out',
        to: voice.id,
        input: 'Frequency',
      })),
      ...voices.map((voice) => ({
        from: voice.id,
        output: 'Out',
        to: 'pd-mix',
        input: 'In',
      })),
      { from: 'pd-mix', output: 'Out', to: 'pd-env', input: 'In' },
      { from: 'pd-env', output: 'Out', to: 'pd-chorus', input: 'In' },
      { from: 'pd-chorus', output: 'Out', to: 'pd-master', input: 'In' },
      { from: 'pd-master', output: 'Out', to: 'pd-hall', input: 'In' },
      { from: 'pd-hall', output: 'Out', to: 'pd-render', input: 'In' },
    ],
  );
}


// ── Pads fitted to ONE section each ──────────────────────────────────
//
// `PAD_CHORD` above was peak-picked from the WHOLE 0-22 s target, and that was
// the same mistake twice: the bed is not stationary, so the union of its peaks
// is not a chord. Sectioning it
// (`samples/analysis/reference/pad_sections.py`) shows two different sounds:
//
//     band          A 0-10 s   B 10-15 s
//     80-140 Hz        5.92 %     58.19 %      +52.3 pp
//     140-250 Hz      54.40 %     27.82 %
//     250-400 Hz      37.53 %     13.33 %
//     centroid        218.7 Hz    163.7 Hz
//     chroma cosine        0.737   (1.00 would be identical harmony)
//     onsets/s              8.70       4.40
//
// 87.5 Hz never sounds in A and 109.0 Hz never sounds in B. Read across the
// whole file they look like one chord with a major third; they are two roots
// in two sections. Each table below is fitted to its OWN window: levels are
// the sqrt of the measured energy share normalised to that window's loudest
// partial, intervals snapped to equal temperament (every measured tone lands
// within ~25 cents, consistently a touch sharp).
type PadChordVoice = { cents: number; level: number; note: string };

/** A2 E3 A3 B3 C4 E4 B4 — A minor with its ninth. */
const PAD_A_CHORD: PadChordVoice[] = [
  { cents: 0, level: 0.415, note: 'A2 root' },
  { cents: 700, level: 0.884, note: 'E3 fifth' },
  { cents: 1200, level: 0.12, note: 'A3 octave' },
  { cents: 1400, level: 0.707, note: 'B3 ninth' },
  { cents: 1500, level: 1.0, note: 'C4 minor third' },
  { cents: 1900, level: 0.134, note: 'E4 fifth + octave' },
  { cents: 2600, level: 0.207, note: 'B4 ninth + octave' },
];


/**
 * A pad fitted to one measured section, optionally with the low-end onset.
 *
 * Deliberately SEPARATE from `buildDreamyPadGraph` rather than a flag on it.
 * The original pad is not to be disturbed, and sharing a builder would put its
 * behaviour one careless default away from changing.
 */
function buildFittedPadGraph(options: { chord: PadChordVoice[] }): ProbeState {
  const { chord } = options;
  const voices = chord.map((voice, index) => ({
    id: `fp-v${index}`,
    type: 'oscillator' as const,
    x: 1060,
    y: 60 + index * 150,
    values: {
      Shape: 'sine' as const,
      Detune: voice.cents,
      Level: voice.level,
    },
  }));

  return buildState(
    [
      { id: 'fp-key', type: 'keyboardPitch', x: 40, y: 660 },
      // x0.25 lands the root two octaves below the key held, which is where
      // both sections sit (A2 = 109 Hz, F2 = 87.5 Hz) against a keyboard whose
      // home window is C4-D#5. `gain` takes AUDIO, hence the round trip.
      { id: 'fp-rootA', type: 'toAudio', x: 300, y: 660 },
      { id: 'fp-rootG', type: 'gain', x: 540, y: 660, values: { Gain: 0.25 } },
      { id: 'fp-rootS', type: 'toSignal', x: 780, y: 660 },
      ...voices,
      { id: 'fp-mix', type: 'mix', x: 1400, y: 660 },
      {
        id: 'fp-env',
        type: 'adsr',
        x: 1660,
        y: 660,
        values: {
          'Attack s': 0.021,
          'Decay s': 0.35,
          Sustain: 1,
          'Release s': 2.5,
        },
      },
      {
        id: 'fp-chorus',
        type: 'chorus',
        x: 1920,
        y: 660,
        values: { 'Rate Hz': 0.5, 'Delay ms': 12, Depth: 0.7, Wet: 0.55 },
      },
        // THE BASS IS A PHYSICALLY MODELLED STRING, not an oscillator.
        //
        // The first attempt was a sine sub plus a triangle at the root
        // through a saturator, and Deepak's verdict was "a plate with a
        // ting sound". That is what the parts add up to: a triangle is all
        // ODD harmonics, and saturating a 55 Hz sine manufactures partials
        // at 110, 165, 220 Hz — landing exactly on this chord's own tones,
        // so the sub beats against the pad instead of underpinning it. The
        // metallic attack is the 20 ms onset of that harmonic stack.
        //
        // A real bass string decays its highs away within the first
        // moments and leaves a fundamental that rings, which is both the
        // sound asked for and the ONSET-then-fade the section measures.
        // The string's own `Decay s` IS the fade, so no extra envelope.
        //
        // Voiced against the guitar patch, which uses Position 0.13-0.18,
        // Brightness 0.72-0.82, Decay 4-4.5, Pick 'nail'. Every value here
        // moves the other way: plucked nearer the middle, dark, long, and
        // with the flesh of a finger rather than a nail.
        {
          id: 'fp-bass',
          type: 'pluckedString' as const,
          x: 1400,
          y: 1390,
          values: {
            // Position 0.28. This was the ORIGINAL value, changed to 0.35
            // on the strength of a measurement that turned out to be an
            // artifact (see `fp-bassSat`), and changed back once the
            // reference was measured unfiltered. At 0.28 the string gives
            // h2 -4.5 / h3 -15.1 dB against the reference's actual
            // -2.7 / -18.3. At 0.35 it gave -7.4 / -24.8, far too dull.
            // 0.24. The reference's h2 sits just -0.8 dB under its
            // fundamental — a second harmonic that strong is what makes a
            // bass read as present and "clear". Moving the strike toward
            // the bridge raises h2, but it raises h3 faster: at 0.12 h2
            // reaches -2.0 while h3 blows out to -6.3 against a -16.0
            // target. 0.24 takes h2 from -5.2 to -4.1 and keeps h3 at
            // -13.0. The last ~4 dB on h2 is the loop filter's loss and is
            // not reachable from here — Brightness moves it under 1 dB.
            Position: 0.24,
            // Sets how fast highs die in the LOOP, which is what shapes
            // h6+ (the reference rolls off to -42 dB by h6). It does not
            // set the excitation spectrum — sweeping it 0.38 -> 0.00 moves
            // h2 by only 0.9 dB.
            Brightness: 0.35,
            // 2.0 s, not 9. The reference's low band is re-struck every
            // 0.14 s (median), so a 9 s ring would pile note on note into
            // mush — and it did: "too long". Measured per-note T60 on the
            // isolated low band, from the -6 dB point in the usable gaps,
            // is 1.65 s median (n=7, p25 1.25, p75 4.23 — thin, because
            // few notes get a clean gap, so this is indicative rather than
            // precise). 2.0 sits just above the median for a little tail.
            'Decay s': 2,
            // A wound bass string is stiff enough to hear.
            Stiffness: 0.0001,
            // High polarization: the two-stage decay and slow beating that
            // make a bass ring rather than simply stop.
            Polarization: 0.85,
            Pick: 'finger',
            Damp: 'on',
            // An octave below the chord root — 55 Hz when the root is 110.
            // Octave 0, NOT -1. At -1 the bass sat an octave under the
            // root, which is 32.7 Hz when C4 is held — under what most
            // playback reproduces at all. The measurement also points
            // here: the band that surges and fades is 80-140 Hz (17.3 %
            // at the attack against 6.6 % sustained), and 45-80 Hz carries
            // 0.11 %. The root region IS the "deep bass"; the octave below
            // it is nearly silent in the reference too.
            Octave: 0,
            // Amp is a DYNAMIC, not a volume. `interpolateShape` maps 0.25
            // to pianissimo and 1.0 to fortissimo, and ABOVE 1.0 the shape
            // stops changing (`Math.min(1, level)`) while the amplitude
            // keeps scaling — so Amp cannot make a loud DARK pluck. 0.6
            // buys the dark excitation; `fp-bassGain` supplies the level.
            Amp: 0.6,
          },
        },
        // `pluckedString.Gate` has NO keyboard-bus fallback — unlike the
        // ADSR, `connectGateTo` simply returns when Gate is unconnected and
        // the string never fires. So the gate is derived from the bus the
        // ratified way: a constant through a legacy-mode ADSR (which IS
        // keyboard-bus triggered) and back to a signal, then a Schmitt
        // trigger, the one sanctioned signal->gate crossing.
        {
          id: 'fp-bassOne',
          type: 'constant' as const,
          x: 40,
          y: 1390,
          values: { Value: 1 },
        },
        { id: 'fp-bassA', type: 'toAudio' as const, x: 300, y: 1390 },
        {
          id: 'fp-bassEnv',
          type: 'adsr' as const,
          x: 540,
          y: 1390,
          // Shapes a GATE, not a sound: square-ish, so the threshold has a
          // clean edge to trigger on.
          values: {
            'Attack s': 0.005,
            'Decay s': 0.02,
            Sustain: 1,
            'Release s': 0.02,
          },
        },
        { id: 'fp-bassS', type: 'toSignal' as const, x: 780, y: 1390 },
        {
          id: 'fp-bassGate',
          type: 'threshold' as const,
          x: 1060,
          y: 1390,
          values: { Threshold: 0.5, Hysteresis: 0.1 },
        },
        // Cutoff tracker, tapped off `fp-rootA` (the AUDIO copy of the
        // raw key pitch, because `gain` takes audio, not signal).
        // 0.25 is the transpose, 3.0 the cutoff ratio -> fc = 3 x root,
        // i.e. sitting ON h3 so h1 and h2 pass untouched.
        {
          id: 'fp-bassFcG',
          type: 'gain' as const,
          x: 540,
          y: 1560,
          values: { Gain: 0.75 },
        },
        { id: 'fp-bassFcS', type: 'toSignal' as const, x: 780, y: 1560 },
        {
          id: 'fp-bassLp',
          type: 'filter' as const,
          x: 1400,
          y: 1560,
          // `Freq` is DRIVEN by `fp-bassFcS`, so the cutoff tracks pitch
          // and the timbre is the same on every key.
          //
          // fc = 3 x root, NOT the 0.7 x root this once was. The earlier
          // value came from measuring the reference on a file this repo
          // had already lowpassed at 140 Hz, which reported h2 (175 Hz) at
          // -20.3 dB — it had filtered out the partial it was reporting.
          // Measured unfiltered, h2 is -2.7 dB: nearly as loud as the
          // fundamental, and THAT dominant second harmonic is what reads
          // as "distorted, stringy and clear". The old filter destroyed
          // exactly the partial that carries the character.
          //
          // What genuinely needs taming is h3 and above. Reference vs our
          // raw string:  h3 -18.3/-15.1   h4 -29.8/-20.9   h5 -24.6/-16.5
          // h6 -42.0/-21.4. A 2-pole at 3 x root is flat through h2 and
          // takes roughly -3/-8/-12/-16 dB off h3..h6, which is the shape
          // that gap asks for.
          //
          // NO SATURATOR. One was tried here, because the reference's h4
          // (350 Hz) and h5 (437.5 Hz) are not tones of the chord above
          // and so must be distortion products. But measured at Drive 1 —
          // effectively bypass — our string ALREADY carries more h4/h5/h6
          // than the reference. Adding a tanh stage moved every one of
          // them further from target, so the honest fix is subtractive.
          values: { Type: 'lowpass', Q: 0.7 },
        },
        {
          id: 'fp-bassSoft',
          type: 'adsr' as const,
          x: 1660,
          y: 1560,
          // ONSET ONLY. Sustain 1 so the string's own `Decay s` still
          // provides the fade — this exists purely to blunt the pluck
          // transient. Measured on the reference away from the track's
          // fade-in, its low band rises 10-90 % in 34 ms median; ours was
          // 2.7-3.5 ms, and that sharp arrival is what "stands out" is.
          values: {
            'Attack s': 0.032,
            'Decay s': 0.1,
            Sustain: 1,
            'Release s': 2.0,
          },
        },
        {
          id: 'fp-bassGain',
          type: 'gain' as const,
          x: 1920,
          y: 1560,
          // MEASURED, not guessed, and revised twice.
          //
          // The branch is quiet by construction: the tracked lowpass takes
          // ~7 dB off the fundamental, Amp 0.6 is a deliberately soft
          // pluck, and the 32 ms ramp shaves the transient. Rendered at
          // unity the chain peaks at 0.033 against a chord that peaks near
          // 3.2 — which is why "too weak" survived a first correction from
          // 16 to 21.
          //
          // 90 is PEAK PARITY with the chord, measured across C4..C5
          // (88-98x, mean 93). Two independent metrics agree it is right:
          // matching long-term RMS instead asks for 110. Note the target
          // itself needed care — the reference bass sits 4.2 dB under its
          // pad, but it reaches that as a CONTINUOUS line re-struck every
          // 0.14 s, where ours is one decaying note per press. Peak is the
          // honest metric for a note that decays; RMS flatters a drone.
          // 80, deliberately ABOVE the measured peak parity of 51.
          // Parity makes the bass exactly as loud at its attack as the
          // chord, and by ear that still read as not prominent enough. 80
          // is +3.9 dB over parity: since the string DECAYS while the
          // chord sustains, this buys a strong arrival that then recedes
          // rather than a bass that sits on top of everything.
          values: { Gain: 80 },
        },
      // Master sum so the sub branch can bypass the chorus — chorusing a sub
      // smears its pitch and muddies the band the layer exists to deliver.
      { id: 'fp-master', type: 'mix', x: 2180, y: 660 },
      {
        id: 'fp-hall',
        type: 'reverb',
        x: 2440,
        y: 660,
        // `Decay s` 8 is a real T60 of 2.86 s — T60 = 1.3038*ln(D+1). See the
        // law documented on the reverb node in `effectTable.ts`.
        values: { 'Decay s': 8, 'PreDelay s': 0.04, Wet: 0.5 },
      },
      {
        id: 'fp-render',
        type: 'render',
        x: 2700,
        y: 680,
        values: { 'Level dB': -8 },
      },
    ],
    [
      { from: 'fp-key', output: 'Hz', to: 'fp-rootA', input: 'In' },
      { from: 'fp-rootA', output: 'Out', to: 'fp-rootG', input: 'In' },
      { from: 'fp-rootG', output: 'Out', to: 'fp-rootS', input: 'In' },
      ...voices.map((voice) => ({
        from: 'fp-rootS',
        output: 'Out',
        to: voice.id,
        input: 'Frequency',
      })),
      ...voices.map((voice) => ({
        from: voice.id,
        output: 'Out',
        to: 'fp-mix',
        input: 'In',
      })),
      { from: 'fp-mix', output: 'Out', to: 'fp-env', input: 'In' },
      { from: 'fp-env', output: 'Out', to: 'fp-chorus', input: 'In' },
      { from: 'fp-chorus', output: 'Out', to: 'fp-master', input: 'In' },
        { from: 'fp-bassOne', output: 'Out', to: 'fp-bassA', input: 'In' },
        { from: 'fp-bassA', output: 'Out', to: 'fp-bassEnv', input: 'In' },
        { from: 'fp-bassEnv', output: 'Out', to: 'fp-bassS', input: 'In' },
        { from: 'fp-bassS', output: 'Out', to: 'fp-bassGate', input: 'In' },
        { from: 'fp-bassGate', output: 'Gate', to: 'fp-bass', input: 'Gate' },
        { from: 'fp-rootS', output: 'Out', to: 'fp-bass', input: 'Hz' },
        { from: 'fp-rootA', output: 'Out', to: 'fp-bassFcG', input: 'In' },
        { from: 'fp-bassFcG', output: 'Out', to: 'fp-bassFcS', input: 'In' },
        { from: 'fp-bassFcS', output: 'Out', to: 'fp-bassLp', input: 'Freq' },
        { from: 'fp-bass', output: 'Out', to: 'fp-bassLp', input: 'In' },
        { from: 'fp-bassLp', output: 'Out', to: 'fp-bassSoft', input: 'In' },
        { from: 'fp-bassSoft', output: 'Out', to: 'fp-bassGain', input: 'In' },
        { from: 'fp-bassGain', output: 'Out', to: 'fp-master', input: 'In' },
      { from: 'fp-master', output: 'Out', to: 'fp-hall', input: 'In' },
      { from: 'fp-hall', output: 'Out', to: 'fp-render', input: 'In' },
    ],
  );
}


/**
 * Both heartbeats share one anatomy and differ only in voicing.
 *
 * The rate is fixed at Run: `pulser.Rate Hz` is a `number` input, read once, so
 * it cannot be automated. A heartbeat that accelerates would need a different
 * phase source entirely.
 */
/**
 * All three heartbeats share one anatomy — a phase ramp, two Schmitt triggers,
 * two damped thuds — and differ in voicing.
 *
 * The rate is fixed at Run: `pulser.Rate Hz` is a `number` input, read once, so
 * it cannot be automated. A heartbeat that accelerates needs a different phase
 * source entirely.
 */
function buildHeartbeat(
  flavour: 'clinical' | 'cinematic' | 'deep',
): ProbeState {
  const deep = flavour === 'deep';
  const cinematic = flavour === 'cinematic';

  // 72 bpm resting; 54 slow and filmic; 63 for the produced one, which wants
  // to feel like a track's pulse rather than a patient's.
  const rateHz = deep ? 1.05 : cinematic ? 0.9 : 1.2;
  const s1Hz = deep ? 52 : cinematic ? 26 : 44;
  const s2Hz = deep ? 70 : cinematic ? 38 : 62;
  // The produced one is TIGHT: the sub carries the weight, so the valve sounds
  // are kept short or they turn the low end to mud.
  const s1Decay = deep ? 0.13 : cinematic ? 0.34 : 0.16;
  const s2Decay = deep ? 0.1 : cinematic ? 0.26 : 0.12;
  // 8 ms, never 0. An instant attack is the discontinuity that made the
  // original build read as a square wave.
  const attack = 0.008;

  // WHERE S2 FIRES IS DERIVED, NOT HARDCODED.
  //
  // Systole is NOT a fixed fraction of the cycle. It follows the measured
  // clinical relation `systole_ms ~= 400 - 1.2*bpm`, which is far FLATTER than
  // proportional: as the heart slows, diastole lengthens and systole barely
  // moves. Reusing one phase split across flavours put the 54 bpm version 87 ms
  // out — an audibly evenly-spaced beat, i.e. the exact fault being fixed.
  const bpm = rateHz * 60;
  const cycleMs = 60000 / bpm;
  const systoleMs = 400 - 1.2 * bpm;
  // Each Threshold fires when the ramp rises past `Threshold + Hysteresis/2`.
  const hysteresis = 0.02;
  // S1 SITS AT 0.20, NOT 0.04, AND THAT IS NOT A TASTE CHOICE.
  //
  // `pulser` is a Tone.LFO over a NATIVE band-limited sawtooth, and a
  // band-limited step rings: the Gibbs overshoot after the reset is a fixed
  // fraction of the jump, independent of how many partials the browser uses.
  // Measured by rendering the real oscillator in an OfflineAudioContext at all
  // three rates, the ramp lands at 0 for ~0.3 ms and then RINGS UP TO 0.1247
  // before settling.
  //
  // With S1 at 0.04 (fire above 0.05, release below 0.03) that ripple cleared
  // the rising threshold ~0.5 ms after the reset and the gate then STAYED high
  // for the rest of the cycle — so the intended crossing at phase 0.04 never
  // produced an edge at all, and S1 actually fired 33 ms (clinical) / 44 ms
  // (cinematic) / 38 ms (deep) EARLY. Systole came out that much too long,
  // which is the one number this whole build is derived from.
  //
  // 0.20 puts the release point at 0.19, comfortably above the 0.1247 ripple
  // peak, so the gate genuinely goes low at the reset and rises only when the
  // ramp truly arrives. WHERE the pair sits in the cycle is arbitrary — the
  // patch loops — but the INTERVAL between them is the physiology, and that is
  // preserved because s2Phase is derived from s1Phase.
  const s1Phase = 0.2;
  const s2Phase = s1Phase + systoleMs / cycleMs;

  const nodes: NodeSpec[] = [
    {
      id: 'hb-phase',
      type: 'pulser',
      x: 40,
      y: 300,
      values: {
        Shape: 'sawtooth',
        'Rate Hz': rateHz,
        Amplitude: 0.5,
        Offset: 0.5,
      },
    },
    {
      id: 'hb-t1',
      type: 'threshold',
      x: 420,
      y: 120,
      values: { Threshold: s1Phase - hysteresis / 2, Hysteresis: hysteresis },
    },
    {
      id: 'hb-t2',
      type: 'threshold',
      x: 420,
      y: 500,
      values: { Threshold: s2Phase - hysteresis / 2, Hysteresis: hysteresis },
    },
    {
      id: 'hb-s1Tone',
      type: 'oscillator',
      x: 800,
      y: 40,
      values: { Shape: 'sine', Frequency: s1Hz, Level: deep ? 0.55 : 0.9 },
    },
    {
      id: 'hb-s1Noise',
      type: 'noise',
      x: 800,
      y: 200,
      values: { Type: 'brown', Level: deep ? 0.18 : cinematic ? 0.3 : 0.22 },
    },
    { id: 'hb-s1Mix', type: 'mix', x: 1120, y: 120 },
    {
      id: 'hb-s1Env',
      type: 'adsr',
      x: 1440,
      y: 120,
      values: {
        Trigger: 'rising',
        'Attack s': attack,
        'Decay s': s1Decay,
        Sustain: 0,
        'Release s': 0.05,
      },
    },
    {
      id: 'hb-s2Tone',
      type: 'oscillator',
      x: 800,
      y: 420,
      values: { Shape: 'sine', Frequency: s2Hz, Level: deep ? 0.4 : 0.62 },
    },
    {
      id: 'hb-s2Noise',
      type: 'noise',
      x: 800,
      y: 580,
      values: { Type: 'brown', Level: deep ? 0.13 : cinematic ? 0.22 : 0.16 },
    },
    { id: 'hb-s2Mix', type: 'mix', x: 1120, y: 500 },
    {
      id: 'hb-s2Env',
      type: 'adsr',
      x: 1440,
      y: 500,
      values: {
        Trigger: 'rising',
        'Attack s': attack,
        'Decay s': s2Decay,
        Sustain: 0,
        'Release s': 0.05,
      },
    },
    { id: 'hb-sum', type: 'mix', x: 1780, y: 300 },
    {
      id: 'hb-chest',
      type: 'filter',
      x: 2100,
      y: 300,
      values: {
        Type: 'peaking',
        // A PEAKING FILTER AT 0 dB IS A WIRE. `Gain dB` defaults to 0, and
        // this node never set it, so the "chest cavity" did nothing at all in
        // any flavour. Measured in-app: hb-sum and hb-lp had IDENTICAL band
        // profiles (0-60 Hz -21, 60-180 Hz -33) on either side of it.
        //
        // With a real gain it does its actual job, which matters more than
        // decoration: it puts energy in the 110-150 Hz region, which is the
        // lowest band a laptop or phone speaker can actually reproduce.
        Freq: deep ? 150 : cinematic ? 110 : 140,
        Q: 1.2,
        'Gain dB': 7,
      },
    },
    // ── TRANSLATION ─────────────────────────────────────────────────────
    // THE PROBLEM THIS SOLVES, measured rather than guessed: the heart sounds
    // put essentially all of their energy below 60 Hz (cinematic measured
    // -22 dB in 0-60 Hz against -33 dB in 60-180 Hz). The signal itself is
    // CLEAN — master peak 0.35, no clipping, no discontinuity, max
    // sample-to-sample delta 0.00185 against the 0.0012 a 26 Hz sine implies.
    //
    // But no laptop or phone speaker reproduces 26 Hz. Cone excursion for a
    // given loudness goes as 1/f^2, so a 26 Hz tone demands ~5.7x the
    // excursion of a 62 Hz one; the driver bottoms out and what you hear is
    // its mechanical distortion, not the heartbeat. Hence "glitchy".
    //
    // The fix is the standard one: generate HARMONICS of the fundamental.
    // The ear reconstructs the missing fundamental from them, so the beat is
    // perceived at its true pitch on a speaker that cannot produce that pitch
    // at all — and the harmonics need almost no excursion.
    //
    // Safe here in a way it was NOT on the Starry Night pad (see HANDOFF
    // 2026-09-06 v2, where a master saturator manufactured harmonics foreign
    // to the chord): a heartbeat is UNPITCHED percussion. There is no harmony
    // for its harmonics to clash with.
    {
      id: 'hb-translate',
      type: 'saturator',
      x: 2260,
      y: 300,
      values: { Drive: 2.4, Trim: 0.9, Wet: 0.55 },
    },
    {
      id: 'hb-lp',
      type: 'filter',
      x: 2420,
      y: 300,
      values: {
        Type: 'lowpass',
        // Raised across the board. The old corners (180 Hz on the cinematic
        // one) cut away the very harmonics that make a sub-bass thump
        // AUDIBLE rather than merely present.
        Freq: deep ? 520 : cinematic ? 340 : 420,
        Q: 0.7,
      },
    },
    // Every path meets HERE, not on the cut. `filter.In` is maxConnections 1
    // and `readAudioChain` returns exactly ONE chain, so feeding the highpass
    // directly silently DISCARDED the valve bus and the click and left only
    // the sub. Summing first is the only way all three survive.
    { id: 'hb-outSum', type: 'mix', x: 2740, y: 300 },
    // ── THE EXCURSION CUT ───────────────────────────────────────────────
    // 55 Hz, NOT 30, AND Q = -3, NOT 0.7. The first version of this cut did
    // not cut anything:
    //   - at 30 Hz it sat BELOW almost all the offending energy (the cinematic
    //     S1 fundamental is 26 Hz, S2 is 38 Hz), so the band that actually
    //     moves the cone passed straight through; and
    //   - Web Audio interprets `Q` on lowpass/highpass in DECIBELS, so Q 0.7
    //     is a +0.7 dB resonant LIFT at the corner — it was boosting the very
    //     band it was supposed to remove. Q = 0 dB is the FLATTEST value this
    //     node can take: true Butterworth would be -3.01 dB (10^(-3/20) =
    //     0.707), but Tone's Filter clamps `Q` to >= 0 and a negative value
    //     throws at Run ("Value must be within [0, 3.4e38], got: -3"),
    //     verified live. 0 dB leaves ~1.25 dB of corner lift, which is the
    //     best available and far better than the +0.7 dB ON TOP of that.
    // Measured before this change: the translation stage raised 0-60 Hz by
    // ~+4.7 dB, so the sub reaching the speaker ended up HOTTER than before
    // the "fix" — the opposite of the intent. The harmonics generated upstream
    // are what carry the pitch now (the ear reconstructs a missing
    // fundamental), so cutting the fundamental costs perceived depth far less
    // than it costs cone travel.
    {
      id: 'hb-out',
      type: 'filter',
      x: 2900,
      y: 300,
      values: { Type: 'highpass', Freq: 55, Q: 0 },
    },
  ];

  const edges: EdgeSpec[] = [
    { from: 'hb-phase', output: 'Out', to: 'hb-t1', input: 'In' },
    { from: 'hb-phase', output: 'Out', to: 'hb-t2', input: 'In' },

    { from: 'hb-s1Tone', output: 'Out', to: 'hb-s1Mix', input: 'In' },
    { from: 'hb-s1Noise', output: 'Out', to: 'hb-s1Mix', input: 'In' },
    { from: 'hb-s1Mix', output: 'Out', to: 'hb-s1Env', input: 'In' },
    { from: 'hb-t1', output: 'Gate', to: 'hb-s1Env', input: 'Gate' },

    { from: 'hb-s2Tone', output: 'Out', to: 'hb-s2Mix', input: 'In' },
    { from: 'hb-s2Noise', output: 'Out', to: 'hb-s2Mix', input: 'In' },
    { from: 'hb-s2Mix', output: 'Out', to: 'hb-s2Env', input: 'In' },
    { from: 'hb-t2', output: 'Gate', to: 'hb-s2Env', input: 'Gate' },

    { from: 'hb-s1Env', output: 'Out', to: 'hb-sum', input: 'In' },
    { from: 'hb-s2Env', output: 'Out', to: 'hb-sum', input: 'In' },
    { from: 'hb-sum', output: 'Out', to: 'hb-chest', input: 'In' },
    { from: 'hb-chest', output: 'Out', to: 'hb-translate', input: 'In' },
    { from: 'hb-translate', output: 'Out', to: 'hb-lp', input: 'In' },
  ];

  if (deep) {
    // ── THE 808 MOVE ────────────────────────────────────────────────────
    // What separates a PRODUCED heartbeat from a filmic one is not depth —
    // both are deep — it is that the sub DROPS IN PITCH. A static sine reads
    // as a rumble; a sine that falls 60 Hz -> 26 Hz in 55 ms reads as a kick,
    // and that is the sound a music video is built on.
    //
    // The drop is driven by its OWN short envelope, not by the sub's
    // amplitude envelope. That is the whole trick: pitch settles in ~55 ms
    // while the note rings for ~500 ms, so the ear hears a hard attack
    // followed by a sustained low tone rather than a siren sliding down.
    //
    // `adsr.Env` is only live in GATE mode — in legacy mode it is a constant
    // 0. This envelope is gate-driven (from the same S1 threshold), so `Env`
    // is the worklet's real output and needs no audio input at all.
    //
    //   Frequency = constant(26) + Env(0..1) x 34   ->   60 Hz ... 26 Hz
    //
    // Signals SUM on a signal input, which is what makes the offset+scale
    // work without any arithmetic node.
    nodes.push(
      {
        id: 'hb-pitchEnv',
        type: 'adsr',
        x: 800,
        y: 900,
        values: {
          Trigger: 'rising',
          'Attack s': 0.002,
          'Decay s': 0.055,
          Sustain: 0,
          'Release s': 0.04,
        },
      },
      { id: 'hb-pitchAudio', type: 'toAudio', x: 1120, y: 900 },
      {
        id: 'hb-pitchDepth',
        type: 'gain',
        x: 1440,
        y: 900,
        values: { Gain: 34 },
      },
      { id: 'hb-pitchSig', type: 'toSignal', x: 1780, y: 900 },
      { id: 'hb-subBase', type: 'constant', x: 1780, y: 1060, values: { Value: 26 } },
      {
        id: 'hb-subTone',
        type: 'oscillator',
        x: 2100,
        y: 960,
        values: { Shape: 'sine', Level: 1 },
      },
      {
        id: 'hb-subEnv',
        type: 'adsr',
        x: 2420,
        y: 960,
        values: {
          Trigger: 'rising',
          'Attack s': 0.004,
          'Decay s': 0.5,
          Sustain: 0,
          'Release s': 0.12,
        },
      },
      // 22 Hz is below what most speakers move at all. Clipping folds energy
      // into the odd harmonics (3f, 5f...) which DO reproduce, so the weight
      // survives on a laptop. It is a hard clipper, so Drive stays modest.
      {
        id: 'hb-subDrive',
        type: 'saturator',
        x: 2740,
        y: 960,
        values: { Drive: 2.2, Trim: 0.8, Wet: 0.75 },
      },
      // ── THE CLICK ──────────────────────────────────────────────────────
      // A produced kick has a transient on top so it reads on phone speakers
      // that cannot reproduce the sub at all. 18 ms of highpassed noise.
      {
        id: 'hb-clickNoise',
        type: 'noise',
        x: 800,
        y: 1220,
        values: { Type: 'white', Level: 0.5 },
      },
      {
        id: 'hb-clickEnv',
        type: 'adsr',
        x: 1120,
        y: 1220,
        values: {
          Trigger: 'rising',
          'Attack s': 0.002,
          'Decay s': 0.018,
          Sustain: 0,
          'Release s': 0.02,
        },
      },
      {
        id: 'hb-clickHp',
        type: 'filter',
        x: 1440,
        y: 1220,
        values: { Type: 'highpass', Freq: 1400, Q: 0.7 },
      },
    );
    edges.push(
      { from: 'hb-t1', output: 'Gate', to: 'hb-pitchEnv', input: 'Gate' },
      { from: 'hb-pitchEnv', output: 'Env', to: 'hb-pitchAudio', input: 'In' },
      { from: 'hb-pitchAudio', output: 'Out', to: 'hb-pitchDepth', input: 'In' },
      { from: 'hb-pitchDepth', output: 'Out', to: 'hb-pitchSig', input: 'In' },
      { from: 'hb-pitchSig', output: 'Out', to: 'hb-subTone', input: 'Frequency' },
      { from: 'hb-subBase', output: 'Out', to: 'hb-subTone', input: 'Frequency' },
      { from: 'hb-subTone', output: 'Out', to: 'hb-subEnv', input: 'In' },
      { from: 'hb-t1', output: 'Gate', to: 'hb-subEnv', input: 'Gate' },
      { from: 'hb-subEnv', output: 'Out', to: 'hb-subDrive', input: 'In' },
      // The sub bypasses the chest filters: those shape valve sounds, and the
      // lowpass would undo the harmonics the clipper just created.
      { from: 'hb-subDrive', output: 'Out', to: 'hb-outSum', input: 'In' },

      { from: 'hb-clickNoise', output: 'Out', to: 'hb-clickEnv', input: 'In' },
      { from: 'hb-t1', output: 'Gate', to: 'hb-clickEnv', input: 'Gate' },
      { from: 'hb-clickEnv', output: 'Out', to: 'hb-clickHp', input: 'In' },
      { from: 'hb-clickHp', output: 'Out', to: 'hb-outSum', input: 'In' },
    );
  }

  if (cinematic) {
    nodes.push({
      id: 'hb-room',
      type: 'reverb',
      x: 2740,
      y: 300,
      values: { 'Decay s': 2.6, 'PreDelay s': 0.01, Wet: 0.32 },
    });
    edges.push({ from: 'hb-lp', output: 'Out', to: 'hb-room', input: 'In' });
    edges.push({ from: 'hb-room', output: 'Out', to: 'hb-outSum', input: 'In' });
  } else {
    // The produced one is DRY on purpose. Reverb is what made it read as a
    // second cinematic heartbeat rather than as its own thing: a track's kick
    // sits forward, in your face, with the room printed on the mix instead.
    edges.push({ from: 'hb-lp', output: 'Out', to: 'hb-outSum', input: 'In' });
  }

  edges.push(
    { from: 'hb-outSum', output: 'Out', to: 'hb-out', input: 'In' },
    { from: 'hb-out', output: 'Out', to: 'hb-render', input: 'In' },
  );

  nodes.push({
    id: 'hb-render',
    type: 'render',
    x: 3060,
    y: 320,
    // The translation stage adds real level as well as harmonics (deep
    // measured 0.55 -> 0.83 peak at the master), so the dial comes DOWN to
    // keep headroom. It still sounds the loudest of the three: the energy
    // moved into the band ears and speakers actually respond to, which is
    // worth more perceived loudness than the 3 dB given back here.
    values: { 'Level dB': deep ? -2 : cinematic ? -2 : -5 },
  });

  return buildState(nodes, edges);
}

/**
 * Wet blast — see the builder entry for the full rationale.
 *
 * Every envelope here is LEGACY mode (no `Gate` edge), so they all fire
 * together from the global keyboard bus on any key press. That is the contract
 * for a one-shot SFX: one gesture, one blast.
 *
 * Legacy `adsr` CLAMPS attack/decay/release to >= 1 ms, so the 2-4 ms transient
 * is built as a short shaped noise burst rather than as a sub-millisecond
 * attack, which would be silently rounded up.
 */
function buildWetBlast(): ProbeState {
  // The sweep depths are written as start/end pitches and converted, so the
  // musical intent stays readable and the oracle can check the octave span.
  const bodyFrom = 320;
  const bodyTo = 40;
  const squelchFrom = 2860;
  const squelchTo = 260;

  const nodes: NodeSpec[] = [
    // ONE DC carrier for every envelope in the patch.
    { id: 'bl-dc', type: 'constant', x: 40, y: 40, values: { Value: 1 } },
    { id: 'bl-dcAudio', type: 'toAudio', x: 300, y: 40 },

    // 1. TRANSIENT — the crack that puts the hit in front of the listener.
    {
      id: 'bl-tNoise',
      type: 'noise',
      x: 40,
      y: 200,
      values: { Type: 'white', Level: 0.9 },
    },
    {
      id: 'bl-tEnv',
      type: 'adsr',
      x: 300,
      y: 200,
      values: {
        'Attack s': 0.001,
        'Decay s': 0.004,
        Sustain: 0,
        'Release s': 0.004,
      },
    },
    {
      id: 'bl-tHp',
      type: 'filter',
      x: 560,
      y: 200,
      values: { Type: 'highpass', Freq: 1800, Q: 0.7 },
    },

    // 2. BODY — 320 -> 40 Hz, three octaves, in about 80 ms.
    {
      id: 'bl-pEnv',
      type: 'adsr',
      x: 560,
      y: 380,
      values: {
        'Attack s': 0.001,
        'Decay s': 0.075,
        Sustain: 0,
        'Release s': 0.05,
      },
    },
    {
      id: 'bl-pDepth',
      type: 'gain',
      x: 820,
      y: 380,
      values: { Gain: bodyFrom - bodyTo },
    },
    { id: 'bl-pSig', type: 'toSignal', x: 1080, y: 380 },
    {
      id: 'bl-bBase',
      type: 'constant',
      x: 1080,
      y: 520,
      values: { Value: bodyTo },
    },
    {
      id: 'bl-body',
      type: 'oscillator',
      x: 1340,
      y: 430,
      values: { Shape: 'sine', Level: 1 },
    },
    {
      id: 'bl-bEnv',
      type: 'adsr',
      x: 1600,
      y: 430,
      values: {
        'Attack s': 0.001,
        'Decay s': 0.38,
        Sustain: 0,
        'Release s': 0.2,
      },
    },
    // Driven UNDER unity, where the shaper really is tanh(2.5x)/tanh(2.5), so
    // this is soft saturation for weight — not the hard clip it becomes when
    // pushed past |x| = 1.
    {
      id: 'bl-bDrive',
      type: 'saturator',
      x: 1860,
      y: 430,
      values: { Drive: 2, Trim: 0.85, Wet: 0.5 },
    },

    // 3. SQUELCH — a high-Q band collapsing downward. This is the "wet".
    {
      id: 'bl-sEnv',
      type: 'adsr',
      x: 560,
      y: 640,
      values: {
        'Attack s': 0.002,
        'Decay s': 0.16,
        Sustain: 0,
        'Release s': 0.1,
      },
    },
    {
      id: 'bl-sDepth',
      type: 'gain',
      x: 820,
      y: 640,
      values: { Gain: squelchFrom - squelchTo },
    },
    { id: 'bl-sSig', type: 'toSignal', x: 1080, y: 640 },
    {
      id: 'bl-sBase',
      type: 'constant',
      x: 1080,
      y: 760,
      values: { Value: squelchTo },
    },
    {
      id: 'bl-sNoise',
      type: 'noise',
      x: 1080,
      y: 880,
      values: { Type: 'pink', Level: 0.8 },
    },
    {
      id: 'bl-sBp',
      type: 'filter',
      x: 1340,
      y: 700,
      values: { Type: 'bandpass', Q: 7 },
    },
    {
      id: 'bl-sAmp',
      type: 'adsr',
      x: 1600,
      y: 700,
      values: {
        'Attack s': 0.002,
        'Decay s': 0.22,
        Sustain: 0,
        'Release s': 0.12,
      },
    },

    // 4. BUBBLES — negative depth, so these RISE while everything else falls.
    {
      id: 'bl-uEnv',
      type: 'adsr',
      x: 560,
      y: 1000,
      values: {
        'Attack s': 0.001,
        'Decay s': 0.09,
        Sustain: 0,
        'Release s': 0.06,
      },
    },
    { id: 'bl-u1Depth', type: 'gain', x: 820, y: 1000, values: { Gain: -520 } },
    { id: 'bl-u1Sig', type: 'toSignal', x: 1080, y: 1000 },
    {
      id: 'bl-u1Base',
      type: 'constant',
      x: 1080,
      y: 1110,
      values: { Value: 820 },
    },
    {
      id: 'bl-u1',
      type: 'oscillator',
      x: 1340,
      y: 1040,
      values: { Shape: 'sine', Level: 0.5 },
    },
    { id: 'bl-u2Depth', type: 'gain', x: 820, y: 1220, values: { Gain: -900 } },
    { id: 'bl-u2Sig', type: 'toSignal', x: 1080, y: 1220 },
    {
      id: 'bl-u2Base',
      type: 'constant',
      x: 1080,
      y: 1330,
      values: { Value: 1450 },
    },
    {
      id: 'bl-u2',
      type: 'oscillator',
      x: 1340,
      y: 1260,
      values: { Shape: 'sine', Level: 0.35 },
    },
    { id: 'bl-uMix', type: 'mix', x: 1600, y: 1140 },
    {
      id: 'bl-uAmp',
      type: 'adsr',
      x: 1860,
      y: 1140,
      values: {
        'Attack s': 0.004,
        'Decay s': 0.12,
        Sustain: 0,
        'Release s': 0.08,
      },
    },

    // 5. DEBRIS — the splatter that keeps the tail alive after the thump.
    {
      id: 'bl-dNoise',
      type: 'noise',
      x: 1340,
      y: 1440,
      values: { Type: 'pink', Level: 0.5 },
    },
    {
      id: 'bl-dHp',
      type: 'filter',
      x: 1600,
      y: 1440,
      values: { Type: 'highpass', Freq: 900, Q: 0.7 },
    },
    {
      id: 'bl-dEnv',
      type: 'adsr',
      x: 1860,
      y: 1440,
      values: {
        'Attack s': 0.004,
        'Decay s': 0.34,
        Sustain: 0,
        'Release s': 0.2,
      },
    },

    { id: 'bl-mix', type: 'mix', x: 2200, y: 700 },
    // Short and plate-ish. `Decay s` 5 (a real T60 of 2.3 s) was most of what
    // made the old one a puddle rather than a punch.
    {
      id: 'bl-verb',
      type: 'reverb',
      x: 2460,
      y: 700,
      values: { 'Decay s': 1.4, 'PreDelay s': 0.008, Wet: 0.26 },
    },
    // The body ends at 40 Hz, so everything under 30 Hz is skirt: inaudible on
    // real hardware and pure cone excursion. Same cut the heartbeats carry.
    {
      id: 'bl-out',
      type: 'filter',
      x: 2720,
      y: 700,
      values: { Type: 'highpass', Freq: 30, Q: 0.7 },
    },
    {
      id: 'bl-render',
      type: 'render',
      x: 2980,
      y: 720,
      values: { 'Level dB': -6 },
    },
  ];

  const edges: EdgeSpec[] = [
    { from: 'bl-dc', output: 'Out', to: 'bl-dcAudio', input: 'In' },

    { from: 'bl-tNoise', output: 'Out', to: 'bl-tEnv', input: 'In' },
    { from: 'bl-tEnv', output: 'Out', to: 'bl-tHp', input: 'In' },
    { from: 'bl-tHp', output: 'Out', to: 'bl-mix', input: 'In' },

    { from: 'bl-dcAudio', output: 'Out', to: 'bl-pEnv', input: 'In' },
    { from: 'bl-pEnv', output: 'Out', to: 'bl-pDepth', input: 'In' },
    { from: 'bl-pDepth', output: 'Out', to: 'bl-pSig', input: 'In' },
    { from: 'bl-pSig', output: 'Out', to: 'bl-body', input: 'Frequency' },
    { from: 'bl-bBase', output: 'Out', to: 'bl-body', input: 'Frequency' },
    { from: 'bl-body', output: 'Out', to: 'bl-bEnv', input: 'In' },
    { from: 'bl-bEnv', output: 'Out', to: 'bl-bDrive', input: 'In' },
    { from: 'bl-bDrive', output: 'Out', to: 'bl-mix', input: 'In' },

    { from: 'bl-dcAudio', output: 'Out', to: 'bl-sEnv', input: 'In' },
    { from: 'bl-sEnv', output: 'Out', to: 'bl-sDepth', input: 'In' },
    { from: 'bl-sDepth', output: 'Out', to: 'bl-sSig', input: 'In' },
    { from: 'bl-sSig', output: 'Out', to: 'bl-sBp', input: 'Freq' },
    { from: 'bl-sBase', output: 'Out', to: 'bl-sBp', input: 'Freq' },
    { from: 'bl-sNoise', output: 'Out', to: 'bl-sBp', input: 'In' },
    { from: 'bl-sBp', output: 'Out', to: 'bl-sAmp', input: 'In' },
    { from: 'bl-sAmp', output: 'Out', to: 'bl-mix', input: 'In' },

    { from: 'bl-dcAudio', output: 'Out', to: 'bl-uEnv', input: 'In' },
    { from: 'bl-uEnv', output: 'Out', to: 'bl-u1Depth', input: 'In' },
    { from: 'bl-u1Depth', output: 'Out', to: 'bl-u1Sig', input: 'In' },
    { from: 'bl-u1Sig', output: 'Out', to: 'bl-u1', input: 'Frequency' },
    { from: 'bl-u1Base', output: 'Out', to: 'bl-u1', input: 'Frequency' },
    { from: 'bl-uEnv', output: 'Out', to: 'bl-u2Depth', input: 'In' },
    { from: 'bl-u2Depth', output: 'Out', to: 'bl-u2Sig', input: 'In' },
    { from: 'bl-u2Sig', output: 'Out', to: 'bl-u2', input: 'Frequency' },
    { from: 'bl-u2Base', output: 'Out', to: 'bl-u2', input: 'Frequency' },
    { from: 'bl-u1', output: 'Out', to: 'bl-uMix', input: 'In' },
    { from: 'bl-u2', output: 'Out', to: 'bl-uMix', input: 'In' },
    { from: 'bl-uMix', output: 'Out', to: 'bl-uAmp', input: 'In' },
    { from: 'bl-uAmp', output: 'Out', to: 'bl-mix', input: 'In' },

    { from: 'bl-dNoise', output: 'Out', to: 'bl-dHp', input: 'In' },
    { from: 'bl-dHp', output: 'Out', to: 'bl-dEnv', input: 'In' },
    { from: 'bl-dEnv', output: 'Out', to: 'bl-mix', input: 'In' },

    { from: 'bl-mix', output: 'Out', to: 'bl-verb', input: 'In' },
    { from: 'bl-verb', output: 'Out', to: 'bl-out', input: 'In' },
    { from: 'bl-out', output: 'Out', to: 'bl-render', input: 'In' },
  ];

  return buildState(nodes, edges);
}

/**
 * THE KEY-TRIGGERED CONTROL-SWEEP IDIOM, shared by every one-shot SFX below.
 *
 * `adsr.Env` is a constant 0 unless `Gate` is connected, and a "press any key"
 * patch fires from the legacy global keyboard bus with `Gate` unconnected. So
 * the envelope has to be taken off the AUDIO path and converted back to
 * control:
 *
 *     constant(1) -> toAudio -> adsr -> gain(depth) -> toSignal ->|
 *                                              constant(base) ->|-> some param
 *
 * `toAudio`/`toSignal` are each a bare `Tone.Gain(1)` with no DC blocking
 * (implementations.ts:840-859), so DC survives the round trip; and signals SUM
 * on a signal input, so the two feeds give
 *
 *     value(t) = to + (from - to) * env(t)
 *
 * env runs 1 -> 0, so the value runs `from` -> `to`. `from < to` makes the
 * depth gain NEGATIVE and the sweep RISES, which is how the bubble layers get
 * their Minnaert up-glide.
 *
 * Legacy `adsr` CLAMPS attack/decay/release to >= 1 ms, so nothing here asks
 * for a sub-millisecond stage: transients are short shaped noise bursts.
 */
type SweepOptions = {
  id: string;
  /** id of the shared `toAudio` DC carrier. */
  carrier: string;
  x: number;
  y: number;
  /**
   * KEEP THIS SHORT unless you want the sweep to run backwards first.
   *
   * The envelope rises 0 -> 1 during the attack, and the value is
   * `to + (from - to) * env`, so during the attack the value travels FROM `to`
   * TOWARDS `from` — the opposite of the intended direction — and only reaches
   * `from` when the attack completes. The sweep proper is the DECAY. A 1 ms
   * attack makes the backwards leg inaudible; a 900 ms one inverts the whole
   * gesture. If a layer needs a delayed onset, put the slow attack on its
   * AMPLITUDE envelope, where a slow rise is exactly what is wanted.
   */
  attack: number;
  decay: number;
  release?: number;
  from: number;
  to: number;
};

function controlSweep(options: SweepOptions): {
  nodes: NodeSpec[];
  edges: EdgeSpec[];
} {
  const nodes: NodeSpec[] = [
    {
      id: `${options.id}Env`,
      type: 'adsr',
      x: options.x,
      y: options.y,
      values: {
        'Attack s': options.attack,
        'Decay s': options.decay,
        Sustain: 0,
        'Release s': options.release ?? 0.05,
      },
    },
    {
      id: `${options.id}Depth`,
      type: 'gain',
      x: options.x + 240,
      y: options.y,
      values: { Gain: options.from - options.to },
    },
    { id: `${options.id}Sig`, type: 'toSignal', x: options.x + 480, y: options.y },
    {
      id: `${options.id}Base`,
      type: 'constant',
      x: options.x + 480,
      y: options.y + 110,
      values: { Value: options.to },
    },
  ];
  const edges: EdgeSpec[] = [
    { from: options.carrier, output: 'Out', to: `${options.id}Env`, input: 'In' },
    { from: `${options.id}Env`, output: 'Out', to: `${options.id}Depth`, input: 'In' },
    { from: `${options.id}Depth`, output: 'Out', to: `${options.id}Sig`, input: 'In' },
  ];
  return { nodes, edges };
}

/** Both halves of a sweep feed the SAME signal input, where they sum. */
function sweepInto(id: string, target: string, input: string): EdgeSpec[] {
  return [
    { from: `${id}Sig`, output: 'Out', to: target, input },
    { from: `${id}Base`, output: 'Out', to: target, input },
  ];
}

/** The DC carrier every control sweep in a patch shares. */
function sweepCarrier(prefix: string): NodeSpec[] {
  return [
    { id: `${prefix}-dc`, type: 'constant', x: 40, y: 40, values: { Value: 1 } },
    { id: `${prefix}-dcAudio`, type: 'toAudio', x: 280, y: 40 },
  ];
}

function carrierEdge(prefix: string): EdgeSpec {
  return {
    from: `${prefix}-dc`,
    output: 'Out',
    to: `${prefix}-dcAudio`,
    input: 'In',
  };
}

/** A one-shot amplitude envelope. Sustain > 0 keeps the sound while held. */
function ampEnv(
  id: string,
  x: number,
  y: number,
  attack: number,
  decay: number,
  sustain: number,
  release: number,
): NodeSpec {
  return {
    id,
    type: 'adsr',
    x,
    y,
    values: {
      'Attack s': attack,
      'Decay s': decay,
      Sustain: sustain,
      'Release s': release,
    },
  };
}

/**
 * SFX — HEAL. The only effect in this set with NO impact: a restorative sound
 * is defined by the absence of a transient. Everything rises, nothing strikes.
 *
 * Three voices in JUST intervals — 528 / 792 / 1056 Hz is 1 : 3/2 : 2, exact
 * ratios rather than tempered ones, so the partials lock instead of beating.
 * Each glides UP about two semitones into tune during the attack, which is the
 * "restoring" gesture; a slow highpassed shimmer sits over the top. Sustain is
 * non-zero, so the glow holds for as long as the key is held.
 */
function buildHeal(): ProbeState {
  const p = 'hl';
  const nodes: NodeSpec[] = [...sweepCarrier(p)];
  const edges: EdgeSpec[] = [carrierEdge(p)];

  const voices = [
    { id: 'hl-v1', to: 528, from: 470, level: 0.5, y: 200 },
    { id: 'hl-v2', to: 792, from: 706, level: 0.32, y: 520 },
    { id: 'hl-v3', to: 1056, from: 941, level: 0.2, y: 840 },
  ];
  for (const v of voices) {
    const sweep = controlSweep({
      id: v.id,
      carrier: `${p}-dcAudio`,
      x: 300,
      y: v.y,
      attack: 0.02,
      decay: 0.45,
      release: 0.4,
      from: v.from,
      to: v.to,
    });
    nodes.push(...sweep.nodes, {
      id: `${v.id}Osc`,
      type: 'oscillator',
      x: 1060,
      y: v.y + 40,
      values: { Shape: 'sine', Level: v.level },
    });
    edges.push(...sweep.edges, ...sweepInto(v.id, `${v.id}Osc`, 'Frequency'), {
      from: `${v.id}Osc`,
      output: 'Out',
      to: 'hl-tone',
      input: 'In',
    });
  }

  nodes.push(
    { id: 'hl-tone', type: 'mix', x: 1360, y: 520 },
    // The slow attack IS the identity. A fast one would make this a bell.
    ampEnv('hl-amp', 1620, 520, 0.35, 0.9, 0.4, 1.6),
    {
      id: 'hl-shimNoise',
      type: 'noise',
      x: 1060,
      y: 1160,
      values: { Type: 'pink', Level: 0.16 },
    },
    {
      id: 'hl-shimHp',
      type: 'filter',
      x: 1360,
      y: 1160,
      values: { Type: 'highpass', Freq: 3800, Q: 0.7 },
    },
    ampEnv('hl-shimEnv', 1620, 1160, 0.5, 1.2, 0.28, 1.8),
    { id: 'hl-mix', type: 'mix', x: 1900, y: 760 },
    {
      id: 'hl-verb',
      type: 'reverb',
      x: 2160,
      y: 760,
      values: { 'Decay s': 4.5, 'PreDelay s': 0.02, Wet: 0.5 },
    },
    {
      id: 'hl-out',
      type: 'filter',
      x: 2420,
      y: 760,
      values: { Type: 'highpass', Freq: 30, Q: 0.7 },
    },
    {
      id: 'hl-render',
      type: 'render',
      x: 2680,
      y: 780,
      values: { 'Level dB': -8 },
    },
  );
  edges.push(
    { from: 'hl-tone', output: 'Out', to: 'hl-amp', input: 'In' },
    { from: 'hl-amp', output: 'Out', to: 'hl-mix', input: 'In' },
    { from: 'hl-shimNoise', output: 'Out', to: 'hl-shimHp', input: 'In' },
    { from: 'hl-shimHp', output: 'Out', to: 'hl-shimEnv', input: 'In' },
    { from: 'hl-shimEnv', output: 'Out', to: 'hl-mix', input: 'In' },
    { from: 'hl-mix', output: 'Out', to: 'hl-verb', input: 'In' },
    { from: 'hl-verb', output: 'Out', to: 'hl-out', input: 'In' },
    { from: 'hl-out', output: 'Out', to: 'hl-render', input: 'In' },
  );
  return buildState(nodes, edges);
}

/**
 * SFX — LIGHTNING. Two events, and the GAP BETWEEN THEM is the whole effect.
 *
 * A strike is a ~2 ms crack and a broadband burst, then — after the sound has
 * travelled — a long rumble with nothing above ~125 Hz, because air absorbs
 * high frequencies over distance. That delay is the distance cue: it is why
 * you count seconds after a flash.
 *
 * The delay is built as a long ADSR ATTACK on the rumble rather than as a
 * delay line. An attack IS a scheduled onset, it costs one node instead of
 * three, and it cannot feed back.
 */
function buildLightning(): ProbeState {
  const p = 'lt';
  const sub = controlSweep({
    id: 'lt-sub',
    carrier: 'lt-dcAudio',
    x: 300,
    y: 900,
    // 1 ms: the pitch must fall from the first instant. The 0.32 s delayed
    // ARRIVAL is carried by `lt-subAmp` below, which is where it belongs.
    attack: 0.001,
    decay: 1.4,
    release: 0.9,
    from: 90,
    to: 38,
  });
  const nodes: NodeSpec[] = [
    ...sweepCarrier(p),
    {
      id: 'lt-crackNoise',
      type: 'noise',
      x: 300,
      y: 200,
      values: { Type: 'white', Level: 1 },
    },
    ampEnv('lt-crackEnv', 560, 200, 0.001, 0.003, 0, 0.003),
    {
      id: 'lt-crackHp',
      type: 'filter',
      x: 820,
      y: 200,
      values: { Type: 'highpass', Freq: 2600, Q: 0.7 },
    },
    {
      id: 'lt-burstNoise',
      type: 'noise',
      x: 300,
      y: 420,
      values: { Type: 'white', Level: 0.85 },
    },
    ampEnv('lt-burstEnv', 560, 420, 0.001, 0.05, 0, 0.04),
    {
      id: 'lt-burstBp',
      type: 'filter',
      x: 820,
      y: 420,
      values: { Type: 'bandpass', Freq: 1400, Q: 1 },
    },
    {
      id: 'lt-rumbleNoise',
      type: 'noise',
      x: 300,
      y: 640,
      values: { Type: 'brown', Level: 0.9 },
    },
    // 0.3 s of attack = roughly 100 m of air. This is the distance cue.
    ampEnv('lt-rumbleEnv', 560, 640, 0.3, 1.8, 0, 1.2),
    {
      id: 'lt-rumbleLp',
      type: 'filter',
      x: 820,
      y: 640,
      values: { Type: 'lowpass', Freq: 125, Q: 0.7 },
    },
    ...sub.nodes,
    {
      id: 'lt-subOsc',
      type: 'oscillator',
      x: 1060,
      y: 940,
      values: { Shape: 'sine', Level: 0.8 },
    },
    ampEnv('lt-subAmp', 1320, 940, 0.32, 1.3, 0, 0.8),
    { id: 'lt-mix', type: 'mix', x: 1620, y: 520 },
    {
      id: 'lt-verb',
      type: 'reverb',
      x: 1880,
      y: 520,
      values: { 'Decay s': 3, 'PreDelay s': 0.02, Wet: 0.35 },
    },
    {
      id: 'lt-out',
      type: 'filter',
      x: 2140,
      y: 520,
      values: { Type: 'highpass', Freq: 30, Q: 0.7 },
    },
    {
      id: 'lt-render',
      type: 'render',
      x: 2400,
      y: 540,
      values: { 'Level dB': -6 },
    },
  ];
  const edges: EdgeSpec[] = [
    carrierEdge(p),
    { from: 'lt-crackNoise', output: 'Out', to: 'lt-crackEnv', input: 'In' },
    { from: 'lt-crackEnv', output: 'Out', to: 'lt-crackHp', input: 'In' },
    { from: 'lt-crackHp', output: 'Out', to: 'lt-mix', input: 'In' },
    { from: 'lt-burstNoise', output: 'Out', to: 'lt-burstEnv', input: 'In' },
    { from: 'lt-burstEnv', output: 'Out', to: 'lt-burstBp', input: 'In' },
    { from: 'lt-burstBp', output: 'Out', to: 'lt-mix', input: 'In' },
    { from: 'lt-rumbleNoise', output: 'Out', to: 'lt-rumbleEnv', input: 'In' },
    { from: 'lt-rumbleEnv', output: 'Out', to: 'lt-rumbleLp', input: 'In' },
    { from: 'lt-rumbleLp', output: 'Out', to: 'lt-mix', input: 'In' },
    ...sub.edges,
    ...sweepInto('lt-sub', 'lt-subOsc', 'Frequency'),
    { from: 'lt-subOsc', output: 'Out', to: 'lt-subAmp', input: 'In' },
    { from: 'lt-subAmp', output: 'Out', to: 'lt-mix', input: 'In' },
    { from: 'lt-mix', output: 'Out', to: 'lt-verb', input: 'In' },
    { from: 'lt-verb', output: 'Out', to: 'lt-out', input: 'In' },
    { from: 'lt-out', output: 'Out', to: 'lt-render', input: 'In' },
  ];
  return buildState(nodes, edges);
}

/**
 * SFX — TIME WARP. Built on the one mechanism that genuinely warps time here:
 * a delay line whose length is CHANGING.
 *
 * Puckette's relation for a delay of length D(t) is
 *
 *     t = 1 - dD/dt
 *
 * -- the rate at which the output advances through the input. Lengthening the
 * delay stretches time (pitch falls); shortening it compresses time (pitch
 * rises). The pitch shift is a CONSEQUENCE of the time change, not an effect
 * bolted on, which is exactly why it sounds like time rather than like a pitch
 * knob.
 *
 * `Time s` is a signal param on `feedbackDelay` (effectTable.ts), so the sweep
 * idiom drives it directly. Two stages: a long one that does the warping, and
 * a short one that COLLAPSES from 45 ms to 4 ms, walking its comb notches down
 * through the spectrum.
 *
 * The granular/grain-time mechanism the research proposed is NOT here: it has
 * no realisation in this node set. The wow does NOT come from `vibrato`
 * either -- its depth range is wrong by one to two orders of magnitude -- it
 * comes from a slow pulser on the same delay time.
 */
function buildTimeWarp(): ProbeState {
  const p = 'tw';
  const warp = controlSweep({
    id: 'tw-warp',
    carrier: 'tw-dcAudio',
    x: 300,
    y: 760,
    // Was 0.9 s, which started the delay at its LONGEST and ran the warp
    // backwards for the first second — the opposite of the stretch intended.
    attack: 0.001,
    decay: 1.8,
    release: 1.2,
    from: 0.002,
    to: 0.085,
  });
  const comb = controlSweep({
    id: 'tw-comb',
    carrier: 'tw-dcAudio',
    x: 300,
    y: 1040,
    attack: 0.001,
    decay: 2.4,
    release: 1.4,
    from: 0.045,
    to: 0.004,
  });
  const nodes: NodeSpec[] = [
    ...sweepCarrier(p),
    {
      id: 'tw-saw1',
      type: 'oscillator',
      x: 300,
      y: 200,
      values: { Shape: 'sawtooth', Frequency: 220, Level: 0.3 },
    },
    {
      id: 'tw-saw2',
      type: 'oscillator',
      x: 300,
      y: 360,
      values: { Shape: 'sawtooth', Frequency: 220.9, Level: 0.3 },
    },
    {
      id: 'tw-sub',
      type: 'oscillator',
      x: 300,
      y: 520,
      values: { Shape: 'sine', Frequency: 110, Level: 0.35 },
    },
    { id: 'tw-src', type: 'mix', x: 620, y: 360 },
    ampEnv('tw-amp', 880, 360, 0.02, 2.2, 0.5, 0.8),
    ...warp.nodes,
    ...comb.nodes,
    {
      id: 'tw-warpDelay',
      type: 'feedbackDelay',
      x: 1180,
      y: 360,
      values: { Feedback: 0.55, Wet: 0.55 },
    },
    {
      id: 'tw-combDelay',
      type: 'feedbackDelay',
      x: 1460,
      y: 360,
      values: { Feedback: 0.68, Wet: 0.45 },
    },
    // Wow: a slow sine on the output level. Deliberately NOT `vibrato`.
    {
      id: 'tw-wow',
      type: 'pulser',
      x: 1460,
      y: 620,
      values: { Shape: 'sine', 'Rate Hz': 0.7, Amplitude: 0.22, Offset: 0.78 },
    },
    { id: 'tw-wowGain', type: 'gain', x: 1740, y: 360 },
    {
      id: 'tw-verb',
      type: 'reverb',
      x: 2020,
      y: 360,
      values: { 'Decay s': 3.5, 'PreDelay s': 0.03, Wet: 0.4 },
    },
    {
      id: 'tw-out',
      type: 'filter',
      x: 2280,
      y: 360,
      values: { Type: 'highpass', Freq: 30, Q: 0.7 },
    },
    {
      id: 'tw-render',
      type: 'render',
      x: 2540,
      y: 380,
      values: { 'Level dB': -4.5 },
    },
  ];
  const edges: EdgeSpec[] = [
    carrierEdge(p),
    { from: 'tw-saw1', output: 'Out', to: 'tw-src', input: 'In' },
    { from: 'tw-saw2', output: 'Out', to: 'tw-src', input: 'In' },
    { from: 'tw-sub', output: 'Out', to: 'tw-src', input: 'In' },
    { from: 'tw-src', output: 'Out', to: 'tw-amp', input: 'In' },
    { from: 'tw-amp', output: 'Out', to: 'tw-warpDelay', input: 'In' },
    ...warp.edges,
    ...sweepInto('tw-warp', 'tw-warpDelay', 'Time s'),
    { from: 'tw-warpDelay', output: 'Out', to: 'tw-combDelay', input: 'In' },
    ...comb.edges,
    ...sweepInto('tw-comb', 'tw-combDelay', 'Time s'),
    { from: 'tw-combDelay', output: 'Out', to: 'tw-wowGain', input: 'In' },
    { from: 'tw-wow', output: 'Out', to: 'tw-wowGain', input: 'Gain' },
    { from: 'tw-wowGain', output: 'Out', to: 'tw-verb', input: 'In' },
    { from: 'tw-verb', output: 'Out', to: 'tw-out', input: 'In' },
    { from: 'tw-out', output: 'Out', to: 'tw-render', input: 'In' },
  ];
  return buildState(nodes, edges);
}

/**
 * SFX — ICE. The identity is FLEXURAL DISPERSION.
 *
 * Bending waves in a thin plate travel at a speed that rises with frequency
 * (c ~ sqrt(omega)), so when ice cracks the HIGH frequencies arrive FIRST and
 * the low ones trail behind. That descending "pew" is the sound of a frozen
 * lake, and it is the one cue that separates ice from glass.
 *
 * Built by staggering the ATTACK of three narrow resonant bands: 1 ms for the
 * top, 45 ms for the middle, 105 ms for the bottom. High Q keeps them narrow,
 * which is what makes it read as brittle rather than as noise.
 */
function buildIce(): ProbeState {
  const p = 'ic';
  const glass = controlSweep({
    id: 'ic-glass',
    carrier: 'ic-dcAudio',
    x: 300,
    y: 900,
    attack: 0.001,
    decay: 0.22,
    release: 0.15,
    from: 3200,
    to: 1400,
  });
  const shards = [
    { id: 'ic-hi', freq: 5200, q: 14, attack: 0.001, decay: 0.11, y: 200 },
    { id: 'ic-mid', freq: 2400, q: 12, attack: 0.045, decay: 0.2, y: 420 },
    { id: 'ic-lo', freq: 900, q: 9, attack: 0.105, decay: 0.34, y: 640 },
  ];
  const nodes: NodeSpec[] = [...sweepCarrier(p)];
  const edges: EdgeSpec[] = [carrierEdge(p)];
  for (const sh of shards) {
    nodes.push(
      {
        id: `${sh.id}Noise`,
        type: 'noise',
        x: 300,
        y: sh.y,
        values: { Type: 'white', Level: 0.8 },
      },
      {
        id: `${sh.id}Bp`,
        type: 'filter',
        x: 560,
        y: sh.y,
        values: { Type: 'bandpass', Freq: sh.freq, Q: sh.q },
      },
      ampEnv(`${sh.id}Env`, 820, sh.y, sh.attack, sh.decay, 0, sh.decay * 0.6),
    );
    edges.push(
      { from: `${sh.id}Noise`, output: 'Out', to: `${sh.id}Bp`, input: 'In' },
      { from: `${sh.id}Bp`, output: 'Out', to: `${sh.id}Env`, input: 'In' },
      { from: `${sh.id}Env`, output: 'Out', to: 'ic-mix', input: 'In' },
    );
  }
  nodes.push(
    {
      id: 'ic-crackNoise',
      type: 'noise',
      x: 300,
      y: 1200,
      values: { Type: 'white', Level: 0.9 },
    },
    ampEnv('ic-crackEnv', 560, 1200, 0.001, 0.006, 0, 0.006),
    {
      id: 'ic-crackHp',
      type: 'filter',
      x: 820,
      y: 1200,
      values: { Type: 'highpass', Freq: 4000, Q: 0.7 },
    },
    ...glass.nodes,
    {
      id: 'ic-glassOsc',
      type: 'oscillator',
      x: 1060,
      y: 940,
      values: { Shape: 'sine', Level: 0.3 },
    },
    ampEnv('ic-glassAmp', 1320, 940, 0.002, 0.2, 0, 0.15),
    { id: 'ic-mix', type: 'mix', x: 1620, y: 620 },
    {
      id: 'ic-verb',
      type: 'reverb',
      x: 1880,
      y: 620,
      values: { 'Decay s': 3.2, 'PreDelay s': 0.012, Wet: 0.42 },
    },
    {
      id: 'ic-out',
      type: 'filter',
      x: 2140,
      y: 620,
      values: { Type: 'highpass', Freq: 30, Q: 0.7 },
    },
    {
      id: 'ic-render',
      type: 'render',
      x: 2400,
      y: 640,
      values: { 'Level dB': -7 },
    },
  );
  edges.push(
    { from: 'ic-crackNoise', output: 'Out', to: 'ic-crackEnv', input: 'In' },
    { from: 'ic-crackEnv', output: 'Out', to: 'ic-crackHp', input: 'In' },
    { from: 'ic-crackHp', output: 'Out', to: 'ic-mix', input: 'In' },
    ...glass.edges,
    ...sweepInto('ic-glass', 'ic-glassOsc', 'Frequency'),
    { from: 'ic-glassOsc', output: 'Out', to: 'ic-glassAmp', input: 'In' },
    { from: 'ic-glassAmp', output: 'Out', to: 'ic-mix', input: 'In' },
    { from: 'ic-mix', output: 'Out', to: 'ic-verb', input: 'In' },
    { from: 'ic-verb', output: 'Out', to: 'ic-out', input: 'In' },
    { from: 'ic-out', output: 'Out', to: 'ic-render', input: 'In' },
  );
  return buildState(nodes, edges);
}

/**
 * SFX — FIRE. Combustion noise peaks at 300-500 Hz; crackle is a separate,
 * irregular, much brighter layer.
 *
 * IRREGULARITY WITHOUT A RANDOM SOURCE. There is no noise generator for
 * control signals here, and a single pulser gives a metronome. So the crackle
 * gain is driven by TWO pulsers at deliberately incommensurate rates (6.7 and
 * 4.1 Hz -- their ratio is irrational to the ear). Signals SUM on a signal
 * input, so the combined envelope has a period of ~1/0.1 Hz and never repeats
 * audibly within the life of the sound. Fire crackle is not periodic, and a
 * single LFO is instantly recognisable as machinery.
 *
 * Sustain is non-zero on every layer: fire burns while the key is held.
 */
function buildFire(): ProbeState {
  const p = 'fr';
  const nodes: NodeSpec[] = [
    ...sweepCarrier(p),
    {
      id: 'fr-bedNoise',
      type: 'noise',
      x: 300,
      y: 200,
      values: { Type: 'pink', Level: 0.9 },
    },
    {
      id: 'fr-bedBp',
      type: 'filter',
      x: 560,
      y: 200,
      values: { Type: 'bandpass', Freq: 400, Q: 1.2 },
    },
    ampEnv('fr-bedEnv', 820, 200, 0.08, 0.5, 0.55, 0.6),
    {
      id: 'fr-roarNoise',
      type: 'noise',
      x: 300,
      y: 420,
      values: { Type: 'brown', Level: 0.8 },
    },
    {
      id: 'fr-roarLp',
      type: 'filter',
      x: 560,
      y: 420,
      values: { Type: 'lowpass', Freq: 260, Q: 0.9 },
    },
    ampEnv('fr-roarEnv', 820, 420, 0.15, 0.8, 0.45, 0.7),
    {
      id: 'fr-crackNoise',
      type: 'noise',
      x: 300,
      y: 640,
      values: { Type: 'white', Level: 0.7 },
    },
    {
      id: 'fr-crackBp',
      type: 'filter',
      x: 560,
      y: 640,
      values: { Type: 'bandpass', Freq: 3600, Q: 18 },
    },
    ampEnv('fr-crackEnv', 820, 640, 0.002, 0.09, 0.14, 0.15),
    {
      id: 'fr-flickA',
      type: 'pulser',
      x: 820,
      y: 900,
      values: { Shape: 'sine', 'Rate Hz': 6.7, Amplitude: 0.5, Offset: 0.5 },
    },
    {
      id: 'fr-flickB',
      type: 'pulser',
      x: 820,
      y: 1040,
      values: { Shape: 'sine', 'Rate Hz': 4.1, Amplitude: 0.45, Offset: 0 },
    },
    { id: 'fr-crackGain', type: 'gain', x: 1120, y: 640 },
    { id: 'fr-mix', type: 'mix', x: 1420, y: 420 },
    {
      id: 'fr-verb',
      type: 'reverb',
      x: 1680,
      y: 420,
      values: { 'Decay s': 1.2, 'PreDelay s': 0.008, Wet: 0.18 },
    },
    {
      id: 'fr-out',
      type: 'filter',
      x: 1940,
      y: 420,
      values: { Type: 'highpass', Freq: 30, Q: 0.7 },
    },
    {
      id: 'fr-render',
      type: 'render',
      x: 2200,
      y: 440,
      values: { 'Level dB': -1 },
    },
  ];
  const edges: EdgeSpec[] = [
    carrierEdge(p),
    { from: 'fr-bedNoise', output: 'Out', to: 'fr-bedBp', input: 'In' },
    { from: 'fr-bedBp', output: 'Out', to: 'fr-bedEnv', input: 'In' },
    { from: 'fr-bedEnv', output: 'Out', to: 'fr-mix', input: 'In' },
    { from: 'fr-roarNoise', output: 'Out', to: 'fr-roarLp', input: 'In' },
    { from: 'fr-roarLp', output: 'Out', to: 'fr-roarEnv', input: 'In' },
    { from: 'fr-roarEnv', output: 'Out', to: 'fr-mix', input: 'In' },
    { from: 'fr-crackNoise', output: 'Out', to: 'fr-crackBp', input: 'In' },
    { from: 'fr-crackBp', output: 'Out', to: 'fr-crackEnv', input: 'In' },
    { from: 'fr-crackEnv', output: 'Out', to: 'fr-crackGain', input: 'In' },
    { from: 'fr-flickA', output: 'Out', to: 'fr-crackGain', input: 'Gain' },
    { from: 'fr-flickB', output: 'Out', to: 'fr-crackGain', input: 'Gain' },
    { from: 'fr-crackGain', output: 'Out', to: 'fr-mix', input: 'In' },
    { from: 'fr-mix', output: 'Out', to: 'fr-verb', input: 'In' },
    { from: 'fr-verb', output: 'Out', to: 'fr-out', input: 'In' },
    { from: 'fr-out', output: 'Out', to: 'fr-render', input: 'In' },
  ];
  return buildState(nodes, edges);
}

/**
 * SFX — NATURE. The only one of the seven with no single defining mechanism:
 * "nature" is a LAYERING, and what makes it read as alive rather than as a
 * noise bed is fluctuation at about 4 Hz.
 *
 * 4 Hz is where fluctuation strength peaks in human hearing (Zwicker): slower
 * reads as a drift, faster fuses into roughness. Leaves, breath and moving
 * water all sit near it, which is why it reads as organic.
 *
 * The wind's filter centre is swept by a very slow pulser -- pulser output is
 * a signal, so it drives the bandpass `Freq` directly: 0.23 Hz over 260-780 Hz
 * is a breath every four seconds or so.
 */
function buildNature(): ProbeState {
  const p = 'nt';
  const nodes: NodeSpec[] = [
    ...sweepCarrier(p),
    {
      id: 'nt-windNoise',
      type: 'noise',
      x: 300,
      y: 200,
      values: { Type: 'brown', Level: 0.9 },
    },
    {
      id: 'nt-windBp',
      type: 'filter',
      x: 560,
      y: 200,
      values: { Type: 'bandpass', Q: 0.9 },
    },
    {
      id: 'nt-windLfo',
      type: 'pulser',
      x: 300,
      y: 360,
      values: { Shape: 'sine', 'Rate Hz': 0.23, Amplitude: 260, Offset: 520 },
    },
    ampEnv('nt-windEnv', 820, 200, 0.6, 1.5, 0.6, 1.2),
    {
      id: 'nt-leafNoise',
      type: 'noise',
      x: 300,
      y: 560,
      values: { Type: 'pink', Level: 0.35 },
    },
    {
      id: 'nt-leafHp',
      type: 'filter',
      x: 560,
      y: 560,
      values: { Type: 'highpass', Freq: 2600, Q: 0.7 },
    },
    ampEnv('nt-leafEnv', 820, 560, 0.3, 1.2, 0.4, 1 ),
    // 4 Hz: the peak of fluctuation strength. This is what sounds alive.
    {
      id: 'nt-flutter',
      type: 'pulser',
      x: 820,
      y: 760,
      values: { Shape: 'sine', 'Rate Hz': 4, Amplitude: 0.35, Offset: 0.65 },
    },
    { id: 'nt-leafGain', type: 'gain', x: 1120, y: 560 },
    {
      id: 'nt-woodNoise',
      type: 'noise',
      x: 300,
      y: 940,
      values: { Type: 'pink', Level: 0.6 },
    },
    {
      id: 'nt-woodBp',
      type: 'filter',
      x: 560,
      y: 940,
      values: { Type: 'bandpass', Freq: 900, Q: 8 },
    },
    ampEnv('nt-woodEnv', 820, 940, 0.002, 0.12, 0, 0.1),
    { id: 'nt-mix', type: 'mix', x: 1420, y: 520 },
    {
      id: 'nt-verb',
      type: 'reverb',
      x: 1680,
      y: 520,
      values: { 'Decay s': 2.6, 'PreDelay s': 0.02, Wet: 0.3 },
    },
    {
      id: 'nt-out',
      type: 'filter',
      x: 1940,
      y: 520,
      values: { Type: 'highpass', Freq: 30, Q: 0.7 },
    },
    {
      id: 'nt-render',
      type: 'render',
      x: 2200,
      y: 540,
      values: { 'Level dB': 2 },
    },
  ];
  const edges: EdgeSpec[] = [
    carrierEdge(p),
    { from: 'nt-windNoise', output: 'Out', to: 'nt-windBp', input: 'In' },
    { from: 'nt-windLfo', output: 'Out', to: 'nt-windBp', input: 'Freq' },
    { from: 'nt-windBp', output: 'Out', to: 'nt-windEnv', input: 'In' },
    { from: 'nt-windEnv', output: 'Out', to: 'nt-mix', input: 'In' },
    { from: 'nt-leafNoise', output: 'Out', to: 'nt-leafHp', input: 'In' },
    { from: 'nt-leafHp', output: 'Out', to: 'nt-leafEnv', input: 'In' },
    { from: 'nt-leafEnv', output: 'Out', to: 'nt-leafGain', input: 'In' },
    { from: 'nt-flutter', output: 'Out', to: 'nt-leafGain', input: 'Gain' },
    { from: 'nt-leafGain', output: 'Out', to: 'nt-mix', input: 'In' },
    { from: 'nt-woodNoise', output: 'Out', to: 'nt-woodBp', input: 'In' },
    { from: 'nt-woodBp', output: 'Out', to: 'nt-woodEnv', input: 'In' },
    { from: 'nt-woodEnv', output: 'Out', to: 'nt-mix', input: 'In' },
    { from: 'nt-mix', output: 'Out', to: 'nt-verb', input: 'In' },
    { from: 'nt-verb', output: 'Out', to: 'nt-out', input: 'In' },
    { from: 'nt-out', output: 'Out', to: 'nt-render', input: 'In' },
  ];
  return buildState(nodes, edges);
}

/**
 * SFX — BUBBLE / WATER ATTACK. Minnaert's relation is the whole effect.
 *
 * A gas bubble in water rings at
 *
 *     f . a ~= 3.26     (a = radius in metres, f in Hz)
 *
 * so a 3 mm bubble sings near 1.1 kHz and a 12 mm one near 270 Hz. As a bubble
 * rises it SHRINKS, so its tone GLIDES UP -- and an upward glide is the single
 * cue the ear reads as liquid. Every other impact sound in this set falls.
 *
 * Four bubbles, each with a different radius and therefore a different band,
 * and each with a different ATTACK so they plop in sequence rather than as a
 * chord. Their sweeps use a negative depth gain, which is what makes them rise.
 */
function buildBubbleWater(): ProbeState {
  const p = 'bw';
  const bubbles = [
    { id: 'bw-b1', from: 280, to: 760, attack: 0.004, decay: 0.05, level: 0.45, y: 200 },
    { id: 'bw-b2', from: 420, to: 1150, attack: 0.05, decay: 0.035, level: 0.35, y: 480 },
    { id: 'bw-b3', from: 650, to: 1680, attack: 0.11, decay: 0.028, level: 0.28, y: 760 },
    { id: 'bw-b4', from: 180, to: 520, attack: 0.18, decay: 0.075, level: 0.5, y: 1040 },
  ];
  const nodes: NodeSpec[] = [...sweepCarrier(p)];
  const edges: EdgeSpec[] = [carrierEdge(p)];
  for (const b of bubbles) {
    const sweep = controlSweep({
      id: b.id,
      carrier: `${p}-dcAudio`,
      x: 300,
      y: b.y,
      // 1 ms, NOT `b.attack`: the pitch has to rise from the first instant or
      // the bubble glides DOWN for up to 180 ms first. The staggered plops
      // come from `${b.id}Amp` below, which keeps the per-bubble attack.
      attack: 0.001,
      decay: b.decay,
      release: b.decay,
      from: b.from,
      to: b.to,
    });
    nodes.push(
      ...sweep.nodes,
      {
        id: `${b.id}Osc`,
        type: 'oscillator',
        x: 1060,
        y: b.y + 40,
        values: { Shape: 'sine', Level: b.level },
      },
      ampEnv(`${b.id}Amp`, 1320, b.y + 40, b.attack, b.decay, 0, b.decay),
    );
    edges.push(
      ...sweep.edges,
      ...sweepInto(b.id, `${b.id}Osc`, 'Frequency'),
      { from: `${b.id}Osc`, output: 'Out', to: `${b.id}Amp`, input: 'In' },
      { from: `${b.id}Amp`, output: 'Out', to: 'bw-mix', input: 'In' },
    );
  }
  nodes.push(
    {
      id: 'bw-splashNoise',
      type: 'noise',
      x: 300,
      y: 1360,
      values: { Type: 'white', Level: 0.8 },
    },
    ampEnv('bw-splashEnv', 560, 1360, 0.001, 0.02, 0, 0.02),
    {
      id: 'bw-splashHp',
      type: 'filter',
      x: 820,
      y: 1360,
      values: { Type: 'highpass', Freq: 3000, Q: 0.7 },
    },
    {
      id: 'bw-bedNoise',
      type: 'noise',
      x: 300,
      y: 1560,
      values: { Type: 'pink', Level: 0.5 },
    },
    {
      id: 'bw-bedBp',
      type: 'filter',
      x: 560,
      y: 1560,
      values: { Type: 'bandpass', Freq: 1200, Q: 2 },
    },
    ampEnv('bw-bedEnv', 820, 1560, 0.01, 0.5, 0.18, 0.4),
    { id: 'bw-mix', type: 'mix', x: 1620, y: 820 },
    {
      id: 'bw-verb',
      type: 'reverb',
      x: 1880,
      y: 820,
      values: { 'Decay s': 1.8, 'PreDelay s': 0.01, Wet: 0.3 },
    },
    {
      id: 'bw-out',
      type: 'filter',
      x: 2140,
      y: 820,
      values: { Type: 'highpass', Freq: 30, Q: 0.7 },
    },
    {
      id: 'bw-render',
      type: 'render',
      x: 2400,
      y: 840,
      values: { 'Level dB': -7 },
    },
  );
  edges.push(
    { from: 'bw-splashNoise', output: 'Out', to: 'bw-splashEnv', input: 'In' },
    { from: 'bw-splashEnv', output: 'Out', to: 'bw-splashHp', input: 'In' },
    { from: 'bw-splashHp', output: 'Out', to: 'bw-mix', input: 'In' },
    { from: 'bw-bedNoise', output: 'Out', to: 'bw-bedBp', input: 'In' },
    { from: 'bw-bedBp', output: 'Out', to: 'bw-bedEnv', input: 'In' },
    { from: 'bw-bedEnv', output: 'Out', to: 'bw-mix', input: 'In' },
    { from: 'bw-mix', output: 'Out', to: 'bw-verb', input: 'In' },
    { from: 'bw-verb', output: 'Out', to: 'bw-out', input: 'In' },
    { from: 'bw-out', output: 'Out', to: 'bw-render', input: 'In' },
  );
  return buildState(nodes, edges);
}

// ──────────────────────────────────────────────────────────────────────────
// SOLOS — a note-event score compiler.
//
// A solo is written as a list of NOTES, and the lanes are DERIVED. Writing 39
// curves by hand (13 voices x Hz/gate/Amp for the guitar alone) is how off-by-
// one errors get into a score and never come out; a sequencer does not ask its
// user to draw envelopes either.
//
// THE THREE RULES THE COMPILER ENFORCES, each of which is a real trap:
//
//  1. PITCH AND AMP ARE SET BEFORE THE GATE OPENS. A physical model reads its
//     pitch when the gate rises. Put the Hz point ON the onset and the note
//     speaks at the PREVIOUS pitch, because the curve has not moved yet. Every
//     note lane therefore leads the gate by `SOLO_LEAD`.
//  2. A GATE MUST CLOSE BEFORE THE SAME VOICE IS STRUCK AGAIN. Two onsets
//     inside one continuous gate-high span produce one note, not two — this is
//     oracle O13, and it is enforced here by CONSTRUCTION rather than merely
//     tested: an overlapping gate is clamped to leave `SOLO_RELEASE_GAP`.
//  3. A CURVE HOLDS ITS FIRST POINT'S VALUE BEFORE THAT POINT (hold-clamp), so
//     every gate lane gets an explicit 0 anchor at t = 0 or the voice sounds
//     from the moment the transport starts.
//
// `step` interpolation is what makes a note lane a note lane: the value holds
// flat until the next keyframe instead of gliding between them. Bends opt into
// `linear` for exactly the span they cover, which is how a slur or a pull-off
// is written.
// ──────────────────────────────────────────────────────────────────────────

/** A ramp inside a note: at `at` seconds in, move to `v` over `over` seconds. */
type SoloRamp = { at: number; v: number; over: number };

/**
 * One note event.
 *
 * `bend` moves the PITCH inside this note's gate (slur, pull-off, portamento).
 * `swell` does the same for `Amp` and `press` for bowed `Force` — both only
 * mean anything on instruments that read them per sample. A plucked string
 * reads `Amp` once, at the gate edge, so a swell on one is silent.
 */
type SoloNote = {
  t: number;
  hz: number;
  voice: number;
  gate: number;
  amp: number;
  bend?: readonly { at: number; hz: number; over: number }[];
  force?: number;
  swell?: readonly SoloRamp[];
  press?: readonly SoloRamp[];
};

/** Pitch and amplitude lead the gate, so the model reads them in time. */
const SOLO_LEAD = 0.006;
/** Minimum silence the compiler leaves between two notes on ONE voice. */
const SOLO_RELEASE_GAP = 0.012;
/**
 * Every score is shifted this far into the transport.
 *
 * NOT cosmetic. A gate lane needs a 0 anchor BEFORE its first 1 or the
 * hold-clamp leaves it high from the moment the transport starts — and a gate
 * that is already high in the first block has no RISING EDGE. Both the plucked
 * string and the envelope worklet are edge-triggered (`lastGate === null` means
 * no edge at start), so a note written at t = 0 would never sound at all.
 */
const SOLO_START_OFFSET = 0.25;
/**
 * The schema requires points strictly increasing by at least 1 ms, so the
 * separation used here is 2 ms and the result is ROUNDED to microseconds.
 *
 * Both details are load-bearing. `1.45 + 0.001` evaluates to
 * 1.4509999999999998 in binary floating point, which is LESS than 1.451 and
 * fails a `>= 0.001` check by one ulp. Rounding keeps the timestamps exact to
 * the microsecond and the wider gap leaves the comparison no room to lose.
 */
const SOLO_MIN_POINT_GAP = 0.002;

/**
 * Nudge coincident keyframes apart just enough to satisfy the schema.
 *
 * Two lanes legitimately land on the same instant — a bend that begins exactly
 * on a following note, a gate closing as another opens. Rather than reject the
 * score, separate them by the minimum the format allows; 1 ms is far below the
 * ear's resolution for these events and never reorders them.
 */
function spreadPoints(points: CurvePoint[]): CurvePoint[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  for (let i = 1; i < sorted.length; i++) {
    const earliest =
      Math.round((sorted[i - 1].t + SOLO_MIN_POINT_GAP) * 1e6) / 1e6;
    if (sorted[i].t < earliest) {
      sorted[i] = { ...sorted[i], t: earliest };
    }
  }
  return sorted;
}

function soloNote(
  t: number,
  hz: number,
  voice: number,
  gate: number,
  amp: number,
  bend?: readonly { at: number; hz: number; over: number }[],
): SoloNote {
  return { t, hz, voice, gate, amp, bend };
}

/**
 * Bow pressure FOLLOWS the dynamic. This is the measured Schelleng window of
 * the thermal model (vibrato + noise on, 220..1175 Hz, slips per period):
 *
 *   Amp 0.25-0.55:  force 0.06-0.10  Helmholtz at every pitch
 *                   force 0.12       DOUBLE slipping at 880 Hz when soft
 *   Amp 0.65-0.95:  force 0.12-0.20  Helmholtz at every pitch
 *                   force 0.286      DOUBLE at 440-880   (the old mapping's
 *                   force 0.418      MULTIPLE everywhere  expressive range)
 *
 * Schelleng's MAXIMUM force scales with bow speed, so a slow, soft bow must
 * also be a LIGHT one — a player does this without thinking, and a score that
 * writes pressure independently of dynamic (as the research draft did, with a
 * 1.9 "bite" at a soft moment) walks straight out of the window into the
 * raucous multi-slip buzz the ear test called "bagpipe". So the Force lane is
 * DERIVED from the Amp lane by this law and the score writes dynamics only.
 * A note may still carry an explicit `force`/`press` to override it.
 */
function forceForAmp(amp: number): number {
  const t = Math.min(1, Math.max(0, (amp - 0.3) / 0.65));
  return 0.08 + (0.2 - 0.08) * t;
}

function soloCurveId(
  prefix: string,
  voice: number,
  lane: 'hz' | 'gate' | 'amp' | 'force',
): string {
  return `crv_${prefix}V${voice}${lane}`;
}

/**
 * Compile a note list into one Hz lane, one gate lane and one Amp lane per
 * voice.
 *
 * `ampInterp` is per instrument and is NOT cosmetic: plucked `Amp` is read once
 * at the gate edge as pluck VELOCITY, so it must hold flat (`step`); bowed and
 * flute `Amp` are read per sample as a live gain, so they want `linear` and
 * shape the note as it sounds.
 */
function compileSoloCurves(
  prefix: string,
  voiceCount: number,
  notes: readonly SoloNote[],
  ampInterp: SideInterp,
  colors: readonly string[],
  withForce = false,
): TimelineCurve[] {
  const curves: TimelineCurve[] = [];
  for (let voice = 0; voice < voiceCount; voice++) {
    const mine = notes
      .filter((note) => note.voice === voice)
      .sort((a, b) => a.t - b.t);
    const color = colors[voice % colors.length];
    if (mine.length === 0) {
      // A silent voice still needs lanes, or its curve node has nothing to
      // reference and the score fails the orphan-lane oracle.
      curves.push(
        orchestraCurve(soloCurveId(prefix, voice, 'hz'), `v${voice} Hz`, color, 220, [
          curvePoint(0, 220, 'step', 'step'),
        ]),
        orchestraCurve(soloCurveId(prefix, voice, 'gate'), `v${voice} gate`, color, 0, [
          curvePoint(0, 0, 'step', 'step'),
        ]),
        orchestraCurve(soloCurveId(prefix, voice, 'amp'), `v${voice} amp`, color, 0, [
          curvePoint(0, 0, 'step', 'step'),
        ]),
      );
      if (withForce) {
        curves.push(
          orchestraCurve(
            soloCurveId(prefix, voice, 'force'),
            `v${voice} force`,
            color,
            forceForAmp(0.5),
            [curvePoint(0, forceForAmp(0.5), 'step', 'step')],
          ),
        );
      }
      continue;
    }

    const hzPoints: CurvePoint[] = [curvePoint(0, mine[0].hz, 'step', 'step')];
    const gatePoints: CurvePoint[] = [curvePoint(0, 0, 'step', 'step')];
    const ampPoints: CurvePoint[] = [
      curvePoint(0, mine[0].amp, 'step', ampInterp),
    ];
    const explicitForce = mine.some(
      (note) => note.force !== undefined || note.press !== undefined,
    );
    const forcePoints: CurvePoint[] = [
      curvePoint(0, mine[0].force ?? forceForAmp(mine[0].amp), 'step', 'linear'),
    ];

    mine.forEach((note, index) => {
      const onset = note.t + SOLO_START_OFFSET;
      const lead = Math.max(0, onset - SOLO_LEAD);
      hzPoints.push(curvePoint(lead, note.hz, 'step', 'step'));
      ampPoints.push(curvePoint(lead, note.amp, ampInterp, ampInterp));
      if (note.force !== undefined) {
        forcePoints.push(curvePoint(lead, note.force, 'linear', 'linear'));
      }

      // Ramps INSIDE the note: the messa di voce, the martele bite, the bow
      // running out at the end. These only reach instruments that read the
      // parameter per sample.
      let level = note.amp;
      for (const ramp of note.swell ?? []) {
        const from = onset + ramp.at;
        ampPoints.push(curvePoint(from, level, ampInterp, 'linear'));
        ampPoints.push(curvePoint(from + ramp.over, ramp.v, 'linear', ampInterp));
        level = ramp.v;
      }
      let pressure = note.force ?? forceForAmp(note.amp);
      for (const ramp of note.press ?? []) {
        const from = onset + ramp.at;
        forcePoints.push(curvePoint(from, pressure, 'linear', 'linear'));
        forcePoints.push(curvePoint(from + ramp.over, ramp.v, 'linear', 'linear'));
        pressure = ramp.v;
      }

      // Rule 2: never let this gate run into the next note on this voice.
      const next = mine[index + 1];
      let off = onset + note.gate;
      if (next !== undefined) {
        off = Math.min(
          off,
          next.t + SOLO_START_OFFSET - SOLO_LEAD - SOLO_RELEASE_GAP,
        );
      }
      // A gate shorter than the lead would fire and close inside one block.
      off = Math.max(off, onset + 0.02);
      gatePoints.push(curvePoint(onset, 1, 'step', 'step'));
      gatePoints.push(curvePoint(off, 0, 'step', 'step'));

      // Bends ride INSIDE this note's gate: hold, then ramp, then hold again.
      let current = note.hz;
      for (const bend of note.bend ?? []) {
        const from = onset + bend.at;
        hzPoints.push(curvePoint(from, current, 'step', 'linear'));
        hzPoints.push(curvePoint(from + bend.over, bend.hz, 'linear', 'step'));
        current = bend.hz;
      }
    });

    const sorted = spreadPoints;
    curves.push(
      orchestraCurve(
        soloCurveId(prefix, voice, 'hz'),
        `v${voice} Hz`,
        color,
        mine[0].hz,
        sorted(hzPoints),
      ),
      orchestraCurve(
        soloCurveId(prefix, voice, 'gate'),
        `v${voice} gate`,
        color,
        0,
        sorted(gatePoints),
      ),
      orchestraCurve(
        soloCurveId(prefix, voice, 'amp'),
        `v${voice} amp`,
        color,
        mine[0].amp,
        sorted(ampPoints),
      ),
    );
    if (withForce) {
      // No explicit pressure anywhere on this voice: the Force lane is the Amp
      // lane through the measured law, point for point, so a swell lightens
      // and a crescendo leans in exactly as the dynamic moves.
      const lane = explicitForce
        ? sorted(forcePoints)
        : sorted(ampPoints).map((point) => ({ ...point, v: forceForAmp(point.v) }));
      curves.push(
        orchestraCurve(
          soloCurveId(prefix, voice, 'force'),
          `v${voice} force`,
          color,
          lane[0].v,
          lane,
        ),
      );
    }
  }
  return curves;
}

/** One physical-model voice, with its per-voice FIXED parameters. */
type SoloVoiceSpec = {
  /**
   * A node type id. The three physical models are used BARE, so their
   * per-voice `Position`/`Brightness`/`Force` are reachable; the pad and the
   * synth lead have no bare equivalent and use their shipped instrument
   * groups, whose Hz/Gate/Amp contract this wiring already matches.
   */
  type: SoundCatalogNodeTypeId;
  values: Record<string, string | number>;
};

/**
 * Build the graph for a solo: per voice an instrument plus its three lanes and
 * a Threshold to turn the gate lane into a `boolSignal`, then ONE shared body
 * and a room.
 *
 * BARE NODES, NOT THE SHIPPED INSTRUMENT GROUPS. A group exposes only
 * `Hz`/`Gate`/`Amp` and hard-codes everything else inside, so `Position`,
 * `Brightness` and bowed `Force` — the parameters that make one voice sound
 * different from another — are unreachable through it. Voice specialisation is
 * the entire expressive technique here, because the fixed parameters cannot be
 * automated: a `number` input is read ONCE at Run.
 *
 * ONE body for all voices, because a guitar has one body. The strings mix
 * first and the resonator sees the sum, which is both cheaper and right.
 */
function buildSoloGraph(
  prefix: string,
  voices: readonly SoloVoiceSpec[],
  tail: {
    body?: 'guitar' | 'violin';
    bodyMix?: number;
    reverbDecay: number;
    reverbWet: number;
    renderDb: number;
    /**
     * Makeup gain for the bare-node path.
     *
     * The SHIPPED instrument groups each carry a fitted level gain inside them
     * (Phase C, the "fitted-level gain + Amp gain tail" idiom). Building from
     * bare nodes to reach `Position`/`Brightness`/`Force` means giving that up,
     * and a raw plucked string into a raw body lands about 30 dB below where a
     * demo should sit. Measured on the guitar solo: master peak 0.011 without
     * it. This is the only thing the groups were doing that we still need.
     */
    busGain?: number;
    /**
     * A lowpass whose `Freq` is driven by a timeline lane. Filter `Freq` and
     * `Q` are `signal` inputs, so a cutoff ride is one of the few genuinely
     * automatable gestures here — and on a pad it carries the whole arc.
     */
    cutoffCurveId?: string;
    cutoffQ?: number;
    chorus?: { rate: number; depth: number; wet: number };
    drive?: { amount: number; wet: number };
    echo?: { time: number; feedback: number; wet: number };
    /** A lane on the ping-pong's `Wet` — the "delay throw". */
    echoWetCurveId?: string;
    /** bowed only: give every voice its own live bow-pressure lane. */
    withForce?: boolean;
  },
): ProbeState {
  const nodes: NodeSpec[] = [];
  const edges: EdgeSpec[] = [];

  voices.forEach((voice, index) => {
    const y = index * 520;
    const hz = `${prefix}-cHz${index}`;
    const gate = `${prefix}-cGate${index}`;
    const amp = `${prefix}-cAmp${index}`;
    const threshold = `${prefix}-th${index}`;
    const inst = `${prefix}-v${index}`;
    nodes.push(
      curveNode(hz, y, soloCurveId(prefix, index, 'hz')),
      curveNode(gate, y + 160, soloCurveId(prefix, index, 'gate')),
      curveNode(amp, y + 320, soloCurveId(prefix, index, 'amp')),
      {
        id: threshold,
        type: 'threshold',
        x: 420,
        y: y + 160,
        values: { Threshold: 0.5, Hysteresis: 0.1 },
      },
      { id: inst, type: voice.type, x: 760, y: y + 120, values: voice.values },
    );
    edges.push(
      { from: hz, output: 'Signal', to: inst, input: 'Hz' },
      { from: gate, output: 'Signal', to: threshold, input: 'In' },
      { from: threshold, output: 'Gate', to: inst, input: 'Gate' },
      { from: amp, output: 'Signal', to: inst, input: 'Amp' },
      { from: inst, output: 'Out', to: `${prefix}-mix`, input: 'In' },
    );
    if (tail.withForce === true) {
      const force = `${prefix}-cForce${index}`;
      nodes.push(curveNode(force, y + 400, soloCurveId(prefix, index, 'force')));
      edges.push({ from: force, output: 'Signal', to: inst, input: 'Force' });
    }
  });

  const busY = 200;
  nodes.push({ id: `${prefix}-mix`, type: 'mix', x: 1120, y: busY });
  let last = `${prefix}-mix`;
  if (tail.body !== undefined) {
    nodes.push({
      id: `${prefix}-body`,
      type: 'stringBody',
      x: 1400,
      y: busY,
      values: { Preset: tail.body, Mix: tail.bodyMix ?? 1 },
    });
    edges.push({ from: last, output: 'Out', to: `${prefix}-body`, input: 'In' });
    last = `${prefix}-body`;
  }
  if (tail.cutoffCurveId !== undefined) {
    nodes.push(
      curveNode(`${prefix}-cCutoff`, voices.length * 520 + 120, tail.cutoffCurveId),
      {
        id: `${prefix}-cutoff`,
        type: 'filter',
        x: 1400,
        y: busY + 200,
        values: { Type: 'lowpass', Q: tail.cutoffQ ?? 1.2 },
      },
    );
    edges.push(
      { from: last, output: 'Out', to: `${prefix}-cutoff`, input: 'In' },
      {
        from: `${prefix}-cCutoff`,
        output: 'Signal',
        to: `${prefix}-cutoff`,
        input: 'Freq',
      },
    );
    last = `${prefix}-cutoff`;
  }

  if (tail.chorus !== undefined) {
    nodes.push({
      id: `${prefix}-chorus`,
      type: 'chorus',
      x: 1460,
      y: busY + 120,
      values: {
        'Rate Hz': tail.chorus.rate,
        Depth: tail.chorus.depth,
        Wet: tail.chorus.wet,
      },
    });
    edges.push({ from: last, output: 'Out', to: `${prefix}-chorus`, input: 'In' });
    last = `${prefix}-chorus`;
  }

  if (tail.drive !== undefined) {
    nodes.push({
      id: `${prefix}-drive`,
      type: 'saturator',
      x: 1500,
      y: busY + 300,
      values: { Drive: tail.drive.amount, Trim: 0.9, Wet: tail.drive.wet },
    });
    edges.push({ from: last, output: 'Out', to: `${prefix}-drive`, input: 'In' });
    last = `${prefix}-drive`;
  }

  if (tail.echo !== undefined) {
    nodes.push({
      id: `${prefix}-echo`,
      type: 'pingPongDelay',
      x: 1560,
      y: busY + 380,
      values: {
        'Time s': tail.echo.time,
        Feedback: tail.echo.feedback,
        Wet: tail.echo.wet,
      },
    });
    edges.push({ from: last, output: 'Out', to: `${prefix}-echo`, input: 'In' });
    if (tail.echoWetCurveId !== undefined) {
      nodes.push(
        curveNode(`${prefix}-cEchoWet`, voices.length * 520 + 280, tail.echoWetCurveId),
      );
      edges.push({
        from: `${prefix}-cEchoWet`,
        output: 'Signal',
        to: `${prefix}-echo`,
        input: 'Wet',
      });
    }
    last = `${prefix}-echo`;
  }

  if (tail.busGain !== undefined) {
    nodes.push({
      id: `${prefix}-makeup`,
      type: 'gain',
      x: 1540,
      y: busY,
      values: { Gain: tail.busGain },
    });
    edges.push({ from: last, output: 'Out', to: `${prefix}-makeup`, input: 'In' });
    last = `${prefix}-makeup`;
  }

  nodes.push(
    {
      id: `${prefix}-verb`,
      type: 'reverb',
      x: 1680,
      y: busY,
      values: {
        'Decay s': tail.reverbDecay,
        'PreDelay s': 0.02,
        Wet: tail.reverbWet,
      },
    },
    {
      id: `${prefix}-out`,
      type: 'filter',
      x: 1960,
      y: busY,
      values: { Type: 'highpass', Freq: 30, Q: 0.7 },
    },
    {
      id: `${prefix}-render`,
      type: 'render',
      x: 2240,
      y: busY + 20,
      values: { 'Level dB': tail.renderDb },
    },
  );
  edges.push(
    { from: last, output: 'Out', to: `${prefix}-verb`, input: 'In' },
    { from: `${prefix}-verb`, output: 'Out', to: `${prefix}-out`, input: 'In' },
    { from: `${prefix}-out`, output: 'Out', to: `${prefix}-render`, input: 'In' },
  );
  return buildState(nodes, edges);
}

const SOLO_COLORS = [
  '#f97316',
  '#22d3ee',
  '#a78bfa',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#60a5fa',
];

// ── SOLO 1 — GUITAR: "Back Porch Run" (country flatpicking) ─────────────
//
// The first version was a classical E-minor nocturne: sparse, dark, tremolo.
// The verdict was "too simple and low sound, doesn't give that guitar riff
// country refreshing feeling" — a GENRE miss, not a tuning miss. This is an
// original flatpicking piece in the bluegrass/country idiom instead:
//
//   G major, 4/4 at quarter = 124 (bar 1.935 s), 16 bars, ~33 s.
//   BOOM-CHICK: alternating bass on 1 and 3 (root / fifth), a short
//     three-string "chick" on 2 and 4. That alternation IS the country feel.
//   THE G-RUN: the Lester-Flatt cadence figure G2 A2 (hammer) B2 D3 G3 that
//     closes a phrase — the single most recognisable lick in the style.
//   LICKS from the G major pentatonic with hammer-ons (a `bend` inside one
//     gate, 12 ms), and double-stop thirds on the strong beats.
//   A walk-down turnaround into a big open-G strum that RINGS to the end.
//
// VOICING. Everything is brighter, harder and louder than before:
//   `Pick: 'nail'`   — a flatpick is a hard, fast contact (0.15 ms vs 0.35)
//   Position 0.13-0.18 — nearer the bridge than the nocturne's 0.24-0.28
//   Brightness 0.72-0.82, Decay 4-4.5 s — steel-string snap, not nylon bloom
//   Amp 0.62 -> 0.92 — the old piece sat at 0.3-0.5, which read as "low"
// Nine voices: two alternating bass, three chick strings (a strum is three
// onsets 8 ms apart, never one), three lead.
const CG_BPM = 124;
const CG_BEAT = 60 / CG_BPM;
const CG_BAR = 4 * CG_BEAT;
/** Absolute time of (bar, beat) — beat may be fractional: 2.5 is the "and". */
function cgAt(bar: number, beat: number): number {
  return (bar - 1) * CG_BAR + (beat - 1) * CG_BEAT;
}

const CG = {
  G2: 98.0, A2: 110.0, B2: 123.47, C3: 130.81, D3: 146.83, E3: 164.81,
  FS3: 185.0, G3: 196.0, A3: 220.0, B3: 246.94, C4: 261.63, D4: 293.66,
  E4: 329.63, FS4: 369.99, G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25,
  D5: 587.33, E5: 659.25, G5: 783.99,
};

type CgChord = { root: number; fifth: number; chick: readonly [number, number, number] };
const CG_CHORDS: Record<'G' | 'C' | 'D' | 'Em', CgChord> = {
  G: { root: CG.G2, fifth: CG.D3, chick: [CG.G3, CG.B3, CG.D4] },
  C: { root: CG.C3, fifth: CG.G2, chick: [CG.G3, CG.C4, CG.E4] },
  D: { root: CG.D3, fifth: CG.A2, chick: [CG.A3, CG.D4, CG.FS4] },
  Em: { root: CG.E3, fifth: CG.B2, chick: [CG.G3, CG.B3, CG.E4] },
};

function guitarSoloNotes(): SoloNote[] {
  const n = soloNote;
  const notes: SoloNote[] = [];
  let bassVoice = 0;

  // One bar of boom-chick. `amp` is the bar's dynamic; the chick sits under
  // the bass, the way a rhythm hand does.
  const boomChick = (bar: number, chord: CgChord, amp: number, skipBeat4 = false) => {
    for (const [beat, hz] of [[1, chord.root], [3, chord.fifth]] as const) {
      notes.push(n(cgAt(bar, beat), hz, bassVoice, 0.42, amp));
      bassVoice = bassVoice === 0 ? 1 : 0;
    }
    for (const beat of skipBeat4 ? [2] : [2, 4]) {
      chord.chick.forEach((hz, i) => {
        notes.push(n(cgAt(bar, beat) + i * 0.008, hz, 2 + i, 0.19, amp * 0.72));
      });
    }
  };

  // The G-run, landing on beat 3 of `bar`: G2, A2 hammered to B2, D3, G3.
  const gRun = (bar: number, amp: number) => {
    notes.push(
      n(cgAt(bar, 3), CG.G2, 6, 0.22, amp),
      n(cgAt(bar, 3.5), CG.A2, 7, 0.46, amp, [{ at: 0.24, hz: CG.B2, over: 0.012 }]),
      n(cgAt(bar, 4), CG.D3, 8, 0.22, amp * 0.95),
      n(cgAt(bar, 4.5), CG.G3, 6, 0.9, amp * 1.05),
    );
  };

  // ── Section A: the tune, bars 1-8 ──
  boomChick(1, CG_CHORDS.G, 0.62);
  boomChick(2, CG_CHORDS.G, 0.64, true);
  // pickup lick into the C: B3 hammered to D4, E4, D4
  notes.push(
    n(cgAt(2, 3.5), CG.B3, 6, 0.3, 0.7, [{ at: 0.11, hz: CG.D4, over: 0.012 }]),
    n(cgAt(2, 4), CG.E4, 7, 0.22, 0.74),
    n(cgAt(2, 4.5), CG.D4, 8, 0.22, 0.7),
  );
  boomChick(3, CG_CHORDS.C, 0.66);
  boomChick(4, CG_CHORDS.G, 0.66, true);
  gRun(4, 0.78);
  boomChick(5, CG_CHORDS.D, 0.68);
  boomChick(6, CG_CHORDS.D, 0.7, true);
  // D-chord lick: A3 -> B3 hammer, D4, then the double-stop 3rd F#4+A4
  notes.push(
    n(cgAt(6, 3), CG.A3, 6, 0.3, 0.74, [{ at: 0.12, hz: CG.B3, over: 0.012 }]),
    n(cgAt(6, 3.5), CG.D4, 7, 0.22, 0.76),
    n(cgAt(6, 4), CG.FS4, 6, 0.44, 0.8),
    n(cgAt(6, 4) + 0.008, CG.A4, 8, 0.44, 0.74),
  );
  boomChick(7, CG_CHORDS.G, 0.72);
  boomChick(8, CG_CHORDS.G, 0.74, true);
  gRun(8, 0.86);

  // ── Section B: the break, bars 9-16 — the lead takes over, louder ──
  boomChick(9, CG_CHORDS.G, 0.78);
  // pentatonic run up: G4 A4 B4 D5, then the double-stop B4+D5 on the beat
  notes.push(
    n(cgAt(9, 1.5), CG.G4, 6, 0.2, 0.82),
    n(cgAt(9, 2), CG.A4, 7, 0.2, 0.84),
    n(cgAt(9, 2.5), CG.B4, 8, 0.2, 0.86),
    n(cgAt(9, 3), CG.D5, 6, 0.44, 0.9),
    n(cgAt(9, 4), CG.B4, 7, 0.4, 0.86),
    n(cgAt(9, 4) + 0.008, CG.D5, 8, 0.4, 0.8),
  );
  boomChick(10, CG_CHORDS.C, 0.8);
  notes.push(
    n(cgAt(10, 1.5), CG.E5, 6, 0.2, 0.88),
    n(cgAt(10, 2), CG.D5, 7, 0.2, 0.86),
    n(cgAt(10, 2.5), CG.C5, 8, 0.2, 0.84),
    n(cgAt(10, 3), CG.E4, 6, 0.4, 0.86, [{ at: 0.1, hz: CG.G4, over: 0.014 }]),
    n(cgAt(10, 4), CG.C5, 7, 0.4, 0.84),
    n(cgAt(10, 4) + 0.008, CG.E5, 8, 0.4, 0.78),
  );
  boomChick(11, CG_CHORDS.G, 0.82);
  notes.push(
    n(cgAt(11, 1.5), CG.B4, 6, 0.2, 0.88),
    n(cgAt(11, 2), CG.G4, 7, 0.2, 0.86),
    n(cgAt(11, 2.5), CG.A4, 8, 0.3, 0.88, [{ at: 0.1, hz: CG.B4, over: 0.012 }]),
    n(cgAt(11, 3), CG.D5, 6, 0.44, 0.92), // THE APEX, 65 % through
    n(cgAt(11, 4), CG.B4, 7, 0.44, 0.9),
  );
  boomChick(12, CG_CHORDS.Em, 0.82);
  notes.push(
    n(cgAt(12, 1.5), CG.G4, 6, 0.2, 0.84),
    n(cgAt(12, 2), CG.E4, 7, 0.2, 0.82),
    n(cgAt(12, 2.5), CG.D4, 8, 0.2, 0.8),
    n(cgAt(12, 3), CG.E4, 6, 0.44, 0.84),
    n(cgAt(12, 4), CG.G4, 7, 0.44, 0.82),
  );
  boomChick(13, CG_CHORDS.C, 0.8);
  notes.push(
    n(cgAt(13, 1.5), CG.E4, 6, 0.2, 0.82),
    n(cgAt(13, 2), CG.G4, 7, 0.2, 0.82),
    n(cgAt(13, 2.5), CG.A4, 8, 0.2, 0.84),
    n(cgAt(13, 3), CG.C5, 6, 0.44, 0.86),
    n(cgAt(13, 3) + 0.008, CG.E5, 7, 0.44, 0.78),
  );
  boomChick(14, CG_CHORDS.D, 0.82);
  notes.push(
    n(cgAt(14, 1.5), CG.A4, 6, 0.2, 0.84),
    n(cgAt(14, 2), CG.FS4, 7, 0.2, 0.82),
    n(cgAt(14, 2.5), CG.D4, 8, 0.2, 0.8),
    n(cgAt(14, 3), CG.FS4, 6, 0.44, 0.86),
    n(cgAt(14, 3) + 0.008, CG.A4, 7, 0.44, 0.8),
    n(cgAt(14, 4), CG.C5, 8, 0.44, 0.84), // the 7th, pulling home
  );
  // bar 15: walk-down turnaround on the bass, then the G-run
  notes.push(
    n(cgAt(15, 1), CG.D3, 0, 0.42, 0.84),
    n(cgAt(15, 1.5), CG.C3, 1, 0.42, 0.84),
    n(cgAt(15, 2), CG.B2, 0, 0.42, 0.86),
    n(cgAt(15, 2.5), CG.A2, 1, 0.42, 0.86),
  );
  gRun(15, 0.9);
  // bar 16: the big open-G strum, six strings 12 ms apart, ringing out
  [CG.G2, CG.B2, CG.D3, CG.G3, CG.B3, CG.G4].forEach((hz, i) => {
    notes.push(n(cgAt(16, 1) + i * 0.012, hz, i, 3.6, 0.9 + i * 0.01));
  });
  return notes;
}

const GUITAR_SOLO_SECONDS = 16 * CG_BAR + 2.2 + SOLO_START_OFFSET;

function guitarSoloVoices(): SoloVoiceSpec[] {
  const voice = (position: number, brightness: number, decay: number): SoloVoiceSpec => ({
    type: 'pluckedString',
    values: {
      Position: position,
      Brightness: brightness,
      'Decay s': decay,
      Damp: 'on',
      Pick: 'nail',
    },
  });
  return [
    voice(0.18, 0.72, 4.5),
    voice(0.18, 0.72, 4.5),
    voice(0.16, 0.76, 4),
    voice(0.16, 0.76, 4),
    voice(0.16, 0.76, 4),
    voice(0.13, 0.82, 4),
    voice(0.13, 0.82, 4),
    voice(0.13, 0.82, 4),
    voice(0.13, 0.82, 4),
  ];
}

const guitarSoloTimeline: TimelineDocument = {
  version: 1,
  durationSec: GUITAR_SOLO_SECONDS,
  loop: true,
  curves: compileSoloCurves(
    'gs',
    9,
    guitarSoloNotes(),
    // Plucked `Amp` is pluck VELOCITY, read once at the gate edge, so it must
    // hold flat. A linear lane would slide the velocity between notes and the
    // tremolo accents would smear into each other.
    'step',
    SOLO_COLORS,
  ),
};

// ── SOLO 2 — VIOLIN: "Lament and Flight" ─────────────────────────────────
//
// D minor, 3/4 with sarabande weight on beat 2, ~36 s. D minor because the open
// D and A strings are the tonic and dominant, so the instrument rings with the
// key rather than against it.
//
// SIX VOICES, DIFFERING ONLY IN VIBRATO AND BOW POSITION. `Vib Cents` and
// `Position` are `number` inputs, read ONCE at Run, so a player's arrival of
// vibrato part-way through a held note CANNOT be automated. It is done instead
// by cross-fading a senza-vibrato voice into a vibrato one on the same pitch,
// on their `Amp` lanes, which bowed strings read PER SAMPLE:
//
//   v0 Va  Vib 0   Position 0.127  straight tone (unused after round 1 — kept so ids stay stable)
//   v1 Vb  Vib 12  Position 0.127  normale, the default melody voice
//   v2 Vc  Vib 22  Position 0.115  molto vibrato, toward the bridge — the peak
//   v3 Vd  Vib 0   Position 0.140  lower voice of double stops, bows straight
//
// FOUR voices, not the six the research proposed. The score never uses a
// second lower voice or a pedal, and `bowedStringCore` DELIBERATELY has no
// idle short-circuit (it documents 1.24-1.39 % of a core each while silent),
// so two unused voices would burn ~2.6 % of a core on nothing and put eight
// empty lanes in the timeline dock.
//
// That Va -> Vb cross-fade at t 1.2 is the single gesture that separates a
// violin from a sawtooth, and it is the reason this solo uses bare
// `bowedString` nodes instead of the shipped group, which exposes neither.
//
// THE ENDING IS THE MODEL'S OWN PHYSICS. Over the last three seconds `Force`
// falls toward Schelleng's minimum bow force; below it the string stops
// sustaining Helmholtz motion and the tone thins and loses its corner. That is
// precisely the sound of a bow running out, and here it is the ending.
function violinSoloNotes(): SoloNote[] {
  const n = soloNote;
  return [
    // Bars 1-2: the opening statement on the G string, messa di voce.
    {
      // ONE voice from the first note. The draft cross-faded a straight-tone
      // voice into a vibrato voice on the SAME pitch to make vibrato "arrive";
      // two bowed strings on one pitch, one of them wobbling, BEAT against each
      // other — and the model is not silent at Amp 0, so both sounded for the
      // whole hand-over. That beating was the "dissonant" opening.
      ...n(0.0, 220.0, 1, 5.75, 0.22),
      bend: [
        { at: 3.0, hz: 233.08, over: 0.02 },
        { at: 4.0, hz: 261.63, over: 0.02 },
        { at: 5.0, hz: 293.66, over: 0.02 },
      ],
      swell: [
        { at: 0, v: 0.72, over: 1.5 },
        { at: 1.5, v: 0.4, over: 1.5 },
        { at: 3.0, v: 0.45, over: 0.05 },
        { at: 4.0, v: 0.52, over: 0.05 },
        { at: 5.0, v: 0.6, over: 0.05 },
      ],
    },

    // Bars 3-4: detache theme, then an audible position shift.
    { ...n(6.0, 349.23, 1, 1.45, 0.5), swell: [{ at: 0, v: 0.56, over: 1.4 }] },
    { ...n(7.5, 329.63, 1, 0.45, 0.52) },
    { ...n(8.0, 293.66, 1, 0.95, 0.55) },
    { ...n(9.0, 277.18, 1, 0.95, 0.58) },
    {
      // PORTAMENTO over 120 ms inside one gate — the shift a violinist makes
      // audibly, which is a different sound from two separate notes.
      ...n(10.0, 293.66, 1, 2.9, 0.55),
      bend: [{ at: 0.9, hz: 440.0, over: 0.12 }],
      swell: [{ at: 0.9, v: 0.68, over: 0.12 }],
    },

    // Bars 5-6: DOUBLE STOPS. The passage that can only be a solo string.
    { ...n(13.0, 349.23, 1, 0.95, 0.62) },
    { ...n(13.0, 293.66, 3, 0.95, 0.5) },
    { ...n(14.0, 392.0, 1, 0.95, 0.64) },
    { ...n(14.0, 293.66, 3, 0.95, 0.5) },
    { ...n(15.0, 440.0, 1, 0.95, 0.66) },
    { ...n(15.0, 293.66, 3, 0.95, 0.52) },
    { ...n(16.0, 440.0, 1, 0.95, 0.68) },
    { ...n(16.0, 329.63, 3, 0.95, 0.54) },
    // The 6th, then its resolution — the suspension is the point of the bar.
    { ...n(17.0, 466.16, 1, 0.65, 0.72) },
    { ...n(17.0, 293.66, 3, 0.65, 0.56) },
    { ...n(17.7, 440.0, 1, 0.3, 0.7) },
    { ...n(17.7, 277.18, 3, 0.3, 0.54) },

    // Bars 7-8: rising eighths SLURRED IN PAIRS — each pair is one gate,
    // because a slur is one bow stroke.
    { ...n(18.15, 587.33, 1, 0.86, 0.7), bend: [{ at: 0.43, hz: 659.25, over: 0.03 }], swell: [{ at: 0.43, v: 0.73, over: 0.03 }] },
    { ...n(19.055, 698.46, 1, 0.86, 0.75), bend: [{ at: 0.43, hz: 783.99, over: 0.03 }], swell: [{ at: 0.43, v: 0.78, over: 0.03 }] },
    { ...n(19.96, 880.0, 1, 0.86, 0.8), bend: [{ at: 0.43, hz: 783.99, over: 0.03 }], swell: [{ at: 0.43, v: 0.78, over: 0.03 }] },
    { ...n(20.865, 698.46, 1, 0.78, 0.82), bend: [{ at: 0.39, hz: 783.99, over: 0.03 }] },
    { ...n(21.69, 880.0, 1, 0.78, 0.86), bend: [{ at: 0.39, hz: 932.33, over: 0.03 }] },
    { ...n(22.515, 880.0, 1, 0.78, 0.88), bend: [{ at: 0.39, hz: 783.99, over: 0.03 }] },
    {
      // MARTELE: a hard bite of pressure for 55 ms, then release into the note.
      // Then the portamento up the E string INTO the peak, still on one bow.
      ...n(23.34, 932.33, 1, 0.69, 0.9),
      bend: [{ at: 0.6, hz: 1174.66, over: 0.09 }],
    },

    // Bar 9: THE PEAK, on the molto-vibrato voice. t/total = 0.71.
    {
      ...n(24.03, 1174.66, 2, 2.4, 0.95),
      swell: [{ at: 1.2, v: 0.78, over: 1.2 }],
    },

    // Bar 10: descent.
    { ...n(26.5, 880.0, 1, 1.0, 0.75) },
    { ...n(27.55, 698.46, 1, 1.0, 0.6) },
    { ...n(28.6, 587.33, 1, 0.85, 0.48) },

    // Bars 11-12: the open fifth, held, then the bow lifts.
    //
    // The draft faded both voices to Amp 0.05 over three seconds. Below about
    // Amp 0.25 this model leaves its Helmholtz window (measured: the bow speed
    // floor is 0.03 + 0.2 x Amp, and at 0.05 it is a scratch, not a note), so
    // the last two seconds were an inharmonic whisper — the "dissonant"
    // ending. The fade now stops at 0.24 and the GATE closes; the room does
    // the rest, which is what a real diminuendo al niente sounds like anyway.
    {
      ...n(29.5, 440.0, 1, 4.6, 0.55),
      swell: [
        { at: 0, v: 0.7, over: 1.7 },
        { at: 1.7, v: 0.24, over: 2.8 },
      ],
    },
    {
      ...n(29.5, 293.66, 3, 4.6, 0.55),
      swell: [
        { at: 0, v: 0.7, over: 1.7 },
        { at: 1.7, v: 0.24, over: 2.8 },
      ],
    },
  ];
}

const VIOLIN_SOLO_SECONDS = 36 + SOLO_START_OFFSET;

function violinSoloVoices(): SoloVoiceSpec[] {
  const voice = (cents: number, rate: number, position: number): SoloVoiceSpec => ({
    type: 'bowedString',
    values: {
      Friction: 'thermal',
      Position: position,
      'Vib Cents': cents,
      'Vib Rate Hz': rate,
      Noise: 0.4,
    },
  });
  return [
    voice(0, 5.5, 0.127),
    voice(12, 5.5, 0.127),
    voice(22, 6.2, 0.115),
    // Straight: the lower voice of a double stop. Two independent vibratos on
    // a perfect fifth beat against each other; a real player's single hand
    // motion vibrates both strings TOGETHER, which cannot be phase-locked here,
    // so the convention is vibrato on the upper voice only.
    voice(0, 5.5, 0.14),
  ];
}

const violinSoloTimeline: TimelineDocument = {
  version: 1,
  durationSec: VIOLIN_SOLO_SECONDS,
  loop: true,
  // Bowed `Amp` and `Force` are read PER SAMPLE, so their lanes are the
  // expression itself and interpolate smoothly rather than stepping.
  curves: compileSoloCurves('vs', 4, violinSoloNotes(), 'linear', SOLO_COLORS, true),
};

// ── SOLO 2b — VIOLIN: "Firebrand Caprice" (virtuosic) ─────────────────────
//
// The lament stays; this is the fast one. Original material in the caprice
// idiom (Paganini / Sarasate / Monti): D minor, quarter = 152, ~57 s.
//
// EVERYTHING FAST HERE WAS MEASURED FIRST. Separate bow strokes at the
// sixteenth-note rate (98 ms period, 70 ms on, 25 ms attack) reach FULL level
// on every note (0.0 dB vs a held note, worst note 0.0); slurred sixteenth
// runs as pitch steps inside one bow hold within -4..+3 dB per step (the
// body's note-dependence, which is the real thing); and the thermal model
// stays in Helmholtz motion up to A6 (1760 Hz) at both dynamics under the
// `forceForAmp` law. So: spiccato 16ths are separate 70 ms gates on a
// short-attack voice, runs are ONE gate with 12 ms pitch steps (the bow never
// stops -- that is what a slur is), tremolo is 9 Hz strokes, and chords are
// rolled 12 ms apart across three voices, because a bow cannot sound three
// strings at once.
//
// SIX SPECIALISED VOICES (the fixed knobs are the articulation):
//   v0 stroke   attack 25 / release 40 ms, no vibrato    spiccato, runs
//   v1 lead     attack 45 / release 70, vib 12 c         singing line, chord top
//   v2 molto    attack 60 / release 90, vib 22 c @ 6 Hz  the interlude, the end
//   v3 under    attack 30, no vibrato, Position 0.14     lower double-stop voice
//   v4 under2   as v3                                    third chord voice
//   v5 tremolo  attack 18 / release 30, no vibrato       the tremolo peak
//
// FORM (seconds): intro chord + plunging run 0-5.7 · bariolage gallop, then
// the tune on top, then a chromatic rip 5.7-19.6 · double-stop thirds up and
// down two octaves, chromatic climb 19.8-27.6 · TREMOLO PEAK on D6 over
// hammered chords 27.7-32.5 · the lyrical interlude in F, molto vibrato,
// portamento 33-45 · CODA: accelerating runs, ricochet, the tune in octaves,
// the ascent to A6, the final chord 45.2-57.
function violinCapriceNotes(): SoloNote[] {
  const n = soloNote;
  const notes: SoloNote[] = [];
  const Q = 60 / 152;
  const E8 = Q / 2;
  const S16 = Q / 4;
  const N = {
    G3: 196, A3: 220, Bb3: 233.08, C4: 261.63, Cs4: 277.18, D4: 293.66,
    E4: 329.63, F4: 349.23, G4: 392, A4: 440, Bb4: 466.16, B4: 493.88,
    C5: 523.25, Cs5: 554.37, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99,
    A5: 880, Bb5: 932.33, C6: 1046.5, Cs6: 1108.73, D6: 1174.66, E6: 1318.51,
    F6: 1396.91, G6: 1567.98, A6: 1760,
  };

  // A separate bow stroke.
  const stroke = (t: number, hz: number, amp: number, len = 0.07, voice = 0) =>
    notes.push(n(t, hz, voice, len, amp));
  // A slurred run: ONE gate, the pitch steps every `step` seconds.
  const run = (
    t: number,
    pitches: readonly number[],
    step: number,
    amp: number,
    voice = 0,
    ampTo?: number,
  ): number => {
    const len = step * pitches.length - 0.02;
    // EAR TEST 2: "v0 sounds way too artificial". It was, and the reason was
    // that every note of a run came out at exactly the same level and exactly
    // on the grid. A real bow leans on the first note of each group of four
    // and lightens the off-notes, and the hand arrives a few milliseconds
    // early on the strong ones — the run's internal life is the difference
    // between a player and a sequencer. Both are tiny (+7 % / −5 %, ±6 ms)
    // and deterministic, so the piece is still reproducible.
    const accent = (i: number): number =>
      i % 4 === 0 ? 1.07 : i % 2 === 1 ? 0.95 : 1;
    const lean = (i: number): number =>
      i % 4 === 0 ? -0.006 : i % 2 === 1 ? 0.004 : 0;
    const bend = pitches.slice(1).map((hz, i) => ({
      at: step * (i + 1) + lean(i + 1),
      hz,
      over: 0.012,
    }));
    const last = Math.max(1, pitches.length - 1);
    const swell = pitches.map((_, i) => ({
      at: Math.max(0.001, step * i + lean(i)),
      v:
        (ampTo === undefined ? amp : amp + (ampTo - amp) * (i / last)) *
        accent(i),
      over: 0.008,
    }));
    notes.push({
      ...n(t, pitches[0], voice, len, amp * accent(0)),
      bend,
      swell,
    });
    return t + step * pitches.length;
  };
  // A rolled chord, low to high, 12 ms apart, the top on the lead voice.
  const chord = (t: number, pitches: readonly number[], amp: number, len: number) => {
    const voices = [3, 4, 1];
    pitches.forEach((hz, i) => {
      const top = i === pitches.length - 1;
      notes.push(n(t + i * 0.012, hz, voices[i], len - i * 0.012, amp * (top ? 1 : 0.82)));
    });
  };
  // Tremolo: separate strokes at ~9 Hz on their own voice, alternating slightly.
  const tremolo = (t: number, hz: number, len: number, from: number, to: number) => {
    const period = 0.111;
    const count = Math.floor(len / period);
    for (let i = 0; i < count; i++) {
      const a = from + ((to - from) * i) / Math.max(1, count - 1);
      notes.push(n(t + i * period, hz, 5, 0.075, a * (i % 2 ? 0.9 : 1)));
    }
  };
  const sing = (t: number, hz: number, len: number, amp: number, voice: number, extra: Partial<SoloNote> = {}) =>
    notes.push({ ...n(t, hz, voice, len, amp), ...extra });

  // ── A. Intro: the chord, the plunge, the low D, the dominant ──
  chord(0, [N.D4, N.A4, N.F5], 0.95, 1.4);
  run(1.5, [N.A5, N.G5, N.F5, N.E5, N.D5, N.C5, N.Bb4, N.A4, N.G4, N.F4, N.E4, N.D4, N.Cs4], S16, 0.88, 0, 0.7);
  sing(2.9, N.D4, 1.6, 0.72, 1, { swell: [{ at: 0.1, v: 0.5, over: 1.3 }] });
  chord(4.7, [N.A3, N.E4, N.Cs5], 0.8, 0.9);

  // ── B. The gallop: bariolage arpeggios, one bow per bar ──
  const bar = 2 * Q;
  const gallop: Record<string, readonly number[]> = {
    Dm: [N.D4, N.F4, N.A4, N.D5, N.F5, N.D5, N.A4, N.F4],
    Gm: [N.G4, N.Bb4, N.D5, N.G5, N.Bb5, N.G5, N.D5, N.Bb4],
    A7: [N.A4, N.Cs5, N.E5, N.G5, N.A5, N.G5, N.E5, N.Cs5],
    DmHi: [N.D5, N.F5, N.A5, N.D6, N.A5, N.F5, N.D5, N.A4],
  };
  const progression = ['Dm', 'Dm', 'Gm', 'Gm', 'A7', 'A7', 'Dm', 'DmHi'];
  let t = 5.7;
  progression.forEach((c, i) => {
    run(t + i * bar, gallop[c], S16, 0.6 + i * 0.02);
  });
  t += 8 * bar;
  // ...the tune on top, spiccato eighths, while the gallop keeps going.
  const tune: readonly (number | null)[][] = [
    [N.D5, N.F5, N.A5, null], [N.D6, N.A5, N.F5, N.D5],
    [N.G5, N.Bb5, N.D6, null], [N.G6, N.D6, N.Bb5, N.G5],
    [N.A5, N.Cs6, N.E6, null], [N.E6, N.Cs6, N.A5, N.E5],
    [N.F5, N.A5, N.D6, N.F6], [N.A6, N.F6, N.D6, N.A5],
  ];
  progression.forEach((c, i) => {
    run(t + i * bar, gallop[c], S16, 0.7 + i * 0.015);
    tune[i].forEach((hz, k) => {
      if (hz !== null) stroke(t + i * bar + k * E8, hz, 0.78 + i * 0.015, 0.14, 1);
    });
  });
  t += 8 * bar;
  // the rip: chromatic, A4 up to A5, into the thirds
  t = run(t, [N.A4, N.Bb4, N.B4, N.C5, N.Cs5, N.D5, 622.25, N.E5, N.F5, 739.99, N.G5, 830.61, N.A5], S16, 0.8, 0, 0.92);

  // ── C. Double-stop thirds, up and down, then an octave higher ──
  t += 0.15;
  const thirds: readonly [number, number][] = [
    [N.D4, N.F4], [N.E4, N.G4], [N.F4, N.A4], [N.G4, N.Bb4],
    [N.A4, N.C5], [N.Bb4, N.D5], [N.C5, N.E5], [N.D5, N.F5],
  ];
  const thirdsUp = [...thirds, ...[...thirds].reverse().slice(1)];
  const thirdsHi = thirdsUp.map(([lo, hi]) => [lo * 2, hi * 2] as [number, number]);
  [...thirdsUp, ...thirdsHi].forEach(([lo, hi], i) => {
    const amp = 0.7 + i * 0.006;
    stroke(t + i * E8, hi, amp, 0.14, 1);
    stroke(t + i * E8, lo, amp * 0.85, 0.14, 3);
  });
  t += (thirdsUp.length + thirdsHi.length) * E8;
  // chromatic climb C5 -> D6, one bow, crescendo into the peak
  t = run(t, [N.C5, N.Cs5, N.D5, 622.25, N.E5, N.F5, 739.99, N.G5, 830.61, N.A5, N.Bb5, N.B4 * 2, N.C6, N.Cs6, N.D6], S16, 0.82, 0, 0.96);

  // ── D. THE PEAK: tremolo on D6 over hammered chords ──
  // EAR TEST 2: a single D6 tremolo crescendoing for 3.6 s to 0.98 was "too
  // shrill and constant". Same 3.6 s span — the hammered chords under it are
  // untouched — but it now DESCENDS in three stages and peaks early, so the
  // last second (the part called painful) is an A5 easing off instead of a
  // D6 at full power. 1174 → 1047 → 880 Hz takes the fundamental out of the
  // band the Fritz listening tests call harsh.
  tremolo(t, N.D6, 1.4, 0.62, 0.82);
  tremolo(t + 1.4, N.C6, 1.1, 0.8, 0.74);
  tremolo(t + 2.5, N.A5, 1.1, 0.72, 0.6);
  for (let i = 0; i < 9; i++) {
    stroke(t + i * Q, N.D4, 0.6 + i * 0.025, 0.16, 3);
    stroke(t + i * Q + 0.012, N.A4, 0.56 + i * 0.025, 0.15, 4);
  }
  t += 3.6;
  chord(t, [N.D4, N.A4, N.F5], 0.96, 1.3);
  t += 1.7;

  // ── E. The interlude, F major, molto vibrato, portamento ──
  sing(t, N.A5, 1.8, 0.35, 2, { swell: [{ at: 0.05, v: 0.8, over: 1.4 }] });
  sing(t, N.F4, 4.0, 0.3, 3);
  sing(t + 0.012, N.C5, 3.99, 0.28, 4);
  sing(t + 1.9, N.G5, 0.9, 0.62, 2);
  sing(t + 2.8, N.F5, 1.4, 0.55, 2, { swell: [{ at: 0.1, v: 0.7, over: 1.2 }] });
  sing(t + 4.3, N.A5, 0.8, 0.62, 2);
  sing(t + 4.3, N.G4, 3.6, 0.3, 3);
  sing(t + 4.312, N.D5, 3.59, 0.28, 4);
  // the shift up the E string: a real portamento into the top note
  sing(t + 5.1, N.A5, 2.2, 0.6, 2, {
    bend: [{ at: 0.02, hz: N.C6, over: 0.16 }],
    swell: [{ at: 0.2, v: 0.92, over: 1.0 }, { at: 1.3, v: 0.5, over: 0.8 }],
  });
  sing(t + 7.5, N.Bb5, 0.7, 0.6, 2);
  sing(t + 8.2, N.A5, 0.7, 0.55, 2);
  sing(t + 8.0, N.F4, 4.4, 0.3, 3);
  sing(t + 8.012, N.A4, 4.39, 0.28, 4);
  sing(t + 8.9, N.G5, 0.7, 0.5, 2);
  sing(t + 9.6, N.F5, 2.4, 0.56, 2, { swell: [{ at: 0.3, v: 0.25, over: 2.0 }] });
  t += 12.4;

  // ── F. CODA: accelerating runs, ricochet, the tune in octaves, the ascent ──
  // EAR TEST 2: three plain ascending scales in a row read as "unpolished and
  // childish" — they were exercises, not writing. Replaced by the caprice
  // idiom: two bars of BROKEN THIRDS climbing a sequence (the figure that
  // makes a passage sound virtuosic rather than scalar), then a wide arpeggio
  // that sweeps DOWN before it launches up, so the ear gets a shape instead
  // of a third straight staircase.
  t = run(t, [N.D4, N.F4, N.E4, N.G4, N.F4, N.A4, N.G4, N.Bb4], 0.11, 0.7, 0, 0.76);
  t = run(t, [N.A4, N.C5, N.Bb4, N.D5, N.C5, N.E5, N.D5, N.F5], 0.098, 0.76, 0, 0.82);
  t = run(t, [N.A5, N.F5, N.D5, N.A4, N.D5, N.F5, N.A5, N.D6], 0.09, 0.82, 0, 0.86);
  // ricochet: the bow bouncing on D5, then on A5
  for (let i = 0; i < 4; i++) stroke(t + i * 0.09, N.D5, 0.82 - i * 0.06, 0.055, 0);
  t += 0.42;
  for (let i = 0; i < 4; i++) stroke(t + i * 0.09, N.A5, 0.84 - i * 0.06, 0.055, 0);
  t += 0.5;
  // the tune in octaves
  const octaves = [N.D5, N.F5, N.A5, N.D6, N.C6, N.A5, N.F5, N.D5];
  octaves.forEach((hz, i) => {
    stroke(t + i * E8, hz, 0.82, 0.15, 1);
    stroke(t + i * E8, hz / 2, 0.7, 0.15, 3);
  });
  t += 8 * E8 + 0.1;
  // EAR TEST 2: the ascent used to run to A6 (1760 Hz) at a rising 0.84→0.90
  // and was "loud constant … headache inducing". The model plays A6 cleanly
  // (measured, slips/period 1.05–1.08) — playability was never the issue;
  // 1760 Hz arriving at full power on top of the final chord was. It now tops
  // out at F6 (1397 Hz) and climbs chromatically over the last four notes,
  // which is both easier on the ear and more idiomatic than a plain scale.
  t = run(
    t,
    [N.D5, N.E5, N.F5, N.G5, N.A5, N.Bb5, N.C6, N.Cs6, N.D6, N.E6, N.F6],
    0.09,
    0.7,
    0,
    0.78,
  );
  // the last chord, and D6 over it with full vibrato, dying
  chord(t + 0.05, [N.D4, N.A4, N.D5], 0.9, 2.8);
  // EAR TEST 2: 2.8 s of D6 held at 0.84 before it began to fade was "long
  // constant … headache inducing". Now it enters quieter, starts receding
  // almost at once and is gone in 1.9 s, leaving the chord to finish the
  // piece — which is what a diminuendo al niente actually sounds like.
  sing(t + 0.09, N.D6, 1.9, 0.66, 2, {
    swell: [{ at: 0.25, v: 0.12, over: 1.5 }],
  });
  return notes;
}

const VIOLIN_CAPRICE_SECONDS = 58 + SOLO_START_OFFSET;

function violinCapriceVoices(): SoloVoiceSpec[] {
  const voice = (
    attackMs: number,
    releaseMs: number,
    cents: number,
    rate: number,
    position: number,
  ): SoloVoiceSpec => ({
    type: 'bowedString',
    values: {
      Friction: 'thermal',
      Position: position,
      'Attack ms': attackMs,
      'Release ms': releaseMs,
      'Vib Cents': cents,
      'Vib Rate Hz': rate,
      Noise: 0.4,
    },
  });
  return [
    // 7 cents, not 0. A dead-straight tone on every run is the other half of
    // "too artificial"; real players keep a trace of vibrato even in fast
    // passage-work. Small enough that it cannot smear the runs' pitches.
    voice(25, 40, 7, 5.5, 0.127),
    voice(45, 70, 12, 5.5, 0.127),
    voice(60, 90, 22, 6, 0.12),
    voice(30, 50, 0, 5.5, 0.14),
    voice(30, 50, 0, 5.5, 0.14),
    voice(18, 30, 0, 5.5, 0.125),
  ];
}

const violinCapriceTimeline: TimelineDocument = {
  version: 1,
  durationSec: VIOLIN_CAPRICE_SECONDS,
  loop: true,
  curves: compileSoloCurves('vc', 6, violinCapriceNotes(), 'linear', SOLO_COLORS, true),
};

// ── SOLO 3 — FLUTE: "Reed at Dusk" ───────────────────────────────────────
//
// D Aeolian brightening to Dorian, free time, ~35 s. Written as absolute
// timings because this piece IS its rubato: a metrical grid would kill it.
//
// THE OCTAVE TRAP, and why every pitch below is divided by four. `jetFlute`
// carries `Octave: 2` as its DEFAULT (nodeTypes.ts), which shifts the pipe two
// octaves up. Feeding it concert pitch puts the whole solo two octaves above
// where it is written, and the apex would land above the instrument's real
// range. `fluteHz` does the division in one place so the score stays readable
// at sounding pitch — this is oracle O9.
//
// BREATH IS STRUCTURE, NOT PUNCTUATION. The five gaps below (0.55 s, 0.63 s,
// 0.45 s, 0.30 s, 0.55 s) are where a player breathes, and a flute line without
// them stops sounding like a flute no matter how good the model is.
//
// THREE VOICES: Fa straight (`Vib Depth` 0), Fb with vibrato (0.16), Fc breathy
// (`Breath` 0.50) for the low close. As with the violin, vibrato ARRIVES by
// cross-fading Fa into Fb — `Vib Depth` is a `number` and cannot be automated.
const fluteHz = (sounding: number): number => sounding / 4;

function fluteSoloNotes(): SoloNote[] {
  const n = soloNote;
  const h = fluteHz;
  const run = (
    t: number,
    gate: number,
    pitches: readonly number[],
    from: number,
    to: number,
  ): SoloNote => {
    // One gate, `Hz` stepping every 0.16 s. This is the correct technique for
    // a fast flourish and the only way the pipe speaks at this speed: a jet
    // pipe needs time to start, so re-articulating each note would choke it.
    const step = 0.16;
    // The pitch ramp stays LINEAR, and the reason is a recorded null result.
    // Almeida, Chow, Smith & Wolfe (JASA 2009) measured on a real flute that
    // "a relatively small range of key positions, near the fully closed limit,
    // is associated with most of the changes in pitch" — so with a key moving
    // at roughly constant speed, a real transition's pitch-vs-time curve is
    // strongly eased-in. That was implemented here (10 % of the change in
    // 10 ms, 40 % by 19 ms, 100 % by 26 ms) and MEASURED: the transition went
    // 93 -> 96 ms and the settle-to-within-15-cents went 46 -> 55 ms. Slightly
    // WORSE, so it was reverted. The ramp shape is not the bottleneck — the
    // bore's own settling is, which is the same reason lengthening the ramp to
    // 70 ms made things worse too.
    const bend = pitches.slice(1).map((hz, index) => ({
      at: step * (index + 1),
      hz: h(hz),
      over: 0.02,
    }));
    // ARTICULATION, shaped to measurement. A real player does not hold a
    // steady breath through a run: the level dips at every note. Median of 309
    // fast slurred transitions in a real bansuri recording, dB relative to the
    // level just before the move:
    //     -30 ms  -1.6 | -15 ms  -2.7 | 0 ms  -3.3 | +15 ms  -2.8 | +30 ms  -1.7
    // — a smooth trough about 58 ms wide, 3.3 dB deep, bottoming about 6 ms
    // BEFORE the pitch moves, because the breath eases before the fingers
    // arrive. That anticipation is why this lives here and not in the core:
    // only the score knows when the next note is coming. Without it our runs
    // dipped 0.1 dB and read as one continuous tone being pitch-bent.
    const swell: { at: number; v: number; over: number }[] = [];
    const level = (at: number): number =>
      from + (to - from) * Math.min(1, at / Math.max(0.001, gate));
    for (let index = 1; index < pitches.length; index += 1) {
      const centre = step * index - 0.006;
      if (centre - 0.03 <= 0.001 || centre + 0.035 >= gate) continue;
      swell.push(
        { at: centre - 0.03, v: level(centre - 0.03), over: 0.012 },
        { at: centre, v: level(centre) * 0.68, over: 0.024 },
        { at: centre + 0.035, v: level(centre + 0.035), over: 0.03 },
      );
    }
    return {
      ...n(t, h(pitches[0]), 1, gate, from),
      bend,
      swell: swell.length
        ? swell
        : [{ at: 0, v: to, over: gate - 0.05 }],
    };
  };
  return [
    // Phrase 1 — the call, on ONE voice.
    //
    // It used to be a cross-fade: a straight-tone voice handing over to a
    // vibrato voice on the SAME pitch, to make vibrato "arrive". Two flutes on
    // one pitch BEAT — they are separate oscillators with their own noise and
    // no phase relationship — and the model is not silent at Amp 0, so both
    // sounded right through the hand-over. That was the "harmony between 2
    // flute sounds isn't working" at 1-2 s; the same construct was the violin's
    // dissonant opening.
    //
    // It is also now unnecessary: `fluteCore` gives every note a vibrato onset
    // delay and fade-in of its own (VIBRATO_ONSET_SEC / VIBRATO_FADE_SEC), so
    // a single note starts straight and blooms exactly as intended.
    {
      ...n(0.0, h(783.99), 1, 2.6, 0.42),
      bend: [
        { at: 1.35, hz: h(698.46), over: 0.02 },
        { at: 1.8, hz: h(622.25), over: 0.02 },
        { at: 2.05, hz: h(587.33), over: 0.02 },
      ],
      swell: [
        { at: 0.55, v: 0.44, over: 0.35 },
        { at: 1.8, v: 0.42, over: 0.05 },
        { at: 2.05, v: 0.38, over: 0.05 },
      ],
    },
    // BREATH 0.55 s.
    n(3.15, h(587.33), 1, 0.5, 0.38),
    n(3.7, h(523.25), 1, 0.35, 0.36),
    { ...n(4.11, h(466.16), 1, 0.8, 0.4), swell: [{ at: 0, v: 0.48, over: 0.78 }] },
    { ...n(4.97, h(440.0), 1, 1.1, 0.42), swell: [{ at: 0, v: 0.26, over: 1.08 }] },
    // BREATH 0.63 s.

    // Phrase 2 — the answer, higher.
    { ...n(6.7, h(932.33), 1, 1.2, 0.5), bend: [{ at: 0.07, hz: h(880.0), over: 0.02 }] },
    {
      ...n(7.95, h(783.99), 1, 1.35, 0.52),
      bend: [
        { at: 0.4, hz: h(698.46), over: 0.02 },
        { at: 0.8, hz: h(783.99), over: 0.02 },
      ],
      swell: [
        { at: 0.4, v: 0.54, over: 0.02 },
        { at: 0.8, v: 0.58, over: 0.02 },
      ],
    },
    n(9.6, h(932.33), 1, 0.55, 0.58),
    n(10.215, h(1046.5), 1, 0.55, 0.62),
    { ...n(10.83, h(1174.66), 1, 1.1, 0.68), swell: [{ at: 0, v: 0.55, over: 1.08 }] },
    {
      ...n(11.93, h(1046.5), 1, 1.17, 0.55),
      bend: [
        { at: 0.32, hz: h(932.33), over: 0.02 },
        { at: 0.62, hz: h(880.0), over: 0.02 },
        { at: 0.92, hz: h(783.99), over: 0.02 },
      ],
      swell: [
        { at: 0.32, v: 0.5, over: 0.02 },
        { at: 0.62, v: 0.45, over: 0.02 },
        { at: 0.92, v: 0.4, over: 0.02 },
      ],
    },
    // BREATH 0.45 s.

    // Phrase 3 — the fast middle, accelerating.
    run(13.55, 1.6, [587.33, 698.46, 880.0, 1174.66, 1046.5, 880.0, 783.99, 698.46, 659.25, 587.33], 0.55, 0.68),
    run(15.4, 1.6, [659.25, 783.99, 932.33, 1318.51, 1174.66, 932.33, 880.0, 783.99, 698.46, 659.25], 0.62, 0.75),
    run(17.2, 1.28, [698.46, 880.0, 1046.5, 1396.91, 1318.51, 1046.5, 932.33, 880.0], 0.72, 0.85),
    // Tongued and separate — the moment the run reveals it is going somewhere.
    // The onset spike is the tongue; it settles 0.10 lower after 40 ms.
    { ...n(18.75, h(880.0), 1, 0.22, 0.9), swell: [{ at: 0.04, v: 0.8, over: 0.02 }] },
    { ...n(19.04, h(1046.5), 1, 0.22, 0.93), swell: [{ at: 0.04, v: 0.83, over: 0.02 }] },
    { ...n(19.33, h(1174.66), 1, 0.22, 0.96), swell: [{ at: 0.04, v: 0.86, over: 0.02 }] },
    { ...n(19.62, h(1396.91), 1, 0.22, 0.99), swell: [{ at: 0.04, v: 0.89, over: 0.02 }] },
    { ...n(19.91, h(1567.98), 1, 0.22, 1.0), swell: [{ at: 0.04, v: 0.92, over: 0.02 }] },
    // SILENCE 0.30 s — the gap before the apex does the work.

    // Phrase 4 — THE APEX. A6 is the only note above G6 in the piece, which
    // is exactly why it lands. t/total = 0.64.
    { ...n(20.5, h(1760.0), 1, 2.0, 0.95), swell: [{ at: 1.2, v: 0.85, over: 0.8 }] },
    {
      ...n(22.5, h(1567.98), 1, 2.3, 0.85),
      bend: [
        { at: 0.4, hz: h(1396.91), over: 0.02 },
        { at: 0.9, hz: h(1174.66), over: 0.02 },
        { at: 1.4, hz: h(1046.5), over: 0.02 },
        { at: 1.85, hz: h(880.0), over: 0.02 },
      ],
      swell: [
        { at: 0.4, v: 0.78, over: 0.02 },
        { at: 0.9, v: 0.7, over: 0.02 },
        { at: 1.4, v: 0.62, over: 0.02 },
        { at: 1.85, v: 0.55, over: 0.02 },
      ],
    },
    // BIG BREATH 0.55 s.

    // Phrase 5 — the opening returns an octave lower, in the woody register,
    // on the breathy voice. The low register's colour is the whole point.
    {
      ...n(25.35, h(392.0), 2, 2.25, 0.4),
      bend: [
        { at: 0.95, hz: h(349.23), over: 0.02 },
        { at: 1.45, hz: h(311.13), over: 0.02 },
        { at: 1.75, hz: h(293.66), over: 0.02 },
      ],
      swell: [
        { at: 0.95, v: 0.38, over: 0.02 },
        { at: 1.45, v: 0.35, over: 0.02 },
        { at: 1.75, v: 0.32, over: 0.02 },
      ],
    },
    n(28.0, h(293.66), 0, 1.1, 0.34),
    n(29.1, h(440.0), 0, 0.7, 0.3),
    {
      ...n(30.15, h(587.33), 1, 2.1, 0.36),
      swell: [
        { at: 0, v: 0.48, over: 0.9 },
        { at: 1.3, v: 0.04, over: 0.8 },
      ],
    },
    // Vibrato dies before the note does.
    { ...n(31.45, h(587.33), 0, 0.8, 0.0), swell: [{ at: 0, v: 0.12, over: 0.8 }] },
  ];
}

const FLUTE_SOLO_SECONDS = 35 + SOLO_START_OFFSET;

function fluteSoloVoices(): SoloVoiceSpec[] {
  const voice = (depth: number, breath: number): SoloVoiceSpec => ({
    type: 'jetFlute',
    values: {
      Pipe: 'open',
      Octave: 2,
      'Vib Depth': depth,
      'Vib Rate Hz': 5.2,
      Breath: breath,
    },
  });
  // Breath raised 0.3/0.3/0.5 -> 0.62/0.62/0.88 (2026-09-14). With the
  // turbulence moved into the loop the knob finally controls something: at
  // 0.3 the inter-harmonic floor measured -60 dB where the Iowa concert flute
  // sits at -53, i.e. the model was audibly CLEANER than a real flute, which
  // is a large part of "alien and artificial". 0.62 lands on the reference;
  // the breathy low voice goes further.
  return [voice(0, 0.62), voice(0.16, 0.62), voice(0.1, 0.88)];
}

const fluteSoloTimeline: TimelineDocument = {
  version: 1,
  durationSec: FLUTE_SOLO_SECONDS,
  loop: true,
  curves: compileSoloCurves('fs', 3, fluteSoloNotes(), 'linear', SOLO_COLORS),
};

// ── SOLO 4 — STARRY PAD: "Starfield" ─────────────────────────────────────
//
// D# minor, 4/4 at quarter = 60 (bar 4.000 s), 8 bars, ~38 s with the tail.
// D# minor deliberately: it is the key of this app's Starry Night demo, so the
// two are companion pieces.
//
// A PAD'S TUNE IS ITS INNER VOICE LEADING, not a melody on top. Common tones
// are held between chords and everything else moves by step, so the harmony
// changes without anything appearing to leap.
//
// THE BLOOM. The voices of a chord are struck 35-260 ms apart rather than
// together. Simultaneous onsets on a 1 ms attack CLICK — every voice's
// transient lands in the same sample — and a chord that arrives all at once
// reads as a synth stab rather than as a pad opening.
//
// DETUNED TWINS. The instrument has one oscillator per voice, so "detune" means
// a SECOND voice: each chord tone is doubled at +7 cents (x 1.004047), struck
// 18 ms later at 0.72x level. Two nearly-identical pitches beat at ~1-3 Hz, and
// that slow beating is what makes a pad sound wide instead of flat. Twelve
// voices: one sub, five chord tones, their five twins, one melody.
//
// NO THIRDS BELOW G3 — roots and fifths only in the bottom octave, or the low
// end turns to mud.
//
// The cutoff ride 700 -> 3200 -> 700 Hz is the arc. It opens through the piece
// and shuts at the end, and because filter `Freq` is a `signal` it is the one
// timbral gesture that can genuinely be automated here.
const PAD_DETUNE = 1.004047;
const PAD_OFFSETS = [0, 0.035, 0.07, 0.11, 0.155, 0.2];

function padSoloNotes(): SoloNote[] {
  const n = soloNote;
  type Chord = {
    t: number;
    span: number;
    sub: number;
    tones: readonly number[];
    melody: number;
    amp: number;
    melodyAt?: number;
    move?: { at: number; voice: number; hz: number };
    melodyMove?: { at: number; hz: number };
  };
  const chords: readonly Chord[] = [
    // i — D#m(add9)
    { t: 0, span: 8, sub: 77.78, tones: [155.56, 233.08, 311.13, 369.99, 466.16], melody: 739.99, amp: 0.55 },
    // VI — B(add9). The melody waits until t 12 so bar 3 is pure harmony.
    { t: 8, span: 8, sub: 61.74, tones: [123.47, 185.0, 246.94, 311.13, 554.37], melody: 830.61, amp: 0.6, melodyAt: 12 },
    // iv7 — G#m7
    { t: 16, span: 4, sub: 51.91, tones: [103.83, 155.56, 185.0, 246.94, 311.13], melody: 739.99, amp: 0.68, melodyMove: { at: 2, hz: 932.33 } },
    // bVII — C#sus4 resolving to C#. THE APEX at t 20-22, 63 % through. The
    // sus4 -> 3rd resolution INSIDE the apex bar is the one moment of real
    // harmonic motion in a piece that otherwise floats, which is why it lands.
    // `voice` here is the VOICE INDEX, and the loop below assigns
    // `voice = 1 + index`. The sus4 is tones[3] = F#4 369.99, so it lives on
    // voice 4. Writing 3 moved tones[2] — the ROOT C#4 — to F natural instead,
    // leaving the sus4 unresolved: F and F# a semitone apart, each doubled by
    // its +7-cent twin, at the loudest moment of the piece.
    { t: 20, span: 4, sub: 69.3, tones: [138.59, 207.65, 277.18, 369.99, 415.3], melody: 932.33, amp: 0.85, move: { at: 2, voice: 4, hz: 349.23 } },
    // VI — B
    { t: 24, span: 4, sub: 61.74, tones: [123.47, 185.0, 246.94, 311.13, 369.99], melody: 830.61, amp: 0.72 },
    // i — D#m, and the fade
    { t: 28, span: 4, sub: 77.78, tones: [155.56, 233.08, 311.13, 369.99, 466.16], melody: 622.25, amp: 0.5, melodyMove: { at: 2, hz: 622.25 } },
  ];

  const notes: SoloNote[] = [];
  for (const chord of chords) {
    // 150 ms short of the next chord: the gap is where the 1.2 s release of
    // the outgoing chord blooms into the incoming one. THAT overlap is the pad.
    const gate = chord.span - 0.15;
    notes.push({ ...n(chord.t, chord.sub, 0, gate, chord.amp * 0.9) });
    chord.tones.forEach((hz, index) => {
      const voice = 1 + index;
      const twin = 6 + index;
      const onset = chord.t + PAD_OFFSETS[index + 1];
      const bend =
        chord.move !== undefined && chord.move.voice === voice
          ? [{ at: chord.move.at, hz: chord.move.hz, over: 0.9 }]
          : undefined;
      notes.push({ ...n(onset, hz, voice, gate - PAD_OFFSETS[index + 1], chord.amp), bend });
      notes.push({
        ...n(onset + 0.018, hz * PAD_DETUNE, twin, gate - PAD_OFFSETS[index + 1] - 0.018, chord.amp * 0.72),
        bend:
          bend === undefined
            ? undefined
            : [{ at: chord.move!.at, hz: chord.move!.hz * PAD_DETUNE, over: 0.9 }],
      });
    });
    const melodyAt = chord.melodyAt ?? chord.t + 0.26;
    notes.push({
      ...n(melodyAt, chord.melody, 11, chord.t + gate - melodyAt, chord.amp * 0.9),
      bend:
        chord.melodyMove === undefined
          ? undefined
          : [{ at: chord.melodyMove.at, hz: chord.melodyMove.hz, over: 0.6 }],
    });
  }
  return notes;
}

const PAD_SOLO_SECONDS = 38 + SOLO_START_OFFSET;

const padCutoffCurve: TimelineCurve = orchestraCurve(
  'crv_psCutoff',
  'cutoff',
  '#38bdf8',
  700,
  [
    curvePoint(SOLO_START_OFFSET, 700, 'ease', 'ease'),
    curvePoint(8 + SOLO_START_OFFSET, 1100, 'ease', 'ease'),
    curvePoint(16 + SOLO_START_OFFSET, 1500, 'ease', 'ease'),
    curvePoint(20 + SOLO_START_OFFSET, 2100, 'ease', 'ease'),
    curvePoint(22 + SOLO_START_OFFSET, 3200, 'ease', 'ease'),
    curvePoint(28 + SOLO_START_OFFSET, 1600, 'ease', 'ease'),
    curvePoint(36 + SOLO_START_OFFSET, 700, 'ease', 'ease'),
  ],
);

function padSoloVoices(): SoloVoiceSpec[] {
  return Array.from({ length: 12 }, () => ({
    type: 'inst_starryPad' as SoundCatalogNodeTypeId,
    values: {},
  }));
}

const padSoloTimeline: TimelineDocument = {
  version: 1,
  durationSec: PAD_SOLO_SECONDS,
  loop: true,
  curves: [
    ...compileSoloCurves('ps', 12, padSoloNotes(), 'linear', SOLO_COLORS),
    padCutoffCurve,
  ],
};

// ── SOLO 5 — VAMPIRE SYNTH: "Nosferatu" ──────────────────────────────────
//
// F# Phrygian dominant — F# G A# B C# D E — 4/4 at quarter = 132, 16 bars,
// ~29 s. The mode is the sound: a flat 2nd (G) against a MAJOR 3rd (A#) is the
// interval that reads as gothic, and the piece leans on both.
//
// THE DELAY IS LOAD-BEARING, NOT DECORATION. This instrument has a ~10 ms
// release, so a gate of 100 ms is a 100 ms note and nothing more; the dotted-
// eighth ping-pong (0.3409 s at 132 bpm) is the only thing giving the riff a
// tail. Remove it and the part becomes a series of clicks.
//
// SIX VOICES: v0 riff, v1 its octave double, v2 lead, v3 the lead's legato
// partner — a `high`-triggered envelope cannot overlap itself, so genuine
// legato needs a SECOND voice to take the note whose predecessor is still
// gated — v4 a fifth-below stack at the peak, v5 a sustained pedal.
function vampireSoloVoices(): SoloVoiceSpec[] {
  return Array.from({ length: 6 }, () => ({
    type: 'inst_vampireSynth' as SoundCatalogNodeTypeId,
    values: {},
  }));
}

// ── SOLO 5 — VAMPIRE SYNTH: "Nosferatu" ─────────────────────────────────
//
// The verdict on the 16-bar original was "perfect … needs to be longer, add
// hooks, chorus, ear candy etc. it's amazing, don't ruin it. maybe create a
// copy". It was grown into this 32-bar form as a SEPARATE demo so both could
// be auditioned; the user picked this one (2026-09-14) and the 16-bar version
// was deleted. Bars 1-12 are that original, note for note.
//
// Form (bars of 1.818 s at 132):
//    1-2   hook, alone                      (as the original)
//    3-4   hook doubled + pedal             (as the original)
//    5-8   verse: the lead                  (as the original)
//    9-12  hook + lead climbing to the peak (as the original)
//   13-16  CHORUS: hook doubled, a NEW answering melody up top, the
//          fifth-below stack held, cutoff wide, delay thrown open
//   17-20  BREAKDOWN: pedal + every-other-note hook, cutoff shut, sixteenth
//          fills at bar ends, an octave PITCH-DROP stab on each downbeat
//   21-24  RISER: hook, a trilled lead, cutoff climbing 600 -> 3400,
//          off-beat octave stabs anticipating the drop
//   25-28  CHORUS 2: chorus + a sixteenth counter-riff an octave up
//   29-32  descent to the held F# (as the original ending, one octave stab
//          added on the last downbeat)
//
// EAR CANDY, each buildable with what exists: pitch-drop stabs are a `bend`
// from an octave up down to the note in 60 ms inside one gate; trills are
// alternating `bend`s at 16th-note rate inside one gate; the delay throw is a
// lane on the ping-pong's `Wet` (a signal param); the fifth stack is v4.
function vampireSoloExtendedNotes(): SoloNote[] {
  const n = soloNote;
  const BAR = 1.8182;
  const S16 = BAR / 16;
  const hook: readonly [number, number, number][] = [
    [0.0, 185.0, 0.58], [0.227, 185.0, 0.5], [0.341, 196.0, 0.55],
    [0.455, 185.0, 0.58], [0.795, 277.18, 0.52], [0.909, 185.0, 0.48],
    [1.136, 233.08, 0.54], [1.25, 196.0, 0.52], [1.364, 185.0, 0.58],
    [1.818, 185.0, 0.58], [2.045, 185.0, 0.5], [2.159, 196.0, 0.55],
    [2.273, 185.0, 0.58], [2.614, 277.18, 0.52], [2.727, 293.66, 0.56],
    [2.841, 277.18, 0.52], [2.955, 233.08, 0.54], [3.068, 196.0, 0.56],
    [3.409, 185.0, 0.58],
  ];
  const gateOf = (t: number): number => {
    if (t === 0.455 || t === 2.273 || t === 3.409) return 0.21;
    if (t === 1.364) return 0.34;
    if (t === 3.068) return 0.23;
    return 0.1;
  };
  const notes: SoloNote[] = [];
  const placeHook = (offset: number, octaveDouble: boolean, ampScale = 1, everyOther = false) => {
    hook.forEach(([t, hz, amp], i) => {
      if (everyOther && i % 2 === 1) return;
      notes.push(n(t + offset, hz, 0, gateOf(t), amp * ampScale));
      if (octaveDouble) notes.push(n(t + offset, hz * 2, 1, gateOf(t), amp * 0.58 * ampScale));
    });
  };
  const pedal = (t: number, len: number, amp = 0.3) => notes.push(n(t, 123.47, 5, len, amp));
  const leadTable: readonly [number, number, number, number, number][] = [
    [7.273, 554.37, 0.91, 0.72, 2], [8.182, 587.33, 0.45, 0.75, 3],
    [8.636, 554.37, 0.45, 0.72, 2], [9.091, 466.16, 0.91, 0.7, 3],
    [10.0, 493.88, 0.45, 0.7, 2], [10.455, 554.37, 0.45, 0.72, 3],
    [10.909, 369.99, 1.36, 0.65, 2], [12.5, 739.99, 0.45, 0.82, 3],
    [12.955, 659.25, 0.23, 0.78, 2], [13.182, 587.33, 0.23, 0.78, 3],
  ];
  const climb: readonly [number, number, number, number][] = [
    [14.545, 554.37, 0.45, 0.76], [15.0, 587.33, 0.45, 0.78],
    [15.455, 659.25, 0.91, 0.8], [16.364, 587.33, 0.45, 0.8],
    [16.818, 554.37, 0.45, 0.82], [17.273, 739.99, 0.91, 0.86],
    [18.182, 659.25, 0.45, 0.88], [18.636, 783.99, 1.36, 0.95],
    [20.0, 739.99, 0.45, 0.9], [20.455, 659.25, 0.45, 0.86],
    [20.909, 587.33, 0.91, 0.82],
  ];

  // 1-12: the original, verbatim in content.
  placeHook(0, false);
  placeHook(2 * BAR, true);
  pedal(2 * BAR, 3.5);
  leadTable.forEach(([t, hz, gate, amp, voice], i) => {
    notes.push(i === 0
      ? { ...n(t, 466.16, voice, gate, amp), bend: [{ at: 0, hz, over: 0.07 }] }
      : n(t, hz, voice, gate, amp));
  });
  placeHook(8 * BAR, true);
  pedal(8 * BAR, 3.5);
  climb.forEach(([t, hz, gate, amp], i) => notes.push(n(t, hz, i % 2 === 0 ? 2 : 3, gate, amp)));
  notes.push(n(18.636, 554.37, 4, 1.36, 0.5), n(20.0, 493.88, 4, 0.9, 0.42));

  // 13-16: CHORUS. Hook doubled, fifth stack held, and a NEW answer up top —
  // the mode's own shape (F# G A# B C# D E) sung as a hook, not a run.
  const c1 = 12 * BAR;
  placeHook(c1, true, 1.05);
  notes.push(n(c1, 92.5, 5, 4 * BAR - 0.1, 0.34));
  notes.push(n(c1, 277.18, 4, 2 * BAR - 0.05, 0.46), n(c1 + 2 * BAR, 246.94, 4, 2 * BAR - 0.1, 0.46));
  const answer: readonly [number, number, number][] = [
    [0, 739.99, 0.92], [3 * S16, 783.99, 0.9], [6 * S16, 932.33, 0.94], [8 * S16, 783.99, 0.9],
    [11 * S16, 739.99, 0.9], [14 * S16, 659.25, 0.86],
    [16 * S16, 739.99, 0.92], [19 * S16, 587.33, 0.88], [22 * S16, 554.37, 0.88], [24 * S16, 587.33, 0.9],
    [27 * S16, 739.99, 0.94], [30 * S16, 783.99, 0.9],
    [32 * S16, 932.33, 0.96], [35 * S16, 1108.73, 0.98], [38 * S16, 932.33, 0.94], [40 * S16, 783.99, 0.9],
    [43 * S16, 739.99, 0.9], [46 * S16, 659.25, 0.86],
    [48 * S16, 739.99, 0.94], [51 * S16, 587.33, 0.9], [54 * S16, 554.37, 0.9], [56 * S16, 466.16, 0.88],
    [60 * S16, 369.99, 0.9],
  ];
  answer.forEach(([off, hz, amp], i) => {
    const next = answer[i + 1];
    const len = next ? Math.min(next[0] - off - 0.02, 0.6) : 0.9;
    notes.push(n(c1 + off, hz, i % 2 === 0 ? 2 : 3, len, amp));
  });

  // 17-20: BREAKDOWN. Every-other-note hook, pedal, sixteenth fills at bar
  // ends, and a pitch-drop stab on each downbeat (octave up -> note, 60 ms).
  const b0 = 16 * BAR;
  placeHook(b0, false, 0.85, true);
  placeHook(b0 + 2 * BAR, false, 0.85, true);
  pedal(b0, 4 * BAR - 0.1, 0.36);
  for (let bar = 0; bar < 4; bar++) {
    const t = b0 + bar * BAR;
    notes.push({ ...n(t, 369.99, 2, 0.32, 0.9), bend: [{ at: 0, hz: 369.99, over: 0.001 }] });
    notes[notes.length - 1] = { ...n(t, 739.99, 2, 0.32, 0.9), bend: [{ at: 0.004, hz: 369.99, over: 0.06 }] };
    // fill: four sixteenths up the mode into the next downbeat
    const fill = [185.0, 196.0, 233.08, 246.94];
    fill.forEach((hz, k) => notes.push(n(t + BAR - 4 * S16 + k * S16, hz * 2, 3, S16 * 0.8, 0.7 + k * 0.05)));
  }

  // 21-24: RISER. Hook, a TRILLED lead (alternating bends at 16th rate inside
  // one gate), and off-beat octave stabs anticipating the drop.
  const r0 = 20 * BAR;
  placeHook(r0, true, 0.95);
  placeHook(r0 + 2 * BAR, true, 1.0);
  pedal(r0, 4 * BAR - 0.1, 0.34);
  const trill = (t: number, len: number, lo: number, hi: number, amp: number, voice: number) => {
    const bend: { at: number; hz: number; over: number }[] = [];
    for (let k = 1; k * S16 < len - 0.02; k++) bend.push({ at: k * S16, hz: k % 2 ? hi : lo, over: 0.008 });
    notes.push({ ...n(t, lo, voice, len, amp), bend });
  };
  trill(r0, 2 * BAR - 0.05, 554.37, 587.33, 0.84, 2);
  trill(r0 + 2 * BAR, 2 * BAR - 0.05, 739.99, 783.99, 0.9, 3);
  for (let bar = 0; bar < 4; bar++) {
    const t = r0 + bar * BAR;
    for (const off of [6 * S16, 14 * S16]) notes.push(n(t + off, 369.99 * 2, 4, S16 * 1.5, 0.72 + bar * 0.05));
  }

  // 25-28: CHORUS 2 = chorus + a sixteenth counter-riff an octave up on v1.
  const c2 = 24 * BAR;
  placeHook(c2, false, 1.05);
  notes.push(n(c2, 92.5, 5, 4 * BAR - 0.1, 0.34));
  notes.push(n(c2, 277.18, 4, 2 * BAR - 0.05, 0.46), n(c2 + 2 * BAR, 246.94, 4, 2 * BAR - 0.1, 0.46));
  answer.forEach(([off, hz, amp], i) => {
    const next = answer[i + 1];
    const len = next ? Math.min(next[0] - off - 0.02, 0.6) : 0.9;
    notes.push(n(c2 + off, hz, i % 2 === 0 ? 2 : 3, len, amp));
  });
  const counter = [369.99, 369.99, 392.0, 369.99, 466.16, 369.99, 554.37, 466.16];
  for (let bar = 0; bar < 4; bar++) {
    for (let k = 0; k < 16; k++) {
      notes.push(n(c2 + bar * BAR + k * S16, counter[k % 8] * 2, 1, S16 * 0.7, 0.4 + (k % 4 === 0 ? 0.12 : 0)));
    }
  }

  // 29-32: the original descent and held F#, retimed, plus one octave stab.
  const d0 = 28 * BAR;
  const descent: readonly [number, number, number, number][] = [
    [0, 554.37, 0.45, 0.7], [0.455, 466.16, 0.45, 0.66], [0.909, 392.0, 0.45, 0.62],
    [1.364, 369.99, 0.91, 0.58], [2.273, 329.63, 0.45, 0.52], [2.727, 293.66, 0.45, 0.48],
    [3.182, 277.18, 0.91, 0.44], [4.091, 233.08, 0.45, 0.4], [4.545, 196.0, 0.45, 0.38],
  ];
  descent.forEach(([off, hz, gate, amp], i) => notes.push(n(d0 + off, hz, i % 2 === 0 ? 2 : 3, gate, amp)));
  notes.push(
    n(d0 + 5.0, 185.0, 0, 2.2, 0.5),
    n(d0 + 5.0, 92.5, 5, 2.2, 0.4),
    { ...n(d0 + 5.0, 739.99, 4, 0.5, 0.6), bend: [{ at: 0.004, hz: 369.99, over: 0.08 }] },
    n(d0 + 5.0, 369.99, 2, 2.2, 0.36),
  );
  return notes;
}

const VAMPIRE_EXT_SECONDS = 32 * 1.8182 + 2.4 + SOLO_START_OFFSET;

const vampireExtCutoffCurve: TimelineCurve = orchestraCurve(
  'crv_nxCutoff',
  'cutoff',
  '#f43f5e',
  480,
  [
    curvePoint(SOLO_START_OFFSET, 480, 'ease', 'ease'),
    curvePoint(3.636 + SOLO_START_OFFSET, 900, 'ease', 'ease'),
    curvePoint(7.273 + SOLO_START_OFFSET, 1600, 'ease', 'ease'),
    curvePoint(14.545 + SOLO_START_OFFSET, 2200, 'ease', 'ease'),
    curvePoint(18.636 + SOLO_START_OFFSET, 3400, 'ease', 'ease'),
    curvePoint(21.818 + SOLO_START_OFFSET, 3600, 'ease', 'ease'),   // chorus: wide open
    curvePoint(29.09 + SOLO_START_OFFSET, 3400, 'ease', 'ease'),
    curvePoint(29.3 + SOLO_START_OFFSET, 600, 'step', 'ease'),      // breakdown: shut
    curvePoint(36.36 + SOLO_START_OFFSET, 700, 'ease', 'ease'),
    curvePoint(43.63 + SOLO_START_OFFSET, 3400, 'ease', 'ease'),    // riser: climb
    curvePoint(50.9 + SOLO_START_OFFSET, 3600, 'ease', 'ease'),     // chorus 2
    curvePoint(58.18 + SOLO_START_OFFSET, 700, 'ease', 'ease'),
  ],
);

/** The delay THROW: the ping-pong's Wet opens up on the choruses. */
const vampireExtEchoCurve: TimelineCurve = orchestraCurve(
  'crv_nxEcho',
  'echo wet',
  '#fb7185',
  0.28,
  [
    curvePoint(SOLO_START_OFFSET, 0.28, 'step', 'step'),
    curvePoint(21.818 + SOLO_START_OFFSET, 0.42, 'ease', 'ease'),
    curvePoint(29.09 + SOLO_START_OFFSET, 0.2, 'ease', 'ease'),
    curvePoint(36.36 + SOLO_START_OFFSET, 0.3, 'ease', 'ease'),
    curvePoint(43.63 + SOLO_START_OFFSET, 0.45, 'ease', 'ease'),
    curvePoint(50.9 + SOLO_START_OFFSET, 0.3, 'ease', 'ease'),
  ],
);

const vampireSoloExtendedTimeline: TimelineDocument = {
  version: 1,
  durationSec: VAMPIRE_EXT_SECONDS,
  loop: true,
  curves: [
    ...compileSoloCurves('nx', 6, vampireSoloExtendedNotes(), 'linear', SOLO_COLORS),
    vampireExtCutoffCurve,
    vampireExtEchoCurve,
  ],
};

const probeGraphBuilders: Record<string, () => ProbeState> = {
  /**
   * The SYNTHWAVE LEAD patch: two ±9-cent detuned saws + a
   * drawn-saw layer → Mix → LPF with a slow Pulser cutoff sweep → keyboard
   * ADSR → Saturator → Chorus → PingPong → Reverb → Render. Play
   * `a w s e d …`; `,`/`.` shift octaves.
   */
  synthwave: () =>
    buildState(
      [
        { id: 'sw-pitch', type: 'keyboardPitch', x: 40, y: 340 },
        {
          id: 'sw-osc1',
          type: 'oscillator',
          x: 480,
          y: 40,
          // 10–15 cents is the two-voice detune sweet spot.
          values: { Shape: 'sawtooth', Detune: 12, Level: 0.5 },
        },
        {
          id: 'sw-osc2',
          type: 'oscillator',
          x: 480,
          y: 480,
          values: { Shape: 'sawtooth', Detune: -12, Level: 0.5 },
        },
        {
          id: 'sw-osc3',
          type: 'drawnOsc',
          x: 480,
          y: 920,
          values: { Waveform: sawWave, Level: 0.35 },
        },
        { id: 'sw-mix', type: 'mix', x: 1020, y: 460 },
        {
          id: 'sw-pulser',
          type: 'pulser',
          x: 1020,
          y: 860,
          values: { Shape: 'sine', 'Rate Hz': 0.15, Amplitude: 500, Offset: 1400 },
        },
        {
          id: 'sw-filter',
          type: 'filter',
          x: 1440,
          y: 460,
          values: { Type: 'lowpass', Q: 1.4 },
        },
        {
          id: 'sw-adsr',
          type: 'adsr',
          x: 1900,
          y: 460,
          values: {
            'Attack s': 0.03,
            'Decay s': 0.2,
            Sustain: 0.65,
            'Release s': 0.6,
          },
        },
        {
          id: 'sw-sat',
          type: 'saturator',
          x: 2360,
          y: 460,
          values: { Drive: 1.6, Trim: 0.8, Wet: 0.35 },
        },
        {
          id: 'sw-chorus',
          type: 'chorus',
          x: 2800,
          y: 460,
          values: { 'Rate Hz': 0.8, 'Delay ms': 4.5, Depth: 0.85, Wet: 0.5 },
        },
        {
          // Tape/VHS pitch drift — "pads and leads usually feature pitch
          // modulation to emulate tuning drift + wow/flutter".
          id: 'sw-wow',
          type: 'vibrato',
          x: 3260,
          y: 60,
          values: { 'Rate Hz': 0.4, Depth: 0.03, Wet: 1 },
        },
        {
          id: 'sw-delay',
          type: 'pingPongDelay',
          x: 3260,
          y: 460,
          values: { 'Time s': 0.32, Feedback: 0.35, Wet: 0.3 },
        },
        {
          id: 'sw-reverb',
          type: 'reverb',
          x: 3700,
          y: 460,
          values: { 'Decay s': 4, 'PreDelay s': 0.03, Wet: 0.35 },
        },
        { id: 'sw-render', type: 'render', x: 4140, y: 480 },
      ],
      [
        { from: 'sw-pitch', output: 'Hz', to: 'sw-osc1', input: 'Frequency' },
        { from: 'sw-pitch', output: 'Hz', to: 'sw-osc2', input: 'Frequency' },
        { from: 'sw-pitch', output: 'Hz', to: 'sw-osc3', input: 'Frequency' },
        { from: 'sw-osc1', output: 'Out', to: 'sw-mix', input: 'In' },
        { from: 'sw-osc2', output: 'Out', to: 'sw-mix', input: 'In' },
        { from: 'sw-osc3', output: 'Out', to: 'sw-mix', input: 'In' },
        { from: 'sw-mix', output: 'Out', to: 'sw-filter', input: 'In' },
        { from: 'sw-pulser', output: 'Out', to: 'sw-filter', input: 'Freq' },
        { from: 'sw-filter', output: 'Out', to: 'sw-adsr', input: 'In' },
        { from: 'sw-adsr', output: 'Out', to: 'sw-sat', input: 'In' },
        { from: 'sw-sat', output: 'Out', to: 'sw-chorus', input: 'In' },
        { from: 'sw-chorus', output: 'Out', to: 'sw-wow', input: 'In' },
        { from: 'sw-wow', output: 'Out', to: 'sw-delay', input: 'In' },
        { from: 'sw-delay', output: 'Out', to: 'sw-reverb', input: 'In' },
        { from: 'sw-reverb', output: 'Out', to: 'sw-render', input: 'In' },
      ],
    ),

  /**
   * TABLA (dayan "na" stroke; press keys to strike at any pitch): the drawn
   * wave carries Raman's harmonic modal series 1:2:3:4:5 (the syahi-loaded
   * membrane's first five resonances — Nature, 1920); a white-noise chiff is
   * the skin strike; a one-shot envelope rings ~0.3 s and damps.
   */
  tabla: () =>
    buildState(
      [
        { id: 'tb-pitch', type: 'keyboardPitch', x: 40, y: 460 },
        // Branch 1 — the RING (fundamental-suppressed, 2nd-harmonic
        // dominant): slowest decay.
        {
          id: 'tb-ringLow',
          type: 'drawnOsc',
          x: 480,
          y: 40,
          values: { Waveform: tablaRingLowWave, Level: 0.7 },
        },
        {
          id: 'tb-envLow',
          type: 'adsr',
          x: 1020,
          y: 40,
          values: {
            'Attack s': 0.001,
            'Decay s': 0.4,
            Sustain: 0,
            'Release s': 0.15,
          },
        },
        // Branch 2 — the UPPER MODES: same strike, dies 3× faster (real
        // membranes damp high modes first — the modal-decay split).
        {
          id: 'tb-ringHigh',
          type: 'drawnOsc',
          x: 480,
          y: 520,
          values: { Waveform: tablaRingHighWave, Level: 0.6 },
        },
        {
          id: 'tb-envHigh',
          type: 'adsr',
          x: 1020,
          y: 520,
          values: {
            'Attack s': 0.001,
            'Decay s': 0.12,
            Sustain: 0,
            'Release s': 0.06,
          },
        },
        // Branch 3 — the STRIKE: a 20 ms bandpassed "tak", not a wash.
        {
          id: 'tb-strike',
          type: 'noise',
          x: 480,
          y: 1000,
          values: { Type: 'white', Level: 0.8 },
        },
        {
          id: 'tb-strikeBp',
          type: 'filter',
          x: 940,
          y: 1000,
          values: { Type: 'bandpass', Freq: 3200, Q: 1 },
        },
        {
          id: 'tb-envStrike',
          type: 'adsr',
          x: 1400,
          y: 1000,
          values: {
            'Attack s': 0.0005,
            'Decay s': 0.02,
            Sustain: 0,
            'Release s': 0.01,
          },
        },
        { id: 'tb-mix', type: 'mix', x: 1900, y: 500 },
        {
          id: 'tb-filter',
          type: 'filter',
          x: 2340,
          y: 500,
          values: { Type: 'lowpass', Freq: 5000, Q: 0.8 },
        },
        {
          id: 'tb-reverb',
          type: 'reverb',
          x: 2780,
          y: 500,
          values: { 'Decay s': 1, 'PreDelay s': 0.005, Wet: 0.12 },
        },
        {
          id: 'tb-render',
          type: 'render',
          x: 3220,
          y: 520,
          values: { 'Level dB': -3 },
        },
      ],
      [
        { from: 'tb-pitch', output: 'Hz', to: 'tb-ringLow', input: 'Frequency' },
        { from: 'tb-pitch', output: 'Hz', to: 'tb-ringHigh', input: 'Frequency' },
        { from: 'tb-ringLow', output: 'Out', to: 'tb-envLow', input: 'In' },
        { from: 'tb-ringHigh', output: 'Out', to: 'tb-envHigh', input: 'In' },
        { from: 'tb-strike', output: 'Out', to: 'tb-strikeBp', input: 'In' },
        { from: 'tb-strikeBp', output: 'Out', to: 'tb-envStrike', input: 'In' },
        { from: 'tb-envLow', output: 'Out', to: 'tb-mix', input: 'In' },
        { from: 'tb-envHigh', output: 'Out', to: 'tb-mix', input: 'In' },
        { from: 'tb-envStrike', output: 'Out', to: 'tb-mix', input: 'In' },
        { from: 'tb-mix', output: 'Out', to: 'tb-filter', input: 'In' },
        { from: 'tb-filter', output: 'Out', to: 'tb-reverb', input: 'In' },
        { from: 'tb-reverb', output: 'Out', to: 'tb-render', input: 'In' },
      ],
    ),

  /**
   * HARMONIUM (hold keys): free reeds chop air into STEP-LIKE PULSES
   * (a pulse-train spectrum) — a narrow-pulse layer + two detuned
   * saw "reed banks"; the wooden box is a source-filter (lowpass + a nasal
   * mid formant); the bellows breathe as a slow shallow tremolo. Sustains
   * at full level while held — it is an organ, not a string.
   */
  harmonium: () =>
    buildState(
      [
        { id: 'hm-pitch', type: 'keyboardPitch', x: 40, y: 340 },
        {
          id: 'hm-reed1',
          type: 'oscillator',
          x: 480,
          y: 40,
          values: { Shape: 'sawtooth', Detune: 4, Level: 0.38 },
        },
        {
          id: 'hm-reed2',
          type: 'oscillator',
          x: 480,
          y: 480,
          values: { Shape: 'sawtooth', Detune: -4, Level: 0.38 },
        },
        {
          id: 'hm-reed3',
          type: 'drawnOsc',
          x: 480,
          y: 920,
          values: { Waveform: narrowPulse(0.3), Level: 0.3 },
        },
        { id: 'hm-mix', type: 'mix', x: 1020, y: 460 },
        {
          id: 'hm-box',
          type: 'filter',
          x: 1460,
          y: 460,
          values: { Type: 'lowpass', Freq: 2800, Q: 0.8 },
        },
        {
          id: 'hm-formant',
          type: 'eq3',
          x: 1900,
          y: 460,
          values: { 'Low dB': 1, 'Mid dB': 2, 'High dB': -1 },
        },
        {
          id: 'hm-adsr',
          type: 'adsr',
          x: 2340,
          y: 460,
          values: {
            'Attack s': 0.07,
            'Decay s': 0.1,
            Sustain: 0.95,
            'Release s': 0.15,
          },
        },
        {
          id: 'hm-bellows',
          type: 'tremolo',
          x: 2780,
          y: 460,
          values: { 'Rate Hz': 4.5, Depth: 0.06, Wet: 1 },
        },
        {
          id: 'hm-reverb',
          type: 'reverb',
          x: 3220,
          y: 460,
          values: { 'Decay s': 1.4, 'PreDelay s': 0.01, Wet: 0.18 },
        },
        { id: 'hm-render', type: 'render', x: 3660, y: 480 },
      ],
      [
        { from: 'hm-pitch', output: 'Hz', to: 'hm-reed1', input: 'Frequency' },
        { from: 'hm-pitch', output: 'Hz', to: 'hm-reed2', input: 'Frequency' },
        { from: 'hm-pitch', output: 'Hz', to: 'hm-reed3', input: 'Frequency' },
        { from: 'hm-reed1', output: 'Out', to: 'hm-mix', input: 'In' },
        { from: 'hm-reed2', output: 'Out', to: 'hm-mix', input: 'In' },
        { from: 'hm-reed3', output: 'Out', to: 'hm-mix', input: 'In' },
        { from: 'hm-mix', output: 'Out', to: 'hm-box', input: 'In' },
        { from: 'hm-box', output: 'Out', to: 'hm-formant', input: 'In' },
        { from: 'hm-formant', output: 'Out', to: 'hm-adsr', input: 'In' },
        { from: 'hm-adsr', output: 'Out', to: 'hm-bellows', input: 'In' },
        { from: 'hm-bellows', output: 'Out', to: 'hm-reverb', input: 'In' },
        { from: 'hm-reverb', output: 'Out', to: 'hm-render', input: 'In' },
      ],
    ),

  /**
   * DREAMY PAD — a dark, wide, slow bed built to a MEASURED target table.
   *
   * Hold a key: the patch voices a root–fifth–octave chord around it. Voicing
   * is the whole trick. The seven measured partial levels are held byte-exact
   * (`PAD_V1_CENTRE` above), and as ONE note they miss the measured five-band
   * energy split by up to 26 percentage points; voiced as this chord they land
   * within 0.28 pp. The reference's partial table looked unphysical — h6 above
   * h5, a ~52 dB/octave step between h4 and h5 — for exactly this reason: it
   * was never one note's spectrum, it was three notes' partials interleaving.
   *
   * Targets (see `samples/analysis/reports/dreamy-reference-findings.md`):
   *   bands  18.2 / 55.7 / 25.4 / 0.65 / 0.03 %   (0-120/-250/-500/-1k/>1k Hz)
   *   LR correlation  0.667 below 250 Hz, 0.262 from 250-1000 Hz
   *   beating 0.14 Hz, attack ~21 ms, reverb T60 ~1.6 s
   *
   * WHY THERE IS NO LFO HERE. The findings reported an amplitude AND a
   * brightness LFO, both at 0.091 Hz, and an earlier draft of this graph had
   * two `pulser` nodes for them. Measured over 150 s instead of the original
   * 22 s, the three candidate modulation rates disagree with each other and
   * with 0.091 Hz, and none stands 6x above its own spectral mean. 0.091 Hz is
   * exactly BIN 2 of a 22-second window (2/22 s = 0.0909) — it was the
   * analysis window, not the music. Slow movement in the bed is harmony, and
   * harmony belongs in a score, not in the patch.
   *
   * The darkness is the WAVETABLE, not a filter: the table already puts 99.6 %
   * of its energy below 500 Hz, so there is no tone filter either — a lowpass
   * placed to "darken" this would only eat the 500-1000 Hz band, which is
   * already 0.28 pp UNDER target.
   *
   * Beating is a summed `constant`, not a detune: signal inputs SUM, so
   * `Hz + 0.07` is an exact +0.07 Hz at every pitch, where a cents detune would
   * drift with register (0.14 Hz is 3.9 cents at 61.7 Hz but 1.0 at 247 Hz).
   * wideL gets +0.07 and wideR −0.07, so the pair beats at exactly 0.14 Hz.
   *
   * `Decay s` 2.4 is a real T60 of 1.60 s — see the law documented on the
   * reverb node in `effectTable.ts`. It is NOT 2.4 seconds.
   */
  /**
   * PIANO — the physically modelled struck string, one voice per key.
   *
   * Replaces the subtractive `piano` retired on 2026-09-20, which was three
   * detuned saws under ONE ADSR and could not sound like a piano for
   * structural reasons: a single envelope over a fixed spectrum has a frozen
   * timbre, its partials were exactly harmonic where a real string's are
   * stretched, it had no two-stage decay, and velocity could only change
   * level.
   *
   * PLAY IT: hold a key, or several. `Velocity` on any Struck String node is
   * the control worth moving — it is NOT a volume. The core maps it to hammer
   * contact time, so 0.3 is a genuinely darker sound and 1.0 a brighter one:
   * felt is a nonlinear spring, so a harder strike shortens contact and
   * widens the excitation's bandwidth.
   *
   * ONE VOICE PER KEY, off `allKeys` — the same shape the shipped Guitar and
   * Violin demos use, and it is not merely for polyphony. A FIRST VERSION USED
   * `keyboardPitch`, one shared Hz into one string, AND IT GLITCHED AUDIBLY. A
   * waveguide's delay-line LENGTH is its pitch, so changing Hz while the
   * string is still ringing re-pitches the wave already stored in the line —
   * a click, not a note change. Per-key voices each hold a fixed pitch and
   * never do that. It also removes the five-node gate derivation the mono
   * version needed, because `allKeys` emits a real per-key Gate.
   *
   * `pn-trim` is MEASURED. Rendered offline the string peaks at 3.99 on C3 at
   * velocity 0.8 and 4.91 at 1.0 — anything over 1.0 clips, so this attenuates
   * rather than boosts, with headroom for several keys at once. Note an 11 dB
   * spread across the keyboard (C3 peaks 3.7x higher than C5): that is real
   * string behaviour, and a per-note normaliser would remove something a piano
   * genuinely does.
   */
  piano: () => buildPianoGraph(),

  /** Landing scene: "Play the guitar" under the oak. See `buildGuitarKeysGraph`. */
  guitarKeys: () => buildGuitarKeysGraph(),

  /** Landing scene: the sakura's Starry Pad. See `buildStarryPadKeysGraph`. */
  starryPadKeys: () => buildStarryPadKeysGraph(),

  dreamyPad: () => buildDreamyPadGraph(),

  /**
   * DREAMY PAD A — fitted to 0:00-0:10 alone, WITH the low-end onset.
   *
   * An A minor with its ninth: A2 E3 A3 B3 C4 E4 B4. The section's weight sits
   * in 140-400 Hz (92 % of its energy) with almost nothing below 140, and the
   * loudest partials are C4 and E3 rather than the root — a bright, close
   * voicing whose root is the QUIETEST tone in it (0.415 against C4's 1.0).
   *
   * The bass onset belongs HERE and only here: it was measured over 0-0.6 s,
   * inside this section. Its 80-140 Hz share runs 17.3 % at the attack against
   * 6.6 % sustained, and the low end is denser at onset too — 3rd harmonic
   * +24.0 dB at the attack against +8.6 dB later.
   *
   * It is a physically modelled `pluckedString` an octave under the root, not
   * an oscillator. A sine-plus-triangle-through-a-saturator version measured
   * plausibly and sounded, in Deepak's words, like "a plate with a ting":
   * saturating a 55 Hz sine manufactures partials at 110, 165 and 220 Hz,
   * which are this chord's own tones, so it beat against the pad rather than
   * sitting under it. A real string sheds its highs in the first moments and
   * leaves a ringing fundamental — which is both the sound wanted and the
   * onset-then-fade the measurement describes, with no extra envelope.
   *
   * Hold an A (A4 lands the root on 110 Hz, so the bass sounds at 55 Hz).
   */
  dreamyPadA: () => buildFittedPadGraph({ chord: PAD_A_CHORD }),


  /**
   * SFX — WET BLAST (press ANY note key). An anime fight-scene impact.
   *
   * WHY THE OLD ONE WAS WRONG. It was white noise + a STATIC 45 Hz sine into a
   * lowpass, an envelope, a clipper and a 250 ms ping-pong delay. Three faults,
   * none of them a tuning matter:
   *   1. NOTHING SWEPT. A static 45 Hz sine with a 0.4 s decay is the textbook
   *      definition of a synthesised kick drum. The single defining feature of
   *      an impact is a fast DOWNWARD pitch glide, and there was none.
   *   2. The "rubber band" was the PING-PONG DELAY. 250 ms is ~5x past the
   *      ~50 ms echo-fusion threshold, and 0.45 feedback gives discrete
   *      alternating repeats at -6.9 / -13.9 / -20.8 / -27.7 dB — an audible
   *      bouncing train, not a tail. (An earlier guess of mine that the
   *      resonant filter caused it was REFUTED: Q = 1.5 is only +4.0 dB.)
   *   3. The 800 Hz lowpass sat BEFORE the envelope and deleted the transient
   *      layer outright, so amplitude was the only thing that ever moved.
   *
   * THE ANIME TELL. A real drum head glides only a couple of semitones. The
   * ~3-OCTAVE exaggeration here is precisely what makes this read as anime
   * rather than as percussion — it is a stylisation, not a simulation.
   *
   * HOW A KEY-TRIGGERED SWEEP IS EVEN POSSIBLE. `adsr.Env` is a constant 0
   * unless `Gate` is connected, and a "press any key" patch fires from the
   * legacy global keyboard bus with `Gate` unconnected. So the envelope is
   * taken off the AUDIO path instead and converted back to control:
   *
   *     constant(1) -> toAudio -> adsr -> gain(depth) -> toSignal -> Frequency
   *                                                   + constant(base)
   *
   * `toAudio`/`toSignal` are each a bare `Tone.Gain(1)` with no DC blocking
   * (implementations.ts:840-859 — the comment there states control signals
   * carry DC by design), so DC survives the round trip. Signals SUM on a signal
   * input, which is what turns `base + depth x env` into a sweep with no
   * arithmetic node. ONE carrier feeds every envelope in the patch.
   *
   * FIVE LAYERS, and no discrete delay anywhere:
   *   transient  2-4 ms highpassed crack
   *   body       sine swept 320 -> 40 Hz (36 semitones) — the anime tell
   *   squelch    bandpass noise, centre collapsing 2860 -> 260 Hz — the "wet"
   *   bubbles    two sines sweeping UP, 300 -> 820 and 550 -> 1450 Hz
   *   debris     highpassed noise tail, ~340 ms
   *
   * THE BUBBLES SWEEP UP AND THAT IS THE POINT. Minnaert's relation
   * `f . a ~= 3.26` (radius in metres, frequency in Hz) says a bubble's tone
   * RISES as it shrinks, so upward glides against everything else falling is
   * the cue the ear reads as liquid. Built with a NEGATIVE `gain.Gain`: at the
   * envelope's peak the negative term pulls the pitch down to base - depth, and
   * as the envelope decays the pitch rises back to base.
   */
  /**
   * SOLO — STARRY PAD: "Starfield". D# minor, 8 bars, twelve `inst_starryPad`
   * voices (sub + 5 chord tones + 5 detuned twins + melody), bloomed strikes,
   * cutoff riding 700 -> 3200 -> 700 Hz. See `padSoloNotes`.
   */
  padSolo: () =>
    buildSoloGraph('ps', padSoloVoices(), {
      cutoffCurveId: 'crv_psCutoff',
      cutoffQ: 1.2,
      chorus: { rate: 0.3, depth: 0.7, wet: 0.45 },
      reverbDecay: 5.5,
      reverbWet: 0.55,
      busGain: 3,
      renderDb: -7,
    }),


  /**
   * SOLO — VAMPIRE SYNTH: "Nosferatu". F# Phrygian dominant, 32 bars at 132,
   * six `inst_vampireSynth` voices: the hook, the lead, a chorus with an
   * answering melody, a breakdown with octave pitch-drop stabs and sixteenth
   * fills, a riser with trills, a second chorus with a counter-riff, and a
   * delay throw on the choruses. The dotted-eighth ping-pong is structural —
   * with a 10 ms release it is the only tail the notes have. See
   * `vampireSoloExtendedNotes`.
   */
  vampireSoloExtended: () =>
    buildSoloGraph('nx', vampireSoloVoices(), {
      cutoffCurveId: 'crv_nxCutoff',
      cutoffQ: 1.6,
      drive: { amount: 1.8, wet: 0.35 },
      echo: { time: 0.3409, feedback: 0.32, wet: 0.28 },
      echoWetCurveId: 'crv_nxEcho',
      reverbDecay: 3,
      reverbWet: 0.3,
      busGain: 3.5,
      renderDb: -7,
    }),

  /**
   * SOLO — VIOLIN: "Lament and Flight". D minor, six bare `bowedString`
   * (thermal) voices differing only in vibrato and bow position, one shared
   * violin `stringBody`. `Force` is live per voice. See `violinSoloNotes`.
   */
  violinSolo: () =>
    buildSoloGraph('vs', violinSoloVoices(), {
      body: 'violin',
      reverbDecay: 3.2,
      reverbWet: 0.3,
      // 1.0, down from 1.5: the fitted body is fuller (peak measured 0.85 at 1.5).
      busGain: 1,
      withForce: true,
      renderDb: -6,
    }),

  /**
   * SOLO — VIOLIN: "Firebrand Caprice". The fast one: spiccato, bariolage,
   * double-stop thirds, tremolo, a molto-vibrato interlude, and a coda to A6.
   * Six bare `bowedString` voices specialised by ATTACK and vibrato. Every
   * fast device was measured playable before it was written. See
   * `violinCapriceNotes`.
   */
  violinCaprice: () =>
    buildSoloGraph('vc', violinCapriceVoices(), {
      body: 'violin',
      reverbDecay: 2.4,
      reverbWet: 0.26,
      // 0.85: measured 1.07 peak at 1.0 -- the coda clipped.
      busGain: 0.85,
      withForce: true,
      renderDb: -6,
    }),

  /**
   * SOLO — FLUTE: "Reed at Dusk". D Aeolian, free time, three bare `jetFlute`
   * voices (straight / vibrato / breathy). No body node — a flute's resonator
   * IS the instrument. See `fluteSoloNotes`.
   */
  fluteSolo: () =>
    buildSoloGraph('fs', fluteSoloVoices(), {
      reverbDecay: 3.6,
      reverbWet: 0.34,
      busGain: 1,
      renderDb: -6,
    }),

  /**
   * SOLO — GUITAR: "Back Porch Run". G major country flatpicking — boom-chick
   * bass, the G-run, hammer-on licks, double stops, a walk-down turnaround
   * and a ringing open-G strum. Nine bright nail-picked `pluckedString`
   * voices, one shared body. See `guitarSoloNotes`.
   */
  guitarSolo: () =>
    buildSoloGraph('gs', guitarSoloVoices(), {
      body: 'guitar',
      // Drier and brighter than the nocturne: a picked steel-string wants a
      // small room, not a hall.
      reverbDecay: 1.6,
      reverbWet: 0.18,
      busGain: 24,
      renderDb: -5,
    }),

  sfxWetBlast: () => buildWetBlast(),

  /** SFX — HEAL. Rising, consonant, no transient. See `buildHeal`. */
  sfxHeal: () => buildHeal(),

  /** SFX — LIGHTNING. Crack, then a delayed sub rumble. See `buildLightning`. */
  sfxLightning: () => buildLightning(),

  /** SFX — TIME WARP. `t = 1 - dD/dt` on a swept delay. See `buildTimeWarp`. */
  sfxTimeWarp: () => buildTimeWarp(),

  /** SFX — ICE. Flexural dispersion: highs arrive first. See `buildIce`. */
  sfxIce: () => buildIce(),

  /** SFX — FIRE. 300-500 Hz combustion + incommensurate crackle. See `buildFire`. */
  sfxFire: () => buildFire(),

  /** SFX — NATURE. Layered, with 4 Hz fluctuation. See `buildNature`. */
  sfxNature: () => buildNature(),

  /** SFX — BUBBLE/WATER. Minnaert up-glides. See `buildBubbleWater`. */
  sfxBubbleWater: () => buildBubbleWater(),

  /**
   * SFX — RISER (loops every 10 s, no keys): a SAWTOOTH Pulser is a looping
   * ramp — one drives the tone's pitch 50→550 Hz, a twin drives a filter
   * sweep 200→3 kHz over a noise bed; an 8 Hz tremolo adds the tension
   * flutter. The ramp resets = the riser re-arms forever.
   */
  sfxRiser: () =>
    buildState(
      [
        {
          id: 'ri-rampPitch',
          type: 'pulser',
          x: 40,
          y: 40,
          values: { Shape: 'sawtooth', 'Rate Hz': 0.1, Amplitude: 250, Offset: 300 },
        },
        {
          id: 'ri-tone',
          type: 'drawnOsc',
          x: 500,
          y: 40,
          values: { Waveform: sawWave, Level: 0.45 },
        },
        {
          id: 'ri-rampFilter',
          type: 'pulser',
          x: 40,
          y: 620,
          values: { Shape: 'sawtooth', 'Rate Hz': 0.1, Amplitude: 1400, Offset: 1600 },
        },
        {
          id: 'ri-noise',
          type: 'noise',
          x: 500,
          y: 480,
          values: { Type: 'white', Level: 0.55 },
        },
        {
          id: 'ri-sweep',
          type: 'filter',
          x: 960,
          y: 480,
          values: { Type: 'bandpass', Q: 1.2 },
        },
        { id: 'ri-mix', type: 'mix', x: 1420, y: 260 },
        {
          id: 'ri-trem',
          type: 'tremolo',
          x: 1860,
          y: 260,
          values: { 'Rate Hz': 8, Depth: 0.6, Wet: 0.7 },
        },
        {
          id: 'ri-reverb',
          type: 'reverb',
          x: 2300,
          y: 260,
          values: { 'Decay s': 3, 'PreDelay s': 0.02, Wet: 0.35 },
        },
        {
          id: 'ri-render',
          type: 'render',
          x: 2740,
          y: 280,
          values: { 'Level dB': -8 },
        },
      ],
      [
        { from: 'ri-rampPitch', output: 'Out', to: 'ri-tone', input: 'Frequency' },
        { from: 'ri-rampFilter', output: 'Out', to: 'ri-sweep', input: 'Freq' },
        { from: 'ri-noise', output: 'Out', to: 'ri-sweep', input: 'In' },
        { from: 'ri-tone', output: 'Out', to: 'ri-mix', input: 'In' },
        { from: 'ri-sweep', output: 'Out', to: 'ri-mix', input: 'In' },
        { from: 'ri-mix', output: 'Out', to: 'ri-trem', input: 'In' },
        { from: 'ri-trem', output: 'Out', to: 'ri-reverb', input: 'In' },
        { from: 'ri-reverb', output: 'Out', to: 'ri-render', input: 'In' },
      ],
    ),

  /** SFX — WIND STORM (self-running): white noise through a bandpass whose
   *  center is swept 500→2500 Hz by a very slow sine — classic howl. */
  sfxWind: () =>
    buildState(
      [
        {
          id: 'wi-noise',
          type: 'noise',
          x: 40,
          y: 120,
          values: { Type: 'white', Level: 0.7 },
        },
        {
          id: 'wi-sweep',
          type: 'pulser',
          x: 40,
          y: 560,
          values: { Shape: 'sine', 'Rate Hz': 0.08, Amplitude: 1000, Offset: 1500 },
        },
        {
          id: 'wi-filter',
          type: 'filter',
          x: 520,
          y: 220,
          values: { Type: 'bandpass', Q: 1.2 },
        },
        {
          id: 'wi-reverb',
          type: 'reverb',
          x: 980,
          y: 220,
          values: { 'Decay s': 2.5, 'PreDelay s': 0.02, Wet: 0.3 },
        },
        {
          id: 'wi-render',
          type: 'render',
          x: 1420,
          y: 240,
          values: { 'Level dB': -8 },
        },
      ],
      [
        { from: 'wi-noise', output: 'Out', to: 'wi-filter', input: 'In' },
        { from: 'wi-sweep', output: 'Out', to: 'wi-filter', input: 'Freq' },
        { from: 'wi-filter', output: 'Out', to: 'wi-reverb', input: 'In' },
        { from: 'wi-reverb', output: 'Out', to: 'wi-render', input: 'In' },
      ],
    ),

  /** SFX — HEARTBEAT (self-running): a 50 Hz sine hard-gated by a SQUARE
   *  Pulser at 1.2 Hz (thump / silence), darkened and lightly warmed. */
  /**
   * SFX — HEARTBEAT. A real beat is two sounds, unevenly spaced.
   *
   * The previous build was a 50 Hz sine gated by a SQUARE pulser at 1.2 Hz, and
   * the verdict was "just sounds like a square wave". Three faults, none of
   * them a tuning matter:
   *   1. ONE thump per cycle. A heart makes TWO — S1 ("lub", mitral/tricuspid
   *      closing) and S2 ("dub", aortic/pulmonary closing).
   *   2. EVEN spacing. Clinically an evenly-spaced single thump is
   *      *embryocardia* — a fetal or dying heart. Systole (S1->S2) is SHORTER
   *      than diastole (S2->S1) at rest.
   *   3. A SQUARE gate switches instantly, which splatters spectrally. That
   *      discontinuity IS the "square wave" being heard.
   *
   * THE TIMING MECHANISM. One sawtooth pulser is a phase ramp 0->1 per cycle;
   * two Thresholds at different levels turn it into two independent triggers,
   * so the split is set by threshold values rather than by two free-running
   * LFOs that would drift against each other.
   *
   *   phase ramp  0 ───0.04────────0.42────────► 1 ┐ (reset)
   *                     │              │                 │
   *                     ▼              ▼                 │
   *                 S1 "lub"       S2 "dub"                │
   *                     └─ systole 0.38 cyc ─┘                │
   *                                    └─── diastole ──────┘
   *
   * The 0.38 gap is not arbitrary. The measured clinical relation
   * `systole_ms ~= 400 - 1.2*bpm` gives 313.6 ms at 72 bpm, i.e. phase 0.376;
   * the thresholds below fire at 0.04 and 0.42, a 0.38 gap = 317 ms. See
   * `.claude/plans/solos-and-sfx.md` and `samples/analysis/heartbeat_ref.py`.
   *
   * S1 vs S2, from the literature and corroborated on a real phonocardiogram
   * (`samples/references/sfx/heartbeat/`): S1 is longer and lower, S2 shorter
   * and brighter. Measured energy sits at 40-80 Hz, not the single 50 Hz the
   * old build guessed at.
   *
   * Each sound is a damped THUD, not a tone: a sine for weight plus a noise
   * burst for the valve slap through the same envelope, then a shared
   * resonance standing in for the chest cavity. The modal bank would have been
   * the natural home for that, but `stringBody`'s 'custom' preset silently
   * renders a guitar body, so a peaking filter does the job.
   */
  sfxHeartbeat: () => buildHeartbeat('clinical'),

  /**
   * SFX — HEARTBEAT (cinematic). The same two-sound, unevenly-spaced anatomy,
   * voiced for tension rather than for a stethoscope: slower, an octave lower,
   * longer tails and a room around it. A film heartbeat is the chest felt
   * rather than heard.
   */
  sfxHeartbeatCinematic: () => buildHeartbeat('cinematic'),

  /**
   * SFX — HEARTBEAT (deep). The MUSIC-VIDEO heartbeat: a produced kick
   * rather than a recording of a chest.
   *
   * The cinematic one and this were too alike while both were slow, low and
   * reverberant — depth alone does not separate them. What does is the 808
   * move: the sub DROPS in pitch, 60 Hz -> 26 Hz in 55 ms, driven by its own
   * short envelope while the note rings on for half a second. A static sine
   * is a rumble; a falling one is a kick.
   *
   * Plus a highpassed transient click so it reads on a phone, and NO reverb
   * at all — it sits forward in the mix instead of in a room.
   */
  sfxHeartbeatDeep: () => buildHeartbeat('deep'),

  /** SFX — ALARM (self-running): a square wave whose pitch is slammed
   *  between 500 and 900 Hz by a SQUARE Pulser at 2 Hz — the klaxon —
   *  dirtied and slapped with a short delay. */
  sfxAlarm: () =>
    buildState(
      [
        {
          id: 'al-klaxon',
          type: 'pulser',
          x: 40,
          y: 40,
          values: { Shape: 'square', 'Rate Hz': 2, Amplitude: 200, Offset: 700 },
        },
        {
          id: 'al-osc',
          type: 'oscillator',
          x: 500,
          y: 120,
          values: { Shape: 'square', Level: 0.5 },
        },
        {
          id: 'al-dist',
          type: 'distortion',
          x: 960,
          y: 120,
          values: { Amount: 0.5, Wet: 0.6 },
        },
        {
          id: 'al-delay',
          type: 'feedbackDelay',
          x: 1400,
          y: 120,
          values: { 'Time s': 0.12, Feedback: 0.3, Wet: 0.25 },
        },
        {
          id: 'al-render',
          type: 'render',
          x: 1840,
          y: 140,
          values: { 'Level dB': -10 },
        },
      ],
      [
        { from: 'al-klaxon', output: 'Out', to: 'al-osc', input: 'Frequency' },
        { from: 'al-osc', output: 'Out', to: 'al-dist', input: 'In' },
        { from: 'al-dist', output: 'Out', to: 'al-delay', input: 'In' },
        { from: 'al-delay', output: 'Out', to: 'al-render', input: 'In' },
      ],
    ),

  /**
   * EASY EFFECTS — KEYS: a two-saw synth played on the computer keyboard,
   * through three Easy Effects in a row: Crunch → Echo → Big Space. Each
   * effect is a node group with plain-word knobs (open one to see inside).
   */
  fxKeys: () =>
    buildState(
      [
        { id: 'fk-pitch', type: 'keyboardPitch', x: 40, y: 300 },
        {
          id: 'fk-osc1',
          type: 'oscillator',
          x: 480,
          y: 40,
          values: { Shape: 'sawtooth', Detune: 8, Level: 0.4 },
        },
        {
          id: 'fk-osc2',
          type: 'oscillator',
          x: 480,
          y: 700,
          values: { Shape: 'sawtooth', Detune: -8, Level: 0.4 },
        },
        { id: 'fk-mix', type: 'mix', x: 1020, y: 300 },
        {
          id: 'fk-filter',
          type: 'filter',
          x: 1440,
          y: 300,
          values: { Type: 'lowpass', Freq: 2400, Q: 1 },
        },
        {
          id: 'fk-adsr',
          type: 'adsr',
          x: 1900,
          y: 300,
          values: {
            'Attack s': 0.01,
            'Decay s': 0.25,
            Sustain: 0.5,
            'Release s': 0.4,
          },
        },
        {
          id: 'fk-crunch',
          type: 'fx_crunch',
          x: 2360,
          y: 300,
          values: { Crunch: 30, Tone: 55, Volume: 50 },
        },
        {
          id: 'fk-echo',
          type: 'fx_echo',
          x: 2820,
          y: 300,
          values: { Echoes: 40, Time: '1/8.', Darkness: 45, Mix: 30 },
        },
        {
          id: 'fk-space',
          type: 'fx_bigSpace',
          x: 3280,
          y: 300,
          values: { Size: 55, Brightness: 50, Mix: 25 },
        },
        { id: 'fk-render', type: 'render', x: 3740, y: 320 },
      ],
      [
        { from: 'fk-pitch', output: 'Hz', to: 'fk-osc1', input: 'Frequency' },
        { from: 'fk-pitch', output: 'Hz', to: 'fk-osc2', input: 'Frequency' },
        { from: 'fk-osc1', output: 'Out', to: 'fk-mix', input: 'In' },
        { from: 'fk-osc2', output: 'Out', to: 'fk-mix', input: 'In' },
        { from: 'fk-mix', output: 'Out', to: 'fk-filter', input: 'In' },
        { from: 'fk-filter', output: 'Out', to: 'fk-adsr', input: 'In' },
        { from: 'fk-adsr', output: 'Out', to: 'fk-crunch', input: 'In' },
        { from: 'fk-crunch', output: 'Out', to: 'fk-echo', input: 'In' },
        { from: 'fk-echo', output: 'Out', to: 'fk-space', input: 'In' },
        { from: 'fk-space', output: 'Out', to: 'fk-render', input: 'In' },
      ],
    ),

  /**
   * EASY EFFECTS — RHYTHM: a held A-minor chord (no keys needed; it sounds
   * on Run) through the tempo-locked Easy Effects: Wobble → Stutter →
   * Big Space. Both follow the timeline tempo (120 BPM when none is set).
   */
  fxRhythm: () =>
    buildState(
      [
        {
          id: 'fr-root',
          type: 'oscillator',
          x: 40,
          y: 40,
          values: { Shape: 'sawtooth', Frequency: 110, Level: 0.35 },
        },
        {
          id: 'fr-third',
          type: 'oscillator',
          x: 40,
          y: 660,
          values: { Shape: 'sawtooth', Frequency: 130.81, Level: 0.3 },
        },
        {
          id: 'fr-fifth',
          type: 'oscillator',
          x: 40,
          y: 1280,
          values: { Shape: 'sawtooth', Frequency: 164.81, Level: 0.3 },
        },
        { id: 'fr-mix', type: 'mix', x: 580, y: 660 },
        {
          id: 'fr-wobble',
          type: 'fx_wobble',
          x: 1040,
          y: 660,
          values: { Speed: '1/8', Depth: 70, Growl: 25 },
        },
        {
          id: 'fr-stutter',
          type: 'fx_stutter',
          x: 1500,
          y: 660,
          values: { Amount: 45, Chop: '1/16', Mix: 100 },
        },
        {
          id: 'fr-space',
          type: 'fx_bigSpace',
          x: 1960,
          y: 660,
          values: { Size: 40, Brightness: 45, Mix: 20 },
        },
        {
          id: 'fr-level',
          type: 'gain',
          x: 2420,
          y: 660,
          values: { Gain: 0.7 },
        },
        { id: 'fr-render', type: 'render', x: 2880, y: 680 },
      ],
      [
        { from: 'fr-root', output: 'Out', to: 'fr-mix', input: 'In' },
        { from: 'fr-third', output: 'Out', to: 'fr-mix', input: 'In' },
        { from: 'fr-fifth', output: 'Out', to: 'fr-mix', input: 'In' },
        { from: 'fr-mix', output: 'Out', to: 'fr-wobble', input: 'In' },
        { from: 'fr-wobble', output: 'Out', to: 'fr-stutter', input: 'In' },
        { from: 'fr-stutter', output: 'Out', to: 'fr-space', input: 'In' },
        { from: 'fr-space', output: 'Out', to: 'fr-level', input: 'In' },
        { from: 'fr-level', output: 'Out', to: 'fr-render', input: 'In' },
      ],
    ),

  /**
   * DRONE — ABYSS (sub-frequency beating + rumble bed): two sines
   * 55 vs 56.6 Hz (≈1.6 Hz physical beat), a 110 Hz saw octave body, brown
   * noise low-passed to a rumble, thickening saturation, deep lowpass and
   * SERIAL reverbs for the cavern. No envelope — it sounds on Run.
   */
  droneAbyss: () =>
    buildState(
      [
        {
          id: 'da-sub1',
          type: 'oscillator',
          x: 40,
          y: 40,
          values: { Shape: 'sine', Frequency: 55, Level: 0.6 },
        },
        {
          id: 'da-sub2',
          type: 'oscillator',
          x: 40,
          y: 460,
          values: { Shape: 'sine', Frequency: 56.6, Level: 0.6 },
        },
        {
          id: 'da-body',
          type: 'drawnOsc',
          x: 40,
          y: 880,
          values: { Waveform: sawWave, Frequency: 110, Level: 0.25 },
        },
        {
          id: 'da-noise',
          type: 'noise',
          x: 40,
          y: 1320,
          values: { Type: 'brown', Level: 0.18 },
        },
        {
          id: 'da-rumble',
          type: 'filter',
          x: 480,
          y: 1320,
          values: { Type: 'lowpass', Freq: 180, Q: 0.7 },
        },
        { id: 'da-mix', type: 'mix', x: 940, y: 620 },
        {
          id: 'da-sat',
          type: 'saturator',
          x: 1380,
          y: 620,
          values: { Drive: 1.8, Trim: 0.8, Wet: 0.4 },
        },
        {
          id: 'da-filter',
          type: 'filter',
          x: 1820,
          y: 620,
          values: { Type: 'lowpass', Freq: 350, Q: 0.8 },
        },
        {
          id: 'da-reverbA',
          type: 'reverb',
          x: 2260,
          y: 620,
          values: { 'Decay s': 8, 'PreDelay s': 0.05, Wet: 0.5 },
        },
        {
          id: 'da-reverbB',
          type: 'reverb',
          x: 2700,
          y: 620,
          values: { 'Decay s': 4, 'PreDelay s': 0.02, Wet: 0.35 },
        },
        {
          id: 'da-render',
          type: 'render',
          x: 3140,
          y: 640,
          values: { 'Level dB': -4 },
        },
      ],
      [
        { from: 'da-sub1', output: 'Out', to: 'da-mix', input: 'In' },
        { from: 'da-sub2', output: 'Out', to: 'da-mix', input: 'In' },
        { from: 'da-body', output: 'Out', to: 'da-mix', input: 'In' },
        { from: 'da-noise', output: 'Out', to: 'da-rumble', input: 'In' },
        { from: 'da-rumble', output: 'Out', to: 'da-mix', input: 'In' },
        { from: 'da-mix', output: 'Out', to: 'da-sat', input: 'In' },
        { from: 'da-sat', output: 'Out', to: 'da-filter', input: 'In' },
        { from: 'da-filter', output: 'Out', to: 'da-reverbA', input: 'In' },
        { from: 'da-reverbA', output: 'Out', to: 'da-reverbB', input: 'In' },
        { from: 'da-reverbB', output: 'Out', to: 'da-render', input: 'In' },
      ],
    ),

  /**
   * DRONE — VOID (inharmonic variation): a tritone saw pair smeared by a
   * slow FrequencyShifter (3 Hz shift = endless phasing inharmonicity),
   * Chebyshev metallic edge, resonant lowpass, glacial phaser, long tail.
   */
  droneVoid: () =>
    buildState(
      [
        {
          id: 'dv-osc1',
          type: 'oscillator',
          x: 40,
          y: 120,
          values: { Shape: 'sawtooth', Frequency: 110, Level: 0.5 },
        },
        {
          id: 'dv-osc2',
          type: 'oscillator',
          x: 40,
          y: 560,
          values: { Shape: 'sawtooth', Frequency: 155.56, Level: 0.4 },
        },
        { id: 'dv-mix', type: 'mix', x: 520, y: 320 },
        {
          id: 'dv-shift',
          type: 'frequencyShifter',
          x: 960,
          y: 320,
          values: { 'Shift Hz': 3, Wet: 0.6 },
        },
        {
          id: 'dv-cheby',
          type: 'chebyshev',
          x: 1400,
          y: 320,
          values: { Order: 3, Wet: 0.25 },
        },
        {
          id: 'dv-filter',
          type: 'filter',
          x: 1840,
          y: 320,
          values: { Type: 'lowpass', Freq: 900, Q: 2 },
        },
        {
          id: 'dv-phaser',
          type: 'phaser',
          x: 2280,
          y: 320,
          values: { 'Rate Hz': 0.12, Octaves: 3, 'Base Hz': 200, Wet: 0.5 },
        },
        {
          id: 'dv-reverb',
          type: 'reverb',
          x: 2720,
          y: 320,
          values: { 'Decay s': 7, 'PreDelay s': 0.04, Wet: 0.45 },
        },
        {
          id: 'dv-render',
          type: 'render',
          x: 3160,
          y: 340,
          values: { 'Level dB': -6 },
        },
      ],
      [
        { from: 'dv-osc1', output: 'Out', to: 'dv-mix', input: 'In' },
        { from: 'dv-osc2', output: 'Out', to: 'dv-mix', input: 'In' },
        { from: 'dv-mix', output: 'Out', to: 'dv-shift', input: 'In' },
        { from: 'dv-shift', output: 'Out', to: 'dv-cheby', input: 'In' },
        { from: 'dv-cheby', output: 'Out', to: 'dv-filter', input: 'In' },
        { from: 'dv-filter', output: 'Out', to: 'dv-phaser', input: 'In' },
        { from: 'dv-phaser', output: 'Out', to: 'dv-reverb', input: 'In' },
        { from: 'dv-reverb', output: 'Out', to: 'dv-render', input: 'In' },
      ],
    ),

  /**
   * DRONE — DREAD CHOIR (cluster variation): a minor-2nd
   * saw cluster whose detune DRIFTS via a slow Pulser (the "LFO-modulated
   * fine tune"), a −12 square sub (octave stack), dark filter, TIDAL
   * tremolo (0.07 Hz ≈ 14 s swells), doubled width, long tail.
   */
  droneDread: () =>
    buildState(
      [
        {
          id: 'dd-drift',
          type: 'pulser',
          x: 40,
          y: 40,
          values: { Shape: 'sine', 'Rate Hz': 0.05, Amplitude: 8, Offset: 0 },
        },
        {
          id: 'dd-osc1',
          type: 'oscillator',
          x: 480,
          y: 40,
          values: { Shape: 'sawtooth', Frequency: 110, Level: 0.45 },
        },
        {
          id: 'dd-osc2',
          type: 'oscillator',
          x: 480,
          y: 480,
          values: { Shape: 'sawtooth', Frequency: 116.54, Level: 0.45 },
        },
        {
          id: 'dd-sub',
          type: 'oscillator',
          x: 480,
          y: 920,
          values: { Shape: 'square', Frequency: 55, Level: 0.35 },
        },
        { id: 'dd-mix', type: 'mix', x: 1000, y: 480 },
        {
          id: 'dd-filter',
          type: 'filter',
          x: 1440,
          y: 480,
          values: { Type: 'lowpass', Freq: 420, Q: 1 },
        },
        {
          id: 'dd-tide',
          type: 'tremolo',
          x: 1880,
          y: 480,
          values: { 'Rate Hz': 0.07, Depth: 0.45, Wet: 1 },
        },
        {
          id: 'dd-chorus',
          type: 'chorus',
          x: 2320,
          y: 480,
          values: { 'Rate Hz': 0.4, 'Delay ms': 7, Depth: 0.9, Wet: 0.6 },
        },
        {
          id: 'dd-reverb',
          type: 'reverb',
          x: 2760,
          y: 480,
          values: { 'Decay s': 6, 'PreDelay s': 0.03, Wet: 0.5 },
        },
        {
          id: 'dd-render',
          type: 'render',
          x: 3200,
          y: 500,
          values: { 'Level dB': -5 },
        },
      ],
      [
        { from: 'dd-drift', output: 'Out', to: 'dd-osc1', input: 'Detune' },
        { from: 'dd-osc1', output: 'Out', to: 'dd-mix', input: 'In' },
        { from: 'dd-osc2', output: 'Out', to: 'dd-mix', input: 'In' },
        { from: 'dd-sub', output: 'Out', to: 'dd-mix', input: 'In' },
        { from: 'dd-mix', output: 'Out', to: 'dd-filter', input: 'In' },
        { from: 'dd-filter', output: 'Out', to: 'dd-tide', input: 'In' },
        { from: 'dd-tide', output: 'Out', to: 'dd-chorus', input: 'In' },
        { from: 'dd-chorus', output: 'Out', to: 'dd-reverb', input: 'In' },
        { from: 'dd-reverb', output: 'Out', to: 'dd-render', input: 'In' },
      ],
    ),

  /**
   * Hollow Bloom: saw pair + a rounded-square third layer; dark lowpass;
   * soft-bloom envelope; AutoWah as the envelope→cutoff "wah" (follower ≈
   * env, res ~55%); light drive; deep
   * chorus; slow Vibrato = the LFO-on-fine-tune tape wow; 1/8-at-85-BPM
   * ping-pong (0.353 s); a LOT of reverb.
   */
  hollowBloom: () =>
    buildState(
      [
        { id: 'hb-pitch', type: 'keyboardPitch', x: 40, y: 340 },
        {
          id: 'hb-osc1',
          type: 'oscillator',
          x: 480,
          y: 40,
          values: { Shape: 'sawtooth', Detune: 6, Level: 0.45 },
        },
        {
          id: 'hb-osc2',
          type: 'oscillator',
          x: 480,
          y: 480,
          values: { Shape: 'sawtooth', Detune: -6, Level: 0.45 },
        },
        {
          id: 'hb-osc3',
          type: 'drawnOsc',
          x: 480,
          y: 920,
          values: { Waveform: roundedSquareWave, Level: 0.4 },
        },
        { id: 'hb-mix', type: 'mix', x: 1020, y: 460 },
        {
          id: 'hb-filter',
          type: 'filter',
          x: 1440,
          y: 460,
          values: { Type: 'lowpass', Freq: 2200, Q: 1.2 },
        },
        {
          id: 'hb-adsr',
          type: 'adsr',
          x: 1880,
          y: 460,
          values: {
            'Attack s': 0.12,
            'Decay s': 0.25,
            Sustain: 0.7,
            'Release s': 0.5,
          },
        },
        {
          id: 'hb-wah',
          type: 'autoWah',
          x: 2320,
          y: 460,
          values: { 'Base Hz': 110, Octaves: 4.5, 'Sensitivity dB': 0, Wet: 1 },
        },
        {
          id: 'hb-sat',
          type: 'saturator',
          x: 2760,
          y: 460,
          values: { Drive: 1.3, Trim: 0.85, Wet: 0.3 },
        },
        {
          id: 'hb-chorus',
          type: 'chorus',
          x: 3200,
          y: 460,
          values: { 'Rate Hz': 0.5, 'Delay ms': 5, Depth: 0.9, Wet: 0.6 },
        },
        {
          id: 'hb-wow',
          type: 'vibrato',
          x: 3640,
          y: 460,
          values: { 'Rate Hz': 0.6, Depth: 0.04, Wet: 1 },
        },
        {
          id: 'hb-delay',
          type: 'pingPongDelay',
          x: 4080,
          y: 460,
          values: { 'Time s': 0.353, Feedback: 0.35, Wet: 0.3 },
        },
        {
          id: 'hb-reverb',
          type: 'reverb',
          x: 4520,
          y: 460,
          values: { 'Decay s': 6, 'PreDelay s': 0.02, Wet: 0.45 },
        },
        { id: 'hb-render', type: 'render', x: 4960, y: 480 },
      ],
      [
        { from: 'hb-pitch', output: 'Hz', to: 'hb-osc1', input: 'Frequency' },
        { from: 'hb-pitch', output: 'Hz', to: 'hb-osc2', input: 'Frequency' },
        { from: 'hb-pitch', output: 'Hz', to: 'hb-osc3', input: 'Frequency' },
        { from: 'hb-osc1', output: 'Out', to: 'hb-mix', input: 'In' },
        { from: 'hb-osc2', output: 'Out', to: 'hb-mix', input: 'In' },
        { from: 'hb-osc3', output: 'Out', to: 'hb-mix', input: 'In' },
        { from: 'hb-mix', output: 'Out', to: 'hb-filter', input: 'In' },
        { from: 'hb-filter', output: 'Out', to: 'hb-adsr', input: 'In' },
        { from: 'hb-adsr', output: 'Out', to: 'hb-wah', input: 'In' },
        { from: 'hb-wah', output: 'Out', to: 'hb-sat', input: 'In' },
        { from: 'hb-sat', output: 'Out', to: 'hb-chorus', input: 'In' },
        { from: 'hb-chorus', output: 'Out', to: 'hb-wow', input: 'In' },
        { from: 'hb-wow', output: 'Out', to: 'hb-delay', input: 'In' },
        { from: 'hb-delay', output: 'Out', to: 'hb-reverb', input: 'In' },
        { from: 'hb-reverb', output: 'Out', to: 'hb-render', input: 'In' },
      ],
    ),

  /**
   * SOLINA-STYLE STRINGS: saw pair + narrow-pulse layer (the Solina's
   * divider wave leans concave/pulse), slow attack + full sustain + long
   * release, and THE trick — TWO choruses stacked in series (the
   * triple-delay-line ensemble), a whisper of phaser (the classic
   * ensemble-plus-phaser pairing), airy EQ, hall reverb. No delay —
   * strings don't echo.
   */
  /**
   * SOLINA ENSEMBLE — a POLYPHONIC string machine (hold a chord).
   *
   * What actually makes an ARP Solina sound like a Solina, in order:
   *
   * 1. It is POLYPHONIC. Every key on the divider board sounds at once —
   *    that is why it can hold a whole string chord. The older `strings`
   *    demo was a mono patch through the keyboard bus, which is the one
   *    thing a string machine never is. This builds a voice PER KEY off
   *    All Keys, so a held chord really is sixteen oscillators.
   * 2. The wave is a SAWTOOTH straight off the divide-down chain, with no
   *    filter envelope — a Solina has no VCF at all. Two saws a few cents
   *    apart per voice stand in for the divider's paired outputs.
   * 3. THE ENSEMBLE. A three-phase BBD chorus is the whole identity of the
   *    instrument. Two chorus stages at DIFFERENT rates (a slow ~0.5 Hz
   *    swell and a faster ~5 Hz shimmer) approximate the three-phase
   *    modulation, and a slow phaser adds the last of the smear.
   * 4. A slow attack and long release — bowing, not plucking.
   */
  solinaEnsemble: () => {
    const nodes: NodeSpec[] = [
      { id: 'sol-keys', type: 'allKeys', x: -1500, y: 800 },
      { id: 'sol-mix', type: 'mix', x: -60, y: 800 },
      // No VCF envelope — a Solina has no filter at all; this is a fixed
      // tone-shaping lowpass, kept gentle.
      {
        id: 'sol-tone',
        type: 'filter',
        x: 220,
        y: 800,
        // MEASURED off the reference: it is full to ~1.6 kHz then falls away
        // (-7.7 dB by 1.6-3.2 k, -13.7 by 3.2-6.4 k, -21.8 above). 4.2 kHz
        // was far too bright and read as buzzy rather than lush.
        values: { Type: 'lowpass', Freq: 1900, Q: 0.6 },
      },
      // The ensemble: two stages at different rates.
      {
        id: 'sol-ens1',
        type: 'chorus',
        x: 500,
        y: 760,
        // The reference's ensemble modulation is SLOW — measured peaks at
        // 0.2, 0.4, 0.6 and 1.0 Hz, no fast component. Two stages at
        // different slow rates stand in for the 3-phase BBD.
        values: { 'Rate Hz': 0.36, 'Delay ms': 14, Depth: 0.95, Wet: 0.9 },
      },
      {
        id: 'sol-ens2',
        type: 'chorus',
        x: 780,
        y: 760,
        values: { 'Rate Hz': 0.83, 'Delay ms': 9, Depth: 0.8, Wet: 0.75 },
      },
      {
        id: 'sol-phase',
        type: 'phaser',
        x: 1060,
        y: 760,
        values: { 'Rate Hz': 0.18, Octaves: 2, Wet: 0.35 },
      },
      {
        id: 'sol-air',
        type: 'eq3',
        x: 1340,
        y: 760,
        // The reference is STRONGEST just below the root (100-200 Hz is
        // +1.4 dB on the 200-400 band), so do not thin the low end.
        values: { 'Low dB': 1, 'Mid dB': 0, 'High dB': -2 },
      },
      {
        id: 'sol-hall',
        type: 'reverb',
        x: 1620,
        y: 760,
        values: { 'Decay s': 3.4, 'PreDelay s': 0.02, Wet: 0.38 },
      },
      { id: 'sol-render', type: 'render', x: 1900, y: 780, values: { 'Level dB': 8 } },
    ];
    const edges: EdgeSpec[] = [
      { from: 'sol-mix', output: 'Out', to: 'sol-tone', input: 'In' },
      { from: 'sol-tone', output: 'Out', to: 'sol-ens1', input: 'In' },
      { from: 'sol-ens1', output: 'Out', to: 'sol-ens2', input: 'In' },
      { from: 'sol-ens2', output: 'Out', to: 'sol-phase', input: 'In' },
      { from: 'sol-phase', output: 'Out', to: 'sol-air', input: 'In' },
      { from: 'sol-air', output: 'Out', to: 'sol-hall', input: 'In' },
      { from: 'sol-hall', output: 'Out', to: 'sol-render', input: 'In' },
    ];
    KEY_ORDER.forEach((key, index) => {
      const label = keyLabel(key);
      const column = index % 2 === 0 ? -1150 : -900;
      const row = Math.floor(index / 2) * 200;
      const a = `sol-a${index}`;
      const b = `sol-b${index}`;
      const env = `sol-env${index}`;
      // Paired saws a few cents apart: the divider board's two outputs.
      nodes.push(
        {
          id: a,
          type: 'oscillator',
          x: column,
          y: row,
          values: { Shape: 'sawtooth', Detune: 0, Level: 0.07 },
        },
        {
          id: b,
          type: 'oscillator',
          x: column,
          y: row + 90,
          // 4' register an octave up, as the Solina's footage switches —
          // NOT a detuned twin: a divide-down organ is phase-locked and gets
          // ALL of its movement from the ensemble, not from beating.
          values: { Shape: 'sawtooth', Detune: 1200, Level: 0.035 },
        },
        // PRE-EXISTING BUG, found 2026-09-12 by the new maxConnections gate:
        // both saws were wired straight into the envelope, whose `In` is
        // `maxConnections: 1`. `readAudioChain` returns ONE chain, so the 4'
        // rank was silently discarded and this string machine had been playing
        // on half its oscillators since the ranks were split (2026-09-07) —
        // including through the reference-tuning pass that introduced them.
        { id: `sol-sum${index}`, type: 'mix', x: column + 100, y: row + 40 },
        {
          id: env,
          type: 'adsr',
          x: column + 190,
          y: row + 40,
          values: {
            Trigger: 'high',
            'Attack s': 0.16,
            'Decay s': 0.2,
            Sustain: 0.9,
            'Release s': 0.85,
          },
        },
      );
      edges.push(
        { from: 'sol-keys', output: `${label} Hz`, to: a, input: 'Frequency' },
        { from: 'sol-keys', output: `${label} Hz`, to: b, input: 'Frequency' },
        { from: a, output: 'Out', to: `sol-sum${index}`, input: 'In' },
        { from: b, output: 'Out', to: `sol-sum${index}`, input: 'In' },
        { from: `sol-sum${index}`, output: 'Out', to: env, input: 'In' },
        { from: 'sol-keys', output: `${label} Gate`, to: env, input: 'Gate' },
        { from: env, output: 'Out', to: 'sol-mix', input: 'In' },
      );
    });
    return buildState(nodes, edges);
  },

  strings: () =>
    buildState(
      [
        { id: 'st-pitch', type: 'keyboardPitch', x: 40, y: 340 },
        {
          id: 'st-osc1',
          type: 'oscillator',
          x: 480,
          y: 40,
          values: { Shape: 'sawtooth', Detune: 5, Level: 0.4 },
        },
        {
          id: 'st-osc2',
          type: 'oscillator',
          x: 480,
          y: 480,
          values: { Shape: 'sawtooth', Detune: -5, Level: 0.4 },
        },
        {
          id: 'st-osc3',
          type: 'drawnOsc',
          x: 480,
          y: 920,
          values: { Waveform: narrowPulse(0.25), Level: 0.35 },
        },
        { id: 'st-mix', type: 'mix', x: 1020, y: 460 },
        {
          id: 'st-filter',
          type: 'filter',
          x: 1440,
          y: 460,
          values: { Type: 'lowpass', Freq: 3500, Q: 0.5 },
        },
        {
          id: 'st-adsr',
          type: 'adsr',
          x: 1880,
          y: 460,
          values: {
            'Attack s': 0.4,
            'Decay s': 0.3,
            Sustain: 0.85,
            'Release s': 0.9,
          },
        },
        {
          id: 'st-chorusA',
          type: 'chorus',
          x: 2320,
          y: 460,
          values: { 'Rate Hz': 0.6, 'Delay ms': 6, Depth: 1, Wet: 0.7 },
        },
        {
          id: 'st-chorusB',
          type: 'chorus',
          x: 2760,
          y: 460,
          values: { 'Rate Hz': 1.1, 'Delay ms': 8, Depth: 0.8, Wet: 0.6 },
        },
        {
          id: 'st-phaser',
          type: 'phaser',
          x: 3200,
          y: 460,
          values: { 'Rate Hz': 0.3, Octaves: 2, 'Base Hz': 400, Wet: 0.3 },
        },
        {
          id: 'st-eq',
          type: 'eq3',
          x: 3640,
          y: 460,
          values: { 'Low dB': -1, 'Mid dB': 0, 'High dB': 1.5 },
        },
        {
          id: 'st-reverb',
          type: 'reverb',
          x: 4080,
          y: 460,
          values: { 'Decay s': 3.2, 'PreDelay s': 0.02, Wet: 0.35 },
        },
        { id: 'st-render', type: 'render', x: 4520, y: 480 },
      ],
      [
        { from: 'st-pitch', output: 'Hz', to: 'st-osc1', input: 'Frequency' },
        { from: 'st-pitch', output: 'Hz', to: 'st-osc2', input: 'Frequency' },
        { from: 'st-pitch', output: 'Hz', to: 'st-osc3', input: 'Frequency' },
        { from: 'st-osc1', output: 'Out', to: 'st-mix', input: 'In' },
        { from: 'st-osc2', output: 'Out', to: 'st-mix', input: 'In' },
        { from: 'st-osc3', output: 'Out', to: 'st-mix', input: 'In' },
        { from: 'st-mix', output: 'Out', to: 'st-filter', input: 'In' },
        { from: 'st-filter', output: 'Out', to: 'st-adsr', input: 'In' },
        { from: 'st-adsr', output: 'Out', to: 'st-chorusA', input: 'In' },
        { from: 'st-chorusA', output: 'Out', to: 'st-chorusB', input: 'In' },
        { from: 'st-chorusB', output: 'Out', to: 'st-phaser', input: 'In' },
        { from: 'st-phaser', output: 'Out', to: 'st-eq', input: 'In' },
        { from: 'st-eq', output: 'Out', to: 'st-reverb', input: 'In' },
        { from: 'st-reverb', output: 'Out', to: 'st-render', input: 'In' },
      ],
    ),

  /**
   * FLUTE: the tone sits between sine and triangle —
   * triangle carries it; a PINK-noise breath layer through its own bandpass
   * (~2.5 kHz formant) gated by the same envelope; gentle 5 Hz vibrato;
   * soft attack; small chamber. Purity: no chorus, no drive.
   */
  flute: () =>
    buildState(
      [
        { id: 'fl-pitch', type: 'keyboardPitch', x: 40, y: 300 },
        {
          id: 'fl-osc',
          type: 'drawnOsc',
          x: 480,
          y: 120,
          values: { Waveform: triangleWave, Level: 0.8 },
        },
        {
          id: 'fl-noise',
          type: 'noise',
          x: 480,
          y: 620,
          values: { Type: 'pink', Level: 0.07 },
        },
        {
          id: 'fl-breath',
          type: 'filter',
          x: 940,
          y: 620,
          values: { Type: 'bandpass', Freq: 2500, Q: 1.5 },
        },
        { id: 'fl-mix', type: 'mix', x: 1400, y: 320 },
        {
          id: 'fl-filter',
          type: 'filter',
          x: 1820,
          y: 320,
          values: { Type: 'lowpass', Freq: 2800, Q: 0.6 },
        },
        {
          id: 'fl-adsr',
          type: 'adsr',
          x: 2280,
          y: 320,
          values: {
            'Attack s': 0.09,
            'Decay s': 0.15,
            Sustain: 0.75,
            'Release s': 0.25,
          },
        },
        {
          id: 'fl-vibrato',
          type: 'vibrato',
          x: 2740,
          y: 320,
          values: { 'Rate Hz': 5, Depth: 0.01, Wet: 1 },
        },
        {
          id: 'fl-reverb',
          type: 'reverb',
          x: 3180,
          y: 320,
          values: { 'Decay s': 1.8, 'PreDelay s': 0.01, Wet: 0.25 },
        },
        { id: 'fl-render', type: 'render', x: 3620, y: 340 },
      ],
      [
        { from: 'fl-pitch', output: 'Hz', to: 'fl-osc', input: 'Frequency' },
        { from: 'fl-osc', output: 'Out', to: 'fl-mix', input: 'In' },
        { from: 'fl-noise', output: 'Out', to: 'fl-breath', input: 'In' },
        { from: 'fl-breath', output: 'Out', to: 'fl-mix', input: 'In' },
        { from: 'fl-mix', output: 'Out', to: 'fl-filter', input: 'In' },
        { from: 'fl-filter', output: 'Out', to: 'fl-adsr', input: 'In' },
        { from: 'fl-adsr', output: 'Out', to: 'fl-vibrato', input: 'In' },
        { from: 'fl-vibrato', output: 'Out', to: 'fl-reverb', input: 'In' },
        { from: 'fl-reverb', output: 'Out', to: 'fl-render', input: 'In' },
      ],
    ),

  /**
   * DARK SYNTHWAVE (darksynth): wider-detuned saws + a square layer, a LOW
   * slow filter growl (300–900 Hz, Q 3), punchy envelope, heavy saturation
   * into BitCrusher grit, mid-scooped EQ, tight slap delay, short dark
   * reverb. Play LOW (tap `,` twice).
   */
  darkSynthwave: () =>
    buildState(
      [
        { id: 'dk-pitch', type: 'keyboardPitch', x: 40, y: 340 },
        {
          id: 'dk-osc1',
          type: 'oscillator',
          x: 480,
          y: 40,
          values: { Shape: 'sawtooth', Detune: 15, Level: 0.45 },
        },
        {
          id: 'dk-osc2',
          type: 'oscillator',
          x: 480,
          y: 480,
          values: { Shape: 'sawtooth', Detune: -15, Level: 0.45 },
        },
        {
          id: 'dk-osc3',
          type: 'oscillator',
          x: 480,
          y: 920,
          values: { Shape: 'square', Detune: 0, Level: 0.3 },
        },
        { id: 'dk-mix', type: 'mix', x: 1020, y: 460 },
        {
          id: 'dk-pulser',
          type: 'pulser',
          x: 1020,
          y: 860,
          values: { Shape: 'sine', 'Rate Hz': 0.1, Amplitude: 300, Offset: 600 },
        },
        {
          id: 'dk-filter',
          type: 'filter',
          x: 1440,
          y: 460,
          values: { Type: 'lowpass', Q: 3 },
        },
        {
          id: 'dk-adsr',
          type: 'adsr',
          x: 1900,
          y: 460,
          values: {
            'Attack s': 0.005,
            'Decay s': 0.12,
            Sustain: 0.5,
            'Release s': 0.25,
          },
        },
        {
          id: 'dk-sat',
          type: 'saturator',
          x: 2360,
          y: 460,
          values: { Drive: 3, Trim: 0.7, Wet: 0.6 },
        },
        {
          id: 'dk-crush',
          type: 'bitCrusher',
          x: 2800,
          y: 460,
          values: { Bits: 6, Wet: 0.25 },
        },
        {
          id: 'dk-eq',
          type: 'eq3',
          x: 3240,
          y: 460,
          values: { 'Low dB': 2.5, 'Mid dB': -2, 'High dB': 1 },
        },
        {
          // VHS flutter — subtler + slightly faster than the lead's wow.
          id: 'dk-wow',
          type: 'vibrato',
          x: 3680,
          y: 60,
          values: { 'Rate Hz': 0.55, Depth: 0.02, Wet: 1 },
        },
        {
          id: 'dk-delay',
          type: 'feedbackDelay',
          x: 3680,
          y: 460,
          values: { 'Time s': 0.18, Feedback: 0.3, Wet: 0.22 },
        },
        {
          id: 'dk-reverb',
          type: 'reverb',
          x: 4120,
          y: 460,
          values: { 'Decay s': 1.6, 'PreDelay s': 0.02, Wet: 0.22 },
        },
        { id: 'dk-render', type: 'render', x: 4560, y: 480 },
      ],
      [
        { from: 'dk-pitch', output: 'Hz', to: 'dk-osc1', input: 'Frequency' },
        { from: 'dk-pitch', output: 'Hz', to: 'dk-osc2', input: 'Frequency' },
        { from: 'dk-pitch', output: 'Hz', to: 'dk-osc3', input: 'Frequency' },
        { from: 'dk-osc1', output: 'Out', to: 'dk-mix', input: 'In' },
        { from: 'dk-osc2', output: 'Out', to: 'dk-mix', input: 'In' },
        { from: 'dk-osc3', output: 'Out', to: 'dk-mix', input: 'In' },
        { from: 'dk-mix', output: 'Out', to: 'dk-filter', input: 'In' },
        { from: 'dk-pulser', output: 'Out', to: 'dk-filter', input: 'Freq' },
        { from: 'dk-filter', output: 'Out', to: 'dk-adsr', input: 'In' },
        { from: 'dk-adsr', output: 'Out', to: 'dk-sat', input: 'In' },
        { from: 'dk-sat', output: 'Out', to: 'dk-crush', input: 'In' },
        { from: 'dk-crush', output: 'Out', to: 'dk-eq', input: 'In' },
        { from: 'dk-eq', output: 'Out', to: 'dk-wow', input: 'In' },
        { from: 'dk-wow', output: 'Out', to: 'dk-delay', input: 'In' },
        { from: 'dk-delay', output: 'Out', to: 'dk-reverb', input: 'In' },
        { from: 'dk-reverb', output: 'Out', to: 'dk-render', input: 'In' },
      ],
    ),

  /**
   * HARPSICHORD: the sound is 90% envelope — instant pluck attack,
   * ~1.2 s decay to SUSTAIN ZERO (a harpsichord fades while held), fast
   * damper release. Bright tight-detuned saw pair, a static lowpass for
   * quill sheen, a whisper of saturation for pluck bite, small dry room.
   * No modulation anywhere — period-correct stillness.
   */
  harpsichord: () =>
    buildState(
      [
        { id: 'hc-pitch', type: 'keyboardPitch', x: 40, y: 300 },
        {
          // Harpsichord = PULSE-WIDTH territory, not
          // saw — a ~15% duty pulse is the plucked-near-the-bridge quill.
          id: 'hc-osc1',
          type: 'drawnOsc',
          x: 480,
          y: 80,
          values: { Waveform: narrowPulse(0.15), Level: 0.55 },
        },
        {
          id: 'hc-osc2',
          type: 'oscillator',
          x: 480,
          y: 520,
          values: { Shape: 'sawtooth', Detune: -3, Level: 0.35 },
        },
        { id: 'hc-mix', type: 'mix', x: 1000, y: 300 },
        {
          id: 'hc-filter',
          type: 'filter',
          x: 1420,
          y: 300,
          values: { Type: 'lowpass', Freq: 6500, Q: 0.7 },
        },
        {
          id: 'hc-adsr',
          type: 'adsr',
          x: 1880,
          y: 300,
          values: {
            'Attack s': 0.002,
            'Decay s': 1.2,
            Sustain: 0,
            'Release s': 0.08,
          },
        },
        {
          id: 'hc-sat',
          type: 'saturator',
          x: 2340,
          y: 300,
          values: { Drive: 1.2, Trim: 0.85, Wet: 0.15 },
        },
        {
          id: 'hc-reverb',
          type: 'reverb',
          x: 2780,
          y: 300,
          values: { 'Decay s': 1.1, 'PreDelay s': 0.01, Wet: 0.18 },
        },
        { id: 'hc-render', type: 'render', x: 3220, y: 320 },
      ],
      [
        { from: 'hc-pitch', output: 'Hz', to: 'hc-osc1', input: 'Frequency' },
        { from: 'hc-pitch', output: 'Hz', to: 'hc-osc2', input: 'Frequency' },
        { from: 'hc-osc1', output: 'Out', to: 'hc-mix', input: 'In' },
        { from: 'hc-osc2', output: 'Out', to: 'hc-mix', input: 'In' },
        { from: 'hc-mix', output: 'Out', to: 'hc-filter', input: 'In' },
        { from: 'hc-filter', output: 'Out', to: 'hc-adsr', input: 'In' },
        { from: 'hc-adsr', output: 'Out', to: 'hc-sat', input: 'In' },
        { from: 'hc-sat', output: 'Out', to: 'hc-reverb', input: 'In' },
        { from: 'hc-reverb', output: 'Out', to: 'hc-render', input: 'In' },
      ],
    ),

  /** Pulser(2 Hz, ±0.5 around 0.5) → Gain.Gain — masterDb wobbles at 2 Hz. */
  pulserGain: () =>
    buildState(
      [
        { id: 'p-osc', type: 'drawnOsc', x: 60, y: 120 },
        {
          id: 'p-pulser',
          type: 'pulser',
          x: 60,
          y: 620,
          values: { 'Rate Hz': 2, Amplitude: 0.5, Offset: 0.5 },
        },
        { id: 'p-gain', type: 'gain', x: 620, y: 220 },
        { id: 'p-render', type: 'render', x: 1100, y: 240 },
      ],
      [
        { from: 'p-osc', output: 'Out', to: 'p-gain', input: 'In' },
        { from: 'p-pulser', output: 'Out', to: 'p-gain', input: 'Gain' },
        { from: 'p-gain', output: 'Out', to: 'p-render', input: 'In' },
      ],
    ),

  /** Pulser(2 Hz, 0..1) → Render 'Level dB': the
   *  convert-true dB replace-base must TROUGH near silence (−Inf base),
   *  not ride on top of unity. */
  pulserLevelDb: () =>
    buildState(
      [
        { id: 'l-osc', type: 'drawnOsc', x: 60, y: 120 },
        {
          id: 'l-pulser',
          type: 'pulser',
          x: 60,
          y: 620,
          values: { 'Rate Hz': 2, Amplitude: 0.5, Offset: 0.5 },
        },
        { id: 'l-render', type: 'render', x: 620, y: 220 },
      ],
      [
        { from: 'l-osc', output: 'Out', to: 'l-render', input: 'In' },
        { from: 'l-pulser', output: 'Out', to: 'l-render', input: 'Level dB' },
      ],
    ),

  /** Pulser(4..12) → BitCrusher 'Bits': the min-bounded
   *  Param must accept modulation without assertRange throwing. */
  bitsMod: () =>
    buildState(
      [
        { id: 'b-osc', type: 'drawnOsc', x: 60, y: 120 },
        {
          id: 'b-pulser',
          type: 'pulser',
          x: 60,
          y: 620,
          values: { 'Rate Hz': 1, Amplitude: 4, Offset: 8 },
        },
        { id: 'b-crusher', type: 'bitCrusher', x: 560, y: 180 },
        { id: 'b-render', type: 'render', x: 1040, y: 240 },
      ],
      [
        { from: 'b-osc', output: 'Out', to: 'b-crusher', input: 'In' },
        { from: 'b-pulser', output: 'Out', to: 'b-crusher', input: 'Bits' },
        { from: 'b-crusher', output: 'Out', to: 'b-render', input: 'In' },
      ],
    ),

  /** Player('' URL, throws) beside a WORKING DrawnOsc→Render branch —
   *  the errored run must end SILENT (the app
   *  disposes the build when the record carries an errored step). */
  errorRun: () =>
    buildState(
      [
        { id: 'x-osc', type: 'drawnOsc', x: 60, y: 120 },
        { id: 'x-render', type: 'render', x: 620, y: 220 },
        { id: 'x-player', type: 'player', x: 60, y: 640 },
        { id: 'x-render2', type: 'render', x: 620, y: 700 },
      ],
      [
        { from: 'x-osc', output: 'Out', to: 'x-render', input: 'In' },
        { from: 'x-player', output: 'Out', to: 'x-render2', input: 'In' },
      ],
    ),

  /** DrawnOsc → ADSR → Render — the keyboard gate probe. */
  gateAdsr: () =>
    buildState(
      [
        { id: 'g-osc', type: 'drawnOsc', x: 60, y: 120 },
        { id: 'g-adsr', type: 'adsr', x: 620, y: 200 },
        { id: 'g-render', type: 'render', x: 1100, y: 240 },
      ],
      [
        { from: 'g-osc', output: 'Out', to: 'g-adsr', input: 'In' },
        { from: 'g-adsr', output: 'Out', to: 'g-render', input: 'In' },
      ],
    ),

  /** Square wave through a lowpass: 50 Hz sits 2+ octaves under the 220 Hz
   *  fundamental (−12 dB/oct biquad ⇒ deep attenuation) vs wide-open 8 kHz.
   *  (200 Hz was RMS-insensitive: the fundamental carries ~90% of a
   *  square's energy.) */
  filterLow: () => filterProbe(50),
  filterHigh: () => filterProbe(8000),

  /** "Curve Orchestra" — the timeline-composition flagship demo: a 16 s /
   *  120 BPM / 8-bar loop in A minor where SIX named curves score four
   *  voices (a tension-arc filter pad carrying the bed; a trance-gate
   *  16th pulse with ~12 ms anti-click attacks; a curve-SYNTHESIZED kick
   *  — instant-attack amp decay + 130→52 Hz pitch drop, with pitched
   *  ACCENT booms on beats 5/9; a Berlin-school stepped pentatonic lead
   *  through a dotted-8th ping-pong echo with a final portamento glide).
   *  Load via the demo picker (which also installs the timeline
   *  document), Run, then ▶ in the dock. */
  curveOrchestra: () => buildCurveOrchestraGraph(),

  /** "Piano & Flute Orchestra" — a pastoral chamber duet scored entirely
   *  by timeline curves: classical Alberti bass in the piano left hand
   *  (lowest-highest-middle-highest broken chords), call-and-response
   *  right-hand answers in the flute's breath rests, and a
   *  middle-register flute melody with phrase-level breath swells (messa
   *  di voce), delayed vibrato on held notes and hard stepped pitches
   *  (keyed winds don't glide). Load via the demo picker, Run, then ▶ in
   *  the dock. */
  pianoFluteOrchestra: () => buildPianoFluteOrchestraGraph(),
  starryNight: () => buildStarryNightGraph(),

  /** "Bell Club" — club-pop score: a music-box twinkle loop through a
   *  bit crusher (chiptune lo-fi), a five-kick club skeleton with a
   *  squeaky bed, an octave-bounce section, one hard dead-stop and one
   *  soft pause where the melody hangs on alone. */
  bellClub: () => buildBellClubGraph(),

  /** "Neon Drop" — EDM score in B minor: four-on-floor + saw riff, a
   *  snare-roll build with a filter riser, then a drop with a distorted
   *  GLIDING 808 and robotic formant vocal chops. */
  neonDrop: () => buildNeonDropGraph(),

  /** "Filter Rush" — 170 BPM score whose whole master bus breathes
   *  through a sweeping lowpass + highpass + pan + amplitude wobble
   *  over a clean deep club groove: EQ play as the lead instrument. */
  filterRush: () => buildFilterRushGraph(),

  /** Timeline curve → bandpass Freq — the FFT peak must track the curve
   *  with NO re-Run while scrubbing/playing.
   *  The probe builds only the GRAPH; the timeline document arrives via
   *  `__timeline.setDocument(...)` (curve id `crv_cutoff`). */
  timelineFilter: () =>
    buildState(
      [
        { id: 't-noise', type: 'noise', x: 60, y: 120 },
        {
          id: 't-curve',
          type: 'timelineCurve',
          x: 60,
          y: 420,
          values: { Curve: makeTimelineCurveRef('crv_cutoff') },
        },
        {
          id: 't-filter',
          type: 'filter',
          x: 620,
          y: 200,
          // Sharp bandpass on white noise → a clean FFT peak at Freq.
          values: { Type: 'bandpass', Q: 8 },
        },
        { id: 't-render', type: 'render', x: 1100, y: 240 },
      ],
      [
        { from: 't-noise', output: 'Out', to: 't-filter', input: 'In' },
        { from: 't-curve', output: 'Signal', to: 't-filter', input: 'Freq' },
        { from: 't-filter', output: 'Out', to: 't-render', input: 'In' },
      ],
    ),

  /** Pulser at audio rate (220 Hz) → ToAudio → Render — adapters audible. */
  adapters: () =>
    buildState(
      [
        {
          id: 'a-pulser',
          type: 'pulser',
          x: 60,
          y: 160,
          values: { 'Rate Hz': 220, Amplitude: 0.8, Offset: 0 },
        },
        { id: 'a-toAudio', type: 'toAudio', x: 560, y: 200 },
        { id: 'a-render', type: 'render', x: 1020, y: 220 },
      ],
      [
        { from: 'a-pulser', output: 'Out', to: 'a-toAudio', input: 'In' },
        { from: 'a-toAudio', output: 'Out', to: 'a-render', input: 'In' },
      ],
    ),

  /** Calibration probes: five KNOWN-parameter chains an offline replica
   *  must match within 1 dB per shared band — captured live via the
   *  render tap's audiogram FFT. Steady-state by design. */
  gcalOsc: () =>
    buildState(
      [
        {
          id: 'gc-osc',
          type: 'drawnOsc',
          x: 60,
          y: 140,
          values: {
            Waveform: harmonicWave([1, 0.5, 0.25]),
            Frequency: 220,
            Level: 0.8,
          },
        },
        { id: 'gc-render', type: 'render', x: 560, y: 160 },
      ],
      [{ from: 'gc-osc', output: 'Out', to: 'gc-render', input: 'In' }],
    ),
  gcalBassOsc: () =>
    buildState(
      [
        {
          id: 'gc-osc',
          type: 'drawnOsc',
          x: 60,
          y: 140,
          values: {
            Waveform: harmonicWave([1, 0.49, 0.11, 0.07, 0.02]),
            Frequency: 66.4,
            Level: 0.8,
          },
        },
        { id: 'gc-render', type: 'render', x: 560, y: 160 },
      ],
      [{ from: 'gc-osc', output: 'Out', to: 'gc-render', input: 'In' }],
    ),
  gcalNoiseBand: () =>
    buildState(
      [
        {
          id: 'gc-noise',
          type: 'noise',
          x: 60,
          y: 140,
          values: { Type: 'white', Level: 0.8 },
        },
        {
          id: 'gc-filter',
          type: 'filter',
          x: 520,
          y: 160,
          values: { Type: 'bandpass', Freq: 2000, Q: 1 },
        },
        { id: 'gc-render', type: 'render', x: 980, y: 180 },
      ],
      [
        { from: 'gc-noise', output: 'Out', to: 'gc-filter', input: 'In' },
        { from: 'gc-filter', output: 'Out', to: 'gc-render', input: 'In' },
      ],
    ),
  gcalHatNoise: () =>
    buildState(
      [
        {
          id: 'gc-noise',
          type: 'noise',
          x: 60,
          y: 140,
          values: { Type: 'pink', Level: 0.8 },
        },
        {
          id: 'gc-filter',
          type: 'filter',
          x: 520,
          y: 160,
          values: { Type: 'highpass', Freq: 6000, Q: 1 },
        },
        { id: 'gc-render', type: 'render', x: 980, y: 180 },
      ],
      [
        { from: 'gc-noise', output: 'Out', to: 'gc-filter', input: 'In' },
        { from: 'gc-filter', output: 'Out', to: 'gc-render', input: 'In' },
      ],
    ),
  gcalOscFilter: () =>
    buildState(
      [
        {
          id: 'gc-osc',
          type: 'drawnOsc',
          x: 60,
          y: 140,
          values: {
            Waveform: harmonicWave([1, 0.5, 0.33, 0.25, 0.2]),
            Frequency: 220,
            Level: 0.8,
          },
        },
        {
          id: 'gc-filter',
          type: 'filter',
          x: 520,
          y: 160,
          values: { Type: 'lowpass', Freq: 1200, Q: 1 },
        },
        { id: 'gc-render', type: 'render', x: 980, y: 180 },
      ],
      [
        { from: 'gc-osc', output: 'Out', to: 'gc-filter', input: 'In' },
        { from: 'gc-filter', output: 'Out', to: 'gc-render', input: 'In' },
      ],
    ),
  gcalSaturator: () =>
    buildState(
      [
        {
          id: 'gc-osc',
          type: 'drawnOsc',
          x: 60,
          y: 140,
          values: {
            Waveform: harmonicWave([1, 0.5, 0.25]),
            Frequency: 220,
            Level: 0.8,
          },
        },
        {
          id: 'gc-sat',
          type: 'saturator',
          x: 520,
          y: 160,
          values: { Drive: 2, Trim: 0.7, Wet: 0.5 },
        },
        { id: 'gc-render', type: 'render', x: 980, y: 180 },
      ],
      [
        { from: 'gc-osc', output: 'Out', to: 'gc-sat', input: 'In' },
        { from: 'gc-sat', output: 'Out', to: 'gc-render', input: 'In' },
      ],
    ),
  gcalCrossfade: () =>
    buildState(
      [
        {
          id: 'gc-oscA',
          type: 'drawnOsc',
          x: 60,
          y: 60,
          values: {
            Waveform: harmonicWave([1]),
            Frequency: 220,
            Level: 0.8,
          },
        },
        {
          id: 'gc-oscB',
          type: 'drawnOsc',
          x: 60,
          y: 320,
          values: {
            Waveform: harmonicWave([1, 0.5, 0.25]),
            Frequency: 330,
            Level: 0.8,
          },
        },
        {
          id: 'gc-xfade',
          type: 'crossFade',
          x: 520,
          y: 180,
          values: { Fade: 0.25 },
        },
        { id: 'gc-render', type: 'render', x: 980, y: 200 },
      ],
      [
        { from: 'gc-oscA', output: 'Out', to: 'gc-xfade', input: 'A' },
        { from: 'gc-oscB', output: 'Out', to: 'gc-xfade', input: 'B' },
        { from: 'gc-xfade', output: 'Out', to: 'gc-render', input: 'In' },
      ],
    ),

  /** Oscillator with the Shape enum through the effect chain (async Reverb). */
  effectsChain: () =>
    buildState(
      [
        {
          id: 'e-osc',
          type: 'oscillator',
          x: 40,
          y: 140,
          values: { Shape: 'square' },
        },
        { id: 'e-delay', type: 'feedbackDelay', x: 480, y: 180 },
        { id: 'e-reverb', type: 'reverb', x: 940, y: 200 },
        { id: 'e-render', type: 'render', x: 1400, y: 240 },
      ],
      [
        { from: 'e-osc', output: 'Out', to: 'e-delay', input: 'In' },
        { from: 'e-delay', output: 'Out', to: 'e-reverb', input: 'In' },
        { from: 'e-reverb', output: 'Out', to: 'e-render', input: 'In' },
      ],
    ),

  /** Two sources fan into Mix (fan-in — every connection connected). */
  mixFan: () =>
    buildState(
      [
        { id: 'm-osc1', type: 'drawnOsc', x: 40, y: 80 },
        {
          id: 'm-osc2',
          type: 'oscillator',
          x: 40,
          y: 560,
          values: { Shape: 'triangle' },
        },
        { id: 'm-mix', type: 'mix', x: 620, y: 300 },
        { id: 'm-render', type: 'render', x: 1080, y: 320 },
      ],
      [
        { from: 'm-osc1', output: 'Out', to: 'm-mix', input: 'In' },
        { from: 'm-osc2', output: 'Out', to: 'm-mix', input: 'In' },
        { from: 'm-mix', output: 'Out', to: 'm-render', input: 'In' },
      ],
    ),

  /** KeyboardPitch → DrawnOsc.Frequency — live retuning (per-build slave). */
  keyboardPitch: () =>
    buildState(
      [
        { id: 'k-pitch', type: 'keyboardPitch', x: 40, y: 120 },
        { id: 'k-osc', type: 'drawnOsc', x: 460, y: 120 },
        { id: 'k-adsr', type: 'adsr', x: 1020, y: 220 },
        { id: 'k-render', type: 'render', x: 1480, y: 260 },
      ],
      [
        { from: 'k-pitch', output: 'Hz', to: 'k-osc', input: 'Frequency' },
        { from: 'k-osc', output: 'Out', to: 'k-adsr', input: 'In' },
        { from: 'k-adsr', output: 'Out', to: 'k-render', input: 'In' },
      ],
    ),
};

function filterProbe(cutoffHz: number): ProbeState {
  return buildState(
    [
      {
        id: 'f-osc',
        type: 'drawnOsc',
        x: 60,
        y: 120,
        values: { Waveform: squareWave },
      },
      {
        id: 'f-filter',
        type: 'filter',
        x: 620,
        y: 180,
        values: { Freq: cutoffHz },
      },
      { id: 'f-render', type: 'render', x: 1100, y: 240 },
    ],
    [
      { from: 'f-osc', output: 'Out', to: 'f-filter', input: 'In' },
      { from: 'f-filter', output: 'Out', to: 'f-render', input: 'In' },
    ],
  );
}

// ── "Curve Orchestra" — the timeline-composition flagship demo ──────────
//
// 16 s loop = 8 bars of 4/4 at 120 BPM (beat 0.5 s, 16th 0.125 s), A minor.
// Score anchors:
// - Drone bed: low warm root first, fifth above with slow ±cents drift for
//   beating; filters carve one register per layer; automation stays subtle.
// - Trance gate: sustained voice chopped by a 16th-grid pattern; ~12 ms
//   attack avoids clicks, eased release keeps the groove.
// - Kick synthesis: sine, instant-attack amp envelope decaying ~300 ms,
//   pitch envelope 130 → 52 Hz inside 50 ms.
// - Berlin school: short stepped sequence (A-minor pentatonic), repeated
//   once, varied once, one portamento glide home; dotted-8th (0.375 s)
//   ping-pong echo.
// - Form: one slow tension arc (pad cutoff + swell peaking around bar 5–6).

const ORCHESTRA_BEAT_SECONDS = 0.5;
const ORCHESTRA_SIXTEENTH_SECONDS = ORCHESTRA_BEAT_SECONDS / 4;
const ORCHESTRA_LOOP_SECONDS = 16;

function curvePoint(
  t: number,
  v: number,
  leftInterp: SideInterp = 'linear',
  rightInterp: SideInterp = 'linear',
): CurvePoint {
  return { t, v, leftInterp, rightInterp };
}

/** The minimum spacing the timeline schema requires between two points. */
const MIN_POINT_GAP_SECONDS = 0.001;

/**
 * How far before the next hit a clamped tail stops.
 *
 * Deliberately TWICE the schema minimum: clamping to exactly the minimum makes
 * the gap land a fraction under it once the bar-time arithmetic has been
 * through binary floating point (measured: a tail clamped to 9.021556 against
 * a hit at 9.022556 reads as 0.0009999999999998899, which fails the rule).
 * 2 ms before a kick is musically nothing.
 */
const TAIL_CLEARANCE_SECONDS = 2 * MIN_POINT_GAP_SECONDS;

/**
 * Where a percussion decay tail must actually END.
 *
 * A tail written as `hit + tailSeconds` overshoots whenever the next hit lands
 * sooner than that, and the point list then stops being ordered in time. That
 * is not cosmetic — BOTH consumers assume the array is sorted:
 *
 * - `evaluateCurve` binary-searches it (its own comment says "assumes points
 *   strictly increasing in t"), so the node's `Value` output and the preview
 *   read the WRONG segment;
 * - the transport skips the backwards span, then samples the next one through
 *   the same broken search and schedules a ghost tail.
 *
 * Measured on the original Bell Club kick before this clamp: a 300 ms tail
 * against a 226 ms gap made every affected hit decay to silence in 14 ms and
 * then re-open to 37 % amplitude for a further 225 ms.
 */
function percussionTailEnd(
  hitTime: number,
  tailSeconds: number,
  nextHitTime: number | undefined,
): number {
  const naturalEnd = hitTime + tailSeconds;
  if (nextHitTime === undefined) return naturalEnd;
  // Stop short of the next attack, so that attack stays its own point rather
  // than colliding with the tail's last one.
  return Math.min(naturalEnd, nextHitTime - TAIL_CLEARANCE_SECONDS);
}

function orchestraCurve(
  id: string,
  name: string,
  color: string,
  defaultValue: number,
  points: CurvePoint[],
): TimelineCurve {
  return { id, name, color, defaultValue, points };
}

/** Trance-gate lane: ON 16ths per bar at indices 0,3,6,8,11,14 (min gap
 *  0.25 s > the 0.115 s hit shape); 12 ms attack, short hold, eased tail. */
function gateCurvePoints(): CurvePoint[] {
  const onSixteenths = [0, 3, 6, 8, 11, 14];
  const points: CurvePoint[] = [];
  for (let bar = 0; bar < 8; bar += 1) {
    for (const step of onSixteenths) {
      const hit = bar * 2 + step * ORCHESTRA_SIXTEENTH_SECONDS;
      points.push(curvePoint(hit, 0));
      points.push(curvePoint(hit + 0.012, 0.85));
      points.push(curvePoint(hit + 0.09, 0.7));
      points.push(curvePoint(hit + 0.115, 0, 'ease'));
    }
  }
  return points;
}

/** Beats turned into ACCENT booms: one second after each melody-phrase
 *  entry (P1 at t=4, its repeat at t=8), the kick becomes a long PITCHED
 *  tom — amp held near-full then parked at ~0.68 until the next beat,
 *  pitch easing only to ~121 Hz instead of dropping to the 52 Hz sub. */
const KICK_ACCENT_BEATS = new Set([5, 9]);

/** Kick hits: every beat 1 & 3 (each second) PLUS one extra standard hit
 *  halfway between the 3rd and 4th hits, counting from 1 (t=2.5). Shared
 *  by both kick lanes so their points stay aligned and sorted. */
const KICK_HIT_TIMES: number[] = [
  ...Array.from({ length: 16 }, (_, beat) => beat),
  2.5,
].sort((a, b) => a - b);

/** Kick amp: instant attack via a step arrival, 70 ms drop, eased 300 ms
 *  tail; accent beats sustain instead. The wrap jump back to the first
 *  hit IS the downbeat (intentional wrap mismatch). */
function kickAmpPoints(): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (const hit of KICK_HIT_TIMES) {
    points.push(curvePoint(hit, 0.95, 'step'));
    if (KICK_ACCENT_BEATS.has(hit)) {
      points.push(curvePoint(hit + 0.39, 0.89));
      points.push(curvePoint(hit + 0.61, 0.68, 'ease'));
    } else {
      points.push(curvePoint(hit + 0.07, 0.3));
      points.push(curvePoint(hit + 0.3, 0, 'ease'));
    }
  }
  return points;
}

/** Kick pitch: 130 → 52 Hz inside 50 ms, then step-held until the next
 *  hit re-triggers the drop; accent beats ease only to ~121 Hz so the boom
 *  stays tonal. */
function kickPitchPoints(): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (const hit of KICK_HIT_TIMES) {
    points.push(curvePoint(hit, 130, 'step', 'ease'));
    if (KICK_ACCENT_BEATS.has(hit)) {
      points.push(curvePoint(hit + 0.45, 121, 'ease', 'step'));
    } else {
      points.push(curvePoint(hit + 0.05, 52, 'ease', 'step'));
    }
  }
  return points;
}

/** The pad's waveform: a smoothed triangle (±0.87 peaks, rounded
 *  corners). */
const padWave: WaveformValue = {
  kind: 'waveform',
  samples: [-0.8704089893172992,-0.8698109795729458,-0.8680224087265834,-0.8650595041039069,-0.8609488250674145,-0.8557265564412198,-0.8494375632589268,-0.8421342475483418,-0.8338752551555155,-0.8247240851093147,-0.8147476555814797,-0.8040148791605836,-0.7925952961811079,-0.7805578086451932,-0.7679695493811203,-0.7548949121082359,-0.7413947586525268,-0.7275258102812179,-0.7133402215283637,-0.6988853273928181,-0.6842035487080171,-0.6693324359812765,-0.6543048291230777,-0.6391491091651249,-0.6238895181387161,-0.6085465245247079,-0.5931372138263256,-0.5776756865762042,-0.5621734491986883,-0.546639786364253,-0.5310821065915353,-0.5155062557172881,-0.49991679535771594,-0.4843172455644858,-0.4687102925143664,-0.4530979632751249,-0.4374817704988875,-0.421862830360637,-0.4062419572453305,-0.3906197386556858,-0.37499659362436255,-0.3593728176229451,-0.34374861661115136,-0.3281241324990953,-0.3124994619300424,-0.29687466994940015,-0.28124979981900794,-0.2656248799697255,-0.24999992886113392,-0.23437495833311733,-0.21874997588652442,-0.20312498621435812,-0.18749999221599983,-0.171874995659957,-0.1562499976110701,-0.1406249987021351,-0.12499999930423031,-0.10937499963204418,-0.09374999980809795,-0.07812499990135312,-0.062499999950091964,-0.04687499997528807,-0.03124999998831888,-0.01562499999537556,1.3877787807814458e-18,0.01562499999537556,0.03124999998831888,0.04687499997528807,0.062499999950091964,0.07812499990135313,0.09374999980809795,0.1093749996320442,0.1249999993042303,0.14062499870213507,0.15624999761107009,0.171874995659957,0.18749999221599983,0.20312498621435818,0.21874997588652442,0.2343749583331174,0.24999992886113395,0.2656248799697255,0.281249799819008,0.29687466994940015,0.3124994619300424,0.3281241324990953,0.34374861661115136,0.35937281762294504,0.3749965936243625,0.39061973865568567,0.40624195724533047,0.42186283036063693,0.43748177049888737,0.45309796327512475,0.46871029251436636,0.4843172455644857,0.4999167953577158,0.5155062557172881,0.5310821065915353,0.5466397863642531,0.5621734491986883,0.5776756865762042,0.5931372138263254,0.6085465245247079,0.6238895181387158,0.6391491091651249,0.6543048291230776,0.6693324359812765,0.6842035487080169,0.698885327392818,0.7133402215283636,0.7275258102812175,0.7413947586525266,0.7548949121082359,0.7679695493811204,0.7805578086451932,0.792595296181108,0.8040148791605837,0.8147476555814797,0.8247240851093147,0.8338752551555155,0.8421342475483418,0.8494375632589269,0.8557265564412198,0.8609488250674145,0.8650595041039069,0.8680224087265834,0.8698109795729456,0.8704089893172992,0.8698109795729458,0.8680224087265834,0.8650595041039069,0.8609488250674145,0.8557265564412198,0.8494375632589268,0.8421342475483418,0.8338752551555155,0.8247240851093147,0.8147476555814797,0.8040148791605836,0.7925952961811079,0.7805578086451932,0.7679695493811203,0.7548949121082359,0.7413947586525268,0.7275258102812179,0.7133402215283637,0.6988853273928181,0.6842035487080171,0.6693324359812765,0.6543048291230777,0.6391491091651249,0.6238895181387161,0.6085465245247079,0.5931372138263256,0.5776756865762042,0.5621734491986883,0.546639786364253,0.5310821065915353,0.5155062557172881,0.49991679535771594,0.4843172455644858,0.4687102925143664,0.4530979632751249,0.4374817704988875,0.421862830360637,0.4062419572453305,0.3906197386556858,0.37499659362436255,0.3593728176229451,0.34374861661115136,0.3281241324990953,0.3124994619300424,0.29687466994940015,0.28124979981900794,0.2656248799697255,0.24999992886113392,0.23437495833311733,0.21874997588652442,0.20312498621435812,0.18749999221599983,0.171874995659957,0.1562499976110701,0.1406249987021351,0.12499999930423031,0.10937499963204418,0.09374999980809795,0.07812499990135312,0.062499999950091964,0.04687499997528807,0.03124999998831888,0.01562499999537556,-1.3877787807814458e-18,-0.01562499999537556,-0.03124999998831888,-0.04687499997528807,-0.062499999950091964,-0.07812499990135313,-0.09374999980809795,-0.1093749996320442,-0.1249999993042303,-0.14062499870213507,-0.15624999761107009,-0.171874995659957,-0.18749999221599983,-0.20312498621435818,-0.21874997588652442,-0.2343749583331174,-0.24999992886113395,-0.2656248799697255,-0.281249799819008,-0.29687466994940015,-0.3124994619300424,-0.3281241324990953,-0.34374861661115136,-0.35937281762294504,-0.3749965936243625,-0.39061973865568567,-0.40624195724533047,-0.42186283036063693,-0.43748177049888737,-0.45309796327512475,-0.46871029251436636,-0.4843172455644857,-0.4999167953577158,-0.5155062557172881,-0.5310821065915353,-0.5466397863642531,-0.5621734491986883,-0.5776756865762042,-0.5931372138263254,-0.6085465245247079,-0.6238895181387158,-0.6391491091651249,-0.6543048291230776,-0.6693324359812765,-0.6842035487080169,-0.698885327392818,-0.7133402215283636,-0.7275258102812175,-0.7413947586525266,-0.7548949121082359,-0.7679695493811204,-0.7805578086451932,-0.792595296181108,-0.8040148791605837,-0.8147476555814797,-0.8247240851093147,-0.8338752551555155,-0.8421342475483418,-0.8494375632589269,-0.8557265564412198,-0.8609488250674145,-0.8650595041039069,-0.8680224087265834,-0.8698109795729456],
};

const NOTE_A3 = 220;
const NOTE_C4 = 261.63;
const NOTE_D4 = 293.66;
const NOTE_E4 = 329.63;
const NOTE_G4 = 392;
const NOTE_A4 = 440;

/** Berlin-school lead: quarters, step-held like a sequencer. Bars 1–2
 *  idle on the root (level curve keeps it silent), P1 twice (bars 3–6),
 *  variation P2 (bars 7–8), final E4 gliding home to A3 over the last
 *  second — first and last values match, so the loop seam is clean. */
function melodyPoints(): CurvePoint[] {
  const phrase1 = [
    NOTE_A3,
    NOTE_C4,
    NOTE_E4,
    NOTE_D4,
    NOTE_A3,
    NOTE_C4,
    NOTE_G4,
    NOTE_E4,
  ];
  const phrase2 = [
    NOTE_A4,
    NOTE_G4,
    NOTE_E4,
    NOTE_D4,
    NOTE_C4,
    NOTE_D4,
    NOTE_E4,
  ];
  const points: CurvePoint[] = [curvePoint(0, NOTE_A3, 'step', 'step')];
  phrase1.forEach((frequency, index) => {
    points.push(curvePoint(4 + index * 0.5, frequency, 'step', 'step'));
  });
  phrase1.forEach((frequency, index) => {
    points.push(curvePoint(8 + index * 0.5, frequency, 'step', 'step'));
  });
  phrase2.forEach((frequency, index) => {
    points.push(curvePoint(12 + index * 0.5, frequency, 'step', 'step'));
  });
  points[points.length - 1] = curvePoint(15, NOTE_E4, 'step', 'ease');
  points.push(curvePoint(16, NOTE_A3, 'ease', 'step'));
  return points;
}

const curveOrchestraTimeline: TimelineDocument = {
  version: 1,
  durationSec: ORCHESTRA_LOOP_SECONDS,
  loop: true,
  // The softened pad carries the bed on its own.
  curves: [
    orchestraCurve('crv_padCutoff', 'pad cutoff', '#a3e635', 400, [
      curvePoint(0, 250, 'ease', 'ease'),
      curvePoint(9, 1800, 'ease', 'ease'),
      curvePoint(12, 1150, 'ease', 'ease'),
      curvePoint(16, 250, 'ease', 'ease'),
    ]),
    orchestraCurve('crv_gate', 'gate', '#f472b6', 0, gateCurvePoints()),
    orchestraCurve('crv_kickAmp', 'kick amp', '#fb7185', 0, kickAmpPoints()),
    orchestraCurve(
      'crv_kickPitch',
      'kick pitch',
      '#c084fc',
      52,
      kickPitchPoints(),
    ),
    orchestraCurve('crv_melody', 'melody Hz', '#34d399', NOTE_A3, melodyPoints()),
    orchestraCurve('crv_melodyLevel', 'melody level', '#fbbf24', 0, [
      curvePoint(0, 0, 'ease', 'ease'),
      curvePoint(3.9, 0, 'linear', 'linear'),
      curvePoint(4.3, 0.3, 'ease', 'ease'),
      curvePoint(10, 0.34, 'ease', 'ease'),
      curvePoint(14.8, 0.26, 'ease', 'ease'),
      curvePoint(16, 0, 'ease', 'ease'),
    ]),
  ],
};

// ── "Piano & Flute Orchestra" — pastoral chamber duet ────────────────
//
// 24 s loop = 8 bars of 4/4 at 80 BPM (bar 3 s, quarter 0.75 s), G major,
// progression G–Em–C–D | G–C–D–G. Score anchors:
// - Alberti bass: broken-chord LH figure in the order lowest-highest-
//   middle-highest (C-G-E-G for C major), smooth flowing harmonic support
//   under a homophonic melody.
// - Duet roles: flute leads, piano answers — arrangements alternate the
//   melody between the two so both get to lead; the RH answers live in
//   the flute's breath rests.
// - Registers: the flute melody stays in its bright, carrying middle
//   register D5–G6; the low octave is weak and easily masked.
// - Piano voicing: accompaniment sits around middle C — close intervals
//   low down go muddy; keep the accompaniment softer than the melody.
// - Breath: breathe in rests and after the longest note, at phrase
//   boundaries — the amp lane holds hard zeros between phrases.
// - Messa di voce: swells peak PAST the middle and fall away faster than
//   they grew — both phrase arcs do.
// - Vibrato: tied to breath and expression, developed on long tones —
//   the depth lane stays near zero and blooms late on held notes.

/** Equal-tempered pitch from semitones relative to A4 = 440 Hz —
 *  frequencies are COMPUTED, never hand-typed. */
function noteHz(semitonesFromA4: number): number {
  return 440 * 2 ** (semitonesFromA4 / 12);
}

const PF_D3 = noteHz(-19);
const PF_E3 = noteHz(-17);
const PF_FS3 = noteHz(-15);
const PF_G3 = noteHz(-14);
const PF_A3 = noteHz(-12);
const PF_B3 = noteHz(-10);
const PF_C4 = noteHz(-9);
const PF_D4 = noteHz(-7);
const PF_E4 = noteHz(-5);
const PF_FS4 = noteHz(-3);
const PF_G4 = noteHz(-2);
const PF_A4 = noteHz(0);
const PF_B4 = noteHz(2);
const PF_C5 = noteHz(3);
const PF_D5 = noteHz(5);
const PF_E5 = noteHz(7);
const PF_FS5 = noteHz(9);
const PF_G5 = noteHz(10);
const PF_A5 = noteHz(12);
const PF_B5 = noteHz(14);
const PF_C6 = noteHz(15);
const PF_D6 = noteHz(17);
const PF_E6 = noteHz(19);

const PF_BAR_SECONDS = 3;
const PF_QUARTER_SECONDS = 0.75;

/** LH Alberti voicings per bar, in the classical order lowest-highest-
 *  middle-highest; kept around middle C (low close intervals go muddy),
 *  with the final V (bar 7) dropped an octave for cadential weight. */
const pfLeftHandBars: number[][] = [
  [PF_G3, PF_D4, PF_B3, PF_D4], // G
  [PF_E3, PF_B3, PF_G3, PF_B3], // Em
  [PF_C4, PF_G4, PF_E4, PF_G4], // C
  [PF_D4, PF_A4, PF_FS4, PF_A4], // D (V — the RH answer adds the 7th)
  [PF_G3, PF_D4, PF_B3, PF_D4], // G
  [PF_C4, PF_G4, PF_E4, PF_G4], // C
  [PF_D3, PF_A3, PF_FS3, PF_A3], // D low — cadential weight
  [PF_G3, PF_D4, PF_B3, PF_D4], // G
];

/** Per-bar strike peaks — a WIDE dynamic arc: hushed opening, cresting
 *  with the flute's climax (bars 5–7), falling away into the wrap —
 *  always under the melody. */
const pfLeftHandPeaks = [0.44, 0.46, 0.52, 0.55, 0.6, 0.64, 0.66, 0.48];

/** Humanization: players don't strike on a grid
 *  at one velocity. Deterministic per-note-in-bar leans — the downbeat
 *  stays anchored, off-beats land a hair late — plus small velocity
 *  deltas. Shared by every LH-derived lane (pitch, amp, brightness) so
 *  the lanes stay aligned per strike. */
const pfStrikeLag = [0, 0.016, 0.007, 0.021];
const pfStrikeAccent = [0.03, -0.03, -0.01, -0.04];

function pfLeftHandStrikes(): { t: number; hz: number; peak: number }[] {
  const strikes: { t: number; hz: number; peak: number }[] = [];
  pfLeftHandBars.forEach((bar, barIndex) => {
    bar.forEach((hz, noteIndex) => {
      strikes.push({
        t:
          barIndex * PF_BAR_SECONDS +
          noteIndex * PF_QUARTER_SECONDS +
          pfStrikeLag[noteIndex],
        hz,
        peak: pfLeftHandPeaks[barIndex] + pfStrikeAccent[noteIndex],
      });
    });
  });
  return strikes;
}

function pianoLeftHandPitchPoints(): CurvePoint[] {
  return pfLeftHandStrikes().map(({ t, hz }) =>
    curvePoint(t, hz, 'step', 'step'),
  );
}

/** Piano strikes: instant hammer attack (step arrival), ~0.68 s eased
 *  ring-down to a LOW floor (real piano notes decay away — a high floor
 *  reads as an organ), re-struck before the ring dies. */
function pianoLeftHandAmpPoints(): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (const { t, peak } of pfLeftHandStrikes()) {
    points.push(curvePoint(t, peak, 'step'));
    points.push(curvePoint(t + 0.68, 0.07, 'ease'));
  }
  return points;
}

/** Hammer brightness: a real strike opens bright and mellows as it
 *  rings, so the piano-bus lowpass rides its own lane — 3400 Hz at each
 *  attack easing down to 2200 Hz. LH strike times cover the RH too:
 *  the answers land on the same quarter grid with the same leans. */
function pianoBrightnessPoints(): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (const { t } of pfLeftHandStrikes()) {
    points.push(curvePoint(t, 3400, 'step'));
    points.push(curvePoint(t + 0.58, 2200, 'ease'));
  }
  return points;
}

/** RH answers, dovetailing under the flute's phrase tapers: bar 4 walks
 *  D5-C5-B4-A4 down (the C5 makes the V a V7, resolving to B within the
 *  bar), bar 8 rises G4-A4-B4-D5 into the wrap — handing its final D5
 *  straight to the flute's D5 entry at t=0. */
const pfRightHandAnswers: { t: number; hz: number }[] = [
  { t: 9, hz: PF_D5 },
  { t: 9.75, hz: PF_C5 },
  { t: 10.5, hz: PF_B4 },
  { t: 11.25, hz: PF_A4 },
  { t: 21, hz: PF_G4 },
  { t: 21.75, hz: PF_A4 },
  { t: 22.5, hz: PF_B4 },
  { t: 23.25, hz: PF_D5 },
];

function pianoRightHandPitchPoints(): CurvePoint[] {
  return pfRightHandAnswers.map(({ t, hz }, index) =>
    curvePoint(t + pfStrikeLag[index % 4], hz, 'step', 'step'),
  );
}

function pianoRightHandAmpPoints(): CurvePoint[] {
  // Anchor at zero: before its FIRST point a curve holds that point's
  // value (hold-clamp), so without this the RH would ring from boot
  // until its first bar-4 strike. The strike's step left-interp keeps
  // the 0→9 s segment flat.
  const points: CurvePoint[] = [curvePoint(0, 0)];
  pfRightHandAnswers.forEach(({ t }, index) => {
    const lastOfAnswer = index === 3 || index === 7;
    const lagged = t + pfStrikeLag[index % 4];
    points.push(curvePoint(lagged, 0.45, 'step'));
    points.push(curvePoint(lagged + 0.68, lastOfAnswer ? 0 : 0.08, 'ease'));
  });
  return points;
}

/** Flute melody — all in the bright middle register (D5–E6), every
 *  transition a hard step (keyed winds change pitch instantly; the
 *  legato lives in the unbroken breath lane, not in glides).
 *  Phrase 1 (bars 1–4): D5 G5 A5 | B5 A5 G5 | E5 G5 | F#5, breath.
 *  Phrase 2 (bars 5–8): G5 B5 D6 | E6 D6 C6 | B5 A5 | G5, taper out. */
const pfFluteMelody: { t: number; hz: number }[] = [
  { t: 0, hz: PF_D5 },
  { t: 1.5, hz: PF_G5 },
  { t: 2.25, hz: PF_A5 },
  { t: 3, hz: PF_B5 },
  { t: 4.5, hz: PF_A5 },
  { t: 5.25, hz: PF_G5 },
  { t: 6, hz: PF_E5 },
  { t: 7.5, hz: PF_G5 },
  { t: 9, hz: PF_FS5 },
  { t: 12, hz: PF_G5 },
  { t: 12.75, hz: PF_B5 },
  { t: 13.5, hz: PF_D6 },
  { t: 15, hz: PF_E6 },
  { t: 16.5, hz: PF_D6 },
  { t: 17.25, hz: PF_C6 },
  { t: 18, hz: PF_B5 },
  { t: 19.5, hz: PF_A5 },
  { t: 21, hz: PF_G5 },
];

function flutePitchPoints(): CurvePoint[] {
  return pfFluteMelody.map(({ t, hz }) => curvePoint(t, hz, 'step', 'step'));
}

const pianoFluteTimeline: TimelineDocument = {
  version: 1,
  durationSec: 24,
  loop: true,
  curves: [
    orchestraCurve(
      'crv_pfLhPitch',
      'piano LH Hz',
      '#60a5fa',
      PF_G3,
      pianoLeftHandPitchPoints(),
    ),
    orchestraCurve(
      'crv_pfLhAmp',
      'piano LH amp',
      '#38bdf8',
      0,
      pianoLeftHandAmpPoints(),
    ),
    orchestraCurve(
      'crv_pfRhPitch',
      'piano RH Hz',
      '#f59e0b',
      PF_D5,
      pianoRightHandPitchPoints(),
    ),
    orchestraCurve(
      'crv_pfRhAmp',
      'piano RH amp',
      '#fbbf24',
      0,
      pianoRightHandAmpPoints(),
    ),
    orchestraCurve(
      'crv_pfPianoBright',
      'piano brightness',
      '#a78bfa',
      2400,
      pianoBrightnessPoints(),
    ),
    orchestraCurve(
      'crv_pfFlutePitch',
      'flute Hz',
      '#34d399',
      PF_D5,
      flutePitchPoints(),
    ),
    // Breath lane: one continuous arc per slurred phrase (swell peaking
    // past the middle, falling faster than it grew), hard zero in the
    // breath rest between phrases, tapering out before the wrap.
    // Breath lane: hushed entry, wider swells,
    // a bigger 0.9 climax on the E6, and a LONG lingering final taper
    // (to 23 s) that dissolves into the hall tail before the wrap.
    orchestraCurve('crv_pfFluteAmp', 'flute breath', '#4ade80', 0, [
      curvePoint(0, 0),
      curvePoint(0.15, 0.35, 'ease'),
      curvePoint(4.2, 0.72, 'ease', 'ease'),
      curvePoint(7.5, 0.52, 'ease', 'ease'),
      curvePoint(9.2, 0.6, 'ease', 'ease'),
      curvePoint(10.4, 0, 'ease'),
      curvePoint(12, 0),
      curvePoint(12.15, 0.42, 'ease'),
      curvePoint(14, 0.65, 'ease', 'ease'),
      curvePoint(15.9, 0.9, 'ease', 'ease'),
      curvePoint(19.5, 0.5, 'ease', 'ease'),
      curvePoint(21.2, 0.48, 'ease', 'ease'),
      curvePoint(23, 0, 'ease'),
    ]),
    // Delayed vibrato: near-still base, blooming late on the held B5,
    // the D6→E6 climax and the final G5 — never at note onsets.
    orchestraCurve('crv_pfFluteVib', 'flute vibrato', '#f472b6', 0.002, [
      curvePoint(0, 0.002),
      curvePoint(3.1, 0.002, 'ease', 'ease'),
      curvePoint(4.4, 0.016, 'ease', 'ease'),
      curvePoint(5.4, 0.004, 'ease', 'ease'),
      curvePoint(13.6, 0.004, 'ease', 'ease'),
      curvePoint(16.3, 0.018, 'ease', 'ease'),
      curvePoint(18.5, 0.006, 'ease', 'ease'),
      curvePoint(21.2, 0.004, 'ease', 'ease'),
      curvePoint(22.8, 0.014, 'ease', 'ease'),
    ]),
  ],
};

// ── "Ear candy" orchestra trio ────────────────────────────────────────
//
// Three original timeline scores, each built around a set of production
// devices:
//   · a five-kick club skeleton on sixteenth steps 1, 5, 9, 12, 15
//     (beats 0, 1, 2, 2.75, 3.5) with a squeaky "eee-err" bed filling
//     the gaps between kicks
//   · a hard DEAD-STOP — every voice cut on a beat, then slammed back
//   · a SOFT pause — the beat cuts but the melody rings on in the echo
//   · four-on-floor with an offbeat octave-bounce bass
//   · an overdrive swell: a clean tone pushed into saturation like an
//     amplifier being turned up
//   · extreme master-EQ play as a rhythmic effect in its own right
// Each demo's own header below records the tempo, key and bar structure
// it uses, and the devices are commented where they are implemented.

// ---- Demo A: "Bell Club" — club-pop score ----------------------------
// 133 BPM, F major, 12 bars (~21.65 s). Sections: bars 0–1 music-box
// intro · 2–5 five-kick skeleton + squeaky bed · hard DEAD-STOP on bar
// 5 beat 3 · 6–9 four-on-floor + octave-bounce bass, with the SOFT
// pause at bar 9 beats 2–4 where the bells hang alone in the echo ·
// 10–11 everything at once.

const BC_BEAT = 60 / 133;

function bcT(bar: number, beat: number): number {
  return (bar * 4 + beat) * BC_BEAT;
}

// Warm bell wave (fundamental-heavy, barely any upper partials); the
// riff sits an octave below alarm register, over a warm pad bed.
const bellWave = harmonicWave([1, 0.25, 0.06, 0.1]);

/** Music-box voicings per chord (top line A-G-F-F), struck at beats
 *  0 / 0.75 / 1.5 / 2.5 — the dinky syncopated twinkle, octave 4. */
const BC_CHORD_BELLS: Record<string, number[]> = {
  F: [noteHz(0), noteHz(3), noteHz(-4), noteHz(0)], // A4 C5 F4 A4
  C: [noteHz(-2), noteHz(3), noteHz(-5), noteHz(-2)], // G4 C5 E4 G4
  Dm: [noteHz(-4), noteHz(0), noteHz(-7), noteHz(-4)], // F4 A4 D4 F4
  Bb: [noteHz(-4), noteHz(1), noteHz(-7), noteHz(-4)], // F4 Bb4 D4 F4
};

/** Pad bed roots (octave 3) — depth under the whole groove. */
const BC_PAD_ROOTS: Record<string, number> = {
  F: noteHz(-16), // F3
  C: noteHz(-21), // C3
  Dm: noteHz(-19), // D3
  Bb: noteHz(-23), // Bb2
};

/** I–V–vi–IV loop: bar index → chord. */
const BC_BARS = [
  'F',
  'C',
  'Dm',
  'Bb',
  'F',
  'C',
  'Dm',
  'Bb',
  'F',
  'C',
  'Dm',
  'Bb',
];
const BC_BELL_BEATS = [0, 0.75, 1.5, 2.5];
const BC_BASS_ROOTS: Record<string, number> = {
  F: noteHz(-28), // F2
  C: noteHz(-21), // C3
  Dm: noteHz(-19), // D3
  Bb: noteHz(-23), // Bb2
};

/** The five-kick club skeleton (16th steps 1,5,9,12,15). */
const BC_CLUB_BEATS = [0, 1, 2, 2.75, 3.5];
const BC_KICK_HITS: { bar: number; beats: number[] }[] = [
  { bar: 2, beats: BC_CLUB_BEATS },
  { bar: 3, beats: BC_CLUB_BEATS },
  { bar: 4, beats: BC_CLUB_BEATS },
  { bar: 5, beats: [0, 1, 2] }, // beat 3 = the hard dead-stop
  { bar: 6, beats: [0, 1, 2, 3] }, // four-on-floor
  { bar: 7, beats: [0, 1, 2, 3] },
  { bar: 8, beats: [0, 1, 2, 3] },
  { bar: 9, beats: [0, 1] }, // beats 2–4 = the soft "melody hangs" pause
  { bar: 10, beats: BC_CLUB_BEATS },
  // Final bar drops the 3.5 hit: a breath before the wrap slam, and the
  // longer boomy decay stays inside the loop duration.
  { bar: 11, beats: [0, 1, 2, 2.75] },
];

/** Deep heartbeat kick: full weight on the three on-beats, the two late
 *  "half" hits softer — the lopsided 3-then-2 gallop reads as a
 *  heartbeat — with a longer boomy tail and a 120→42 Hz drop. */
function bcKickAmpPoints(): CurvePoint[] {
  const hits = BC_KICK_HITS.flatMap(({ bar, beats }) =>
    beats.map((beat) => ({
      t: bcT(bar, beat),
      onBeat: Number.isInteger(beat),
    })),
  );
  const points: CurvePoint[] = [curvePoint(0, 0)];
  hits.forEach((hit, index) => {
    // The club beats run closer together than the boomy 300 ms tail, so the
    // tail is clamped to the next hit — see `percussionTailEnd`.
    const tailEnd = percussionTailEnd(hit.t, 0.3, hits[index + 1]?.t);
    points.push(curvePoint(hit.t, hit.onBeat ? 0.95 : 0.82, 'step'));
    const knee = hit.t + 0.06;
    if (knee + MIN_POINT_GAP_SECONDS <= tailEnd) {
      points.push(curvePoint(knee, 0.4));
    }
    points.push(curvePoint(tailEnd, 0, 'ease'));
  });
  return points;
}

function bcKickPitchPoints(): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (const { bar, beats } of BC_KICK_HITS) {
    for (const beat of beats) {
      const t = bcT(bar, beat);
      points.push(curvePoint(t, 120, 'step', 'ease'));
      points.push(curvePoint(t + 0.05, 42, 'ease', 'step'));
    }
  }
  return points;
}

function bcBellPitchPoints(): CurvePoint[] {
  const points: CurvePoint[] = [];
  BC_BARS.forEach((chord, bar) => {
    BC_CHORD_BELLS[chord].forEach((hz, i) => {
      points.push(curvePoint(bcT(bar, BC_BELL_BEATS[i]), hz, 'step', 'step'));
    });
  });
  return points;
}

function bcBellAmpPoints(): CurvePoint[] {
  const points: CurvePoint[] = [];
  BC_BARS.forEach((_chord, bar) => {
    BC_BELL_BEATS.forEach((beat) => {
      const t = bcT(bar, beat);
      points.push(curvePoint(t, 0.45, 'step'));
      points.push(curvePoint(t + 0.21, 0.05, 'ease'));
    });
    if (bar === 5) {
      // Hard dead-stop: even the bell floor cuts at beat 3.
      points.push(curvePoint(bcT(5, 3), 0, 'step'));
    }
  });
  return points;
}

function bcBassPoints(): {
  pitch: CurvePoint[];
  amp: CurvePoint[];
} {
  const pitch: CurvePoint[] = [];
  const amp: CurvePoint[] = [curvePoint(0, 0)];
  const push = (t: number, hz: number, decay: number) => {
    pitch.push(curvePoint(t, hz, 'step', 'step'));
    amp.push(curvePoint(t, 0.75, 'step'));
    amp.push(curvePoint(t + decay, 0, 'ease'));
  };
  // Octave bounce on the offbeats (bars 6–9 until the pause) — longer
  // ring for weight.
  for (const bar of [6, 7, 8]) {
    [0.5, 1.5, 2.5, 3.5].forEach((beat, i) => {
      const root = BC_BASS_ROOTS[BC_BARS[bar]];
      push(bcT(bar, beat), i % 2 === 0 ? root : root * 2, 0.3);
    });
  }
  [0.5, 1.5].forEach((beat, i) => {
    const root = BC_BASS_ROOTS[BC_BARS[9]];
    push(bcT(9, beat), i % 2 === 0 ? root : root * 2, 0.3);
  });
  // Final stretch: bass joins the (breath-shortened) kick grid.
  for (const beat of BC_CLUB_BEATS) {
    push(bcT(10, beat), BC_BASS_ROOTS[BC_BARS[10]], 0.2);
  }
  for (const beat of [0, 1, 2, 2.75]) {
    push(bcT(11, beat), BC_BASS_ROOTS[BC_BARS[11]], 0.2);
  }
  return { pitch, amp };
}

/** The bed squeak as a true "eee-err" PAIR: a short rising squeak then a
 *  lower falling one, quiet and dark — it fills kick gaps rhythmically
 *  instead of chirping like an alarm. */
function bcSqueakPoints(): { pitch: CurvePoint[]; amp: CurvePoint[] } {
  const pitch: CurvePoint[] = [];
  const amp: CurvePoint[] = [curvePoint(0, 0)];
  const squeakBars: { bar: number; beats: number[] }[] = [
    { bar: 2, beats: [1.5, 3] },
    { bar: 3, beats: [1.5, 3] },
    { bar: 4, beats: [1.5, 3] },
    { bar: 5, beats: [1.5] }, // beat 3 would collide with the dead-stop
    { bar: 10, beats: [1.5, 3] },
    { bar: 11, beats: [1.5, 3] },
  ];
  for (const { bar, beats } of squeakBars) {
    for (const beat of beats) {
      const t = bcT(bar, beat);
      // "eee": rise…
      pitch.push(curvePoint(t, 900, 'step', 'ease'));
      pitch.push(curvePoint(t + 0.07, 1350, 'ease', 'step'));
      // …"err": fall.
      pitch.push(curvePoint(t + 0.14, 1250, 'step', 'ease'));
      pitch.push(curvePoint(t + 0.24, 780, 'ease', 'step'));
      amp.push(curvePoint(t, 0.3, 'step'));
      amp.push(curvePoint(t + 0.11, 0, 'ease'));
      amp.push(curvePoint(t + 0.14, 0.28, 'step'));
      amp.push(curvePoint(t + 0.26, 0, 'ease'));
    }
  }
  return { pitch, amp };
}

function bcHatAmpPoints(): CurvePoint[] {
  const points: CurvePoint[] = [curvePoint(0, 0)];
  const hatBars: { bar: number; beats: number[] }[] = [
    { bar: 6, beats: [0.5, 1.5, 2.5, 3.5] },
    { bar: 7, beats: [0.5, 1.5, 2.5, 3.5] },
    { bar: 8, beats: [0.5, 1.5, 2.5, 3.5] },
    { bar: 9, beats: [0.5, 1.5] },
    { bar: 10, beats: [0.5, 1.5, 2.5, 3.5] },
    { bar: 11, beats: [0.5, 1.5, 2.5, 3.5] },
  ];
  for (const { bar, beats } of hatBars) {
    for (const beat of beats) {
      const t = bcT(bar, beat);
      points.push(curvePoint(t, 0.35, 'step'));
      points.push(curvePoint(t + 0.03, 0.18));
      points.push(curvePoint(t + 0.09, 0, 'ease'));
    }
  }
  return points;
}

/** Warm pad bed on the drawn smoothed-triangle wave: sustains under the
 *  groove from the first kick, obeys the dead-stop, hangs through the
 *  soft pause, eases out before the wrap. */
function bcPadPoints(): { pitch: CurvePoint[]; amp: CurvePoint[] } {
  const pitch: CurvePoint[] = BC_BARS.map((chord, bar) =>
    curvePoint(bcT(bar, 0), BC_PAD_ROOTS[chord], 'step', 'step'),
  );
  const amp: CurvePoint[] = [
    curvePoint(0, 0),
    curvePoint(bcT(2, 0), 0, 'step'),
    curvePoint(bcT(2, 0) + 0.4, 0.3, 'ease'),
    curvePoint(bcT(5, 3), 0, 'step'), // hard dead-stop
    curvePoint(bcT(6, 0), 0.3, 'step'), // slams back with the disco beat
    curvePoint(bcT(11, 2), 0.3, 'step', 'ease'),
    curvePoint(bcT(11, 3.8), 0, 'ease'),
  ];
  return { pitch, amp };
}

const bellClubTimeline: TimelineDocument = {
  version: 1,
  durationSec: 48 * BC_BEAT,
  loop: true,
  curves: [
    orchestraCurve('crv_bcKickAmp', 'kick amp', '#fb7185', 0, bcKickAmpPoints()),
    orchestraCurve(
      'crv_bcKickPitch',
      'kick pitch',
      '#c084fc',
      48,
      bcKickPitchPoints(),
    ),
    orchestraCurve(
      'crv_bcBellPitch',
      'bells Hz',
      '#34d399',
      noteHz(0),
      bcBellPitchPoints(),
    ),
    orchestraCurve('crv_bcBellAmp', 'bells amp', '#4ade80', 0, bcBellAmpPoints()),
    orchestraCurve(
      'crv_bcBassPitch',
      'bass Hz',
      '#60a5fa',
      BC_BASS_ROOTS.F,
      bcBassPoints().pitch,
    ),
    orchestraCurve('crv_bcBassAmp', 'bass amp', '#38bdf8', 0, bcBassPoints().amp),
    orchestraCurve(
      'crv_bcSqueakPitch',
      'squeak Hz',
      '#f472b6',
      1150,
      bcSqueakPoints().pitch,
    ),
    orchestraCurve(
      'crv_bcSqueakAmp',
      'squeak amp',
      '#fda4af',
      0,
      bcSqueakPoints().amp,
    ),
    orchestraCurve('crv_bcHatAmp', 'hats amp', '#fbbf24', 0, bcHatAmpPoints()),
    orchestraCurve(
      'crv_bcPadPitch',
      'pad Hz',
      '#a78bfa',
      BC_PAD_ROOTS.F,
      bcPadPoints().pitch,
    ),
    orchestraCurve('crv_bcPadAmp', 'pad amp', '#c4b5fd', 0, bcPadPoints().amp),
  ],
};

// ---- Demo B: "Neon Drop" — EDM score ---------------------------------
// 132 BPM, B minor, 12 bars (~21.82 s). Bars 0–3 groove (saw riff +
// robot vox teaser) · 4–5 BUILD (snare roll + filter riser) · 6–9 DROP
// (heavy distorted gliding 808 + robotic formant vocal chops) ·
// 10–11 outro.

const ND_BEAT = 60 / 132;

function ndT(bar: number, beat: number): number {
  return (bar * 4 + beat) * ND_BEAT;
}

// Design anchors:
// - Harmony: an i–iv7–♭VII7sus–♭III class progression transposed to B
//   minor = Bm–Em7–A7sus–D(add9) — extended chords are the spice.
// - Lead element: a STICKY FUNKY BASSLINE + retro synth offbeat plucks,
//   layers growing.
// - Form: build → SPARSE hard drop; end ON the hook — so the drop strips
//   to kick + 808 + chant, and the outro is groove + chant.

/** Per-chord data: funk-bass root (octave 2) + four offbeat pluck tones
 *  (7th/9th colors — D-add9's E5 is the brightest spice). */
const ND_CHORDS = [
  // Bm7: plucks D4 F#4 A4 F#4
  {
    root2: noteHz(-22),
    pluck: [noteHz(-7), noteHz(-3), noteHz(0), noteHz(-3)],
  },
  // Em7: plucks G4 B4 D5 B4
  { root2: noteHz(-29), pluck: [noteHz(-2), noteHz(2), noteHz(5), noteHz(2)] },
  // A7sus: plucks E4 G4 A4 G4
  {
    root2: noteHz(-24),
    pluck: [noteHz(-5), noteHz(-2), noteHz(0), noteHz(-2)],
  },
  // D(add9): plucks F#4 A4 E5 A4
  { root2: noteHz(-19), pluck: [noteHz(-3), noteHz(0), noteHz(7), noteHz(0)] },
];
const ND_FIFTH = 2 ** (7 / 12);
const ND_GROOVE_BARS = [0, 1, 2, 3, 10, 11];

/** The sticky bassline: syncopated funk figure with octave pops and a
 *  fifth pass — root(0), root(0.75), OCTAVE(1.5), fifth(2.25),
 *  root(3), OCTAVE(3.5). */
function ndBassPoints(): { pitch: CurvePoint[]; amp: CurvePoint[] } {
  const pitch: CurvePoint[] = [];
  // No silent seed point: the groove's first note lands ON t=0, and a seed
  // there would be a second point at the same instant.
  const amp: CurvePoint[] =
    ndT(ND_GROOVE_BARS[0], 0) > MIN_POINT_GAP_SECONDS
      ? [curvePoint(0, 0)]
      : [];
  const figure: { beat: number; ratio: number }[] = [
    { beat: 0, ratio: 1 },
    { beat: 0.75, ratio: 1 },
    { beat: 1.5, ratio: 2 },
    { beat: 2.25, ratio: ND_FIFTH },
    { beat: 3, ratio: 1 },
    { beat: 3.5, ratio: 2 },
  ];
  for (const bar of ND_GROOVE_BARS) {
    const { root2 } = ND_CHORDS[bar % 4];
    for (const { beat, ratio } of figure) {
      const t = ndT(bar, beat);
      pitch.push(curvePoint(t, root2 * ratio, 'step', 'step'));
      amp.push(curvePoint(t, 0.7, 'step'));
      amp.push(curvePoint(t + 0.18, 0, 'ease'));
    }
  }
  return { pitch, amp };
}

/** Retro synth plucks on the offbeats — chord-tone colors, tight and
 *  un-resonant (the modern kind of bright). */
function ndPluckPoints(): { pitch: CurvePoint[]; amp: CurvePoint[] } {
  const pitch: CurvePoint[] = [];
  const amp: CurvePoint[] = [curvePoint(0, 0)];
  for (const bar of ND_GROOVE_BARS) {
    const { pluck } = ND_CHORDS[bar % 4];
    [0.5, 1.5, 2.5, 3.5].forEach((beat, i) => {
      const t = ndT(bar, beat);
      pitch.push(curvePoint(t, pluck[i], 'step', 'step'));
      amp.push(curvePoint(t, 0.6, 'step'));
      amp.push(curvePoint(t + 0.12, 0, 'ease'));
    });
  }
  return { pitch, amp };
}

/** Hats AND the build riser share one noise voice: crisp offbeat ticks
 *  in the groove/drop, a continuous rising noise swell through the
 *  build, cut dead at the drop. */
function ndHatPoints(): CurvePoint[] {
  const points: CurvePoint[] = [curvePoint(0, 0)];
  const burst = (t: number, peak: number) => {
    points.push(curvePoint(t, peak, 'step'));
    points.push(curvePoint(t + 0.02, peak * 0.5));
    points.push(curvePoint(t + 0.07, 0, 'ease'));
  };
  for (const bar of [0, 1, 2, 3]) {
    for (const beat of [0.5, 1.5, 2.5, 3.5]) burst(ndT(bar, beat), 0.4);
  }
  points.push(curvePoint(ndT(4, 0), 0.05, 'step', 'ease'));
  points.push(curvePoint(ndT(6, 0) - 0.03, 0.6, 'ease', 'step'));
  points.push(curvePoint(ndT(6, 0), 0, 'step'));
  for (const bar of [6, 7, 8, 9]) {
    for (const beat of [0.5, 1.5, 2.5, 3.5]) burst(ndT(bar, beat), 0.5);
  }
  for (const bar of [10, 11]) {
    for (const beat of [0.5, 1.5, 2.5, 3.5]) burst(ndT(bar, beat), 0.4);
  }
  return points;
}

function ndKickAmpPoints(): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (let bar = 0; bar < 12; bar += 1) {
    for (let beat = 0; beat < 4; beat += 1) {
      const t = ndT(bar, beat);
      points.push(curvePoint(t, 0.95, 'step'));
      points.push(curvePoint(t + 0.05, 0.35));
      points.push(curvePoint(t + 0.24, 0, 'ease'));
    }
  }
  return points;
}

function ndKickPitchPoints(): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (let bar = 0; bar < 12; bar += 1) {
    for (let beat = 0; beat < 4; beat += 1) {
      const t = ndT(bar, beat);
      points.push(curvePoint(t, 145, 'step', 'ease'));
      points.push(curvePoint(t + 0.045, 46, 'ease', 'step'));
    }
  }
  return points;
}

/** Build: 8th-note roll (bar 4) doubling to 16ths (bar 5), crescendo. */
function ndSnarePoints(): CurvePoint[] {
  const points: CurvePoint[] = [curvePoint(0, 0)];
  const bursts: number[] = [];
  for (let i = 0; i < 8; i += 1) bursts.push(ndT(4, i * 0.5));
  for (let i = 0; i < 16; i += 1) bursts.push(ndT(5, i * 0.25));
  bursts.forEach((t, i) => {
    const peak = 0.35 + (0.45 * i) / (bursts.length - 1);
    points.push(curvePoint(t, peak, 'step'));
    points.push(curvePoint(t + 0.02, peak * 0.6));
    points.push(curvePoint(t + 0.07, 0, 'ease'));
  });
  return points;
}

/** The heavy sound: a distorted 808 that SLIDES between notes (hold,
 *  then a late 100 ms glide into the next pitch). */
const ND_808_NOTES: { bar: number; beat: number; hz: number }[] = [];
for (const bar of [6, 7, 8, 9]) {
  ND_808_NOTES.push(
    { bar, beat: 0, hz: noteHz(-34) }, // B1
    { bar, beat: 1.5, hz: noteHz(-31) }, // D2
    { bar, beat: 2.5, hz: noteHz(-36) }, // A1
    { bar, beat: 3, hz: noteHz(-34) },
  );
}

function ndSubPoints(): { pitch: CurvePoint[]; amp: CurvePoint[] } {
  const pitch: CurvePoint[] = [];
  const amp: CurvePoint[] = [curvePoint(0, 0)];
  ND_808_NOTES.forEach(({ bar, beat, hz }, i) => {
    const t = ndT(bar, beat);
    if (i === 0) {
      pitch.push(curvePoint(t, hz, 'step', 'step'));
    } else {
      // Hold the previous pitch until 100 ms before this hit, then glide.
      pitch.push(curvePoint(t - 0.1, ND_808_NOTES[i - 1].hz, 'step', 'ease'));
      pitch.push(curvePoint(t, hz, 'ease', 'step'));
    }
    amp.push(curvePoint(t, 0.9, 'step'));
    // The 808's 420 ms tail outlives the gap between the closer notes — clamp
    // it to the next hit (see `percussionTailEnd`).
    const next = ND_808_NOTES[i + 1];
    const tailEnd = percussionTailEnd(
      t,
      0.42,
      next ? ndT(next.bar, next.beat) : undefined,
    );
    amp.push(curvePoint(tailEnd, 0.2, 'ease'));
  });
  const release = ndT(10, 0);
  const lastAmpPoint = amp[amp.length - 1];
  if (release >= lastAmpPoint.t + MIN_POINT_GAP_SECONDS) {
    amp.push(curvePoint(release, 0, 'ease'));
  }
  return { pitch, amp };
}

/** The chant hook: pulse chops through a jumping formant bandpass.
 *  Rounded vowels (no 2.2 kHz honk), tight chops; a two-chop pickup
 *  announces it, the drop carries it, and the score ENDS on it. */
const ND_VOX_PITCHES = [noteHz(2), noteHz(5), noteHz(0), noteHz(2)];
const ND_VOX_FORMANTS = [700, 1100, 500, 900];
const ND_VOX_CHOPS: { bar: number; beat: number }[] = [
  { bar: 3, beat: 3.25 },
  { bar: 3, beat: 3.75 },
];
for (const bar of [6, 7, 8, 9, 10, 11]) {
  for (const beat of [0.5, 1.25, 2.5, 3.25]) {
    ND_VOX_CHOPS.push({ bar, beat });
  }
}

function ndVoxPoints(): {
  pitch: CurvePoint[];
  amp: CurvePoint[];
  formant: CurvePoint[];
} {
  const pitch: CurvePoint[] = [];
  const amp: CurvePoint[] = [curvePoint(0, 0)];
  const formant: CurvePoint[] = [];
  ND_VOX_CHOPS.forEach(({ bar, beat }, i) => {
    const t = ndT(bar, beat);
    pitch.push(curvePoint(t, ND_VOX_PITCHES[i % 4], 'step', 'step'));
    formant.push(curvePoint(t, ND_VOX_FORMANTS[i % 4], 'step', 'step'));
    amp.push(curvePoint(t, 0.65, 'step'));
    amp.push(curvePoint(t + 0.11, 0, 'ease'));
  });
  return { pitch, amp, formant };
}

const neonDropTimeline: TimelineDocument = {
  version: 1,
  durationSec: 48 * ND_BEAT,
  loop: true,
  curves: [
    orchestraCurve('crv_ndKickAmp', 'kick amp', '#fb7185', 0, ndKickAmpPoints()),
    orchestraCurve(
      'crv_ndKickPitch',
      'kick pitch',
      '#c084fc',
      52,
      ndKickPitchPoints(),
    ),
    orchestraCurve(
      'crv_ndBassPitch',
      'funk bass Hz',
      '#34d399',
      ND_CHORDS[0].root2,
      ndBassPoints().pitch,
    ),
    orchestraCurve(
      'crv_ndBassAmp',
      'funk bass amp',
      '#4ade80',
      0,
      ndBassPoints().amp,
    ),
    orchestraCurve(
      'crv_ndPluckPitch',
      'pluck Hz',
      '#a3e635',
      ND_CHORDS[0].pluck[0],
      ndPluckPoints().pitch,
    ),
    orchestraCurve(
      'crv_ndPluckAmp',
      'pluck amp',
      '#bef264',
      0,
      ndPluckPoints().amp,
    ),
    orchestraCurve('crv_ndHatAmp', 'hats + riser', '#f97316', 0, ndHatPoints()),
    orchestraCurve('crv_ndSnareAmp', 'build roll', '#fbbf24', 0, ndSnarePoints()),
    orchestraCurve(
      'crv_ndSubPitch',
      '808 Hz',
      '#60a5fa',
      noteHz(-34),
      ndSubPoints().pitch,
    ),
    orchestraCurve('crv_ndSubAmp', '808 amp', '#38bdf8', 0, ndSubPoints().amp),
    orchestraCurve(
      'crv_ndVoxPitch',
      'vox Hz',
      '#f472b6',
      noteHz(2),
      ndVoxPoints().pitch,
    ),
    orchestraCurve('crv_ndVoxAmp', 'vox amp', '#fda4af', 0, ndVoxPoints().amp),
    orchestraCurve(
      'crv_ndVoxFormant',
      'vox formant',
      '#a78bfa',
      500,
      ndVoxPoints().formant,
    ),
  ],
};

// ---- Demo C: "Filter Rush" — the finger-in-the-ear score -------------
// Principle: a CLEAN deep club groove (kick, sine sub, arp lead, claps
// — zero distortion) whose ENTIRE MASTER BUS breathes through a moving
// lowpass + highpass + PAN + amplitude wobble, giving the "finger in
// the ear, moving around" effect: slow swirls first, a thin pressed-in
// section, then fast wobbles, then it opens wide.
// 170 BPM, F# minor, 12 bars (~16.94 s), i–i–VI–VII (F#m–F#m–D–E)
// with maj7/7th arps for color.

const FR_BEAT = 60 / 170;

function frT(bar: number, beat: number): number {
  return (bar * 4 + beat) * FR_BEAT;
}

const FR_ROOTS = [
  noteHz(-27), // F#2
  noteHz(-27),
  noteHz(-31), // D2
  noteHz(-29), // E2
];

/** Up-down 8th arps, one per chord — the 7th-chord tones are the color:
 *  F#m7 / F#m7 / Dmaj7 / E7. */
const FR_ARPS: number[][] = [
  [
    noteHz(-3),
    noteHz(0),
    noteHz(4),
    noteHz(7),
    noteHz(9),
    noteHz(7),
    noteHz(4),
    noteHz(0),
  ],
  [
    noteHz(-3),
    noteHz(0),
    noteHz(4),
    noteHz(7),
    noteHz(9),
    noteHz(7),
    noteHz(4),
    noteHz(0),
  ],
  [
    noteHz(-7),
    noteHz(-3),
    noteHz(0),
    noteHz(4),
    noteHz(5),
    noteHz(4),
    noteHz(0),
    noteHz(-3),
  ],
  [
    noteHz(-5),
    noteHz(-1),
    noteHz(2),
    noteHz(5),
    noteHz(7),
    noteHz(5),
    noteHz(2),
    noteHz(-1),
  ],
];

function frKickAmpPoints(): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (let bar = 0; bar < 12; bar += 1) {
    for (let beat = 0; beat < 4; beat += 1) {
      const t = frT(bar, beat);
      points.push(curvePoint(t, 0.95, 'step'));
      points.push(curvePoint(t + 0.04, 0.35));
      points.push(curvePoint(t + 0.16, 0, 'ease'));
    }
  }
  return points;
}

function frKickPitchPoints(): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (let bar = 0; bar < 12; bar += 1) {
    for (let beat = 0; beat < 4; beat += 1) {
      const t = frT(bar, beat);
      points.push(curvePoint(t, 160, 'step', 'ease'));
      points.push(curvePoint(t + 0.03, 48, 'ease', 'step'));
    }
  }
  return points;
}

/** Clean SINE sub stabs on the offbeats — deep pump, zero distortion. */
function frBassPoints(): { pitch: CurvePoint[]; amp: CurvePoint[] } {
  const pitch: CurvePoint[] = [];
  const amp: CurvePoint[] = [curvePoint(0, 0)];
  for (let bar = 0; bar < 12; bar += 1) {
    pitch.push(curvePoint(frT(bar, 0), FR_ROOTS[bar % 4], 'step', 'step'));
    for (const beat of [0.5, 1.5, 2.5, 3.5]) {
      const t = frT(bar, beat);
      amp.push(curvePoint(t, 0.7, 'step'));
      amp.push(curvePoint(t + 0.15, 0, 'ease'));
    }
  }
  return { pitch, amp };
}

/** The lead: a clean triangle arp in 8ths, bars 2–9 — melody without a
 *  single distorted or honking element. */
function frArpPoints(): { pitch: CurvePoint[]; gate: CurvePoint[] } {
  const pitch: CurvePoint[] = [];
  const gate: CurvePoint[] = [curvePoint(0, 0)];
  for (let bar = 2; bar < 10; bar += 1) {
    const arp = FR_ARPS[bar % 4];
    arp.forEach((hz, i) => {
      const t = frT(bar, i * 0.5);
      pitch.push(curvePoint(t, hz, 'step', 'step'));
      gate.push(curvePoint(t, 0.5, 'step'));
      gate.push(curvePoint(t + 0.12, 0, 'ease'));
    });
  }
  return { pitch, gate };
}

function frClapAmpPoints(): CurvePoint[] {
  const points: CurvePoint[] = [curvePoint(0, 0)];
  for (let bar = 2; bar < 12; bar += 1) {
    for (const beat of [1, 3]) {
      const t = frT(bar, beat);
      points.push(curvePoint(t, 0.6, 'step'));
      points.push(curvePoint(t + 0.02, 0.35));
      points.push(curvePoint(t + 0.07, 0, 'ease'));
    }
  }
  return points;
}

/** THE finger-in-the-ear lowpass: wide open for two bars, two slow
 *  deep swirls (bars 2–6), half-covered while the highpass presses in
 *  (6–8), FAST wobbles every two beats (8–10), then it opens wide for
 *  the final lap. All ease — this must SWEEP, never step. */
function frLpFreqPoints(): CurvePoint[] {
  return [
    curvePoint(0, 16000, 'step', 'step'),
    curvePoint(frT(2, 0), 16000, 'step', 'ease'),
    curvePoint(frT(3, 0), 700, 'ease', 'ease'),
    curvePoint(frT(4, 0), 9000, 'ease', 'ease'),
    curvePoint(frT(5, 0), 900, 'ease', 'ease'),
    curvePoint(frT(6, 0), 5000, 'ease', 'step'),
    curvePoint(frT(8, 0), 5000, 'step', 'ease'),
    curvePoint(frT(8, 2), 800, 'ease', 'ease'),
    curvePoint(frT(9, 0), 6000, 'ease', 'ease'),
    curvePoint(frT(9, 2), 800, 'ease', 'ease'),
    curvePoint(frT(10, 0), 16000, 'ease', 'step'),
  ];
}

/** The highpass presses in against it (bars 6–8): the mix thins out
 *  like the finger sealing the canal, then releases. */
function frHpFreqPoints(): CurvePoint[] {
  return [
    curvePoint(0, 25, 'step', 'step'),
    curvePoint(frT(6, 0), 25, 'step', 'ease'),
    curvePoint(frT(6, 2), 900, 'ease', 'ease'),
    curvePoint(frT(7, 2), 120, 'ease', 'ease'),
    curvePoint(frT(8, 0), 25, 'ease', 'step'),
  ];
}

/** Pan sways with the swirls (slow ±0.6), then flips fast with the
 *  wobble section — the "moving it around" half of the effect. */
function frPanPoints(): CurvePoint[] {
  return [
    curvePoint(0, 0, 'step', 'step'),
    curvePoint(frT(2, 0), 0, 'step', 'ease'),
    curvePoint(frT(3, 0), -0.6, 'ease', 'ease'),
    curvePoint(frT(4, 0), 0.6, 'ease', 'ease'),
    curvePoint(frT(5, 0), -0.6, 'ease', 'ease'),
    curvePoint(frT(6, 0), 0.5, 'ease', 'ease'),
    curvePoint(frT(7, 0), -0.5, 'ease', 'ease'),
    curvePoint(frT(8, 0), 0, 'ease', 'ease'),
    curvePoint(frT(8, 1), 0.6, 'ease', 'ease'),
    curvePoint(frT(8, 3), -0.6, 'ease', 'ease'),
    curvePoint(frT(9, 1), 0.6, 'ease', 'ease'),
    curvePoint(frT(9, 3), -0.6, 'ease', 'ease'),
    curvePoint(frT(10, 0), 0, 'ease', 'step'),
  ];
}

/** Amplitude wobble on the master: gentle breathing under the slow
 *  swirls, hard rhythmic pumping in the wobble bars — the "amplitude
 *  effect". */
function frWobblePoints(): CurvePoint[] {
  const points: CurvePoint[] = [
    curvePoint(0, 1, 'step', 'step'),
    curvePoint(frT(2, 0), 1, 'step', 'ease'),
    curvePoint(frT(3, 0), 0.72, 'ease', 'ease'),
    curvePoint(frT(4, 0), 1, 'ease', 'ease'),
    curvePoint(frT(5, 0), 0.72, 'ease', 'ease'),
    curvePoint(frT(6, 0), 1, 'ease', 'step'),
    curvePoint(frT(8, 0), 1, 'step', 'ease'),
  ];
  for (const bar of [8, 9]) {
    points.push(curvePoint(frT(bar, 1), 0.55, 'ease', 'ease'));
    points.push(curvePoint(frT(bar, 2), 1, 'ease', 'ease'));
    points.push(curvePoint(frT(bar, 3), 0.55, 'ease', 'ease'));
    points.push(curvePoint(frT(bar + 1, 0), 1, 'ease', 'ease'));
  }
  points[points.length - 1] = curvePoint(frT(10, 0), 1, 'ease', 'step');
  return points;
}

const filterRushTimeline: TimelineDocument = {
  version: 1,
  durationSec: 48 * FR_BEAT,
  loop: true,
  curves: [
    orchestraCurve('crv_frKickAmp', 'kick amp', '#fb7185', 0, frKickAmpPoints()),
    orchestraCurve(
      'crv_frKickPitch',
      'kick pitch',
      '#c084fc',
      48,
      frKickPitchPoints(),
    ),
    orchestraCurve(
      'crv_frBassPitch',
      'sub Hz',
      '#60a5fa',
      FR_ROOTS[0],
      frBassPoints().pitch,
    ),
    orchestraCurve('crv_frBassAmp', 'sub pump', '#38bdf8', 0, frBassPoints().amp),
    orchestraCurve(
      'crv_frArpPitch',
      'arp Hz',
      '#34d399',
      FR_ARPS[0][0],
      frArpPoints().pitch,
    ),
    orchestraCurve('crv_frArpGate', 'arp gate', '#4ade80', 0, frArpPoints().gate),
    orchestraCurve('crv_frClapAmp', 'clap amp', '#fbbf24', 0, frClapAmpPoints()),
    orchestraCurve(
      'crv_frLpFreq',
      'ear lowpass',
      '#f97316',
      16000,
      frLpFreqPoints(),
    ),
    orchestraCurve('crv_frHpFreq', 'ear highpass', '#fde047', 25, frHpFreqPoints()),
    orchestraCurve('crv_frPan', 'ear pan', '#a78bfa', 0, frPanPoints()),
    orchestraCurve('crv_frWobble', 'ear wobble', '#f472b6', 1, frWobblePoints()),
  ],
};

/** Per-demo timeline documents — the App's demo picker installs these
 *  alongside the graph (empty document for every other demo). */
// ---- Demo D: "Starry Night" — deep-space downtempo score ---------------
// 85 BPM, D# minor, 16 bars (45.18 s loop). An ORIGINAL score modelled on
// the measured anatomy of an AI-generated ambient bed (stem separation +
// spectra, 2026-09-06):
// - 90% of the energy below 620 Hz and nothing above ~3.5 kHz → every
//   voice is dark and the master carries an "air" lowpass.
// - Sub: a near-sine holding chord ROOTS (58–93 Hz) for whole bars.
// - Kick: 808-style pitch drop (~190 → 54 Hz in 60 ms) in a sparse
//   syncopated pattern (beats 1, 2, the late 3) under a constant 16th tick
//   whose last offbeat rings longer (the "open" tick).
// - Pad: lowpassed chords changing every bar on the i–III–VI–VII loop with
//   the filter opening slowly across the groove; a pad-only breakdown on
//   i–i–i–VI; then the full return.
// - Sparse high "star" pings (F5–D#6) through a dotted-8th ping-pong.
// Form (bars): 0–1 pad + sub · 2–9 groove · 10–13 breakdown · 14–15 return.
//
// v2 (2026-09-06, after the user's listen: "dissonant, unnatural, the pad
// is too distorted"). Measured in-app with the transport parked in the
// pad-only bar: the render spectrum was the SUB sine plus its 3rd, 5th,
// 7th and 9th harmonics at −36…−65 dB — a pure sine has none; the master
// saturator manufactured them, and the 5th (G4) and 9th (F5) are foreign
// to a D♯ minor chord. Plus: every chord change left a semitone /
// whole-tone clash ringing in the master and ping halls (`Decay s` 5.5 and
// 8 — real T60s of 2.4 s and 2.9 s, not 5.5 and 8), and
// the pad was three sustained oscillators jumping pitch at bar lines. So:
// - NO master saturator; master hall `Decay s` 3 (real T60 1.8 s); ping
//   tails shortened.
// - The pad is three `inst_starryPad` voices (the MEASURED Night Pad
//   voice, derived variant that holds while gated) STRUCK once per bar by
//   a gate lane → Threshold, so a chord has died before the next sounds.
// - A continuous `inst_starryDrone` pair (the measured drone voice, deep
//   and soft: pitch-tracking lowpass at f0) on the key's root, D♯3 with a
//   half-level D♯4 double — consonant with every chord used.
// - Ping notes chosen so none sits a semitone from the drone or the next
//   bar's chord.

const SN_BEAT = 60 / 85;
const SN_BAR = SN_BEAT * 4;
const SN_LOOP_SECONDS = SN_BAR * 16;

function snT(bar: number, beat: number): number {
  return bar * SN_BAR + beat * SN_BEAT;
}

type SnChord = 'D#m' | 'F#' | 'B' | 'C#' | 'A#m';

/** One chord per bar: intro i–i · groove i–III–VI–VII, i–III–VI–v ·
 *  breakdown i–i–i–VI · return i–III. */
const SN_CHORDS: SnChord[] = [
  'D#m',
  'D#m',
  'D#m',
  'F#',
  'B',
  'C#',
  'D#m',
  'F#',
  'B',
  'A#m',
  'D#m',
  'D#m',
  'D#m',
  'B',
  'D#m',
  'F#',
];
const SN_GROOVE_BARS = [2, 3, 4, 5, 6, 7, 8, 9, 14, 15];

/** Sub roots inside the measured 58–93 Hz band (semitones from A4). */
const SN_ROOTS: Record<SnChord, number> = {
  'D#m': -30, // D#2
  'F#': -27, // F#2
  B: -34, // B1
  'C#': -32, // C#2
  'A#m': -35, // A#1
};

/** Pad voicings, low → high, voice-led so each voice steps or holds
 *  (D#3–C#4: dark, yet above the register where close intervals go
 *  muddy). */
const SN_VOICINGS: Record<SnChord, [number, number, number]> = {
  'D#m': [-18, -15, -11], // D#3 F#3 A#3
  'F#': [-20, -15, -11], // C#3 F#3 A#3
  B: [-18, -15, -10], // D#3 F#3 B3
  'C#': [-16, -13, -8], // F3 G#3 C#4
  'A#m': [-16, -11, -8], // F3 A#3 C#4
};

/** Star pings: chord tones two octaves above the pad, chosen so no ping is
 *  a semitone from the D♯/A♯ drone or from the NEXT bar's chord (v1's F5
 *  over C♯ and A♯m, and B5 over B, rang through the echo into D♯m / C♯
 *  bars and clashed). */
const SN_PINGS: Record<SnChord, [number, number, number]> = {
  'D#m': [9, 13, 18], // F#5 A#5 D#6
  'F#': [16, 13, 9], // C#6 A#5 F#5
  B: [18, 9, 13], // D#6 F#5 A#5
  'C#': [16, 11, 18], // C#6 G#5 D#6
  'A#m': [16, 13, 18], // C#6 A#5 D#6
};

/** Pad gate: each bar's chord is STRUCK — gate high for two beats, then
 *  the Starry Pad's 1.2 s release — so a chord has died (2.6 s) before
 *  the next bar's chord (2.82 s) sounds. Both sides step: a rectangle. */
function snPadGatePoints(): CurvePoint[] {
  const points: CurvePoint[] = [curvePoint(0, 0, 'step', 'step')];
  for (let bar = 0; bar < 16; bar += 1) {
    points.push(curvePoint(snT(bar, 0) + 0.01, 1, 'step', 'step'));
    points.push(curvePoint(snT(bar, 2), 0, 'step', 'step'));
  }
  return points;
}

function snPadVoicePoints(voice: 0 | 1 | 2): CurvePoint[] {
  return SN_CHORDS.map((chord, bar) =>
    curvePoint(
      snT(bar, 0),
      noteHz(SN_VOICINGS[chord][voice]),
      'step',
      'step',
    ),
  );
}

function snSubPitchPoints(): CurvePoint[] {
  return SN_CHORDS.map((chord, bar) =>
    curvePoint(snT(bar, 0), noteHz(SN_ROOTS[chord]), 'step', 'step'),
  );
}

/** Kick hits: even bars on 16ths 0·4·11 (beats 1, 2, the late 3), odd
 *  bars 0·6·10·13 — every gap ≥ 0.53 s, longer than the 0.42 s tail. */
function snKickHits(): number[] {
  const hits: number[] = [];
  for (const bar of SN_GROOVE_BARS) {
    const steps = bar % 2 === 0 ? [0, 4, 11] : [0, 6, 10, 13];
    for (const step of steps) hits.push(snT(bar, step / 4));
  }
  return hits;
}

function snKickAmpPoints(): CurvePoint[] {
  const points: CurvePoint[] = [curvePoint(0, 0)];
  for (const hit of snKickHits()) {
    points.push(curvePoint(hit, 0.95, 'step'));
    points.push(curvePoint(hit + 0.08, 0.4));
    points.push(curvePoint(hit + 0.42, 0, 'ease'));
  }
  return points;
}

function snKickPitchPoints(): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (const hit of snKickHits()) {
    points.push(curvePoint(hit, 190, 'step', 'ease'));
    points.push(curvePoint(hit + 0.06, 54, 'ease', 'step'));
  }
  return points;
}

/** The constant 16th tick: on-beat 16ths louder; 16th 14 (the last
 *  offbeat) rings 160 ms as the "open" tick, still inside the 176 ms
 *  grid. */
function snTickPoints(): CurvePoint[] {
  const points: CurvePoint[] = [curvePoint(0, 0)];
  for (const bar of SN_GROOVE_BARS) {
    for (let step = 0; step < 16; step += 1) {
      const hit = snT(bar, step / 4);
      if (step === 14) {
        points.push(curvePoint(hit, 0.35, 'step'));
        points.push(curvePoint(hit + 0.16, 0, 'ease'));
      } else {
        points.push(curvePoint(hit, step % 4 === 0 ? 0.42 : 0.22, 'step'));
        points.push(curvePoint(hit + 0.03, 0, 'ease'));
      }
    }
  }
  return points;
}

/** Star pings: two per even bar, three per odd bar. Dreamy, not sharp
 *  (user feedback 2026-09-06): no click — a 30 ms eased swell to a soft
 *  peak, then a long eased fall over 0.78 s; the closest pair is 0.88 s
 *  apart so tails never overlap the next swell, and the bar-15 tail is
 *  clamped to end before the loop wraps. */
const SN_PING_SWELL_SECONDS = 0.03;
const SN_PING_FALL_SECONDS = 0.78;

function snPingPoints(): { pitch: CurvePoint[]; amp: CurvePoint[] } {
  const pitch: CurvePoint[] = [];
  const amp: CurvePoint[] = [curvePoint(0, 0)];
  for (const bar of SN_GROOVE_BARS) {
    const chord = SN_CHORDS[bar];
    const beats = bar % 2 === 0 ? [1.5, 3.25] : [0.75, 2, 3.25];
    beats.forEach((beat, index) => {
      const hit = snT(bar, beat);
      const tailEnd = Math.min(
        hit + SN_PING_FALL_SECONDS,
        SN_LOOP_SECONDS - 0.02,
      );
      pitch.push(
        curvePoint(hit, noteHz(SN_PINGS[chord][index]), 'step', 'step'),
      );
      amp.push(curvePoint(hit, 0, 'step', 'ease'));
      amp.push(curvePoint(hit + SN_PING_SWELL_SECONDS, 0.2, 'ease', 'ease'));
      amp.push(curvePoint(tailEnd, 0, 'ease', 'linear'));
    });
  }
  return { pitch, amp };
}

const snPings = snPingPoints();

const starryNightTimeline: TimelineDocument = {
  version: 1,
  durationSec: SN_LOOP_SECONDS,
  loop: true,
  curves: [
    orchestraCurve(
      'crv_snPadLow',
      'pad low Hz',
      '#6366f1',
      noteHz(-18),
      snPadVoicePoints(0),
    ),
    orchestraCurve(
      'crv_snPadMid',
      'pad mid Hz',
      '#818cf8',
      noteHz(-15),
      snPadVoicePoints(1),
    ),
    orchestraCurve(
      'crv_snPadHigh',
      'pad high Hz',
      '#a5b4fc',
      noteHz(-11),
      snPadVoicePoints(2),
    ),
    // Pad Amp: fades in over the first bar and eases back for the loop seam
    // (the voices carry their own fitted level; this is expression).
    orchestraCurve('crv_snPadLevel', 'pad level', '#a3e635', 0.9, [
      curvePoint(0, 0.35, 'ease', 'ease'),
      curvePoint(snT(1, 0), 0.9, 'ease', 'linear'),
      curvePoint(snT(15, 2), 0.9, 'linear', 'ease'),
      curvePoint(SN_LOOP_SECONDS, 0.35, 'ease', 'ease'),
    ]),
    orchestraCurve('crv_snPadGate', 'pad gate', '#e879f9', 0, snPadGatePoints()),
    // Drone Amp: swells in, sits under the groove, lifts in the breakdown
    // where it carries the bed, eases back for the seam.
    orchestraCurve('crv_snDroneLevel', 'drone level', '#38bdf8', 0.05, [
      curvePoint(0, 0.05, 'ease', 'ease'),
      curvePoint(snT(1, 0), 0.35, 'ease', 'linear'),
      curvePoint(snT(10, 0), 0.35, 'linear', 'ease'),
      curvePoint(snT(10, 2), 0.5, 'ease', 'linear'),
      curvePoint(snT(14, 0), 0.5, 'linear', 'ease'),
      curvePoint(snT(14, 2), 0.35, 'ease', 'linear'),
      curvePoint(snT(15, 2), 0.35, 'linear', 'ease'),
      curvePoint(SN_LOOP_SECONDS, 0.05, 'ease', 'ease'),
    ]),
    // The slow opening across the groove, shut for the breakdown, a
    // faster re-opening on the return.
    orchestraCurve('crv_snPadCutoff', 'pad cutoff', '#facc15', 320, [
      curvePoint(0, 320, 'ease', 'ease'),
      curvePoint(snT(2, 0), 520, 'ease', 'ease'),
      curvePoint(snT(10, 0), 2200, 'ease', 'ease'),
      curvePoint(snT(10, 2), 620, 'ease', 'linear'),
      curvePoint(snT(14, 0), 620, 'linear', 'ease'),
      curvePoint(snT(15, 0), 1900, 'ease', 'ease'),
      curvePoint(SN_LOOP_SECONDS, 320, 'ease', 'ease'),
    ]),
    orchestraCurve(
      'crv_snSubPitch',
      'sub Hz',
      '#f97316',
      noteHz(-30),
      snSubPitchPoints(),
    ),
    // Enters at bar 1, drops out for the breakdown (40 ms fade — a sub
    // sine cut hard would click), returns with the bar-14 kick.
    orchestraCurve('crv_snSubLevel', 'sub level', '#fb923c', 0, [
      curvePoint(0, 0, 'ease', 'ease'),
      curvePoint(snT(1, 0), 0.55, 'ease', 'linear'),
      curvePoint(snT(10, 0) - 0.04, 0.55, 'linear', 'ease'),
      curvePoint(snT(10, 0), 0, 'ease', 'linear'),
      curvePoint(snT(14, 0), 0, 'linear', 'linear'),
      curvePoint(snT(14, 0) + 0.02, 0.55, 'linear', 'linear'),
      curvePoint(SN_LOOP_SECONDS - 0.35, 0.55, 'linear', 'ease'),
      curvePoint(SN_LOOP_SECONDS, 0, 'ease', 'ease'),
    ]),
    orchestraCurve('crv_snKickAmp', 'kick amp', '#fb7185', 0, snKickAmpPoints()),
    orchestraCurve(
      'crv_snKickPitch',
      'kick pitch',
      '#c084fc',
      54,
      snKickPitchPoints(),
    ),
    orchestraCurve('crv_snTickAmp', 'tick amp', '#f472b6', 0, snTickPoints()),
    orchestraCurve(
      'crv_snPingPitch',
      'ping Hz',
      '#34d399',
      noteHz(9),
      snPings.pitch,
    ),
    orchestraCurve('crv_snPingAmp', 'ping amp', '#2dd4bf', 0, snPings.amp),
  ],
};

const demoTimelineDocuments: Record<string, TimelineDocument> = {
  curveOrchestra: curveOrchestraTimeline,
  pianoFluteOrchestra: pianoFluteTimeline,
  bellClub: bellClubTimeline,
  neonDrop: neonDropTimeline,
  filterRush: filterRushTimeline,
  starryNight: starryNightTimeline,
  guitarSolo: guitarSoloTimeline,
  violinSolo: violinSoloTimeline,
  violinCaprice: violinCapriceTimeline,
  fluteSolo: fluteSoloTimeline,
  padSolo: padSoloTimeline,
  vampireSoloExtended: vampireSoloExtendedTimeline,
};

function curveNode(
  id: string,
  y: number,
  curveId: string,
): NodeSpec {
  return {
    id,
    type: 'timelineCurve',
    x: 40,
    y,
    values: { Curve: makeTimelineCurveRef(curveId) },
  };
}

function buildCurveOrchestraGraph(): ProbeState {
  return buildState(
    [
      // The score: one Timeline Curve node per lane.
      curveNode('co-cPadCutoff', 40, 'crv_padCutoff'),
      curveNode('co-cGate', 360, 'crv_gate'),
      curveNode('co-cKickAmp', 680, 'crv_kickAmp'),
      curveNode('co-cKickPitch', 1000, 'crv_kickPitch'),
      curveNode('co-cMelody', 1320, 'crv_melody'),
      curveNode('co-cMelodyLevel', 1640, 'crv_melodyLevel'),

      // Tension pad: saw through the arc-swept lowpass — the bed voice.
      {
        id: 'co-pad',
        type: 'drawnOsc',
        x: 620,
        y: 760,
        values: { Waveform: padWave, Frequency: 110, Level: 0.3 },
      },
      {
        id: 'co-padFilter',
        type: 'filter',
        x: 1180,
        y: 780,
        values: { Type: 'lowpass', Q: 1.1 },
      },
      // Trance-gate pulse: narrow pulse through a bandpass, chopped by the
      // gate curve on a Gain node.
      {
        id: 'co-pulse',
        type: 'drawnOsc',
        x: 620,
        y: 1140,
        values: { Waveform: narrowPulse(0.25), Frequency: 220, Level: 0.5 },
      },
      {
        id: 'co-pulseFilter',
        type: 'filter',
        x: 1180,
        y: 1160,
        values: { Type: 'bandpass', Freq: 900, Q: 1.5 },
      },
      { id: 'co-gate', type: 'gain', x: 1740, y: 1180 },
      // Curve-synthesized kick: both envelope AND pitch drop are lanes.
      {
        id: 'co-kick',
        type: 'oscillator',
        x: 620,
        y: 1520,
        values: { Shape: 'sine' },
      },
      // Berlin lead: triangle, frequency stepped by the melody lane,
      // phrased by its level lane, echoed at a dotted 8th.
      {
        id: 'co-lead',
        type: 'oscillator',
        x: 620,
        y: 1880,
        values: { Shape: 'triangle' },
      },
      {
        id: 'co-echo',
        type: 'pingPongDelay',
        x: 1180,
        y: 1900,
        values: { 'Time s': 0.375, Feedback: 0.35, Wet: 0.35 },
      },
      // Master: sum → gentle saturation → hall → render.
      { id: 'co-mix', type: 'mix', x: 2300, y: 1000 },
      {
        id: 'co-sat',
        type: 'saturator',
        x: 2740,
        y: 1000,
        values: { Drive: 1.4, Trim: 0.85, Wet: 0.3 },
      },
      {
        id: 'co-verb',
        type: 'reverb',
        x: 3180,
        y: 1000,
        values: { 'Decay s': 6, 'PreDelay s': 0.03, Wet: 0.38 },
      },
      {
        id: 'co-render',
        type: 'render',
        x: 3620,
        y: 1020,
        values: { 'Level dB': -5 },
      },
    ],
    [
      // Score → voices.
      {
        from: 'co-cPadCutoff',
        output: 'Signal',
        to: 'co-padFilter',
        input: 'Freq',
      },
      { from: 'co-cGate', output: 'Signal', to: 'co-gate', input: 'Gain' },
      { from: 'co-cKickAmp', output: 'Signal', to: 'co-kick', input: 'Level' },
      {
        from: 'co-cKickPitch',
        output: 'Signal',
        to: 'co-kick',
        input: 'Frequency',
      },
      {
        from: 'co-cMelody',
        output: 'Signal',
        to: 'co-lead',
        input: 'Frequency',
      },
      {
        from: 'co-cMelodyLevel',
        output: 'Signal',
        to: 'co-lead',
        input: 'Level',
      },
      // Voices → master.
      { from: 'co-pad', output: 'Out', to: 'co-padFilter', input: 'In' },
      { from: 'co-padFilter', output: 'Out', to: 'co-mix', input: 'In' },
      { from: 'co-pulse', output: 'Out', to: 'co-pulseFilter', input: 'In' },
      { from: 'co-pulseFilter', output: 'Out', to: 'co-gate', input: 'In' },
      { from: 'co-gate', output: 'Out', to: 'co-mix', input: 'In' },
      { from: 'co-kick', output: 'Out', to: 'co-mix', input: 'In' },
      { from: 'co-lead', output: 'Out', to: 'co-echo', input: 'In' },
      { from: 'co-echo', output: 'Out', to: 'co-mix', input: 'In' },
      { from: 'co-mix', output: 'Out', to: 'co-sat', input: 'In' },
      { from: 'co-sat', output: 'Out', to: 'co-verb', input: 'In' },
      { from: 'co-verb', output: 'Out', to: 'co-render', input: 'In' },
    ],
  );
}

/** Piano voice = the tricord recipe (pianoWave
 *  drawn spectrum + lowpass 3200), struck by its amp lane; flute voice =
 *  the flute demo's recipe (triangle + bandpassed pink-noise breath +
 *  vibrato), breathing through its amp lane with curve-driven vibrato
 *  DEPTH for the delayed-onset bloom. Flute louder than piano (melody
 *  over accompaniment), both into the large-hall chain (early
 *  reflections → `Decay s` 6.5, which is a real T60 of 2.6 s, NOT 6.5 s
 *  → air-absorption lowpass). See the law in `effectTable.ts`. */
function buildPianoFluteOrchestraGraph(): ProbeState {
  return buildState(
    [
      // The score: one Timeline Curve node per lane.
      curveNode('pf-cLhPitch', 40, 'crv_pfLhPitch'),
      curveNode('pf-cLhAmp', 360, 'crv_pfLhAmp'),
      curveNode('pf-cRhPitch', 680, 'crv_pfRhPitch'),
      curveNode('pf-cRhAmp', 1000, 'crv_pfRhAmp'),
      curveNode('pf-cFlPitch', 1320, 'crv_pfFlutePitch'),
      curveNode('pf-cFlAmp', 1640, 'crv_pfFluteAmp'),
      curveNode('pf-cFlVib', 1960, 'crv_pfFluteVib'),
      curveNode('pf-cBright', 2280, 'crv_pfPianoBright'),

      // Piano left hand (Alberti bass) and right hand (answers).
      {
        id: 'pf-lhOsc',
        type: 'drawnOsc',
        x: 620,
        y: 200,
        values: { Waveform: pianoWave, Level: 0.5 },
      },
      { id: 'pf-lhGain', type: 'gain', x: 1180, y: 220 },
      {
        id: 'pf-rhOsc',
        type: 'drawnOsc',
        x: 620,
        y: 560,
        values: { Waveform: pianoWave, Level: 0.5 },
      },
      { id: 'pf-rhGain', type: 'gain', x: 1180, y: 580 },
      { id: 'pf-pianoBus', type: 'mix', x: 1740, y: 400 },
      {
        id: 'pf-pianoFilter',
        type: 'filter',
        x: 2180,
        y: 400,
        // Freq rides the hammer-brightness lane.
        values: { Type: 'lowpass', Q: 0.5 },
      },

      // Flute: tone + breath noise, phrased by the breath lane.
      {
        id: 'pf-fluteOsc',
        type: 'drawnOsc',
        x: 620,
        y: 980,
        values: { Waveform: triangleWave, Level: 0.85 },
      },
      {
        id: 'pf-fluteNoise',
        type: 'noise',
        x: 620,
        y: 1340,
        values: { Type: 'pink', Level: 0.075 },
      },
      {
        id: 'pf-breathBand',
        type: 'filter',
        x: 1180,
        y: 1360,
        values: { Type: 'bandpass', Freq: 2500, Q: 1.5 },
      },
      { id: 'pf-fluteMix', type: 'mix', x: 1740, y: 1100 },
      {
        id: 'pf-fluteTone',
        type: 'filter',
        x: 2180,
        y: 1100,
        // A little more air than the standalone flute patch.
        values: { Type: 'lowpass', Freq: 3100, Q: 0.6 },
      },
      { id: 'pf-fluteGain', type: 'gain', x: 2620, y: 1100 },
      {
        id: 'pf-vibrato',
        type: 'vibrato',
        x: 3060,
        y: 1100,
        values: { 'Rate Hz': 5.3, Wet: 1 },
      },

      // Master: LARGE-hall chain. Three stages, matching how halls actually
      // work: dense EARLY REFLECTIONS (an ~85 ms low-feedback delay —
      // the first wall bounces that tell the ear "big room"), then a
      // LONG generous tail (`Decay s` 6.5 = a real T60 of 2.6 s, wet 0.6 —
      // past critical distance the reverberant field rivals the direct
      // sound), then AIR ABSORPTION
      // (a lowpass darkening the tail — halls eat highs over distance).
      { id: 'pf-mix', type: 'mix', x: 3500, y: 700 },
      {
        id: 'pf-early',
        type: 'feedbackDelay',
        x: 3800,
        y: 700,
        values: { 'Time s': 0.085, Feedback: 0.25, Wet: 0.3 },
      },
      {
        id: 'pf-verb',
        type: 'reverb',
        x: 4100,
        y: 700,
        values: { 'Decay s': 6.5, 'PreDelay s': 0.025, Wet: 0.6 },
      },
      {
        id: 'pf-air',
        type: 'filter',
        x: 4400,
        y: 710,
        values: { Type: 'lowpass', Freq: 4200, Q: 0.4 },
      },
      {
        id: 'pf-render',
        type: 'render',
        x: 4700,
        y: 720,
        values: { 'Level dB': -5 },
      },
    ],
    [
      // Score → voices.
      {
        from: 'pf-cLhPitch',
        output: 'Signal',
        to: 'pf-lhOsc',
        input: 'Frequency',
      },
      { from: 'pf-cLhAmp', output: 'Signal', to: 'pf-lhGain', input: 'Gain' },
      {
        from: 'pf-cRhPitch',
        output: 'Signal',
        to: 'pf-rhOsc',
        input: 'Frequency',
      },
      { from: 'pf-cRhAmp', output: 'Signal', to: 'pf-rhGain', input: 'Gain' },
      {
        from: 'pf-cFlPitch',
        output: 'Signal',
        to: 'pf-fluteOsc',
        input: 'Frequency',
      },
      {
        from: 'pf-cFlAmp',
        output: 'Signal',
        to: 'pf-fluteGain',
        input: 'Gain',
      },
      { from: 'pf-cFlVib', output: 'Signal', to: 'pf-vibrato', input: 'Depth' },
      {
        from: 'pf-cBright',
        output: 'Signal',
        to: 'pf-pianoFilter',
        input: 'Freq',
      },
      // Piano voices → piano bus → mix.
      { from: 'pf-lhOsc', output: 'Out', to: 'pf-lhGain', input: 'In' },
      { from: 'pf-lhGain', output: 'Out', to: 'pf-pianoBus', input: 'In' },
      { from: 'pf-rhOsc', output: 'Out', to: 'pf-rhGain', input: 'In' },
      { from: 'pf-rhGain', output: 'Out', to: 'pf-pianoBus', input: 'In' },
      { from: 'pf-pianoBus', output: 'Out', to: 'pf-pianoFilter', input: 'In' },
      { from: 'pf-pianoFilter', output: 'Out', to: 'pf-mix', input: 'In' },
      // Flute chain → mix.
      { from: 'pf-fluteOsc', output: 'Out', to: 'pf-fluteMix', input: 'In' },
      { from: 'pf-fluteNoise', output: 'Out', to: 'pf-breathBand', input: 'In' },
      { from: 'pf-breathBand', output: 'Out', to: 'pf-fluteMix', input: 'In' },
      { from: 'pf-fluteMix', output: 'Out', to: 'pf-fluteTone', input: 'In' },
      { from: 'pf-fluteTone', output: 'Out', to: 'pf-fluteGain', input: 'In' },
      { from: 'pf-fluteGain', output: 'Out', to: 'pf-vibrato', input: 'In' },
      { from: 'pf-vibrato', output: 'Out', to: 'pf-mix', input: 'In' },
      // Master: early reflections → hall tail → air absorption.
      { from: 'pf-mix', output: 'Out', to: 'pf-early', input: 'In' },
      { from: 'pf-early', output: 'Out', to: 'pf-verb', input: 'In' },
      { from: 'pf-verb', output: 'Out', to: 'pf-air', input: 'In' },
      { from: 'pf-air', output: 'Out', to: 'pf-render', input: 'In' },
    ],
  );
}

function buildBellClubGraph(): ProbeState {
  return buildState(
    [
      curveNode('bc-cKickAmp', 40, 'crv_bcKickAmp'),
      curveNode('bc-cKickPitch', 360, 'crv_bcKickPitch'),
      curveNode('bc-cBellPitch', 680, 'crv_bcBellPitch'),
      curveNode('bc-cBellAmp', 1000, 'crv_bcBellAmp'),
      curveNode('bc-cBassPitch', 1320, 'crv_bcBassPitch'),
      curveNode('bc-cBassAmp', 1640, 'crv_bcBassAmp'),
      curveNode('bc-cSqueakPitch', 1960, 'crv_bcSqueakPitch'),
      curveNode('bc-cSqueakAmp', 2280, 'crv_bcSqueakAmp'),
      curveNode('bc-cHatAmp', 2600, 'crv_bcHatAmp'),
      curveNode('bc-cPadPitch', 2920, 'crv_bcPadPitch'),
      curveNode('bc-cPadAmp', 3240, 'crv_bcPadAmp'),

      // Music box: warm bell partials → a TOUCH of bit crush → echo.
      {
        id: 'bc-bell',
        type: 'drawnOsc',
        x: 620,
        y: 200,
        values: { Waveform: bellWave, Level: 0.45 },
      },
      {
        id: 'bc-bellCrush',
        type: 'bitCrusher',
        x: 1180,
        y: 220,
        values: { Bits: 8, Wet: 0.15 },
      },
      {
        id: 'bc-bellEcho',
        type: 'pingPongDelay',
        x: 1740,
        y: 220,
        values: { 'Time s': 0.338, Feedback: 0.28, Wet: 0.22 },
      },
      // Warm pad bed on the drawn pad wave, tucked low.
      {
        id: 'bc-pad',
        type: 'drawnOsc',
        x: 620,
        y: 1980,
        values: { Waveform: padWave },
      },
      {
        id: 'bc-padLP',
        type: 'filter',
        x: 1180,
        y: 2000,
        values: { Type: 'lowpass', Freq: 1100, Q: 0.7 },
      },
      // Curve-synthesized club kick.
      {
        id: 'bc-kick',
        type: 'oscillator',
        x: 620,
        y: 560,
        values: { Shape: 'sine' },
      },
      // Sub bass with a bit of drive.
      {
        id: 'bc-bass',
        type: 'oscillator',
        x: 620,
        y: 920,
        values: { Shape: 'sine' },
      },
      {
        id: 'bc-bassDrive',
        type: 'saturator',
        x: 1180,
        y: 940,
        values: { Drive: 1.8, Trim: 0.9, Wet: 0.5 },
      },
      // Bed squeak: sine flick through a mid-high bandpass.
      {
        id: 'bc-squeak',
        type: 'oscillator',
        x: 620,
        y: 1280,
        values: { Shape: 'sine' },
      },
      {
        id: 'bc-squeakBP',
        type: 'filter',
        x: 1180,
        y: 1300,
        values: { Type: 'bandpass', Freq: 1400, Q: 1 },
      },
      // Hats: highpassed noise bursts.
      {
        id: 'bc-hatNoise',
        type: 'noise',
        x: 620,
        y: 1640,
        values: { Type: 'white' },
      },
      {
        id: 'bc-hatHP',
        type: 'filter',
        x: 1180,
        y: 1660,
        values: { Type: 'highpass', Freq: 7000, Q: 0.7 },
      },
      { id: 'bc-mix', type: 'mix', x: 2300, y: 900 },
      {
        id: 'bc-sat',
        type: 'saturator',
        x: 2740,
        y: 900,
        values: { Drive: 1.3, Trim: 0.85, Wet: 0.25 },
      },
      {
        id: 'bc-verb',
        type: 'reverb',
        x: 3180,
        y: 900,
        values: { 'Decay s': 1.6, 'PreDelay s': 0.012, Wet: 0.16 },
      },
      {
        id: 'bc-render',
        type: 'render',
        x: 3620,
        y: 920,
        values: { 'Level dB': -5 },
      },
    ],
    [
      { from: 'bc-cKickAmp', output: 'Signal', to: 'bc-kick', input: 'Level' },
      {
        from: 'bc-cKickPitch',
        output: 'Signal',
        to: 'bc-kick',
        input: 'Frequency',
      },
      {
        from: 'bc-cBellPitch',
        output: 'Signal',
        to: 'bc-bell',
        input: 'Frequency',
      },
      { from: 'bc-cBellAmp', output: 'Signal', to: 'bc-bell', input: 'Level' },
      {
        from: 'bc-cBassPitch',
        output: 'Signal',
        to: 'bc-bass',
        input: 'Frequency',
      },
      { from: 'bc-cBassAmp', output: 'Signal', to: 'bc-bass', input: 'Level' },
      {
        from: 'bc-cSqueakPitch',
        output: 'Signal',
        to: 'bc-squeak',
        input: 'Frequency',
      },
      {
        from: 'bc-cSqueakAmp',
        output: 'Signal',
        to: 'bc-squeak',
        input: 'Level',
      },
      {
        from: 'bc-cHatAmp',
        output: 'Signal',
        to: 'bc-hatNoise',
        input: 'Level',
      },
      {
        from: 'bc-cPadPitch',
        output: 'Signal',
        to: 'bc-pad',
        input: 'Frequency',
      },
      { from: 'bc-cPadAmp', output: 'Signal', to: 'bc-pad', input: 'Level' },
      { from: 'bc-pad', output: 'Out', to: 'bc-padLP', input: 'In' },
      { from: 'bc-padLP', output: 'Out', to: 'bc-mix', input: 'In' },
      { from: 'bc-bell', output: 'Out', to: 'bc-bellCrush', input: 'In' },
      { from: 'bc-bellCrush', output: 'Out', to: 'bc-bellEcho', input: 'In' },
      { from: 'bc-bellEcho', output: 'Out', to: 'bc-mix', input: 'In' },
      { from: 'bc-kick', output: 'Out', to: 'bc-mix', input: 'In' },
      { from: 'bc-bass', output: 'Out', to: 'bc-bassDrive', input: 'In' },
      { from: 'bc-bassDrive', output: 'Out', to: 'bc-mix', input: 'In' },
      { from: 'bc-squeak', output: 'Out', to: 'bc-squeakBP', input: 'In' },
      { from: 'bc-squeakBP', output: 'Out', to: 'bc-mix', input: 'In' },
      { from: 'bc-hatNoise', output: 'Out', to: 'bc-hatHP', input: 'In' },
      { from: 'bc-hatHP', output: 'Out', to: 'bc-mix', input: 'In' },
      { from: 'bc-mix', output: 'Out', to: 'bc-sat', input: 'In' },
      { from: 'bc-sat', output: 'Out', to: 'bc-verb', input: 'In' },
      { from: 'bc-verb', output: 'Out', to: 'bc-render', input: 'In' },
    ],
  );
}

function buildNeonDropGraph(): ProbeState {
  return buildState(
    [
      curveNode('nd-cKickAmp', 40, 'crv_ndKickAmp'),
      curveNode('nd-cKickPitch', 360, 'crv_ndKickPitch'),
      curveNode('nd-cBassPitch', 680, 'crv_ndBassPitch'),
      curveNode('nd-cBassAmp', 1000, 'crv_ndBassAmp'),
      curveNode('nd-cPluckPitch', 1320, 'crv_ndPluckPitch'),
      curveNode('nd-cPluckAmp', 1640, 'crv_ndPluckAmp'),
      curveNode('nd-cHatAmp', 1960, 'crv_ndHatAmp'),
      curveNode('nd-cSnareAmp', 2280, 'crv_ndSnareAmp'),
      curveNode('nd-cSubPitch', 2600, 'crv_ndSubPitch'),
      curveNode('nd-cSubAmp', 2920, 'crv_ndSubAmp'),
      curveNode('nd-cVoxPitch', 3240, 'crv_ndVoxPitch'),
      curveNode('nd-cVoxAmp', 3560, 'crv_ndVoxAmp'),
      curveNode('nd-cVoxFormant', 3880, 'crv_ndVoxFormant'),

      {
        id: 'nd-kick',
        type: 'oscillator',
        x: 620,
        y: 200,
        values: { Shape: 'sine' },
      },
      // The sticky funk bass: rounded saw, no resonance games.
      {
        id: 'nd-bass',
        type: 'oscillator',
        x: 620,
        y: 560,
        values: { Shape: 'sawtooth' },
      },
      {
        id: 'nd-bassLP',
        type: 'filter',
        x: 1180,
        y: 580,
        values: { Type: 'lowpass', Freq: 700, Q: 0.9 },
      },
      // Retro offbeat plucks, gently rounded.
      {
        id: 'nd-pluck',
        type: 'oscillator',
        x: 620,
        y: 920,
        values: { Shape: 'sawtooth' },
      },
      {
        id: 'nd-pluckLP',
        type: 'filter',
        x: 1180,
        y: 940,
        values: { Type: 'lowpass', Freq: 2600, Q: 0.8 },
      },
      // Hats + build riser share this noise voice.
      {
        id: 'nd-hatNoise',
        type: 'noise',
        x: 620,
        y: 1280,
        values: { Type: 'white' },
      },
      {
        id: 'nd-hatHP',
        type: 'filter',
        x: 1180,
        y: 1300,
        values: { Type: 'highpass', Freq: 6500, Q: 0.7 },
      },
      // Build roll: bandpassed noise bursts.
      {
        id: 'nd-snareNoise',
        type: 'noise',
        x: 620,
        y: 1640,
        values: { Type: 'white' },
      },
      {
        id: 'nd-snareBP',
        type: 'filter',
        x: 1180,
        y: 1660,
        values: { Type: 'bandpass', Freq: 1800, Q: 1.2 },
      },
      // Heavy 808 — driven sine, curve-glided pitch.
      {
        id: 'nd-sub',
        type: 'oscillator',
        x: 620,
        y: 2000,
        values: { Shape: 'sine' },
      },
      {
        id: 'nd-subDrive',
        type: 'saturator',
        x: 1180,
        y: 2020,
        values: { Drive: 2.2, Trim: 0.8, Wet: 0.7 },
      },
      // The chant — pulse through a jumping formant bandpass.
      {
        id: 'nd-vox',
        type: 'drawnOsc',
        x: 620,
        y: 2360,
        values: { Waveform: narrowPulse(0.5), Level: 0.6 },
      },
      {
        id: 'nd-voxBP',
        type: 'filter',
        x: 1180,
        y: 2380,
        values: { Type: 'bandpass', Q: 3.5 },
      },
      { id: 'nd-mix', type: 'mix', x: 2300, y: 1100 },
      {
        id: 'nd-sat',
        type: 'saturator',
        x: 2740,
        y: 1100,
        values: { Drive: 1.5, Trim: 0.85, Wet: 0.25 },
      },
      {
        id: 'nd-verb',
        type: 'reverb',
        x: 3180,
        y: 1100,
        values: { 'Decay s': 1.4, 'PreDelay s': 0.015, Wet: 0.2 },
      },
      {
        id: 'nd-render',
        type: 'render',
        x: 3620,
        y: 1120,
        values: { 'Level dB': -5 },
      },
    ],
    [
      { from: 'nd-cKickAmp', output: 'Signal', to: 'nd-kick', input: 'Level' },
      {
        from: 'nd-cKickPitch',
        output: 'Signal',
        to: 'nd-kick',
        input: 'Frequency',
      },
      {
        from: 'nd-cBassPitch',
        output: 'Signal',
        to: 'nd-bass',
        input: 'Frequency',
      },
      { from: 'nd-cBassAmp', output: 'Signal', to: 'nd-bass', input: 'Level' },
      {
        from: 'nd-cPluckPitch',
        output: 'Signal',
        to: 'nd-pluck',
        input: 'Frequency',
      },
      {
        from: 'nd-cPluckAmp',
        output: 'Signal',
        to: 'nd-pluck',
        input: 'Level',
      },
      {
        from: 'nd-cHatAmp',
        output: 'Signal',
        to: 'nd-hatNoise',
        input: 'Level',
      },
      {
        from: 'nd-cSnareAmp',
        output: 'Signal',
        to: 'nd-snareNoise',
        input: 'Level',
      },
      {
        from: 'nd-cSubPitch',
        output: 'Signal',
        to: 'nd-sub',
        input: 'Frequency',
      },
      { from: 'nd-cSubAmp', output: 'Signal', to: 'nd-sub', input: 'Level' },
      {
        from: 'nd-cVoxPitch',
        output: 'Signal',
        to: 'nd-vox',
        input: 'Frequency',
      },
      { from: 'nd-cVoxAmp', output: 'Signal', to: 'nd-vox', input: 'Level' },
      {
        from: 'nd-cVoxFormant',
        output: 'Signal',
        to: 'nd-voxBP',
        input: 'Freq',
      },
      { from: 'nd-kick', output: 'Out', to: 'nd-mix', input: 'In' },
      { from: 'nd-bass', output: 'Out', to: 'nd-bassLP', input: 'In' },
      { from: 'nd-bassLP', output: 'Out', to: 'nd-mix', input: 'In' },
      { from: 'nd-pluck', output: 'Out', to: 'nd-pluckLP', input: 'In' },
      { from: 'nd-pluckLP', output: 'Out', to: 'nd-mix', input: 'In' },
      { from: 'nd-hatNoise', output: 'Out', to: 'nd-hatHP', input: 'In' },
      { from: 'nd-hatHP', output: 'Out', to: 'nd-mix', input: 'In' },
      { from: 'nd-snareNoise', output: 'Out', to: 'nd-snareBP', input: 'In' },
      { from: 'nd-snareBP', output: 'Out', to: 'nd-mix', input: 'In' },
      { from: 'nd-sub', output: 'Out', to: 'nd-subDrive', input: 'In' },
      { from: 'nd-subDrive', output: 'Out', to: 'nd-mix', input: 'In' },
      { from: 'nd-vox', output: 'Out', to: 'nd-voxBP', input: 'In' },
      { from: 'nd-voxBP', output: 'Out', to: 'nd-mix', input: 'In' },
      { from: 'nd-mix', output: 'Out', to: 'nd-sat', input: 'In' },
      { from: 'nd-sat', output: 'Out', to: 'nd-verb', input: 'In' },
      { from: 'nd-verb', output: 'Out', to: 'nd-render', input: 'In' },
    ],
  );
}

function buildFilterRushGraph(): ProbeState {
  return buildState(
    [
      curveNode('fr-cKickAmp', 40, 'crv_frKickAmp'),
      curveNode('fr-cKickPitch', 360, 'crv_frKickPitch'),
      curveNode('fr-cBassPitch', 680, 'crv_frBassPitch'),
      curveNode('fr-cBassAmp', 1000, 'crv_frBassAmp'),
      curveNode('fr-cArpPitch', 1320, 'crv_frArpPitch'),
      curveNode('fr-cArpGate', 1640, 'crv_frArpGate'),
      curveNode('fr-cClapAmp', 1960, 'crv_frClapAmp'),
      curveNode('fr-cLpFreq', 2280, 'crv_frLpFreq'),
      curveNode('fr-cHpFreq', 2600, 'crv_frHpFreq'),
      curveNode('fr-cPan', 2920, 'crv_frPan'),
      curveNode('fr-cWobble', 3240, 'crv_frWobble'),

      {
        id: 'fr-kick',
        type: 'oscillator',
        x: 620,
        y: 200,
        values: { Shape: 'sine' },
      },
      // Clean sine sub — no filter, no drive.
      {
        id: 'fr-sub',
        type: 'oscillator',
        x: 620,
        y: 560,
        values: { Shape: 'sine' },
      },
      // Clean triangle arp lead.
      {
        id: 'fr-arp',
        type: 'oscillator',
        x: 620,
        y: 920,
        values: { Shape: 'triangle' },
      },
      {
        id: 'fr-clapNoise',
        type: 'noise',
        x: 620,
        y: 1280,
        values: { Type: 'white' },
      },
      {
        id: 'fr-clapBP',
        type: 'filter',
        x: 1180,
        y: 1300,
        values: { Type: 'bandpass', Freq: 1500, Q: 1.1 },
      },
      // The finger-in-the-ear chain, on the WHOLE mix: sweeping lowpass
      // → counter-sweeping highpass → pan sway → amplitude wobble.
      { id: 'fr-mix', type: 'mix', x: 1740, y: 700 },
      {
        id: 'fr-earLP',
        type: 'filter',
        x: 2180,
        y: 700,
        values: { Type: 'lowpass', Q: 1.1 },
      },
      {
        id: 'fr-earHP',
        type: 'filter',
        x: 2620,
        y: 700,
        values: { Type: 'highpass', Q: 0.9 },
      },
      { id: 'fr-earPan', type: 'pan', x: 3060, y: 700 },
      { id: 'fr-earWobble', type: 'gain', x: 3500, y: 700 },
      {
        id: 'fr-verb',
        type: 'reverb',
        x: 3940,
        y: 700,
        values: { 'Decay s': 1.2, 'PreDelay s': 0.01, Wet: 0.15 },
      },
      {
        id: 'fr-render',
        type: 'render',
        x: 4380,
        y: 720,
        values: { 'Level dB': -5 },
      },
    ],
    [
      { from: 'fr-cKickAmp', output: 'Signal', to: 'fr-kick', input: 'Level' },
      {
        from: 'fr-cKickPitch',
        output: 'Signal',
        to: 'fr-kick',
        input: 'Frequency',
      },
      {
        from: 'fr-cBassPitch',
        output: 'Signal',
        to: 'fr-sub',
        input: 'Frequency',
      },
      { from: 'fr-cBassAmp', output: 'Signal', to: 'fr-sub', input: 'Level' },
      {
        from: 'fr-cArpPitch',
        output: 'Signal',
        to: 'fr-arp',
        input: 'Frequency',
      },
      { from: 'fr-cArpGate', output: 'Signal', to: 'fr-arp', input: 'Level' },
      {
        from: 'fr-cClapAmp',
        output: 'Signal',
        to: 'fr-clapNoise',
        input: 'Level',
      },
      { from: 'fr-cLpFreq', output: 'Signal', to: 'fr-earLP', input: 'Freq' },
      { from: 'fr-cHpFreq', output: 'Signal', to: 'fr-earHP', input: 'Freq' },
      { from: 'fr-cPan', output: 'Signal', to: 'fr-earPan', input: 'Pan' },
      {
        from: 'fr-cWobble',
        output: 'Signal',
        to: 'fr-earWobble',
        input: 'Gain',
      },
      { from: 'fr-kick', output: 'Out', to: 'fr-mix', input: 'In' },
      { from: 'fr-sub', output: 'Out', to: 'fr-mix', input: 'In' },
      { from: 'fr-arp', output: 'Out', to: 'fr-mix', input: 'In' },
      { from: 'fr-clapNoise', output: 'Out', to: 'fr-clapBP', input: 'In' },
      { from: 'fr-clapBP', output: 'Out', to: 'fr-mix', input: 'In' },
      { from: 'fr-mix', output: 'Out', to: 'fr-earLP', input: 'In' },
      { from: 'fr-earLP', output: 'Out', to: 'fr-earHP', input: 'In' },
      { from: 'fr-earHP', output: 'Out', to: 'fr-earPan', input: 'In' },
      { from: 'fr-earPan', output: 'Out', to: 'fr-earWobble', input: 'In' },
      { from: 'fr-earWobble', output: 'Out', to: 'fr-verb', input: 'In' },
      { from: 'fr-verb', output: 'Out', to: 'fr-render', input: 'In' },
    ],
  );
}

/** Starry Night voices (v2): three `inst_starryPad` voices (the measured
 *  Night Pad voice, holding while gated) pitched by the chord lanes, struck
 *  per bar by the gate lane through a Threshold, Amp from the pad-level
 *  lane, summed through the slowly-opening lowpass; two continuous
 *  `inst_starryDrone` voices (the measured drone) on D♯4 and A♯4 with the
 *  drone-level lane on Amp; sine sub on the root lane; curve-synthesised
 *  808 kick; bandpassed white-noise 16th ticks; sine star pings swelled by
 *  their amp lane → 1.6 kHz lowpass → dotted-8th ping-pong → a short hall.
 *  Master: sum → 3.8 kHz "air" lowpass (the measured ceiling) → `Decay s` 3
 *  hall (a real T60 of 1.8 s)
 *  → render. No saturator anywhere on the master: a tanh stage on a chord
 *  plus sub manufactured the sub's 5th and 9th harmonics (G, F) under a
 *  D♯ minor chord — measured, and heard as distortion + dissonance. */
function buildStarryNightGraph(): ProbeState {
  return buildState(
    [
      curveNode('sn-cPadLow', 40, 'crv_snPadLow'),
      curveNode('sn-cPadMid', 360, 'crv_snPadMid'),
      curveNode('sn-cPadHigh', 680, 'crv_snPadHigh'),
      curveNode('sn-cPadLevel', 1000, 'crv_snPadLevel'),
      curveNode('sn-cPadCutoff', 1320, 'crv_snPadCutoff'),
      curveNode('sn-cSubPitch', 1640, 'crv_snSubPitch'),
      curveNode('sn-cSubLevel', 1960, 'crv_snSubLevel'),
      curveNode('sn-cKickAmp', 2280, 'crv_snKickAmp'),
      curveNode('sn-cKickPitch', 2600, 'crv_snKickPitch'),
      curveNode('sn-cTickAmp', 2920, 'crv_snTickAmp'),
      curveNode('sn-cPingPitch', 3240, 'crv_snPingPitch'),
      curveNode('sn-cPingAmp', 3560, 'crv_snPingAmp'),
      curveNode('sn-cPadGate', 3880, 'crv_snPadGate'),
      curveNode('sn-cDroneLevel', 4200, 'crv_snDroneLevel'),

      // Pad: the gate lane → Threshold strikes all three voices per bar.
      {
        id: 'sn-padGate',
        type: 'threshold',
        x: 620,
        y: 40,
        values: { Threshold: 0.5, Hysteresis: 0.1 },
      },
      { id: 'sn-padLow', type: 'inst_starryPad', x: 1180, y: 200 },
      { id: 'sn-padMid', type: 'inst_starryPad', x: 1180, y: 480 },
      { id: 'sn-padHigh', type: 'inst_starryPad', x: 1180, y: 760 },
      { id: 'sn-padMix', type: 'mix', x: 1620, y: 480 },
      {
        id: 'sn-padFilter',
        type: 'filter',
        x: 2060,
        y: 480,
        values: { Type: 'lowpass', Q: 0.9 },
      },
      // Drone: the key's root, deep — D♯3 carries it, D♯4 doubles it at half
      // level (its own trim Gain) — continuous, level lane on Amp. Root only:
      // the drone wave's 3rd harmonic is strong, so a fifth voice would put
      // an F over every F♯. (The first version's D♯4 + D♯3 was "extremely
      // headache inducing"; the instrument itself is now lowpassed at f0.)
      {
        id: 'sn-droneHz1',
        type: 'constant',
        x: 620,
        y: 2560,
        values: { Value: noteHz(-18) },
      },
      {
        id: 'sn-droneHz2',
        type: 'constant',
        x: 620,
        y: 2840,
        values: { Value: noteHz(-6) },
      },
      { id: 'sn-drone1', type: 'inst_starryDrone', x: 1180, y: 2560 },
      { id: 'sn-drone2', type: 'inst_starryDrone', x: 1180, y: 2840 },
      {
        id: 'sn-drone2Trim',
        type: 'gain',
        x: 1620,
        y: 2840,
        values: { Gain: 0.5 },
      },
      // Sub: clean sine on the root lane.
      {
        id: 'sn-sub',
        type: 'oscillator',
        x: 620,
        y: 1120,
        values: { Shape: 'sine' },
      },
      // Kick: envelope AND pitch drop are lanes.
      {
        id: 'sn-kick',
        type: 'oscillator',
        x: 620,
        y: 1480,
        values: { Shape: 'sine' },
      },
      // Ticks: white noise through a narrow band, chopped by the tick lane.
      {
        id: 'sn-tickNoise',
        type: 'noise',
        x: 620,
        y: 1840,
        values: { Type: 'white' },
      },
      {
        id: 'sn-tickBP',
        type: 'filter',
        x: 1180,
        y: 1860,
        values: { Type: 'bandpass', Freq: 2800, Q: 1.6 },
      },
      // Star pings: a sine (no harmonics to bite), rounded further by its
      // own lowpass, a long dotted-8th ping-pong trail, then its own hall
      // BEFORE the master — the wash is what makes them distant.
      {
        id: 'sn-ping',
        type: 'oscillator',
        x: 620,
        y: 2200,
        values: { Shape: 'sine' },
      },
      {
        id: 'sn-pingSoft',
        type: 'filter',
        x: 1180,
        y: 2220,
        values: { Type: 'lowpass', Freq: 1600, Q: 0.6 },
      },
      {
        id: 'sn-pingEcho',
        type: 'pingPongDelay',
        x: 1620,
        y: 2220,
        values: { 'Time s': SN_BEAT * 0.75, Feedback: 0.3, Wet: 0.35 },
      },
      {
        id: 'sn-pingVerb',
        type: 'reverb',
        x: 2060,
        y: 2220,
        values: { 'Decay s': 2.5, 'PreDelay s': 0.02, Wet: 0.35 },
      },
      // Master (no saturator — see the builder note).
      { id: 'sn-mix', type: 'mix', x: 3000, y: 1200 },
      {
        id: 'sn-air',
        type: 'filter',
        x: 3440,
        y: 1200,
        values: { Type: 'lowpass', Freq: 3800, Q: 0.7 },
      },
      {
        id: 'sn-verb',
        type: 'reverb',
        x: 3880,
        y: 1200,
        values: { 'Decay s': 3, 'PreDelay s': 0.03, Wet: 0.3 },
      },
      {
        id: 'sn-render',
        type: 'render',
        x: 4320,
        y: 1220,
        values: { 'Level dB': -5 },
      },
    ],
    [
      // Score → voices.
      { from: 'sn-cPadLow', output: 'Signal', to: 'sn-padLow', input: 'Hz' },
      { from: 'sn-cPadMid', output: 'Signal', to: 'sn-padMid', input: 'Hz' },
      { from: 'sn-cPadHigh', output: 'Signal', to: 'sn-padHigh', input: 'Hz' },
      { from: 'sn-cPadGate', output: 'Signal', to: 'sn-padGate', input: 'In' },
      { from: 'sn-padGate', output: 'Gate', to: 'sn-padLow', input: 'Gate' },
      { from: 'sn-padGate', output: 'Gate', to: 'sn-padMid', input: 'Gate' },
      { from: 'sn-padGate', output: 'Gate', to: 'sn-padHigh', input: 'Gate' },
      { from: 'sn-cPadLevel', output: 'Signal', to: 'sn-padLow', input: 'Amp' },
      { from: 'sn-cPadLevel', output: 'Signal', to: 'sn-padMid', input: 'Amp' },
      {
        from: 'sn-cPadLevel',
        output: 'Signal',
        to: 'sn-padHigh',
        input: 'Amp',
      },
      {
        from: 'sn-cPadCutoff',
        output: 'Signal',
        to: 'sn-padFilter',
        input: 'Freq',
      },
      { from: 'sn-droneHz1', output: 'Out', to: 'sn-drone1', input: 'Hz' },
      { from: 'sn-droneHz2', output: 'Out', to: 'sn-drone2', input: 'Hz' },
      {
        from: 'sn-cDroneLevel',
        output: 'Signal',
        to: 'sn-drone1',
        input: 'Amp',
      },
      {
        from: 'sn-cDroneLevel',
        output: 'Signal',
        to: 'sn-drone2',
        input: 'Amp',
      },
      {
        from: 'sn-cSubPitch',
        output: 'Signal',
        to: 'sn-sub',
        input: 'Frequency',
      },
      { from: 'sn-cSubLevel', output: 'Signal', to: 'sn-sub', input: 'Level' },
      { from: 'sn-cKickAmp', output: 'Signal', to: 'sn-kick', input: 'Level' },
      {
        from: 'sn-cKickPitch',
        output: 'Signal',
        to: 'sn-kick',
        input: 'Frequency',
      },
      {
        from: 'sn-cTickAmp',
        output: 'Signal',
        to: 'sn-tickNoise',
        input: 'Level',
      },
      {
        from: 'sn-cPingPitch',
        output: 'Signal',
        to: 'sn-ping',
        input: 'Frequency',
      },
      { from: 'sn-cPingAmp', output: 'Signal', to: 'sn-ping', input: 'Level' },
      // Voices → master.
      { from: 'sn-padLow', output: 'Out', to: 'sn-padMix', input: 'In' },
      { from: 'sn-padMid', output: 'Out', to: 'sn-padMix', input: 'In' },
      { from: 'sn-padHigh', output: 'Out', to: 'sn-padMix', input: 'In' },
      { from: 'sn-padMix', output: 'Out', to: 'sn-padFilter', input: 'In' },
      { from: 'sn-padFilter', output: 'Out', to: 'sn-mix', input: 'In' },
      { from: 'sn-drone1', output: 'Out', to: 'sn-mix', input: 'In' },
      { from: 'sn-drone2', output: 'Out', to: 'sn-drone2Trim', input: 'In' },
      { from: 'sn-drone2Trim', output: 'Out', to: 'sn-mix', input: 'In' },
      { from: 'sn-sub', output: 'Out', to: 'sn-mix', input: 'In' },
      { from: 'sn-kick', output: 'Out', to: 'sn-mix', input: 'In' },
      { from: 'sn-tickNoise', output: 'Out', to: 'sn-tickBP', input: 'In' },
      { from: 'sn-tickBP', output: 'Out', to: 'sn-mix', input: 'In' },
      { from: 'sn-ping', output: 'Out', to: 'sn-pingSoft', input: 'In' },
      { from: 'sn-pingSoft', output: 'Out', to: 'sn-pingEcho', input: 'In' },
      { from: 'sn-pingEcho', output: 'Out', to: 'sn-pingVerb', input: 'In' },
      { from: 'sn-pingVerb', output: 'Out', to: 'sn-mix', input: 'In' },
      { from: 'sn-mix', output: 'Out', to: 'sn-air', input: 'In' },
      { from: 'sn-air', output: 'Out', to: 'sn-verb', input: 'In' },
      { from: 'sn-verb', output: 'Out', to: 'sn-render', input: 'In' },
    ],
  );
}

/**
 * One probe per Easy Effect (`fxProbe_<id>`, e.g. `__probe('fxProbe_fx_stutter')`):
 * a 220 Hz saw whose level pulses at an off-tempo 3.3 Hz (so a stutter's held
 * slice or a chopper's gate shows up against a known pattern) → the effect
 * at its defaults → Render. For measuring each effect alone.
 */
// The same source with no effect, as the reference.
probeGraphBuilders.fxProbe_dry = () =>
  buildState(
    [
      {
        id: 'fp-pulse',
        type: 'pulser',
        x: 40,
        y: 40,
        values: { Shape: 'triangle', 'Rate Hz': 3.3, Amplitude: 0.35, Offset: 0.45 },
      },
      {
        id: 'fp-osc',
        type: 'oscillator',
        x: 480,
        y: 40,
        values: { Shape: 'sawtooth', Frequency: 220 },
      },
      { id: 'fp-render', type: 'render', x: 940, y: 60 },
    ],
    [
      { from: 'fp-pulse', output: 'Out', to: 'fp-osc', input: 'Level' },
      { from: 'fp-osc', output: 'Out', to: 'fp-render', input: 'In' },
    ],
  );
// Map driven LIVE (its wave-shaper path): a 0.5 Hz sine swinging 0–100 %
// → Map 0…1 (exponential 0.05…1 would be the other check) → a saw's Gain.
// The level should rise and fall once every 2 s.
probeGraphBuilders.fxProbe_mapLive = () =>
  buildState(
    [
      {
        id: 'ml-lfo',
        type: 'pulser',
        x: 40,
        y: 40,
        values: { Shape: 'sine', 'Rate Hz': 0.5, Amplitude: 50, Offset: 50 },
      },
      {
        id: 'ml-map',
        type: 'map',
        x: 480,
        y: 40,
        values: { Low: 0, High: 1, Curve: 'linear' },
      },
      {
        id: 'ml-osc',
        type: 'oscillator',
        x: 480,
        y: 500,
        values: { Shape: 'sawtooth', Frequency: 220, Level: 0.8 },
      },
      { id: 'ml-vca', type: 'gain', x: 940, y: 300 },
      { id: 'ml-render', type: 'render', x: 1400, y: 320 },
    ],
    [
      { from: 'ml-lfo', output: 'Out', to: 'ml-map', input: 'Amount' },
      { from: 'ml-map', output: 'Signal', to: 'ml-vca', input: 'Gain' },
      { from: 'ml-osc', output: 'Out', to: 'ml-vca', input: 'In' },
      { from: 'ml-vca', output: 'Out', to: 'ml-render', input: 'In' },
    ],
  );

for (const effectId of Object.keys(effectNodeTypes)) {
  probeGraphBuilders[`fxProbe_${effectId}`] = () =>
    buildState(
      [
        {
          id: 'fp-pulse',
          type: 'pulser',
          x: 40,
          y: 40,
          values: { Shape: 'triangle', 'Rate Hz': 3.3, Amplitude: 0.35, Offset: 0.45 },
        },
        {
          id: 'fp-osc',
          type: 'oscillator',
          x: 480,
          y: 40,
          values: { Shape: 'sawtooth', Frequency: 220 },
        },
        {
          id: 'fp-effect',
          type: effectId as SoundCatalogNodeTypeId,
          x: 940,
          y: 40,
        },
        { id: 'fp-render', type: 'render', x: 1400, y: 60 },
      ],
      [
        { from: 'fp-pulse', output: 'Out', to: 'fp-osc', input: 'Level' },
        { from: 'fp-osc', output: 'Out', to: 'fp-effect', input: 'In' },
        { from: 'fp-effect', output: 'Out', to: 'fp-render', input: 'In' },
      ],
    );
}

function buildProbeGraphState(name: string): ProbeState {
  const builder = probeGraphBuilders[name];
  if (!builder) {
    throw new Error(
      `Unknown probe graph "${name}" — have: ${Object.keys(probeGraphBuilders).join(', ')}`,
    );
  }
  return builder();
}

export {
  buildProbeGraphState,
  buildState,
  demoTimelineDocuments,
  probeGraphBuilders,
};
export type { EdgeSpec, NodeSpec, ProbeState };

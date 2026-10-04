/**
 * Easy Effects — hand-written node groups with layman controls (plan
 * `.claude/plans/easy-effect-groups.md`, rulings Q-E1..Q-E4 "all rec").
 *
 * Every effect is an ordinary node group (open it to see how it works),
 * built by the instrument `groupBuilder`:
 * - 2–4 controls in plain words, each a KNOB on the group node: percent
 *   knobs are yellow 0–100 % signals (so a timeline curve can also drive
 *   them), note lengths are Beat Clock choices;
 * - inside, a Map node turns each percent into the real setting's range, and
 *   a Beat Clock turns a note length into seconds or Hz at the timeline
 *   tempo;
 * - it sounds good at its defaults.
 *
 * Map's live `Signal` feeds yellow inputs; its `Value` (fixed when the graph
 * starts) feeds blue number inputs.
 */

import type { InstrumentSpec } from '../instruments/groupBuilder';
import { buildInstrumentType } from '../instruments/groupBuilder';

type NodeSpec = InstrumentSpec['nodes'][number];
type BoundaryInput = InstrumentSpec['inputs'][number];

const EFFECT_COLOR = '#be185d';
const MENU = { menuPath: ['Easy Effects'], priorityInContextMenu: 85 };

const AUDIO_IN: BoundaryInput = {
  name: 'In',
  dataType: 'audio',
  description: 'The sound to process.',
};
const AUDIO_OUT: BoundaryInput = { name: 'Out', dataType: 'audio' };

/** A 0–100 % knob on the group node. */
function percent(
  name: string,
  defaultValue: number,
  description: string,
): BoundaryInput {
  return {
    name,
    dataType: 'signal',
    allowInput: true,
    defaultValue,
    min: 0,
    max: 100,
    step: 1,
    description: `${description} 0–100 % (default ${defaultValue}).`,
  };
}

/** A note-length choice on the group node (read by a Beat Clock inside). */
function noteLength(
  name: string,
  defaultValue: string,
  description: string,
): BoundaryInput {
  return {
    name,
    dataType: 'beatDivision',
    allowInput: true,
    defaultValue,
    description: `${description} Follows the timeline tempo (default ${defaultValue}).`,
  };
}

/** A Map node: 0–100 % → Low…High. */
function map(
  id: string,
  x: number,
  y: number,
  low: number,
  high: number,
  curve: 'linear' | 'exponential' = 'linear',
): NodeSpec {
  return {
    id,
    type: 'map',
    x,
    y,
    values: { Low: low, High: high, Curve: curve },
  };
}

// ── Rhythmic volume ──

/** Chopper and Pump share one shape: a tempo-locked Pulser on a Gain. The
 *  Pulser swings between 1 (full) and 1 − depth. */
function rhythmicGain(options: {
  id: string;
  name: string;
  description: string;
  speed: BoundaryInput;
  depth: BoundaryInput;
  shape: BoundaryInput | { fixed: string };
}): InstrumentSpec {
  const shapeIsKnob = !('fixed' in options.shape);
  return {
    id: options.id,
    name: options.name,
    family: 'Easy Effects',
    headerColor: EFFECT_COLOR,
    description: options.description,
    ...MENU,
    inputs: [
      AUDIO_IN,
      options.speed,
      options.depth,
      ...(shapeIsKnob ? [options.shape as BoundaryInput] : []),
    ],
    outputs: [AUDIO_OUT],
    nodes: [
      { id: 'clock', type: 'beatClock', x: -900, y: -300 },
      map('swing', -900, 0, 0, 0.5),
      map('centre', -900, 300, 1, 0.5),
      {
        id: 'lfo',
        type: 'pulser',
        x: -450,
        y: 0,
        ...(shapeIsKnob
          ? {}
          : { values: { Shape: (options.shape as { fixed: string }).fixed } }),
      },
      { id: 'vca', type: 'gain', x: 0, y: 0 },
    ],
    edges: [
      { from: '$in', output: options.speed.name, to: 'clock', input: 'Note' },
      { from: '$in', output: options.depth.name, to: 'swing', input: 'Amount' },
      { from: '$in', output: options.depth.name, to: 'centre', input: 'Amount' },
      ...(shapeIsKnob
        ? [
            {
              from: '$in',
              output: (options.shape as BoundaryInput).name,
              to: 'lfo',
              input: 'Shape',
            },
          ]
        : []),
      { from: 'clock', output: 'Hz', to: 'lfo', input: 'Rate Hz' },
      { from: 'swing', output: 'Value', to: 'lfo', input: 'Amplitude' },
      { from: 'centre', output: 'Value', to: 'lfo', input: 'Offset' },
      { from: '$in', output: 'In', to: 'vca', input: 'In' },
      { from: 'lfo', output: 'Out', to: 'vca', input: 'Gain' },
      { from: 'vca', output: 'Out', to: '$out', input: 'Out' },
    ],
  };
}

const chopper = rhythmicGain({
  id: 'fx_chopper',
  name: 'Chopper',
  description:
    'Chops the sound on and off in time with the music, like a gate stutter on a pad.',
  speed: noteLength('Speed', '1/16', 'How fast it chops: one on-off per note.'),
  depth: percent('Depth', 80, 'How far the volume drops. 100 is fully off.'),
  shape: {
    name: 'Shape',
    dataType: 'oscShape',
    allowInput: true,
    defaultValue: 'square',
    description:
      'square chops hard; sine and triangle pulse softly; sawtooth swells.',
  },
});

const pump = rhythmicGain({
  id: 'fx_pump',
  name: 'Pump',
  description:
    'Ducks the volume on every beat and lets it swell back, the "sidechain" breathing of dance music.',
  speed: noteLength('Speed', '1/4', 'How often it pumps.'),
  depth: percent('Depth', 60, 'How deep each duck goes.'),
  shape: { fixed: 'sawtooth' },
});

// ── Stutter: a DJ beat-repeat ──
//
// A square Pulser opens a GATE (0/1). While it is 0 the sound plays dry and
// a delay records the last slice; while it is 1 the dry sound is muted, the
// delay stops listening and its feedback goes to 1, so the slice repeats.
const stutter: InstrumentSpec = {
  id: 'fx_stutter',
  name: 'Stutter',
  family: 'Easy Effects',
  headerColor: EFFECT_COLOR,
  description:
    'Grabs a tiny slice of the sound and repeats it, like a DJ beat-repeat.',
  ...MENU,
  inputs: [
    AUDIO_IN,
    percent('Amount', 60, 'How often it stutters.'),
    noteLength('Chop', '1/16', 'The length of the repeated slice.'),
    percent('Mix', 100, 'How much of the effect you hear.'),
  ],
  outputs: [AUDIO_OUT],
  nodes: [
    map('rate', -1350, -300, 0.5, 4, 'exponential'),
    {
      id: 'gate',
      type: 'pulser',
      x: -900,
      y: -300,
      values: { Shape: 'square', Amplitude: 0.5, Offset: 0.5 },
    },
    { id: 'clock', type: 'beatClock', x: -900, y: 200 },
    { id: 'listen', type: 'crossFade', x: -450, y: -100 },
    {
      id: 'hold',
      type: 'feedbackDelay',
      x: 0,
      y: -100,
      values: { Wet: 1 },
    },
    { id: 'select', type: 'crossFade', x: 450, y: 0 },
    map('mixAmount', 450, 350, 0, 1),
    { id: 'mix', type: 'crossFade', x: 900, y: 0 },
  ],
  edges: [
    { from: '$in', output: 'Amount', to: 'rate', input: 'Amount' },
    { from: 'rate', output: 'Signal', to: 'gate', input: 'Rate Hz' },
    { from: '$in', output: 'Chop', to: 'clock', input: 'Note' },
    // The delay listens only while the gate is closed.
    { from: '$in', output: 'In', to: 'listen', input: 'A' },
    { from: 'gate', output: 'Out', to: 'listen', input: 'Fade' },
    { from: 'listen', output: 'Out', to: 'hold', input: 'In' },
    { from: 'clock', output: 'Seconds', to: 'hold', input: 'Time s' },
    { from: 'gate', output: 'Out', to: 'hold', input: 'Feedback' },
    // Dry while closed, the held slice while open.
    { from: '$in', output: 'In', to: 'select', input: 'A' },
    { from: 'hold', output: 'Out', to: 'select', input: 'B' },
    { from: 'gate', output: 'Out', to: 'select', input: 'Fade' },
    { from: '$in', output: 'Mix', to: 'mixAmount', input: 'Amount' },
    { from: '$in', output: 'In', to: 'mix', input: 'A' },
    { from: 'select', output: 'Out', to: 'mix', input: 'B' },
    { from: 'mixAmount', output: 'Signal', to: 'mix', input: 'Fade' },
    { from: 'mix', output: 'Out', to: '$out', input: 'Out' },
  ],
};

// ── Space ──

const echo: InstrumentSpec = {
  id: 'fx_echo',
  name: 'Echo',
  family: 'Easy Effects',
  headerColor: EFFECT_COLOR,
  description:
    'Repeats that bounce left and right and fade away, in time with the music.',
  ...MENU,
  inputs: [
    AUDIO_IN,
    percent('Echoes', 40, 'How many repeats before it fades.'),
    noteLength('Time', '1/8.', 'The gap between repeats.'),
    percent('Darkness', 40, 'How muffled the repeats are.'),
    percent('Mix', 35, 'How loud the echoes are against the original.'),
  ],
  outputs: [AUDIO_OUT],
  nodes: [
    { id: 'clock', type: 'beatClock', x: -900, y: -350 },
    map('feedback', -900, 0, 0.1, 0.85),
    {
      id: 'delay',
      type: 'pingPongDelay',
      x: -450,
      y: 0,
      values: { Wet: 1 },
    },
    map('cutoff', -450, 400, 16000, 1200, 'exponential'),
    { id: 'tone', type: 'filter', x: 0, y: 0, values: { Type: 'lowpass', Q: 0.7 } },
    map('mixAmount', 0, 400, 0, 1),
    { id: 'mix', type: 'crossFade', x: 450, y: 0 },
  ],
  edges: [
    { from: '$in', output: 'Time', to: 'clock', input: 'Note' },
    { from: '$in', output: 'Echoes', to: 'feedback', input: 'Amount' },
    { from: '$in', output: 'In', to: 'delay', input: 'In' },
    { from: 'clock', output: 'Seconds', to: 'delay', input: 'Time s' },
    { from: 'feedback', output: 'Signal', to: 'delay', input: 'Feedback' },
    { from: 'delay', output: 'Out', to: 'tone', input: 'In' },
    { from: '$in', output: 'Darkness', to: 'cutoff', input: 'Amount' },
    { from: 'cutoff', output: 'Signal', to: 'tone', input: 'Freq' },
    { from: '$in', output: 'Mix', to: 'mixAmount', input: 'Amount' },
    { from: '$in', output: 'In', to: 'mix', input: 'A' },
    { from: 'tone', output: 'Out', to: 'mix', input: 'B' },
    { from: 'mixAmount', output: 'Signal', to: 'mix', input: 'Fade' },
    { from: 'mix', output: 'Out', to: '$out', input: 'Out' },
  ],
};

const bigSpace: InstrumentSpec = {
  id: 'fx_bigSpace',
  name: 'Big Space',
  family: 'Easy Effects',
  headerColor: EFFECT_COLOR,
  description:
    'Puts the sound in a room, from a small studio to a huge cathedral.',
  ...MENU,
  inputs: [
    AUDIO_IN,
    percent('Size', 50, 'How big the room is and how long the sound hangs.'),
    percent('Brightness', 50, 'How much sparkle the room keeps.'),
    percent('Mix', 30, 'How much room you hear against the original.'),
  ],
  outputs: [AUDIO_OUT],
  nodes: [
    map('decay', -900, -300, 0.6, 9, 'exponential'),
    map('scale', -900, 50, 0.5, 2.5),
    map('damping', -900, 400, 1500, 14000, 'exponential'),
    map('mixAmount', -900, 750, 0, 1),
    { id: 'reverb', type: 'fdnReverb', x: -400, y: 0 },
  ],
  edges: [
    { from: '$in', output: 'Size', to: 'decay', input: 'Amount' },
    { from: '$in', output: 'Size', to: 'scale', input: 'Amount' },
    { from: '$in', output: 'Brightness', to: 'damping', input: 'Amount' },
    { from: '$in', output: 'Mix', to: 'mixAmount', input: 'Amount' },
    { from: '$in', output: 'In', to: 'reverb', input: 'In' },
    { from: 'decay', output: 'Value', to: 'reverb', input: 'Decay s' },
    { from: 'scale', output: 'Value', to: 'reverb', input: 'Size' },
    { from: 'damping', output: 'Value', to: 'reverb', input: 'Damping Hz' },
    { from: 'mixAmount', output: 'Signal', to: 'reverb', input: 'Mix' },
    { from: 'reverb', output: 'Out', to: '$out', input: 'Out' },
  ],
};

// ── Character ──

const lofiRadio: InstrumentSpec = {
  id: 'fx_lofiRadio',
  name: 'Lo-Fi Radio',
  family: 'Easy Effects',
  headerColor: EFFECT_COLOR,
  description:
    'Makes the sound old, crunchy and narrow, like a small radio or a worn record.',
  ...MENU,
  inputs: [
    AUDIO_IN,
    percent('Age', 50, 'How old and crunchy it sounds.'),
    percent('Hiss', 20, 'How much background hiss.'),
    percent('Mix', 100, 'How much of the effect you hear.'),
  ],
  outputs: [AUDIO_OUT],
  // Crush and warm first, add the hiss, THEN the speaker band — so the
  // crusher's fizz and the hiss are band-limited like a small speaker (the
  // band first made the result brighter than the input). The band is a low
  // cut + a high cut that close in with Age: a narrow band-pass lost ~20 dB
  // on a low note.
  nodes: [
    // Bits sum on the Bit Crusher's base of 1: 10…2 here means 11…3 bits.
    map('bits', -1350, -350, 10, 2),
    { id: 'crush', type: 'bitCrusher', x: -900, y: -100, values: { Wet: 1 } },
    map('drive', -900, 300, 1.5, 5),
    // Level-matched: the saturator's small-signal gain is about 2.5 × Drive.
    map('trim', -900, 650, 0.26, 0.08, 'exponential'),
    { id: 'warm', type: 'saturator', x: -450, y: -100 },
    map('hissLevel', -450, 400, 0, 0.06),
    { id: 'noise', type: 'noise', x: -450, y: 750, values: { Type: 'white' } },
    { id: 'sum', type: 'mix', x: 0, y: 0 },
    map('lowCutHz', 0, 400, 150, 700, 'exponential'),
    {
      id: 'lowCut',
      type: 'filter',
      x: 450,
      y: 0,
      values: { Type: 'highpass', Q: 0.7 },
    },
    map('highCutHz', 450, 400, 7000, 2200, 'exponential'),
    {
      id: 'highCut',
      type: 'filter',
      x: 900,
      y: 0,
      values: { Type: 'lowpass', Q: 0.9 },
    },
    // Make-up for the lows and highs the speaker band removes (~+7 dB).
    { id: 'makeup', type: 'gain', x: 1350, y: 0, values: { Gain: 2.2 } },
    map('mixAmount', 1350, 400, 0, 1),
    { id: 'mix', type: 'crossFade', x: 1800, y: 0 },
  ],
  edges: [
    { from: '$in', output: 'Age', to: 'lowCutHz', input: 'Amount' },
    { from: '$in', output: 'Age', to: 'highCutHz', input: 'Amount' },
    { from: '$in', output: 'Age', to: 'bits', input: 'Amount' },
    { from: '$in', output: 'Age', to: 'drive', input: 'Amount' },
    { from: '$in', output: 'Age', to: 'trim', input: 'Amount' },
    { from: '$in', output: 'In', to: 'crush', input: 'In' },
    { from: 'bits', output: 'Signal', to: 'crush', input: 'Bits' },
    { from: 'crush', output: 'Out', to: 'warm', input: 'In' },
    { from: 'drive', output: 'Signal', to: 'warm', input: 'Drive' },
    { from: 'trim', output: 'Signal', to: 'warm', input: 'Trim' },
    { from: '$in', output: 'Hiss', to: 'hissLevel', input: 'Amount' },
    { from: 'hissLevel', output: 'Signal', to: 'noise', input: 'Level' },
    { from: 'warm', output: 'Out', to: 'sum', input: 'In' },
    { from: 'noise', output: 'Out', to: 'sum', input: 'In' },
    { from: 'sum', output: 'Out', to: 'lowCut', input: 'In' },
    { from: 'lowCutHz', output: 'Signal', to: 'lowCut', input: 'Freq' },
    { from: 'lowCut', output: 'Out', to: 'highCut', input: 'In' },
    { from: 'highCutHz', output: 'Signal', to: 'highCut', input: 'Freq' },
    { from: '$in', output: 'Mix', to: 'mixAmount', input: 'Amount' },
    { from: '$in', output: 'In', to: 'mix', input: 'A' },
    { from: 'highCut', output: 'Out', to: 'makeup', input: 'In' },
    { from: 'makeup', output: 'Out', to: 'mix', input: 'B' },
    { from: 'mixAmount', output: 'Signal', to: 'mix', input: 'Fade' },
    { from: 'mix', output: 'Out', to: '$out', input: 'Out' },
  ],
};

const wobble: InstrumentSpec = {
  id: 'fx_wobble',
  name: 'Wobble',
  family: 'Easy Effects',
  headerColor: EFFECT_COLOR,
  description:
    'A filter that opens and closes in time with the music: the dubstep "wub".',
  ...MENU,
  inputs: [
    AUDIO_IN,
    noteLength('Speed', '1/8', 'How fast it wobbles: one wub per note.'),
    percent('Depth', 70, 'How wide the filter sweeps.'),
    percent('Growl', 30, 'How much dirt is added.'),
  ],
  outputs: [AUDIO_OUT],
  nodes: [
    { id: 'clock', type: 'beatClock', x: -900, y: -300 },
    map('sweep', -900, 50, 1, 5.5),
    {
      id: 'filter',
      type: 'autoFilter',
      x: -450,
      y: 0,
      values: { Wet: 1, 'Base Hz': 120 },
    },
    map('dirt', -450, 400, 0, 1),
    // Trim 0.1 undoes the saturator's ~10× small-signal gain at Drive 4, so
    // Growl adds grit without jumping in level.
    {
      id: 'growl',
      type: 'saturator',
      x: 0,
      y: 0,
      values: { Drive: 4, Trim: 0.1 },
    },
  ],
  edges: [
    { from: '$in', output: 'Speed', to: 'clock', input: 'Note' },
    { from: '$in', output: 'Depth', to: 'sweep', input: 'Amount' },
    { from: '$in', output: 'In', to: 'filter', input: 'In' },
    { from: 'clock', output: 'Hz', to: 'filter', input: 'Rate Hz' },
    { from: 'sweep', output: 'Value', to: 'filter', input: 'Octaves' },
    { from: 'filter', output: 'Out', to: 'growl', input: 'In' },
    { from: '$in', output: 'Growl', to: 'dirt', input: 'Amount' },
    { from: 'dirt', output: 'Signal', to: 'growl', input: 'Wet' },
    { from: 'growl', output: 'Out', to: '$out', input: 'Out' },
  ],
};

// EQ3 bands sum a connected signal in LINEAR gain on a silent base, so the
// Tone maps below are gains: 0.25…2 is −12…+6 dB (exponential = even in dB).
const crunch: InstrumentSpec = {
  id: 'fx_crunch',
  name: 'Crunch',
  family: 'Easy Effects',
  headerColor: EFFECT_COLOR,
  description: 'Adds dirt, from warm and thick to fuzzy and broken.',
  ...MENU,
  inputs: [
    AUDIO_IN,
    percent('Crunch', 40, 'How much dirt.'),
    percent('Tone', 50, 'Dark (0) to bright (100).'),
    percent('Volume', 50, 'Output level; 50 keeps it about as loud.'),
  ],
  outputs: [AUDIO_OUT],
  nodes: [
    map('amount', -1350, -300, 0.05, 0.9),
    { id: 'dirt', type: 'distortion', x: -900, y: 0, values: { Wet: 1 } },
    map('drive', -900, 350, 1, 4),
    // Level-matched: the saturator's small-signal gain is about 2.5 × Drive.
    map('trim', -900, 700, 0.4, 0.1, 'exponential'),
    { id: 'warm', type: 'saturator', x: -450, y: 0 },
    map('treble', -450, 350, 0.25, 2, 'exponential'),
    map('bass', -450, 700, 1.6, 0.63, 'exponential'),
    { id: 'tone', type: 'eq3', x: 0, y: 0 },
    // 50 % = ×1.3: the make-up that keeps the dirt about as loud as the input.
    map('level', 0, 400, 0, 2.6),
    { id: 'volume', type: 'gain', x: 450, y: 0 },
    {
      id: 'safety',
      type: 'limiter',
      x: 900,
      y: 0,
      values: { 'Threshold dB': -1 },
    },
  ],
  edges: [
    { from: '$in', output: 'Crunch', to: 'amount', input: 'Amount' },
    { from: '$in', output: 'Crunch', to: 'drive', input: 'Amount' },
    { from: '$in', output: 'In', to: 'dirt', input: 'In' },
    { from: 'amount', output: 'Value', to: 'dirt', input: 'Amount' },
    { from: 'dirt', output: 'Out', to: 'warm', input: 'In' },
    { from: 'drive', output: 'Signal', to: 'warm', input: 'Drive' },
    { from: '$in', output: 'Crunch', to: 'trim', input: 'Amount' },
    { from: 'trim', output: 'Signal', to: 'warm', input: 'Trim' },
    { from: 'warm', output: 'Out', to: 'tone', input: 'In' },
    { from: '$in', output: 'Tone', to: 'treble', input: 'Amount' },
    { from: '$in', output: 'Tone', to: 'bass', input: 'Amount' },
    { from: 'treble', output: 'Signal', to: 'tone', input: 'High dB' },
    { from: 'bass', output: 'Signal', to: 'tone', input: 'Low dB' },
    { from: 'tone', output: 'Out', to: 'volume', input: 'In' },
    { from: '$in', output: 'Volume', to: 'level', input: 'Amount' },
    { from: 'level', output: 'Signal', to: 'volume', input: 'Gain' },
    { from: 'volume', output: 'Out', to: 'safety', input: 'In' },
    { from: 'safety', output: 'Out', to: '$out', input: 'Out' },
  ],
};

const effectSpecs: InstrumentSpec[] = [
  stutter,
  chopper,
  pump,
  echo,
  bigSpace,
  lofiRadio,
  wobble,
  crunch,
];

/**
 * The specs are laid out on a compact grid; spread the rows apart so the
 * inner nodes (their live previews included, ~550 px tall) never overlap
 * when a group is opened.
 */
function spaced(spec: InstrumentSpec): InstrumentSpec {
  return {
    ...spec,
    nodes: spec.nodes.map((node) => ({ ...node, y: Math.round(node.y * 1.75) })),
  };
}

const effectNodeTypes = {
  fx_stutter: buildInstrumentType(spaced(stutter)),
  fx_chopper: buildInstrumentType(spaced(chopper)),
  fx_pump: buildInstrumentType(spaced(pump)),
  fx_echo: buildInstrumentType(spaced(echo)),
  fx_bigSpace: buildInstrumentType(spaced(bigSpace)),
  fx_lofiRadio: buildInstrumentType(spaced(lofiRadio)),
  fx_wobble: buildInstrumentType(spaced(wobble)),
  fx_crunch: buildInstrumentType(spaced(crunch)),
};

export { effectNodeTypes, effectSpecs };

/**
 * The sound app's data types + edge-discipline configuration.
 *
 * maxConnections is deliberately NOT set at the dataType level: the host
 * merges `input.maxConnections ?? dataType.maxConnections` for OUTPUT handles
 * too (constructAndModifyNodes.ts:94-96), so a dataType-level cap of 1 would
 * throttle output fan-out. Audio fan-IN caps live per-input in nodeTypes.ts.
 * Signal inputs stay unlimited — connections SUM.
 */

import {
  makeDataTypeWithAutoInfer,
  standardDataTypes,
} from '@theclearsky/react-blender-nodes';
import { timelineCurveRefSchema } from '@theclearsky/react-blender-nodes-timeline';
import {
  audioChainSchema,
  boolSignalChainSchema,
  signalKnobSchema,
  waveformValueSchema,
} from './valueTypes';
import { beatDivisions, mapCurves } from './controlMath';

const filterTypes = [
  'lowpass',
  'highpass',
  'bandpass',
  'lowshelf',
  'highshelf',
  'notch',
  'allpass',
  'peaking',
] as const;

const oscillatorShapes = ['sine', 'square', 'sawtooth', 'triangle'] as const;
const noiseTypes = ['white', 'pink', 'brown'] as const;
const playerModes = ['loop', 'once'] as const;
/** adsr gate semantics: level modes + one-shots. */
const triggerModes = ['high', 'low', 'rising', 'falling', 'any'] as const;
/** Plucked String: what strikes the string. */
const pickStyles = ['finger', 'nail'] as const;
/** Bowed String: which friction law drives the stick-slip interaction. */
const frictionModels = ['bowTable', 'frictionCurve', 'thermal'] as const;
/** String Body: which instrument's measured modes to load. */
const bodyPresets = ['guitar', 'violin', 'custom'] as const;
/**
 * Jet Flute: how many sign inversions the wave meets per round trip, which is
 * the ONLY thing that decides an air column's harmonic series.
 *
 * `open`   — open at both ends (flute, recorder): TWO inversions, so the round
 *            trip is net non-inverting and every harmonic is a mode.
 *            Fundamental at c/2L. This is the default: it is what a flute is.
 * `closed` — stopped at one end (clarinet, panpipe, stopped organ pipe): ONE
 *            inversion, so only ODD harmonics are modes and the tube sounds an
 *            octave lower for the same length. Fundamental at c/4L.
 */
const pipeModes = ['open', 'closed'] as const;
/** A plain on/off for node knobs (the host's `condition` is switch-specific). */
const toggleValues = ['on', 'off'] as const;
/**
 * How a key node's Hz output travels to a new note — portamento/glide.
 *
 * `off` is the DEFAULT and is byte-for-byte today's behaviour: a 10 ms
 * anti-zipper ramp, which is not a glide, just a click-free jump.
 * `linear` ramps in Hz; `exponential` ramps at a constant rate in CENTS,
 * which is the musically even one and what a fretless slide sounds like;
 * `smooth` is an asymptotic slew — the classic synth portamento, fast at
 * first and easing into the target.
 */
const glideModes = ['off', 'linear', 'exponential', 'smooth'] as const;

/**
 * Socket look (2026-09-28): shapes AND colours follow the host's "All Handle
 * Shapes" story palette — Audio green parallelogram, Signal yellow diamond,
 * Gate red square, Number blue hexagon, Waveform purple grid, Curve Ref
 * orange star, Text teal rectangle, Toggle pink cross, Note Length amber
 * sparkle, every other choice a deep-red LIST (pick one from a list). The
 * host draws the data type's CURRENT shape and colour, so saved graphs
 * follow.
 */
const soundDataTypes = {
  // The host's standard data types (groupInfer etc.) are the CONSUMER's
  // job to merge — without them ADD_NODE_GROUP crashes constructing
  // boundary nodes.
  ...standardDataTypes,
  audio: makeDataTypeWithAutoInfer({
    name: 'Audio',
    shape: 'parallelogram',
    underlyingType: 'complex',
    complexSchema: audioChainSchema,
    color: '#2ECC71',
    // Edges only — no direct-input UI for a live audio node.
    allowInput: false,
  }),
  signal: makeDataTypeWithAutoInfer({
    name: 'Signal',
    shape: 'diamond',
    underlyingType: 'complex',
    complexSchema: signalKnobSchema,
    color: '#F1C40F',
    // Unconnected → our SignalBaseInput number box (hence complex).
    allowInput: true,
  }),
  waveform: makeDataTypeWithAutoInfer({
    name: 'Waveform',
    shape: 'grid',
    underlyingType: 'complex',
    complexSchema: waveformValueSchema,
    color: '#9B59B6',
    allowInput: true,
  }),
  number: makeDataTypeWithAutoInfer({
    name: 'Number',
    shape: 'hexagon',
    underlyingType: 'number',
    color: '#3498DB',
    allowInput: true,
  }),
  boolSignal: makeDataTypeWithAutoInfer({
    // Audio-rate 0/1 gate. EDGES ONLY — allowInput false means no knob
    // anywhere (an unconnected adsr Gate = legacy keyboard-bus mode BY
    // DESIGN). Identity-only conversions via the generated table below;
    // `Threshold` is the sole signal→boolSignal crossing.
    name: 'Gate',
    shape: 'square',
    underlyingType: 'complex',
    complexSchema: boolSignalChainSchema,
    color: '#E74C3C',
    allowInput: false,
  }),
  triggerMode: makeDataTypeWithAutoInfer({
    name: 'Trigger Mode',
    shape: 'list',
    underlyingType: 'string',
    color: '#C0392B',
    allowInput: true,
    allowedStrings: triggerModes,
  }),
  curveRef: makeDataTypeWithAutoInfer({
    // The Timeline Curve node's picker value — a branded
    // {kind, curveId} object, edited ONLY via the plugin's picker component
    // (registered in App's InputComponentRegistry; edges are disabled at
    // the node-type level).
    name: 'Curve Ref',
    shape: 'star',
    underlyingType: 'complex',
    complexSchema: timelineCurveRefSchema,
    color: '#F39C12',
    allowInput: true,
  }),
  text: makeDataTypeWithAutoInfer({
    name: 'Text',
    shape: 'rectangle',
    underlyingType: 'string',
    color: '#1ABC9C',
    allowInput: true,
  }),
  oscShape: makeDataTypeWithAutoInfer({
    name: 'Osc Shape',
    shape: 'list',
    underlyingType: 'string',
    color: '#C0392B',
    allowInput: true,
    allowedStrings: oscillatorShapes,
  }),
  noiseType: makeDataTypeWithAutoInfer({
    name: 'Noise Type',
    shape: 'list',
    underlyingType: 'string',
    color: '#C0392B',
    allowInput: true,
    allowedStrings: noiseTypes,
  }),
  filterType: makeDataTypeWithAutoInfer({
    name: 'Filter Type',
    shape: 'list',
    underlyingType: 'string',
    color: '#C0392B',
    allowInput: true,
    allowedStrings: filterTypes,
  }),
  playerMode: makeDataTypeWithAutoInfer({
    name: 'Player Mode',
    shape: 'list',
    underlyingType: 'string',
    color: '#C0392B',
    allowInput: true,
    allowedStrings: playerModes,
  }),
  pickStyle: makeDataTypeWithAutoInfer({
    name: 'Pick Style',
    shape: 'list',
    underlyingType: 'string',
    color: '#C0392B',
    allowInput: true,
    allowedStrings: pickStyles,
  }),
  frictionModel: makeDataTypeWithAutoInfer({
    name: 'Friction Model',
    shape: 'list',
    underlyingType: 'string',
    color: '#C0392B',
    allowInput: true,
    allowedStrings: frictionModels,
  }),
  pipeMode: makeDataTypeWithAutoInfer({
    name: 'Pipe Mode',
    shape: 'list',
    underlyingType: 'string',
    color: '#C0392B',
    allowInput: true,
    allowedStrings: pipeModes,
  }),
  bodyPreset: makeDataTypeWithAutoInfer({
    name: 'Body Preset',
    shape: 'list',
    underlyingType: 'string',
    color: '#C0392B',
    allowInput: true,
    allowedStrings: bodyPresets,
  }),
  toggle: makeDataTypeWithAutoInfer({
    name: 'Toggle',
    shape: 'cross',
    underlyingType: 'string',
    color: '#E91E63',
    allowInput: true,
    allowedStrings: toggleValues,
  }),
  glideMode: makeDataTypeWithAutoInfer({
    name: 'Glide Mode',
    shape: 'list',
    underlyingType: 'string',
    color: '#C0392B',
    allowInput: true,
    allowedStrings: glideModes,
  }),
  mapCurve: makeDataTypeWithAutoInfer({
    name: 'Map Curve',
    shape: 'list',
    underlyingType: 'string',
    color: '#C0392B',
    allowInput: true,
    allowedStrings: mapCurves,
  }),
  beatDivision: makeDataTypeWithAutoInfer({
    name: 'Note Length',
    shape: 'sparkle',
    underlyingType: 'string',
    color: '#FF9800',
    allowInput: true,
    allowedStrings: beatDivisions,
  }),
};

type SoundDataTypeId = keyof typeof soundDataTypes;

/**
 * Identity-only conversion table: each type connects ONLY to itself
 * (complex→complex pairs need the explicit allowance even under identity;
 * the ToSignal/ToAudio adapter NODES are the only boundary crossings).
 */
const allowedConversionsBetweenDataTypes: Partial<
  Record<SoundDataTypeId, Partial<Record<SoundDataTypeId, boolean>>>
> = Object.fromEntries(
  (Object.keys(soundDataTypes) as SoundDataTypeId[]).map((id) => [
    id,
    { [id]: true },
  ]),
);

export {
  allowedConversionsBetweenDataTypes,
  bodyPresets,
  filterTypes,
  frictionModels,
  glideModes,
  noiseTypes,
  oscillatorShapes,
  pickStyles,
  pipeModes,
  playerModes,
  soundDataTypes,
  toggleValues,
  triggerModes,
};
export type { SoundDataTypeId };

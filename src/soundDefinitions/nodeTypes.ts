/**
 * The full node catalog: sources, adapters, the 18-row effect table
 * (generated), Saturator, filter/dynamics/channel/envelope, Render.
 * Audio inputs cap fan-in at 1 per input (Mix raises it); signal inputs
 * stay unlimited — connections SUM.
 *
 * Add-menu organization: every node type carries a `locationInContextMenu`
 * subpath so the Add Node menu groups into folders (Sources / Output /
 * Control / Filter & EQ / Dynamics & Envelope / Routing & Mix /
 * Effects>…). `priorityInContextMenu` is the FOLDER rank — the host sorts
 * each menu level by max child priority, so one shared value per folder
 * orders the folders and leaves the within-folder order to declaration
 * order.
 */

import {
  makeTypeOfNodeWithAutoInfer,
  standardNodeTypes,
} from '@theclearsky/react-blender-nodes';
import { makeTimelineCurveNodeType } from '@theclearsky/react-blender-nodes-timeline';
import { KEY_ORDER, keyLabel } from '../audio/keyMap';
import type { SoundDataTypeId } from './dataTypes';
import type { EffectRowId } from './effectTable';
import { effectRows } from './effectTable';

/** All Keys node outputs: 17 interleaved [Gate, Hz] pairs generated from
 *  the shared key map — one pair per physical key. */
const ALL_KEYS_OUTPUTS = KEY_ORDER.flatMap((key) => [
  {
    name: `${keyLabel(key)} Gate`,
    dataType: 'boolSignal' as const,
    description: 'On while this key is held down, off when you let go.',
  },
  {
    name: `${keyLabel(key)} Hz`,
    dataType: 'signal' as const,
    description:
      'The pitch of this key in Hz. It holds after release, so the fading note stays in tune.',
  },
]);

// Folder ranks: higher lists first at the menu root.
const MENU_SOURCES = { path: ['Sources'], rank: 100 };
const MENU_OUTPUT = { path: ['Output'], rank: 90 };
const MENU_CONTROL = { path: ['Control'], rank: 80 };
const MENU_FILTER_EQ = { path: ['Filter & EQ'], rank: 70 };
const MENU_DYNAMICS = { path: ['Dynamics & Envelope'], rank: 60 };
const MENU_ROUTING = { path: ['Routing & Mix'], rank: 50 };
const MENU_PHYSICAL = { path: ['Physical Models'], rank: 95 };
const EFFECTS_RANK = 40;

/** Effects subfolder per generated row (the table stays synthesis-only). */
const effectMenuLocations: Record<EffectRowId, string[]> = {
  distortion: ['Effects', 'Distortion'],
  chebyshev: ['Effects', 'Distortion'],
  bitCrusher: ['Effects', 'Distortion'],
  chorus: ['Effects', 'Modulation'],
  phaser: ['Effects', 'Modulation'],
  tremolo: ['Effects', 'Modulation'],
  vibrato: ['Effects', 'Modulation'],
  autoFilter: ['Effects', 'Modulation'],
  autoWah: ['Effects', 'Modulation'],
  autoPanner: ['Effects', 'Modulation'],
  feedbackDelay: ['Effects', 'Delay'],
  pingPongDelay: ['Effects', 'Delay'],
  reverb: ['Effects', 'Reverb'],
  freeverb: ['Effects', 'Reverb'],
  jcReverb: ['Effects', 'Reverb'],
  frequencyShifter: ['Effects', 'Pitch & Stereo'],
  pitchShift: ['Effects', 'Pitch & Stereo'],
  stereoWidener: ['Effects', 'Pitch & Stereo'],
};

/** The common shape every generated effect node type conforms to. */
type GeneratedNodeType = {
  name: string;
  description?: string;
  headerColor: string;
  locationInContextMenu: string[];
  priorityInContextMenu: number;
  inputs: {
    name: string;
    dataType: SoundDataTypeId;
    allowInput?: boolean;
    maxConnections?: number;
    defaultValue?: number;
    description?: string;
  }[];
  outputs: { name: string; dataType: SoundDataTypeId; description?: string }[];
};

const effectNodeTypes = Object.fromEntries(
  effectRows.map((row) => [
    row.id,
    {
      name: row.name,
      ...(row.description !== undefined && { description: row.description }),
      headerColor: row.headerColor,
      locationInContextMenu: effectMenuLocations[row.id],
      priorityInContextMenu: EFFECTS_RANK,
      inputs: [
        {
          name: 'In',
          dataType: 'audio' as const,
          maxConnections: 1,
          description: 'The sound to process.',
        },
        ...row.signalParams.map((param) => ({
          name: param.input,
          dataType: 'signal' as const,
          allowInput: true,
          ...(param.description !== undefined && {
            description: param.description,
          }),
        })),
        ...row.numberParams.map((param) => ({
          name: param.input,
          dataType: 'number' as const,
          allowInput: true,
          defaultValue: param.fallback,
          ...(param.description !== undefined && {
            description: param.description,
          }),
        })),
      ],
      outputs: [{ name: 'Out', dataType: 'audio' as const }],
    },
  ]),
) as Record<EffectRowId, GeneratedNodeType>;

const soundNodeTypes = {
  // The host's standard node types (group/loop/switch boundaries) are the
  // CONSUMER's job to merge — ADD_NODE_GROUP builds groupInput/groupOutput
  // instances out of these entries.
  ...standardNodeTypes,

  // ── Sources ──
  drawnOsc: makeTypeOfNodeWithAutoInfer({
    name: 'Drawn Osc',
    description:
      'A tone generator that repeats one wave cycle you draw yourself, so you can design your own timbre.',
    headerColor: '#7c3aed',
    locationInContextMenu: MENU_SOURCES.path,
    priorityInContextMenu: MENU_SOURCES.rank,
    inputs: [
      {
        name: 'Waveform',
        dataType: 'waveform',
        allowInput: true,
        maxConnections: 1,
        description:
          'One cycle of the wave, drawn by hand. Its shape sets the tone color; a sine is used if empty.',
      },
      {
        name: 'Frequency',
        dataType: 'signal',
        allowInput: true,
        description:
          'Pitch in Hz (default 220). Connect a keyboard node’s Hz here to play notes.',
      },
      {
        name: 'Level',
        dataType: 'signal',
        allowInput: true,
        description:
          'Volume as a multiplier (default 0.8). Connect an envelope to shape it over time.',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),
  oscillator: makeTypeOfNodeWithAutoInfer({
    name: 'Oscillator',
    description:
      'A basic tone generator playing a sine, square, sawtooth or triangle wave. The starting point for most synth sounds.',
    headerColor: '#0e7490',
    locationInContextMenu: MENU_SOURCES.path,
    priorityInContextMenu: MENU_SOURCES.rank,
    inputs: [
      {
        name: 'Shape',
        dataType: 'oscShape',
        allowInput: true,
        defaultValue: 'sine',
        description:
          'The wave shape: sine is pure and soft, triangle mellow, square hollow, sawtooth bright and buzzy.',
      },
      {
        name: 'Frequency',
        dataType: 'signal',
        allowInput: true,
        description:
          'Pitch in Hz (default 220). Connect a keyboard node’s Hz here to play notes.',
      },
      {
        name: 'Detune',
        dataType: 'signal',
        allowInput: true,
        description:
          'Fine pitch offset in cents (100 cents = one semitone). Useful for thickening two oscillators.',
      },
      {
        name: 'Level',
        dataType: 'signal',
        allowInput: true,
        description:
          'Volume as a multiplier (default 0.8). Connect an envelope to shape it over time.',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),
  noise: makeTypeOfNodeWithAutoInfer({
    name: 'Noise',
    description:
      'Hiss with no pitch. Useful for wind, breath, drums and texture.',
    headerColor: '#0e7490',
    locationInContextMenu: MENU_SOURCES.path,
    priorityInContextMenu: MENU_SOURCES.rank,
    inputs: [
      {
        name: 'Type',
        dataType: 'noiseType',
        allowInput: true,
        defaultValue: 'white',
        description:
          'White is bright hiss, pink is softer and more even, brown is a deep rumble.',
      },
      {
        name: 'Level',
        dataType: 'signal',
        allowInput: true,
        description: 'Volume as a multiplier (default 0.8).',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),
  player: makeTypeOfNodeWithAutoInfer({
    name: 'Player',
    description: 'Plays an audio file from a web address, once or on a loop.',
    headerColor: '#0e7490',
    locationInContextMenu: MENU_SOURCES.path,
    priorityInContextMenu: MENU_SOURCES.rank,
    inputs: [
      {
        name: 'URL',
        dataType: 'text',
        allowInput: true,
        description:
          'Web address of the audio file to play, such as an .mp3 or .wav link.',
      },
      {
        name: 'Mode',
        dataType: 'playerMode',
        allowInput: true,
        defaultValue: 'once',
        description:
          'Choose once to play the file one time, or loop to repeat it forever.',
      },
      {
        name: 'Rate',
        dataType: 'number',
        allowInput: true,
        defaultValue: 1,
        description:
          'Playback speed. 2 is twice as fast and an octave higher; 0.5 is half speed and an octave lower.',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),
  pulser: makeTypeOfNodeWithAutoInfer({
    name: 'Pulser',
    description:
      'A slow repeating wobble (an LFO) for moving other knobs over time: vibrato, tremolo, filter sweeps. It swings around Offset by Amplitude.',
    headerColor: '#b45309',
    locationInContextMenu: MENU_CONTROL.path,
    priorityInContextMenu: MENU_CONTROL.rank,
    inputs: [
      {
        name: 'Shape',
        dataType: 'oscShape',
        allowInput: true,
        defaultValue: 'sine',
        description:
          'The wobble’s shape: sine is smooth, triangle even, square jumps between two values, sawtooth ramps.',
      },
      {
        // A live signal (was a plain number) so a Beat Clock, a Map or a
        // timeline curve can drive the speed.
        name: 'Rate Hz',
        dataType: 'signal',
        allowInput: true,
        defaultValue: 2,
        description:
          'Wobbles per second (default 2). Below 1 is a slow drift; 5 or so is a fast shake. Connect a Beat Clock to lock it to the tempo.',
      },
      {
        name: 'Amplitude',
        dataType: 'number',
        allowInput: true,
        defaultValue: 1,
        description: 'How far the output swings above and below Offset.',
      },
      {
        name: 'Offset',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0,
        description: 'The middle value the wobble swings around.',
      },
    ],
    outputs: [
      {
        name: 'Out',
        dataType: 'signal',
        description:
          'The wobbling value, from Offset - Amplitude to Offset + Amplitude. Connect it to any yellow input.',
      },
    ],
  }),
  constant: makeTypeOfNodeWithAutoInfer({
    name: 'Constant',
    description:
      'Outputs one fixed value as a signal, so you can feed the same number into several yellow inputs.',
    headerColor: '#b45309',
    locationInContextMenu: MENU_CONTROL.path,
    priorityInContextMenu: MENU_CONTROL.rank,
    inputs: [
      {
        name: 'Value',
        dataType: 'number',
        allowInput: true,
        defaultValue: 1,
        description: 'The value to output.',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'signal' }],
  }),
  map: makeTypeOfNodeWithAutoInfer({
    name: 'Map',
    description:
      'Turns a 0–100 % knob into any range, such as 200–8000 Hz. Use one knob to move several settings, each over its own range.',
    headerColor: '#b45309',
    locationInContextMenu: MENU_CONTROL.path,
    priorityInContextMenu: MENU_CONTROL.rank,
    inputs: [
      {
        name: 'Amount',
        dataType: 'signal',
        allowInput: true,
        defaultValue: 50,
        min: 0,
        max: 100,
        step: 1,
        description:
          '0–100 %. 0 gives Low, 100 gives High. Connect a curve or another knob to move it live.',
      },
      {
        name: 'Low',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0,
        description: 'The value at 0 %.',
      },
      {
        name: 'High',
        dataType: 'number',
        allowInput: true,
        defaultValue: 1,
        description: 'The value at 100 %.',
      },
      {
        name: 'Curve',
        dataType: 'mapCurve',
        allowInput: true,
        defaultValue: 'linear',
        description:
          'linear moves in even steps; exponential sounds even for pitches, frequencies and times (Low and High must be above 0).',
      },
    ],
    outputs: [
      {
        name: 'Signal',
        dataType: 'signal',
        description: 'The mapped value, live. Connect it to yellow inputs.',
      },
      {
        name: 'Value',
        dataType: 'number',
        description:
          'The mapped value when the graph starts, for blue inputs. It does not follow a connected curve.',
      },
    ],
  }),
  beatClock: makeTypeOfNodeWithAutoInfer({
    name: 'Beat Clock',
    description:
      'The length of a note at the timeline tempo (for example an 8th note at 120 BPM is 0.25 s). Change the tempo and it follows.',
    headerColor: '#b45309',
    locationInContextMenu: MENU_CONTROL.path,
    priorityInContextMenu: MENU_CONTROL.rank,
    inputs: [
      {
        name: 'Note',
        dataType: 'beatDivision',
        allowInput: true,
        defaultValue: '1/8',
        description:
          'Which note: 1/4 is one beat, 1/8 half a beat. T is a triplet (2/3 as long), a dot is 1.5 times as long.',
      },
    ],
    outputs: [
      {
        name: 'Hz',
        dataType: 'signal',
        description:
          'How many of these notes fit in a second. Connect it to a Rate Hz input to wobble in time.',
      },
      {
        name: 'Seconds',
        dataType: 'signal',
        description:
          'How long one note lasts, in seconds. Connect it to a delay time for echoes in time.',
      },
    ],
  }),
  keyboardPitch: makeTypeOfNodeWithAutoInfer({
    name: 'Keyboard Pitch',
    description:
      'The pitch of the last key you pressed on your computer keyboard, one note at a time. Use All Keys to play chords.',
    headerColor: '#b45309',
    locationInContextMenu: MENU_CONTROL.path,
    priorityInContextMenu: MENU_CONTROL.rank,
    // Portamento on the MONO bus: each new key slides from the pitch of the
    // one before it. `off` (default) keeps today's click-free jump.
    inputs: [
      {
        name: 'Glide',
        dataType: 'glideMode',
        allowInput: true,
        defaultValue: 'off',
        description:
          'How the pitch moves to a new note: off jumps, linear and exponential slide evenly, smooth eases in.',
      },
      {
        name: 'Glide ms',
        dataType: 'number',
        allowInput: true,
        defaultValue: 60,
        description:
          'How long the slide to a new note takes, in milliseconds (0–5000). Ignored when Glide is off.',
      },
    ],
    outputs: [
      {
        name: 'Hz',
        dataType: 'signal',
        description:
          'Pitch of the most recent key, in Hz. Connect it to an oscillator’s Frequency.',
      },
    ],
  }),
  // Every key of the physical map as a [gate, Hz] output pair — polyphony
  // by wiring instrument instances per key. Handle names combine the
  // physical key (unique, finger-findable) with its base pitch class
  // (invariant under octave shift).
  allKeys: makeTypeOfNodeWithAutoInfer({
    name: 'All Keys',
    description:
      'Every key of your computer keyboard as its own Gate and Hz pair, so each key can play its own copy of an instrument. This is how you play chords.',
    headerColor: '#b45309',
    locationInContextMenu: MENU_CONTROL.path,
    priorityInContextMenu: MENU_CONTROL.rank,
    // Each key owns its own Hz, so glide here means sliding INTO a new note
    // from the previously played one (and gliding held keys on an octave
    // shift). `off` (default) keeps today's click-free jump.
    inputs: [
      {
        name: 'Glide',
        dataType: 'glideMode',
        allowInput: true,
        defaultValue: 'off',
        description:
          'How a new note slides in from the one played before it: off jumps, linear and exponential slide evenly, smooth eases in.',
      },
      {
        name: 'Glide ms',
        dataType: 'number',
        allowInput: true,
        defaultValue: 60,
        description:
          'How long the slide into a new note takes, in milliseconds (0–5000). Ignored when Glide is off.',
      },
    ],
    outputs: ALL_KEYS_OUTPUTS,
  }),
  // The sole signal→gate crossing — a Schmitt trigger (rise at
  // Threshold+Hysteresis/2, fall at Threshold−Hysteresis/2).
  threshold: makeTypeOfNodeWithAutoInfer({
    name: 'Threshold',
    description:
      'Turns a changing signal into a Gate: on when the signal rises past Threshold, off when it falls back. Use it to trigger notes from a curve or wobble.',
    headerColor: '#b45309',
    locationInContextMenu: MENU_CONTROL.path,
    priorityInContextMenu: MENU_CONTROL.rank,
    inputs: [
      {
        name: 'In',
        dataType: 'signal',
        allowInput: true,
        description:
          'The signal to watch. Several connections are added together.',
      },
      {
        name: 'Threshold',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.5,
        description: 'The level the input has to cross to switch the gate.',
      },
      {
        name: 'Hysteresis',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.1,
        description:
          'A dead zone around Threshold, so small jitters do not flicker the gate on and off. 0 turns it off.',
      },
    ],
    outputs: [
      {
        name: 'Gate',
        dataType: 'boolSignal',
        description: 'On while the input is above the threshold, off below it.',
      },
    ],
  }),

  // ── Physical models ──
  // Digital-waveguide string models. Unlike every other source in this
  // catalog these carry their OWN feedback loop, so their ranges are
  // clamped in the impl and their cores carry a NaN watchdog.
  pluckedString: makeTypeOfNodeWithAutoInfer({
    name: 'Plucked String',
    description:
      'A simulated plucked string, like a guitar or harp. It is plucked each time Gate turns on; add a String Body after it for the wooden tone.',
    headerColor: '#b45309',
    locationInContextMenu: MENU_PHYSICAL.path,
    priorityInContextMenu: MENU_PHYSICAL.rank,
    inputs: [
      {
        name: 'Hz',
        dataType: 'signal',
        allowInput: true,
        description:
          'The note’s pitch in Hz, usually from a keyboard node. Octave shifts it.',
      },
      {
        name: 'Gate',
        dataType: 'boolSignal',
        maxConnections: 1,
        description:
          'Plucks the string when it turns on (a key pressed). Turning off mutes the string if Damp is on.',
      },
      {
        name: 'Amp',
        dataType: 'signal',
        allowInput: true,
        description:
          'How hard the string is plucked, 0–1, read at the moment of the pluck. Harder is louder and brighter.',
      },
      {
        name: 'Position',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.2,
        description:
          'Where you pluck, as a share of the string from the bridge (0.02–0.5). Low is thin and twangy, 0.5 round.',
      },
      {
        name: 'Brightness',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.62,
        description:
          'How long the high overtones last, 0–1. Low sounds dull and muted, high sounds bright and ringing.',
      },
      {
        name: 'Decay s',
        dataType: 'number',
        allowInput: true,
        defaultValue: 7,
        description:
          'Roughly how many seconds the note rings before dying away (0.05–30).',
      },
      // Inharmonicity B: partials sit at k·f0·√(1+B·k²). A guitar lives
      // around 3e-5; a piano needs far more and climbs toward both ends of
      // the keyboard (C2 2.5e-4, C6 1e-3, C7 3.5e-3), so the ceiling is 1e-2.
      // The 4-section allpass cascade reaches piano B exactly from C2 up and
      // saturates gracefully below that.
      {
        name: 'Stiffness',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.00003,
        description:
          'String stiffness (0–0.01). Stiffer pushes the overtones sharp, like a piano; a guitar is about 0.00003.',
      },
      {
        name: 'Polarization',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.5,
        description:
          'Slightly detunes the string’s second direction of swing, 0–1. Higher adds a slow beating to the tail.',
      },
      // Whole-octave transpose of the Hz input. The keyboard's home window is
      // C4–D♯5; a piano's characteristic register sits two octaves below it.
      // `Hz` cannot be scaled upstream — `gain` takes `audio`, not `signal`.
      {
        name: 'Octave',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0,
        description: 'Shifts the incoming pitch by whole octaves, -3 to +3.',
      },
      {
        name: 'Pick',
        dataType: 'pickStyle',
        allowInput: true,
        defaultValue: 'finger',
        description:
          'What plucks the string: a fingertip is softer and a little quieter, a nail sharper and brighter.',
      },
      {
        name: 'Damp',
        dataType: 'toggle',
        allowInput: true,
        defaultValue: 'on',
        description:
          'On: letting go of the key mutes the string. Off: the note rings out on its own.',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),
  // A PIANO string group: 1-3 bridge-coupled unison strings under a felt
  // hammer. Shares the waveguide with `pluckedString`; what makes it a piano
  // is the hammer's contact time (which is why Velocity changes TIMBRE, not
  // just level) and the unison group's two-stage decay.
  struckString: makeTypeOfNodeWithAutoInfer({
    name: 'Struck String',
    description:
      'A simulated piano note: a felt hammer striking one to three strings tuned together. The note is struck each time Gate turns on.',
    headerColor: '#b45309',
    locationInContextMenu: MENU_PHYSICAL.path,
    priorityInContextMenu: MENU_PHYSICAL.rank,
    inputs: [
      {
        name: 'Hz',
        dataType: 'signal',
        allowInput: true,
        description:
          'The note’s pitch in Hz, usually from a keyboard node. Octave shifts it.',
      },
      {
        name: 'Gate',
        dataType: 'boolSignal',
        maxConnections: 1,
        description:
          'Strikes the note when it turns on (a key pressed). Turning off drops the damper if Damp is on.',
      },
      // NOT a volume. The core maps this to hammer contact time, so a soft
      // strike is a DARKER sound and not merely a quieter one — felt is a
      // nonlinear spring, so striking harder shortens contact and widens the
      // excitation's bandwidth. This is the control "soft and emotional"
      // actually needs.
      {
        name: 'Velocity',
        dataType: 'signal',
        allowInput: true,
        description:
          'How hard the key is hit (about 0.25 soft to 1 hard, default 0.8). Harder is brighter as well as louder.',
      },
      // Strike point as a fraction of string length. A real hammer lands near
      // 1/8, which nulls the 8th partial.
      {
        name: 'Position',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.125,
        description:
          'Where the hammer hits, as a share of the string from the bridge (0.02–0.5). Real pianos use about 0.125.',
      },
      {
        name: 'Brightness',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.62,
        description:
          'How long the high overtones last, 0–1. Low sounds dull and muted, high sounds bright and ringing.',
      },
      {
        name: 'Decay s',
        dataType: 'number',
        allowInput: true,
        defaultValue: 8,
        description:
          'Roughly how many seconds the note rings before dying away (0.05–30).',
      },
      // Inharmonicity B: partials sit at k*f0*sqrt(1+B*k^2). A piano's climbs
      // toward both ends of the keyboard (C2 2.5e-4, C7 3.5e-3).
      {
        name: 'Stiffness',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.00025,
        description:
          'String stiffness (0–0.01). Stiffer pushes the overtones sharp; real pianos get stiffer toward both ends.',
      },
      // Strings in the unison group. More than one gives the two-stage decay:
      // in-phase motion drives the bridge and dies, out-of-phase lingers.
      {
        name: 'Strings',
        dataType: 'number',
        allowInput: true,
        defaultValue: 3,
        description:
          'Strings per note, 1–3. More than one gives the piano’s quick first fade and long, soft tail.',
      },
      {
        name: 'Unison c',
        dataType: 'number',
        allowInput: true,
        defaultValue: 3,
        description:
          'How far apart the strings of one note are tuned, in cents (0–60). A few cents gives a gentle shimmer.',
      },
      // Felt hardness: 0 = old and soft, 1 = freshly voiced and bright.
      {
        name: 'Hardness',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.5,
        description:
          'Hammer felt hardness, 0–1. 0 is soft, worn felt (mellow); 1 is hard new felt (bright).',
      },
      {
        name: 'Octave',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0,
        description: 'Shifts the incoming pitch by whole octaves, -3 to +3.',
      },
      // Gate down drops the damper. Off = the sustain pedal.
      {
        name: 'Damp',
        dataType: 'toggle',
        allowInput: true,
        defaultValue: 'on',
        description:
          'On: letting go of the key stops the note. Off: notes ring on, like holding the sustain pedal.',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),
  bowedString: makeTypeOfNodeWithAutoInfer({
    name: 'Bowed String',
    description:
      'A simulated bowed string, like a violin or cello. The bow plays for as long as Gate is on; add a String Body after it for the wooden tone.',
    headerColor: '#b45309',
    locationInContextMenu: MENU_PHYSICAL.path,
    priorityInContextMenu: MENU_PHYSICAL.rank,
    inputs: [
      {
        name: 'Hz',
        dataType: 'signal',
        allowInput: true,
        description: 'The note’s pitch in Hz, usually from a keyboard node.',
      },
      // Gate = the bow ON the string; a LEVEL, not an edge trigger.
      {
        name: 'Gate',
        dataType: 'boolSignal',
        maxConnections: 1,
        description:
          'The bow is on the string while this is on (a key held down) and lifts off when it turns off.',
      },
      {
        name: 'Amp',
        dataType: 'signal',
        allowInput: true,
        description:
          'How strongly you bow, 0–1 (default 0.65). Louder also means a heavier bow nearer the bridge, so brighter.',
      },
      {
        name: 'Force',
        dataType: 'signal',
        allowInput: true,
        description:
          'How hard the bow presses on the string (default 0.3). Too little sounds airy and weak, too much scratchy.',
      },
      {
        name: 'Friction',
        dataType: 'frictionModel',
        allowInput: true,
        defaultValue: 'thermal',
        description:
          'Rosin grip model: thermal (default) is most reliable, frictionCurve goes flat under heavy bow, bowTable is simplest.',
      },
      {
        name: 'Position',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.127,
        description:
          'Where the bow meets the string, as a share of it from the bridge (0.02–0.45). Nearer the bridge is brighter.',
      },
      {
        name: 'Impedance',
        dataType: 'number',
        allowInput: true,
        // 0 = derive from Hz by the equal-tension law (stringPresets).
        defaultValue: 0,
        description:
          'How heavy the string feels to the bow (0.02–4). 0 (default) picks it from the pitch, which suits most uses.',
      },
      {
        name: 'Attack ms',
        dataType: 'number',
        allowInput: true,
        defaultValue: 60,
        description:
          'How long the bow takes to get up to speed after Gate turns on, in milliseconds (1–500).',
      },
      {
        name: 'Release ms',
        dataType: 'number',
        allowInput: true,
        defaultValue: 80,
        description:
          'How long the bow takes to lift off after Gate turns off, in milliseconds (1–1000).',
      },
      {
        name: 'Vib Rate Hz',
        dataType: 'number',
        allowInput: true,
        defaultValue: 5.5,
        description:
          'Vibrato speed: how many times per second the pitch wavers (0–12).',
      },
      {
        name: 'Vib Cents',
        dataType: 'number',
        allowInput: true,
        defaultValue: 12,
        description:
          'Vibrato depth: how far the pitch wavers, in cents (0–60; 100 cents = one semitone). 0 turns it off.',
      },
      {
        name: 'Noise',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.4,
        description: 'Bow hair noise, 0–1: the grit and breath of a real bow.',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),
  jetFlute: makeTypeOfNodeWithAutoInfer({
    name: 'Jet Flute',
    description:
      'A simulated flute: breath blown across the mouth hole of a tube. It sounds for as long as Gate is on.',
    headerColor: '#b45309',
    locationInContextMenu: MENU_PHYSICAL.path,
    priorityInContextMenu: MENU_PHYSICAL.rank,
    inputs: [
      {
        name: 'Hz',
        dataType: 'signal',
        allowInput: true,
        description:
          'The note’s pitch in Hz, usually from a keyboard node. Octave shifts it.',
      },
      // Gate = blowing. A LEVEL, not an edge trigger.
      {
        name: 'Gate',
        dataType: 'boolSignal',
        maxConnections: 1,
        description:
          'Blows while this is on (a key held down) and stops when it turns off.',
      },
      {
        name: 'Amp',
        dataType: 'signal',
        allowInput: true,
        description:
          'Breath strength, 0–1 (default 0.7). Stronger breath is louder.',
      },
      // Open at both ends is what a flute IS; `closed` is the stopped pipe
      // (clarinet, panpipe). See `pipeModes` in dataTypes.ts.
      {
        name: 'Pipe',
        dataType: 'pipeMode',
        allowInput: true,
        defaultValue: 'open',
        description:
          'Choose open for a flute (all harmonics), or closed for a stopped pipe like a clarinet or panpipe (odd harmonics only).',
      },
      // OPEN: fraction of the PERIOD. 1/4 is the phase condition from
      // Euphonics 11.8.1, and it is also what keeps the register from
      // jumping — at 1/5 the octave's loop gain came within 3% of the
      // fundamental's and the model octave-jumped on scattered notes.
      {
        name: 'Jet Ratio',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.25,
        description:
          'Timing of the air jet across the mouth hole (0.05–0.9). Keep near 0.25, or notes may jump up an octave.',
      },
      // OPEN only: how far the air is aimed off the labium edge. The one
      // control over the even harmonics, hence over how flute-like it is.
      {
        name: 'Embouchure',
        dataType: 'number',
        allowInput: true,
        defaultValue: 1,
        description:
          'Open pipe only. How the breath is aimed at the edge (0.2–1.3): lower is breathier and purer, higher reedier.',
      },
      // OPEN only: Benade's tone-hole lattice cutoff. A FIXED frequency, not
      // a multiple of the pitch, which is what makes the top octave pure
      // while the low register stays rich. 0 = a plain tube (no lattice).
      {
        name: 'Tone Hole Hz',
        dataType: 'number',
        allowInput: true,
        defaultValue: 2600,
        description:
          'Open pipe only. Overtones above this frequency (Hz) fade away, as with a real flute’s holes. 0 = a plain tube.',
      },
      // OPEN only: 1 or 2 loss poles, 6 or 12 dB/oct. A real flute's spectrum
      // falls off a cliff past the cutoff; one pole cannot make that shape.
      {
        name: 'Loss Poles',
        dataType: 'number',
        allowInput: true,
        defaultValue: 2,
        description:
          'Open pipe only. 1 or 2: how steeply high overtones are cut. 2 is more flute-like; 1 leaves a brassier edge.',
      },
      // Whole-octave transpose of the Hz input. A voice's RANGE is part of
      // what it is: the keyboard's home window is C4-D#5, which is a concert
      // flute's weakest bottom octave, so the flute sits at +2 and the
      // longhorn at 0.
      {
        name: 'Octave',
        dataType: 'number',
        allowInput: true,
        defaultValue: 2,
        description:
          'Shifts the incoming pitch by whole octaves, -3 to +3. The default +2 puts the keyboard in a flute’s range.',
      },
      {
        name: 'Breath',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.15,
        description: 'How much airy breath noise is mixed into the tone, 0–1.',
      },
      {
        name: 'Vib Rate Hz',
        dataType: 'number',
        allowInput: true,
        defaultValue: 5.925,
        description:
          'Vibrato speed: how many times per second the breath pulses (0–12).',
      },
      {
        name: 'Vib Depth',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.05,
        description:
          'Vibrato depth, 0–1: how strongly the breath pressure pulses. 0 turns it off.',
      },
      {
        name: 'Jet Refl',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.5,
        description:
          'How much of the tube’s sound feeds back into the air jet, 0–1. With an open pipe it mainly changes loudness.',
      },
      // OPEN clamps this to 0.9..0.995: an open end really does reflect
      // nearly all of a pressure wave, and endRefl < 1 is the model's
      // stability condition (the direct path holds no nonlinearity).
      {
        name: 'End Refl',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.95,
        description:
          'How much sound bounces back from the far end of the tube. Kept within 0.9–0.995 when open, 0.5 max when closed.',
      },
      {
        name: 'Attack ms',
        dataType: 'number',
        allowInput: true,
        defaultValue: 40,
        description:
          'How long the breath takes to build after Gate turns on, in milliseconds (1–500).',
      },
      {
        name: 'Release ms',
        dataType: 'number',
        allowInput: true,
        defaultValue: 50,
        description:
          'How long the note takes to stop after Gate turns off, in milliseconds (1–1000).',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),
  stringBody: makeTypeOfNodeWithAutoInfer({
    name: 'String Body',
    description:
      'Adds the wood and air resonances of a guitar or violin body to a bare string. Place it after a Plucked or Bowed String.',
    headerColor: '#b45309',
    locationInContextMenu: MENU_PHYSICAL.path,
    priorityInContextMenu: MENU_PHYSICAL.rank,
    inputs: [
      {
        name: 'In',
        dataType: 'audio',
        maxConnections: 1,
        description: 'The bare string sound to put inside the body.',
      },
      {
        name: 'Preset',
        dataType: 'bodyPreset',
        allowInput: true,
        defaultValue: 'guitar',
        description:
          'Which instrument body to imitate. The custom option currently uses the guitar body.',
      },
      {
        name: 'Scale',
        dataType: 'number',
        allowInput: true,
        defaultValue: 1,
        description:
          'Resizes the body (0.25–4). Above 1 raises its resonances like a smaller body; below 1 a bigger one.',
      },
      // 0 = the preset's own air resonance.
      {
        name: 'Air Hz',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0,
        description:
          'Moves the body’s lowest, boomy air resonance to this frequency in Hz (up to 2000). 0 keeps the preset’s.',
      },
      {
        name: 'Mix',
        dataType: 'number',
        allowInput: true,
        defaultValue: 1,
        description: '0 is the bare string, 1 is the full body sound.',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),

  // ── Adapters ──
  toSignal: makeTypeOfNodeWithAutoInfer({
    name: 'To Signal',
    description:
      'Turns sound into a control signal, so an audio source such as an Oscillator can move a yellow knob.',
    headerColor: '#525252',
    locationInContextMenu: MENU_ROUTING.path,
    priorityInContextMenu: MENU_ROUTING.rank,
    inputs: [{ name: 'In', dataType: 'audio', maxConnections: 1 }],
    outputs: [{ name: 'Out', dataType: 'signal' }],
  }),
  toAudio: makeTypeOfNodeWithAutoInfer({
    name: 'To Audio',
    description:
      'Turns a control signal into sound you can process or hear. Values beyond -1 to 1 will distort, and steady values can thump.',
    headerColor: '#525252',
    locationInContextMenu: MENU_ROUTING.path,
    priorityInContextMenu: MENU_ROUTING.rank,
    inputs: [
      {
        name: 'In',
        dataType: 'signal',
        description:
          'The signal to convert. Several connections are added together.',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),

  // ── Effects (generated from the table) + Saturator ──
  ...effectNodeTypes,
  saturator: makeTypeOfNodeWithAutoInfer({
    name: 'Saturator',
    description:
      'Warm, smooth overdrive that rounds off the loudest peaks, like a pushed tube amp or tape. Gentler than Distortion.',
    headerColor: '#9a3412',
    locationInContextMenu: ['Effects', 'Distortion'],
    priorityInContextMenu: EFFECTS_RANK,
    inputs: [
      {
        name: 'In',
        dataType: 'audio',
        maxConnections: 1,
        description: 'The sound to process.',
      },
      {
        name: 'Drive',
        dataType: 'signal',
        allowInput: true,
        description:
          'How hard the sound is pushed into saturation (default 2). Higher is thicker and grittier.',
      },
      {
        name: 'Trim',
        dataType: 'signal',
        allowInput: true,
        description:
          'Output volume after saturation (default 0.7), to tame the extra loudness Drive adds.',
      },
      {
        name: 'Wet',
        dataType: 'signal',
        allowInput: true,
        description:
          'How much of the effected sound you hear vs. the original, 0–1 (1 = effect only).',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),

  // ── Filter / dynamics / channel / envelope ──
  filter: makeTypeOfNodeWithAutoInfer({
    name: 'Filter',
    description:
      'Removes or boosts part of the frequency range. The default lowpass keeps the lows and makes the sound darker.',
    headerColor: '#1d4ed8',
    locationInContextMenu: MENU_FILTER_EQ.path,
    priorityInContextMenu: MENU_FILTER_EQ.rank,
    inputs: [
      {
        name: 'In',
        dataType: 'audio',
        maxConnections: 1,
        description: 'The sound to filter.',
      },
      {
        name: 'Type',
        dataType: 'filterType',
        allowInput: true,
        defaultValue: 'lowpass',
        description:
          'lowpass keeps lows, highpass keeps highs, bandpass keeps a band, notch cuts one; shelves and peaking boost or cut.',
      },
      {
        name: 'Freq',
        dataType: 'signal',
        allowInput: true,
        description:
          'Where the filter acts, in Hz (default 1200): the cutoff or the centre of the band.',
      },
      {
        name: 'Q',
        dataType: 'signal',
        allowInput: true,
        description:
          'Resonance: how sharp the filter is around Freq (default 1). High values add a ringing peak.',
      },
      {
        name: 'Gain dB',
        dataType: 'signal',
        allowInput: true,
        description:
          'Boost (positive) or cut (negative) in dB. Only used by the lowshelf, highshelf and peaking types.',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),
  eq3: makeTypeOfNodeWithAutoInfer({
    name: 'EQ3',
    description:
      'A simple three-band tone control: turn the lows, mids and highs up or down.',
    headerColor: '#1d4ed8',
    locationInContextMenu: MENU_FILTER_EQ.path,
    priorityInContextMenu: MENU_FILTER_EQ.rank,
    inputs: [
      {
        name: 'In',
        dataType: 'audio',
        maxConnections: 1,
        description: 'The sound to adjust.',
      },
      {
        name: 'Low dB',
        dataType: 'signal',
        allowInput: true,
        description:
          'Boost or cut below about 400 Hz, in dB. 0 leaves it unchanged.',
      },
      {
        name: 'Mid dB',
        dataType: 'signal',
        allowInput: true,
        description:
          'Boost or cut between about 400 Hz and 2500 Hz, in dB. 0 leaves it unchanged.',
      },
      {
        name: 'High dB',
        dataType: 'signal',
        allowInput: true,
        description:
          'Boost or cut above about 2500 Hz, in dB. 0 leaves it unchanged.',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),
  compressor: makeTypeOfNodeWithAutoInfer({
    name: 'Compressor',
    description:
      'Evens out loudness by turning down the parts that get too loud, making a sound steadier and punchier.',
    headerColor: '#1d4ed8',
    locationInContextMenu: MENU_DYNAMICS.path,
    priorityInContextMenu: MENU_DYNAMICS.rank,
    inputs: [
      {
        name: 'In',
        dataType: 'audio',
        maxConnections: 1,
        description: 'The sound to compress.',
      },
      {
        name: 'Threshold dB',
        dataType: 'signal',
        allowInput: true,
        description:
          'Sound louder than this level gets turned down (default -24 dB).',
      },
      {
        name: 'Ratio',
        dataType: 'signal',
        allowInput: true,
        description:
          'How strongly loud parts are reduced (default 4): 4 dB over the threshold comes out as 1 dB. 1 = none.',
      },
      {
        name: 'Attack s',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.003,
        description:
          'How quickly it clamps down on a loud sound, in seconds. Slower lets the start of each hit through.',
      },
      {
        name: 'Release s',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.25,
        description:
          'How quickly it lets go once the sound gets quieter again, in seconds.',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),
  limiter: makeTypeOfNodeWithAutoInfer({
    name: 'Limiter',
    description:
      'A ceiling on loudness: anything louder than the threshold is held down to it. Useful at the end of a chain.',
    headerColor: '#1d4ed8',
    locationInContextMenu: MENU_DYNAMICS.path,
    priorityInContextMenu: MENU_DYNAMICS.rank,
    inputs: [
      {
        name: 'In',
        dataType: 'audio',
        maxConnections: 1,
        description: 'The sound to limit.',
      },
      {
        name: 'Threshold dB',
        dataType: 'signal',
        allowInput: true,
        description: 'The loudest level allowed through, in dB (default -12).',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),
  gate: makeTypeOfNodeWithAutoInfer({
    name: 'Noise Gate',
    description:
      'Mutes the sound whenever it drops below a set level, cutting hiss and hum between notes.',
    headerColor: '#1d4ed8',
    locationInContextMenu: MENU_DYNAMICS.path,
    priorityInContextMenu: MENU_DYNAMICS.rank,
    inputs: [
      {
        name: 'In',
        dataType: 'audio',
        maxConnections: 1,
        description: 'The sound to gate.',
      },
      {
        name: 'Threshold dB',
        dataType: 'number',
        allowInput: true,
        defaultValue: -40,
        description: 'Sound quieter than this level, in dB, is muted.',
      },
      {
        name: 'Smoothing s',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.1,
        description:
          'How gradually the gate follows the sound level, in seconds. Longer avoids choppy cut-offs.',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),
  gain: makeTypeOfNodeWithAutoInfer({
    name: 'Gain',
    description:
      'Changes the volume by multiplying it: 1 leaves it unchanged, 0 is silent, 2 is twice as loud.',
    headerColor: '#334155',
    locationInContextMenu: MENU_ROUTING.path,
    priorityInContextMenu: MENU_ROUTING.rank,
    inputs: [
      {
        name: 'In',
        dataType: 'audio',
        maxConnections: 1,
        description: 'The sound to change the volume of.',
      },
      {
        name: 'Gain',
        dataType: 'signal',
        allowInput: true,
        description:
          'The volume multiplier (default 1). Connect an envelope or a Pulser to move the volume over time.',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),
  pan: makeTypeOfNodeWithAutoInfer({
    name: 'Pan',
    description: 'Places a sound to the left or right in stereo.',
    headerColor: '#334155',
    locationInContextMenu: MENU_ROUTING.path,
    priorityInContextMenu: MENU_ROUTING.rank,
    inputs: [
      {
        name: 'In',
        dataType: 'audio',
        maxConnections: 1,
        description: 'The sound to place.',
      },
      {
        name: 'Pan',
        dataType: 'signal',
        allowInput: true,
        description: '-1 is fully left, 0 is centre, 1 is fully right.',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),
  crossFade: makeTypeOfNodeWithAutoInfer({
    name: 'Cross Fade',
    description: 'Blends between two sounds, A and B, with a single control.',
    headerColor: '#334155',
    locationInContextMenu: MENU_ROUTING.path,
    priorityInContextMenu: MENU_ROUTING.rank,
    inputs: [
      {
        name: 'A',
        dataType: 'audio',
        maxConnections: 1,
        description: 'The sound heard when Fade is 0.',
      },
      {
        name: 'B',
        dataType: 'audio',
        maxConnections: 1,
        description: 'The sound heard when Fade is 1.',
      },
      {
        name: 'Fade',
        dataType: 'signal',
        allowInput: true,
        description:
          '0 plays only A, 1 plays only B, 0.5 (default) an even blend.',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),
  mix: makeTypeOfNodeWithAutoInfer({
    name: 'Mix',
    description: 'Adds several sounds together into one.',
    headerColor: '#334155',
    locationInContextMenu: MENU_ROUTING.path,
    priorityInContextMenu: MENU_ROUTING.rank,
    inputs: [
      {
        name: 'In',
        dataType: 'audio',
        maxConnections: 32,
        description:
          'Connect up to 32 sounds here; they are all added together.',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),
  adsr: makeTypeOfNodeWithAutoInfer({
    name: 'ADSR',
    description:
      'Shapes a sound’s volume over each note: it rises (Attack), falls (Decay) to a held level (Sustain), then fades out (Release).',
    headerColor: '#15803d',
    locationInContextMenu: MENU_DYNAMICS.path,
    priorityInContextMenu: MENU_DYNAMICS.rank,
    inputs: [
      {
        name: 'In',
        dataType: 'audio',
        maxConnections: 1,
        description: 'The sound to shape.',
      },
      // Gate CONNECTED switches the node to the sample-accurate
      // envelopeCore worklet following this gate; unconnected = the
      // legacy global-keyboard-bus Tone envelope, byte-for-byte (zero
      // existing patches change).
      {
        name: 'Gate',
        dataType: 'boolSignal',
        maxConnections: 1,
        description:
          'When connected, notes start and stop with this gate. Left empty, it follows your computer keyboard.',
      },
      {
        name: 'Trigger',
        dataType: 'triggerMode',
        allowInput: true,
        defaultValue: 'high',
        description:
          'Only with Gate connected. high: play while on. low: while off. rising, falling, any: a one-shot on that change.',
      },
      {
        name: 'Attack s',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.01,
        description:
          'Seconds to rise from silence to full volume when a note starts.',
      },
      {
        name: 'Decay s',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.1,
        description: 'Seconds to fall from full volume to the Sustain level.',
      },
      {
        name: 'Sustain',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.5,
        description: 'The volume held while the note is held, 0–1.',
      },
      {
        name: 'Release s',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.3,
        description: 'Seconds to fade to silence after the note is let go.',
      },
    ],
    // Env: the envelope VALUE as a signal — drives wavetable crossfades,
    // filter motion, internal pitch envelopes. Active in gate mode; a
    // constant 0 in legacy mode (documented).
    outputs: [
      { name: 'Out', dataType: 'audio', description: 'The shaped sound.' },
      {
        name: 'Env',
        dataType: 'signal',
        description:
          'The envelope’s level (0–1) as a signal, to move a filter or other knob. Stays 0 unless Gate is connected.',
      },
    ],
  }),

  // ── Timeline: one node per curve reference; the picker input takes no
  // edges; 'Signal' is the live driver and 'Value' samples the curve at
  // RUN time ──
  // Explicit type argument (generic-inference widening) — a pre-built
  // object argument otherwise widens DataTypeUniqueId to string.
  // Spread + menu fields: the plugin factory doesn't know this app's menu
  // taxonomy, so the subpath is stamped on here.
  // A Feedback Delay Network reverb, hand-written rather than generated from
  // `effectTable` because it is a worklet, not a Tone effect.
  //
  // It exists because `reverb` (Tone.Reverb) is a convolution against a FIXED
  // decaying-noise impulse response: no delay network, so nothing to modulate
  // and no way to set decay per frequency band. Those two are exactly what the
  // lush, "from the sky" reverb sound is made of.
  fdnReverb: makeTypeOfNodeWithAutoInfer({
    name: 'FDN Reverb',
    description:
      'A lush, smooth reverb with a gently moving tail. Unlike Reverb, its Decay s is the real tail length, and highs can fade before lows.',
    headerColor: '#3f6212',
    locationInContextMenu: ['Effects', 'Reverb'],
    priorityInContextMenu: EFFECTS_RANK,
    inputs: [
      {
        name: 'In',
        dataType: 'audio',
        maxConnections: 1,
        description: 'The sound to add reverb to.',
      },
      // Dry/wet is the parameter people automate, so it is a signal.
      {
        name: 'Mix',
        dataType: 'signal',
        allowInput: true,
        description:
          'How much reverb you hear vs. the original sound, 0–1 (default 0.35).',
      },
      // Scales every delay length: the size of the room.
      {
        name: 'Size',
        dataType: 'number',
        allowInput: true,
        defaultValue: 1,
        description:
          'Size of the space (0.1–4). Bigger spreads the echoes further apart.',
      },
      // T60 at low frequency. Unlike `reverb`'s `Decay s`, this IS the decay
      // time — the per-line gains solve for it directly.
      {
        name: 'Decay s',
        dataType: 'number',
        allowInput: true,
        defaultValue: 3,
        description:
          'How many seconds the tail takes to die away for low sounds (0.05–60).',
      },
      // One-pole cutoff inside each feedback path; lower = highs die sooner,
      // the way a real room's air and soft surfaces behave.
      {
        name: 'Damping Hz',
        dataType: 'number',
        allowInput: true,
        defaultValue: 6000,
        description:
          'Highs above about this frequency fade sooner in the tail. Lower sounds darker, like a soft-furnished room.',
      },
      // THE control that makes it lush. A static FDN rings metallically; the
      // delay lengths are swept by a multi-phase oscillator to smear its modes.
      {
        name: 'Mod Rate Hz',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.7,
        description:
          'Speed of a slow wobble inside the tail, in Hz (0–10). It keeps the tail from ringing metallically.',
      },
      // Depth in ms, but what you HEAR is pitch deviation:
      // depth_samples * 2*pi*rate / fs. At the 0.7 Hz default, 1 ms is about
      // 7.6 cents and 4 ms about 30 — past a few cents it stops being shimmer
      // and becomes a warble.
      {
        name: 'Mod Depth ms',
        dataType: 'number',
        allowInput: true,
        defaultValue: 1,
        description:
          'Amount of that wobble, in milliseconds (0–50). About 1 adds shimmer; much more makes the tail warble.',
      },
      // Density: input allpass diffusion, which spreads a single impulse into
      // a burst before the network sees it.
      {
        name: 'Diffusion',
        dataType: 'number',
        allowInput: true,
        defaultValue: 0.6,
        description:
          'How quickly echoes blur into a smooth wash, 0–1. Low values leave separate early echoes audible.',
      },
      {
        name: 'Low Cut Hz',
        dataType: 'number',
        allowInput: true,
        defaultValue: 120,
        description:
          'Lows below this frequency are kept out of the reverb, so the tail stays clear instead of muddy.',
      },
      {
        name: 'Width',
        dataType: 'number',
        allowInput: true,
        defaultValue: 1,
        description: 'Stereo spread of the tail, 0 (mono) to 1 (wide).',
      },
    ],
    outputs: [{ name: 'Out', dataType: 'audio' }],
  }),

  timelineCurve: makeTypeOfNodeWithAutoInfer<SoundDataTypeId>({
    ...makeTimelineCurveNodeType({
      signalDataTypeId: 'signal',
      numberDataTypeId: 'number',
      curveRefDataTypeId: 'curveRef',
    }),
    description:
      'Plays a curve drawn on the timeline. Signal follows the curve during playback; Value is its value when the graph is built and stays fixed.',
    locationInContextMenu: MENU_CONTROL.path,
    priorityInContextMenu: MENU_CONTROL.rank,
  }),

  // ── Output ──
  render: makeTypeOfNodeWithAutoInfer({
    name: 'Render',
    description:
      'Sends a sound to your speakers. A sound is only heard once it reaches a Render node; several Renders add together.',
    headerColor: '#b91c1c',
    locationInContextMenu: MENU_OUTPUT.path,
    priorityInContextMenu: MENU_OUTPUT.rank,
    inputs: [
      {
        name: 'In',
        dataType: 'audio',
        maxConnections: 1,
        description: 'The sound to play.',
      },
      {
        name: 'Level dB',
        dataType: 'signal',
        allowInput: true,
        description:
          'Playback volume in dB (default -6). 0 is full level; more negative is quieter.',
      },
    ],
    outputs: [],
  }),
};

type SoundNodeTypeId = keyof typeof soundNodeTypes;

export { soundNodeTypes };
export type { SoundNodeTypeId };

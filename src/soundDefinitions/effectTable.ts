/**
 * The table-driven effect catalog: one row per Tone effect class.
 * `nodeTypes.ts` generates the node definitions from these rows, and
 * `effectAudio.ts` binds each row to its Tone class for `implementations.ts`.
 *
 * THIS FILE IS METADATA ONLY, and must never import `tone`. Measured
 * 2026-10-09 with an esbuild metafile: when the Tone factories lived in these
 * rows, `nodeTypes.ts` pulled all of Tone (183 modules) into anything that
 * merely DESCRIBES a graph — every landing-page showcase frame among them,
 * each of which then created an AudioContext and logged "AudioContext was
 * not allowed to start". The audio half lives in `effectAudio.ts`, keyed by
 * the ids below; the type there makes a missing or extra binding a compile
 * error, and `effectTableSplit.test.ts` checks the same at runtime.
 *
 * Per-param kinds were verified against the INSTALLED Tone 15.1.22 d.ts:
 * `signal` = the target is a live Param/Signal (schedulable +
 * connectable), `number` = a plain property Tone reads on assignment.
 * Getting this wrong is a silent-behavior bug class.
 */

type EffectSignalParam = {
  input: string;
  /** In-app documentation shown behind the socket's info icon. */
  description?: string;
  fallback: number;
  /** Mod-domain declaration; defaults to 'normal' (0–1-ish native
   *  range). */
  modDomain?: 'linear' | 'dB-native' | 'Hz' | 's' | 'normal' | 'bits';
};

type EffectNumberParam = {
  input: string;
  /** In-app documentation shown behind the socket's info icon. */
  description?: string;
  fallback: number;
};

type EffectRow = {
  /** Node type id (camelCase) and display name. */
  id: string;
  name: string;
  /** In-app documentation shown behind the node title's info icon. */
  description?: string;
  headerColor: string;
  /** Params whose Tone target is a Param/Signal → `signal` inputs. */
  signalParams: ReadonlyArray<EffectSignalParam>;
  /** Plain-property params → `number` inputs (defaultValue-seeded knobs). */
  numberParams: ReadonlyArray<EffectNumberParam>;
};

const wetParam = {
  input: 'Wet',
  description:
    'How much of the effected sound you hear vs. the original, 0–1 (1 = effect only).',
  fallback: 1,
} as const;

const effectRows = [
  {
    id: 'distortion',
    name: 'Distortion',
    description:
      'Harsh, gritty overdrive that clips the sound, like a guitar distortion pedal.',
    headerColor: '#9a3412',
    signalParams: [wetParam],
    numberParams: [
      {
        input: 'Amount',
        description: 'How much distortion, 0 (clean) to 1 (heavy).',
        fallback: 0.4,
      },
    ],
  },
  {
    id: 'chebyshev',
    name: 'Chebyshev',
    description:
      'Distortion that adds a chosen set of extra overtones. Odd and even Order values sound quite different.',
    headerColor: '#9a3412',
    signalParams: [wetParam],
    numberParams: [
      {
        input: 'Order',
        description:
          'Which overtone the sound is bent toward. 1 leaves it unchanged; higher is buzzier and brighter.',
        fallback: 4,
      },
    ],
  },
  {
    id: 'bitCrusher',
    name: 'Bit Crusher',
    description:
      'Lo-fi grit: lowers the sound’s resolution, like an old video game or early sampler.',
    headerColor: '#9a3412',
    signalParams: [
      wetParam,
      {
        input: 'Bits',
        description:
          'Resolution in bits (1–16). Fewer bits sound noisier and crunchier; the default 4 is heavily crushed.',
        fallback: 4,
        modDomain: 'bits',
      },
    ],
    numberParams: [],
  },
  {
    id: 'chorus',
    name: 'Chorus',
    description:
      'Thickens a sound by layering slightly delayed, wavering copies of it, like several players in unison.',
    headerColor: '#155e75',
    signalParams: [
      wetParam,
      {
        input: 'Rate Hz',
        description:
          'How fast the copies waver, in times per second (default 1.5).',
        fallback: 1.5,
        modDomain: 'Hz',
      },
    ],
    numberParams: [
      {
        input: 'Delay ms',
        description:
          'How far behind the original the copies sit, in milliseconds (default 3.5).',
        fallback: 3.5,
      },
      {
        input: 'Depth',
        description: 'How far the copies waver, 0–1.',
        fallback: 0.7,
      },
    ],
  },
  {
    id: 'phaser',
    name: 'Phaser',
    description:
      'A sweeping, swooshing effect made by moving notches up and down through the sound.',
    headerColor: '#155e75',
    signalParams: [
      wetParam,
      {
        input: 'Rate Hz',
        description:
          'How fast the sweep moves, in sweeps per second (default 0.5).',
        fallback: 0.5,
        modDomain: 'Hz',
      },
      {
        input: 'Q',
        description: 'How sharp and pronounced the notches are (default 10).',
        fallback: 10,
      },
    ],
    numberParams: [
      {
        input: 'Octaves',
        description: 'How wide the sweep is, in octaves above Base Hz.',
        fallback: 3,
      },
      {
        input: 'Base Hz',
        description: 'The lowest frequency the sweep reaches, in Hz.',
        fallback: 350,
      },
    ],
  },
  {
    id: 'tremolo',
    name: 'Tremolo',
    description: 'Pulses the volume up and down in a steady rhythm.',
    headerColor: '#155e75',
    signalParams: [
      wetParam,
      {
        input: 'Rate Hz',
        description: 'Volume pulses per second (default 10).',
        fallback: 10,
        modDomain: 'Hz',
      },
      {
        input: 'Depth',
        description:
          'How deep the volume dips, 0 (not at all) to 1 (down to silence).',
        fallback: 0.5,
      },
    ],
    numberParams: [],
  },
  {
    id: 'vibrato',
    name: 'Vibrato',
    description:
      'Wobbles the pitch up and down, like a singer’s or violinist’s vibrato.',
    headerColor: '#155e75',
    signalParams: [
      wetParam,
      {
        input: 'Rate Hz',
        description: 'Pitch wobbles per second (default 5).',
        fallback: 5,
        modDomain: 'Hz',
      },
      {
        input: 'Depth',
        description: 'How far the pitch wobbles, 0–1 (default 0.1).',
        fallback: 0.1,
      },
    ],
    numberParams: [],
  },
  {
    id: 'autoFilter',
    name: 'Auto Filter',
    description:
      'A filter that sweeps up and down by itself, for a rhythmic, wah-like movement.',
    headerColor: '#155e75',
    signalParams: [
      wetParam,
      {
        input: 'Rate Hz',
        description: 'Filter sweeps per second (default 1).',
        fallback: 1,
        modDomain: 'Hz',
      },
    ],
    numberParams: [
      {
        input: 'Base Hz',
        description: 'The lowest point of the sweep, in Hz.',
        fallback: 200,
      },
      {
        input: 'Octaves',
        description: 'How far above Base Hz the sweep reaches, in octaves.',
        fallback: 2.6,
      },
    ],
  },
  {
    id: 'autoWah',
    name: 'Auto Wah',
    description:
      'A wah filter that opens as the sound gets louder, so the tone follows how hard you play.',
    headerColor: '#155e75',
    signalParams: [wetParam],
    numberParams: [
      {
        input: 'Base Hz',
        description: 'Where the filter sits when the sound is quiet, in Hz.',
        fallback: 100,
      },
      {
        input: 'Octaves',
        description: 'How far above Base Hz the filter can open, in octaves.',
        fallback: 6,
      },
      {
        input: 'Sensitivity dB',
        description:
          'How easily it reacts. Lower values such as -30 let quieter sound open the wah (default 0).',
        fallback: 0,
      },
    ],
  },
  {
    id: 'autoPanner',
    name: 'Auto Panner',
    description:
      'Moves the sound back and forth between the left and right speakers.',
    headerColor: '#155e75',
    signalParams: [
      wetParam,
      {
        input: 'Rate Hz',
        description: 'Left-to-right sweeps per second (default 1).',
        fallback: 1,
        modDomain: 'Hz',
      },
    ],
    numberParams: [],
  },
  {
    id: 'feedbackDelay',
    name: 'Delay',
    description:
      'Echo: repeats the sound after a set time, each repeat quieter than the last.',
    headerColor: '#3f6212',
    signalParams: [
      wetParam,
      {
        input: 'Time s',
        description: 'Time between echoes, in seconds (default 0.25).',
        fallback: 0.25,
        modDomain: 's',
      },
      {
        input: 'Feedback',
        description:
          'How much of each echo comes back as another, 0–1. Higher gives more repeats; near 1 they barely fade.',
        fallback: 0.4,
      },
    ],
    numberParams: [],
  },
  {
    id: 'pingPongDelay',
    name: 'Ping Pong Delay',
    description:
      'Echo that bounces back and forth between the left and right speakers.',
    headerColor: '#3f6212',
    signalParams: [
      wetParam,
      {
        input: 'Time s',
        description: 'Time between echoes, in seconds (default 0.25).',
        fallback: 0.25,
        modDomain: 's',
      },
      {
        input: 'Feedback',
        description:
          'How much of each echo comes back as another, 0–1. Higher gives more repeats; near 1 they barely fade.',
        fallback: 0.4,
      },
    ],
    numberParams: [],
  },
  {
    id: 'reverb',
    name: 'Reverb',
    description:
      'Puts the sound in a room or hall, adding space and distance. Its tail is shorter than Decay s suggests.',
    headerColor: '#3f6212',
    signalParams: [wetParam],
    numberParams: [
      /**
       * `Decay s` IS NOT RT60. It is the length of the generated impulse
       * response, and the envelope inside it decays far faster than the name
       * suggests.
       *
       * `Tone.Reverb` builds the IR as a noise burst under
       * `exponentialApproachValueAtTime(0, preDelay, decay)`, and Tone sets
       * the time constant (`Param.js`) to
       *
       *     tau = ln(decay + 1) / ln(200)
       *
       * so the 60 dB point is at tau * ln(1000):
       *
       *     T60 = 1.3038 * ln(Decay s + 1)
       *
       *   Decay s   2.5 -> T60 1.63 s     Decay s  10 -> T60 3.13 s
       *   Decay s   6.5 -> T60 2.63 s     Decay s  45 -> T60 5.00 s
       *
       * The IR is additionally truncated at `decay + preDelay`, with a forced
       * linear ramp to zero from 90 %. So a genuine 5 s tail costs a 45-second
       * IR (~16 MB at 44.1 kHz stereo) and is not practical here.
       *
       * Inverse, for authoring to a measured target:
       *
       *     Decay s = exp(T60 / 1.3038) - 1
       *
       * Several comments in `probeGraphs.ts` used to describe these values as
       * if they were RT60 ("a 6.5 s tail"). Those were corrected; the VALUES
       * were left alone, because every patch was tuned by ear against what it
       * actually sounded like.
       */
      {
        input: 'Decay s',
        description:
          'Length of the reverb it builds, in seconds. The tail you hear is shorter: 2.5 gives about 1.6 s.',
        fallback: 2.5,
      },
      {
        input: 'PreDelay s',
        description:
          'A short gap before the reverb starts, in seconds. It keeps the original sound clear.',
        fallback: 0.01,
      },
    ],
  },
  {
    id: 'freeverb',
    name: 'Freeverb',
    description:
      'A classic room reverb whose room size can change while it plays.',
    headerColor: '#3f6212',
    signalParams: [
      wetParam,
      {
        input: 'Room Size',
        description: 'Size of the room, 0–1. Larger gives a longer tail.',
        fallback: 0.7,
      },
    ],
    numberParams: [
      {
        input: 'Dampening Hz',
        description:
          'Highs above about this frequency fade sooner in the tail. Lower sounds darker (default 3000).',
        fallback: 3000,
      },
    ],
  },
  {
    id: 'jcReverb',
    name: 'JC Reverb',
    description:
      'A simple vintage digital reverb with a slightly metallic ring.',
    headerColor: '#3f6212',
    signalParams: [
      wetParam,
      {
        input: 'Room Size',
        description: 'Size of the room, 0–1. Larger gives a longer tail.',
        fallback: 0.5,
      },
    ],
    numberParams: [],
  },
  {
    id: 'frequencyShifter',
    name: 'Freq Shifter',
    description:
      'Moves every frequency by the same number of Hz. Unlike Pitch Shift this breaks the harmony, giving bell-like or robotic tones.',
    headerColor: '#86198f',
    signalParams: [
      wetParam,
      {
        input: 'Shift Hz',
        description:
          'How many Hz to add to every frequency. Negative values move everything down.',
        fallback: 0,
        modDomain: 'Hz',
      },
    ],
    numberParams: [],
  },
  {
    id: 'pitchShift',
    name: 'Pitch Shift',
    description:
      'Shifts pitch up or down in semitones without changing speed. With Feedback it stacks shifted copies, as in a shimmer reverb.',
    headerColor: '#86198f',
    signalParams: [
      wetParam,
      {
        // `Tone.PitchShift` extends `FeedbackEffect` and owns a real feedback
        // Param that this row never surfaced. It is what separates a single
        // transposed copy from a REGENERATING ladder: each pass round the
        // internal loop is shifted again, so one node at +12 produces +12,
        // +24, +36... decaying — the octave stack a shimmer reverb is made
        // of. Our graph forbids cycles (`enableCycleChecking`), so this is
        // the only place a genuine audio feedback loop is available at all.
        //
        // Fallback 0 is Tone's own default, so every existing patch keeps its
        // current sound. It is a normalRange Param, so Tone bounds it to
        // 0..1; values near 1 pile octaves into ultrasonic hiss, and anything
        // above ~0.7 needs a lowpass after it to stay musical.
        input: 'Feedback',
        description:
          'Sends the shifted sound round again to be shifted further, 0–1. Above about 0.7, add a lowpass after it.',
        fallback: 0,
      },
    ],
    numberParams: [
      {
        input: 'Semitones',
        description:
          'How far to shift, in semitones: 12 is an octave up, -12 an octave down.',
        fallback: 0,
      },
      {
        input: 'Window s',
        description:
          'Length of the slices it works in, in seconds (0.01–0.5). 0.03–0.1 suits most sounds.',
        fallback: 0.1,
      },
    ],
  },
  {
    id: 'stereoWidener',
    name: 'Stereo Widener',
    description: 'Makes a stereo sound wider or narrower.',
    headerColor: '#86198f',
    signalParams: [
      wetParam,
      {
        input: 'Width',
        description:
          '0 is mono, 0.5 leaves the sound unchanged, 1 is as wide as it goes.',
        fallback: 0.5,
      },
    ],
    numberParams: [],
  },
] as const satisfies readonly EffectRow[];

type EffectRowId = (typeof effectRows)[number]['id'];

/** The row whose id is `Id` — lets `effectAudio.ts` type its bindings by the
 *  exact socket names this table declares. */
type EffectRowById<Id extends EffectRowId> = Extract<
  (typeof effectRows)[number],
  { id: Id }
>;
type EffectSignalInput<Id extends EffectRowId> =
  EffectRowById<Id>['signalParams'][number]['input'];
type EffectNumberInput<Id extends EffectRowId> =
  EffectRowById<Id>['numberParams'][number]['input'];

export { effectRows };
export type {
  EffectNumberInput,
  EffectNumberParam,
  EffectRow,
  EffectRowId,
  EffectSignalInput,
  EffectSignalParam,
};

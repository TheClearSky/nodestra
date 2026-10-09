/**
 * The AUDIO half of the effect table: each `effectTable.ts` row's Tone
 * factory and param bindings, keyed by the row's id. Only the audio build
 * (`implementations.ts`) imports this; anything that merely describes a
 * graph imports `effectTable.ts`, which is Tone-free (see its header for the
 * measured reason).
 *
 * WHY KEYED BY ID, with each binding keyed by its socket name: the two files
 * cannot drift. `effectAudio` must satisfy a type mapped over every
 * `EffectRowId` and, per row, over that row's exact signal/number input
 * names — a missing or extra effect, or a binding for a renamed socket, is a
 * compile error, and `effectTableSplit.test.ts` checks the same at runtime.
 *
 * The ORDER in which params are applied comes from the metadata rows (number
 * params first, then signal params, each in row order), exactly as before
 * the split. It matters: Tone's `Reverb` regenerates its IR on every `decay`
 * / `preDelay` assignment (both setters call `generate()` in Reverb.js), and
 * `awaitReady` must wait on the LAST of those generations.
 *
 * Closures cast `node` to the concrete class — the row data IS the seam
 * between the generic factory and Tone's heterogeneous classes.
 */

import * as Tone from 'tone';
import type {
  EffectNumberInput,
  EffectRowId,
  EffectSignalInput,
} from './effectTable';
import { effectRows } from './effectTable';
import type { ParamLike } from './valueTypes';

type EffectNode = { dispose: () => unknown };

type SignalBinding = {
  target: (node: EffectNode) => ParamLike;
  /** Replace-on-connect base when 0 is not silent/legal in the param's
   *  native domain; defaults to 0. */
  replaceBase?: number;
};

type NumberSetter = (node: EffectNode, value: number) => void;

type EffectAudio<Id extends EffectRowId> = {
  make: () => EffectNode;
  /** One binding per `signalParams` input of the row. */
  signalTargets: Record<EffectSignalInput<Id>, SignalBinding>;
  /** One setter per `numberParams` input of the row. */
  numberSetters: Record<EffectNumberInput<Id>, NumberSetter>;
  /** LFO-driven effects must `.start()`. */
  needsStart?: boolean;
  /** Async-ready effects (Reverb) are awaited before connecting. */
  awaitReady?: (node: EffectNode) => Promise<unknown>;
};

const wetTarget: SignalBinding = {
  target: (node: EffectNode) => (node as unknown as { wet: ParamLike }).wet,
};

const effectAudio = {
  distortion: {
    make: () => new Tone.Distortion({ distortion: 0.4 }),
    signalTargets: { Wet: wetTarget },
    numberSetters: {
      Amount: (node, value) => {
        (node as Tone.Distortion).distortion = Math.min(1, Math.max(0, value));
      },
    },
  },
  chebyshev: {
    make: () => new Tone.Chebyshev({ order: 4 }),
    signalTargets: { Wet: wetTarget },
    numberSetters: {
      Order: (node, value) => {
        (node as Tone.Chebyshev).order = Math.max(1, Math.round(value));
      },
    },
  },
  bitCrusher: {
    make: () => new Tone.BitCrusher({ bits: 4 }),
    signalTargets: {
      Wet: wetTarget,
      Bits: {
        target: (node) => (node as Tone.BitCrusher).bits,
        // Param minValue is 1 — a zero base THROWS assertRange.
        replaceBase: 1,
      },
    },
    numberSetters: {},
  },
  chorus: {
    make: () => new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.7 }),
    signalTargets: {
      Wet: wetTarget,
      'Rate Hz': { target: (node) => (node as Tone.Chorus).frequency },
    },
    numberSetters: {
      'Delay ms': (node, value) => {
        (node as Tone.Chorus).delayTime = value;
      },
      Depth: (node, value) => {
        (node as Tone.Chorus).depth = Math.min(1, Math.max(0, value));
      },
    },
    needsStart: true,
  },
  phaser: {
    make: () =>
      new Tone.Phaser({ frequency: 0.5, octaves: 3, baseFrequency: 350 }),
    signalTargets: {
      Wet: wetTarget,
      'Rate Hz': { target: (node) => (node as Tone.Phaser).frequency },
      Q: { target: (node) => (node as Tone.Phaser).Q },
    },
    numberSetters: {
      Octaves: (node, value) => {
        (node as Tone.Phaser).octaves = Math.max(0, value);
      },
      'Base Hz': (node, value) => {
        (node as Tone.Phaser).baseFrequency = value;
      },
    },
  },
  tremolo: {
    make: () => new Tone.Tremolo({ frequency: 10, depth: 0.5 }),
    signalTargets: {
      Wet: wetTarget,
      'Rate Hz': { target: (node) => (node as Tone.Tremolo).frequency },
      Depth: { target: (node) => (node as Tone.Tremolo).depth },
    },
    numberSetters: {},
    needsStart: true,
  },
  vibrato: {
    make: () => new Tone.Vibrato({ frequency: 5, depth: 0.1 }),
    signalTargets: {
      Wet: wetTarget,
      'Rate Hz': { target: (node) => (node as Tone.Vibrato).frequency },
      Depth: { target: (node) => (node as Tone.Vibrato).depth },
    },
    numberSetters: {},
  },
  autoFilter: {
    make: () =>
      new Tone.AutoFilter({ frequency: 1, baseFrequency: 200, octaves: 2.6 }),
    signalTargets: {
      Wet: wetTarget,
      'Rate Hz': { target: (node) => (node as Tone.AutoFilter).frequency },
    },
    numberSetters: {
      'Base Hz': (node, value) => {
        (node as Tone.AutoFilter).baseFrequency = value;
      },
      Octaves: (node, value) => {
        (node as Tone.AutoFilter).octaves = Math.max(0, value);
      },
    },
    needsStart: true,
  },
  autoWah: {
    make: () =>
      new Tone.AutoWah({ baseFrequency: 100, octaves: 6, sensitivity: 0 }),
    signalTargets: { Wet: wetTarget },
    numberSetters: {
      'Base Hz': (node, value) => {
        (node as Tone.AutoWah).baseFrequency = value;
      },
      Octaves: (node, value) => {
        (node as Tone.AutoWah).octaves = Math.max(0, value);
      },
      'Sensitivity dB': (node, value) => {
        (node as Tone.AutoWah).sensitivity = value;
      },
    },
  },
  autoPanner: {
    make: () => new Tone.AutoPanner({ frequency: 1 }),
    signalTargets: {
      Wet: wetTarget,
      'Rate Hz': { target: (node) => (node as Tone.AutoPanner).frequency },
    },
    numberSetters: {},
    needsStart: true,
  },
  feedbackDelay: {
    make: () => new Tone.FeedbackDelay({ delayTime: 0.25, feedback: 0.4 }),
    signalTargets: {
      Wet: wetTarget,
      'Time s': { target: (node) => (node as Tone.FeedbackDelay).delayTime },
      Feedback: { target: (node) => (node as Tone.FeedbackDelay).feedback },
    },
    numberSetters: {},
  },
  pingPongDelay: {
    make: () => new Tone.PingPongDelay({ delayTime: 0.25, feedback: 0.4 }),
    signalTargets: {
      Wet: wetTarget,
      'Time s': { target: (node) => (node as Tone.PingPongDelay).delayTime },
      Feedback: { target: (node) => (node as Tone.PingPongDelay).feedback },
    },
    numberSetters: {},
  },
  reverb: {
    make: () => new Tone.Reverb({ decay: 2.5, preDelay: 0.01 }),
    signalTargets: { Wet: wetTarget },
    numberSetters: {
      // `Decay s` is the IR length, NOT RT60 — the law is on the row in
      // `effectTable.ts`.
      'Decay s': (node, value) => {
        (node as Tone.Reverb).decay = Math.max(0.001, value);
      },
      'PreDelay s': (node, value) => {
        (node as Tone.Reverb).preDelay = Math.max(0, value);
      },
    },
    awaitReady: (node) => (node as Tone.Reverb).ready,
  },
  freeverb: {
    make: () => new Tone.Freeverb({ roomSize: 0.7, dampening: 3000 }),
    signalTargets: {
      Wet: wetTarget,
      'Room Size': { target: (node) => (node as Tone.Freeverb).roomSize },
    },
    numberSetters: {
      'Dampening Hz': (node, value) => {
        (node as Tone.Freeverb).dampening = value;
      },
    },
  },
  jcReverb: {
    make: () => new Tone.JCReverb({ roomSize: 0.5 }),
    signalTargets: {
      Wet: wetTarget,
      'Room Size': { target: (node) => (node as Tone.JCReverb).roomSize },
    },
    numberSetters: {},
  },
  frequencyShifter: {
    make: () => new Tone.FrequencyShifter({ frequency: 0 }),
    signalTargets: {
      Wet: wetTarget,
      'Shift Hz': {
        target: (node) => (node as Tone.FrequencyShifter).frequency,
      },
    },
    numberSetters: {},
  },
  pitchShift: {
    make: () => new Tone.PitchShift({ pitch: 0, windowSize: 0.1 }),
    signalTargets: {
      Wet: wetTarget,
      // The FeedbackEffect's own feedback Param — why it is surfaced is on
      // the row in `effectTable.ts`.
      Feedback: { target: (node) => (node as Tone.PitchShift).feedback },
    },
    numberSetters: {
      Semitones: (node, value) => {
        (node as Tone.PitchShift).pitch = value;
      },
      'Window s': (node, value) => {
        (node as Tone.PitchShift).windowSize = Math.min(
          0.5,
          Math.max(0.01, value),
        );
      },
    },
  },
  stereoWidener: {
    make: () => new Tone.StereoWidener({ width: 0.5 }),
    signalTargets: {
      Wet: wetTarget,
      Width: { target: (node) => (node as Tone.StereoWidener).width },
    },
    numberSetters: {},
  },
} satisfies { [Id in EffectRowId]: EffectAudio<Id> };

/**
 * A metadata row joined with its audio binding — the flat shape the effect
 * factory in `implementations.ts` consumes. Param order and fallbacks come
 * from the metadata row; only the Tone-facing functions come from here.
 */
type BoundEffectRow = {
  id: EffectRowId;
  name: string;
  make: () => EffectNode;
  signalParams: ReadonlyArray<{
    input: string;
    fallback: number;
    target: (node: EffectNode) => ParamLike;
    replaceBase?: number;
  }>;
  numberParams: ReadonlyArray<{
    input: string;
    fallback: number;
    apply: NumberSetter;
  }>;
  needsStart?: boolean;
  awaitReady?: (node: EffectNode) => Promise<unknown>;
};

/** `effectAudio[id]` with its socket keys widened to string, for lookup by
 *  the metadata's input names. */
type LooseEffectAudio = {
  make: () => EffectNode;
  signalTargets: Readonly<Record<string, SignalBinding>>;
  numberSetters: Readonly<Record<string, NumberSetter>>;
  needsStart?: boolean;
  awaitReady?: (node: EffectNode) => Promise<unknown>;
};

function bindingFor<T>(
  table: Readonly<Record<string, T>>,
  rowId: string,
  input: string,
): T {
  // The mapped type already rules this out; the throw keeps a future cast
  // from turning a missing binding into a silent `undefined` call.
  if (!Object.hasOwn(table, input)) {
    throw new Error(`effectAudio.${rowId} has no binding for "${input}"`);
  }
  return table[input];
}

const boundEffectRows: readonly BoundEffectRow[] = effectRows.map((row) => {
  const audio: LooseEffectAudio = effectAudio[row.id];
  return {
    id: row.id,
    name: row.name,
    make: audio.make,
    signalParams: row.signalParams.map((param) => {
      const binding = bindingFor(audio.signalTargets, row.id, param.input);
      return {
        input: param.input,
        fallback: param.fallback,
        target: binding.target,
        ...(binding.replaceBase !== undefined && {
          replaceBase: binding.replaceBase,
        }),
      };
    }),
    numberParams: row.numberParams.map((param) => ({
      input: param.input,
      fallback: param.fallback,
      apply: bindingFor(audio.numberSetters, row.id, param.input),
    })),
    ...(audio.needsStart !== undefined && { needsStart: audio.needsStart }),
    ...(audio.awaitReady !== undefined && { awaitReady: audio.awaitReady }),
  };
});

export { boundEffectRows, effectAudio };
export type { BoundEffectRow, EffectNode };

/**
 * The value shapes flowing on sound-graph edges plus their guards and zod
 * schemas. Deliberately dependency-free (no tone import) so pure modules
 * and unit tests never touch Web Audio.
 *
 * `output` is typed `unknown` here — it is a live Tone/standardized audio
 * node; only `implementations.ts` (the one Tone-importing seam) narrows it
 * when calling `Tone.connect`.
 */

import { z } from 'zod';
import { WAVEFORM_SAMPLE_COUNT } from './waveformMath';

/** The value on `audio` edges: a connectable live node + staleness guard. */
type AudioChain = {
  readonly kind: 'audioChain';
  readonly output: unknown;
  readonly buildId: number;
  readonly label: string;
};

/** The value on `signal` edges: a connectable modulator source. */
type SignalChain = {
  readonly kind: 'signalChain';
  readonly output: unknown;
  readonly buildId: number;
  readonly label: string;
};

/** The value a WaveformDrawInput commits: ONE cycle, N samples in [−1,1]. */
type WaveformValue = {
  readonly kind: 'waveform';
  readonly samples: readonly number[];
};

/** A schedulable param target (native AudioParam, Tone Param/Signal).
 *  `.value` unifies as unknown — Tone's unit types range over number,
 *  note-name strings, and Time objects; writers cast to `{value: number}`
 *  at the one seam in implementations.ts. */
type ParamLike = { value: unknown };

function isAudioChain(value: unknown): value is AudioChain {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'audioChain'
  );
}

function isSignalChain(value: unknown): value is SignalChain {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'signalChain'
  );
}

/** Length-pinned, all-finite, clamped — NaN must never reach
 *  `createPeriodicWave`. */
const waveformValueSchema = z.object({
  kind: z.literal('waveform'),
  samples: z
    .array(z.number().finite().min(-1).max(1))
    .length(WAVEFORM_SAMPLE_COUNT),
});

/** The `signal` data type's stored KNOB value: a plain finite number.
 *  Runtime edge values are SignalChain objects by contract. */
const signalKnobSchema = z.number().finite();

/** The `audio` data type's schema — identity matters for the host's complex
 *  type checking; values are live objects validated by the guard. */
const audioChainSchema = z.custom<AudioChain>(isAudioChain);

/** The `boolSignal` data type's schema: edges-only (no knob,
 *  allowInput false at the dataType), runtime values are SignalChain
 *  objects carrying an audio-rate 0/1 gate. A DISTINCT schema object from
 *  the signal knob schema so host complex-type identity keeps the two
 *  types apart. */
const boolSignalChainSchema = z.custom<SignalChain>(isSignalChain);

function parseWaveformValue(value: unknown): readonly number[] | undefined {
  const result = waveformValueSchema.safeParse(value);
  return result.success ? result.data.samples : undefined;
}

export {
  audioChainSchema,
  boolSignalChainSchema,
  isAudioChain,
  isSignalChain,
  parseWaveformValue,
  signalKnobSchema,
  waveformValueSchema,
};
export type { AudioChain, ParamLike, SignalChain, WaveformValue };

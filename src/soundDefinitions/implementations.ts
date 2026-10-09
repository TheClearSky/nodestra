/**
 * Function implementations — the ONE Tone-importing seam (with its effect
 * half, `effectAudio.ts`; graph DESCRIPTIONS never import either).
 *
 * Discipline:
 * - the free `Tone.connect` ONLY — member `.connect()` on Signal-family
 *   nodes ZEROES the destination param;
 * - register every created node IMMEDIATELY after construction;
 * - replace-on-connect: a connected signal replaces the knob — the impl
 *   zeroes the base; N signal connections SUM natively;
 * - native nodes via `rawContext.create*()` factories, never DOM
 *   constructors (standardized-audio-context wrapper);
 * - `ensureBuild(context.abortSignal)` opens/joins the build; async impls
 *   re-check `assertNotSuperseded` after EVERY await.
 */

import * as Tone from 'tone';
import type { FunctionImplementations, ReadableInputHandle } from '@theclearsky/react-blender-nodes';
import { readInput } from '@theclearsky/react-blender-nodes';
import {
  evaluateCurve,
  parseTimelineCurveRef,
} from '@theclearsky/react-blender-nodes-timeline';
import {
  getTimelineRegistry,
  getTimelineStore,
  getTimelineTransport,
} from '../timeline/timelineSystem';
import {
  assertNotSuperseded,
  ensureBuild,
  getCurrentBuildId,
  registerDisposable,
  registerGateTarget,
} from './audioSystem';
import type { AudioChain, ParamLike, SignalChain } from './valueTypes';
import { isAudioChain, isSignalChain, parseWaveformValue } from './valueTypes';
import type { SignalReading } from './signalApply';
import { applySignalReading } from './signalApply';
import { dftToPeriodicCoefficients, sinePreset } from './waveformMath';
import { divisionSeconds, mapPercent } from './controlMath';
import type { SoundNodeTypeId } from './nodeTypes';
import type { EffectRowId } from './effectTable';
import type { BoundEffectRow, EffectNode } from './effectAudio';
import { boundEffectRows } from './effectAudio';
import {
  areWorkletsRegistered,
  getMasterInput,
  getPitchSignal,
  setPitchGlide,
} from '../audio/bootstrap';
import { nextGateEdgeTime } from '../audio/gateSchedule';
import { KEY_ORDER, keyLabel } from '../audio/keyMap';
import type { KeyName } from '../audio/keyMap';
import {
  isKeyHeld,
  keyHzAtCurrentOctave,
  onKeyBusEvent,
} from '../audio/keyboardBus';
import type { EnvelopeMode, EnvelopeParams } from './envelopeCore';
import {
  bodyPresets,
  frictionModels,
  glideModes,
  pickStyles,
  pipeModes,
  triggerModes,
} from './dataTypes';
import type { PickStyle, PluckedStringParams } from './pluckedStringCore';
import type { StruckStringParams } from './struckStringCore';
import type { FdnReverbParams } from './fdnReverbCore';
import type {
  BowedStringParams,
  FrictionModel,
} from './bowedStringCore';
import type { BodyMode, ModalBodyParams } from './modalBodyCore';
import type { FluteParams } from './fluteCore';
import {
  GUITAR_BODY,
  GUITAR_DIRECT_DB,
  VIOLIN_BODY,
  VIOLIN_DIRECT_DB,
} from './stringPresets';

type ToneConnectSource = Parameters<typeof Tone.connect>[0];
type ToneConnectTarget = Parameters<typeof Tone.connect>[1];
type Inputs = ReadonlyMap<string, ReadableInputHandle>;
type FnImpl = NonNullable<FunctionImplementations<string>[string]>;

// ── Reading helpers ──

function makeAudioChain(output: unknown, label: string): AudioChain {
  return { kind: 'audioChain', output, buildId: getCurrentBuildId(), label };
}

function makeSignalChain(output: unknown, label: string): SignalChain {
  return { kind: 'signalChain', output, buildId: getCurrentBuildId(), label };
}

function readAudioChain(inputs: Inputs, name: string): AudioChain | undefined {
  return readInput(inputs, name).find(isAudioChain);
}

function readAudioChains(inputs: Inputs, name: string): AudioChain[] {
  return readInput(inputs, name).filter(isAudioChain);
}

function readSignal(inputs: Inputs, name: string): SignalReading {
  const values = readInput(inputs, name);
  return {
    chains: values.filter(isSignalChain),
    knob: values.find((value) => typeof value === 'number') as
      | number
      | undefined,
  };
}

function readNumber(inputs: Inputs, name: string, fallback: number): number {
  const value = readInput(inputs, name).find(
    (candidate) => typeof candidate === 'number',
  );
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback;
}

function readString(
  inputs: Inputs,
  name: string,
  fallback: string,
): string {
  const value = readInput(inputs, name).find(
    (candidate) => typeof candidate === 'string' && candidate.length > 0,
  );
  return typeof value === 'string' ? value : fallback;
}

/**
 * Replace-on-connect (pure rule in signalApply.ts, pinned by tests):
 * connected → base = `replaceBase`, every connection free-connected
 * (they SUM); unconnected → knob (or the impl default). `replaceBase`
 * MUST be overridden where 0 is not silent/legal in the param's native
 * domain (convert-true dB params, or min-bounded ones).
 */
function applySignalToParam(
  param: ParamLike,
  reading: SignalReading,
  fallback: number,
  replaceBase: number = 0,
): void {
  applySignalReading(param, reading, fallback, replaceBase, (chain, target) => {
    Tone.connect(
      chain.output as ToneConnectSource,
      target as unknown as ToneConnectTarget,
    );
  });
}

// ── Helpers (gate-mode worklets + All Keys) ──

/** Structural view of a raw ConstantSourceNode via the context factory
 *  (standardized-audio-context wrapper — never DOM constructors). */
type RampableParam = {
  value: number;
  cancelScheduledValues(time: number): unknown;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(value: number, time: number, timeConstant: number): unknown;
};

type ConstantSourceLike = {
  offset: RampableParam;
  start(): void;
  stop(): void;
  disconnect(): void;
};

/** The anti-zipper ramp every retune uses even with glide OFF — a hard jump
 *  on an audio-rate frequency clicks. This is today's behaviour. */
const PITCH_JUMP_SEC = 0.01;

/**
 * Move a frequency param to `target`, honouring the node's Glide setting.
 *
 * - `off`        the 10 ms anti-zipper jump (what the app has always done)
 * - `linear`     a straight ramp in Hz
 * - `exponential` a straight ramp in CENTS — the musically even glide, and
 *                what a fretless slide actually does
 * - `smooth`     an asymptotic slew, fast at first, easing in; the classic
 *                synth portamento. `setTargetAtTime`'s time constant is a
 *                THIRD of the glide time, so ~95 % of the distance is covered
 *                within it.
 */
function glideParamTo(
  param: RampableParam,
  target: number,
  mode: string,
  glideSec: number,
  now: number,
): void {
  const from = param.value;
  param.cancelScheduledValues(now);
  param.setValueAtTime(from, now);
  if (mode === 'off' || !(glideSec > 0)) {
    param.linearRampToValueAtTime(target, now + PITCH_JUMP_SEC);
    return;
  }
  if (mode === 'exponential') {
    // exponentialRampToValueAtTime cannot cross or touch zero.
    const safeFrom = from > 1e-3 ? from : 1e-3;
    param.setValueAtTime(safeFrom, now);
    param.exponentialRampToValueAtTime(
      target > 1e-3 ? target : 1e-3,
      now + glideSec,
    );
    return;
  }
  if (mode === 'smooth') {
    param.setTargetAtTime(target, now, glideSec / 3);
    return;
  }
  param.linearRampToValueAtTime(target, now + glideSec);
}

/** Read a node's Glide pair, clamped and validated. */
function readGlide(inputs: Inputs): { mode: string; seconds: number } {
  const mode = readString(inputs, 'Glide', 'off');
  return {
    mode: (glideModes as readonly string[]).includes(mode) ? mode : 'off',
    seconds: clampRange(readNumber(inputs, 'Glide ms', 60), 0, 5000) / 1000,
  };
}

type RawContextLike = {
  currentTime: number;
  /** Needed to space gate edges by whole samples — see `gateSchedule.ts`. */
  sampleRate: number;
  createConstantSource(): ConstantSourceLike;
};

function rawContext(): RawContextLike {
  return Tone.getContext().rawContext as unknown as RawContextLike;
}

type WorkletNodeLike = {
  port: { postMessage(message: unknown): void; close?: () => void };
  disconnect(): void;
  /** Present on processors that declare `parameterDescriptors`. Not a Map:
   *  standardized-audio-context returns its own read-only map type. */
  parameters?: { get(name: string): ParamLike | undefined };
};

type WorkletProcessorName =
  | 'sound-envelope'
  | 'sound-threshold'
  | 'sound-plucked-string'
  | 'sound-struck-string'
  | 'sound-bowed-string'
  | 'sound-fdn-reverb'
  | 'sound-modal-body'
  | 'sound-flute';

/** Create a registered worklet node or throw the one clear error the
 *  registration failure path promises (bootstrap.ts). */
function createWorkletNode(
  name: WorkletProcessorName,
  processorOptions: Record<string, unknown>,
  overrides?: Record<string, unknown>,
): WorkletNodeLike {
  if (!areWorkletsRegistered(name)) {
    throw new Error(
      `${name}: audio worklet failed to register at startup — ` +
        'check public/*.worklet.js (npm run build:worklets) and reload',
    );
  }
  const node = (
    Tone.getContext() as unknown as {
      createAudioWorkletNode(
        workletName: string,
        options: Record<string, unknown>,
      ): WorkletNodeLike;
    }
  ).createAudioWorkletNode(name, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    // Force the spec's mono downmix — the processors read input channel
    // 0 only, so without this a stereo signal would gate on its LEFT
    // channel alone.
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    processorOptions,
    ...overrides,
  });
  registerDisposable({
    dispose: () => {
      // Order matters: the 'stop' message flips the processor to return
      // false from process() — WITHOUT it the audio thread keeps one
      // live callback per disposed node per Run forever. Only then
      // close the port and disconnect.
      try {
        node.port.postMessage({ type: 'stop' });
      } catch {
        // context already closed — nothing to stop
      }
      node.port.close?.();
      node.disconnect();
    },
  });
  return node;
}

function connectAudio(chain: AudioChain, target: ToneConnectTarget): void {
  Tone.connect(chain.output as ToneConnectSource, target);
}

/** Clamp a knob into the range its node type documents. */
function clampRange(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return value < low ? low : value > high ? high : value;
}

/**
 * Wire a signal input into a worklet's AudioParam, honouring the same
 * replace-on-connect rule as every other signal target. `replaceBase` is 0
 * here because every physical-model param declares `minValue: 0` — a
 * min-bounded AudioParam would silently floor the summed modulation instead.
 */
function applyWorkletParam(
  node: WorkletNodeLike,
  name: string,
  reading: SignalReading,
  fallback: number,
): void {
  const param = node.parameters?.get(name);
  if (!param) {
    throw new Error(
      `worklet parameter "${name}" is missing — the processor must declare ` +
        'it in static parameterDescriptors',
    );
  }
  applySignalToParam(param, reading, fallback);
}

/** Connect a boolSignal Gate input into a worklet processor's input 0. */
function connectGateTo(inputs: Inputs, node: WorkletNodeLike): void {
  const gate = readInput(inputs, 'Gate').find(isSignalChain);
  if (!gate) return;
  Tone.connect(
    gate.output as ToneConnectSource,
    node as unknown as ToneConnectTarget,
  );
}

function registerNativeSource(node: {
  stop: () => void;
  disconnect: () => void;
}): void {
  registerDisposable({
    dispose: () => {
      try {
        node.stop();
      } catch {
        // already stopped — dispose stays idempotent
      }
      node.disconnect();
    },
  });
}

// ── Effect-table factory ──

function makeEffectImplementation(row: BoundEffectRow): FnImpl {
  return async (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const myBuild = getCurrentBuildId();

    const node: EffectNode = row.make();
    registerDisposable({ dispose: () => void node.dispose() });

    for (const param of row.numberParams) {
      param.apply(node, readNumber(inputs, param.input, param.fallback));
    }
    if (row.awaitReady) {
      await row.awaitReady(node);
      assertNotSuperseded(myBuild);
      if (context.abortSignal.aborted) {
        throw new Error(`${row.name}: run aborted`);
      }
    }
    for (const param of row.signalParams) {
      applySignalToParam(
        param.target(node),
        readSignal(inputs, param.input),
        param.fallback,
        param.replaceBase ?? 0,
      );
    }

    const upstream = readAudioChain(inputs, 'In');
    if (upstream) connectAudio(upstream, node as ToneConnectTarget);
    if (row.needsStart) (node as unknown as { start: () => void }).start();

    return new Map([['Out', makeAudioChain(node, row.name)]]);
  };
}

const effectImplementations = Object.fromEntries(
  boundEffectRows.map((row) => [row.id, makeEffectImplementation(row)]),
) as Record<EffectRowId, FnImpl>;

// ── The catalog ──

const soundImplementations: FunctionImplementations<SoundNodeTypeId> = {
  // Sources
  drawnOsc: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const rawContext = Tone.getContext().rawContext;

    const samples =
      parseWaveformValue(readInput(inputs, 'Waveform')[0]) ?? sinePreset();
    const { real, imag } = dftToPeriodicCoefficients(samples);

    const oscillator = rawContext.createOscillator();
    registerNativeSource(oscillator);
    oscillator.setPeriodicWave(
      rawContext.createPeriodicWave(real, imag, {
        disableNormalization: false,
      }),
    );

    const level = new Tone.Gain(0);
    registerDisposable(level);

    applySignalToParam(
      oscillator.frequency,
      readSignal(inputs, 'Frequency'),
      220,
    );
    applySignalToParam(level.gain, readSignal(inputs, 'Level'), 0.8);

    Tone.connect(oscillator as ToneConnectSource, level);
    oscillator.start();

    return new Map([['Out', makeAudioChain(level, 'DrawnOsc')]]);
  },

  oscillator: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const shape = readString(inputs, 'Shape', 'sine');

    const oscillator = new Tone.Oscillator();
    registerDisposable(oscillator); // register BEFORE config
    oscillator.type = shape as Tone.ToneOscillatorType;
    const level = new Tone.Gain(0);
    registerDisposable(level);

    applySignalToParam(
      oscillator.frequency,
      readSignal(inputs, 'Frequency'),
      220,
    );
    applySignalToParam(oscillator.detune, readSignal(inputs, 'Detune'), 0);
    applySignalToParam(level.gain, readSignal(inputs, 'Level'), 0.8);

    Tone.connect(oscillator, level);
    oscillator.start();

    return new Map([['Out', makeAudioChain(level, 'Oscillator')]]);
  },

  noise: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const type = readString(inputs, 'Type', 'white') as Tone.NoiseType;

    const noise = new Tone.Noise({ type });
    registerDisposable(noise);
    const level = new Tone.Gain(0);
    registerDisposable(level);

    applySignalToParam(level.gain, readSignal(inputs, 'Level'), 0.8);
    Tone.connect(noise, level);
    noise.start();

    return new Map([['Out', makeAudioChain(level, 'Noise')]]);
  },

  player: async (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const myBuild = getCurrentBuildId();
    const url = readString(inputs, 'URL', '');
    if (!url) throw new Error('Player: URL is empty');

    const player = new Tone.Player();
    registerDisposable(player);
    await player.load(url);
    assertNotSuperseded(myBuild);
    if (context.abortSignal.aborted) throw new Error('Player: run aborted');

    player.loop = readString(inputs, 'Mode', 'once') === 'loop';
    player.playbackRate = Math.max(0.01, readNumber(inputs, 'Rate', 1));
    player.start();

    return new Map([['Out', makeAudioChain(player, 'Player')]]);
  },

  pulser: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const shape = readString(inputs, 'Shape', 'sine');
    // Rate Hz is a live signal (a Beat Clock or a Map can drive it); a
    // saved graph's plain-number knob reads the same way.
    const rate = readSignal(inputs, 'Rate Hz');
    const knobRate =
      rate.knob === undefined ? undefined : Math.max(0.001, rate.knob);
    const amplitude = readNumber(inputs, 'Amplitude', 1);
    const offset = readNumber(inputs, 'Offset', 0);

    // Bipolar mapping: value(t) = offset + amp·shape(2πft).
    const lfo = new Tone.LFO({
      frequency: knobRate ?? 2,
      min: offset - amplitude,
      max: offset + amplitude,
      type: shape as Tone.ToneOscillatorType,
    });
    registerDisposable(lfo);
    applySignalToParam(lfo.frequency, { chains: rate.chains, knob: knobRate }, 2);
    lfo.start();

    return new Map([['Out', makeSignalChain(lfo, 'Pulser')]]);
  },

  constant: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const signal = new Tone.Signal(readNumber(inputs, 'Value', 1));
    registerDisposable(signal);
    return new Map([['Out', makeSignalChain(signal, 'Constant')]]);
  },

  // 0–100 % → Low…High. A knob is mapped once, here; a connected signal is
  // mapped live by a wave shaper holding the same curve (0–100 is scaled
  // onto the shaper's −1…1 input, and anything outside is held at the ends).
  map: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const low = readNumber(inputs, 'Low', 0);
    const high = readNumber(inputs, 'High', 1);
    const curve = readString(inputs, 'Curve', 'linear');
    const amount = readSignal(inputs, 'Amount');
    const value = mapPercent(amount.knob ?? 50, low, high, curve);

    if (amount.chains.length === 0) {
      const signal = new Tone.Signal(value);
      registerDisposable(signal);
      return new Map<string, unknown>([
        ['Signal', makeSignalChain(signal, 'Map')],
        ['Value', value],
      ]);
    }
    const scale = new Tone.Gain(1 / 50);
    registerDisposable(scale);
    const centre = new Tone.Add(-1);
    registerDisposable(centre);
    const shaper = new Tone.WaveShaper(
      (x) => mapPercent((x + 1) * 50, low, high, curve),
      4096,
    );
    registerDisposable(shaper);
    for (const chain of amount.chains) {
      Tone.connect(chain.output as ToneConnectSource, scale);
    }
    Tone.connect(scale, centre);
    Tone.connect(centre, shaper);
    return new Map<string, unknown>([
      ['Signal', makeSignalChain(shaper, 'Map')],
      ['Value', value],
    ]);
  },

  // Note length at the timeline tempo. The two outputs follow a tempo
  // change live (a short ramp, so a delay time glides instead of clicking).
  beatClock: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const note = readString(inputs, 'Note', '1/8');
    const store = getTimelineStore();
    const secondsNow = () =>
      divisionSeconds(store.getDocument().tempo?.bpm ?? 120, note);
    let seconds = secondsNow();
    const hz = new Tone.Signal(1 / seconds);
    registerDisposable(hz);
    const length = new Tone.Signal(seconds);
    registerDisposable(length);
    const unsubscribe = store.subscribe(() => {
      const next = secondsNow();
      if (next === seconds) return;
      seconds = next;
      hz.rampTo(1 / next, 0.05);
      length.rampTo(next, 0.05);
    });
    registerDisposable({ dispose: unsubscribe });
    return new Map([
      ['Hz', makeSignalChain(hz, `Beat Clock ${note}`)],
      ['Seconds', makeSignalChain(length, `Beat Clock ${note}`)],
    ]);
  },

  keyboardPitch: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    // The mono bus is one persistent signal, so its glide is published
    // globally rather than held per-node (bootstrap documents the rule).
    const glide = readGlide(inputs);
    setPitchGlide(glide.mode, glide.seconds);
    // PER-BUILD slave: never hand out the persistent signal — a
    // persistent→per-build param edge would survive dispose and leak.
    const slave = new Tone.Signal(0);
    // Composite disposable: slave.dispose() cannot remove the INCOMING
    // edge from the persistent pitch — sever it source-side too, or the
    // persistent node accumulates one dead fan-out edge per Run.
    registerDisposable({
      dispose: () => {
        try {
          getPitchSignal().disconnect(slave);
        } catch {
          // already severed
        }
        slave.dispose();
      },
    });
    Tone.connect(getPitchSignal(), slave);
    return new Map([['Hz', makeSignalChain(slave, 'KeyboardPitch')]]);
  },

  // 17 [gate, Hz] pairs — one per physical key. Per-build constant
  // sources driven by the bus's per-key events; Hz outputs initialize to
  // the key's mapped pitch (never 0 Hz), HOLD the last value on key-up,
  // and octave shifts retune HELD keys only (released tails keep their
  // pitch).
  allKeys: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const raw = rawContext();
    const glide = readGlide(inputs);
    // The pitch the NEXT key glides from. Seeded to 0 = "nothing played
    // yet", so the first note of a performance starts in tune rather than
    // swooping up from silence.
    let previousPitch = 0;
    const outputs = new Map<string, unknown>();
    const keyNodes = new Map<
      KeyName,
      {
        gate: ConstantSourceLike;
        hz: ConstantSourceLike;
        /** Timestamp of this key's last scheduled gate edge — see
         *  `scheduleGate`. Never read for anything but spacing. */
        lastGateTime: number;
      }
    >();
    for (const key of KEY_ORDER) {
      // Register EACH source the moment it exists — a throw between the
      // pair must not orphan a started node; registerNativeSource's
      // try/catch keeps dispose idempotent.
      const gate = raw.createConstantSource();
      // Seed from the live keyboard state so a key held across a Run
      // keeps truthful edges (its release IS a falling edge).
      gate.offset.value = isKeyHeld(key) ? 1 : 0;
      gate.start();
      registerNativeSource(gate);
      const hz = raw.createConstantSource();
      hz.offset.value = keyHzAtCurrentOctave(key);
      hz.start();
      registerNativeSource(hz);
      keyNodes.set(key, { gate, hz, lastGateTime: 0 });
      const label = keyLabel(key);
      outputs.set(`${label} Gate`, makeSignalChain(gate, `${label} Gate`));
      outputs.set(`${label} Hz`, makeSignalChain(hz, `${label} Hz`));
    }
    /**
     * Schedule one gate edge at a timestamp no earlier edge on this key owns.
     *
     * Scheduling two edges at the same timestamp destroys one of them, which
     * strands a held key silently — `gateSchedule.ts` carries the measured
     * evidence and the reasoning. Every gate change on every key goes through
     * here; writing `setValueAtTime(v, raw.currentTime)` directly reopens it.
     */
    const scheduleGate = (
      entry: { gate: ConstantSourceLike; lastGateTime: number },
      value: 0 | 1,
    ) => {
      const at = nextGateEdgeTime(
        raw.currentTime,
        entry.lastGateTime,
        raw.sampleRate,
      );
      entry.lastGateTime = at;
      entry.gate.offset.setValueAtTime(value, at);
    };
    /**
     * Move one key to a pitch. With Glide off this is an INSTANT jump, not
     * the app's usual 10 ms anti-zipper ramp.
     *
     * A waveguide's delay-line length IS its pitch, so a pitch ramp does not
     * transpose a sounding string — it re-reads stored energy at a shifting
     * offset. The strike fires on the gate edge, so with a ramp the note is
     * struck at the OLD pitch and then re-pitched under itself for 10 ms.
     * Measured, striking C5 at velocity 0.7:
     *
     *   pitch already correct   peak 0.500, settles at pitch
     *   struck during the ramp  peak 1.997, ZERO zero-crossings after 0.4 s
     *   set instantly, then hit peak 0.500, settles at pitch
     *
     * The middle row is a note that clips and then makes no sound at all —
     * it pegs the meter while sitting at DC. The anti-zipper ramp exists for
     * a continuously sounding oscillator on the shared mono bus; here every
     * key owns its own pitch and is silent when it changes, so the ramp buys
     * nothing and costs the attack.
     */
    const retune = (hz: ConstantSourceLike, target: number) => {
      if (glide.mode === 'off') {
        hz.offset.cancelScheduledValues(raw.currentTime);
        hz.offset.setValueAtTime(target, raw.currentTime);
        return;
      }
      glideParamTo(
        hz.offset,
        target,
        glide.mode,
        glide.seconds,
        raw.currentTime,
      );
    };
    const unsubscribe = onKeyBusEvent((event) => {
      if (event.type === 'down') {
        const nodes = keyNodes.get(event.key);
        if (!nodes) return;
        const target = keyHzAtCurrentOctave(event.key);
        // Each key owns its own Hz and already sits at its own pitch, so a
        // glide has to be given somewhere to travel FROM: the note played
        // before it. That is what portamento means on a polyphonic-by-
        // instantiation keyboard, and it is how a fretless player slides
        // into a note.
        if (glide.mode !== 'off' && previousPitch > 0) {
          nodes.hz.offset.cancelScheduledValues(raw.currentTime);
          nodes.hz.offset.setValueAtTime(previousPitch, raw.currentTime);
        }
        retune(nodes.hz, target);
        previousPitch = target;
        scheduleGate(nodes, 1);
        return;
      }
      if (event.type === 'up') {
        // Gate drops; Hz holds its last value (release tails stay put).
        const nodes = keyNodes.get(event.key);
        if (nodes) scheduleGate(nodes, 0);
        return;
      }
      // Octave shift: retune every key that is NOT sounding.
      //
      // A string that is already ringing has a fixed length, so it keeps its
      // pitch until it is released and struck again — which is what both a
      // real instrument and a MIDI transpose do. Retuning held keys instead
      // (what this did before) re-pitches a live delay line: a held C4 sent
      // one octave up peaked 0.506 -> 1.645, and three octaves up reached
      // 3.132, i.e. straight into clipping and then into a dead note.
      //
      // Silent keys ARE updated, so the next press already sits at the new
      // octave and its strike needs no pitch move at all.
      for (const [key, nodes] of keyNodes) {
        if (!isKeyHeld(key)) retune(nodes.hz, keyHzAtCurrentOctave(key));
      }
    });
    registerDisposable({ dispose: unsubscribe });
    return outputs;
  },

  // The sole signal→gate crossing — thresholdCore in its worklet.
  // Summed signal connections in, 0/1 out.
  threshold: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const node = createWorkletNode('sound-threshold', {
      threshold: readNumber(inputs, 'Threshold', 0.5),
      hysteresis: readNumber(inputs, 'Hysteresis', 0.1),
    });
    const reading = readSignal(inputs, 'In');
    for (const chain of reading.chains) {
      Tone.connect(
        chain.output as ToneConnectSource,
        node as unknown as ToneConnectTarget,
      );
    }
    if (reading.chains.length === 0 && reading.knob !== undefined) {
      // Knob-only input: a constant lets a static level open the gate.
      const constant = rawContext().createConstantSource();
      constant.offset.value = reading.knob;
      constant.start();
      registerNativeSource(constant);
      Tone.connect(
        constant as unknown as ToneConnectSource,
        node as unknown as ToneConnectTarget,
      );
    }
    return new Map([['Gate', makeSignalChain(node, 'Threshold')]]);
  },

  // ── Physical models ──
  //
  // These three are the only nodes with their OWN feedback loop, so every
  // knob is CLAMPED here before it reaches the processor: an out-of-range
  // value would circulate in a delay line for the life of the node, and the
  // cores' NaN watchdogs are the last line of defence, not the first.
  pluckedString: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const pick = readString(inputs, 'Pick', 'finger');
    const params: PluckedStringParams = {
      positionBeta: clampRange(readNumber(inputs, 'Position', 0.2), 0.02, 0.5),
      brightness: clampRange(readNumber(inputs, 'Brightness', 0.62), 0, 1),
      decaySec: clampRange(readNumber(inputs, 'Decay s', 7), 0.05, 30),
      // Ceiling raised 3e-4 -> 1e-2 to cover a PIANO. 3e-4 is a guitar's
      // range; a piano's inharmonicity climbs toward both ends of the
      // keyboard (C6 ~1e-3, C7 ~3.5e-3, C8 ~1e-2) and was unreachable. The
      // dispersion solver already saturates gracefully at
      // MIN_DISPERSION_POLE, so asking for more B than 4 allpass sections can
      // deliver costs accuracy, never stability.
      stiffness: clampRange(readNumber(inputs, 'Stiffness', 3e-5), 0, 1e-2),
      polarization: clampRange(readNumber(inputs, 'Polarization', 0.5), 0, 1),
      octave: clampRange(readNumber(inputs, 'Octave', 0), -3, 3),
      pickStyle: (pickStyles as readonly string[]).includes(pick)
        ? (pick as PickStyle)
        : 'finger',
      dampOnRelease: readString(inputs, 'Damp', 'on') !== 'off',
    };
    const node = createWorkletNode('sound-plucked-string', { params });
    connectGateTo(inputs, node);
    applyWorkletParam(node, 'hz', readSignal(inputs, 'Hz'), 220);
    applyWorkletParam(node, 'amp', readSignal(inputs, 'Amp'), 1);
    return new Map([['Out', makeAudioChain(node, 'Plucked String')]]);
  },

  struckString: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const params: StruckStringParams = {
      positionBeta: clampRange(readNumber(inputs, 'Position', 0.125), 0.02, 0.5),
      brightness: clampRange(readNumber(inputs, 'Brightness', 0.62), 0, 1),
      decaySec: clampRange(readNumber(inputs, 'Decay s', 8), 0.05, 30),
      // Ceiling 1e-2 covers the whole keyboard — a piano's inharmonicity
      // climbs toward both ends (C7 ~3.5e-3, C8 ~1e-2). The dispersion solver
      // saturates gracefully, so over-asking costs accuracy, never stability.
      stiffness: clampRange(readNumber(inputs, 'Stiffness', 2.5e-4), 0, 1e-2),
      strings: clampRange(readNumber(inputs, 'Strings', 3), 1, 3),
      unisonCents: clampRange(readNumber(inputs, 'Unison c', 3), 0, 60),
      hardness: clampRange(readNumber(inputs, 'Hardness', 0.5), 0, 1),
      octave: clampRange(readNumber(inputs, 'Octave', 0), -3, 3),
      dampOnRelease: readString(inputs, 'Damp', 'on') !== 'off',
    };
    const node = createWorkletNode('sound-struck-string', { params });
    connectGateTo(inputs, node);
    applyWorkletParam(node, 'hz', readSignal(inputs, 'Hz'), 220);
    // Default 0.8: a firm but not fortissimo strike. `interpolateShape`-style
    // anchors make 0.25 pianissimo and 1.0 the hardest voicing.
    applyWorkletParam(node, 'velocity', readSignal(inputs, 'Velocity'), 0.8);
    return new Map([['Out', makeAudioChain(node, 'Struck String')]]);
  },

  bowedString: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const friction = readString(inputs, 'Friction', 'thermal');
    const impedanceKnob = readNumber(inputs, 'Impedance', 0);
    const hzReading = readSignal(inputs, 'Hz');
    // Impedance 0 = "derive from the note". That derivation now happens IN THE
    // CORE, per block, from the pitch actually being played. It used to be
    // resolved here from `hzReading.knob`, which is undefined whenever Hz is
    // driven — i.e. in every real patch — so the equal-tension scaling silently
    // pinned itself to the G3 reference for the life of the node (2026-09-12
    // review, INT-F3). The 0 is passed through as the sentinel.
    const impedance =
      impedanceKnob > 0 ? clampRange(impedanceKnob, 0.02, 4) : 0;
    const params: BowedStringParams = {
      positionBeta: clampRange(readNumber(inputs, 'Position', 0.127), 0.02, 0.45),
      force: 0.3,
      impedance,
      frictionModel: (frictionModels as readonly string[]).includes(friction)
        ? (friction as FrictionModel)
        : 'thermal',
      attackSec: clampRange(readNumber(inputs, 'Attack ms', 60), 1, 500) / 1000,
      releaseSec:
        clampRange(readNumber(inputs, 'Release ms', 80), 1, 1000) / 1000,
      vibratoRateHz: clampRange(readNumber(inputs, 'Vib Rate Hz', 5.5), 0, 12),
      vibratoCents: clampRange(readNumber(inputs, 'Vib Cents', 12), 0, 60),
      noise: clampRange(readNumber(inputs, 'Noise', 0.4), 0, 1),
    };
    const node = createWorkletNode('sound-bowed-string', { params });
    connectGateTo(inputs, node);
    applyWorkletParam(node, 'hz', hzReading, 220);
    // Amp is the BOW GESTURE, not just a level: it drives bow speed, bow
    // force and bow position together. An unconnected default of 1 would
    // pin every note at full ponticello; 0.65 is a mezzo-forte that leaves
    // room to go softer (flautando) and louder (shrill) from there.
    applyWorkletParam(node, 'amp', readSignal(inputs, 'Amp'), 0.65);
    applyWorkletParam(node, 'force', readSignal(inputs, 'Force'), 0.3);
    return new Map([['Out', makeAudioChain(node, 'Bowed String')]]);
  },

  jetFlute: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const pipe = readString(inputs, 'Pipe', 'open');
    const params: FluteParams = {
      pipe: (pipeModes as readonly string[]).includes(pipe)
        ? (pipe as FluteParams['pipe'])
        : 'open',
      jetRatio: clampRange(readNumber(inputs, 'Jet Ratio', 0.25), 0.05, 0.9),
      noise: clampRange(readNumber(inputs, 'Breath', 0.15), 0, 1),
      vibratoRateHz: clampRange(readNumber(inputs, 'Vib Rate Hz', 5.925), 0, 12),
      vibratoDepth: clampRange(readNumber(inputs, 'Vib Depth', 0.05), 0, 1),
      jetReflection: clampRange(readNumber(inputs, 'Jet Refl', 0.5), 0, 1),
      endReflection: clampRange(readNumber(inputs, 'End Refl', 0.95), 0, 1),
      embouchure: clampRange(readNumber(inputs, 'Embouchure', 1), 0.2, 1.3),
      toneHoleHz: clampRange(readNumber(inputs, 'Tone Hole Hz', 2600), 0, 12000),
      lossPoles: readNumber(inputs, 'Loss Poles', 2) >= 2 ? 2 : 1,
      octave: clampRange(readNumber(inputs, 'Octave', 2), -3, 3),
      attackSec: clampRange(readNumber(inputs, 'Attack ms', 40), 1, 500) / 1000,
      releaseSec:
        clampRange(readNumber(inputs, 'Release ms', 50), 1, 1000) / 1000,
    };
    const node = createWorkletNode('sound-flute', { params });
    connectGateTo(inputs, node);
    applyWorkletParam(node, 'hz', readSignal(inputs, 'Hz'), 262);
    // Amp maps onto the flute's playable breath window, so the default is a
    // comfortable mezzo-forte rather than full blast.
    applyWorkletParam(node, 'amp', readSignal(inputs, 'Amp'), 0.7);
    return new Map([['Out', makeAudioChain(node, 'Jet Flute')]]);
  },

  fdnReverb: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const params: FdnReverbParams = {
      sizeScale: clampRange(readNumber(inputs, 'Size', 1), 0.1, 4),
      decaySec: clampRange(readNumber(inputs, 'Decay s', 3), 0.05, 60),
      dampingHz: clampRange(readNumber(inputs, 'Damping Hz', 6000), 200, 20000),
      // Capped at 10 Hz: above that the delay sweep stops being a shimmer and
      // becomes audible FM on the tail.
      modRateHz: clampRange(readNumber(inputs, 'Mod Rate Hz', 0.7), 0, 10),
      modDepthMs: clampRange(readNumber(inputs, 'Mod Depth ms', 3), 0, 50),
      diffusion: clampRange(readNumber(inputs, 'Diffusion', 0.6), 0, 1),
      lowCutHz: clampRange(readNumber(inputs, 'Low Cut Hz', 120), 10, 2000),
      width: clampRange(readNumber(inputs, 'Width', 1), 0, 1),
      // Superseded per block by the `mix` AudioParam below; this is the value
      // the processor starts with before the first param frame arrives.
      mix: 0.35,
    };
    // STEREO, explicitly. `createWorkletNode` defaults every processor to
    // one output channel because the rest of them are mono by nature, but
    // this one is a stereo reverb: its core writes two decorrelated taps and
    // the worklet reads `channels[1] ?? outL`. With a single output channel
    // that fallback makes outR the SAME Float32Array as outL, so the L tap is
    // written and then immediately overwritten by the R tap — the node
    // emitted mono, and `Width` did nothing at all.
    //
    // That was the whole of "it sounds very narrow": the piano's 16 voices
    // sum to mono, and the only node in the chain that could have produced
    // stereo was silently collapsing it. `channelCount: 2` matters too, so a
    // stereo upstream reaches the network instead of being downmixed first.
    const node = createWorkletNode(
      'sound-fdn-reverb',
      { params },
      { outputChannelCount: [2], channelCount: 2 },
    );
    const upstream = readAudioChain(inputs, 'In');
    if (upstream) {
      connectAudio(upstream, node as unknown as ToneConnectTarget);
    }
    applyWorkletParam(node, 'mix', readSignal(inputs, 'Mix'), 0.35);
    return new Map([['Out', makeAudioChain(node, 'FDN Reverb')]]);
  },

  stringBody: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const preset = readString(inputs, 'Preset', 'guitar');
    const chosen = (bodyPresets as readonly string[]).includes(preset)
      ? preset
      : 'guitar';
    const modes: readonly BodyMode[] =
      chosen === 'violin' ? VIOLIN_BODY : GUITAR_BODY;
    const params: ModalBodyParams = {
      modes,
      scale: clampRange(readNumber(inputs, 'Scale', 1), 0.25, 4),
      airHz: clampRange(readNumber(inputs, 'Air Hz', 0), 0, 2000),
      mix: clampRange(readNumber(inputs, 'Mix', 1), 0, 1),
      directDb: chosen === 'violin' ? VIOLIN_DIRECT_DB : GUITAR_DIRECT_DB,
    };
    // Mono is deliberate: a body is one radiating structure, and the modal
    // bank is defined for a single channel.
    const node = createWorkletNode('sound-modal-body', { params });
    const upstream = readAudioChain(inputs, 'In');
    if (upstream) connectAudio(upstream, node as unknown as ToneConnectTarget);
    return new Map([['Out', makeAudioChain(node, 'String Body')]]);
  },

  // The driver comes from the plugin registry — one ConstantSource per
  // (curve, build); shared curves fan out from one driver ({node, isNew});
  // the transport schedules onto every live driver. The app owns disposal:
  // prune the registry FIRST so the transport stops scheduling, then
  // stop/disconnect (registered like every impl node).
  timelineCurve: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const myBuild = getCurrentBuildId();
    const registry = getTimelineRegistry();
    const transport = getTimelineTransport();
    if (registry === undefined || transport === undefined) {
      throw new Error('Timeline Curve: audio not started');
    }
    const reference = readInput(inputs, 'Curve').find(
      (candidate) => parseTimelineCurveRef(candidate) !== null,
    );
    const curveId = parseTimelineCurveRef(reference);
    const curve = getTimelineStore()
      .getDocument()
      .curves.find((candidate) => candidate.id === curveId);
    if (curve === undefined) {
      // Missing/unset reference: the run stays safe — the transport
      // anchors an unmatched driver to a constant 0.
      console.warn(
        curveId === null
          ? '[timelineCurve] no curve selected — emitting constant 0'
          : `[timelineCurve] curve "${curveId}" is not in the timeline document — emitting constant 0`,
      );
    }
    // Sentinel OUTSIDE the schema's domain (ids require min length 1), so
    // no imported curve can ever collide with the unset state.
    const { node, isNew } = registry.acquireDriver(curveId ?? '', myBuild);
    if (isNew) {
      registerDisposable({
        dispose: () => {
          registry.releaseBuild(myBuild);
          try {
            node.stop();
          } catch {
            // already stopped — dispose stays idempotent
          }
          node.disconnect();
        },
      });
    }
    // 'Value' samples the curve at RUN time and stays constant thereafter
    // (documented on the node); playback varies 'Signal' only.
    const runTimeValue =
      curve === undefined
        ? 0
        : evaluateCurve(curve, transport.getPlayheadTime());
    return new Map<string, unknown>([
      [
        'Signal',
        {
          ...makeSignalChain(node, `Timeline: ${curve?.name ?? 'missing'}`),
          // Extra structural field the TimelineCurvePreview reads to find
          // the curve for its thumbnail; invisible to isSignalChain guards.
          timelineCurveId: curveId ?? undefined,
        },
      ],
      ['Value', runTimeValue],
    ]);
  },

  // Adapters — a Gain(1) summer handles any fan-in on the way through.
  toSignal: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const summer = new Tone.Gain(1);
    registerDisposable(summer);
    const upstream = readAudioChain(inputs, 'In');
    if (upstream) connectAudio(upstream, summer);
    return new Map([['Out', makeSignalChain(summer, 'ToSignal')]]);
  },

  toAudio: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const summer = new Tone.Gain(1);
    registerDisposable(summer);
    // Control signals carry DC/out-of-range values by design — clipping and
    // connect thumps are documented on the node.
    for (const chain of readInput(inputs, 'In').filter(isSignalChain)) {
      Tone.connect(chain.output as ToneConnectSource, summer);
    }
    return new Map([['Out', makeAudioChain(summer, 'ToAudio')]]);
  },

  // Effects
  ...effectImplementations,

  saturator: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const rawContext = Tone.getContext().rawContext;

    // Mini-graph: drive Gain → tanh WaveShaper (4x) → trim Gain, dry/wet
    // via Tone.CrossFade so the Wet contract holds.
    const drive = new Tone.Gain(0);
    registerDisposable(drive);
    const shaper = rawContext.createWaveShaper();
    registerDisposable({ dispose: () => shaper.disconnect() });
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(2.5 * x) / Math.tanh(2.5);
    }
    shaper.curve = curve;
    shaper.oversample = '4x';
    const trim = new Tone.Gain(0);
    registerDisposable(trim);
    const crossFade = new Tone.CrossFade(1);
    registerDisposable(crossFade);

    applySignalToParam(drive.gain, readSignal(inputs, 'Drive'), 2);
    applySignalToParam(trim.gain, readSignal(inputs, 'Trim'), 0.7);
    applySignalToParam(crossFade.fade, readSignal(inputs, 'Wet'), 1);

    const upstream = readAudioChain(inputs, 'In');
    if (upstream) {
      connectAudio(upstream, drive);
      connectAudio(upstream, crossFade.a); // dry path
    }
    Tone.connect(drive, shaper as ToneConnectTarget);
    Tone.connect(shaper as ToneConnectSource, trim);
    Tone.connect(trim, crossFade.b);

    return new Map([['Out', makeAudioChain(crossFade, 'Saturator')]]);
  },

  // Filter / dynamics / channel / envelope
  filter: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const type = readString(inputs, 'Type', 'lowpass');

    const filter = new Tone.Filter({ type: type as BiquadFilterType });
    registerDisposable(filter);

    const upstream = readAudioChain(inputs, 'In');
    if (upstream) connectAudio(upstream, filter);
    applySignalToParam(filter.frequency, readSignal(inputs, 'Freq'), 1200);
    applySignalToParam(filter.Q, readSignal(inputs, 'Q'), 1);
    applySignalToParam(filter.gain, readSignal(inputs, 'Gain dB'), 0);

    return new Map([['Out', makeAudioChain(filter, 'Filter')]]);
  },

  eq3: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const eq = new Tone.EQ3();
    registerDisposable(eq);

    const upstream = readAudioChain(inputs, 'In');
    if (upstream) connectAudio(upstream, eq);
    // EQ3 bands are convert-true dB Params: replace-base 0 would mean 0 dB =
    // UNITY gain with the mod summing LINEAR on top — −Infinity dB (Tone's
    // own mute value) is the true silent base.
    applySignalToParam(
      eq.low,
      readSignal(inputs, 'Low dB'),
      0,
      Number.NEGATIVE_INFINITY,
    );
    applySignalToParam(
      eq.mid,
      readSignal(inputs, 'Mid dB'),
      0,
      Number.NEGATIVE_INFINITY,
    );
    applySignalToParam(
      eq.high,
      readSignal(inputs, 'High dB'),
      0,
      Number.NEGATIVE_INFINITY,
    );

    return new Map([['Out', makeAudioChain(eq, 'EQ3')]]);
  },

  compressor: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const compressor = new Tone.Compressor();
    registerDisposable(compressor);

    const upstream = readAudioChain(inputs, 'In');
    if (upstream) connectAudio(upstream, compressor);
    applySignalToParam(
      compressor.threshold,
      readSignal(inputs, 'Threshold dB'),
      -24,
    );
    // ratio's native minValue is 1 — zero-base would THROW; 1 = no
    // compression, the natural neutral for summed modulation.
    applySignalToParam(compressor.ratio, readSignal(inputs, 'Ratio'), 4, 1);
    // Deliberate knobs-only exception — still Params.
    compressor.attack.value = readNumber(inputs, 'Attack s', 0.003);
    compressor.release.value = readNumber(inputs, 'Release s', 0.25);

    return new Map([['Out', makeAudioChain(compressor, 'Compressor')]]);
  },

  limiter: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const limiter = new Tone.Limiter(-12);
    registerDisposable(limiter);

    const upstream = readAudioChain(inputs, 'In');
    if (upstream) connectAudio(upstream, limiter);
    applySignalToParam(
      limiter.threshold,
      readSignal(inputs, 'Threshold dB'),
      -12,
    );

    return new Map([['Out', makeAudioChain(limiter, 'Limiter')]]);
  },

  gate: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const gate = new Tone.Gate({
      threshold: readNumber(inputs, 'Threshold dB', -40),
      smoothing: readNumber(inputs, 'Smoothing s', 0.1),
    });
    registerDisposable(gate);

    const upstream = readAudioChain(inputs, 'In');
    if (upstream) connectAudio(upstream, gate);

    return new Map([['Out', makeAudioChain(gate, 'Noise Gate')]]);
  },

  gain: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const gain = new Tone.Gain(0);
    registerDisposable(gain);

    const upstream = readAudioChain(inputs, 'In');
    if (upstream) connectAudio(upstream, gain);
    applySignalToParam(gain.gain, readSignal(inputs, 'Gain'), 1);

    return new Map([['Out', makeAudioChain(gain, 'Gain')]]);
  },

  pan: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const panner = new Tone.Panner(0);
    registerDisposable(panner);

    const upstream = readAudioChain(inputs, 'In');
    if (upstream) connectAudio(upstream, panner);
    applySignalToParam(panner.pan, readSignal(inputs, 'Pan'), 0);

    return new Map([['Out', makeAudioChain(panner, 'Pan')]]);
  },

  crossFade: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const crossFade = new Tone.CrossFade(0.5);
    registerDisposable(crossFade);

    // No default input — targets are the a/b sub-nodes.
    const inputA = readAudioChain(inputs, 'A');
    if (inputA) connectAudio(inputA, crossFade.a);
    const inputB = readAudioChain(inputs, 'B');
    if (inputB) connectAudio(inputB, crossFade.b);
    applySignalToParam(crossFade.fade, readSignal(inputs, 'Fade'), 0.5);

    return new Map([['Out', makeAudioChain(crossFade, 'Cross Fade')]]);
  },

  mix: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const summer = new Tone.Gain(1);
    registerDisposable(summer);
    // Fan-in: connect EVERY connection — a Gain used as a summer.
    for (const chain of readAudioChains(inputs, 'In')) {
      connectAudio(chain, summer);
    }
    return new Map([['Out', makeAudioChain(summer, 'Mix')]]);
  },

  adsr: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    const upstream = readAudioChain(inputs, 'In');
    const gateChain = readSignal(inputs, 'Gate').chains[0];

    if (!gateChain) {
      // LEGACY MODE: Gate unconnected keeps the original
      // Tone.AmplitudeEnvelope on the global keyboard bus, byte-for-byte
      // — zero existing patches change. Env is a documented constant 0.
      const envelope = new Tone.AmplitudeEnvelope({
        attack: Math.max(0.001, readNumber(inputs, 'Attack s', 0.01)),
        decay: Math.max(0.001, readNumber(inputs, 'Decay s', 0.1)),
        sustain: Math.min(1, Math.max(0, readNumber(inputs, 'Sustain', 0.5))),
        release: Math.max(0.001, readNumber(inputs, 'Release s', 0.3)),
      });
      registerDisposable(envelope);

      if (upstream) connectAudio(upstream, envelope);
      registerGateTarget({
        triggerAttack: () => void envelope.triggerAttack(),
        triggerRelease: () => void envelope.triggerRelease(),
      });

      const envZero = rawContext().createConstantSource();
      envZero.offset.value = 0;
      envZero.start();
      registerNativeSource(envZero);
      return new Map<string, unknown>([
        ['Out', makeAudioChain(envelope, 'ADSR')],
        ['Env', makeSignalChain(envZero, 'ADSR Env (legacy: 0)')],
      ]);
    }

    // GATE MODE: the envelopeCore worklet follows this gate; the node
    // LEAVES the keyboard bus entirely. The worklet's envelope output
    // drives a Gain's gain param (base 0 — the envelope alone defines
    // the level) and doubles as the Env signal output.
    const mode = readString(inputs, 'Trigger', 'high');
    const params: EnvelopeParams = {
      attackSec: Math.max(0, readNumber(inputs, 'Attack s', 0.01)),
      decaySec: Math.max(0, readNumber(inputs, 'Decay s', 0.1)),
      sustain: Math.min(1, Math.max(0, readNumber(inputs, 'Sustain', 0.5))),
      releaseSec: Math.max(0, readNumber(inputs, 'Release s', 0.3)),
      mode: (triggerModes as readonly string[]).includes(mode)
        ? (mode as EnvelopeMode)
        : 'high',
    };
    const worklet = createWorkletNode('sound-envelope', { params });
    Tone.connect(
      gateChain.output as ToneConnectSource,
      worklet as unknown as ToneConnectTarget,
    );

    const vca = new Tone.Gain(0);
    registerDisposable(vca);
    if (upstream) connectAudio(upstream, vca);
    Tone.connect(
      worklet as unknown as ToneConnectSource,
      vca.gain as unknown as ToneConnectTarget,
    );

    return new Map<string, unknown>([
      ['Out', makeAudioChain(vca, 'ADSR (gate)')],
      ['Env', makeSignalChain(worklet, 'ADSR Env')],
    ]);
  },

  // Output
  render: (inputs, _outputs, context) => {
    ensureBuild(context.abortSignal);
    // Per-build per-node Volume — impls never write the persistent master;
    // multiple Renders legally SUM into the master bus.
    const volume = new Tone.Volume(0);
    registerDisposable(volume);

    const upstream = readAudioChain(inputs, 'In');
    if (upstream) connectAudio(upstream, volume);
    // Volume.volume is a convert-true dB Param: replace-base must be
    // −Infinity dB (silence), NOT 0 dB = unity; the connected modulator
    // then alone defines the LINEAR gain.
    applySignalToParam(
      volume.volume,
      readSignal(inputs, 'Level dB'),
      -6,
      Number.NEGATIVE_INFINITY,
    );

    Tone.connect(volume, getMasterInput());
    return new Map();
  },
};

export { soundImplementations };

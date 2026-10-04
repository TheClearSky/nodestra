/**
 * App-level audio bootstrap: the ONE place that starts the context
 * (user gesture), owns the persistent master bus, and exposes the
 * `window.__sound` debug handle for live verification.
 *
 * Persistent (never disposed): master Volume → Meter → Destination.
 * Everything else is per-build and lives in audioSystem's registry.
 */

import * as Tone from 'tone';
import {
  disposeBuild,
  gateTargetCount,
  getCurrentBuildId,
  registrySize,
} from '../soundDefinitions/audioSystem';
import { getTapFftBins } from '../components/previews/tapManager';

type PersistentBus = {
  master: Tone.Volume;
  meter: Tone.Meter;
  monitor: Tone.Gain;
  pitch: Tone.Signal<'frequency'>;
  recorder: Tone.Recorder;
};

let persistent: PersistentBus | undefined;
let startPromise: Promise<void> | undefined;
const contextStateListeners = new Set<(state: string) => void>();

function buildPersistentBus(): void {
  const master = new Tone.Volume(-6);
  // 0.6: smooth enough for humans, fast enough that 2 Hz modulation
  // remains measurable through the per-getValue smoothing.
  const meter = new Tone.Meter({ smoothing: 0.6 });
  const monitor = new Tone.Gain(1);
  Tone.connect(master, meter);
  Tone.connect(meter, monitor);
  Tone.connect(monitor, Tone.getDestination());
  const pitch = new Tone.Signal<'frequency'>({
    value: 220,
    units: 'frequency',
  });
  // Recorder taps the master BEFORE the monitor stage: recordings capture
  // the mix even while the speakers are muted.
  const recorder = new Tone.Recorder();
  Tone.connect(master, recorder);
  persistent = { master, meter, monitor, pitch, recorder };
  if (urlFlag('muted')) {
    setMonitorMuted(true);
  }

  // Surface context drops via Tone's OWN emitter — assigning
  // rawContext.onstatechange would clobber the handler Tone installs
  // there for itself.
  Tone.getContext().on('statechange', () => {
    const state = Tone.getContext().state;
    for (const listener of contextStateListeners) listener(state);
  });

  installDebugHandle();
}

/**
 * Resume the context (a user gesture) and build the persistent bus once.
 *
 * NOT permanently cached: the in-flight promise only
 * de-dupes concurrent clicks — it is cleared on settle, so a rejected start
 * can be retried and a suspended context (device switch, OS interrupt) can
 * be RESUMED from the re-shown overlay (Tone.start() on a running context
 * is a no-op; the bus builds exactly once).
 */
function startAudio(): Promise<void> {
  if (startPromise) return startPromise;
  const attempt = (async () => {
    await Tone.start();
    // Register the gate-mode worklets ONCE per context.
    // The generated public/*.worklet.js artifacts are served identically
    // by dev and build; a failure here must not brick basic
    // audio — gate-mode impls throw their own clear error if the
    // processors are missing.
    if (!workletsRegistered) {
      try {
        // NOT Tone's Context.addAudioWorkletModule: tone@15 caches the
        // FIRST call's promise and silently ignores every later URL
        // (Context.js `if (!this._workletPromise)`) — the second module
        // would never register (empty-message NotSupportedError from
        // createAudioWorkletNode). Go straight to the raw context's
        // audioWorklet.
        const audioWorklet = (
          Tone.getContext().rawContext as unknown as {
            audioWorklet?: { addModule(url: string): Promise<void> };
          }
        ).audioWorklet;
        if (!audioWorklet) throw new Error('audioWorklet unavailable');
        // PER-MODULE, not all-or-nothing: a single bad module used to take
        // down `sound-envelope` too, and every generated instrument contains
        // a gate-mode adsr — so one broken string worklet would silence the
        // whole instrument library with nothing but a console error.
        for (const [name, url] of WORKLET_MODULES) {
          try {
            await audioWorklet.addModule(url);
            registeredProcessors.add(name);
          } catch (moduleError) {
            console.error('[audio] worklet failed', url, moduleError);
          }
        }
        workletsRegistered = registeredProcessors.size > 0;
      } catch (error) {
        console.error('[audio] worklet registration failed', error);
      }
    }
    if (!persistent) buildPersistentBus();
  })();
  startPromise = attempt.finally(() => {
    startPromise = undefined;
  });
  return startPromise;
}

let workletsRegistered = false;

/** Processor name → the generated module that registers it (under the
 *  site's base path — a sub-path on GitHub Pages). */
const WORKLET_MODULES: ReadonlyArray<readonly [string, string]> = [
  ['sound-envelope', `${import.meta.env.BASE_URL}envelope.worklet.js`],
  ['sound-threshold', `${import.meta.env.BASE_URL}threshold.worklet.js`],
  ['sound-plucked-string', `${import.meta.env.BASE_URL}pluckedString.worklet.js`],
  ['sound-struck-string', `${import.meta.env.BASE_URL}struckString.worklet.js`],
  ['sound-bowed-string', `${import.meta.env.BASE_URL}bowedString.worklet.js`],
  ['sound-modal-body', `${import.meta.env.BASE_URL}modalBody.worklet.js`],
  ['sound-fdn-reverb', `${import.meta.env.BASE_URL}fdnReverb.worklet.js`],
  ['sound-flute', `${import.meta.env.BASE_URL}flute.worklet.js`],
];

const registeredProcessors = new Set<string>();

/** Impls guard on this before creating worklet nodes.
 *  With a name: did THAT processor register? Without: did any? */
function areWorkletsRegistered(name?: string): boolean {
  return name === undefined
    ? workletsRegistered
    : registeredProcessors.has(name);
}

/** Presence-style URL flag honoring explicit off values. */
function urlFlag(name: string): boolean {
  const value = new URLSearchParams(window.location.search).get(name);
  return value !== null && value !== '0' && value !== 'false';
}

function isAudioStarted(): boolean {
  return persistent !== undefined;
}

/** The Render implementations' connect target (per-node Volume → HERE). */
function getMasterInput(): Tone.Volume {
  if (!persistent) {
    throw new Error(
      'Audio not started — the StartOverlay must resolve Tone.start() first',
    );
  }
  return persistent.master;
}

/** Master level in dB (−Infinity when silent).
 *  NOTE: Tone.Meter smooths PER getValue() CALL — probes asserting silence
 *  must drain it (call in a loop), not read once. */
function masterDb(): number {
  if (!persistent) return Number.NEGATIVE_INFINITY;
  const value = persistent.meter.getValue();
  return Array.isArray(value) ? Math.max(...value) : value;
}

/** The persistent keyboard-pitch Signal (implementations connect PER-BUILD
 *  slaves to it; never hand this to a chain directly). */
function getPitchSignal(): Tone.Signal<'frequency'> {
  if (!persistent) {
    throw new Error(
      'Audio not started — the StartOverlay must resolve Tone.start() first',
    );
  }
  return persistent.pitch;
}

/**
 * Portamento for the MONO keyboard bus.
 *
 * The bus is a single persistent signal, so its glide is a single global
 * setting rather than per-node state. A Keyboard Pitch node publishes its
 * Glide inputs here when the graph is built; with more than one such node in
 * a graph the LAST one built wins, which is the same rule the mono bus
 * already implies (there is only one pitch to follow).
 */
let pitchGlideMode = 'off';
let pitchGlideSeconds = 0;

function setPitchGlide(mode: string, seconds: number): void {
  pitchGlideMode = mode;
  pitchGlideSeconds = seconds;
}

/** Keyboard bus retune. With glide `off` this is the ~10 ms anti-zipper ramp
 *  the app has always used; a hard jump on a frequency clicks. */
function rampPitch(frequencyHz: number): void {
  const pitch = persistent?.pitch;
  if (!pitch) return;
  if (pitchGlideMode === 'off' || !(pitchGlideSeconds > 0)) {
    pitch.rampTo(frequencyHz, 0.01);
    return;
  }
  const now = Tone.getContext().currentTime;
  // A frequency Signal reports Tone's Frequency unit; the scheduler and the
  // zero-crossing guard below both need plain Hertz.
  const current = Tone.Frequency(pitch.getValueAtTime(now)).toFrequency();
  pitch.cancelScheduledValues(now);
  pitch.setValueAtTime(current, now);
  if (pitchGlideMode === 'exponential') {
    // Cannot ramp exponentially through zero.
    const from = current > 1e-3 ? current : 1e-3;
    pitch.setValueAtTime(from, now);
    pitch.exponentialRampToValueAtTime(
      frequencyHz > 1e-3 ? frequencyHz : 1e-3,
      now + pitchGlideSeconds,
    );
    return;
  }
  if (pitchGlideMode === 'smooth') {
    pitch.setTargetAtTime(frequencyHz, now, pitchGlideSeconds / 3);
    return;
  }
  pitch.linearRampToValueAtTime(frequencyHz, now + pitchGlideSeconds);
}

let recording = false;
let lastRecordingBytes = 0;

function isRecording(): boolean {
  return recording;
}

function startRecording(): void {
  if (!persistent || recording) return;
  recording = true;
  persistent.recorder.start();
}

/** Stop and hand back the webm blob (the caller downloads it).
 *  The flag flips only AFTER the recorder settles so a rapid
 *  re-click cannot start() a MediaRecorder that is still stopping. */
async function stopRecording(): Promise<Blob | undefined> {
  if (!persistent || !recording) return undefined;
  try {
    const blob = await persistent.recorder.stop();
    lastRecordingBytes = blob.size;
    return blob;
  } finally {
    recording = false;
  }
}

/** Speaker mute — the monitor stage after the meter (probes unaffected). */
function setMonitorMuted(muted: boolean): void {
  if (!persistent) return;
  persistent.monitor.gain.value = muted ? 0 : 1;
}

function isMonitorMuted(): boolean {
  return persistent !== undefined && persistent.monitor.gain.value === 0;
}

function onContextStateChange(listener: (state: string) => void): () => void {
  contextStateListeners.add(listener);
  return () => contextStateListeners.delete(listener);
}

declare global {
  interface Window {
    __sound?: {
      contextState: () => string;
      buildId: () => number;
      registrySize: () => number;
      masterDb: () => number;
      gateTargets: () => number;
      monitorMuted: () => boolean;
      getFftBins: (nodeId: string) => number[] | null;
      sampleRate: () => number;
      lastRecordingBytes: () => number;
      /** The Tone context, for worklet debugging. */
      _context: () => unknown;
    };
  }
}

function installDebugHandle(): void {
  window.__sound = {
    contextState: () => Tone.getContext().state,
    buildId: getCurrentBuildId,
    registrySize,
    masterDb,
    gateTargets: gateTargetCount,
    monitorMuted: isMonitorMuted,
    getFftBins: getTapFftBins,
    sampleRate: () => Tone.getContext().sampleRate,
    lastRecordingBytes: () => lastRecordingBytes,
    /** The Tone context, for worklet debugging. */
    _context: () => Tone.getContext(),
  };
}

// Vite HMR re-evaluates module state while the old build's nodes keep
// sounding — exactly the stacking this exists to prevent.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeBuild();
  });
}

export {
  areWorkletsRegistered,
  getMasterInput,
  getPitchSignal,
  isAudioStarted,
  isMonitorMuted,
  isRecording,
  masterDb,
  onContextStateChange,
  rampPitch,
  setMonitorMuted,
  setPitchGlide,
  startAudio,
  startRecording,
  stopRecording,
  urlFlag,
};

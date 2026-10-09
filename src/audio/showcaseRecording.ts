/**
 * Recorded previews for the landing page's showcase frames
 * (`.claude/plans/live-landing.md`, stage 2). Showcase mode ONLY.
 *
 * A showcase can never start live audio — browsers need a click — so instead
 * of playing the open graph it RECORDS it, silently, and plays the recording
 * back into the app's own previews and timeline playhead:
 *
 *   1. "Start audio" on an OfflineAudioContext (`startOfflineAudio`): the same
 *      worklets and persistent bus as a real start, no gesture needed.
 *   2. Run the graph with the app's own runner — the real build path, real
 *      implementations — and, when the graph has timeline curves, play the
 *      real timeline transport against that context.
 *   3. Let the previews acquire their taps as they always do (their painters,
 *      on the next frames), then render the context, suspending it every
 *      1/frameRate s to copy what each tap's OWN analyser reads — and the
 *      transport's playhead.
 *   4. Swap each tap's analyser for its recording and the transport for a
 *      playback one (`playbackTransport.ts`), both on one loop clock.
 *
 * The painters never know: they read `tap.analyser.getValue()` and
 * `getTimelineTransport()` exactly as in the app.
 */
import type { RunEvent } from '@theclearsky/react-blender-nodes';
import type { TimelineTransport } from '@theclearsky/react-blender-nodes-timeline';
import { startOfflineAudio } from './bootstrap';
import {
  arePreviewsPaused,
  getLiveTaps,
  replaceTapAnalyser,
  setPreviewsPaused,
} from '../components/previews/tapManager';
import type { Tap } from '../components/previews/tapManager';
import {
  createFrameTrackWriter,
  createLoopClock,
  frameBytes,
  planFrameBudget,
  RecordedAnalyser,
} from '../components/previews/recordedFrames';
import type {
  FrameEncoding,
  FrameShape,
  FrameTrackWriter,
} from '../components/previews/recordedFrames';
import {
  ensureTimelineRuntime,
  getTimelineRegistry,
  getTimelineStore,
  installPlaybackTransport,
} from '../timeline/timelineSystem';
import { createPlaybackTransport } from '../timeline/playbackTransport';

/** The loop the previews replay. Long enough that a rhythm reads as one (a
 *  2-bar phrase at 120 BPM), short enough to render quickly on a phone. */
const LOOP_SECONDS = 4;
/** Rendered first and NOT replayed: oscillators and reverbs start from
 *  silence, and a loop that opened on that silence would flash flat each
 *  pass. Half a second lets the attacks settle and the tails start. */
const PRE_ROLL_SECONDS = 0.5;
/** Frames per second recorded (the painters run at the display rate and
 *  show each frame for the time it covers). */
const FRAME_RATE = 30;
/** The frame rate may drop to this to stay inside the memory budget. */
const MIN_FRAME_RATE = 12;
/** Hard bound on the recorded frames of one showcase. */
const MAX_RECORDING_BYTES = 8 * 1024 * 1024;
/** A run that has not ended by then is not going to. */
const RUN_TIMEOUT_MS = 20000;

type RecorderDeps = {
  /** Where the score starts playing, in seconds (default 0). */
  startAt?: number;
  /** Is a graph open (not the Welcome page)? */
  hasGraph(): boolean;
  /** Start a run with the app's runner — what Run / auto-run call. */
  run(): void;
  /** Hand the playback transport to the timeline UI. */
  showTransport(transport: TimelineTransport): void;
};

type RecordingStats = {
  previews: number;
  sampleRate: number;
  frameRate: number;
  loopSeconds: number;
  bytes: number;
  timeline: boolean;
  /** Offline render only. */
  renderMs: number;
  /** Everything: start, run, render, swap. */
  totalMs: number;
};

// ── Run completion (fed by the App's `onRunEvent`) ──

let runWaiters: Array<(completed: boolean) => void> = [];

/** The App forwards its runner events here (showcase mode only). */
function noteShowcaseRunEvent(event: RunEvent): void {
  if (event.kind === 'run:started') return;
  const waiters = runWaiters;
  runWaiters = [];
  for (const resolve of waiters) resolve(event.kind === 'run:completed');
}

function waitForRunEnd(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('the showcase run did not end')),
      RUN_TIMEOUT_MS,
    );
    runWaiters.push((completed) => {
      window.clearTimeout(timer);
      resolve(completed);
    });
  });
}

/** One display frame — or a short timeout, so a frame the browser is not
 *  painting (throttled, off-screen) cannot stall the recording forever. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, 100);
    requestAnimationFrame(() => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}

/** The previews acquire their taps in their painters, on the frames after
 *  the run's record lands. Wait until the set of taps stops growing (and,
 *  while there is none yet, give the record time to land). */
async function settleTaps(): Promise<void> {
  let previous = -1;
  let stableFrames = 0;
  for (let frame = 0; frame < 60; frame++) {
    await nextFrame();
    const count = getLiveTaps().size;
    stableFrames = count === previous ? stableFrames + 1 : 0;
    previous = count;
    if (stableFrames >= 3 && (count > 0 || frame >= 20)) return;
  }
}

type TapPlan = {
  nodeId: string;
  tap: Tap;
  frameLength: number;
  shape: FrameShape;
  encoding: FrameEncoding;
};

/** How each tap's frames are kept: an audio waveform as clamped 16-bit (its
 *  painter clamps to ±1 anyway), everything else exact. */
function planTap(nodeId: string, tap: Tap): TapPlan {
  const value = tap.analyser.getValue();
  const shape: FrameShape = typeof value === 'number' ? 'number' : 'array';
  return {
    nodeId,
    tap,
    frameLength: typeof value === 'number' ? 1 : value.length,
    shape,
    encoding: tap.mode === 'wave' ? 'unit16' : 'float32',
  };
}

type NativeOfflineContext = {
  suspend(when: number): Promise<void>;
  resume(): Promise<void>;
};

/** standardized-audio-context (Tone's wrapper) does not expose `suspend` on
 *  its OfflineAudioContext; the native context it wraps does. */
function nativeOfflineContext(rawContext: unknown): NativeOfflineContext {
  const native = (rawContext as { _nativeOfflineAudioContext?: unknown })
    ._nativeOfflineAudioContext as Partial<NativeOfflineContext> | undefined;
  if (typeof native?.suspend !== 'function' || typeof native.resume !== 'function') {
    throw new Error('this browser cannot suspend an offline audio render');
  }
  return native as NativeOfflineContext;
}

type ConnectableLike = { connect(destination: unknown): unknown };

/**
 * standardized-audio-context (Tone's wrapper) renders an OFFLINE graph
 * lazily, walking upstream from the destination: a node with no path to the
 * destination is never rendered — and an analyser is exactly such a dead end
 * (measured: a tapped oscillator read all zeros). Each tap's native analysers
 * are fed into one silent sink on the destination so the render reaches them
 * (and, through them, the chain they tap). The rendered buffer is discarded.
 */
function reachAnalysers(
  rawContext: unknown,
  analysers: readonly Tap['analyser'][],
): void {
  const raw = rawContext as {
    createGain(): ConnectableLike & { gain: { value: number } };
    destination: unknown;
  };
  const sink = raw.createGain();
  sink.gain.value = 0;
  sink.connect(raw.destination);
  for (const analyser of analysers) {
    // Tone.Waveform / FFT / Meter → their Tone.Analyser → its native nodes.
    const nodes = (
      analyser as unknown as { _analyser?: { _analysers?: ConnectableLike[] } }
    )._analyser?._analysers;
    if (!Array.isArray(nodes)) {
      throw new Error('cannot reach a preview analyser (Tone internals changed?)');
    }
    for (const node of nodes) node.connect(sink);
  }
}

let started = false;

/**
 * Record the open graph and start its playback. Resolves once the recorded
 * playback is running; at once when no graph is open. One recording per page
 * (its offline context is the page's audio context from then on).
 */
async function recordOpenGraph(deps: RecorderDeps): Promise<RecordingStats | null> {
  if (started || !deps.hasGraph()) return null;
  const startedAt = performance.now();
  started = true;

  // Frames k = 0..frames-1 are replayed; the playhead gets one more sample
  // (at the loop's end) to interpolate the last frame. The render runs a
  // few render quanta past it — a suspend must fall before the end.
  const renderSeconds = PRE_ROLL_SECONDS + LOOP_SECONDS + 0.02;
  const context = await startOfflineAudio(renderSeconds);
  // The transport and driver registry bind to the offline context.
  const transport = ensureTimelineRuntime();

  const ended = waitForRunEnd();
  deps.run();
  const completed = await ended;
  if (!completed) throw new Error('the showcase run did not complete');

  // A score plays while it records — as after "Run, then ▶" in the app.
  const playsTimeline = (getTimelineRegistry()?.getLiveDrivers().length ?? 0) > 0;
  if (playsTimeline) {
    if (deps.startAt) transport.scrub(deps.startAt);
    transport.play();
  }
  // Both settle here, before the render: the previews' taps, and any
  // coalesced transport flush (one frame + 40 ms) — a flush landing MID-render
  // would cancel and rewrite automation at an arbitrary render time.
  await settleTaps();

  const plans = [...getLiveTaps()].map(([nodeId, tap]) => planTap(nodeId, tap));
  const budget = planFrameBudget(
    plans.map((plan) => frameBytes(plan.frameLength, plan.encoding)),
    {
      loopSeconds: LOOP_SECONDS,
      frameRate: FRAME_RATE,
      minFrameRate: MIN_FRAME_RATE,
      maxBytes: MAX_RECORDING_BYTES,
    },
  );
  const frameRate = budget.frameRate;
  const recorded = budget.recorded.map((index) => plans[index]);
  const frames = frameRate * LOOP_SECONDS;
  const writers = new Map<string, FrameTrackWriter>(
    recorded.map((plan) => [
      plan.nodeId,
      createFrameTrackWriter({
        frameLength: plan.frameLength,
        frameCount: frames,
        frameRate,
        shape: plan.shape,
        encoding: plan.encoding,
      }),
    ]),
  );
  const playheads = new Float64Array(frames + 1);

  // Nothing on screen moves with the sound (no tapped preview, no score):
  // nothing to render.
  let renderMs = 0;
  if (recorded.length > 0 || playsTimeline) {
    reachAnalysers(
      context.rawContext,
      recorded.map((plan) => plan.tap.analyser),
    );
    const native = nativeOfflineContext(context.rawContext);
    for (let frame = 0; frame <= frames; frame++) {
      const at = PRE_ROLL_SECONDS + frame / frameRate;
      void native.suspend(at).then(() => {
        if (frame < frames) {
          for (const plan of recorded) {
            writers.get(plan.nodeId)?.push(plan.tap.analyser.getValue());
          }
        }
        playheads[frame] = transport.getPlayheadTime();
        void native.resume();
      }, (error: unknown) => console.warn('[showcase] a frame was not sampled', error));
    }
    // Every suspend is a round trip through the main thread; painting ~20
    // previews meanwhile (of a graph not yet showing anything) only delays it.
    const wasPaused = arePreviewsPaused();
    setPreviewsPaused(true);
    const renderStartedAt = performance.now();
    try {
      await (context.rawContext as unknown as { startRendering(): Promise<unknown> })
        .startRendering();
    } finally {
      setPreviewsPaused(wasPaused);
    }
    renderMs = performance.now() - renderStartedAt;
  }

  // Playback: one clock for every recorded preview and the playhead.
  const clock = createLoopClock(frames / frameRate);
  let bytes = 0;
  let previews = 0;
  for (const plan of recorded) {
    const track = writers.get(plan.nodeId)?.finish();
    if (!track) continue;
    bytes += track.data.byteLength;
    if (replaceTapAnalyser(plan.nodeId, new RecordedAnalyser(track, clock))) {
      previews += 1;
    }
  }
  const playback = createPlaybackTransport({
    track: playsTimeline ? { frameRate, playheads } : null,
    clock,
    getDurationSec: () => getTimelineStore().getDocument().durationSec,
  });
  installPlaybackTransport(playback);
  deps.showTransport(playback);

  const stats: RecordingStats = {
    previews,
    sampleRate: context.sampleRate,
    frameRate,
    loopSeconds: frames / frameRate,
    bytes,
    timeline: playsTimeline,
    renderMs: Math.round(renderMs),
    totalMs: Math.round(performance.now() - startedAt),
  };
  console.info(
    `[showcase] recorded ${previews} previews: ${stats.loopSeconds} s at ` +
      `${frameRate} fps (${context.sampleRate} Hz), ` +
      `${(bytes / 1024 / 1024).toFixed(2)} MB, render ` +
      `${stats.renderMs} ms, total ${stats.totalMs} ms`,
  );
  // Verification handle (like `window.__sound`).
  (window as Window & { __showcaseRecording?: RecordingStats }).__showcaseRecording =
    stats;
  return stats;
}

export { noteShowcaseRunEvent, recordOpenGraph };
export type { RecorderDeps, RecordingStats };

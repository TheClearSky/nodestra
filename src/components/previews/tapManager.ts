/**
 * Analyser-tap lifecycle + the shared paint loop for node previews.
 *
 * Rules:
 * - Detach direction: during a LIVE build (mode switch/unmount)
 *   disconnect source-side then dispose the analyser; on BUILD CHANGE
 *   dispose the analyser ONLY — source-side disconnect against a disposed
 *   chain throws InvalidAccessError inside rAF.
 * - One shared rAF loop paints every mounted preview; audiogram painters
 *   self-throttle to ~30 fps and are CAPPED at 8 concurrently (LRU demotes
 *   the oldest back to wave).
 * - Staleness: chain.buildId !== current ⇒ flatline, never touch nodes.
 */

import * as Tone from 'tone';
import { getCurrentBuildId } from '../../soundDefinitions/audioSystem';
import { isRecordedAnalyser } from './recordedFrames';
import type { RecordedAnalyser } from './recordedFrames';

type TapMode = 'wave' | 'audiogram' | 'meter' | 'signal';

/** What a preview reads: a live Tone analyser (Waveform, FFT, Meter) — or,
 *  in a showcase, its recording (`recordedFrames.ts`), which answers
 *  `getValue()` in the same shape. Painters read it through `readArray` /
 *  `readLevel`, never by casting to a Tone class. */
type PreviewAnalyser = {
  getValue(): Float32Array | number | number[];
  dispose(): unknown;
};

type Tap = {
  analyser: PreviewAnalyser;
  mode: TapMode;
  buildId: number;
  source: unknown;
};

const AUDIOGRAM_CAP = 8;

const taps = new Map<string, Tap>();
const modeByNode = new Map<string, TapMode>();
const audiogramLru: string[] = [];

type ToneConnectSource = Parameters<typeof Tone.connect>[0];

function getPreviewMode(nodeId: string, fallback: TapMode): TapMode {
  return modeByNode.get(nodeId) ?? fallback;
}

function setPreviewMode(nodeId: string, mode: TapMode): void {
  modeByNode.set(nodeId, mode);
  if (mode === 'audiogram') {
    const existing = audiogramLru.indexOf(nodeId);
    if (existing >= 0) audiogramLru.splice(existing, 1);
    audiogramLru.push(nodeId);
    while (audiogramLru.length > AUDIOGRAM_CAP) {
      const demoted = audiogramLru.shift();
      if (demoted !== undefined) modeByNode.set(demoted, 'wave');
    }
  }
}

function makeAnalyser(mode: TapMode): Tone.Waveform | Tone.FFT | Tone.Meter {
  switch (mode) {
    case 'wave':
      return new Tone.Waveform(1024);
    case 'audiogram':
      return new Tone.FFT({ size: 1024, smoothing: 0.6 });
    case 'meter':
      return new Tone.Meter({ smoothing: 0.6 });
    case 'signal':
      // Raw signed samples — Tone.Meter is RMS/sign-blind, and DCMeter read
      // a constant 0 against LFO chains in live probing; the alternative is
      // a small Waveform buffer whose LAST sample is the live value.
      return new Tone.Waveform(256);
  }
}

function disposeTap(tap: Tap): void {
  // A recording was never connected to anything.
  if (tap.buildId === getCurrentBuildId() && !isRecordedAnalyser(tap.analyser)) {
    try {
      Tone.disconnect(
        tap.source as ToneConnectSource,
        tap.analyser as unknown as Parameters<typeof Tone.disconnect>[1],
      );
    } catch {
      // Connection may already be gone — analyser dispose below suffices.
    }
  }
  try {
    tap.analyser.dispose();
  } catch {
    // Never let cleanup throw into a paint frame.
  }
}

/** Get (or lazily build) the analyser for (nodeId, chain, mode). Returns
 *  null while the chain is stale — the caller paints a flatline. */
function acquireTap(
  nodeId: string,
  chain: { output: unknown; buildId: number },
  mode: TapMode,
): Tap | null {
  if (chain.buildId !== getCurrentBuildId()) {
    const stale = taps.get(nodeId);
    if (stale) {
      disposeTap(stale);
      taps.delete(nodeId);
    }
    return null;
  }
  const existing = taps.get(nodeId);
  if (
    existing &&
    existing.mode === mode &&
    existing.buildId === chain.buildId &&
    existing.source === chain.output
  ) {
    return existing;
  }
  if (existing) {
    disposeTap(existing);
    taps.delete(nodeId);
  }
  const analyser = makeAnalyser(mode);
  try {
    Tone.connect(
      chain.output as ToneConnectSource,
      analyser as unknown as Parameters<typeof Tone.connect>[1],
    );
  } catch (error) {
    // A connect failure (e.g. torn-down internals) must not leak one
    // analyser per rAF frame: dispose and report stale.
    try {
      analyser.dispose();
    } catch {
      // best-effort
    }
    console.warn('[tapManager] tap connect failed', error);
    return null;
  }
  const tap: Tap = { analyser, mode, buildId: chain.buildId, source: chain.output };
  taps.set(nodeId, tap);
  return tap;
}

/** Showcase recording: every tap that is live right now (one per mounted
 *  preview of the current build). */
function getLiveTaps(): ReadonlyMap<string, Tap> {
  const current = getCurrentBuildId();
  return new Map([...taps].filter(([, tap]) => tap.buildId === current));
}

/**
 * Showcase recording: swap a tap's analyser for its recording. The tap keeps
 * its identity (mode, build, source), so `acquireTap` goes on returning it and
 * the painters read the recording exactly as they read the analyser. The live
 * analyser is disconnected and disposed here, like any replaced tap.
 */
function replaceTapAnalyser(nodeId: string, analyser: RecordedAnalyser): boolean {
  const tap = taps.get(nodeId);
  if (!tap || tap.buildId !== getCurrentBuildId()) return false;
  disposeTap(tap);
  tap.analyser = analyser;
  return true;
}

function releaseTap(nodeId: string): void {
  const tap = taps.get(nodeId);
  if (tap) {
    disposeTap(tap);
    taps.delete(nodeId);
  }
}

// ── Shared paint loop ──
// Painters are keyed by a PER-MOUNT token, never by nodeId: the host (and
// StrictMode) can mount two preview instances for one node, and an
// id-keyed map lets instance A's cleanup delete instance B's painter —
// observed live as a frozen readout. The tap itself is per-node and
// released only when the last instance for that node unmounts.

const painters = new Map<object, () => void>();
const painterCountByNode = new Map<string, number>();
let rafHandle: number | null = null;
/** Why nobody can see the previews right now — the landing stage covers the
 *  app ('app'), a showcase frame is off screen ('offscreen'), a recording is
 *  rendering ('recording'). While any reason holds, the loop stops outright
 *  rather than drawing ~20 waveforms nobody sees. */
type PauseReason = 'app' | 'offscreen' | 'recording';
const pauseReasons = new Set<PauseReason>();
/** A showcase recording needs the painters to run once — they acquire the
 *  taps it records — whatever else holds them paused. */
let forcedRuns = 0;
let paused = false;

function syncPaused(): void {
  const next = pauseReasons.size > 0 && forcedRuns === 0;
  if (next === paused) return;
  paused = next;
  if (!paused && rafHandle === null && painters.size > 0) {
    rafHandle = requestAnimationFrame(paintFrame);
  }
}

function paintFrame(): void {
  if (paused) {
    rafHandle = null;
    return;
  }
  for (const paint of painters.values()) {
    try {
      paint();
    } catch {
      // One broken painter must not kill the loop.
    }
  }
  rafHandle = painters.size > 0 ? requestAnimationFrame(paintFrame) : null;
}

function registerPainter(nodeId: string, paint: () => void): () => void {
  const token = {};
  painters.set(token, paint);
  painterCountByNode.set(nodeId, (painterCountByNode.get(nodeId) ?? 0) + 1);
  if (rafHandle === null && !paused) rafHandle = requestAnimationFrame(paintFrame);
  return () => {
    painters.delete(token);
    const remaining = (painterCountByNode.get(nodeId) ?? 1) - 1;
    if (remaining <= 0) {
      painterCountByNode.delete(nodeId);
      releaseTap(nodeId);
    } else {
      painterCountByNode.set(nodeId, remaining);
    }
  };
}

/** Stop / resume every preview painter (and the timeline-curve previews,
 *  which read `arePreviewsPaused`) for one reason; they run again once no
 *  reason holds. */
function setPreviewsPaused(next: boolean, reason: PauseReason = 'app'): void {
  if (next) pauseReasons.add(reason);
  else pauseReasons.delete(reason);
  syncPaused();
}

/** Showcase recording: run the painters whatever pauses them, until the
 *  returned release is called. */
function forcePreviewsRunning(): () => void {
  forcedRuns += 1;
  syncPaused();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    forcedRuns -= 1;
    syncPaused();
  };
}

function arePreviewsPaused(): boolean {
  return paused;
}

const NO_SAMPLES = new Float32Array(0);

/** A wave or signal tap's samples, or an audiogram tap's spectrum (dB per
 *  bin) — whatever array the analyser (or its recording) holds now. */
function readArray(tap: Tap): Float32Array {
  const value = tap.analyser.getValue();
  if (value instanceof Float32Array) return value;
  return Array.isArray(value) ? Float32Array.from(value) : NO_SAMPLES;
}

/** A meter tap's level (dB; the loudest channel). */
function readLevel(tap: Tap): number {
  const value = tap.analyser.getValue();
  if (typeof value === 'number') return value;
  return value.length > 0 ? Math.max(...value) : -Infinity;
}

/** Dev/verification: read a node's current FFT bins (audiogram tap) —
 *  verification probes assert spectra through this. */
function getTapFftBins(nodeId: string): number[] | null {
  const tap = taps.get(nodeId);
  if (!tap || tap.mode !== 'audiogram') return null;
  return Array.from(readArray(tap));
}

export {
  acquireTap,
  arePreviewsPaused,
  forcePreviewsRunning,
  readArray,
  readLevel,
  getLiveTaps,
  replaceTapAnalyser,
  setPreviewsPaused,
  getPreviewMode,
  getTapFftBins,
  registerPainter,
  setPreviewMode,
};
export type { PauseReason, PreviewAnalyser, Tap, TapMode };

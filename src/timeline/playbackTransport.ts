/**
 * The timeline transport a showcase plays back (`.claude/plans/live-landing.md`,
 * stage 2). A showcase records the open graph offline; when the timeline
 * played during that recording, this transport replays its PLAYHEAD — sampled
 * from the real transport at every recorded frame — in a loop on the same
 * clock as the recorded previews, so the playhead, the curve-node markers and
 * the waveforms move together exactly as they did in the render.
 *
 * It drives nothing: the audio was rendered already. The controls still mean
 * what they mean in the app — Stop parks at 0, Pause holds, Play resumes the
 * recording — so a visitor clicking them sees the UI respond the same way.
 *
 * Pure: the clock is injected (tested on fakes).
 */
import type {
  TimelineTransport,
  TransportState,
} from '@theclearsky/react-blender-nodes-timeline';
import type { LoopClock } from '../components/previews/recordedFrames';

/** The real transport's playhead at frame k of the recording (k/frameRate s
 *  into the loop), one extra sample at the loop's end for interpolation. */
type PlayheadTrack = {
  readonly frameRate: number;
  readonly playheads: Float64Array;
};

/**
 * The recorded playhead at `loopTime`. Between two samples it moves linearly
 * (the live playhead advances in real time, so this is exact while playing);
 * across a wrap (the document looped, or ended and parked) it holds the
 * earlier sample rather than sweep backwards through the score.
 */
function playheadAt(track: PlayheadTrack, loopTime: number): number {
  const { playheads, frameRate } = track;
  if (playheads.length === 0) return 0;
  const position = Math.max(0, loopTime * frameRate);
  const index = Math.min(Math.floor(position), playheads.length - 1);
  const from = playheads[index];
  if (index + 1 >= playheads.length) return from;
  const to = playheads[index + 1];
  if (to < from) return from;
  return from + (to - from) * (position - index);
}

function createPlaybackTransport(options: {
  /** Null: the timeline did not play while recording — nothing to replay. */
  track: PlayheadTrack | null;
  clock: LoopClock;
  /** Clamp for scrubs (the document's duration). */
  getDurationSec(): number;
}): TimelineTransport {
  const { track, clock, getDurationSec } = options;
  let state: TransportState = track === null ? 'stopped' : 'playing';
  let parkedSeconds = track === null ? 0 : playheadAt(track, clock.loopTime());
  let disposed = false;
  const listeners = new Set<() => void>();

  function current(): number {
    return state === 'playing' && track !== null
      ? playheadAt(track, clock.loopTime())
      : parkedSeconds;
  }

  function setState(next: TransportState, seconds: number): void {
    state = next;
    parkedSeconds = seconds;
    for (const listener of [...listeners]) listener();
  }

  return {
    getState: () => state,
    getPlayheadTime: current,
    play() {
      // Only what was recorded can play; the recording runs on its own clock.
      if (disposed || track === null || state === 'playing') return;
      setState('playing', parkedSeconds);
    },
    pause() {
      if (disposed || state !== 'playing') return;
      setState('paused', current());
    },
    stop() {
      if (disposed) return;
      setState('stopped', 0);
    },
    scrub(timeSeconds) {
      if (disposed || !Number.isFinite(timeSeconds)) return;
      const clamped = Math.min(Math.max(timeSeconds, 0), getDurationSec());
      // A recording cannot play from an arbitrary point: a scrub parks there.
      setState(state === 'stopped' ? 'stopped' : 'paused', clamped);
    },
    notifyDocumentChanged() {},
    notifyBuildEnded() {},
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}

export { createPlaybackTransport, playheadAt };
export type { PlayheadTrack };

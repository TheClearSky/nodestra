/**
 * Recorded preview frames — what a showcase plays back instead of a live
 * analyser (`.claude/plans/live-landing.md`, stage 2).
 *
 * A showcase cannot start live audio (browsers need a click), so it renders
 * the open graph on an OfflineAudioContext and, every 1/frameRate s of that
 * render, copies what each preview's OWN analyser returns. Played back, a
 * `RecordedAnalyser` answers `getValue()` with the frame for the current loop
 * time — the same shape the Tone analyser had — so the painters draw exactly
 * what they would have drawn live, untouched.
 *
 * Everything here is pure (no Tone, no DOM): the clock is injected.
 */

/** Seconds since some fixed origin. */
type Now = () => number;

/** One loop of the recording, shared by every recorded preview and the
 *  playback transport so a note and the playhead stay in step. */
type LoopClock = {
  readonly loopSeconds: number;
  /** Seconds into the current pass of the loop, in [0, loopSeconds). */
  loopTime(): number;
};

function createLoopClock(
  loopSeconds: number,
  now: Now = () => performance.now() / 1000,
): LoopClock {
  if (!(loopSeconds > 0)) throw new Error('loopSeconds must be positive');
  const origin = now();
  return {
    loopSeconds,
    loopTime: () => wrapLoopTime(now() - origin, loopSeconds),
  };
}

/** Elapsed seconds → seconds into the loop, in [0, loopSeconds). */
function wrapLoopTime(elapsedSeconds: number, loopSeconds: number): number {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;
  const wrapped = elapsedSeconds % loopSeconds;
  // `%` of a value a hair under a multiple can round up to loopSeconds.
  return wrapped >= loopSeconds ? 0 : wrapped;
}

/** The frame showing at `loopTime`: frame k covers [k, k+1) / frameRate. */
function frameIndexAt(
  loopTime: number,
  frameCount: number,
  frameRate: number,
): number {
  if (frameCount <= 0) return -1;
  const index = Math.floor(loopTime * frameRate);
  if (!Number.isFinite(index) || index < 0) return 0;
  return index >= frameCount ? frameCount - 1 : index;
}

/**
 * How a track stores its frames.
 *  float32  exact — frequency bins (dB), meter levels, control signals (any
 *           range: a cutoff curve reads 1955).
 *  unit16   an audio waveform: the painter clamps to [-1, 1], so it is stored
 *           clamped as 16-bit (steps of 1/32767 — far below one pixel of the
 *           240-px canvas) at half the memory.
 */
type FrameEncoding = 'float32' | 'unit16';

/** What a recorded analyser hands back: an array (waveform, FFT) or a
 *  number (a mono Tone.Meter). */
type FrameShape = 'array' | 'number';

type FrameTrack = {
  readonly frameLength: number;
  readonly frameCount: number;
  readonly frameRate: number;
  readonly shape: FrameShape;
  readonly encoding: FrameEncoding;
  /** frameCount × frameLength values, frame-major. */
  readonly data: Float32Array | Int16Array;
};

const UNIT16_SCALE = 32767;

/** Bytes one frame of a track takes — the memory budget is planned with it. */
function frameBytes(frameLength: number, encoding: FrameEncoding): number {
  return frameLength * (encoding === 'unit16' ? 2 : 4);
}

/**
 * The memory bound. Given each track's bytes per frame: the full frame rate
 * if every track fits; else a lower rate, down to `minFrameRate`; else, at
 * that rate, the tracks that fit (in order) — the rest are not recorded.
 * Returns the rate and the indices of the tracks to record.
 */
function planFrameBudget(
  bytesPerFrame: readonly number[],
  options: {
    loopSeconds: number;
    frameRate: number;
    minFrameRate: number;
    maxBytes: number;
  },
): { frameRate: number; recorded: number[] } {
  const { loopSeconds, maxBytes } = options;
  const total = bytesPerFrame.reduce((sum, bytes) => sum + bytes, 0);
  const affordable =
    total > 0 ? Math.floor(maxBytes / (total * loopSeconds)) : options.frameRate;
  const frameRate = Math.max(
    options.minFrameRate,
    Math.min(options.frameRate, affordable),
  );
  const frames = frameRate * loopSeconds;
  const recorded: number[] = [];
  let bytes = 0;
  bytesPerFrame.forEach((perFrame, index) => {
    const cost = perFrame * frames;
    if (bytes + cost > maxBytes) return;
    bytes += cost;
    recorded.push(index);
  });
  return { frameRate, recorded };
}

/** Fills a track frame by frame while the offline render runs. */
type FrameTrackWriter = {
  /** Copy one analyser reading in; readings past `frameCount` are dropped. */
  push(value: ArrayLike<number> | number): void;
  /** The frames written so far (a short render leaves a short track). */
  finish(): FrameTrack;
};

function createFrameTrackWriter(options: {
  frameLength: number;
  frameCount: number;
  frameRate: number;
  shape: FrameShape;
  encoding: FrameEncoding;
}): FrameTrackWriter {
  const { frameLength, frameCount, frameRate, shape, encoding } = options;
  const data =
    encoding === 'unit16'
      ? new Int16Array(frameLength * frameCount)
      : new Float32Array(frameLength * frameCount);
  let written = 0;
  return {
    push(value) {
      if (written >= frameCount) return;
      const offset = written * frameLength;
      for (let index = 0; index < frameLength; index++) {
        const sample =
          typeof value === 'number' ? value : (value[index] ?? Number.NaN);
        if (encoding === 'unit16') {
          const clamped = Number.isFinite(sample)
            ? Math.max(-1, Math.min(1, sample))
            : 0;
          data[offset + index] = Math.round(clamped * UNIT16_SCALE);
        } else {
          data[offset + index] = sample;
        }
      }
      written += 1;
    },
    finish() {
      return {
        frameLength,
        frameCount: written,
        frameRate,
        shape,
        encoding,
        data: written === frameCount ? data : data.slice(0, written * frameLength),
      };
    },
  };
}

/** The value `getValue()` returns for frame `index`: arrays are written
 *  into `into` (one reused array per analyser, as Tone's analysers do). */
function readFrame(
  track: FrameTrack,
  index: number,
  into: Float32Array,
): Float32Array | number {
  if (index < 0 || track.frameCount === 0) {
    if (track.shape === 'number') return Number.NEGATIVE_INFINITY;
    into.fill(0);
    return into;
  }
  const offset = index * track.frameLength;
  if (track.shape === 'number') {
    const value = track.data[offset];
    return track.encoding === 'unit16' ? value / UNIT16_SCALE : value;
  }
  if (track.encoding === 'unit16') {
    for (let sample = 0; sample < track.frameLength; sample++) {
      into[sample] = track.data[offset + sample] / UNIT16_SCALE;
    }
  } else {
    into.set(track.data.subarray(offset, offset + track.frameLength));
  }
  return into;
}

/**
 * Stands in for a preview's Tone analyser after a showcase recording. Same
 * `getValue()` shape; `dispose()` so the tap lifecycle treats it like the
 * analyser it replaces. Like Tone's analysers, it reuses ONE output array.
 */
class RecordedAnalyser {
  private readonly track: FrameTrack;
  private readonly clock: LoopClock;
  private readonly buffer: Float32Array;
  constructor(track: FrameTrack, clock: LoopClock) {
    this.track = track;
    this.clock = clock;
    this.buffer = new Float32Array(track.frameLength);
  }
  getValue(): Float32Array | number {
    const index = frameIndexAt(
      this.clock.loopTime(),
      this.track.frameCount,
      this.track.frameRate,
    );
    return readFrame(this.track, index, this.buffer);
  }
  dispose(): this {
    return this;
  }
}

function isRecordedAnalyser(value: unknown): value is RecordedAnalyser {
  return value instanceof RecordedAnalyser;
}

export {
  createFrameTrackWriter,
  createLoopClock,
  frameBytes,
  frameIndexAt,
  isRecordedAnalyser,
  planFrameBudget,
  readFrame,
  RecordedAnalyser,
  wrapLoopTime,
};
export type { FrameEncoding, FrameShape, FrameTrack, FrameTrackWriter, LoopClock, Now };

import { describe, expect, it, vi } from 'vitest';
import {
  createFrameTrackWriter,
  createLoopClock,
  frameBytes,
  frameIndexAt,
  isRecordedAnalyser,
  planFrameBudget,
  RecordedAnalyser,
  wrapLoopTime,
} from '../components/previews/recordedFrames';
import type { LoopClock } from '../components/previews/recordedFrames';
import { createPlaybackTransport, playheadAt } from '../timeline/playbackTransport';
import type { PlayheadTrack } from '../timeline/playbackTransport';

/** A loop clock the test moves by hand. */
function manualClock(loopSeconds: number) {
  let seconds = 0;
  const clock = createLoopClock(loopSeconds, () => seconds);
  return {
    clock,
    set(next: number) {
      seconds = next;
    },
  };
}

function fixedClock(loopTime: number, loopSeconds = 4): LoopClock {
  return { loopSeconds, loopTime: () => loopTime };
}

describe('wrapLoopTime', () => {
  it('wraps elapsed time into [0, loop)', () => {
    expect(wrapLoopTime(0, 4)).toBe(0);
    expect(wrapLoopTime(1.5, 4)).toBe(1.5);
    expect(wrapLoopTime(4, 4)).toBe(0);
    expect(wrapLoopTime(9.25, 4)).toBeCloseTo(1.25);
  });

  it('treats negative and non-finite time as the loop start', () => {
    expect(wrapLoopTime(-3, 4)).toBe(0);
    expect(wrapLoopTime(Number.NaN, 4)).toBe(0);
    expect(wrapLoopTime(Number.POSITIVE_INFINITY, 4)).toBe(0);
  });
});

describe('createLoopClock', () => {
  it('counts from its creation and loops', () => {
    let now = 100;
    const clock = createLoopClock(4, () => now);
    expect(clock.loopTime()).toBe(0);
    now = 102.5;
    expect(clock.loopTime()).toBeCloseTo(2.5);
    now = 105;
    expect(clock.loopTime()).toBeCloseTo(1);
  });

  it('refuses a loop with no length', () => {
    expect(() => createLoopClock(0)).toThrow();
  });
});

describe('frameIndexAt', () => {
  it('maps loop time to the frame that covers it', () => {
    // 30 fps: frame k covers [k/30, (k+1)/30).
    expect(frameIndexAt(0, 120, 30)).toBe(0);
    expect(frameIndexAt(1 / 30 - 1e-9, 120, 30)).toBe(0);
    expect(frameIndexAt(1 / 30, 120, 30)).toBe(1);
    expect(frameIndexAt(2, 120, 30)).toBe(60);
    expect(frameIndexAt(3.999, 120, 30)).toBe(119);
  });

  it('clamps past either end, and reports an empty track', () => {
    expect(frameIndexAt(-1, 120, 30)).toBe(0);
    expect(frameIndexAt(10, 120, 30)).toBe(119);
    expect(frameIndexAt(1, 0, 30)).toBe(-1);
  });
});

describe('frame tracks', () => {
  it('store an audio waveform as clamped 16-bit at half the bytes', () => {
    expect(frameBytes(1024, 'unit16')).toBe(2048);
    expect(frameBytes(1024, 'float32')).toBe(4096);
    const writer = createFrameTrackWriter({
      frameLength: 4,
      frameCount: 2,
      frameRate: 30,
      shape: 'array',
      encoding: 'unit16',
    });
    writer.push(new Float32Array([0, 0.5, -1, 1.7]));
    writer.push([Number.NaN, -0.25, 1, -3]);
    const track = writer.finish();
    expect(track.data).toBeInstanceOf(Int16Array);
    const analyser = new RecordedAnalyser(track, fixedClock(0));
    const first = Array.from(analyser.getValue() as Float32Array);
    // Within one 16-bit step of the input; out-of-range clamps like the painter.
    expect(first[0]).toBe(0);
    expect(first[1]).toBeCloseTo(0.5, 4);
    expect(first[2]).toBeCloseTo(-1, 4);
    expect(first[3]).toBeCloseTo(1, 4);
    const second = Array.from(
      new RecordedAnalyser(track, fixedClock(1 / 30)).getValue() as Float32Array,
    );
    expect(second[0]).toBe(0); // non-finite → silence
    expect(second[3]).toBeCloseTo(-1, 4);
  });

  it('store everything else exactly (frequency bins, control signals)', () => {
    const writer = createFrameTrackWriter({
      frameLength: 3,
      frameCount: 1,
      frameRate: 30,
      shape: 'array',
      encoding: 'float32',
    });
    writer.push([1955, -100, Number.NEGATIVE_INFINITY]);
    const value = new RecordedAnalyser(writer.finish(), fixedClock(0)).getValue();
    expect(Array.from(value as Float32Array)).toEqual([
      1955,
      -100,
      Number.NEGATIVE_INFINITY,
    ]);
  });

  it('return a number for a meter, as Tone.Meter does', () => {
    const writer = createFrameTrackWriter({
      frameLength: 1,
      frameCount: 2,
      frameRate: 2,
      shape: 'number',
      encoding: 'float32',
    });
    writer.push(-12.5);
    writer.push(-3);
    const track = writer.finish();
    expect(new RecordedAnalyser(track, fixedClock(0.2)).getValue()).toBe(-12.5);
    expect(new RecordedAnalyser(track, fixedClock(0.7)).getValue()).toBe(-3);
  });

  it('drop readings past the planned frames (memory stays bounded)', () => {
    const writer = createFrameTrackWriter({
      frameLength: 2,
      frameCount: 2,
      frameRate: 30,
      shape: 'array',
      encoding: 'float32',
    });
    for (let index = 0; index < 5; index++) writer.push([index, index]);
    const track = writer.finish();
    expect(track.frameCount).toBe(2);
    expect(track.data.length).toBe(4);
  });

  it('keep only the frames a short render wrote', () => {
    const writer = createFrameTrackWriter({
      frameLength: 2,
      frameCount: 10,
      frameRate: 30,
      shape: 'array',
      encoding: 'float32',
    });
    writer.push([1, 2]);
    const track = writer.finish();
    expect(track.frameCount).toBe(1);
    expect(track.data.length).toBe(2);
    // Any loop time then reads that one frame.
    expect(
      Array.from(new RecordedAnalyser(track, fixedClock(3)).getValue() as Float32Array),
    ).toEqual([1, 2]);
  });

  it('play the frame for the CURRENT loop time, on every read', () => {
    const writer = createFrameTrackWriter({
      frameLength: 1,
      frameCount: 4,
      frameRate: 1,
      shape: 'array',
      encoding: 'float32',
    });
    for (const value of [10, 20, 30, 40]) writer.push([value]);
    const manual = manualClock(4);
    const analyser = new RecordedAnalyser(writer.finish(), manual.clock);
    const read = () => (analyser.getValue() as Float32Array)[0];
    expect(read()).toBe(10);
    manual.set(2.5);
    expect(read()).toBe(30);
    manual.set(4.2); // looped
    expect(read()).toBe(10);
  });

  it('an empty recording reads as silence', () => {
    const empty = createFrameTrackWriter({
      frameLength: 3,
      frameCount: 0,
      frameRate: 30,
      shape: 'array',
      encoding: 'unit16',
    }).finish();
    expect(Array.from(new RecordedAnalyser(empty, fixedClock(1)).getValue() as Float32Array)).toEqual([0, 0, 0]);
    const emptyMeter = createFrameTrackWriter({
      frameLength: 1,
      frameCount: 0,
      frameRate: 30,
      shape: 'number',
      encoding: 'float32',
    }).finish();
    expect(new RecordedAnalyser(emptyMeter, fixedClock(1)).getValue()).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });

  it('is told apart from a live analyser, and disposes harmlessly', () => {
    const track = createFrameTrackWriter({
      frameLength: 1,
      frameCount: 1,
      frameRate: 30,
      shape: 'number',
      encoding: 'float32',
    }).finish();
    const analyser = new RecordedAnalyser(track, fixedClock(0));
    expect(isRecordedAnalyser(analyser)).toBe(true);
    expect(isRecordedAnalyser({ getValue: () => 0 })).toBe(false);
    expect(() => analyser.dispose()).not.toThrow();
  });
});

describe('planFrameBudget', () => {
  const options = { loopSeconds: 4, frameRate: 30, minFrameRate: 12, maxBytes: 8 * 1024 * 1024 };

  it('records everything at full rate when it fits', () => {
    // 20 waveform previews (2 KiB a frame): 20 × 2048 × 120 = 4.7 MiB.
    const plan = planFrameBudget(new Array(20).fill(2048), options);
    expect(plan.frameRate).toBe(30);
    expect(plan.recorded).toHaveLength(20);
  });

  it('lowers the frame rate before dropping anything', () => {
    // 50 × 2048 × 4 s = 400 KiB a frame-second → 20 fps fits in 8 MiB.
    const plan = planFrameBudget(new Array(50).fill(2048), options);
    expect(plan.frameRate).toBe(20);
    expect(plan.recorded).toHaveLength(50);
    expect(50 * 2048 * plan.frameRate * 4).toBeLessThanOrEqual(options.maxBytes);
  });

  it('at the lowest rate, keeps the tracks that fit and never exceeds the bound', () => {
    const perFrame = new Array(200).fill(2048);
    const plan = planFrameBudget(perFrame, options);
    expect(plan.frameRate).toBe(12);
    const bytes = plan.recorded.length * 2048 * 12 * 4;
    expect(bytes).toBeLessThanOrEqual(options.maxBytes);
    expect(plan.recorded.length).toBeLessThan(200);
    expect(plan.recorded[0]).toBe(0);
  });

  it('has nothing to plan for no tracks', () => {
    expect(planFrameBudget([], options)).toEqual({ frameRate: 30, recorded: [] });
  });
});

describe('playheadAt', () => {
  // 2 fps, the transport moving at real time from 10 s.
  const moving: PlayheadTrack = {
    frameRate: 2,
    playheads: new Float64Array([10, 10.5, 11, 11.5, 12]),
  };

  it('moves linearly between samples, as the live playhead does', () => {
    expect(playheadAt(moving, 0)).toBe(10);
    expect(playheadAt(moving, 0.25)).toBeCloseTo(10.25);
    expect(playheadAt(moving, 1.9)).toBeCloseTo(11.9);
  });

  it('holds the last sample at and past the end', () => {
    expect(playheadAt(moving, 2)).toBe(12);
    expect(playheadAt(moving, 5)).toBe(12);
  });

  it('never sweeps backwards across a document wrap', () => {
    const wrapping: PlayheadTrack = {
      frameRate: 2,
      playheads: new Float64Array([15.5, 0.0, 0.5]),
    };
    expect(playheadAt(wrapping, 0.25)).toBe(15.5);
    expect(playheadAt(wrapping, 0.75)).toBeCloseTo(0.25);
  });

  it('holds while the transport held (schedule headroom, ended)', () => {
    const held: PlayheadTrack = {
      frameRate: 2,
      playheads: new Float64Array([0, 0, 0.25]),
    };
    expect(playheadAt(held, 0.3)).toBe(0);
    expect(playheadAt(held, 0.75)).toBeCloseTo(0.125);
  });

  it('is 0 for an empty track', () => {
    expect(playheadAt({ frameRate: 30, playheads: new Float64Array(0) }, 1)).toBe(0);
  });
});

describe('createPlaybackTransport', () => {
  const track: PlayheadTrack = {
    frameRate: 1,
    playheads: new Float64Array([2, 3, 4, 5, 6]),
  };

  function make(withTrack = true) {
    const manual = manualClock(4);
    const transport = createPlaybackTransport({
      track: withTrack ? track : null,
      clock: manual.clock,
      getDurationSec: () => 16,
    });
    return { transport, manual };
  }

  it('starts playing a recording, looping its playhead', () => {
    const { transport, manual } = make();
    expect(transport.getState()).toBe('playing');
    expect(transport.getPlayheadTime()).toBe(2);
    manual.set(1.5);
    expect(transport.getPlayheadTime()).toBeCloseTo(3.5);
    manual.set(5.5); // second pass of the 4 s loop
    expect(transport.getPlayheadTime()).toBeCloseTo(3.5);
  });

  it('pause holds the playhead, play resumes the recording', () => {
    const { transport, manual } = make();
    const listener = vi.fn();
    transport.subscribe(listener);
    manual.set(1);
    transport.pause();
    expect(transport.getState()).toBe('paused');
    manual.set(3);
    expect(transport.getPlayheadTime()).toBe(3);
    transport.play();
    expect(transport.getState()).toBe('playing');
    expect(transport.getPlayheadTime()).toBe(5);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stop parks at 0; a scrub parks where it points (clamped)', () => {
    const { transport } = make();
    transport.stop();
    expect(transport.getState()).toBe('stopped');
    expect(transport.getPlayheadTime()).toBe(0);
    transport.scrub(7);
    expect(transport.getState()).toBe('stopped');
    expect(transport.getPlayheadTime()).toBe(7);
    transport.play();
    transport.scrub(99);
    expect(transport.getState()).toBe('paused');
    expect(transport.getPlayheadTime()).toBe(16);
    transport.scrub(Number.NaN);
    expect(transport.getPlayheadTime()).toBe(16);
  });

  it('with nothing recorded, stays stopped: there is nothing to play', () => {
    const { transport } = make(false);
    expect(transport.getState()).toBe('stopped');
    transport.play();
    expect(transport.getState()).toBe('stopped');
    expect(transport.getPlayheadTime()).toBe(0);
  });

  it('ignores edits and builds, and goes quiet once disposed', () => {
    const { transport } = make();
    const listener = vi.fn();
    const unsubscribe = transport.subscribe(listener);
    transport.notifyDocumentChanged();
    transport.notifyBuildEnded();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    transport.pause();
    expect(listener).not.toHaveBeenCalled();
    transport.dispose();
    transport.play();
    expect(transport.getState()).toBe('paused');
  });
});

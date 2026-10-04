/**
 * Gate edges must never share a timestamp.
 *
 * `currentTime` is quantised to the 128-sample render quantum, so every edge
 * produced inside one quantum arrives with the same clock reading. Web Audio
 * does not queue same-timestamp events — the later value wins and the earlier
 * one is unobservable. For an EDGE-triggered consumer that is not a timing
 * nudge, it is a lost transition: the struck string only strikes on
 * LOW->HIGH, so an annihilated release leaves the key held and silent.
 */

import { describe, expect, it } from 'vitest';
import {
  GATE_EDGE_SPACING_SAMPLES,
  nextGateEdgeTime,
} from '../audio/gateSchedule';

const SAMPLE_RATE = 48000;
const SPACING = GATE_EDGE_SPACING_SAMPLES / SAMPLE_RATE;

describe('nextGateEdgeTime', () => {
  it('hands the first edge the clock unchanged', () => {
    expect(nextGateEdgeTime(1.25, 0, SAMPLE_RATE)).toBe(1.25);
  });

  it('separates every edge of a burst inside ONE quantum', () => {
    // The whole bug in one test: press, release, press with the clock frozen,
    // which is what a fast retrigger looks like from JavaScript.
    const frozen = 1.25;
    let last = 0;
    const edges: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      last = nextGateEdgeTime(frozen, last, SAMPLE_RATE);
      edges.push(last);
    }
    expect(edges[0]).toBe(frozen);
    for (let i = 1; i < edges.length; i += 1) {
      expect(edges[i]).toBeGreaterThan(edges[i - 1]);
    }
    // Still inside the 2.7 ms quantum, so no audible lateness is introduced.
    expect(edges[edges.length - 1] - frozen).toBeLessThan(0.0027);
  });

  it('spaces consecutive edges by exactly the declared step', () => {
    const first = nextGateEdgeTime(2, 0, SAMPLE_RATE);
    const second = nextGateEdgeTime(2, first, SAMPLE_RATE);
    expect(second - first).toBeCloseTo(SPACING, 12);
  });

  it('does not run ahead once the clock overtakes the last edge', () => {
    // Spacing is a burst-local remedy, NOT a growing offset: a slow
    // performance must stay sample-accurate rather than drifting later.
    const last = nextGateEdgeTime(1, 0, SAMPLE_RATE);
    expect(nextGateEdgeTime(5, last, SAMPLE_RATE)).toBe(5);
  });

  it('never schedules in the past', () => {
    expect(nextGateEdgeTime(3, 0.5, SAMPLE_RATE)).toBe(3);
  });

  it('stays finite when the sample rate is unusable', () => {
    // A NaN timestamp would make the event unschedulable, turning a mistimed
    // gate into a gate that never arrives at all.
    for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const at = nextGateEdgeTime(1.5, 1.4, rate);
      expect(Number.isFinite(at)).toBe(true);
      expect(at).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('holds the invariant across a long random burst', () => {
    let last = 0;
    let clock = 0;
    for (let i = 0; i < 2000; i += 1) {
      // The clock only moves every ~21 edges — a dense roll on one key.
      if (i % 21 === 0) clock += 128 / SAMPLE_RATE;
      const at = nextGateEdgeTime(clock, last, SAMPLE_RATE);
      expect(at).toBeGreaterThan(last);
      expect(at).toBeGreaterThanOrEqual(clock);
      last = at;
    }
  });
});

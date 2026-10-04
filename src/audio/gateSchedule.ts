/**
 * Where a gate edge is allowed to land on the Web Audio timeline.
 *
 * THE PROBLEM. `AudioContext.currentTime` advances once per 128-sample
 * render quantum, so it reports the SAME number for ~2.7 ms at 48 kHz.
 * Scheduling every gate change at `currentTime` therefore hands identical
 * timestamps to every edge produced inside one quantum — and edges at a
 * single timestamp do not queue. The later value wins outright, and the
 * earlier one occupies a zero-width interval that no sample can observe.
 *
 * Measured in an OfflineAudioContext at 48 kHz, counting samples above 0.5
 * out of 48000:
 *
 *   setValueAtTime(1, T); setValueAtTime(0, T)            ->     0 samples
 *   setValueAtTime(1, T); setValueAtTime(0, T + 1/SR)     ->     1 sample
 *   ...(1,a); (0,T); (1,T)   [release then re-press]      -> 47760, never drops
 *
 * The third row is the damaging one. A release followed by a press inside
 * one quantum annihilates the 0, so an edge-triggered consumer — the
 * struck-string worklet, whose `lastGate` only strikes on a LOW->HIGH
 * transition — never sees the key let go. Its `lastGate` stays true, the
 * re-press raises no edge, and the note goes silent while the key still
 * reads as held. It recovers only when a later release happens to land in a
 * different quantum, which is exactly the reported "releasing and pressing
 * the key again brings it back".
 *
 * THE RULE. Every edge lands strictly after the previous edge on the SAME
 * key, and never before the present. `Math.max` against `currentTime` keeps
 * the spacing local to a burst: it cannot accumulate into drift across a
 * performance, because as soon as the clock overtakes the last edge the
 * spacing stops applying.
 *
 * Two samples rather than one: enough to survive a sample-rate mismatch
 * between the context and a worklet, while 42 us at 48 kHz is orders of
 * magnitude below any audible timing error.
 */

/** Sample steps between consecutive edges on one key. */
const GATE_EDGE_SPACING_SAMPLES = 2;

/**
 * The timestamp for the next gate edge on a key.
 *
 * @param currentTime  the context clock — quantised to the render quantum
 * @param lastEdgeTime the timestamp this key's previous edge was given, or 0
 * @param sampleRate   the context sample rate
 */
function nextGateEdgeTime(
  currentTime: number,
  lastEdgeTime: number,
  sampleRate: number,
): number {
  // A non-finite or absent rate must not poison the timeline with NaN, which
  // would make the param event unschedulable rather than merely mistimed.
  const spacing =
    sampleRate > 0 && Number.isFinite(sampleRate)
      ? GATE_EDGE_SPACING_SAMPLES / sampleRate
      : 0;
  return Math.max(currentTime, lastEdgeTime + spacing);
}

export { GATE_EDGE_SPACING_SAMPLES, nextGateEdgeTime };

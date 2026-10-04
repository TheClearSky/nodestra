/**
 * Guarantee the one precondition every score consumer assumes: that each
 * curve's points are ordered in time.
 *
 * WHY THE APP AND NOT THE SCHEMA. A score reaches the store from four
 * directions — a generator in `probeGraphs.ts`, a demo, an imported file, a
 * restored autosave — and only the importer validates. So "the generators are
 * fixed" (which they now are) protects exactly the scores that exist today; it
 * does nothing about the next generator, a hand-edited file, or a score
 * written by an older build. `replaceProject` is the single door every score
 * walks through, so enforcing it there covers all of them at once.
 *
 * WHAT GOES WRONG WITHOUT IT. Both plugin consumers index the array directly:
 * `evaluateCurve` binary-searches it (its own comment: "assumes points
 * strictly increasing in t") and the transport walks segments in array order.
 * Measured on an unsorted kick lane: the `Value` output was wrong at every
 * instant across the affected window, and the scheduled envelope decayed to
 * silence and then re-opened to 37 % amplitude for a further 225 ms.
 *
 * This only REORDERS. It never moves a point in time, merges points, or drops
 * one — so it cannot quietly change a score that was already well-formed, and
 * for a malformed one it produces the reading every consumer was already
 * assuming.
 */

import type { TimelineDocument } from '@theclearsky/react-blender-nodes-timeline';

type Curve = TimelineDocument['curves'][number];

function isSorted(curve: Curve): boolean {
  for (let index = 1; index < curve.points.length; index += 1) {
    if (curve.points[index].t < curve.points[index - 1].t) return false;
  }
  return true;
}

function normaliseTimelineDocument(
  document: TimelineDocument,
): TimelineDocument {
  // The overwhelmingly common case: already sorted. Return the SAME object so
  // the store's identity check stays a no-op and nothing downstream re-renders
  // or re-schedules for a document that did not change.
  if (document.curves.every(isSorted)) return document;

  return {
    ...document,
    curves: document.curves.map((curve) =>
      isSorted(curve)
        ? curve
        : {
            ...curve,
            // `sort` is stable, so points that genuinely share an instant keep
            // their authored order.
            points: [...curve.points].sort((left, right) => left.t - right.t),
          },
    ),
  };
}

export { normaliseTimelineDocument };

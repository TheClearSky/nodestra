import { describe, expect, it } from 'vitest';
import { normaliseTimelineDocument } from '../project/normaliseTimelineDocument';
import { demoTimelineDocuments } from '../soundDefinitions/probeGraphs';
import type { TimelineDocument } from '@theclearsky/react-blender-nodes-timeline';

const point = (t: number, v: number) => ({
  t,
  v,
  leftInterp: 'linear' as const,
  rightInterp: 'linear' as const,
});

const documentWith = (points: { t: number; v: number }[]) =>
  ({
    version: 1,
    durationSec: 20,
    loop: true,
    curves: [
      {
        id: 'crv_test',
        name: 'test',
        color: '#ffffff',
        defaultValue: 0,
        points,
      },
    ],
  }) as unknown as TimelineDocument;

describe('normaliseTimelineDocument', () => {
  it('orders a curve whose tail was written past the next hit', () => {
    // The real Bell Club kick shape: tail ends at 5.4880, next attack 5.4135.
    const result = normaliseTimelineDocument(
      documentWith([
        point(5.1879, 0.82),
        point(5.2479, 0.4),
        point(5.4879, 0),
        point(5.4135, 0.95),
        point(5.4735, 0.4),
      ]),
    );
    expect(result.curves[0].points.map((p) => p.t)).toEqual([
      5.1879, 5.2479, 5.4135, 5.4735, 5.4879,
    ]);
  });

  it('returns the SAME object when nothing needed moving', () => {
    // Identity matters: the store compares by reference, so re-wrapping an
    // already-good document would make every install look like a change.
    const document = documentWith([point(0, 0), point(1, 1), point(2, 0)]);
    expect(normaliseTimelineDocument(document)).toBe(document);
  });

  it('leaves every shipped demo score untouched — they are already sorted', () => {
    for (const [id, document] of Object.entries(demoTimelineDocuments)) {
      expect(
        normaliseTimelineDocument(document),
        `${id} should not need normalising`,
      ).toBe(document);
    }
  });

  it('only REORDERS — it never moves, merges or drops a point', () => {
    const before = [point(3, 0.3), point(1, 0.1), point(2, 0.2)];
    const after = normaliseTimelineDocument(documentWith(before)).curves[0]
      .points;
    expect(after).toHaveLength(3);
    expect([...after].sort((a, b) => a.v - b.v)).toEqual(
      [...before].sort((a, b) => a.v - b.v),
    );
  });

  it('is stable for points that genuinely share an instant', () => {
    const result = normaliseTimelineDocument(
      documentWith([point(1, 0.9), point(0, 0), point(0, 0.7)]),
    );
    // The two t=0 points keep their authored order relative to each other.
    expect(result.curves[0].points.map((p) => p.v)).toEqual([0, 0.7, 0.9]);
  });

  it('touches only the curves that need it', () => {
    const document = {
      version: 1,
      durationSec: 20,
      loop: true,
      curves: [
        { id: 'a', name: 'a', color: '#fff', defaultValue: 0, points: [point(0, 0), point(1, 1)] },
        { id: 'b', name: 'b', color: '#fff', defaultValue: 0, points: [point(2, 0), point(1, 1)] },
      ],
    } as unknown as TimelineDocument;
    const result = normaliseTimelineDocument(document);
    expect(result.curves[0]).toBe(document.curves[0]); // untouched
    expect(result.curves[1]).not.toBe(document.curves[1]); // reordered
    expect(result.curves[1].points.map((p) => p.t)).toEqual([1, 2]);
  });
});

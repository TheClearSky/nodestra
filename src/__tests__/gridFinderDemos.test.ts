/**
 * The Grid finder on the real demo scores (plan timeline-grid-finder.md).
 * Several demos' tempos are known from their lengths (bellClub 21.654 s =
 * 48 beats at 133, neonDrop 21.818 s = 48 at 132, starryNight 45.176 s = 64
 * at 85) — the finder must at least OFFER each, and put it first where the
 * evidence is clear.
 */
import { describe, expect, it } from 'vitest';
import {
  collectEventTimes,
  findTempoCandidates,
  findValueGridCandidates,
} from '@theclearsky/react-blender-nodes-timeline';
import type { TimelineDocument } from '@theclearsky/react-blender-nodes-timeline';
import { demoTimelineDocuments } from '../soundDefinitions/probeGraphs';

function demo(name: string): TimelineDocument {
  const entry = (demoTimelineDocuments as Record<string, unknown>)[name];
  return (typeof entry === 'function' ? entry() : entry) as TimelineDocument;
}

const tempos = (name: string) =>
  findTempoCandidates(collectEventTimes(demo(name))).map((candidate) => candidate.bpm);

describe('grid finder on the demos', () => {
  it('puts the known tempo first on every demo whose tempo is known', () => {
    expect(tempos('curveOrchestra')[0]).toBe(120);
    expect(tempos('bellClub')[0]).toBe(133);
    expect(tempos('neonDrop')[0]).toBe(132);
    // 170 and 85 draw the same lines at double/half speed; both are offered.
    expect([170, 85]).toContain(tempos('filterRush')[0]);
    expect([170, 85]).toContain(tempos('starryNight')[0]);
    expect(tempos('starryNight').slice(0, 3)).toContain(85);
  });

  it('reads every Hz lane of the orchestra as notes, A4 = 440', () => {
    const document = demo('curveOrchestra');
    const melody = document.curves.find((curve) => curve.name === 'melody Hz');
    const [best] = findValueGridCandidates(melody!.points.map((point) => point.v));
    expect(best.grid).toEqual({ kind: 'pitch', a4: 440 });
    expect(best.hits).toBe(best.total);
  });
});

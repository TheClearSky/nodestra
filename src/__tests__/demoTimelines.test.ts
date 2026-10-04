/**
 * Every toolbar demo that ships a timeline score must (a) parse against the
 * plugin's document schema — strictly increasing point times ≥ 1 ms apart,
 * finite values, duration ≥ the last point, unique curve ids — and (b) have
 * a graph whose Timeline Curve nodes reference curves that exist in that
 * score. A typo in either silently plays a constant-0 lane in the app.
 */

import { describe, expect, it } from 'vitest';
import { parseTimelineDocument } from '@theclearsky/react-blender-nodes-timeline';
import { exportGraphState } from '@theclearsky/react-blender-nodes';
import {
  demoTimelineDocuments,
  probeGraphBuilders,
} from '../soundDefinitions/probeGraphs';
import { deserializeProject } from '../appPersistence';

const scoredDemos = Object.keys(demoTimelineDocuments);

/**
 * CLOSED 2026-09-19 (Deepak's ruling: fix the generators AND normalise on
 * install). From 2026-09-06 to then, `bellClub` and `neonDrop` were exempt
 * from the ordering rule: their percussion decay tails were written as
 * `hit + tail` and outlived the gap to the next hit, so the point lists were
 * not time-sorted. That was never cosmetic — measured, every affected kick
 * decayed to silence in 14 ms and then re-opened to 37 % amplitude for a
 * further 225 ms, because both consumers assume a sorted array.
 *
 * `percussionTailEnd` in `probeGraphs.ts` now clamps each tail to the next
 * hit, and the allowlist is EMPTY. It stays here, empty and asserted, so that
 * re-introducing an unsorted score is a test failure rather than a new
 * exemption.
 */
const PENDING_ORDERING_FIX = new Set<string>([]);
const ORDERING_RULE = 'points must be strictly increasing in t';

function schemaIssues(id: string): { message: string }[] {
  try {
    parseTimelineDocument(demoTimelineDocuments[id]);
    return [];
  } catch (error) {
    // parseTimelineDocument throws with the zod issue list as JSON.
    return JSON.parse((error as Error).message) as { message: string }[];
  }
}

describe('demo timeline scores', () => {
  it('ships at least the orchestras', () => {
    expect(scoredDemos).toEqual(
      expect.arrayContaining(['curveOrchestra', 'starryNight']),
    );
  });

  it.each(scoredDemos)('%s parses against the plugin schema', (id) => {
    const issues = schemaIssues(id);
    const tolerated = PENDING_ORDERING_FIX.has(id)
      ? issues.filter((issue) => issue.message.startsWith(ORDERING_RULE))
      : [];
    const remaining = issues.filter((issue) => !tolerated.includes(issue));
    // Surfaces curve index → point index → rule, not just "threw".
    expect(remaining, `${id}: ${JSON.stringify(remaining, null, 2)}`).toEqual(
      [],
    );
    if (PENDING_ORDERING_FIX.has(id)) {
      // The exception must still be EARNED: drop the allowlist entry once
      // the score is sorted.
      expect(tolerated.length).toBeGreaterThan(0);
    }
    expect(demoTimelineDocuments[id].loop).toBe(true);
  });

  // The gate above pins the SCORE. This one pins the thing that actually bit:
  // a score the app is happy to PLAY must also survive being SAVED and READ
  // BACK, because the autosave is an import in all but name. Before
  // `parseProjectTimeline` split the score from the graph, a Bell Club session
  // was destroyed by its own autosave: the restore rejected the file, the app
  // booted a different demo, and the 800 ms autosave overwrote the original.
  it.each(scoredDemos)('%s survives a project save → restore', (id) => {
    const file = JSON.stringify({
      version: 1,
      graph: exportGraphState(probeGraphBuilders[id]()),
      timeline: demoTimelineDocuments[id],
    });
    const outcome = deserializeProject(file);
    // The GRAPH always survives — a score can no longer veto the project.
    expect(
      outcome.state,
      `${id} did not restore: ${outcome.issues.join(' | ')}`,
    ).toBeDefined();
    // EVERY demo keeps its music. Degrading to an empty document would hand
    // the user a project that loads and plays nothing.
    expect(outcome.timelineDocument?.curves.map((curve) => curve.id)).toEqual(
      demoTimelineDocuments[id].curves.map((curve) => curve.id),
    );
    // Tolerating the ordering rule must stay EARNED and must stay NOISY.
    expect(outcome.issues.length > 0).toBe(PENDING_ORDERING_FIX.has(id));
  });

  it('EVERY shipped score is time-sorted — no exemptions left', () => {
    const violations: string[] = [];
    for (const id of scoredDemos) {
      for (const curve of demoTimelineDocuments[id].curves) {
        for (let index = 1; index < curve.points.length; index += 1) {
          const delta = curve.points[index].t - curve.points[index - 1].t;
          if (delta < 0.001) {
            violations.push(
              `${id}/${curve.id}[${index}] Δt=${delta.toFixed(6)}`,
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
    expect(PENDING_ORDERING_FIX.size, 'the allowlist must stay empty').toBe(0);
  });

  it('a score whose ramp slope would overflow is REFUSED — the hazard that is real', () => {
    // A positive but sub-denormal Δt survives every "is it sorted" test and
    // overflows `(Δv / Δt)` in the transport's pure-linear branch, which has
    // no clamp: the scheduled value becomes NaN/Infinity.
    const document = structuredClone(
      demoTimelineDocuments.curveOrchestra,
    ) as unknown as { curves: { points: { t: number; v: number }[] }[] };
    document.curves[0].points[0].t = 0;
    document.curves[0].points[0].v = 0;
    document.curves[0].points[1].t = 5e-324;
    document.curves[0].points[1].v = 1;
    const outcome = deserializeProject(
      JSON.stringify({
        version: 1,
        graph: exportGraphState(probeGraphBuilders.curveOrchestra()),
        timeline: document,
      }),
    );
    // The GRAPH still survives — a bad score must never destroy the project.
    expect(outcome.state).toBeDefined();
    expect(outcome.timelineDocument?.curves).toEqual([]);
    expect(outcome.issues.length).toBeGreaterThan(0);
  });

  it('a score failing a SAFETY rule still degrades to empty — only ordering is tolerated', () => {
    const document = structuredClone(
      demoTimelineDocuments.curveOrchestra,
    ) as unknown as { curves: { id: string; color: string }[] };
    document.curves[0].color = 'not-a-hex-colour';
    const outcome = deserializeProject(
      JSON.stringify({
        version: 1,
        graph: exportGraphState(probeGraphBuilders.curveOrchestra()),
        timeline: document,
      }),
    );
    // The GRAPH still survives — a bad score must never destroy the project.
    expect(outcome.state).toBeDefined();
    expect(outcome.timelineDocument?.curves).toEqual([]);
    expect(outcome.issues.length).toBeGreaterThan(0);
  });

  it.each(scoredDemos)(
    '%s graph references only curves the score defines',
    (id) => {
      const state = probeGraphBuilders[id]();
      const curveIds = new Set(
        demoTimelineDocuments[id].curves.map((curve) => curve.id),
      );
      const referenced = state.nodes
        .filter((node) => node.data.nodeTypeUniqueId === 'timelineCurve')
        .map((node) => {
          const input = (node.data.inputs ?? []).find(
            (candidate) => candidate.name === 'Curve',
          );
          // Panels carry no value; the picker input does (a curve ref).
          const value = (input as { value?: unknown } | undefined)?.value;
          return (value as { curveId?: string } | undefined)?.curveId;
        });
      expect(referenced.length).toBeGreaterThan(0);
      for (const curveId of referenced) {
        expect(curveId).toBeDefined();
        expect(curveIds.has(curveId as string)).toBe(true);
      }
    },
  );
});

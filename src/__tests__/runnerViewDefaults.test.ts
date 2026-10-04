import { describe, expect, it } from 'vitest';
import type { RunnerViewPreferences } from '@theclearsky/react-blender-nodes';
import {
  SOUND_RUNNER_VIEW_PREFERENCES,
  withSoundRunnerDefaults,
} from '../runnerViewDefaults';
import { initialSoundState } from '../soundDefinitions/demoState';
import { buildProbeGraphState } from '../soundDefinitions/probeGraphs';

// The user's ruling (2026-09-18): the LIBRARY keeps Auto-scroll / Follow groups
// ON by default; THIS APP turns them off by seeding the persisted document field.

describe('withSoundRunnerDefaults', () => {
  it('seeds both preferences OFF when the document carries no field', () => {
    const seeded = withSoundRunnerDefaults(
      {} as { runnerViewPreferences?: RunnerViewPreferences },
    );
    expect(seeded.runnerViewPreferences).toEqual({
      autoScroll: false,
      followIntoGroups: false,
    });
    expect(SOUND_RUNNER_VIEW_PREFERENCES).toEqual({
      autoScroll: false,
      followIntoGroups: false,
    });
  });

  it('never hands out the shared frozen object (a later toggle must not mutate the default)', () => {
    const seeded = withSoundRunnerDefaults(
      {} as { runnerViewPreferences?: RunnerViewPreferences },
    );
    expect(seeded.runnerViewPreferences).not.toBe(
      SOUND_RUNNER_VIEW_PREFERENCES,
    );
    expect(Object.isFrozen(SOUND_RUNNER_VIEW_PREFERENCES)).toBe(true);
  });

  it("returns a document that already carries the field UNTOUCHED, identity included (the user's own toggle wins)", () => {
    const document = {
      runnerViewPreferences: { autoScroll: true, followIntoGroups: false },
    };
    expect(withSoundRunnerDefaults(document)).toBe(document);
  });

  it('applies to the states the app installs: the starter and a probe graph read OFF/OFF', () => {
    for (const state of [
      withSoundRunnerDefaults(initialSoundState),
      withSoundRunnerDefaults(buildProbeGraphState('curveOrchestra')),
    ]) {
      expect(state.runnerViewPreferences).toEqual({
        autoScroll: false,
        followIntoGroups: false,
      });
    }
  });

  it('does not seed the builders themselves — the seed happens at the app boundary', () => {
    // If a demo builder ever ships the field, the seed must not clobber it;
    // pin that today none do, so the boundary seed is what the user sees.
    expect(initialSoundState.runnerViewPreferences).toBeUndefined();
    expect(
      buildProbeGraphState('curveOrchestra').runnerViewPreferences,
    ).toBeUndefined();
  });
});

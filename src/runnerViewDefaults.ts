import type { RunnerViewPreferences } from '@theclearsky/react-blender-nodes';

/**
 * THIS APP's runner-panel defaults: Auto-scroll and Follow groups OFF.
 *
 * The host library defaults both ON and the user ruled that the LIBRARY must
 * stay that way ("dont do that. make it false from sound app", 2026-09-18).
 * `runnerViewPreferences` is a persisted, document-level field the host reads
 * per-field, so the app gets its own default by SEEDING the field on every
 * document it installs — boot state, demo picker, probe graphs, imports —
 * whenever the document does not already carry one. A document that does
 * carry the field (the user toggled a checkbox and it autosaved / was
 * exported) is returned untouched, identity included.
 */
const SOUND_RUNNER_VIEW_PREFERENCES: Readonly<RunnerViewPreferences> =
  Object.freeze({ autoScroll: false, followIntoGroups: false });

function withSoundRunnerDefaults<
  DocumentState extends { runnerViewPreferences?: RunnerViewPreferences },
>(state: DocumentState): DocumentState {
  if (state.runnerViewPreferences !== undefined) return state;
  return {
    ...state,
    runnerViewPreferences: { ...SOUND_RUNNER_VIEW_PREFERENCES },
  };
}

export { SOUND_RUNNER_VIEW_PREFERENCES, withSoundRunnerDefaults };

import { createProgressStore } from '@theclearsky/easy-tutorial-builder';
import type { KitTutorial } from '@theclearsky/easy-tutorial-builder';
import { parseTutorial } from '@theclearsky/easy-tutorial-builder/schema';
import { tutorialKit } from './kit';
import openPianoDemo from './open-piano-demo.json';
import { STORAGE_NAMESPACE } from '../storageNamespace';

/**
 * The tutorials that ship with the app. Each is a JSON script validated
 * against the app's kit — the same check a script from a docs link gets. A
 * bundled script that fails is a build-time bug (the unit test catches it),
 * so here it is simply left out rather than crashing the app.
 */

type AppTutorial = KitTutorial<typeof tutorialKit>;

const bundled: unknown[] = [openPianoDemo];

const tutorials: readonly AppTutorial[] = bundled.flatMap((script) => {
  const parsed = parseTutorial(tutorialKit, script);
  if (parsed.ok) return [parsed.tutorial];
  console.error('[tutorials] a bundled tutorial is invalid', parsed.issues);
  return [];
});

const tutorialProgress = createProgressStore(
  typeof localStorage === 'undefined' ? null : localStorage,
  `${STORAGE_NAMESPACE}.tutorials`,
);

const FIRST_TUTORIAL_ID = 'open-piano-demo';

export { FIRST_TUTORIAL_ID, tutorialProgress, tutorials };
export type { AppTutorial };

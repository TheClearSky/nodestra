/**
 * The hellscape's finish — Anime finish (default) or Painted cel — as the
 * visitor last picked it (2026-10-11, Deepak: "retain the cell painted and
 * anime choice on synth page"). Kept here, outside the hellscape's own
 * chunk, so the gate can show and remember it without loading the scene.
 */
import { STORAGE_NAMESPACE } from '../storageNamespace';

type HellFinishChoice = 'anime' | 'painted';

const FINISH_KEY = `${STORAGE_NAMESPACE}.landing.hellFinish`;

const HELL_FINISH_CHOICES: { id: HellFinishChoice; label: string }[] = [
  { id: 'anime', label: 'Anime finish' },
  { id: 'painted', label: 'Painted cel' },
];

function loadHellFinish(): HellFinishChoice {
  try {
    return localStorage.getItem(FINISH_KEY) === 'painted' ? 'painted' : 'anime';
  } catch {
    return 'anime';
  }
}

function saveHellFinish(finish: HellFinishChoice): void {
  try {
    localStorage.setItem(FINISH_KEY, finish);
  } catch {
    // Remembering is a convenience only.
  }
}

export { HELL_FINISH_CHOICES, loadHellFinish, saveHellFinish };
export type { HellFinishChoice };

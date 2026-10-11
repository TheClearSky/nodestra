/**
 * The landing's hellscape (2026-10-11): the castle in the hellscape, the
 * drone flight onto its roof and the Vampire Synth there — the 4th scene,
 * beside the piano stage and the two meadows. It shares their API
 * (`setLive`, `setLiveKey`, `renderNow`, `resize`, `dispose`) and adds the
 * auto demo (`playDemo` / `stopDemo`).
 *
 * `hell-src/` and `env-src/` are COPIES of the experiment sources under
 * `.claude/pages/ad/experiments/` (`node scripts/sync-hell.mjs` refreshes
 * them and the demo's files in `public/landing/hell/`); edit there, where the
 * experiment pages can show the change, then sync.
 */
import { createHellScene } from './hell-src/hell-stage';
import type { HellFinish, HellScene } from './hell-src/hell-stage';

/** The demo's recording and the notes that press the synth's keys. */
const HELL_DEMO = {
  audio: `${import.meta.env.BASE_URL}landing/hell/vampire-c2.mp3`,
  notes: `${import.meta.env.BASE_URL}landing/hell/vampire-c2-notes.json`,
};

function createHellStage(
  canvas: HTMLCanvasElement,
  options: { reducedMotion: boolean; finish: HellFinish; onDemoChange(playing: boolean): void },
): HellScene {
  return createHellScene(canvas, { ...options, demo: HELL_DEMO });
}

export { createHellStage };
export type { HellFinish, HellScene };

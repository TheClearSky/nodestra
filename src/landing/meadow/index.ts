/**
 * The landing's meadow scenes (2026-10-04): the guitar under the oak and the
 * sakura. Both share the stage's API — `setLive(true)` tours the camera in,
 * `setLive(false)` backs it off, `setLiveKey` follows the keyboard.
 *
 * `env/` and `gtr-*.ts` are COPIES of the experiment sources under
 * `.claude/pages/ad/experiments/` (`npm run sync:meadow` refreshes them); edit
 * there, where the experiment pages can show the change, then sync.
 */
import { createGuitarScene } from './env/scene-guitar-stage';
import type { InstrumentScene, SceneOptions } from './env/scene-guitar-stage';
import { createSakuraScene } from './env/scene-sakura-stage';

type MeadowKind = 'guitar' | 'sakura';
type MeadowScene = InstrumentScene;

function createMeadowScene(kind: MeadowKind, canvas: HTMLCanvasElement, options: SceneOptions): MeadowScene {
  return kind === 'guitar' ? createGuitarScene(canvas, options) : createSakuraScene(canvas, options);
}

export { createMeadowScene };
export type { MeadowKind, MeadowScene };

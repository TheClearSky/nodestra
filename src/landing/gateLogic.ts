/**
 * The start gate's plain logic (`StageLanding.tsx`), kept free of React,
 * three.js and the DOM so it can be tested on its own.
 */
import { KEY_ORDER } from '../audio/keyMap';
import type { KeyName } from '../audio/keyMap';

/** The short-screen layout (a phone on its side). It is the same query as
 *  every `[@media(max-height:520px)]` class in the gate: one definition of
 *  "short" (≤ 520 px) for the script and the styles. */
const SHORT_SCREEN = '(max-height: 520px)';

/** How long a meadow's chunk may take to arrive before its scene counts as
 *  failed (a stalled network). The switch then ends, the scene says it
 *  could not be drawn, and its instrument still plays. */
const MEADOW_LOAD_TIMEOUT_MS = 10_000;

/** A white key's width: the keys fill a phone's width (16 px gutters), stay
 *  34 px on a desktop and 44 px on touch, and never go under 24 px. */
function keyWidthFor(viewportWidth: number, touch: boolean): number {
  return Math.max(24, Math.min(touch ? 44 : 34, Math.floor((viewportWidth - 32) / 10)));
}

/** A white key's height: the piano's proportions, shorter on a short screen. */
function keyHeightFor(keyWidth: number, short: boolean): number {
  return Math.round(Math.min(keyWidth * (92 / 34), short ? 64 : 120));
}

/** A `data-piano-key` value that names a key (the DOM is not typed). */
function isKeyName(value: string | undefined): value is KeyName {
  return value !== undefined && (KEY_ORDER as readonly string[]).includes(value);
}

/** Whether a scene is up: the piano always is; a meadow once it has drawn,
 *  or once it is known that it cannot be drawn (it failed, or there is no
 *  WebGL at all), so a switch to it always ends. */
function isSceneReady<Scene extends string>(state: {
  scene: Scene | 'piano';
  webglFailed: boolean;
  meadowReady: Scene | null;
  meadowFailed: Scene | null;
}): boolean {
  const { scene } = state;
  return scene === 'piano' || state.webglFailed || state.meadowReady === scene || state.meadowFailed === scene;
}

/**
 * One try at making a scene that loads its code asynchronously (a meadow):
 *
 *  1. `load` fetches the code. If it has not arrived within `timeoutMs`, the
 *     try fails, and code that arrives later is not used.
 *  2. `create` makes the scene from it.
 *  3. `prepare` sizes it and draws its first frames; it settles once they are
 *     on screen.
 *
 * Exactly one of `onReady` / `onFailed` is called, unless the try is
 * cancelled first. A scene that throws while it is made or prepared is
 * released at once (its GL context, its observers): nothing half-made is
 * kept. `cancel()` stops the try and releases its scene, ready or not.
 */
function attemptScene<Loaded, Scene>(steps: {
  load(): Promise<Loaded>;
  create(loaded: Loaded): Scene;
  prepare(scene: Scene): Promise<void>;
  release(scene: Scene): void;
  timeoutMs: number;
  onReady(scene: Scene): void;
  onFailed(error: unknown): void;
}): { cancel(): void } {
  let done = false;
  let made: Scene | null = null;
  const release = () => {
    const scene = made;
    made = null;
    if (scene === null) return;
    try {
      steps.release(scene);
    } catch (error) {
      console.error('[landing] a scene could not be released', error);
    }
  };
  const fail = (error: unknown) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    release();
    steps.onFailed(error);
  };
  const timer = setTimeout(
    () => fail(new Error(`the scene's code did not arrive within ${steps.timeoutMs / 1000} s`)),
    steps.timeoutMs,
  );
  steps
    .load()
    .then((loaded) => {
      if (done) return undefined;
      // The code is here: what follows runs on this device, not the network.
      clearTimeout(timer);
      const scene = steps.create(loaded);
      made = scene;
      return steps.prepare(scene).then(() => {
        if (done) return;
        done = true;
        steps.onReady(scene);
      });
    })
    .catch((error: unknown) => {
      if (done) {
        // Cancelled meanwhile, or `onReady` itself threw: there is nothing
        // left to settle, but nothing is swallowed either.
        console.error('[landing] a scene failed after its try had ended', error);
        return;
      }
      fail(error);
    });
  return {
    cancel() {
      done = true;
      clearTimeout(timer);
      release();
    },
  };
}

export { attemptScene, isKeyName, isSceneReady, keyHeightFor, keyWidthFor, MEADOW_LOAD_TIMEOUT_MS, SHORT_SCREEN };

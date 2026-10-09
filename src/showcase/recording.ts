/**
 * The hand-off between a showcase frame and the App it runs.
 *
 * A showcase can never start live audio (browsers need a click), so in
 * showcase mode the App records instead: it renders the open graph silently
 * ahead of time and plays the recording back into its own previews and
 * timeline playhead (`.claude/plans/live-landing.md`, stage 2). The App
 * registers how; the frame asks for it once the scene is set up, and reports
 * the scene ready when the recording plays.
 */

/** How a scene records. `startAt`: where the score starts playing (seconds),
 *  so a scene can show the same stretch of the score as its approved look. */
type SceneRecordingOptions = { startAt?: number };

type SceneRecorder = (options: SceneRecordingOptions) => Promise<void>;

let recorder: SceneRecorder | null = null;

/** The App, in showcase mode: "this is how to record the open graph". */
function registerSceneRecorder(next: SceneRecorder): () => void {
  recorder = next;
  return () => {
    if (recorder === next) recorder = null;
  };
}

/** The frame, after the scene's steps: record and start playback. A scene
 *  with nothing to record (no graph open) resolves at once. */
async function recordScene(options: SceneRecordingOptions = {}): Promise<void> {
  await recorder?.(options);
}

export { recordScene, registerSceneRecorder };
export type { SceneRecorder, SceneRecordingOptions };

/**
 * Replacing the project is ONE transaction, with one writer.
 *
 * A "project" in this app is five pieces of state owned by four subsystems:
 * the graph (host reducer), the score (timeline plugin store), the live audio
 * build (`audioSystem`), the execution record (host runner, controlled by us)
 * and the run-freshness bookkeeping that drives auto-run. Before this existed
 * there were four places that replaced a project — the demo menu, the file
 * picker, the dev import handle and the probe loader — and each wrote a
 * DIFFERENT subset:
 *
 * | site            | graph | score | build | record | keys |
 * | --------------- | ----- | ----- | ----- | ------ | ---- |
 * | loadDemo        |  ✓    |  ✓    |  ✗    |  ✗     |  ✗   |
 * | file picker     |  ✓    |  ✓    |  ✗    |  ✗     |  ✗   |
 * | __importProject |  ✓    |  ✓    |  ✗    |  ✗     |  ✗   |
 * | __probe         |  ✓    |  ✗    |  ✗    |  ✗     |  ✗   |
 *
 * The consequences were all measured: the previous demo kept sounding
 * (unmodulated, because the transport zeroes drivers it cannot match) until
 * the next run; the runner panel, the timeline and every node preview went on
 * describing a project that was no longer loaded; and `__probe` left the
 * PREVIOUS demo's score installed, so every curve reference dangled and each
 * one logged a warning per run.
 *
 * ORDER IS THE CONTRACT. It is asserted by a unit test, because the thing a
 * human gets wrong on the fifth call site is the order, not the list.
 */

import type { TimelineDocument } from '@theclearsky/react-blender-nodes-timeline';
import type { GraphRunnerHandle } from '@theclearsky/react-blender-nodes';
import { normaliseTimelineDocument } from './normaliseTimelineDocument';

/** What the caller is installing. */
type ProjectReplacement<State> = {
  state: State;
  /** Always explicit — "the previous score stays" is never what a replace
   *  means, and leaving it implicit is exactly how `__probe` grew its bug. */
  timelineDocument: TimelineDocument;
  /**
   * `false` for probe graphs, which must NEVER reach the user's autosave.
   * Explicit rather than inherited: this transaction is the only door, so a
   * caller that forgets to say is a caller that silently overwrites the
   * user's project 800 ms later.
   */
  persist: boolean;
  /**
   * Keep `state.history` (undo/redo). ONLY for restoring a state this editor
   * produced itself — a tab switched back to — whose history describes it.
   */
  preserveHistory?: boolean;
};

/** Everything the transaction touches, injected so the ORDER can be tested. */
type ReplaceProjectDependencies<State, Action> = {
  dispatch: (action: Action) => void;
  makeReplaceStateAction: (state: State, preserveHistory: boolean) => Action;
  /** `null` when no runner is mounted — every step must tolerate that. */
  runner: GraphRunnerHandle | null;
  disposeBuild: () => void;
  stopTransport: () => void;
  releaseHeldKeys: () => void;
  applyTimelineDocument: (document: TimelineDocument) => void;
  suppressPersistence: () => void;
  /** Clears the app-side run bookkeeping that names the OLD project: the
   *  pending run signatures, the "already handled this errored record" guard,
   *  and the stamped freshness signature. */
  forgetRunBookkeeping: () => void;
};

function replaceProject<State, Action>(
  project: ProjectReplacement<State>,
  dependencies: ReplaceProjectDependencies<State, Action>,
): void {
  const {
    dispatch,
    makeReplaceStateAction,
    runner,
    disposeBuild,
    stopTransport,
    releaseHeldKeys,
    applyTimelineDocument,
    suppressPersistence,
    forgetRunBookkeeping,
  } = dependencies;

  // 1. Probe graphs opt out of persistence BEFORE anything can trigger a save.
  if (!project.persist) suppressPersistence();

  // 2. Abandon the run that is building the OLD project. `initiator:
  //    'consumer'` is load-bearing: the app switches auto-run off when the
  //    USER halts a run, and must not do that when it halts one itself.
  //    `reset()` rather than `stop()` — `stop()` lands the runner in
  //    'errored' with the old graph's node overlays painted over the new
  //    graph's ids, which is not an honest state for "I just loaded a demo".
  //    This synchronously emits run:aborted + run:reset, and the app's
  //    handler disposes the build on the way through.
  runner?.reset({ initiator: 'consumer' });

  // 3. Unconditional floor. Step 2 emits NOTHING when no run was in flight,
  //    and the previous project's audio is still live in exactly that case.
  //    Disposing twice is safe and deliberate (see `audioSystem.disposeBuild`,
  //    which records the killed run in a set rather than a slot).
  disposeBuild();

  // 4. Park the transport now that its driver set is empty — cancelling and
  //    re-anchoring over zero drivers costs nothing, whereas doing it after
  //    the new score is installed would schedule a full pass for a build that
  //    does not exist yet.
  stopTransport();

  // 5. A key held across the swap would otherwise release into a build that
  //    never attacked it.
  releaseHeldKeys();

  // 6. The graph. The only fallible step (the host validates and can refuse),
  //    so it goes before the score: a rejected graph must not leave the new
  //    score installed over the old graph.
  dispatch(makeReplaceStateAction(project.state, project.preserveHistory === true));

  // 7. The score — normalised, because this is the only door every score
  //    walks through and both plugin consumers index the point array directly.
  //    See `normaliseTimelineDocument`.
  applyTimelineDocument(normaliseTimelineDocument(project.timelineDocument));

  // 8. Nothing that names a run of the OLD project may survive it.
  forgetRunBookkeeping();
}

export { replaceProject };
export type { ProjectReplacement, ReplaceProjectDependencies };

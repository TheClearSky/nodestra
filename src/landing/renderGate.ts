/**
 * May a 3D scene draw right now? One answer for every scene (the piano
 * stage, Blip, the meadow scenes), from three independent reasons to stop:
 *
 *  - the owner paused it (`setPaused` — e.g. the stage while a meadow scene
 *    covers it);
 *  - the tab is hidden (browsers throttle a hidden tab's animation frames,
 *    not always to zero, and nobody sees them);
 *  - its canvas is out of the screen's view (Deepak, 2026-10-09: "when a 3d
 *    scene isn't in screen's view dont render it, save performance").
 *
 * The scene draws only when none applies. Out of view is an
 * IntersectionObserver with the IMPLICIT root — the top-level viewport —
 * which also clips a canvas inside a same-origin iframe (the landing tour's
 * stage, Blip in the showcase frames) by the frame's own position on the
 * page: a frame scrolled away stops its scene too.
 *
 * Until the observer's first report (the next rendering step) the canvas
 * counts as in view, so a scene created off screen still draws a frame or
 * two — which compiles its shaders before anyone scrolls to it.
 */

type RenderGate = {
  /** True while the scene may draw. */
  isOpen(): boolean;
  /** The owner's own stop (pause / resume). */
  setPaused(paused: boolean): void;
  /** Stop observing; the gate closes for good. */
  dispose(): void;
};

/**
 * `onChange` is called on every flip (never on creation: read `isOpen()`
 * then). On reopening, the scene must restart its frame clock — no catch-up
 * for the time it was stopped, and no jump.
 */
function createRenderGate(element: Element, onChange: (open: boolean) => void): RenderGate {
  let paused = false;
  let inView = true;
  let disposed = false;
  const compute = () => !disposed && !paused && !document.hidden && inView;
  let open = compute();
  const update = () => {
    const next = compute();
    if (next === open) return;
    open = next;
    onChange(open);
  };
  const observer =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver((entries) => {
          // Entries queue up between reports; the last one is current.
          inView = entries[entries.length - 1].isIntersecting;
          update();
        });
  observer?.observe(element);
  document.addEventListener('visibilitychange', update);
  return {
    isOpen: () => open,
    setPaused(next) {
      paused = next;
      update();
    },
    dispose() {
      disposed = true;
      observer?.disconnect();
      document.removeEventListener('visibilitychange', update);
      update();
    },
  };
}

export { createRenderGate };
export type { RenderGate };

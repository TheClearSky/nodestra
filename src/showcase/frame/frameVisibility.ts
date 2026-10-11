/**
 * Is this showcase frame seen right now? Its previews stop drawing while it
 * is not (`tapManager` 'offscreen'): a card scrolled away but still mounted,
 * a card under the "Try it" dialog's opaque backdrop, a tour screen mounted
 * ahead of its turn in a hidden panel.
 *
 * Three signals, any of which hides it:
 *   - the tab is hidden;
 *   - the frame's document is outside the page's viewport (an
 *     IntersectionObserver with the implicit root measures against the
 *     top-level viewport, through every frame between);
 *   - the iframe element, or a frame around it, is hidden by CSS
 *     (`visibility`, `display`, `opacity: 0`) — which an IntersectionObserver
 *     does not see. Same-origin frames can ask their element directly; this
 *     is checked twice a second.
 */

const CSS_CHECK_MS = 500;

/** True when every same-origin frame element from this window up to the top
 *  is rendered and visible. A cross-origin parent ends the walk (it cannot
 *  be asked; counted as visible). */
function framesShown(): boolean {
  let current: Window = window;
  while (current !== current.parent) {
    let element: Element | null;
    try {
      element = current.frameElement;
    } catch {
      return true;
    }
    if (!element) return true;
    const check = (element as Element & { checkVisibility?(options: object): boolean }).checkVisibility;
    if (check && !check.call(element, { visibilityProperty: true, opacityProperty: true })) return false;
    current = current.parent;
  }
  return true;
}

/** Calls `onChange(seen)` whenever the answer changes (and once at the start). */
function watchFrameVisibility(onChange: (seen: boolean) => void): () => void {
  let inView = true;
  let shown = framesShown();
  let last: boolean | null = null;
  const update = () => {
    const seen = !document.hidden && inView && shown;
    if (seen === last) return;
    last = seen;
    onChange(seen);
  };
  const observer =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          inView = entries[entries.length - 1].isIntersecting;
          update();
        })
      : null;
  observer?.observe(document.documentElement);
  const timer = window.setInterval(() => {
    shown = framesShown();
    update();
  }, CSS_CHECK_MS);
  document.addEventListener('visibilitychange', update);
  update();
  return () => {
    observer?.disconnect();
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', update);
  };
}

/** Resolves once the tab is visible (at once if it is). */
function whenTabVisible(): Promise<void> {
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', onChange);
      resolve();
    };
    document.addEventListener('visibilitychange', onChange);
  });
}

export { watchFrameVisibility, whenTabVisible };

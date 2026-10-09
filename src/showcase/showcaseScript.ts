/**
 * Steps that set a live showcase up after it mounts: open the add menu, enter
 * a node group, open the timeline drawer… The host has no API for some of
 * these (a drawer, the context menu, a plugin modal), so they are driven the
 * way a visitor would — through the component's own UI — always scoped to
 * the showcase's root, never the page.
 */

type ShowcaseContext = {
  root: HTMLElement;
  /** The showcase graph's own dispatch (host actions). */
  dispatch: (action: never) => void;
};

type ShowcaseStep = (context: ShowcaseContext) => void | Promise<void>;

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Waits until `find` returns an element (checked every frame). */
async function waitFor<T>(find: () => T | null | undefined, timeoutMs = 4000): Promise<T> {
  const start = performance.now();
  for (;;) {
    const found = find();
    if (found) return found;
    if (performance.now() - start > timeoutMs) throw new Error('[showcase] a setup step timed out');
    await frame();
  }
}

function wait(ms: number): ShowcaseStep {
  return () => new Promise((resolve) => setTimeout(resolve, ms));
}

/** Clicks the first element under the root matching `selector` (and, when
 *  given, whose text includes `text`). */
function click(selector: string, text?: string): ShowcaseStep {
  return async ({ root }) => {
    const target = await waitFor(() =>
      [...root.querySelectorAll<HTMLElement>(selector)].find((element) => text === undefined || element.textContent?.includes(text)),
    );
    target.click();
  };
}

/** Right-clicks the graph's empty pane at a point given as fractions of its size. */
function contextMenu(fx: number, fy: number): ShowcaseStep {
  return async ({ root }) => {
    const pane = await waitFor(() => root.querySelector<HTMLElement>('.react-flow__pane'));
    const box = pane.getBoundingClientRect();
    pane.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: box.left + box.width * fx,
        clientY: box.top + box.height * fy,
      }),
    );
  };
}

/** Hovers the menu row whose text is exactly `text` — anywhere in the
 *  showcase's document, because menus and submenus are portaled to its body.
 *  React derives onMouseEnter from a `mouseover` whose relatedTarget lies
 *  outside the element. */
function hover(text: string): ShowcaseStep {
  return async () => {
    const row = await waitFor(() =>
      [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((element) => element.textContent?.trim() === text && element.offsetParent !== null)
        .at(-1),
    );
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
  };
}

/** Sends a host action to the showcase's own graph. */
function dispatch(action: unknown): ShowcaseStep {
  return ({ dispatch: send }) => send(action as never);
}

/** Runs the steps in order. Each waits a frame first and is skipped once
 *  `cancelled()` — React's StrictMode mounts effects twice in development,
 *  and a toggle (open the drawer) run twice would close it again. */
async function runSteps(steps: readonly ShowcaseStep[], context: ShowcaseContext, cancelled: () => boolean) {
  for (const step of steps) {
    // Let React commit (and ReactFlow measure) between steps.
    await frame();
    await frame();
    if (cancelled()) return;
    await step(context);
  }
}

export { click, contextMenu, dispatch, hover, runSteps, wait, waitFor };
export type { ShowcaseContext, ShowcaseStep };

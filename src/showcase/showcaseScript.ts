/**
 * Steps that set a live showcase up after it mounts: open the add menu, enter
 * a node group, open the timeline drawer… The host has no API for some of
 * these (a drawer, the context menu, a plugin modal), so they are driven the
 * way a visitor would — through the component's own UI — always scoped to
 * the showcase's root, never the page.
 */

type ShowcaseContext = {
  /** Where the steps look (the showcase frame's body). */
  root: HTMLElement;
};

type ShowcaseStep = ((context: ShowcaseContext) => void | Promise<void>) & {
  /** Names the step in a failure ("step 4 (hover 'Solos')"). */
  label?: string;
};

function labelled(label: string, step: ShowcaseStep): ShowcaseStep {
  step.label = label;
  return step;
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** On screen, as a visitor could see it. Steps only ever act on these: right
 *  after a tab switch the previous tab's graph is briefly still in the
 *  document, and "the first .react-flow__pane" could be that one. */
function isVisible(element: Element): boolean {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
}

function firstVisible(root: ParentNode, selector: string, text?: string): Element | undefined {
  return [...root.querySelectorAll(selector)].find(
    (element) => isVisible(element) && (text === undefined || element.textContent?.includes(text)),
  );
}

/** A real click event — SVG icons have no `.click()` (only HTML elements do). */
function clickElement(target: Element) {
  if (target instanceof HTMLElement) target.click();
  else target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}

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
  return labelled(`wait ${ms}`, () => new Promise((resolve) => setTimeout(resolve, ms)));
}

/** Clicks the first element under the root matching `selector` (and, when
 *  given, whose text includes `text`). */
function click(selector: string, text?: string): ShowcaseStep {
  return labelled(`click ${selector}${text === undefined ? '' : ` '${text}'`}`, async ({ root }) => {
    const target = await waitFor(() => firstVisible(root, selector, text));
    clickElement(target);
  });
}

/** Clicks `selector` under the root if it is there now; otherwise nothing.
 *  For UI the app opens only sometimes (the Runner drawer after some demos). */
function clickIfPresent(selector: string): ShowcaseStep {
  return labelled(`click if present ${selector}`, ({ root }) => {
    const target = firstVisible(root, selector);
    if (target) clickElement(target);
  });
}

/** Points at `selector` the way a mouse arriving over it does — the full
 *  pointer/mouse over → enter → move sequence, at its centre — so hover
 *  cards and tooltips open. */
function pointAt(selector: string): ShowcaseStep {
  return labelled(`point at ${selector}`, async ({ root }) => {
    const target = await waitFor(() => firstVisible(root, selector));
    const box = target.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, view: window, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, relatedTarget: document.body };
    target.dispatchEvent(new PointerEvent('pointerover', { ...at, pointerType: 'mouse' }));
    target.dispatchEvent(new PointerEvent('pointerenter', { ...at, bubbles: false, pointerType: 'mouse' }));
    target.dispatchEvent(new MouseEvent('mouseover', at));
    target.dispatchEvent(new MouseEvent('mouseenter', { ...at, bubbles: false }));
    target.dispatchEvent(new PointerEvent('pointermove', { ...at, pointerType: 'mouse' }));
    target.dispatchEvent(new MouseEvent('mousemove', at));
  });
}

/** Waits until `selector` (with `text`, when given) is visible. */
function waitVisible(selector: string, text?: string): ShowcaseStep {
  return labelled(`wait for ${selector}${text === undefined ? '' : ` '${text}'`}`, async ({ root }) => {
    await waitFor(() => firstVisible(root, selector, text), 8000);
  });
}

/** Shows an element that only CSS `:hover` reveals (a node's ⓘ appears while
 *  the pointer is over its node) — a script cannot produce `:hover`, so this
 *  sets what the hover would: the element's display. */
function reveal(selector: string, display = 'inline-flex'): ShowcaseStep {
  return labelled(`reveal ${selector}`, async ({ root }) => {
    const target = await waitFor(() => root.querySelector<HTMLElement>(selector));
    target.style.display = display;
  });
}

/** Drops focus: a scripted click focuses a dialog's first control and draws
 *  the keyboard focus ring, which a visitor's mouse click would not. */
const blurActive: ShowcaseStep = labelled('blur', () => {
  (document.activeElement as HTMLElement | null)?.blur?.();
});

/** Right-clicks the graph's empty pane at a point given as fractions of its size. */
function contextMenu(fx: number, fy: number): ShowcaseStep {
  return labelled(`context menu at ${fx}, ${fy}`, async ({ root }) => {
    const pane = await waitFor(() => firstVisible(root, '.react-flow__pane'));
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
  });
}

/** Hovers the menu row whose text is exactly `text` — anywhere in the
 *  showcase's document, because menus and submenus are portaled to its body.
 *  React derives onMouseEnter from a `mouseover` whose relatedTarget lies
 *  outside the element. */
function hover(text: string): ShowcaseStep {
  return labelled(`hover '${text}'`, async () => {
    const row = await waitFor(() =>
      [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((element) => element.textContent?.trim() === text && element.offsetParent !== null)
        .at(-1),
    );
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
  });
}

/** Clicks the deepest visible element whose text starts with `text` —
 *  anywhere in the showcase's document (menu rows are portaled to its body).
 *  The click bubbles to the row's own handler, as a visitor's would. */
function clickText(text: string): ShowcaseStep {
  return labelled(`click text '${text}'`, async () => {
    const target = await waitFor(() =>
      [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((element) => element.textContent?.trim().startsWith(text) && element.offsetParent !== null)
        .at(-1),
    );
    clickElement(target);
  });
}

/** Runs the steps in order. Each waits a frame first and is skipped once
 *  `cancelled()` — React's StrictMode mounts effects twice in development,
 *  and a toggle (open the drawer) run twice would close it again. */
const DEBUG_STEPS = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug-steps');

async function runSteps(steps: readonly ShowcaseStep[], context: ShowcaseContext, cancelled: () => boolean) {
  for (const [index, step] of steps.entries()) {
    // Let React commit (and ReactFlow measure) between steps.
    await frame();
    await frame();
    if (cancelled()) return;
    try {
      await step(context);
      // `?debug-steps`: each step, as it completes (devtools, tests).
      if (DEBUG_STEPS) console.debug(`[showcase] step ${index} done: ${step.label ?? 'unnamed'}`);
    } catch (error) {
      throw new Error(`step ${index} (${step.label ?? 'unnamed'}) failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export { blurActive, click, clickIfPresent, clickText, contextMenu, hover, pointAt, reveal, runSteps, wait, waitFor, waitVisible };
export type { ShowcaseContext, ShowcaseStep };

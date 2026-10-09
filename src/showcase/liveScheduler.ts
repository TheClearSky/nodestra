/**
 * Who may be live right now.
 *
 * A live showcase is a real app component (the graph editor, the timeline…)
 * mounted on the landing page. Each costs real work — thousands of elements,
 * ReactFlow measuring — so the page keeps only a few at once: slots ASK to go
 * live when they scroll near, the scheduler GRANTS mounts one at a time in an
 * idle moment (never several in the same frame while the visitor scrolls),
 * most-visible first, and EVICTS the least-visible live slot when a more
 * visible one is waiting and the budget is full.
 *
 * Measured 2026-10-09 on an emulated phone (390x844, DPR 3, CPU /4): the old
 * landing — every screen and the tour mounted at once as iframes — ran its
 * hero at 2 fps; with nothing but the hero stage it ran at 39 fps.
 */

type LiveSlotHandle = {
  /** Higher goes live first and is evicted last (the slot's visible share). */
  priority(): number;
  mount(): void;
  unmount(): void;
};

/** How many showcases may be live at once on this device. */
function liveBudget(): number {
  const forced = Number(new URLSearchParams(location.search).get('live'));
  if (Number.isFinite(forced) && forced > 0) return forced;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const cores = nav.hardwareConcurrency ?? 8;
  const memory = nav.deviceMemory ?? 8;
  if (cores <= 4 || memory <= 4) return 1;
  if (coarse) return 2;
  return 3;
}

/**
 * Eviction needs a CLEAR win, and a fresh mount is left alone for a while.
 * Measured 2026-10-09: the landing's cards float (a 6 px bob), which nudges
 * every card's visible share between ~0.99 and 1 — with "any higher share
 * wins" the slots evicted each other forever, often before they had loaded.
 */
const EVICT_MARGIN = 0.2;
const MIN_LIVE_MS = 4000;

/**
 * Look-ahead waits for intent. Before the visitor has scrolled at all, only a
 * slot that is actually ON screen may go live: measured on a phone (CPU /4),
 * the first screens card is within a screen of the hero, and loading its
 * editor at page load blocked the main thread for 10.8 s while the visitor
 * was looking at the hero.
 */
let scrolled = false;
let scrollWatch = false;
function watchFirstScroll() {
  if (scrollWatch) return;
  scrollWatch = true;
  window.addEventListener?.(
    'scroll',
    () => {
      scrolled = true;
      schedule();
    },
    { once: true, passive: true },
  );
}

const live = new Map<LiveSlotHandle, number>();
const waiting = new Set<LiveSlotHandle>();
let budget: number | undefined;
let tickQueued = false;

const idle = (callback: () => void) => {
  if ('requestIdleCallback' in window) window.requestIdleCallback(callback, { timeout: 400 });
  else setTimeout(callback, 60);
};

function byPriority(a: LiveSlotHandle, b: LiveSlotHandle) {
  return b.priority() - a.priority();
}

/** One grant (or one eviction + grant) per idle moment. */
function tick() {
  tickQueued = false;
  if (waiting.size === 0) return;
  budget ??= liveBudget();
  watchFirstScroll();
  const next = [...waiting].filter((slot) => scrolled || slot.priority() > 0).sort(byPriority)[0];
  if (!next) return;
  if (live.size >= budget) {
    const now = performance.now();
    const settled = [...live.entries()].filter(([, since]) => now - since >= MIN_LIVE_MS).map(([slot]) => slot);
    const weakest = settled.sort(byPriority).at(-1);
    // Only a slot that is CLEARLY more visible displaces a live one.
    if (!weakest || next.priority() - weakest.priority() < EVICT_MARGIN) {
      // A fresh mount may settle into being evictable: look again then.
      if (settled.length < live.size) setTimeout(schedule, MIN_LIVE_MS);
      return;
    }
    live.delete(weakest);
    weakest.unmount();
    // It is still near the viewport: it waits to come back.
    waiting.add(weakest);
  }
  waiting.delete(next);
  live.set(next, performance.now());
  next.mount();
  schedule();
}

function schedule() {
  if (tickQueued || waiting.size === 0) return;
  tickQueued = true;
  idle(tick);
}

/** The slot scrolled near: it would like to be live. */
function requestLive(slot: LiveSlotHandle) {
  if (live.has(slot)) return;
  waiting.add(slot);
  schedule();
}

/** The slot scrolled far away (or unmounted): it gives its place up. */
function releaseLive(slot: LiveSlotHandle) {
  waiting.delete(slot);
  if (live.delete(slot)) slot.unmount();
  schedule();
}

/** Priorities changed (scrolling): a waiting slot may now outrank a live one. */
function reprioritise() {
  schedule();
}

/** True on devices that get one live showcase at a time (phones, low-end):
 *  heavy slots there wait for a tap instead of going live on their own. */
function isConstrainedDevice(): boolean {
  budget ??= liveBudget();
  return budget <= 1;
}

export { isConstrainedDevice, releaseLive, reprioritise, requestLive };
export type { LiveSlotHandle };

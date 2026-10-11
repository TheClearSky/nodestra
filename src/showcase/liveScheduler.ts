/**
 * Who may be live right now.
 *
 * A live showcase is a real app component (the graph editor, the timeline…)
 * mounted on the landing page. Each costs real work — thousands of elements,
 * ReactFlow measuring — so the page keeps only a few at once: slots ASK to go
 * live when they scroll near, the scheduler GRANTS mounts one at a time in an
 * idle moment, most-visible first — and the next only once the last one has
 * booted (reported ready, or failed): same-origin frames share the page's
 * main thread, and two booting at once janked a phone for 30 s. It EVICTS
 * the least-visible live slot when a more visible one is waiting and the
 * budget is full; a slot still booting is never evicted. A visitor's own
 * request (a tap) goes first and takes a place at once.
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

type LiveEntry = {
  /** When it reported ready (`readyLive`); null while it boots. */
  readyAt: number | null;
};

/** How many showcases may be live at once on this device. */
function liveBudget(): number {
  const forced = Number(new URLSearchParams(location.search).get('live'));
  if (Number.isFinite(forced) && forced > 0) return forced;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const cores = nav.hardwareConcurrency ?? 8;
  const memory = nav.deviceMemory ?? 8;
  // Phones and tablets: one at a time. Each showcase is the whole app; on an
  // emulated phone (CPU /4) two live cards ran the page at 13 fps, one at 22.
  if (cores <= 4 || memory <= 4 || coarse) return 1;
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
/** Watches for the first scroll — from the moment this module loads, never
 *  lazily: a page scrolled before any slot asked for a place (a wheel, then
 *  a jump to a section) would otherwise never count as scrolled, and slots
 *  near but not on screen would wait for a scroll that already happened. */
function watchFirstScroll() {
  if (scrollWatch || typeof window === 'undefined') return;
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
watchFirstScroll();
/** Scrolled already (also before this module loaded, e.g. a restored
 *  position)? */
function hasScrolled(): boolean {
  if (!scrolled && (window.scrollY ?? 0) > 0) scrolled = true;
  return scrolled;
}

const live = new Map<LiveSlotHandle, LiveEntry>();
const waiting = new Set<LiveSlotHandle>();
/** Asked for by the visitor (a tap): first in line, and never displaced. */
const explicit = new Set<LiveSlotHandle>();
let budget: number | undefined;
let tickQueued = false;
let recheckTimer: ReturnType<typeof setTimeout> | null = null;

const idle = (callback: () => void) => {
  if ('requestIdleCallback' in window) window.requestIdleCallback(callback, { timeout: 400 });
  else setTimeout(callback, 60);
};

function byPriority(a: LiveSlotHandle, b: LiveSlotHandle) {
  return (explicit.has(b) ? 1 : 0) - (explicit.has(a) ? 1 : 0) || b.priority() - a.priority();
}

/** Look again in `ms` (one pending re-check at a time). */
function recheckIn(ms: number) {
  if (recheckTimer !== null) clearTimeout(recheckTimer);
  recheckTimer = setTimeout(() => {
    recheckTimer = null;
    schedule();
  }, ms);
}

function evict(slot: LiveSlotHandle) {
  live.delete(slot);
  slot.unmount();
  // It is still near the viewport: it waits to come back.
  waiting.add(slot);
}

/** One grant (or one eviction + grant) per idle moment. */
function tick() {
  tickQueued = false;
  if (waiting.size === 0) return;
  budget ??= liveBudget();
  watchFirstScroll();
  const next = [...waiting].filter((slot) => explicit.has(slot) || hasScrolled() || slot.priority() > 0).sort(byPriority)[0];
  if (!next) return;
  const asked = explicit.has(next);
  // One boot at a time: the next waits for the last to report ready. A
  // visitor's tap does not wait.
  if (!asked && [...live.values()].some((entry) => entry.readyAt === null)) return;
  if (live.size >= budget) {
    const others = [...live.keys()].filter((slot) => !explicit.has(slot));
    if (asked) {
      // The visitor asked: the least visible place goes, booted or not.
      const weakest = others.sort(byPriority).at(-1);
      if (!weakest) return;
      evict(weakest);
    } else {
      const now = performance.now();
      const settled = others.filter((slot) => {
        const readyAt = live.get(slot)?.readyAt ?? null;
        return readyAt !== null && now - readyAt >= MIN_LIVE_MS;
      });
      const weakest = settled.sort(byPriority).at(-1);
      // Only a slot that is CLEARLY more visible displaces a live one.
      if (!weakest || next.priority() - weakest.priority() < EVICT_MARGIN) {
        // A fresh slot may settle into being evictable: look again then.
        if (settled.length < others.length) recheckIn(MIN_LIVE_MS);
        return;
      }
      evict(weakest);
    }
  }
  waiting.delete(next);
  live.set(next, { readyAt: null });
  next.mount();
  schedule();
}

function schedule() {
  if (tickQueued || waiting.size === 0) return;
  tickQueued = true;
  idle(tick);
}

/** The slot scrolled near: it would like to be live. `explicit`: the
 *  visitor asked for it (a tap) — it goes first and takes a place at once. */
function requestLive(slot: LiveSlotHandle, options: { explicit?: boolean } = {}) {
  if (options.explicit) explicit.add(slot);
  if (live.has(slot)) return;
  waiting.add(slot);
  schedule();
}

/** The slot's component booted (it is on screen as itself): it may now be
 *  evicted after `MIN_LIVE_MS`, and the next slot may boot. */
function readyLive(slot: LiveSlotHandle) {
  const entry = live.get(slot);
  if (!entry || entry.readyAt !== null) return;
  entry.readyAt = performance.now();
  schedule();
}

/** The slot scrolled far away (or unmounted, or failed): it gives its place
 *  up. */
function releaseLive(slot: LiveSlotHandle) {
  waiting.delete(slot);
  explicit.delete(slot);
  if (live.delete(slot)) slot.unmount();
  schedule();
}

/** Priorities changed (scrolling): a waiting slot may now outrank a live one. */
function reprioritise() {
  schedule();
}

// `?debug-live`: the scheduler's state on `window.__liveScheduler` (devtools,
// tests).
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug-live')) {
  (window as unknown as Record<string, unknown>).__liveScheduler = {
    state: () => ({
      budget,
      scrolled,
      tickQueued,
      live: [...live].map(([slot, entry]) => ({ priority: slot.priority(), ready: entry.readyAt !== null, explicit: explicit.has(slot) })),
      waiting: [...waiting].map((slot) => slot.priority()),
    }),
  };
}

/** True on devices that get one live showcase at a time (phones, low-end):
 *  heavy slots there wait for a tap instead of going live on their own. */
function isConstrainedDevice(): boolean {
  budget ??= liveBudget();
  return budget <= 1;
}

export { isConstrainedDevice, readyLive, releaseLive, reprioritise, requestLive };
export type { LiveSlotHandle };

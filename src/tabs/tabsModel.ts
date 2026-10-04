/**
 * The open tabs, as plain data and a pure reducer — no React, no I/O.
 *
 * A tab is keyed by the file's STABLE library id (or `WELCOME_TAB`), so a
 * rename or a move in the library needs nothing here: the label is looked up
 * from the tree at render time. Only ONE editor exists (one audio build, one
 * timeline store — plan §B), so "the active tab" is simply "which file the
 * editor shows". What swapping the editor involves is the session's job; this
 * module only decides WHICH tab is where and which is active.
 *
 * Rulings: no preview tabs (Q4 "no") — every open is a permanent tab.
 */

/** Page tabs (not files) have ids starting with '@' — library ids never do. */
const WELCOME_TAB = '@welcome';

type TabsState = {
  /** Left-to-right order of the strip. */
  order: readonly string[];
  /** The tab the editor shows; `null` = nothing open. */
  active: string | null;
  /** Most-recently-used first — who becomes active when the active tab
   *  closes (VS Code focuses the last-used tab, not a neighbour). */
  mru: readonly string[];
  /** Closed tabs, most recent first, for "reopen closed tab". */
  closed: readonly string[];
};

type TabsAction =
  /** Open (or re-focus) a tab. New tabs go right after the active one. */
  | { type: 'open'; id: string; activate?: boolean }
  | { type: 'activate'; id: string }
  | { type: 'close'; ids: readonly string[] }
  /** Move a tab to a new index in the strip. */
  | { type: 'reorder'; id: string; toIndex: number }
  /** Pop the most recently closed tab that `canReopen` still allows. */
  | { type: 'reopen'; canReopen: (id: string) => boolean }
  /** Drop tabs whose files no longer exist at all (e.g. a new folder was
   *  linked: every old id is gone). Missing-but-maybe-returning files are
   *  NOT pruned here — the strip shows them as "deleted" until closed. */
  | { type: 'retain'; keep: (id: string) => boolean }
  /** Replace everything (restoring a saved record). */
  | { type: 'restore'; state: TabsState };

const MAX_CLOSED = 20;

const emptyTabs: TabsState = { order: [], active: null, mru: [], closed: [] };

function touch(mru: readonly string[], id: string): string[] {
  return [id, ...mru.filter((other) => other !== id)];
}

/** Who is active after `closing` leaves: the most recently used survivor. */
function nextActive(state: TabsState, closing: ReadonlySet<string>): string | null {
  if (state.active !== null && !closing.has(state.active)) return state.active;
  return state.mru.find((id) => !closing.has(id) && state.order.includes(id)) ?? null;
}

function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'open': {
      const activate = action.activate ?? true;
      if (state.order.includes(action.id)) {
        return activate ? tabsReducer(state, { type: 'activate', id: action.id }) : state;
      }
      const at = state.active === null ? state.order.length : state.order.indexOf(state.active) + 1;
      const order = [...state.order.slice(0, at), action.id, ...state.order.slice(at)];
      return {
        order,
        active: activate ? action.id : state.active,
        mru: activate ? touch(state.mru, action.id) : [...state.mru, action.id],
        closed: state.closed.filter((id) => id !== action.id),
      };
    }
    case 'activate': {
      if (!state.order.includes(action.id) || state.active === action.id) return state;
      return { ...state, active: action.id, mru: touch(state.mru, action.id) };
    }
    case 'close': {
      const closing = new Set(action.ids.filter((id) => state.order.includes(id)));
      if (closing.size === 0) return state;
      // Remember in strip order, the rightmost first, so repeated "reopen"
      // brings them back in a natural order.
      const reopenable = state.order.filter((id) => closing.has(id)).reverse();
      return {
        order: state.order.filter((id) => !closing.has(id)),
        active: nextActive(state, closing),
        mru: state.mru.filter((id) => !closing.has(id)),
        closed: [...reopenable, ...state.closed.filter((id) => !closing.has(id))].slice(0, MAX_CLOSED),
      };
    }
    case 'reorder': {
      const from = state.order.indexOf(action.id);
      if (from < 0) return state;
      const without = state.order.filter((id) => id !== action.id);
      const to = Math.max(0, Math.min(action.toIndex, without.length));
      if (to === from) return state;
      return { ...state, order: [...without.slice(0, to), action.id, ...without.slice(to)] };
    }
    case 'reopen': {
      const index = state.closed.findIndex((id) => action.canReopen(id) && !state.order.includes(id));
      if (index < 0) return state;
      const id = state.closed[index];
      const reopened = tabsReducer(
        { ...state, closed: state.closed.filter((_, i) => i !== index) },
        { type: 'open', id },
      );
      return reopened;
    }
    case 'retain': {
      const gone = state.order.filter((id) => !action.keep(id));
      const afterClose = gone.length > 0 ? tabsReducer(state, { type: 'close', ids: gone }) : state;
      // Gone for good: they are not reopenable either.
      const closed = afterClose.closed.filter((id) => action.keep(id));
      return closed.length === afterClose.closed.length ? afterClose : { ...afterClose, closed };
    }
    case 'restore':
      return sanitizeTabs(action.state);
  }
}

/** Repair a record from storage: dedupe, drop unknown MRU/closed entries,
 *  and make sure `active` is one of the open tabs. */
function sanitizeTabs(input: TabsState): TabsState {
  const order = [...new Set(input.order)];
  const inOrder = new Set(order);
  const active = input.active !== null && inOrder.has(input.active) ? input.active : (order[0] ?? null);
  const mru = [...new Set(input.mru)].filter((id) => inOrder.has(id));
  for (const id of order) if (!mru.includes(id)) mru.push(id);
  if (active !== null) mru.splice(0, mru.length, ...touch(mru, active));
  const closed = [...new Set(input.closed)].filter((id) => !inOrder.has(id)).slice(0, MAX_CLOSED);
  return { order, active, mru, closed };
}

/** The tab that ends up active if these close — for callers that must act
 *  on the switch before the state changes (saving, swapping the editor). */
function activeAfterClose(state: TabsState, ids: readonly string[]): string | null {
  return nextActive(state, new Set(ids));
}

/** Close-family helpers: which ids each menu command closes. */
function othersOf(state: TabsState, id: string): string[] {
  return state.order.filter((other) => other !== id);
}
function rightOf(state: TabsState, id: string): string[] {
  const index = state.order.indexOf(id);
  return index < 0 ? [] : state.order.slice(index + 1);
}

export {
  activeAfterClose,
  emptyTabs,
  othersOf,
  rightOf,
  sanitizeTabs,
  tabsReducer,
  WELCOME_TAB,
};
export type { TabsAction, TabsState };

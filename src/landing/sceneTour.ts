/**
 * Which of the start gate's scenes the visitor has played, and which to
 * suggest next (2026-10-11, Deepak: "Keep track of which scenes the user
 * hasn't visited and remind them to check one of them next").
 *
 * A scene counts as visited once its instrument was played (its Play
 * button) — looking at a scene through the arrows is not yet playing it.
 * Remembered in this browser, so a returning visitor is pointed at what is
 * still new to them; a storage that throws or holds rubbish only forgets.
 */
import { STORAGE_NAMESPACE } from '../storageNamespace';

const VISITED_KEY = `${STORAGE_NAMESPACE}.landing.visitedScenes`;

/** The stored list, kept to known scene ids (anything else is dropped). */
function parseVisited<Id extends string>(raw: string | null, ids: readonly Id[]): Set<Id> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    return new Set(ids.filter((id) => value.includes(id)));
  } catch {
    return new Set();
  }
}

function loadVisited<Id extends string>(ids: readonly Id[]): Set<Id> {
  try {
    return parseVisited(localStorage.getItem(VISITED_KEY), ids);
  } catch {
    return new Set();
  }
}

function saveVisited(visited: ReadonlySet<string>): void {
  try {
    localStorage.setItem(VISITED_KEY, JSON.stringify([...visited]));
  } catch {
    // Remembering is a convenience only.
  }
}

/** The first scene after `current` (in arrow order, wrapping) that has not
 *  been visited — never `current` itself; null when every other scene has. */
function nextUnvisited<Id extends string>(order: readonly Id[], current: Id, visited: ReadonlySet<Id>): Id | null {
  const start = order.indexOf(current);
  for (let step = 1; step < order.length; step++) {
    const candidate = order[(start + step + order.length) % order.length];
    if (!visited.has(candidate)) return candidate;
  }
  return null;
}

/** How many scenes, other than `current`, are still unvisited. */
function unvisitedCount<Id extends string>(order: readonly Id[], current: Id, visited: ReadonlySet<Id>): number {
  return order.filter((id) => id !== current && !visited.has(id)).length;
}

export { loadVisited, nextUnvisited, parseVisited, saveVisited, unvisitedCount };

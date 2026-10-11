/**
 * After a deploy, a page loaded from the previous one asks for code files
 * that no longer exist (every file name carries its content's hash). The
 * only cure is to load the page again, which fetches the new deploy — once:
 * a reload that fails the same way means something else is wrong, and the
 * error screen shows instead of a reload loop.
 */

const RELOADED_KEY = 'nodestra:reloaded-for-deploy';
/** A second failure this soon after the reload is not a stale deploy. */
const RELOAD_WINDOW_MS = 60_000;

/** True for the errors a missing code file produces in each engine. */
function isStaleChunkError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Unable to preload CSS/i.test(text);
}

/** Reloads the page, unless it was just reloaded for this; returns whether it did. */
function reloadOnceForNewDeploy(): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOADED_KEY) ?? 0);
  } catch {
    // no session storage: still reload once (the window below is per page)
  }
  if (Date.now() - last < RELOAD_WINDOW_MS) return false;
  try {
    sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
  } catch {
    return false;
  }
  console.warn('[site] code from an older deploy is missing; reloading once');
  location.reload();
  return true;
}

export { isStaleChunkError, reloadOnceForNewDeploy };

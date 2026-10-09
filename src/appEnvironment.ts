/**
 * How this copy of the app is running.
 *
 *   app       the real thing at /app (the default)
 *   showcase  the landing page's live showcase frames (`showcase.html`): the
 *             same App, started without the "click to start audio" stage. The
 *             frame isolates storage BEFORE the app loads
 *             (`showcase/frame/isolateStorage.ts`), so a showcase is always a
 *             fresh first visit and never sees the visitor's library.
 *     audio 'recorded'  a card or the tour: nobody has clicked, so the open
 *                       graph is recorded silently and played back
 *     audio 'live'      "Try it": the visitor is using it — real audio,
 *                       started by their first click or key inside it
 *
 * Set once, by the frame, before the App renders.
 */
type AppEnvironment = { kind: 'app' } | { kind: 'showcase'; audio: 'recorded' | 'live' };

let current: AppEnvironment = { kind: 'app' };

function setAppEnvironment(next: AppEnvironment): void {
  current = next;
}

function isShowcase(): boolean {
  return current.kind === 'showcase';
}

/** A "Try it" showcase: real audio on the visitor's first click or key. */
function isLiveShowcase(): boolean {
  return current.kind === 'showcase' && current.audio === 'live';
}

export { isLiveShowcase, isShowcase, setAppEnvironment };
export type { AppEnvironment };

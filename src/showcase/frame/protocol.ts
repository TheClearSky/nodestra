/**
 * Messages between a page and the showcase frames it hosts (`showcase.html`):
 * the landing page's live cards (`FrameLive`) and the tour
 * (`public/landing/ad/tour.html`, which speaks the same messages by hand).
 * Frames only ever talk to their parent, at the page's own origin; the page
 * checks `event.origin` and that the message comes from the frame it expects.
 */

import type { AppSceneId } from '../appScenes';

/** Why a frame that reports ready does not show the full look. */
type FrameDegraded = 'step-failed' | 'recording-failed';

/** Frame → page. */
type FrameToPage =
  | { type: 'showcase:ready'; degraded?: FrameDegraded[] }
  | { type: 'showcase:failed'; message: string };

/** What a frame shows — the query string of `showcase.html`. `live`: the
 *  "Try it" instance (real audio on the visitor's first click, no recording). */
type FrameQuery = { kind: 'app'; scene: AppSceneId; live?: boolean };

function frameSearch(query: FrameQuery): string {
  return `?kind=app&scene=${encodeURIComponent(query.scene)}${query.live ? '&live' : ''}`;
}

/** The message, if `data` is exactly one of `FrameToPage`; anything else
 *  (another library's messages, a newer frame's extra kinds) is ignored. */
function parseFrameMessage(data: unknown): FrameToPage | null {
  if (typeof data !== 'object' || data === null) return null;
  const message = data as { type?: unknown; message?: unknown; degraded?: unknown };
  if (message.type === 'showcase:failed') {
    return typeof message.message === 'string' ? { type: 'showcase:failed', message: message.message } : null;
  }
  if (message.type === 'showcase:ready') {
    const degraded = Array.isArray(message.degraded) ? (message.degraded.filter((reason) => typeof reason === 'string') as FrameDegraded[]) : undefined;
    return degraded && degraded.length > 0 ? { type: 'showcase:ready', degraded } : { type: 'showcase:ready' };
  }
  return null;
}

export { frameSearch, parseFrameMessage };
export type { FrameDegraded, FrameQuery, FrameToPage };

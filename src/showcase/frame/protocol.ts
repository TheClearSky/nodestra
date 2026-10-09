/**
 * Messages between a landing-page slot and the showcase frame it hosts
 * (`showcase.html`). Same origin only: both sides check `event.origin` and
 * that the message comes from the window they expect.
 */

/** Frame → page. */
type FrameToPage = { type: 'showcase:ready' } | { type: 'showcase:failed'; message: string };

/** Page → frame. */
type PageToFrame = { type: 'showcase:visible'; visible: boolean };

/** What a frame shows — the query string of `showcase.html`. */
type FrameQuery = { kind: 'graph'; id: string } | { kind: 'welcome' };

function frameSearch(query: FrameQuery): string {
  return query.kind === 'graph' ? `?kind=graph&id=${encodeURIComponent(query.id)}` : '?kind=welcome';
}

function isMessage<T extends { type: string }>(data: unknown, prefix = 'showcase:'): data is T {
  return typeof data === 'object' && data !== null && typeof (data as { type?: unknown }).type === 'string' && (data as { type: string }).type.startsWith(prefix);
}

export { frameSearch, isMessage };
export type { FrameQuery, FrameToPage, PageToFrame };

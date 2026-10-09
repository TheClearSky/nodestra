import { Component, lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import type { GraphShowcaseId } from '../showcaseIds';
import { isMessage } from './protocol';
import type { FrameToPage, PageToFrame } from './protocol';

/*
 * `showcase.html`: ONE live app component in its own window, for a landing
 * page slot. Its own window is the point — the editor's dialogs, menus and
 * popovers (Radix portals to document.body), its fixed-position pieces and
 * its keyboard handling all behave exactly as in the app, inside a real
 * 1440x900 viewport the page scales, and none of it can reach the landing
 * page.
 */

// Only the kind this frame shows is loaded: the Welcome showcase brings
// Blip's voice (Tone.js), which a graph frame must not pay for.
const GraphShowcase = lazy(() => import('../GraphShowcase').then((module) => ({ default: module.GraphShowcase })));
const WelcomeShowcase = lazy(() => import('../WelcomeShowcase').then((module) => ({ default: module.WelcomeShowcase })));
const GRAPH_IDS: readonly string[] = ['effectsGraph', 'addMenu', 'insideGroup', 'timeline', 'gridFinder'] satisfies readonly GraphShowcaseId[];

const params = new URLSearchParams(location.search);
const kind = params.get('kind');
const graphId = params.get('id') as GraphShowcaseId | null;

function send(message: FrameToPage) {
  if (window.parent !== window) window.parent.postMessage(message, location.origin);
}

function Frame() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window.parent) return;
      if (!isMessage<PageToFrame>(event.data)) return;
      if (event.data.type === 'showcase:visible') setVisible(event.data.visible);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  const onReady = () => send({ type: 'showcase:ready' });
  // A frame opened on its own (not in a slot) is the full-size "Try it" one.
  const interactive = params.has('interactive') || window.parent === window;

  if (kind === 'graph' && graphId !== null && GRAPH_IDS.includes(graphId)) {
    return <GraphShowcase showcase={graphId} visible={visible} interactive={interactive} onReady={onReady} />;
  }
  if (kind === 'welcome') {
    return <WelcomeShowcase visible={visible} interactive={interactive} onReady={onReady} />;
  }
  send({ type: 'showcase:failed', message: `unknown showcase ${location.search}` });
  return null;
}

/** Only a showcase that cannot RENDER has failed — not every stray window
 *  error (a ResizeObserver loop notice is an error event, and is harmless). */
class FrameBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('[showcase] the showcase failed to render', error);
    send({ type: 'showcase:failed', message: error instanceof Error ? error.message : String(error) });
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FrameBoundary>
      <Suspense fallback={null}>
        <Frame />
      </Suspense>
    </FrameBoundary>
  </StrictMode>,
);

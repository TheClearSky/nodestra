import { Component, lazy, StrictMode, Suspense, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { setAppEnvironment } from '../../appEnvironment';
import { setPreviewsPaused } from '../../components/previews/tapManager';
import { afterRecording, appScenes, isAppSceneId, sceneRecording } from '../appScenes';
import type { AppSceneId } from '../appScenes';
import { recordScene } from '../recording';
import { runSteps } from '../showcaseScript';
import { watchFrameVisibility, whenTabVisible } from './frameVisibility';
import type { FrameDegraded, FrameToPage } from './protocol';

/*
 * `showcase.html?kind=app&scene=<id>`: the REAL app, running one scene, in its
 * own window — for the landing page's cards and tour. Its own window is the
 * point: the app's dialogs, menus and popovers (Radix portals to
 * document.body), its fixed-position pieces and its keyboard handling all
 * behave exactly as in the app, inside a real 1440x900 viewport the page
 * scales, and none of it can reach the landing page. Storage was isolated
 * before this module ran (the classic script in `showcase.html`), the scene
 * is set up through the app's own UI (`appScenes`), its previews play a
 * silent recording (`recording`) and stop drawing while the frame is not
 * seen (`frameVisibility`). Its 3D scenes stop on their own (render gate).
 */

type ShowcaseWindow = Window & { __showcaseIsolated?: boolean; __showcaseBooted?: boolean; __showcaseReady?: boolean };
const frameWindow = window as ShowcaseWindow;

// The page's `FrameLive` checks this on the iframe's `load`: a frame whose
// script never ran (a chunk that failed to load) is a failed frame.
frameWindow.__showcaseBooted = true;

const App = lazy(() => import('../../App').then((module) => ({ default: module.App })));

const params = new URLSearchParams(location.search);
const kind = params.get('kind');
const sceneParam = params.get('scene');
const live = params.has('live');
const scene: AppSceneId | null = kind === 'app' && isAppSceneId(sceneParam) ? sceneParam : null;

function send(message: FrameToPage) {
  if (window.parent !== window) window.parent.postMessage(message, location.origin);
}

/** The real App, set up as `scene` through its own UI, then reported ready —
 *  with what, if anything, keeps it from the full look. */
function AppScene({ scene, onReady }: { scene: AppSceneId; onReady(degraded: FrameDegraded[]): void }) {
  const readyRef = useRef(onReady);
  useEffect(() => {
    readyRef.current = onReady;
  });
  useEffect(() => {
    let cancelled = false;
    const degraded: FrameDegraded[] = [];
    void runSteps(appScenes[scene], { root: document.body }, () => cancelled)
      .catch((error: unknown) => {
        degraded.push('step-failed');
        console.warn('[showcase] a scene step failed', scene, error);
      })
      .then(async () => {
        // The previews and playhead play a silent recording (no click
        // needed) — except in "Try it", where the visitor's own click starts
        // real audio. A hidden tab paints nothing, and the previews acquire
        // what is recorded as they paint: it waits for the tab.
        if (cancelled || live) return;
        await whenTabVisible();
        if (cancelled) return;
        await recordScene(sceneRecording[scene]);
      })
      .catch((error: unknown) => {
        degraded.push('recording-failed');
        console.warn('[showcase] recording the scene failed', scene, error);
      })
      .then(() => runSteps(afterRecording[scene] ?? [], { root: document.body }, () => cancelled))
      .catch((error: unknown) => {
        if (!degraded.includes('step-failed')) degraded.push('step-failed');
        console.warn('[showcase] a scene step failed', scene, error);
      })
      .finally(() => {
        if (!cancelled) requestAnimationFrame(() => requestAnimationFrame(() => readyRef.current(degraded)));
      });
    return () => {
      cancelled = true;
    };
  }, [scene]);
  // Not seen (scrolled away, under a dialog, in a hidden tour panel): the
  // previews stop drawing.
  useEffect(() => watchFrameVisibility((seen) => setPreviewsPaused(!seen, 'offscreen')), []);
  return <App />;
}

function onReady(degraded: FrameDegraded[]) {
  // Also on the window, for a frame opened on its own (tests, devtools).
  frameWindow.__showcaseReady = true;
  send(degraded.length > 0 ? { type: 'showcase:ready', degraded } : { type: 'showcase:ready' });
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

if (!frameWindow.__showcaseIsolated) {
  // The isolation script failed (and said so): the real App must not run
  // against the visitor's own storage.
  console.error('[showcase] storage is not isolated; not starting the app');
} else if (scene === null) {
  console.error('[showcase] unknown showcase', location.search);
  send({ type: 'showcase:failed', message: `unknown showcase ${location.search}` });
} else {
  // The real App runs here as a showcase: no start stage (see appEnvironment).
  setAppEnvironment({ kind: 'showcase', audio: live ? 'live' : 'recorded' });
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <FrameBoundary>
        <Suspense fallback={null}>
          <AppScene scene={scene} onReady={onReady} />
        </Suspense>
      </FrameBoundary>
    </StrictMode>,
  );
}

// FIRST: this window's storage is replaced before any app module runs.
import './isolateStorage';
import { Component, lazy, StrictMode, Suspense, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { setAppEnvironment } from '../../appEnvironment';
import { APP_SCENE_IDS, appScenes, sceneRecording } from '../appScenes';
import type { AppSceneId } from '../appScenes';
import { recordScene } from '../recording';
import { runSteps } from '../showcaseScript';
import type { FrameToPage } from './protocol';

/*
 * `showcase.html?kind=app&scene=<id>`: the REAL app, running one scene, in its
 * own window — for the landing page's cards and tour. Its own window is the
 * point: the app's dialogs, menus and popovers (Radix portals to
 * document.body), its fixed-position pieces and its keyboard handling all
 * behave exactly as in the app, inside a real 1440x900 viewport the page
 * scales, and none of it can reach the landing page. Storage is isolated
 * (`isolateStorage`), the scene is set up through the app's own UI
 * (`appScenes`), and its previews play a silent recording (`recording`).
 * Its 3D scenes stop drawing on their own while off screen (render gate).
 */

const App = lazy(() => import('../../App').then((module) => ({ default: module.App })));

const params = new URLSearchParams(location.search);
const kind = params.get('kind');
const live = params.has('live');

/** The real App, set up as `scene` through its own UI, then reported ready. */
function AppScene({ scene, onReady }: { scene: AppSceneId; onReady(): void }) {
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  useEffect(() => {
    let cancelled = false;
    void runSteps(appScenes[scene], { root: document.body }, () => cancelled)
      .catch((error: unknown) => console.warn('[showcase] a scene step failed', scene, error))
      // The previews and playhead play a silent recording (no click needed) —
      // except in "Try it", where the visitor's own click starts real audio.
      .then(() => (cancelled || live ? undefined : recordScene(sceneRecording[scene])))
      .catch((error: unknown) => console.warn('[showcase] recording the scene failed', scene, error))
      .finally(() => {
        if (!cancelled) requestAnimationFrame(() => requestAnimationFrame(() => readyRef.current()));
      });
    return () => {
      cancelled = true;
    };
  }, [scene]);
  return <App />;
}

function send(message: FrameToPage) {
  if (window.parent !== window) window.parent.postMessage(message, location.origin);
}

function Frame() {
  const onReady = () => {
    // Also on the window, for a frame opened on its own (tests, devtools).
    (window as unknown as { __showcaseReady?: boolean }).__showcaseReady = true;
    send({ type: 'showcase:ready' });
  };
  const scene = params.get('scene') as AppSceneId | null;
  if (kind === 'app' && scene !== null && APP_SCENE_IDS.includes(scene)) {
    return <AppScene scene={scene} onReady={onReady} />;
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

// The real App runs here as a showcase: no start stage (see appEnvironment).
if (kind === 'app') setAppEnvironment({ kind: 'showcase', audio: live ? 'live' : 'recorded' });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FrameBoundary>
      <Suspense fallback={null}>
        <Frame />
      </Suspense>
    </FrameBoundary>
  </StrictMode>,
);

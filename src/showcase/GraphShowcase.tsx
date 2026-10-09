import { useEffect, useMemo, useRef } from 'react';
import { FullGraph, useFullGraph } from '@theclearsky/react-blender-nodes';
import '@theclearsky/react-blender-nodes/style.css';
import {
  createEmptyTimelineDocument,
  createTimelineDocumentStore,
  TimelineProvider,
} from '@theclearsky/react-blender-nodes-timeline';
import '@theclearsky/react-blender-nodes-timeline/style.css';
import { bottomDrawers, inputComponents } from '../editor/editorParts';
import { graphShowcases } from './graphShowcases';
import type { LiveComponentProps } from './LiveSlot';
import { runSteps } from './showcaseScript';
import type { GraphShowcaseId } from './showcaseIds';

type GraphShowcaseProps = { showcase: GraphShowcaseId };

/**
 * The app's real graph editor, live on the landing page: the same FullGraph,
 * inputs and timeline drawer as the app (`editor/editorParts`), on a demo
 * graph with its own timeline store. Silent on purpose — no audio engine, so
 * no node previews (they read live audio) and no runner; the landing page
 * never loads Tone.
 */
function GraphShowcase({ showcase, interactive, onReady }: GraphShowcaseProps & LiveComponentProps) {
  const spec = graphShowcases[showcase];
  const initialState = useMemo(() => spec.state(), [spec]);
  const store = useMemo(
    () => createTimelineDocumentStore(spec.timeline?.() ?? createEmptyTimelineDocument()),
    [spec],
  );
  const { state, dispatch } = useFullGraph(initialState);
  const root = useRef<HTMLDivElement>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  // Set up once, then show. A step that fails still shows the graph.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let cancelled = false;
    void runSteps(spec.steps ?? [], { root: element, dispatch: dispatch as (action: never) => void }, () => cancelled)
      .catch((error: unknown) => console.warn('[showcase] a setup step failed', showcase, error))
      .finally(() => {
        if (!cancelled) readyRef.current();
      });
    return () => {
      cancelled = true;
    };
    // Once per mount: a showcase is remounted, never re-scripted.
  }, []);

  return (
    <div ref={root} className='h-full w-full bg-primary-black [&>*]:h-full'>
      <TimelineProvider store={store}>
        <FullGraph
          state={state}
          dispatch={dispatch}
          inputComponents={inputComponents}
          bottomDrawers={bottomDrawers}
          enableUndoRedoShortcuts={interactive}
        />
      </TimelineProvider>
    </div>
  );
}

export { GraphShowcase };
export type { GraphShowcaseProps };

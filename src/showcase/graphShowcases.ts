import { actionTypesMap } from '@theclearsky/react-blender-nodes';
import type { TimelineDocument } from '@theclearsky/react-blender-nodes-timeline';
import { buildProbeGraphState, demoTimelineDocuments } from '../soundDefinitions/probeGraphs';
import type { ProbeState } from '../soundDefinitions/probeGraphs';
import { click, contextMenu, dispatch, hover } from './showcaseScript';
import type { ShowcaseStep } from './showcaseScript';
import type { GraphShowcaseId } from './showcaseIds';

/*
 * What each graph showcase shows: a real demo graph from the app's Demos menu,
 * set up the way a visitor would (the add menu opened, a group entered, the
 * timeline drawer pulled up). This module only loads with the showcase chunk.
 */

type GraphShowcaseSpec = {
  state(): ProbeState;
  /** Its own timeline document (never the visitor's app timeline). */
  timeline?(): TimelineDocument;
  steps?: readonly ShowcaseStep[];
};

const openTimeline = click('button[title="Open the curve timeline"]');

const graphShowcases: Record<GraphShowcaseId, GraphShowcaseSpec> = {
  // "Wobble → Stutter → Big Space" — three Easy Effects on a chord.
  effectsGraph: { state: () => buildProbeGraphState('fxRhythm') },
  addMenu: {
    state: () => buildProbeGraphState('fxRhythm'),
    steps: [contextMenu(0.62, 0.3), hover('Add Node'), hover('Easy Effects')],
  },
  insideGroup: {
    state: () => buildProbeGraphState('fxKeys'),
    steps: [dispatch({ type: actionTypesMap.OPEN_NODE_GROUP, payload: { nodeId: 'fk-echo' } })],
  },
  timeline: {
    state: () => buildProbeGraphState('curveOrchestra'),
    timeline: () => demoTimelineDocuments.curveOrchestra,
    steps: [openTimeline],
  },
  gridFinder: {
    state: () => buildProbeGraphState('curveOrchestra'),
    timeline: () => demoTimelineDocuments.curveOrchestra,
    steps: [openTimeline, click('button', 'find grid')],
  },
};

export { graphShowcases };
export type { GraphShowcaseSpec };

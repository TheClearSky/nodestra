import { blurActive, click, clickIfPresent, clickText, contextMenu, hover, pointAt, reveal, wait, waitVisible } from './showcaseScript';
import type { SceneRecordingOptions } from './recording';
import type { ShowcaseStep } from './showcaseScript';

/*
 * The landing page's live scenes of the REAL app (`showcase.html?kind=app`),
 * each set up the way a visitor would: through the app's own toolbar, menus
 * and buttons, never its internals — so a scene keeps working as the app
 * changes, and a scene that breaks shows the UI changed. The approved look
 * for each is the snapshot it replaces (`.claude/plans/live-landing.md`).
 */

type AppSceneId =
  | 'welcome'
  | 'tutorial'
  | 'effects'
  | 'info'
  | 'addMenu'
  | 'insideGroup'
  | 'groupEditor'
  | 'timeline'
  | 'gridFinder'
  | 'violin';

const APP_SCENE_IDS: readonly AppSceneId[] = [
  'welcome',
  'tutorial',
  'effects',
  'info',
  'addMenu',
  'insideGroup',
  'groupEditor',
  'timeline',
  'gridFinder',
  'violin',
];

/** Opens a demo from the toolbar's Demos menu (a new file and tab): the
 *  category row opens its submenu on hover, the demo row loads on click. */
function openDemo(category: string, label: string): ShowcaseStep[] {
  return [
    click('button', 'Demos'),
    hover(category),
    // The submenu is positioned (floating UI) a moment after the hover.
    wait(300),
    clickText(label),
    // Its tab is the active one: the next step acts on THIS graph.
    waitVisible('[role="tab"][aria-selected="true"]', label),
    wait(600),
    // "Run, then ▶" demos open the Runner drawer; the session the snapshots
    // show had it closed.
    clickIfPresent('button[aria-label="Close panel"]'),
  ];
}

const openTimeline = click('button[title="Open the curve timeline"]');
const openEchoGroup: ShowcaseStep[] = [
  click('.react-flow__node[data-id="fk-echo"] [data-testid="open-node-group"]'),
  // The group's own graph is on screen (its Beat Clock) before anything else.
  waitVisible('.react-flow__node', 'Beat Clock'),
  wait(300),
];
// The ✎ beside the open group's name. The host's group header buttons carry
// no label or test id yet (an accessibility gap to fix in the host), so this
// targets the pencil icon itself.
const editOpenGroup = click('button:has(> svg.lucide-pencil)');

/** Blip's first-visit offer, declined — as a returning visitor would see it. */
const dismissOffer = click('button', 'Not now');

/** The session every app snapshot was captured in. */
const curveOrchestra = openDemo('Orchestras', 'Curve Orchestra');
const violin = openDemo('Solos', 'Violin — Lament and Flight');
const wobble = openDemo('Easy Effects', 'Wobble → Stutter → Big Space');
const crunch = openDemo('Easy Effects', 'Crunch → Echo → Big Space');
const session: ShowcaseStep[] = [dismissOffer, ...curveOrchestra, ...violin, ...wobble];

const appScenes: Record<AppSceneId, readonly ShowcaseStep[]> = {
  welcome: [],
  tutorial: [click('button', 'Show me how'), click('button', 'Next')],
  effects: session,
  // The ⓘ shows while the pointer is over its node; then the hint opens.
  info: [...session, wait(400), reveal('[aria-label="About Stutter"]'), pointAt('[aria-label="About Stutter"]')],
  addMenu: [...session, ...crunch, contextMenu(0.545, 0.1), hover('Add Node'), wait(300), hover('Easy Effects')],
  insideGroup: [...session, ...crunch, ...openEchoGroup],
  groupEditor: [...session, ...crunch, ...openEchoGroup, editOpenGroup],
  timeline: [dismissOffer, ...curveOrchestra, openTimeline],
  gridFinder: [dismissOffer, ...curveOrchestra, openTimeline, click('button', 'find grid'), wait(300), blurActive],
  violin: [dismissOffer, ...curveOrchestra, ...violin, openTimeline],
};

/** Where each score starts playing in its recording. The playhead must sweep
 *  through the visible lanes: at the timeline's default zoom about 11 s fit, and
 *  the approved look had the playhead at x ≈ 789 (t ≈ 3.5 s at that zoom; the
 *  snapshot's view had scrolled to t = 10.96 s), so the 4 s loop starts at 1.5 s
 *  and passes that spot mid-loop. The tour's playhead highlight follows it. */
const sceneRecording: Partial<Record<AppSceneId, SceneRecordingOptions>> = {
  timeline: { startAt: 1.5 },
  gridFinder: { startAt: 1.5 },
  violin: { startAt: 1.7 },
};

export { APP_SCENE_IDS, appScenes, sceneRecording };
export type { AppSceneId };

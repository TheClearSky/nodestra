import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ExecutionRecord,
  GraphBottomDrawer,
  GraphRunnerHandle,
  InputComponentRegistry,
  RunEvent,
} from '@theclearsky/react-blender-nodes';
import {
  actionTypesMap,
  FullGraph,
  useFullGraph,
} from '@theclearsky/react-blender-nodes';
import '@theclearsky/react-blender-nodes/style.css';
import {
  CurveTimeline,
  parseTimelineDocument,
  TimelineCurvePicker,
  TimelineProvider,
} from '@theclearsky/react-blender-nodes-timeline';
import type {
  TimelineDocument,
  TimelineTransport,
} from '@theclearsky/react-blender-nodes-timeline';
import '@theclearsky/react-blender-nodes-timeline/style.css';
import './index.css';
import {
  ensureTimelineRuntime,
  getTimelineRegistry,
  getTimelineStore,
  getTimelineTransport,
} from './timeline/timelineSystem';
import { initialSoundState } from './soundDefinitions/demoState';
import {
  buildProbeGraphState,
  demoTimelineDocuments,
} from './soundDefinitions/probeGraphs';
import { createEmptyTimelineDocument } from '@theclearsky/react-blender-nodes-timeline';
import { soundImplementations } from './soundDefinitions/implementations';
import { disposeBuild } from './soundDefinitions/audioSystem';
import { installKeyboardBus, onKeyBusEvent, releaseEverything } from './audio/keyboardBus';
import { createTutorial } from '@theclearsky/easy-tutorial-builder';
import type { TutorialController } from '@theclearsky/easy-tutorial-builder';
import { useTutorialView } from '@theclearsky/easy-tutorial-builder/react';
import { TutorialLayer } from './components/TutorialLayer';
import { tutorialKit, tutorialSignals } from './tutorials/kit';
import { FIRST_TUTORIAL_ID, tutorialProgress, tutorials } from './tutorials';
import { replaceProject } from './project/replaceProject';
import { decideAutoRun } from './project/decideAutoRun';
import {
  isMonitorMuted,
  isRecording,
  onContextStateChange,
  setMonitorMuted,
  startAudio,
  startRecording,
  stopRecording,
} from './audio/bootstrap';
import {
  applyTimelineDocument,
  clearJournal,
  deserializeProject,
  downloadBlob,
  downloadProject,
  isLibraryInitializedSync,
  loadJournal,
  loadProjectFromLocalStorage,
  serializeProject,
  setBootJournalPath,
  suppressPersistence,
} from './appPersistence';
import {
  buildInstrumentProbeState,
  instrumentDemoBuilders,
} from './soundDefinitions/instrumentDemos';
import { withSoundRunnerDefaults } from './runnerViewDefaults';
import { DemosMenu } from './components/DemosMenu';
import {
  AutoRunControl,
  type RunFreshness,
} from './components/AutoRunControl';
import { graphSignature } from './soundDefinitions/graphSignature';
import { SignalBaseInput } from './components/SignalBaseInput';
import { WaveformDrawInput } from './components/WaveformDrawInput';
import { previewRegistry } from './components/previews/previewRegistry';
import { OctaveControl } from './components/OctaveControl';
import { AutoSaveControl } from './components/AutoSaveControl';
import { FileSidebar } from './components/FileSidebar';
import { SidebarErrorBoundary } from './components/SidebarErrorBoundary';
import { setPreviewsPaused } from './components/previews/tapManager';
import { EmptyEditor } from './components/EmptyEditor';
import { TabStrip } from './components/TabStrip';
import { showToast, Toaster } from './components/Toaster';
import { useUnsavedChangesDialog } from './components/UnsavedChangesDialog';
import { WelcomePage } from './components/WelcomePage';
import type { WelcomeDemo } from './components/WelcomePage';
import type { LandingInstrument } from './landing/StageLanding';
import { WELCOME_TAB } from './tabs/tabsModel';

/** Featured on the Welcome page; ids are Demos-menu ids. */
const WELCOME_DEMOS: readonly WelcomeDemo[] = [
  { id: 'piano', title: 'Piano', blurb: 'A physically modelled grand — play it with your keyboard.' },
  { id: 'violinSolo', title: 'Violin', blurb: 'Lament and Flight — a bowed-string solo on a score.' },
  { id: 'guitarSolo', title: 'Guitar', blurb: 'Back Porch Run — a country flatpick.' },
  { id: 'fluteSolo', title: 'Flute', blurb: 'Reed at Dusk — a breath-driven pipe.' },
  { id: 'curveOrchestra', title: 'Curve Orchestra', blurb: 'Timeline curves conducting a small band.' },
  { id: 'starryNight', title: 'Starry Night', blurb: 'A deep-space ambient score.' },
];

const SHOW_WELCOME_KEY = `${STORAGE_NAMESPACE}.welcome.showOnStartup`;
/** The first-run offer (ruling Q14) is made once. */
const TUTORIAL_OFFERED_KEY = `${STORAGE_NAMESPACE}.tutorial.offered`;
function readOffered(): boolean {
  try {
    return window.localStorage.getItem(TUTORIAL_OFFERED_KEY) === '1';
  } catch {
    return false;
  }
}
function writeOffered(): void {
  try {
    window.localStorage.setItem(TUTORIAL_OFFERED_KEY, '1');
  } catch {
    // shown again next time, at worst
  }
}
function readShowWelcome(): boolean {
  try {
    return window.localStorage.getItem(SHOW_WELCOME_KEY) !== '0';
  } catch {
    return true;
  }
}
function writeShowWelcome(value: boolean): void {
  try {
    window.localStorage.setItem(SHOW_WELCOME_KEY, value ? '1' : '0');
  } catch {
    // a preference only
  }
}
import { useLibrarySession } from './library/useLibrarySession';
import { allDemoCategories } from './soundDefinitions/demoCatalog';
import { STORAGE_NAMESPACE } from './storageNamespace';

// The landing stage pulls in three.js: its own chunk, fetched only while the
// start gate is up. The plain gate below stands in until it arrives.
/** The demo each of the landing's play buttons installs — a probe graph or
 *  an Instrument-library demo. The sakura plays the library's Organ demo
 *  (2026-10-04, Deepak: "organ demo suits sakura scene the best"). */
const LANDING_GRAPHS: Record<LandingInstrument, string> = {
  piano: 'piano',
  guitar: 'guitarKeys',
  sakura: 'demoInst_inst_organ',
};
function landingGraphState(instrument: LandingInstrument) {
  const id = LANDING_GRAPHS[instrument];
  return id in instrumentDemoBuilders ? instrumentDemoBuilders[id]() : buildProbeGraphState(id);
}
const StageLanding = lazy(() =>
  import('./landing/StageLanding').then((module) => ({ default: module.StageLanding })),
);

// The curve timeline as a host BOTTOM DRAWER: the runner panel's chrome, a
// floating button beside the Runner's, and the host guarantees only one of the
// two is open at a time (user ruling 2026-09-18, superseding the timeline
// plan's Q-TL-6 dual dock). Module-level so the array identity is stable —
// the drawer chrome re-renders when it changes (host guidance). It renders
// inside FullGraph, which sits under <TimelineProvider>, so the timeline still
// finds its store and transport.
const bottomDrawers: GraphBottomDrawer[] = [
  {
    id: 'curveTimeline',
    label: 'Timeline',
    title: 'Open the curve timeline',
    // Toolbar + ruler + two full lanes; the runner's 220 shows ~1.4 lanes.
    // The user can still drag the handle (80–600).
    defaultHeight: 320,
    // keepMounted defaults to true: zoom, scroll and selection survive a
    // switch to the Runner and back, exactly as they did in the old dock.
    icon: (
      <svg
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
        aria-hidden='true'
      >
        <path d='M2 12h3l3-8 4 16 3-8h3' />
      </svg>
    ),
    // Fit the plugin's panel to the drawer. `overflow-visible` is
    // load-bearing: the timeline's transport toolbar is `sticky`, and while
    // the timeline clips its own overflow IT becomes the sticky container — one
    // that never scrolls — so ▶ would scroll away with the lanes. Letting
    // overflow through makes the drawer's scroll box the container. `min-h-full`
    // fills the drawer body so a one-lane document shows no seam, and the inset
    // ring restores the keyboard-focus cue the removed border used to give.
    content: (
      <CurveTimeline className='min-h-full overflow-visible rounded-none border-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-secondary-light-gray)]' />
    ),
  },
];

/**
 * Demo id → the name its library file is given: the menu label WITHOUT its
 * trailing usage hint — "Piano — struck string (hold a key)" names a file
 * "Piano — struck string.json", not one ending "(hold a key).json".
 */
const demoLabels = new Map<string, string>(
  allDemoCategories.flatMap((category) =>
    category.options.map(
      (option) =>
        [option.id, option.label.replace(/\s*\([^)]*\)\s*$/, '')] as const,
    ),
  ),
);

/** The plain toolbar controls (Stop / Mute / Record / Export / Import). */
const TOOLBAR_BUTTON_CLASS =
  'cursor-pointer rounded border border-primary-gray bg-primary-dark-gray px-3 py-[3px] text-[13px] text-primary-white hover:bg-secondary-dark-gray';

// Module-level registries — an inline literal would remount the components
// every App render (host guidance).
const inputComponents: InputComponentRegistry = {
  signal: SignalBaseInput,
  waveform: WaveformDrawInput,
  // Needs <TimelineProvider> above the graph. The plugin's picker is built on
  // the host's `Select`, so it is the same widget as a node's enum input.
  curveRef: TimelineCurvePicker,
};

function isTypingElement(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable)
  );
}

/**
 * The header Stop and Esc: silence the running build AND stop the timeline
 * (its playhead and every curve it drives). Stopping only the build left the
 * timeline cursor running on (Deepak, 2026-09-27).
 */
function stopEverything(): void {
  disposeBuild();
  getTimelineTransport()?.stop();
}

function App() {
  // Autosave restore: the saved project wins; a fresh session boots into
  // the flagship Curve Orchestra demo, score included. The timeline
  // install defers to a microtask exactly like the persistence hydration
  // path, and is idempotent under StrictMode double-invocation.
  // Every document this app installs passes through `withSoundRunnerDefaults`
  // (here and at each REPLACE_STATE below): the runner's Auto-scroll / Follow
  // groups are OFF in this app unless the document already says otherwise.
  // What the very first render shows, before the library (IndexedDB) has
  // answered:
  //  1. THIS tab's journal — the crash copy of the file it had open. Adopted
  //     by the library only if it restores cleanly (a failed restore used to
  //     show the demo and then write it over the user's file — B3).
  //  2. Before the library ever existed: the old single autosave, which the
  //     first run migrates into the library as "Untitled.json".
  //  3. Otherwise the flagship demo (the library then opens the remembered
  //     file over it).
  const bootLegacyAutosaveRef = useRef(false);
  // `useState`, not `useMemo`: this has side effects (it adopts the crash
  // journal and queues its timeline), and Fast Refresh re-runs every useMemo on
  // a hot update — which would re-apply an old journal over the live session.
  const [bootState] = useState(() => {
    const journal = loadJournal();
    if (journal) {
      const outcome = deserializeProject(journal.text);
      if (outcome.state) {
        setBootJournalPath(journal.path);
        const timelineDocument = outcome.timelineDocument;
        if (timelineDocument) {
          queueMicrotask(() => applyTimelineDocument(timelineDocument));
        }
        return withSoundRunnerDefaults(outcome.state);
      }
      clearJournal();
    }
    if (!isLibraryInitializedSync()) {
      const saved = loadProjectFromLocalStorage();
      if (saved) {
        bootLegacyAutosaveRef.current = true;
        return withSoundRunnerDefaults(saved);
      }
    }
    // Nothing is open by default (ruling Q7): the editor starts empty and
    // hidden; the library restores tabs on later visits.
    return withSoundRunnerDefaults(initialSoundState);
  });
  const { state, dispatch } = useFullGraph(bootState);
  const [audioReady, setAudioReady] = useState(false);
  // The landing stage outlives the audio start: it flies into the piano,
  // fades to black and lifts the black off the app, then says so.
  const [stageShown, setStageShown] = useState(true);
  // While the stage fully covers the app, the app is not painted and its
  // live previews stop drawing — measured: ~20 hidden waveform painters plus
  // painting 11k hidden DOM nodes cost more than the stage's own WebGL
  // frame in "Play the piano". Layout is kept (`visibility`, not
  // `display`/`content-visibility`), so ReactFlow still measures and fits.
  const [stageCovering, setStageCovering] = useState(true);
  const appHidden = stageShown && stageCovering;
  useEffect(() => {
    setPreviewsPaused(appHidden);
  }, [appHidden]);
  // Focus lands somewhere useful once the app is revealed — not during the
  // fly-in, where it would steal Enter from the Skip button.
  const hideStage = useCallback(() => {
    setStageShown(false);
    stopButtonRef.current?.focus();
  }, []);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | undefined>(undefined);
  const [muted, setMuted] = useState(false);
  const [recordingUi, setRecordingUi] = useState(false);
  // Controlled run record: a run that ERRORS must end silent — independent
  // branches keep executing under Promise.allSettled, so a completed Render
  // may already be sounding when a sibling fails.
  const [executionRecord, setExecutionRecord] =
    useState<ExecutionRecord | null>(null);
  // Null until audio starts — the Timeline drawer renders with transport
  // controls disabled meanwhile.
  const [timelineTransport, setTimelineTransport] =
    useState<TimelineTransport | null>(null);
  // Auto-run is ON by default: the point of this app is to hear the graph, and
  // requiring a manual run after every edit is friction in the common case.
  // Pressing the runner's Stop or Reset switches it back off (see
  // `onRunEvent`) — a halt the user asked for has to stay halted.
  const [autoRunEnabled, setAutoRunEnabled] = useState(true);
  // One second after the LAST change. The effect below clears and re-arms the
  // timer on every change, so a burst of edits (dragging a slider, typing a
  // number) schedules exactly one run, one second after the burst ends.
  const [autoRunDelaySeconds, setAutoRunDelaySeconds] = useState(1);
  const [autoRunCountdown, setAutoRunCountdown] = useState<number | null>(null);
  // The signature the CURRENT record was produced from. `null` = nothing ran.
  const [ranSignature, setRanSignature] = useState<string | null>(null);
  // Is a run in flight right now? Fed by `onRunEvent`, read by auto-run.
  // Without it, an auto-run whose timer fired while the runner was busy was
  // dropped on the floor by `runGraphNow` and NOTHING re-armed it — the effect
  // only re-runs when one of its deps changes, and none of them do. The edit
  // that triggered it then never ran, silently, forever.
  const [runInFlight, setRunInFlight] = useState(false);
  // The same fact, readable synchronously from callbacks that fire during a
  // run (React state in a closure is a render behind).
  const runInFlightRef = useRef(false);
  // runId → the signature the graph had when THAT run started. The host emits
  // `run:started` synchronously before the run's first `await`, so the entry is
  // the exact graph the run went on to compile; it is promoted to
  // `ranSignature` only when the SAME runId completes.
  const pendingRunSignaturesRef = useRef(new Map<number, string>());
  const runnerRef = useRef<GraphRunnerHandle | null>(null);
  const autoRunTimerRef = useRef<number | undefined>(undefined);
  const autoRunDeadlineRef = useRef<number | null>(null);
  const handledErrorRecordRef = useRef<ExecutionRecord | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stopButtonRef = useRef<HTMLButtonElement | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // THE single door for replacing the project. Every load, import and probe
  // goes through here — see `project/replaceProject.ts` for why it is one
  // transaction and for the order it guarantees.
  const installProject = useCallback(
    (project: {
      state: typeof initialSoundState;
      timelineDocument: TimelineDocument;
      persist: boolean;
      preserveHistory?: boolean;
    }) => {
      replaceProject(project, {
        dispatch,
        makeReplaceStateAction: (nextState, preserveHistory) => ({
          type: actionTypesMap.REPLACE_STATE,
          payload: { state: withSoundRunnerDefaults(nextState), preserveHistory },
        }),
        runner: runnerRef.current,
        disposeBuild,
        stopTransport: () => getTimelineTransport()?.stop(),
        releaseHeldKeys: releaseEverything,
        applyTimelineDocument,
        suppressPersistence,
        forgetRunBookkeeping: () => {
          pendingRunSignaturesRef.current.clear();
          handledErrorRecordRef.current = null;
          // Nothing has run THIS project yet, whatever ran the last one.
          setRanSignature(null);
          setRunInFlight(false);
        },
      });
    },
    [dispatch],
  );

  // The graph library: which file is open, saving it, the sidebar's
  // operations. See `library/useLibrarySession.ts`.
  const silenceForLibrary = useCallback(() => {
    disposeBuild();
    getTimelineTransport()?.stop();
  }, []);
  const newGraphState = useCallback(() => initialSoundState, []);
  const unsavedDialog = useUnsavedChangesDialog();
  // ── tutorials ────────────────────────────────────────────────────────
  const [tutorialOffer, setTutorialOffer] = useState(false);
  const [tutorialController, setTutorialController] = useState<TutorialController | null>(null);
  const tutorialView = useTutorialView(tutorialController);
  const [tutorialProgressVersion, setTutorialProgressVersion] = useState(0);
  // The running controller lives in a ref too: starting one is a side
  // effect (it draws the spotlight), so it must never happen inside a state
  // updater — StrictMode runs those twice, which started an orphan tutorial
  // whose overlay covered the real one.
  const tutorialControllerRef = useRef<TutorialController | null>(null);
  const startTutorial = useCallback((id: string) => {
    const tutorial = tutorials.find((candidate) => candidate.id === id);
    if (!tutorial) return;
    writeOffered();
    setTutorialOffer(false);
    tutorialControllerRef.current?.destroy();
    const controller = createTutorial({ kit: tutorialKit, tutorial, progress: tutorialProgress });
    tutorialControllerRef.current = controller;
    controller.on('finish', () => {
      setTutorialProgressVersion((version) => version + 1);
      if (tutorialControllerRef.current === controller) {
        tutorialControllerRef.current = null;
        setTutorialController(null);
      }
      controller.destroy();
    });
    setTutorialController(controller);
    controller.start();
  }, []);
  useEffect(() => () => tutorialControllerRef.current?.destroy(), []);
  // Startup opened something by itself (restored tabs, a crash journal, old
  // work migrated): auto-run goes OFF and a toast says so (ruling Q7).
  const onStartupOpened = useCallback((count: number) => {
    setAutoRunEnabled(false);
    showToast({
      message:
        count === 1
          ? 'Reopened your file from last time. Auto-run is off.'
          : `Reopened ${count} tabs from last time. Auto-run is off.`,
      action: { label: 'Turn auto-run on', run: () => setAutoRunEnabled(true) },
      timeoutMs: 12000,
    });
  }, []);
  const session = useLibrarySession({
    state,
    stateRef,
    installProject,
    silence: silenceForLibrary,
    newGraphState,
    bootShowedLegacyAutosave: bootLegacyAutosaveRef.current,
    confirmUnsaved: unsavedDialog.ask,
    onStartupOpened,
    showWelcomeOnStartup: readShowWelcome,
    onFirstVisit: () => {
      if (!readOffered()) setTutorialOffer(true);
    },
  });
  const [showWelcome, setShowWelcome] = useState(readShowWelcome);
  // Tab shortcuts. Ctrl+W / Ctrl+T / Ctrl+Tab belong to the browser, so the
  // app uses Alt (ruling Q6): Alt+W close, Alt+Shift+T reopen,
  // Alt+PageUp / Alt+PageDown previous / next tab.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const { order, active } = session.tabs;
      if (event.code === 'KeyW' && !event.shiftKey) {
        event.preventDefault();
        if (active) void session.closeTabs([active]);
      } else if (event.code === 'KeyT' && event.shiftKey) {
        event.preventDefault();
        void session.reopenClosedTab();
      } else if ((event.code === 'PageUp' || event.code === 'PageDown') && order.length > 1) {
        event.preventDefault();
        const index = active ? order.indexOf(active) : -1;
        const step = event.code === 'PageUp' ? -1 : 1;
        void session.activateTab(order[(index + step + order.length) % order.length]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Dev observability: live state reader, the serialized-export reader,
  // and the probe-graph loader.
  useEffect(() => {
    const devWindow = window as Window & {
      __graphState?: () => unknown;
      __exportProject?: () => string;
      __probe?: (name: string) => void;
    };
    devWindow.__graphState = () => stateRef.current;
    devWindow.__exportProject = () => serializeProject(stateRef.current);
    // Raw action dispatch (probe-only — the host validates every action
    // through its own validate→plan→apply pipeline, so this cannot
    // corrupt state).
    (devWindow as Window & { __dispatch?: unknown }).__dispatch = (
      action: Parameters<typeof dispatch>[0],
    ) => dispatch(action);
    devWindow.__probe = (name: string) => {
      // A probe graph must never reach a library file.
      session.detachForProbe();
      installProject({
        state:
          name in instrumentDemoBuilders
            ? instrumentDemoBuilders[name]()
            : buildProbeGraphState(name),
        // This used to be MISSING, so a probe left the PREVIOUS demo's score
        // installed and every curve reference in the probed graph dangled —
        // measured at 8 warnings per run, and the source of a long-running
        // false theory about in-flight runs.
        timelineDocument:
          demoTimelineDocuments[name] ?? createEmptyTimelineDocument(),
        // Probe graphs must NEVER clobber the user's autosaved project.
        persist: false,
      });
    };
    // Constant-pitch / strike-train drive of one instrument for FFT
    // capture. Probe-only.
    (
      devWindow as Window & {
        __probeInstrument?: (
          instrumentId: string,
          pitchHz: number,
          strike?: boolean,
        ) => void;
      }
    ).__probeInstrument = (
      instrumentId: string,
      pitchHz: number,
      strike?: boolean,
    ) => {
      session.detachForProbe();
      installProject({
        state: buildInstrumentProbeState(
          instrumentId as Parameters<typeof buildInstrumentProbeState>[0],
          pitchHz,
          strike,
        ),
        // An instrument probe carries no score; installing an empty one is
        // the honest state, and stops the previous demo's curves resolving.
        timelineDocument: createEmptyTimelineDocument(),
        persist: false,
      });
    };
  }, [dispatch, installProject, session.detachForProbe]);

  // Import path shared by the file picker and the dev handle.
  useEffect(() => {
    (
      window as Window & { __importProject?: (json: string) => boolean }
    ).__importProject = (json: string) => {
      const outcome = deserializeProject(json);
      if (!outcome.state) {
        console.warn('[import] failed', outcome.issues);
        return false;
      }
      if (outcome.issues.length > 0) {
        console.warn('[import] warnings', outcome.issues);
      }
      // Ruling F5: an import becomes a NEW library file, never an overwrite
      // of the open one.
      void session.createAndOpen(
        session.snapshot.tree.rootId,
        'Imported',
        {
          state: outcome.state,
          timelineDocument:
            outcome.timelineDocument ?? createEmptyTimelineDocument(),
        },
        json,
      );
      return true;
    };
  }, [session.createAndOpen, session.snapshot.tree.rootId]);

  // Debug handle for the timeline (mirrors `window.__sound`).
  useEffect(() => {
    (window as Window & { __timeline?: unknown }).__timeline = {
      state: () => getTimelineTransport()?.getState() ?? null,
      t: () => getTimelineTransport()?.getPlayheadTime() ?? null,
      drivers: () => {
        const registry = getTimelineRegistry();
        if (!registry) return {};
        return Object.fromEntries(
          registry
            .getLiveDrivers()
            .map((driver) => [driver.curveId, driver.node.offset.value]),
        );
      },
      exportDocument: () => getTimelineStore().getDocument(),
      setDocument: (document: unknown) => {
        // Probe-only path; parseTimelineDocument throws on bad input.
        applyTimelineDocument(parseTimelineDocument(document));
      },
      /** Raw registry entries (node refs) — probe only. */
      _probeDrivers: () => getTimelineRegistry()?.getLiveDrivers() ?? [],
      /** The transport object itself — probe only. */
      _probeTransport: () => getTimelineTransport() ?? null,
      play: () => getTimelineTransport()?.play(),
      pause: () => getTimelineTransport()?.pause(),
      stop: () => getTimelineTransport()?.stop(),
      scrub: (timeSeconds: number) =>
        getTimelineTransport()?.scrub(timeSeconds),
    };
  }, []);

  // Saving: the open library file (auto-save / Ctrl+S) and this tab's crash
  // journal are both owned by `useLibrarySession`. The old single
  // localStorage autosave is no longer written — it is read once, for the
  // first-run migration.

  // Esc = panic silence — but never while typing/canceling in a widget
  // (the draw editor's capture listener stops its own Esc before this
  // bubble listener runs).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (event.defaultPrevented) return;
      if (isTypingElement(event.target)) return;
      stopEverything();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // If the context leaves 'running', re-show the overlay.
  useEffect(() => {
    return onContextStateChange((contextState) => {
      if (contextState !== 'running') setAudioReady(false);
    });
  }, []);

  // Keyboard bus, once audio is running.
  useEffect(() => {
    if (!audioReady) return;
    return installKeyboardBus();
  }, [audioReady]);

  // What the last run says about what is on the canvas right now. Derived from
  // the same signature auto-run uses, so the dot and the timer can never
  // disagree. Memoised on `state`: the reducer replaces the object on every
  // real change and never mutates it, so a cache hit is exact — and the walk
  // now covers every group subtree, not just the root scope.
  const currentSignature = useMemo(() => graphSignature(state), [state]);
  // Tutorials read live facts through these (see tutorials/kit.ts).
  const demosMenuOpenRef = useRef(false);
  tutorialSignals.demosMenuOpen = () => demosMenuOpenRef.current;
  useEffect(
    () =>
      onKeyBusEvent((event) => {
        if (event.type === 'down') tutorialKit.bus.emit('note.played', { key: event.key });
      }),
    [],
  );
  const freshness: RunFreshness =
    ranSignature === null
      ? 'none'
      : ranSignature === currentSignature
        ? 'fresh'
        : 'stale';
  tutorialSignals.graphHasRun = () => freshness === 'fresh';

  const runGraphNow = useCallback(() => {
    const runner = runnerRef.current;
    if (runner === null) return;
    // Never restart an execution that is already in flight — the host would
    // treat it as a resume, and a half-built audio graph would be replaced
    // mid-flight.
    const runnerState = runner.getRunnerState();
    if (runnerState === 'running' || runnerState === 'compiling') return;
    runner.run();
  }, []);

  // Auto-run. Every graph change re-arms one timer; when it fires and the run
  // would actually change something, the graph runs. The countdown is a
  // separate, cheap interval so the button can show the wait without the timer
  // itself re-rendering the app.
  useEffect(() => {
    window.clearTimeout(autoRunTimerRef.current);
    autoRunDeadlineRef.current = null;
    setAutoRunCountdown(null);
    // Every reason NOT to arm lives in `decideAutoRun` — see it for why.
    const decision = decideAutoRun({
      audioReady,
      // Paused while "Unsupported file" is shown: the graph under it is the
      // previous file's, and running it would be audio from a file the user
      // has left (L17).
      // …and while the landing stage covers the app: a graph nobody can see
      // must not start sounding (Back from the landing piano returns the
      // file under the stage; entering the app ran it mid-flight). It arms
      // the moment the black lifts.
      enabled: autoRunEnabled && !session.openFailure && !appHidden && session.editorOpen,
      freshness,
      runInFlight,
      delaySeconds: autoRunDelaySeconds,
    });
    if (decision.kind === 'idle') return;
    const delayMs = decision.delayMs;
    autoRunDeadlineRef.current = Date.now() + delayMs;
    autoRunTimerRef.current = window.setTimeout(() => {
      autoRunDeadlineRef.current = null;
      setAutoRunCountdown(null);
      runGraphNow();
    }, delayMs);
    const tick = window.setInterval(() => {
      const deadline = autoRunDeadlineRef.current;
      if (deadline === null) return;
      setAutoRunCountdown(Math.max(0, (deadline - Date.now()) / 1000));
    }, 200);
    return () => {
      window.clearTimeout(autoRunTimerRef.current);
      window.clearInterval(tick);
    };
  }, [
    audioReady,
    autoRunEnabled,
    autoRunDelaySeconds,
    freshness,
    currentSignature,
    runInFlight,
    runGraphNow,
    session.openFailure,
    appHidden,
    session.editorOpen,
  ]);

  // Loading a demo from the toolbar menu creates a NEW library file named
  // after it and opens it (ruling F5) — the open file is never overwritten.
  const loadDemo = useCallback(
    (demoId: string) => {
      // Synchronous, inside the click: the menu closes right after, and a
      // tutorial must see "picked" before it sees "closed".
      tutorialKit.bus.emit('demo.picked', { demoId });
      void session.createAndOpen(
        session.snapshot.tree.rootId,
        demoLabels.get(demoId) ?? demoId,
        {
          state:
            demoId === 'starter'
              ? initialSoundState
              : demoId in instrumentDemoBuilders
                ? instrumentDemoBuilders[demoId]()
                : buildProbeGraphState(demoId),
          // Empty for demos without a score — same semantics as import.
          timelineDocument:
            demoTimelineDocuments[demoId] ?? createEmptyTimelineDocument(),
        },
      ).then(() => tutorialKit.bus.emit('demo.loaded', { demoId }));
    },
    [session.createAndOpen, session.snapshot.tree.rootId],
  );

  // The landing page's "Play the piano": the struck-string piano demo on a
  // BORROWED canvas — the open file is settled and detached first, so the
  // piano is never written into the library (ruling Q2-b), and "Enter"
  // gives the file back. Persistence stays on (`persist: true`): suppressing
  // it is one-way, and with no file open nothing is saved anyway.
  const landingPianoRunPendingRef = useRef(false);
  // The loan in progress. Leaving waits for it: an "Enter" clicked while the
  // borrow is still waiting on the boot would otherwise return nothing, and
  // the piano would install AFTER it — over the app, file detached.
  const landingPianoLoanRef = useRef<Promise<void>>(Promise.resolve());
  // The meadow scenes play their own instrument the same way (2026-10-04):
  // the guitar under the oak, the Starry Pad under the sakura.
  const playLandingPiano = useCallback((instrument: LandingInstrument) => {
    landingPianoLoanRef.current = (async () => {
      await session.borrowCanvas();
      installProject({
        state: landingGraphState(instrument),
        timelineDocument: createEmptyTimelineDocument(),
        persist: true,
      });
      landingPianoRunPendingRef.current = true;
    })();
  }, [session.borrowCanvas, installProject]);
  const leaveLandingPiano = useCallback(async () => {
    await landingPianoLoanRef.current.catch(() => {});
    landingPianoRunPendingRef.current = false;
    await session.returnCanvas();
  }, [session.returnCanvas]);
  // Run the piano once it is installed and audio is up, even with auto-run
  // switched off — a piano that makes no sound is not a piano. Waits out a
  // run already in flight (`runGraphNow` would drop the request).
  useEffect(() => {
    if (!landingPianoRunPendingRef.current || !audioReady || runInFlight) return;
    landingPianoRunPendingRef.current = false;
    runGraphNow();
  }, [state, audioReady, runInFlight, runGraphNow]);

  async function handleStart() {
    setStarting(true);
    setStartError(undefined);
    try {
      await startAudio();
      setAudioReady(true);
      // The transport binds to the now-running context.
      setTimelineTransport(ensureTimelineRuntime());
      setMuted(isMonitorMuted()); // ?muted=1 auto-mute
    } catch (error) {
      setStartError(
        error instanceof Error ? error.message : 'Audio failed to start',
      );
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
    <div className={appHidden ? 'app-covered flex h-screen flex-col' : 'flex h-screen flex-col'}>
      <header className='flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-secondary-dark-gray bg-secondary-black px-3 py-1.5'>
        <button
          type='button'
          className={TOOLBAR_BUTTON_CLASS}
          aria-pressed={sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
          title={sidebarOpen ? 'Hide the graph library' : 'Show the graph library'}
        >
          ☰ Library
        </button>
        <button
          type='button'
          className={TOOLBAR_BUTTON_CLASS}
          aria-pressed={session.tabs.active === WELCOME_TAB}
          onClick={() => void session.openWelcome()}
          title='Demos, recent files and tips'
        >
          Welcome
        </button>
        <span
          className='max-w-[220px] truncate text-[13px] text-primary-light-gray'
          title={session.activeFileName ?? 'Not saved in the library'}
        >
          {session.activeFileName ?? 'Nodestra'}
        </span>
        <span data-tour='toolbar.octave' className='inline-flex'>
          <OctaveControl />
        </span>
        <button
          ref={stopButtonRef}
          type='button'
          className={TOOLBAR_BUTTON_CLASS}
          onClick={stopEverything}
          title='Stop: silence the build and stop the timeline (Esc)'
        >
          Stop
        </button>
        <span data-tour='toolbar.autoRun' className='inline-flex'>
        <AutoRunControl
          enabled={autoRunEnabled}
          onEnabledChange={setAutoRunEnabled}
          delaySeconds={autoRunDelaySeconds}
          onDelaySecondsChange={setAutoRunDelaySeconds}
          freshness={freshness}
          countdownSeconds={autoRunCountdown}
          onRunNow={runGraphNow}
        />
        </span>
        <AutoSaveControl
          enabled={session.autoSaveEnabled}
          onEnabledChange={(enabled) => session.setAutoSave({ enabled })}
          delaySeconds={session.autoSaveDelaySeconds}
          onDelaySecondsChange={(delaySeconds) =>
            session.setAutoSave({ delaySeconds })
          }
          status={session.saveStatus}
          pending={session.savePending}
          onSaveNow={session.saveNow}
        />
        <button
          type='button'
          className={TOOLBAR_BUTTON_CLASS}
          aria-pressed={muted}
          onClick={() => {
            const next = !muted;
            setMonitorMuted(next);
            setMuted(next);
          }}
          title='Mute the speakers only — meters and previews keep measuring'
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <button
          type='button'
          className={TOOLBAR_BUTTON_CLASS}
          aria-pressed={recordingUi}
          // The STOP path must stay clickable through a context drop.
          disabled={!audioReady && !recordingUi}
          onClick={async () => {
            if (isRecording()) {
              const blob = await stopRecording();
              setRecordingUi(false);
              if (blob) downloadBlob(blob, 'nodestra-recording.webm');
            } else {
              startRecording();
              setRecordingUi(true);
            }
          }}
          title='Record the master bus to a .webm file'
        >
          {recordingUi ? '■ Stop Rec' : '● Record'}
        </button>
        <DemosMenu
          onPick={loadDemo}
          onOpenChange={(open) => {
            demosMenuOpenRef.current = open;
            tutorialKit.bus.emit(open ? 'demosMenu.opened' : 'demosMenu.closed');
          }}
        />
        <button
          type='button'
          className={TOOLBAR_BUTTON_CLASS}
          onClick={() => downloadProject(state)}
          title='Export the project (graph + timeline) as one JSON file'
        >
          Export
        </button>
        <button
          type='button'
          className={TOOLBAR_BUTTON_CLASS}
          onClick={() => fileInputRef.current?.click()}
          title='Import a project JSON file'
        >
          Import
        </button>
        <input
          ref={fileInputRef}
          type='file'
          accept='application/json'
          style={{ display: 'none' }}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            const json = await file.text();
            const outcome = deserializeProject(json);
            if (!outcome.state) {
              window.alert(
                `Import failed:\n${outcome.issues.slice(0, 5).join('\n') || 'not a valid sound project file'}`,
              );
              return;
            }
            if (outcome.issues.length > 0) {
              // A degraded score is not a silent event — the project loads but
              // does not play what the file said.
              console.warn('[import] warnings', outcome.issues);
              window.alert(
                `Imported with issues:\n${outcome.issues.slice(0, 5).join('\n')}`,
              );
            }
            // Ruling F5: a new library file, named after the imported one.
            void session.createAndOpen(
              session.snapshot.tree.rootId,
              file.name,
              {
                state: outcome.state,
                timelineDocument:
                  outcome.timelineDocument ?? createEmptyTimelineDocument(),
              },
              json,
            );
          }}
        />
      </header>
      <div className='flex min-h-0 flex-1'>
      {sidebarOpen && (
        <SidebarErrorBoundary resetKey={session.snapshot.mode.kind}>
        <FileSidebar
          snapshot={session.snapshot}
          activeFileId={session.activeFileId}
          isDirty={session.isDirty}
          readOnly={session.readOnly}
          folderActionsDisabled={session.folderActionsDisabled}
          canLinkFolders={session.canLinkFolders}
          onOpen={(fileId) => void session.openFile(fileId)}
          onNewFile={(parentId) => void session.newFile(parentId)}
          onNewFolder={(parentId) => void session.newFolder(parentId)}
          onRename={session.rename}
          onMove={session.move}
          onDelete={session.remove}
          onUndoDelete={session.undoDelete}
          onLink={() => void session.link()}
          onUnlink={() => void session.unlink()}
          onReconnect={() => void session.reconnect()}
          onDismissError={session.dismissError}
          onDismissNotice={session.dismissNotice}
          renameRequest={session.renameRequest}
          onRenameRequestHandled={session.clearRenameRequest}
        />
        </SidebarErrorBoundary>
      )}
      <div className='relative flex min-w-0 flex-1 flex-col'>
      <TabStrip
        order={session.tabs.order}
        active={session.tabs.active}
        label={session.tabName}
        isDirty={session.isDirty}
        isMissing={session.isTabMissing}
        onActivate={(id) => void session.activateTab(id)}
        onClose={(ids) => void session.closeTabs(ids)}
        onCloseOthers={(id) => void session.closeOtherTabs(id)}
        onCloseRight={(id) => void session.closeTabsToTheRight(id)}
        onCloseSaved={() => void session.closeSavedTabs()}
        onCloseAll={() => void session.closeAllTabs()}
        onReorder={session.reorderTab}
        onReopen={() => void session.reopenClosedTab()}
        panelId='editor-panel'
      />
      {session.detachedOpen &&
        !session.activeFileId &&
        !session.openFailure &&
        session.snapshot.mode.kind !== 'loading' && (
          <div className='flex flex-none items-center gap-3 border-b border-secondary-dark-gray bg-primary-dark-gray px-3 py-1 text-[12px] text-primary-light-gray'>
            <span className='mr-auto'>
              {session.snapshot.mode.kind === 'reconnect'
                ? 'The linked folder needs reconnecting before this graph can be saved.'
                : 'This graph is not saved in the library.'}
            </span>
            {!session.readOnly && (
              <button
                type='button'
                className={TOOLBAR_BUTTON_CLASS}
                onClick={() =>
                  void session.createAndOpen(
                    session.snapshot.tree.rootId,
                    'Untitled',
                    null,
                  )
                }
              >
                Save to library
              </button>
            )}
          </div>
        )}
      {session.conflict && (
        <div
          role='alert'
          className='flex flex-none items-center gap-3 border-b border-status-warning/60 bg-status-warning/15 px-3 py-1 text-[12px] text-primary-white'
        >
          <span className='mr-auto'>
            “{session.conflict.name}” was changed on disk outside the app.
            Saving is paused.
          </span>
          <button
            type='button'
            className={TOOLBAR_BUTTON_CLASS}
            onClick={() => void session.overwriteConflict()}
            title='Replace the file on disk with what is on the canvas'
          >
            Overwrite with canvas
          </button>
          <button
            type='button'
            className={TOOLBAR_BUTTON_CLASS}
            onClick={() => void session.reloadConflict()}
            title='Discard the canvas edits and load the version on disk'
          >
            Reload from disk
          </button>
        </div>
      )}
      {!session.editorOpen && session.tabs.active === WELCOME_TAB ? (
        <div id='editor-panel' role='tabpanel' aria-labelledby={`tab-${WELCOME_TAB}`} className='min-h-0 flex-1'>
          <WelcomePage
            recentFiles={session.recentFiles.map((id) => ({ id, name: session.tabName(id) }))}
            demos={WELCOME_DEMOS}
            tutorials={tutorials.map((tutorial) => ({
              id: tutorial.id,
              title: tutorial.title,
              minutes: tutorial.estimatedMinutes ?? 1,
              done: tutorialProgressVersion >= 0 && tutorialProgress.isCompleted(tutorial.id),
            }))}
            canCreate={!session.readOnly}
            canLinkFolders={session.canLinkFolders && !session.folderActionsDisabled && session.snapshot.mode.kind === 'memory'}
            showOnStartup={showWelcome}
            onShowOnStartupChange={(value) => {
              writeShowWelcome(value);
              setShowWelcome(value);
            }}
            onNewGraph={() => void session.newFile(session.snapshot.tree.rootId)}
            onImport={() => fileInputRef.current?.click()}
            onLinkFolder={() => void session.link()}
            onOpenFile={(id) => void session.openFile(id)}
            onOpenDemo={loadDemo}
            onStartTutorial={startTutorial}
          />
        </div>
      ) : !session.editorOpen ? (
        <div id='editor-panel' role='tabpanel' className='min-h-0 flex-1'>
          <EmptyEditor
            canCreate={!session.readOnly}
            canReopen={session.tabs.closed.length > 0}
            onNewGraph={() => void session.newFile(session.snapshot.tree.rootId)}
            onReopen={() => void session.reopenClosedTab()}
            onOpenWelcome={() => void session.openWelcome()}
          />
        </div>
      ) : (
      <TimelineProvider store={getTimelineStore()} transport={timelineTransport}>
        {/* `[&>*]:h-full` hands the graph the definite height ReactFlow needs. */}
        <div
          id='editor-panel'
          data-tour='editor'
          role='tabpanel'
          aria-labelledby={session.tabs.active ? `tab-${session.tabs.active}` : undefined}
          className='min-h-0 flex-1 [&>*]:h-full'
        >
          <FullGraph
            state={state}
            dispatch={dispatch}
            functionImplementations={soundImplementations}
            inputComponents={inputComponents}
            nodePreviews={previewRegistry}
            bottomDrawers={bottomDrawers}
            runnerRef={runnerRef}
            executionRecord={executionRecord}
            onRunEvent={(event: RunEvent) => {
              const pending = pendingRunSignaturesRef.current;
              runInFlightRef.current = event.kind === 'run:started';
              switch (event.kind) {
                case 'run:started':
                  // Snapshot HERE, not when the record arrives: the record
                  // lands after every await in the run, by which time the user
                  // may have edited the graph — stamping then would declare a
                  // graph fresh that was never run.
                  pending.set(event.runId, graphSignature(stateRef.current));
                  setRunInFlight(true);
                  break;
                case 'run:completed': {
                  const signature = pending.get(event.runId);
                  pending.delete(event.runId);
                  if (signature !== undefined) setRanSignature(signature);
                  setRunInFlight(false);
                  break;
                }
                case 'run:aborted':
                  // That snapshot describes a graph nothing ever finished
                  // running, so it must never be stamped.
                  pending.delete(event.runId);
                  setRunInFlight(false);
                  if (event.reason === 'stopped') {
                    // Silence what the halted run had already built. Without
                    // this the runner panel's Stop and Reset left the partial
                    // graph sounding until the next run — only the header Stop
                    // and Esc ever silenced anything.
                    disposeBuild();
                    // A halt the USER asked for has to stay halted, or auto-run
                    // re-arms on the still-stale graph a second later and Stop
                    // does nothing. A halt the APP asked for (replacing the
                    // project) must not touch the user's preference.
                    if (event.initiator !== 'consumer') setAutoRunEnabled(false);
                  }
                  // `'failed'` deliberately does NOT disable auto-run: a graph
                  // that does not compile is a mis-wire to fix, not a halt the
                  // user asked for.
                  break;
                case 'run:reset':
                  pending.clear();
                  setRanSignature(null);
                  setRunInFlight(false);
                  // Reset must silence. It cannot be identity-guarded (the
                  // event carries no runId) and it does not need to be: the
                  // panel's Reset is only enabled once the run has finished,
                  // so `run:aborted` never fires for it and this is the ONLY
                  // chance to stop the completed build still sounding.
                  disposeBuild();
                  if (event.initiator !== 'consumer') setAutoRunEnabled(false);
                  break;
              }
            }}
            onExecutionRecordChange={(record) => {
              setExecutionRecord(record);
              // NB: no signature stamping here. This callback is the controlled
              // record SETTER — it fires identically for a run starting, a
              // reset and a run finishing — so it cannot tell what actually
              // ran. `onRunEvent` above can.
              // Probe-only: the latest record, errored steps included.
              (
                window as Window & { __executionRecord?: unknown }
              ).__executionRecord = record;
              // endBuild trigger — coalesced downstream, so per-step
              // chatter costs one flush per frame at most.
              getTimelineTransport()?.notifyBuildEnded();
              // Failed runs end silent — but only once the run has ENDED.
              // In step-by-step mode a fresh record object arrives after every
              // step, which defeats the identity dedupe below, so a single
              // errored step used to dispose on every subsequent step. That is
              // now actively harmful: disposing a build retires its run's
              // token, so every remaining step would throw `BuildKilledError`
              // and one mis-wired node would bury itself under thirty fake
              // errors. The run's own terminal event disposes exactly once.
              if (
                record &&
                !runInFlightRef.current &&
                record !== handledErrorRecordRef.current &&
                record.steps.some((step) => step.status === 'errored')
              ) {
                handledErrorRecordRef.current = record;
                disposeBuild();
              }
            }}
          />
        </div>
      </TimelineProvider>
      )}
      {session.openFailure && (
        // In place of the graph, not over the whole app: the library stays
        // clickable, so another file is one click away.
        <div
          role='status'
          className='absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-primary-black/95 px-6 text-center'
        >
          <p className='text-[18px] text-primary-white'>Unsupported file</p>
          <p className='text-[13px] text-primary-light-gray'>
            “{session.openFailure.name}” could not be opened as a sound graph.
          </p>
          <p className='max-w-[520px] text-[12px] break-words text-secondary-light-gray'>
            {session.openFailure.detail}
          </p>
          <p className='text-[12px] text-primary-light-gray'>
            The file is left exactly as it is. Pick another file in the library.
          </p>
        </div>
      )}
      </div>
      </div>
    </div>
      <Toaster paused={appHidden} />
      {!appHidden && (
        <TutorialLayer
          controller={tutorialController}
          view={tutorialView}
          offer={tutorialOffer && !tutorialController}
          onOfferTutorial={() => startTutorial(FIRST_TUTORIAL_ID)}
          onOfferJustOpen={() => {
            writeOffered();
            setTutorialOffer(false);
            loadDemo('piano');
          }}
          onOfferDismiss={() => {
            writeOffered();
            setTutorialOffer(false);
          }}
        />
      )}
      {unsavedDialog.element}
      {stageShown && (
        <Suspense
          fallback={
            audioReady ? null : (
            <div className='fixed inset-0 z-1000 flex flex-col items-center justify-center gap-4 bg-primary-black/95'>
              <button
                type='button'
                className='start-overlay-button cursor-pointer rounded-lg border border-secondary-light-gray bg-primary-dark-gray px-8 py-4 text-[20px] text-primary-white hover:bg-secondary-dark-gray'
                disabled={starting}
                onClick={handleStart}
              >
                {starting ? 'Starting audio…' : 'Click to start audio'}
              </button>
              <p className='text-[13px] text-primary-light-gray'>
                {startError
                  ? `Start failed: ${startError} — click to retry.`
                  : 'Browsers require a real click before any sound can play.'}
              </p>
            </div>
            )
          }
        >
          <StageLanding
            audioReady={audioReady}
            starting={starting}
            startError={startError}
            onStart={() => void handleStart()}
            onPlayInstrument={(instrument) => {
              // Audio first, inside the click: browsers only allow it there.
              void handleStart();
              playLandingPiano(instrument);
            }}
            onLeavePiano={leaveLandingPiano}
            onCoveringChange={setStageCovering}
            onDone={hideStage}
          />
        </Suspense>
      )}
    </>
  );
}

export { App };

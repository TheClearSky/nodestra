/**
 * The app side of the graph library: which file is open, how it opens, when
 * it saves, and how the library's operations stay consistent with the canvas.
 *
 * Kept out of `App.tsx` so the rules read in one place. The pieces:
 *  - GraphLibrary  — the tree and its storage (memory or a linked folder)
 *  - SaveController — saves the OPEN file, addressed by id (never "whatever
 *    file is open when a timer fires")
 *  - this hook     — opening, the unsupported-file outcome, change
 *    detection, the per-tab journal, boot, demos/import creating new files.
 *
 * Every rule below is traceable to review/2026-09-26-library/TRIAGE.md.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { MutableRefObject } from 'react';
import type { TimelineDocument } from '@theclearsky/react-blender-nodes-timeline';
import { createEmptyTimelineDocument } from '@theclearsky/react-blender-nodes-timeline';
import { canLinkFolders, ConflictError } from './backends';
import { GraphLibrary } from './graphLibrary';
import { createIndexedDbStore, createMemoryStore } from './keyValueStore';
import type { KeyValueStore } from './keyValueStore';
import { findByPath, isGraphFile, pathOf, subtreeIds } from './libraryTree';
import { splitExtension, toGraphFileName } from './names';
import { SaveController } from './saveController';
import type { SaveSettings } from './saveController';
import {
  clearJournal,
  deserializeProject,
  getBootJournalPath,
  loadJournal,
  markLibraryInitializedSync,
  persistenceDisabled,
  projectSignature,
  saveJournal,
  serializeProject,
} from '../appPersistence';
import { getTimelineStore } from '../timeline/timelineSystem';
import type { initialSoundState } from '../soundDefinitions/demoState';
import { activeAfterClose, emptyTabs, othersOf, rightOf, tabsReducer, WELCOME_TAB } from '../tabs/tabsModel';
import type { TabsAction, TabsState } from '../tabs/tabsModel';

type SoundState = typeof initialSoundState;

type InstallProject = (project: {
  state: SoundState;
  timelineDocument: TimelineDocument;
  persist: boolean;
}) => void;

/** Why the canvas is showing "unsupported file" instead of a graph. */
type OpenFailure = { fileId: string; name: string; detail: string };

/** The open file changed on disk outside the app; saving is paused. */
type SaveConflict = { fileId: string; name: string };

type LibrarySessionOptions = {
  state: SoundState;
  stateRef: MutableRefObject<SoundState>;
  installProject: InstallProject;
  /** Silence the audio of the graph being left for an unsupported file. */
  silence(): void;
  /** Starter content for "New graph". */
  newGraphState(): SoundState;
  /** Did the first render show an old localStorage autosave? */
  bootShowedLegacyAutosave: boolean;
  /** Closing tabs with unsaved edits: the user chooses. */
  confirmUnsaved(names: readonly string[]): Promise<'save' | 'discard' | 'cancel'>;
  /** Startup opened something on its own (restored tabs, a crash journal,
   *  migrated work) — ruling Q7: the app turns auto-run off and says so. */
  onStartupOpened(count: number): void;
  /** "Show Welcome on startup" (on by default). */
  showWelcomeOnStartup(): boolean;
  /** The very first visit (nothing was ever stored) — the guide may offer
   *  its first tutorial (ruling Q14). */
  onFirstVisit(): void;
};

/** Recently opened files, newest first, for the Welcome page. */
const MAX_RECENT = 8;

/** One tab's editor, kept in memory while another tab is shown: the full
 *  state INCLUDING undo/redo and viewport, plus its score. Never written. */
type TabSnapshot = {
  state: SoundState;
  timeline: TimelineDocument;
  /** What the FILE said (content signature) when this copy was taken — the
   *  copy is reused only while the file still says that. Compared file to
   *  file, never copy to file: loading normalises the score, so a copy never
   *  serialises byte-for-byte like the file it came from. */
  fileSignature: string | null;
};

/** Undo/redo entries kept per inactive tab (plan §B). */
const SNAPSHOT_HISTORY_CAP = 50;

const isPageTab = (id: string) => id.startsWith('@');

/** How long edits must settle before "did the content change?" is asked. */
const CHANGE_SETTLE_MS = 300;
/** The journal's own debounce. */
const JOURNAL_DELAY_MS = 800;

function openStore(): KeyValueStore {
  // A failure on first USE is handled by the library's own probe.
  try {
    if (typeof indexedDB !== 'undefined') return createIndexedDbStore();
  } catch {
    // fall through
  }
  return createMemoryStore();
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function useLibrarySession(options: LibrarySessionOptions) {
  const {
    state,
    stateRef,
    installProject,
    silence,
    newGraphState,
    bootShowedLegacyAutosave,
    confirmUnsaved,
    onStartupOpened,
    showWelcomeOnStartup,
    onFirstVisit,
  } = options;
  const readOnlySession = useMemo(() => persistenceDisabled(), []);
  const [probeActive, setProbeActive] = useState(false);

  // ONE instance for the component's life. Not `useMemo`: React Fast Refresh
  // re-runs every useMemo on a hot update while refs keep their values, so a
  // dev-server hot swap minted a fresh library stuck in 'loading' — boot had
  // already run (`bootedRef`) and never initialised it: the sidebar said
  // "Loading…" forever and every tab looked missing (2026-09-27).
  const [library] = useState(() => new GraphLibrary({ store: openStore() }));
  const snapshot = useSyncExternalStore(library.subscribe, library.getSnapshot);

  const [openFailure, setOpenFailure] = useState<OpenFailure | null>(null);
  const [conflict, setConflict] = useState<SaveConflict | null>(null);
  const [renameRequest, setRenameRequest] = useState<string | null>(null);

  // ── tabs ─────────────────────────────────────────────────────────────
  //
  // The strip's state is a pure reducer (`tabs/tabsModel`); a ref mirrors it
  // because the async flows below read it between awaits.
  const [tabs, setTabs] = useState<TabsState>(emptyTabs);
  const tabsRef = useRef<TabsState>(emptyTabs);
  const dispatchTabs = useCallback((action: TabsAction) => {
    const next = tabsReducer(tabsRef.current, action);
    if (next === tabsRef.current) return;
    tabsRef.current = next;
    setTabs(next);
  }, []);
  const snapshotsRef = useRef(new Map<string, TabSnapshot>());
  /** Content signature of each file as last read or written by the app. */
  const fileSignaturesRef = useRef(new Map<string, string | null>());
  /** Last name each tab's file had — a file deleted outside the app keeps
   *  its tab (struck through) and its label. */
  const tabNamesRef = useRef(new Map<string, string>());
  const openFailureRef = useRef<OpenFailure | null>(null);
  openFailureRef.current = openFailure;
  /** The editor shows content that is not a library file (a failed create,
   *  a probe, the landing piano). */
  const [detachedOpen, setDetachedOpen] = useState(false);
  const [recent, setRecent] = useState<readonly string[]>([]);
  const recentRef = useRef<readonly string[]>([]);
  const noteRecent = useCallback((fileId: string) => {
    const next = [fileId, ...recentRef.current.filter((id) => id !== fileId)].slice(0, MAX_RECENT);
    recentRef.current = next;
    setRecent(next);
  }, []);

  // ── content signatures ───────────────────────────────────────────────
  //
  // "Has the open file changed?" is answered by CONTENT, not by counting
  // state changes. The old rule — swallow exactly one change after an
  // install — was fooled by the editor's own first measurement and fitView,
  // which marked every freshly opened demo unsaved and rewrote it (C1).
  // `baselineRef` is the signature of what the file on storage holds.
  const baselineRef = useRef<string | null>(null);
  const liveSignature = useCallback(
    () => projectSignature(serializeProject(stateRef.current)),
    [stateRef],
  );

  // Files that opened with warnings keep their original bytes on the FIRST
  // real save: a `(original)` sibling. Kept until the backup exists (B10).
  const originalsRef = useRef(new Map<string, string>());

  const writeFile = useCallback(
    async (fileId: string, text: string, writeOptions?: { force?: boolean }) => {
      const original = originalsRef.current.get(fileId);
      if (original !== undefined) {
        const node = library.tree.nodes[fileId];
        if (node) {
          const { stem } = splitExtension(node.name);
          // Throws → the save fails and the edit stays unsaved; the backup
          // is never silently dropped.
          await library.createFile(
            node.parentId ?? library.tree.rootId,
            `${stem} (original).json`,
            original,
          );
        }
        originalsRef.current.delete(fileId);
      }
      await library.writeText(fileId, text, writeOptions);
    },
    [library],
  );

  const saveControllerRef = useRef<SaveController | null>(null);
  // Same reason as `library`: one controller for the component's life (a
  // replaced controller loses the file it is saving). Its callbacks read
  // refs, so they stay current without re-creating it.
  const writeFileRef = useRef(writeFile);
  writeFileRef.current = writeFile;
  const [saveController] = useState(
    () =>
      new SaveController({
        serialize: () => serializeProject(stateRef.current),
        write: async (fileId, text, writeOptions) => {
          try {
            await writeFileRef.current(fileId, text, writeOptions);
          } catch (error) {
            // A linked file changed on disk: pause saving and let the user
            // choose, instead of a confirm popping up from a timer (D2).
            if (error instanceof ConflictError) {
              setConflict({
                fileId,
                name: library.tree.nodes[fileId]?.name ?? error.fileName,
              });
            }
            throw error;
          }
          fileSignaturesRef.current.set(fileId, projectSignature(text));
          if (fileId === saveControllerRef.current?.activeFileId) {
            baselineRef.current = projectSignature(text);
          }
        },
      }),
  );
  saveControllerRef.current = saveController;
  useSyncExternalStore(saveController.subscribe, saveController.getVersion);

  // While a conflict is unresolved nothing is written to that file.
  useEffect(() => {
    if (conflict && saveController.activeFileId === conflict.fileId) {
      saveController.setWritable(false);
    }
  }, [conflict, saveController]);

  // ── the journal ──────────────────────────────────────────────────────

  const journalTimerRef = useRef<number | undefined>(undefined);
  const writeJournalNow = useCallback(() => {
    window.clearTimeout(journalTimerRef.current);
    journalTimerRef.current = undefined;
    const active = saveController.activeFileId;
    if (
      persistenceDisabled() ||
      !active ||
      !saveController.isActiveWritable ||
      !library.tree.nodes[active]
    ) {
      return;
    }
    saveJournal(pathOf(library.tree, active), serializeProject(stateRef.current));
  }, [saveController, library, stateRef]);
  const scheduleJournal = useCallback(() => {
    window.clearTimeout(journalTimerRef.current);
    journalTimerRef.current = window.setTimeout(writeJournalNow, JOURNAL_DELAY_MS);
  }, [writeJournalNow]);
  useEffect(() => {
    const onPageHide = () => writeJournalNow();
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [writeJournalNow]);

  // ── change detection ─────────────────────────────────────────────────

  const installingRef = useRef(false);
  const lastSeenStateRef = useRef(state);
  const compareTimerRef = useRef<number | undefined>(undefined);

  const onProjectChanged = useCallback(() => {
    if (!saveController.isActiveWritable) return;
    scheduleJournal();
    const active = saveController.activeFileId;
    if (active && saveController.isDirty(active)) {
      saveController.markChanged(); // already unsaved: just re-arm
      return;
    }
    // Clean: compare content once edits settle (a drag emits a change per
    // frame; serialising per frame would stutter).
    window.clearTimeout(compareTimerRef.current);
    compareTimerRef.current = window.setTimeout(() => {
      if (!saveController.isActiveWritable) return;
      const signature = liveSignature();
      if (baselineRef.current === null) {
        // First settle after an open or create: this IS the file's content.
        baselineRef.current = signature;
        return;
      }
      if (signature !== baselineRef.current) saveController.markChanged();
    }, CHANGE_SETTLE_MS);
  }, [saveController, scheduleJournal, liveSignature]);

  useEffect(() => {
    if (state === lastSeenStateRef.current) return;
    lastSeenStateRef.current = state;
    onProjectChanged();
  }, [state, onProjectChanged]);

  useEffect(
    () =>
      getTimelineStore().subscribe(() => {
        if (!installingRef.current) onProjectChanged();
      }),
    [onProjectChanged],
  );

  /** Put a project on the canvas. Its content becomes the baseline once the
   *  editor has settled (measurement, fitView). */
  const install = useCallback(
    (project: { state: SoundState; timelineDocument: TimelineDocument; preserveHistory?: boolean }) => {
      baselineRef.current = null;
      installingRef.current = true;
      try {
        installProject({ ...project, persist: true });
      } finally {
        installingRef.current = false;
      }
    },
    [installProject],
  );

  // Flush the open file before anything moves, renames or deletes it. The
  // library calls this OUTSIDE its queue (A1).
  useEffect(() => {
    library.beforeMutate = async (ids) => {
      const active = saveController.activeFileId;
      if (active !== null && ids.includes(active)) await saveController.flush();
    };
  }, [library, saveController]);

  const rememberOpen = useCallback(
    (fileId: string | null) => {
      if (persistenceDisabled()) return;
      void library.rememberActiveFile(fileId);
      if (fileId === null) clearJournal();
      else scheduleJournal();
    },
    [library, scheduleJournal],
  );

  /** Detach the canvas from any file (it keeps showing what it shows). */
  const detach = useCallback(async () => {
    await saveController.switchTo(null, false);
    baselineRef.current = null;
    setConflict(null);
    clearJournal();
  }, [saveController]);

  // ── opening ──────────────────────────────────────────────────────────

  const openTokenRef = useRef(0);

  /**
   * Keep the editor's current file in memory before another tab replaces it:
   * the state with its undo/redo (capped) and viewport, and its score. Not
   * for an unsupported file — the editor under that overlay shows the
   * PREVIOUS file.
   */
  const captureActive = useCallback(() => {
    const active = saveController.activeFileId;
    if (!active || openFailureRef.current?.fileId === active) return;
    const current = stateRef.current;
    const history = current.history;
    const capped =
      history &&
      (history.undoStack.length > SNAPSHOT_HISTORY_CAP || history.redoStack.length > SNAPSHOT_HISTORY_CAP)
        ? {
            ...history,
            undoStack: history.undoStack.slice(-SNAPSHOT_HISTORY_CAP),
            redoStack: history.redoStack.slice(-SNAPSHOT_HISTORY_CAP),
          }
        : history;
    snapshotsRef.current.set(active, {
      state: capped === history ? current : { ...current, history: capped },
      timeline: getTimelineStore().getDocument(),
      fileSignature: fileSignaturesRef.current.get(active) ?? null,
    });
  }, [saveController, stateRef]);

  /** Open a library file on the canvas. A JSON file that is not a project
   *  shows "unsupported" in place of the graph and blocks nothing else. */
  const openFile = useCallback(
    async (fileId: string, openOptions: { force?: boolean } = {}) => {
      const node = library.tree.nodes[fileId];
      if (!node || !isGraphFile(node)) return;
      if (!openOptions.force && fileId === saveController.activeFileId && !openFailure) {
        return;
      }
      const token = ++openTokenRef.current;
      if (saveController.activeFileId !== fileId) captureActive();
      // Settle the file being left while its content is still on the canvas.
      await saveController.switchTo(fileId, false);
      setConflict(null);
      const buffered = saveController.takeBuffer(fileId);
      let text = buffered;
      if (text === undefined) {
        try {
          text = await library.readText(fileId);
        } catch (error) {
          if (token !== openTokenRef.current) return;
          silence();
          setOpenFailure({
            fileId,
            name: node.name,
            detail: error instanceof Error ? error.message : 'It could not be read.',
          });
          return;
        }
      }
      if (token !== openTokenRef.current) {
        // Another click won: give back the buffer we took (C2).
        if (buffered !== undefined) saveController.restoreBuffer(fileId, buffered);
        return;
      }
      const outcome = deserializeProject(text);
      if (!outcome.state) {
        library.markUnsupported(fileId, true);
        silence();
        setOpenFailure({
          fileId,
          name: node.name,
          detail: outcome.issues.slice(0, 3).join(' · ') || 'It is not a sound graph file.',
        });
        return;
      }
      library.markUnsupported(fileId, false);
      setOpenFailure(null);
      setDetachedOpen(false);
      // Switching back to a tab: its in-memory copy (undo/redo, viewport) is
      // used when it still says what the file says — always for unsaved
      // edits (the buffer IS that copy), and for a clean file only when the
      // file was not changed outside the app meanwhile (a linked folder).
      const kept = snapshotsRef.current.get(fileId);
      const fileSignature = buffered === undefined ? projectSignature(text) : undefined;
      if (fileSignature !== undefined) fileSignaturesRef.current.set(fileId, fileSignature);
      const keptMatches =
        kept !== undefined &&
        (buffered !== undefined || (kept.fileSignature !== null && kept.fileSignature === fileSignature));
      if (kept && keptMatches) {
        install({ state: kept.state, timelineDocument: kept.timeline, preserveHistory: true });
      } else {
        snapshotsRef.current.delete(fileId);
        install({
          state: outcome.state,
          timelineDocument: outcome.timelineDocument ?? createEmptyTimelineDocument(),
        });
      }
      if (outcome.issues.length > 0 && buffered === undefined) {
        originalsRef.current.set(fileId, text);
      }
      saveController.setWritable(library.writable && !persistenceDisabled());
      if (buffered !== undefined) {
        // The buffer is newer than the file: unsaved from the start.
        saveController.markChanged();
      }
      rememberOpen(fileId);
    },
    [library, saveController, openFailure, install, silence, rememberOpen, captureActive],
  );

  /**
   * Create a library file and make it the open one. With a `project`, it is
   * installed on the canvas; without one (Save to library), the canvas is
   * already showing it and is not reinstalled (L16). If the library cannot
   * take the file, the project STILL loads — detached — because the user's
   * click must always do what it asked (L6 / F1).
   */
  const createAndOpen = useCallback(
    async (
      parentId: string,
      title: string,
      project: { state: SoundState; timelineDocument: TimelineDocument } | null,
      text?: string,
    ): Promise<string | null> => {
      const loadDetached = async () => {
        openTokenRef.current += 1;
        captureActive();
        await detach();
        setOpenFailure(null);
        if (project) {
          install(project);
          setDetachedOpen(true);
        }
        return null;
      };
      if (!library.writable || persistenceDisabled()) return loadDetached();
      const body =
        text ??
        (project
          ? serializeProject(project.state, project.timelineDocument)
          : serializeProject(stateRef.current));
      let id: string;
      try {
        id = await library.createFile(parentId, toGraphFileName(title), body);
      } catch {
        return loadDetached(); // the sidebar shows why
      }
      openTokenRef.current += 1;
      captureActive();
      fileSignaturesRef.current.set(id, projectSignature(body));
      await saveController.switchTo(id, true);
      setOpenFailure(null);
      setConflict(null);
      setDetachedOpen(false);
      dispatchTabs({ type: 'open', id });
      noteRecent(id);
      if (project) {
        install(project);
      } else {
        baselineRef.current = projectSignature(body);
      }
      rememberOpen(id);
      return id;
    },
    [library, saveController, install, rememberOpen, detach, stateRef, captureActive, dispatchTabs, noteRecent],
  );

  // ── tab operations ───────────────────────────────────────────────────

  /** Nothing is open: the editor goes away (the app shows the empty page),
   *  and the audio build of the last file is disposed with an empty graph. */
  const closeEditor = useCallback(async () => {
    openTokenRef.current += 1;
    await saveController.switchTo(null, false);
    baselineRef.current = null;
    setConflict(null);
    setOpenFailure(null);
    setDetachedOpen(false);
    clearJournal();
    install({ state: newGraphState(), timelineDocument: createEmptyTimelineDocument() });
    void library.rememberActiveFile(null);
  }, [saveController, install, newGraphState, library]);

  /** Show `id` in the editor (its tab must already exist). */
  const showTab = useCallback(
    async (id: string | null) => {
      if (id === null || isPageTab(id)) {
        captureActive();
        await closeEditor();
        return;
      }
      await openFile(id, { force: saveController.activeFileId !== id });
    },
    [captureActive, closeEditor, openFile, saveController],
  );

  /** Open a file in a tab (or focus its tab). */
  const openTab = useCallback(
    async (fileId: string) => {
      const node = library.tree.nodes[fileId];
      if (!node || !isGraphFile(node)) return;
      tabNamesRef.current.set(fileId, node.name);
      dispatchTabs({ type: 'open', id: fileId });
      noteRecent(fileId);
      await openFile(fileId);
    },
    [library, dispatchTabs, openFile, noteRecent],
  );

  /** The Welcome page, as a tab (one at most). */
  const openWelcome = useCallback(async () => {
    dispatchTabs({ type: 'open', id: WELCOME_TAB });
    await showTab(WELCOME_TAB);
  }, [dispatchTabs, showTab]);

  const activateTab = useCallback(
    async (id: string) => {
      if (!tabsRef.current.order.includes(id) || tabsRef.current.active === id) return;
      dispatchTabs({ type: 'activate', id });
      if (!isPageTab(id) && !library.tree.nodes[id]) {
        // Deleted outside the app: show its last in-memory copy, detached.
        const kept = snapshotsRef.current.get(id);
        captureActive();
        await detach();
        if (kept) {
          install({ state: kept.state, timelineDocument: kept.timeline, preserveHistory: true });
          setDetachedOpen(true);
        }
        return;
      }
      await showTab(id);
    },
    [dispatchTabs, library, captureActive, detach, install, showTab],
  );

  /**
   * Close tabs. Unsaved ones ask first (Save / Don't save / Cancel). The
   * closing files are forgotten BEFORE the editor switches, so "Don't save"
   * is never undone by the switch's own save of the file being left.
   */
  const closeTabs = useCallback(
    async (ids: readonly string[]) => {
      const current = tabsRef.current;
      const closing = ids.filter((id) => current.order.includes(id));
      if (closing.length === 0) return;
      const dirty = closing.filter((id) => !isPageTab(id) && saveController.isDirty(id));
      if (dirty.length > 0) {
        const names = dirty.map((id) => library.tree.nodes[id]?.name ?? tabNamesRef.current.get(id) ?? 'Untitled');
        const choice = await confirmUnsaved(names);
        if (choice === 'cancel') return;
        if (choice === 'save') {
          try {
            for (const id of dirty) {
              if (id === saveController.activeFileId) await saveController.save();
              else await saveController.saveBuffered(id);
            }
          } catch {
            return; // still unsaved: the tab stays open
          }
        }
      }
      const activeClosing = current.active !== null && closing.includes(current.active);
      const next = activeAfterClose(tabsRef.current, closing);
      saveController.forget(closing.filter((id) => !isPageTab(id)));
      for (const id of closing) snapshotsRef.current.delete(id);
      dispatchTabs({ type: 'close', ids: closing });
      if (activeClosing) await showTab(next);
    },
    [saveController, library, confirmUnsaved, dispatchTabs, showTab],
  );

  const closeOtherTabs = useCallback((id: string) => closeTabs(othersOf(tabsRef.current, id)), [closeTabs]);
  const closeTabsToTheRight = useCallback((id: string) => closeTabs(rightOf(tabsRef.current, id)), [closeTabs]);
  const closeSavedTabs = useCallback(
    () => closeTabs(tabsRef.current.order.filter((id) => isPageTab(id) || !saveController.isDirty(id))),
    [closeTabs, saveController],
  );
  const closeAllTabs = useCallback(() => closeTabs(tabsRef.current.order), [closeTabs]);

  const reorderTab = useCallback(
    (id: string, toIndex: number) => dispatchTabs({ type: 'reorder', id, toIndex }),
    [dispatchTabs],
  );

  const reopenClosedTab = useCallback(async () => {
    const before = tabsRef.current;
    dispatchTabs({
      type: 'reopen',
      canReopen: (id) => isPageTab(id) || (!!library.tree.nodes[id] && isGraphFile(library.tree.nodes[id])),
    });
    const after = tabsRef.current;
    if (after !== before && after.active !== null) await showTab(after.active);
  }, [dispatchTabs, library, showTab]);

  /** Files that are gone for good (deleted in the app, or a new folder
   *  linked): their tabs close without asking — the deletion was confirmed. */
  const dropTabs = useCallback(
    async (ids: readonly string[]) => {
      const current = tabsRef.current;
      const gone = ids.filter((id) => current.order.includes(id));
      if (gone.length === 0) return;
      const activeGone = current.active !== null && gone.includes(current.active);
      const next = activeAfterClose(current, gone);
      for (const id of gone) snapshotsRef.current.delete(id);
      dispatchTabs({ type: 'close', ids: gone });
      if (activeGone) await showTab(next);
    },
    [dispatchTabs, showTab],
  );


  // ── tree operations ──────────────────────────────────────────────────

  const newFile = useCallback(
    async (parentId: string) => {
      const id = await createAndOpen(parentId, 'Untitled', {
        state: newGraphState(),
        timelineDocument: createEmptyTimelineDocument(),
      });
      if (id) setRenameRequest(id);
    },
    [createAndOpen, newGraphState],
  );

  const newFolder = useCallback(
    async (parentId: string) => {
      const id = await library.createFolder(parentId, 'New folder').catch(() => null);
      if (id) setRenameRequest(id);
    },
    [library],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      void library
        .rename(id, name)
        .then(() => {
          const active = saveController.activeFileId;
          if (active && subtreeIds(library.tree, id).includes(active)) rememberOpen(active);
        })
        .catch(() => {});
    },
    [library, saveController, rememberOpen],
  );

  const move = useCallback(
    (ids: string[], targetFolderId: string) => {
      void library
        .move(ids, targetFolderId)
        .then(() => {
          if (saveController.activeFileId) rememberOpen(saveController.activeFileId);
        })
        .catch(() => {});
    },
    [library, saveController, rememberOpen],
  );

  const remove = useCallback(
    async (ids: string[]) => {
      const tree = library.tree;
      const present = ids.filter((id) => tree.nodes[id]);
      if (present.length === 0) return;
      const affected = present.flatMap((id) => subtreeIds(tree, id));
      const graphs = affected.filter((id) => isGraphFile(tree.nodes[id])).length;
      const others = affected.filter(
        (id) => tree.nodes[id].kind === 'file' && !isGraphFile(tree.nodes[id]),
      ).length;
      const onDisk = library.mode.kind === 'folder';
      const hidden = onDisk ? await library.hiddenEntriesIn(present) : 0;
      const label =
        present.length === 1 ? `"${tree.nodes[present[0]].name}"` : `${present.length} items`;
      const lines = [
        `Delete ${label}${graphs > 1 ? ` (${graphs} graphs)` : ''}?`,
        onDisk
          ? 'It is deleted from the folder on disk — the browser cannot move it to the Recycle Bin.'
          : 'It is removed from this browser.',
        'You can undo this until you reload the page.',
      ];
      if (onDisk && others + hidden > 0) {
        lines.push(
          `${others + hidden} other file(s) inside${hidden > 0 ? ` (including ${hidden} hidden, such as .git)` : ''} will be deleted too and CANNOT be undone — only graphs and folders are kept for undo.`,
        );
      }
      if (!window.confirm(lines.join('\n\n'))) return;
      const activeGone =
        saveController.activeFileId !== null && affected.includes(saveController.activeFileId);
      try {
        await library.remove(present);
      } catch {
        return;
      }
      saveController.forget(affected);
      if (activeGone) {
        baselineRef.current = null;
        clearJournal();
        void library.rememberActiveFile(null);
      }
      if (openFailure && affected.includes(openFailure.fileId)) setOpenFailure(null);
      await dropTabs(affected);
    },
    [library, saveController, openFailure, dropTabs],
  );

  const undoDelete = useCallback(() => {
    void library.undoDelete().catch(() => {});
  }, [library]);

  // ── link / unlink / reconnect ────────────────────────────────────────

  /**
   * LINK: the picker opens FIRST, straight from the click. Asking the
   * "replaces your library" confirm before it spent the click's user
   * activation (~5 s), after which the picker threw a SecurityError that was
   * swallowed as "cancelled" — Link silently did nothing (E1).
   */
  const link = useCallback(async () => {
    if (readOnlySession || probeActive || persistenceDisabled()) return;
    const picker = window.showDirectoryPicker;
    if (!picker) return;
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await picker({ id: 'sound-library', mode: 'readwrite' });
    } catch (error) {
      if (!isAbort(error)) {
        window.alert(
          `The folder picker could not open: ${error instanceof Error ? error.message : 'unknown error'}. Click "Link folder…" again.`,
        );
      }
      return;
    }
    const { graphs, folders } = library.unlinkSummary();
    if (
      library.mode.kind === 'memory' &&
      graphs + folders > 0 &&
      !window.confirm(
        `Linking "${handle.name}" REPLACES the library in this browser (${graphs} graph(s), ${folders} folder(s)) with the folder's contents.\n\nThe graphs here are discarded. Export anything you want to keep first.\n\nContinue?`,
      )
    ) {
      return;
    }
    await saveController.flush().catch(() => {});
    const discarded = Object.keys(library.tree.nodes);
    try {
      await library.link(handle);
    } catch {
      return; // shown in the sidebar
    }
    // The in-memory files are gone: their buffers go with them, or they
    // would haunt every reload with "Leave site?" (E3).
    saveController.forget(discarded);
    snapshotsRef.current.clear();
    dispatchTabs({ type: 'retain', keep: isPageTab });
    await closeEditor();
    setOpenFailure(null);
    void library.rememberActiveFile(null);
  }, [library, saveController, closeEditor, dispatchTabs, probeActive, readOnlySession]);

  const unlink = useCallback(async () => {
    if (readOnlySession || probeActive || persistenceDisabled()) return;
    const { graphs, folders, otherFiles } = library.unlinkSummary();
    const message =
      library.mode.kind === 'folder'
        ? `Copy ${graphs} graph(s) and ${folders} folder(s) into this browser and stop using the folder?` +
          (otherFiles > 0 ? `\n\n${otherFiles} other file(s) stay only in the folder on disk.` : '') +
          '\n\nThe folder itself is not changed.'
        : 'Forget this folder? The library in this browser starts empty. The folder on disk is not changed.';
    if (!window.confirm(message)) return;
    await saveController.flush().catch(() => {});
    const wasFolder = library.mode.kind === 'folder';
    try {
      await library.unlink();
    } catch {
      return;
    }
    const active = saveController.activeFileId;
    // Ids are kept on unlink, so the open file stays open (now in memory) —
    // unless it is an unsupported file, which must stay unwritable (E6).
    if (wasFolder && active && library.tree.nodes[active] && openFailure?.fileId !== active) {
      saveController.setWritable(true);
      rememberOpen(active);
    } else {
      await detach();
      void library.rememberActiveFile(null);
    }
  }, [library, saveController, rememberOpen, detach, openFailure, probeActive, readOnlySession]);

  /**
   * Adopt the file the journal belongs to. The canvas already shows the
   * journal (the newest copy of that file); this decides whether it is
   * unsaved relative to the file — by CONTENT, since the export timestamp
   * made raw text never equal (B4). Only a journal restored at BOOT can be
   * adopted: never a canvas showing a demo loaded while a folder was
   * disconnected (B2), never a journal that failed to restore (B3).
   */
  const adoptJournal = useCallback(async (): Promise<boolean> => {
    const journalPath = getBootJournalPath();
    const node = journalPath ? findByPath(library.tree, journalPath) : undefined;
    if (!node || !isGraphFile(node)) return false;
    const stored = await library.readText(node.id).catch(() => undefined);
    if (stored === undefined) return false;
    const journal = loadJournal();
    tabNamesRef.current.set(node.id, node.name);
    fileSignaturesRef.current.set(node.id, projectSignature(stored));
    dispatchTabs({ type: 'open', id: node.id });
    await saveController.switchTo(node.id, !persistenceDisabled());
    baselineRef.current = projectSignature(stored);
    if (journal && projectSignature(journal.text) !== baselineRef.current) {
      saveController.markChanged();
    }
    rememberOpen(node.id);
    return true;
  }, [library, saveController, rememberOpen, dispatchTabs]);

  /**
   * Put the remembered tabs back (startup, reconnect). `alreadyOpen` is a
   * file the journal just adopted — it stays the active one. Only the active
   * tab is loaded; the others load when clicked.
   */
  const restoreTabs = useCallback(
    async (alreadyOpen: string | null): Promise<number> => {
      const record = await library.recallTabs();
      if (record) {
        recentRef.current = record.recent.slice(0, MAX_RECENT);
        setRecent(recentRef.current);
      }
      const order = record ? [...record.order] : [];
      if (alreadyOpen !== null && !order.includes(alreadyOpen)) order.push(alreadyOpen);
      if (order.length === 0) return 0;
      for (const id of order) {
        const node = library.tree.nodes[id];
        if (node) tabNamesRef.current.set(id, node.name);
      }
      const active = alreadyOpen ?? record?.active ?? order[0];
      dispatchTabs({
        type: 'restore',
        state: { order, active, mru: [active, ...order.filter((id) => id !== active)], closed: record?.closed ?? [] },
      });
      if (alreadyOpen === null && active && !isPageTab(active)) await openFile(active);
      return order.filter((id) => !isPageTab(id)).length;
    },
    [library, dispatchTabs, openFile],
  );

  // The canvas still shows the boot journal only until the user loads
  // something else; after that the journal must not be adopted.
  const bootJournalValidRef = useRef(true);

  const reconnect = useCallback(async () => {
    if (readOnlySession || probeActive || persistenceDisabled()) return;
    try {
      // NO await before this call: the permission request needs the click's
      // user activation (FB-28).
      await library.reconnect();
    } catch {
      return;
    }
    if (saveController.activeFileId === null) {
      const adopted = bootJournalValidRef.current && (await adoptJournal());
      await restoreTabs(adopted ? saveController.activeFileId : null);
    } else if (!openFailure) {
      saveController.setWritable(true);
    }
  }, [library, saveController, adoptJournal, restoreTabs, openFailure, probeActive, readOnlySession]);

  // ── boot (once, even under StrictMode's double effects) ─────────────

  const bootedRef = useRef(false);
  /** Settles when the boot sequence (journal adoption, first-run migration,
   *  reopening the remembered file) is over — see `borrowCanvas`. */
  const bootDoneRef = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    bootDoneRef.current = (async () => {
      // The canvas as it was at mount: the first-run migration writes THIS,
      // never a demo clicked while the library was loading (L23). Taken one
      // microtask late on purpose: every boot source (journal, old autosave,
      // demo) hands its SCORE to the timeline store in a microtask queued
      // during the first render, which React commits before that runs —
      // serialising here directly stored the boot demo with an empty score,
      // so reopening it later played six silent curves. Microtasks run in
      // order and no user event can land between them.
      await Promise.resolve();
      const initialText = serializeProject(stateRef.current);
      await library.init();
      if (persistenceDisabled()) return;
      if (library.mode.kind === 'reconnect') return; // waits for a click
      if (!(await library.isInitialized())) {
        await library.markInitialized();
        markLibraryInitializedSync();
        // First visit (ruling Q7-F2): NOTHING opens. The one exception is
        // work from before the library existed — the old single autosave —
        // which becomes the first file and opens, so it is never lost.
        if (library.mode.kind === 'memory' && bootShowedLegacyAutosave) {
          const id = await library.createFile(library.tree.rootId, 'Untitled.json', initialText).catch(() => null);
          if (id && saveController.activeFileId === null && bootJournalValidRef.current) {
            tabNamesRef.current.set(id, 'Untitled.json');
            fileSignaturesRef.current.set(id, projectSignature(initialText));
            dispatchTabs({ type: 'open', id });
            await saveController.switchTo(id, true);
            baselineRef.current = projectSignature(initialText);
            rememberOpen(id);
            onStartupOpened(1);
            return;
          }
        }
        // A first visit opens nothing but the Welcome page.
        dispatchTabs({ type: 'open', id: WELCOME_TAB });
        onFirstVisit();
        return;
      }
      markLibraryInitializedSync();
      if (saveController.activeFileId !== null || !bootJournalValidRef.current) return;
      // Later visits: the tabs come back (and this tab's crash journal, if
      // it restored, is the active one). Anything opened this way switches
      // auto-run off, with a toast (ruling Q7).
      const adopted = await adoptJournal();
      const count = await restoreTabs(adopted ? saveController.activeFileId : null);
      if (count > 0) onStartupOpened(count);
      else if (tabsRef.current.order.length === 0 && showWelcomeOnStartup()) {
        dispatchTabs({ type: 'open', id: WELCOME_TAB });
      }
    })();
    // Boot runs once; the callbacks it uses are stable for the session.
  }, []);

  // The open file vanished from the tree (deleted or renamed outside the
  // app, seen by a re-scan): detach, so the canvas says "not saved in the
  // library" and offers Save to library, instead of saving nowhere (E6).
  useEffect(() => {
    const active = saveController.activeFileId;
    if (active && library.mode.kind === 'folder' && !snapshot.tree.nodes[active]) {
      saveController.forget([active]);
      baselineRef.current = null;
      clearJournal();
    }
  }, [snapshot.tree, library, saveController]);

  // The tab record follows the strip AND the tree (a rename or move changes
  // the stored path). Debounced; never in a read-only or probe session.
  useEffect(() => {
    if (readOnlySession || probeActive || persistenceDisabled()) return;
    if (snapshot.mode.kind === 'loading' || snapshot.mode.kind === 'reconnect') return;
    const handle = window.setTimeout(() => {
      void library.rememberTabs({ ...tabsRef.current, recent: recentRef.current });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [tabs, recent, snapshot.tree, snapshot.mode.kind, library, readOnlySession, probeActive]);

  // Tab labels follow renames; a vanished file keeps its last name.
  for (const id of tabs.order) {
    const node = snapshot.tree.nodes[id];
    if (node) tabNamesRef.current.set(id, node.name);
  }

  // Outside changes to a linked folder: re-read when the window regains
  // focus. Throttled and deduplicated inside the library.
  useEffect(() => {
    const onFocus = () => {
      if (library.mode.kind === 'folder') void library.rescan().catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [library]);

  // Ctrl+S — capture phase, so it works with focus anywhere.
  const saveNow = useCallback(() => {
    void saveController.save().catch(() => {});
  }, [saveController]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      saveNow();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [saveNow]);

  // A closing tab can lose BUFFERED files (auto-save off, switched away
  // from). The open file's pending edit is carried by the journal.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!saveController.hasBufferedFiles()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saveController]);

  // ── the landing's piano borrows the canvas ───────────────────────────

  /** The canvas is on loan to the landing page's piano. */
  const borrowedRef = useRef(false);

  /**
   * Hand the canvas to something that is NOT a library document (the landing
   * page's playable piano): the open file is settled — saved, or buffered
   * with auto-save off — and detached, so what goes on the canvas next is
   * never written anywhere. Unlike `detachForProbe` this is reversible:
   * `returnCanvas` reopens the file.
   *
   * Waits for the boot sequence first: a borrow that cut in before it would
   * clear this tab's crash journal before the library had adopted it.
   */
  const borrowCanvas = useCallback(async () => {
    await bootDoneRef.current.catch(() => {});
    borrowedRef.current = true;
    openTokenRef.current += 1; // an open already in flight must not land on the loan
    captureActive();
    await detach();
    setOpenFailure(null);
    setDetachedOpen(true);
  }, [detach, captureActive]);

  /** End the loan: the file that was open comes back, exactly as settled. */
  const returnCanvas = useCallback(async () => {
    if (!borrowedRef.current) return;
    borrowedRef.current = false;
    setDetachedOpen(false);
    // The tab that was showing comes back from memory (undo and view
    // intact); with no tab open, the editor closes again.
    await showTab(tabsRef.current.active);
  }, [showTab]);

  /** `__probe` graphs must never reach storage: detach and freeze. */
  const detachForProbe = useCallback(() => {
    setProbeActive(true);
    bootJournalValidRef.current = false;
    openTokenRef.current += 1;
    void detach();
    setOpenFailure(null);
    setDetachedOpen(true);
  }, [detach]);

  // ── conflict resolution ──────────────────────────────────────────────

  const overwriteConflict = useCallback(async () => {
    if (!conflict) return;
    const text = serializeProject(stateRef.current);
    try {
      await library.writeText(conflict.fileId, text, { force: true });
    } catch {
      return;
    }
    setConflict(null);
    if (saveController.activeFileId === conflict.fileId) {
      saveController.setWritable(true);
      await saveController.save().catch(() => {}); // clears the dirty flag
    }
    baselineRef.current = projectSignature(text);
  }, [conflict, library, saveController, stateRef]);

  const reloadConflict = useCallback(async () => {
    if (!conflict) return;
    const fileId = conflict.fileId;
    setConflict(null);
    saveController.forget([fileId]);
    snapshotsRef.current.delete(fileId);
    await openFile(fileId, { force: true });
  }, [conflict, saveController, openFile]);

  const settings = saveController.getSettings();
  const setAutoSave = useCallback(
    (next: Partial<SaveSettings>) => {
      void saveController.setSettings({ ...saveController.getSettings(), ...next });
    },
    [saveController],
  );

  const clearRenameRequest = useCallback(() => setRenameRequest(null), []);

  /** Wrap every user-driven load so the boot journal stops being adoptable
   *  the moment the canvas shows something else. */
  const invalidateBootJournal = useCallback(() => {
    bootJournalValidRef.current = false;
  }, []);

  const activeFileId = saveController.activeFileId;
  const saveStatus: 'saved' | 'unsaved' | 'unavailable' = !saveController.isActiveWritable
    ? 'unavailable'
    : activeFileId && saveController.isDirty(activeFileId)
      ? 'unsaved'
      : 'saved';

  return {
    library,
    snapshot,
    activeFileId,
    activeFileName: activeFileId ? (library.tree.nodes[activeFileId]?.name ?? null) : null,
    openFailure,
    conflict,
    overwriteConflict,
    reloadConflict,
    readOnly: readOnlySession || probeActive || !library.writable,
    folderActionsDisabled: readOnlySession || probeActive,
    canLinkFolders: canLinkFolders() && !readOnlySession,
    isDirty: (fileId: string) => saveController.isDirty(fileId),
    saveStatus,
    savePending: saveController.isPending,
    autoSaveEnabled: settings.enabled,
    autoSaveDelaySeconds: settings.delaySeconds,
    setAutoSave,
    saveNow,
    openFile: (fileId: string) => {
      invalidateBootJournal();
      return openTab(fileId);
    },
    tabs,
    tabName: (id: string) =>
      id === WELCOME_TAB ? 'Welcome' : (snapshot.tree.nodes[id]?.name ?? tabNamesRef.current.get(id) ?? id),
    openWelcome,
    /** Recently opened files that still exist, newest first. */
    recentFiles: recent.filter((id) => snapshot.tree.nodes[id]),
    isTabMissing: (id: string) => !isPageTab(id) && !snapshot.tree.nodes[id],
    activateTab: (id: string) => {
      invalidateBootJournal();
      return activateTab(id);
    },
    closeTabs,
    closeOtherTabs,
    closeTabsToTheRight,
    closeSavedTabs,
    closeAllTabs,
    reorderTab,
    reopenClosedTab,
    /** The editor has something to show: a file tab, or detached content. */
    editorOpen: detachedOpen || (tabs.active !== null && !isPageTab(tabs.active)),
    detachedOpen,
    createAndOpen: (
      parentId: string,
      title: string,
      project: { state: SoundState; timelineDocument: TimelineDocument } | null,
      text?: string,
    ) => {
      if (project) invalidateBootJournal();
      return createAndOpen(parentId, title, project, text);
    },
    newFile: (parentId: string) => {
      invalidateBootJournal();
      return newFile(parentId);
    },
    newFolder,
    rename,
    move,
    remove,
    undoDelete,
    link,
    unlink,
    reconnect,
    dismissError: () => library.dismissError(),
    dismissNotice: () => library.dismissNotice(),
    renameRequest,
    clearRenameRequest,
    detachForProbe,
    borrowCanvas,
    returnCanvas,
  };
}

export { useLibrarySession };
export type { OpenFailure, SaveConflict };

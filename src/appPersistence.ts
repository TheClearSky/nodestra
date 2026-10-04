/**
 * Combined project persistence: one JSON file/blob of shape
 * `{ version, graph, timeline }` — graph via the host's
 * `exportGraphState`/`importGraphState` (full rehydration; never a raw
 * REPLACE_STATE of parsed JSON), `timeline` carrying the curve document.
 * localStorage autosave is ON; `?nosave=1` turns it off, and probe-graph
 * loading suppresses saving entirely so a `__probe(...)` call can never
 * clobber the user's project.
 */

import { z } from 'zod';
import {
  exportGraphState,
  importGraphState,
  standardHiddenNodeTypesInContextMenu,
  standardNodeCountConstraints,
} from '@theclearsky/react-blender-nodes';
import {
  createEmptyTimelineDocument,
  timelineDocumentSchema,
} from '@theclearsky/react-blender-nodes-timeline';
import type { TimelineDocument } from '@theclearsky/react-blender-nodes-timeline';
import {
  allowedConversionsBetweenDataTypes,
  soundDataTypes,
} from './soundDefinitions/dataTypes';
import { soundNodeTypes } from './soundDefinitions/nodeCatalog';
import { initialSoundState } from './soundDefinitions/demoState';
import { urlFlag } from './audio/bootstrap';
import {
  getTimelineStore,
  getTimelineTransport,
} from './timeline/timelineSystem';
import { STORAGE_NAMESPACE } from './storageNamespace';

type SoundProjectState = typeof initialSoundState;

const STORAGE_KEY = `${STORAGE_NAMESPACE}.project.v1`;

/** The combined file's ENVELOPE. The timeline is deliberately `unknown` here
 *  and parsed separately by `parseProjectTimeline` — see there for why a score
 *  must never be able to destroy the graph it ships with. */
const projectEnvelopeSchema = z.object({
  version: z.literal(1),
  /** The host's own export format, embedded verbatim (a JSON string). */
  graph: z.string(),
  /** The timeline plugin's TimelineDocument (null in older files). */
  timeline: z.unknown(),
});

/** The prefix of the plugin's point-ordering issue message. */
const ORDERING_RULE = 'points must be strictly increasing in t';

let persistenceSuppressed = false;

/** Once probe graphs enter the session, autosave is OFF for good. */
function suppressPersistence(): void {
  persistenceSuppressed = true;
}

/**
 * The project as file text. `timeline` defaults to the LIVE score, which is
 * right for "save what is open" and wrong for anything else: a demo or a new
 * graph written to the library must carry its OWN score, not whatever the
 * open file happens to have loaded.
 */
function serializeProject(
  state: SoundProjectState,
  timeline: TimelineDocument = getTimelineStore().getDocument(),
): string {
  // Typed structurally rather than as the zod OUTPUT type: the live
  // document carries readonly arrays; JSON.stringify doesn't care and the
  // parse side re-validates against the schema.
  const file: { version: 1; graph: string; timeline: TimelineDocument } = {
    version: 1,
    graph: exportGraphState(state),
    timeline,
  };
  return JSON.stringify(file);
}

type ProjectImportOutcome = {
  state?: SoundProjectState;
  /** Always present on success — empty document for older files. */
  timelineDocument?: TimelineDocument;
  issues: string[];
};

/** Replace the live timeline document (import/boot path) and let a playing
 *  transport reschedule. */
function applyTimelineDocument(document: TimelineDocument): void {
  getTimelineStore().setDocument(document);
  getTimelineTransport()?.notifyDocumentChanged();
}

/**
 * True when no adjacent pair of points can produce a non-finite ramp slope.
 *
 * This is the ONE ordering hazard that is real. The transport's pure-linear
 * branch (plugin `transport/scheduling.ts`) computes
 * `(endPoint.v - startPoint.v) / (endPoint.t - startPoint.t)` and feeds the
 * result straight to `setValueAtTime` / `linearRampToValueAtTime` with no
 * clamp — so a Δt that is positive but sub-denormal overflows the slope to
 * `Infinity` and schedules a `NaN`. The schema's "≥ 1 ms apart" rule is what
 * used to stop that.
 *
 * Δt of EXACTLY zero is explicitly allowed, and that is not an oversight:
 * the same function skips a zero-width segment (`if (!(effectiveEnd >
 * effectiveStart)) continue;`) before it ever divides, and the evaluator's
 * `solveBezierU` clamps `xTarget <= 0` and `>= 1`, so neither path can produce
 * a bad sample. Refusing equal `t` would cost a shipped demo its entire score
 * to prevent a poisoning that cannot occur.
 */
function hasSafeSegmentSlopes(raw: unknown): boolean {
  const curves = (
    raw as { curves?: { points?: { t?: number; v?: number }[] }[] }
  )?.curves;
  if (!Array.isArray(curves)) return false;
  for (const curve of curves) {
    const points = curve?.points;
    if (!Array.isArray(points)) return false;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const deltaTime = (current?.t as number) - (previous?.t as number);
      if (deltaTime === 0) continue; // provably skipped before the divide
      if (
        !Number.isFinite(
          ((current?.v as number) - (previous?.v as number)) / deltaTime,
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Parse the `timeline` half of a project file on its own.
 *
 * WHY THIS IS SEPARATE FROM THE GRAPH. One schema used to govern the whole
 * file, and a timeline failure short-circuited before the graph was even
 * looked at — so an unparseable score destroyed the entire project. That was
 * not theoretical: two SHIPPED demos (`bellClub`, `neonDrop`) carry percussion
 * decay tails that land after the next hit, so their points are not
 * time-sorted. Measured end to end: load Bell Club → autosave writes it →
 * reload → restore rejects it → the app boots the Curve Orchestra demo → the
 * 800 ms autosave then writes THAT over the user's project. Unrecoverable,
 * with one `console.warn` as the only signal.
 *
 * WHY ORDERING IS TOLERATED AND NOTHING ELSE IS. The app plays a demo score
 * without validating it at all — only import/restore validates. So a restore
 * that is STRICTER than loading the same score from the menu can only ever
 * lose data the app was perfectly happy to play a moment earlier. Every
 * SAFETY rule the schema carries (finite `t`/`v`, hex colour, non-empty and
 * unique curve ids, `durationSec` covering the last point) still rejects, and
 * so does the one ordering case that is genuinely unsafe — see
 * `hasSafeSegmentSlopes`.
 *
 * Re-sorting the two scores is a MUSICAL decision and is deliberately not
 * taken here (the gate's `PENDING_ORDERING_FIX`).
 */
function parseProjectTimeline(raw: unknown): {
  document: TimelineDocument;
  issues: string[];
} {
  if (raw === null || raw === undefined) {
    // Older files predate the timeline entirely — not a failure.
    return { document: createEmptyTimelineDocument(), issues: [] };
  }
  const parsed = timelineDocumentSchema.safeParse(raw);
  if (parsed.success) return { document: parsed.data, issues: [] };
  const orderingOnly = parsed.error.issues.every((issue) =>
    issue.message.startsWith(ORDERING_RULE),
  );
  if (orderingOnly && hasSafeSegmentSlopes(raw)) {
    return {
      document: raw as TimelineDocument,
      issues: [
        `timeline: kept a score with ${parsed.error.issues.length} unsorted point(s) — it plays, but its points are not time-ordered`,
      ],
    };
  }
  return {
    document: createEmptyTimelineDocument(),
    issues: parsed.error.issues.map(
      (issue) => `timeline.${issue.path.join('.')}: ${issue.message}`,
    ),
  };
}

function deserializeProject(json: string): ProjectImportOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { issues: ['Not JSON'] };
  }
  const file = projectEnvelopeSchema.safeParse(parsed);
  if (!file.success) {
    return {
      issues: file.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      ),
    };
  }
  // The score is parsed on its own and can never veto the graph.
  const timeline = parseProjectTimeline(file.data.timeline);
  const issues: string[] = [...timeline.issues];
  const result = importGraphState(file.data.graph, {
    dataTypes: soundDataTypes,
    typeOfNodes: soundNodeTypes,
    // Surface the host's validation detail instead of a blind failure.
    onValidationError: (issue) => {
      issues.push(`${issue.severity ?? 'issue'}: ${issue.message}`);
    },
  });
  if (!result.success) {
    for (const error of result.errors) issues.push(error.message);
    return { issues };
  }
  for (const warning of result.warnings) issues.push(warning.message);
  // importGraphState returns the FILE's typeOfNodes wholesale — it never
  // merges the registry we pass in options. Without this, restoring any
  // pre-upgrade autosave pins stale engine types for the whole session
  // (an old adsr without Gate/Trigger/Env; a save made before the
  // instrument library existed would boot with ZERO instrument types in
  // the Add menu). Merge policy: REGISTRY WINS for every key in the
  // static `soundNodeTypes` map; FILE WINS for user-made auto-id group
  // types (they only exist in the file). Stale node INSTANCES of
  // upgraded types keep their old handle arrays — documented, harmless.
  // The merge must cover the WHOLE engine surface, not just typeOfNodes
  // — an older file restores stale dataTypes (no boolSignal/triggerMode
  // → constructNodeOfType throws on the merged adsr), a stale conversion
  // table (gate edges rejected), and drops the engine flags (group
  // boundaries/inference/menu hygiene). Registry wins for ALL static
  // engine definitions; the file keeps only what is genuinely its own
  // (nodes, edges, user-made group types).
  const state = {
    ...result.data,
    typeOfNodes: {
      ...result.data.typeOfNodes,
      ...(soundNodeTypes as SoundProjectState['typeOfNodes']),
    },
    dataTypes: {
      ...result.data.dataTypes,
      ...(soundDataTypes as SoundProjectState['dataTypes']),
    },
    allowedConversionsBetweenDataTypes,
    nodeCountConstraints: standardNodeCountConstraints,
    enableRecursionChecking: true,
    enableTypeInference: true,
    hiddenNodeTypesInContextMenu: standardHiddenNodeTypesInContextMenu,
  };
  return { state, timelineDocument: timeline.document, issues };
}

/**
 * THE JOURNAL — the crash copy of the OPEN library file, per TAB.
 *
 * One `sessionStorage` entry holding the file's path AND its content,
 * written together (debounced, and synchronously on `pagehide` — the one
 * write a closing tab can still complete; it cannot await IndexedDB or a
 * disk write). On the next boot of the same tab a newer journal reopens the
 * file with the edits shown as unsaved.
 *
 * Why per tab and why one entry (review/2026-09-26-library):
 *  - B6: a shared localStorage journal let one tab's graph be adopted into
 *    ANOTHER tab's file on the next boot.
 *  - B7: path and content in separate keys, written 800 ms apart, left a
 *    window in which a crash paired the new file with the old content.
 *  - B2/B3: the journal is written ONLY while a writable library file is
 *    open, and adopted only when it restored successfully — a demo shown
 *    detached, or a failed restore, can never be written into a file.
 *
 * The old localStorage autosave key is now READ once, for first-run
 * migration into the library, and no longer written.
 */
const JOURNAL_KEY = `${STORAGE_NAMESPACE}.journal.v2`;
/** Mirrors the library's own "initialized" flag, synchronously, so the very
 *  first render can decide what to show before IndexedDB answers. */
const LIBRARY_INITIALIZED_KEY = `${STORAGE_NAMESPACE}.library-initialized`;

type Journal = { path: string[]; text: string };

function saveJournal(path: readonly string[], text: string): void {
  if (persistenceDisabled()) return;
  try {
    window.sessionStorage.setItem(JOURNAL_KEY, JSON.stringify({ path, text }));
  } catch {
    // Quota / privacy mode: the library copy is still authoritative.
  }
}

function loadJournal(): Journal | null {
  try {
    const raw = window.sessionStorage.getItem(JOURNAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Journal>;
    return Array.isArray(parsed.path) &&
      parsed.path.every((segment) => typeof segment === 'string') &&
      typeof parsed.text === 'string'
      ? { path: parsed.path, text: parsed.text }
      : null;
  } catch {
    return null;
  }
}

function clearJournal(): void {
  try {
    window.sessionStorage.removeItem(JOURNAL_KEY);
  } catch {
    // nothing to clear
  }
}

/** Set by the boot render when (and only when) the journal was restored onto
 *  the canvas — the library may then adopt it. */
let bootJournalPath: string[] | null = null;

function setBootJournalPath(path: string[] | null): void {
  bootJournalPath = path;
}

function getBootJournalPath(): string[] | null {
  return bootJournalPath;
}

function isLibraryInitializedSync(): boolean {
  try {
    return window.localStorage.getItem(LIBRARY_INITIALIZED_KEY) === '1';
  } catch {
    return false;
  }
}

function markLibraryInitializedSync(): void {
  try {
    window.localStorage.setItem(LIBRARY_INITIALIZED_KEY, '1');
  } catch {
    // The IndexedDB flag is the authority; this only speeds up the boot.
  }
}

/**
 * What a project file MEANS, for "has it changed?": the graph and score with
 * everything that is not the user's content removed — the export timestamp
 * (new on every save, so raw text never compares equal: B4), the viewport
 * (panning is not an edit), and ReactFlow's per-node view state (`measured`
 * appears on the first render of every freshly built graph, `selected` and
 * `dragging` on interaction). `null` for text that is not a project.
 */
const TRANSIENT_KEYS = new Set([
  'exportedAt',
  'viewport',
  'measured',
  'selected',
  'dragging',
  'resizing',
  'positionAbsolute',
]);

function projectSignature(text: string): string | null {
  try {
    const file = JSON.parse(text) as { graph?: unknown; timeline?: unknown };
    const graph = typeof file.graph === 'string' ? JSON.parse(file.graph) : file.graph;
    return JSON.stringify({ graph, timeline: file.timeline ?? null }, (key, value) =>
      TRANSIENT_KEYS.has(key) ? undefined : value,
    );
  } catch {
    return null;
  }
}

function persistenceDisabled(): boolean {
  return persistenceSuppressed || urlFlag('nosave');
}

function saveProjectToLocalStorage(state: SoundProjectState): void {
  if (persistenceDisabled()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeProject(state));
  } catch {
    // Quota/privacy-mode failures must never break the app.
  }
}

function loadProjectFromLocalStorage(): SoundProjectState | undefined {
  if (persistenceDisabled()) return undefined;
  try {
    // The localStorage GETTER itself can throw in privacy modes — this runs
    // on the boot render path.
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return undefined;
    const outcome = deserializeProject(stored);
    if (outcome.issues.length > 0) {
      console.warn('[persistence] autosave restore issues', outcome.issues);
    }
    // Boot hydration of the timeline document. Deferred to a microtask:
    // this function runs inside a render-phase useMemo, and an external
    // store write during render violates concurrent-rendering rules.
    // Idempotent under StrictMode double-invocation.
    if (outcome.state && outcome.timelineDocument) {
      const timelineDocument = outcome.timelineDocument;
      queueMicrotask(() => applyTimelineDocument(timelineDocument));
    }
    return outcome.state;
  } catch {
    return undefined;
  }
}

/** Blob download with a DEFERRED revoke — a synchronous revoke races the
 *  navigation-to-blob in some engines. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function downloadProject(state: SoundProjectState): void {
  downloadBlob(
    new Blob([serializeProject(state)], { type: 'application/json' }),
    'nodestra-project.json',
  );
}

export {
  applyTimelineDocument,
  deserializeProject,
  downloadBlob,
  downloadProject,
  clearJournal,
  getBootJournalPath,
  isLibraryInitializedSync,
  loadJournal,
  loadProjectFromLocalStorage,
  markLibraryInitializedSync,
  persistenceDisabled,
  projectSignature,
  saveJournal,
  saveProjectToLocalStorage,
  setBootJournalPath,
  serializeProject,
  suppressPersistence,
};

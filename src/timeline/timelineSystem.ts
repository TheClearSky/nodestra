/**
 * Timeline glue: ONE document store for the whole app — created at module
 * load so boot persistence can hydrate before audio exists — plus ONE
 * transport/registry pair created when audio starts. Tone 15's `rawContext`
 * is the standardized-audio-context WRAPPER: the plugin's structural seam
 * accepts it directly and only ever calls `createConstantSource()` — no DOM
 * constructors, no instanceof.
 */
import * as Tone from 'tone';
import {
  createEmptyTimelineDocument,
  createTimelineDocumentStore,
  createTimelineDriverRegistry,
  createTimelineTransport,
} from '@theclearsky/react-blender-nodes-timeline';
import type {
  TimelineAudioContextLike,
  TimelineDocumentStore,
  TimelineDriverRegistry,
  TimelineTransport,
} from '@theclearsky/react-blender-nodes-timeline';
// The runtime lives on globalThis under the app's FORMER name on purpose: a
// dev hot update of this module must find the SAME store (see storageNamespace).
import { STORAGE_NAMESPACE } from '../storageNamespace';

/**
 * ONE store, transport and registry per PAGE — held on `globalThis`, not in
 * module scope. This module imports the timeline plugin, so a hot update of
 * the plugin (or of this file) RE-RUNS it, and a re-run used to mint a fresh,
 * EMPTY store the timeline UI switched to while the journal and autosave kept
 * writing — the open file's curves were destroyed (reproduced 2026-09-27:
 * 6 → 0). `import.meta.hot.data` did not help: Vite never disposes the
 * modules it re-runs in between. A global survives any re-run; in production
 * it is simply the one instance. (vite.config.ts also turns a linked
 * library's rebuild into a full reload — two guards for one data loss.)
 */
type TimelineRuntime = {
  store: TimelineDocumentStore;
  transport?: TimelineTransport;
  registry?: TimelineDriverRegistry;
};
const RUNTIME_KEY = Symbol.for(`${STORAGE_NAMESPACE}.timeline-runtime`);
const holder = globalThis as unknown as Record<symbol, TimelineRuntime | undefined>;
const runtime: TimelineRuntime = (holder[RUNTIME_KEY] ??= {
  store: createTimelineDocumentStore(createEmptyTimelineDocument()),
});
const timelineStore: TimelineDocumentStore = runtime.store;

function getTimelineStore(): TimelineDocumentStore {
  return timelineStore;
}

function getTimelineTransport(): TimelineTransport | undefined {
  return runtime.transport;
}

function getTimelineRegistry(): TimelineDriverRegistry | undefined {
  return runtime.registry;
}

/** Idempotent; call once audio has started (the raw context then runs). */
function ensureTimelineRuntime(): TimelineTransport {
  if (runtime.transport !== undefined) {
    return runtime.transport;
  }
  const rawContext = Tone.getContext()
    .rawContext as unknown as TimelineAudioContextLike;
  const registry = createTimelineDriverRegistry(rawContext);
  runtime.registry = registry;
  runtime.transport = createTimelineTransport({
    context: rawContext,
    registry,
    getDocument: timelineStore.getDocument,
    // The plugin default (0.08 s) proved too tight once the Piano &
    // Flute hall chain landed — a 6.5 s convolver IR plus ~500 schedule
    // events slowed the write pass past the headroom, Chrome shifted the
    // now-past-dated curve windows and later events of the SAME pass
    // overlapped them (seen as NotSupportedError "overlaps" on play).
    // 0.25 s buys the burst room; the playhead holds at the anchor that
    // long, which is imperceptible for these pieces.
    scheduleHeadroomSeconds: 0.25,
  });
  return runtime.transport;
}

export {
  ensureTimelineRuntime,
  getTimelineRegistry,
  getTimelineStore,
  getTimelineTransport,
};

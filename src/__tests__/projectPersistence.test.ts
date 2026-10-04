/**
 * The two persistence rules the library session leans on:
 *  - "has the project changed?" compares MEANING, not text (B4/C1): the
 *    export timestamp is new on every serialisation and ReactFlow adds view
 *    state to a freshly built graph, so raw text never compares equal;
 *  - the per-tab crash journal round-trips and rejects anything malformed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearJournal,
  loadJournal,
  projectSignature,
  saveJournal,
} from '../appPersistence';

function projectText(options: {
  exportedAt?: string;
  viewport?: object;
  node?: object;
  timeline?: unknown;
}): string {
  const graph = {
    nodes: [{ id: 'osc', type: 'oscillator', position: { x: 0, y: 0 }, ...options.node }],
    edges: [],
    viewport: options.viewport ?? { x: 0, y: 0, zoom: 1 },
    exportedAt: options.exportedAt ?? '2026-09-26T10:00:00.000Z',
  };
  return JSON.stringify({ graph: JSON.stringify(graph), timeline: options.timeline ?? null });
}

describe('projectSignature', () => {
  it('ignores the export timestamp, the viewport and ReactFlow view state', () => {
    const saved = projectText({});
    const reserialised = projectText({
      exportedAt: '2026-09-26T10:00:05.000Z',
      viewport: { x: 120, y: -40, zoom: 0.6 },
      node: { measured: { width: 180, height: 90 }, selected: true, dragging: false },
    });
    expect(saved).not.toBe(reserialised);
    expect(projectSignature(reserialised)).toBe(projectSignature(saved));
  });

  it('sees a real edit to the graph or the score', () => {
    const saved = projectSignature(projectText({}));
    expect(projectSignature(projectText({ node: { position: { x: 10, y: 0 } } }))).not.toBe(saved);
    expect(projectSignature(projectText({ timeline: { tracks: [] } }))).not.toBe(saved);
  });

  it('is null for text that is not a project', () => {
    expect(projectSignature('not json')).toBeNull();
    expect(projectSignature('{"graph":"{broken"}')).toBeNull();
  });
});

describe('crash journal', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', {
      location: { search: '' },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips the open file’s path and text, and clears', () => {
    expect(loadJournal()).toBeNull();
    saveJournal(['drums', 'kick.json'], 'TEXT');
    expect(loadJournal()).toEqual({ path: ['drums', 'kick.json'], text: 'TEXT' });
    clearJournal();
    expect(loadJournal()).toBeNull();
  });

  it('rejects a malformed entry instead of restoring it', () => {
    window.sessionStorage.setItem('react-blender-nodes-sound.journal.v2', '{"path":[1],"text":"x"}');
    expect(loadJournal()).toBeNull();
    window.sessionStorage.setItem('react-blender-nodes-sound.journal.v2', '{nope');
    expect(loadJournal()).toBeNull();
  });

  it('is not written in a ?nosave session', () => {
    (window.location as { search: string }).search = '?nosave';
    saveJournal(['a.json'], 'TEXT');
    expect(loadJournal()).toBeNull();
  });
});

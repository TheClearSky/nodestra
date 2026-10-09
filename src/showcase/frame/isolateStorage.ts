/**
 * A showcase frame's storage is its own and lives only in memory.
 *
 * The frame shares the landing page's origin, so without this the real App
 * running inside it would read — and autosave into — the visitor's own
 * library and settings. The App's ONLY persistence APIs are localStorage,
 * sessionStorage and IndexedDB (no BroadcastChannel, no `storage` events, no
 * service worker), so replacing those three in this window, before any app
 * module runs, isolates it completely: every showcase is a fresh first visit.
 * Without IndexedDB the library falls back to its in-memory store.
 *
 * Imported FIRST by `frame/main.tsx`, for its side effect.
 */

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value));
  }
}

function replace(name: 'localStorage' | 'sessionStorage' | 'indexedDB', value: unknown) {
  Object.defineProperty(window, name, { value, configurable: true, enumerable: true, writable: false });
  if (window[name] !== value) throw new Error(`[showcase] could not isolate ${name}`);
}

replace('localStorage', new MemoryStorage());
replace('sessionStorage', new MemoryStorage());
replace('indexedDB', undefined);

export {};

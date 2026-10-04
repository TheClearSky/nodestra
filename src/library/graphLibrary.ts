/**
 * The graph library: one tree, one storage backend at a time, one queue.
 *
 * Framework-free (subscribe / getSnapshot for `useSyncExternalStore`) so the
 * behaviour can be tested without a DOM. Prompts are NOT made here — the UI
 * asks the user, then calls in.
 *
 * THE QUEUE. Every operation that touches storage runs one at a time, in
 * call order, and the tree only changes after its storage operation
 * succeeded — so a refused disk operation leaves nothing to roll back.
 *
 * THE MUTATION GUARD runs BEFORE an operation enters the queue, never inside
 * it. Before a rename, move or delete, `beforeMutate(affectedIds)` lets the
 * app save the open file; that save is itself a queued write. Awaiting it
 * from INSIDE a queued operation deadlocked the whole library — the save
 * waited behind the operation that waited for the save — and every later
 * open, save and demo hung until reload (review/2026-09-26-library, A1).
 */

import {
  canLinkFolders,
  ConflictError,
  FolderBackend,
  folderPermission,
  MemoryBackend,
  scanFolder,
} from './backends';
import type { LibraryBackend } from './backends';
import { createMemoryStore } from './keyValueStore';
import type { KeyValueStore } from './keyValueStore';
import {
  addNode,
  childNamed,
  countContents,
  createEmptyTree,
  deserializeTree,
  findByPath,
  getNode,
  isGraphFile,
  LibraryError,
  moveNode,
  pathOf,
  removeNode,
  renameNode,
  serializeTree,
  subtreeIds,
  topmostOnly,
} from './libraryTree';
import type { LibraryTree } from './libraryTree';
import { uniqueName } from './names';

type LibraryMode =
  | { kind: 'loading' }
  | { kind: 'memory' }
  | { kind: 'folder'; folderName: string }
  /** A folder is linked but the browser needs a click to re-grant access. */
  | { kind: 'reconnect'; folderName: string };

type LibrarySnapshot = {
  mode: LibraryMode;
  tree: LibraryTree;
  /** Graph files that could not be opened as a project. */
  unsupported: ReadonlySet<string>;
  /** The last error worth showing, until dismissed. */
  error: string | null;
  /** Something the user should know that is not a failure. */
  notice: string | null;
  /** True while at least one WRITE is queued (reads do not count). */
  busy: boolean;
  /** A delete this session can still undo. */
  undoableDelete: string | null;
  /** The browser refused its storage; the library lives for this tab only. */
  storageUnavailable: boolean;
};

/** What a delete removed, enough to put it back (graphs and folders). */
type DeletedSubtree = {
  label: string;
  items: { path: string[]; kind: 'folder' | 'file'; text?: string }[];
};

const FOLDER_HANDLE_KEY = 'folderHandle';
const ACTIVE_FILE_KEY = 'activeFile';
/** The open tabs, by PATH (ids of a linked folder are rebuilt each scan). */
const OPEN_TABS_KEY = 'openTabs';
const INITIALIZED_KEY = 'initialized';

type StoredTab = { path: string[] } | { page: string };
type StoredTabs = { order: StoredTab[]; active: StoredTab | null; closed: StoredTab[]; recent?: StoredTab[] };

/** Re-scans triggered by window focus are cheap only when rare. */
const MIN_RESCAN_INTERVAL_MS = 2000;

type GraphLibraryOptions = {
  store: KeyValueStore;
  /** Flush pending edits of any of these files before they move or vanish.
   *  Called OUTSIDE the queue. */
  beforeMutate?: (affectedIds: readonly string[]) => Promise<void>;
};

class GraphLibrary {
  private snapshot: LibrarySnapshot = {
    mode: { kind: 'loading' },
    tree: createEmptyTree(),
    unsupported: new Set(),
    error: null,
    notice: null,
    busy: false,
    undoableDelete: null,
    storageUnavailable: false,
  };
  private readonly listeners = new Set<() => void>();
  private store: KeyValueStore;
  private memory: MemoryBackend;
  private backend: LibraryBackend;
  private queue: Promise<unknown> = Promise.resolve();
  private pendingWrites = 0;
  private lastDelete: DeletedSubtree | null = null;
  private initPromise: Promise<void> | null = null;
  /** The linked folder's handle, kept so Reconnect can ask for permission
   *  synchronously inside the click (a queue hop or an IndexedDB read first
   *  would spend the click's user activation). */
  private storedHandle: FileSystemDirectoryHandle | null = null;
  private lastRescanAt = 0;
  private rescanning = false;
  beforeMutate: (affectedIds: readonly string[]) => Promise<void>;

  constructor(options: GraphLibraryOptions) {
    this.store = options.store;
    this.memory = new MemoryBackend(this.store);
    this.backend = this.memory;
    this.beforeMutate = options.beforeMutate ?? (async () => {});
  }

  // ── store plumbing ────────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LibrarySnapshot => this.snapshot;

  private set(patch: Partial<LibrarySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  get tree(): LibraryTree {
    return this.snapshot.tree;
  }

  get mode(): LibraryMode {
    return this.snapshot.mode;
  }

  /** Can this tree be written right now? */
  get writable(): boolean {
    return this.snapshot.mode.kind === 'memory' || this.snapshot.mode.kind === 'folder';
  }

  /**
   * Run `work` after everything queued before it. Errors are shown AND
   * rethrown. `write` operations drive the "Saving…" indicator.
   */
  private run<T>(work: () => Promise<T>, options: { write?: boolean } = {}): Promise<T> {
    const write = options.write ?? true;
    if (write) {
      this.pendingWrites += 1;
      if (!this.snapshot.busy) this.set({ busy: true });
    }
    const result = this.queue.then(work);
    this.queue = result
      .catch(() => {})
      .finally(() => {
        if (!write) return;
        this.pendingWrites -= 1;
        if (this.pendingWrites === 0) this.set({ busy: false });
      });
    return result.catch((error: unknown) => {
      if (!(error instanceof ConflictError)) {
        this.set({ error: describe(error) });
        this.noticeAccessLoss(error);
      }
      throw error;
    });
  }

  /** A folder whose permission was revoked, or which was moved or deleted,
   *  goes back to "Reconnect" — otherwise every later operation just fails
   *  with no way back short of a reload (FB-09). */
  private noticeAccessLoss(error: unknown): void {
    if (!(this.backend instanceof FolderBackend) || this.mode.kind !== 'folder') return;
    if (!(error instanceof DOMException)) return;
    if (error.name !== 'NotAllowedError' && error.name !== 'SecurityError') {
      if (error.name !== 'NotFoundError') return;
      // A missing FILE is normal; a missing ROOT is not. Probe the root.
      const root = this.backend.root;
      void (async () => {
        try {
          await root.keys().next();
        } catch {
          this.set({ mode: { kind: 'reconnect', folderName: root.name } });
        }
      })();
      return;
    }
    this.set({ mode: { kind: 'reconnect', folderName: this.backend.root.name } });
  }

  dismissError(): void {
    this.set({ error: null });
  }

  dismissNotice(): void {
    this.set({ notice: null });
  }

  // ── boot ──────────────────────────────────────────────────────────────

  /** Idempotent: React StrictMode runs effects twice, and two concurrent
   *  scans of one folder mint two different id sets (FB-15). */
  init(): Promise<void> {
    this.initPromise ??= this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    // Some browsers refuse IndexedDB only when it is first USED (private
    // modes); a probe decides up front whether the library can persist.
    try {
      await this.store.keys();
    } catch {
      this.store = createMemoryStore();
      this.memory = new MemoryBackend(this.store);
      this.backend = this.memory;
      this.set({ storageUnavailable: true });
    }
    const handle = await this.store
      .get<FileSystemDirectoryHandle>(FOLDER_HANDLE_KEY)
      .catch(() => undefined);
    if (handle && canLinkFolders()) {
      this.storedHandle = handle;
      const permission = await folderPermission(handle, false).catch(
        () => 'denied' as PermissionState,
      );
      if (permission === 'granted') {
        try {
          await this.attachFolder(handle);
          return;
        } catch {
          // Moved or deleted outside the app: fall through to "reconnect".
        }
      }
      this.backend = new FolderBackend(handle);
      this.set({ mode: { kind: 'reconnect', folderName: handle.name } });
      return;
    }
    const stored = await this.memory.loadStructure().catch(() => undefined);
    const tree = (stored && deserializeTree(stored)) || createEmptyTree();
    this.backend = this.memory;
    this.set({ mode: { kind: 'memory' }, tree });
  }

  /** Has this browser ever set up the library? Decides first-run migration
   *  — NOT an empty tree, which a user can legitimately reach (L15). */
  async isInitialized(): Promise<boolean> {
    return (await this.store.get<boolean>(INITIALIZED_KEY).catch(() => false)) === true;
  }

  async markInitialized(): Promise<void> {
    await this.store.set(INITIALIZED_KEY, true).catch(() => {});
  }

  private async attachFolder(handle: FileSystemDirectoryHandle): Promise<void> {
    const { tree, unreadable } = await scanFolder(handle);
    this.backend = new FolderBackend(handle);
    this.storedHandle = handle;
    this.lastRescanAt = Date.now();
    this.set({
      mode: { kind: 'folder', folderName: handle.name },
      tree,
      unsupported: new Set(),
      notice:
        unreadable > 0
          ? `${unreadable} subfolder(s) could not be read and are not shown.`
          : null,
    });
  }

  /**
   * Re-grant access to the stored folder. MUST be called from a click, and
   * asks for permission FIRST — before any queue hop or storage read, which
   * would outlive the click's user activation.
   */
  reconnect(): Promise<void> {
    const handle = this.storedHandle;
    if (!handle) return Promise.reject(new LibraryError('No folder is linked.'));
    const permission = folderPermission(handle, true);
    return this.run(async () => {
      if ((await permission) !== 'granted') {
        throw new LibraryError('The browser did not grant access to the folder.');
      }
      await this.attachFolder(handle);
    }, { write: false });
  }

  /**
   * Re-read the linked folder (after a change made outside the app). Ids of
   * unchanged paths are kept, and an unchanged folder keeps the SAME tree
   * object, so nothing downstream re-renders or re-prunes. Throttled, and
   * never concurrent with another rescan (FB-05 / FB-25).
   */
  rescan(options: { force?: boolean } = {}): Promise<void> {
    if (this.rescanning) return Promise.resolve();
    if (!options.force && Date.now() - this.lastRescanAt < MIN_RESCAN_INTERVAL_MS) {
      return Promise.resolve();
    }
    this.rescanning = true;
    return this.run(async () => {
      if (!(this.backend instanceof FolderBackend) || this.mode.kind !== 'folder') return;
      const previous = this.tree;
      const { tree } = await scanFolder(this.backend.root, previous);
      this.lastRescanAt = Date.now();
      if (serializeTree(tree) === serializeTree(previous)) return;
      this.set({ tree });
    }, { write: false }).finally(() => {
      this.rescanning = false;
    });
  }

  // ── link / unlink ─────────────────────────────────────────────────────

  /**
   * LINK: the in-memory library is DISCARDED and the folder becomes the
   * library (ruling: "Linking back discards in memory tree and loads
   * folder"). The caller confirms with the user first. The handle is
   * persisted before the mode switches, so a failure part-way cannot leave
   * a linked-looking library that forgets its folder on reload.
   */
  link(handle: FileSystemDirectoryHandle): Promise<void> {
    return this.run(async () => {
      // The picker already granted readwrite; query first so no second
      // prompt appears, and request only if the picker did not.
      let permission = await folderPermission(handle, false);
      if (permission !== 'granted') permission = await folderPermission(handle, true);
      if (permission !== 'granted') {
        throw new LibraryError('The browser did not grant write access to the folder.');
      }
      await this.store.set(FOLDER_HANDLE_KEY, handle);
      await this.attachFolder(handle);
      await this.memory.clear();
      this.lastDelete = null;
      this.set({ undoableDelete: null });
    });
  }

  /** What UNLINK would copy, for the confirm dialog. */
  unlinkSummary(): { folders: number; graphs: number; otherFiles: number } {
    return countContents(this.tree);
  }

  /**
   * UNLINK: copy the folder's structure and every `.json` file into the
   * browser, then forget the folder. Other files stay on disk only (ruling
   * F4). Ids are kept, so the open file stays open.
   *
   * Everything is READ first and only then is the browser's store replaced —
   * a read failure part-way used to leave an already-wiped store (FB-17).
   * Unreadable files are skipped and reported, not fatal.
   */
  unlink(): Promise<void> {
    return this.run(async () => {
      if (this.mode.kind !== 'folder') {
        // Nothing readable (reconnect pending): forget the folder.
        await this.store.delete(FOLDER_HANDLE_KEY);
        this.storedHandle = null;
        this.backend = this.memory;
        await this.memory.clear();
        await this.memory.saveStructure(createEmptyTree());
        this.set({ mode: { kind: 'memory' }, tree: createEmptyTree() });
        return;
      }
      const source = this.backend;
      const before = this.tree;
      let tree = before;
      for (const node of Object.values(before.nodes)) {
        if (node.kind === 'file' && !isGraphFile(node) && tree.nodes[node.id]) {
          tree = removeNode(tree, node.id).tree;
        }
      }
      const contents = new Map<string, string>();
      let skipped = 0;
      for (const node of Object.values(tree.nodes)) {
        if (!isGraphFile(node)) continue;
        try {
          contents.set(node.id, await source.readText(before, node.id));
        } catch {
          skipped += 1;
          tree = removeNode(tree, node.id).tree;
        }
      }
      await this.memory.clear();
      for (const [id, text] of contents) await this.memory.writeText(tree, id, text);
      await this.memory.saveStructure(tree);
      await this.store.delete(FOLDER_HANDLE_KEY);
      this.storedHandle = null;
      this.backend = this.memory;
      this.set({
        mode: { kind: 'memory' },
        tree,
        notice:
          skipped > 0 ? `${skipped} graph(s) could not be read and were not copied.` : null,
      });
    });
  }

  // ── files ─────────────────────────────────────────────────────────────

  readText(id: string): Promise<string> {
    return this.run(() => this.backend.readText(this.tree, id), { write: false });
  }

  /** Overwrite a file. Rejects with `ConflictError` when a linked file
   *  changed on disk since it was read; pass `force` to overwrite anyway. */
  writeText(id: string, text: string, options?: { force?: boolean }): Promise<void> {
    return this.run(async () => {
      this.assertWritable();
      if (!this.tree.nodes[id]) throw new LibraryError('That file no longer exists.');
      await this.backend.writeText(this.tree, id, text, options);
      if (this.snapshot.unsupported.has(id)) {
        const unsupported = new Set(this.snapshot.unsupported);
        unsupported.delete(id);
        this.set({ unsupported });
      }
    });
  }

  markUnsupported(id: string, isUnsupported: boolean): void {
    if (this.snapshot.unsupported.has(id) === isUnsupported) return;
    const unsupported = new Set(this.snapshot.unsupported);
    if (isUnsupported) unsupported.add(id);
    else unsupported.delete(id);
    this.set({ unsupported });
  }

  /** A name free both in the tree AND on disk (a linked folder may hold
   *  entries the last scan did not see, or hides). */
  private async freeName(parentId: string, desired: string): Promise<string> {
    const names = new Set(this.siblingNames(parentId));
    for (const name of await this.backend.namesIn(this.tree, parentId).catch(() => [])) {
      names.add(name);
    }
    return uniqueName(desired, names);
  }

  /** Create a file with `text`; its name is made unique among siblings. */
  createFile(parentId: string, desiredName: string, text: string): Promise<string> {
    return this.run(async () => {
      this.assertWritable();
      const name = await this.freeName(parentId, desiredName);
      const { tree, id } = addNode(this.tree, parentId, 'file', name);
      await this.backend.writeText(tree, id, text, { create: true });
      await this.backend.saveStructure(tree);
      this.set({ tree });
      return id;
    });
  }

  createFolder(parentId: string, desiredName: string): Promise<string> {
    return this.run(async () => {
      this.assertWritable();
      const name = await this.freeName(parentId, desiredName);
      const { tree, id } = addNode(this.tree, parentId, 'folder', name);
      await this.backend.createFolder(tree, id);
      await this.backend.saveStructure(tree);
      this.set({ tree });
      return id;
    });
  }

  async rename(id: string, name: string): Promise<void> {
    if (this.tree.nodes[id]) await this.beforeMutate(subtreeIds(this.tree, id));
    return this.run(async () => {
      this.assertWritable();
      const before = this.tree;
      const after = renameNode(before, id, name);
      if (after === before) return;
      const note = await this.backend.relocate(before, after, id);
      await this.backend.saveStructure(after);
      this.set({ tree: after, notice: note ?? this.snapshot.notice });
    });
  }

  /** Move several items into `targetParentId`. Selected descendants of a
   *  selected folder ride along with it rather than moving twice. */
  async move(ids: readonly string[], targetParentId: string): Promise<void> {
    const targets = topmostOnly(this.tree, ids);
    await this.beforeMutate(targets.flatMap((id) => subtreeIds(this.tree, id)));
    return this.run(async () => {
      this.assertWritable();
      for (const id of targets) {
        const before = this.tree;
        if (!before.nodes[id]) continue;
        const after = moveNode(before, id, targetParentId);
        if (after === before) continue;
        const note = await this.backend.relocate(before, after, id);
        await this.backend.saveStructure(after);
        this.set({ tree: after, notice: note ?? this.snapshot.notice });
      }
    });
  }

  /** Hidden entries (`.git`, dot-files, `node_modules`) a delete of these
   *  items would also remove — the tree does not show them. */
  async hiddenEntriesIn(ids: readonly string[]): Promise<number> {
    if (!(this.backend instanceof FolderBackend)) return 0;
    let total = 0;
    for (const id of topmostOnly(this.tree, ids)) {
      total += await this.backend.countHiddenEntries(this.tree, id);
    }
    return total;
  }

  /**
   * Delete, keeping enough to UNDO it this session (ruling F6: permanent
   * with confirm + session undo). Graph files and folders are restorable;
   * non-JSON files in a linked folder are not held in memory and are gone.
   * If a folder delete fails part-way, the tree is re-read from disk so it
   * matches what is really there (FB-10).
   */
  async remove(ids: readonly string[]): Promise<void> {
    const targets = topmostOnly(this.tree, ids);
    if (targets.length === 0) return;
    await this.beforeMutate(targets.flatMap((id) => subtreeIds(this.tree, id)));
    return this.run(async () => {
      this.assertWritable();
      const present = targets.filter((id) => this.tree.nodes[id]);
      if (present.length === 0) return;
      const record: DeletedSubtree = {
        label:
          present.length === 1
            ? `"${this.tree.nodes[present[0]].name}"`
            : `${present.length} items`,
        items: [],
      };
      for (const id of present) {
        for (const itemId of subtreeIds(this.tree, id)) {
          const node = this.tree.nodes[itemId];
          const path = pathOf(this.tree, itemId);
          if (node.kind === 'folder') {
            record.items.push({ path, kind: 'folder' });
          } else if (isGraphFile(node)) {
            const text = await this.backend.readText(this.tree, itemId).catch(() => undefined);
            record.items.push({ path, kind: 'file', text });
          }
        }
      }
      const notes: string[] = [];
      try {
        for (const id of present) {
          const before = this.tree;
          const note = await this.backend.remove(before, id);
          if (note) notes.push(note);
          const { tree } = removeNode(before, id);
          await this.backend.saveStructure(tree);
          this.set({ tree });
        }
      } catch (error) {
        if (this.backend instanceof FolderBackend) {
          const { tree } = await scanFolder(this.backend.root, this.tree).catch(() => ({
            tree: this.tree,
            unreadable: 0,
          }));
          this.set({ tree });
        }
        throw error;
      }
      if (notes.length > 0) {
        // Something stayed on disk; a re-scan shows what really remains.
        if (this.backend instanceof FolderBackend) {
          const { tree } = await scanFolder(this.backend.root, this.tree);
          this.set({ tree });
        }
        this.set({ notice: notes.join(' ') });
      }
      this.lastDelete = record;
      this.set({ undoableDelete: record.label });
    });
  }

  /** Put the last delete back, at the same paths (names made unique if
   *  something took their place meanwhile). Returns the restored ids. */
  undoDelete(): Promise<string[]> {
    return this.run(async () => {
      this.assertWritable();
      const record = this.lastDelete;
      if (!record) return [];
      const restored: string[] = [];
      const idByPath = new Map<string, string>();
      for (const item of record.items) {
        const parentSegments = item.path.slice(0, -1);
        const parentKey = parentSegments.join('/');
        const parentId =
          idByPath.get(parentKey) ??
          findByPath(this.tree, parentSegments)?.id ??
          this.tree.rootId;
        const wanted = item.path[item.path.length - 1];
        const existing = childNamed(this.tree, parentId, wanted);
        if (item.kind === 'folder' && existing?.kind === 'folder') {
          idByPath.set(item.path.join('/'), existing.id);
          continue;
        }
        if (item.kind === 'file' && item.text === undefined) continue;
        const name = await this.freeName(parentId, wanted);
        const { tree, id } = addNode(this.tree, parentId, item.kind, name);
        if (item.kind === 'folder') await this.backend.createFolder(tree, id);
        else await this.backend.writeText(tree, id, item.text as string, { create: true });
        await this.backend.saveStructure(tree);
        this.set({ tree });
        idByPath.set(item.path.join('/'), id);
        restored.push(id);
      }
      this.lastDelete = null;
      this.set({ undoableDelete: null });
      return restored;
    });
  }

  // ── the open file, remembered across reloads ──────────────────────────

  async rememberActiveFile(id: string | null): Promise<void> {
    const path = id && this.tree.nodes[id] ? pathOf(this.tree, id) : null;
    await this.store.set(ACTIVE_FILE_KEY, path).catch(() => {});
  }

  async recallActiveFile(): Promise<string | null> {
    const path = await this.store.get<string[] | null>(ACTIVE_FILE_KEY).catch(() => null);
    if (!Array.isArray(path)) return null;
    const node = findByPath(this.tree, path);
    return node && isGraphFile(node) ? node.id : null;
  }

  /**
   * Remember the open tabs. File tabs are stored by path; other tabs (the
   * Welcome page) by their own id. Unknown ids are dropped.
   */
  async rememberTabs(record: {
    order: readonly string[];
    active: string | null;
    closed: readonly string[];
    recent?: readonly string[];
  }): Promise<void> {
    const toEntry = (id: string): StoredTab | null =>
      this.tree.nodes[id] ? { path: pathOf(this.tree, id) } : id.startsWith('@') ? { page: id } : null;
    const stored: StoredTabs = {
      order: record.order.map(toEntry).filter((entry): entry is StoredTab => entry !== null),
      active: record.active === null ? null : toEntry(record.active),
      closed: record.closed.map(toEntry).filter((entry): entry is StoredTab => entry !== null),
      recent: (record.recent ?? []).map(toEntry).filter((entry): entry is StoredTab => entry !== null),
    };
    await this.store.set(OPEN_TABS_KEY, stored).catch(() => {});
  }

  /**
   * The remembered tabs resolved against the CURRENT tree. A file that is
   * gone is dropped; `null` when nothing was ever remembered (a first visit,
   * or a library from before tabs — then the old single active file, if any,
   * becomes the one tab).
   */
  async recallTabs(): Promise<{ order: string[]; active: string | null; closed: string[]; recent: string[] } | null> {
    const stored = await this.store.get<StoredTabs>(OPEN_TABS_KEY).catch(() => undefined);
    const resolve = (entry: unknown): string | null => {
      if (!entry || typeof entry !== 'object') return null;
      const { path, page } = entry as { path?: unknown; page?: unknown };
      if (typeof page === 'string' && page.startsWith('@')) return page;
      if (!Array.isArray(path) || !path.every((segment) => typeof segment === 'string')) return null;
      const node = findByPath(this.tree, path as string[]);
      return node && isGraphFile(node) ? node.id : null;
    };
    if (!stored || typeof stored !== 'object' || !Array.isArray(stored.order)) {
      const legacy = await this.recallActiveFile();
      return legacy ? { order: [legacy], active: legacy, closed: [], recent: [legacy] } : null;
    }
    const order = stored.order.map(resolve).filter((id): id is string => id !== null);
    const closed = Array.isArray(stored.closed)
      ? stored.closed.map(resolve).filter((id): id is string => id !== null)
      : [];
    const recent = Array.isArray(stored.recent)
      ? stored.recent.map(resolve).filter((id): id is string => id !== null && !id.startsWith('@'))
      : [];
    const active = resolve(stored.active);
    return { order, active: active && order.includes(active) ? active : (order[0] ?? null), closed, recent };
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private siblingNames(parentId: string): string[] {
    getNode(this.tree, parentId);
    return (this.tree.children[parentId] ?? []).map((id) => this.tree.nodes[id].name);
  }

  private assertWritable(): void {
    if (this.writable) return;
    throw new LibraryError(
      this.mode.kind === 'reconnect'
        ? 'Reconnect the folder before changing it.'
        : 'The library is still loading.',
    );
  }
}

function describe(error: unknown): string {
  if (error instanceof LibraryError) return error.message;
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'The browser refused access to the folder. Reconnect it to continue.';
      case 'NotFoundError':
        return 'That item is no longer on disk — it may have been moved outside the app.';
      case 'QuotaExceededError':
        return 'The browser is out of storage space for the library.';
      case 'NoModificationAllowedError':
        return 'The file is locked by another program or tab.';
      case 'TypeMismatchError':
        return 'A file and a folder have the same name there.';
      case 'InvalidModificationError':
        return 'That folder is not empty or is in use, so it could not be changed.';
      case 'AbortError':
        return 'The operation was cancelled.';
      default:
        break;
    }
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export { GraphLibrary };
export type { LibraryMode, LibrarySnapshot };

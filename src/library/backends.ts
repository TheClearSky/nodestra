/**
 * Where the library's bytes live. Two backends, one contract:
 *
 *  - MemoryBackend: the browser's own storage (IndexedDB). The tree structure
 *    is one key, each file's text another. Survives a reload (ruling F2).
 *  - FolderBackend: a real folder the user linked with the File System Access
 *    API. Every operation is mirrored to disk; the tree is re-read from disk.
 *
 * Every mutating call receives the tree BEFORE and/or AFTER the change, so
 * the backend can derive both paths itself. Ids never reach the disk.
 */

import { isHiddenEntry, nameKey, sameName } from './names';
import {
  getNode,
  LibraryError,
  newNodeId,
  pathOf,
  serializeTree,
  subtreeIds,
  treeFromNodes,
} from './libraryTree';
import type { LibraryNode, LibraryTree } from './libraryTree';
import type { KeyValueStore } from './keyValueStore';

type BackendKind = 'memory' | 'folder';

interface LibraryBackend {
  readonly kind: BackendKind;
  readText(tree: LibraryTree, id: string): Promise<string>;
  /**
   * Overwrite an existing file, or — with `create` — make a new one. `force`
   * skips the folder backend's "changed on disk since we last saw it" check
   * (see `ConflictError`). `create` REFUSES to replace anything already on
   * disk: the tree only knows what the last scan saw.
   */
  writeText(
    tree: LibraryTree,
    id: string,
    text: string,
    options?: { force?: boolean; create?: boolean },
  ): Promise<void>;
  createFolder(tree: LibraryTree, id: string): Promise<void>;
  /** Rename and/or move `id`: its path in `before` → its path in `after`.
   *  Resolves to a note for the user when part of it could not be done. */
  relocate(before: LibraryTree, after: LibraryTree, id: string): Promise<string | null>;
  /** Delete `id` (and everything under it) as it is in `before`. Resolves
   *  to a note for the user when something had to be left behind. */
  remove(before: LibraryTree, id: string): Promise<string | null>;
  /** Persist the STRUCTURE after a change. Memory only; a folder IS its
   *  structure. */
  saveStructure(tree: LibraryTree): Promise<void>;
  /** Every name currently in `parentId` — on DISK for a folder (hidden and
   *  unlisted entries included where the browser shows them). */
  namesIn(tree: LibraryTree, parentId: string): Promise<string[]>;
}

/** The file changed on disk after we last read or wrote it. */
class ConflictError extends Error {
  constructor(readonly fileName: string) {
    super(`"${fileName}" was changed outside the app since it was opened.`);
    this.name = 'ConflictError';
  }
}

// ─────────────────────────────── memory ────────────────────────────────

const TREE_KEY = 'tree';
const fileKey = (id: string) => `file:${id}`;

class MemoryBackend implements LibraryBackend {
  readonly kind = 'memory' as const;

  constructor(private readonly store: KeyValueStore) {}

  async readText(_tree: LibraryTree, id: string): Promise<string> {
    const text = await this.store.get<string>(fileKey(id));
    if (typeof text !== 'string') {
      throw new LibraryError('This file has no stored content.');
    }
    return text;
  }

  async writeText(_tree: LibraryTree, id: string, text: string): Promise<void> {
    await this.store.set(fileKey(id), text);
  }

  async createFolder(_tree: LibraryTree, _id: string): Promise<void> {}

  async relocate(
    _before: LibraryTree,
    _after: LibraryTree,
    _id: string,
  ): Promise<string | null> {
    // Contents are keyed by id, which does not change; the structure write
    // that follows every operation records the new place.
    return null;
  }

  async remove(before: LibraryTree, id: string): Promise<string | null> {
    for (const gone of subtreeIds(before, id)) {
      if (before.nodes[gone].kind === 'file') await this.store.delete(fileKey(gone));
    }
    return null;
  }

  async saveStructure(tree: LibraryTree): Promise<void> {
    await this.store.set(TREE_KEY, serializeTree(tree));
  }

  async namesIn(tree: LibraryTree, parentId: string): Promise<string[]> {
    return (tree.children[parentId] ?? []).map((id) => tree.nodes[id].name);
  }

  /** The stored structure, if any. */
  async loadStructure(): Promise<string | undefined> {
    return this.store.get<string>(TREE_KEY);
  }

  /** Forget every file and the structure (RE-LINK discards memory). */
  async clear(): Promise<void> {
    for (const key of await this.store.keys()) {
      if (key === TREE_KEY || key.startsWith('file:')) await this.store.delete(key);
    }
  }
}

// ─────────────────────────────── folder ────────────────────────────────

async function directoryAt(
  root: FileSystemDirectoryHandle,
  segments: readonly string[],
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment);
  }
  return current;
}

/** Every name the browser lists in `directory`. */
async function listNames(directory: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  for await (const name of directory.keys()) names.push(name);
  return names;
}

/** Every [name, handle] the browser lists, collected before acting on any. */
async function listEntries(
  directory: FileSystemDirectoryHandle,
): Promise<[string, FileSystemHandle][]> {
  const entries: [string, FileSystemHandle][] = [];
  for await (const entry of directory.entries()) entries.push(entry);
  return entries;
}

/** Does `parent` already contain `name` — file OR folder, any case? Hidden
 *  entries (`.git`) are not in the tree, so the tree's own check misses them. */
async function diskHasName(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<string | undefined> {
  for (const existing of await listNames(parent)) {
    if (sameName(existing, name)) return existing;
  }
  return undefined;
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

async function writeWhole(handle: FileSystemFileHandle, data: FileSystemWriteChunkType) {
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    // An unclosed writable keeps the file locked and its swap file on disk.
    await writable.abort().catch(() => {});
    throw error;
  }
}

async function copyFile(
  source: FileSystemFileHandle,
  destinationParent: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  const bytes = await (await source.getFile()).arrayBuffer();
  const target = await destinationParent.getFileHandle(name, { create: true });
  await writeWhole(target, bytes);
}

type CopyReport = { copied: number; failed: number };

/**
 * Copy what the browser LISTS in `source`. Chrome's listing silently omits
 * names it will not expose to websites (`.lnk`, `.url`, `.scf`, dangerous
 * executables, `~`-names, invisible characters — Chromium
 * `DidReadDirectory` skips any child failing `IsSafePathComponent`), so this
 * copy can never be assumed complete. See `drainCopiedDirectory`.
 */
async function copyDirectory(
  source: FileSystemDirectoryHandle,
  destinationParent: FileSystemDirectoryHandle,
  name: string,
  report: CopyReport,
): Promise<void> {
  const target = await destinationParent.getDirectoryHandle(name, { create: true });
  for await (const [childName, child] of source.entries()) {
    try {
      if (child.kind === 'file') {
        await copyFile(child as FileSystemFileHandle, target, childName);
      } else {
        await copyDirectory(child as FileSystemDirectoryHandle, target, childName, report);
        continue; // counted inside
      }
      report.copied += 1;
    } catch (error) {
      report.failed += 1;
      throw error;
    }
  }
}

/**
 * Remove from `source` ONLY what exists in `copy`, bottom-up, and remove a
 * directory only if it ended up EMPTY (never `recursive: true`). Returns how
 * many entries had to be left behind.
 *
 * WHY NOT `removeEntry(source, { recursive: true })`: that is an OS-level
 * recursive delete, and it deletes the entries the browser never listed —
 * files the copy therefore never made. Measured cause: FB-01 in
 * review/2026-09-26-library. With this drain, anything invisible to the app
 * stays exactly where it was, in the old folder, and the user is told.
 */
async function drainCopiedDirectory(
  source: FileSystemDirectoryHandle,
  copy: FileSystemDirectoryHandle,
): Promise<number> {
  let leftBehind = 0;
  // Snapshot first: removing entries while iterating the same directory can
  // make the iterator skip siblings.
  for (const [childName, child] of await listEntries(source)) {
    try {
      if (child.kind === 'file') {
        await copy.getFileHandle(childName); // throws if the copy lacks it
        await source.removeEntry(childName);
      } else {
        const copiedDirectory = await copy.getDirectoryHandle(childName);
        const kept = await drainCopiedDirectory(
          child as FileSystemDirectoryHandle,
          copiedDirectory,
        );
        leftBehind += kept;
        if (kept === 0) await source.removeEntry(childName).catch(() => {
          leftBehind += 1;
        });
      }
    } catch {
      leftBehind += 1;
    }
  }
  return leftBehind;
}

/**
 * Delete everything the browser lists under `directory`, bottom-up, and the
 * directory itself only if it is then empty. Returns how many entries were
 * left behind (ones the browser does not list, or refuses to delete).
 */
async function drainDirectory(directory: FileSystemDirectoryHandle): Promise<number> {
  let leftBehind = 0;
  for (const [childName, child] of await listEntries(directory)) {
    try {
      if (child.kind === 'file') {
        await directory.removeEntry(childName);
      } else {
        const kept = await drainDirectory(child as FileSystemDirectoryHandle);
        leftBehind += kept;
        if (kept === 0) await directory.removeEntry(childName);
      }
    } catch {
      leftBehind += 1;
    }
  }
  return leftBehind;
}

/** Is `directory` empty as far as the OS is concerned? The browser listing
 *  can omit entries, so "nothing listed" is not proof; a non-recursive
 *  removal attempt is. */
async function removeIfEmpty(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await parent.removeEntry(name);
    return true;
  } catch {
    return false;
  }
}

/** A name no sibling has — the intermediate step of a case-only rename. */
function temporaryName(name: string): string {
  return `${name}.renaming-${Math.random().toString(36).slice(2, 8)}`;
}

type Seen = { lastModified: number; size: number };

class FolderBackend implements LibraryBackend {
  readonly kind = 'folder' as const;
  /** What each file was when we last read or wrote it — the conflict check.
   *  Size as well as time: an outside edit can carry an OLDER timestamp
   *  (a restore, a sync client, a copy with preserved times). */
  private readonly seen = new Map<string, Seen>();

  constructor(readonly root: FileSystemDirectoryHandle) {}

  get folderName(): string {
    return this.root.name;
  }

  private async parentOf(tree: LibraryTree, id: string) {
    const segments = pathOf(tree, id);
    const name = segments[segments.length - 1];
    const parent = await directoryAt(this.root, segments.slice(0, -1));
    return { parent, name };
  }

  private async remember(id: string, handle: FileSystemFileHandle) {
    const file = await handle.getFile();
    this.seen.set(id, { lastModified: file.lastModified, size: file.size });
  }

  async readText(tree: LibraryTree, id: string): Promise<string> {
    const { parent, name } = await this.parentOf(tree, id);
    const handle = await parent.getFileHandle(name);
    const file = await handle.getFile();
    this.seen.set(id, { lastModified: file.lastModified, size: file.size });
    return file.text();
  }

  async writeText(
    tree: LibraryTree,
    id: string,
    text: string,
    options: { force?: boolean; create?: boolean } = {},
  ): Promise<void> {
    const { parent, name } = await this.parentOf(tree, id);
    let handle: FileSystemFileHandle;
    if (options.create) {
      // Never over an entry the tree did not know about (made by another
      // program since the last scan, or hidden from the listing).
      const clash = await diskHasName(parent, name);
      if (clash !== undefined) {
        throw new LibraryError(`"${clash}" already exists in that folder on disk.`);
      }
      handle = await parent.getFileHandle(name, { create: true });
    } else {
      try {
        handle = await parent.getFileHandle(name);
      } catch (error) {
        // Only a genuinely missing file is re-created (deleted outside the
        // app while open). Any other failure — a folder of that name, a
        // lock, a revoked permission — is a real error, not "new".
        if (!isNotFound(error)) throw error;
        const clash = await diskHasName(parent, name);
        if (clash !== undefined) {
          throw new LibraryError(`"${clash}" already exists in that folder on disk.`);
        }
        handle = await parent.getFileHandle(name, { create: true });
      }
      const known = this.seen.get(id);
      if (!options.force && known !== undefined) {
        const current = await handle.getFile();
        if (current.lastModified !== known.lastModified || current.size !== known.size) {
          throw new ConflictError(name);
        }
      }
    }
    await writeWhole(handle, text);
    await this.remember(id, handle);
  }

  async createFolder(tree: LibraryTree, id: string): Promise<void> {
    const { parent, name } = await this.parentOf(tree, id);
    const clash = await diskHasName(parent, name);
    if (clash !== undefined) {
      throw new LibraryError(`"${clash}" already exists in that folder on disk.`);
    }
    await parent.getDirectoryHandle(name, { create: true });
  }

  async namesIn(tree: LibraryTree, parentId: string): Promise<string[]> {
    const segments = pathOf(tree, parentId);
    return listNames(await directoryAt(this.root, segments));
  }

  async relocate(
    before: LibraryTree,
    after: LibraryTree,
    id: string,
  ): Promise<string | null> {
    const node = getNode(before, id);
    const from = await this.parentOf(before, id);
    const to = await this.parentOf(after, id);
    const sameParent = (await from.parent.isSameEntry(to.parent)) === true;
    const caseOnly = sameParent && sameName(from.name, to.name);
    if (!caseOnly) {
      const clash = await diskHasName(to.parent, to.name);
      if (clash !== undefined) {
        throw new LibraryError(`"${clash}" already exists in that folder on disk.`);
      }
    }

    if (node.kind === 'file') {
      const handle = await from.parent.getFileHandle(from.name);
      if (caseOnly) {
        // One step would be a no-op on a case-insensitive disk; go via a
        // temporary name that cannot collide.
        const temp = temporaryName(from.name);
        await this.moveFile(handle, from.parent, from.name, to.parent, temp);
        const tempHandle = await to.parent.getFileHandle(temp);
        await this.moveFile(tempHandle, to.parent, temp, to.parent, to.name);
      } else {
        await this.moveFile(handle, from.parent, from.name, to.parent, to.name);
      }
      await this.remember(id, await to.parent.getFileHandle(to.name));
      return null;
    }

    // Directories cannot be moved or renamed natively in any shipping browser
    // (`FileSystemDirectoryHandle.prototype.move` is undefined in stable
    // Chrome). Copy, then remove from the original ONLY what the copy
    // verifiably holds — never a recursive delete (see drainCopiedDirectory).
    const source = await from.parent.getDirectoryHandle(from.name);
    const stagingName = caseOnly ? temporaryName(from.name) : to.name;
    const report: CopyReport = { copied: 0, failed: 0 };
    try {
      await copyDirectory(source, to.parent, stagingName, report);
    } catch (error) {
      // Undo the partial copy the same careful way: only what we made.
      const partial = await to.parent
        .getDirectoryHandle(stagingName)
        .catch(() => undefined);
      if (partial) {
        await drainDirectory(partial);
        await removeIfEmpty(to.parent, stagingName);
      }
      throw error;
    }
    const staged = await to.parent.getDirectoryHandle(stagingName);
    let leftBehind = await drainCopiedDirectory(source, staged);
    if (leftBehind === 0 && !(await removeIfEmpty(from.parent, from.name))) {
      // The listing showed nothing more, yet the OS says it is not empty:
      // entries the browser hides. They stay put.
      leftBehind = 1;
    }
    if (caseOnly) {
      if (leftBehind > 0) {
        // The original name is still taken by what was left behind; keep
        // the moved content under its temporary name rather than guess.
        throw new LibraryError(
          `Some items in "${from.name}" are hidden from websites and could not be moved; the rest is in "${stagingName}".`,
        );
      }
      const finalReport: CopyReport = { copied: 0, failed: 0 };
      await copyDirectory(staged, to.parent, to.name, finalReport);
      const final = await to.parent.getDirectoryHandle(to.name);
      await drainCopiedDirectory(staged, final);
      await removeIfEmpty(to.parent, stagingName);
    }
    // Every copied file was written just now: refresh the conflict records,
    // or the next save of each would falsely report "changed outside the
    // app" (FB-03).
    await this.rememberSubtree(after, id);
    return leftBehind > 0
      ? `${leftBehind} item(s) in "${from.name}" are hidden from websites by the browser and were left in the original folder, untouched.`
      : null;
  }

  private async rememberSubtree(tree: LibraryTree, id: string): Promise<void> {
    for (const itemId of subtreeIds(tree, id)) {
      if (tree.nodes[itemId].kind !== 'file') continue;
      const { parent, name } = await this.parentOf(tree, itemId);
      const handle = await parent.getFileHandle(name).catch(() => undefined);
      if (handle) await this.remember(itemId, handle);
    }
  }

  private async moveFile(
    handle: FileSystemFileHandle,
    fromParent: FileSystemDirectoryHandle,
    fromName: string,
    toParent: FileSystemDirectoryHandle,
    toName: string,
  ): Promise<void> {
    if (typeof handle.move === 'function') {
      try {
        await handle.move(toParent, toName);
        return;
      } catch {
        // Chrome Android and some edge cases refuse; fall back to a copy.
      }
    }
    await copyFile(handle, toParent, toName);
    await fromParent.removeEntry(fromName);
  }

  async remove(before: LibraryTree, id: string): Promise<string | null> {
    const node = getNode(before, id);
    const { parent, name } = await this.parentOf(before, id);
    for (const gone of subtreeIds(before, id)) this.seen.delete(gone);
    if (node.kind === 'file') {
      await parent.removeEntry(name);
      return null;
    }
    // Same rule as a move: only what the browser lists, never recursive.
    const directory = await parent.getDirectoryHandle(name);
    let leftBehind = await drainDirectory(directory);
    if (leftBehind === 0 && !(await removeIfEmpty(parent, name))) leftBehind = 1;
    return leftBehind > 0
      ? `"${name}" still holds ${leftBehind} item(s) the browser does not let websites see or delete; they were left on disk.`
      : null;
  }

  /** Hidden entries (dot-files, `node_modules`) inside `id`, which the tree
   *  does not show — so a delete can say it will remove them too. */
  async countHiddenEntries(tree: LibraryTree, id: string): Promise<number> {
    if (tree.nodes[id]?.kind !== 'folder') return 0;
    const count = async (directory: FileSystemDirectoryHandle): Promise<number> => {
      let hidden = 0;
      for await (const [name, child] of directory.entries()) {
        if (isHiddenEntry(name)) hidden += 1;
        else if (child.kind === 'directory') {
          hidden += await count(child as FileSystemDirectoryHandle);
        }
      }
      return hidden;
    };
    try {
      return await count(await directoryAt(this.root, pathOf(tree, id)));
    } catch {
      return 0;
    }
  }

  async saveStructure(_tree: LibraryTree): Promise<void> {}
}

// ─────────────────────────────── scanning ──────────────────────────────

type ScanResult = {
  tree: LibraryTree;
  /** Subfolders that could not be read (permissions, locks) — skipped. */
  unreadable: number;
};

/**
 * Read a linked folder into a tree. Hidden entries are skipped entirely;
 * every other file is included (non-JSON ones render greyed). Contents are
 * NOT read — a file's status is decided when it is opened.
 *
 * LINEAR: nodes are collected into plain maps and each folder's children are
 * sorted once at the end. Building it through `addNode` copied the whole node
 * map per entry — quadratic, and it froze the app on a large folder (FB-05).
 *
 * `previous`, when given, lends its ids to entries at the same path AND of
 * the same kind, so a re-scan keeps the open file, the selection and the
 * expanded folders pointing at the same items.
 */
async function scanFolder(
  root: FileSystemDirectoryHandle,
  previous?: LibraryTree,
): Promise<ScanResult> {
  const rootId = previous?.rootId ?? 'root';
  const nodes: Record<string, LibraryNode> = {
    [rootId]: { id: rootId, kind: 'folder', name: '', parentId: null },
  };
  const previousIndex = new Map<string, string>();
  if (previous) {
    for (const node of Object.values(previous.nodes)) {
      if (node.parentId === null) continue;
      previousIndex.set(
        `${node.kind}:${pathOf(previous, node.id).map(nameKey).join('/')}`,
        node.id,
      );
    }
  }
  let unreadable = 0;
  const walk = async (
    directory: FileSystemDirectoryHandle,
    parentId: string,
    segments: string[],
  ) => {
    const entries: [string, FileSystemHandle][] = [];
    try {
      for await (const entry of directory.entries()) entries.push(entry);
    } catch {
      unreadable += 1; // skip this folder, keep the rest of the scan
      return;
    }
    const taken = new Set<string>();
    for (const [name, handle] of entries) {
      if (isHiddenEntry(name)) continue;
      // A case-twin (possible on Linux) cannot be represented; keep the
      // first, leave the other untouched on disk.
      if (taken.has(nameKey(name))) continue;
      taken.add(nameKey(name));
      const kind = handle.kind === 'directory' ? 'folder' : 'file';
      const childSegments = [...segments, name];
      const id =
        previousIndex.get(`${kind}:${childSegments.map(nameKey).join('/')}`) ??
        newNodeId();
      nodes[id] = { id, kind, name, parentId };
      if (kind === 'folder') {
        await walk(handle as FileSystemDirectoryHandle, id, childSegments);
      }
    }
  };
  await walk(root, rootId, []);
  return { tree: treeFromNodes(rootId, nodes), unreadable };
}

/** Is a stored folder handle still usable without asking? */
async function folderPermission(
  handle: FileSystemDirectoryHandle,
  request: boolean,
): Promise<PermissionState> {
  const descriptor = { mode: 'readwrite' as const };
  if (request && typeof handle.requestPermission === 'function') {
    return handle.requestPermission(descriptor);
  }
  if (typeof handle.queryPermission === 'function') {
    return handle.queryPermission(descriptor);
  }
  // No permission API at all (a test double): treat as granted.
  return 'granted';
}

function canLinkFolders(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export {
  canLinkFolders,
  ConflictError,
  FolderBackend,
  folderPermission,
  MemoryBackend,
  scanFolder,
};
export type { BackendKind, LibraryBackend, ScanResult };

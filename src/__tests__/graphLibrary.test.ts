/**
 * The library's behaviour, through its public API, on both backends. The
 * folder is memfs's in-memory File System Access implementation with `move`
 * stripped, so it behaves like stable Chrome (see libraryBackends.test.ts).
 */

import { describe, expect, it } from 'vitest';
import { fsa } from 'memfs/lib/fsa';
import { GraphLibrary } from '../library/graphLibrary';
import { createMemoryStore } from '../library/keyValueStore';
import { findByPath, pathOf } from '../library/libraryTree';

type Dir = FileSystemDirectoryHandle;

async function makeFolder(files: Record<string, string>): Promise<Dir> {
  const { dir } = fsa({ mode: 'readwrite' });
  const root = dir as unknown as Dir;
  for (const [path, text] of Object.entries(files)) {
    const segments = path.split('/');
    let current = root;
    for (const segment of segments.slice(0, -1)) {
      current = await current.getDirectoryHandle(segment, { create: true });
    }
    const handle = await current.getFileHandle(segments[segments.length - 1], {
      create: true,
    });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  }
  const proto = Object.getPrototypeOf(root) as { move?: unknown };
  if ('move' in proto) delete proto.move;
  return root;
}

async function readDisk(root: Dir, path: string): Promise<string | undefined> {
  const segments = path.split('/');
  try {
    let current = root;
    for (const segment of segments.slice(0, -1)) {
      current = await current.getDirectoryHandle(segment);
    }
    const file = await current.getFileHandle(segments[segments.length - 1]);
    return (await file.getFile()).text();
  } catch {
    return undefined;
  }
}

async function freshMemoryLibrary() {
  const store = createMemoryStore();
  const library = new GraphLibrary({ store });
  await library.init();
  return { library, store };
}

describe('GraphLibrary — memory', () => {
  it('boots empty, creates with unique names, and survives a reload', async () => {
    const { library, store } = await freshMemoryLibrary();
    expect(library.mode.kind).toBe('memory');
    const folder = await library.createFolder(library.tree.rootId, 'New folder');
    const a = await library.createFile(folder, 'Untitled.json', 'A');
    const b = await library.createFile(folder, 'Untitled.json', 'B');
    expect(library.tree.nodes[b].name).toBe('Untitled 2.json');

    const reloaded = new GraphLibrary({ store });
    await reloaded.init();
    expect(pathOf(reloaded.tree, a)).toEqual(['New folder', 'Untitled.json']);
    expect(await reloaded.readText(b)).toBe('B');
  });

  it('awaits the mutation guard BEFORE moving a file', async () => {
    const { library } = await freshMemoryLibrary();
    const file = await library.createFile(library.tree.rootId, 'a.json', 'x');
    const folder = await library.createFolder(library.tree.rootId, 'f');
    const order: string[] = [];
    library.beforeMutate = async (ids) => {
      order.push(`guard:${ids.includes(file)}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('guard done');
    };
    await library.move([file], folder).then(() => order.push('moved'));
    expect(order).toEqual(['guard:true', 'guard done', 'moved']);
  });

  it('serialises operations: a save issued before a rename lands first', async () => {
    const { library } = await freshMemoryLibrary();
    const file = await library.createFile(library.tree.rootId, 'a.json', 'old');
    const save = library.writeText(file, 'new');
    const rename = library.rename(file, 'b.json');
    await Promise.all([save, rename]);
    expect(library.tree.nodes[file].name).toBe('b.json');
    expect(await library.readText(file)).toBe('new');
  });

  it('shows a refused operation as an error and leaves the tree unchanged', async () => {
    const { library } = await freshMemoryLibrary();
    const a = await library.createFile(library.tree.rootId, 'a.json', '');
    await library.createFile(library.tree.rootId, 'b.json', '');
    const before = library.tree;
    await expect(library.rename(a, 'B.JSON')).rejects.toThrow(/already exists/);
    expect(library.tree).toBe(before);
    expect(library.getSnapshot().error).toMatch(/already exists/);
    library.dismissError();
    expect(library.getSnapshot().error).toBeNull();
  });

  it('undoes a delete of a folder with its graphs', async () => {
    const { library } = await freshMemoryLibrary();
    const folder = await library.createFolder(library.tree.rootId, 'drums');
    await library.createFile(folder, 'kick.json', 'K');
    await library.remove([folder]);
    expect(findByPath(library.tree, ['drums'])).toBeUndefined();
    expect(library.getSnapshot().undoableDelete).toBe('"drums"');
    await library.undoDelete();
    const kick = findByPath(library.tree, ['drums', 'kick.json']);
    expect(kick).toBeDefined();
    expect(await library.readText(kick!.id)).toBe('K');
    expect(library.getSnapshot().undoableDelete).toBeNull();
  });

  it('remembers open tabs by path: renames follow, deleted files drop out', async () => {
    const { library, store } = await freshMemoryLibrary();
    const folder = await library.createFolder(library.tree.rootId, 'drums');
    const kick = await library.createFile(folder, 'kick.json', 'K');
    const snare = await library.createFile(library.tree.rootId, 'snare.json', 'S');
    const gone = await library.createFile(library.tree.rootId, 'gone.json', 'G');
    await library.rememberTabs({ order: [kick, '@welcome', snare, gone], active: snare, closed: [gone] });
    await library.rename(folder, 'percussion');
    await library.rememberTabs({ order: [kick, '@welcome', snare, gone], active: snare, closed: [gone] });
    await library.remove([gone]);

    const reloaded = new GraphLibrary({ store });
    await reloaded.init();
    const tabs = await reloaded.recallTabs();
    expect(tabs?.order).toEqual([findByPath(reloaded.tree, ['percussion', 'kick.json'])!.id, '@welcome', snare]);
    expect(tabs?.active).toBe(snare);
    expect(tabs?.closed).toEqual([]);
  });

  it('a library from before tabs brings back its single open file as one tab', async () => {
    const { library, store } = await freshMemoryLibrary();
    const file = await library.createFile(library.tree.rootId, 'a.json', '');
    await library.rememberActiveFile(file);
    const reloaded = new GraphLibrary({ store });
    await reloaded.init();
    expect(await reloaded.recallTabs()).toEqual({ order: [file], active: file, closed: [], recent: [file] });
  });

  it('remembers the open file by path', async () => {
    const { library, store } = await freshMemoryLibrary();
    const file = await library.createFile(library.tree.rootId, 'a.json', '');
    await library.rememberActiveFile(file);
    const reloaded = new GraphLibrary({ store });
    await reloaded.init();
    expect(await reloaded.recallActiveFile()).toBe(file);
  });
});

describe('GraphLibrary — linked folder', () => {
  it('LINK discards the in-memory library and loads the folder', async () => {
    const { library } = await freshMemoryLibrary();
    await library.createFile(library.tree.rootId, 'memory-only.json', 'M');
    const root = await makeFolder({ 'disk.json': 'D', 'notes.txt': 'n' });
    await library.link(root);
    expect(library.mode).toEqual({ kind: 'folder', folderName: root.name });
    expect(findByPath(library.tree, ['memory-only.json'])).toBeUndefined();
    expect(findByPath(library.tree, ['disk.json'])).toBeDefined();
    expect(findByPath(library.tree, ['notes.txt'])).toBeDefined();
  });

  it('mirrors create, rename, move and delete to disk', async () => {
    const { library } = await freshMemoryLibrary();
    const root = await makeFolder({});
    await library.link(root);
    const folder = await library.createFolder(library.tree.rootId, 'drums');
    const file = await library.createFile(library.tree.rootId, 'kick.json', 'K');
    expect(await readDisk(root, 'kick.json')).toBe('K');
    await library.rename(file, 'boom.json');
    expect(await readDisk(root, 'boom.json')).toBe('K');
    expect(await readDisk(root, 'kick.json')).toBeUndefined();
    await library.move([file], folder);
    expect(await readDisk(root, 'drums/boom.json')).toBe('K');
    await library.remove([folder]);
    expect(await readDisk(root, 'drums/boom.json')).toBeUndefined();
  });

  it('UNLINK copies folders and .json files into memory, not other files', async () => {
    const { library, store } = await freshMemoryLibrary();
    const root = await makeFolder({
      'drums/kick.json': 'K',
      'drums/kick.wav': 'RIFF',
      'notes.txt': 'n',
      'broken.json': 'not json',
    });
    await library.link(root);
    const kickId = findByPath(library.tree, ['drums', 'kick.json'])!.id;
    expect(library.unlinkSummary()).toEqual({ folders: 1, graphs: 2, otherFiles: 2 });
    await library.unlink();
    expect(library.mode.kind).toBe('memory');
    expect(findByPath(library.tree, ['drums', 'kick.wav'])).toBeUndefined();
    expect(findByPath(library.tree, ['notes.txt'])).toBeUndefined();
    // Same id: the open file stays open across an unlink.
    expect(findByPath(library.tree, ['drums', 'kick.json'])!.id).toBe(kickId);
    expect(await library.readText(kickId)).toBe('K');
    const broken = findByPath(library.tree, ['broken.json'])!;
    expect(await library.readText(broken.id)).toBe('not json');

    // And it is the library after a reload, with the folder forgotten.
    const reloaded = new GraphLibrary({ store });
    await reloaded.init();
    expect(reloaded.mode.kind).toBe('memory');
    expect(findByPath(reloaded.tree, ['drums', 'kick.json'])).toBeDefined();
  });

  it('keeps ids across a rescan after an outside change', async () => {
    const { library } = await freshMemoryLibrary();
    const root = await makeFolder({ 'a.json': 'A' });
    await library.link(root);
    const a = findByPath(library.tree, ['a.json'])!.id;
    const handle = await root.getFileHandle('new.json', { create: true });
    const writable = await handle.createWritable();
    await writable.write('N');
    await writable.close();
    // Throttled: a focus-driven rescan right after linking does nothing.
    await library.rescan();
    expect(findByPath(library.tree, ['new.json'])).toBeUndefined();
    await library.rescan({ force: true });
    expect(findByPath(library.tree, ['a.json'])!.id).toBe(a);
    expect(findByPath(library.tree, ['new.json'])).toBeDefined();
  });

  it('keeps the SAME tree object when a rescan finds nothing changed', async () => {
    const { library } = await freshMemoryLibrary();
    const root = await makeFolder({ 'a.json': 'A' });
    await library.link(root);
    const before = library.tree;
    await library.rescan({ force: true });
    expect(library.tree).toBe(before);
  });

  it('a pre-change save of the OPEN file does not deadlock the queue', async () => {
    // The mutation guard saves through the queue; it must run OUTSIDE it.
    const { library } = await freshMemoryLibrary();
    const file = await library.createFile(library.tree.rootId, 'a.json', 'old');
    library.beforeMutate = async (ids) => {
      if (ids.includes(file)) await library.writeText(file, 'saved first');
    };
    const outcome = await Promise.race([
      library.rename(file, 'b.json').then(() => 'done'),
      new Promise((resolve) => setTimeout(() => resolve('DEADLOCK'), 1000)),
    ]);
    expect(outcome).toBe('done');
    expect(await library.readText(file)).toBe('saved first');
    const other = await library.createFile(library.tree.rootId, 'c.json', '');
    await library.remove([other]);
    expect(library.tree.nodes[other]).toBeUndefined();
  });
});

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTree } from '@headless-tree/react';
import {
  dragAndDropFeature,
  hotkeysCoreFeature,
  renamingFeature,
  selectionFeature,
  syncDataLoaderFeature,
} from '@headless-tree/core';
import type { DragTarget, ItemInstance, TreeInstance } from '@headless-tree/core';
import { cn, FullGraphContextMenu } from '@theclearsky/react-blender-nodes';
import type { ContextMenuItem } from '@theclearsky/react-blender-nodes';
import type { LibrarySnapshot } from '../library/graphLibrary';
import type { LibraryNode } from '../library/libraryTree';
import { isGraphFileName, splitExtension } from '../library/names';

export type FileSidebarProps = {
  snapshot: LibrarySnapshot;
  activeFileId: string | null;
  isDirty(fileId: string): boolean;
  /** Tree operations are disabled (library loading, folder awaiting
   *  reconnection, or a probe session). */
  readOnly: boolean;
  /** Link / Unlink / Reconnect are disabled (probe or ?nosave session). */
  folderActionsDisabled: boolean;
  canLinkFolders: boolean;
  onOpen(fileId: string): void;
  onNewFile(parentId: string): void;
  onNewFolder(parentId: string): void;
  onRename(id: string, name: string): void;
  onMove(ids: string[], targetFolderId: string): void;
  onDelete(ids: string[]): void;
  onUndoDelete(): void;
  onLink(): void;
  onUnlink(): void;
  onReconnect(): void;
  onDismissError(): void;
  onDismissNotice(): void;
  /** Id of an item to put into rename mode right after it appears. */
  renameRequest: string | null;
  onRenameRequestHandled(): void;
};

const ROW_HEIGHT = 'h-[26px]';
const INDENT_PX = 14;
const TOOLBAR_BUTTON =
  'cursor-pointer rounded px-1.5 py-0.5 text-[12px] text-primary-white hover:bg-secondary-dark-gray disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent';

/**
 * Keys the TREE owns when a row has focus. Everything else — letters and
 * numbers (the piano), Escape (panic silence), Ctrl+Z (graph undo) — passes
 * through to the app. Stopping every keydown made the whole app deaf after a
 * single click on a file, Esc included (G1/G2).
 */
const TREE_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'Enter',
  'F2',
  'Delete',
  'Backspace',
]);

/** Only folders and `.json` files take part in the library; every other
 *  file in a linked folder is shown greyed and left alone. */
function isInert(node: LibraryNode): boolean {
  return node.kind === 'file' && !isGraphFileName(node.name);
}

/** Stand-in for an id the current tree no longer has (see the loader). */
function missingNode(id: string): LibraryNode {
  return { id, kind: 'file', name: '', parentId: null };
}

/** The folder a new item or a drop lands in: the item itself if it is a
 *  folder, else its parent. */
function folderFor(node: LibraryNode | undefined, rootId: string): string {
  if (!node) return rootId;
  return node.kind === 'folder' ? node.id : (node.parentId ?? rootId);
}

/**
 * A new name for a GRAPH file always ends in `.json`. Anything else the user
 * typed after a dot is part of the name ("Song v1.2" → "Song v1.2.json"),
 * because a graph that loses `.json` turns into a greyed file that can never
 * be opened or renamed back (I1).
 */
function graphFileName(typed: string): string {
  return isGraphFileName(typed) ? typed : `${typed}.json`;
}

/**
 * Bring headless-tree's own state in line with the current data: every id
 * it remembers must still exist. Selected, focused, renaming and expanded
 * ids were never pruned, so after a delete, a link (a whole new tree with
 * new ids) or a re-scan, keyboard Delete silently did nothing, drags refused
 * to start, Shift+click picked the wrong range and no row was reachable with
 * Tab (H1). Same class as the placeholder-loader crash.
 */
function pruneTreeState(tree: TreeInstance<LibraryNode>, nodes: Record<string, LibraryNode>) {
  const state = tree.getState();
  const selected = (state.selectedItems ?? []).filter((id) => nodes[id]);
  if (selected.length !== (state.selectedItems ?? []).length) tree.setSelectedItems(selected);
  if (state.focusedItem && !nodes[state.focusedItem]) {
    tree.applySubStateUpdate('focusedItem', null);
  }
  if (state.renamingItem && !nodes[state.renamingItem]) {
    tree.applySubStateUpdate('renamingItem', null);
  }
  const expanded = [...new Set((state.expandedItems ?? []).filter((id) => nodes[id]))];
  if (expanded.length !== (state.expandedItems ?? []).length) {
    tree.applySubStateUpdate('expandedItems', expanded);
  }
  const dataRef = tree.getDataRef<{ selectUpToAnchorId?: string | null }>();
  if (dataRef.current.selectUpToAnchorId && !nodes[dataRef.current.selectUpToAnchorId]) {
    dataRef.current.selectUpToAnchorId = null;
  }
}

/**
 * The graph library as a left sidebar: a headless-tree tree (MIT, zero
 * dependencies; ruling F1) whose rows we render ourselves.
 */
function FileSidebar({
  snapshot,
  activeFileId,
  isDirty,
  readOnly,
  folderActionsDisabled,
  canLinkFolders,
  onOpen,
  onNewFile,
  onNewFolder,
  onRename,
  onMove,
  onDelete,
  onUndoDelete,
  onLink,
  onUnlink,
  onReconnect,
  onDismissError,
  onDismissNotice,
  renameRequest,
  onRenameRequestHandled,
}: FileSidebarProps) {
  const treeData = snapshot.tree;
  // The data loader is read lazily by the tree; a ref keeps it current
  // without rebuilding the tree instance on every snapshot.
  const dataRef = useRef(treeData);
  dataRef.current = treeData;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  /** The rename SESSION whose text selection has been set, so re-renders do
   *  not reselect. Reset whenever no rename is active — Enter/Esc end a
   *  rename without reaching the input's own handlers (G6). */
  const renameSelectedFor = useRef<string | null>(null);
  /** A modifier was held on the click that triggered the primary action. */
  const modifierClickRef = useRef(false);

  const commitRename = (item: ItemInstance<LibraryNode>, value: string) => {
    const node = item.getItemData();
    if (!node || !dataRef.current.nodes[node.id]) return;
    let name = value.trim();
    if (name.length === 0 || name === node.name) return;
    if (node.kind === 'file' && isGraphFileName(node.name)) name = graphFileName(name);
    onRename(node.id, name);
  };

  const tree = useTree<LibraryNode>({
    rootItemId: treeData.rootId,
    getItemName: (item) => item.getItemData()?.name ?? '',
    isItemFolder: (item) => item.getItemData()?.kind === 'folder',
    dataLoader: {
      // Never undefined: headless-tree can ask for ids from the previous
      // structure before the rebuild, and throws on undefined — which once
      // unmounted the whole app. A placeholder is filtered out at render.
      getItem: (id) => dataRef.current.nodes[id] ?? missingNode(id),
      getChildren: (id) => [...(dataRef.current.children[id] ?? [])],
    },
    indent: INDENT_PX,
    // Folders are sorted by name, so a drop position between two rows has no
    // meaning; every drop lands INSIDE a folder.
    canReorder: false,
    canDrag: (items) =>
      !readOnlyRef.current &&
      items.every((item) => {
        const node = dataRef.current.nodes[item.getId()];
        return node !== undefined && !isInert(node);
      }),
    // A folder takes the drop; a FILE hands it to its parent folder — which
    // is how a file reaches the ROOT, the rows there being files (S13).
    canDrop: (_items, target: DragTarget<LibraryNode>) =>
      !readOnlyRef.current && dataRef.current.nodes[target.item.getId()] !== undefined,
    onDrop: (items, target) => {
      const targetNode = dataRef.current.nodes[target.item.getId()];
      onMove(
        items.map((item) => item.getId()).filter((id) => dataRef.current.nodes[id]),
        folderFor(targetNode, dataRef.current.rootId),
      );
    },
    // Firefox only starts an HTML5 drag if the dragstart sets some data.
    createForeignDragObject: (items) => ({
      format: 'text/plain',
      data: items.map((item) => item.getItemName()).join('\n'),
      effectAllowed: 'move',
    }),
    canRename: (item) => {
      const node = dataRef.current.nodes[item.getId()];
      return !readOnlyRef.current && node !== undefined && !isInert(node);
    },
    onRename: commitRename,
    onPrimaryAction: (item) => {
      // Ctrl/Shift/Cmd+click is multi-select, not "open" (G5).
      if (modifierClickRef.current) return;
      const node = dataRef.current.nodes[item.getId()];
      if (node && node.kind === 'file' && !isInert(node)) onOpen(node.id);
    },
    hotkeys: {
      customOpen: {
        hotkey: 'Enter',
        isEnabled: (instance) => !instance.isRenamingItem(),
        handler: (_event, instance) => {
          const focused = instance.getFocusedItem();
          if (focused.isFolder()) {
            if (focused.isExpanded()) focused.collapse();
            else focused.expand();
          } else {
            focused.primaryAction();
          }
        },
      },
      customDelete: {
        hotkey: 'Delete',
        isEnabled: (instance) => !instance.isRenamingItem(),
        handler: (_event, instance) => deleteFromKeyboard(instance),
      },
      // macOS has no Delete key on most keyboards (S20).
      customBackspace: {
        hotkey: 'Backspace',
        isEnabled: (instance) => !instance.isRenamingItem(),
        handler: (_event, instance) => deleteFromKeyboard(instance),
      },
    },
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      dragAndDropFeature,
      renamingFeature,
    ],
  });

  function deleteFromKeyboard(instance: TreeInstance<LibraryNode>) {
    if (readOnlyRef.current) return;
    const selected = instance
      .getSelectedItems()
      .map((item) => item.getId())
      .filter((id) => dataRef.current.nodes[id] && id !== dataRef.current.rootId);
    const focusedId = instance.getState().focusedItem;
    const ids =
      selected.length > 0
        ? selected
        : focusedId && dataRef.current.nodes[focusedId]
          ? [focusedId]
          : [];
    if (ids.length > 0) onDelete(ids);
  }

  // Structure changed (ours or a re-scan): prune stale ids and let the tree
  // re-read — BEFORE paint, so the old rows never flash (H2).
  useLayoutEffect(() => {
    pruneTreeState(tree, treeData.nodes);
    tree.rebuildTree();
  }, [tree, treeData]);

  // The open file is revealed and selected — after a demo or import too
  // (S14). DOM focus is NOT moved: taking it from the canvas would divert
  // the next keypress into the tree.
  useEffect(() => {
    if (!activeFileId || !treeData.nodes[activeFileId]) return;
    let parent = treeData.nodes[activeFileId].parentId;
    while (parent && parent !== treeData.rootId) {
      tree.getItemInstance(parent).expand();
      parent = treeData.nodes[parent]?.parentId ?? null;
    }
    tree.setSelectedItems([activeFileId]);
    tree.applySubStateUpdate('focusedItem', activeFileId);
    void tree.getItemInstance(activeFileId).scrollTo({ block: 'nearest' }).catch(() => {});
  }, [activeFileId, tree, treeData]);

  // A freshly created item goes straight into rename mode, like an explorer.
  useEffect(() => {
    if (!renameRequest) return;
    if (!treeData.nodes[renameRequest]) return;
    let parent = treeData.nodes[renameRequest].parentId;
    while (parent && parent !== treeData.rootId) {
      tree.getItemInstance(parent).expand();
      parent = treeData.nodes[parent]?.parentId ?? null;
    }
    tree.rebuildTree();
    const item = tree.getItemInstance(renameRequest);
    item.setFocused();
    tree.setSelectedItems([renameRequest]);
    item.startRenaming();
    onRenameRequestHandled();
  }, [renameRequest, treeData, tree, onRenameRequestHandled]);

  if (!tree.getState().renamingItem) renameSelectedFor.current = null;

  const focusedNode = (() => {
    const focused = tree.getState().focusedItem;
    return focused ? treeData.nodes[focused] : undefined;
  })();
  const targetFolder = folderFor(focusedNode, treeData.rootId);
  const selectedIds = tree
    .getSelectedItems()
    .map((item) => item.getId())
    .filter((id) => id !== treeData.rootId && treeData.nodes[id]);

  const mode = snapshot.mode;

  // Right-click on a row: the graph's own context menu (host
  // FullGraphContextMenu), with the actions for the selection.
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = () => setMenuPosition(null);
  const renameTarget =
    !readOnly &&
    selectedIds.length === 1 &&
    treeData.nodes[selectedIds[0]] !== undefined &&
    !isInert(treeData.nodes[selectedIds[0]])
      ? selectedIds[0]
      : null;
  const menuItems: ContextMenuItem[] = [];
  if (renameTarget !== null) {
    menuItems.push({
      id: 'rename',
      label: 'Rename',
      shortcut: 'F2',
      onClick: () => {
        closeMenu();
        tree.getItemInstance(renameTarget).startRenaming();
      },
    });
  }
  if (!readOnly && selectedIds.length > 0) {
    menuItems.push({
      id: 'delete',
      label: selectedIds.length > 1 ? `Delete ${selectedIds.length} items` : 'Delete',
      shortcut: 'Del',
      onClick: () => {
        closeMenu();
        onDelete(selectedIds);
      },
    });
  }
  const empty = (treeData.children[treeData.rootId] ?? []).length === 0;

  return (
    <aside
      className='nokey flex h-full w-[260px] flex-none flex-col border-r border-secondary-dark-gray bg-secondary-black text-[13px] text-primary-white'
      aria-label='Graph library'
      onKeyDown={(event: ReactKeyboardEvent) => {
        const target = event.target as HTMLElement;
        // Typing in the rename box: every key belongs to the box, EXCEPT
        // Escape, which ends the rename (headless-tree handles it first).
        if (target.tagName === 'INPUT') {
          if (event.key !== 'Escape') event.stopPropagation();
          return;
        }
        // On a row: only the keys the tree uses (plus Ctrl+A select-all).
        if (
          target.getAttribute('role') === 'treeitem' &&
          (TREE_KEYS.has(event.key) || ((event.ctrlKey || event.metaKey) && event.key === 'a'))
        ) {
          event.stopPropagation();
        }
      }}
    >
      <div className='flex items-center gap-1 border-b border-secondary-dark-gray px-2 py-1.5'>
        <span className='mr-auto text-[12px] font-semibold tracking-wide text-primary-light-gray uppercase'>
          Library
        </span>
        <button
          type='button'
          className={TOOLBAR_BUTTON}
          disabled={readOnly}
          title='New graph'
          aria-label='New graph'
          onClick={() => onNewFile(targetFolder)}
        >
          ＋ Graph
        </button>
        <button
          type='button'
          className={TOOLBAR_BUTTON}
          disabled={readOnly}
          title='New folder'
          aria-label='New folder'
          onClick={() => onNewFolder(targetFolder)}
        >
          ＋ Folder
        </button>
      </div>

      <div className='flex items-center gap-1 border-b border-secondary-dark-gray px-2 py-1 text-[12px] text-primary-light-gray'>
        {mode.kind === 'loading' && <span>Loading…</span>}
        {mode.kind === 'memory' && (
          <>
            <span className='mr-auto' title='Stored in this browser, not on disk'>
              {snapshot.storageUnavailable ? 'This tab only' : 'In this browser'}
            </span>
            {canLinkFolders ? (
              <button
                type='button'
                className={TOOLBAR_BUTTON}
                disabled={folderActionsDisabled}
                onClick={onLink}
                title='Use a folder on this computer as the library (replaces what is here)'
              >
                Link folder…
              </button>
            ) : (
              <span
                className='text-[11px]'
                title='Linking a local folder needs Chrome, Edge or Opera on desktop — Firefox and Safari do not provide the File System Access API.'
              >
                Folder linking unavailable
              </span>
            )}
          </>
        )}
        {mode.kind === 'folder' && (
          <>
            <span className='mr-auto truncate' title='Every change is written to this folder'>
              📁 {mode.folderName}
            </span>
            <button
              type='button'
              className={TOOLBAR_BUTTON}
              disabled={folderActionsDisabled}
              onClick={onUnlink}
              title='Copy the folder’s graphs into this browser and stop using the folder'
            >
              Unlink
            </button>
          </>
        )}
        {mode.kind === 'reconnect' && (
          <>
            <span className='mr-auto truncate'>📁 {mode.folderName}</span>
            <button
              type='button'
              className={cn(TOOLBAR_BUTTON, 'text-status-warning')}
              disabled={folderActionsDisabled}
              onClick={onReconnect}
              title='The browser needs your permission again to use this folder'
            >
              Reconnect
            </button>
            <button
              type='button'
              className={TOOLBAR_BUTTON}
              disabled={folderActionsDisabled}
              onClick={onUnlink}
              title='Forget this folder'
            >
              Forget
            </button>
          </>
        )}
      </div>

      {/* Actions on the selection, right under the storage strip (they used
          to sit at the very bottom, far from the tree they act on). */}
      <div className='flex items-center gap-1 border-b border-secondary-dark-gray px-2 py-1'>
        <button
          type='button'
          className={TOOLBAR_BUTTON}
          disabled={
            readOnly ||
            selectedIds.length !== 1 ||
            !treeData.nodes[selectedIds[0]] ||
            isInert(treeData.nodes[selectedIds[0]])
          }
          onClick={() => tree.getItemInstance(selectedIds[0]).startRenaming()}
          title='Rename (F2 or double-click)'
        >
          Rename
        </button>
        <button
          type='button'
          className={TOOLBAR_BUTTON}
          disabled={readOnly || selectedIds.length === 0}
          onClick={() => onDelete(selectedIds)}
          title='Delete (Del)'
        >
          Delete
        </button>
        {snapshot.undoableDelete && (
          <button
            type='button'
            className={cn(TOOLBAR_BUTTON, 'ml-auto')}
            disabled={readOnly}
            onClick={onUndoDelete}
            title={`Restore ${snapshot.undoableDelete}`}
          >
            Undo delete
          </button>
        )}
        {snapshot.busy && (
          <span className='ml-auto text-[11px] text-primary-light-gray'>Saving…</span>
        )}
      </div>

      <div
        {...tree.getContainerProps('Graph library')}
        className='relative min-h-0 flex-1 overflow-y-auto py-1 outline-none'
      >
        {tree.getItems().map((item) => {
          // Skip stale rows (a placeholder from the loader) until the rebuild.
          const node = treeData.nodes[item.getId()];
          if (!node) return null;
          const inert = isInert(node);
          const isActive = node.id === activeFileId;
          const unsupported = snapshot.unsupported.has(node.id);
          const level = item.getItemMeta().level;
          const renameProps = item.isRenaming() ? item.getRenameInputProps() : null;
          const rowProps = item.getProps();
          return (
            <div
              key={item.getKey()}
              {...rowProps}
              onClick={(event) => {
                modifierClickRef.current = event.ctrlKey || event.shiftKey || event.metaKey;
                try {
                  rowProps.onClick?.(event);
                } finally {
                  modifierClickRef.current = false;
                }
              }}
              onDoubleClick={() => {
                if (!inert && !readOnlyRef.current) item.startRenaming();
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                // Right-clicking outside the selection acts on that row alone;
                // inside a multi-selection it keeps the selection.
                if (!item.isSelected()) {
                  tree.setSelectedItems([node.id]);
                  item.setFocused();
                }
                // The keyboard's menu key reports (0, 0): open at the row.
                const rect = event.currentTarget.getBoundingClientRect();
                setMenuPosition({
                  x: event.clientX || rect.left + 24,
                  y: event.clientY || rect.bottom,
                });
              }}
              className={cn(
                'flex cursor-pointer items-center gap-1.5 pr-2 outline-none select-none',
                ROW_HEIGHT,
                item.isSelected() && 'bg-secondary-dark-gray',
                isActive && 'bg-primary-blue/25',
                item.isFocused() && 'shadow-[inset_0_0_0_1px_var(--color-secondary-light-gray)]',
                item.isDragTarget() && node.kind === 'folder' && 'bg-primary-blue/40',
                inert && 'cursor-default text-secondary-light-gray opacity-60',
              )}
              style={{ paddingLeft: 8 + level * INDENT_PX }}
              title={
                inert
                  ? 'Not a graph file — ignored by the library'
                  : unsupported
                    ? 'This file could not be opened as a graph'
                    : undefined
              }
            >
              <span aria-hidden='true' className='w-3 text-center text-[10px] text-primary-light-gray'>
                {node.kind === 'folder' ? (item.isExpanded() ? '▾' : '▸') : ''}
              </span>
              <span aria-hidden='true' className='w-4 text-center text-[12px]'>
                {node.kind === 'folder' ? '🗀' : inert ? '·' : '◇'}
              </span>
              {renameProps ? (
                <input
                  {...renameProps}
                  ref={(element) => {
                    renameProps.ref?.(element);
                    // Select the NAME, not the extension — typing replaces
                    // "kick" and keeps ".json". Once per rename session.
                    if (element && renameSelectedFor.current !== node.id) {
                      renameSelectedFor.current = node.id;
                      const { stem } = splitExtension(node.name);
                      element.setSelectionRange(
                        0,
                        node.kind === 'file' ? stem.length : node.name.length,
                      );
                    }
                  }}
                  // The box lives inside the row; without these a click in it
                  // runs the ROW's click — toggling a folder or opening
                  // another file mid-rename (G4).
                  onClick={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  // Clicking away COMMITS (every explorer does), and without
                  // headless-tree's completeRenaming: that pulls DOM focus
                  // back onto the row ~20 ms later, stealing it from the
                  // canvas the user just clicked (G3).
                  onBlur={() => {
                    const renaming = tree.getRenamingItem();
                    const value = tree.getRenamingValue();
                    renameSelectedFor.current = null;
                    tree.applySubStateUpdate('renamingItem', null);
                    if (renaming) commitRename(renaming, value);
                  }}
                  aria-label={`Rename ${node.name}`}
                  className='min-w-0 flex-1 rounded border border-primary-blue bg-primary-black px-1 text-[13px] text-primary-white outline-none'
                />
              ) : (
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    unsupported && 'line-through decoration-secondary-light-gray',
                  )}
                >
                  {node.name}
                </span>
              )}
              {node.kind === 'file' && isDirty(node.id) && (
                <span
                  aria-label='unsaved'
                  title='Unsaved changes'
                  className='h-2 w-2 flex-none rounded-full bg-status-warning'
                />
              )}
            </div>
          );
        })}
        {empty && mode.kind !== 'loading' && (
          <p className='px-3 py-4 text-[12px] leading-relaxed text-primary-light-gray'>
            {mode.kind === 'reconnect'
              ? 'Reconnect to see the folder’s graphs.'
              : 'No graphs yet. Create one with ＋ Graph, or pick a demo from the Demos menu.'}
          </p>
        )}
        <div style={tree.getDragLineStyle()} className='pointer-events-none h-0.5 bg-primary-blue' />
      </div>

      {snapshot.notice && (
        <div
          role='status'
          className='flex items-start gap-2 border-t border-status-warning/50 bg-status-warning/10 px-2 py-1.5 text-[12px]'
        >
          <span className='min-w-0 flex-1'>{snapshot.notice}</span>
          <button type='button' className={TOOLBAR_BUTTON} onClick={onDismissNotice} aria-label='Dismiss'>
            ✕
          </button>
        </div>
      )}
      {snapshot.error && (
        <div
          role='alert'
          className='flex items-start gap-2 border-t border-status-errored/60 bg-status-errored/15 px-2 py-1.5 text-[12px]'
        >
          <span className='min-w-0 flex-1'>{snapshot.error}</span>
          <button type='button' className={TOOLBAR_BUTTON} onClick={onDismissError} aria-label='Dismiss'>
            ✕
          </button>
        </div>
      )}
      <FullGraphContextMenu
        isOpen={menuPosition !== null && menuItems.length > 0}
        position={menuPosition ?? { x: 0, y: 0 }}
        onClose={closeMenu}
        items={menuItems}
      />
    </aside>
  );
}

export { FileSidebar };

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { cn } from '@theclearsky/react-blender-nodes';

/**
 * The open files, VS Code style — built from scratch (ruling Q1): one row,
 * one editor below it (tabs only choose what the single editor shows).
 *
 * Keyboard follows the WAI-ARIA tabs pattern with MANUAL activation, because
 * activating a tab swaps the whole editor (and stops its audio):
 *   ←/→ Home/End move focus · Enter/Space open · Delete closes ·
 *   Ctrl+Shift+←/→ move the tab · Shift+F10 / Menu key: the context menu.
 * Mouse: click opens, middle-click closes, drag reorders.
 */

type TabStripProps = {
  order: readonly string[];
  active: string | null;
  label(id: string): string;
  isDirty(id: string): boolean;
  /** The file is gone (deleted outside the app) — struck through. */
  isMissing(id: string): boolean;
  onActivate(id: string): void;
  onClose(ids: readonly string[]): void;
  onCloseOthers(id: string): void;
  onCloseRight(id: string): void;
  onCloseSaved(): void;
  onCloseAll(): void;
  onReorder(id: string, toIndex: number): void;
  onReopen(): void;
  /** id of the element the tabs control (the editor area). */
  panelId: string;
};

const DRAG_THRESHOLD_PX = 4;
const EDGE_SCROLL_PX = 32;

const MENU_ITEM =
  'flex cursor-pointer items-center justify-between gap-6 rounded px-2 py-1 text-[12px] text-primary-white outline-none select-none data-[disabled]:cursor-default data-[disabled]:opacity-40 data-[highlighted]:bg-secondary-dark-gray';

function TabStrip(props: TabStripProps) {
  const { order, active, label, isDirty, isMissing, onActivate, onClose, onReorder, panelId } = props;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const [focusId, setFocusId] = useState<string | null>(active);
  const [drag, setDrag] = useState<{ id: string; startX: number; moving: boolean; dropIndex: number } | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);

  // The roving tab stop follows the active tab when focus is not in the strip.
  useEffect(() => {
    if (!scrollerRef.current?.contains(document.activeElement)) setFocusId(active);
  }, [active]);

  // Keep the active tab in view.
  useEffect(() => {
    if (active) tabRefs.current.get(active)?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [active, order]);

  const tabStop = focusId !== null && order.includes(focusId) ? focusId : (active ?? order[0] ?? null);

  const focusTab = (id: string | undefined) => {
    if (!id) return;
    setFocusId(id);
    tabRefs.current.get(id)?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent, id: string) => {
    const index = order.indexOf(id);
    if (event.ctrlKey && event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      onReorder(id, index + (event.key === 'ArrowLeft' ? -1 : 1));
      requestAnimationFrame(() => tabRefs.current.get(id)?.focus());
      return;
    }
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        focusTab(order[(index - 1 + order.length) % order.length]);
        break;
      case 'ArrowRight':
        event.preventDefault();
        focusTab(order[(index + 1) % order.length]);
        break;
      case 'Home':
        event.preventDefault();
        focusTab(order[0]);
        break;
      case 'End':
        event.preventDefault();
        focusTab(order[order.length - 1]);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onActivate(id);
        break;
      case 'Delete':
        event.preventDefault();
        onClose([id]);
        focusTab(order[index + 1] ?? order[index - 1]);
        break;
    }
  };

  // ── drag reorder (one row, pointer events) ──────────────────────────
  const dropIndexAt = (clientX: number, draggedId: string) => {
    const others = order.filter((id) => id !== draggedId);
    let index = 0;
    for (const id of others) {
      const rect = tabRefs.current.get(id)?.getBoundingClientRect();
      if (rect && clientX > rect.left + rect.width / 2) index += 1;
    }
    return index;
  };
  const onPointerDown = (event: ReactPointerEvent, id: string) => {
    if (event.button !== 0) return;
    setDrag({ id, startX: event.clientX, moving: false, dropIndex: order.indexOf(id) });
  };
  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent) => {
      const moving = drag.moving || Math.abs(event.clientX - drag.startX) > DRAG_THRESHOLD_PX;
      if (!moving) return;
      const scroller = scrollerRef.current;
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        if (event.clientX < rect.left + EDGE_SCROLL_PX) scroller.scrollLeft -= 12;
        else if (event.clientX > rect.right - EDGE_SCROLL_PX) scroller.scrollLeft += 12;
      }
      setDrag({ ...drag, moving: true, dropIndex: dropIndexAt(event.clientX, drag.id) });
    };
    const onUp = () => {
      if (drag.moving) onReorder(drag.id, drag.dropIndex);
      setDrag(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  });

  if (order.length === 0) return null;
  const dragging = drag?.moving ? drag : null;
  const indicatorBefore = dragging ? order.filter((id) => id !== dragging.id)[dragging.dropIndex] : undefined;
  const indicatorAtEnd = dragging !== null && indicatorBefore === undefined;

  return (
    <div className='flex h-[34px] flex-none items-stretch border-b border-secondary-dark-gray bg-secondary-black'>
      <div
        ref={scrollerRef}
        role='tablist'
        aria-label='Open files'
        onWheel={(event) => {
          if (event.deltaY !== 0 && scrollerRef.current) scrollerRef.current.scrollLeft += event.deltaY;
        }}
        className='flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:thin]'
      >
        {order.map((id) => {
          const selected = id === active;
          const dirty = isDirty(id);
          const missing = isMissing(id);
          const name = label(id);
          return (
            <ContextMenu.Root key={id}>
              <ContextMenu.Trigger asChild>
                <div
                  ref={(element) => {
                    if (element) tabRefs.current.set(id, element);
                    else tabRefs.current.delete(id);
                  }}
                  role='tab'
                  id={`tab-${id}`}
                  aria-selected={selected}
                  aria-controls={panelId}
                  aria-label={`${name}${dirty ? ', unsaved' : ''}${missing ? ', deleted' : ''}`}
                  tabIndex={id === tabStop ? 0 : -1}
                  title={missing ? `${name} — deleted` : name}
                  onKeyDown={(event) => onKeyDown(event, id)}
                  onFocus={() => setFocusId(id)}
                  onClick={() => {
                    if (!drag?.moving) onActivate(id);
                  }}
                  onAuxClick={(event) => {
                    if (event.button === 1) {
                      event.preventDefault();
                      onClose([id]);
                    }
                  }}
                  onMouseDown={(event) => {
                    if (event.button === 1) event.preventDefault(); // no autoscroll cursor
                  }}
                  onPointerDown={(event) => onPointerDown(event, id)}
                  className={cn(
                    'group relative flex max-w-[220px] flex-none cursor-pointer items-center gap-1.5 border-r border-secondary-dark-gray pr-1.5 pl-3 text-[12px] outline-none select-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-primary-blue)]',
                    selected
                      ? 'bg-primary-dark-gray text-primary-white shadow-[inset_0_2px_0_var(--color-primary-blue)]'
                      : 'text-primary-light-gray hover:bg-primary-dark-gray/60 hover:text-primary-white',
                    dragging?.id === id && 'opacity-50',
                  )}
                >
                  {indicatorBefore === id && (
                    <span aria-hidden='true' className='absolute top-1 bottom-1 -left-px w-0.5 bg-primary-blue' />
                  )}
                  <span className={cn('min-w-0 truncate', missing && 'line-through opacity-70')}>{name}</span>
                  <button
                    type='button'
                    tabIndex={-1}
                    aria-label={`Close ${name}`}
                    title='Close (Alt+W)'
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onClose([id]);
                    }}
                    className='relative flex h-[18px] w-[18px] flex-none cursor-pointer items-center justify-center rounded text-[11px] hover:bg-secondary-dark-gray'
                  >
                    {/* A dirty dot until hovered, then the ×, like VS Code. */}
                    <span className={cn(dirty ? 'group-hover:hidden' : 'hidden')} aria-hidden='true'>
                      ●
                    </span>
                    <span
                      className={cn(
                        dirty ? 'hidden group-hover:inline' : selected ? 'inline' : 'invisible group-hover:visible',
                      )}
                      aria-hidden='true'
                    >
                      ✕
                    </span>
                  </button>
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content className='z-1100 min-w-[200px] rounded-md border border-secondary-dark-gray bg-primary-dark-gray p-1 shadow-xl'>
                  <ContextMenu.Item className={MENU_ITEM} onSelect={() => onClose([id])}>
                    Close <span className='text-primary-light-gray'>Alt+W</span>
                  </ContextMenu.Item>
                  <ContextMenu.Item className={MENU_ITEM} disabled={order.length < 2} onSelect={() => props.onCloseOthers(id)}>
                    Close Others
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={MENU_ITEM}
                    disabled={order.indexOf(id) === order.length - 1}
                    onSelect={() => props.onCloseRight(id)}
                  >
                    Close to the Right
                  </ContextMenu.Item>
                  <ContextMenu.Item className={MENU_ITEM} onSelect={props.onCloseSaved}>
                    Close Saved
                  </ContextMenu.Item>
                  <ContextMenu.Item className={MENU_ITEM} onSelect={props.onCloseAll}>
                    Close All
                  </ContextMenu.Item>
                  <ContextMenu.Separator className='my-1 h-px bg-secondary-dark-gray' />
                  <ContextMenu.Item className={MENU_ITEM} onSelect={props.onReopen}>
                    Reopen Closed Tab <span className='text-primary-light-gray'>Alt+Shift+T</span>
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
        {indicatorAtEnd && <span aria-hidden='true' className='my-1 w-0.5 flex-none bg-primary-blue' />}
      </div>
      {/* Every open file, for when the strip overflows. */}
      <div className='relative flex-none border-l border-secondary-dark-gray'>
        <button
          type='button'
          aria-label='All open files'
          aria-haspopup='listbox'
          aria-expanded={overflowOpen}
          title='All open files'
          onClick={() => setOverflowOpen((open) => !open)}
          className='h-full cursor-pointer px-2 text-[12px] text-primary-light-gray hover:bg-primary-dark-gray hover:text-primary-white'
        >
          ⌄
        </button>
        {overflowOpen && (
          <ul
            role='listbox'
            aria-label='Open files'
            className='absolute top-full right-0 z-1100 max-h-80 min-w-[220px] overflow-auto rounded-md border border-secondary-dark-gray bg-primary-dark-gray p-1 shadow-xl'
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOverflowOpen(false);
            }}
          >
            {order.map((id) => (
              <li key={id} role='option' aria-selected={id === active}>
                <button
                  type='button'
                  onClick={() => {
                    setOverflowOpen(false);
                    onActivate(id);
                  }}
                  className={cn(
                    'flex w-full cursor-pointer items-center justify-between gap-3 rounded px-2 py-1 text-left text-[12px] hover:bg-secondary-dark-gray',
                    id === active ? 'text-primary-white' : 'text-primary-light-gray',
                  )}
                >
                  <span className={cn('truncate', isMissing(id) && 'line-through')}>{label(id)}</span>
                  {isDirty(id) && <span aria-label='unsaved'>●</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export { TabStrip };

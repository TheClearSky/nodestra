import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button, cn, ContextMenu } from '@theclearsky/react-blender-nodes';
import { allDemoCategories } from '../soundDefinitions/demoCatalog';
import { buildDemoMenuItems, isDemoMenuLeaf } from '../soundDefinitions/demoMenu';

/**
 * The toolbar's "Demos" button: every demo in ONE nested menu, rendered by the
 * host library's `ContextMenu` (the same component the graph's right-click menu
 * uses), so the submenus, hover timing and crossfade match the editor exactly.
 *
 * Replaces the six category `<select>`s that used to sit in the toolbar.
 *
 * Dismissal is a full-screen backdrop rather than a document listener: the
 * host portals each open SUBMENU to `document.body`, so a plain
 * "is the click inside my wrapper?" test would treat every submenu click as an
 * outside click and close the menu before the item fired. The backdrop sits
 * below the menu surfaces and above everything else, so a click either lands on
 * a menu (and the item runs) or on the backdrop (and the menu closes).
 */
function DemosMenu({
  onPick,
  onOpenChange,
}: {
  onPick: (demoId: string) => void;
  /** Opened / closed — tutorials wait on it. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    onOpenChangeRef.current?.(isOpen);
  }, [isOpen]);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  const close = useCallback(() => {
    setIsOpen(false);
    // Drop focus with the menu: a focused toolbar button re-fires on
    // Space/Enter, which would reopen the menu mid-performance.
    buttonRef.current?.blur();
  }, []);

  const items = useMemo(
    () =>
      buildDemoMenuItems(allDemoCategories, (demoId) => {
        onPick(demoId);
        close();
      }),
    [onPick, close],
  );

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation(); // Escape is also the app's panic-silence key
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, close]);

  return (
    <span className='relative inline-flex'>
      {/* The host's Button, with the app's own gradient and sheen on top — the
          toolbar's one deliberately loud control. */}
      <Button
        ref={buttonRef}
        type='button'
        size='small'
        className={cn(
          'app-demos-button relative inline-flex items-center gap-2 overflow-hidden rounded-md px-5 py-[7px]',
          'border border-demos-border text-[15px] leading-4 font-semibold tracking-[0.02em] text-demos-text',
          'bg-linear-[135deg,var(--color-demos-from)_0%,var(--color-demos-via)_50%,var(--color-demos-to)_100%]',
          'shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),0_2px_10px_rgba(122,68,216,0.45)]',
          'transition-[box-shadow,filter,transform] duration-150',
          'hover:brightness-110 hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1),0_3px_16px_rgba(160,80,230,0.6)]',
          'active:translate-y-px',
          'aria-expanded:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_0_0_2px_rgba(180,108,255,0.45),0_3px_16px_rgba(160,80,230,0.6)]',
        )}
        data-tour='toolbar.demos'
        aria-haspopup='menu'
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        onClick={() => setIsOpen((open) => !open)}
        title='Load a demo patch — it becomes the project'
      >
        {/* Decorative glint; it holds still for anyone who asked for reduced
            motion. */}
        <span
          aria-hidden='true'
          className='pointer-events-none absolute inset-0 -translate-x-[120%] animate-demos-sheen bg-linear-[100deg,transparent_35%,rgba(255,255,255,0.38)_50%,transparent_65%] motion-reduce:animate-none motion-reduce:opacity-0'
        />
        <span className='relative'>Demos</span>
        <span className='relative text-[11px] leading-none opacity-85' aria-hidden='true'>
          ▾
        </span>
      </Button>
      {isOpen && (
        <>
          {/* Catches clicks that miss the menu. The host portals each open
              SUBMENU to the body at z-50, so this must stay below that and
              above the app. */}
          <div className='fixed inset-0 z-40' onClick={close} />
          <div
            id={menuId}
            role='menu'
            data-tour='demosMenu.list'
            className='absolute top-[calc(100%+6px)] left-0 z-50 max-h-[70vh] overflow-y-auto rounded-md shadow-[0_10px_30px_rgba(0,0,0,0.55)]'
          >
            <ContextMenu
              subItems={items}
              // A category row only opens its submenu; only a leaf is a choice.
              // The leaf's own `onClick` already loaded the demo and closed.
              onItemClick={(item) => {
                if (isDemoMenuLeaf(item)) close();
              }}
            />
          </div>
        </>
      )}
    </span>
  );
}

export { DemosMenu };

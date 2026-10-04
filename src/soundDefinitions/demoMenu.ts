import type { ContextMenuItem } from '@theclearsky/react-blender-nodes';

/**
 * The demo catalogue as the toolbar's "Demos" menu sees it: one submenu per
 * category, one leaf per demo. Kept as a PURE builder (no React) so the tree —
 * ids, nesting, ordering, the click wiring — is unit-testable in the node
 * environment the app's vitest runs in.
 *
 * Ids are namespaced (`demo-cat-…` / `demo-…`) because the host's `ContextMenu`
 * keys rows and tracks the hovered submenu BY ID: a category id colliding with
 * a demo id would make the wrong submenu open.
 */

type DemoOption = { readonly id: string; readonly label: string };
type DemoCategory = {
  readonly label: string;
  readonly options: readonly DemoOption[];
};

function buildDemoMenuItems(
  categories: readonly DemoCategory[],
  onPick: (demoId: string) => void,
): ContextMenuItem[] {
  return categories
    .filter((category) => category.options.length > 0)
    .map((category) => ({
      id: `demo-cat-${category.label}`,
      label: category.label,
      subItems: category.options.map((option) => ({
        id: `demo-${option.id}`,
        label: option.label,
        // The host calls `item.onClick` and then the menu's `onItemClick`; the
        // demo id is captured here so the menu itself stays data-free.
        onClick: () => onPick(option.id),
      })),
    }));
}

/** True for a leaf (a demo), false for a category row that only opens a submenu. */
function isDemoMenuLeaf(item: ContextMenuItem): boolean {
  return item.subItems === undefined || item.subItems.length === 0;
}

export { buildDemoMenuItems, isDemoMenuLeaf };
export type { DemoCategory, DemoOption };

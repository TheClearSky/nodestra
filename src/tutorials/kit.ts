import { byTourId, defineKit } from '@theclearsky/easy-tutorial-builder';
import { allDemoCategories } from '../soundDefinitions/demoCatalog';

/**
 * The app's tutorial vocabulary: everything a tutorial script may point at,
 * wait for, ask about or ask for. Scripts can ONLY name these.
 *
 * Targets are found fresh every frame. Most are `data-tour` attributes; the
 * Demos submenus belong to the host's ContextMenu (portaled, no ids — plan
 * ruling Q11-I1), so their rows are found by LABEL, which the catalogue
 * owns. When the host gains a generic item attribute, only these resolvers
 * change — no script does.
 */

/** Live app facts the predicates read. App.tsx wires them. */
const tutorialSignals = {
  demosMenuOpen: (): boolean => false,
  /** The editor shows a graph that has run since its last change. */
  graphHasRun: (): boolean => false,
};

const demoLabels = new Map(allDemoCategories.flatMap((category) => category.options.map((option) => [option.id, option.label])));

/** A row of the Demos menu (category or demo) by its label. */
function demosMenuRow(label: string): HTMLElement | null {
  for (const row of document.querySelectorAll<HTMLElement>('li > div')) {
    if (row.querySelector('span')?.textContent?.trim() === label) return row;
  }
  return null;
}

function shown(element: Element | null): boolean {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

const demoRow = (demoId: unknown) => demosMenuRow(demoLabels.get(String(demoId)) ?? '');

const tutorialKit = defineKit({
  targets: {
    'toolbar.demos': () => byTourId('toolbar.demos'),
    'toolbar.autoRun': () => byTourId('toolbar.autoRun'),
    'toolbar.octave': () => byTourId('toolbar.octave'),
    'demosMenu.list': () => byTourId('demosMenu.list'),
    'demosMenu.category': ({ label }) => demosMenuRow(String(label)),
    'demosMenu.item': ({ demoId }) => demoRow(demoId),
    /** The (portaled) submenu that holds a demo. */
    'demosMenu.submenu': ({ demoId }) => demoRow(demoId)?.closest('ul') ?? null,
    editor: () => byTourId('editor'),
    'welcome.keymap': () => byTourId('welcome.keymap'),
  },
  events: ['demosMenu.opened', 'demosMenu.closed', 'demo.picked', 'demo.loaded', 'note.played'],
  predicates: {
    'demosMenu.isOpen': () => tutorialSignals.demosMenuOpen(),
    'demosMenu.itemVisible': ({ demoId }) => shown(demoRow(demoId)),
    'graph.hasRun': () => tutorialSignals.graphHasRun(),
  },
  assists: {
    /** "Show me" on the Demos step: opens the menu (never picks a demo — that
     *  creates a library file, so the user makes that click). */
    'demosMenu.open': () => {
      if (!tutorialSignals.demosMenuOpen()) (byTourId('toolbar.demos') as HTMLElement | null)?.click();
    },
  },
  capabilities: ['demosMenu', 'tabs', 'welcome'],
});

export { tutorialKit, tutorialSignals };

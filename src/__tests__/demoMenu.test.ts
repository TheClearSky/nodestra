import { describe, expect, it, vi } from 'vitest';
import {
  buildDemoMenuItems,
  isDemoMenuLeaf,
  type DemoCategory,
} from '../soundDefinitions/demoMenu';
import { allDemoCategories } from '../soundDefinitions/demoCatalog';
import { instrumentDemoBuilders } from '../soundDefinitions/instrumentDemos';
import { buildProbeGraphState } from '../soundDefinitions/probeGraphs';
import { initialSoundState } from '../soundDefinitions/demoState';

const categories: DemoCategory[] = [
  { label: 'Solos', options: [{ id: 'guitarSolo', label: 'Guitar' }] },
  { label: 'Empty', options: [] },
  {
    label: 'Drones',
    options: [
      { id: 'droneAbyss', label: 'Abyss' },
      { id: 'droneVoid', label: 'Void' },
    ],
  },
];

describe('buildDemoMenuItems', () => {
  it('makes one submenu per non-empty category, in order, with its demos as leaves', () => {
    const items = buildDemoMenuItems(categories, () => {});
    expect(items.map((item) => item.label)).toEqual(['Solos', 'Drones']);
    expect(items[1].subItems?.map((leaf) => leaf.label)).toEqual([
      'Abyss',
      'Void',
    ]);
    expect(items.every((item) => !isDemoMenuLeaf(item))).toBe(true);
    expect(items[1].subItems?.every(isDemoMenuLeaf)).toBe(true);
  });

  it('namespaces ids so a category can never collide with a demo (the host keys submenus by id)', () => {
    const items = buildDemoMenuItems(categories, () => {});
    const ids = items.flatMap((item) => [
      item.id,
      ...(item.subItems ?? []).map((leaf) => leaf.id),
    ]);
    expect(ids).toEqual([
      'demo-cat-Solos',
      'demo-guitarSolo',
      'demo-cat-Drones',
      'demo-droneAbyss',
      'demo-droneVoid',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a leaf click reports its demo id; a category row has no onClick', () => {
    const onPick = vi.fn();
    const items = buildDemoMenuItems(categories, onPick);
    expect(items[0].onClick).toBeUndefined();
    items[1].subItems?.[1].onClick?.();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('droneVoid');
  });

  it('drops an empty category rather than rendering a dead submenu row', () => {
    expect(
      buildDemoMenuItems([{ label: 'Empty', options: [] }], () => {}),
    ).toEqual([]);
  });
});

describe('the real catalogue', () => {
  it('every demo in the menu resolves to a builder the app can load', () => {
    const items = buildDemoMenuItems(allDemoCategories, () => {});
    const demoIds = items.flatMap((item) =>
      (item.subItems ?? []).map((leaf) => leaf.id.replace(/^demo-/, '')),
    );
    expect(demoIds.length).toBeGreaterThan(30);
    for (const id of demoIds) {
      if (id === 'starter') {
        expect(initialSoundState.nodes.length).toBeGreaterThan(0);
        continue;
      }
      if (id in instrumentDemoBuilders) {
        expect(instrumentDemoBuilders[id]().nodes.length).toBeGreaterThan(0);
        continue;
      }
      expect(buildProbeGraphState(id).nodes.length).toBeGreaterThan(0);
    }
  });

  it('demo ids are unique across every category (one menu now shows them all together)', () => {
    const ids = allDemoCategories.flatMap((category) =>
      category.options.map((option) => option.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});

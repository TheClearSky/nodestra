/**
 * Every demo that plays one voice per key must wire EVERY key on the row —
 * the row is `KEY_ORDER`, and when it grew from 16 to 17 keys (`;` = E5) a
 * demo that had hard-coded its wiring would have gone silent on the new key
 * without anyone noticing.
 *
 * Drum kits are the exception by design: one piece per key, and a piece's
 * id ENCODES its key (`inst_lightKit_w`), so a kit wires exactly the keys it
 * has pieces for.
 */

import { describe, expect, it } from 'vitest';
import { KEY_ORDER, keyLabel } from '../audio/keyMap';
import { allDemoCategories } from '../soundDefinitions/demoCatalog';
import { initialSoundState } from '../soundDefinitions/demoState';
import { instrumentDemoBuilders } from '../soundDefinitions/instrumentDemos';
import { buildProbeGraphState } from '../soundDefinitions/probeGraphs';

type GraphNode = {
  id: string;
  data: { nodeTypeUniqueId?: string; outputs?: { id: string; name: string }[] };
};
type GraphEdge = { source: string; sourceHandle?: string | null };

function demoState(id: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const state =
    id === 'starter'
      ? initialSoundState
      : id in instrumentDemoBuilders
        ? instrumentDemoBuilders[id]()
        : buildProbeGraphState(id);
  return state as unknown as { nodes: GraphNode[]; edges: GraphEdge[] };
}

/** Output names of `node` that at least one edge leaves from. */
function wiredOutputs(node: GraphNode, edges: GraphEdge[]): Set<string> {
  const names = new Set<string>();
  for (const edge of edges) {
    if (edge.source !== node.id) continue;
    const output = node.data.outputs?.find((candidate) => candidate.id === edge.sourceHandle);
    if (output) names.add(output.name);
  }
  return names;
}

const perKeyDemos = allDemoCategories
  .flatMap((category) => category.options.map((option) => option.id))
  .filter((id) => !id.startsWith('demoKit_'))
  .map((id) => ({ id, state: demoState(id) }))
  .filter(({ state }) => state.nodes.some((node) => node.data.nodeTypeUniqueId === 'allKeys'));

describe('per-key demos cover the whole key row', () => {
  it('finds the per-key demos (the piano among them)', () => {
    expect(perKeyDemos.map(({ id }) => id)).toContain('piano');
  });

  for (const { id, state } of perKeyDemos) {
    it(`${id}: every key, ";" included, has its Gate wired`, () => {
      for (const node of state.nodes.filter((candidate) => candidate.data.nodeTypeUniqueId === 'allKeys')) {
        const wired = wiredOutputs(node, state.edges);
        const silent = KEY_ORDER.filter((key) => !wired.has(`${keyLabel(key)} Gate`));
        expect(silent).toEqual([]);
      }
    });
  }
});

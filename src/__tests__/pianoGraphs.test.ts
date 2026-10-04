/**
 * Structural guards for the piano demo.
 *
 * `buildState` already throws on an unknown input name or a missing handle,
 * so a demo that builds at all has its `values` keys and every edge endpoint
 * verified. These tests cover what it does NOT check, and what hand-authoring
 * a 93-node graph actually gets wrong:
 *
 *  - fan-in limits, which are per input and easy to exceed on a shared bus;
 *  - cycles, which the editor rejects outright (`enableCycleChecking`), so a
 *    graph containing one is dead on arrival rather than merely wrong;
 *  - orphans — a node wired to nothing downstream is silent, and silence is
 *    indistinguishable from "this layer is subtle" by ear. That is the whole
 *    reason this file exists: an inaudible layer and a misspelled edge sound
 *    exactly alike.
 */

import { describe, expect, it } from 'vitest';
import { probeGraphBuilders } from '../soundDefinitions/probeGraphs';

type AnyRecord = Record<string, unknown>;

const PIANO_DEMOS = ['piano'] as const;

function graphOf(name: string) {
  const builder = (probeGraphBuilders as unknown as AnyRecord)[name] as
    | (() => AnyRecord)
    | undefined;
  expect(builder, `${name} has a builder`).toBeTypeOf('function');
  const state = (builder as () => AnyRecord)();
  return {
    nodes: (state.nodes ?? []) as AnyRecord[],
    edges: (state.edges ?? []) as AnyRecord[],
  };
}

describe('piano demo graphs', () => {
  for (const name of PIANO_DEMOS) {
    describe(name, () => {
      it('builds without an unknown input or handle', () => {
        // buildState throws for either, so this is the assertion.
        const { nodes, edges } = graphOf(name);
        expect(nodes.length).toBeGreaterThan(0);
        expect(edges.length).toBeGreaterThan(0);
      });

      it('respects every input fan-in limit', () => {
        const { nodes, edges } = graphOf(name);
        const byId = new Map(nodes.map((node) => [node.id as string, node]));
        const counts = new Map<string, number>();
        const overflows: string[] = [];
        for (const edge of edges) {
          const target = byId.get(edge.target as string);
          const data = target?.data as AnyRecord | undefined;
          const inputs = (data?.inputs ?? []) as AnyRecord[];
          const handle = inputs.find((i) => i.id === edge.targetHandle);
          const key = `${edge.target as string}::${String(handle?.name)}`;
          const next = (counts.get(key) ?? 0) + 1;
          counts.set(key, next);
          const max =
            (handle?.maxConnections as number | undefined) ?? Infinity;
          if (next > max) overflows.push(`${key} has ${next}, max ${max}`);
        }
        expect(overflows).toEqual([]);
      });

      it('is acyclic', () => {
        const { nodes, edges } = graphOf(name);
        const next = new Map<string, string[]>();
        for (const edge of edges) {
          const from = edge.source as string;
          next.set(from, [...(next.get(from) ?? []), edge.target as string]);
        }
        const mark = new Map<string, number>();
        const hasCycle = (id: string): boolean => {
          if (mark.get(id) === 1) return true;
          if (mark.get(id) === 2) return false;
          mark.set(id, 1);
          for (const child of next.get(id) ?? []) {
            if (hasCycle(child)) return true;
          }
          mark.set(id, 2);
          return false;
        };
        const cyclic = nodes.some((node) => hasCycle(node.id as string));
        expect(cyclic).toBe(false);
      });

      it('wires every node through to the render', () => {
        const { nodes, edges } = graphOf(name);
        const reaches = new Set(
          nodes
            .filter(
              (node) =>
                (node.data as AnyRecord | undefined)?.nodeTypeUniqueId ===
                'render',
            )
            .map((node) => node.id as string),
        );
        expect(reaches.size, 'demo has a render node').toBeGreaterThan(0);
        let changed = true;
        while (changed) {
          changed = false;
          for (const edge of edges) {
            const from = edge.source as string;
            if (reaches.has(edge.target as string) && !reaches.has(from)) {
              reaches.add(from);
              changed = true;
            }
          }
        }
        const orphans = nodes
          .map((node) => node.id as string)
          .filter((id) => !reaches.has(id));
        expect(orphans).toEqual([]);
      });
    });
  }

});

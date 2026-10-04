/**
 * Every demo in the picker must actually BUILD.
 *
 * `buildState` throws on an unknown handle name or a dangling edge, so
 * calling each builder once catches every wiring typo — including in a
 * hand-written demo whose node ids are generated in a loop. Nothing covered
 * the probe graphs before; only the six SCORED demos were checked, by
 * demoTimelines.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { probeGraphBuilders } from '../soundDefinitions/probeGraphs';
import { soundNodeTypes } from '../soundDefinitions/nodeCatalog';
import { allowedConversionsBetweenDataTypes } from '../soundDefinitions/dataTypes';

describe('probe graphs', () => {
  it('every builder produces a graph whose node types all exist', () => {
    const ids = Object.keys(probeGraphBuilders);
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) {
      const state = probeGraphBuilders[id]();
      expect(state.nodes.length, id).toBeGreaterThan(0);
      for (const node of state.nodes) {
        const typeId = (node.data as { nodeTypeUniqueId?: string })
          .nodeTypeUniqueId;
        expect(
          Object.hasOwn(soundNodeTypes, typeId as string),
          `${id} uses unknown node type ${typeId}`,
        ).toBe(true);
      }
    }
  });

  it('no input anywhere is fed more edges than it accepts', () => {
    // THE BUG THIS EXISTS FOR. The deep heartbeat fed THREE audio edges into
    // `hb-out`, a Filter whose `In` is `maxConnections: 1`. `readAudioChain`
    // is `readInput(...).find(isAudioChain)` — it returns ONE chain and
    // silently discards the rest, so two of the three layers never reached the
    // output and the patch was a bare kick. Nothing failed: it built, it
    // played, it just was not the sound.
    //
    // This is a whole CLASS of silent defect, so it is gated generically
    // rather than per demo. An over-subscribed input is never intentional —
    // `mix` exists for fan-in, with a cap of 32.
    const failures: string[] = [];
    for (const id of Object.keys(probeGraphBuilders)) {
      const state = probeGraphBuilders[id]();
      const cap = new Map<string, { label: string; max: number }>();
      for (const node of state.nodes) {
        const data = node.data as {
          nodeTypeUniqueId?: string;
          inputs?: { id: string; name: string; maxConnections?: number }[];
        };
        for (const input of data.inputs ?? []) {
          if (input.maxConnections === undefined) continue;
          cap.set(input.id, {
            label: `${node.id}.${input.name} (${data.nodeTypeUniqueId})`,
            max: input.maxConnections,
          });
        }
      }
      const used = new Map<string, number>();
      for (const edge of state.edges) {
        const handle = (edge as { targetHandle?: string }).targetHandle;
        if (handle === undefined) continue;
        used.set(handle, (used.get(handle) ?? 0) + 1);
      }
      for (const [handle, count] of used) {
        const limit = cap.get(handle);
        if (limit !== undefined && count > limit.max) {
          failures.push(`${id}: ${limit.label} has ${count} edges, cap ${limit.max}`);
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('dreamyPad voices its chord in the register its table was measured at', () => {
    // THE BUG THIS EXISTS FOR. The pad's partial table is fitted at
    // B1 = 61.74 Hz, but the keyboard's home window is C4-D#5. The first
    // version wired the root straight to `pd-key.Hz`, so the chord played two
    // octaves high: 81.7 % of its energy landed ABOVE 500 Hz against a target
    // of 0.68 %, and NOTHING below 250 Hz where the target puts 74 %. It built,
    // it type-checked, every band number in the plan was verified on paper —
    // and it sounded like a shrill organ, because root+fifth+octave with no low
    // end is an organ drawbar stack. A voice's RANGE is part of what it is.
    const state = probeGraphBuilders.dreamyPad();
    const gainOf = (nodeId: string): number => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId);
      expect(node, `dreamyPad is missing ${nodeId}`).toBeDefined();
      const inputs = (node!.data as { inputs?: { name: string; value?: unknown }[] })
        .inputs;
      const gain = inputs?.find((input) => input.name === 'Gain')?.value;
      expect(typeof gain, `${nodeId}.Gain must be a number`).toBe('number');
      return gain as number;
    };

    // Holding F4 must land the root on the reference's ~87.5 Hz.
    const F4 = 349.228;
    const rootHz = F4 * gainOf('pd-rootG');
    expect(rootHz, `root at ${rootHz.toFixed(1)} Hz`).toBeGreaterThan(80);
    expect(rootHz, `root at ${rootHz.toFixed(1)} Hz`).toBeLessThan(95);

    // And the chord must be a MAJOR SEVENTH, not a bare fifth stack. The
    // second bug this test exists for: root+fifth+octave measured acceptably
    // against five coarse bands and sounded like a hollow organ, because a
    // power chord is what it was. The major third is the load-bearing tone.
    const detunes = state.nodes
      .filter((node) => node.id.startsWith('pd-v'))
      .map((node) => {
        const inputs = (
          node.data as { inputs?: { name: string; value?: unknown }[] }
        ).inputs;
        return inputs?.find((input) => input.name === 'Detune')?.value as number;
      })
      .sort((a, b) => a - b);
    expect(detunes).toEqual([0, 400, 700, 1100, 1200, 1600, 1900, 2300]);
    // 400 cents IS the major third. Its absence is what made the old one an
    // organ, so assert it by name rather than leaving it inside the array.
    expect(detunes).toContain(400);
  });

  it('every edge joins two handles of the same data type', () => {
    // Plan oracle O1. `buildState` matches handles BY NAME ONLY and never
    // consults `allowedConversionsBetweenDataTypes`, so a `signal -> number`
    // edge builds perfectly in a test and only misbehaves in the running app.
    // The check the oracle asked for is this one.
    const failures: string[] = [];
    for (const id of Object.keys(probeGraphBuilders)) {
      const state = probeGraphBuilders[id]();
      const type = new Map<string, string>();
      for (const node of state.nodes) {
        const data = node.data as {
          inputs?: { id: string; dataTypeUniqueId?: string }[];
          outputs?: { id: string; dataTypeUniqueId?: string }[];
        };
        for (const handle of [...(data.inputs ?? []), ...(data.outputs ?? [])]) {
          if (handle.dataTypeUniqueId !== undefined) {
            type.set(handle.id, handle.dataTypeUniqueId);
          }
        }
      }
      for (const edge of state.edges) {
        const e = edge as { sourceHandle?: string; targetHandle?: string };
        const from = e.sourceHandle && type.get(e.sourceHandle);
        const to = e.targetHandle && type.get(e.targetHandle);
        if (from === undefined || to === undefined || from === to) continue;
        const allowed = (
          allowedConversionsBetweenDataTypes as Record<
            string,
            readonly string[] | undefined
          >
        )[from];
        if (!allowed?.includes(to)) {
          failures.push(`${id}: ${from} -> ${to} is not a legal conversion`);
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('the retired guitar and violin demos are gone', () => {
    // Superseded by the physically modelled instruments (user, 2026-09-07).
    expect(probeGraphBuilders.guitar).toBeUndefined();
    expect(probeGraphBuilders.violin).toBeUndefined();
  });

  it('the Solina Ensemble is polyphonic off All Keys', () => {
    const state = probeGraphBuilders.solinaEnsemble();
    const typesOf = (wanted: string): number =>
      state.nodes.filter(
        (node) =>
          (node.data as { nodeTypeUniqueId?: string }).nodeTypeUniqueId ===
          wanted,
      ).length;
    // A string machine sounds every held key at once — that is the whole
    // point, and what the old mono `strings` patch could not do.
    expect(typesOf('allKeys')).toBe(1);
    expect(typesOf('oscillator')).toBe(34); // two saws per key, 17 keys
    expect(typesOf('adsr')).toBe(17);
    // ...and the ensemble that gives it its name.
    expect(typesOf('chorus')).toBe(2);
  });
});

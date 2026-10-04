/**
 * Every instrument demo must actually BUILD.
 *
 * `buildState` throws on an unknown handle name and `buildInstrumentType`
 * throws on a bad edge at module load, so calling each builder once catches
 * every emitter or wiring typo — including a physical-model instrument whose
 * boundary names drift from its inner nodes. Nothing covered this before.
 */

import { describe, expect, it } from 'vitest';
import {
  buildInstrumentProbeState,
  instrumentDemoBuilders,
  instrumentDemoCategory,
} from '../soundDefinitions/instrumentDemos';
import { soundNodeTypes } from '../soundDefinitions/nodeCatalog';

describe('instrument demos', () => {
  it('has at least one demo and every option has a builder', () => {
    expect(instrumentDemoCategory.options.length).toBeGreaterThan(0);
    for (const option of instrumentDemoCategory.options) {
      expect(instrumentDemoBuilders[option.id]).toBeTypeOf('function');
    }
  });

  it('every builder produces a state whose node types all exist', () => {
    for (const [demoId, build] of Object.entries(instrumentDemoBuilders)) {
      const state = build();
      expect(state.nodes.length, demoId).toBeGreaterThan(0);
      for (const node of state.nodes) {
        const typeId = (node.data as { nodeTypeUniqueId?: string })
          .nodeTypeUniqueId;
        expect(typeId, `${demoId} → ${node.id}`).toBeDefined();
        expect(
          Object.hasOwn(soundNodeTypes, typeId as string),
          `${demoId} uses unknown node type ${typeId}`,
        ).toBe(true);
      }
    }
  });

  it('ships the physical string instruments and their demos', () => {
    // The thermal violin won the friction-model ear test; the other two
    // variants were removed as instruments (the node still offers all three).
    for (const id of ['inst_guitarPM', 'inst_violinPM_thermal']) {
      expect(Object.hasOwn(soundNodeTypes, id), id).toBe(true);
      expect(instrumentDemoBuilders[`demoInst_${id}`], id).toBeTypeOf(
        'function',
      );
    }
  });

  it('the single-instrument probe harness builds for a physical model', () => {
    const state = buildInstrumentProbeState('inst_guitarPM', 220);
    expect(state.nodes.length).toBeGreaterThan(0);
  });

  it('violin demos render at 1 dB; guitar and the rest stay at 10', () => {
    // User ruling 2026-09-06. The physical violins run hot (a broad bridge
    // hill in the body), so they need their own level.
    const renderLevel = (demoId: string): number | undefined => {
      const state = instrumentDemoBuilders[demoId]();
      const render = state.nodes.find(
        (node) =>
          (node.data as { nodeTypeUniqueId?: string }).nodeTypeUniqueId ===
          'render',
      );
      const inputs = (render?.data as { inputs?: unknown[] } | undefined)
        ?.inputs as Array<{ name?: string; value?: unknown }> | undefined;
      const level = inputs?.find((input) => input.name === 'Level dB');
      return typeof level?.value === 'number' ? level.value : undefined;
    };
    expect(renderLevel('demoInst_inst_violinPM_thermal')).toBe(1);
    expect(renderLevel('demoInst_inst_guitarPM')).toBe(10);
  });
});

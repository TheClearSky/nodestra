/**
 * Describing a graph must not load the audio engine.
 *
 * Building a demo graph (`buildProbeGraphState`, the Demos menu, the Welcome
 * page's demos) needs only node TYPES and graph STATE. Measured 2026-10-09:
 * one Tone import in `effectTable.ts` (its effect factories) pulled all of
 * Tone (183 modules) through `nodeTypes.ts` → `nodeCatalog.ts` →
 * `probeGraphs.ts` into everything that described a graph, and each such
 * page created an AudioContext it never used.
 *
 * Only STATIC imports are caught: an `import('tone')` inside a function the
 * test does not call slips through.
 *
 * Here `tone` THROWS on import, so any graph-description module that grows a
 * Tone import again — directly or through any depth of re-exports — fails
 * this file. The audio half lives in `effectAudio.ts` / `implementations.ts`,
 * which only the audio build imports.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('tone', () => {
  throw new Error(
    'tone was imported by a graph-description module — keep Tone behind effectAudio.ts / implementations.ts',
  );
});

describe('graph descriptions are Tone-free', () => {
  it('the node catalog loads without Tone', async () => {
    const { soundNodeTypes } = await import('../soundDefinitions/nodeCatalog');
    expect(Object.hasOwn(soundNodeTypes, 'reverb')).toBe(true);
    expect(Object.hasOwn(soundNodeTypes, 'pitchShift')).toBe(true);
  });

  it('the starting demo state builds without Tone', async () => {
    const { initialSoundState } = await import(
      '../soundDefinitions/demoState'
    );
    expect(initialSoundState.nodes.length).toBeGreaterThan(0);
  });

  it('the demo catalogs and the Welcome demos load without Tone', async () => {
    const { allDemoCategories } = await import('../soundDefinitions/demoCatalog');
    const { instrumentDemoBuilders } = await import('../soundDefinitions/instrumentDemos');
    const { WELCOME_DEMOS } = await import('../components/welcomeDemos');
    expect(allDemoCategories.length).toBeGreaterThan(0);
    expect(Object.keys(instrumentDemoBuilders).length).toBeGreaterThan(0);
    expect(WELCOME_DEMOS.length).toBeGreaterThan(0);
  });

  it('showcase demo graphs build without Tone', async () => {
    const { buildProbeGraphState, probeGraphBuilders } = await import(
      '../soundDefinitions/probeGraphs'
    );
    // The effect-heavy and timeline-heavy demos the landing showcases use.
    for (const name of ['fxRhythm', 'fxKeys', 'curveOrchestra']) {
      expect(buildProbeGraphState(name).nodes.length, name).toBeGreaterThan(0);
    }
    // And every other probe, so a new one cannot reintroduce Tone unseen.
    for (const name of Object.keys(probeGraphBuilders)) {
      expect(probeGraphBuilders[name]().nodes.length, name).toBeGreaterThan(0);
    }
  });
});

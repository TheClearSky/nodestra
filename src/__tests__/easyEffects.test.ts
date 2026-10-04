/**
 * The Easy Effects node groups (plan `.claude/plans/easy-effect-groups.md`).
 * `buildInstrumentType` already throws at module load on a bad edge or an
 * unknown value name; these pin the layman-control contract on top.
 */

import { describe, expect, it } from 'vitest';
import { effectNodeTypes, effectSpecs } from '../soundDefinitions/effects';
import { soundNodeTypes } from '../soundDefinitions/nodeCatalog';

type TypeLike = {
  name: string;
  description?: string;
  locationInContextMenu?: string[];
  inputs: {
    name: string;
    dataType: string;
    allowInput?: boolean;
    defaultValue?: unknown;
    min?: number;
    max?: number;
    description?: string;
  }[];
};

describe('Easy Effects', () => {
  it('ships the first batch, registered in the catalog under Easy Effects', () => {
    expect(effectSpecs.map((spec) => spec.name)).toEqual([
      'Stutter',
      'Chopper',
      'Pump',
      'Echo',
      'Big Space',
      'Lo-Fi Radio',
      'Wobble',
      'Crunch',
    ]);
    for (const [id, type] of Object.entries(effectNodeTypes)) {
      expect(Object.hasOwn(soundNodeTypes, id), id).toBe(true);
      const typed = type as unknown as TypeLike;
      expect(typed.locationInContextMenu, id).toEqual(['Easy Effects']);
      expect(typed.description, id).toBeTruthy();
    }
  });

  it('every control is a documented knob with a default; percents are 0–100', () => {
    for (const [id, type] of Object.entries(effectNodeTypes)) {
      for (const input of (type as unknown as TypeLike).inputs) {
        expect(input.description, `${id} › ${input.name}`).toBeTruthy();
        if (input.dataType === 'audio') continue;
        expect(input.allowInput, `${id} › ${input.name}`).toBe(true);
        expect(input.defaultValue, `${id} › ${input.name}`).toBeDefined();
        if (input.dataType === 'signal') {
          expect([input.min, input.max], `${id} › ${input.name}`).toEqual([0, 100]);
        }
      }
    }
  });

  it('has 2–4 controls, and every control is wired inside', () => {
    for (const spec of effectSpecs) {
      const controls = spec.inputs.filter((input) => input.dataType !== 'audio');
      expect(controls.length, spec.id).toBeGreaterThanOrEqual(2);
      expect(controls.length, spec.id).toBeLessThanOrEqual(4);
      for (const input of spec.inputs) {
        expect(
          spec.edges.some((edge) => edge.from === '$in' && edge.output === input.name),
          `${spec.id} › ${input.name} is not connected inside`,
        ).toBe(true);
      }
      expect(
        spec.edges.some((edge) => edge.to === '$out'),
        `${spec.id} has no output`,
      ).toBe(true);
    }
  });
});

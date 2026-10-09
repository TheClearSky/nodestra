/**
 * The effect table is split in two: Tone-free METADATA (`effectTable.ts`,
 * what node types and graph descriptions need) and the AUDIO bindings
 * (`effectAudio.ts`, keyed by effect id and socket name). The type in
 * `effectAudio.ts` already makes drift a compile error; this pins the same
 * contract at runtime, so a cast or a `// @ts-expect-error` cannot slip a
 * silent `undefined` binding into the audio build.
 */

import { describe, expect, it } from 'vitest';
import { effectRows } from '../soundDefinitions/effectTable';
import { boundEffectRows, effectAudio } from '../soundDefinitions/effectAudio';

const sorted = (values: Iterable<string>) => [...values].sort();

describe('effect table split', () => {
  it('every metadata row has exactly one audio binding, and vice versa', () => {
    const metadataIds = effectRows.map((row) => row.id);
    expect(new Set(metadataIds).size, 'duplicate metadata id').toBe(
      metadataIds.length,
    );
    expect(sorted(Object.keys(effectAudio))).toEqual(sorted(metadataIds));
  });

  it('every socket has exactly one binding of the right kind, and vice versa', () => {
    for (const row of effectRows) {
      const audio = effectAudio[row.id] as {
        make: unknown;
        signalTargets: Record<string, { target: unknown }>;
        numberSetters: Record<string, unknown>;
      };
      const signalInputs = row.signalParams.map((param) => param.input);
      const numberInputs = row.numberParams.map((param) => param.input);
      const allInputs: string[] = [...signalInputs, ...numberInputs];
      expect(new Set(allInputs).size, `${row.id}: duplicate socket`).toBe(
        allInputs.length,
      );

      expect(typeof audio.make, row.id).toBe('function');
      expect(sorted(Object.keys(audio.signalTargets)), row.id).toEqual(
        sorted(signalInputs),
      );
      expect(sorted(Object.keys(audio.numberSetters)), row.id).toEqual(
        sorted(numberInputs),
      );
      for (const input of signalInputs) {
        expect(typeof audio.signalTargets[input].target, input).toBe(
          'function',
        );
      }
      for (const input of numberInputs) {
        expect(typeof audio.numberSetters[input], input).toBe('function');
      }
    }
  });

  it('the bound rows keep the metadata order and fallbacks', () => {
    // Order is behaviour: params are applied in this order, and Reverb
    // regenerates its IR on each assignment.
    expect(boundEffectRows.map((row) => row.id)).toEqual(
      effectRows.map((row) => row.id),
    );
    boundEffectRows.forEach((bound, index) => {
      const row = effectRows[index];
      expect(bound.name).toBe(row.name);
      expect(
        bound.signalParams.map(({ input, fallback }) => ({ input, fallback })),
      ).toEqual(
        row.signalParams.map(({ input, fallback }) => ({ input, fallback })),
      );
      expect(
        bound.numberParams.map(({ input, fallback }) => ({ input, fallback })),
      ).toEqual(
        row.numberParams.map(({ input, fallback }) => ({ input, fallback })),
      );
    });
  });
});

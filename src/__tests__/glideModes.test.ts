/**
 * Portamento (Glide) on the key nodes.
 *
 * The load-bearing property is that `off` — the default — is EXACTLY the
 * behaviour the app had before glide existed: a 10 ms anti-zipper ramp, which
 * is a click-free jump, not a slide. Every existing patch must sound
 * identical until someone opts in.
 */

import { describe, expect, it } from 'vitest';
import { glideModes, soundDataTypes } from '../soundDefinitions/dataTypes';
import { soundNodeTypes } from '../soundDefinitions/nodeTypes';

type InputSpec = { name: string; dataType: string; defaultValue?: unknown };

function inputsOf(typeId: 'allKeys' | 'keyboardPitch'): InputSpec[] {
  return (soundNodeTypes[typeId] as unknown as { inputs: InputSpec[] }).inputs;
}

describe('glide mode data type', () => {
  it('offers off plus three interpolation shapes, with off first', () => {
    expect(glideModes[0]).toBe('off');
    expect([...glideModes]).toEqual([
      'off',
      'linear',
      'exponential',
      'smooth',
    ]);
  });

  it('is a string dataType constrained to those values', () => {
    const dataType = soundDataTypes.glideMode as unknown as {
      underlyingType: string;
      allowedStrings: readonly string[];
      allowInput: boolean;
    };
    expect(dataType.underlyingType).toBe('string');
    expect(dataType.allowInput).toBe(true);
    expect([...dataType.allowedStrings]).toEqual([...glideModes]);
  });
});

describe('key nodes expose glide', () => {
  for (const typeId of ['allKeys', 'keyboardPitch'] as const) {
    it(`${typeId} has a Glide enum defaulting to OFF and a Glide ms knob`, () => {
      const inputs = inputsOf(typeId);
      const mode = inputs.find((input) => input.name === 'Glide');
      expect(mode, `${typeId} Glide`).toBeDefined();
      expect(mode?.dataType).toBe('glideMode');
      // OFF BY DEFAULT — every existing patch keeps its current sound.
      expect(mode?.defaultValue).toBe('off');

      const time = inputs.find((input) => input.name === 'Glide ms');
      expect(time, `${typeId} Glide ms`).toBeDefined();
      expect(time?.dataType).toBe('number');
      expect(typeof time?.defaultValue).toBe('number');
    });
  }

  it('leaves the key nodes otherwise output-compatible', () => {
    // All Keys still publishes its 17 [Gate, Hz] pairs, and Keyboard Pitch
    // still publishes exactly one Hz — adding inputs must not disturb the
    // handles every existing patch is wired to.
    const allKeys = soundNodeTypes.allKeys as unknown as {
      outputs: { name: string }[];
    };
    expect(allKeys.outputs).toHaveLength(34);
    const keyboardPitch = soundNodeTypes.keyboardPitch as unknown as {
      outputs: { name: string }[];
    };
    expect(keyboardPitch.outputs.map((output) => output.name)).toEqual(['Hz']);
  });
});

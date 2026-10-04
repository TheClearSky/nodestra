/**
 * "Nothing audible moved" — the cores still render what they rendered before
 * the idle/denormal change (`.claude/plans/idle-voice-cpu.md`).
 *
 * The fixtures in `fixtures/*.reference.json` were captured from the cores as
 * they stood before that work, by `samples/analysis/capture_core_reference.mjs`,
 * using the SHIPPED presets and the length-128 gate path the worklets actually
 * pass. Both of those matter: an earlier capture used hand-typed parameters
 * (`stiffness 0.5` against a shipped maximum of 3e-4) and a length-1 gate the
 * product never runs, which would have pinned "unchanged" to configurations no
 * user can play.
 *
 * The decay comparison deliberately stops at -120 dBFS. Below that the two
 * renders are EXPECTED to diverge — the change flushes state under 1e-18 to
 * zero — and comparing there would assert that the bug is still present.
 */

import { describe, expect, it } from 'vitest';
import fluteReference from './fixtures/fluteCore.reference.json';
import bowedReference from './fixtures/bowedStringCore.reference.json';
import pluckedReference from './fixtures/pluckedStringCore.reference.json';
import bodyReference from './fixtures/modalBodyCore.reference.json';
import {
  compareToReference,
  renderReferenceScenario,
} from './fixtures/compareToReference';
import type { Reference } from './fixtures/compareToReference';
import {
  createFluteState,
  processFluteBlock,
} from '../soundDefinitions/fluteCore';
import {
  createBowedStringState,
  processBowedStringBlock,
} from '../soundDefinitions/bowedStringCore';
import {
  createPluckedStringState,
  processPluckedStringBlock,
} from '../soundDefinitions/pluckedStringCore';
import {
  createModalBodyState,
  processModalBodyBlock,
} from '../soundDefinitions/modalBodyCore';
import {
  DEFAULT_BOW_FORCE,
  GUITAR_STRING,
  VIOLIN_BODY,
  VIOLIN_DIRECT_DB,
  violinImpedanceFor,
} from '../soundDefinitions/stringPresets';

const QUANTUM = 128;

/** The capture script's scenario, reproduced exactly. */
function hzAmp(reference: Reference) {
  return {
    hz: new Float32Array(QUANTUM).fill(reference.hz),
    amp: new Float32Array(QUANTUM).fill(reference.amp),
  };
}

describe('cores still render what they used to', () => {
  it('jetFlute', () => {
    const reference = fluteReference as Reference;
    const { hz, amp } = hzAmp(reference);
    const state = createFluteState(reference.sampleRate);
    const signal = renderReferenceScenario(reference, (gate, out) =>
      processFluteBlock(
        state,
        {
          pipe: 'open', jetRatio: 0.25, noise: 0.3, vibratoRateHz: 5.5,
          vibratoDepth: 0.1, jetReflection: 0.5, endReflection: 0.95,
          embouchure: 0.85, toneHoleHz: 2600, lossPoles: 2, octave: 2,
          attackSec: 0.09, releaseSec: 0.09,
        },
        hz, amp, gate, out, reference.sampleRate,
      ),
    );
    const diff = compareToReference(reference, signal);
    expect(diff.attackMaxDiff, 'attack').toBe(0);
    expect(diff.sustainMaxDiff, 'sustain').toBe(0);
    expect(diff.decayMaxDbDiff, 'decay envelope').toBeLessThan(0.01);
    expect(diff.comparedWindows, 'nothing was actually compared').toBeGreaterThan(10);
  });

  it('bowedString', () => {
    const reference = bowedReference as Reference;
    const { hz, amp } = hzAmp(reference);
    const state = createBowedStringState(reference.sampleRate);
    const signal = renderReferenceScenario(reference, (gate, out) =>
      processBowedStringBlock(
        state,
        {
          positionBeta: 0.127,
          force: DEFAULT_BOW_FORCE.thermal,
          impedance: violinImpedanceFor(reference.hz),
          frictionModel: 'thermal',
          attackSec: 0.06, releaseSec: 0.08,
          vibratoRateHz: 5.5, vibratoCents: 12, noise: 0.4,
        },
        hz, amp, gate, out, reference.sampleRate,
      ),
    );
    const diff = compareToReference(reference, signal);
    expect(diff.attackMaxDiff, 'attack').toBe(0);
    expect(diff.sustainMaxDiff, 'sustain').toBe(0);
    expect(diff.decayMaxDbDiff, 'decay envelope').toBeLessThan(0.01);
    expect(diff.comparedWindows).toBeGreaterThan(10);
  });

  it('pluckedString', () => {
    const reference = pluckedReference as Reference;
    const { hz, amp } = hzAmp(reference);
    const state = createPluckedStringState(reference.sampleRate);
    const signal = renderReferenceScenario(reference, (gate, out) =>
      processPluckedStringBlock(
        state,
        {
          positionBeta: GUITAR_STRING.positionBeta,
          brightness: GUITAR_STRING.brightness,
          decaySec: GUITAR_STRING.decaySec,
          stiffness: GUITAR_STRING.stiffness,
          polarization: GUITAR_STRING.polarization,
          octave: 0,
          pickStyle: 'finger',
          dampOnRelease: true,
        },
        hz, amp, gate, out, reference.sampleRate,
      ),
    );
    const diff = compareToReference(reference, signal);
    expect(diff.attackMaxDiff, 'attack').toBe(0);
    expect(diff.sustainMaxDiff, 'sustain').toBe(0);
    expect(diff.decayMaxDbDiff, 'decay envelope').toBeLessThan(0.01);
    expect(diff.comparedWindows).toBeGreaterThan(10);
  });

  it('modalBody', () => {
    // The body has no gate: the capture drove it with a decaying sine, so the
    // scenario is rebuilt here rather than reusing `renderReferenceScenario`.
    const reference = bodyReference as Reference;
    const { sampleRate, leadSec, gateSec, tailSec, hz } = reference;
    const state = createModalBodyState();
    const total = Math.round(sampleRate * (leadSec + gateSec + tailSec));
    const signal = new Float32Array(total);
    const input = new Float32Array(QUANTUM);
    const out = new Float32Array(QUANTUM);
    const leadSamples = Math.round(sampleRate * leadSec);
    const gateSamples = leadSamples + Math.round(sampleRate * gateSec);
    let written = 0;
    while (written < total) {
      for (let j = 0; j < QUANTUM; j += 1) {
        const n = written + j;
        input[j] =
          n >= leadSamples && n < gateSamples
            ? 0.4 *
              Math.exp(-(n - leadSamples) / (sampleRate * 0.25)) *
              Math.sin((2 * Math.PI * hz * (n - leadSamples)) / sampleRate)
            : 0;
      }
      processModalBodyBlock(
        state,
        { modes: VIOLIN_BODY, scale: 1, airHz: 0, mix: 1, directDb: VIOLIN_DIRECT_DB },
        input, out, sampleRate,
      );
      const take = Math.min(QUANTUM, total - written);
      signal.set(out.subarray(0, take), written);
      written += take;
    }
    const diff = compareToReference(reference, signal);
    expect(diff.attackMaxDiff, 'attack').toBe(0);
    expect(diff.sustainMaxDiff, 'sustain').toBe(0);
    expect(diff.decayMaxDbDiff, 'decay envelope').toBeLessThan(0.01);
    expect(diff.comparedWindows).toBeGreaterThan(10);
  });
});

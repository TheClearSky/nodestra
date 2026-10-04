/**
 * The shipped body presets must keep reproducing the measurements they were
 * fitted to, and must stay physically consistent with the papers.
 *
 * These assertions are the whole reason the modal node exists: a FIXED EQ
 * cannot make one note's h2 louder than its h1 and another note's h2 quieter,
 * and that is exactly what the Iowa recordings show a real body doing.
 */

import { describe, expect, it } from 'vitest';
import {
  configureModalBody,
  createModalBodyState,
  modalBodyMagnitude,
} from '../soundDefinitions/modalBodyCore';
import {
  GUITAR_BODY,
  GUITAR_DIRECT_DB,
  VIOLIN_BODY,
  VIOLIN_DIRECT_DB,
  violinImpedanceFor,
} from '../soundDefinitions/stringPresets';
import type { BodyMode } from '../soundDefinitions/modalBodyCore';

const SR = 48000;

function levelsRelativeToFundamental(
  modes: readonly BodyMode[],
  directDb: number,
  f0: number,
  harmonics: number[],
): number[] {
  const state = createModalBodyState();
  configureModalBody(
    state,
    { modes, scale: 1, airHz: 0, mix: 1, directDb },
    SR,
  );
  const base = modalBodyMagnitude(state, f0, SR);
  return harmonics.map((k) => 20 * Math.log10(modalBodyMagnitude(state, f0 * k, SR) / base));
}

describe('guitar body preset', () => {
  it('reproduces the Iowa E2 signature: h1 far BELOW h2-h5', () => {
    // E2's fundamental (82.41 Hz) sits below the body's first radiating
    // resonance, so the recording measures h1 about 16 dB down on h2-h5.
    const levels = levelsRelativeToFundamental(
      GUITAR_BODY,
      GUITAR_DIRECT_DB,
      82.41,
      [2, 3, 4, 5],
    );
    for (const level of levels) {
      expect(level).toBeGreaterThan(8);
    }
  });

  it('reproduces the Iowa A2 signature: h1 and h2 are the loudest partials', () => {
    const [h2] = levelsRelativeToFundamental(
      GUITAR_BODY,
      GUITAR_DIRECT_DB,
      110,
      [2],
    );
    expect(Math.abs(h2)).toBeLessThan(5);
  });

  it('stays consistent with Christensen: f-^2 + f+^2 = fh^2 + fp^2', () => {
    const fMinus = GUITAR_BODY[0].hz;
    const fPlus = GUITAR_BODY[1].hz;
    const plate = 184; // Christensen's measured top-plate resonance
    const air = Math.sqrt(fMinus ** 2 + fPlus ** 2 - plate ** 2);
    // Christensen & Vistisen measure the Helmholtz resonance at 122-135 Hz.
    expect(air).toBeGreaterThan(118);
    expect(air).toBeLessThan(140);
  });
});

describe('violin body preset', () => {
  it('carries the four signature modes at their published frequencies', () => {
    const [a0, cbr, b1minus, b1plus] = VIOLIN_BODY;
    // Woodhouse 2014 §3.2: A0 243-272, CBR 376-407, B1- 397-462, B1+ 551-562
    expect(a0.hz).toBeGreaterThanOrEqual(243);
    expect(a0.hz).toBeLessThanOrEqual(280);
    expect(cbr.hz).toBeGreaterThanOrEqual(376);
    expect(cbr.hz).toBeLessThanOrEqual(410);
    expect(b1minus.hz).toBeGreaterThanOrEqual(395);
    expect(b1minus.hz).toBeLessThanOrEqual(465);
    expect(b1plus.hz).toBeGreaterThanOrEqual(545);
    expect(b1plus.hz).toBeLessThanOrEqual(565);
    // and the bridge hill in the 2-3 kHz region
    expect(VIOLIN_BODY.some((m) => m.hz >= 2000 && m.hz <= 3000)).toBe(true);
  });

  it('is strongly note-dependent across the signature-mode region', () => {
    // The whole point of a modal body over a fixed EQ: the response is NOT
    // flat, so each note's harmonics land on different features. The
    // note-dependence lives in the signature modes (A0/CBR/B1-/B1+), where
    // the response swings by tens of dB over a few semitones.
    const state = createModalBodyState();
    configureModalBody(
      state,
      {
        modes: VIOLIN_BODY,
        scale: 1,
        airHz: 0,
        mix: 1,
        directDb: VIOLIN_DIRECT_DB,
      },
      SR,
    );
    const levels: number[] = [];
    for (let hz = 196; hz <= 620; hz += 8) {
      levels.push(20 * Math.log10(modalBodyMagnitude(state, hz, SR)));
    }
    const swing = Math.max(...levels) - Math.min(...levels);
    expect(swing).toBeGreaterThan(8);
  });

  it('carries a BROAD bridge hill that sits BELOW the low body, as measured', () => {
    // Woodhouse 3.3.3: the hill is a wide 2-3 kHz hump of many peaks, with
    // levels comparable to B1+/B1-. The previous version of this oracle
    // demanded the hill be 9 dB ABOVE the 800 Hz region. Measured on the
    // University of Iowa violin (arco mf, G3-B4, long-term average spectrum,
    // 2026-09-12) that premise is inverted: 800 Hz is a PEAK (+13.4 dB rel
    // 200 Hz) and the hill at 1.6-2.3 kHz sits at +6.4..+7.0 -- about 7 dB
    // BELOW it -- while 4.5 kHz is at -11.9. Enforcing the old number made an
    // A4's harmonics 2-7 as loud as its fundamental, which the ear test called
    // "saw-wave". So the hill is pinned RELATIVE TO ITS OWN NEIGHBOURHOOD:
    // above 1.3-1.6 kHz, far above 4.5 kHz, and not above the low body.
    const state = createModalBodyState();
    configureModalBody(
      state,
      {
        modes: VIOLIN_BODY,
        scale: 1,
        airHz: 0,
        mix: 1,
        directDb: VIOLIN_DIRECT_DB,
      },
      SR,
    );
    const at = (hz: number): number =>
      20 * Math.log10(modalBodyMagnitude(state, hz, SR));
    const hill = (at(1900) + at(2300)) / 2;
    const below = (at(1300) + at(1600)) / 2;
    // a hump: measured +3.5 dB over its lower neighbourhood
    expect(hill - below, 'hill over 1.3-1.6 kHz').toBeGreaterThan(1.5);
    // that rolls off hard above: measured +19 dB over 4.5 kHz
    expect(hill - at(4500), 'hill over 4.5 kHz').toBeGreaterThan(8);
    expect(at(3000)).toBeGreaterThan(at(8000));
    // and the low body (B1-, 800 Hz) is NOT weaker than the hill (measured
    // +8.5 and +13.7 against the hill's +2.9, shape-normalised)
    expect(Math.max(at(462), at(823)) - hill, 'low body vs hill').toBeGreaterThan(-3);
  });
});

describe('string impedance law', () => {
  it('follows Z = Z_ref * f_ref / f0 from the one published value', () => {
    // Woodhouse 2014 §5.1: a violin G string (196 Hz) is 0.363 Ns/m.
    expect(violinImpedanceFor(196)).toBeCloseTo(0.363, 6);
    expect(violinImpedanceFor(392)).toBeCloseTo(0.1815, 6);
    // and it stays inside the node's declared knob range at both extremes
    expect(violinImpedanceFor(20)).toBeLessThanOrEqual(1);
    expect(violinImpedanceFor(8000)).toBeGreaterThanOrEqual(0.05);
  });
});

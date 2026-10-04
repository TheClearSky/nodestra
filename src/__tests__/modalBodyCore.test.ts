/**
 * modalBodyCore oracles.
 *
 * The load-bearing claim is the NORMALISATION: each mode must reach exactly
 * its authored `db` at its own centre frequency. Without it the `db` column is
 * decorative — a bare 2-pole's peak gain is ≈1/(1−r), which spans 64 dB across
 * a single guitar preset.
 */

import { describe, expect, it } from 'vitest';
import {
  configureModalBody,
  createModalBodyState,
  modalBodyMagnitude,
  modeT60,
  processModalBodyBlock,
  resonatorMagnitude,
  T60_PER_Q,
  twoPoleMagnitude,
} from '../soundDefinitions/modalBodyCore';
import type { BodyMode, ModalBodyParams } from '../soundDefinitions/modalBodyCore';

const SR = 48000;

const GUITAR: BodyMode[] = [
  { hz: 100, q: 16.5, db: 0 },
  { hz: 200, q: 24, db: -2 },
  { hz: 260, q: 20, db: -8 },
  { hz: 400, q: 18, db: -10 },
  { hz: 600, q: 12, db: -14 },
  { hz: 900, q: 10, db: -18 },
  { hz: 1400, q: 8, db: -22 },
  { hz: 2500, q: 6, db: -26 },
];

function params(overrides: Partial<ModalBodyParams> = {}): ModalBodyParams {
  return {
    modes: GUITAR,
    scale: 1,
    airHz: 0,
    mix: 1,
    directDb: -Infinity,
    ...overrides,
  };
}

describe('modalBodyCore — closed-form oracles', () => {
  it('T60_PER_Q is ln(1000)/pi and modeT60 uses it', () => {
    expect(T60_PER_Q).toBeCloseTo(2.198807, 5);
    // Woodhouse's violin A0: 272 Hz at Q 30 rings about a quarter second.
    expect(modeT60(272, 30)).toBeCloseTo(0.2425, 4);
    expect(modeT60(100, 16.5)).toBeCloseTo((2.198807 * 16.5) / 100, 5);
  });

  it('a bare 2-pole has a huge, Q- and f-dependent peak gain', () => {
    // This is WHY per-mode normalisation is required.
    const gains: number[] = [];
    for (const mode of [GUITAR[0], GUITAR[7]]) {
      const omega = (2 * Math.PI * mode.hz) / SR;
      const r = Math.exp(-omega / (2 * mode.q));
      gains.push(twoPoleMagnitude(-2 * r * Math.cos(omega), r * r, omega));
    }
    // ~+99 dB at 100 Hz/Q16.5 vs ~+35 dB at 2500 Hz/Q6 — a 64 dB spread.
    const spreadDb = 20 * Math.log10(gains[0] / gains[1]);
    expect(spreadDb).toBeGreaterThan(55);
    expect(gains[0]).toBeGreaterThan(1000);
  });

  it('the (1 - z^-2) resonator is zero at DC and Nyquist, peaked at its mode', () => {
    const mode = GUITAR[0];
    const omega = (2 * Math.PI * mode.hz) / SR;
    const r = Math.exp(-omega / (2 * mode.q));
    const a1 = -2 * r * Math.cos(omega);
    const a2 = r * r;
    expect(resonatorMagnitude(a1, a2, 0)).toBeCloseTo(0, 12);
    expect(resonatorMagnitude(a1, a2, Math.PI)).toBeCloseTo(0, 12);
    expect(resonatorMagnitude(a1, a2, omega)).toBeGreaterThan(100);
  });

  it('the bank is silent at DC and at Nyquist (Woodhouse eq. 3 has an iw numerator)', () => {
    const state = createModalBodyState();
    configureModalBody(state, params(), SR);
    // An all-pole bank would have |H(DC)| in the thousands here.
    expect(modalBodyMagnitude(state, 0, SR)).toBeLessThan(1e-9);
    expect(modalBodyMagnitude(state, SR / 2, SR)).toBeLessThan(1e-9);
  });

  it('rejects DC in the time domain, direct-field path included', () => {
    const block = new Float32Array(128);
    const constant = new Float32Array([1]);
    // A plucked excitation carries DC; an all-pole bank would turn it into a
    // huge subsonic thump plus a standing offset. The DIRECT field must take
    // the same zeros — with it bypassing them a unit DC input left a 0.28
    // offset (found in the browser, not by this suite's earlier version,
    // which only tested directDb = -Infinity).
    for (const directDb of [-Infinity, -11, 0]) {
      const state = createModalBodyState();
      for (let i = 0; i < 400; i += 1) {
        processModalBodyBlock(state, params({ directDb }), constant, block, SR);
      }
      let peak = 0;
      for (const sample of block) peak = Math.max(peak, Math.abs(sample));
      expect(peak, `directDb ${directDb}`).toBeLessThan(0.02);
    }
  });

  it('each mode reaches exactly its authored dB at its own centre frequency', () => {
    const state = createModalBodyState();
    // One mode at a time, so neighbours cannot contribute.
    for (const mode of GUITAR) {
      configureModalBody(state, params({ modes: [mode] }), SR);
      const magnitude = modalBodyMagnitude(state, mode.hz, SR);
      expect(20 * Math.log10(magnitude)).toBeCloseTo(mode.db, 1);
    }
  });

  it('Scale multiplies every modal frequency', () => {
    const state = createModalBodyState();
    configureModalBody(state, params({ modes: [GUITAR[0]], scale: 2 }), SR);
    const atScaled = modalBodyMagnitude(state, 200, SR);
    const atOriginal = modalBodyMagnitude(state, 100, SR);
    expect(atScaled).toBeGreaterThan(atOriginal * 10);
  });

  it('Air Hz moves ONLY the first mode', () => {
    const state = createModalBodyState();
    configureModalBody(
      state,
      params({ modes: [GUITAR[0], GUITAR[1]], airHz: 130 }),
      SR,
    );
    expect(modalBodyMagnitude(state, 130, SR)).toBeGreaterThan(
      modalBodyMagnitude(state, 100, SR),
    );
    // the second mode has not moved
    expect(modalBodyMagnitude(state, 200, SR)).toBeGreaterThan(
      modalBodyMagnitude(state, 230, SR),
    );
  });

  it('drops modes at or above Nyquist instead of aliasing them', () => {
    const state = createModalBodyState();
    configureModalBody(
      state,
      params({ modes: [{ hz: 100, q: 10, db: 0 }, { hz: 30000, q: 5, db: 0 }] }),
      SR,
    );
    expect(state.count).toBe(1);
  });
});

describe('modalBodyCore — rendered behaviour', () => {
  it('rings for the T60 its Q implies', () => {
    const state = createModalBodyState();
    const single: BodyMode = { hz: 200, q: 24, db: 0 };
    const config = params({ modes: [single] });
    const block = new Float32Array(128);
    // one-sample impulse
    const impulse = new Float32Array(128);
    impulse[0] = 1;
    processModalBodyBlock(state, config, impulse, block, SR);
    let peak = 0;
    for (const sample of block) peak = Math.max(peak, Math.abs(sample));

    const expected = modeT60(single.hz, single.q);
    const silence = new Float32Array(128);
    let elapsed = 0;
    let level = peak;
    while (elapsed < expected * 2) {
      processModalBodyBlock(state, config, silence, block, SR);
      elapsed += block.length / SR;
      level = 0;
      for (const sample of block) level = Math.max(level, Math.abs(sample));
      if (level < peak / 1000) break;
    }
    // 60 dB down within +/-25% of the predicted time
    expect(elapsed).toBeGreaterThan(expected * 0.75);
    expect(elapsed).toBeLessThan(expected * 1.25);
  });

  it('Mix = 0 passes the dry signal through untouched', () => {
    const state = createModalBodyState();
    const block = new Float32Array(64);
    const input = new Float32Array(64);
    for (let i = 0; i < input.length; i += 1) input[i] = Math.sin(i * 0.3);
    processModalBodyBlock(state, params({ mix: 0 }), input, block, SR);
    for (let i = 0; i < input.length; i += 1) {
      expect(block[i]).toBeCloseTo(input[i], 6);
    }
  });

  it('the direct-field path fills the valleys between modes', () => {
    const withoutDirect = createModalBodyState();
    const withDirect = createModalBodyState();
    configureModalBody(withoutDirect, params({ directDb: -Infinity }), SR);
    configureModalBody(withDirect, params({ directDb: -12 }), SR);
    // 1500 Hz sits between the 1400 and 2500 Hz modes.
    const valleyBare = modalBodyMagnitude(withoutDirect, 1800, SR);
    const valleyFilled = modalBodyMagnitude(withDirect, 1800, SR);
    expect(valleyFilled).toBeGreaterThan(valleyBare);
  });

  it('the watchdog resets the bank instead of ringing NaN forever', () => {
    const state = createModalBodyState();
    const block = new Float32Array(128);
    const impulse = new Float32Array(128);
    impulse[0] = 1;
    processModalBodyBlock(state, params(), impulse, block, SR);
    state.y1[0] = Number.NaN;
    const ok = processModalBodyBlock(state, params(), impulse, block, SR);
    expect(ok).toBe(false);
    for (let i = 0; i < 5; i += 1) {
      processModalBodyBlock(state, params(), impulse, block, SR);
      for (const sample of block) expect(Number.isFinite(sample)).toBe(true);
    }
  });

  it('is stable: an impulse decays rather than growing', () => {
    const state = createModalBodyState();
    const block = new Float32Array(128);
    const impulse = new Float32Array(128);
    impulse[0] = 1;
    processModalBodyBlock(state, params(), impulse, block, SR);
    let first = 0;
    for (const sample of block) first = Math.max(first, Math.abs(sample));
    const silence = new Float32Array(128);
    let last = first;
    for (let i = 0; i < 400; i += 1) {
      processModalBodyBlock(state, params(), silence, block, SR);
      last = 0;
      for (const sample of block) last = Math.max(last, Math.abs(sample));
    }
    expect(last).toBeLessThan(first);
    expect(Number.isFinite(last)).toBe(true);
  });
});

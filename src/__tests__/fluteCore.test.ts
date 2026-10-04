/**
 * fluteCore oracles.
 *
 * A jet-driven pipe either oscillates or it does not — there is a blowing
 * threshold and a ceiling — so the decisive tests are "does it speak", "at
 * the pitch asked for", and "with a flute's spectrum" (near-pure, unlike the
 * odd-harmonic spectrum of a closed pipe).
 */

import { describe, expect, it } from 'vitest';
import {
  createFluteState,
  jetTable,
  onePolePhaseDelay,
  processFluteBlock,
} from '../soundDefinitions/fluteCore';
import type { FluteParams } from '../soundDefinitions/fluteCore';

const SR = 48000;

/** The shipped flute: an OPEN pipe. */
const BASE: FluteParams = {
  pipe: 'open',
  jetRatio: 0.25,
  noise: 0.15,
  vibratoRateHz: 5.925,
  vibratoDepth: 0.05,
  jetReflection: 0.5,
  endReflection: 0.95,
  embouchure: 1,
  toneHoleHz: 2600,
  lossPoles: 2,
  // 0, not the shipped +2: every measured number in these oracles is
  // quoted at concert pitch, and a transpose would silently move them all.
  octave: 0,
  attackSec: 0.04,
  releaseSec: 0.05,
};

/** The stopped pipe kept on the Pipe enum — a clarinet/panpipe, not a flute. */
const CLOSED: FluteParams = {
  ...BASE,
  pipe: 'closed',
  jetRatio: 0.32,
  endReflection: 0.5,
};

function blow(
  hz: number,
  amp: number,
  seconds = 1.0,
  overrides: Partial<FluteParams> = {},
): Float32Array {
  const state = createFluteState(SR);
  const params = { ...BASE, ...overrides };
  const total = Math.round(SR * seconds);
  const out = new Float32Array(total);
  const block = new Float32Array(128);
  const hzArray = new Float32Array([hz]);
  const ampArray = new Float32Array([amp]);
  const gate = new Float32Array([1]);
  let written = 0;
  while (written < total) {
    processFluteBlock(state, params, hzArray, ampArray, gate, block, SR);
    const take = Math.min(block.length, total - written);
    out.set(block.subarray(0, take), written);
    written += take;
  }
  return out;
}

function magnitude(
  signal: Float32Array,
  frequency: number,
  start: number,
  length: number,
): number {
  let real = 0;
  let imaginary = 0;
  const omega = (2 * Math.PI * frequency) / SR;
  for (let n = 0; n < length; n += 1) {
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * n) / length));
    const sample = signal[start + n] * window;
    real += sample * Math.cos(omega * n);
    imaginary -= sample * Math.sin(omega * n);
  }
  return Math.hypot(real, imaginary);
}

/**
 * Strongest partial near `target`, coarse-to-fine.
 *
 * Identical result to a flat 1-cent sweep over +-250 cents, at a quarter of
 * the cost: each `magnitude` call is an O(16384) DFT bin, and a flat sweep is
 * 501 of them per pitch. The assertion is unchanged — only the search is.
 */
function measurePitch(signal: Float32Array, target: number): number {
  const start = Math.round(SR * 0.6);
  const scan = (from: number, to: number, step: number, around: number) => {
    let best = -1;
    let bestFrequency = around;
    for (let cents = from; cents <= to; cents += step) {
      const frequency = around * 2 ** (cents / 1200);
      const value = magnitude(signal, frequency, start, 16384);
      if (value > best) {
        best = value;
        bestFrequency = frequency;
      }
    }
    return bestFrequency;
  };
  return scan(-6, 6, 0.25, scan(-250, 250, 6, target));
}

function rms(signal: Float32Array): number {
  const from = Math.round(SR * 0.6);
  let sum = 0;
  for (let i = from; i < signal.length; i += 1) sum += signal[i] * signal[i];
  return Math.sqrt(sum / (signal.length - from));
}

describe('fluteCore — the jet', () => {
  it('the jet nonlinearity is an odd saturating cubic, clipped', () => {
    expect(jetTable(0)).toBeCloseTo(0, 12);
    // odd symmetry
    for (const x of [0.2, 0.5, 0.9, 1.4]) {
      expect(jetTable(-x)).toBeCloseTo(-jetTable(x), 12);
    }
    // x(x^2 - 1) before clipping
    expect(jetTable(0.5)).toBeCloseTo(0.5 * (0.25 - 1), 12);
    // clipped to +/-1 outside
    expect(jetTable(5)).toBe(1);
    expect(jetTable(-5)).toBe(-1);
  });

  it('the reflection filter phase delay is 0 when the pole is 0', () => {
    expect(onePolePhaseDelay(0, (2 * Math.PI * 1000) / SR)).toBeCloseTo(0, 9);
  });
});

describe('fluteCore — it speaks', () => {
  it('plays in tune across its range, with NO empirical correction', () => {
    // The open pipe's delay budget is closed-form:
    //     D = T - theta/omega - phaseDelay(H)
    // where theta is the jet bracket's phase at the share the loop settles
    // at. Nothing is fitted, and it lands inside a couple of cents — where
    // the closed model needed an `A + B/f + C/f^2` correction fitted at seven
    // pitches to reach the same place.
    for (const hz of [196, 262, 349, 440, 523, 698, 880, 1047, 1397]) {
      const measured = measurePitch(blow(hz, 0.7), hz);
      const cents = 1200 * Math.log2(measured / hz);
      expect(Math.abs(cents), `${hz} Hz`).toBeLessThan(8);
    }
  });

  it('the tuning does not move with Amp', () => {
    // The bracket phase has to be evaluated at the share the loop SETTLES at
    // (1/|H| - endRefl), not the small-signal one, or the volume knob bends
    // the pitch: measured -0.7 cents at Amp 0 drifting to -11.9 at Amp 1.
    const cents = [0.2, 0.5, 0.8, 1].map((amp) =>
      1200 * Math.log2(measurePitch(blow(523, amp), 523) / 523),
    );
    const spread = Math.max(...cents) - Math.min(...cents);
    expect(spread, `cents across Amp: ${cents.map((c) => c.toFixed(1))}`)
      .toBeLessThan(6);
  });

  it('holds its register across the keyboard — no octave jumps', () => {
    // The sporadic ones are the dangerous ones: at jetRatio 1/5 the octave's
    // loop gain came within 3% of the fundamental's, so which mode won
    // depended on the attack transient and only scattered notes jumped.
    // Hence a dense sweep rather than spot pitches.
    for (let semitone = -8; semitone <= 20; semitone += 2) {
      const hz = 349.23 * 2 ** (semitone / 12);
      for (const amp of [0.25, 0.7, 1]) {
        const signal = blow(hz, amp, 0.8);
        const start = Math.round(SR * 0.5);
        const nominal = magnitude(signal, hz, start, 8192);
        for (const k of [0.5, 2 / 3, 1.5, 2, 3]) {
          expect(
            magnitude(signal, hz * k, start, 8192),
            `${hz.toFixed(0)} Hz amp ${amp}: partial x${k} beats the nominal`,
          ).toBeLessThan(nominal);
        }
      }
    }
  });

  it('speaks at EVERY Amp setting — no dead zone in the breath window', () => {
    // A jet pipe has a threshold AND a ceiling; Amp is mapped onto the window
    // so the instrument is playable across its whole range.
    for (const amp of [0, 0.25, 0.5, 0.75, 1]) {
      expect(rms(blow(523, amp)), `amp ${amp}`).toBeGreaterThan(0.02);
    }
  });

  it('is louder blown harder', () => {
    expect(rms(blow(523, 1))).toBeGreaterThan(rms(blow(523, 0.2)) * 1.5);
  });

  it('is an OPEN pipe: the even harmonics are there', () => {
    // THE oracle for this rebuild. An air column's harmonic series is decided
    // by the number of sign inversions per round trip and by nothing else:
    // two (both ends open) puts a mode under every harmonic, one (stopped)
    // puts them only under the odd ones. Measured at C5, h2 relative to h1:
    //     closed  -40.4 dB      open  -8.6 dB      real flute (Iowa, mf) -4.2
    // so this asserts the property, not the fitted number.
    const relative = (params: FluteParams) => {
      const signal = blow(523, 0.7, 1.0, params);
      const start = Math.round(SR * 0.6);
      const h = [1, 2, 3, 4, 5, 6].map((k) =>
        magnitude(signal, 523 * k, start, 16384),
      );
      return h.map((value) => 20 * Math.log10(value / h[0] + 1e-12));
    };
    const open = relative(BASE);
    const closed = relative(CLOSED);

    // The second harmonic is the whole difference between a flute and a
    // clarinet, and it must be a LARGE difference, not a nudge.
    expect(open[1], 'open h2').toBeGreaterThan(-16);
    expect(closed[1], 'closed h2').toBeLessThan(-30);
    expect(open[1] - closed[1], 'open vs closed h2').toBeGreaterThan(20);

    // Even-minus-odd: real flutes measure +3.5..+6.4 dB over the Iowa set,
    // a stopped pipe is deeply negative. Ours is positive; the residual gap
    // to the real figure is recorded in the Phase D plan.
    const evenOdd = (r: number[]) =>
      (r[1] + r[3] + r[5]) / 3 - (r[2] + r[4]) / 2;
    expect(evenOdd(open), 'open E-O').toBeGreaterThan(0);
    expect(evenOdd(closed), 'closed E-O').toBeLessThan(-15);

    // Still a flute, not a sawtooth: the fundamental leads.
    for (let k = 1; k < open.length; k += 1) {
      expect(open[k], `open h${k + 1}`).toBeLessThan(0);
    }
  });

  it('brightens as it is blown harder, as a flute does', () => {
    // Brightness = total harmonic content against the fundamental, which
    // rises monotonically -13.5 -> -4.5 dB across Amp. An earlier arrangement
    // had this BACKWARDS: deepening the saturation of a FIXED-offset tanh
    // drives it toward a symmetric square, which is odd-only, so the evens
    // died as you blew harder. Amp drives the jet offset for that reason.
    //
    // KNOWN SHORTFALL, deliberately not asserted: h2 alone rises only ~5 dB
    // (-13.7 -> -8.3) and then plateaus, where the Iowa reference has it
    // rising ~15 dB (-18.5 pp -> -3.6 ff). The equilibrium drive amplitude
    // grows faster than the offset can follow, so the duty cycle drifts back
    // toward 0.5. Recorded in the Phase D plan; do not "fix" it by asserting
    // monotonic h2, which the model does not do.
    const thd = [0.1, 0.35, 0.65, 1].map((amp) => {
      const signal = blow(523, amp);
      const start = Math.round(SR * 0.6);
      const first = magnitude(signal, 523, start, 16384);
      const power = [2, 3, 4, 5, 6].reduce(
        (sum, k) => sum + (magnitude(signal, 523 * k, start, 16384) / first) ** 2,
        0,
      );
      return 10 * Math.log10(power);
    });
    for (let i = 1; i < thd.length; i += 1) {
      expect(thd[i], `THD across Amp: ${thd.map((v) => v.toFixed(1))}`)
        .toBeGreaterThan(thd[i - 1]);
    }
  });

  it('the even harmonics come from the jet OFFSET, not from the pipe', () => {
    // tanh is odd, so a drive swinging about zero can only make odd
    // harmonics — measured h2 at -103 dB before the offset was restored.
    // Euphonics 11.8.1 writes the source as d/dt[tanh((eta - y0)/b)]; y0 is
    // the jet-to-labium offset and it is the sole even-harmonic generator.
    const h2Of = (embouchure: number) => {
      const signal = blow(523, 0.7, 1.0, { embouchure });
      const start = Math.round(SR * 0.6);
      const first = magnitude(signal, 523, start, 16384);
      return 20 * Math.log10(magnitude(signal, 1046, start, 16384) / first);
    };
    expect(h2Of(1), 'aimed at the fitted embouchure').toBeGreaterThan(h2Of(0.2));
  });

  it('the tone-hole lattice makes the top register PURE — flute vs longhorn', () => {
    // Deepak, 2026-09-07: "flute sounds like a longhorn". The measured reason
    // was that the plain open tube is equally rich at EVERY pitch — h2 sat at
    // about -8 dB from 262 Hz to 1568 Hz — whereas a real flute falls from
    // -6.1 dB in the low register to -18.2 in the high one. A long plain tube
    // that sounds the same at every pitch IS an alphorn.
    //
    // Benade's tone-hole lattice is what does it: its cutoff is a FIXED
    // FREQUENCY, so the top octave sits near it and goes pure while the low
    // register is untouched. That is the whole difference between the two
    // shipped instruments, so it is pinned here.
    const h2At = (hz: number, overrides: Partial<FluteParams>) => {
      const signal = blow(hz, 0.6, 1.2, overrides);
      const start = Math.round(SR * 0.8);
      const first = magnitude(signal, hz, start, 8192);
      return 20 * Math.log10(magnitude(signal, hz * 2, start, 8192) / first);
    };
    const longhorn = { toneHoleHz: 0, lossPoles: 1 } as Partial<FluteParams>;
    const flute = { toneHoleHz: 2600, lossPoles: 2 } as Partial<FluteParams>;

    // The longhorn barely changes across three octaves...
    const longhornSpread = Math.abs(h2At(262, longhorn) - h2At(1568, longhorn));
    expect(longhornSpread, 'longhorn h2 spread 262->1568 Hz').toBeLessThan(4);

    // ...the flute's top register is markedly purer than its bottom.
    const fluteLow = h2At(262, flute);
    const fluteHigh = h2At(1568, flute);
    expect(fluteLow - fluteHigh, `flute h2 ${fluteLow} -> ${fluteHigh}`)
      .toBeGreaterThan(5);
  });

  it('the tone-hole cutoff is floored, so high notes still speak', () => {
    // A cutoff that falls too close to f0 leaves the loop unable to sustain:
    // unfloored, 2.6 kHz at 1568 Hz lands at 1.66*f0 and the harmonic ladder
    // fell apart entirely (h4 -9.3, h5 -9.7 dB). And the jet's headroom has to
    // be measured ABOVE what sustaining costs, not as an absolute share, or a
    // heavier bore loss cannot reach unity gain at all — with two poles that
    // silenced 1110-1176 Hz at EVERY Amp.
    for (const hz of [988, 1047, 1110, 1176, 1245, 1319, 1568, 1976]) {
      for (const amp of [0.2, 0.6, 1]) {
        expect(rms(blow(hz, amp, 1.0)), `${hz} Hz amp ${amp}`)
          .toBeGreaterThan(0.02);
      }
    }
  });

  it('Octave transposes the Hz input by whole octaves', () => {
    // The shipped flute sits at +2 because the keyboard's home window
    // (C4-D#5) is a concert flute's weakest bottom octave. `Hz` still means
    // Hz: Octave 0 plays exactly what it is given.
    // A transpose is a multiply, so comparing partial magnitudes settles it
    // far more cheaply than scanning for the pitch.
    const start = Math.round(SR * 0.6);
    for (const octave of [-1, 0, 1, 2]) {
      const signal = blow(262, 0.7, 0.9, { octave });
      const sounding = 262 * 2 ** octave;
      const atSounding = magnitude(signal, sounding, start, 8192);
      for (const other of [-1, 0, 1, 2].filter((o) => o !== octave)) {
        expect(
          magnitude(signal, 262 * 2 ** other, start, 8192),
          `Octave ${octave} should sound at ${sounding.toFixed(0)} Hz, not ${(262 * 2 ** other).toFixed(0)}`,
        ).toBeLessThan(atSounding);
      }
    }
    // Fractional values cannot detune it — whole octaves only.
    const fractional = blow(262, 0.7, 0.9, { octave: 1.4 });
    expect(magnitude(fractional, 524, start, 8192)).toBeGreaterThan(
      magnitude(fractional, 262 * 2 ** 1.4, start, 8192),
    );
  });

  it('speaks across the SHIPPED flute range, C6-D#7 at Octave +2', () => {
    // The transpose moves the default playing range up two octaves, so the
    // notes the demo actually plays are 1047-2489 Hz — above everything the
    // other oracles cover. A register the instrument ships in has to be
    // verified in that register.
    for (const semitone of [0, 3, 7, 11, 12, 15]) {
      const hz = 1046.5 * 2 ** (semitone / 12);
      for (const amp of [0.25, 0.7, 1]) {
        const signal = blow(hz, amp, 1.0, { octave: 0 });
        expect(rms(signal), `${hz.toFixed(0)} Hz amp ${amp}`).toBeGreaterThan(0.02);
        const start = Math.round(SR * 0.6);
        const nominal = magnitude(signal, hz, start, 8192);
        for (const k of [0.5, 2 / 3, 1.5, 2]) {
          expect(
            magnitude(signal, hz * k, start, 8192),
            `${hz.toFixed(0)} Hz amp ${amp}: partial x${k} beats the nominal`,
          ).toBeLessThan(nominal);
        }
      }
    }
  });

  it('Jet Refl moves the LEVEL, not the spectrum', () => {
    // jetGain is back-solved as share/(g0*jetRefl), so jetGain*jetRefl is
    // invariant and the loop is untouched. Worth pinning: it is why
    // Embouchure had to exist as a separate control.
    const spectrumOf = (jetReflection: number) => {
      const signal = blow(523, 0.7, 1.0, { jetReflection });
      const start = Math.round(SR * 0.6);
      const h = [1, 2, 3, 4].map((k) =>
        magnitude(signal, 523 * k, start, 16384),
      );
      return h.map((value) => 20 * Math.log10(value / h[0] + 1e-12));
    };
    const low = spectrumOf(0.2);
    const high = spectrumOf(0.8);
    for (let k = 1; k < low.length; k += 1) {
      expect(Math.abs(low[k] - high[k]), `h${k + 1}`).toBeLessThan(1.5);
    }
  });

  it('is silent when not blown, and rings down when the breath stops', () => {
    const state = createFluteState(SR);
    const block = new Float32Array(128);
    const hz = new Float32Array([523]);
    const amp = new Float32Array([0.8]);
    const low = new Float32Array([0]);
    const high = new Float32Array([1]);
    for (let i = 0; i < 60; i += 1) {
      processFluteBlock(state, BASE, hz, amp, low, block, SR);
    }
    let quiet = 0;
    for (const sample of block) quiet = Math.max(quiet, Math.abs(sample));
    expect(quiet).toBeLessThan(1e-6);

    for (let i = 0; i < 500; i += 1) {
      processFluteBlock(state, BASE, hz, amp, high, block, SR);
    }
    let sounding = 0;
    for (const sample of block) sounding = Math.max(sounding, Math.abs(sample));
    expect(sounding).toBeGreaterThan(0.05);

    for (let i = 0; i < 400; i += 1) {
      processFluteBlock(state, BASE, hz, amp, low, block, SR);
    }
    let after = 0;
    for (const sample of block) after = Math.max(after, Math.abs(sample));
    expect(after).toBeLessThan(sounding * 0.5);
  });

  // 864 combinations x 0.3 s of audio each. The default 5 s budget was always
  // marginal for it (measured 2.4-4.0 s) and tips over on a loaded machine.
  // The assertions are unchanged — only the harness budget moves.
  it('stays finite AND sane across the whole knob space', () => {
    // Not just finite: the open loop can be driven out of the regime its
    // linearisation was derived in, and when it was, it reached rms 2.9 and
    // jumped registers rather than producing a NaN. So bound the level too.
    for (const pipe of ['open', 'closed'] as const) {
      for (const hz of [80, 523, 2000]) {
        for (const amp of [0, 0.5, 1, 4]) {
          for (const jetRatio of [0.05, 0.25, 0.9]) {
            for (const endReflection of [0, 0.5, 0.95, 1]) {
              for (const embouchure of [0.2, 1, 1.3]) {
                const where = `${pipe}/${hz}/${amp}/${jetRatio}/${endReflection}/${embouchure}`;
                const signal = blow(hz, amp, 0.3, {
                  pipe,
                  jetRatio,
                  endReflection,
                  embouchure,
                });
                expect(signal.every(Number.isFinite), where).toBe(true);
                let peak = 0;
                for (const sample of signal) peak = Math.max(peak, Math.abs(sample));
                expect(peak, `${where} peak`).toBeLessThan(6);
              }
            }
          }
        }
      }
    }
  }, 20000);

  it('the watchdog resets instead of circulating NaN', () => {
    const state = createFluteState(SR);
    const block = new Float32Array(128);
    const hz = new Float32Array([523]);
    const amp = new Float32Array([0.8]);
    const gate = new Float32Array([1]);
    processFluteBlock(state, BASE, hz, amp, gate, block, SR);
    state.boreLastOut = Number.NaN;
    // The poison takes a few blocks to reach the output: the bore is read
    // `boreDelay` samples behind the write, so the first blocks still emit
    // the finite history already in the line.
    let tripped = false;
    for (let i = 0; i < 20 && !tripped; i += 1) {
      tripped = !processFluteBlock(state, BASE, hz, amp, gate, block, SR);
    }
    expect(tripped).toBe(true);
    for (let i = 0; i < 10; i += 1) {
      processFluteBlock(state, BASE, hz, amp, gate, block, SR);
      for (const sample of block) expect(Number.isFinite(sample)).toBe(true);
    }
  });
});

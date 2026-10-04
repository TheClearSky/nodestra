/**
 * Idle-voice oracles — the gates for `.claude/plans/idle-voice-cpu.md`.
 *
 * A released voice used to cost MORE than a sounding one (up to 11.4x), because
 * its state decayed into the subnormal float range and parked there. Two
 * changes fix it: a denormal guard that flushes recursive state to exact zero,
 * and an idle short-circuit that skips the loop once every state value is
 * ALREADY zero.
 *
 * THE LOAD-BEARING PROPERTY, and the reason these tests are phrased the way
 * they are: **the short-circuit must be an identity, not an approximation.**
 * Entry requires the state to be exactly zero, so a skipped block emits what
 * the loop provably would have computed. The proof is O1: render the same gate
 * pattern twice, once with the fast path available and once with it defeated,
 * and require the two to be BIT-IDENTICAL.
 *
 * Why not "a note after idle sounds within one block": the shipped flute's
 * onset is 90 ms and the first block after gate-high peaks at 1.6e-4, by
 * design (the Iowa reference's onset is 274 ms median). Any audibility
 * threshold that flute could pass would be too low to distinguish "woke" from
 * "leaking", so that formulation is unsound and is deliberately not used.
 *
 * Why not "released costs less than sounding": a wall-clock assertion inside a
 * unit suite flakes on a shared runner, and it passes vacuously once the fast
 * path exists. Cost lives in `samples/analysis/idle_cost.mjs`, reported and
 * not gated.
 */

import { describe, expect, it } from 'vitest';
import {
  createFluteState,
  processFluteBlock,
} from '../soundDefinitions/fluteCore';
import type { FluteParams, FluteState } from '../soundDefinitions/fluteCore';
import {
  createPluckedStringState,
  processPluckedStringBlock,
} from '../soundDefinitions/pluckedStringCore';
import type {
  PluckedStringParams,
  PluckedStringState,
} from '../soundDefinitions/pluckedStringCore';
import {
  createBowedStringState,
  processBowedStringBlock,
} from '../soundDefinitions/bowedStringCore';
import type { BowedStringParams } from '../soundDefinitions/bowedStringCore';
import {
  createModalBodyState,
  processModalBodyBlock,
} from '../soundDefinitions/modalBodyCore';
import type { ModalBodyParams } from '../soundDefinitions/modalBodyCore';
import {
  DEFAULT_BOW_FORCE,
  GUITAR_STRING,
  VIOLIN_BODY,
  VIOLIN_DIRECT_DB,
  violinImpedanceFor,
} from '../soundDefinitions/stringPresets';

const SR = 48000;
const QUANTUM = 128;
const HZ = 392;

/** Gate arrays are length 128 in the app — every worklet resolves them so. */
const HIGH = new Float32Array(QUANTUM).fill(1);
const LOW = new Float32Array(QUANTUM);
const HZ_A = new Float32Array(QUANTUM).fill(HZ);
const AMP_A = new Float32Array(QUANTUM).fill(0.7);

const FLUTE: FluteParams = {
  pipe: 'open', jetRatio: 0.25, noise: 0.3, vibratoRateHz: 5.5,
  vibratoDepth: 0.1, jetReflection: 0.5, endReflection: 0.95,
  embouchure: 0.85, toneHoleHz: 2600, lossPoles: 2, octave: 2,
  attackSec: 0.09, releaseSec: 0.09,
};
const PLUCKED: PluckedStringParams = {
  positionBeta: GUITAR_STRING.positionBeta,
  brightness: GUITAR_STRING.brightness,
  decaySec: GUITAR_STRING.decaySec,
  stiffness: GUITAR_STRING.stiffness,
  polarization: GUITAR_STRING.polarization,
  octave: 0,
  pickStyle: 'finger',
  dampOnRelease: true,
};
const BOWED: BowedStringParams = {
  positionBeta: 0.127,
  force: DEFAULT_BOW_FORCE.thermal,
  impedance: violinImpedanceFor(HZ),
  frictionModel: 'thermal',
  attackSec: 0.06, releaseSec: 0.08,
  vibratoRateHz: 5.5, vibratoCents: 12, noise: 0.4,
};
const BODY: ModalBodyParams = {
  modes: VIOLIN_BODY, scale: 1, airHz: 0, mix: 1, directDb: VIOLIN_DIRECT_DB,
};

const blocks = (seconds: number) => Math.round((SR * seconds) / QUANTUM);

type GatedCore<S> = {
  name: string;
  make: () => S;
  step: (state: S, gate: Float32Array, out: Float32Array) => void;
  /** Forces the full loop to run, so a run can be compared against itself. */
  defeatIdle: (state: S) => void;
  isIdle: (state: S) => boolean;
};

const flute: GatedCore<FluteState> = {
  name: 'jetFlute',
  make: () => createFluteState(SR),
  step: (s, g, o) => processFluteBlock(s, FLUTE, HZ_A, AMP_A, g, o, SR),
  defeatIdle: (s) => { s.idle = false; },
  isIdle: (s) => s.idle,
};

const plucked: GatedCore<PluckedStringState> = {
  name: 'pluckedString',
  make: () => createPluckedStringState(SR),
  step: (s, g, o) => processPluckedStringBlock(s, PLUCKED, HZ_A, AMP_A, g, o, SR),
  defeatIdle: (s) => { s.idle = false; },
  isIdle: (s) => s.idle,
};

/**
 * Render: low lead-in, a note, a LONG silence, then a second note — capturing
 * only that second note.
 *
 * The low lead-in is load-bearing, not padding: `pluckedString` triggers on a
 * RISING EDGE and treats `lastGate === null` as "no edge at start", so a gate
 * held high from the first block never plucks at all.
 */
function noteAfterSilence<S>(
  core: GatedCore<S>,
  silenceSeconds: number,
  defeat: boolean,
): { signal: Float32Array; wentIdle: boolean } {
  const state = core.make();
  const out = new Float32Array(QUANTUM);
  let wentIdle = false;
  const run = (count: number, gate: Float32Array, keep: Float32Array[] | null) => {
    for (let i = 0; i < count; i += 1) {
      if (defeat) core.defeatIdle(state);
      core.step(state, gate, out);
      if (core.isIdle(state)) wentIdle = true;
      if (keep) keep.push(Float32Array.from(out));
    }
  };
  run(4, LOW, null);
  run(blocks(1), HIGH, null);
  run(blocks(silenceSeconds), LOW, null);
  const kept: Float32Array[] = [];
  run(blocks(0.5), HIGH, kept);
  const signal = new Float32Array(kept.length * QUANTUM);
  kept.forEach((chunk, i) => signal.set(chunk, i * QUANTUM));
  return { signal, wentIdle };
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i += 1) {
    worst = Math.max(worst, Math.abs(a[i] - b[i]));
  }
  return worst;
}

describe('idle voices — the short-circuit is an identity', () => {
  const identity = <S,>(core: GatedCore<S>) =>
    it(`${core.name}: a note after idle is BIT-IDENTICAL to one without the fast path`, () => {
      // This is the user's constraint turned into a gate: "even if i come back
      // one hour later and press a key i should hear a sound" — and not merely
      // a sound, the SAME sound.
      for (const silence of [3, 10, 60]) {
        const withFastPath = noteAfterSilence(core, silence, false);
        const without = noteAfterSilence(core, silence, true);
        expect(withFastPath.wentIdle, `${core.name} never idled at ${silence}s`)
          .toBe(true);
        let peak = 0;
        for (const v of without.signal) peak = Math.max(peak, Math.abs(v));
        expect(peak, `${core.name} rendered silence — the test proves nothing`)
          .toBeGreaterThan(1e-3);
        expect(
          maxAbsDiff(withFastPath.signal, without.signal),
          `${core.name} after ${silence}s of idle`,
        ).toBe(0);
      }
    });
  identity(flute);
  identity(plucked);

  it('the flute keeps its noise and vibrato trajectories moving while idle', () => {
    // The loop is skipped but the LCG and the vibrato phase are not: they are
    // the only state that keeps moving at rest, and freezing them would make
    // the next note depend on how long the key was up. Measured before this
    // was handled: maxAbsDiff 1.92 against a peak of 1.28 — a different note.
    const state = createFluteState(SR);
    const out = new Float32Array(QUANTUM);
    for (let i = 0; i < 4; i += 1) processFluteBlock(state, FLUTE, HZ_A, AMP_A, LOW, out, SR);
    for (let i = 0; i < blocks(1); i += 1) processFluteBlock(state, FLUTE, HZ_A, AMP_A, HIGH, out, SR);
    for (let i = 0; i < blocks(3); i += 1) processFluteBlock(state, FLUTE, HZ_A, AMP_A, LOW, out, SR);
    expect(state.idle).toBe(true);
    const seedBefore = state.noiseSeed;
    const phaseBefore = state.vibratoPhase;
    for (let i = 0; i < 50; i += 1) processFluteBlock(state, FLUTE, HZ_A, AMP_A, LOW, out, SR);
    expect(state.noiseSeed).not.toBe(seedBefore);
    expect(state.vibratoPhase).not.toBe(phaseBefore);
  });
});

describe('idle voices — waking', () => {
  const waking = <S,>(core: GatedCore<S>) => {
    it(`${core.name}: wakes on a gate high anywhere in the block`, () => {
      // A whole-block scan is mandatory rather than convenient: `thresholdCore`
      // writes one output sample per input sample, so it can emit a gate that
      // rises and falls inside a single quantum.
      for (const index of [0, 63, 127]) {
        const state = core.make();
        const out = new Float32Array(QUANTUM);
        for (let i = 0; i < 4; i += 1) core.step(state, LOW, out);
        for (let i = 0; i < blocks(1); i += 1) core.step(state, HIGH, out);
        for (let i = 0; i < blocks(3); i += 1) core.step(state, LOW, out);
        expect(core.isIdle(state), `${core.name} did not idle`).toBe(true);

        const blip = new Float32Array(QUANTUM);
        blip[index] = 1;
        core.step(state, blip, out);
        expect(core.isIdle(state), `${core.name} stayed idle on a blip at ${index}`)
          .toBe(false);
      }
    });

    it(`${core.name}: a length-1 gate wakes it exactly like a length-128 one`, () => {
      // Cores accept length 1 (constant across the quantum) or length 128.
      // Reading past the end of a length-1 array yields `undefined`, and the
      // scan must not depend on `undefined >= 0.5` happening to be false.
      const settle = (state: S) => {
        const out = new Float32Array(QUANTUM);
        for (let i = 0; i < 4; i += 1) core.step(state, LOW, out);
        for (let i = 0; i < blocks(1); i += 1) core.step(state, HIGH, out);
        for (let i = 0; i < blocks(3); i += 1) core.step(state, LOW, out);
        return out;
      };
      const a = core.make();
      const out = settle(a);
      expect(core.isIdle(a)).toBe(true);
      core.step(a, new Float32Array([1]) as Float32Array, out);
      expect(core.isIdle(a), `${core.name} ignored a length-1 high gate`).toBe(false);

      const b = core.make();
      settle(b);
      core.step(b, new Float32Array([0]) as Float32Array, out);
      expect(core.isIdle(b), `${core.name} woke on a length-1 LOW gate`).toBe(true);
    });
  };
  waking(flute);
  waking(plucked);

  it('pluckedString: forced idle with lastGate true still plucks on the next high gate', () => {
    // The quiet counter requires `gate low`, which is what guarantees
    // `lastGate === false` when idle is entered. This pins that invariant: if
    // the requirement is ever dropped, a voice could idle mid-note with
    // `lastGate === true`, see no transition on wake, and stay silent until the
    // user released and pressed again.
    const state = createPluckedStringState(SR);
    const out = new Float32Array(QUANTUM);
    for (let i = 0; i < 4; i += 1) processPluckedStringBlock(state, PLUCKED, HZ_A, AMP_A, LOW, out, SR);
    for (let i = 0; i < blocks(1); i += 1) processPluckedStringBlock(state, PLUCKED, HZ_A, AMP_A, HIGH, out, SR);
    for (let i = 0; i < blocks(3); i += 1) processPluckedStringBlock(state, PLUCKED, HZ_A, AMP_A, LOW, out, SR);
    expect(state.idle).toBe(true);
    expect(state.lastGate).toBe(false);
  });

  it('modalBody wakes on ONE non-zero input sample, however tiny, anywhere', () => {
    // The wake test is an exact `!== 0`, never a threshold: this node's input
    // is a decaying string and no threshold can be chosen that upstream is
    // guaranteed to exceed. 1.401e-45 is the smallest float32 subnormal, i.e.
    // exactly the state an upstream voice parks in.
    for (const value of [1e-30, 1.401e-45, Number.NaN]) {
      for (const index of [0, 63, 127]) {
        const state = createModalBodyState();
        const out = new Float32Array(QUANTUM);
        const silent = new Float32Array(QUANTUM);
        const drive = Float32Array.from({ length: QUANTUM }, (_, i) =>
          0.3 * Math.sin((2 * Math.PI * i) / QUANTUM),
        );
        for (let i = 0; i < blocks(1); i += 1) processModalBodyBlock(state, BODY, drive, out, SR);
        for (let i = 0; i < blocks(8); i += 1) processModalBodyBlock(state, BODY, silent, out, SR);
        expect(state.idle, 'body never idled').toBe(true);

        const poke = new Float32Array(QUANTUM);
        poke[index] = value;
        processModalBodyBlock(state, BODY, poke, out, SR);
        expect(state.idle, `body stayed idle on ${value} at ${index}`).toBe(false);
      }
    }
  });

  it('modalBody does NOT wake on a block of -0', () => {
    // `-0 !== 0` is false in JavaScript, and that is the correct behaviour:
    // -0 carries no signal. Pinned so nobody "fixes" it with Object.is.
    const state = createModalBodyState();
    const out = new Float32Array(QUANTUM);
    const silent = new Float32Array(QUANTUM);
    const drive = Float32Array.from({ length: QUANTUM }, (_, i) =>
      0.3 * Math.sin((2 * Math.PI * i) / QUANTUM),
    );
    for (let i = 0; i < blocks(1); i += 1) processModalBodyBlock(state, BODY, drive, out, SR);
    for (let i = 0; i < blocks(8); i += 1) processModalBodyBlock(state, BODY, silent, out, SR);
    expect(state.idle).toBe(true);
    processModalBodyBlock(state, BODY, new Float32Array(QUANTUM).fill(-0), out, SR);
    expect(state.idle).toBe(true);
  });
});

describe('idle voices — the bowed string must NOT idle', () => {
  it('keeps running, because its nut line holds energy the output cannot see', () => {
    // With the bow lifted the friction solver sticks every sample, which makes
    // the nut recirculation unity-gain and non-inverting, so `nutLine` holds a
    // standing wave indefinitely while the output (taken from `toBridge`
    // alone) is ~1e-16. That state is REAL and the next note uses it: clearing
    // it moved the second note by maxAbsDiff 1.515 and its onset rms by +38 %.
    //
    // So this voice must never reach the "all state already zero" condition.
    // The denormal guard alone carries its cost, measured 2.4x -> 0.89x.
    const state = createBowedStringState(SR);
    const out = new Float32Array(QUANTUM);
    for (let i = 0; i < 4; i += 1) processBowedStringBlock(state, BOWED, HZ_A, AMP_A, LOW, out, SR);
    for (let i = 0; i < blocks(1); i += 1) processBowedStringBlock(state, BOWED, HZ_A, AMP_A, HIGH, out, SR);
    for (let i = 0; i < blocks(10); i += 1) processBowedStringBlock(state, BOWED, HZ_A, AMP_A, LOW, out, SR);

    let nut = 0;
    for (const v of state.nutLine) nut = Math.max(nut, Math.abs(v));
    let output = 0;
    for (const v of out) output = Math.max(output, Math.abs(v));

    expect(nut, 'the nut line should still hold real energy').toBeGreaterThan(0.05);
    expect(output, 'while the output is inaudible').toBeLessThan(1e-6);
  });
});

describe('every voice actually STOPS when the gate drops', () => {
  // The gate this suite was missing, and it found a real user-reachable bug:
  // with `Pipe: closed` the flute SELF-OSCILLATED and never stopped. Measured
  // 6 s after gate-low, with `state.breath` exactly 0:
  //     End Refl 0.50 -> 0.0e+0 .. 6.8e-8   decays
  //               0.60 -> 1.6e-1 .. 2.7e-1   STUCK NOTE
  //               0.85 -> 6.2e-1 .. 7.2e-1   STUCK at ~90 % of sounding level
  // The node's default End Refl had been raised to 0.95 for the OPEN pipe,
  // which pushed the closed path past its decay threshold and made a stuck
  // note reachable by switching one enum. The closed path now pins its own
  // ceiling; this asserts the property rather than the constant.
  //
  // No previous test could see it: the flute suite's CLOSED fixture used
  // End Refl 0.5 — the one value that decays — and its release test ran only
  // the open pipe.
  const peakOf = (buffer: Float32Array) => {
    let peak = 0;
    for (const v of buffer) peak = Math.max(peak, Math.abs(v));
    return peak;
  };

  for (const pipe of ['open', 'closed'] as const) {
    for (const endReflection of [0.5, 0.7, 0.85, 0.95]) {
      it(`jetFlute ${pipe} pipe, End Refl ${endReflection}, decays after release`, () => {
        const params: FluteParams = { ...FLUTE, pipe, endReflection, octave: 0 };
        const state = createFluteState(SR);
        const out = new Float32Array(QUANTUM);
        const hz = new Float32Array(QUANTUM).fill(262);
        const amp = new Float32Array(QUANTUM).fill(1);
        for (let i = 0; i < 4; i += 1) processFluteBlock(state, params, hz, amp, LOW, out, SR);
        for (let i = 0; i < blocks(1); i += 1) processFluteBlock(state, params, hz, amp, HIGH, out, SR);
        const sounding = peakOf(out);
        expect(sounding, 'it never spoke, so the test proves nothing')
          .toBeGreaterThan(0.01);

        for (let i = 0; i < blocks(6); i += 1) processFluteBlock(state, params, hz, amp, LOW, out, SR);
        expect(state.breath, 'breath should be fully released').toBe(0);
        expect(
          peakOf(out),
          `${pipe} @ ${endReflection} still sounding 6 s after release`,
        ).toBeLessThan(sounding * 1e-3);
      });
    }
  }
});

describe('the SHIPPED chains, string -> body', () => {
  // The body tests elsewhere feed hand-made zero blocks. No shipped upstream
  // produces those after a release, so this drives the real topologies:
  //   guitar = pluckedString -> stringBody   (instruments/physical/index.ts)
  //   violin = bowedString   -> stringBody
  const chain = (
    stringStep: (gate: Float32Array, out: Float32Array) => void,
    seconds: number,
  ) => {
    const body = createModalBodyState();
    const stringOut = new Float32Array(QUANTUM);
    const bodyOut = new Float32Array(QUANTUM);
    const run = (count: number, gate: Float32Array) => {
      for (let i = 0; i < count; i += 1) {
        stringStep(gate, stringOut);
        processModalBodyBlock(body, BODY, stringOut, bodyOut, SR);
      }
    };
    run(4, LOW);
    run(blocks(1), HIGH);
    run(blocks(seconds), LOW);
    let stringPeak = 0;
    for (const v of stringOut) stringPeak = Math.max(stringPeak, Math.abs(v));
    return { body, stringPeak };
  };

  it('guitar: the string reaches exact zero, so the body idles too', () => {
    const state = createPluckedStringState(SR);
    const { body, stringPeak } = chain(
      (gate, out) => processPluckedStringBlock(state, PLUCKED, HZ_A, AMP_A, gate, out, SR),
      4,
    );
    expect(stringPeak, 'the plucked string should be exactly silent').toBe(0);
    expect(body.idle, 'the body should follow it into idle').toBe(true);
  });

  it('violin: the body deliberately never idles, because the string never does', () => {
    // NOT a defect — the consequence of a decision made deliberately. The
    // bowed string holds a standing wave in its nut line (see the O6 test), so
    // its output parks around 1e-17: non-zero, and therefore above the
    // DENORMAL_FLOOR that `flush` would zero. The body's wake test is an exact
    // `!== 0` — never a threshold, because no threshold can be chosen that a
    // decaying upstream string is guaranteed to exceed — so the body is woken
    // every block, forever.
    //
    // Guard A is what carries this pair instead: the body went 3.03 % of a
    // core released to 0.29 %, and the bowed string 3.31 % to 1.24 %. If this
    // test ever starts failing because the body DOES idle, that means the
    // bowed string reached exact zero, which would contradict the O6 test and
    // means the violin's second note has changed.
    const state = createBowedStringState(SR);
    const { body, stringPeak } = chain(
      (gate, out) => processBowedStringBlock(state, BOWED, HZ_A, AMP_A, gate, out, SR),
      6,
    );
    expect(stringPeak, 'the bowed string should still be emitting something')
      .toBeGreaterThan(0);
    expect(stringPeak, 'and it should be far below audibility').toBeLessThan(1e-9);
    expect(body.idle, 'so the body cannot idle').toBe(false);
  });
});

describe('idle voices — the denormal guard', () => {
  const FLOAT32_MIN_NORMAL = 1.1754943508222875e-38;
  const FLOAT64_MIN_NORMAL = 2.2250738585072014e-308;

  const subnormals = (values: ArrayLike<number>, boundary: number) => {
    let count = 0;
    for (let i = 0; i < values.length; i += 1) {
      const magnitude = Math.abs(values[i]);
      if (magnitude > 0 && magnitude < boundary) count += 1;
    }
    return count;
  };

  it('no state parks subnormal — at EITHER boundary', () => {
    // Both matter, and the float64 one is the one that did the damage: the
    // body's mode memories and the bowed string's heat bank are Float64Array,
    // and nothing in modalBodyCore is float32 at all.
    const bowed = createBowedStringState(SR);
    const out = new Float32Array(QUANTUM);
    for (let i = 0; i < 4; i += 1) processBowedStringBlock(bowed, BOWED, HZ_A, AMP_A, LOW, out, SR);
    for (let i = 0; i < blocks(1); i += 1) processBowedStringBlock(bowed, BOWED, HZ_A, AMP_A, HIGH, out, SR);
    for (let i = 0; i < blocks(6); i += 1) processBowedStringBlock(bowed, BOWED, HZ_A, AMP_A, LOW, out, SR);

    expect(subnormals(bowed.heat, FLOAT64_MIN_NORMAL), 'bowed heat[]').toBe(0);
    expect(subnormals(bowed.decimation, FLOAT64_MIN_NORMAL), 'bowed decimation[]').toBe(0);
    expect(subnormals(bowed.bridgeLine, FLOAT32_MIN_NORMAL), 'bowed bridgeLine').toBe(0);
    expect(subnormals(bowed.nutLine, FLOAT32_MIN_NORMAL), 'bowed nutLine').toBe(0);

    const body = createModalBodyState();
    const drive = Float32Array.from({ length: QUANTUM }, (_, i) =>
      0.3 * Math.sin((2 * Math.PI * i) / QUANTUM),
    );
    const silent = new Float32Array(QUANTUM);
    for (let i = 0; i < blocks(1); i += 1) processModalBodyBlock(body, BODY, drive, out, SR);
    for (let i = 0; i < blocks(6); i += 1) processModalBodyBlock(body, BODY, silent, out, SR);
    expect(subnormals(body.y1, FLOAT64_MIN_NORMAL), 'body y1[]').toBe(0);
    expect(subnormals(body.y2, FLOAT64_MIN_NORMAL), 'body y2[]').toBe(0);

    const pipe = createFluteState(SR);
    for (let i = 0; i < 4; i += 1) processFluteBlock(pipe, FLUTE, HZ_A, AMP_A, LOW, out, SR);
    for (let i = 0; i < blocks(1); i += 1) processFluteBlock(pipe, FLUTE, HZ_A, AMP_A, HIGH, out, SR);
    for (let i = 0; i < blocks(6); i += 1) processFluteBlock(pipe, FLUTE, HZ_A, AMP_A, LOW, out, SR);
    expect(subnormals(pipe.bore, FLOAT32_MIN_NORMAL), 'flute bore').toBe(0);
    expect(subnormals(pipe.jet, FLOAT32_MIN_NORMAL), 'flute jet').toBe(0);

    // The CLOSED path too — guard A was applied only to the open loop at
    // first, leaving `filterY1` parked at -4.94e-324 and `dcY1` at -2.42e-322
    // in a shipped code path.
    const closed = createFluteState(SR);
    const closedParams: FluteParams = { ...FLUTE, pipe: 'closed', octave: 0 };
    for (let i = 0; i < 4; i += 1) processFluteBlock(closed, closedParams, HZ_A, AMP_A, LOW, out, SR);
    for (let i = 0; i < blocks(1); i += 1) processFluteBlock(closed, closedParams, HZ_A, AMP_A, HIGH, out, SR);
    for (let i = 0; i < blocks(6); i += 1) processFluteBlock(closed, closedParams, HZ_A, AMP_A, LOW, out, SR);
    expect(subnormals(closed.bore, FLOAT32_MIN_NORMAL), 'closed bore').toBe(0);
    expect(subnormals([closed.filterY1], FLOAT64_MIN_NORMAL), 'closed filterY1').toBe(0);
    expect(subnormals([closed.dcY1], FLOAT64_MIN_NORMAL), 'closed dcY1').toBe(0);
    expect(subnormals([closed.dcX1], FLOAT64_MIN_NORMAL), 'closed dcX1').toBe(0);
  });
});

describe('idle voices — the watchdog still wins', () => {
  it('a NaN poked into an idle voice is caught on the block that wakes it', () => {
    // The idle path computes nothing, so a NaN already in the state is
    // invisible until the voice wakes — at which point the watchdog must trip
    // and the reset must leave the voice AWAKE with a clear counter, or a
    // reset could collide with a stale settle count and strand it.
    const state = createFluteState(SR);
    const out = new Float32Array(QUANTUM);
    for (let i = 0; i < 4; i += 1) processFluteBlock(state, FLUTE, HZ_A, AMP_A, LOW, out, SR);
    for (let i = 0; i < blocks(1); i += 1) processFluteBlock(state, FLUTE, HZ_A, AMP_A, HIGH, out, SR);
    for (let i = 0; i < blocks(3); i += 1) processFluteBlock(state, FLUTE, HZ_A, AMP_A, LOW, out, SR);
    expect(state.idle).toBe(true);

    state.boreLastOut = Number.NaN;
    let tripped = false;
    for (let i = 0; i < 40 && !tripped; i += 1) {
      tripped = !processFluteBlock(state, FLUTE, HZ_A, AMP_A, HIGH, out, SR);
    }
    expect(tripped, 'the watchdog never tripped after waking').toBe(true);
    expect(state.idle, 'a reset must leave the voice awake').toBe(false);
    expect(state.zeroSamples, 'a reset must clear the settle count').toBe(0);
    for (let i = 0; i < 10; i += 1) {
      processFluteBlock(state, FLUTE, HZ_A, AMP_A, HIGH, out, SR);
      for (const sample of out) expect(Number.isFinite(sample)).toBe(true);
    }
  });
});

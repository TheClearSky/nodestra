/**
 * Heartbeat oracles.
 *
 * The old build was a 50 Hz sine gated by a SQUARE pulser at 1.2 Hz, and the
 * user's verdict was "just sounds like a square wave". What was wrong was not
 * tuning, so these tests pin the STRUCTURE that was wrong:
 *
 *   - it made ONE sound per cycle, where a heart makes two (S1 "lub", S2 "dub")
 *   - it spaced them EVENLY, which clinically is *embryocardia* — a fetal or
 *     dying heart — not a resting one
 *   - it switched INSTANTLY, and that discontinuity is the square wave itself
 *
 * Each assertion below fails against that old graph, for the right reason.
 */

import { describe, expect, it } from 'vitest';
import { probeGraphBuilders } from '../soundDefinitions/probeGraphs';

type NodeData = {
  nodeTypeUniqueId?: string;
  inputs?: { name: string; value?: unknown }[];
};

/**
 * `systoleMs` is written as a LITERAL on purpose.
 *
 * The previous version of the timing test recomputed `400 - 1.2 * bpm` and
 * compared it to thresholds the builder had derived from that same formula. It
 * was an identity: it could not fail for any bpm, any threshold, or any bug.
 * That is the same circularity that got caught once already in the
 * phonocardiogram script, and it got in here too.
 *
 * Holding the expected value as an independent constant means changing the
 * builder's relation breaks this test, which is the entire point of having it.
 */
const FLAVOURS = [
  { id: 'sfxHeartbeat', bpm: 72, systoleMs: 313.6 },
  { id: 'sfxHeartbeatCinematic', bpm: 54, systoleMs: 335.2 },
  { id: 'sfxHeartbeatDeep', bpm: 63, systoleMs: 324.4 },
] as const;

/** Pull a node's declared input value out of a built demo state. */
function nodesOf(demoId: string) {
  const state = probeGraphBuilders[demoId]();
  return state.nodes.map((node) => node.data as NodeData);
}

function valueOf(data: NodeData, input: string): number | undefined {
  const found = data.inputs?.find((i) => i.name === input);
  return typeof found?.value === 'number' ? found.value : undefined;
}

function byType(demoId: string, typeId: string) {
  return nodesOf(demoId).filter((d) => d.nodeTypeUniqueId === typeId);
}

describe('heartbeat — two sounds, not one', () => {
  for (const { id } of FLAVOURS) {
    it(`${id}: has TWO independently triggered sounds`, () => {
      // The old build had one gated oscillator. A heart has S1 and S2, each
      // with its own trigger and its own envelope.
      // TWO triggers, always. The deep flavour hangs a sub, a pitch envelope
      // and a transient click off the S1 trigger, but they are all part of the
      // same "lub" — adding a third heart sound would be wrong.
      expect(byType(id, 'threshold').length, 'triggers').toBe(2);
      const deep = id === 'sfxHeartbeatDeep';
      // deep: S1, S2, pitch, sub, click.
      expect(byType(id, 'adsr').length, 'envelopes').toBe(deep ? 5 : 2);
      // deep: S1, S2, sub.
      expect(byType(id, 'oscillator').length, 'tone sources').toBe(deep ? 3 : 2);
    });

    it(`${id}: neither sound switches instantly`, () => {
      // A square gate splatters spectrally at the discontinuity — that IS the
      // reported "square wave". Every envelope must have a real attack.
      // 1 ms is the floor below which the edge is effectively a step. The
      // transient click sits near it deliberately — that is what a click IS —
      // but nothing is allowed to be zero.
      for (const env of byType(id, 'adsr')) {
        const attack = valueOf(env, 'Attack s');
        expect(attack, 'Attack s').toBeGreaterThanOrEqual(0.002);
      }
    });

    it(`${id}: S1 fires on the ramp, not on the reset ripple`, () => {
      // MEASURED by rendering the real band-limited sawtooth offline: after
      // the reset the ramp rings up to 0.1247 before settling. With S1's
      // release point below that, the Schmitt trigger went high on the RIPPLE
      // ~0.5 ms after the reset and stayed high, so the intended crossing
      // never fired an edge and S1 arrived 33-44 ms early — while this test
      // suite, which only reads threshold NUMBERS, passed throughout.
      const RIPPLE_PEAK = 0.1247;
      const s1 = byType(id, 'threshold')
        .map((node) => ({
          fall: valueOf(node, 'Threshold')! - valueOf(node, 'Hysteresis')! / 2,
          rise: valueOf(node, 'Threshold')! + valueOf(node, 'Hysteresis')! / 2,
        }))
        .sort((a, b) => a.rise - b.rise)[0];
      expect(s1.fall, 'S1 release point clears the ripple').toBeGreaterThan(
        RIPPLE_PEAK,
      );
    });

    it(`${id}: the phase source is a RAMP, never a square`, () => {
      const pulsers = byType(id, 'pulser');
      expect(pulsers.length).toBe(1);
      const shape = pulsers[0].inputs?.find((i) => i.name === 'Shape')?.value;
      // A sawtooth is what lets two thresholds pick two different phases out
      // of one cycle. A square has only two levels and cannot.
      expect(shape).toBe('sawtooth');
    });
  }
});

describe('heartbeat — the timing is asymmetric and physiological', () => {
  for (const { id, bpm, systoleMs } of FLAVOURS) {
    it(`${id}: systole matches the clinical relation at ${bpm} bpm`, () => {
      // systole_ms ~= 400 - 1.2*bpm (measured relation; corroborated on a real
      // phonocardiogram in samples/references/sfx/heartbeat/). This is the
      // assertion the old evenly-spaced build cannot satisfy at any rate.
      const pulser = byType(id, 'pulser')[0];
      const rateHz = valueOf(pulser, 'Rate Hz');
      expect(rateHz).toBeDefined();
      expect(rateHz! * 60).toBeCloseTo(bpm, 1);

      const thresholds = byType(id, 'threshold')
        .map((t) => ({
          threshold: valueOf(t, 'Threshold')!,
          hysteresis: valueOf(t, 'Hysteresis')!,
        }))
        // A Schmitt trigger fires on the way UP past threshold + hysteresis/2.
        .map((t) => t.threshold + t.hysteresis / 2)
        .sort((a, b) => a - b);

      const cycleMs = 60000 / bpm;
      const actual = (thresholds[1] - thresholds[0]) * cycleMs;
      expect(
        Math.abs(actual - systoleMs),
        `systole ${actual.toFixed(1)} ms vs expected ${systoleMs.toFixed(1)} ms`,
      ).toBeLessThan(15);
    });

    it(`${id}: systole is SHORTER than diastole`, () => {
      // The asymmetry is the whole point: "lub-DUB ... lub-DUB", never an
      // evenly spaced "thump thump thump".
      const pulser = byType(id, 'pulser')[0];
      const cycleMs = 60000 / (valueOf(pulser, 'Rate Hz')! * 60);
      const fire = byType(id, 'threshold')
        .map((t) => valueOf(t, 'Threshold')! + valueOf(t, 'Hysteresis')! / 2)
        .sort((a, b) => a - b);
      const systoleMs = (fire[1] - fire[0]) * cycleMs;
      const diastoleMs = cycleMs - systoleMs;
      expect(systoleMs).toBeLessThan(diastoleMs);
      // And by a physiological margin, not a hair.
      expect(systoleMs / diastoleMs).toBeLessThan(0.85);
    });
  }

  it('the two flavours do NOT share one phase split', () => {
    // Systole is not a fixed FRACTION of the cycle — it follows
    // `400 - 1.2*bpm`, which is far flatter than proportional. Reusing one
    // split across both rates put the 54 bpm version 87 ms out, which is an
    // audibly evenly-spaced beat: exactly the fault being fixed. So the split
    // must differ between flavours.
    const split = (id: string) =>
      byType(id, 'threshold')
        .map((t) => valueOf(t, 'Threshold')!)
        .sort((a, b) => a - b);
    const clinical = split('sfxHeartbeat');
    const cinematic = split('sfxHeartbeatCinematic');
    expect(Math.abs(clinical[1] - cinematic[1])).toBeGreaterThan(0.02);
  });
});

describe('heartbeat — it sits where real heart sounds sit', () => {
  for (const { id } of FLAVOURS) {
    it(`${id}: S1 is lower than S2, and both are under 150 Hz`, () => {
      // Measured on real recordings: S1 is the longer, lower sound; S2 shorter
      // and brighter. Energy sits at 40-80 Hz — the old build's single 50 Hz
      // tone was a guess that happened to land in the band but could only ever
      // be one of the two sounds.
      // On the deep flavour the sub's Frequency is DRIVEN by a signal and so
      // has no static value at all — `valueOf` returns undefined for it, which
      // is itself the evidence that the pitch drop is wired.
      const all = byType(id, 'oscillator')
        .map((o) => valueOf(o, 'Frequency'))
        .filter((f): f is number => f !== undefined)
        .sort((a, b) => a - b);
      const freqs = all;
      expect(freqs.length).toBe(2);
      expect(freqs[0]).toBeLessThan(freqs[1]);
      for (const f of freqs) {
        expect(f).toBeGreaterThan(20);
        expect(f).toBeLessThan(150);
      }
    });

    it(`${id}: S2 decays faster than S1`, () => {
      const decays = byType(id, 'adsr').map((e) => valueOf(e, 'Decay s')!);
      expect(Math.min(...decays)).toBeLessThan(Math.max(...decays));
    });
  }
});

describe('heartbeat — it has to survive a real speaker', () => {
  // Reported symptom: "i hear glitchy sounds when it goes high", on the
  // cinematic AND deep flavours. The signal was measured CLEAN in-app --
  // master peak 0.35, no clipping, max sample-to-sample delta 0.00185 against
  // the 0.0012 a 26 Hz sine implies, no aliasing. The fault was that all the
  // energy sat below 60 Hz, where a laptop driver can only distort.
  for (const { id } of FLAVOURS) {
    it(`${id}: the chest resonance is not a 0 dB no-op`, () => {
      // THE BUG: `Gain dB` defaults to 0, and a peaking filter at 0 dB is a
      // WIRE. Measured in-app before the fix: hb-sum and hb-lp had identical
      // band profiles, proving the node between them did nothing.
      const chest = nodesOf(id).find(
        (d) =>
          d.nodeTypeUniqueId === 'filter' &&
          d.inputs?.find((i) => i.name === 'Type')?.value === 'peaking',
      );
      expect(chest, 'a peaking filter exists').toBeDefined();
      expect(Math.abs(valueOf(chest!, 'Gain dB') ?? 0)).toBeGreaterThan(0);
    });

    it(`${id}: cuts the sub-audible band that only moves the cone`, () => {
      // Below ~30 Hz nothing is audible on consumer hardware, but it still
      // consumes the driver's whole excursion budget. Every path must go
      // through the cut, or the untreated one re-introduces the problem.
      const state = probeGraphBuilders[id]();
      const out = state.nodes.find((n) => n.id === 'hb-out');
      expect(out, 'output highpass exists').toBeDefined();
      const data = out!.data as NodeData;
      expect(data.inputs?.find((i) => i.name === 'Type')?.value).toBe(
        'highpass',
      );
      // High enough to actually reach the offending band: at 30 Hz the cut sat
      // BELOW the cinematic S1 fundamental (26 Hz) and removed nothing.
      expect(valueOf(data, 'Freq')!).toBeGreaterThanOrEqual(45);
      expect(valueOf(data, 'Freq')!).toBeLessThanOrEqual(80);
      // Web Audio reads `Q` on a highpass in DECIBELS, so a positive Q is a
      // resonant LIFT at the corner — it would boost the exact band this node
      // exists to remove. Butterworth is Q = -3 dB (10^(-3/20) = 0.707).
      expect(valueOf(data, 'Q')!).toBeLessThanOrEqual(0);

      const edges = state.edges as { source: string; target: string }[];
      const feedsRender = edges.filter((e) => e.target === 'hb-render');
      expect(feedsRender.length, 'render is fed ONLY via the cut').toBe(1);
      expect(feedsRender[0].source).toBe('hb-out');
    });

    it(`${id}: generates harmonics so a small speaker can reproduce it`, () => {
      // The ear reconstructs a missing fundamental from its harmonics, so
      // this is what makes a 26 Hz thump audible on a device that cannot
      // produce 26 Hz at all.
      const state = probeGraphBuilders[id]();
      const translate = state.nodes.find((n) => n.id === 'hb-translate');
      expect(translate, 'translation stage on the valve bus').toBeDefined();
      expect((translate!.data as NodeData).nodeTypeUniqueId).toBe('saturator');
    });

    it(`${id}: the lowpass leaves those harmonics room to exist`, () => {
      // A 180 Hz corner (the old cinematic value) removes the harmonics the
      // stage above just generated, which is self-defeating.
      const lp = nodesOf(id).find(
        (d) =>
          d.nodeTypeUniqueId === 'filter' &&
          d.inputs?.find((i) => i.name === 'Type')?.value === 'lowpass',
      );
      expect(valueOf(lp!, 'Freq')!).toBeGreaterThanOrEqual(300);
    });
  }
});

describe('heartbeat — the deep flavour is a PRODUCED kick', () => {
  it('drops the sub in pitch — the one thing that separates it from cinematic', () => {
    // Depth alone did not separate them: both were slow, low and reverberant.
    // What makes a music-video kick is that the sub FALLS in pitch. A static
    // sine is a rumble; a falling one is a kick.
    //
    // The wiring is: constant(base) + Env x depth -> oscillator Frequency,
    // with signals summing on the signal input. So the evidence is a pitch
    // envelope whose decay is far shorter than the sub's amplitude decay —
    // pitch settles while the note rings on.
    const state = probeGraphBuilders.sfxHeartbeatDeep();
    const edges = state.edges as { source: string; target: string }[];
    const toSubFreq = edges.filter((e) => e.target === 'hb-subTone');
    expect(toSubFreq.length, 'sub Frequency is driven by 2 summed signals').toBe(2);

    const data = nodesOf('sfxHeartbeatDeep');
    const byId = (id: string) =>
      state.nodes.find((n) => n.id === id)!.data as NodeData;
    const pitchDecay = valueOf(byId('hb-pitchEnv'), 'Decay s')!;
    const subDecay = valueOf(byId('hb-subEnv'), 'Decay s')!;
    expect(pitchDecay, 'pitch settles fast').toBeLessThan(0.08);
    expect(subDecay, 'while the note rings on').toBeGreaterThan(0.3);
    expect(subDecay / pitchDecay).toBeGreaterThan(5);

    // Base + depth must span a real kick drop, not a wobble.
    const base = valueOf(byId('hb-subBase'), 'Value')!;
    const depth = valueOf(byId('hb-pitchDepth'), 'Gain')!;
    expect(base, 'lands low').toBeLessThan(35);
    expect(base + depth, 'starts high').toBeGreaterThan(50);
    expect(data.filter((d) => d.nodeTypeUniqueId === 'threshold').length).toBe(2);
  });

  it('has a transient click so it reads on a phone', () => {
    const state = probeGraphBuilders.sfxHeartbeatDeep();
    const byId = (id: string) =>
      state.nodes.find((n) => n.id === id)!.data as NodeData;
    // Short, and highpassed well above the sub.
    expect(valueOf(byId('hb-clickEnv'), 'Decay s')!).toBeLessThan(0.04);
    expect(valueOf(byId('hb-clickHp'), 'Freq')!).toBeGreaterThan(800);
  });

  it('is DRY — no reverb, unlike the cinematic one', () => {
    // Reverb is what made the two sound alike. A track's kick sits forward.
    const deepHasReverb = nodesOf('sfxHeartbeatDeep').some(
      (d) => d.nodeTypeUniqueId === 'reverb',
    );
    const cinematicHasReverb = nodesOf('sfxHeartbeatCinematic').some(
      (d) => d.nodeTypeUniqueId === 'reverb',
    );
    expect(deepHasReverb).toBe(false);
    expect(cinematicHasReverb).toBe(true);
  });

  it('hard-clips the sub so it survives on small speakers', () => {
    // A pure 22 Hz sine is inaudible on a laptop. Clipping folds energy into
    // odd harmonics (66 Hz, 110 Hz, ...) which DO reproduce, so the weight is
    // felt rather than lost. Without this the deep flavour would be the
    // QUIETEST of the three on most hardware, which is the opposite of asked.
    // Pinned BY ID, not by counting saturators: every flavour now also
    // carries `hb-translate` on the valve bus, whose job is the same trick
    // for the heart sounds themselves. Counting would conflate the two.
    const state = probeGraphBuilders.sfxHeartbeatDeep();
    const sub = state.nodes.find((n) => n.id === 'hb-subDrive')!.data as NodeData;
    expect(sub.nodeTypeUniqueId, 'saturator on the sub path').toBe('saturator');
    const drive = valueOf(sub, 'Drive')!;
    expect(drive).toBeGreaterThan(1);
    // It is a HARD clipper, not tanh: too much drive squares the sub off.
    expect(drive).toBeLessThan(3);
  });

  it('is voiced for impact, which is not the same as a hotter dial', () => {
    // This test used to be called "is the loudest of the three" and asserted
    // `deep >= cinematic` — which became vacuously true the moment deep's dial
    // was trimmed to match cinematic's. A test whose name stops describing
    // what it checks is worse than no test.
    //
    // Deep is loudest PERCEPTUALLY, via the sub and the harmonic translation,
    // not via the render level; the dial actually came DOWN because the
    // translation stage added real level. So what is worth pinning is that
    // both voiced flavours sit above the clinical one, which is quiet by
    // design because it is a stethoscope recording.
    const level = (id: string) =>
      valueOf(
        nodesOf(id).find((d) => d.nodeTypeUniqueId === 'render')!,
        'Level dB',
      )!;
    expect(level('sfxHeartbeatDeep')).toBeGreaterThan(level('sfxHeartbeat'));
    expect(level('sfxHeartbeatCinematic')).toBeGreaterThan(
      level('sfxHeartbeat'),
    );
  });
});

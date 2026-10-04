/**
 * Shared helper: prove a core still renders what it rendered BEFORE the
 * idle/denormal change (`.claude/plans/idle-voice-cpu.md`).
 *
 * The whole promise of that change is "nothing audible moves". The reference
 * fixtures in this directory were captured from the cores as they stood before
 * it, by `samples/analysis/capture_core_reference.mjs`, and these comparisons
 * are what turn that promise into a gate.
 *
 * WHAT IS COMPARED, and why each part exists:
 *
 *   attack   256 samples FROM THE ONSET (not from sample 0, which is inside the
 *            silent lead-in) — where any change to the excitation shows first
 *   sustain  every 64th sample while sounding — a decimated fingerprint; any
 *            real change to the DSP perturbs these
 *   decay    rms per 10 ms window in dB, across the release — the ONLY part
 *            that catches a TRUNCATED TAIL, which sample fingerprints taken
 *            during the sustain cannot see
 *
 * The decay comparison deliberately stops at `compareFloorDb`. Below that the
 * two renders are EXPECTED to diverge: the change flushes state under 1e-18
 * (-360 dBFS) to zero and short-circuits under 1e-8 (-160 dBFS). Comparing
 * there would assert that the bug is still present.
 */

const SILENT_DB = -999;

type Reference = {
  sampleRate: number;
  leadSec: number;
  gateSec: number;
  tailSec: number;
  hz: number;
  amp: number;
  attack: number[];
  sustain: number[];
  decayDb: number[];
};

type Comparison = {
  /** Largest absolute sample difference over the attack window. */
  attackMaxDiff: number;
  /** Largest absolute sample difference over the decimated sustain. */
  sustainMaxDiff: number;
  /** Largest dB difference over decay windows above `compareFloorDb`. */
  decayMaxDbDiff: number;
  /** How far down the reference decay was still compared, in dB. */
  comparedDownToDb: number;
  /** Windows that were above the floor and therefore actually compared. */
  comparedWindows: number;
};

/**
 * Re-render the reference scenario and diff it against the fixture.
 *
 * `render` must reproduce EXACTLY the scenario the capture script used:
 * `leadSec` of gate low, `gateSec` high, `tailSec` low — the low lead-in is
 * load-bearing, because `pluckedString` triggers on a rising edge and a gate
 * held high from the first block never plucks at all.
 */
function compareToReference(
  reference: Reference,
  signal: Float32Array,
  compareFloorDb = -120,
): Comparison {
  const { sampleRate, leadSec, gateSec } = reference;

  // The attack window starts AT the onset. Taking it from sample 0 would land
  // entirely inside the silent lead-in and assert nothing.
  const onset = Math.round(sampleRate * leadSec);
  let attackMaxDiff = 0;
  for (let i = 0; i < reference.attack.length; i += 1) {
    attackMaxDiff = Math.max(
      attackMaxDiff,
      Math.abs(signal[onset + i] - reference.attack[i]),
    );
  }

  const sustainFrom = Math.round(sampleRate * (leadSec + 0.35));
  const sustainTo = Math.round(sampleRate * (leadSec + gateSec));
  let sustainMaxDiff = 0;
  let k = 0;
  for (let i = sustainFrom; i < sustainTo; i += 64, k += 1) {
    sustainMaxDiff = Math.max(sustainMaxDiff, Math.abs(signal[i] - reference.sustain[k]));
  }

  const win = Math.round(sampleRate * 0.01);
  let decayMaxDbDiff = 0;
  let comparedDownToDb = 0;
  let comparedWindows = 0;
  for (let w = 0; w < reference.decayDb.length; w += 1) {
    const expected = reference.decayDb[w];
    if (expected === SILENT_DB || expected < compareFloorDb) continue;
    const start = w * win;
    if (start + win > signal.length) break;
    let sum = 0;
    for (let j = 0; j < win; j += 1) sum += signal[start + j] * signal[start + j];
    const rms = Math.sqrt(sum / win);
    const actual = rms > 0 ? 20 * Math.log10(rms) : SILENT_DB;
    decayMaxDbDiff = Math.max(decayMaxDbDiff, Math.abs(actual - expected));
    comparedDownToDb = Math.min(comparedDownToDb, expected);
    comparedWindows += 1;
  }

  return {
    attackMaxDiff,
    sustainMaxDiff,
    decayMaxDbDiff,
    comparedDownToDb,
    comparedWindows,
  };
}

/**
 * Render the reference scenario for a gated core.
 *
 * The lead-in of SILENCE then a rising edge is the same shape the capture
 * script used and the same shape the keyboard produces.
 */
function renderReferenceScenario(
  reference: Reference,
  step: (gate: Float32Array, out: Float32Array) => void,
  quantum = 128,
): Float32Array {
  const { sampleRate, leadSec, gateSec, tailSec } = reference;
  const total = Math.round(sampleRate * (leadSec + gateSec + tailSec));
  const signal = new Float32Array(total);
  const block = new Float32Array(quantum);
  // LENGTH `quantum`, matching the capture script exactly. The cores branch on
  // `gate.length === 1`, so replaying a capture with a length-1 gate would
  // compare two different code paths — and length 128 is the only one the
  // shipped worklets ever pass.
  const high = new Float32Array(quantum).fill(1);
  const low = new Float32Array(quantum);
  const leadBlocks = Math.round((sampleRate * leadSec) / quantum);
  const offBlock = leadBlocks + Math.round((sampleRate * gateSec) / quantum);
  let written = 0;
  let i = 0;
  while (written < total) {
    step(i >= leadBlocks && i < offBlock ? high : low, block);
    const take = Math.min(quantum, total - written);
    signal.set(block.subarray(0, take), written);
    written += take;
    i += 1;
  }
  return signal;
}

export { compareToReference, renderReferenceScenario };
export type { Comparison, Reference };

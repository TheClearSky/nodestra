/**
 * thresholdCore — the signal→boolSignal Schmitt trigger. PURE and
 * dependency-free by the same contract as envelopeCore: shared verbatim
 * by the worklet wrapper and the vitest oracles.
 *
 * Semantics: output goes HIGH when the input rises to
 * `threshold + hysteresis/2` or above, LOW when it falls to
 * `threshold - hysteresis/2` or below, and HOLDS its previous state in
 * between — chatter inside the hysteresis band never toggles the gate.
 * With hysteresis 0 both bounds coincide, and the FALL check runs
 * first while high: an input at EXACTLY the threshold reads high from
 * below but drops the gate from above (pinned by the oracle table).
 * Initial state is LOW: a lane
 * that starts above the threshold fires its rising edge on the first
 * sample, which is exactly the "gate rectangle starts at t=0"
 * behavior score lanes want.
 */

type ThresholdState = {
  high: boolean;
};

function createThresholdState(): ThresholdState {
  return { high: false };
}

/** Advance one sample; returns the gate as 0 or 1. Mutates `state`. */
function processThresholdSample(
  state: ThresholdState,
  x: number,
  threshold: number,
  hysteresis: number,
): 0 | 1 {
  const half = Math.abs(hysteresis) / 2;
  if (state.high) {
    if (x <= threshold - half) state.high = false;
  } else if (x >= threshold + half) {
    state.high = true;
  }
  return state.high ? 1 : 0;
}

/** Block form for the worklet quantum. */
function processThresholdBlock(
  state: ThresholdState,
  input: ArrayLike<number>,
  out: Float32Array,
  threshold: number,
  hysteresis: number,
): void {
  for (let i = 0; i < out.length; i += 1) {
    out[i] = processThresholdSample(state, input[i], threshold, hysteresis);
  }
}

export { createThresholdState, processThresholdBlock, processThresholdSample };
export type { ThresholdState };

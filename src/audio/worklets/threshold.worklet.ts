/**
 * The Threshold (Schmitt trigger) AudioWorklet — the sole
 * signal→boolSignal crossing. Thin wrapper over thresholdCore.ts,
 * bundled to public/threshold.worklet.js by scripts/build-worklets.mjs
 * (same delivery contract as the envelope).
 *
 * Input 0 = the signal to gate; output 0 = 0/1. Threshold/Hysteresis
 * are knob numbers delivered via processorOptions + port messages.
 * An absent input quantum is PROCESSED as x = 0 — the Schmitt state
 * is not frozen: a gate whose fall level is ≥ 0 drops when its
 * upstream goes inactive, and a negative-threshold gate sticks high.
 */

import {
  createThresholdState,
  processThresholdBlock,
} from '../../soundDefinitions/thresholdCore';

const QUANTUM = 128;

class SoundThresholdProcessor extends AudioWorkletProcessor {
  private readonly state = createThresholdState();

  private readonly silence = new Float32Array(QUANTUM);

  private threshold = 0.5;

  private hysteresis = 0.1;

  constructor(options?: { processorOptions?: unknown }) {
    super();
    const initial = options?.processorOptions as
      | { threshold?: number; hysteresis?: number }
      | undefined;
    if (typeof initial?.threshold === 'number') {
      this.threshold = initial.threshold;
    }
    if (typeof initial?.hysteresis === 'number') {
      this.hysteresis = initial.hysteresis;
    }
    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; threshold?: number; hysteresis?: number }
        | undefined;
      if (data?.type === 'stop') {
        this.stopped = true;
        return;
      }
      if (data?.type !== 'params') return;
      if (typeof data.threshold === 'number') this.threshold = data.threshold;
      if (typeof data.hysteresis === 'number') {
        this.hysteresis = data.hysteresis;
      }
    };
  }

  /** 'stop' dispose message → process() returns false → processor is
   *  reclaimed instead of leaking per Run. */
  private stopped = false;

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.stopped) return false;
    const channels = outputs[0];
    const out = channels?.[0];
    if (!out) return true;
    const input =
      inputs[0]?.[0] && inputs[0][0].length === out.length
        ? inputs[0][0]
        : this.silence.subarray(0, out.length);
    processThresholdBlock(
      this.state,
      input,
      out,
      this.threshold,
      this.hysteresis,
    );
    for (let channel = 1; channel < channels.length; channel += 1) {
      channels[channel].set(out);
    }
    return true;
  }
}

registerProcessor('sound-threshold', SoundThresholdProcessor);

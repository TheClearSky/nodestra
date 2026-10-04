/**
 * The bowed-string AudioWorklet.
 *
 * Thin wrapper only: ALL semantics live in bowedStringCore.ts, which is
 * bundled INTO public/bowedString.worklet.js by scripts/build-worklets.mjs.
 *
 * Topology: input 0 = the gate (bow on the string — a LEVEL, not an edge);
 * AudioParams `hz`, `amp` (bow speed) and `force` (bow pressure); output 0 =
 * the velocity wave toward the bridge, proportional to bridge force.
 *
 * The 'stop' handling is MANDATORY for every `sound-*` processor.
 */

import {
  createBowedStringState,
  processBowedStringBlock,
} from '../../soundDefinitions/bowedStringCore';
import type { BowedStringParams } from '../../soundDefinitions/bowedStringCore';

const QUANTUM = 128;

class BowedStringProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): AudioParamDescriptorLike[] {
    return [
      {
        name: 'hz',
        defaultValue: 220,
        minValue: 0,
        maxValue: 20000,
        automationRate: 'a-rate',
      },
      {
        name: 'amp',
        defaultValue: 1,
        minValue: 0,
        maxValue: 8,
        automationRate: 'a-rate',
      },
      {
        name: 'force',
        defaultValue: 0.3,
        minValue: 0,
        maxValue: 1,
        automationRate: 'a-rate',
      },
    ];
  }

  private readonly state = createBowedStringState(sampleRate);

  private readonly silence = new Float32Array(QUANTUM);

  private params: BowedStringParams = {
    positionBeta: 0.127,
    force: 0.3,
    impedance: 0.363,
    frictionModel: 'thermal',
    attackSec: 0.06,
    releaseSec: 0.08,
    vibratoRateHz: 5.5,
    vibratoCents: 12,
    noise: 0.4,
  };

  private stopped = false;

  constructor(options?: { processorOptions?: unknown }) {
    super();
    const initial = (
      options?.processorOptions as { params?: BowedStringParams } | undefined
    )?.params;
    if (initial) this.params = initial;
    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; params?: BowedStringParams }
        | undefined;
      if (data?.type === 'stop') this.stopped = true;
      else if (data?.type === 'params' && data.params) this.params = data.params;
    };
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    if (this.stopped) return false;
    const channels = outputs[0];
    const out = channels?.[0];
    if (!out) return true;
    const gate =
      inputs[0]?.[0] && inputs[0][0].length === out.length
        ? inputs[0][0]
        : this.silence.subarray(0, out.length);
    // `force` is an AudioParam so it can be played, but the friction solve
    // needs one value per block; take the first sample of the quantum.
    const force = parameters.force;
    processBowedStringBlock(
      this.state,
      { ...this.params, force: force ? force[0] : this.params.force },
      parameters.hz,
      parameters.amp,
      gate,
      out,
      sampleRate,
    );
    for (let channel = 1; channel < channels.length; channel += 1) {
      channels[channel].set(out);
    }
    return true;
  }
}

registerProcessor('sound-bowed-string', BowedStringProcessor);

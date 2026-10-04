/**
 * The jet-flute AudioWorklet.
 *
 * Thin wrapper only: ALL semantics live in fluteCore.ts, which is bundled
 * INTO public/flute.worklet.js by scripts/build-worklets.mjs.
 *
 * Topology: input 0 = the gate (blowing — a LEVEL, not an edge); AudioParams
 * `hz` and `amp` (breath); output 0 = the bore's radiated pressure.
 *
 * The 'stop' handling is MANDATORY for every `sound-*` processor: without it
 * the audio thread keeps one live callback per disposed node per Run.
 */

import {
  createFluteState,
  processFluteBlock,
} from '../../soundDefinitions/fluteCore';
import type { FluteParams } from '../../soundDefinitions/fluteCore';

const QUANTUM = 128;

class FluteProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): AudioParamDescriptorLike[] {
    return [
      {
        name: 'hz',
        defaultValue: 262,
        minValue: 0,
        maxValue: 20000,
        automationRate: 'a-rate',
      },
      {
        name: 'amp',
        defaultValue: 0.7,
        minValue: 0,
        maxValue: 8,
        automationRate: 'a-rate',
      },
    ];
  }

  private readonly state = createFluteState(sampleRate);

  private readonly silence = new Float32Array(QUANTUM);

  private params: FluteParams = {
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
    octave: 2,
    attackSec: 0.04,
    releaseSec: 0.05,
  };

  private stopped = false;

  constructor(options?: { processorOptions?: unknown }) {
    super();
    const initial = (
      options?.processorOptions as { params?: FluteParams } | undefined
    )?.params;
    if (initial) this.params = initial;
    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; params?: FluteParams }
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
    processFluteBlock(
      this.state,
      this.params,
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

registerProcessor('sound-flute', FluteProcessor);

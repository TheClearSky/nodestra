/**
 * The FDN reverb AudioWorklet.
 *
 * Thin wrapper only: ALL semantics live in fdnReverbCore.ts, which is bundled
 * INTO public/fdnReverb.worklet.js by scripts/build-worklets.mjs (the generated
 * file is what dev AND `vite build` serve, so the two cannot drift).
 *
 * STEREO IN, STEREO OUT — unlike the instrument worklets, which are mono and
 * copy their single channel out. A reverb's whole job includes producing a
 * stereo field, and the core taps alternating delay lines for L and R to get
 * one, so collapsing it here would throw away the thing being built.
 *
 * `mix` is an AudioParam rather than a processorOptions knob because dry/wet is
 * the parameter people automate. The rest arrive at construction and via
 * `{type:'params'}` port messages.
 *
 * The 'stop' handling is MANDATORY for every `sound-*` processor: without it
 * the audio thread keeps one live callback per disposed node per Run forever.
 */

import {
  createFdnReverbState,
  processFdnReverbBlock,
} from '../../soundDefinitions/fdnReverbCore';
import type { FdnReverbParams } from '../../soundDefinitions/fdnReverbCore';

const QUANTUM = 128;

class FdnReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): AudioParamDescriptorLike[] {
    return [
      {
        name: 'mix',
        defaultValue: 0.35,
        minValue: 0,
        maxValue: 1,
        automationRate: 'a-rate',
      },
    ];
  }

  private readonly state = createFdnReverbState(sampleRate);

  private readonly silence = new Float32Array(QUANTUM);

  private params: FdnReverbParams = {
    sizeScale: 1,
    decaySec: 3,
    dampingHz: 6000,
    modRateHz: 0.7,
    modDepthMs: 3,
    diffusion: 0.6,
    lowCutHz: 120,
    width: 1,
    mix: 0.35,
  };

  private stopped = false;

  constructor(options?: { processorOptions?: unknown }) {
    super();
    const initial = (
      options?.processorOptions as { params?: FdnReverbParams } | undefined
    )?.params;
    if (initial) this.params = initial;
    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; params?: FdnReverbParams }
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
    const outL = channels?.[0];
    if (!outL) return true;
    const outR = channels[1] ?? outL;

    const source = inputs[0];
    const silence = this.silence.subarray(0, outL.length);
    const inL = source?.[0]?.length === outL.length ? source[0] : silence;
    // A mono upstream feeds both sides rather than half a reverb.
    const inR = source?.[1]?.length === outL.length ? source[1] : inL;

    // `mix` may be a-rate (length === quantum) or k-rate (length 1).
    const mixParam = parameters.mix;
    this.params = {
      ...this.params,
      mix: mixParam.length > 0 ? mixParam[0] : this.params.mix,
    };

    processFdnReverbBlock(
      this.state,
      this.params,
      inL,
      inR,
      outL,
      outR,
      sampleRate,
    );

    for (let channel = 2; channel < channels.length; channel += 1) {
      channels[channel].set(outL);
    }
    return true;
  }
}

registerProcessor('sound-fdn-reverb', FdnReverbProcessor);

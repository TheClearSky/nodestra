/**
 * The plucked-string AudioWorklet.
 *
 * Thin wrapper only: ALL semantics live in pluckedStringCore.ts, which is
 * bundled INTO public/pluckedString.worklet.js by scripts/build-worklets.mjs
 * (the generated file is what dev AND `vite build` serve, so the two modes
 * cannot drift).
 *
 * Topology: input 0 = the gate (audio-rate 0/1, ≥ 0.5 = high); AudioParams
 * `hz` and `amp` carry the pitch and the pluck strength; output 0 = the
 * string's bridge force. Knob-style parameters arrive via processorOptions at
 * construction and `{type:'params'}` port messages after.
 *
 * The 'stop' handling is MANDATORY for every `sound-*` processor: without it
 * the audio thread keeps one live callback per disposed node per Run forever.
 */

import {
  createPluckedStringState,
  processPluckedStringBlock,
} from '../../soundDefinitions/pluckedStringCore';
import type { PluckedStringParams } from '../../soundDefinitions/pluckedStringCore';

const QUANTUM = 128;

class PluckedStringProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): AudioParamDescriptorLike[] {
    return [
      // minValue 0, not 20: `applySignalReading` writes the base to 0 when a
      // modulator is connected, and a min-bounded AudioParam would silently
      // floor it. The core clamps the pitch itself.
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
    ];
  }

  private readonly state = createPluckedStringState(sampleRate);

  private readonly silence = new Float32Array(QUANTUM);

  private params: PluckedStringParams = {
    positionBeta: 0.2,
    brightness: 0.6,
    decaySec: 7,
    stiffness: 3e-5,
    polarization: 0.5,
    // 0 = no transpose, matching the node's default and the guitar voice.
    octave: 0,
    pickStyle: 'finger',
    dampOnRelease: true,
  };

  private stopped = false;

  constructor(options?: { processorOptions?: unknown }) {
    super();
    const initial = (
      options?.processorOptions as
        | { params?: PluckedStringParams }
        | undefined
    )?.params;
    if (initial) this.params = initial;
    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; params?: PluckedStringParams }
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
    processPluckedStringBlock(
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

registerProcessor('sound-plucked-string', PluckedStringProcessor);

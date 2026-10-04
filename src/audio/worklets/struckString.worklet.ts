/**
 * The struck-string (piano) AudioWorklet.
 *
 * Thin wrapper only: ALL semantics live in struckStringCore.ts, which is
 * bundled INTO public/struckString.worklet.js by scripts/build-worklets.mjs
 * (the generated file is what dev AND `vite build` serve, so the two modes
 * cannot drift).
 *
 * Topology: input 0 = the gate (audio-rate 0/1, >= 0.5 = high); AudioParams
 * `hz` and `velocity` carry the pitch and the hammer speed; output 0 = the
 * bridge force of the whole unison group. Knob-style parameters arrive via
 * processorOptions at construction and `{type:'params'}` port messages after.
 *
 * `velocity` is NOT a volume. The core maps it to hammer contact time, so it
 * changes the SPECTRUM as well as the level — a soft strike is a darker
 * sound, not merely a quieter one. That is the whole reason this core exists.
 *
 * The 'stop' handling is MANDATORY for every `sound-*` processor: without it
 * the audio thread keeps one live callback per disposed node per Run forever.
 */

import {
  createStruckStringState,
  processStruckStringBlock,
} from '../../soundDefinitions/struckStringCore';
import type { StruckStringParams } from '../../soundDefinitions/struckStringCore';

const QUANTUM = 128;

class StruckStringProcessor extends AudioWorkletProcessor {
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
        name: 'velocity',
        defaultValue: 0.8,
        minValue: 0,
        maxValue: 4,
        automationRate: 'a-rate',
      },
    ];
  }

  private readonly state = createStruckStringState(sampleRate);

  private readonly silence = new Float32Array(QUANTUM);

  private params: StruckStringParams = {
    positionBeta: 0.125,
    brightness: 0.62,
    decaySec: 8,
    stiffness: 2.5e-4,
    strings: 3,
    unisonCents: 3,
    hardness: 0.5,
    octave: 0,
    dampOnRelease: true,
  };

  private stopped = false;

  constructor(options?: { processorOptions?: unknown }) {
    super();
    const initial = (
      options?.processorOptions as { params?: StruckStringParams } | undefined
    )?.params;
    if (initial) this.params = initial;
    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; params?: StruckStringParams }
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
    processStruckStringBlock(
      this.state,
      this.params,
      parameters.hz,
      parameters.velocity,
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

registerProcessor('sound-struck-string', StruckStringProcessor);

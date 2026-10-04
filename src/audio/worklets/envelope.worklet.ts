/**
 * The gate-mode envelope AudioWorklet.
 *
 * Thin wrapper only: ALL semantics live in envelopeCore.ts, which is
 * bundled INTO public/envelope.worklet.js by scripts/build-worklets.mjs
 * (the generated file is what dev AND `vite build` serve, so the two
 * modes cannot drift).
 *
 * Topology: input 0 = the gate (audio-rate 0/1, ≥ 0.5 = high);
 * output 0 = the envelope value 0..1 (drives a Gain's gain param and
 * the node's Env signal output). Params arrive via processorOptions at
 * construction and `{type:'params', params}` port messages after —
 * they are knob numbers, not modulation targets, so no AudioParams.
 *
 * An absent/empty input quantum is processed as gate LOW — one-shot
 * cycles keep running after a 1-sample pulse even if the source goes
 * silent, and releases complete when a driver is disconnected.
 */

import {
  createEnvelopeState,
  processEnvelopeBlock,
} from '../../soundDefinitions/envelopeCore';
import type { EnvelopeParams } from '../../soundDefinitions/envelopeCore';

const QUANTUM = 128;

class SoundEnvelopeProcessor extends AudioWorkletProcessor {
  private readonly state = createEnvelopeState();

  private readonly silence = new Float32Array(QUANTUM);

  private params: EnvelopeParams = {
    attackSec: 0.01,
    decaySec: 0.1,
    sustain: 0.5,
    releaseSec: 0.3,
    mode: 'high',
  };

  /** Set by the 'stop' dispose message: process() then returns false,
   *  clearing the active-source flag so the processor is reclaimed —
   *  returning true forever would leak one live audio-thread callback
   *  per disposed node per Run. */
  private stopped = false;

  constructor(options?: { processorOptions?: unknown }) {
    super();
    const initial = (
      options?.processorOptions as { params?: EnvelopeParams } | undefined
    )?.params;
    if (initial) this.params = initial;
    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; params?: EnvelopeParams }
        | undefined;
      if (data?.type === 'stop') this.stopped = true;
      else if (data?.type === 'params' && data.params) {
        this.params = data.params;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.stopped) return false;
    const channels = outputs[0];
    const out = channels?.[0];
    if (!out) return true;
    const gate =
      inputs[0]?.[0] && inputs[0][0].length === out.length
        ? inputs[0][0]
        : this.silence.subarray(0, out.length);
    processEnvelopeBlock(this.state, this.params, gate, out, sampleRate);
    for (let channel = 1; channel < channels.length; channel += 1) {
      channels[channel].set(out);
    }
    return true;
  }
}

registerProcessor('sound-envelope', SoundEnvelopeProcessor);

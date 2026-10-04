/**
 * The instrument-body AudioWorklet (a modal resonator bank).
 *
 * Thin wrapper only: ALL semantics live in modalBodyCore.ts, which is bundled
 * INTO public/modalBody.worklet.js by scripts/build-worklets.mjs.
 *
 * Topology: input 0 = audio (the dry string); output 0 = the radiated sound.
 * Unlike the gate-reading processors this one carries a real audio signal, so
 * it is NOT forced to mono at the node level — see implementations.ts.
 *
 * The 'stop' handling is MANDATORY for every `sound-*` processor.
 */

import {
  createModalBodyState,
  processModalBodyBlock,
} from '../../soundDefinitions/modalBodyCore';
import type { ModalBodyParams } from '../../soundDefinitions/modalBodyCore';

const QUANTUM = 128;

class ModalBodyProcessor extends AudioWorkletProcessor {
  private readonly state = createModalBodyState();

  /** Reused zero input for quanta Chrome elides — never allocate per block. */
  private readonly silence = new Float32Array(QUANTUM);

  private params: ModalBodyParams = {
    modes: [],
    scale: 1,
    airHz: 0,
    mix: 1,
    directDb: -14,
  };

  private stopped = false;

  constructor(options?: { processorOptions?: unknown }) {
    super();
    const initial = (
      options?.processorOptions as { params?: ModalBodyParams } | undefined
    )?.params;
    if (initial) this.params = initial;
    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; params?: ModalBodyParams }
        | undefined;
      if (data?.type === 'stop') this.stopped = true;
      else if (data?.type === 'params' && data.params) this.params = data.params;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.stopped) return false;
    const channels = outputs[0];
    const out = channels?.[0];
    if (!out) return true;
    const input = inputs[0]?.[0];
    if (!input || input.length !== out.length) {
      // An absent input quantum still has to be RUN, so the bank rings down
      // instead of freezing mid-decay when its upstream goes inactive.
      //
      // Fed from a REUSED zero buffer, not `out.slice()`: that allocated 128
      // floats per block per body on the audio thread, and this is exactly the
      // path an inactive upstream takes — i.e. it allocated hardest precisely
      // when the instrument was doing nothing.
      out.fill(0);
      processModalBodyBlock(
        this.state,
        this.params,
        this.silence.subarray(0, out.length),
        out,
        sampleRate,
      );
    } else {
      processModalBodyBlock(this.state, this.params, input, out, sampleRate);
    }
    for (let channel = 1; channel < channels.length; channel += 1) {
      channels[channel].set(out);
    }
    return true;
  }
}

registerProcessor('sound-modal-body', ModalBodyProcessor);

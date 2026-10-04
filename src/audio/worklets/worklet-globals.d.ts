/**
 * Ambient declarations for the AudioWorkletGlobalScope.
 * The DOM lib doesn't declare these; the wrapper sources under this
 * folder run INSIDE the worklet scope after being bundled to
 * public/*.worklet.js by scripts/build-worklets.mjs.
 */

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

/**
 * One entry of a processor's static `parameterDescriptors`. Declared here
 * because the DOM lib does not expose it to worklet-scope sources.
 *
 * NOTE the values arrive in `process()` as a Float32Array of length 1 when
 * the parameter was constant across the quantum, and 128 when it was
 * automated — every core must handle both.
 */
declare type AudioParamDescriptorLike = {
  name: string;
  defaultValue: number;
  minValue: number;
  maxValue: number;
  automationRate: 'a-rate' | 'k-rate';
};

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: {
    processorOptions?: unknown;
  }) => AudioWorkletProcessor,
): void;

/** The worklet scope's context sample rate. */
declare const sampleRate: number;

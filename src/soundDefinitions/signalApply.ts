/**
 * The pure replace-on-connect rule, extracted Tone-free so the
 * enforcement pins can exercise it with fake params.
 *
 * Connected → the base is REPLACED by `replaceBase` and every connection is
 * wired in (they SUM natively). `replaceBase` defaults to 0, but MUST be
 * overridden where 0 is not "silent/neutral" in the param's native domain:
 * - convert-true dB Params (Volume.volume, EQ3 bands): 0 dB = UNITY gain —
 *   pass `-Infinity` (Tone's own mute value) instead;
 * - min-bounded Params (BitCrusher.bits min 1, Compressor.ratio min 1):
 *   0 THROWS assertRange — pass the domain minimum.
 * Unconnected → the knob (or the implementation default).
 */

import type { ParamLike, SignalChain } from './valueTypes';

type SignalReading = {
  chains: SignalChain[];
  knob: number | undefined;
};

function applySignalReading(
  param: ParamLike,
  reading: SignalReading,
  fallback: number,
  replaceBase: number,
  connectChain: (chain: SignalChain, param: ParamLike) => void,
): void {
  const writable = param as { value: number };
  if (reading.chains.length > 0) {
    writable.value = replaceBase;
    for (const chain of reading.chains) {
      connectChain(chain, param);
    }
  } else {
    writable.value = reading.knob ?? fallback;
  }
}

export { applySignalReading };
export type { SignalReading };

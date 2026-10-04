import { describe, expect, it, vi } from 'vitest';
import { applySignalReading } from '@/soundDefinitions/signalApply';
import type { SignalChain } from '@/soundDefinitions/valueTypes';

function makeChain(label: string): SignalChain {
  return { kind: 'signalChain', output: { label }, buildId: 1, label };
}

function makeFakeParam(initial: number) {
  return {
    value: initial,
    // The member-connect path Tone forbids would call
    // setValueAtTime(0, 0) on the destination — it must NEVER happen.
    setValueAtTime: vi.fn(),
  };
}

describe('applySignalReading — the replace-on-connect rule', () => {
  it('unconnected: knob wins, else the implementation fallback', () => {
    const param = makeFakeParam(999);
    applySignalReading(param, { chains: [], knob: 42 }, 7, 0, vi.fn());
    expect(param.value).toBe(42);
    applySignalReading(param, { chains: [], knob: undefined }, 7, 0, vi.fn());
    expect(param.value).toBe(7);
  });

  it('connected: base REPLACED (pitch-absolute general rule) and every chain connected', () => {
    const param = makeFakeParam(1200);
    const connect = vi.fn();
    const chains = [makeChain('pulser'), makeChain('constant')];
    applySignalReading(param, { chains, knob: 1200 }, 220, 0, connect);
    expect(param.value).toBe(0); // zeroed base — the pitch pin
    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenNthCalledWith(1, chains[0], param);
    expect(connect).toHaveBeenNthCalledWith(2, chains[1], param);
  });

  it('never calls setValueAtTime — the connectSignal zeroing path is banned', () => {
    const param = makeFakeParam(5);
    applySignalReading(
      param,
      { chains: [makeChain('m')], knob: 5 },
      1,
      0,
      vi.fn(),
    );
    applySignalReading(param, { chains: [], knob: 3 }, 1, 0, vi.fn());
    expect(param.setValueAtTime).not.toHaveBeenCalled();
  });

  it('replaceBase overrides where 0 is wrong: −Infinity for convert-true dB', () => {
    const volume = makeFakeParam(-6);
    applySignalReading(
      volume,
      { chains: [makeChain('curve')], knob: -6 },
      -6,
      Number.NEGATIVE_INFINITY,
      vi.fn(),
    );
    expect(volume.value).toBe(Number.NEGATIVE_INFINITY);
  });

  it('replaceBase overrides where 0 throws: domain minimum for bounded params', () => {
    const ratio = makeFakeParam(4);
    applySignalReading(
      ratio,
      { chains: [makeChain('lfo')], knob: 4 },
      4,
      1,
      vi.fn(),
    );
    expect(ratio.value).toBe(1);
  });
});

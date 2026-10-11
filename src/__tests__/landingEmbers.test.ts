import { describe, expect, it } from 'vitest';
import { moveEmber } from '../site/stageEffects';
import type { Ember } from '../site/stageEffects';

// The hero's embers move by time, not by frame: the same look at 30, 60 and
// 144 frames a second.

const ember = (): Ember => ({ x: 400, y: 600, z: 0.5, s: 0, ph: 1, born: 0 });

/** One second of frames at `hz`; returns the ember. */
const second = (hz: number) => {
  const p = ember();
  let t = 0;
  for (let i = 0; i < hz; i++) {
    t += 1 / hz;
    moveEmber(p, t, 1 / hz, 1000);
  }
  return p;
};

describe('moveEmber', () => {
  it('rises as far in a second at 144 Hz and at 30 Hz as at 60 Hz', () => {
    const at60 = second(60);
    for (const hz of [30, 144]) {
      const p = second(hz);
      expect(p.y).toBeCloseTo(at60.y, 6);
      // The sideways sway is sampled at the frame times: within a pixel.
      expect(Math.abs(p.x - at60.x)).toBeLessThan(1);
    }
  });

  it('keeps the old per-frame step at 60 fps', () => {
    const p = ember();
    moveEmber(p, 1, 1 / 60, 1000);
    expect(600 - p.y).toBeCloseTo((6.5 + 4.5 * 0.5) * 24 * 0.016, 9);
  });
});

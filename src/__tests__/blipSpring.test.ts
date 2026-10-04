import { describe, expect, it } from 'vitest';
import { Spring } from '../guide/spring';

describe("Blip's springs", () => {
  it('settle on the target, overshooting when under-damped', () => {
    const spring = new Spring(2, 0.4, 1);
    let peak = 0;
    let value = 0;
    for (let i = 0; i < 300; i++) {
      value = spring.update(1 / 30, 1);
      peak = Math.max(peak, value);
    }
    expect(peak).toBeGreaterThan(1.05);
    expect(value).toBeCloseTo(1, 3);
  });

  it('stay stable through dropped frames', () => {
    const spring = new Spring(9, 0.45, 1);
    let value = 0;
    // A 100 ms hitch at a stiff 9 Hz would explode naive Euler.
    for (let i = 0; i < 100; i++) value = spring.update(0.1, i % 2);
    expect(Number.isFinite(value)).toBe(true);
    expect(Math.abs(value)).toBeLessThan(3);
  });
});

import { describe, expect, it } from 'vitest';
import {
  beatDivisions,
  divisionSeconds,
  mapPercent,
} from '../soundDefinitions/controlMath';

describe('mapPercent (Map node)', () => {
  it('linear: 0 → Low, 100 → High, 50 halfway, clamped outside 0–100', () => {
    expect(mapPercent(0, 0.1, 0.85, 'linear')).toBeCloseTo(0.1);
    expect(mapPercent(100, 0.1, 0.85, 'linear')).toBeCloseTo(0.85);
    expect(mapPercent(50, 0, 2, 'linear')).toBeCloseTo(1);
    expect(mapPercent(-20, 0, 2, 'linear')).toBe(0);
    expect(mapPercent(180, 0, 2, 'linear')).toBe(2);
  });

  it('Low may exceed High (the knob turns the setting down)', () => {
    expect(mapPercent(25, 1, 0.5, 'linear')).toBeCloseTo(0.875);
  });

  it('exponential sweeps evenly by ratio: halfway is the geometric mean', () => {
    // 200…8000 Hz: 50 % is √(200·8000) = 1264.9 Hz, not 4100 Hz.
    expect(mapPercent(50, 200, 8000, 'exponential')).toBeCloseTo(1264.911, 2);
    // The Stutter rate knob at 70 %: 0.5 × 8^0.7 = 2.14355 per second.
    expect(mapPercent(70, 0.5, 4, 'exponential')).toBeCloseTo(2.14355, 4);
  });

  it('exponential falls back to linear when a bound is not above 0 (never NaN)', () => {
    expect(mapPercent(50, 0, 10, 'exponential')).toBeCloseTo(5);
    expect(mapPercent(50, -1, 1, 'exponential')).toBeCloseTo(0);
    expect(mapPercent(Number.NaN, 0, 1, 'linear')).toBe(0);
  });
});

describe('divisionSeconds (Beat Clock)', () => {
  it('a quarter note is one beat', () => {
    expect(divisionSeconds(120, '1/4')).toBeCloseTo(0.5);
    expect(divisionSeconds(60, '1/4')).toBeCloseTo(1);
  });

  it('eighths, sixteenths, whole notes', () => {
    expect(divisionSeconds(120, '1/8')).toBeCloseTo(0.25);
    expect(divisionSeconds(120, '1/16')).toBeCloseTo(0.125);
    expect(divisionSeconds(120, '1/1')).toBeCloseTo(2);
  });

  it('triplets are 2/3 as long, dotted notes 1.5 times', () => {
    expect(divisionSeconds(120, '1/8T')).toBeCloseTo(0.25 * (2 / 3));
    expect(divisionSeconds(120, '1/8.')).toBeCloseTo(0.375);
  });

  it('bad input falls back to an 8th note at 120 BPM', () => {
    expect(divisionSeconds(Number.NaN, '1/4')).toBeCloseTo(0.5);
    expect(divisionSeconds(0, '1/4')).toBeCloseTo(0.5);
    expect(divisionSeconds(120, 'nonsense')).toBeCloseTo(0.25);
  });

  it('every offered division parses', () => {
    for (const division of beatDivisions) {
      expect(/^1\/(\d+)([T.]?)$/.test(division), division).toBe(true);
      expect(divisionSeconds(120, division)).toBeGreaterThan(0);
    }
  });
});

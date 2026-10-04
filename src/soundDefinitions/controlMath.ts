/**
 * The pure math behind the Map and Beat Clock control nodes (Tone-free, so
 * the unit tests pin it directly). Used by `implementations.ts` for both the
 * build-time values and the live wave-shaper curve.
 */

/** Map node curves. `exponential` sweeps evenly by ear (frequencies, times). */
const mapCurves = ['linear', 'exponential'] as const;
type MapCurve = (typeof mapCurves)[number];

/**
 * 0–100 % → Low…High. `exponential` needs Low and High both above zero (a
 * ratio); otherwise it falls back to `linear`, so the node never emits NaN.
 * Low may be greater than High (the knob then turns the setting down).
 */
function mapPercent(
  percent: number,
  low: number,
  high: number,
  curve: string,
): number {
  const t = Math.min(1, Math.max(0, (Number.isFinite(percent) ? percent : 0) / 100));
  if (curve === 'exponential' && low > 0 && high > 0) {
    return low * Math.pow(high / low, t);
  }
  return low + (high - low) * t;
}

/**
 * Note lengths for the Beat Clock. A quarter note is one beat; `T` is a
 * triplet (2/3 as long), `.` is dotted (1.5 times as long).
 */
const beatDivisions = [
  '1/1',
  '1/2',
  '1/4',
  '1/4.',
  '1/4T',
  '1/8',
  '1/8.',
  '1/8T',
  '1/16',
  '1/16T',
  '1/32',
] as const;
type BeatDivision = (typeof beatDivisions)[number];

/** Seconds per note of `division` at `bpm` (quarter note = one beat).
 *  An unknown division reads as '1/8'; a bad tempo as 120 BPM. */
function divisionSeconds(bpm: number, division: string): number {
  const tempo = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  const match = /^1\/(\d+)([T.]?)$/.exec(division);
  const denominator = match ? Number(match[1]) : 8;
  const modifier = match?.[2] === 'T' ? 2 / 3 : match?.[2] === '.' ? 1.5 : 1;
  return (60 / tempo) * (4 / denominator) * modifier;
}

export { beatDivisions, divisionSeconds, mapCurves, mapPercent };
export type { BeatDivision, MapCurve };

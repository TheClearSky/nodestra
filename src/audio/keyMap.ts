/**
 * The physical key map — SINGLE SOURCE OF TRUTH.
 * Dependency-free so both the keyboard bus (runtime) and nodeTypes
 * (the All Keys node's generated outputs) share it verbatim.
 *
 * `awsedftgyhujkolp;` = 17 chromatic keys from C4 to E5; the letters
 * are chosen around host shortcuts (`x` deletes, Ctrl+Z is undo). `;`
 * closes the second row the way a QWERTY piano does: without it `p` (D♯5)
 * was a black key with no white key after it.
 * Semitone 0 = C4; `,`/`.` shift the octave window at runtime.
 */

const KEY_ORDER = [
  'a',
  'w',
  's',
  'e',
  'd',
  'f',
  't',
  'g',
  'y',
  'h',
  'u',
  'j',
  'k',
  'o',
  'l',
  'p',
  ';',
] as const;

type KeyName = (typeof KEY_ORDER)[number];

const KEY_TO_SEMITONE: Readonly<Record<KeyName, number>> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
  ';': 16,
};

const PITCH_CLASS_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

/** Handle-name stem, e.g. `A (C)` — the physical key keeps it unique
 *  (the 17-key map wraps past the octave: two keys per pitch class for
 *  C/C#/D/D#/E), the pitch class is invariant under octave shift. */
function keyLabel(key: KeyName): string {
  const pitchClass = PITCH_CLASS_NAMES[KEY_TO_SEMITONE[key] % 12];
  return `${key.toUpperCase()} (${pitchClass})`;
}

export { KEY_ORDER, KEY_TO_SEMITONE, keyLabel, PITCH_CLASS_NAMES };
export type { KeyName };

/**
 * The keyboard bus: `awsedftgyhujkolp;` = chromatic from C4, `,`/`.`
 * shift octaves (REMAPPED from z/x — `x` is one of the host's delete
 * keys and Ctrl+Z is host undo; letters near the note rows were
 * shortcut landmines). keydown → retune + gate attack; last-key-up →
 * release.
 *
 * Rules: `e.repeat` filtered; modifier chords ignored (Ctrl+A must not
 * play a note); typing targets AND select/listbox widgets never stolen;
 * window blur releases the gate; uninstall releases the gate too.
 */

import { gateOff, gateOn } from '../soundDefinitions/audioSystem';
import { rampPitch } from './bootstrap';
import { KEY_TO_SEMITONE } from './keyMap';
import type { KeyName } from './keyMap';

const C4_HZ = 261.6255653005986;

let octaveShift = 0;
let lastSemitone: number | undefined;
const heldKeys = new Set<KeyName>();

// ── Per-key publisher (feeds the All Keys node) ──
// The legacy mono pitch/gate path below is untouched; these events are
// an additional broadcast. 'octave' fires AFTER octaveShift updates so
// subscribers can re-read pitches for keys they consider held.
type KeyBusEvent =
  | { type: 'down'; key: KeyName }
  | { type: 'up'; key: KeyName }
  | { type: 'octave' };

const keyListeners = new Set<(event: KeyBusEvent) => void>();

function emitKeyEvent(event: KeyBusEvent): void {
  for (const listener of keyListeners) listener(event);
}

/** Subscribe to per-key events; returns the unsubscriber. */
function onKeyBusEvent(listener: (event: KeyBusEvent) => void): () => void {
  keyListeners.add(listener);
  return () => keyListeners.delete(listener);
}

function asKeyName(key: string): KeyName | undefined {
  return Object.prototype.hasOwnProperty.call(KEY_TO_SEMITONE, key)
    ? (key as KeyName)
    : undefined;
}

/** A key's pitch at the CURRENT octave window. */
function keyHzAtCurrentOctave(key: KeyName): number {
  return semitoneToHz(KEY_TO_SEMITONE[key]);
}

function isKeyHeld(key: KeyName): boolean {
  return heldKeys.has(key);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  ) {
    return true;
  }
  // Host enum dropdowns are Radix-style widgets (button trigger + listbox)
  // with typeahead — choosing "sine" by typing must not play notes.
  return (
    target.closest(
      '[role="listbox"], [role="option"], [role="combobox"], [role="menu"]',
    ) !== null
  );
}

function semitoneToHz(semitone: number): number {
  return C4_HZ * 2 ** ((semitone + 12 * octaveShift) / 12);
}

const OCTAVE_MIN = -3;
const OCTAVE_MAX = 3;

function shiftOctave(delta: number): void {
  const next = Math.min(OCTAVE_MAX, Math.max(OCTAVE_MIN, octaveShift + delta));
  if (next === octaveShift) return;
  octaveShift = next;
  // Retune the held note live.
  if (heldKeys.size > 0 && lastSemitone !== undefined) {
    rampPitch(semitoneToHz(lastSemitone));
  }
  emitKeyEvent({ type: 'octave' });
}

/** The current window, in octaves from the C4 home position. */
function getOctaveShift(): number {
  return octaveShift;
}

/**
 * The name of the octave the bottom key (C) currently plays — `C4` at home.
 * Scientific pitch notation, so it reads the way a musician expects.
 */
function octaveLabel(): string {
  return `C${4 + octaveShift}`;
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.repeat) return;
  // Modifier chords are editor/browser shortcuts, never notes.
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.defaultPrevented) return;
  if (isTypingTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === ',') {
    shiftOctave(-1);
    return;
  }
  if (key === '.') {
    shiftOctave(1);
    return;
  }
  const keyName = asKeyName(key);
  if (keyName === undefined) return;
  pressKey(keyName);
}

function handleKeyUp(event: KeyboardEvent): void {
  const keyName = asKeyName(event.key.toLowerCase());
  if (keyName === undefined) return;
  releaseKey(keyName);
}

/**
 * Plays a key as if it were pressed on the computer keyboard — the same
 * retune, gate and per-key event. Used by the QWERTY handler and by
 * on-screen keys (click / tap). Pressing a key already held does nothing.
 */
function pressKey(keyName: KeyName): void {
  if (heldKeys.has(keyName)) return;
  heldKeys.add(keyName);
  lastSemitone = KEY_TO_SEMITONE[keyName];
  rampPitch(semitoneToHz(lastSemitone));
  gateOn();
  emitKeyEvent({ type: 'down', key: keyName });
}

/** Lets a key go (see `pressKey`). Releasing a key not held does nothing. */
function releaseKey(keyName: KeyName): void {
  if (!heldKeys.delete(keyName)) return;
  if (heldKeys.size === 0) gateOff();
  emitKeyEvent({ type: 'up', key: keyName });
}

function releaseEverything(): void {
  // Per-key gates release BEFORE the mono gate — and this same path
  // runs on UNINSTALL too: a bus teardown must never leave an All Keys
  // gate stuck high, or the voice drones the moment the context
  // resumes.
  const wasHeld = [...heldKeys];
  heldKeys.clear();
  for (const key of wasHeld) emitKeyEvent({ type: 'up', key });
  gateOff();
}

function handleBlur(): void {
  releaseEverything();
}

/** Install once audio is ready; returns the uninstaller. */
function installKeyboardBus(): () => void {
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', handleBlur);
  return () => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('blur', handleBlur);
    releaseEverything(); // nothing stays attacked or gated
  };
}

export {
  getOctaveShift,
  installKeyboardBus,
  isKeyHeld,
  keyHzAtCurrentOctave,
  OCTAVE_MAX,
  OCTAVE_MIN,
  octaveLabel,
  onKeyBusEvent,
  pressKey,
  releaseKey,
  // Exported for the project-replace transaction: a key held down across a
  // project swap would otherwise release into a build that never attacked it.
  releaseEverything,
  shiftOctave,
};
export type { KeyBusEvent };

import * as Tone from 'tone';
import { startAudio } from '../audio/bootstrap';
import { STORAGE_NAMESPACE } from '../storageNamespace';

/**
 * Blip's voice: soft pentatonic chirps while it talks (Animal Crossing
 * style). ON by default (Q13 re-ruled 2026-09-27); a mute is remembered.
 *
 * Wired straight to the speakers, not the master bus — the recorder taps
 * the master, and a guide's chatter must never end up in a recording.
 */

const MUTED_KEY = `${STORAGE_NAMESPACE}.blip.muted`;
const NOTES = ['C6', 'D6', 'E6', 'G6', 'A6', 'C7'];
const MIN_GAP_MS = 70;

let synth: Tone.Synth | null = null;
let lastChirp = 0;

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === 'true';
  } catch {
    return false;
  }
}

let muted = readMuted();

function isBlipMuted(): boolean {
  return muted;
}

/** Called from a click, so unmuting can also start the audio context. */
async function setBlipMuted(next: boolean): Promise<void> {
  muted = next;
  try {
    localStorage.setItem(MUTED_KEY, String(next));
  } catch {
    // Private mode: the choice lasts this session only.
  }
  if (!next) await startAudio();
}

function chirp(): void {
  if (muted || Tone.getContext().state !== 'running') return;
  const now = performance.now();
  if (now - lastChirp < MIN_GAP_MS) return;
  lastChirp = now;
  if (!synth) {
    synth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.004, decay: 0.05, sustain: 0, release: 0.03 },
      volume: -22,
    }).toDestination();
  }
  synth.triggerAttackRelease(NOTES[Math.floor(Math.random() * NOTES.length)], 0.05);
}

export { chirp, isBlipMuted, setBlipMuted };

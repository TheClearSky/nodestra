/**
 * envelopeCore — the gate-mode envelope state machine.
 *
 * PURE and dependency-free by contract: this exact module is consumed by
 * both the AudioWorklet wrapper (bundled into public/*.worklet.js) and
 * the vitest oracles, so they can never drift apart. No imports, no
 * Tone, no DOM.
 *
 * Pinned semantics:
 * - Level modes: `high` = classic gate ADSR (attack on gate ↑, decay to
 *   sustain, hold while high, release on ↓); `low` = the same machine on
 *   the inverted gate.
 * - One-shot modes (`rising` / `falling` / `any`): on the named edge run
 *   Attack → Decay to the SUSTAIN LEVEL → immediately Release to 0 — no
 *   hold; gate level is otherwise ignored.
 * - Retrigger (any mode, any phase): restart the attack FROM THE CURRENT
 *   LEVEL (no click); the attack still takes its full attackSec to reach
 *   peak.
 * - No edge fires at initialization: the machine idles until it observes
 *   a real transition (a `low`-mode envelope does not sound at boot just
 *   because the gate starts low).
 *
 * Curve shapes (a definition of its own, not a Tone emulation): attack
 * is LINEAR current→1; decay and release are EXPONENTIAL closed forms
 * that traverse 99% of the distance at the nominal duration
 * (exp(-EXP_SETTLE·t/dur), EXP_SETTLE = ln(100)) and SNAP to the target
 * there — time-based, so retriggers and oracles are exact.
 */

type EnvelopeMode = 'high' | 'low' | 'rising' | 'falling' | 'any';

type EnvelopeParams = {
  attackSec: number;
  decaySec: number;
  /** 0..1 — also the one-shot decay target (the knee before release). */
  sustain: number;
  releaseSec: number;
  mode: EnvelopeMode;
};

type EnvelopePhase = 'idle' | 'attack' | 'decay' | 'sustain' | 'release';

type EnvelopeState = {
  phase: EnvelopePhase;
  /** Current output level 0..1 (the value the voice is multiplied by). */
  level: number;
  /** Raw gate of the PREVIOUS sample (edge detection); null = pre-init. */
  lastGate: boolean | null;
  /** Level the current attack started from. */
  attackFrom: number;
  /** Level the current decay started from. */
  decayFrom: number;
  /** Level the current release started from. */
  releaseFrom: number;
  /** Seconds elapsed inside the current phase. */
  elapsed: number;
};

/** exp(-EXP_SETTLE) ≈ 0.01 → 99% traversed at the nominal duration. */
const EXP_SETTLE = Math.log(100);

function createEnvelopeState(): EnvelopeState {
  return {
    phase: 'idle',
    level: 0,
    lastGate: null,
    attackFrom: 0,
    decayFrom: 0,
    releaseFrom: 0,
    elapsed: 0,
  };
}

function isOneShotMode(mode: EnvelopeMode): boolean {
  return mode === 'rising' || mode === 'falling' || mode === 'any';
}

function enterAttack(state: EnvelopeState): void {
  state.attackFrom = state.level;
  state.elapsed = 0;
  state.phase = 'attack';
}

function enterDecay(state: EnvelopeState): void {
  state.decayFrom = state.level;
  state.elapsed = 0;
  state.phase = 'decay';
}

function enterRelease(state: EnvelopeState): void {
  state.releaseFrom = state.level;
  state.elapsed = 0;
  state.phase = 'release';
}

/**
 * Advance one sample. `gate` is the raw boolean gate for this sample;
 * `dt` is 1/sampleRate. Mutates `state`, returns the output level.
 */
function processEnvelopeSample(
  state: EnvelopeState,
  params: EnvelopeParams,
  gate: boolean,
  dt: number,
): number {
  const { mode } = params;
  const oneShot = isOneShotMode(mode);

  // ── Edge / level handling ──
  if (state.lastGate === null) {
    // First observed sample: record, never fire an edge (pinned rule).
    state.lastGate = gate;
  } else if (gate !== state.lastGate) {
    const rose = gate;
    state.lastGate = gate;
    if (oneShot) {
      const fires =
        mode === 'any' || (mode === 'rising' ? rose : !rose);
      if (fires) enterAttack(state);
    } else {
      // Level modes: `low` inverts the gate's meaning.
      const effectiveRose = mode === 'low' ? !rose : rose;
      if (effectiveRose) enterAttack(state);
      else if (state.phase !== 'idle') enterRelease(state);
    }
  }

  // ── Phase progression ──
  switch (state.phase) {
    case 'idle':
      state.level = 0;
      break;
    case 'attack': {
      state.elapsed += dt;
      if (params.attackSec <= 0 || state.elapsed >= params.attackSec) {
        state.level = 1;
        enterDecay(state);
      } else {
        state.level =
          state.attackFrom +
          (1 - state.attackFrom) * (state.elapsed / params.attackSec);
      }
      break;
    }
    case 'decay': {
      state.elapsed += dt;
      const target = params.sustain;
      if (params.decaySec <= 0 || state.elapsed >= params.decaySec) {
        state.level = target;
        if (oneShot) enterRelease(state);
        else state.phase = 'sustain';
      } else {
        state.level =
          target +
          (state.decayFrom - target) *
            Math.exp((-EXP_SETTLE * state.elapsed) / params.decaySec);
      }
      break;
    }
    case 'sustain':
      state.level = params.sustain;
      break;
    case 'release': {
      state.elapsed += dt;
      if (params.releaseSec <= 0 || state.elapsed >= params.releaseSec) {
        state.level = 0;
        state.phase = 'idle';
      } else {
        state.level =
          state.releaseFrom *
          Math.exp((-EXP_SETTLE * state.elapsed) / params.releaseSec);
      }
      break;
    }
  }
  return state.level;
}

/**
 * Block form for the worklet: reads `gate` (values ≥ 0.5 are true),
 * writes levels into `out`. Arrays may be the same length-128 quantum.
 */
function processEnvelopeBlock(
  state: EnvelopeState,
  params: EnvelopeParams,
  gate: ArrayLike<number>,
  out: Float32Array,
  sampleRate: number,
): void {
  const dt = 1 / sampleRate;
  for (let i = 0; i < out.length; i += 1) {
    out[i] = processEnvelopeSample(state, params, gate[i] >= 0.5, dt);
  }
}

export {
  createEnvelopeState,
  EXP_SETTLE,
  isOneShotMode,
  processEnvelopeBlock,
  processEnvelopeSample,
};
export type { EnvelopeMode, EnvelopeParams, EnvelopePhase, EnvelopeState };

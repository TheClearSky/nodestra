/**
 * Should auto-run arm a timer right now, and for how long?
 *
 * Extracted as a pure function because the interesting part is the PREDICATE,
 * and testing it through a React effect and two timers proves nothing.
 */

type RunFreshness = 'none' | 'stale' | 'fresh';

type AutoRunInput = {
  /** No run may start before the AudioContext exists: measured, every node
   *  that needs the context throws, and the failed run still stamps a
   *  signature — so the graph reads "up to date" and never runs again. */
  audioReady: boolean;
  enabled: boolean;
  freshness: RunFreshness;
  /** A run is executing right now. Arming during one is pointless: the run
   *  would be refused (the host would treat a second `run()` as a resume) and
   *  NOTHING would re-arm, because no dependency of the effect changes when a
   *  refused call returns. The edit silently never ran. Waiting for the
   *  in-flight run to end and re-arming then is the whole fix. */
  runInFlight: boolean;
  delaySeconds: number;
};

type AutoRunDecision = { kind: 'idle' } | { kind: 'arm'; delayMs: number };

/** The floor stops a 0 s setting turning every keystroke into a run. */
const MINIMUM_DELAY_MS = 500;

function decideAutoRun(input: AutoRunInput): AutoRunDecision {
  if (!input.audioReady) return { kind: 'idle' };
  if (!input.enabled) return { kind: 'idle' };
  // Arm for BOTH 'stale' and 'none': "nothing has run yet" is exactly the case
  // where the user most wants the sound, and requiring a previous run first
  // meant switching auto-run on did nothing at all (measured).
  if (input.freshness === 'fresh') return { kind: 'idle' };
  if (input.runInFlight) return { kind: 'idle' };
  return {
    kind: 'arm',
    delayMs: Math.max(MINIMUM_DELAY_MS, input.delaySeconds * 1000),
  };
}

export { decideAutoRun, MINIMUM_DELAY_MS };
export type { AutoRunDecision, AutoRunInput, RunFreshness };

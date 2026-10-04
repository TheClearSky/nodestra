import { describe, expect, it } from 'vitest';
import { decideAutoRun, MINIMUM_DELAY_MS } from '../project/decideAutoRun';
import type { AutoRunInput } from '../project/decideAutoRun';

const ready: AutoRunInput = {
  audioReady: true,
  enabled: true,
  freshness: 'stale',
  runInFlight: false,
  delaySeconds: 1,
};

describe('decideAutoRun', () => {
  it('arms one second after a change, the shipped default', () => {
    expect(decideAutoRun(ready)).toEqual({ kind: 'arm', delayMs: 1000 });
  });

  it('arms when NOTHING has run yet, not only when a run went stale', () => {
    // Switching auto-run on used to do nothing at all in this state.
    expect(decideAutoRun({ ...ready, freshness: 'none' })).toEqual({
      kind: 'arm',
      delayMs: 1000,
    });
  });

  it('never arms before audio exists', () => {
    // Measured: the timer fired behind the "Click to start audio" overlay and
    // every node needing the context threw — then the failed run stamped a
    // signature, so the graph read "up to date" and never ran again.
    expect(decideAutoRun({ ...ready, audioReady: false })).toEqual({
      kind: 'idle',
    });
  });

  it('never arms when the graph is already up to date', () => {
    expect(decideAutoRun({ ...ready, freshness: 'fresh' })).toEqual({
      kind: 'idle',
    });
  });

  it('never arms while auto-run is switched off', () => {
    expect(decideAutoRun({ ...ready, enabled: false })).toEqual({
      kind: 'idle',
    });
  });

  it('waits while a run is IN FLIGHT instead of firing into it', () => {
    // The bug this exists for: the timer fired mid-run, `runGraphNow` refused
    // (a second `run()` would be treated as a resume), and nothing re-armed,
    // so the edit that triggered it never ran.
    expect(decideAutoRun({ ...ready, runInFlight: true })).toEqual({
      kind: 'idle',
    });
  });

  it('arms again as soon as the in-flight run ends and the graph is still stale', () => {
    const during = decideAutoRun({ ...ready, runInFlight: true });
    const after = decideAutoRun({ ...ready, runInFlight: false });
    expect(during.kind).toBe('idle');
    expect(after).toEqual({ kind: 'arm', delayMs: 1000 });
  });

  it('floors the delay so a 0 s setting cannot run on every keystroke', () => {
    expect(decideAutoRun({ ...ready, delaySeconds: 0 })).toEqual({
      kind: 'arm',
      delayMs: MINIMUM_DELAY_MS,
    });
  });

  it('honours a longer delay verbatim', () => {
    expect(decideAutoRun({ ...ready, delaySeconds: 5 })).toEqual({
      kind: 'arm',
      delayMs: 5000,
    });
  });

  it('is decided by the STRONGEST reason not to run', () => {
    // Every blocking input on its own is enough; combinations stay idle.
    expect(
      decideAutoRun({
        ...ready,
        audioReady: false,
        enabled: false,
        freshness: 'fresh',
        runInFlight: true,
      }),
    ).toEqual({ kind: 'idle' });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertNotSuperseded,
  beginBuild,
  BuildKilledError,
  BuildSupersededError,
  disposeBuild,
  ensureBuild,
  gateOff,
  gateOn,
  gateTargetCount,
  getCurrentBuildId,
  isCurrentBuild,
  registerDisposable,
  registerGateTarget,
  registrySize,
  resetForTests,
} from '@/soundDefinitions/audioSystem';

beforeEach(() => {
  resetForTests();
});

function makeFakeNode(label: string, order: string[]) {
  return {
    dispose: vi.fn(() => {
      order.push(label);
    }),
  };
}

describe('build lifecycle', () => {
  it('buildId starts at 0 and increments per beginBuild', () => {
    expect(getCurrentBuildId()).toBe(0);
    expect(beginBuild()).toBe(1);
    expect(beginBuild()).toBe(2);
    expect(getCurrentBuildId()).toBe(2);
  });

  it('beginBuild disposes the previous registry in REVERSE order', () => {
    const order: string[] = [];
    beginBuild();
    registerDisposable(makeFakeNode('osc', order));
    registerDisposable(makeFakeNode('gain', order));
    registerDisposable(makeFakeNode('filter', order));
    beginBuild();
    expect(order).toEqual(['filter', 'gain', 'osc']);
    expect(registrySize()).toBe(0);
  });

  it('disposeBuild is idempotent — nodes dispose exactly once', () => {
    beginBuild();
    const order: string[] = [];
    const node = makeFakeNode('osc', order);
    registerDisposable(node);
    disposeBuild();
    disposeBuild();
    expect(node.dispose).toHaveBeenCalledTimes(1);
  });

  it('a throwing dispose does not abort the rest of the walk', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const order: string[] = [];
    beginBuild();
    registerDisposable(makeFakeNode('first', order));
    registerDisposable({
      dispose: () => {
        throw new Error('boom');
      },
    });
    registerDisposable(makeFakeNode('last', order));
    disposeBuild();
    expect(order).toEqual(['last', 'first']);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('re-entering the lifecycle from a dispose callback throws', () => {
    beginBuild();
    registerDisposable({
      dispose: () => {
        beginBuild();
      },
    });
    expect(() => disposeBuild()).toThrow(/re-entered/);
  });
});

describe('run envelope — ensureBuild keyed on token identity', () => {
  it('same token joins the same build; a new token begins a new one', () => {
    const tokenA = new AbortController().signal;
    const tokenB = new AbortController().signal;
    expect(ensureBuild(tokenA)).toBe(1);
    expect(ensureBuild(tokenA)).toBe(1);
    expect(ensureBuild(tokenA)).toBe(1);
    expect(ensureBuild(tokenB)).toBe(2);
  });

  it('pin: two sequential run tokens ⇒ exactly two builds, first disposed', () => {
    const order: string[] = [];
    ensureBuild('run-1');
    registerDisposable(makeFakeNode('run1-node', order));
    ensureBuild('run-1');
    expect(order).toEqual([]); // same run — nothing disposed
    ensureBuild('run-2');
    expect(order).toEqual(['run1-node']);
    expect(getCurrentBuildId()).toBe(2);
  });

  it('async impl resuming after supersession gets BuildSupersededError', () => {
    const myBuild = ensureBuild('run-1');
    expect(() => assertNotSuperseded(myBuild)).not.toThrow();
    ensureBuild('run-2'); // user re-ran while the impl was awaiting
    expect(() => assertNotSuperseded(myBuild)).toThrow(BuildSupersededError);
    expect(isCurrentBuild(myBuild)).toBe(false);
  });

  it('a superseded async impl registers NOTHING into the new build', () => {
    const oldBuild = ensureBuild('run-1');
    ensureBuild('run-2'); // supersede while "awaiting"
    // The mandated impl pattern: assert BEFORE touching the graph — the
    // throw prevents any registration from landing in the new build.
    expect(() => {
      assertNotSuperseded(oldBuild);
      registerDisposable({ dispose: () => {} }); // must be unreachable
    }).toThrow(BuildSupersededError);
    expect(registrySize()).toBe(0);
  });
});

describe('disposeBuild invalidates the epoch', () => {
  it('Stop/Esc-style dispose makes every outstanding chain stale', () => {
    const build = beginBuild();
    expect(isCurrentBuild(build)).toBe(true);
    disposeBuild();
    expect(isCurrentBuild(build)).toBe(false); // previews flatline
    expect(() => assertNotSuperseded(build)).toThrow(BuildSupersededError);
  });

  // REWRITTEN 2026-09-19. This test used to assert the OPPOSITE — that a later
  // implementation of a disposed run gets `beginBuild()` and a fresh epoch —
  // and framed it as the desired behaviour ("fresh build, not the corpse").
  // It is not: not re-joining the corpse is necessary but not sufficient,
  // because the run then finished the ABANDONED graph into the new epoch and
  // that became the current, audible build. Esc and the header Stop silenced
  // the graph for one moment and it came back; a project replace kept the
  // previous project playing underneath the new one. Tearing a build down now
  // means the run that owned it cannot build at all.
  it('a continued host run can neither re-join NOR rebuild a disposed build', () => {
    const token = new AbortController().signal;
    const first = ensureBuild(token);
    disposeBuild(); // Esc mid-run
    expect(() => ensureBuild(token)).toThrow(BuildKilledError);
    expect(isCurrentBuild(first)).toBe(false);
    expect(registrySize()).toBe(0); // nothing was resurrected
  });

  it('a genuinely NEW run is unaffected by the poison', () => {
    const killed = new AbortController().signal;
    ensureBuild(killed);
    disposeBuild();
    const fresh = new AbortController().signal;
    expect(() => ensureBuild(fresh)).not.toThrow();
    // …and the killed run stays killed even after the new one started.
    expect(() => ensureBuild(killed)).toThrow(BuildKilledError);
  });

  it('a SECOND dispose does not erase the poison (the project-replace path disposes twice)', () => {
    const token = new AbortController().signal;
    ensureBuild(token);
    disposeBuild(); // from the runner's abort event
    disposeBuild(); // the unconditional floor in the replace transaction
    expect(() => ensureBuild(token)).toThrow(BuildKilledError);
  });

  it('registering during teardown disposes immediately instead of leaking', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    beginBuild();
    const lateNode = { dispose: vi.fn() };
    registerDisposable({
      dispose: () => {
        registerDisposable(lateNode);
      },
    });
    disposeBuild();
    expect(lateNode.dispose).toHaveBeenCalledTimes(1);
    expect(registrySize()).toBe(0);
    warn.mockRestore();
  });

  it('one throwing gate target does not block the rest of the fan-out', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    beginBuild();
    const healthy = { triggerAttack: vi.fn(), triggerRelease: vi.fn() };
    registerGateTarget({
      triggerAttack: () => {
        throw new Error('zombie envelope');
      },
      triggerRelease: () => {},
    });
    registerGateTarget(healthy);
    gateOn();
    expect(healthy.triggerAttack).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('gate bus', () => {
  it('fans attack/release out to every registered target', () => {
    beginBuild();
    const adsr1 = { triggerAttack: vi.fn(), triggerRelease: vi.fn() };
    const adsr2 = { triggerAttack: vi.fn(), triggerRelease: vi.fn() };
    registerGateTarget(adsr1);
    registerGateTarget(adsr2);
    gateOn();
    gateOff();
    expect(adsr1.triggerAttack).toHaveBeenCalledTimes(1);
    expect(adsr2.triggerAttack).toHaveBeenCalledTimes(1);
    expect(adsr1.triggerRelease).toHaveBeenCalledTimes(1);
    expect(adsr2.triggerRelease).toHaveBeenCalledTimes(1);
  });

  it('gate targets are per-build: cleared on the next beginBuild', () => {
    beginBuild();
    const adsr = { triggerAttack: vi.fn(), triggerRelease: vi.fn() };
    registerGateTarget(adsr);
    expect(gateTargetCount()).toBe(1);
    beginBuild();
    expect(gateTargetCount()).toBe(0);
    gateOn();
    expect(adsr.triggerAttack).not.toHaveBeenCalled();
  });
});

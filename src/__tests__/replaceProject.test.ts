import { describe, expect, it, vi } from 'vitest';
import { replaceProject } from '../project/replaceProject';
import type { ReplaceProjectDependencies } from '../project/replaceProject';
import { createEmptyTimelineDocument } from '@theclearsky/react-blender-nodes-timeline';

/**
 * The ORDER is the contract — see the module comment. These assert it against
 * a call log, because the thing a human gets wrong when adding the fifth
 * replace site is the order, not the list of things to call.
 */
function makeDependencies(options?: { withRunner?: boolean }) {
  const log: string[] = [];
  const runner = {
    run: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn((arg?: { initiator?: string }) => {
      log.push(`reset:${arg?.initiator ?? 'user'}`);
    }),
    getRunnerState: () => 'idle' as const,
  };
  const dependencies: ReplaceProjectDependencies<{ id: string }, string> = {
    dispatch: (action) => log.push(`dispatch:${action}`),
    makeReplaceStateAction: (state) => `REPLACE_STATE(${state.id})`,
    runner: options?.withRunner === false ? null : runner,
    disposeBuild: () => log.push('disposeBuild'),
    stopTransport: () => log.push('stopTransport'),
    releaseHeldKeys: () => log.push('releaseHeldKeys'),
    applyTimelineDocument: () => log.push('applyTimelineDocument'),
    suppressPersistence: () => log.push('suppressPersistence'),
    forgetRunBookkeeping: () => log.push('forgetRunBookkeeping'),
  };
  return { log, runner, dependencies };
}

const project = (persist: boolean) => ({
  state: { id: 'padSolo' },
  timelineDocument: createEmptyTimelineDocument(),
  persist,
});

describe('replaceProject', () => {
  it('runs every step, in the order the contract fixes', () => {
    const { log, dependencies } = makeDependencies();
    replaceProject(project(true), dependencies);
    expect(log).toEqual([
      'reset:consumer',
      'disposeBuild',
      'stopTransport',
      'releaseHeldKeys',
      'dispatch:REPLACE_STATE(padSolo)',
      'applyTimelineDocument',
      'forgetRunBookkeeping',
    ]);
  });

  it('silences the old build BEFORE installing the new graph or score', () => {
    const { log, dependencies } = makeDependencies();
    replaceProject(project(true), dependencies);
    expect(log.indexOf('disposeBuild')).toBeLessThan(
      log.indexOf('dispatch:REPLACE_STATE(padSolo)'),
    );
    expect(log.indexOf('disposeBuild')).toBeLessThan(
      log.indexOf('applyTimelineDocument'),
    );
  });

  it('installs the graph BEFORE the score — a refused graph must not leave the new score over the old one', () => {
    const { log, dependencies } = makeDependencies();
    replaceProject(project(true), dependencies);
    expect(log.indexOf('dispatch:REPLACE_STATE(padSolo)')).toBeLessThan(
      log.indexOf('applyTimelineDocument'),
    );
  });

  it('halts the run as the CONSUMER, never as the user', () => {
    // The app switches auto-run off on a user halt. A project load is not one,
    // and getting this wrong disables auto-run every time a demo is opened.
    const { runner, dependencies } = makeDependencies();
    replaceProject(project(true), dependencies);
    expect(runner.reset).toHaveBeenCalledWith({ initiator: 'consumer' });
    expect(runner.stop).not.toHaveBeenCalled(); // stop() lands in 'errored'
  });

  it('suppresses persistence FIRST for a probe graph, before anything can save', () => {
    const { log, dependencies } = makeDependencies();
    replaceProject(project(false), dependencies);
    expect(log[0]).toBe('suppressPersistence');
    // …and it still does the whole transaction.
    expect(log).toContain('disposeBuild');
    expect(log).toContain('applyTimelineDocument');
  });

  it('never suppresses persistence for a real project', () => {
    const { log, dependencies } = makeDependencies();
    replaceProject(project(true), dependencies);
    expect(log).not.toContain('suppressPersistence');
  });

  it('works with no runner mounted', () => {
    const { log, dependencies } = makeDependencies({ withRunner: false });
    expect(() => replaceProject(project(true), dependencies)).not.toThrow();
    // The build floor still runs — that is the whole point of it being
    // unconditional rather than living in the runner's abort handler.
    expect(log[0]).toBe('disposeBuild');
  });
});

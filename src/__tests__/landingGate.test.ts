import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attemptScene,
  isKeyName,
  isSceneReady,
  keyHeightFor,
  keyWidthFor,
  MEADOW_LOAD_TIMEOUT_MS,
} from '../landing/gateLogic';

// The start gate's plain logic (`src/landing/gateLogic.ts`): when a scene
// counts as up, one try at a meadow (load → create → prepare, with a load
// deadline), and the key sizes.

describe('isSceneReady', () => {
  const none = { webglFailed: false, meadowReady: null, meadowFailed: null };

  it('has the piano up at once, and a meadow once it has drawn or failed', () => {
    expect(isSceneReady({ ...none, scene: 'piano' })).toBe(true);
    expect(isSceneReady({ ...none, scene: 'guitar' })).toBe(false);
    expect(isSceneReady({ ...none, scene: 'guitar', meadowReady: 'guitar' })).toBe(true);
    expect(isSceneReady({ ...none, scene: 'guitar', meadowFailed: 'guitar' })).toBe(true);
    // Another meadow's result says nothing about this one.
    expect(isSceneReady({ ...none, scene: 'guitar', meadowReady: 'sakura', meadowFailed: 'sakura' })).toBe(false);
  });

  it('never holds a switch with no WebGL (it used to lock the gate on black)', () => {
    expect(isSceneReady({ ...none, scene: 'guitar', webglFailed: true })).toBe(true);
    expect(isSceneReady({ ...none, scene: 'sakura', webglFailed: true })).toBe(true);
  });
});

describe('attemptScene', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  type Scene = { name: string };
  /** A try whose steps are spies; `load` resolves or rejects by hand. */
  const setUp = (options: { create?: () => Scene; prepare?: (scene: Scene) => Promise<void> } = {}) => {
    let resolveLoad!: (value: string) => void;
    let rejectLoad!: (error: unknown) => void;
    const loaded = new Promise<string>((resolve, reject) => {
      resolveLoad = resolve;
      rejectLoad = reject;
    });
    const steps = {
      load: vi.fn(() => loaded),
      create: vi.fn((code: string) => options.create?.() ?? { name: code }),
      prepare: vi.fn((scene: Scene) => options.prepare?.(scene) ?? Promise.resolve()),
      release: vi.fn(),
      timeoutMs: MEADOW_LOAD_TIMEOUT_MS,
      onReady: vi.fn(),
      onFailed: vi.fn(),
    };
    const attempt = attemptScene(steps);
    return { steps, attempt, resolveLoad, rejectLoad };
  };

  it('makes, prepares and hands over the scene', async () => {
    const { steps, resolveLoad } = setUp();
    resolveLoad('meadow');
    await vi.runAllTimersAsync();
    expect(steps.create).toHaveBeenCalledWith('meadow');
    expect(steps.prepare).toHaveBeenCalledWith({ name: 'meadow' });
    expect(steps.onReady).toHaveBeenCalledWith({ name: 'meadow' });
    expect(steps.onFailed).not.toHaveBeenCalled();
    expect(steps.release).not.toHaveBeenCalled();
  });

  it('fails a load that never arrives within the deadline, and ignores it if it arrives later', async () => {
    const { steps, resolveLoad } = setUp();
    await vi.advanceTimersByTimeAsync(MEADOW_LOAD_TIMEOUT_MS - 1);
    expect(steps.onFailed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(steps.onFailed).toHaveBeenCalledTimes(1);
    resolveLoad('late');
    await vi.runAllTimersAsync();
    // A late chunk does not make a scene behind the failure line.
    expect(steps.create).not.toHaveBeenCalled();
    expect(steps.onReady).not.toHaveBeenCalled();
  });

  it('does not time out once the code is here (preparing waits on frames, which a hidden tab holds back)', async () => {
    let settle!: () => void;
    const { steps, resolveLoad } = setUp({ prepare: () => new Promise<void>((resolve) => (settle = resolve)) });
    resolveLoad('meadow');
    await vi.advanceTimersByTimeAsync(MEADOW_LOAD_TIMEOUT_MS * 3);
    expect(steps.onFailed).not.toHaveBeenCalled();
    settle();
    await vi.runAllTimersAsync();
    expect(steps.onReady).toHaveBeenCalledTimes(1);
  });

  it('reports a failed load', async () => {
    const { steps, rejectLoad } = setUp();
    const error = new Error('chunk 404');
    rejectLoad(error);
    await vi.runAllTimersAsync();
    expect(steps.onFailed).toHaveBeenCalledWith(error);
    expect(steps.release).not.toHaveBeenCalled();
  });

  it('releases a scene that throws while it is prepared (nothing half-made is kept)', async () => {
    const { steps, resolveLoad } = setUp({
      prepare: () => {
        throw new Error('context lost mid-compile');
      },
    });
    resolveLoad('meadow');
    await vi.runAllTimersAsync();
    expect(steps.release).toHaveBeenCalledWith({ name: 'meadow' });
    expect(steps.onFailed).toHaveBeenCalledTimes(1);
    expect(steps.onReady).not.toHaveBeenCalled();
  });

  it('reports a scene that throws while it is made', async () => {
    const { steps, resolveLoad } = setUp({
      create: () => {
        throw new Error('no WebGL');
      },
    });
    resolveLoad('meadow');
    await vi.runAllTimersAsync();
    expect(steps.onFailed).toHaveBeenCalledTimes(1);
    expect(steps.release).not.toHaveBeenCalled();
  });

  it('on cancel, makes nothing that arrives later and releases what it made', async () => {
    const early = setUp();
    early.attempt.cancel();
    early.resolveLoad('meadow');
    await vi.runAllTimersAsync();
    expect(early.steps.create).not.toHaveBeenCalled();
    expect(early.steps.onFailed).not.toHaveBeenCalled();

    const ready = setUp();
    ready.resolveLoad('meadow');
    await vi.runAllTimersAsync();
    expect(ready.steps.onReady).toHaveBeenCalledTimes(1);
    ready.attempt.cancel();
    expect(ready.steps.release).toHaveBeenCalledWith({ name: 'meadow' });
    ready.attempt.cancel();
    expect(ready.steps.release).toHaveBeenCalledTimes(1);
  });
});

describe('the gate keys', () => {
  it('size a white key from the window, the pointer and the screen height', () => {
    expect(keyWidthFor(1440, false)).toBe(34);
    expect(keyWidthFor(1440, true)).toBe(44);
    expect(keyWidthFor(390, true)).toBe(35);
    expect(keyWidthFor(200, true)).toBe(24);
    expect(keyHeightFor(34, false)).toBe(92);
    expect(keyHeightFor(44, false)).toBe(119);
    expect(keyHeightFor(34, true)).toBe(64);
  });

  it('accept only real key names from the DOM', () => {
    expect(isKeyName('a')).toBe(true);
    expect(isKeyName(';')).toBe(true);
    expect(isKeyName('Z')).toBe(false);
    expect(isKeyName('__proto__')).toBe(false);
    expect(isKeyName(undefined)).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { APP_SCENE_IDS } from '../showcase/appScenes';

/*
 * The landing tour (`public/landing/ad/tour.html`) is hand-written JS outside
 * the TypeScript build: nothing type-checks the strings and calls it shares
 * with the app. This pins that contract — its live scene ids are real app
 * scenes, every `liveStage.<method>` it calls exists on the stage (and on its
 * no-WebGL stand-in) — and boots the script against a stub DOM to check its
 * liveness: a screen that fails or hangs never freezes the clock.
 */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const tourHtml = read('../../public/landing/ad/tour.html');
const tourScript = (() => {
  const scripts = [...tourHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  expect(scripts).toHaveLength(1);
  return scripts[0][1];
})();

/** The scene ids the tour's panels show (`seg({ live: '…' }, …)`). */
const panelScenes = [...tourScript.matchAll(/seg\(\{\s*live:\s*'([^']+)'/g)].map((m) => m[1]);
/** The keys of the tour's `LIVE_SCENES` table. */
const tableScenes = (() => {
  const body = /const LIVE_SCENES = \{([\s\S]*?)\n\};/.exec(tourScript)?.[1] ?? '';
  return [...body.matchAll(/(\w+):\s*\{/g)].map((m) => m[1]);
})();

describe('tour.html ↔ app contract', () => {
  it('shows only real app scenes', () => {
    expect(panelScenes.length).toBeGreaterThanOrEqual(10);
    for (const id of panelScenes) expect(APP_SCENE_IDS).toContain(id);
    for (const id of tableScenes) expect(APP_SCENE_IDS).toContain(id);
    expect([...new Set(panelScenes)].sort()).toEqual([...tableScenes].sort());
  });

  it('calls only stage methods that createStageScene returns (and its stand-in has)', () => {
    // `liveStage.x(…)` everywhere, and `s.x(…)` on the stage just created in `makeStage`.
    const makeStage = /function makeStage\(\) \{([\s\S]*?)\n\}/.exec(tourScript)?.[1] ?? '';
    expect(makeStage).toContain('createStageScene');
    const used = [
      ...new Set([...tourScript.matchAll(/\bliveStage\.(\w+)\(/g), ...makeStage.matchAll(/\bs\.(\w+)\(/g)].map((m) => m[1])),
    ];
    expect(used).toEqual(expect.arrayContaining(['resize', 'pause', 'resume', 'setLive', 'setLiveKey']));

    // The object literal `createStageScene` returns (needs WebGL to build, so read from the source).
    const stageSource = read('../landing/stageScene.ts');
    const returned = /\n {2}return \{\n([\s\S]*?)\n {2}\};\n\}\n\nexport \{ createStageScene/.exec(stageSource)?.[1] ?? '';
    const stageKeys = [...returned.matchAll(/^ {4}(\w+)(?:\(|,|:)/gm)].map((m) => m[1]);
    expect(stageKeys).toEqual(expect.arrayContaining(['resize', 'pause', 'resume', 'setLive', 'setLiveKey', 'dispose']));
    for (const name of used) expect(stageKeys).toContain(name);

    const stub = /const STAGE_STUB = \{([^\n]*)\};/.exec(tourScript)?.[1] ?? '';
    const stubKeys = [...stub.matchAll(/(\w+)(?:\(\)|:)/g)].map((m) => m[1]);
    for (const name of stageKeys) expect(stubKeys).toContain(name);
  });
});

// ── a stub DOM: enough of a browser to run the script's clock (no layout, no WebGL) ──

/** An object that accepts anything: every read is another such object (kept),
 *  every call returns one, it iterates as empty and coerces to 0. */
function anything(): any {
  const store = new Map<PropertyKey, unknown>();
  return new Proxy(function stub() {}, {
    get(_, key) {
      if (store.has(key)) return store.get(key);
      if (key === Symbol.iterator) return function* empty() {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      const value = anything();
      store.set(key, value);
      return value;
    },
    set(_, key, value) {
      store.set(key, value);
      return true;
    },
    apply: () => anything(),
    construct: () => anything(),
  });
}

type Frame = { src: string; inert: boolean; removed: boolean; ready: boolean; contentWindow: object };

function bootTour({ reduced = false } = {}) {
  const frames: Frame[] = [];
  const listeners = new Map<string, ((event: any) => void)[]>();
  const events: { type: string; detail: unknown }[] = [];
  let rafQueue: ((ts: number) => void)[] = [];
  const timers: (() => void)[] = [];
  let now = 0;
  const win: Record<string, any> = {};
  const doc = anything();
  doc.hidden = false;
  doc.querySelectorAll = () => [];
  doc.createElement = (tag: string) => {
    const element = anything();
    if (tag === 'iframe') {
      const frame = element as Frame & Record<string, unknown>;
      frame.removed = false;
      frame.ready = false;
      frame.remove = () => { frame.removed = true; };
      frame.classList = { add: (name: string) => { if (name === 'ready') frame.ready = true; }, remove() {}, toggle() {} };
      frames.push(frame);
    }
    return element;
  };
  const warn = vi.fn();
  const error = vi.fn();
  const origin = 'https://tour.test';
  const run = new Function(
    'window', 'document', 'location', 'matchMedia', 'addEventListener', 'dispatchEvent', 'CustomEvent',
    'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'console',
    tourScript,
  );
  run(
    win,
    doc,
    { origin, search: '?debug', href: `${origin}/landing/ad/tour.html?debug` },
    () => ({ matches: reduced, addEventListener() {} }),
    (type: string, fn: (event: any) => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    (event: { type: string; detail: unknown }) => events.push(event),
    class { type: string; detail: unknown; constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail; } },
    (fn: (ts: number) => void) => { rafQueue.push(fn); return rafQueue.length; },
    () => { rafQueue = []; },
    (fn: () => void) => { timers.push(fn); return timers.length; },
    1600, 1000, 1,
    { ...console, warn, error, info() {} },
  );
  const step = (count = 1, ms = 16) => {
    for (let i = 0; i < count; i++) {
      const queue = rafQueue;
      rafQueue = [];
      now += ms;
      for (const fn of queue) fn(now);
    }
  };
  const flushTimers = () => { while (timers.length) timers.shift()!(); };
  const post = (frame: Frame, data: unknown, from = origin) => {
    for (const fn of listeners.get('message') ?? []) fn({ origin: from, source: frame.contentWindow, data });
  };
  const live = () => frames.filter((f) => !f.removed);
  const scene = (id: string) => live().find((f) => f.src.endsWith(`scene=${id}`));
  return { win, frames, live, scene, events, step, flushTimers, post, warn, error, origin };
}

describe('tour.html liveness (stub DOM)', () => {
  it('starts without a 3D stage, once the first live screen is ready', () => {
    const tour = bootTour();
    expect(tour.error).toHaveBeenCalledWith(expect.stringContaining('[tour] the 3D stage could not start'), expect.anything());
    tour.step();
    const effects = tour.scene('effects');
    expect(effects).toBeDefined();
    expect(effects!.inert).toBe(true);
    expect(tour.live()).toHaveLength(1);
    tour.step(10);
    tour.flushTimers();
    expect(tour.win.__adNow()).toBe(0); // "Tuning up…" still waits

    tour.post(effects!, { type: 'showcase:ready' }, 'https://elsewhere.test'); // wrong origin: ignored
    tour.step();
    tour.flushTimers();
    expect(effects!.ready).toBe(false);

    tour.post(effects!, { type: 'showcase:ready', degraded: ['recording-failed'] });
    tour.post(effects!, { type: 'showcase:ready', degraded: ['recording-failed'] });
    expect(effects!.ready).toBe(true); // degraded still counts as ready…
    const degradedWarnings = tour.warn.mock.calls.filter(([text]) => String(text).includes('degraded'));
    expect(degradedWarnings).toEqual([['[tour] scene effects is ready but degraded: recording-failed']]); // …said once
    tour.step();
    tour.flushTimers();
    tour.step(30);
    expect(tour.win.__adNow()).toBeGreaterThan(0.3);
    expect(tour.win.__tour.isBuffering()).toBe(false);
  });

  it('never waits on a failed screen, and gives up on a hung one', () => {
    const tour = bootTour();
    tour.step();
    tour.post(tour.scene('effects')!, { type: 'showcase:ready' });
    tour.step();
    tour.flushTimers();
    tour.step();

    tour.win.__tour.skipBy(12); // 12 s: the info screen mounts (10 s ahead of 21.85)
    tour.step();
    const info = tour.scene('info');
    expect(info).toBeDefined();
    tour.post(info!, { type: 'showcase:failed', message: 'boom' });
    expect(info!.removed).toBe(true);
    expect(tour.warn).toHaveBeenCalledWith('[tour] scene info failed: boom');

    tour.win.__tour.skipBy(21.7 - tour.win.__adNow()); // inside info's window: no wait
    tour.step(5);
    expect(tour.win.__tour.isBuffering()).toBe(false);
    expect(tour.scene('info')).toBeUndefined(); // not remounted inside its window
    const before = tour.win.__adNow();
    tour.step(10);
    expect(tour.win.__adNow()).toBeGreaterThan(before);

    tour.win.__tour.skipBy(25.2 - tour.win.__adNow()); // the add menu never reports: the clock waits…
    tour.step(3);
    expect(tour.win.__tour.isBuffering()).toBe(true);
    expect(tour.events.some((e) => e.type === 'tourbuffering' && e.detail === true)).toBe(true);
    const held = tour.win.__adNow();
    tour.step(5);
    expect(tour.win.__adNow()).toBe(held);

    tour.win.__tour.toggle(); // …paused, it is not "buffering"
    tour.step(2);
    expect(tour.win.__tour.isBuffering()).toBe(false);
    tour.win.__tour.toggle();

    tour.step(32, 1000); // …until its liveness deadline
    expect(tour.warn).toHaveBeenCalledWith(expect.stringMatching(/^\[tour\] scene addMenu failed: not ready 30 s/));
    expect(tour.scene('addMenu')).toBeUndefined();
    tour.step(3);
    expect(tour.win.__tour.isBuffering()).toBe(false);
    expect(tour.win.__adNow()).toBeGreaterThan(held);
  });

  it('mounts the tutorial 24 s ahead, and never mounts a screen reduced motion never shows', () => {
    const tour = bootTour();
    tour.step();
    tour.post(tour.scene('effects')!, { type: 'showcase:ready' });
    tour.step();
    tour.flushTimers();
    tour.win.__tour.skipBy(35);
    tour.step();
    expect(tour.scene('tutorial')).toBeUndefined();
    tour.win.__tour.skipBy(37 - tour.win.__adNow());
    tour.step();
    expect(tour.scene('tutorial')).toBeDefined();

    const still = bootTour({ reduced: true });
    still.step();
    still.post(still.scene('effects')!, { type: 'showcase:ready' });
    still.step();
    still.flushTimers();
    for (const at of [40, 50, 58, 61, 64]) {
      still.win.__tour.skipBy(at - still.win.__adNow());
      still.step();
      expect(still.scene('tutorial')).toBeUndefined();
    }
  });
});

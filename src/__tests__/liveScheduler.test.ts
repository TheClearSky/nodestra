/**
 * The live-showcase scheduler: how many app components may be live on the
 * landing page, who goes first, and when one gives its place up. The
 * eviction rules carry a measured lesson — the landing's cards float, so
 * visible shares jitter, and "any higher share wins" made the slots evict
 * each other forever.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Slot = { priority(): number; mount(): void; unmount(): void; share: number; isLive: boolean; boots: boolean };

type Scheduler = typeof import('../showcase/liveScheduler');
let current: Scheduler;

/** A slot. By default it reports ready the moment it mounts (as if booting
 *  were instant); `boots: true` leaves it booting until `ready(slot)`. */
function slot(share: number, { boots = false } = {}): Slot {
  const handle: Slot = {
    share,
    boots,
    isLive: false,
    priority: () => handle.share,
    mount: () => {
      handle.isLive = true;
      if (!handle.boots) current.readyLive(handle);
    },
    unmount: () => {
      handle.isLive = false;
    },
  };
  return handle;
}

/** A fresh scheduler with a fixed budget (`?live=`), loaded into `win`. */
async function scheduler(budget: number, win: Record<string, unknown> = {}) {
  vi.stubGlobal('location', { search: `?live=${budget}` });
  vi.stubGlobal('window', win);
  vi.resetModules();
  current = await import('../showcase/liveScheduler');
  return current;
}

/** Lets every queued idle tick (a 60 ms timeout without requestIdleCallback) run. */
async function settle(ms = 1000) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('live showcase scheduler', () => {
  it('grants places up to the budget, most visible first', async () => {
    const { requestLive } = await scheduler(2);
    const [a, b, c] = [slot(0.3), slot(1), slot(0.8)];
    for (const s of [a, b, c]) requestLive(s);
    await settle();
    expect([a.isLive, b.isLive, c.isLive]).toEqual([false, true, true]);
  });

  it('never evicts for a jitter-sized difference', async () => {
    const { requestLive, reprioritise } = await scheduler(1);
    const live = slot(0.99);
    requestLive(live);
    await settle();
    const waiting = slot(1);
    requestLive(waiting);
    reprioritise();
    await settle(10_000);
    expect(live.isLive).toBe(true);
    expect(waiting.isLive).toBe(false);
  });

  it('a clearly more visible slot takes the place — after the fresh mount has had its time', async () => {
    const { requestLive, reprioritise } = await scheduler(1);
    const old = slot(0.4);
    requestLive(old);
    await settle(100);
    expect(old.isLive).toBe(true);
    const better = slot(1);
    requestLive(better);
    await settle(1000);
    // Still within the 4 s a fresh mount is given.
    expect(better.isLive).toBe(false);
    reprioritise();
    await settle(5000);
    expect(better.isLive).toBe(true);
    expect(old.isLive).toBe(false);
  });

  it('looks ahead only once the visitor has scrolled', async () => {
    const listeners: Array<() => void> = [];
    const { requestLive } = await scheduler(2, { addEventListener: (_type: string, listener: () => void) => listeners.push(listener) });
    const offScreen = slot(0);
    requestLive(offScreen);
    await settle(10_000);
    expect(offScreen.isLive).toBe(false);
    for (const listener of listeners) listener();
    await settle();
    expect(offScreen.isLive).toBe(true);
  });

  it('a page already scrolled when the scheduler loads counts as scrolled', async () => {
    const { requestLive } = await scheduler(2, { scrollY: 900 });
    const offScreen = slot(0);
    requestLive(offScreen);
    await settle();
    expect(offScreen.isLive).toBe(true);
  });

  it('boots one slot at a time: the next waits for the last to report ready', async () => {
    const { readyLive, requestLive } = await scheduler(3);
    const [a, b] = [slot(1, { boots: true }), slot(0.9, { boots: true })];
    requestLive(a);
    requestLive(b);
    await settle(10_000);
    expect([a.isLive, b.isLive]).toEqual([true, false]);
    readyLive(a);
    await settle();
    expect([a.isLive, b.isLive]).toEqual([true, true]);
  });

  it('never evicts a slot that is still booting', async () => {
    const { requestLive, reprioritise } = await scheduler(1);
    const booting = slot(0.1, { boots: true });
    requestLive(booting);
    await settle();
    const better = slot(1);
    requestLive(better);
    reprioritise();
    await settle(30_000);
    expect(booting.isLive).toBe(true);
    expect(better.isLive).toBe(false);
  });

  it('counts the settling time from ready, not from mount', async () => {
    const { readyLive, requestLive, reprioritise } = await scheduler(1);
    const old = slot(0.2, { boots: true });
    requestLive(old);
    await settle(100);
    await settle(10_000);
    readyLive(old);
    const better = slot(1);
    requestLive(better);
    reprioritise();
    await settle(1000);
    // Booted for 10 s, but ready for only 1 s: not yet evictable.
    expect(better.isLive).toBe(false);
    await settle(5000);
    expect(better.isLive).toBe(true);
    expect(old.isLive).toBe(false);
  });

  it("a visitor's tap takes a place at once, booting or not, margin or not", async () => {
    const { requestLive } = await scheduler(1);
    const card = slot(1, { boots: true });
    requestLive(card);
    await settle();
    expect(card.isLive).toBe(true);
    const tour = slot(1);
    requestLive(tour, { explicit: true });
    await settle();
    expect(tour.isLive).toBe(true);
    expect(card.isLive).toBe(false);
  });

  it('a tapped slot is never displaced by a looked-ahead one', async () => {
    const { requestLive, reprioritise } = await scheduler(1);
    const tour = slot(0.1);
    requestLive(tour, { explicit: true });
    await settle();
    const card = slot(1);
    requestLive(card);
    reprioritise();
    await settle(30_000);
    expect(tour.isLive).toBe(true);
    expect(card.isLive).toBe(false);
  });

  it('a released place goes to the next waiting slot', async () => {
    const { releaseLive, requestLive } = await scheduler(1);
    const first = slot(1);
    const second = slot(0.9);
    requestLive(first);
    requestLive(second);
    await settle();
    expect([first.isLive, second.isLive]).toEqual([true, false]);
    releaseLive(first);
    await settle();
    expect([first.isLive, second.isLive]).toEqual([false, true]);
  });
});

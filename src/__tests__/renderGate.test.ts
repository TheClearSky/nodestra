import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenderGate } from '../landing/renderGate';

// A stand-in document (visibility) and IntersectionObserver (view), driven
// by hand: the gate's three reasons to stop, each on its own and together.
class FakeDocument extends EventTarget {
  hidden = false;
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

const observers: FakeObserver[] = [];
class FakeObserver {
  observed: unknown[] = [];
  disconnected = false;
  constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {
    observers.push(this);
  }
  observe(element: unknown) {
    this.observed.push(element);
  }
  disconnect() {
    this.disconnected = true;
  }
  report(...visible: boolean[]) {
    this.callback(visible.map((isIntersecting) => ({ isIntersecting })));
  }
}

let doc: FakeDocument;
beforeEach(() => {
  doc = new FakeDocument();
  observers.length = 0;
  vi.stubGlobal('document', doc);
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});
afterEach(() => vi.unstubAllGlobals());

const element = {} as Element;

describe('createRenderGate', () => {
  it('starts open (in view until the observer reports) and observes the canvas', () => {
    const changes: boolean[] = [];
    const gate = createRenderGate(element, (open) => changes.push(open));
    expect(gate.isOpen()).toBe(true);
    expect(observers[0].observed).toEqual([element]);
    expect(changes).toEqual([]); // no call on creation
  });

  it('closes off screen and reopens in view, calling back only on flips', () => {
    const changes: boolean[] = [];
    const gate = createRenderGate(element, (open) => changes.push(open));
    observers[0].report(false);
    observers[0].report(false);
    expect(gate.isOpen()).toBe(false);
    observers[0].report(true);
    expect(changes).toEqual([false, true]);
  });

  it('takes the last of several queued entries', () => {
    const gate = createRenderGate(element, () => {});
    observers[0].report(true, false);
    expect(gate.isOpen()).toBe(false);
    observers[0].report(false, true);
    expect(gate.isOpen()).toBe(true);
  });

  it('closes while the tab is hidden', () => {
    const changes: boolean[] = [];
    const gate = createRenderGate(element, (open) => changes.push(open));
    doc.setHidden(true);
    expect(gate.isOpen()).toBe(false);
    doc.setHidden(false);
    expect(changes).toEqual([false, true]);
  });

  it('keeps an owner pause through a tab or scroll round trip', () => {
    const changes: boolean[] = [];
    const gate = createRenderGate(element, (open) => changes.push(open));
    gate.setPaused(true);
    doc.setHidden(true);
    doc.setHidden(false);
    observers[0].report(false);
    observers[0].report(true);
    expect(gate.isOpen()).toBe(false);
    expect(changes).toEqual([false]);
    gate.setPaused(false);
    expect(changes).toEqual([false, true]);
  });

  it('opens only when no reason applies', () => {
    const gate = createRenderGate(element, () => {});
    gate.setPaused(true);
    doc.setHidden(true);
    observers[0].report(false);
    gate.setPaused(false);
    expect(gate.isOpen()).toBe(false);
    doc.setHidden(false);
    expect(gate.isOpen()).toBe(false);
    observers[0].report(true);
    expect(gate.isOpen()).toBe(true);
  });

  it('closes for good on dispose and stops listening', () => {
    const changes: boolean[] = [];
    const gate = createRenderGate(element, (open) => changes.push(open));
    gate.dispose();
    expect(changes).toEqual([false]);
    expect(observers[0].disconnected).toBe(true);
    doc.setHidden(true);
    doc.setHidden(false);
    gate.setPaused(false);
    expect(gate.isOpen()).toBe(false);
    expect(changes).toEqual([false]);
  });

  it('counts the canvas as in view where there is no IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const gate = createRenderGate(element, () => {});
    expect(gate.isOpen()).toBe(true);
    doc.setHidden(true);
    expect(gate.isOpen()).toBe(false);
  });
});

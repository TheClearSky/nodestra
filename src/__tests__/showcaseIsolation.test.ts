/**
 * The showcase frames run the REAL app on the landing page's origin. Their
 * one security property: they never touch the visitor's own storage. That
 * rests on two things, both pinned here:
 *
 *   1. `showcase.html`'s classic head script replaces localStorage,
 *      sessionStorage and indexedDB with in-memory stand-ins — before any
 *      module (the app's shared chunks included) runs.
 *   2. The app persists ONLY through those three. Any other persistence or
 *      cross-window API (BroadcastChannel, workers, OPFS, Cache Storage,
 *      cookies, reaching into a parent window) would slip past the stand-ins,
 *      so a new use fails this test and must be thought through first.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');

function isolationScript(): string {
  const html = readFileSync(join(root, 'showcase.html'), 'utf8');
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('showcase.html has no classic isolation script');
  return match[1];
}

type FakeWindow = Record<string, unknown> & { parent: unknown; posted: unknown[] };

function runIsolation(win: FakeWindow) {
  new Function('window', 'location', isolationScript())(win, { origin: 'https://example.test' });
}

function fakeWindow(): FakeWindow {
  const realStorage = { getItem: () => 'REAL', setItem: () => {} };
  const parent: { postMessage(message: unknown): void } = { postMessage: () => {} };
  const win: FakeWindow = { localStorage: realStorage, sessionStorage: realStorage, indexedDB: { open: () => null }, parent, posted: [] };
  parent.postMessage = (message) => {
    win.posted.push(message);
  };
  return win;
}

describe('showcase storage isolation', () => {
  it('the isolation script runs before the module script', () => {
    const html = readFileSync(join(root, 'showcase.html'), 'utf8');
    expect(html.indexOf('<script>')).toBeGreaterThan(-1);
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('<script type="module"'));
  });

  it('replaces both storages with memory and hides IndexedDB', () => {
    const win = fakeWindow();
    runIsolation(win);
    const local = win.localStorage as Storage;
    const session = win.sessionStorage as Storage;
    expect(local.getItem('library')).toBeNull();
    local.setItem('library', 'demo');
    expect(local.getItem('library')).toBe('demo');
    expect(session.getItem('library')).toBeNull();
    expect(local.length).toBe(1);
    expect(local.key(0)).toBe('library');
    local.removeItem('library');
    expect(local.length).toBe(0);
    expect(win.indexedDB).toBeUndefined();
    expect(win.__showcaseIsolated).toBe(true);
    expect(win.posted).toEqual([]);
  });

  it('answers named access as a real Storage does', () => {
    const win = fakeWindow();
    runIsolation(win);
    const local = win.localStorage as Storage & Record<string, unknown>;
    local.setItem('a', '1');
    expect(local.a).toBe('1');
    expect(Object.keys(local)).toEqual(['a']);
    local.b = 2;
    expect(local.getItem('b')).toBe('2');
    expect('b' in local).toBe(true);
    delete local.b;
    expect(local.getItem('b')).toBeNull();
  });

  it('fails closed, and says so, when the window cannot be patched', () => {
    const win = fakeWindow();
    Object.defineProperty(win, 'localStorage', { value: win.localStorage, configurable: false, writable: false });
    runIsolation(win);
    expect(win.__showcaseIsolated).toBeUndefined();
    expect(win.posted).toEqual([{ type: 'showcase:failed', message: 'storage isolation failed' }]);
  });

  it('the frame refuses to start the app without isolation', () => {
    const main = readFileSync(join(root, 'src/showcase/frame/main.tsx'), 'utf8');
    expect(main).toMatch(/if \(!frameWindow\.__showcaseIsolated\)/);
  });
});

/** Every source file under src/, tests excluded. */
function sourceFiles(dir = join(root, 'src')): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** APIs that would carry data past the stand-ins, and the files allowed to
 *  use each (with why). */
const FORBIDDEN: Array<{ name: string; pattern: RegExp; allowed: string[] }> = [
  { name: 'BroadcastChannel', pattern: /\bBroadcastChannel\b/, allowed: [] },
  { name: 'navigator.storage (OPFS, persistence)', pattern: /navigator\.storage\b/, allowed: [] },
  { name: 'Cache Storage', pattern: /\bcaches\.(open|match|keys|delete|has)\b/, allowed: [] },
  { name: 'document.cookie', pattern: /document\.cookie\b/, allowed: [] },
  { name: 'SharedWorker / Worker', pattern: /new (Shared)?Worker\(/, allowed: [] },
  { name: 'service worker', pattern: /serviceWorker\b/, allowed: [] },
  {
    name: 'a parent or top window',
    pattern: /window\.(parent|top|opener)\b/,
    // The frame posts its status to its page; frame visibility reads its own
    // iframe element through `parent` (no storage involved).
    allowed: ['src/showcase/frame/main.tsx', 'src/showcase/frame/frameVisibility.ts'],
  },
];

describe('the app persists only through the isolated APIs', () => {
  const files = sourceFiles().map((path) => ({ path: relative(root, path).replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }));
  for (const { name, pattern, allowed } of FORBIDDEN) {
    it(`no ${name}`, () => {
      const users = files.filter((file) => pattern.test(file.text)).map((file) => file.path);
      expect(users.filter((path) => !allowed.includes(path))).toEqual([]);
    });
  }
});

/**
 * The messages between a page and its showcase frames, the query that picks
 * a frame's scene, and the small site helpers around deploys and the base
 * path. The tour (`public/landing/ad/tour.html`) speaks the same messages by
 * hand; `tourContract.test.ts` pins its side.
 */

import { describe, expect, it } from 'vitest';
import { APP_SCENE_IDS, isAppSceneId } from '../showcase/appScenes';
import { frameSearch, parseFrameMessage } from '../showcase/frame/protocol';
import { basenameFrom } from '../routes';
import { isStaleChunkError } from '../staleDeploy';

describe('frame messages', () => {
  it('reads exactly the two kinds a frame sends', () => {
    expect(parseFrameMessage({ type: 'showcase:ready' })).toEqual({ type: 'showcase:ready' });
    expect(parseFrameMessage({ type: 'showcase:ready', degraded: ['recording-failed'] })).toEqual({
      type: 'showcase:ready',
      degraded: ['recording-failed'],
    });
    expect(parseFrameMessage({ type: 'showcase:failed', message: 'no scene' })).toEqual({ type: 'showcase:failed', message: 'no scene' });
  });

  it('ignores everything else — a malformed failure is not a failure', () => {
    for (const data of [null, 'showcase:ready', 42, {}, { type: 'showcase:visible' }, { type: 'showcase:failed' }, { type: 'other' }]) {
      expect(parseFrameMessage(data), JSON.stringify(data)).toBeNull();
    }
  });

  it('an empty degraded list is a plain ready', () => {
    expect(parseFrameMessage({ type: 'showcase:ready', degraded: [] })).toEqual({ type: 'showcase:ready' });
  });
});

describe('frame query', () => {
  it('names the scene, and marks the live "Try it" instance', () => {
    expect(frameSearch({ kind: 'app', scene: 'gridFinder' })).toBe('?kind=app&scene=gridFinder');
    expect(frameSearch({ kind: 'app', scene: 'effects', live: true })).toBe('?kind=app&scene=effects&live');
  });

  it('accepts exactly the scene ids', () => {
    for (const id of APP_SCENE_IDS) expect(isAppSceneId(id)).toBe(true);
    for (const id of [null, '', 'Effects', 'nope', 'constructor']) expect(isAppSceneId(id)).toBe(false);
  });
});

describe('site helpers', () => {
  it('the router basename follows the deploy base', () => {
    expect(basenameFrom('/')).toBe('/');
    expect(basenameFrom('/nodestra/')).toBe('/nodestra');
    expect(() => basenameFrom('./')).toThrow();
  });

  it('recognises a code file missing after a deploy, in each engine', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/App-abc.js'))).toBe(true);
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
  });
});

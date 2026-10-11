/**
 * The tour video's Auto quality: the smallest rendition that fills the player
 * sharply (its height in device pixels), never above what the connection
 * allows or what stalls have capped it to.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { autoHeight } from '../site/TourPlayer';

function device(pixelRatio: number, connection?: { saveData?: boolean; effectiveType?: string }) {
  vi.stubGlobal('window', { devicePixelRatio: pixelRatio });
  vi.stubGlobal('navigator', { connection });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tour video Auto quality', () => {
  it('picks the smallest rendition that covers the player in device pixels', () => {
    device(1);
    expect(autoHeight(300, 1080)).toBe(360);
    expect(autoHeight(420, 1080)).toBe(480);
    expect(autoHeight(700, 1080)).toBe(720);
    device(2);
    expect(autoHeight(420, 1080)).toBe(1080);
    expect(autoHeight(200, 1080)).toBe(360);
    expect(autoHeight(240, 1080)).toBe(480);
  });

  it('never goes above 1080p, however large the player', () => {
    device(2);
    expect(autoHeight(2000, 1080)).toBe(1080);
  });

  it('follows the connection: data saver and 2G get 360p, 3G at most 480p', () => {
    device(2, { saveData: true });
    expect(autoHeight(700, 1080)).toBe(360);
    device(2, { effectiveType: '2g' });
    expect(autoHeight(700, 1080)).toBe(360);
    device(2, { effectiveType: '3g' });
    expect(autoHeight(700, 1080)).toBe(480);
    device(2, { effectiveType: '4g' });
    expect(autoHeight(700, 1080)).toBe(1080);
  });

  it('stays within the cap that stalls lowered it to', () => {
    device(2);
    expect(autoHeight(700, 720)).toBe(720);
    expect(autoHeight(700, 480)).toBe(480);
  });
});

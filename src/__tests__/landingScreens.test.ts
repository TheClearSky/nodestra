import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREENS, SHOT_VIRTUAL, SHOT_WIDTHS, shotImagePath, shotRegion } from '../site/screens';

describe('landing screens', () => {
  it('every card has its stills at every width (run scripts/capture-cards.mjs)', () => {
    for (const shot of SCREENS) {
      for (const width of SHOT_WIDTHS) {
        expect(existsSync(join(process.cwd(), 'public', shotImagePath(shot.key, width))), `${shot.key} @ ${width}`).toBe(true);
      }
    }
  });

  it('a crop zooms in on its point and never shows past the screen', () => {
    expect(shotRegion(undefined)).toEqual({ left: 0, top: 0, ...SHOT_VIRTUAL });
    const centred = shotRegion({ x: 720, y: 450, scale: 2 });
    expect(centred).toEqual({ left: 360, top: 225, width: 720, height: 450 });
    const corner = shotRegion({ x: 1430, y: 890, scale: 1.6 });
    expect(corner.left + corner.width).toBeCloseTo(SHOT_VIRTUAL.width);
    expect(corner.top + corner.height).toBeCloseTo(SHOT_VIRTUAL.height);
  });
});

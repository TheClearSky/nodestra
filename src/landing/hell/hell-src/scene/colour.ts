// COPIED from .claude/pages/ad/experiments/hell-src/scene/colour.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * COLOUR — the scene's colour script (scene/palette.ts). Its options are whole
 * palettes; every other class keeps its shapes and re-colours itself from the
 * palette store when this changes. It sets the shared environment, lights and
 * fog itself.
 */

import { applyGlobalPalette, PALETTES } from './palette';
import type { AssetFactory } from './contract';

export const create: AssetFactory = ({ lab, backdrop, palette }) => {
  palette.subscribe((p) => applyGlobalPalette(lab, backdrop, p));
  return {
    id: 'colour',
    label: 'Colour',
    options: PALETTES.map((p) => ({ id: p.id, label: p.label, description: p.description, source: p.source })),
    setOption: (id) => palette.set(id),
    params: () => {
      const p = palette.current();
      return { sky: `${p.sky.zenith}→${p.sky.mid}→${p.sky.horizon}`, light: p.sun, fog: p.fog.color, sand: p.sand.lit, circles: p.glow.circles };
    },
  };
};

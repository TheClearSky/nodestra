import type { FrameQuery } from '../showcase/frame/protocol';
import type { LiveCrop } from '../showcase/LiveSlot';

/** A real screen of the app on the landing page: a still of the whole app
 *  running a scene (`src/showcase/appScenes.ts`), taken by
 *  `scripts/capture-cards.mjs`; "Try it" runs that scene live. `crop` zooms
 *  in on part of the 1440x900 desktop layout; `tryItCorner` keeps the
 *  "Try it" button off what the card is showing.
 *
 *  Plain data (no React): the capture script reads this file too. */
type Shot = {
  key: string;
  showcase: FrameQuery;
  title: string;
  caption: string;
  crop?: LiveCrop;
  tryItCorner?: 'bottom-right' | 'top-right';
};

const SCREENS: Shot[] = [
  { key: 'effects', showcase: { kind: 'app', scene: 'effects' }, title: 'A running effects graph', caption: 'Every node is a real sound. Green wires carry the audio; each node draws its wave live.' },
  { key: 'add-menu', showcase: { kind: 'app', scene: 'addMenu' }, title: 'The Add menu, Easy Effects', caption: 'Eight Easy Effects wait in the Add menu, from Stutter to Crunch.', crop: { x: 1000, y: 360, scale: 1.45 } },
  { key: 'inside-group', showcase: { kind: 'app', scene: 'insideGroup' }, title: 'Inside the Echo group', caption: 'Open one up and see the nodes that make it.' },
  { key: 'timeline', showcase: { kind: 'app', scene: 'timeline' }, title: 'The timeline, playing', caption: 'Draw curves that move any setting while it plays.' },
  { key: 'grid-finder', showcase: { kind: 'app', scene: 'gridFinder' }, title: 'The grid finder', caption: 'It suggests tempos that fit your notes, and shows how many land on the grid.', crop: { x: 720, y: 450, scale: 1.25 } },
  { key: 'welcome', showcase: { kind: 'app', scene: 'welcome' }, title: 'Blip, on the Welcome page', caption: 'Blip, a small conductor, shows you what to click, step by step.', crop: { x: 1080, y: 720, scale: 1.6 }, tryItCorner: 'top-right' },
];

/** The desktop layout every scene is captured at. */
const SHOT_VIRTUAL = { width: 1440, height: 900 };

/** The card stills' widths (px): `-<width>.webp`, picked by `srcset`. */
const SHOT_WIDTHS = [720, 1440] as const;

/** Where a card's still lives (under `public/`), at one of `SHOT_WIDTHS`. */
function shotImagePath(key: string, width: number): string {
  return `landing/cards/${key}-${width}.webp`;
}

/** The part of the virtual screen a card shows: centred on the crop's point,
 *  `1 / scale` of the screen, kept inside it (no empty edge). */
function shotRegion(crop: LiveCrop | undefined): { left: number; top: number; width: number; height: number } {
  const zoom = crop?.scale ?? 1;
  const width = SHOT_VIRTUAL.width / zoom;
  const height = SHOT_VIRTUAL.height / zoom;
  const left = crop ? Math.min(Math.max(crop.x - width / 2, 0), SHOT_VIRTUAL.width - width) : 0;
  const top = crop ? Math.min(Math.max(crop.y - height / 2, 0), SHOT_VIRTUAL.height - height) : 0;
  return { left, top, width, height };
}

export { SCREENS, SHOT_VIRTUAL, SHOT_WIDTHS, shotImagePath, shotRegion };
export type { Shot };

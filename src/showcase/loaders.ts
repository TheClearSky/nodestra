import { FrameLive } from './FrameLive';
import type { FrameQuery } from './frame/protocol';
import type { LiveLoader } from './LiveSlot';

/*
 * What the landing page's live slots load. The app components themselves run
 * inside showcase frames (`FrameLive` → `showcase.html`), so the landing page
 * downloads none of the editor; the tour player is its own small chunk.
 */

const loadFrame: LiveLoader<{ query: FrameQuery }> = () => Promise.resolve(FrameLive);

const loadTour: LiveLoader<Record<string, never>> = () =>
  import('../site/TourPlayer').then((module) => module.TourPlayer);

export { loadFrame, loadTour };

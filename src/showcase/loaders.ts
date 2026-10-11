import { FrameLive } from './FrameLive';
import type { FrameQuery } from './frame/protocol';
import type { LiveLoader } from './LiveSlot';

/*
 * What the landing page's live slots load. The app components themselves run
 * inside showcase frames (`FrameLive` → `showcase.html`), so the landing page
 * downloads none of the editor. (The tour is a video: `site/TourPlayer`.)
 */

const loadFrame: LiveLoader<{ query: FrameQuery }> = () => Promise.resolve(FrameLive);

export { loadFrame };

import { useEffect, useRef, useState } from 'react';

/** The size every UI snapshot was captured at (CSS px). */
const SHOT_W = 1440;
const SHOT_H = 900;

/**
 * One real screen of the app — not a picture of it: a standalone HTML
 * snapshot of the app's own DOM (`public/landing/ad/ui/*.html`, captured by
 * `.claude/pages/ad/tools/capture-init.js`), shown at 1440×900 and scaled to
 * the card's width. Inert: no pointer events, out of the tab order, hidden
 * from assistive tech (the caption carries the meaning).
 */
function UiShot({ src, title, crop }: { src: string; title: string; crop?: { x: number; y: number; scale: number } }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const zoom = crop?.scale ?? 1;
  const fit = width / SHOT_W;
  const scale = fit * zoom;
  // Keep the crop's focus point centred, clamped so no empty edge shows.
  const visibleW = SHOT_W / zoom;
  const visibleH = SHOT_H / zoom;
  const left = crop ? Math.min(Math.max(crop.x - visibleW / 2, 0), SHOT_W - visibleW) : 0;
  const top = crop ? Math.min(Math.max(crop.y - visibleH / 2, 0), SHOT_H - visibleH) : 0;

  return (
    <div ref={boxRef} className='relative aspect-[16/10] w-full overflow-hidden bg-primary-black'>
      {width > 0 && (
        <iframe
          src={src}
          title={title}
          width={SHOT_W}
          height={SHOT_H}
          loading='lazy'
          tabIndex={-1}
          aria-hidden='true'
          scrolling='no'
          className='pointer-events-none absolute top-0 left-0 origin-top-left border-0'
          style={{ transform: `scale(${scale}) translate(${-left}px, ${-top}px)` }}
        />
      )}
    </div>
  );
}

export { UiShot };

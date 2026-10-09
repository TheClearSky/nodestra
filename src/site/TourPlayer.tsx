import { useEffect, useRef, useState } from 'react';
import type { LiveComponentProps } from '../showcase/LiveSlot';
import { GOLD, TOUR_SRC } from './shared';

/*
 * The tour inside the proscenium, with the page's own controls (Deepak,
 * 2026-10-01: "remove the bottom progress bar on procenium. instead on hover
 * show a left and right [arrow] for skipping to 10 seconds earlier or later
 * or pause by clicking a pause button which turns into a play button- keep
 * same theme as the border graphics").
 *
 * `?embed` makes the tour hide its own progress bar and pause hint and expose
 * `window.__tour` (same origin); it fires `tourplaying` whenever it pauses or
 * plays — also when the tour itself is clicked — so the button always shows
 * the truth.
 */

type TourApi = { skipBy(sec: number): void; toggle(): boolean; isPlaying(): boolean };
type TourWindow = Window & { __tour?: TourApi };

/** A gilded medallion, in the proscenium's materials: gold ring, dark lacquer, a gold glyph. */
function Medallion({ label, onClick, size = 58, children, className = '' }: { label: string; onClick(): void; size?: number; children: React.ReactNode; className?: string }) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`pointer-events-auto grid place-items-center rounded-full p-[2px] transition-[transform,opacity,filter] duration-300 hover:scale-[1.07] hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9d3a8] ${className}`}
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(160deg, #f3dca6, #8a6a2c 35%, #3d2a10 62%, #c9973f)',
        boxShadow: '0 0 0 1px rgba(233,211,168,0.35), 0 0 22px rgba(255,200,120,0.28), 0 10px 26px rgba(0,0,0,0.65)',
      }}
    >
      <span className='grid h-full w-full place-items-center rounded-full' style={{ background: 'radial-gradient(circle at 35% 30%, #5a3f16, #241707 70%)', boxShadow: 'inset 0 0 0 1px rgba(233,211,168,0.4), inset 0 2px 6px rgba(255,230,170,0.18)' }}>
        {children}
      </span>
    </button>
  );
}

function SkipGlyph({ dir }: { dir: -1 | 1 }) {
  // A circular arrow with "10" in it, mirrored for forward.
  return (
    <svg width='30' height='30' viewBox='0 0 30 30' aria-hidden='true' style={{ transform: dir > 0 ? 'scaleX(-1)' : undefined }}>
      <path d='M8.5 9.5A9.5 9.5 0 1 1 6 16' fill='none' stroke={GOLD} strokeWidth='1.8' strokeLinecap='round' />
      <path d='M8.6 4.6v5h5' fill='none' stroke={GOLD} strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' />
      <text x='15.5' y='19.5' textAnchor='middle' fontSize='8.5' fontWeight='700' fill={GOLD} fontFamily='ui-serif, Georgia, serif' style={{ transform: dir > 0 ? 'scaleX(-1)' : undefined, transformOrigin: '15.5px 15px' }}>10</text>
    </svg>
  );
}

/**
 * A live showcase (`showcase/LiveSlot`, fit 'fill'): the slot mounts it only
 * near the viewport and unmounts it far away — the tour is a second three.js
 * stage plus ten app screens, the heaviest thing on the page. Off screen it
 * pauses, and it resumes only if it was the one that paused (a visitor's own
 * pause stays a pause).
 */
function TourPlayer({ visible, onReady }: LiveComponentProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [playing, setPlaying] = useState(true);
  const [nudge, setNudge] = useState<-1 | 0 | 1>(0);
  const pausedForScrollRef = useRef(false);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    const frame = frameRef.current; if (!frame) return undefined;
    let win: TourWindow | null = null;
    const onPlaying = (e: Event) => setPlaying(Boolean((e as CustomEvent<boolean>).detail));
    const attach = () => {
      win = frame.contentWindow as TourWindow | null;
      if (!win) return;
      try {
        win.addEventListener('tourplaying', onPlaying);
      } catch {
        // The tour failed to load and the frame holds the browser's (cross-
        // origin) error page: no controls to drive, and no page error.
        win = null;
        return;
      }
      setPlaying(win.__tour?.isPlaying() ?? true);
      readyRef.current();
    };
    frame.addEventListener('load', attach);
    if (frame.contentDocument?.readyState === 'complete') attach();
    return () => { frame.removeEventListener('load', attach); win?.removeEventListener('tourplaying', onPlaying); };
  }, []);

  const tour = () => (frameRef.current?.contentWindow as TourWindow | null)?.__tour;

  useEffect(() => {
    const api = (frameRef.current?.contentWindow as TourWindow | null)?.__tour;
    if (!api) return;
    if (!visible && api.isPlaying()) {
      api.toggle();
      pausedForScrollRef.current = true;
    } else if (visible && pausedForScrollRef.current) {
      pausedForScrollRef.current = false;
      if (!api.isPlaying()) api.toggle();
    }
  }, [visible]);
  const skip = (dir: -1 | 1) => {
    tour()?.skipBy(dir * 10);
    setNudge(dir);
    window.setTimeout(() => setNudge(0), 450);
  };

  // Shown while the pointer is over the tour, while a control has focus, always on touch screens,
  // and (for play) always while paused.
  const reveal = 'opacity-0 group-hover/tour:opacity-100 group-focus-within/tour:opacity-100 [@media(hover:none)]:opacity-100';
  return (
    <div className='group/tour relative'>
      <iframe ref={frameRef} src={`${TOUR_SRC}?embed`} title='Nodestra — an animated tour of the app' className='block aspect-[16/10] w-full border-0' />
      <div className='pointer-events-none absolute inset-0 flex items-center justify-between px-[3%]'>
        <Medallion label='Back 10 seconds' onClick={() => skip(-1)} className={`${reveal} ${nudge === -1 ? '-translate-x-1' : ''}`}>
          <SkipGlyph dir={-1} />
        </Medallion>
        <div className='flex flex-col items-center gap-2'>
          <Medallion label={playing ? 'Pause' : 'Play'} onClick={() => tour()?.toggle()} size={74} className={playing ? reveal : 'opacity-100'}>
            {playing ? (
              <svg width='26' height='26' viewBox='0 0 26 26' aria-hidden='true'><rect x='6' y='4' width='5' height='18' rx='1.2' fill={GOLD} /><rect x='15' y='4' width='5' height='18' rx='1.2' fill={GOLD} /></svg>
            ) : (
              <svg width='28' height='28' viewBox='0 0 28 28' aria-hidden='true'><path d='M9 5.5v17a1 1 0 0 0 1.5.86l13-8.5a1 1 0 0 0 0-1.72l-13-8.5A1 1 0 0 0 9 5.5z' fill={GOLD} /></svg>
            )}
          </Medallion>
          {/* a small flourish under the centre medallion, like the arch's ornament */}
          <svg width='110' height='14' viewBox='0 0 110 14' aria-hidden='true' className={playing ? reveal : 'opacity-100'} style={{ transition: 'opacity .3s' }}>
            <path d='M2 7 Q22 -1 42 7 M108 7 Q88 -1 68 7' fill='none' stroke={GOLD} strokeOpacity='.7' strokeWidth='1.3' strokeLinecap='round' />
            <circle cx='55' cy='7' r='3' fill='none' stroke={GOLD} strokeWidth='1.3' />
          </svg>
        </div>
        <Medallion label='Forward 10 seconds' onClick={() => skip(1)} className={`${reveal} ${nudge === 1 ? 'translate-x-1' : ''}`}>
          <SkipGlyph dir={1} />
        </Medallion>
      </div>
    </div>
  );
}

export { TourPlayer };

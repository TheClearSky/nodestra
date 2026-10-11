import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { STORAGE_NAMESPACE } from '../storageNamespace';
import { GOLD } from './shared';

/*
 * The tour, as a video (Deepak, 2026-10-11: "it might be better to render it
 * as [a] video asset … offer 1080p, 720p, 480p and 360p, by default auto and
 * let the user choose it too, maintain theme, keep it sleek. Also when the
 * mouse is hovering on the video, display the controls but not forever, hide
 * them if mouse isn't moving for some time. Have an appear and disappear fade
 * for controls").
 *
 * Played live, the tour booted the real app in ten screens and the page
 * lagged; `scripts/record-tour.mjs` records `public/landing/ad/tour.html`
 * frame by frame into `public/landing/ad/tour/tour-<height>.mp4` (re-run it
 * when the app's look changes). The controls are the proscenium's gilded
 * medallions (Deepak, 2026-10-01: "on hover show a left and right [arrow] for
 * skipping to 10 seconds earlier or later or pause by clicking a pause button
 * which turns into a play button — keep same theme as the border graphics").
 */

const TOUR_DIR = `${import.meta.env.BASE_URL}landing/ad/tour/`;
/** The recorded renditions (16:10), smallest first. */
const HEIGHTS = [360, 480, 720, 1080] as const;
type Height = (typeof HEIGHTS)[number];
type Quality = 'auto' | Height;
const QUALITY_KEY = `${STORAGE_NAMESPACE}.tour.quality`;
/** Controls fade out after the pointer rests this long. */
const IDLE_MS = 2200;
/** A stall this long, in Auto, steps down one rendition. */
const STALL_MS = 2000;

const videoUrl = (height: Height) => `${TOUR_DIR}tour-${height}.mp4`;

function readQuality(): Quality {
  try {
    const saved = Number(localStorage.getItem(QUALITY_KEY));
    return (HEIGHTS as readonly number[]).includes(saved) ? (saved as Height) : 'auto';
  } catch {
    return 'auto';
  }
}

function saveQuality(quality: Quality) {
  try {
    if (quality === 'auto') localStorage.removeItem(QUALITY_KEY);
    else localStorage.setItem(QUALITY_KEY, String(quality));
  } catch {
    // Private mode: the choice lasts this visit only.
  }
}

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

/** Auto: the smallest rendition that fills the player sharply, within what
 *  the connection allows, and never above `cap` (lowered by stalls). */
function autoHeight(playerHeight: number, cap: Height): Height {
  const network = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  let limit: Height = 1080;
  if (network?.saveData || network?.effectiveType === '2g' || network?.effectiveType === 'slow-2g') limit = 360;
  else if (network?.effectiveType === '3g') limit = 480;
  const needed = playerHeight * Math.min(window.devicePixelRatio || 1, 2) * 0.9;
  const fits = HEIGHTS.find((height) => height >= needed) ?? 1080;
  return Math.min(fits, limit, cap) as Height;
}

const lower = (height: Height): Height => HEIGHTS[Math.max(0, HEIGHTS.indexOf(height) - 1)];

/** A gilded medallion, in the proscenium's materials: gold ring, dark lacquer, a gold glyph. */
function Medallion({ label, onClick, size = 58, children, className = '' }: { label: string; onClick(): void; size?: number; children: ReactNode; className?: string }) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`grid place-items-center rounded-full p-[2px] transition-[transform,filter] duration-300 hover:scale-[1.07] hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9d3a8] ${className}`}
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

/** The quality pill and its menu: Auto (showing what it picked) or a fixed rendition. */
function QualityMenu({ quality, playingHeight, open, onOpen, onPick }: { quality: Quality; playingHeight: Height | null; open: boolean; onOpen(open: boolean): void; onPick(quality: Quality): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open, onOpen]);
  const options: Quality[] = ['auto', 1080, 720, 480, 360];
  const name = (q: Quality) => (q === 'auto' ? 'Auto' : `${q}p`);
  return (
    <div ref={ref} className='relative' onClick={(event) => event.stopPropagation()}>
      {open && (
        <div role='menu' aria-label='Video quality' className='absolute right-0 bottom-[calc(100%+8px)] min-w-[132px] overflow-hidden rounded-xl border border-[#e9d3a8]/30 bg-[#140e07]/90 py-1 shadow-[0_12px_32px_rgba(0,0,0,0.6)] backdrop-blur-md'>
          {options.map((q) => (
            <button
              key={q}
              type='button'
              role='menuitemradio'
              aria-checked={quality === q}
              onClick={() => onPick(q)}
              className='flex w-full items-center justify-between gap-4 px-3.5 py-1.5 text-left font-serif text-[13px] tracking-wide text-[#f4ead8]/85 transition-colors hover:bg-[#e9d3a8]/10 hover:text-[#f4ead8] focus-visible:bg-[#e9d3a8]/10 focus-visible:outline-none'
            >
              <span>
                {name(q)}
                {q === 'auto' && playingHeight !== null && quality === 'auto' && <span className='ml-1.5 text-[11px] text-[#e9d3a8]/55'>{playingHeight}p</span>}
              </span>
              <span aria-hidden='true' className='text-[11px]' style={{ color: GOLD, opacity: quality === q ? 1 : 0 }}>✦</span>
            </button>
          ))}
        </div>
      )}
      <button
        type='button'
        aria-haspopup='menu'
        aria-expanded={open}
        aria-label={`Video quality: ${name(quality)}${quality === 'auto' && playingHeight !== null ? ` (${playingHeight}p)` : ''}`}
        onClick={() => onOpen(!open)}
        className='flex items-center gap-1.5 rounded-full border border-[#e9d3a8]/40 bg-black/55 px-3 py-1 font-serif text-[12px] tracking-[0.12em] text-[#f4ead8]/90 uppercase shadow-[0_6px_16px_rgba(0,0,0,0.5)] backdrop-blur-md transition-colors hover:border-[#e9d3a8]/70 hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9d3a8]'
      >
        <span style={{ color: GOLD }}>{quality === 'auto' ? 'Auto' : `${quality}p`}</span>
        {quality === 'auto' && playingHeight !== null && <span className='text-[10px] tracking-normal text-[#e9d3a8]/55 normal-case'>{playingHeight}p</span>}
        <svg width='9' height='9' viewBox='0 0 10 10' aria-hidden='true' className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          <path d='M2 6.5 5 3.5 8 6.5' fill='none' stroke={GOLD} strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' />
        </svg>
      </button>
    </div>
  );
}

/**
 * The tour video inside the proscenium. It loads only as it nears the screen,
 * plays (muted, looping) while seen and pauses off screen — resuming only if
 * it was the one that paused (a visitor's own pause stays a pause). Reduced
 * motion: it waits for the play button.
 */
function TourPlayer({ reduced }: { reduced: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const freezeRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [quality, setQuality] = useState<Quality>(readQuality);
  const [cap, setCap] = useState<Height>(1080);
  const [playerHeight, setPlayerHeight] = useState(0);
  const [source, setSource] = useState<Height | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [shown, setShown] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [nudge, setNudge] = useState<-1 | 0 | 1>(0);
  /** Should it play whenever it is seen: yes until the visitor pauses it
   *  (or, with reduced motion, until they press play). */
  const wantsPlay = useRef(!reduced);
  const seen = useRef(false);
  const sourceRef = useRef<Height | null>(null);
  const idleTimer = useRef(0);

  const wanted: Height | null = playerHeight === 0 ? null : quality === 'auto' ? autoHeight(playerHeight, cap) : quality;

  // Near the screen: start loading. Seen: play (unless the visitor paused it); gone: pause.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const nearby = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setNear(true);
    }, { rootMargin: '50% 0px' });
    const visible = new IntersectionObserver(([entry]) => {
      seen.current = entry.isIntersecting;
      const video = videoRef.current;
      if (!video) return;
      if (!entry.isIntersecting && !video.paused) video.pause();
      else if (entry.isIntersecting && wantsPlay.current && video.paused && video.currentSrc) void video.play().catch(() => {});
    });
    const size = new ResizeObserver(([entry]) => setPlayerHeight(entry.contentRect.height));
    nearby.observe(box);
    visible.observe(box);
    size.observe(box);
    return () => {
      nearby.disconnect();
      visible.disconnect();
      size.disconnect();
    };
  }, []);

  // The rendition to play changed: switch at the same moment, holding the
  // current picture over the video until the new one shows.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !near || wanted === null || wanted === sourceRef.current) return undefined;
    const at = video.currentTime;
    if (sourceRef.current !== null && video.readyState >= 2) {
      const canvas = freezeRef.current;
      if (canvas) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')?.drawImage(video, 0, 0);
        setFrozen(true);
      }
    }
    sourceRef.current = wanted;
    setSource(wanted);
    video.src = videoUrl(wanted);
    const onLoaded = () => {
      if (at > 0) video.currentTime = at;
      if (seen.current && wantsPlay.current) void video.play().catch(() => {});
    };
    const onShown = () => setFrozen(false);
    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    video.addEventListener('playing', onShown, { once: true });
    video.addEventListener('seeked', onShown, { once: true });
    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('playing', onShown);
      video.removeEventListener('seeked', onShown);
    };
  }, [near, wanted]);

  // Auto steps down a rendition when playback stalls for a while.
  useEffect(() => {
    if (!buffering || quality !== 'auto' || source === null || source === 360) return undefined;
    const timer = window.setTimeout(() => setCap(lower(source)), STALL_MS);
    return () => window.clearTimeout(timer);
  }, [buffering, quality, source]);

  // Controls: shown while the pointer moves over the player, faded out once it
  // rests (or leaves); kept while the quality menu is open or a control has
  // the keyboard's focus. Touch: a tap shows them for a while.
  const poke = useCallback(() => {
    setShown(true);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setShown(false), IDLE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(idleTimer.current), []);

  const video = () => videoRef.current;
  const toggle = () => {
    const v = video();
    if (!v) return;
    wantsPlay.current = v.paused;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
    poke();
  };
  const skip = (dir: -1 | 1) => {
    const v = video();
    if (!v || !Number.isFinite(v.duration)) return;
    v.currentTime = (((v.currentTime + dir * 10) % v.duration) + v.duration) % v.duration;
    setNudge(dir);
    window.setTimeout(() => setNudge(0), 450);
    poke();
  };
  const pick = (next: Quality) => {
    setQuality(next);
    saveQuality(next);
    setMenuOpen(false);
    poke();
  };

  const controlsOn = shown || menuOpen;
  // Hidden controls take no clicks (a click there plays or pauses instead).
  const fade = `transition-opacity duration-300 ease-out ${controlsOn ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`;
  return (
    <div
      ref={boxRef}
      role='region'
      aria-label='Nodestra — an animated tour of the app'
      className={`relative aspect-[16/10] w-full overflow-hidden bg-black ${!controlsOn && playing ? 'cursor-none' : ''}`}
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse') poke();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse' || menuOpen) return;
        window.clearTimeout(idleTimer.current);
        setShown(false);
      }}
      onPointerUp={(event) => {
        if (event.pointerType !== 'mouse') poke();
      }}
      onClick={(event) => {
        // A mouse click on the picture plays or pauses; a tap only shows the controls.
        if ((event.nativeEvent as PointerEvent).pointerType !== 'touch' && (event.nativeEvent as PointerEvent).pointerType !== 'pen') toggle();
      }}
      onFocus={(event) => {
        // Keyboard focus keeps the controls up; a mouse click's focus does not.
        if (!(event.target as HTMLElement).matches(':focus-visible')) return;
        window.clearTimeout(idleTimer.current);
        setShown(true);
      }}
      onBlur={poke}
    >
      <video
        ref={videoRef}
        muted
        loop
        playsInline
        preload={near ? 'auto' : 'none'}
        poster={`${TOUR_DIR}poster.jpg`}
        aria-hidden='true'
        className='absolute inset-0 block h-full w-full object-cover'
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
      />
      {/* The picture before a quality switch, until the new rendition shows. */}
      <canvas ref={freezeRef} aria-hidden='true' className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${frozen ? 'block' : 'hidden'}`} />

      {/* Buffering: a small gold spinner, late, so a short wait does not flash it. */}
      <div
        aria-hidden='true'
        className={`pointer-events-none absolute top-[5%] right-[3%] grid h-9 w-9 place-items-center rounded-full transition-opacity ${buffering && playing ? 'opacity-100 delay-300 duration-300' : 'opacity-0 duration-200'}`}
        style={{ background: 'radial-gradient(circle at 35% 30%, #5a3f16, #241707 70%)', boxShadow: 'inset 0 0 0 1px rgba(233,211,168,0.4), 0 6px 16px rgba(0,0,0,0.6)' }}
      >
        <svg width='22' height='22' viewBox='0 0 22 22' className='animate-spin motion-reduce:animate-none'>
          <circle cx='11' cy='11' r='8' fill='none' stroke={GOLD} strokeOpacity='.25' strokeWidth='2' />
          <path d='M11 3a8 8 0 0 1 8 8' fill='none' stroke={GOLD} strokeWidth='2' strokeLinecap='round' />
        </svg>
      </div>
      <span role='status' className='sr-only'>{buffering && playing ? 'Loading the tour' : ''}</span>

      {/* A soft shade behind the controls, so gold reads on bright frames. */}
      <div aria-hidden='true' className={`pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.38),transparent_62%),linear-gradient(to_top,rgba(0,0,0,0.45),transparent_28%)] ${fade}`} />

      <div className='pointer-events-none absolute inset-0 flex items-center justify-between px-[3%]'>
        <div className={fade}>
          <Medallion label='Back 10 seconds' onClick={() => skip(-1)} className={nudge === -1 ? '-translate-x-1' : ''}>
            <SkipGlyph dir={-1} />
          </Medallion>
        </div>
        {/* Play / pause: also kept up while paused, so a paused tour says so. */}
        <div className={`flex flex-col items-center gap-2 transition-opacity duration-300 ease-out ${controlsOn || !playing ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}>
          <Medallion label={playing ? 'Pause' : 'Play'} onClick={toggle} size={74}>
            {playing ? (
              <svg width='26' height='26' viewBox='0 0 26 26' aria-hidden='true'><rect x='6' y='4' width='5' height='18' rx='1.2' fill={GOLD} /><rect x='15' y='4' width='5' height='18' rx='1.2' fill={GOLD} /></svg>
            ) : (
              <svg width='28' height='28' viewBox='0 0 28 28' aria-hidden='true'><path d='M9 5.5v17a1 1 0 0 0 1.5.86l13-8.5a1 1 0 0 0 0-1.72l-13-8.5A1 1 0 0 0 9 5.5z' fill={GOLD} /></svg>
            )}
          </Medallion>
          {/* a small flourish under the centre medallion, like the arch's ornament */}
          <svg width='110' height='14' viewBox='0 0 110 14' aria-hidden='true'>
            <path d='M2 7 Q22 -1 42 7 M108 7 Q88 -1 68 7' fill='none' stroke={GOLD} strokeOpacity='.7' strokeWidth='1.3' strokeLinecap='round' />
            <circle cx='55' cy='7' r='3' fill='none' stroke={GOLD} strokeWidth='1.3' />
          </svg>
        </div>
        <div className={fade}>
          <Medallion label='Forward 10 seconds' onClick={() => skip(1)} className={nudge === 1 ? 'translate-x-1' : ''}>
            <SkipGlyph dir={1} />
          </Medallion>
        </div>
      </div>

      <div className={`absolute right-[3%] bottom-[5%] ${fade}`}>
        <QualityMenu quality={quality} playingHeight={source} open={menuOpen} onOpen={setMenuOpen} onPick={pick} />
      </div>
    </div>
  );
}

export { autoHeight, TourPlayer };

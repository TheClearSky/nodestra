import { useEffect, useRef, useState } from 'react';
import type { Mood, Rect } from '@theclearsky/easy-tutorial-builder';
import type { BlipScene } from './blipScene';
import { chirp } from './blipVoice';

/**
 * Blip on the page: the three.js character (lazy chunk) when motion is
 * welcome, otherwise an SVG twin with the same face — reduced motion, small
 * screens, no WebGL, a lost context, and the moment before the chunk loads.
 * Purely decorative (aria-hidden); the bubble carries every word.
 */

const WIDTH = 180;
const HEIGHT = 180;
/** Chirp/flap cadence while a line is "being said". */
const TALK_TICK_MS = 80;
const MS_PER_CHARACTER = 30;
const MAX_TALK_MS = 3500;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/**
 * The SVG twin, drawn to match the 3D Blip (same proportions: 75 px per
 * world unit, feet at y = 161): a round bean with headphones, a bow tie and
 * a baton. `mouth`/`happyEyes` mirror the 3D moods.
 */
const FACES: Record<Mood, { happyEyes: boolean; mouth: 'smile' | 'grin' | 'o' | 'frown'; arms: number }> = {
  neutral: { happyEyes: false, mouth: 'smile', arms: 0 },
  happy: { happyEyes: true, mouth: 'grin', arms: 10 },
  excited: { happyEyes: false, mouth: 'grin', arms: 35 },
  thinking: { happyEyes: false, mouth: 'o', arms: 0 },
  pointing: { happyEyes: false, mouth: 'grin', arms: 0 },
  surprised: { happyEyes: false, mouth: 'o', arms: 20 },
  concerned: { happyEyes: false, mouth: 'frown', arms: -5 },
  celebrate: { happyEyes: true, mouth: 'grin', arms: 70 },
};

type Direction = { dx: number; dy: number } | null;

const INK = '#1b1530';

function BlipSvg({ mood, talking, direction, pointing }: { mood: Mood; talking: boolean; direction: Direction; pointing: boolean }) {
  const face = FACES[mood];
  const lookX = (direction?.dx ?? 0) * 2.5;
  const lookY = (direction?.dy ?? 0) * 2.5;
  // Capped below vertical, as in 3D: an arm straight up hides by the head.
  const pointAngle = direction ? Math.max(-63, (Math.atan2(direction.dy, Math.abs(direction.dx)) * 180) / Math.PI) : 0;
  const pointLeft = pointing && direction !== null && direction.dx < 0;
  const pointRight = pointing && direction !== null && direction.dx >= 0;
  const mouth = talking ? 'grin' : face.mouth;
  const leftAngle = pointLeft ? 90 - pointAngle : 20 + face.arms;
  const rightAngle = pointRight ? -90 + pointAngle : -20 - face.arms;
  // The baton sits in the pointing hand (right when idle): up and out at
  // rest, straight along the arm when pointing.
  const batonLeft = pointLeft;
  const batonHold = pointLeft || pointRight ? 0 : batonLeft ? 115 : -115;
  const arm = (x: number, angle: number, baton: boolean) => (
    <g transform={`rotate(${angle} ${x} 130)`}>
      {baton && (
        <g transform={`rotate(${batonHold} ${x} 150)`}>
          <line x1={x} y1='150' x2={x} y2='178' stroke='#fff' strokeWidth='2' strokeLinecap='round' />
          <circle cx={x} cy='150' r='2.6' fill='#f59e0b' />
        </g>
      )}
      <rect x={x - 6.5} y='124' width='13' height='28' rx='6.5' fill='#6a4ff0' stroke='#b444d8' strokeWidth='1.5' />
    </g>
  );
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT} className='absolute inset-0'>
      {/* headphone band, behind the head */}
      <path d='M39 116 A 51 49 0 0 1 141 116' fill='none' stroke='#f59e0b' strokeWidth='6' strokeLinecap='round' />
      <path d='M90 70 C 122 70, 142 100, 142 126 C 142 150, 128 161, 90 161 C 52 161, 38 150, 38 126 C 38 100, 58 70, 90 70 Z' fill='#7b5cff' stroke='#b444d8' strokeWidth='2.5' />
      {/* ear cups */}
      <rect x='30' y='101' width='12' height='29' rx='5' fill='#f59e0b' stroke='#2a2440' strokeWidth='2' />
      <rect x='138' y='101' width='12' height='29' rx='5' fill='#f59e0b' stroke='#2a2440' strokeWidth='2' />
      <g fill='#ff5f9e' opacity='0.55'>
        <ellipse cx='60' cy='128' rx='8' ry='5' />
        <ellipse cx='120' cy='128' rx='8' ry='5' />
      </g>
      {[71, 109].map((x) =>
        face.happyEyes ? (
          <path key={x} d={`M${x - 7} ${119} Q${x} ${108} ${x + 7} ${119}`} fill='none' stroke={INK} strokeWidth='3.5' strokeLinecap='round' />
        ) : (
          <g key={x}>
            <ellipse cx={x} cy='116' rx='10.5' ry='12' fill='#fff' />
            <ellipse cx={x + lookX} cy={116 + lookY} rx='8' ry='9' fill={INK} />
            <circle cx={x + lookX + 2.6} cy={112.5 + lookY} r='3' fill='#fff' />
            <circle cx={x + lookX - 2.6} cy={120 + lookY} r='1.4' fill='#fff' />
          </g>
        ),
      )}
      {mouth === 'smile' && <path d='M85 131 Q90 136 95 131' fill='none' stroke={INK} strokeWidth='2.4' strokeLinecap='round' />}
      {mouth === 'grin' && (
        <g>
          <path d={`M83 129 H97 A7 ${talking ? 8 : 6.5} 0 0 1 83 129 Z`} fill='#5a1030' />
          <ellipse cx='90' cy={talking ? 135 : 133.5} rx='3.2' ry='2' fill='#ff5f9e' />
        </g>
      )}
      {mouth === 'o' && <ellipse cx='90' cy='131' rx='3.5' ry='4.5' fill='#5a1030' />}
      {mouth === 'frown' && <path d='M86 134 Q90 129.5 94 134' fill='none' stroke={INK} strokeWidth='2.4' strokeLinecap='round' />}
      {/* bow tie */}
      <g fill='#ff5f9e'>
        <path d='M90 145 L79 139 L79 151 Z' />
        <path d='M90 145 L101 139 L101 151 Z' />
        <circle cx='90' cy='145' r='3' />
      </g>
      {arm(42, leftAngle, batonLeft)}
      {arm(138, rightAngle, !batonLeft)}
    </svg>
  );
}

type BlipCharacterProps = {
  mood: Mood;
  /** The line being said (plain text); a new line makes Blip talk. */
  speech: string;
  /** Saying the same words again (a new step) talks again. */
  speechId?: string;
  /** What the current step points at, if anything. */
  focus: Rect | null;
  pointing: boolean;
};

function BlipCharacter({ mood, speech, speechId, focus, pointing }: BlipCharacterProps) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const smallScreen = useMediaQuery('(max-width: 640px)');
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [talking, setTalking] = useState(false);
  const [origin, setOrigin] = useState<DOMRect | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BlipScene | null>(null);
  const useWebgl = !reducedMotion && !smallScreen && !failed;

  // The canvas is made here, not in JSX: a disposed renderer force-loses its
  // context, and a remount (StrictMode, fallback and back) needs a fresh one.
  useEffect(() => {
    const host = hostRef.current;
    if (!useWebgl || !host) return;
    let disposed = false;
    const canvas = document.createElement('canvas');
    canvas.style.width = `${WIDTH}px`;
    canvas.style.height = `${HEIGHT}px`;
    const onLost = (event: Event) => {
      event.preventDefault();
      setFailed(true);
    };
    canvas.addEventListener('webglcontextlost', onLost);
    host.appendChild(canvas);
    import('./blipScene')
      .then(({ createBlip }) => {
        if (disposed) return;
        const scene = createBlip(canvas);
        scene.resize(WIDTH, HEIGHT);
        sceneRef.current = scene;
        setReady(true);
      })
      .catch((error: unknown) => {
        console.warn('[blip] 3D guide unavailable, using the drawing', error);
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      canvas.removeEventListener('webglcontextlost', onLost);
      sceneRef.current?.dispose();
      sceneRef.current = null;
      canvas.remove();
      setReady(false);
    };
  }, [useWebgl]);

  useEffect(() => {
    sceneRef.current?.setMood(mood);
  }, [mood, ready]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    setOrigin(rect);
    sceneRef.current?.setOrigin(rect);
    sceneRef.current?.setFocus(focus ? { x: focus.x + focus.width / 2, y: focus.y + focus.height / 2 } : null, pointing);
  }, [focus, pointing, ready]);

  useEffect(() => {
    if (!speech) return;
    const talkMs = Math.min(MAX_TALK_MS, speech.length * MS_PER_CHARACTER);
    let open = false;
    const tick = window.setInterval(() => {
      sceneRef.current?.talkPulse();
      chirp();
      open = !open;
      if (!reducedMotion) setTalking(open);
    }, TALK_TICK_MS);
    const stop = window.setTimeout(() => {
      window.clearInterval(tick);
      setTalking(false);
    }, talkMs);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(stop);
      setTalking(false);
    };
  }, [speech, speechId, reducedMotion]);

  let direction: Direction = null;
  if (focus && origin) {
    const vx = focus.x + focus.width / 2 - (origin.left + origin.width / 2);
    const vy = focus.y + focus.height / 2 - (origin.top + origin.height * 0.5);
    const length = Math.hypot(vx, vy) || 1;
    direction = { dx: vx / length, dy: vy / length };
  }

  return (
    <div aria-hidden='true' data-blip={ready ? 'webgl' : 'svg'} className='pointer-events-none relative shrink-0' style={{ width: WIDTH, height: HEIGHT }}>
      <div className='absolute bottom-2 left-1/2 h-3 w-24 -translate-x-1/2 rounded-[50%] bg-black/45 blur-[3px]' />
      {!ready && <BlipSvg mood={mood} talking={talking} direction={direction} pointing={pointing} />}
      <div ref={hostRef} className='absolute inset-0' />
    </div>
  );
}

export { BlipCharacter };

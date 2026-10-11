import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  getOctaveShift,
  octaveLabel,
  onKeyBusEvent,
  pressKey,
  releaseKey,
  shiftOctave,
} from '../audio/keyboardBus';
import { KEY_ORDER, KEY_TO_SEMITONE } from '../audio/keyMap';
import type { KeyName } from '../audio/keyMap';
import {
  attemptScene,
  isKeyName,
  isSceneReady,
  keyHeightFor,
  keyWidthFor,
  MEADOW_LOAD_TIMEOUT_MS,
  SHORT_SCREEN,
} from './gateLogic';
import { HELL_FINISH_CHOICES, loadHellFinish, saveHellFinish } from './hellFinish';
import type { HellFinishChoice } from './hellFinish';
import { loadVisited, nextUnvisited, saveVisited, unvisitedCount } from './sceneTour';
import { createStageScene, FLIGHT_SECONDS } from './stageScene';
import type { StageScene } from './stageScene';
import type { MeadowKind, MeadowScene } from './meadow';

/** What the stage's play buttons play: the piano on this stage, or one of
 *  the other scenes (2026-10-04: the guitar under the oak, and the organ
 *  under the sakura — "organ demo suits sakura scene the best"; 2026-10-11:
 *  the Vampire Synth on the castle roof in the hellscape). */
type LandingInstrument = 'piano' | MeadowKind | 'hell';
/** The scenes drawn on a canvas of their own, over the paused piano stage. */
type SideKind = Exclude<LandingInstrument, 'piano'>;
/** What the gate drives on such a scene — the meadows' API, plus the
 *  hellscape's auto demo. */
type SideScene = Pick<MeadowScene, 'resize' | 'renderNow' | 'setLive' | 'setLiveKey' | 'dispose'> & {
  /** Compile the scene's shaders off the main thread before its first frame
   *  (the hellscape's would otherwise block the page for seconds). */
  warm?(): Promise<void>;
  /** The hellscape's finish (Anime finish / Painted cel). */
  setFinish?(finish: HellFinishChoice): void;
  playDemo?(): void;
  stopDemo?(): void;
};

/**
 * The gate's scenes, in arrow order (2026-10-04, Deepak: "a left and right
 * arrow button that can change the piano scenes to other scenes … 'play
 * guitar' … should only appear on the guitar scene"). Each scene has exactly
 * one play button: its own instrument. A record over every instrument, so a
 * new meadow kind cannot be left without a scene.
 */
const SCENE_INFO = {
  piano: { title: 'The stage', play: '🎹 Play the piano', tab: 'Piano' },
  guitar: { title: 'Under the oak', play: '🎸 Play the guitar', tab: 'Guitar' },
  sakura: { title: 'Under the sakura', play: '🌸 Play the organ', tab: 'Organ' },
  // 2026-10-11, Deepak: "fit it along with other scenes like the piano,
  // guitar and organ scene as the 4th scene, have same buttons, including the
  // piano sheet. just have one extra button to play/stop the auto demo".
  hell: { title: 'The hellscape', play: '🦇 Play the Vampire Synth', tab: 'Synth' },
} satisfies Record<LandingInstrument, { title: string; play: string; tab: string }>;
/** The scenes in arrow order: the record's own key order. */
const SCENES = (Object.keys(SCENE_INFO) as LandingInstrument[]).map((id) => ({ id, ...SCENE_INFO[id] }));
const SCENE_IDS = SCENES.map((candidate) => candidate.id);

/** A scene whose keys start somewhere other than the visitor's octave
 *  (octaves from C4): the hellscape's synth plays from C2, where its demo
 *  sits (2026-10-11, Deepak: "set to default c2"). The visitor's own octave
 *  comes back when they leave the scene. */
const SCENE_OCTAVE: Partial<Record<LandingInstrument, number>> = { hell: -2 };

/** The scene hints (2026-10-11, Deepak: "Make it clear that there are more
 *  scenes … display a tooltip … for a few seconds … Once in the scene,
 *  display a tooltip on the back button"): shown after a beat, for a while. */
const HINT_DELAY_MS = 1200;
const HINT_SHOW_MS = 7000;
const BACK_HINT_DELAY_MS = 1800;

/** Back from a meadow: the camera's own back-off (guitar 3.5 s — its 7 s
 *  tour replayed at 2x; sakura 3.4 s, the straight line). */
const MEADOW_BACKOFF_MS = 3500;
/** On a meadow from tablet width up, the play keys sit in the bottom-right
 *  corner (the instrument — the organ's own manual — is bottom-centre and
 *  must stay visible), so their two text lines get a dark pill instead of
 *  the full-width gradient. */
const MEADOW_PILL = 'sm:rounded-full sm:bg-black/50 sm:px-3 sm:py-0.5 sm:text-[#e9d3a8] sm:backdrop-blur-md';
/** A scene switch dips to black for this long, swaps behind it, lifts. */
const SWITCH_VEIL_MS = 280;

type StageLandingProps = {
  audioReady: boolean;
  starting: boolean;
  startError?: string;
  onStart(): void;
  /** Start audio AND put the instrument's playable demo on a borrowed canvas. */
  onPlayInstrument(instrument: LandingInstrument): void;
  /** Leaving the piano: give the canvas back to the file that was open.
   *  Settles once the file is back on the canvas. */
  onLeavePiano(): Promise<void>;
  /** Whether the stage hides the app completely (everything but the reveal). */
  onCoveringChange(covering: boolean): void;
  /** The app is revealed; unmount the stage. */
  onDone(): void;
};

/**
 * idle      a scene; drag to look around, the arrows change scene, the
 *           buttons start audio or play the scene's instrument
 * piano     playing: the QWERTY keys play the scene's instrument and the
 *           scene follows them (3D keys, strings, organ pipes)
 * flying    the camera flies into the piano (or, from a meadow, a short
 *           fade) and the view fades to black
 * dark      black, waiting for audio if it is still starting
 * revealing the black lifts off the app
 */
type Phase = 'idle' | 'piano' | 'flying' | 'dark' | 'revealing';

const SKIP_FADE_MS = 300;
const REVEAL_MS = 700;

const afterTwoFrames = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** A failed return of the visitor's file to the canvas is the gate's most
 *  important failure (the app would open without the file): logged, never
 *  swallowed. */
const logReturnFailure = (error: unknown) =>
  console.error('[landing] could not give the canvas back to the open file', error);

const A0_MIDI = 21;
const WHITE_SEMITONES = new Set([0, 2, 4, 5, 7, 9, 11, 12, 14, 16]);

/** The 3D key (0 = A0) a QWERTY key plays at the current octave window —
 *  the same pitch the keyboard bus sends the piano. */
function stageKeyFor(key: KeyName): number {
  return 60 + KEY_TO_SEMITONE[key] + 12 * getOctaveShift() - A0_MIDI;
}

/** A white key's width for the window, live. Only the width itself is
 *  state, so a resize re-renders the gate only when the keys change size
 *  (not on every resize event of a window drag or a phone's URL bar). */
function useKeyWidth(touch: boolean): number {
  const [width, setWidth] = useState(() => keyWidthFor(window.innerWidth, touch));
  useEffect(() => {
    const update = () => setWidth(keyWidthFor(window.innerWidth, touch));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [touch]);
  return width;
}

/** Whether a media query matches, live. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/**
 * The QWERTY keys as a little keyboard, lit while held — and playable: click
 * or tap a key to sound it, hold to sustain, slide across keys for a
 * glissando, several fingers for a chord. Presses go through the keyboard
 * bus exactly like the computer keys, so the sound, the lit key and the 3D
 * key all follow the same way.
 *
 * `keyWidth` / `keyHeight` size a white key; the black keys and labels scale
 * with them (34 x 92 is the desktop size).
 */
function KeyLegend({
  held,
  playable,
  keyWidth,
  keyHeight,
}: {
  held: ReadonlySet<KeyName>;
  playable: boolean;
  keyWidth: number;
  keyHeight: number;
}) {
  const whites = KEY_ORDER.filter((key) => WHITE_SEMITONES.has(KEY_TO_SEMITONE[key]));
  const blacks = KEY_ORDER.filter((key) => !WHITE_SEMITONES.has(KEY_TO_SEMITONE[key]));
  const blackWidth = Math.round((keyWidth * 20) / 34);
  const blackHeight = Math.round((keyHeight * 56) / 92);
  const labelPx = keyWidth < 30 ? 10 : 12;
  // Which key each pointer (mouse, pen, finger) is holding, and how many
  // pointers hold each key — two fingers on one key release it only when
  // both lift.
  const pointerKeys = useRef(new Map<number, KeyName>());
  const holders = useRef(new Map<KeyName, number>());

  const hold = (key: KeyName) => {
    holders.current.set(key, (holders.current.get(key) ?? 0) + 1);
    // Idempotent, and it also re-sounds a key the bus let go on its own
    // (window blur releases everything).
    pressKey(key);
  };
  const letGo = (key: KeyName) => {
    const count = holders.current.get(key) ?? 0;
    if (count <= 1) {
      holders.current.delete(key);
      releaseKey(key);
    } else {
      holders.current.set(key, count - 1);
    }
  };
  /** The key under a screen point (black keys sit on top of white ones). */
  const keyAt = (x: number, y: number): KeyName | undefined => {
    const element = document.elementFromPoint(x, y);
    const key = element?.closest<HTMLElement>('[data-piano-key]')?.dataset.pianoKey;
    return isKeyName(key) ? key : undefined;
  };
  const move = (pointerId: number, next: KeyName | undefined) => {
    const current = pointerKeys.current.get(pointerId);
    if (current === next) return;
    if (current !== undefined) letGo(current);
    if (next === undefined) pointerKeys.current.delete(pointerId);
    else {
      pointerKeys.current.set(pointerId, next);
      hold(next);
    }
  };
  const end = (pointerId: number) => {
    const current = pointerKeys.current.get(pointerId);
    if (current !== undefined) letGo(current);
    pointerKeys.current.delete(pointerId);
  };

  // Leaving the piano (unmount) lets every held key go.
  useEffect(() => {
    const pointers = pointerKeys.current;
    const counts = holders.current;
    return () => {
      for (const key of counts.keys()) releaseKey(key);
      counts.clear();
      pointers.clear();
    };
  }, []);

  return (
    <div
      role='group'
      aria-label='Piano keys — click or tap to play'
      className={`relative shrink-0 touch-none select-none ${playable ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'}`}
      style={{ width: whites.length * keyWidth, height: keyHeight }}
      onPointerDown={(event) => {
        if (!playable || (event.pointerType === 'mouse' && event.button !== 0)) return;
        event.preventDefault();
        // Keep receiving this pointer's moves even outside a key, so a slide
        // off the keyboard lets the note go and a slide back plays again.
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event.pointerId, keyAt(event.clientX, event.clientY));
      }}
      onPointerMove={(event) => {
        if (!pointerKeys.current.has(event.pointerId) && !event.currentTarget.hasPointerCapture(event.pointerId)) {
          return;
        }
        move(event.pointerId, keyAt(event.clientX, event.clientY));
      }}
      onPointerUp={(event) => end(event.pointerId)}
      onPointerCancel={(event) => end(event.pointerId)}
      onLostPointerCapture={(event) => end(event.pointerId)}
      onContextMenu={(event) => event.preventDefault()}
    >
      {whites.map((key, index) => (
        <div
          key={key}
          data-piano-key={key}
          className={`absolute top-0 flex items-end justify-center rounded-b-md border border-black/60 pb-1.5 font-semibold uppercase transition-colors duration-75 ${held.has(key) ? 'bg-[#f3cf8a] text-black' : 'bg-[#efe9dc] text-black/60'}`}
          style={{ left: index * keyWidth, width: keyWidth - 2, height: keyHeight, fontSize: labelPx }}
        >
          {key}
        </div>
      ))}
      {blacks.map((key) => {
        const whitesBefore = whites.filter((white) => KEY_TO_SEMITONE[white] < KEY_TO_SEMITONE[key]).length;
        return (
          <div
            key={key}
            data-piano-key={key}
            className={`absolute top-0 z-10 flex items-end justify-center rounded-b-md pb-1 font-semibold uppercase transition-colors duration-75 ${held.has(key) ? 'bg-[#c9973f] text-black' : 'bg-[#141414] text-white/70'}`}
            style={{
              left: whitesBefore * keyWidth - Math.round(blackWidth / 2) - 1,
              width: blackWidth,
              height: blackHeight,
              fontSize: labelPx - 1,
            }}
          >
            {key}
          </div>
        );
      })}
    </div>
  );
}

/** A gilded round arrow at the side of the screen (scene switching). */
function SceneArrow({ side, label, onClick }: { side: 'left' | 'right'; label: string; onClick(): void }) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`pointer-events-auto absolute top-1/2 grid h-12 w-12 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-[#e9d3a8]/35 bg-black/35 text-[#e9d3a8] shadow-[0_0_28px_rgba(255,190,110,0.18)] backdrop-blur-md transition-colors hover:bg-black/55 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9d3a8] sm:h-14 sm:w-14 ${side === 'left' ? 'left-3 sm:left-6' : 'right-3 sm:right-6'}`}
    >
      <svg viewBox='0 0 24 24' aria-hidden='true' className='h-6 w-6' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
        <path d={side === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
      </svg>
    </button>
  );
}

/** A scene's tab icon: the piano, the guitar, the organ, the bat (24 × 24,
 *  in the text colour). */
function SceneIcon({ id }: { id: LandingInstrument }) {
  const className = 'h-5 w-5 shrink-0 transition-transform duration-300 ease-out group-hover:-rotate-6 group-hover:scale-115';
  if (id === 'piano') {
    return (
      <svg viewBox='0 0 24 24' aria-hidden='true' className={className} fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinejoin='round'>
        <rect x='3' y='5' width='18' height='14' rx='2' />
        <path d='M7.5 19v-5.5M12 19v-5.5M16.5 19v-5.5' />
        <path d='M6.4 5.8h2.2v7.7H6.4zM10.9 5.8h2.2v7.7h-2.2zM15.4 5.8h2.2v7.7h-2.2z' fill='currentColor' stroke='none' />
      </svg>
    );
  }
  if (id === 'guitar') {
    return (
      <svg viewBox='0 0 24 24' aria-hidden='true' className={className} fill='currentColor'>
        <g transform='rotate(45 12 12)'>
          <rect x='11.15' y='2.4' width='1.7' height='9' rx='0.6' />
          <rect x='10.4' y='0.9' width='3.2' height='2.8' rx='0.9' />
          <circle cx='12' cy='13.4' r='3.3' />
          <circle cx='12' cy='17.7' r='4.2' />
          <circle cx='12' cy='14.9' r='1.25' fill='#120b0a' />
        </g>
      </svg>
    );
  }
  if (id === 'sakura') {
    // The organ: a towered façade of pipes on a case.
    return (
      <svg viewBox='0 0 24 24' aria-hidden='true' className={className} fill='currentColor'>
        {[
          [3.5, 11],
          [6.6, 8],
          [9.7, 5],
          [12.8, 5],
          [15.9, 8],
          [19, 11],
        ].map(([x, top]) => (
          <rect key={x} x={x} y={top} width='1.9' height={18.5 - top} rx='0.95' />
        ))}
        <rect x='2.5' y='18.5' width='19' height='3' rx='0.8' />
      </svg>
    );
  }
  return (
    <svg viewBox='0 0 24 24' aria-hidden='true' className={className} fill='currentColor'>
      <path d='M12 7.6c-.7 0-1.25.55-1.45 1.2L9.7 7.5l-.4 1.8C7.4 9 4.9 9.7 1.8 12c1.65-.1 2.85.4 3.45 1.45.95-.8 2.25-1 3.15-.4.3.95 1.2 1.7 2.25 1.9L12 17.4l1.35-2.45c1.05-.2 1.95-.95 2.25-1.9.9-.6 2.2-.4 3.15.4.6-1.05 1.8-1.55 3.45-1.45-3.1-2.3-5.6-3-7.5-2.7l-.4-1.8-.85 1.3c-.2-.65-.75-1.2-1.45-1.2z' />
    </svg>
  );
}

/**
 * The scenes as tabs along the top (2026-10-11, Deepak: "have 4 stylized
 * buttons at the top with piano icon, guitar icon, organ icon and bat icon
 * with hover effects like tab, follow the style"): the gilded glass of the
 * arrows; the current scene lit, the others lifting and underlined on hover;
 * a scene not yet played carries a small gold dot, and the one suggested
 * next a slow glow.
 */
function SceneTabs({
  current,
  visited,
  suggested,
  hint,
  onPick,
}: {
  current: LandingInstrument;
  visited: ReadonlySet<LandingInstrument>;
  /** The tab to point at (glow, and the hint under it); null for none. */
  suggested: LandingInstrument | null;
  /** The hint bubble, drawn under the suggested tab (2026-10-11, Deepak:
   *  "make the tooltip appear on the exact button not on the whole tab"). */
  hint: { visible: boolean; text: ReactNode; onClick(): void } | null;
  onPick(id: LandingInstrument): void;
}) {
  return (
    <nav
      aria-label='Scenes'
      className='pointer-events-auto absolute top-[max(1rem,env(safe-area-inset-top))] left-1/2 flex -translate-x-1/2 gap-1 rounded-full border border-[#e9d3a8]/25 bg-black/35 p-1 shadow-[0_0_28px_rgba(255,190,110,0.16)] backdrop-blur-md'
    >
      {SCENES.map((candidate, index) => {
        const active = candidate.id === current;
        const fresh = !visited.has(candidate.id);
        // The bubble hangs from its tab: centred under it, or held to the
        // bar's edge under the first and last tab so a phone never clips it
        // (its caret still points at the tab).
        const edge =
          index === 0
            ? 'left-0 before:left-5'
            : index === SCENES.length - 1
              ? 'right-0 before:right-5'
              : 'left-1/2 -translate-x-1/2 before:left-1/2 before:-translate-x-1/2';
        return (
          <div key={candidate.id} className='relative'>
            <button
              type='button'
              aria-current={active ? 'true' : undefined}
              aria-label={`${candidate.title}${fresh ? ' — not played yet' : ''}`}
              title={candidate.title}
              onClick={() => onPick(candidate.id)}
              className={`group relative flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-2 text-[13px] transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9d3a8] sm:px-4 ${active ? 'bg-[#e9d3a8]/16 text-[#f6e7c8] shadow-[inset_0_0_0_1px_rgba(233,211,168,0.5),0_0_18px_rgba(255,190,110,0.3)]' : 'text-[#e9d3a8]/65 hover:-translate-y-px hover:bg-white/8 hover:text-[#f6e7c8]'}`}
            >
              {candidate.id === suggested && !active && (
                <span aria-hidden='true' className='pointer-events-none absolute inset-0 rounded-full ring-1 ring-[#f3cf8a]/70 motion-safe:animate-pulse' />
              )}
              <SceneIcon id={candidate.id} />
              <span className='hidden sm:inline'>{candidate.tab}</span>
              <span
                aria-hidden='true'
                className={`pointer-events-none absolute inset-x-3 -bottom-px h-px bg-linear-to-r from-transparent via-[#f3cf8a] to-transparent transition-transform duration-300 ${active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'}`}
              />
              {fresh && (
                <span aria-hidden='true' className='pointer-events-none absolute top-1 right-1.5 h-1.5 w-1.5 rounded-full bg-[#f3cf8a] shadow-[0_0_6px_#f3cf8a]' />
              )}
            </button>
            {hint && candidate.id === suggested && (
              <button
                type='button'
                aria-hidden={!hint.visible}
                tabIndex={hint.visible ? 0 : -1}
                onClick={hint.onClick}
                className={`absolute top-[calc(100%+0.85rem)] w-max max-w-[min(17rem,calc(100vw-2rem))] cursor-pointer text-center sm:max-w-none ${edge} ${HINT_BUBBLE} ${hint.visible ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none -translate-y-1 opacity-0'}`}
              >
                {hint.text}
              </button>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * The gate's two buttons trade looks (2026-10-11, Deepak: "when a scene
 * hasn't been played, always highlight the 'play the' button instead of
 * enter the app, on all scenes, if it has been played, then highlight the
 * other button"): the highlighted one is the bright, glowing glass; the other
 * the quiet dark one. Sizes are shared, so nothing moves when they swap.
 */
const GATE_BUTTON =
  'cursor-pointer rounded-full border px-7 py-3.5 backdrop-blur-md transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9d3a8] disabled:cursor-wait sm:px-9 sm:py-4 [@media(max-height:520px)]:px-5 [@media(max-height:520px)]:py-2.5';
const GATE_PRIMARY =
  'border-[#e9d3a8]/50 bg-white/10 text-[18px] text-primary-white shadow-[0_0_48px_rgba(255,190,110,0.32)] hover:bg-white/18 sm:text-[20px] [@media(max-height:520px)]:text-[16px]';
const GATE_SECONDARY =
  'border-[#e9d3a8]/25 bg-black/30 text-[17px] text-[#e9d3a8] hover:bg-black/50 sm:text-[18px] [@media(max-height:520px)]:text-[15px]';

/** The hellscape's finish, Anime finish or Painted cel (2026-10-11, Deepak:
 *  "retain the cell painted and anime choice on synth page") — the choice
 *  the experiment page leaves to the viewer, remembered in this browser. */
function FinishToggle({ value, onChange }: { value: HellFinishChoice; onChange(finish: HellFinishChoice): void }) {
  return (
    <div
      role='group'
      aria-label='Finish'
      className='pointer-events-auto flex gap-1 rounded-full border border-[#e9d3a8]/25 bg-black/40 p-1 text-[12px] backdrop-blur-md sm:text-[13px]'
    >
      {HELL_FINISH_CHOICES.map((choice) => (
        <button
          key={choice.id}
          type='button'
          aria-pressed={value === choice.id}
          onClick={() => onChange(choice.id)}
          className={`cursor-pointer rounded-full px-3 py-1 transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9d3a8] ${value === choice.id ? 'bg-[#e9d3a8]/85 text-[#1a1018]' : 'text-[#e9d3a8]/75 hover:bg-white/8 hover:text-[#f6e7c8]'}`}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

/** A gilded speech bubble with a caret on top (the scene hints). */
const HINT_BUBBLE =
  "rounded-xl border border-[#e9d3a8]/40 bg-[#160d0b]/85 px-4 py-2 text-[13px] text-[#f3e3c3] shadow-[0_0_28px_rgba(255,190,110,0.25)] backdrop-blur-md transition-all duration-500 before:absolute before:-top-[5px] before:h-2.5 before:w-2.5 before:rotate-45 before:border-t before:border-l before:border-[#e9d3a8]/40 before:bg-[#160d0b] before:content-['']";

/**
 * The "click to start audio" gate, as a set of scenes: a grand piano playing
 * itself under a spotlight, the guitar under the oak, and the sakura. The
 * arrows (or ← / →) change scene; each scene's own button plays its
 * instrument. Browsers only let audio start from a real user gesture — the
 * buttons. Dragging a scene turns the view a little. Loaded lazily — three.js
 * stays out of the app's own bundle, and the meadows are a further chunk.
 */
function StageLanding({
  audioReady,
  starting,
  startError,
  onStart,
  onPlayInstrument,
  onLeavePiano,
  onCoveringChange,
  onDone,
}: StageLandingProps) {
  /** The piano stage's canvas sits in here (see the stage's effect). */
  const stageHostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<StageScene | null>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const blackRef = useRef<HTMLDivElement>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [skipped, setSkipped] = useState(false);
  /** Entering from the piano: the file comes back once the screen is black,
   *  and the black lifts only when it is back (`fileBack`). */
  const returningRef = useRef(false);
  /** An instrument's demo is on the borrowed canvas (Play); cleared once
   *  the canvas is given back to the file. */
  const loanRef = useRef(false);
  const [fileBack, setFileBack] = useState(true);
  /** A stage button was used — from then on, audio running does NOT mean
   *  "dismiss the stage" (Back from the piano returns here with audio on). */
  const usedStageRef = useRef(false);
  /** Back from the piano is in progress (the file is coming back). */
  const [goingBack, setGoingBack] = useState(false);
  const [heldKeys, setHeldKeys] = useState<ReadonlySet<KeyName>>(new Set());
  /** The scene on screen. */
  const [scene, setScene] = useState<LandingInstrument>('piano');
  /** A scene switch in progress: the scene it is going to. */
  const [switchTarget, setSwitchTarget] = useState<LandingInstrument | null>(null);
  const meadowCanvasRef = useRef<HTMLCanvasElement>(null);
  const meadowRef = useRef<SideScene | null>(null);
  /** The meadow that has drawn its first frames, and the one that could
   *  not be made. Both describe the current try only: a try's leftovers are
   *  cleared when its scene goes. */
  const [meadowReady, setMeadowReady] = useState<SideKind | null>(null);
  const [meadowFailed, setMeadowFailed] = useState<SideKind | null>(null);
  /** The hellscape's auto demo is playing (its one extra button). */
  const [demoPlaying, setDemoPlaying] = useState(false);
  /** The hellscape's finish, as last picked here. The ref is what a new
   *  hellscape starts with (read when it is made, not an effect dependency). */
  const [hellFinish, setHellFinish] = useState(loadHellFinish);
  const hellFinishRef = useRef(hellFinish);
  hellFinishRef.current = hellFinish;
  const pickFinish = (finish: HellFinishChoice) => {
    setHellFinish(finish);
    saveHellFinish(finish);
    if (scene === 'hell') meadowRef.current?.setFinish?.(finish);
  };
  /** The scenes whose instrument the visitor has played (remembered here). */
  const [visited, setVisited] = useState(() => loadVisited(SCENE_IDS));
  /** Bumped when the idle hint may show again: on arrival, and back from playing. */
  const [hintArm, setHintArm] = useState(1);
  const shownArmRef = useRef(0);
  const [idleHint, setIdleHint] = useState(false);
  const [backHint, setBackHint] = useState(false);
  /** The visitor's octave while a scene with its own (the hellscape) plays. */
  const savedOctaveRef = useRef<number | null>(null);
  const [octave, setOctave] = useState(octaveLabel());
  // Read once (a one-shot read is state, not a memo): changing either would
  // re-create the scenes under the visitor.
  const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  /** Phones and tablets: no computer keyboard to mention. */
  const [touch] = useState(() => window.matchMedia('(hover: none) and (pointer: coarse)').matches);
  const short = useMediaQuery(SHORT_SCREEN);

  const sceneIndex = SCENES.findIndex((candidate) => candidate.id === scene);
  const current = SCENE_INFO[scene];
  /** The meadow that should exist right now: the scene's, until the app is
   *  on its way in (behind the black it is disposed for good). */
  const activeMeadow: SideKind | null =
    scene !== 'piano' && phase !== 'dark' && phase !== 'revealing' ? scene : null;
  const sceneReady = isSceneReady({ scene, webglFailed, meadowReady, meadowFailed });
  const switching = switchTarget !== null;
  /** The scene to suggest next, and how many are still new. */
  const suggestion = nextUnvisited(SCENE_IDS, scene, visited);
  /** The idle hint (and the suggested tab's glow) only once the scene on
   *  screen has been played: before that, its own Play comes first. */
  const hintable = visited.has(scene);
  /** This scene's instrument has not been played yet: Play is the highlighted button. */
  const playFirst = !visited.has(scene);
  /** Read at mount only (autoFocus): the button highlighted on arrival. */
  const [focusPlayFirst] = useState(playFirst);
  const remaining = unvisitedCount(SCENE_IDS, scene, visited);

  // Keys fill the width on a phone, stay 34 px on a desktop, and get
  // shorter on a short (landscape phone) screen.
  const keyWidth = useKeyWidth(touch);
  const keyHeight = keyHeightFor(keyWidth, short);

  // The piano stage, on a canvas of its own: the stage gives its WebGL
  // context up for good when it is disposed, so a stage made again (React's
  // StrictMode runs this effect twice in development) needs a new canvas.
  useEffect(() => {
    const host = stageHostRef.current;
    if (!host) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'absolute inset-0 h-full w-full';
    host.appendChild(canvas);
    let stage: StageScene;
    try {
      stage = createStageScene(canvas, { reducedMotion });
    } catch (error) {
      // No WebGL: the dark page with the button still does its job, and the
      // meadows count as failed (their instruments still play).
      console.warn('[landing] no WebGL for the piano stage', error);
      canvas.remove();
      setWebglFailed(true);
      return;
    }
    stageRef.current = stage;
    const observer = new ResizeObserver(() => stage.resize(canvas.clientWidth, canvas.clientHeight));
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      stage.dispose();
      stageRef.current = null;
      canvas.remove();
    };
  }, [reducedMotion]);

  // The meadows and the hellscape are chunks of their own: fetch them once
  // the stage is up, so the first arrow press does not wait on the network.
  useEffect(() => {
    const meadows = window.setTimeout(
      () =>
        void import('./meadow').catch((error: unknown) =>
          console.warn('[landing] could not fetch the meadow scenes ahead of time', error),
        ),
      2500,
    );
    const hell = window.setTimeout(
      () =>
        void import('./hell').catch((error: unknown) =>
          console.warn('[landing] could not fetch the hellscape ahead of time', error),
        ),
      6000,
    );
    return () => {
      window.clearTimeout(meadows);
      window.clearTimeout(hell);
    };
  }, []);

  // The active meadow: made when its scene comes up (behind the switch's
  // black), drawn two frames, and only then handed to the gate (`meadowRef`),
  // so Play never drives a meadow that has not settled. Disposed — GL
  // context and all — when the scene changes or the app takes over, and at
  // once if it fails half-made. Only one meadow lives at a time.
  useEffect(() => {
    if (activeMeadow === null) return;
    const kind = activeMeadow;
    // A new try starts clean: an earlier failure of this scene must not end
    // this try's switch at once.
    setMeadowFailed((failed) => (failed === kind ? null : failed));
    const canvas = meadowCanvasRef.current;
    if (webglFailed || !canvas) {
      // No WebGL: the piano stage could not be made, so no meadow can be
      // either. It counts as a failed meadow: the switch ends, the scene
      // says it could not be drawn, and its instrument still plays.
      setMeadowFailed(kind);
      return;
    }
    let observer: ResizeObserver | null = null;
    const attempt = attemptScene({
      load: (): Promise<(target: HTMLCanvasElement) => SideScene> =>
        kind === 'hell'
          ? import('./hell').then(
              ({ createHellStage }) =>
                (target) =>
                  createHellStage(target, {
                    reducedMotion,
                    finish: hellFinishRef.current,
                    onDemoChange: setDemoPlaying,
                  }),
            )
          : import('./meadow').then(
              ({ createMeadowScene }) =>
                (target) =>
                  createMeadowScene(kind, target, { reducedMotion }),
            ),
      create: (make) => make(canvas),
      prepare: async (meadow: SideScene) => {
        observer = new ResizeObserver(() => meadow.resize(canvas.clientWidth, canvas.clientHeight));
        observer.observe(canvas);
        meadow.resize(canvas.clientWidth, canvas.clientHeight);
        // The hellscape compiles its shaders off the main thread first (the
        // page stays responsive behind "Setting the scene…").
        await meadow.warm?.();
        // Drawn NOW, behind the black — not left to the scene's loop, whose
        // frame cap skips the first frames on a 120/144 Hz screen: "two
        // frames later" was then still an empty canvas, and the paused piano
        // showed through it until the meadow's first (shader-compiling) frame.
        meadow.renderNow();
        return afterTwoFrames();
      },
      release: (meadow) => {
        observer?.disconnect();
        observer = null;
        if (meadowRef.current === meadow) meadowRef.current = null;
        meadow.dispose();
      },
      // A chunk that never arrives (a stalled network) would hold the switch
      // on black for good.
      timeoutMs: MEADOW_LOAD_TIMEOUT_MS,
      onReady: (meadow) => {
        meadowRef.current = meadow;
        setMeadowReady(kind);
      },
      onFailed: (error) => {
        // No meadow (WebGL, the chunk, or the scene failed): the scene's
        // button still plays its sound. Logged — a swallowed failure here
        // once hid a bug.
        console.error(`[landing] the ${kind} scene could not be made`, error);
        setMeadowFailed(kind);
      },
    });
    return () => {
      attempt.cancel();
      setMeadowReady((ready) => (ready === kind ? null : ready));
      setMeadowFailed((failed) => (failed === kind ? null : failed));
    };
  }, [activeMeadow, reducedMotion, webglFailed]);

  // The piano stage draws only on its own scene. Anywhere else it is
  // covered (by a meadow, by the black while one loads, or by a meadow that
  // failed), so it stops at once, behind the switch's black, and draws again
  // when its scene is back.
  useEffect(() => {
    if (scene === 'piano') stageRef.current?.resume();
    else stageRef.current?.pause();
  }, [scene]);

  // A switch ends when its scene is up.
  useEffect(() => {
    if (switchTarget !== null && scene === switchTarget && sceneReady) setSwitchTarget(null);
  }, [switchTarget, scene, sceneReady]);

  // The app mounts underneath and can overflow a small screen; no page
  // scrollbars while the stage is up.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    onCoveringChange(phase !== 'revealing');
  }, [phase, onCoveringChange]);

  // Audio was started from the plain gate before this chunk arrived.
  useEffect(() => {
    if (audioReady && phase === 'idle' && !usedStageRef.current) onDone();
  }, [audioReady, phase, onDone]);

  // The flight (or the short skip fade) ends in black.
  useEffect(() => {
    if (phase !== 'flying') return;
    const handle = window.setTimeout(() => setPhase('dark'), skipped ? SKIP_FADE_MS : FLIGHT_SECONDS * 1000);
    return () => window.clearTimeout(handle);
  }, [phase, skipped]);

  // Black: nothing on screen moves any more, so the stage stops drawing (the
  // meadow goes with `activeMeadow`), and this is when the heavy work happens
  // — measured, swapping the project back (read the file, render the whole
  // graph) blocks the main thread for 0.4 s at a time in production (1.3 s
  // in dev); during the flight that was a visible stutter.
  useEffect(() => {
    if (phase !== 'dark') return;
    stageRef.current?.pause();
    if (returningRef.current) {
      returningRef.current = false;
      loanRef.current = false;
      setFileBack(false);
      void onLeavePiano()
        .catch(logReturnFailure)
        // The swap is dispatched; React renders the graph in the next task.
        // A frame can only run after that long task, so two frames later the
        // graph is committed and painted-ready.
        .then(afterTwoFrames)
        .finally(() => setFileBack(true));
    }
  }, [phase, onLeavePiano]);
  // Lift the black once audio runs and the file is back.
  useEffect(() => {
    if (phase !== 'dark' || !audioReady || !fileBack) return;
    setPhase('revealing');
  }, [phase, audioReady, fileBack]);
  useEffect(() => {
    if (phase !== 'revealing') return;
    const handle = window.setTimeout(onDone, REVEAL_MS);
    return () => window.clearTimeout(handle);
  }, [phase, onDone]);

  // Audio failed: back to the scene, with the error under the button. From
  // any phase, a canvas still on loan goes back to the file now, and a
  // return that was waiting for the black is dropped (it happens here).
  useEffect(() => {
    if (!startError || phase === 'idle') return;
    returningRef.current = false;
    if (loanRef.current) {
      loanRef.current = false;
      void onLeavePiano().catch(logReturnFailure);
    }
    stageRef.current?.setLive(false);
    stageRef.current?.cancelFlight();
    meadowRef.current?.setLive(false);
    restoreOctave();
    if (scene === 'piano') stageRef.current?.resume();
    setSkipped(false);
    setPhase('idle');
  }, [startError, phase, onLeavePiano, scene]);

  // Playing: the keyboard bus's key events reach the scene — the piano's 3D
  // keys, the guitar's strings, the sakura's organ. Each QWERTY key
  // remembers the key index it pressed, so an octave shift moves held keys
  // across (the instrument retunes them too) and a release lifts the right one.
  useEffect(() => {
    if (phase !== 'piano') return;
    const pressed = new Map<KeyName, number>();
    const unsubscribe = onKeyBusEvent((event) => {
      const target: Pick<StageScene, 'setLiveKey'> | null = scene === 'piano' ? stageRef.current : meadowRef.current;
      if (event.type === 'octave') {
        setOctave(octaveLabel());
        for (const [key, index] of pressed) {
          target?.setLiveKey(index, false);
          const moved = stageKeyFor(key);
          target?.setLiveKey(moved, true);
          pressed.set(key, moved);
        }
        return;
      }
      if (event.type === 'down') {
        const index = stageKeyFor(event.key);
        pressed.set(event.key, index);
        target?.setLiveKey(index, true);
      } else {
        const index = pressed.get(event.key);
        if (index !== undefined) target?.setLiveKey(index, false);
        pressed.delete(event.key);
      }
      setHeldKeys(new Set(pressed.keys()));
    });
    return () => {
      unsubscribe();
      setHeldKeys(new Set());
    };
  }, [phase, scene]);

  // The idle hint: once per arming (arrival, back from playing), when the
  // scene is up — a bubble under the tabs naming a scene not played yet.
  useEffect(() => {
    if (phase !== 'idle' || switching || !sceneReady || !hintable || suggestion === null || shownArmRef.current === hintArm) {
      return;
    }
    // Marked as shown only once it shows (StrictMode runs this twice, and a
    // switch during the delay must not use the arming up).
    const show = window.setTimeout(() => {
      shownArmRef.current = hintArm;
      setIdleHint(true);
    }, HINT_DELAY_MS);
    const hide = window.setTimeout(() => setIdleHint(false), HINT_DELAY_MS + HINT_SHOW_MS);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
      setIdleHint(false);
    };
  }, [phase, switching, sceneReady, hintable, suggestion, hintArm]);
  // In a scene: a bubble on Back — there is more to see, and which next.
  useEffect(() => {
    if (phase !== 'piano') return;
    const show = window.setTimeout(() => setBackHint(true), BACK_HINT_DELAY_MS);
    const hide = window.setTimeout(() => setBackHint(false), BACK_HINT_DELAY_MS + HINT_SHOW_MS);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
      setBackHint(false);
    };
  }, [phase]);

  const playFirstRef = useRef(playFirst);
  playFirstRef.current = playFirst;
  // Focus follows the phase, so a keyboard or screen-reader visitor is never
  // dropped on the page's body: the flight's Skip (Enter / Space skip), the
  // piano's Back, and the scene's Play on the way back to the scene.
  const previousPhaseRef = useRef(phase);
  useEffect(() => {
    const previous = previousPhaseRef.current;
    previousPhaseRef.current = phase;
    if (previous === phase) return;
    if (phase === 'flying') skipRef.current?.focus();
    else if (phase === 'piano') backRef.current?.focus();
    else if (phase === 'idle') {
      // The highlighted one: Play while this scene is new, the other after.
      const playButton = playRef.current;
      if (playFirstRef.current && playButton && !playButton.disabled) playButton.focus();
      else startRef.current?.focus();
    }
  }, [phase]);

  // A switch makes the controls inert for its moment, which drops the focus
  // to the page: when it ends, focus goes to the scene's highlighted button
  // (unless the visitor has already put it somewhere else).
  const wasSwitchingRef = useRef(false);
  useEffect(() => {
    const ended = wasSwitchingRef.current && !switching;
    wasSwitchingRef.current = switching;
    if (!ended || phase !== 'idle') return;
    if (document.activeElement && document.activeElement !== document.body) return;
    const playButton = playRef.current;
    if (playFirstRef.current && playButton && !playButton.disabled) playButton.focus();
    else startRef.current?.focus();
  }, [switching, phase]);

  // The black veil. Web Animations, not CSS transitions: a skip must take
  // over mid-fade — even during the fade's delay — from wherever it is.
  useEffect(() => {
    const element = blackRef.current;
    if (!element) return;
    const [to, duration, delay] = switching
      ? [1, reducedMotion ? 0 : SWITCH_VEIL_MS, 0]
      : phase === 'idle' || phase === 'piano'
        ? [0, 300, 0]
        : phase === 'flying'
          ? skipped
            ? [1, SKIP_FADE_MS, 0]
            : [1, 1100, FLIGHT_SECONDS * 1000 - 1100]
          : phase === 'dark'
            ? [1, 200, 0]
            : [0, REVEAL_MS, 0];
    const from = getComputedStyle(element).opacity;
    for (const animation of element.getAnimations()) animation.cancel();
    element.animate([{ opacity: from }, { opacity: String(to) }], {
      duration,
      delay,
      easing: 'ease-in-out',
      fill: 'both',
    });
  }, [phase, skipped, switching, reducedMotion]);

  /** To a scene (a tab, the hint): black, swap, lift. */
  const goToScene = (next: LandingInstrument) => {
    if (phase !== 'idle' || switching || next === scene) return;
    setIdleHint(false);
    setSwitchTarget(next);
    window.setTimeout(() => setScene(next), reducedMotion ? 0 : SWITCH_VEIL_MS);
  };
  /** To the next (+1) or previous (-1) scene. */
  const goTo = (delta: number) => goToScene(SCENES[(sceneIndex + delta + SCENES.length) % SCENES.length].id);
  const goToRef = useRef(goTo);
  goToRef.current = goTo;
  // ← / → change scene too (the playing keys are letters, so no clash).
  useEffect(() => {
    if (phase !== 'idle') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowLeft') goToRef.current(-1);
      else if (event.key === 'ArrowRight') goToRef.current(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  /** The visitor's own octave back (after a scene that set its own). */
  function restoreOctave() {
    const saved = savedOctaveRef.current;
    if (saved === null) return;
    savedOctaveRef.current = null;
    shiftOctave(saved - getOctaveShift());
    setOctave(octaveLabel());
  }
  const fly = () => {
    // Nothing to watch without motion (or without WebGL), and from a meadow
    // there is no piano to fly into: a short fade to black instead.
    setSkipped(reducedMotion || webglFailed || scene !== 'piano');
    setPhase('flying');
    if (scene === 'piano') stageRef.current?.flyIn();
  };
  const begin = () => {
    usedStageRef.current = true;
    if (!audioReady) onStart();
    fly();
  };
  /** The scene's own instrument. */
  const play = () => {
    if (!sceneReady) return;
    usedStageRef.current = true;
    onPlayInstrument(scene);
    loanRef.current = true;
    if (!visited.has(scene)) {
      const next = new Set(visited).add(scene);
      setVisited(next);
      saveVisited(next);
    }
    const home = SCENE_OCTAVE[scene];
    if (home !== undefined) {
      savedOctaveRef.current ??= getOctaveShift();
      shiftOctave(home - getOctaveShift());
    }
    setOctave(octaveLabel());
    // The phase first: the instrument is playable (with Back) whatever the
    // 3D scene does next.
    setPhase('piano');
    try {
      if (scene === 'piano') stageRef.current?.setLive(true);
      else meadowRef.current?.setLive(true);
    } catch (error) {
      console.error(`[landing] the ${scene} scene could not follow Play`, error);
    }
  };
  // From playing into the app: the flight (or fade) first; the open file
  // comes back behind the black (see the 'dark' effect).
  const enterFromPiano = () => {
    restoreOctave();
    returningRef.current = true;
    fly();
  };
  // Back to the scene as it was: the file first — its render is the one
  // heavy moment, so it happens while the camera still holds the close view
  // — then the glide back (a meadow's camera backs off at once, alongside).
  const backToStage = () => {
    if (goingBack) return;
    setGoingBack(true);
    setBackHint(false);
    restoreOctave();
    const meadow = scene !== 'piano';
    if (meadow) meadowRef.current?.setLive(false);
    const backedOff = new Promise<void>((resolve) =>
      window.setTimeout(resolve, meadow && !reducedMotion ? MEADOW_BACKOFF_MS : 0),
    );
    loanRef.current = false;
    void Promise.all([onLeavePiano().catch(logReturnFailure).then(afterTwoFrames), backedOff]).finally(() => {
      if (!meadow) stageRef.current?.setLive(false);
      setGoingBack(false);
      setPhase('idle');
      // Back on the scene: the hint may point at a scene not played yet.
      setHintArm((arm) => arm + 1);
    });
  };

  const meadowGradient = scene !== 'piano';
  const idle = phase === 'idle';

  return (
    <div
      className={
        phase === 'revealing'
          ? 'pointer-events-none fixed inset-0 z-1000 overflow-hidden select-none'
          : 'fixed inset-0 z-1000 overflow-hidden bg-[#030102] select-none'
      }
    >
      {/* The scenes themselves are for looking around (drag); only the
          buttons start audio. */}
      {!webglFailed && (
        <div
          ref={stageHostRef}
          aria-hidden='true'
          className={
            // Hidden under any other scene: if a meadow is ever late to draw,
            // the gap shows black, never the piano.
            phase === 'revealing' || scene !== 'piano' ? 'invisible absolute inset-0' : 'absolute inset-0'
          }
        />
      )}
      {activeMeadow !== null && !webglFailed && (
        <canvas key={activeMeadow} ref={meadowCanvasRef} aria-hidden='true' className='absolute inset-0 h-full w-full' />
      )}

      {/* The idle controls. Faded out, not unmounted, when not idle — and
          `inert` then, so its buttons leave the tab order and the
          accessibility tree. */}
      <div
        inert={!idle || switching}
        className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ${idle ? 'opacity-100' : 'opacity-0'}`}
      >
        <SceneTabs
          current={scene}
          visited={visited}
          suggested={hintable ? suggestion : null}
          hint={
            hintable && suggestion !== null
              ? {
                  visible: idleHint,
                  onClick: () => goToScene(suggestion),
                  text: (
                    <>
                      ✦ {remaining === 1 ? 'One more scene' : `${remaining} more scenes`} to explore — try{' '}
                      <span className='font-semibold text-[#f3cf8a]'>{SCENE_INFO[suggestion].title}</span> next ›
                    </>
                  ),
                }
              : null
          }
          onPick={goToScene}
        />
        <SceneArrow side='left' label='Previous scene' onClick={() => goTo(-1)} />
        <SceneArrow side='right' label='Next scene' onClick={() => goTo(1)} />
        <div
          className={`absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-linear-to-t px-4 pt-20 pb-[max(2rem,env(safe-area-inset-bottom))] text-center sm:gap-4 sm:pt-28 sm:pb-10 [@media(max-height:520px)]:gap-2 [@media(max-height:520px)]:pt-10 [@media(max-height:520px)]:pb-3 ${meadowGradient ? 'from-black/75 via-black/30 to-transparent' : 'from-black/90 via-black/45 to-transparent'}`}
        >
          <p className='font-serif text-[13px] tracking-[0.25em] text-[#e9d3a8]/80 uppercase sm:tracking-[0.4em] [@media(max-height:520px)]:hidden'>
            nodestra
          </p>
          {/* Where you are among the scenes: the tabs at the top show it
              (the title and dots that sat here went with them, 2026-10-11:
              "remove the tab below since the tab is above now"); a screen
              reader still hears the scene change. */}
          <p className='sr-only' aria-live='polite'>
            {current.title}
          </p>
          <div className='flex w-full max-w-sm flex-col items-stretch gap-2.5 sm:w-auto sm:max-w-none sm:flex-row sm:items-center sm:gap-3 [@media(max-height:520px)]:w-auto [@media(max-height:520px)]:max-w-none [@media(max-height:520px)]:flex-row'>
            <button
              ref={startRef}
              type='button'
              autoFocus={!focusPlayFirst}
              disabled={starting || !idle}
              onClick={begin}
              className={`start-overlay-button ${GATE_BUTTON} ${playFirst ? GATE_SECONDARY : GATE_PRIMARY} ${idle ? 'pointer-events-auto' : ''}`}
            >
              {audioReady ? 'Enter the app' : starting ? 'Starting audio…' : 'Click to start audio'}
            </button>
            <button
              ref={playRef}
              type='button'
              autoFocus={focusPlayFirst}
              disabled={starting || !idle || !sceneReady}
              onClick={play}
              className={`${GATE_BUTTON} ${playFirst ? GATE_PRIMARY : GATE_SECONDARY} ${idle ? 'pointer-events-auto' : ''}`}
            >
              {current.play}
            </button>
          </div>
          {scene === 'hell' && meadowFailed !== 'hell' && <FinishToggle value={hellFinish} onChange={pickFinish} />}
          {meadowFailed === scene && (
            <p className='text-[13px] text-[#d8c7a8]/75'>This scene could not be drawn here — its instrument still plays.</p>
          )}
          {!audioReady && (
            <p className='text-[12px] text-[#d8c7a8]/75 sm:text-[13px] [@media(max-height:520px)]:hidden'>
              {startError
                ? `Start failed: ${startError} — click to retry.`
                : 'Browsers require a real click before any sound can play.'}
            </p>
          )}
        </div>
      </div>

      {phase === 'piano' && (
        <>
          <button
            ref={backRef}
            type='button'
            onClick={backToStage}
            disabled={goingBack}
            className='absolute top-[max(1rem,env(safe-area-inset-top))] left-4 cursor-pointer rounded-full border border-[#e9d3a8]/30 bg-black/40 px-5 py-2 text-[14px] text-[#e9d3a8] backdrop-blur-md transition-colors hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9d3a8] disabled:cursor-wait disabled:opacity-60 sm:left-5'
          >
            ‹ Back
          </button>
          {suggestion !== null && (
            <p
              role='status'
              className={`pointer-events-none absolute top-[calc(max(1rem,env(safe-area-inset-top))+3.1rem)] left-3 max-w-[min(20rem,calc(100vw-1.5rem))] before:left-6 sm:left-4 ${HINT_BUBBLE} ${backHint ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'}`}
            >
              {backHint && (
                <>
                  {remaining === 1 ? 'One more scene' : `${remaining} more scenes`} to check out — go ‹ Back and try{' '}
                  <span className='font-semibold text-[#f3cf8a]'>{SCENE_INFO[suggestion].title}</span> next
                </>
              )}
            </p>
          )}
          <button
            type='button'
            onClick={enterFromPiano}
            disabled={goingBack}
            className='absolute top-[max(1rem,env(safe-area-inset-top))] right-4 cursor-pointer rounded-full border border-[#e9d3a8]/40 bg-black/45 px-5 py-2 text-[14px] text-primary-white backdrop-blur-md transition-colors hover:bg-black/65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9d3a8] disabled:opacity-60 sm:right-5 sm:px-6 sm:text-[15px]'
          >
            Enter the app ›
          </button>
          {/* The keys. On a short screen (a phone on its side) every scene's
              subject sits bottom-centre, so they move to the corner. */}
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2.5 bg-linear-to-t px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center sm:gap-3 sm:pb-8 [@media(max-height:520px)]:items-end [@media(max-height:520px)]:gap-1.5 [@media(max-height:520px)]:pb-2 [@media(max-height:520px)]:bg-none ${meadowGradient ? `from-black/65 via-black/20 to-transparent pt-12 sm:items-end sm:bg-none sm:px-6 sm:pt-0 [@media(max-height:520px)]:pt-6` : 'from-black/90 via-black/50 to-transparent pt-16 sm:pt-24 [@media(max-height:520px)]:pt-6'}`}
          >
            {/* The hellscape's one extra button: its auto demo (Nosferatu,
                recorded from the app's Vampire Synth), which presses the
                synth's keys while it plays. Never on by itself. */}
            {scene === 'hell' && (
              <div className='flex flex-wrap items-center justify-center gap-2 sm:justify-end'>
                <button
                  type='button'
                  aria-pressed={demoPlaying}
                  onClick={() => (demoPlaying ? meadowRef.current?.stopDemo?.() : meadowRef.current?.playDemo?.())}
                  className='pointer-events-auto cursor-pointer rounded-full border border-[#e9d3a8]/35 bg-black/50 px-5 py-2 text-[14px] text-[#e9d3a8] backdrop-blur-md transition-colors hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9d3a8] [@media(max-height:520px)]:px-4 [@media(max-height:520px)]:py-1 [@media(max-height:520px)]:text-[13px]'
                >
                  {demoPlaying ? '■ Stop the demo' : '▶ Play the demo'}
                </button>
                <FinishToggle value={hellFinish} onChange={pickFinish} />
              </div>
            )}
            <p className={`text-[13px] text-[#e9d3a8] sm:text-[14px] [@media(max-height:520px)]:hidden ${meadowGradient ? MEADOW_PILL : ''}`}>
              {!audioReady
                ? 'Starting audio…'
                : touch
                  ? 'Tap the keys — slide for a glissando, several fingers for a chord'
                  : 'Play with your keyboard, or click and tap the keys'}
            </p>
            <KeyLegend held={heldKeys} playable={audioReady} keyWidth={keyWidth} keyHeight={keyHeight} />
            <p className={`flex items-center gap-1.5 text-[12px] text-[#d8c7a8]/75 ${meadowGradient ? `sm:pointer-events-auto ${MEADOW_PILL}` : ''} [@media(max-height:520px)]:pointer-events-auto [@media(max-height:520px)]:rounded-full [@media(max-height:520px)]:bg-black/50 [@media(max-height:520px)]:px-3 [@media(max-height:520px)]:py-0.5 [@media(max-height:520px)]:text-[#e9d3a8] [@media(max-height:520px)]:backdrop-blur-md`}>
              Octave <span className='font-semibold text-[#e9d3a8]'>{octave}</span>
              {touch ? (
                <>
                  <button
                    type='button'
                    aria-label='Octave down'
                    onClick={() => shiftOctave(-1)}
                    className='pointer-events-auto grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-[#e9d3a8]/30 text-[16px] text-[#e9d3a8] active:bg-white/10'
                  >
                    −
                  </button>
                  <button
                    type='button'
                    aria-label='Octave up'
                    onClick={() => shiftOctave(1)}
                    className='pointer-events-auto grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-[#e9d3a8]/30 text-[16px] text-[#e9d3a8] active:bg-white/10'
                  >
                    +
                  </button>
                </>
              ) : (
                <>
                  ·
                  <button
                    type='button'
                    aria-label='Octave down'
                    onClick={() => shiftOctave(-1)}
                    className='pointer-events-auto cursor-pointer rounded border border-[#e9d3a8]/30 px-1.5 font-mono hover:bg-white/10'
                  >
                    ,
                  </button>
                  and
                  <button
                    type='button'
                    aria-label='Octave up'
                    onClick={() => shiftOctave(1)}
                    className='pointer-events-auto cursor-pointer rounded border border-[#e9d3a8]/30 px-1.5 font-mono hover:bg-white/10'
                  >
                    .
                  </button>
                  shift the octave
                </>
              )}
            </p>
          </div>
        </>
      )}

      <div ref={blackRef} aria-hidden='true' className='pointer-events-none absolute inset-0 bg-black opacity-0' />

      {switching && scene === switchTarget && !sceneReady && (
        <p className='pointer-events-none absolute inset-x-0 top-1/2 text-center text-[13px] text-[#d8c7a8]/70'>
          Setting the scene…
        </p>
      )}

      {phase === 'dark' && !audioReady && (
        <p className='absolute inset-x-0 bottom-12 text-center text-[13px] text-[#d8c7a8]/70'>Starting audio…</p>
      )}

      {phase === 'flying' && !skipped && (
        <button
          ref={skipRef}
          type='button'
          onClick={() => setSkipped(true)}
          className='absolute right-5 bottom-[max(1.25rem,env(safe-area-inset-bottom))] cursor-pointer rounded-full border border-[#e9d3a8]/30 bg-black/40 px-5 py-2 text-[14px] text-[#e9d3a8] backdrop-blur-md transition-colors hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9d3a8]'
        >
          Skip ›
        </button>
      )}
    </div>
  );
}

export { StageLanding };
export type { LandingInstrument };

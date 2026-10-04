import { useEffect, useMemo, useRef, useState } from 'react';
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
import { createStageScene, FLIGHT_SECONDS } from './stageScene';
import type { StageScene } from './stageScene';
import type { MeadowKind, MeadowScene } from './meadow';

/** What the stage's play buttons play: the piano on this stage, or one of
 *  the meadow scenes (2026-10-04: the guitar under the oak, and the organ
 *  under the sakura — "organ demo suits sakura scene the best"). */
type LandingInstrument = 'piano' | MeadowKind;

/**
 * The gate's scenes, in arrow order (2026-10-04, Deepak: "a left and right
 * arrow button that can change the piano scenes to other scenes … 'play
 * guitar' … should only appear on the guitar scene"). Each scene has exactly
 * one play button: its own instrument.
 */
const SCENES: readonly { id: LandingInstrument; title: string; play: string }[] = [
  { id: 'piano', title: 'The stage', play: '🎹 Play the piano' },
  { id: 'guitar', title: 'Under the oak', play: '🎸 Play the guitar' },
  { id: 'sakura', title: 'Under the sakura', play: '🌸 Play the organ' },
];

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
 *           scene follows them (3D keys, strings, petals)
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

const A0_MIDI = 21;
const WHITE_SEMITONES = new Set([0, 2, 4, 5, 7, 9, 11, 12, 14, 16]);

/** The 3D key (0 = A0) a QWERTY key plays at the current octave window —
 *  the same pitch the keyboard bus sends the piano. */
function stageKeyFor(key: KeyName): number {
  return 60 + KEY_TO_SEMITONE[key] + 12 * getOctaveShift() - A0_MIDI;
}

/** The window size, live. */
function useViewport(): { width: number; height: number } {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const update = () => setSize(read());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return size;
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
    return key as KeyName | undefined;
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<StageScene | null>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const blackRef = useRef<HTMLDivElement>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [skipped, setSkipped] = useState(false);
  /** Entering from the piano: the file comes back once the screen is black,
   *  and the black lifts only when it is back (`fileBack`). */
  const returningRef = useRef(false);
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
  const meadowRef = useRef<MeadowScene | null>(null);
  /** The meadow that has drawn its first frames (or could not be made). */
  const [meadowReady, setMeadowReady] = useState<MeadowKind | null>(null);
  const [meadowFailed, setMeadowFailed] = useState<MeadowKind | null>(null);
  const [octave, setOctave] = useState(octaveLabel());
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  /** Phones and tablets: no computer keyboard to mention. */
  const touch = useMemo(() => window.matchMedia('(hover: none) and (pointer: coarse)').matches, []);
  const viewport = useViewport();
  const short = viewport.height < 520;

  const sceneIndex = SCENES.findIndex((candidate) => candidate.id === scene);
  const current = SCENES[sceneIndex];
  /** The meadow that should exist right now: the scene's, until the app is
   *  on its way in (behind the black it is disposed for good). */
  const activeMeadow: MeadowKind | null =
    scene !== 'piano' && phase !== 'dark' && phase !== 'revealing' ? scene : null;
  const sceneReady = scene === 'piano' || meadowReady === scene || meadowFailed === scene;
  const switching = switchTarget !== null;

  // Keys fill the width on a phone (16 px gutters), stay 34 px on a desktop,
  // and get shorter on a short (landscape phone) screen.
  const keyWidth = Math.max(24, Math.min(touch ? 44 : 34, Math.floor((viewport.width - 32) / 10)));
  const keyHeight = Math.round(Math.min(keyWidth * (92 / 34), short ? 64 : 120));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let stage: StageScene;
    try {
      stage = createStageScene(canvas, { reducedMotion });
    } catch {
      // No WebGL: the dark page with the button still does its job.
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
    };
  }, [reducedMotion]);

  // The meadows are their own chunk: fetch it once the stage is up, so the
  // first arrow press does not wait on the network.
  useEffect(() => {
    const handle = window.setTimeout(() => void import('./meadow').catch(() => {}), 2500);
    return () => window.clearTimeout(handle);
  }, []);

  // The active meadow: made when its scene comes up (behind the switch's
  // black), drawn two frames, then the piano stage stops drawing under it.
  // Disposed — GL context and all — when the scene changes or the app takes
  // over. Only one meadow lives at a time.
  useEffect(() => {
    if (activeMeadow === null || webglFailed) return;
    const kind = activeMeadow;
    let cancelled = false;
    let made: MeadowScene | null = null;
    let observer: ResizeObserver | null = null;
    void import('./meadow')
      .then(({ createMeadowScene }) => {
        const canvas = meadowCanvasRef.current;
        if (cancelled || !canvas) return;
        const meadow = createMeadowScene(kind, canvas, { reducedMotion });
        made = meadow;
        meadowRef.current = meadow;
        observer = new ResizeObserver(() => meadow.resize(canvas.clientWidth, canvas.clientHeight));
        observer.observe(canvas);
        meadow.resize(canvas.clientWidth, canvas.clientHeight);
        // Drawn NOW, behind the black — not left to the scene's loop, whose
        // frame cap skips the first frames on a 120/144 Hz screen: "two
        // frames later" was then still an empty canvas, and the paused piano
        // showed through it until the meadow's first (shader-compiling) frame.
        meadow.renderNow();
        return afterTwoFrames().then(() => {
          if (cancelled) return;
          stageRef.current?.pause();
          setMeadowReady(kind);
          setMeadowFailed((failed) => (failed === kind ? null : failed));
        });
      })
      .catch((error: unknown) => {
        // No meadow (WebGL or the chunk failed): the scene's button still
        // plays its sound. Logged — a swallowed failure here once hid a bug.
        console.error(`[landing] the ${kind} scene could not be made`, error);
        if (!cancelled) setMeadowFailed(kind);
      });
    return () => {
      cancelled = true;
      observer?.disconnect();
      made?.dispose();
      if (meadowRef.current === made) meadowRef.current = null;
      setMeadowReady((ready) => (ready === kind ? null : ready));
    };
  }, [activeMeadow, reducedMotion, webglFailed]);

  // Back on the piano scene: the stage draws again.
  useEffect(() => {
    if (scene === 'piano') stageRef.current?.resume();
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
      setFileBack(false);
      void onLeavePiano()
        .catch(() => {})
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

  // Audio failed: back to the scene, with the error under the button.
  useEffect(() => {
    if (!startError || phase === 'idle') return;
    if (phase === 'piano') void onLeavePiano();
    stageRef.current?.setLive(false);
    stageRef.current?.cancelFlight();
    meadowRef.current?.setLive(false);
    if (scene === 'piano') stageRef.current?.resume();
    setSkipped(false);
    setPhase('idle');
  }, [startError, phase, onLeavePiano, scene]);

  // Playing: the keyboard bus's key events reach the scene — the piano's 3D
  // keys, the guitar's strings, the sakura's petals. Each QWERTY key
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

  // The start button is gone; Enter / Space now skip.
  useEffect(() => {
    if (phase === 'flying') skipRef.current?.focus();
  }, [phase]);

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

  /** To the next (+1) or previous (-1) scene: black, swap, lift. */
  const goTo = (delta: number) => {
    if (phase !== 'idle' || switching) return;
    const next = SCENES[(sceneIndex + delta + SCENES.length) % SCENES.length].id;
    setSwitchTarget(next);
    window.setTimeout(() => setScene(next), reducedMotion ? 0 : SWITCH_VEIL_MS);
  };
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
    if (scene === 'piano') {
      stageRef.current?.setLive(true);
    } else {
      meadowRef.current?.setLive(true);
    }
    setOctave(octaveLabel());
    setPhase('piano');
  };
  // From playing into the app: the flight (or fade) first; the open file
  // comes back behind the black (see the 'dark' effect).
  const enterFromPiano = () => {
    returningRef.current = true;
    fly();
  };
  // Back to the scene as it was: the file first — its render is the one
  // heavy moment, so it happens while the camera still holds the close view
  // — then the glide back (a meadow's camera backs off at once, alongside).
  const backToStage = () => {
    if (goingBack) return;
    setGoingBack(true);
    const meadow = scene !== 'piano';
    if (meadow) meadowRef.current?.setLive(false);
    const backedOff = new Promise<void>((resolve) =>
      window.setTimeout(resolve, meadow && !reducedMotion ? MEADOW_BACKOFF_MS : 0),
    );
    void Promise.all([onLeavePiano().catch(() => {}).then(afterTwoFrames), backedOff]).finally(() => {
      if (!meadow) stageRef.current?.setLive(false);
        setGoingBack(false);
      setPhase('idle');
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
        <canvas
          ref={canvasRef}
          aria-hidden='true'
          className={
            // Hidden under any other scene: if a meadow is ever late to draw,
            // the gap shows black, never the piano.
            phase === 'revealing' || scene !== 'piano'
              ? 'invisible absolute inset-0 h-full w-full'
              : 'absolute inset-0 h-full w-full'
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
        <SceneArrow side='left' label='Previous scene' onClick={() => goTo(-1)} />
        <SceneArrow side='right' label='Next scene' onClick={() => goTo(1)} />
        <div
          className={`absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-linear-to-t px-4 pt-20 pb-[max(2rem,env(safe-area-inset-bottom))] text-center sm:gap-4 sm:pt-28 sm:pb-10 [@media(max-height:520px)]:gap-2 [@media(max-height:520px)]:pt-10 [@media(max-height:520px)]:pb-3 ${meadowGradient ? 'from-black/75 via-black/30 to-transparent' : 'from-black/90 via-black/45 to-transparent'}`}
        >
          <p className='font-serif text-[13px] tracking-[0.25em] text-[#e9d3a8]/80 uppercase sm:tracking-[0.4em] [@media(max-height:520px)]:hidden'>
            nodestra
          </p>
          {/* Where you are among the scenes. */}
          <div className='flex items-center gap-2.5' aria-live='polite'>
            <span className='text-[14px] text-[#e9d3a8]'>{current.title}</span>
            <span className='flex items-center gap-1.5' aria-hidden='true'>
              {SCENES.map((candidate) => (
                <span
                  key={candidate.id}
                  className={`h-1.5 rounded-full transition-all ${candidate.id === scene ? 'w-4 bg-[#e9d3a8]' : 'w-1.5 bg-[#e9d3a8]/35'}`}
                />
              ))}
            </span>
          </div>
          <div className='flex w-full max-w-sm flex-col items-stretch gap-2.5 sm:w-auto sm:max-w-none sm:flex-row sm:items-center sm:gap-3 [@media(max-height:520px)]:w-auto [@media(max-height:520px)]:max-w-none [@media(max-height:520px)]:flex-row'>
            <button
              type='button'
              autoFocus
              disabled={starting || !idle}
              onClick={begin}
              className={`start-overlay-button cursor-pointer rounded-full border border-[#e9d3a8]/40 bg-white/8 px-8 py-3.5 text-[18px] text-primary-white shadow-[0_0_48px_rgba(255,190,110,0.28)] backdrop-blur-md transition-colors hover:bg-white/16 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9d3a8] disabled:cursor-wait sm:px-10 sm:py-4 sm:text-[20px] [@media(max-height:520px)]:px-6 [@media(max-height:520px)]:py-2.5 [@media(max-height:520px)]:text-[16px] ${idle ? 'pointer-events-auto' : ''}`}
            >
              {audioReady ? 'Enter the app' : starting ? 'Starting audio…' : 'Click to start audio'}
            </button>
            <button
              type='button'
              disabled={starting || !idle || !sceneReady}
              onClick={play}
              className={`cursor-pointer rounded-full border border-[#e9d3a8]/25 bg-black/30 px-7 py-3.5 text-[17px] text-[#e9d3a8] backdrop-blur-md transition-colors hover:bg-black/50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9d3a8] disabled:cursor-wait sm:py-4 sm:text-[18px] [@media(max-height:520px)]:px-5 [@media(max-height:520px)]:py-2.5 [@media(max-height:520px)]:text-[15px] ${idle ? 'pointer-events-auto' : ''}`}
            >
              {current.play}
            </button>
          </div>
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
            type='button'
            onClick={backToStage}
            disabled={goingBack}
            className='absolute top-[max(1rem,env(safe-area-inset-top))] left-4 cursor-pointer rounded-full border border-[#e9d3a8]/30 bg-black/40 px-5 py-2 text-[14px] text-[#e9d3a8] backdrop-blur-md transition-colors hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9d3a8] disabled:cursor-wait disabled:opacity-60 sm:left-5'
          >
            ‹ Back
          </button>
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

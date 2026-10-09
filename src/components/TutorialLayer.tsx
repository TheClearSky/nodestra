import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Line, Mood, Rect, TutorialController, TutorialView } from '@theclearsky/easy-tutorial-builder';
import { BlipCharacter } from '../guide/BlipCharacter';
import { isBlipMuted, setBlipMuted } from '../guide/blipVoice';

/**
 * Blip and its speech bubble. The tutorial library draws only the
 * spotlight; this renders the guide, what it says, and the buttons the step
 * allows. Blip and the bubble share one dock so Blip stays mounted from the
 * first-run offer straight into the tutorial.
 *
 * Text is a tiny markdown subset rendered to React elements — never HTML —
 * because scripts may come from outside the app (a docs link).
 */

/** `**bold**`, `*em*`, `` `code` ``, `[[key]]` → React nodes. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[\[(.+?)\]\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1] !== undefined) nodes.push(<strong key={key++} className='font-semibold text-primary-white'>{match[1]}</strong>);
    else if (match[2] !== undefined) nodes.push(<em key={key++}>{match[2]}</em>);
    else if (match[3] !== undefined)
      nodes.push(
        <code key={key++} className='rounded bg-secondary-dark-gray px-1 text-[12px]'>
          {match[3]}
        </code>,
      );
    else
      nodes.push(
        <kbd
          key={key++}
          className='mx-0.5 inline-block min-w-[1.6em] rounded border border-b-2 border-secondary-light-gray bg-primary-dark-gray px-1 text-center text-[12px] leading-5 text-primary-white'
        >
          {match[4]}
        </kbd>,
      );
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** The same text, plain — for the screen-reader live region. */
function plain(lines: readonly Line[]): string {
  return lines.map((line) => line.say.replace(/\*\*|\*|`|\[\[|\]\]/g, '')).join(' ');
}

const BUBBLE_WIDTH = 340;
const BLIP_WIDTH = 180;
const DOCK_MARGIN = 16;

/** Dock right unless the thing we point at is under Blip or the bubble. */
function dockSide(target: Rect | null): 'right' | 'left' {
  if (!target || typeof window === 'undefined') return 'right';
  const left = window.innerWidth - BUBBLE_WIDTH - BLIP_WIDTH - DOCK_MARGIN * 2;
  const top = window.innerHeight - 280;
  const overlaps = target.x + target.width > left && target.y + target.height > top;
  return overlaps ? 'left' : 'right';
}

const BUTTON =
  'cursor-pointer rounded px-2.5 py-1 text-[12px] text-primary-white hover:bg-secondary-dark-gray focus-visible:outline-2 focus-visible:outline-[#7b5cff]';
const PRIMARY =
  'cursor-pointer rounded bg-[#7b5cff] px-3 py-1 text-[12px] font-semibold text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

type Side = 'right' | 'left';

/** Blip, then the bubble, docked to one bottom corner. */
function Dock({ side, label, blip, children }: { side: Side; label: string; blip: ReactNode; children: ReactNode }) {
  return (
    <div
      className={`pointer-events-none fixed bottom-4 z-[10001] flex items-end ${side === 'right' ? 'flex-row' : 'flex-row-reverse'}`}
      style={{ [side]: DOCK_MARGIN }}
    >
      {blip}
      <div
        role='dialog'
        aria-modal='false'
        aria-label={label}
        className='pointer-events-auto relative mb-6 flex flex-col gap-2 rounded-xl border border-[#7b5cff]/70 bg-primary-dark-gray p-3 text-[13px] leading-relaxed text-primary-light-gray shadow-[0_10px_40px_rgba(0,0,0,0.6)]'
        style={{ width: BUBBLE_WIDTH }}
      >
        {/* The tail, toward Blip. */}
        <span
          aria-hidden='true'
          className={`absolute bottom-6 h-3 w-3 rotate-45 border-[#7b5cff]/70 bg-primary-dark-gray ${side === 'right' ? '-left-[7px] border-b border-l' : '-right-[7px] border-t border-r'}`}
        />
        {children}
      </div>
    </div>
  );
}

function VoiceToggle() {
  const [muted, setMuted] = useState(isBlipMuted);
  return (
    <button
      type='button'
      aria-pressed={!muted}
      aria-label={muted ? "Turn on Blip's voice" : "Mute Blip's voice"}
      title={muted ? "Turn on Blip's voice" : "Mute Blip's voice"}
      className='cursor-pointer rounded px-1 text-[12px] text-primary-light-gray hover:bg-secondary-dark-gray hover:text-primary-white'
      onClick={() => {
        setMuted(!muted);
        void setBlipMuted(!muted);
      }}
    >
      {muted ? '🔇' : '🔈'}
    </button>
  );
}

const OFFER_TEXT = "Hi, I'm **Blip**! Want me to show you how to open the **piano** — or just open it for you?";

type TutorialLayerProps = {
  controller: TutorialController | null;
  view: TutorialView | null;
  /** First run (ruling Q14): offer the tutorial, or the demo straight away. */
  offer: boolean;
  onOfferTutorial(): void;
  onOfferJustOpen(): void;
  onOfferDismiss(): void;
};

/** Blip's first-run offer: show the piano tutorial, or just open the demo.
 *  Also shown, live, on the landing page (`showcase/WelcomeShowcase`). */
function BlipOffer({ onTutorial, onJustOpen, onDismiss }: { onTutorial(): void; onJustOpen(): void; onDismiss(): void }) {
  return (
    <Dock
      side='right'
      label='Blip, your guide'
      blip={<BlipCharacter mood='happy' speech={plain([{ say: OFFER_TEXT }])} focus={null} pointing={false} />}
    >
      <div className='flex items-center'>
        <p className='mr-auto text-[11px] font-semibold tracking-wide text-[#b444d8] uppercase'>♪ Blip</p>
        <VoiceToggle />
      </div>
      <p>{renderInline(OFFER_TEXT)}</p>
      <div className='flex flex-wrap justify-end gap-1.5'>
        <button type='button' className={BUTTON} onClick={onDismiss}>
          Not now
        </button>
        <button type='button' className={BUTTON} onClick={onJustOpen}>
          Just open it
        </button>
        <button type='button' className={PRIMARY} autoFocus onClick={onTutorial}>
          Show me how
        </button>
      </div>
    </Dock>
  );
}

function TutorialLayer({ controller, view, offer, onOfferTutorial, onOfferJustOpen, onOfferDismiss }: TutorialLayerProps) {
  const [confirmSkip, setConfirmSkip] = useState(false);
  const running = view?.status === 'running' && controller !== null;

  useEffect(() => {
    setConfirmSkip(false);
  }, [view?.step?.id]);

  // Esc asks before skipping (it is also the app's "silence" key, which
  // keeps working — this does not stop the event).
  useEffect(() => {
    if (!running) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirmSkip(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [running]);

  if (!running && offer) {
    return <BlipOffer onTutorial={onOfferTutorial} onJustOpen={onOfferJustOpen} onDismiss={onOfferDismiss} />;
  }
  if (!running || !view || !view.step) return null;

  const stepNumber = Math.max(1, view.stepIndex + 1);
  // Blip says the hint when one appears, and looks worried before a skip.
  const speaking = view.hint ?? view.lines;
  let mood: Mood = speaking[0]?.mood ?? (view.hint ? 'thinking' : view.step.type === 'point' ? 'pointing' : 'neutral');
  if (confirmSkip) mood = 'concerned';
  const blip = (
    <BlipCharacter
      mood={mood}
      speech={plain(speaking)}
      speechId={view.step.id}
      focus={view.target}
      pointing={view.step.type === 'point' && view.target !== null}
    />
  );
  return (
    <Dock side={dockSide(view.target)} label={`Tutorial: ${view.tutorial.title}`} blip={blip}>
      <div className='flex items-center gap-2'>
        <span className='text-[11px] font-semibold tracking-wide text-[#b444d8] uppercase'>♪ Blip</span>
        <span className='mr-auto text-[11px] text-secondary-light-gray'>
          {view.tutorial.title} · {stepNumber}/{view.stepCount}
        </span>
        <VoiceToggle />
        <button
          type='button'
          aria-label='Skip tutorial'
          title='Skip tutorial (Esc)'
          className='cursor-pointer rounded px-1 text-primary-light-gray hover:bg-secondary-dark-gray hover:text-primary-white'
          onClick={() => setConfirmSkip(true)}
        >
          ✕
        </button>
      </div>
      <div aria-live='polite' className='sr-only'>
        {plain(view.lines)}
        {view.hint ? ` ${plain(view.hint)}` : ''}
      </div>
      <div aria-hidden='true' className='flex flex-col gap-1'>
        {view.lines.map((line, index) => (
          <p key={index}>{renderInline(line.say)}</p>
        ))}
      </div>
      {view.hint && (
        <div aria-hidden='true' className='rounded-md bg-secondary-black/60 px-2 py-1.5 text-[12px]'>
          {view.hint.map((line, index) => (
            <p key={index}>💡 {renderInline(line.say)}</p>
          ))}
        </div>
      )}
      {view.waitingForTarget && view.step.type === 'point' && (
        <p className='text-[12px] text-secondary-light-gray'>I can’t see it on screen yet…</p>
      )}
      {confirmSkip ? (
        <div className='flex items-center justify-end gap-1.5'>
          <span className='mr-auto text-[12px]'>Skip this tutorial?</span>
          <button type='button' className={BUTTON} onClick={() => setConfirmSkip(false)}>
            Keep going
          </button>
          <button type='button' className={PRIMARY} autoFocus onClick={() => controller.skip()}>
            Skip
          </button>
        </div>
      ) : (
        <div className='flex flex-wrap items-center justify-end gap-1.5'>
          {view.waitingForAction && !view.canNext && (
            <span className='mr-auto flex items-center gap-1.5 text-[11px] text-secondary-light-gray'>
              <span className='h-1.5 w-1.5 animate-pulse rounded-full bg-[#7b5cff] motion-reduce:animate-none' />
              waiting for you…
            </span>
          )}
          {view.canPrev && (
            <button type='button' className={BUTTON} onClick={() => controller.prev()}>
              Back
            </button>
          )}
          {view.assist && (
            <button type='button' className={BUTTON} onClick={() => void controller.runAssist()}>
              {view.assist.label ?? 'Show me'}
            </button>
          )}
          {view.options.map((option, index) => (
            <button key={option.label} type='button' className={BUTTON} onClick={() => controller.choose(index)}>
              {option.label}
            </button>
          ))}
          {view.canNext && (
            <button type='button' className={PRIMARY} autoFocus onClick={() => controller.next()}>
              {view.step.type === 'end' ? 'Done' : 'Next'}
            </button>
          )}
        </div>
      )}
    </Dock>
  );
}

export { BlipOffer, renderInline, TutorialLayer };

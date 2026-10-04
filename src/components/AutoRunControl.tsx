import { useEffect, useId, useRef, useState } from 'react';
import {
  Button,
  cn,
  SliderNumberInput,
} from '@theclearsky/react-blender-nodes';

/** What the last run says about the graph on the canvas right now. */
type RunFreshness = 'none' | 'fresh' | 'stale';

const MIN_DELAY_SECONDS = 0.5;
const MAX_DELAY_SECONDS = 60;

/**
 * The delay field's caption. ONE constant, used both as the visible text and
 * as the control's spoken name, so the two can never drift apart on a copy
 * edit. It is not a `<label>`: a `<label>` binds to its first labelable
 * descendant — here the slider's decrement chevron — and the browser then
 * propagates `:hover` to that chevron from anywhere inside the label.
 */
const DELAY_LABEL = 'Run this long after the last change';

const FRESHNESS_LABEL: Record<RunFreshness, string> = {
  none: 'Not run yet',
  fresh: 'Up to date — this graph has been run',
  stale: 'Stale — the graph changed since the last run',
};

const FRESHNESS_DOT: Record<RunFreshness, string> = {
  none: 'bg-secondary-light-gray',
  fresh: 'bg-status-completed',
  stale: 'bg-status-warning',
};

export type AutoRunControlProps = {
  enabled: boolean;
  onEnabledChange(enabled: boolean): void;
  delaySeconds: number;
  onDelaySecondsChange(delaySeconds: number): void;
  freshness: RunFreshness;
  /** Seconds left before the pending auto-run fires, or null when idle. */
  countdownSeconds: number | null;
  /** Run now — the same call auto-run makes when its timer fires. */
  onRunNow(): void;
};

/**
 * The toolbar's auto-run control: a split button.
 *
 * - **Left half** toggles auto-run. It carries the freshness dot, so the one
 *   thing a user checks at a glance — "is what I hear what I built?" — is on
 *   the control they already look at, and it is readable whether auto-run is
 *   on or off.
 * - **Right half** (the caret) opens the delay editor, so the full
 *   functionality is there without spending toolbar width on it.
 *
 * While a run is pending the left half counts down, which makes the otherwise
 * invisible timer legible and gives a reason for the "run now" button beside
 * it (waiting out five seconds when you already know you want the sound is the
 * annoying part of any auto-run).
 */
function AutoRunControl({
  enabled,
  onEnabledChange,
  delaySeconds,
  onDelaySecondsChange,
  freshness,
  countdownSeconds,
  onRunNow,
}: AutoRunControlProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const popoverId = useId();
  const caretRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isSettingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation(); // Escape is also the app's panic-silence key
      setIsSettingsOpen(false);
      caretRef.current?.blur();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isSettingsOpen]);

  const pending = enabled && countdownSeconds !== null;

  return (
    <span className='relative inline-flex items-stretch'>
      <Button
        type='button'
        size='small'
        aria-pressed={enabled}
        className={cn(
          'flex items-center gap-2 rounded-r-none border border-primary-gray px-3 py-[3px] text-[13px] text-primary-white',
          enabled
            ? 'border-primary-blue bg-primary-blue/25'
            : 'bg-primary-dark-gray hover:bg-secondary-dark-gray',
        )}
        title={
          enabled
            ? `Auto-run is ON — the graph runs ${delaySeconds}s after the last change. ${FRESHNESS_LABEL[freshness]}`
            : `Auto-run is OFF. ${FRESHNESS_LABEL[freshness]}`
        }
        onClick={(event) => {
          onEnabledChange(!enabled);
          event.currentTarget.blur();
        }}
      >
        <span
          aria-hidden='true'
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            FRESHNESS_DOT[freshness],
            freshness === 'stale' && pending && 'animate-pulse',
          )}
        />
        <span>Auto-run</span>
        {/* The state a screen reader gets; the dot alone is colour-only. */}
        <span className='sr-only'>{FRESHNESS_LABEL[freshness]}</span>
        {pending && (
          <span className='tabular-nums text-primary-light-gray'>
            {countdownSeconds!.toFixed(countdownSeconds! < 1 ? 1 : 0)}s
          </span>
        )}
      </Button>
      <Button
        ref={caretRef}
        type='button'
        size='small'
        className='rounded-l-none border border-l-0 border-primary-gray bg-primary-dark-gray px-2 py-[3px] text-[10px] text-primary-white hover:bg-secondary-dark-gray'
        aria-haspopup='dialog'
        aria-expanded={isSettingsOpen}
        aria-controls={isSettingsOpen ? popoverId : undefined}
        aria-label='Auto-run settings'
        title='Auto-run delay'
        onClick={() => setIsSettingsOpen((open) => !open)}
      >
        ▾
      </Button>
      {isSettingsOpen && (
        <>
          <div
            className='fixed inset-0 z-40'
            onClick={() => setIsSettingsOpen(false)}
          />
          <div
            id={popoverId}
            className='absolute top-[calc(100%+6px)] right-0 z-50 w-64 rounded-md border border-secondary-dark-gray bg-secondary-black p-3 shadow-[0_10px_30px_rgba(0,0,0,0.55)]'
          >
            <div className='flex flex-col gap-2 text-[12px] text-primary-light-gray'>
              <span>{DELAY_LABEL}</span>
              <SliderNumberInput
                name='seconds'
                ariaLabel={DELAY_LABEL}
                size='small'
                // The menu's width, like the button under it. `!`: the host's
                // own `rbn:w-max` is a differently-prefixed class, so a plain
                // `w-full` would be decided by stylesheet order.
                className='w-full!'
                value={delaySeconds}
                min={MIN_DELAY_SECONDS}
                max={MAX_DELAY_SECONDS}
                step={0.5}
                decimals={1}
                onChange={(next) =>
                  onDelaySecondsChange(
                    Math.min(
                      MAX_DELAY_SECONDS,
                      Math.max(MIN_DELAY_SECONDS, next),
                    ),
                  )
                }
              />
            </div>
            <Button
              type='button'
              size='small'
              className='mt-3 w-full border border-primary-gray bg-primary-dark-gray py-1 text-[12px] text-primary-white hover:bg-secondary-dark-gray'
              onClick={() => {
                onRunNow();
                setIsSettingsOpen(false);
              }}
            >
              Run now
            </Button>
          </div>
        </>
      )}
    </span>
  );
}

export { AutoRunControl, MIN_DELAY_SECONDS, MAX_DELAY_SECONDS };
export type { RunFreshness };

import { useEffect, useId, useRef, useState } from 'react';
import {
  Button,
  cn,
  SliderNumberInput,
} from '@theclearsky/react-blender-nodes';

/** Whether what is on the canvas is in the open file. */
type SaveStatus = 'saved' | 'unsaved' | 'unavailable';

const MIN_SAVE_DELAY_SECONDS = 0.5;
const MAX_SAVE_DELAY_SECONDS = 60;

/** One constant for the visible caption AND the slider's spoken name (see
 *  AutoRunControl's DELAY_LABEL for why it is not a <label>). */
const DELAY_LABEL = 'Save this long after the last change';

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: 'Saved — the open file has every change',
  unsaved: 'Unsaved changes in the open file',
  unavailable: 'Not saving — no writable file is open',
};

const STATUS_DOT: Record<SaveStatus, string> = {
  saved: 'bg-status-completed',
  unsaved: 'bg-status-warning',
  unavailable: 'bg-secondary-light-gray',
};

export type AutoSaveControlProps = {
  enabled: boolean;
  onEnabledChange(enabled: boolean): void;
  delaySeconds: number;
  onDelaySecondsChange(delaySeconds: number): void;
  status: SaveStatus;
  /** An auto-save is armed and will fire after the delay. */
  pending: boolean;
  onSaveNow(): void;
};

/**
 * The toolbar's auto-save control — the same split button as Auto-run
 * (ruling F3: "same as autorun configurable"). The left half toggles
 * auto-save and carries the saved/unsaved dot; the caret opens the delay and
 * Save now. With auto-save off, Ctrl+S saves.
 */
function AutoSaveControl({
  enabled,
  onEnabledChange,
  delaySeconds,
  onDelaySecondsChange,
  status,
  pending,
  onSaveNow,
}: AutoSaveControlProps) {
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
            ? `Auto-save is ON — the open file saves ${delaySeconds}s after the last change. ${STATUS_LABEL[status]}`
            : `Auto-save is OFF — press Ctrl+S to save. ${STATUS_LABEL[status]}`
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
            STATUS_DOT[status],
            status === 'unsaved' && pending && 'animate-pulse',
          )}
        />
        <span>Auto-save</span>
        <span className='sr-only'>{STATUS_LABEL[status]}</span>
      </Button>
      <Button
        ref={caretRef}
        type='button'
        size='small'
        className='rounded-l-none border border-l-0 border-primary-gray bg-primary-dark-gray px-2 py-[3px] text-[10px] text-primary-white hover:bg-secondary-dark-gray'
        aria-haspopup='dialog'
        aria-expanded={isSettingsOpen}
        aria-controls={isSettingsOpen ? popoverId : undefined}
        aria-label='Auto-save settings'
        title='Auto-save delay'
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
                min={MIN_SAVE_DELAY_SECONDS}
                max={MAX_SAVE_DELAY_SECONDS}
                step={0.5}
                decimals={1}
                onChange={(next) =>
                  onDelaySecondsChange(
                    Math.min(
                      MAX_SAVE_DELAY_SECONDS,
                      Math.max(MIN_SAVE_DELAY_SECONDS, next),
                    ),
                  )
                }
              />
            </div>
            <Button
              type='button'
              size='small'
              disabled={status === 'unavailable'}
              className='mt-3 w-full border border-primary-gray bg-primary-dark-gray py-1 text-[12px] text-primary-white hover:bg-secondary-dark-gray disabled:opacity-50'
              onClick={() => {
                onSaveNow();
                setIsSettingsOpen(false);
              }}
            >
              Save now (Ctrl+S)
            </Button>
          </div>
        </>
      )}
    </span>
  );
}

export { AutoSaveControl };
export type { SaveStatus };

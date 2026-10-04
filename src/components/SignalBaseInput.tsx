import { Button, SliderNumberInput } from '@theclearsky/react-blender-nodes';
import type { InputComponentProps } from '@theclearsky/react-blender-nodes';

/**
 * The knob for `signal` inputs (the value type is complex, so the host's
 * native inputs don't render; this registered component does).
 *
 * It is the HOST's `SliderNumberInput` — the same widget a node's own `number`
 * input already gets — so a signal knob is now drag-to-scrub rather than a
 * text box, and it inherits that control's commit discipline once clicked into.
 * No `min`/`max` of its own: the slider then derives its step proportionally
 * from the value's own magnitude, which is what makes one control work for
 * `Hz` (20-8000) and `Amp` (0-1) alike. A socket that DECLARES a range (the
 * Easy Effects' 0–100 % knobs, Map's Amount) gets it from the host.
 *
 * UNSETTING is what a signal input needs beyond that: an unset knob means "the
 * implementation default applies". That is why `placeholder='auto'` is passed —
 * without it the face would read `value ?? 0` and display `0.0000`, which on a
 * frequency or a decay time is a WRONG reading rather than a cosmetic one.
 * Zero is a value; unset is not. The slider's `onChange` only ever emits a
 * number, so the `auto` button beside it remains the unset gesture, and it
 * still appears only when there is something to clear.
 *
 * The row is a `<div>`, NOT a `<label>`, even though it looks like one. Once the
 * `auto` button appears this row holds TWO labelable descendants, and a
 * `<label>` binds to the first one it finds and then makes Chromium propagate
 * `:hover` to it from anywhere inside — so hovering the `auto` button 100px away
 * would light up the knob. The `<label>` was doing no naming work here anyway:
 * the control carries its own `ariaLabel`.
 */
function SignalBaseInput({
  value,
  onChange,
  name,
  min,
  max,
  step,
}: InputComponentProps) {
  const committed = typeof value === 'number' ? value : undefined;

  return (
    <div
      className='nodrag nopan nowheel flex w-full touch-none items-center gap-3'
      onPointerDown={(event) => event.stopPropagation()}
    >
      <SliderNumberInput
        name={name}
        ariaLabel={name}
        value={committed}
        // Each ◂ / ▸ click moves exactly 0.5 (Deepak, 2026-09-27); drags stay
        // proportional so a 900 Hz knob is not stuck crawling in halves. A
        // socket that declares its own step (a 0–100 % knob: 1) uses that.
        increment={step ?? 0.5}
        min={min}
        max={max}
        step={step}
        // A whole-number step (the 0–100 % knobs) reads "40", not "40.0000".
        decimals={
          step !== undefined && Number.isInteger(step) ? 0 : undefined
        }
        placeholder='auto'
        onChange={(next) => {
          if (next !== committed) onChange(next);
        }}
        className='w-full min-w-0 flex-1'
      />
      {committed !== undefined && (
        <Button
          type='button'
          size='small'
          className='flex-none'
          title={`Clear ${name} — the implementation default applies again`}
          aria-label={`Clear ${name}`}
          onClick={(event) => {
            onChange(undefined);
            event.currentTarget.blur();
          }}
        >
          auto
        </Button>
      )}
    </div>
  );
}

export { SignalBaseInput };

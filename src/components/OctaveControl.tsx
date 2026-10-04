/**
 * The keyboard octave readout, with buttons.
 *
 * The octave window was previously invisible and only reachable through the
 * `,` / `.` keys, so there was no way to tell which octave you were in except
 * by ear — and an instrument that sounded wrong could just as easily be in
 * the wrong register as badly modelled.
 *
 * Lives in the app toolbar, which is the one surface present on every screen
 * (entering a node group swaps the graph beneath it, not the header).
 *
 * TWO things this must not do:
 * - It must not KEEP FOCUS. Note keys themselves are fine — the bus listens
 *   on `window` and `isTypingTarget` does not exclude plain buttons — but a
 *   focused button re-fires on Space and Enter, so playing would randomly
 *   jump the octave. Each button blurs itself.
 * - It must not go stale. `,` / `.` still shift the octave, and so does any
 *   other caller, so the readout subscribes to the bus's `octave` event
 *   rather than tracking its own copy of the state.
 */

import { useEffect, useState } from 'react';
import {
  getOctaveShift,
  OCTAVE_MAX,
  OCTAVE_MIN,
  octaveLabel,
  onKeyBusEvent,
  shiftOctave,
} from '../audio/keyboardBus';

/** The stepper buttons: the toolbar button, squared off and seam-free. */
const STEP_BUTTON_CLASS =
  'cursor-pointer rounded-none border-none bg-primary-dark-gray px-2.5 py-[3px] text-[13px] leading-[1.3] text-primary-white hover:bg-secondary-dark-gray disabled:cursor-default disabled:bg-secondary-black disabled:text-secondary-light-gray';

function OctaveControl() {
  const [shift, setShift] = useState(getOctaveShift);

  useEffect(() => {
    // The bus emits 'octave' AFTER octaveShift updates, so re-reading here is
    // always the new value. Covers the `,`/`.` keys as well as these buttons.
    return onKeyBusEvent((event) => {
      if (event.type === 'octave') setShift(getOctaveShift());
    });
  }, []);

  function step(delta: number, element: HTMLButtonElement) {
    shiftOctave(delta);
    // Drop focus, or Space/Enter while playing would re-fire this button.
    element.blur();
  }

  return (
    <span
      // Grouped so the pair reads as one control rather than two loose buttons
      // among the toolbar's other ones.
      className='inline-flex items-stretch overflow-hidden rounded border border-primary-gray'
      title='Keyboard octave — also the , and . keys'
    >
      <button
        type='button'
        className={STEP_BUTTON_CLASS}
        disabled={shift <= OCTAVE_MIN}
        onClick={(event) => step(-1, event.currentTarget)}
        aria-label='Octave down'
        title='Octave down (,)'
      >
        −
      </button>
      {/* Fixed width so stepping through octaves does not shuffle the toolbar. */}
      <span className='inline-flex min-w-[74px] items-baseline justify-center gap-[5px] border-x border-primary-gray bg-primary-black px-2.5 py-[3px]'>
        <span className='text-[13px] text-primary-white tabular-nums'>
          {octaveLabel()}
        </span>
        <span className='text-[11px] text-primary-light-gray tabular-nums'>
          {shift === 0 ? 'home' : shift > 0 ? `+${shift}` : shift}
        </span>
      </span>
      <button
        type='button'
        className={STEP_BUTTON_CLASS}
        disabled={shift >= OCTAVE_MAX}
        onClick={(event) => step(1, event.currentTarget)}
        aria-label='Octave up'
        title='Octave up (.)'
      >
        +
      </button>
    </span>
  );
}

export { OctaveControl };

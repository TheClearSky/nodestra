import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { InputComponentProps } from '@theclearsky/react-blender-nodes';
import type { WaveformValue } from '../soundDefinitions/valueTypes';
import { parseWaveformValue } from '../soundDefinitions/valueTypes';
import {
  applyStrokeSegment,
  noisePreset,
  normalizeSamples,
  sawPreset,
  sinePreset,
  smoothSamples,
  squarePreset,
  trianglePreset,
  WAVEFORM_SAMPLE_COUNT,
} from '../soundDefinitions/waveformMath';

/**
 * THE drawn-wave editor. One cycle, N=256 samples in [−1, 1].
 *
 * - Strokes interpolate BETWEEN pointer events (fast strokes must not gap).
 * - Commit on pointer-up ONLY (per-move would spam host history);
 *   `pointercancel`/Escape DISCARD the in-progress stroke.
 * - Preset buttons SEED the canvas and commit immediately — "draw
 *   sine/saw/etc" means editable preset seeds.
 * - Ghost sine renders while no value is committed (impl defaults to sine).
 */
function WaveformDrawInput({ value, onChange, name }: InputComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draftRef = useRef<number[] | null>(null);
  const lastPointRef = useRef<{ index: number; sample: number } | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const captureHeldRef = useRef(false);

  // Memoized: zod-parsing 256 numbers per render defeated the drawCanvas
  // memo and repainted on every unrelated re-render.
  const committedSamples = useMemo(() => parseWaveformValue(value), [value]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#232323';
    context.fillRect(0, 0, width, height);

    // Grid: quarter lines + center line.
    context.strokeStyle = '#303030';
    context.lineWidth = 1;
    for (const fraction of [0.25, 0.75]) {
      context.beginPath();
      context.moveTo(0, height * fraction);
      context.lineTo(width, height * fraction);
      context.stroke();
    }
    context.strokeStyle = '#444444';
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();

    const samples = draftRef.current ?? committedSamples;
    const ghost = samples === undefined;
    const plotted = samples ?? sinePreset();

    context.strokeStyle = ghost ? '#5b5470' : '#9B59B6';
    context.lineWidth = Math.max(2, width / 220); // scale with backing store
    context.setLineDash(ghost ? [6, 6] : []);
    context.beginPath();
    for (let i = 0; i < plotted.length; i++) {
      const x = (i / (plotted.length - 1)) * width;
      const y = ((1 - plotted[i]) / 2) * height;
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
    context.setLineDash([]);
  }, [committedSamples]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  function commitSamples(samples: readonly number[]) {
    const next: WaveformValue = { kind: 'waveform', samples: [...samples] };
    onChange(next);
  }

  function pointToSample(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.round(
      Math.min(1, Math.max(0, ratio)) * (WAVEFORM_SAMPLE_COUNT - 1),
    );
    const vertical = (event.clientY - rect.top) / rect.height;
    const sample = 1 - 2 * Math.min(1, Math.max(0, vertical));
    return { index, sample };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.stopPropagation();
    // Primary button only — right-click belongs to the context menu.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (activePointerIdRef.current !== null) return; // one stroke at a time
    const point = pointToSample(event);
    if (!point) return;
    captureHeldRef.current = false;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
      captureHeldRef.current = true;
    } catch {
      // Synthetic/expired pointerIds (tests, some pens) can't be captured —
      // drawing still works; pointerleave discards instead.
    }
    activePointerIdRef.current = event.pointerId;
    const base = committedSamples ? [...committedSamples] : sinePreset();
    draftRef.current = applyStrokeSegment(
      base,
      point.index,
      point.sample,
      point.index,
      point.sample,
    );
    lastPointRef.current = point;
    drawCanvas();
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!draftRef.current || !lastPointRef.current) return;
    // Stroke lifecycle is keyed to ONE pointer; hover (buttons=0) after a
    // lost pointerup must not keep painting.
    if (event.pointerId !== activePointerIdRef.current) return;
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      discardStroke();
      return;
    }
    const point = pointToSample(event);
    if (!point) return;
    draftRef.current = applyStrokeSegment(
      draftRef.current,
      lastPointRef.current.index,
      lastPointRef.current.sample,
      point.index,
      point.sample,
    );
    lastPointRef.current = point;
    drawCanvas();
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerId !== activePointerIdRef.current) return;
    if (draftRef.current) commitSamples(draftRef.current);
    endStroke();
  }

  function handlePointerLeave() {
    // Without capture there will be no pointerup — discard rather than let
    // the dangling draft keep drawing on hover.
    if (!captureHeldRef.current && activePointerIdRef.current !== null) {
      discardStroke();
    }
  }

  // The mount-only window listener below must never capture a stale
  // drawCanvas closure — route repaints through a ref.
  const drawCanvasRef = useRef(drawCanvas);
  drawCanvasRef.current = drawCanvas;

  function endStroke() {
    draftRef.current = null;
    lastPointRef.current = null;
    activePointerIdRef.current = null;
    captureHeldRef.current = false;
    drawCanvasRef.current();
  }

  function discardStroke() {
    endStroke();
  }

  // "Esc aborts a drag", focus-independent: a WINDOW-level capture listener
  // discards an ACTIVE stroke and stops the event so the App's Esc
  // panic-silence does not also fire.
  useEffect(() => {
    function onWindowKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (activePointerIdRef.current === null) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      draftRef.current = null;
      lastPointRef.current = null;
      activePointerIdRef.current = null;
      captureHeldRef.current = false;
      drawCanvasRef.current();
    }
    window.addEventListener('keydown', onWindowKeyDown, { capture: true });
    return () =>
      window.removeEventListener('keydown', onWindowKeyDown, {
        capture: true,
      });
  }, []);

  const presetButtonClass =
    'cursor-pointer rounded border border-primary-gray bg-primary-dark-gray px-2.5 py-0.5 text-[0.55em] text-primary-white enabled:hover:bg-secondary-dark-gray disabled:cursor-default disabled:text-secondary-light-gray';

  return (
    <div
      className='waveform-draw-input nodrag nopan nowheel flex w-full touch-none flex-col gap-2'
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className='text-[0.8em] text-primary-light-gray'>{name}</span>
      <canvas
        ref={canvasRef}
        width={880}
        height={360}
        className='block h-auto w-full cursor-crosshair rounded-md border border-secondary-dark-gray'
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={discardStroke}
        onPointerLeave={handlePointerLeave}
      />
      <div className='flex flex-wrap gap-1.5'>
        <button
          type='button'
          className={presetButtonClass}
          onClick={() => commitSamples(sinePreset())}
        >
          Sine
        </button>
        <button
          type='button'
          className={presetButtonClass}
          onClick={() => commitSamples(squarePreset())}
        >
          Square
        </button>
        <button
          type='button'
          className={presetButtonClass}
          onClick={() => commitSamples(sawPreset())}
        >
          Saw
        </button>
        <button
          type='button'
          className={presetButtonClass}
          onClick={() => commitSamples(trianglePreset())}
        >
          Tri
        </button>
        <button
          type='button'
          className={presetButtonClass}
          onClick={() => commitSamples(noisePreset())}
        >
          Noise
        </button>
        <button
          type='button'
          className={presetButtonClass}
          disabled={!committedSamples}
          onClick={() =>
            committedSamples && commitSamples(smoothSamples(committedSamples))
          }
        >
          Smooth
        </button>
        <button
          type='button'
          className={presetButtonClass}
          disabled={!committedSamples}
          onClick={() =>
            committedSamples &&
            commitSamples(normalizeSamples(committedSamples))
          }
        >
          Normalize
        </button>
      </div>
    </div>
  );
}

export { WaveformDrawInput };

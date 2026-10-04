import { useEffect, useRef, useState } from 'react';
import { cn, type NodePreviewProps } from '@theclearsky/react-blender-nodes';
import * as Tone from 'tone';
import { isAudioChain } from '../../soundDefinitions/valueTypes';
import type { TapMode } from './tapManager';
import {
  acquireTap,
  getPreviewMode,
  registerPainter,
  setPreviewMode,
} from './tapManager';

// 2× backing store — crisp at common devicePixelRatios; CSS scales it
// to the node width.
const WIDTH = 880;
const HEIGHT = 240;
const AUDIOGRAM_FRAME_MS = 33; // ~30 fps
const MIN_DB = -100;
const MAX_DB = -10;

function findAudioChain(live: NodePreviewProps['live']) {
  if (!live) return null;
  for (const output of live.outputValues.values()) {
    if (isAudioChain(output.value)) return output.value;
  }
  // Render has no outputs — read its input connections.
  for (const input of live.inputValues.values()) {
    for (const connection of input.connections) {
      if (isAudioChain(connection.value)) return connection.value;
    }
  }
  return null;
}

function drawFlatline(context: CanvasRenderingContext2D): void {
  context.fillStyle = '#232323';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.strokeStyle = '#444444';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, HEIGHT / 2);
  context.lineTo(WIDTH, HEIGHT / 2);
  context.stroke();
}

function drawWave(
  context: CanvasRenderingContext2D,
  values: Float32Array,
): void {
  context.fillStyle = '#232323';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.strokeStyle = '#2ECC71';
  context.lineWidth = 3;
  context.beginPath();
  for (let i = 0; i < values.length; i++) {
    const x = (i / (values.length - 1)) * WIDTH;
    const y = ((1 - Math.max(-1, Math.min(1, values[i]))) / 2) * HEIGHT;
    if (i === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}

function dbToColor(db: number): string {
  const t = Math.max(0, Math.min(1, (db - MIN_DB) / (MAX_DB - MIN_DB)));
  // Dark → amber → white heat ramp on the app palette.
  const r = Math.round(35 + t * 220);
  const g = Math.round(30 + t * t * 190);
  const b = Math.round(35 + Math.max(0, t - 0.75) * 4 * 180);
  return `rgb(${r},${g},${b})`;
}

/** Scrolling audiogram: shift left 1px, paint the new FFT frame as the
 *  rightmost column, log-frequency vertical axis. */
function drawAudiogramColumn(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  bins: Float32Array,
): void {
  context.drawImage(
    canvas,
    1,
    0,
    WIDTH - 1,
    HEIGHT,
    0,
    0,
    WIDTH - 1,
    HEIGHT,
  );
  const maxBin = bins.length - 1;
  for (let y = 0; y < HEIGHT; y++) {
    // Row 0 = top = Nyquist; log map keeps the musical range readable.
    const fraction = 1 - y / (HEIGHT - 1);
    const bin = Math.min(maxBin, Math.max(1, Math.round(maxBin ** fraction)));
    context.fillStyle = dbToColor(bins[bin]);
    context.fillRect(WIDTH - 1, y, 1, 1);
  }
}

function drawMeter(context: CanvasRenderingContext2D, db: number): void {
  context.fillStyle = '#232323';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  const t = Math.max(0, Math.min(1, (db - MIN_DB) / (MAX_DB - MIN_DB)));
  context.fillStyle = t > 0.9 ? '#ef4444' : t > 0.7 ? '#f59e0b' : '#22c55e';
  context.fillRect(8, HEIGHT / 2 - 14, (WIDTH - 16) * t, 28);
  context.strokeStyle = '#545454';
  context.strokeRect(8, HEIGHT / 2 - 14, WIDTH - 16, 28);
  context.fillStyle = '#e6e6e6';
  context.font = '20px system-ui';
  context.fillText(
    Number.isFinite(db) ? `${db.toFixed(1)} dB` : '-∞ dB',
    16,
    HEIGHT / 2 - 22,
  );
}

/**
 * The universal audio preview: live waveform, per-node toggle to the
 * audiogram heat map, meter mode on Render. One component registered for
 * EVERY audio node type.
 */
function AudioPreview({ nodeId, nodeTypeId, live }: NodePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isRender = nodeTypeId === 'render';
  const [mode, setMode] = useState<TapMode>(() =>
    getPreviewMode(nodeId, isRender ? 'meter' : 'wave'),
  );
  const liveRef = useRef(live);
  liveRef.current = live;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const lastAudiogramPaintRef = useRef(0);

  useEffect(() => {
    return registerPainter(nodeId, () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;

      // The LRU cap may have demoted this node's mode externally.
      const storedMode = getPreviewMode(nodeId, isRender ? 'meter' : 'wave');
      if (storedMode !== modeRef.current) setMode(storedMode);

      const chain = findAudioChain(liveRef.current);
      if (!chain) {
        drawFlatline(context);
        return;
      }
      const tap = acquireTap(nodeId, chain, storedMode);
      if (!tap) {
        drawFlatline(context); // stale build
        return;
      }
      if (storedMode === 'wave') {
        drawWave(context, (tap.analyser as Tone.Waveform).getValue());
      } else if (storedMode === 'audiogram') {
        const now = performance.now();
        if (now - lastAudiogramPaintRef.current < AUDIOGRAM_FRAME_MS) return;
        lastAudiogramPaintRef.current = now;
        drawAudiogramColumn(
          canvas,
          context,
          (tap.analyser as Tone.FFT).getValue(),
        );
      } else if (storedMode === 'meter') {
        const value = (tap.analyser as Tone.Meter).getValue();
        drawMeter(context, Array.isArray(value) ? Math.max(...value) : value);
      }
    });
  }, [nodeId, isRender]);

  function selectMode(next: TapMode) {
    setPreviewMode(nodeId, next);
    setMode(next);
  }

  const modes: TapMode[] = isRender
    ? ['wave', 'audiogram', 'meter']
    : ['wave', 'audiogram'];

  return (
    <div
      className='audio-preview nodrag nopan nowheel flex w-full touch-none flex-col gap-1.5'
      onPointerDown={(event) => event.stopPropagation()}
    >
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className='block h-auto w-full rounded-md border border-secondary-dark-gray'
      />
      <div className='flex gap-1.5'>
        {modes.map((candidate) => (
          <button
            key={candidate}
            type='button'
            aria-pressed={mode === candidate}
            className={cn(
              'cursor-pointer rounded border border-primary-gray bg-primary-dark-gray px-2.5 py-0.5 text-[0.55em] text-primary-light-gray',
              mode === candidate &&
                'border-primary-light-gray bg-secondary-dark-gray text-primary-white',
            )}
            onClick={() => selectMode(candidate)}
          >
            {candidate}
          </button>
        ))}
      </div>
    </div>
  );
}

export { AudioPreview };

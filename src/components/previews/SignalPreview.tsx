import { useEffect, useRef, useState } from 'react';
import type { NodePreviewProps } from '@theclearsky/react-blender-nodes';
import type * as Tone from 'tone';
import { isSignalChain } from '../../soundDefinitions/valueTypes';
import { acquireTap, registerPainter } from './tapManager';

// 2× backing store — CSS scales to the node width.
const WIDTH = 880;
const HEIGHT = 180;
const TRACE_LENGTH = 256;

function findSignalChain(live: NodePreviewProps['live']) {
  if (!live) return null;
  for (const output of live.outputValues.values()) {
    if (isSignalChain(output.value)) return output.value;
  }
  return null;
}

/**
 * Signal preview: a seconds-wide trace + the live numeric readout —
 * where "the number changes" is SEEN on Pulser/Constant/KeyboardPitch nodes.
 * Tap = Tone.DCMeter (raw signed value).
 */
function SignalPreview({ nodeId, live }: NodePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const traceRef = useRef<number[]>([]);
  const [readout, setReadout] = useState<string>('—');
  const liveRef = useRef(live);
  liveRef.current = live;
  const lastReadoutUpdateRef = useRef(0);

  useEffect(() => {
    return registerPainter(nodeId, () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;

      context.fillStyle = '#232323';
      context.fillRect(0, 0, WIDTH, HEIGHT);

      const chain = findSignalChain(liveRef.current);
      const tap = chain ? acquireTap(nodeId, chain, 'signal') : null;
      if (!tap) {
        // Stale/stopped build: clear instead of freezing seconds-old data
        // that looks live.
        if (traceRef.current.length > 0) {
          traceRef.current = [];
          setReadout('—');
        }
        return;
      }
      if (tap) {
        const buffer = (tap.analyser as Tone.Waveform).getValue();
        const value = buffer[buffer.length - 1];
        if (Number.isFinite(value)) {
          const trace = traceRef.current;
          trace.push(value);
          if (trace.length > TRACE_LENGTH) trace.shift();
          const now = performance.now();
          if (now - lastReadoutUpdateRef.current > 120) {
            lastReadoutUpdateRef.current = now;
            setReadout(value.toFixed(3));
          }
        }
      }

      const trace = traceRef.current;
      if (trace.length < 2) return;
      let min = Math.min(...trace);
      let max = Math.max(...trace);
      if (max - min < 1e-6) {
        min -= 1;
        max += 1;
      }
      const pad = (max - min) * 0.1;
      min -= pad;
      max += pad;

      context.strokeStyle = '#F1C40F';
      context.lineWidth = 3;
      context.beginPath();
      for (let i = 0; i < trace.length; i++) {
        const x = (i / (TRACE_LENGTH - 1)) * WIDTH;
        const y = HEIGHT - ((trace[i] - min) / (max - min)) * HEIGHT;
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    });
  }, [nodeId]);

  return (
    <div
      className='signal-preview nodrag nopan nowheel flex w-full touch-none flex-col gap-1.5'
      onPointerDown={(event) => event.stopPropagation()}
    >
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className='block h-auto w-full rounded-md border border-secondary-dark-gray'
      />
      <span className='text-[0.7em] text-signal-readout tabular-nums'>
        {readout}
      </span>
    </div>
  );
}

export { SignalPreview };

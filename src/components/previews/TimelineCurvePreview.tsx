import { useEffect, useRef } from 'react';
import type { NodePreviewProps } from '@theclearsky/react-blender-nodes';
import { evaluateCurve } from '@theclearsky/react-blender-nodes-timeline';
import { isSignalChain } from '../../soundDefinitions/valueTypes';
import { arePreviewsPaused } from './tapManager';
import {
  getTimelineStore,
  getTimelineTransport,
} from '../../timeline/timelineSystem';

// 2× backing store — CSS scales to the node width.
const WIDTH = 880;
const HEIGHT = 180;

/** The impl stamps the picked curve id onto its SignalChain output. */
function findCurveId(live: NodePreviewProps['live']): string | null {
  if (!live) return null;
  for (const output of live.outputValues.values()) {
    const value = output.value;
    if (isSignalChain(value)) {
      const curveId = (value as { timelineCurveId?: unknown }).timelineCurveId;
      if (typeof curveId === 'string') return curveId;
    }
  }
  return null;
}

type PaintInputs = {
  live: NodePreviewProps['live'];
  timelineDocument: unknown;
  playheadTime: number;
};

/**
 * Timeline-curve node preview: mini curve thumbnail +
 * playhead marker + live numeric readout — "when the timeline is moved,
 * the number changes", visible on the node itself. Reads the document and
 * transport directly (no audio tap needed: the driver value IS
 * evaluateCurve(t) by the transport's construction).
 */
function TimelineCurvePreview({ live }: NodePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  const lastPaintRef = useRef<PaintInputs | null>(null);

  useEffect(() => {
    let frameHandle = 0;
    function paint() {
      frameHandle = requestAnimationFrame(paint);
      if (arePreviewsPaused()) return;
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;

      // Repaint only when an input actually changed — an unconditional
      // 60 fps clear+resample per node is constant CPU drain for a static
      // picture.
      const document = getTimelineStore().getDocument();
      const playheadTime = getTimelineTransport()?.getPlayheadTime() ?? 0;
      const previous = lastPaintRef.current;
      if (
        previous !== null &&
        previous.live === liveRef.current &&
        previous.timelineDocument === document &&
        previous.playheadTime === playheadTime
      ) {
        return;
      }
      lastPaintRef.current = {
        live: liveRef.current,
        timelineDocument: document,
        playheadTime,
      };

      context.fillStyle = '#232323';
      context.fillRect(0, 0, WIDTH, HEIGHT);

      const curveId = findCurveId(liveRef.current);
      const curve =
        curveId === null
          ? undefined
          : document.curves.find((candidate) => candidate.id === curveId);

      if (curve === undefined) {
        // Distinguish "never ran" from "ran with nothing picked" — the
        // stamp is only present after a run.
        const ranWithoutSelection = liveRef.current !== null && curveId === null;
        context.fillStyle =
          curveId === null && !ranWithoutSelection ? '#797979' : '#fb7185';
        context.font = '24px system-ui, sans-serif';
        context.textAlign = 'center';
        context.fillText(
          curveId !== null
            ? `missing curve: ${curveId}`
            : ranWithoutSelection
              ? 'no curve selected'
              : 'run to preview',
          WIDTH / 2,
          HEIGHT / 2,
        );
        return;
      }

      const durationSec = Math.max(document.durationSec, 1e-6);
      // Thumbnail y-range from a coarse sample sweep (padded 10%).
      const sampleCount = 220;
      const samples: number[] = [];
      let minValue = Infinity;
      let maxValue = -Infinity;
      for (let index = 0; index < sampleCount; index += 1) {
        const value = evaluateCurve(
          curve,
          (durationSec * index) / (sampleCount - 1),
        );
        samples.push(value);
        minValue = Math.min(minValue, value);
        maxValue = Math.max(maxValue, value);
      }
      if (minValue === maxValue) {
        minValue -= 1;
        maxValue += 1;
      }
      const padding = (maxValue - minValue) * 0.1;
      minValue -= padding;
      maxValue += padding;
      const valueToY = (value: number) =>
        HEIGHT - ((value - minValue) / (maxValue - minValue)) * HEIGHT;

      context.strokeStyle = curve.color;
      context.lineWidth = 3;
      context.beginPath();
      for (const [index, value] of samples.entries()) {
        const x = (WIDTH * index) / (sampleCount - 1);
        if (index === 0) context.moveTo(x, valueToY(value));
        else context.lineTo(x, valueToY(value));
      }
      context.stroke();

      const playheadX = (WIDTH * playheadTime) / durationSec;
      context.strokeStyle = '#F1C40F';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(playheadX, 0);
      context.lineTo(playheadX, HEIGHT);
      context.stroke();

      const currentValue = evaluateCurve(curve, playheadTime);
      context.fillStyle = '#e6e6e6';
      context.font = '26px ui-monospace, monospace';
      context.textAlign = 'left';
      context.fillText(
        `${curve.name}: ${currentValue.toFixed(2)}`,
        10,
        30,
      );
    }
    frameHandle = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frameHandle);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={WIDTH}
      height={HEIGHT}
      style={{ width: '100%', height: 'auto', display: 'block' }}
    />
  );
}

export { TimelineCurvePreview };

/**
 * MODULE-LEVEL preview registry: an inline JSX literal
 * would remount every preview each App render — this object is created once.
 * One AudioPreview over every audio-emitting type + Render; SignalPreview
 * over every signal-emitting type.
 */

import type { NodePreviewRegistry } from '@theclearsky/react-blender-nodes';
import { effectRows } from '../../soundDefinitions/effectTable';
import { AudioPreview } from './AudioPreview';
import { SignalPreview } from './SignalPreview';
import { TimelineCurvePreview } from './TimelineCurvePreview';

const audioTypeIds = [
  'drawnOsc',
  'oscillator',
  'noise',
  'player',
  'toAudio',
  ...effectRows.map((row) => row.id),
  'saturator',
  'filter',
  'eq3',
  'compressor',
  'limiter',
  'gate',
  'gain',
  'pan',
  'crossFade',
  'mix',
  'adsr',
  'render',
  // Physical models — without these the new nodes get no audiogram tap, so
  // `window.__sound.getFftBins(nodeId)` returns null and live verification
  // cannot see their spectra.
  'pluckedString',
  'bowedString',
  'stringBody',
  'jetFlute',
] as const;

// 'threshold' gets SignalPreview as-is (first output = Gate). 'allKeys'
// is deliberately ABSENT — SignalPreview shows only the FIRST signal
// output, which would silently display 1 of its 32 lanes; a dedicated
// multi-lane preview is a future polish item.
const signalTypeIds = [
  'pulser',
  'constant',
  'keyboardPitch',
  'toSignal',
  'threshold',
] as const;

const previewRegistry: NodePreviewRegistry = {
  ...Object.fromEntries(audioTypeIds.map((id) => [id, AudioPreview])),
  ...Object.fromEntries(signalTypeIds.map((id) => [id, SignalPreview])),
  // Thumbnail + playhead + live readout.
  timelineCurve: TimelineCurvePreview,
};

export { previewRegistry };

/**
 * Per-instrument demos — one demo per instrument, so the whole library
 * can be checked without wiring anything up by hand.
 *
 * - Every TONAL instrument gets a demo with ONE INSTANCE PER KEY across
 *   the full key row, wired from one All Keys node into a Mix →
 *   Render. Polyphony by instantiation: play chords, and every key on
 *   the row sounds.
 * - Every KIT gets one demo with its pieces on consecutive white keys.
 *   A kit piece id ENCODES its key (`inst_deepKit_s` plays on `s`), so
 *   the key mapping is the identity itself — nothing here can drift out
 *   of step with the generated modules.
 * - `buildInstrumentProbeState` is the single-instrument probe harness:
 *   a pulse-driven gate through a Threshold. It pulses rather than
 *   holding because envelopeCore never fires on a gate that is already
 *   high at its first sample (the pinned no-init-edge rule); real play
 *   is unaffected since All Keys gates start low.
 */

import { KEY_ORDER, keyLabel } from '../audio/keyMap';
import type { KeyName } from '../audio/keyMap';
import { instrumentNodeTypes as generatedInstrumentNodeTypes } from './instruments';
import { physicalInstrumentNodeTypes } from './instruments/physical';
import type { SoundCatalogNodeTypeId } from './nodeCatalog';
import type { EdgeSpec, NodeSpec, ProbeState } from './probeGraphs';
import { buildState } from './probeGraphs';

/** Both instrument barrels: the recipe-generated library and the
 *  hand-written Phase D physical models. */
const instrumentNodeTypes = {
  ...generatedInstrumentNodeTypes,
  ...physicalInstrumentNodeTypes,
};

type InstrumentCatalogId = keyof typeof instrumentNodeTypes & string;

/** The kits, in menu order. `prefix` is also the piece-id prefix. */
const KIT_DEMOS = [
  { prefix: 'inst_deepKit_', label: 'Deep Kit' },
  { prefix: 'inst_lightKit_', label: 'Light Kit' },
  { prefix: 'inst_kit3_', label: 'Kit 3' },
] as const;

/**
 * Key order for kit pieces: the home row first — the keys a kit is
 * naturally played on — then the upper row, so a kit with more than
 * nine pieces still maps to distinct keys instead of running out.
 * (KEY_ORDER itself interleaves the two rows chromatically, which
 * would scatter a kit across both.)
 */
const KIT_KEY_SEQUENCE: readonly KeyName[] = [
  'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l',
  'w', 'e', 't', 'y', 'u', 'o', 'p',
];

const instrumentIds = Object.keys(instrumentNodeTypes) as InstrumentCatalogId[];

function isKitPiece(id: string): boolean {
  return KIT_DEMOS.some((kit) => id.startsWith(kit.prefix));
}

/** Render level of every Instrument-library demo (the Render's unwired
 *  default is −6 dB; the fitted voices sit well under unity). */
const INSTRUMENT_DEMO_RENDER_DB = 10;

/**
 * Per-instrument render overrides, in dB.
 *
 * The physically modelled violins run far hotter than the fitted voices the
 * +10 dB default was chosen for: their body carries a broad bridge hill, so
 * a single G3 peaks near unity where a recipe instrument sits well below it.
 * User ruling 2026-09-06: the violins play at 1 dB, guitar and the rest stay
 * at 10.
 */
const INSTRUMENT_DEMO_RENDER_DB_OVERRIDES: Readonly<Record<string, number>> = {
  inst_violinPM_thermal: 1,
};

function renderDbFor(instrumentId: string): number {
  return (
    INSTRUMENT_DEMO_RENDER_DB_OVERRIDES[instrumentId] ??
    INSTRUMENT_DEMO_RENDER_DB
  );
}

/** Drones have no envelope and sound while the graph runs: their demo is
 *  ONE voice on the key's root, never one voice per key. */
const DRONE_IDS: ReadonlySet<string> = new Set(['inst_starryDrone']);
/** D♯3 — the Starry Night key's root, an octave down: a drone is meant
 *  to sit deep under a mix (user ruling 2026-09-06: "deep and soft"). */
const DRONE_DEMO_HZ = 440 * 2 ** (-18 / 12);

const tonalIds = instrumentIds.filter(
  (id) => !isKitPiece(id) && !DRONE_IDS.has(id),
);
const droneIds = instrumentIds.filter((id) => DRONE_IDS.has(id));

function typeName(id: InstrumentCatalogId): string {
  return (instrumentNodeTypes[id] as { name: string }).name;
}

type KitPiece = { id: InstrumentCatalogId; key: KeyName };

function isKeyName(value: string): value is KeyName {
  return (KEY_ORDER as readonly string[]).includes(value);
}

/** Pieces of one kit, ordered along the playing sequence. */
function kitPieces(prefix: string): KitPiece[] {
  return instrumentIds
    .filter((id) => id.startsWith(prefix))
    .map((id) => ({ id, key: id.slice(prefix.length) }))
    .filter((piece): piece is KitPiece => isKeyName(piece.key))
    .sort(
      (a, b) =>
        KIT_KEY_SEQUENCE.indexOf(a.key) - KIT_KEY_SEQUENCE.indexOf(b.key),
    );
}

function tonalDemoState(instrumentId: InstrumentCatalogId): ProbeState {
  const nodes: NodeSpec[] = [
    { id: 'keys', type: 'allKeys', x: -1100, y: 900 },
    { id: 'mix', type: 'mix', x: 420, y: 900 },
    // +10 dB (user ruling 2026-09-06 "increase instrument render to 10db"):
    // the fitted voices sit well under unity, so the demos were quiet at
    // the Render's −6 dB default.
    {
      id: 'out',
      type: 'render',
      x: 680,
      y: 920,
      values: { 'Level dB': renderDbFor(instrumentId) },
    },
  ];
  const edges: EdgeSpec[] = [
    { from: 'mix', output: 'Out', to: 'out', input: 'In' },
  ];
  KEY_ORDER.forEach((key, index) => {
    const voiceId = `v${index}`;
    nodes.push({
      id: voiceId,
      type: instrumentId as SoundCatalogNodeTypeId,
      x: index % 2 === 0 ? -560 : -180,
      y: Math.floor(index / 2) * 240,
    });
    edges.push(
      { from: 'keys', output: `${keyLabel(key)} Hz`, to: voiceId, input: 'Hz' },
      {
        from: 'keys',
        output: `${keyLabel(key)} Gate`,
        to: voiceId,
        input: 'Gate',
      },
      { from: voiceId, output: 'Out', to: 'mix', input: 'In' },
    );
  });
  return buildState(nodes, edges);
}

/** Like the Background-sound drones: a root voice plus an octave-down sub
 *  voice at lower level, widened by a slow chorus, in a long hall. */
function droneDemoState(instrumentId: InstrumentCatalogId): ProbeState {
  return buildState(
    [
      {
        id: 'pitch',
        type: 'constant',
        x: -900,
        y: 0,
        values: { Value: DRONE_DEMO_HZ },
      },
      {
        id: 'pitchSub',
        type: 'constant',
        x: -900,
        y: 300,
        values: { Value: DRONE_DEMO_HZ / 2 },
      },
      {
        id: 'subAmp',
        type: 'constant',
        x: -900,
        y: 480,
        values: { Value: 0.55 },
      },
      { id: 'voice', type: instrumentId as SoundCatalogNodeTypeId, x: -500, y: 0 },
      {
        id: 'voiceSub',
        type: instrumentId as SoundCatalogNodeTypeId,
        x: -500,
        y: 300,
      },
      { id: 'mix', type: 'mix', x: -60, y: 140 },
      {
        id: 'chorus',
        type: 'chorus',
        x: 300,
        y: 140,
        values: { 'Rate Hz': 0.3, 'Delay ms': 7, Depth: 0.7, Wet: 0.5 },
      },
      {
        id: 'hall',
        type: 'reverb',
        x: 660,
        y: 140,
        values: { 'Decay s': 7, 'PreDelay s': 0.04, Wet: 0.5 },
      },
      {
        id: 'out',
        type: 'render',
        x: 1020,
        y: 160,
        values: { 'Level dB': renderDbFor(instrumentId) },
      },
    ],
    [
      { from: 'pitch', output: 'Out', to: 'voice', input: 'Hz' },
      { from: 'pitchSub', output: 'Out', to: 'voiceSub', input: 'Hz' },
      { from: 'subAmp', output: 'Out', to: 'voiceSub', input: 'Amp' },
      { from: 'voice', output: 'Out', to: 'mix', input: 'In' },
      { from: 'voiceSub', output: 'Out', to: 'mix', input: 'In' },
      { from: 'mix', output: 'Out', to: 'chorus', input: 'In' },
      { from: 'chorus', output: 'Out', to: 'hall', input: 'In' },
      { from: 'hall', output: 'Out', to: 'out', input: 'In' },
    ],
  );
}

function kitDemoState(pieces: KitPiece[]): ProbeState {
  const nodes: NodeSpec[] = [
    { id: 'keys', type: 'allKeys', x: -900, y: 0 },
    { id: 'mix', type: 'mix', x: 300, y: 120 },
    {
      id: 'out',
      type: 'render',
      x: 560,
      y: 140,
      values: { 'Level dB': INSTRUMENT_DEMO_RENDER_DB },
    },
  ];
  const edges: EdgeSpec[] = [
    { from: 'mix', output: 'Out', to: 'out', input: 'In' },
  ];
  pieces.forEach((piece, index) => {
    const voiceId = `p${index}`;
    nodes.push({
      id: voiceId,
      type: piece.id as SoundCatalogNodeTypeId,
      x: -300,
      y: -320 + index * 220,
    });
    edges.push(
      {
        from: 'keys',
        output: `${keyLabel(piece.key)} Gate`,
        to: voiceId,
        input: 'Gate',
      },
      { from: voiceId, output: 'Out', to: 'mix', input: 'In' },
    );
  });
  return buildState(nodes, edges);
}

const instrumentDemoBuilders: Record<string, () => ProbeState> = {};
const demoOptions: Array<{ id: string; label: string }> = [];

for (const instrumentId of tonalIds) {
  const demoId = `demoInst_${instrumentId}`;
  instrumentDemoBuilders[demoId] = () => tonalDemoState(instrumentId);
  demoOptions.push({
    id: demoId,
    label: `${typeName(instrumentId)} (all ${KEY_ORDER.length} keys)`,
  });
}

for (const instrumentId of droneIds) {
  const demoId = `demoInst_${instrumentId}`;
  instrumentDemoBuilders[demoId] = () => droneDemoState(instrumentId);
  demoOptions.push({
    id: demoId,
    label: `${typeName(instrumentId)} (plays on Run)`,
  });
}

for (const kit of KIT_DEMOS) {
  const pieces = kitPieces(kit.prefix);
  if (pieces.length === 0) continue;
  const demoId = `demoKit_${kit.prefix}`;
  instrumentDemoBuilders[demoId] = () => kitDemoState(pieces);
  demoOptions.push({
    id: demoId,
    label: `${kit.label} (hit ${pieces.map((p) => p.key).join('·')})`,
  });
}

/** The 6th demo dropdown (App toolbar). */
const instrumentDemoCategory = {
  label: 'Instrument library',
  options: demoOptions,
};

/** Probe harness: a deterministic drive graph for one instrument. */
function buildInstrumentProbeState(
  instrumentId: InstrumentCatalogId,
  pitchHz: number,
  strike = false,
): ProbeState {
  const useStrikes = isKitPiece(instrumentId) || strike;
  const nodes: NodeSpec[] = [
    {
      id: 'drive',
      type: 'pulser',
      x: -900,
      y: 0,
      values: { 'Rate Hz': useStrikes ? 2 : 0.5, Amplitude: 1, Offset: 0 },
    },
    {
      id: 'gate',
      type: 'threshold',
      x: -650,
      y: 0,
      values: { Threshold: 0.5, Hysteresis: 0.1 },
    },
    { id: 'voice', type: instrumentId as SoundCatalogNodeTypeId, x: -350, y: 0 },
  ];
  const edges: EdgeSpec[] = [
    { from: 'drive', output: 'Out', to: 'gate', input: 'In' },
    { from: 'gate', output: 'Gate', to: 'voice', input: 'Gate' },
    { from: 'voice', output: 'Out', to: 'out', input: 'In' },
  ];
  if (!isKitPiece(instrumentId)) {
    nodes.push({
      id: 'pitch',
      type: 'constant',
      x: -900,
      y: 180,
      values: { Value: pitchHz },
    });
    edges.push({ from: 'pitch', output: 'Out', to: 'voice', input: 'Hz' });
  }
  // Render LAST: consumers tap "the last audiogram toggle", and DOM
  // order follows node order.
  nodes.push({ id: 'out', type: 'render', x: 0, y: 0 });
  return buildState(nodes, edges);
}

export {
  buildInstrumentProbeState,
  instrumentDemoBuilders,
  instrumentDemoCategory,
};

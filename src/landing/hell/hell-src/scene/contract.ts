// COPIED from .claude/pages/ad/experiments/hell-src/scene/contract.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * The consolidated hellscape scene (hell-20-scene): one full scene in which
 * each ASSET CLASS (sky, circles, clouds, pillar, bones, dunes, islands,
 * particles & mist, sky events, post) can be switched between a few clearly
 * distinct options, while everything else stays in place. The owner picks one
 * option per class, finalises, and exports the selection.
 *
 * RULE: the experiments hell-00 … hell-12 are the owner's and must stay
 * exactly as they are. Adapters here IMPORT their modules read-only, or COPY
 * code into new files under scene/ — they never edit an experiment file.
 */

import type * as THREE from 'three';
import type { Lab } from '../../env-src/lab';
import type { HellBackdrop } from '../hell-common';
import type { PaletteStore } from './palette';

/** One shared world. Units are metres; the camera looks down -Z. */
export const LAYOUT = {
  /** The pillar stands here (the focal point, dead centre of the frame). */
  pillar: { x: 0, z: -420, height: 320, radius: 9 },
  /** The ribcage / bones: mid-ground, left of the pillar, half-buried. */
  bones: { x: -150, z: -260, length: 170, height: 70 },
  /** Floating islands: up in the sky around the pillar. */
  islands: [
    { x: -260, y: 150, z: -620, size: 60 },
    { x: 230, y: 190, z: -560, size: 45 },
    { x: 120, y: 120, z: -820, size: 80 },
    { x: -90, y: 230, z: -900, size: 35 },
  ],
  /** Magic circles: in the sky, centred above/behind the pillar top. */
  circles: { x: 0, y: 260, z: -700, radius: 170 },
  /** Ground plane height (dunes sit on y ≈ 0). */
  groundY: 0,
  /** Camera: low, looking up a little toward the pillar. */
  camera: { position: [0, 9, 70] as [number, number, number], look: [0, 95, -420] as [number, number, number] },
};

export type SceneContext = {
  lab: Lab;
  backdrop: HellBackdrop;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  layout: typeof LAYOUT;
  /** The colour script (scene/palette.ts): every class takes its colours from
   *  it — subscribe, and re-colour when it changes — and keeps only its shapes. */
  palette: PaletteStore;
  /** Final page: only the picked options are used, so classes must not warm
   *  (compile) every option up front — just the current one. */
  lean?: boolean;
};

export type AssetOption = {
  /** Stable id used in the exported selection. */
  id: string;
  label: string;
  /** One line: what makes this option different (shown on hover). */
  description: string;
  /** Which experiment variant(s) it comes from, e.g. "hell-06 design:veined". */
  source: string;
};

/** One switchable asset class. Options must be clearly DIFFERENT from each
 *  other (no near-duplicates); 2–4 options, the first is the default. 'none'
 *  is allowed where hiding the class makes sense (e.g. sky events). */
export type AssetClass = {
  id: string;
  label: string;
  options: AssetOption[];
  setOption(id: string): void;
  /** Per-frame update (t seconds, dt seconds). */
  update?(t: number, dt: number): void;
  /** Key parameters of the current option, included in the export. */
  params?(): Record<string, string | number | boolean>;
};

export type AssetFactory = (context: SceneContext) => AssetClass;

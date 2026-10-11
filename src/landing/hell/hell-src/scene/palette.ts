// COPIED from .claude/pages/ad/experiments/hell-src/scene/palette.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * The scene's COLOUR SCRIPT: one palette sets every colour role in the frame
 * (sky, light, fog, sand, clouds, bone, stone, glows, the post grade), and the
 * asset classes keep only their SHAPES. Picked from the "Colour" row.
 *
 * Why (owner, 2026-10-11: "why does it look sooo red, use more colors, check
 * references"): every experiment had been tuned to red on its own — red key
 * light, red fog, red sand, rose clouds, an oxblood post grade — and they
 * stacked to a frame that was 100% red/magenta by hue. The references average
 * ~15% red, ~31% blue/cyan and ~33% near-neutral (pale bone, white cloud,
 * slate): red is ONE area against a contrasting sky, never the whole frame.
 * The magic circles stay dark red in every palette — the accent the owner
 * loves — against a sky of another hue.
 *
 * Values are the measured colours in .claude/research/hellscape/MOODBOARD.md
 * (its §1 sky-grade table A–F, and the dune / bone / cloud / pillar tables).
 */

import * as THREE from 'three';
import { applyPalette } from '../../env-src/lab';
import type { HellBackdrop } from '../hell-common';
import type { Lab } from '../../env-src/lab';

export type ScenePalette = {
  id: string;
  label: string;
  /** One line: the look, and what carries the red. */
  description: string;
  /** Which reference (MOODBOARD rows) it is measured from. */
  source: string;

  // ── the lab's shared environment (every shader's skyGradient, sun, haze) ──
  sunDir: THREE.Vector3;
  /** Key light colour (and the sky's sun glow). */
  sun: string;
  zenith: string;
  horizon: string;
  haze: string;
  /** Hemisphere sky colour: what shadows are tinted by (a hue, never grey). */
  ambient: string;
  /** Hemisphere ground colour: bounce from the sand. */
  groundShade: string;

  // ── roles the asset classes read ──
  sky: {
    /** Dome ramp, top → bottom (zenith, mid, horizon) and the glow round the sun / focal point. */
    zenith: string;
    mid: string;
    horizon: string;
    glow: string;
  };
  fog: { color: string; density: number };
  sand: { lit: string; shade: string; crest: string; far: string };
  cloud: { lit: string; shade: string; belly: string };
  bone: { lit: string; shade: string };
  /** Pillar and island rock. */
  stone: { lit: string; shade: string; rim: string };
  glow: {
    /** The magic circles (dark red in every palette: the owner's accent). */
    circles: string;
    /** Emissive accents on the pillar (cores, veins, rings). */
    pillar: string;
    /** Sparks and embers. */
    embers: string;
    /** Lightning / shafts / discharge. */
    events: string;
  };
  /** The post grade: split-tone colours and halation, toward the palette (not always oxblood). */
  post: { shadows: string; highlights: string; halation: string; vignette: string };
};

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const PALETTES: ScenePalette[] = [
  {
    id: 'evaSplit',
    label: 'Eva split',
    description: 'Cobalt sky over a crimson field, white cumulus with pink bellies, lilac fog, pale bone: red is the ground and the circles, everything above it is blue.',
    source: 'MOODBOARD sky D (Eva 3.0 Eva-1/Eva-2), dunes "Crimson", clouds "Over red ground"',
    sunDir: v(0, 0.3, -1),
    sun: '#e8ecff',
    zenith: '#0c266b',
    horizon: '#9a94b4',
    haze: '#9a94b4',
    ambient: '#4a5480',
    groundShade: '#3a060c',
    sky: { zenith: '#0c266b', mid: '#1440bb', horizon: '#9a94b4', glow: '#e8ecff' },
    // Lilac, as Eva's fog, but grey enough that pale bone and white cloud stay
    // near-neutral (the saturated #6b4a9a tinted them lavender).
    fog: { color: '#7a7590', density: 0.0011 },
    sand: { lit: '#990001', shade: '#4c0100', crest: '#f4859c', far: '#4c114a' },
    cloud: { lit: '#ecf8f4', shade: '#cecce2', belly: '#c17991' },
    bone: { lit: '#d8ddd1', shade: '#575150' },
    stone: { lit: '#364971', shade: '#1e376d', rim: '#c1ddee' },
    glow: { circles: '#e0182a', pillar: '#fddafc', embers: '#ff8a6a', events: '#c8d4ff' },
    post: { shadows: '#1a1f4a', highlights: '#fff2f2', halation: '#ff4a5a', vignette: '#0a0c24' },
  },
  {
    id: 'amber',
    label: 'Amber backlight',
    description: 'AoT Rumbling: one amber hue from gold sun to rust to near-black, silhouettes rimmed warm; the dark red circles read against gold.',
    source: 'MOODBOARD sky A (AoT ep 80, AoT-1/AoT-2 B1), dunes "Warm regrade", bone "Amber backlight", clouds "Amber steam"',
    sunDir: v(0, 0.12, -1),
    sun: '#ffcf73',
    zenith: '#461a18',
    horizon: '#e5b253',
    haze: '#af7739',
    ambient: '#55416f',
    groundShade: '#3b261a',
    sky: { zenith: '#461a18', mid: '#d06a4a', horizon: '#e5b253', glow: '#f2e168' },
    fog: { color: '#af7739', density: 0.0013 },
    sand: { lit: '#b38361', shade: '#3b261a', crest: '#e5b253', far: '#874424' },
    cloud: { lit: '#b38361', shade: '#623720', belly: '#9a6338' },
    bone: { lit: '#b29d7e', shade: '#4c2e19' },
    stone: { lit: '#844222', shade: '#3b261a', rim: '#c07f3e' },
    glow: { circles: '#b3121a', pillar: '#ffcf73', embers: '#ffcf73', events: '#fff0c8' },
    post: { shadows: '#2a1408', highlights: '#fff0d0', halation: '#ffb060', vignette: '#1e0e08' },
  },
  {
    id: 'dusk',
    label: 'Peach-violet dusk',
    description: '"Apocalyptic but beautiful": violet zenith to a peach horizon, lavender clouds, mauve sand and lilac fog; the circles are the only true red.',
    source: 'MOODBOARD sky C (AoT-2/AoT-3), bone "Dusk, from below" (AoT-4 Shot I), clouds "Dusk deck" (AoT-2 ep 87)',
    sunDir: v(0.1, 0.06, -1),
    sun: '#ffb38a',
    zenith: '#2a2150',
    horizon: '#fcc29d',
    haze: '#b07a8a',
    ambient: '#605688',
    groundShade: '#3b2a3a',
    sky: { zenith: '#2a2150', mid: '#605688', horizon: '#fcc29d', glow: '#ecb69e' },
    fog: { color: '#9a7a9a', density: 0.0012 },
    sand: { lit: '#b19081', shade: '#413637', crest: '#fcc29d', far: '#b3a4b4' },
    cloud: { lit: '#e4d1e1', shade: '#7e79ad', belly: '#cab4c6' },
    bone: { lit: '#b3a4b4', shade: '#413637' },
    stone: { lit: '#55416f', shade: '#2a2150', rim: '#fcc29d' },
    glow: { circles: '#e0182a', pillar: '#ffd6c0', embers: '#ffb38a', events: '#f0e0ff' },
    post: { shadows: '#2a2150', highlights: '#fff0e6', halation: '#ff8a7a', vignette: '#1a1430' },
  },
  {
    id: 'sulphur',
    label: 'Sulphur ceiling',
    description: 'Hell Verse: a yellow cloud ceiling over a violet horizon and an indigo bone-sand ground, lit orange from below; a magenta column, red circles.',
    source: 'MOODBOARD sky E (Hell Verse L4, BL-A), dunes "Bone-sand indigo", clouds "Sulphur ceiling", pillar "Emissive hell column" (HV)',
    sunDir: v(0, 0.25, -1),
    sun: '#f4e27a',
    zenith: '#8a7a14',
    horizon: '#4a3d55',
    haze: '#4a3a6a',
    ambient: '#4a3a6a',
    groundShade: '#c5652a',
    sky: { zenith: '#c4a71d', mid: '#8a7a14', horizon: '#4a3d55', glow: '#f4e27a' },
    fog: { color: '#3a2a5a', density: 0.0012 },
    sand: { lit: '#3a3060', shade: '#14151f', crest: '#6a5a9a', far: '#252738' },
    cloud: { lit: '#c4a71d', shade: '#5b4c61', belly: '#bba242' },
    bone: { lit: '#c9cbc6', shade: '#54544b' },
    stone: { lit: '#34302a', shade: '#1c1a1c', rim: '#6a613f' },
    glow: { circles: '#e0182a', pillar: '#f977f8', embers: '#fb6e17', events: '#fde8a0' },
    post: { shadows: '#14102a', highlights: '#fff6c8', halation: '#f977f8', vignette: '#0c0a18' },
  },
  {
    id: 'hueco',
    label: 'Hueco night',
    description: 'Bleach Hueco Mundo: a near-black navy sky and moon, pale bone-white dunes, slate pillar and grey-green cloud; the red circles glow alone.',
    source: 'MOODBOARD neutral daylight / overcast tables (Eva-2 C1104, AoT-2/AoT-3), pillar "Slate tower" (BL-H S3), clouds "Toxic cloud sea" (HV L3)',
    sunDir: v(-0.3, 0.45, -1),
    sun: '#dfe6f0',
    zenith: '#05060c',
    horizon: '#2a3346',
    haze: '#3a4256',
    ambient: '#2e357a',
    groundShade: '#14151f',
    sky: { zenith: '#05060c', mid: '#141a2a', horizon: '#2a3346', glow: '#dfe6f0' },
    fog: { color: '#2a3140', density: 0.0012 },
    sand: { lit: '#d8ddd1', shade: '#575150', crest: '#f0f2ee', far: '#86aca6' },
    cloud: { lit: '#b5bbb2', shade: '#515a56', belly: '#2e3635' },
    bone: { lit: '#c9cbc6', shade: '#54544b' },
    stone: { lit: '#434948', shade: '#323837', rim: '#d5dae1' },
    glow: { circles: '#e0182a', pillar: '#f2fefd', embers: '#9cdeda', events: '#c8e8ff' },
    post: { shadows: '#0a0e1a', highlights: '#f2f6ff', halation: '#9cdeda', vignette: '#04060c' },
  },
  {
    id: 'crimson',
    label: 'Crimson night (old)',
    description: 'The previous look, kept for comparison: oxblood sky, red key light, red fog, rust sand, rose clouds — red everywhere.',
    source: 'MOODBOARD sky F (Scarlet S3, LUT only) — the "Crimson night" grade every experiment was tuned under',
    sunDir: v(0.2, 0.05, -1),
    sun: '#ff4a2a',
    zenith: '#12040a',
    horizon: '#7a1414',
    haze: '#4a0d10',
    ambient: '#3a1a3f',
    groundShade: '#1a0608',
    sky: { zenith: '#12040a', mid: '#4a0d10', horizon: '#7a1414', glow: '#ff5a3a' },
    fog: { color: '#3a0c10', density: 0.0016 },
    sand: { lit: '#9a3424', shade: '#1e0608', crest: '#e0705a', far: '#4a1210' },
    cloud: { lit: '#c66a72', shade: '#4a1a36', belly: '#a4475a' },
    bone: { lit: '#c8bca8', shade: '#4a2228' },
    stone: { lit: '#3a2428', shade: '#1a0e12', rim: '#ff4a2a' },
    glow: { circles: '#e0182a', pillar: '#ff4a2a', embers: '#ff6a3a', events: '#ff8a7a' },
    post: { shadows: '#4a000c', highlights: '#ffb8b0', halation: '#e01408', vignette: '#2a0006' },
  },
];

/** The current palette, and who to tell when it changes. */
export type PaletteStore = {
  current(): ScenePalette;
  set(id: string): void;
  /** Calls `listener` now and on every change; returns an unsubscribe. */
  subscribe(listener: (palette: ScenePalette) => void): () => void;
};

export function createPaletteStore(initial = PALETTES[0].id): PaletteStore {
  let current = PALETTES.find((p) => p.id === initial) ?? PALETTES[0];
  const listeners = new Set<(palette: ScenePalette) => void>();
  return {
    current: () => current,
    set(id) {
      const next = PALETTES.find((p) => p.id === id);
      if (!next) return;
      // Re-applied even when it is the current one: picking it again repairs
      // anything that changed the colours behind the palette's back.
      current = next;
      for (const listener of listeners) listener(current);
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * The palette's GLOBAL part: the lab's shared environment (sky gradient, sun,
 * haze, ambient — read by every shader), the backdrop's hemisphere and key
 * lights, and the fog. Asset classes do their own materials.
 */
export function applyGlobalPalette(lab: Lab, backdrop: HellBackdrop, palette: ScenePalette) {
  applyPalette(lab.env, palette);
  backdrop.group.traverse((object) => {
    if ((object as THREE.HemisphereLight).isHemisphereLight) {
      const hemi = object as THREE.HemisphereLight;
      hemi.color.set(palette.ambient);
      hemi.groundColor.set(palette.groundShade);
    } else if ((object as THREE.DirectionalLight).isDirectionalLight) {
      const sun = object as THREE.DirectionalLight;
      sun.color.set(palette.sun);
      sun.position.copy(palette.sunDir).normalize().multiplyScalar(400);
    }
  });
  const fog = lab.scene.fog as THREE.FogExp2 | null;
  if (fog) {
    fog.color.set(palette.fog.color);
    fog.density = palette.fog.density;
  }
}

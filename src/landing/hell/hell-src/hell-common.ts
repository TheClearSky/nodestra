// COPIED from .claude/pages/ad/experiments/hell-src/hell-common.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * Shared base for the hellscape experiments (hell-01 … hell-NN).
 *
 * Every experiment studies ONE element of the new start-stage scene (magic
 * circles, sky, clouds, pillar, bones, dunes, floating islands, atmosphere)
 * in many variants, against the same stand-in world, so the variants can be
 * compared and the picks combined later. Look brief and palette:
 * `.claude/research/hellscape/MOODBOARD.md`.
 *
 * Everything is procedural: no image, model or HDRI files.
 */

import * as THREE from 'three';
import { applyPalette, createLab, seededRandom } from '../env-src/lab';
import type { Lab, LabOptions, Palette } from '../env-src/lab';
import { createSkyDome } from '../env-src/sky';

/** The mood board's grades. Colours are sRGB hex; THREE.Color linearises. */
export const GRADES: Record<string, Palette & { label: string; fog: string; ground: string; groundShade: string }> = {
  // A — amber backlight (the mood board's default): sun hidden low behind the pillar.
  amber: {
    label: 'A · Amber backlight',
    sunDir: new THREE.Vector3(0, 0.12, -1),
    sun: '#ffcf73',
    zenith: '#461a18',
    horizon: '#e5b253',
    haze: '#af7739',
    ambient: '#55416f',
    fog: '#af7739',
    ground: '#b38361',
    groundShade: '#5e1a0f',
  },
  // The dark red sky the owner loves (magic circles): oxblood dome, ember horizon.
  crimson: {
    label: 'Crimson night',
    sunDir: new THREE.Vector3(0.2, 0.05, -1),
    sun: '#ff4a2a',
    zenith: '#12040a',
    horizon: '#7a1414',
    haze: '#4a0d10',
    ambient: '#3a1a3f',
    fog: '#3a0c10',
    ground: '#5a2418',
    groundShade: '#1a0608',
  },
  // B — red sun.
  redSun: {
    label: 'B · Red sun',
    sunDir: new THREE.Vector3(-0.2, 0.18, -1),
    sun: '#ff6a3d',
    zenith: '#2a0d14',
    horizon: '#c8452e',
    haze: '#8a2a1e',
    ambient: '#4a2a4f',
    fog: '#7a2a1e',
    ground: '#9a5038',
    groundShade: '#3b1410',
  },
  // C — peach / violet dusk.
  dusk: {
    label: 'C · Peach-violet dusk',
    sunDir: new THREE.Vector3(0.1, 0.06, -1),
    sun: '#ffb38a',
    zenith: '#2a2150',
    horizon: '#e8a07a',
    haze: '#b07a8a',
    ambient: '#605688',
    fog: '#9a6a7a',
    ground: '#a87868',
    groundShade: '#3b2a3a',
  },
  // D — Eva split: crimson ground under a cobalt sky.
  eva: {
    label: 'D · Eva split',
    sunDir: new THREE.Vector3(0, 0.3, -1),
    sun: '#e8ecff',
    zenith: '#0d1a4a',
    horizon: '#5a78c8',
    haze: '#7a3040',
    ambient: '#3a4a8a',
    fog: '#6a2a3a',
    ground: '#a81c22',
    groundShade: '#3a060c',
  },
  // E — sulphur ceiling over a violet band and an indigo ground.
  sulphur: {
    label: 'E · Sulphur ceiling',
    sunDir: new THREE.Vector3(0, 0.25, -1),
    sun: '#f4e27a',
    zenith: '#8a7a14',
    horizon: '#5a3a7a',
    haze: '#4a3a6a',
    ambient: '#4a3a6a',
    fog: '#3a2a5a',
    ground: '#3a3060',
    groundShade: '#14102a',
  },
};

export type GradeId = keyof typeof GRADES;

/** A stand-in world: the shared sky dome, low procedural dunes, coloured fog. */
export type HellBackdrop = {
  group: THREE.Group;
  ground: THREE.Mesh;
  setGrade(id: string): void;
  /** Hide the stand-in dunes (the dunes experiment brings its own). */
  setGroundVisible(visible: boolean): void;
};

function duneHeight(x: number, z: number): number {
  // Long crests across the wind, plus a slower swell; a stand-in only.
  const s = Math.sin(x * 0.018 + Math.sin(z * 0.006) * 2.2) * 6;
  const t = Math.sin((x * 0.6 + z) * 0.01) * 9;
  return Math.max(0, s + t + 4) * 0.8;
}

export function createBackdrop(lab: Lab, grade: GradeId = 'amber'): HellBackdrop {
  const group = new THREE.Group();
  group.name = 'backdrop';
  const dome = createSkyDome(lab.env);
  dome.uLayer.value = 0;
  group.add(dome.mesh);

  const size = 3000;
  const geometry = new THREE.PlaneGeometry(size, size, 220, 220);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    position.setY(i, duneHeight(position.getX(i), position.getZ(i)));
  }
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: GRADES[grade].ground, roughness: 0.95, metalness: 0 });
  const ground = new THREE.Mesh(geometry, material);
  ground.name = 'standin-dunes';
  ground.position.y = -2;
  group.add(ground);

  const hemi = new THREE.HemisphereLight('#ffffff', '#000000', 0.9);
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(0, 60, -400);
  group.add(hemi, sun);

  lab.scene.fog = new THREE.FogExp2(GRADES[grade].fog, 0.0016);

  const setGrade = (id: string) => {
    const g = GRADES[id] ?? GRADES.amber;
    applyPalette(lab.env, g);
    (lab.scene.fog as THREE.FogExp2).color.set(g.fog);
    material.color.set(g.ground);
    hemi.color.set(g.ambient);
    hemi.groundColor.set(g.groundShade);
    sun.color.set(g.sun);
    sun.position.copy(g.sunDir).multiplyScalar(400);
  };
  setGrade(grade);
  lab.scene.add(group);
  return {
    group,
    ground,
    setGrade,
    setGroundVisible: (visible) => {
      ground.visible = visible;
    },
  };
}

/** A hell lab: the shared harness, the backdrop and a grade switch. */
export function createHellLab(
  canvas: HTMLCanvasElement,
  options: Omit<LabOptions, 'palette'> & { grade?: GradeId },
): { lab: Lab; backdrop: HellBackdrop } {
  const grade = options.grade ?? 'amber';
  const lab = createLab(canvas, { ...options, palette: GRADES[grade] });
  const backdrop = createBackdrop(lab, grade);
  lab.addVariants({
    id: 'grade',
    label: 'Grade',
    options: Object.entries(GRADES).map(([id, g]) => ({ id, label: g.label })),
    initial: grade,
    onChange: (id) => backdrop.setGrade(id),
  });
  return { lab, backdrop };
}

export { seededRandom };

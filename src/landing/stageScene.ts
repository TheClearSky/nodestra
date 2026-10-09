/**
 * The landing stage: a grand piano playing itself under a spotlight, framed
 * by red velvet curtains on a wooden stage. Everything is modelled and
 * textured procedurally here — no model or image files.
 *
 * Units are metres; y is up, the audience looks towards −z.
 */

import * as THREE from 'three';
import { makeCameraTour } from './cameraTour';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createStageAdaptive, detectStageTier, stageLadder } from './stageQuality';

type StageScene = {
  resize(width: number, height: number): void;
  /** Fly the camera into the piano, over the strings (FLIGHT_SECONDS). */
  flyIn(): void;
  /** Back to the audience view (audio failed to start). */
  cancelFlight(): void;
  /** Stop drawing — the stage is hidden behind black. */
  pause(): void;
  /** Draw again after `pause` (back to the stage from a meadow scene). */
  resume(): void;
  /** Live mode: the scripted loop stops and the keys follow `setLiveKey`. */
  setLive(live: boolean): void;
  /** A key (0 = A0 … 87 = C8) pressed or released by a player. */
  setLiveKey(key: number, down: boolean): void;
  /** Diagnostics: the quality tier, why it was picked, and where the runtime
   *  ladder has taken it (also mirrored on `canvas.dataset.quality`). */
  quality(): string;
  dispose(): void;
};

/** Length of the fly-in; the landing's fade to black ends with it. */
const FLIGHT_SECONDS = 2.8;

type StageOptions = {
  /** prefers-reduced-motion: one still frame, no animation loop. */
  reducedMotion: boolean;
  /** How strongly the idle view wanders on its own (default 1 — the app's
   *  landing). Above 1 it also pans sideways: the landing-page lab uses ~3
   *  so the stage visibly turns and drifts while nobody is steering it. */
  idleMotion?: number;
};

// ── deterministic randomness (the stage looks the same on every visit) ──

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ── wood floor texture ──────────────────────────────────────────────────

type PlankSegment = {
  x: number;
  y: number;
  length: number;
  rgb: [number, number, number];
  roughness: number;
  grain: { x: number; amp: number; freq: number; phase: number; dark: boolean; alpha: number; width: number }[];
  knot: { x: number; y: number; rx: number; ry: number } | null;
};

/**
 * Planks with varied tone, wavy grain, the odd knot, dark seams and
 * staggered end joints. Tiles seamlessly in both directions: each plank's
 * segments cover exactly one texture height and are drawn twice, once
 * shifted by that height.
 */
function makeWoodTextures(anisotropy: number) {
  const size = 1024;
  const planks = 8;
  const plankWidth = size / planks;
  const random = seededRandom(11);
  const palette: [number, number, number][] = [
    [122, 74, 38],
    [139, 90, 47],
    [110, 63, 31],
    [148, 98, 58],
    [127, 77, 41],
    [104, 60, 32],
    [133, 84, 46],
  ];

  const segments: PlankSegment[] = [];
  for (let p = 0; p < planks; p++) {
    const x = p * plankWidth;
    const start = -random() * 700;
    let y = start;
    while (y < start + size) {
      const length = Math.min(360 + random() * 560, start + size - y);
      const [r, g, b] = palette[Math.floor(random() * palette.length)];
      const tone = 0.86 + random() * 0.28;
      const grain = Array.from({ length: 30 }, () => ({
        x: x + random() * plankWidth,
        amp: 0.8 + random() * 4,
        freq: 0.003 + random() * 0.012,
        phase: random() * Math.PI * 2,
        dark: random() < 0.65,
        alpha: random(),
        width: 0.6 + random() * 1.8,
      }));
      segments.push({
        x,
        y,
        length,
        rgb: [r * tone, g * tone, b * tone],
        roughness: 105 + random() * 60,
        grain,
        knot:
          random() < 0.3
            ? {
                x: x + 20 + random() * (plankWidth - 40),
                y: y + random() * length,
                rx: 5 + random() * 9,
                ry: 14 + random() * 26,
              }
            : null,
      });
      y += length;
    }
  }

  const colorCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = size;
  roughCanvas.width = roughCanvas.height = size;
  const color = colorCanvas.getContext('2d')!;
  const rough = roughCanvas.getContext('2d')!;

  const drawSegment = (segment: PlankSegment, offset: number) => {
    const top = segment.y + offset;
    const [r, g, b] = segment.rgb;
    color.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    color.fillRect(segment.x, top, plankWidth, segment.length);
    const grey = segment.roughness | 0;
    rough.fillStyle = `rgb(${grey},${grey},${grey})`;
    rough.fillRect(segment.x, top, plankWidth, segment.length);

    color.save();
    color.beginPath();
    color.rect(segment.x, top, plankWidth, segment.length);
    color.clip();
    for (const line of segment.grain) {
      color.strokeStyle = line.dark
        ? `rgba(38,18,6,${0.07 + line.alpha * 0.2})`
        : `rgba(255,214,160,${0.03 + line.alpha * 0.07})`;
      color.lineWidth = line.width;
      color.beginPath();
      for (let yy = 0; yy <= segment.length; yy += 8) {
        const xx = line.x + Math.sin((segment.y + yy) * line.freq + line.phase) * line.amp;
        if (yy === 0) color.moveTo(xx, top + yy);
        else color.lineTo(xx, top + yy);
      }
      color.stroke();
    }
    if (segment.knot) {
      const k = segment.knot;
      const gradient = color.createRadialGradient(k.x, k.y + offset, 0, k.x, k.y + offset, k.ry);
      gradient.addColorStop(0, 'rgba(40,18,6,0.75)');
      gradient.addColorStop(0.35, 'rgba(60,30,12,0.35)');
      gradient.addColorStop(1, 'rgba(60,30,12,0)');
      color.fillStyle = gradient;
      color.beginPath();
      color.ellipse(k.x, k.y + offset, k.rx, k.ry, 0, 0, Math.PI * 2);
      color.fill();
    }
    color.restore();

    // End joint.
    color.fillStyle = 'rgba(18,9,3,0.9)';
    color.fillRect(segment.x, top + segment.length - 2, plankWidth, 2);
    rough.fillStyle = 'rgb(235,235,235)';
    rough.fillRect(segment.x, top + segment.length - 2, plankWidth, 2);
  };
  for (const segment of segments) {
    drawSegment(segment, 0);
    drawSegment(segment, size);
  }
  // Long seams between planks.
  for (let p = 0; p < planks; p++) {
    color.fillStyle = 'rgba(14,7,2,0.95)';
    color.fillRect(p * plankWidth, 0, 2, size);
    rough.fillStyle = 'rgb(240,240,240)';
    rough.fillRect(p * plankWidth, 0, 2, size);
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  for (const texture of [map, roughnessMap]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
  }
  return { map, roughnessMap };
}

// ── outlines ────────────────────────────────────────────────────────────

/** Polygon area sign: > 0 when counter-clockwise. */
function signedArea(points: THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/** The polygon moved `distance` inwards, with mitred corners. */
function insetPolygon(points: THREE.Vector2[], distance: number): THREE.Vector2[] {
  const sign = signedArea(points) > 0 ? 1 : -1;
  const n = points.length;
  const edgeNormal = (a: THREE.Vector2, b: THREE.Vector2) => {
    const t = b.clone().sub(a).normalize();
    return new THREE.Vector2(-t.y * sign, t.x * sign);
  };
  return points.map((point, i) => {
    const previous = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const n1 = edgeNormal(previous, point);
    const n2 = edgeNormal(point, next);
    const miter = n1.clone().add(n2);
    if (miter.lengthSq() < 1e-8) return point.clone().addScaledVector(n1, distance);
    miter.normalize();
    const scale = distance / Math.max(0.3, miter.dot(n1));
    return point.clone().addScaledVector(miter, scale);
  });
}

function withoutClosingDuplicate(points: THREE.Vector2[]): THREE.Vector2[] {
  const first = points[0];
  const last = points[points.length - 1];
  return first.distanceTo(last) < 1e-6 ? points.slice(0, -1) : points;
}

/** The deepest point of the polygon along the vertical line at `x`. */
function farDepthAt(points: THREE.Vector2[], x: number): number {
  let best = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if ((a.x - x) * (b.x - x) > 0 || a.x === b.x) continue;
    const t = (x - a.x) / (b.x - a.x);
    best = Math.max(best, a.y + t * (b.y - a.y));
  }
  return best;
}

/** A shape extruded upwards: shape (x, depth) → world (x, up, −depth). */
function horizontalSlab(shape: THREE.Shape, thickness: number, bottom: number, bevel = 0) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
    curveSegments: 12,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bottom, 0);
  return geometry;
}

// ── the piano ───────────────────────────────────────────────────────────

const CASE_WIDTH = 1.48;
const CASE_BOTTOM = 0.6;
const RIM_TOP = 0.9;
const KEY_COUNT = 88;
const WHITE_KEY_WIDTH = 0.0235;
const KEYBOARD_WIDTH = WHITE_KEY_WIDTH * 52;
const CHEEK = (CASE_WIDTH - KEYBOARD_WIDTH) / 2;
const KEY_TOP = 0.722;
const LID_ANGLE = 0.6;
const FIRST_MIDI = 21; // A0

type Performance = {
  events: { key: number; start: number; end: number }[];
  length: number;
  bar: number;
};

/** Eight bars that loop: a broken-chord left hand under a simple tune. */
function buildPerformance(): Performance {
  const beat = 60 / 72;
  const bar = beat * 4;
  const chords = [
    [48, 55, 60, 64], // C
    [47, 55, 59, 62], // G/B
    [45, 52, 57, 60], // Am
    [41, 48, 53, 57], // F
    [48, 55, 60, 64], // C
    [41, 48, 53, 57], // F
    [43, 50, 55, 59], // G
    [48, 55, 60, 64], // C
  ];
  const pattern = [0, 1, 2, 3, 2, 1, 2, 1];
  const melody: [number, number][][] = [
    [[76, 1], [74, 1], [72, 1], [67, 1]],
    [[74, 1.5], [72, 0.5], [71, 2]],
    [[72, 1], [71, 1], [69, 1], [64, 1]],
    [[65, 1], [69, 1], [72, 2]],
    [[76, 1], [79, 1], [77, 1], [76, 1]],
    [[74, 1], [72, 1], [69, 2]],
    [[71, 1], [72, 1], [74, 2]],
    [[72, 4]],
  ];
  const events: Performance['events'] = [];
  chords.forEach((chord, b) => {
    pattern.forEach((index, i) => {
      const start = b * bar + (i * beat) / 2;
      events.push({ key: chord[index] - FIRST_MIDI, start, end: start + (beat / 2) * 0.9 });
    });
    let t = b * bar;
    for (const [note, beats] of melody[b]) {
      events.push({ key: note - FIRST_MIDI, start: t, end: t + beats * beat * 0.93 });
      t += beats * beat;
    }
  });
  return { events, length: chords.length * bar, bar };
}

function isWhite(midi: number): boolean {
  return [0, 2, 4, 5, 7, 9, 11].includes(midi % 12);
}

function makePiano() {
  const group = new THREE.Group();

  const lacquer = new THREE.MeshPhysicalMaterial({
    color: 0x050505,
    roughness: 0.2,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.28 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xb8903a, metalness: 1, roughness: 0.42 });
  const spruce = new THREE.MeshStandardMaterial({ color: 0xc99d62, roughness: 0.55 });
  const ivory = new THREE.MeshPhysicalMaterial({
    color: 0xd9d3c4,
    roughness: 0.38,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
  });
  const ebony = new THREE.MeshPhysicalMaterial({
    color: 0x0b0b0b,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
  });
  const redFelt = new THREE.MeshStandardMaterial({ color: 0x7a1422, roughness: 1 });
  const blackFelt = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 1 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, metalness: 1, roughness: 0.3 });

  const shadowed = <T extends THREE.Object3D>(object: T): T => {
    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return object;
  };

  // Outline of a grand, seen from above: the straight keyboard side, the
  // straight bass side, the S-shaped bentside and the round tail.
  const outlinePath = new THREE.Shape();
  outlinePath.moveTo(0, 0);
  outlinePath.lineTo(CASE_WIDTH, 0);
  outlinePath.lineTo(CASE_WIDTH, 0.32);
  outlinePath.bezierCurveTo(CASE_WIDTH, 0.8, 0.64, 0.8, 0.62, 1.25);
  outlinePath.bezierCurveTo(0.6, 1.62, 0.3, 1.8, 0, 1.68);
  outlinePath.lineTo(0, 0);
  const outline = withoutClosingDuplicate(outlinePath.getPoints(24));
  const inner = insetPolygon(outline, 0.045);

  // Rim: the outline with the inside cut away.
  const rimShape = new THREE.Shape(outline);
  rimShape.holes.push(new THREE.Path(inner));
  group.add(new THREE.Mesh(horizontalSlab(rimShape, RIM_TOP - CASE_BOTTOM - 0.01, CASE_BOTTOM, 0.006), lacquer));
  group.add(new THREE.Mesh(horizontalSlab(new THREE.Shape(outline), 0.03, CASE_BOTTOM), lacquer));

  // Soundboard, and the gold plate over it with its round openings.
  group.add(new THREE.Mesh(horizontalSlab(new THREE.Shape(inner), 0.012, 0.64), spruce));
  const plateOutline = insetPolygon(outline, 0.08).map(
    (point) => new THREE.Vector2(point.x, Math.max(point.y, 0.21)),
  );
  const plateShape = new THREE.Shape(plateOutline);
  for (const [x, d, r] of [
    [0.3, 0.55, 0.09],
    [0.28, 0.95, 0.09],
    [0.26, 1.3, 0.075],
    [0.62, 0.62, 0.08],
    [0.95, 0.46, 0.07],
  ]) {
    const hole = new THREE.Path();
    hole.absarc(x, d, r, 0, Math.PI * 2, true);
    plateShape.holes.push(hole);
  }
  group.add(new THREE.Mesh(horizontalSlab(plateShape, 0.014, 0.7, 0.004), gold));

  // Tuning pins and strings, one course per key.
  const stringX = (key: number) => CHEEK + 0.02 + (key + 0.5) * ((KEYBOARD_WIDTH - 0.04) / KEY_COUNT);
  const pins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.05, 6), steel, KEY_COUNT * 2);
  const dummy = new THREE.Object3D();
  const stringPoints: number[] = [];
  const stringColors: number[] = [];
  const copper = new THREE.Color(0xc07a45);
  const silver = new THREE.Color(0xdadada);
  const stringMid: THREE.Vector3[] = [];
  for (let key = 0; key < KEY_COUNT; key++) {
    const x = stringX(key);
    for (let j = 0; j < 2; j++) {
      dummy.position.set(x + (j ? 0.003 : -0.003), 0.715, -(0.11 + j * 0.05));
      dummy.updateMatrix();
      pins.setMatrixAt(key * 2 + j, dummy.matrix);
    }
    const far = Math.max(0.3, farDepthAt(inner, x) - 0.06);
    stringPoints.push(x, 0.745, -0.13, x, 0.745, -far);
    const tint = key < 20 ? copper : silver;
    stringColors.push(tint.r, tint.g, tint.b, tint.r, tint.g, tint.b);
    stringMid.push(new THREE.Vector3(x, 0.76, -(0.13 + far) / 2));
  }
  group.add(pins);
  const stringGeometry = new THREE.BufferGeometry();
  stringGeometry.setAttribute('position', new THREE.Float32BufferAttribute(stringPoints, 3));
  stringGeometry.setAttribute('color', new THREE.Float32BufferAttribute(stringColors, 3));
  group.add(
    new THREE.LineSegments(
      stringGeometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }),
    ),
  );

  // Dampers: felt blocks resting on the strings; the top of the compass
  // has none, as on a real grand.
  const DAMPED = 68;
  const dampers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.011, 0.04, 0.05), blackFelt, DAMPED);
  const damperRest = (key: number) => new THREE.Vector3(stringX(key), 0.768, -0.3);
  for (let key = 0; key < DAMPED; key++) {
    dummy.position.copy(damperRest(key));
    dummy.updateMatrix();
    dampers.setMatrixAt(key, dummy.matrix);
  }
  dampers.castShadow = true;
  group.add(dampers);

  // Keybed, cheek blocks, key slip, the red key-strip felt and the fallboard.
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  box(CASE_WIDTH, 0.1, 0.19, CASE_WIDTH / 2, 0.65, 0.095, lacquer);
  box(CHEEK, 0.16, 0.19, CHEEK / 2, 0.68, 0.095, lacquer);
  box(CHEEK, 0.16, 0.19, CASE_WIDTH - CHEEK / 2, 0.68, 0.095, lacquer);
  box(KEYBOARD_WIDTH, 0.05, 0.02, CASE_WIDTH / 2, 0.68, 0.18, lacquer);
  box(KEYBOARD_WIDTH, 0.008, 0.012, CASE_WIDTH / 2, 0.704, 0.006, redFelt);
  box(KEYBOARD_WIDTH, 0.1, 0.03, CASE_WIDTH / 2, 0.77, -0.012, lacquer);

  // The keys, each pivoting at its hidden back end. Two instanced meshes
  // (white, black) rather than 88 objects: measured, per-object state
  // changes for 88 separate keys — twice, with the shadow pass — were the
  // single biggest cost of a stage frame.
  const whiteGeometry = new THREE.BoxGeometry(WHITE_KEY_WIDTH - 0.0012, 0.022, 0.15);
  const blackGeometry = new THREE.BoxGeometry(0.0135, 0.02, 0.095);
  const whiteKeys = new THREE.InstancedMesh(whiteGeometry, ivory, 52);
  const blackKeys = new THREE.InstancedMesh(blackGeometry, ebony, 36);
  type KeySlot = { mesh: THREE.InstancedMesh; index: number; pivot: THREE.Vector3; reach: number; angle: number };
  const keys: KeySlot[] = [];
  let whiteIndex = 0;
  let blackIndex = 0;
  for (let key = 0; key < KEY_COUNT; key++) {
    if (isWhite(key + FIRST_MIDI)) {
      keys.push({
        mesh: whiteKeys,
        index: whiteIndex,
        pivot: new THREE.Vector3(CHEEK + (whiteIndex + 0.5) * WHITE_KEY_WIDTH, KEY_TOP - 0.011, -0.05),
        reach: 0.125,
        angle: Number.NaN,
      });
      whiteIndex++;
    } else {
      keys.push({
        mesh: blackKeys,
        index: blackIndex,
        pivot: new THREE.Vector3(CHEEK + whiteIndex * WHITE_KEY_WIDTH, KEY_TOP + 0.009, -0.05),
        reach: 0.0975,
        angle: Number.NaN,
      });
      blackIndex++;
    }
  }
  const keyPivot = new THREE.Matrix4();
  const keyTurn = new THREE.Matrix4();
  const keyReach = new THREE.Matrix4();
  /** Tilt one key; false when it was already there (nothing to upload). */
  const setKeyAngle = (key: number, angle: number): boolean => {
    const slot = keys[key];
    if (Math.abs(slot.angle - angle) < 1e-5) return false;
    slot.angle = angle;
    keyPivot.makeTranslation(slot.pivot.x, slot.pivot.y, slot.pivot.z);
    keyTurn.makeRotationX(angle);
    keyReach.makeTranslation(0, 0, slot.reach);
    slot.mesh.setMatrixAt(slot.index, keyPivot.multiply(keyTurn).multiply(keyReach));
    return true;
  };
  for (let key = 0; key < KEY_COUNT; key++) setKeyAngle(key, 0);
  for (const mesh of [whiteKeys, blackKeys]) {
    // The key travel is millimetres; the bounds of the resting row are fine.
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // Music desk.
  const desk = box(0.78, 0.26, 0.015, CASE_WIDTH / 2, RIM_TOP + 0.13, -0.28, lacquer);
  desk.rotation.x = -0.26;

  // Lid, hinged along the bass side and propped open.
  const lid = new THREE.Group();
  lid.position.set(0, RIM_TOP, 0);
  lid.rotation.z = LID_ANGLE;
  lid.add(new THREE.Mesh(horizontalSlab(new THREE.Shape(outline), 0.02, 0, 0.004), lacquer));
  group.add(lid);
  const propX = 1.0;
  const propHeight = propX * Math.tan(LID_ANGLE);
  const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, propHeight, 10), lacquer);
  prop.position.set(propX, RIM_TOP + propHeight / 2, -0.55);
  group.add(prop);

  // Turned legs on brass casters.
  const legProfile = [
    [0.0, 0.0],
    [0.036, 0.06],
    [0.05, 0.085],
    [0.042, 0.2],
    [0.05, 0.34],
    [0.066, 0.5],
    [0.076, 0.575],
    [0.085, 0.6],
    [0.0, 0.6],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const legGeometry = new THREE.LatheGeometry(legProfile, 28);
  const casterGeometry = new THREE.SphereGeometry(0.03, 16, 12);
  for (const [x, z] of [
    [0.13, -0.1],
    [CASE_WIDTH - 0.13, -0.1],
    [0.3, -1.45],
  ]) {
    const leg = new THREE.Mesh(legGeometry, lacquer);
    leg.position.set(x, 0, z);
    group.add(leg);
    const caster = new THREE.Mesh(casterGeometry, brass);
    caster.position.set(x, 0.03, z);
    group.add(caster);
  }

  // Pedal lyre with three brass pedals.
  box(0.028, 0.52, 0.028, CASE_WIDTH / 2 - 0.1, 0.34, -0.22, lacquer);
  box(0.028, 0.52, 0.028, CASE_WIDTH / 2 + 0.1, 0.34, -0.22, lacquer);
  box(0.34, 0.07, 0.13, CASE_WIDTH / 2, 0.06, -0.22, lacquer);
  const pedals: THREE.Group[] = [];
  for (const offset of [-0.075, 0, 0.075]) {
    const pivot = new THREE.Group();
    pivot.position.set(CASE_WIDTH / 2 + offset, 0.075, -0.18);
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.012, 0.11), brass);
    pedal.position.z = 0.07;
    pivot.add(pedal);
    group.add(pivot);
    pedals.push(pivot);
  }

  // Bench.
  const bench = new THREE.Group();
  bench.position.set(CASE_WIDTH / 2, 0, 0.68);
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.07, 0.36),
    new THREE.MeshPhysicalMaterial({ color: 0x070707, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
  );
  seat.position.y = 0.49;
  bench.add(seat);
  const apron = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.06, 0.34), lacquer);
  apron.position.y = 0.43;
  bench.add(apron);
  for (const [x, z] of [
    [-0.36, -0.15],
    [0.36, -0.15],
    [-0.36, 0.15],
    [0.36, 0.15],
  ]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.04), lacquer);
    leg.position.set(x, 0.21, z);
    bench.add(leg);
  }
  group.add(bench);

  shadowed(group);

  const performance = buildPerformance();
  const keyAmount = new Float32Array(KEY_COUNT);
  const liveAmount = new Float32Array(KEY_COUNT);

  /** Pose the keys, dampers and pedal for time `t` (seconds, looping). */
  const pose = (t: number) => {
    keyAmount.fill(0);
    for (const event of performance.events) {
      if (t < event.start || t > event.end + 0.09) continue;
      const attack = Math.min(1, (t - event.start) / 0.03);
      const release = t > event.end ? 1 - (t - event.end) / 0.09 : 1;
      keyAmount[event.key] = Math.max(keyAmount[event.key], Math.min(attack, release));
    }
    const inBar = t % performance.bar;
    applyPose(keyAmount, inBar > 0.1 && inBar < performance.bar - 0.06 ? 1 : 0);
  };

  /** Keys held by a player: each goes down in 30 ms and back up in 90 ms,
   *  the same travel as the scripted loop. No pedal — the piano demo damps
   *  on release, so the dampers fall with the keys. `dt` 0 = jump. */
  const poseLive = (held: Uint8Array, dt: number) => {
    for (let key = 0; key < KEY_COUNT; key++) {
      liveAmount[key] =
        dt === 0
          ? held[key]
          : held[key]
            ? Math.min(1, liveAmount[key] + dt / 0.03)
            : Math.max(0, liveAmount[key] - dt / 0.09);
    }
    applyPose(liveAmount, 0);
  };

  /** Hand over from the loop mid-phrase: keys already down come up smoothly. */
  const beginLive = () => liveAmount.set(keyAmount);

  /** Keys, dampers and sustain pedal for per-key press amounts 0…1. */
  const applyPose = (amounts: Float32Array, sustain: number) => {
    let moved = false;
    for (let key = 0; key < KEY_COUNT; key++) {
      const eased = amounts[key] * amounts[key] * (3 - 2 * amounts[key]);
      moved = setKeyAngle(key, eased * 0.058) || moved;
    }
    if (moved) {
      whiteKeys.instanceMatrix.needsUpdate = true;
      blackKeys.instanceMatrix.needsUpdate = true;
    }
    for (let key = 0; key < DAMPED; key++) {
      const lift = Math.max(sustain * 0.6, amounts[key]) * 0.014;
      dummy.position.copy(damperRest(key));
      dummy.position.y += lift;
      dummy.updateMatrix();
      dampers.setMatrixAt(key, dummy.matrix);
    }
    dampers.instanceMatrix.needsUpdate = true;
    pedals[2].rotation.x = sustain * 0.12;
  };

  return { group, pose, poseLive, beginLive, performance, stringMid };
}

// ── velvet ──────────────────────────────────────────────────────────────

function velvet(color: number, sheenColor: number, sway: { uniform: { value: number }; height: number }) {
  const material = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.9,
    sheen: 1,
    sheenColor,
    sheenRoughness: 0.42,
    side: THREE.DoubleSide,
  });
  // A slow breath of air through the fabric — strongest at the hem.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sway.uniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float hem = 1.0 - clamp(position.y / ${sway.height.toFixed(2)}, 0.0, 1.0);
        transformed.z += sin(uTime * 0.6 + position.y * 1.3 + position.x * 0.9) * 0.03 * hem * hem;`,
      );
  };
  material.customProgramCacheKey = () => `velvet-${sway.height}`;
  return material;
}

/**
 * A side drape hung from the top and tied back: narrow at the tie, full at
 * the top and flaring again to the floor, its folds deepening where the
 * fabric is gathered. x = 0 is the outer edge.
 */
function drapeGeometry(width: number, height: number, seed: number) {
  const geometry = new THREE.PlaneGeometry(width, height, 220, 80);
  geometry.translate(width / 2, height / 2, 0);
  const position = geometry.attributes.position;
  const tieY = 1.35;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const squeeze = 1 - 0.5 * Math.exp(-(((y - tieY) / 1.1) ** 2));
    const bunch = 1 / squeeze;
    const folds =
      0.7 * Math.sin((x * Math.PI * 2) / 0.42 + seed) +
      0.3 * Math.sin((x * Math.PI * 2) / 0.17 + seed * 2.1 + y * 0.15);
    const pleats = y > height - 0.25 ? 0.7 : 1;
    position.setXYZ(i, x * squeeze, y, 0.085 * bunch * folds * pleats);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** The border across the top: swags dipping between gathered points. */
function valanceGeometry(width: number, height: number, swag: number) {
  const geometry = new THREE.PlaneGeometry(width, height, 360, 30);
  geometry.translate(0, height / 2, 0);
  const position = geometry.attributes.position;
  const dip = (x: number) => {
    const along = ((((x + width / 2) / swag) % 1) + 1) % 1;
    return 0.34 * Math.sin(Math.PI * along);
  };
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const v = position.getY(i) / height;
    const d = dip(x);
    const y = height - (1 - v) * (height + d);
    const z =
      0.06 * Math.sin((x * Math.PI * 2) / 0.26) * (0.35 + 0.65 * (1 - v)) + 0.22 * (d / 0.34) * (1 - v);
    position.setXYZ(i, x, y, z);
  }
  geometry.computeVertexNormals();
  return { geometry, dip };
}

// ── light shafts ────────────────────────────────────────────────────────

const beamVertex = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  void main() {
    vLocal = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const beamFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uLength;
  uniform float uSeed;
  uniform vec3 uColor;
  varying vec3 vLocal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  void main() {
    float along = clamp(-vLocal.y / uLength, 0.0, 1.0);
    vec3 toCamera = normalize(cameraPosition - vWorldPosition);
    float facing = pow(abs(dot(normalize(vWorldNormal), toCamera)), 2.2);
    float angle = atan(vLocal.z, vLocal.x);
    // Integer frequencies around the cone: no seam where the angle wraps.
    float shafts = 0.5 * sin(angle * 7.0 + uSeed + uTime * 0.11)
                 + 0.3 * sin(angle * 13.0 + uSeed * 2.3 - uTime * 0.07)
                 + 0.2 * sin(angle * 23.0 + uSeed * 4.1 + uTime * 0.05);
    shafts = 0.62 + 0.38 * shafts;
    float drift = 0.88 + 0.12 * sin(along * 9.0 - uTime * 0.35 + sin(angle * 3.0 + uSeed) * 2.0);
    float fadeIn = smoothstep(0.0, 0.14, along);
    float fadeOut = 1.0 - 0.55 * smoothstep(0.7, 1.0, along);
    float strength = uIntensity * facing * shafts * drift * fadeIn * fadeOut * mix(1.0, 0.5, along);
    gl_FragColor = vec4(uColor * strength, 1.0);
  }
`;

const dustVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uKeep;
  attribute float aSeed;
  varying float vTwinkle;
  void main() {
    vec3 p = position;
    // A slow drift at each mote's own pace (0.75–1.25×) plus a small, faster
    // jitter, so the dust wanders like Brownian motion instead of swaying in
    // step. About 1.8× the old speed (Deepak, 2026-09-28: "a little faster").
    float pace = 0.75 + 0.5 * fract(aSeed * 7.13);
    float jitter = 0.8 + 0.4 * fract(aSeed * 3.71);
    p.x += sin(uTime * 0.23 * pace + aSeed * 12.0) * 0.12
         + sin(uTime * 0.67 * jitter + aSeed * 31.0) * 0.03;
    p.y += sin(uTime * 0.16 * pace + aSeed * 7.0) * 0.18
         + sin(uTime * 0.53 * jitter + aSeed * 17.0) * 0.035;
    p.z += cos(uTime * 0.2 * pace + aSeed * 9.0) * 0.12
         + cos(uTime * 0.59 * jitter + aSeed * 23.0) * 0.03;
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    vTwinkle = 0.45 + 0.55 * sin(uTime * (0.8 + aSeed) + aSeed * 40.0);
    // The adaptive quality thins the dust by shrinking motes away (size 0 =
    // no fragments), keyed on a hash of the seed so the ones kept are a fair
    // sample of every size. uKeep 2 keeps all: the factor is exactly 1.
    float keep = clamp((uKeep - fract(aSeed * 91.7)) / 0.05, 0.0, 1.0);
    gl_PointSize = (1.2 + aSeed * 2.2) * uPixelRatio * (6.0 / -view.z) * keep;
    gl_Position = projectionMatrix * view;
  }
`;

const dustFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vTwinkle;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float disc = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor * disc * vTwinkle, 1.0);
  }
`;

const moteVertex = /* glsl */ `
  uniform float uPixelRatio;
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vAlpha = aAlpha;
    gl_PointSize = 5.0 * uPixelRatio * (6.0 / -view.z);
    gl_Position = projectionMatrix * view;
  }
`;

const moteFragment = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float glow = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vec3(4.2, 3.0, 1.5) * glow * glow * vAlpha, 1.0);
  }
`;

type Beam = { mesh: THREE.Mesh; material: THREE.ShaderMaterial };

function makeBeam(
  apex: THREE.Vector3,
  target: THREE.Vector3,
  radius: number,
  color: THREE.Color,
  intensity: number,
  seed: number,
  time: { value: number },
): Beam {
  const length = apex.distanceTo(target) * 1.05;
  const geometry = new THREE.CylinderGeometry(0.06, radius, length, 96, 1, true);
  geometry.translate(0, -length / 2, 0);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: time,
      uIntensity: { value: intensity },
      uLength: { value: length },
      uSeed: { value: seed },
      uColor: { value: color },
    },
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(apex);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, -1, 0),
    target.clone().sub(apex).normalize(),
  );
  mesh.renderOrder = 10;
  return { mesh, material };
}

/** Dust hanging in a beam: points scattered through its cone. */
function makeDust(beam: Beam, radius: number, count: number, time: { value: number }, pixelRatio: number) {
  const random = seededRandom(3);
  const length = (beam.material.uniforms.uLength.value as number) * 0.95;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const along = 0.12 + random() * 0.86;
    const r = (0.06 + (radius - 0.06) * along) * Math.sqrt(random()) * 0.92;
    const angle = random() * Math.PI * 2;
    positions.set([Math.cos(angle) * r, -along * length, Math.sin(angle) * r], i * 3);
    seeds[i] = random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: time,
      uPixelRatio: { value: pixelRatio },
      uKeep: { value: 2 },
      uColor: { value: new THREE.Color(1.0, 0.86, 0.62).multiplyScalar(0.9) },
    },
    vertexShader: dustVertex,
    fragmentShader: dustFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.position.copy(beam.mesh.position);
  points.quaternion.copy(beam.mesh.quaternion);
  points.renderOrder = 11;
  return { points, material };
}

// ── environment for reflections ─────────────────────────────────────────

/** A dark room with a hot light above and red glows either side — what the
 *  lacquer and the brass should reflect. */
function makeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const room = new THREE.Scene();
  room.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(20, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0x020101, side: THREE.BackSide }),
    ),
  );
  const panel = (w: number, h: number, color: THREE.Color, position: THREE.Vector3) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    mesh.position.copy(position);
    mesh.lookAt(0, 0, 0);
    room.add(mesh);
  };
  panel(3, 3, new THREE.Color(9, 7.5, 5.5), new THREE.Vector3(0, 12, 1));
  panel(8, 10, new THREE.Color(0.22, 0.01, 0.02), new THREE.Vector3(-10, 2, 4));
  panel(8, 10, new THREE.Color(0.22, 0.01, 0.02), new THREE.Vector3(10, 2, 4));
  panel(20, 20, new THREE.Color(0.025, 0.012, 0.006), new THREE.Vector3(0, -12, 0));
  panel(1.5, 0.6, new THREE.Color(1.5, 1.3, 1.1), new THREE.Vector3(3, 6, 10));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(room, 0.03).texture;
  pmrem.dispose();
  room.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });
  return texture;
}

// ── the scene ───────────────────────────────────────────────────────────

function createStageScene(canvas: HTMLCanvasElement, options: StageOptions): StageScene {
  // Quality: the tier is guessed once from the device (stageQuality.ts);
  // HIGH is the stage exactly as it was before tiers existed. The runtime
  // ladder (below, `applyLevel`) only ever goes down from the tier.
  const guess = detectStageTier();
  const tier = guess.params;
  const ladder = stageLadder(tier, window.devicePixelRatio || 1);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier.antialias, powerPreference: 'high-performance' });
  let pixelRatio = ladder[0].pixelRatio;
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // soft since r186 (PCFSoftShadowMap is deprecated)
  // Everything that casts a shadow is static (the keys move millimetres,
  // invisible in a soft shadow): render the shadow map ONCE, not per frame.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030102);
  scene.fog = new THREE.FogExp2(0x030102, 0.05);
  const environment = makeEnvironment(renderer);
  scene.environment = environment;
  scene.environmentIntensity = 0.55;

  const time = { value: 0 };

  // Stage floor, apron and a black velvet backdrop.
  const wood = makeWoodTextures(renderer.capabilities.getMaxAnisotropy());
  wood.map.repeat.set(4, 2.2);
  wood.roughnessMap.repeat.set(4, 2.2);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 9),
    new THREE.MeshPhysicalMaterial({
      map: wood.map,
      roughnessMap: wood.roughnessMap,
      roughness: 1,
      bumpMap: wood.map,
      bumpScale: 0.35,
      clearcoat: 0.45,
      clearcoatRoughness: 0.28,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -0.5;
  floor.receiveShadow = true;
  scene.add(floor);
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(16, 1.4, 0.1),
    new THREE.MeshStandardMaterial({ map: wood.map, color: 0x6b6b6b, roughness: 0.7 }),
  );
  apron.position.set(0, -0.7, 4.0);
  scene.add(apron);
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 12),
    new THREE.MeshPhysicalMaterial({ color: 0x0a0306, roughness: 1, sheen: 0.8, sheenColor: 0x3a0c14 }),
  );
  backdrop.position.set(0, 5, -4.8);
  backdrop.receiveShadow = true;
  scene.add(backdrop);

  // Footlights along the front edge.
  const footlightMaterial = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: 0xffb866,
    emissiveIntensity: 6,
  });
  const footlights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 12, 8), footlightMaterial, 13);
  for (let i = 0; i < 13; i++) {
    footlights.setMatrixAt(i, new THREE.Matrix4().makeTranslation(-4.8 + i * 0.8, 0.035, 3.85));
  }
  footlights.computeBoundingSphere();
  scene.add(footlights);

  // Curtains.
  const CURTAIN_HEIGHT = 9;
  const CURTAIN_Z = 2.5;
  const swayUniform = { value: 0 };
  const curtainMaterial = velvet(0x6e0710, 0xff5566, { uniform: swayUniform, height: CURTAIN_HEIGHT });
  for (const side of [-1, 1]) {
    const curtain = new THREE.Mesh(drapeGeometry(3.3, CURTAIN_HEIGHT, side > 0 ? 1.3 : 0.2), curtainMaterial);
    curtain.position.set(side * 5.6, 0, CURTAIN_Z);
    curtain.scale.x = -side;
    curtain.receiveShadow = true;
    scene.add(curtain);
    // Gold tie-back cord.
    const cord = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.025, 8, 32),
      new THREE.MeshStandardMaterial({ color: 0xd4a849, metalness: 1, roughness: 0.35 }),
    );
    cord.position.set(side * 4.78, 1.35, CURTAIN_Z + 0.05);
    cord.rotation.set(Math.PI / 2, 0, 0);
    cord.scale.set(2.2, 0.9, 1);
    scene.add(cord);
  }
  const VALANCE_WIDTH = 13;
  const VALANCE_HEIGHT = 5.5;
  const VALANCE_BOTTOM = 3.55;
  const valanceMaterial = velvet(0x6e0710, 0xff5566, { uniform: { value: 0 }, height: 100 });
  const valance = valanceGeometry(VALANCE_WIDTH, VALANCE_HEIGHT, 2.6);
  const valanceMesh = new THREE.Mesh(valance.geometry, valanceMaterial);
  valanceMesh.position.set(0, VALANCE_BOTTOM, CURTAIN_Z + 0.2);
  scene.add(valanceMesh);
  // Gold fringe along the swags, and tassels where they meet.
  const goldTrim = new THREE.MeshStandardMaterial({ color: 0xd4a849, metalness: 1, roughness: 0.32 });
  const fringePoints: THREE.Vector3[] = [];
  for (let i = 0; i <= 260; i++) {
    const x = -VALANCE_WIDTH / 2 + (i / 260) * VALANCE_WIDTH;
    const d = valance.dip(x);
    fringePoints.push(new THREE.Vector3(x, VALANCE_BOTTOM - d - 0.02, CURTAIN_Z + 0.2 + 0.22 * (d / 0.34) + 0.02));
  }
  scene.add(
    new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(fringePoints), 520, 0.03, 6), goldTrim),
  );
  const tasselGeometry = new THREE.ConeGeometry(0.06, 0.3, 12);
  for (let x = -VALANCE_WIDTH / 2 + 2.6; x < VALANCE_WIDTH / 2; x += 2.6) {
    const tassel = new THREE.Mesh(tasselGeometry, goldTrim);
    tassel.position.set(x, VALANCE_BOTTOM - 0.16, CURTAIN_Z + 0.24);
    scene.add(tassel);
  }

  // The piano, turned so the open lid faces the audience.
  const piano = makePiano();
  const pianoRoot = new THREE.Group();
  piano.group.position.set(-CASE_WIDTH / 2, 0, 0.8);
  pianoRoot.add(piano.group);
  pianoRoot.rotation.y = -0.95;
  pianoRoot.position.set(0.15, 0, 0.1);
  pianoRoot.scale.setScalar(1.12);
  scene.add(pianoRoot);
  scene.updateMatrixWorld(true);

  // Lights: the spot from the grid, cool back light, warm curtain washes.
  scene.add(new THREE.HemisphereLight(0x2a1a22, 0x080302, 0.35));
  const spotTarget = new THREE.Vector3(0.15, 0.6, 0.15);
  const spotPosition = new THREE.Vector3(0.5, 8.2, 1.2);
  const spot = new THREE.SpotLight(0xffe0b0, 620, 0, 0.3, 0.55, 2);
  spot.position.copy(spotPosition);
  spot.target.position.copy(spotTarget);
  spot.castShadow = true;
  spot.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
  spot.shadow.camera.near = 4;
  spot.shadow.camera.far = 12;
  spot.shadow.bias = -0.0003;
  spot.shadow.normalBias = 0.02;
  scene.add(spot, spot.target);
  const back = new THREE.SpotLight(0x8aa2ff, 160, 0, 0.45, 0.8, 2);
  back.position.set(-1.5, 6.5, -4);
  back.target.position.set(0.2, 0.9, 0);
  scene.add(back, back.target);
  // The border: lit from the front of house, low and wide.
  const border = new THREE.SpotLight(0xffb070, 110, 0, 0.42, 0.9, 2);
  border.position.set(0, 0.8, 10);
  border.target.position.set(0, 4.2, CURTAIN_Z);
  scene.add(border, border.target);
  for (const side of [-1, 1]) {
    const wash = new THREE.SpotLight(0xffb070, 70, 0, 0.55, 0.9, 2);
    wash.position.set(side * 1.2, 4.5, 6.5);
    wash.target.position.set(side * 3.9, 2.0, CURTAIN_Z);
    scene.add(wash, wash.target);
  }

  // God rays: the main shaft and two fainter ones from the side of the grid.
  const beams = [
    makeBeam(spotPosition, new THREE.Vector3(0.15, 0, 0.15), 2.35, new THREE.Color(1.0, 0.82, 0.58), 0.11, 0.7, time),
    makeBeam(spotPosition, new THREE.Vector3(0.15, 0, 0.15), 1.5, new THREE.Color(1.0, 0.88, 0.7), 0.07, 2.9, time),
    makeBeam(new THREE.Vector3(-4.2, 8.5, -2.2), new THREE.Vector3(-1.6, 0, -3.2), 1.2, new THREE.Color(0.55, 0.62, 1.0), 0.05, 4.2, time),
    makeBeam(new THREE.Vector3(4.6, 8.5, -2.0), new THREE.Vector3(2.0, 0, -3.4), 1.2, new THREE.Color(0.55, 0.62, 1.0), 0.045, 5.3, time),
  ];
  for (const beam of beams) scene.add(beam.mesh);
  const dust = makeDust(beams[0], 2.35, tier.dust, time, pixelRatio);
  scene.add(dust.points);
  /** Share of the dust drawn (1 = all; the ladder's last level halves it,
   *  easing there so no mote pops out). */
  let dustKeep = 1;
  let dustKeepWanted = 1;

  // Motes that rise from each string as it is struck.
  const MOTES = tier.motes;
  /** The ring new motes are emitted into; the ladder can shrink it — motes
   *  past it finish their short lives, so none vanishes mid-air. */
  let moteRing = MOTES;
  const motePositions = new Float32Array(MOTES * 3);
  const moteAlpha = new Float32Array(MOTES);
  const moteVelocity = new Float32Array(MOTES * 3);
  const moteLife = new Float32Array(MOTES);
  const moteMaxLife = new Float32Array(MOTES).fill(1);
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  moteGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(moteAlpha, 1));
  const motes = new THREE.Points(
    moteGeometry,
    new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: pixelRatio } },
      vertexShader: moteVertex,
      fragmentShader: moteFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  const moteMaterial = motes.material as THREE.ShaderMaterial;
  motes.frustumCulled = false;
  motes.renderOrder = 12;
  scene.add(motes);
  const moteRandom = seededRandom(5);
  let nextMote = 0;
  const emitMote = (key: number) => {
    const origin = piano.stringMid[key].clone();
    origin.z += (moteRandom() - 0.5) * 0.3;
    piano.group.localToWorld(origin);
    const i = nextMote % moteRing;
    nextMote = (i + 1) % moteRing;
    motePositions.set([origin.x, origin.y, origin.z], i * 3);
    moteVelocity.set([(moteRandom() - 0.5) * 0.08, 0.16 + moteRandom() * 0.14, (moteRandom() - 0.5) * 0.08], i * 3);
    moteMaxLife[i] = 2.2 + moteRandom() * 1.6;
    moteLife[i] = moteMaxLife[i];
  };
  const stepMotes = (dt: number, t: number) => {
    for (let i = 0; i < MOTES; i++) {
      if (moteLife[i] <= 0) {
        moteAlpha[i] = 0;
        continue;
      }
      moteLife[i] -= dt;
      const k = i * 3;
      motePositions[k] += (moteVelocity[k] + Math.sin(t * 1.3 + i) * 0.03) * dt;
      motePositions[k + 1] += moteVelocity[k + 1] * dt;
      motePositions[k + 2] += (moteVelocity[k + 2] + Math.cos(t * 1.1 + i) * 0.03) * dt;
      const age = 1 - Math.max(0, moteLife[i]) / moteMaxLife[i];
      moteAlpha[i] = Math.sin(Math.PI * age) * 0.9;
    }
    moteGeometry.attributes.position.needsUpdate = true;
    moteGeometry.attributes.aAlpha.needsUpdate = true;
  };

  // Camera and post-processing.
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);
  const lookAt = new THREE.Vector3(0.1, 1.72, 0);
  const basePosition = new THREE.Vector3(0.6, 2.35, 9.6);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const BLOOM_STRENGTH = 0.55;
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM_STRENGTH, 0.6, 2.6);
  // The bloom's targets follow the composer's size times a resolution scale
  // (full on HIGH, half on MEDIUM, off on LOW). Its threshold is 2.6: only
  // the footlights, motes and the spot's glints bloom, and a blur of those
  // looks the same at half resolution. Scale 1 passes the size through
  // untouched, so HIGH is the pass exactly as before.
  let bloomScale = tier.bloom;
  /** The level's bloom scale; 0 fades the bloom out, then turns it off. */
  let bloomWanted = tier.bloom;
  const bloomSize = { width: 1, height: 1 };
  const setBloomSize = bloom.setSize.bind(bloom);
  bloom.setSize = (width: number, height: number) => {
    bloomSize.width = width;
    bloomSize.height = height;
    if (bloomScale === 1) setBloomSize(width, height);
    else setBloomSize(Math.max(2, Math.round(width * bloomScale)), Math.max(2, Math.round(height * bloomScale)));
  };
  const resizeBloom = (scale: number) => {
    if (scale === bloomScale) return;
    bloomScale = scale;
    bloom.setSize(bloomSize.width, bloomSize.height);
  };
  if (tier.bloom === 0) {
    bloom.enabled = false;
    bloom.strength = 0;
  }
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // Runtime adaptation (stageQuality.ts): a level is applied just before a
  // frame is drawn, so a resize never shows an empty canvas. Pixel ratio
  // and bloom resolution change at once (a slight softening); the bloom's
  // switch-off and the dust's thinning ease over a second or two.
  const describeQuality = () => {
    const level = ladder[adaptive.level()];
    return (
      `${tier.tier}${adaptive.label()} (${guess.reasons.join(', ')}; ` +
      `pr ${level.pixelRatio.toFixed(2)}, bloom ${level.bloom === 0 ? 'off' : level.bloom}, ` +
      `shadow ${tier.shadowMap}, dust ${level.dust}, motes ${level.motes})`
    );
  };
  const markQuality = () => {
    const level = adaptive.level();
    canvas.dataset.quality = level === 0 ? tier.tier : `${tier.tier}-${level}`;
  };
  const applyLevel = (index: number) => {
    const level = ladder[index];
    if (Math.abs(level.pixelRatio - pixelRatio) > 1e-3) {
      pixelRatio = level.pixelRatio;
      renderer.setPixelRatio(pixelRatio); // re-sizes the canvas's buffer
      composer.setPixelRatio(pixelRatio); // and every pass's targets
      dust.material.uniforms.uPixelRatio.value = pixelRatio;
      moteMaterial.uniforms.uPixelRatio.value = pixelRatio;
    }
    bloomWanted = level.bloom;
    if (level.bloom > 0) {
      resizeBloom(level.bloom);
      bloom.enabled = true; // fades back in from wherever it was
    }
    dustKeepWanted = level.dust / tier.dust;
    moteRing = level.motes;
    markQuality();
  };
  const adaptive = createStageAdaptive(ladder.length, applyLevel, {
    enabled: !guess.forced && !options.reducedMotion,
  });
  markQuality();
  /** Ease the bloom and the dust towards the current level. */
  const stepQuality = (dt: number) => {
    const strength = bloomWanted > 0 ? BLOOM_STRENGTH : 0;
    if (bloom.strength !== strength) {
      const step = (BLOOM_STRENGTH / 1.2) * dt;
      bloom.strength =
        strength > bloom.strength ? Math.min(strength, bloom.strength + step) : Math.max(strength, bloom.strength - step);
      if (bloom.strength === 0 && bloomWanted === 0) {
        bloom.enabled = false;
        resizeBloom(0); // frees the targets' memory
      }
    }
    if (dustKeep !== dustKeepWanted) {
      const step = dt / 2;
      dustKeep =
        dustKeepWanted > dustKeep ? Math.min(dustKeepWanted, dustKeep + step) : Math.max(dustKeepWanted, dustKeep - step);
      dust.material.uniforms.uKeep.value = dustKeep >= 1 ? 2 : dustKeep;
    }
  };

  // Drag to look around the stage a little: an orbit about the piano,
  // clamped so the curtains always frame the view, and eased so it glides.
  // Wide enough to look round the stage and from above, bounded so the
  // view never ends up under the floor or facing the back of the house.
  const YAW_LIMIT = 0.7;
  const PITCH_MIN = -0.12;
  const PITCH_MAX = 0.45;
  // Zoom multiplies the orbit radius (wheel, trackpad pinch, touch pinch).
  const ZOOM_MIN = 0.55;
  const ZOOM_MAX = 1.4;
  const baseOffset = new THREE.Spherical().setFromVector3(basePosition.clone().sub(lookAt));
  const orbit = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, zoom: 1, targetZoom: 1 };
  // IDLE ORBIT (Deepak, 2026-09-28): left alone, the view wanders slowly on
  // its own — a few unrelated slow waves with random phases, so it never
  // visibly repeats. It fades in after IDLE_AFTER_SECONDS without a drag,
  // pinch or scroll (and once the piano tour has finished); any of those
  // folds the current wander into the visitor's own orbit, so nothing jumps
  // under their hand.
  const IDLE_AFTER_SECONDS = 2.5;
  const wanderPhase = Array.from({ length: 6 }, () => Math.random() * Math.PI * 2);
  const wander = { yaw: 0, pitch: 0, zoom: 1, weight: 0 };
  let lastInteraction = -Infinity;
  const bakeWander = () => {
    lastInteraction = performance.now();
    if (wander.weight === 0) return;
    orbit.yaw += wander.yaw;
    orbit.targetYaw += wander.yaw;
    orbit.pitch += wander.pitch;
    orbit.targetPitch += wander.pitch;
    orbit.zoom *= wander.zoom;
    orbit.targetZoom *= wander.zoom;
    wander.weight = 0;
    wander.yaw = 0;
    wander.pitch = 0;
    wander.zoom = 1;
  };
  /** Pointers currently down on the stage: one drags, two pinch. */
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance: number | null = null;
  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';
  /** No animation loop to ease towards the target: jump and redraw. */
  const redrawStill = () => {
    if (!options.reducedMotion) return;
    orbit.yaw = orbit.targetYaw;
    orbit.pitch = orbit.targetPitch;
    orbit.zoom = orbit.targetZoom;
    placeCamera(0);
    composer.render(0);
  };
  const zoomBy = (factor: number) => {
    orbit.targetZoom = THREE.MathUtils.clamp(orbit.targetZoom * factor, ZOOM_MIN, ZOOM_MAX);
    redrawStill();
  };
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (flight || (event.pointerType === 'mouse' && event.button !== 0)) return;
    bakeWander();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
    pinchDistance = pointers.size === 2 ? spread() : null;
  };
  const onPointerMove = (event: PointerEvent) => {
    const last = pointers.get(event.pointerId);
    if (!last || flight) return;
    lastInteraction = performance.now();
    if (pointers.size >= 2) {
      last.x = event.clientX;
      last.y = event.clientY;
      const distance = spread();
      // Fingers apart = closer, like every map and photo viewer.
      if (pinchDistance !== null && distance > 0) zoomBy(pinchDistance / distance);
      pinchDistance = distance;
      return;
    }
    const scale = 2.2 / Math.max(canvas.clientWidth, 1);
    orbit.targetYaw = THREE.MathUtils.clamp(
      orbit.targetYaw - (event.clientX - last.x) * scale,
      -YAW_LIMIT,
      YAW_LIMIT,
    );
    orbit.targetPitch = THREE.MathUtils.clamp(
      orbit.targetPitch + (event.clientY - last.y) * scale,
      PITCH_MIN,
      PITCH_MAX,
    );
    last.x = event.clientX;
    last.y = event.clientY;
    redrawStill();
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId)) return;
    pinchDistance = pointers.size === 2 ? spread() : null;
    if (pointers.size === 0) canvas.style.cursor = flight ? '' : 'grab';
  };
  const onWheel = (event: WheelEvent) => {
    // Also stops a trackpad pinch (ctrl + wheel) from zooming the page.
    event.preventDefault();
    if (flight) return;
    bakeWander();
    const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    zoomBy(Math.exp(pixels * (event.ctrlKey ? 0.01 : 0.0012)));
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // The fly-in: from wherever the audience view is, round to the open
  // bentside, then in over the rim under the raised lid — the way the
  // sound comes out — to hover above the treble strings, behind the music
  // desk, looking across the dancing dampers towards the bass. A cubic
  // Bézier, eased in and out. (Straight in over the keyboard would pass
  // through the music desk.)
  const toWorld = (x: number, y: number, z: number) => piano.group.localToWorld(new THREE.Vector3(x, y, z));
  const flightEnd = toWorld(1.12, 0.98, -0.42);
  const flightEndLook = toWorld(0.45, 0.74, -0.36);
  const flightApproach = toWorld(CASE_WIDTH + 0.9, 1.35, -0.35);
  let flight: { start: number | null; from: THREE.Vector3; fromLook: THREE.Vector3 } | null = null;
  const cubic = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, u: number) => {
    const v = 1 - u;
    return a
      .clone()
      .multiplyScalar(v * v * v)
      .addScaledVector(b, 3 * v * v * u)
      .addScaledVector(c, 3 * v * u * u)
      .addScaledVector(d, u * u * u);
  };
  const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
  const flyCamera = (t: number) => {
    if (!flight) return;
    if (flight.start === null) flight.start = t;
    const u = Math.min(1, (t - flight.start) / FLIGHT_SECONDS);
    const e = easeInOut(u);
    const lift = flight.from.clone().lerp(flightApproach, 0.55);
    lift.y += 0.35;
    camera.position.copy(cubic(flight.from, lift, flightApproach, flightEnd, e));
    // The gaze leads the body a little, settling on the strings first.
    camera.lookAt(flight.fromLook.clone().lerp(flightEndLook, Math.min(1, e * 1.3)));
  };

  // "Play the piano" is a camera TOUR shaped by views Deepak picked
  // (2026-09-27, from the [stage-camera] logs): from the audience seat in
  // towards the keys, low; bending round towards the tail at key height;
  // then up over the keys, where it settles on his chosen view. The middle
  // views pull the curve without it passing through them (see cameraTour).
  // His "a little further round" view was dropped (2026-09-28: "it makes a
  // cross, maybe drop the last point") — the path doubled back from it.
  // Leaving the piano plays it backwards. Dragging still orbits around
  // wherever the view is.
  //
  // Each view is [turn, rise]: radians of azimuth / polar angle from the
  // audience seat's own angles, at CLOSE_RADIUS round the keyboard.
  const closeLook = toWorld(CASE_WIDTH / 2, KEY_TOP + 0.12, 0.08);
  const CLOSE_RADIUS = 3.461;
  const TOUR: readonly (readonly [number, number])[] = [
    [0, 0], // the audience seat
    [-0.548, -0.061], // in low, facing the keys
    [-0.739, 0.02], // round towards the tail, at key height
    [-0.736, -0.245], // up over the keys — where it settles
  ];
  const TOUR_SECONDS = 7;
  /** Leaving the piano replays the tour backwards this much faster. */
  const TOUR_RETURN_SPEED = 2;
  const tour = makeCameraTour(TOUR, (turn, rise, near, out) => {
    const radius = THREE.MathUtils.lerp(baseOffset.radius, CLOSE_RADIUS, near);
    out.look.lerpVectors(lookAt, closeLook, near);
    out.position
      .setFromSpherical(new THREE.Spherical(radius, baseOffset.phi + rise, baseOffset.theta + turn))
      .add(out.look);
  });
  let tourClock = 0;
  let tourForward = false;
  let lastPlaceTime: number | null = null;
  let closeness = 0; // tour progress 0…1
  const currentLook = lookAt.clone();

  const spherical = new THREE.Spherical();
  const placeCamera = (t: number) => {
    if (flight) {
      flyCamera(t);
      return;
    }
    orbit.yaw += (orbit.targetYaw - orbit.yaw) * 0.1;
    orbit.pitch += (orbit.targetPitch - orbit.pitch) * 0.1;
    orbit.zoom += (orbit.targetZoom - orbit.zoom) * 0.12;
    // Real time, so a slow frame rate cannot stretch the tour; capped so a
    // return to a hidden tab does not jump it.
    const dt = lastPlaceTime === null ? 0 : Math.min(0.25, Math.max(0, t - lastPlaceTime));
    lastPlaceTime = t;
    tourClock = options.reducedMotion
      ? tourForward
        ? TOUR_SECONDS
        : 0
      : THREE.MathUtils.clamp(
          tourClock + (tourForward ? dt : -dt * TOUR_RETURN_SPEED),
          0,
          TOUR_SECONDS,
        );
    closeness = tourClock / TOUR_SECONDS;
    // The idle orbit: fades in (~1.5 s time constant) once nothing has
    // touched the view for a while and the tour is not moving.
    const tourMoving = tourClock > 0 && tourClock < TOUR_SECONDS;
    const idle =
      !options.reducedMotion &&
      !tourMoving &&
      pointers.size === 0 &&
      (performance.now() - lastInteraction) / 1000 > IDLE_AFTER_SECONDS;
    wander.weight += ((idle ? 1 : 0) - wander.weight) * (1 - Math.exp(-dt / 1.5));
    if (wander.weight < 1e-4 && !idle) wander.weight = 0;
    const [a, b, c, d, e, f] = wanderPhase;
    const idleMotion = options.idleMotion ?? 1;
    wander.yaw =
      wander.weight * idleMotion * (0.12 * Math.sin(t * 0.16 + a) + 0.06 * Math.sin(t * 0.083 + b));
    wander.pitch =
      wander.weight * idleMotion * (0.028 * Math.sin(t * 0.11 + c) + 0.015 * Math.sin(t * 0.061 + d));
    wander.zoom =
      1 + wander.weight * idleMotion * (0.025 * Math.sin(t * 0.061 + e) + 0.015 * Math.sin(t * 0.113 + f));
    // Sideways pan, only above the default (0 at idleMotion 1).
    const pan = wander.weight * Math.max(0, idleMotion - 1) * 0.16 * Math.sin(t * 0.07 + e);
    // Smootherstep: gentle at both ends, briskest in the middle (Deepak,
    // 2026-09-28: "a little faster in the middle of the motion").
    const eased = closeness * closeness * closeness * (closeness * (closeness * 6 - 15) + 10);
    const { turn, rise, near } = tour.at(eased);
    currentLook.lerpVectors(lookAt, closeLook, near);
    currentLook.x += pan;
    spherical.set(
      THREE.MathUtils.lerp(baseOffset.radius, CLOSE_RADIUS, near) * orbit.zoom * wander.zoom,
      baseOffset.phi + rise - orbit.pitch - wander.pitch,
      baseOffset.theta + turn + orbit.yaw + wander.yaw,
    );
    camera.position.setFromSpherical(spherical).add(currentLook);
    camera.lookAt(currentLook);
  };

  let previous = performance.now();
  const start = previous;
  let previousLoopTime = 0;
  let live = false;
  const held = new Uint8Array(KEY_COUNT);
  const MIN_FRAME_MS = 1000 / 61;
  /** An animation frame was skipped by the cap since the last render. */
  let capped = false;
  const frame = () => {
    const now = performance.now();
    if (now - previous < MIN_FRAME_MS) {
      capped = true;
      return;
    }
    adaptive.frame(now, capped);
    capped = false;
    const dt = Math.min(0.05, (now - previous) / 1000);
    previous = now;
    stepQuality(dt);
    const t = (now - start) / 1000;
    time.value = t;
    swayUniform.value = t;

    const loopTime = t % piano.performance.length;
    for (const event of live ? [] : piano.performance.events) {
      const struck =
        loopTime >= previousLoopTime
          ? event.start > previousLoopTime && event.start <= loopTime
          : event.start > previousLoopTime || event.start <= loopTime;
      if (struck) {
        emitMote(event.key);
        if (moteRandom() < 0.5) emitMote(event.key);
      }
    }
    previousLoopTime = loopTime;
    if (live) piano.poseLive(held, dt);
    else piano.pose(loopTime);
    stepMotes(dt, t);
    placeCamera(t);
    composer.render(dt);
  };

  const resize = (width: number, height: number) => {
    if (width === 0 || height === 0) return;
    const aspect = width / height;
    camera.aspect = aspect;
    // Keep the stage's width in view on narrow screens.
    const verticalFov = 40;
    camera.fov =
      aspect >= 1.35
        ? verticalFov
        : Math.min(
            75,
            (2 * Math.atan((Math.tan(THREE.MathUtils.degToRad(verticalFov / 2)) * 1.35) / aspect) * 180) /
              Math.PI,
          );
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    if (options.reducedMotion) {
      piano.pose(1.0);
      placeCamera(0);
      composer.render(0);
    }
  };

  // The loop runs unless the owner paused the stage OR the tab is hidden
  // (browsers throttle a hidden tab's animation frames, not always to zero,
  // and a frame nobody sees is wasted battery). Each is its own reason: a
  // stage paused by its owner stays paused when the tab comes back.
  let ownerPaused = false;
  let disposed = false;
  let looping = false;
  const syncLoop = () => {
    const run = !options.reducedMotion && !ownerPaused && !disposed && !document.hidden;
    if (run === looping) return;
    looping = run;
    if (run) {
      // The gap is not a slow frame; the first frames back warm up again.
      adaptive.reset();
      capped = false;
    }
    renderer.setAnimationLoop(run ? frame : null);
  };
  document.addEventListener('visibilitychange', syncLoop);
  syncLoop();

  return {
    resize,
    flyIn() {
      if (options.reducedMotion || flight) return;
      pointers.clear();
      pinchDistance = null;
      canvas.style.cursor = '';
      // From wherever the view is now — the audience seat or the piano view.
      flight = { start: null, from: camera.position.clone(), fromLook: currentLook.clone() };
      // Close enough to the strings to see the felt.
      camera.near = 0.02;
      camera.updateProjectionMatrix();
    },
    cancelFlight() {
      flight = null;
      canvas.style.cursor = 'grab';
      camera.near = 0.1;
      camera.updateProjectionMatrix();
    },
    pause() {
      ownerPaused = true;
      syncLoop();
    },
    resume() {
      if (options.reducedMotion) {
        composer.render(0);
        return;
      }
      // The frame step is capped, so the time spent paused is not replayed.
      ownerPaused = false;
      syncLoop();
    },
    setLive(next) {
      if (next === live) return;
      live = next;
      held.fill(0);
      if (live) piano.beginLive();
      tourForward = live;
      // The glide lands on the framed keyboard view, whatever the visitor
      // had dragged or zoomed to before; they can look around again after.
      orbit.targetYaw = 0;
      orbit.targetPitch = 0;
      orbit.targetZoom = 1;
      if (options.reducedMotion) {
        placeCamera(0);
        composer.render(0);
      }
    },
    setLiveKey(key, down) {
      if (!live || key < 0 || key >= KEY_COUNT) return;
      if (down && !held[key]) {
        emitMote(key);
        emitMote(key);
      }
      held[key] = down ? 1 : 0;
      // No animation loop: show the key where it is and redraw.
      if (options.reducedMotion) {
        piano.poseLive(held, 0);
        composer.render(0);
      }
    },
    quality: describeQuality,
    dispose() {
      disposed = true;
      syncLoop();
      renderer.setAnimationLoop(null);
      document.removeEventListener('visibilitychange', syncLoop);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      const materials = new Set<THREE.Material>();
      scene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            materials.add(material);
          }
        }
      });
      for (const material of materials) material.dispose();
      wood.map.dispose();
      wood.roughnessMap.dispose();
      environment.dispose();
      spot.shadow.map?.dispose();
      bloom.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };
}

export { createStageScene, FLIGHT_SECONDS };
export type { StageScene };

// COPIED from .claude/pages/ad/experiments/env-src/scene-organ.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * A small wooden CHAMBER PIPE ORGAN (a positive organ, one player) for the
 * sakura scene — all procedural, in the scenes' hand-painted anime look:
 * banded sun / cool shade from the tree's own shadow field (so it sits in
 * the shade with the odd sun spot), lacquer gloss on the wood, painted tin
 * pipes, no outlines.
 *
 *  - CASE: one merged mesh of tagged pieces (cherry case, walnut panels,
 *    gilt mouldings and dentils, carved cornice with a crest and finials,
 *    ivory-faced drawstops either side of the manual, a small bench). Each
 *    vertex carries its piece, so the "assemble" arrival builds it piece by
 *    piece in the vertex shader.
 *  - PIPES: an instanced façade of 19 tin pipes, towered (a tall centre
 *    tower, falling flats, two side towers), each with a cone foot, a mouth
 *    and upper / lower lips; per pipe a RISE (slides up out of the chest)
 *    and a GLOW (the note it answers).
 *  - KEYS: one manual, C2…C6 (49 keys), instanced: ivory naturals, ebony
 *    sharps, each pivoting at its back end when pressed.
 *  - SWIRL: a GPU petal swirl (converge = the "bloom" arrival, disperse =
 *    the departure), and a CPU flutter pool for pipe breaths and puffs.
 *
 * Frame: origin = the front-centre of the plinth on the ground; +z = towards
 * the player, +y up. Everything a call allocates is freed by dispose().
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KIT_GLSL } from './v2kit';
import { SHADOW_SAMPLE_GLSL, type ShadowUniforms } from './shadow';
import type { SceneEnv } from './scene-world';
import { createFlutter } from './scene-flutter';

export type OrganMoveId = 'bloom' | 'rise' | 'assemble' | 'descend';
export const ORGAN_MOVES: { id: OrganMoveId; label: string }[] = [
  { id: 'bloom', label: 'Bloom' },
  { id: 'rise', label: 'Rise' },
  { id: 'assemble', label: 'Assemble' },
  { id: 'descend', label: 'Descend' },
];

/** Lowest and highest notes of the manual (C2…C6). */
export const MANUAL_LOW = 36;
export const MANUAL_HIGH = 84;

export type OrganOptions = {
  u: SceneEnv;
  /** The tree's OWN shadow field (not the stamped one: no self shadow). */
  field: { texture: THREE.Texture; rect: THREE.Vector4 };
  /** Ground point under the plinth's front centre. */
  position: THREE.Vector3;
  /** Rotation about y: the front (+z) faces this way. */
  yaw: number;
  scale: number;
  /** Particle budget 0…1 (quality tier). */
  particles: number;
  heightAt: (x: number, z: number) => number;
};

export type Organ = {
  /** Root (placed); add to the scene. */
  group: THREE.Group;
  /** World-space effects (petal swirl, breaths, puffs); add to the scene. */
  fx: THREE.Group;
  /**
   * The visible state: `arrive` 0…1 of `move`'s arrival, then `depart` 0…1
   * of the departure (a dissolve into petals) on top of it, at time t.
   */
  setState(move: OrganMoveId, arrive: number, depart: number, t: number): void;
  noteOn(midi: number): void;
  noteOff(midi: number): void;
  /** Release every held note (Leave). */
  allOff(): void;
  update(t: number, dt: number): void;
  /** World xz capsules of the footprint (grass parting, contact shadow). */
  footprint(): { a: THREE.Vector2; b: THREE.Vector2; r: number }[];
  /** 0…1: how present the organ is on the ground (grass, shadow). */
  presence(): number;
  dispose(): void;
};

// ── shared GLSL ──────────────────────────────────────────────────────────

const ORGAN_GLSL = /* glsl */ `
uniform float uReveal;     // dissolve threshold (1 = whole, 0 = gone)
uniform vec3 uEdge;        // dissolve edge glow
uniform float uGroundY;
float oHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float oNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(oHash(i), oHash(i + vec3(1, 0, 0)), f.x), mix(oHash(i + vec3(0, 1, 0)), oHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(oHash(i + vec3(0, 0, 1)), oHash(i + vec3(1, 0, 1)), f.x), mix(oHash(i + vec3(0, 1, 1)), oHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
/** Dissolve: discards above the threshold; returns the edge glow amount. */
float dissolve(vec3 lp) {
  if (uReveal >= 0.999) return 0.0;
  // Fine painted speckle, biased by height: it blooms from the ground up
  // and blows away from the top down.
  float n = (oNoise(lp * 16.0) * 0.6 + oNoise(lp * 41.0) * 0.4) * 0.6 + clamp(lp.y / 2.4, 0.0, 1.0) * 0.4;
  if (n > uReveal) discard;
  return smoothstep(uReveal - 0.09, uReveal, n);
}
/** The painted light: banded sun masked by the tree's shade, cool fill. */
vec3 organLight(vec3 base, vec3 n, vec3 wp, float gloss) {
  vec3 sh = shadowAt(wp, max(wp.y - uGroundY, 0.0));
  float sv = sh.r * cloudShadow(wp);
  float ndl = dot(n, uSunDir);
  float band = smoothstep(0.0, 0.08, ndl) * 0.65 + smoothstep(0.42, 0.5, ndl) * 0.35;
  vec3 V = normalize(cameraPosition - wp);
  vec3 col = base * (uAmbient * (0.62 + 0.22 * n.y) + srgb(vec3(0.05, 0.07, 0.02)) * (1.0 - n.y) * 0.5);
  col += base * uSunColor * band * sv * 1.05;
  // Lacquer: a crisp sun glint and a soft sky sheen at grazing angles.
  vec3 H = normalize(uSunDir + V);
  col += uSunColor * smoothstep(0.82, 0.95, pow(max(dot(n, H), 0.0), 48.0)) * sv * gloss;
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  col += mix(uHorizon, uZenith, clamp(n.y * 0.5 + 0.5, 0.0, 1.0)) * fres * gloss * 0.22;
  return col;
}
`;

const SHADE_GLSL = KIT_GLSL + SHADOW_SAMPLE_GLSL + ORGAN_GLSL;

// ── case geometry ────────────────────────────────────────────────────────

/** Wood / trim kinds (case colours). */
const KINDS = ['#8f3d23', '#64391f', '#c99b44', '#efe4c8', '#1c1512', '#73301c'];
const PIECES = 8; // assemble order: plinth, lower case, bench, keyboard, chest + stops, sides + back, pilasters, cornice

function buildCase(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tag = (g: THREE.BufferGeometry, kind: number, piece: number) => {
    g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(new Array(n).fill(kind), 1));
    g.setAttribute('aPiece', new THREE.Float32BufferAttribute(new Array(n).fill(piece), 1));
    parts.push(g);
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, kind: number, piece: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    tag(g, kind, piece);
  };
  const cylZ = (r: number, len: number, x: number, y: number, z: number, kind: number, piece: number) => {
    const g = new THREE.CylinderGeometry(r, r, len, 10);
    g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    tag(g, kind, piece);
  };
  const ball = (r: number, x: number, y: number, z: number, kind: number, piece: number) => {
    const g = new THREE.SphereGeometry(r, 10, 7);
    g.translate(x, y, z);
    tag(g, kind, piece);
  };
  // 0 plinth
  box(1.40, 0.08, 0.78, 0, 0.04, -0.35, 1, 0);
  // 1 lower case: body, raised walnut panels, gilt rail
  box(1.30, 0.62, 0.70, 0, 0.39, -0.35, 0, 1);
  for (const x of [-0.31, 0.31]) {
    box(0.50, 0.40, 0.02, x, 0.38, 0.005, 1, 1);
    box(0.54, 0.02, 0.025, x, 0.59, 0.006, 2, 1);
    box(0.54, 0.02, 0.025, x, 0.17, 0.006, 2, 1);
  }
  for (const s of [-1, 1]) box(0.02, 0.40, 0.50, s * 0.655, 0.38, -0.35, 1, 1);
  box(1.30, 0.02, 0.02, 0, 0.69, 0.005, 2, 1);
  // 2 bench (in front of the manual)
  box(0.90, 0.05, 0.30, 0, 0.455, 0.66, 5, 2);
  for (const x of [-0.40, 0.40]) for (const z of [0.54, 0.78]) box(0.045, 0.43, 0.045, x, 0.215, z, 5, 2);
  box(0.80, 0.03, 0.03, 0, 0.12, 0.66, 5, 2);
  // 3 keyboard: key bed, cheeks (the keys are their own instanced mesh)
  box(0.84, 0.03, 0.24, 0, 0.715, 0.09, 0, 3);
  box(1.30, 0.10, 0.66, 0, 0.75, -0.37, 1, 3); // the back of the key recess
  for (const s of [-1, 1]) box(0.05, 0.10, 0.26, s * 0.445, 0.78, 0.08, 0, 3);
  // 4 the chest above the keys, name board, drawstops (shank + ivory knob)
  box(1.30, 0.24, 0.68, 0, 0.92, -0.32, 0, 4);
  box(0.84, 0.022, 0.012, 0, 0.812, 0.026, 2, 4);
  box(1.20, 0.03, 0.03, 0, 1.055, -0.10, 2, 4);
  for (const x of [-0.60, -0.53, 0.53, 0.60]) {
    for (const y of [0.87, 0.95]) {
      cylZ(0.007, 0.04, x, y, 0.04, 1, 4);
      cylZ(0.017, 0.014, x, y, 0.066, 3, 4);
    }
  }
  // 5 the upper case sides and back (walnut inside)
  for (const s of [-1, 1]) box(0.03, 1.02, 0.62, s * 0.64, 1.55, -0.33, 0, 5);
  box(1.26, 1.02, 0.03, 0, 1.55, -0.63, 5, 5);
  // 6 pilasters with gilt capitals and bases
  for (const s of [-1, 1]) {
    box(0.075, 1.02, 0.08, s * 0.625, 1.55, -0.02, 0, 6);
    box(0.095, 0.04, 0.10, s * 0.625, 2.04, -0.02, 2, 6);
    box(0.095, 0.03, 0.10, s * 0.625, 1.07, -0.02, 2, 6);
  }
  // 7 cornice: mouldings, gilt dentils, pipe shade, crest, finials
  box(1.46, 0.05, 0.76, 0, 2.085, -0.33, 0, 7);
  box(1.52, 0.035, 0.80, 0, 2.127, -0.33, 5, 7);
  for (let i = 0; i < 18; i++) box(0.03, 0.03, 0.02, -0.68 + i * 0.08, 2.045, 0.03, 2, 7);
  box(1.18, 0.025, 0.02, 0, 1.975, -0.05, 2, 7);
  for (let i = 0; i < 12; i++) box(0.012, 0.07, 0.012, -0.55 + i * 0.1, 1.94, -0.05, 2, 7);
  box(0.46, 0.10, 0.05, 0, 2.195, -0.04, 0, 7);
  box(0.30, 0.06, 0.05, 0, 2.27, -0.04, 0, 7);
  box(0.50, 0.02, 0.06, 0, 2.25, -0.035, 2, 7);
  ball(0.04, 0, 2.33, -0.04, 2, 7);
  for (const s of [-1, 1]) ball(0.035, s * 0.70, 2.18, -0.02, 2, 7);
  const g = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return g;
}

// ── pipes ────────────────────────────────────────────────────────────────

type Pipe = { x: number; z: number; h: number; r: number };

function facade(): Pipe[] {
  const pipes: Pipe[] = [];
  for (let i = -9; i <= 9; i++) {
    const a = Math.abs(i);
    // Tall centre tower, falling flats, two side towers.
    const h = a <= 6 ? 0.9 - 0.055 * a : [0.74, 0.70, 0.66][a - 7];
    const tower = a <= 2 || a >= 7;
    pipes.push({ x: i * 0.06, z: tower ? -0.1 : -0.17, h, r: 0.011 + 0.014 * h });
  }
  return pipes;
}

const FOOT = 0.16;

function pipeTemplate(radial = 14, rings = 6): THREE.InstancedBufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  // Per vertex: x = angle, y = t along the part (0…1), z = part (0 foot, 1 body).
  let base = 0;
  for (const part of [0, 1]) {
    const n = part === 0 ? 2 : rings;
    for (let j = 0; j <= n; j++) {
      for (let k = 0; k <= radial; k++) pos.push((k / radial) * Math.PI * 2, j / n, part);
    }
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < radial; k++) {
        const a = base + j * (radial + 1) + k;
        const b = a + radial + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    base += (n + 1) * (radial + 1);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// ── keys ─────────────────────────────────────────────────────────────────

const SHARP = new Set([1, 3, 6, 8, 10]);

export function createOrgan(o: OrganOptions): Organ {
  const { u } = o;
  const group = new THREE.Group();
  group.name = 'organ';
  group.position.copy(o.position);
  group.rotation.y = o.yaw;
  group.scale.setScalar(o.scale);
  const body = new THREE.Group();
  group.add(body);

  const field: ShadowUniforms = { tShadow: { value: o.field.texture }, uShadowRect: { value: o.field.rect }, uShadowOn: { value: 1 } };
  const common = {
    uReveal: { value: 1 },
    uEdge: { value: new THREE.Color(1.25, 0.82, 0.92) },
    uGroundY: { value: o.position.y },
  };
  const disposables: { dispose(): void }[] = [];

  // ── case ──
  const caseGeo = buildCase();
  const uPiece = { value: new Array(PIECES).fill(1) as number[] };
  const caseMat = new THREE.ShaderMaterial({
    uniforms: { ...u, ...field, ...common, uPiece, uKinds: { value: KINDS.map((c) => new THREE.Color(c)) } },
    vertexShader: /* glsl */ `
      uniform float uPiece[${PIECES}];
      attribute float aKind;
      attribute float aPiece;
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec3 vLocal;
      varying float vKind;
      void main() {
        float p = uPiece[int(aPiece + 0.5)];
        vec3 q = position;
        // Assemble: a piece drops in from above with a soft settle; before
        // its turn it is collapsed (no fragments).
        float e = 1.0 - pow(1.0 - clamp(p, 0.0, 1.0), 3.0);
        q.y += (1.0 - e) * 0.55 + sin(e * 3.14159) * 0.03;
        if (p <= 0.001) q = vec3(0.0);
        vLocal = position;
        vKind = aKind;
        vec4 w = modelMatrix * vec4(q, 1.0);
        vWorld = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${SHADE_GLSL}
      uniform vec3 uKinds[${KINDS.length}];
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec3 vLocal;
      varying float vKind;
      void main() {
        if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        float edge = dissolve(vLocal);
        int k = int(vKind + 0.5);
        vec3 base = uKinds[0];
        for (int i = 0; i < ${KINDS.length}; i++) if (i == k) base = uKinds[i];
        // Wood grain: soft painted streaks along the boards.
        if (k == 0 || k == 1 || k == 5) {
          float g = oNoise(vec3(vLocal.x * 3.0, vLocal.y * 38.0, vLocal.z * 3.0)) * 0.6 + oNoise(vLocal * 9.0) * 0.4;
          base *= 0.86 + 0.26 * g;
        }
        float gloss = k == 2 ? 1.2 : k == 3 ? 0.5 : 0.7;
        vec3 col = organLight(base, normalize(vN), vWorld, gloss);
        col += uEdge * edge;
        gl_FragColor = vec4(mistFade(col, vWorld), 1.0);
      }
    `,
  });
  const caseMesh = new THREE.Mesh(caseGeo, caseMat);
  caseMesh.frustumCulled = false;
  body.add(caseMesh);
  disposables.push(caseGeo, caseMat);

  // ── pipes ──
  const pipes = facade();
  const P = pipes.length;
  const pipeGeo = pipeTemplate();
  const pipeData = new Float32Array(P * 4);
  pipes.forEach((p, i) => pipeData.set([p.x, p.z, p.h, p.r], i * 4));
  pipeGeo.setAttribute('aPipe', new THREE.InstancedBufferAttribute(pipeData, 4));
  const pipeDyn = new Float32Array(P * 2).fill(0);
  for (let i = 0; i < P; i++) pipeDyn[i * 2] = 1;
  const aPipeDyn = new THREE.InstancedBufferAttribute(pipeDyn, 2).setUsage(THREE.DynamicDrawUsage);
  pipeGeo.setAttribute('aDyn', aPipeDyn);
  pipeGeo.instanceCount = P;
  const CHEST_Y = 1.04;
  const pipeMat = new THREE.ShaderMaterial({
    uniforms: { ...u, ...field, ...common },
    vertexShader: /* glsl */ `
      attribute vec4 aPipe; // x, z, height, radius
      attribute vec2 aDyn;  // rise 0…1, glow 0…1
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec3 vLocal;
      varying vec2 vPipe; // along (m above the chest), angle
      varying float vGlow;
      varying float vR;
      varying float vH;
      void main() {
        float ang = position.x;
        float t = position.y;
        float part = position.z;
        float H = aPipe.z;
        float R = aPipe.w;
        float y = part < 0.5 ? t * ${FOOT.toFixed(3)} : ${FOOT.toFixed(3)} + t * (H - ${FOOT.toFixed(3)});
        float r = part < 0.5 ? mix(0.18 * R, R, t) : R;
        vec3 n = vec3(sin(ang), part < 0.5 ? 0.35 : 0.0, cos(ang));
        // Rise: slides up out of the chest (the part still inside it is cut
        // in the fragment shader).
        float rise = aDyn.x;
        float lift = (1.0 - rise) * (H + 0.02);
        vec3 q = vec3(aPipe.x + sin(ang) * r, ${CHEST_Y.toFixed(3)} + y - lift, aPipe.y + cos(ang) * r);
        if (rise <= 0.001) q = vec3(0.0);
        vLocal = q;
        vPipe = vec2(y, ang);
        vGlow = aDyn.y;
        vR = R;
        vH = H;
        vec4 w = modelMatrix * vec4(q, 1.0);
        vWorld = w.xyz;
        vN = normalize(mat3(modelMatrix) * normalize(n));
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${SHADE_GLSL}
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec3 vLocal;
      varying vec2 vPipe;
      varying float vGlow;
      varying float vR;
      varying float vH;
      void main() {
        if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        if (vLocal.y < ${CHEST_Y.toFixed(3)} - 0.002) discard; // still inside the chest
        float edge = dissolve(vLocal);
        vec3 n = normalize(vN);
        vec3 V = normalize(cameraPosition - vWorld);
        // Painted tin: a cool two-tone body and a bright vertical stripe.
        float f = max(dot(n, V), 0.0);
        vec3 tin = mix(srgb(vec3(0.42, 0.45, 0.50)), srgb(vec3(0.86, 0.87, 0.88)), smoothstep(0.15, 0.85, f));
        vec3 col = organLight(tin, n, vWorld, 0.9);
        col += uZenith * 0.12 * smoothstep(0.2, 0.8, n.y + f * 0.4);
        float stripe = smoothstep(0.9, 0.97, dot(n, normalize(V + vec3(0.25, 0.0, 0.0))));
        col += vec3(0.9, 0.92, 0.95) * stripe * 0.35;
        // Mouth (front, just above the foot): dark slot, lit upper lip, lower lip.
        float front = cos(vPipe.y);
        float m = smoothstep(0.8, 0.86, front);
        float a = vPipe.x - ${FOOT.toFixed(3)};
        float mouthH = vR * 1.25;
        float slot = m * step(0.0, a) * (1.0 - step(mouthH, a));
        float upLip = m * smoothstep(mouthH, mouthH + 0.004, a) * (1.0 - smoothstep(mouthH + 0.012, mouthH + 0.018, a));
        float loLip = m * (1.0 - smoothstep(-0.006, 0.0, a)) * smoothstep(-0.02, -0.012, a);
        col = mix(col, srgb(vec3(0.05, 0.04, 0.05)), slot * 0.92);
        col += srgb(vec3(0.95, 0.85, 0.6)) * (upLip * 0.6 + loLip * 0.35);
        // The note it answers: a warm glow at the mouth, a shimmer up the body.
        float glow = vGlow;
        col += vec3(2.2, 1.5, 1.0) * glow * slot * 2.0;
        // A warm halo round the mouth and a shimmer running up the body.
        float halo = exp(-abs(a - mouthH * 0.5) * 18.0) * smoothstep(0.3, 0.9, front);
        col += vec3(1.3, 0.9, 0.7) * glow * halo * 0.9;
        col += vec3(1.25, 0.95, 0.8) * glow * (0.55 + 0.3 * sin(vPipe.x * 30.0 - uTime * 8.0)) * smoothstep(-0.2, 0.8, front) * smoothstep(-0.05, 0.15, a);
        col += uEdge * edge;
        gl_FragColor = vec4(mistFade(col, vWorld), 1.0);
      }
    `,
  });
  const pipeMesh = new THREE.Mesh(pipeGeo, pipeMat);
  pipeMesh.frustumCulled = false;
  body.add(pipeMesh);
  disposables.push(pipeGeo, pipeMat);
  // Pipes by height, tallest first: low notes answer from the tall pipes.
  const byHeight = pipes.map((p, i) => [p.h, i] as const).sort((a, b) => b[0] - a[0] || Math.abs(pipes[a[1]].x) - Math.abs(pipes[b[1]].x)).map(([, i]) => i);
  // Assemble order: outward from the centre.
  const outward = pipes.map((p, i) => [Math.abs(p.x), i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  const rank = new Array<number>(P);
  outward.forEach((pi, k) => (rank[pi] = k));

  // ── keys ──
  const N_KEYS = MANUAL_HIGH - MANUAL_LOW + 1;
  const keyGeo = new THREE.InstancedBufferGeometry();
  {
    const b = new THREE.BoxGeometry(1, 1, 1);
    keyGeo.setAttribute('position', b.attributes.position);
    keyGeo.setAttribute('normal', b.attributes.normal);
    keyGeo.setIndex(b.index);
    disposables.push(b);
  }
  const keyData = new Float32Array(N_KEYS * 2);
  let nat = 0;
  const NAT_W = 0.0235;
  const naturals = 29;
  const x0 = -(naturals * NAT_W) / 2;
  for (let k = 0; k < N_KEYS; k++) {
    const sharp = SHARP.has((MANUAL_LOW + k) % 12);
    const x = sharp ? x0 + nat * NAT_W : x0 + (nat + 0.5) * NAT_W;
    keyData.set([x, sharp ? 1 : 0], k * 2);
    if (!sharp) nat++;
  }
  keyGeo.setAttribute('aKey', new THREE.InstancedBufferAttribute(keyData, 2));
  const keyPress = new Float32Array(N_KEYS);
  const aKeyPress = new THREE.InstancedBufferAttribute(keyPress, 1).setUsage(THREE.DynamicDrawUsage);
  keyGeo.setAttribute('aPress', aKeyPress);
  keyGeo.instanceCount = N_KEYS;
  const uKeys = { value: 1 };
  const keyMat = new THREE.ShaderMaterial({
    uniforms: { ...u, ...field, ...common, uKeys },
    vertexShader: /* glsl */ `
      uniform float uKeys;
      attribute vec2 aKey;   // x centre, sharp
      attribute float aPress;
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec3 vLocal;
      varying float vSharp;
      varying float vPress;
      void main() {
        bool sharp = aKey.y > 0.5;
        // Natural: 21 mm × 20 mm × 160 mm; sharp: 11 × 16 × 90, raised.
        vec3 size = sharp ? vec3(0.011, 0.016, 0.09) : vec3(0.021, 0.02, 0.16);
        vec3 centre = sharp ? vec3(aKey.x, 0.758, 0.085) : vec3(aKey.x, 0.740, 0.12);
        vec3 q = position * size;
        vec3 nn = normal;
        // Pivot at the back end: the front dips ~8 mm when pressed.
        float back = -size.z * 0.5;
        float ang = -aPress * (sharp ? 0.09 : 0.06);
        float c = cos(ang); float s = sin(ang);
        vec2 yz = vec2(q.y, q.z - back);
        q.yz = vec2(c * yz.x - s * yz.y, s * yz.x + c * yz.y) + vec2(0.0, back);
        nn.yz = vec2(c * nn.y - s * nn.z, s * nn.y + c * nn.z);
        q += centre;
        q.y += (1.0 - uKeys) * 0.55;
        if (uKeys <= 0.001) q = vec3(0.0);
        vLocal = q;
        vSharp = aKey.y;
        vPress = aPress;
        vec4 w = modelMatrix * vec4(q, 1.0);
        vWorld = w.xyz;
        vN = normalize(mat3(modelMatrix) * nn);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${SHADE_GLSL}
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec3 vLocal;
      varying float vSharp;
      varying float vPress;
      void main() {
        if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        float edge = dissolve(vLocal);
        vec3 base = vSharp > 0.5 ? srgb(vec3(0.07, 0.06, 0.055)) : srgb(vec3(0.93, 0.89, 0.78));
        vec3 col = organLight(base, normalize(vN), vWorld, vSharp > 0.5 ? 1.0 : 0.6);
        // A pressed key turns gold (the app's key overlay colours), so it
        // reads at the scene's distance.
        vec3 gold = vSharp > 0.5 ? srgb(vec3(0.79, 0.59, 0.25)) : srgb(vec3(0.95, 0.81, 0.54));
        col = mix(col, gold * (uAmbient * 0.6 + uSunColor * 0.75), vPress);
        col += uEdge * edge;
        gl_FragColor = vec4(mistFade(col, vWorld), 1.0);
      }
    `,
  });
  const keyMesh = new THREE.Mesh(keyGeo, keyMat);
  keyMesh.frustumCulled = false;
  body.add(keyMesh);
  disposables.push(keyGeo, keyMat);

  // ── the swirl (GPU petals: converge = bloom, disperse = departure) ──
  const SW = Math.max(60, Math.round(420 * o.particles));
  const swGeo = new THREE.InstancedBufferGeometry();
  swGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  swGeo.setIndex([0, 1, 2, 0, 2, 3]);
  {
    let s = 911;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const tgt = new Float32Array(SW * 3);
    const seed = new Float32Array(SW * 4);
    for (let i = 0; i < SW; i++) {
      // Targets on the organ's silhouette: mostly the case and the pipes.
      const top = rnd() < 0.4;
      tgt.set([(rnd() - 0.5) * (top ? 1.1 : 1.3), top ? 1.05 + rnd() * 0.9 : rnd() * 1.05, -0.05 - rnd() * 0.6], i * 3);
      seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
    }
    swGeo.setAttribute('aTarget', new THREE.InstancedBufferAttribute(tgt, 3));
    swGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  }
  swGeo.instanceCount = SW;
  const uSwirl = { value: 0 };
  const uSwMode = { value: 0 };
  const uOrg = { value: new THREE.Matrix4() };
  const uCentre = { value: new THREE.Vector3() };
  const swMat = new THREE.ShaderMaterial({
    uniforms: { ...u, uSwirl, uSwMode, uOrg, uCentre, uSize: { value: 0.055 }, uColA: { value: new THREE.Color('#f4bfd1') }, uColB: { value: new THREE.Color('#fff1f5') } },
    vertexShader: /* glsl */ `
      ${KIT_GLSL}
      uniform float uSwirl;
      uniform float uSwMode;
      uniform mat4 uOrg;
      uniform vec3 uCentre;
      uniform float uSize;
      attribute vec3 aTarget;
      attribute vec4 aSeed;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNrm;
      varying float vTone;
      varying float vFade;
      void main() {
        vUv = position.xy;
        vTone = aSeed.w;
        float delay = aSeed.x * 0.42;
        float s = clamp((uSwirl - delay) / 0.58, 0.0, 1.0);
        vec3 tgt = (uOrg * vec4(aTarget, 1.0)).xyz;
        vec2 rel = tgt.xz - uCentre.xz;
        float rt = length(rel);
        float at = atan(rel.y, rel.x);
        vec3 p;
        float fade;
        if (uSwMode < 0.5) {
          // Converge: a spiral from all round the tree's shade into the case.
          float e = s * s * (3.0 - 2.0 * s);
          float r0 = 2.0 + 2.2 * aSeed.y;
          float a0 = aSeed.z * 6.2832;
          float r = mix(r0, rt, e);
          float a = at + (1.0 - e) * (2.6 + a0);
          float y = mix(uCentre.y + 0.3 + 2.8 * aSeed.w, tgt.y, e);
          p = vec3(uCentre.x + cos(a) * r, y, uCentre.z + sin(a) * r);
          fade = smoothstep(0.0, 0.12, s) * (1.0 - smoothstep(0.86, 1.0, s));
        } else {
          // Disperse: off the case, spiralling up and away downwind.
          float e = s;
          float r = rt + e * e * 2.6 * (0.5 + aSeed.y);
          float a = at + e * 2.2 * (aSeed.z - 0.3);
          p = vec3(uCentre.x + cos(a) * r, tgt.y + e * (0.8 + 2.2 * aSeed.w), uCentre.z + sin(a) * r);
          p.xz += uWindDir * e * e * 2.4;
          fade = smoothstep(0.0, 0.05, s) * (1.0 - smoothstep(0.55, 1.0, s));
        }
        vFade = fade;
        if (fade < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float rot = aSeed.y * 6.2832 + uTime * (1.5 + 2.0 * aSeed.z);
        vec3 ax = normalize(vec3(sin(rot), 0.5, cos(rot * 0.7)));
        vec3 bx = normalize(cross(ax, vec3(0.3, 1.0, 0.2)));
        vec3 cx = cross(ax, bx);
        vNrm = ax;
        vWorld = p + (bx * position.x + cx * position.y * 0.72) * uSize * fade;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${KIT_GLSL}
      uniform vec3 uColA;
      uniform vec3 uColB;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNrm;
      varying float vTone;
      varying float vFade;
      void main() {
        vec2 q = vUv;
        float notch = smoothstep(0.25, 0.0, abs(q.y)) * smoothstep(0.55, 1.0, q.x) * 0.45;
        if (1.0 - length(q * vec2(0.85, 1.0)) - notch < 0.0 || vFade < 0.01) discard;
        if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec3 base = mix(uColA, uColB, vTone);
        float ndl = abs(dot(normalize(vNrm), uSunDir));
        vec3 col = base * (uAmbient * 0.6 + uSunColor * (0.45 + 0.5 * ndl));
        gl_FragColor = vec4(mistFade(col, vWorld), 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
  const swirl = new THREE.Mesh(swGeo, swMat);
  swirl.frustumCulled = false;
  swirl.visible = false;
  disposables.push(swGeo, swMat);

  // ── a soft light at each sounding pipe's mouth (bloom catches it) ──
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,214,190,0.55)');
    grad.addColorStop(1, 'rgba(255,190,200,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(g.canvas);
  })();
  disposables.push(glowTex);
  const glowSprites = pipes.map((p) => {
    const m = new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(1.8, 1.35, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 });
    disposables.push(m);
    const sp = new THREE.Sprite(m);
    sp.position.set(p.x, CHEST_Y + FOOT + p.r * 0.6, p.z + p.r + 0.02);
    sp.scale.setScalar(0.11);
    sp.visible = false;
    sp.renderOrder = 52;
    body.add(sp);
    return sp;
  });

  // ── breaths and puffs (CPU petals) ──
  const flutter = createFlutter(u, { count: Math.max(40, Math.round(260 * o.particles)), colorA: '#f6c6d6', colorB: '#fff2f5', size: 0.05, petal: true, groundAt: o.heightAt });
  disposables.push(flutter);
  const fx = new THREE.Group();
  fx.add(swirl, flutter.mesh);

  // ── state ──
  const glow = new Float32Array(P);
  const pipeHeld = new Int32Array(P);
  const keyHeld = new Int32Array(N_KEYS);
  const keyTarget = new Float32Array(N_KEYS);
  const breathAt = new Float32Array(P).fill(0);
  let presence = 0;
  let clock = 0;
  const v = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const keyOf = (midi: number) => {
    let n = Math.round(midi);
    while (n < MANUAL_LOW) n += 12;
    while (n > MANUAL_HIGH) n -= 12;
    return n - MANUAL_LOW;
  };
  const pipeOf = (k: number) => byHeight[Math.round((k / (N_KEYS - 1)) * (P - 1))];
  const mouthWorld = (pi: number, out: THREE.Vector3) => {
    const p = pipes[pi];
    out.set(p.x, CHEST_Y + FOOT + p.r * 0.4, p.z + p.r + 0.01);
    return body.localToWorld(out);
  };
  const breathe = (pi: number, n: number) => {
    mouthWorld(pi, v);
    fwd.set(0, 0, 1).applyQuaternion(group.quaternion);
    for (let k = 0; k < n; k++) {
      // Out of the mouth, forward and up (clear of the façade).
      vel.copy(fwd).multiplyScalar(0.6 + Math.random() * 0.5).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.45 + Math.random() * 0.5, (Math.random() - 0.5) * 0.3));
      flutter.emit(v, vel, 1.8 + Math.random() * 1.4);
    }
  };
  const puff = (centre: THREE.Vector3, n: number, radius: number) => {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      v.set(centre.x + Math.cos(a) * radius, centre.y + 0.08, centre.z + Math.sin(a) * radius);
      vel.set(Math.cos(a) * (0.6 + Math.random() * 0.8), 0.5 + Math.random() * 0.9, Math.sin(a) * (0.6 + Math.random() * 0.8));
      flutter.emit(v, vel, 1.5 + Math.random() * 1.5);
    }
  };
  const nP = (n: number) => Math.max(1, Math.round(n * o.particles));
  let lastMove: OrganMoveId | null = null;
  let lastArrive = 0;
  const groundCentre = new THREE.Vector3();

  const organ: Organ = {
    group,
    fx,
    setState(move, arrive, depart, t) {
      clock = t;
      const a = THREE.MathUtils.clamp(arrive, 0, 1);
      const d = THREE.MathUtils.clamp(depart, 0, 1);
      // Reset to the rest pose, then apply the move.
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      for (let i = 0; i < PIECES; i++) uPiece.value[i] = 1;
      uKeys.value = 1;
      let reveal = 1;
      let rise = 1;
      swirl.visible = false;
      groundCentre.copy(group.position);
      const crossed = (x: number) => lastMove === move && lastArrive < x && a >= x;
      if (move === 'bloom') {
        // A swirl of petals condenses; the organ blooms out of it.
        reveal = THREE.MathUtils.lerp(-0.05, 1.05, THREE.MathUtils.smoothstep(a, 0.42, 1));
        if (a > 0 && a < 1 && d <= 0) {
          swirl.visible = true;
          uSwMode.value = 0;
          uSwirl.value = Math.min(1, a * 1.05);
        }
      } else if (move === 'rise') {
        // Out of the grass (it parts), a slight tilt that rights itself.
        const e = a < 1 ? 1 - Math.pow(1 - a, 3) : 1;
        body.position.y = -(1 - e) * 2.45 + Math.sin(a * Math.PI) * 0.06;
        body.rotation.z = Math.sin(a * Math.PI * 2.0) * 0.03 * (1 - a);
        if (crossed(0.08)) puff(groundCentre, nP(26), 0.7);
        if (crossed(0.97)) puff(groundCentre, nP(14), 0.8);
      } else if (move === 'assemble') {
        // The case piece by piece, then the pipes one by one from the centre.
        for (let i = 0; i < PIECES; i++) {
          const s0 = i * 0.07;
          uPiece.value[i] = THREE.MathUtils.clamp((a - s0) / 0.2, 0, 1);
        }
        uKeys.value = uPiece.value[3];
        rise = -1;
        for (let i = 0; i < P; i++) {
          const s0 = 0.6 + (rank[i] / P) * 0.3;
          pipeDyn[i * 2] = THREE.MathUtils.clamp((a - s0) / 0.12, 0, 1);
        }
        if (crossed(0.05)) puff(groundCentre, nP(10), 0.6);
      } else {
        // Descend: floats down from the canopy like a petal, a soft landing.
        const e = 1 - Math.pow(1 - a, 2.2);
        const sway = (1 - a) * (1 - a);
        body.position.set(Math.sin(a * Math.PI * 3.0) * 0.55 * sway, (1 - e) * 5.2, Math.cos(a * Math.PI * 2.4) * 0.3 * sway);
        body.rotation.z = Math.sin(a * Math.PI * 3.0 + 0.6) * 0.16 * sway;
        body.rotation.x = Math.sin(a * Math.PI * 2.4) * 0.07 * sway;
        body.rotation.y = (1 - e) * 0.9;
        if (crossed(0.985)) puff(groundCentre, nP(30), 0.75);
      }
      if (rise >= 0) for (let i = 0; i < P; i++) pipeDyn[i * 2] = rise;
      // Departure: dissolves into petals that spiral away.
      if (d > 0) {
        reveal = Math.min(reveal, 1.04 - THREE.MathUtils.smoothstep(d, 0.0, 0.85) * 1.1);
        body.position.y += d * 0.12;
        swirl.visible = d < 1;
        uSwMode.value = 1;
        uSwirl.value = d;
      }
      common.uReveal.value = reveal;
      const shown = a > 0 && reveal > -0.01 && d < 1;
      body.visible = shown;
      presence = shown ? (move === 'rise' ? THREE.MathUtils.smoothstep(a, 0.05, 0.6) : move === 'descend' ? THREE.MathUtils.smoothstep(a, 0.85, 1) : Math.min(1, a * 1.5)) * (1 - THREE.MathUtils.smoothstep(d, 0, 0.7)) : 0;
      if (move === 'bloom') presence *= THREE.MathUtils.clamp(reveal, 0, 1);
      group.updateMatrixWorld(true);
      uOrg.value.copy(group.matrixWorld);
      uCentre.value.setFromMatrixPosition(group.matrixWorld);
      uCentre.value.y += 0.9 * o.scale;
      aPipeDyn.needsUpdate = true;
      lastMove = move;
      lastArrive = a;
    },
    noteOn(midi) {
      const k = keyOf(midi);
      keyHeld[k]++;
      keyTarget[k] = 1;
      const pi = pipeOf(k);
      pipeHeld[pi]++;
      if (body.visible) breathe(pi, nP(4));
      breathAt[pi] = clock;
    },
    noteOff(midi) {
      const k = keyOf(midi);
      if (keyHeld[k] > 0 && --keyHeld[k] === 0) keyTarget[k] = 0;
      const pi = pipeOf(k);
      if (pipeHeld[pi] > 0) pipeHeld[pi]--;
    },
    allOff() {
      keyHeld.fill(0);
      keyTarget.fill(0);
      pipeHeld.fill(0);
    },
    update(t, dt) {
      clock = t;
      // Keys: quick press, softer lift; pipes: a gentle swell and fade.
      for (let k = 0; k < N_KEYS; k++) {
        const target = keyTarget[k];
        keyPress[k] += (target - keyPress[k]) * Math.min(1, dt * (target > keyPress[k] ? 30 : 14));
      }
      aKeyPress.needsUpdate = true;
      for (let i = 0; i < P; i++) {
        const on = pipeHeld[i] > 0 ? 1 : 0;
        glow[i] += (on - glow[i]) * Math.min(1, dt * (on ? 12 : 3));
        pipeDyn[i * 2 + 1] = glow[i];
        const sp = glowSprites[i];
        sp.visible = glow[i] > 0.01 && pipeDyn[i * 2] > 0.5;
        (sp.material as THREE.SpriteMaterial).opacity = glow[i] * (0.75 + 0.25 * Math.sin(t * 7 + i));
        // A held note keeps breathing petals now and then.
        if (on && body.visible && t - breathAt[i] > 0.45) {
          breathAt[i] = t;
          breathe(i, nP(2));
        }
      }
      aPipeDyn.needsUpdate = true;
      flutter.update(t, dt);
    },
    footprint() {
      const pts = [
        [-0.62, -0.35, 0.62, -0.35, 0.45],
        [-0.4, 0.66, 0.4, 0.66, 0.2],
      ];
      return pts.map(([ax, az, bx, bz, r]) => {
        const a = group.localToWorld(new THREE.Vector3(ax, 0, az));
        const b = group.localToWorld(new THREE.Vector3(bx, 0, bz));
        return { a: new THREE.Vector2(a.x, a.z), b: new THREE.Vector2(b.x, b.z), r: r * o.scale };
      });
    },
    presence: () => presence,
    dispose() {
      for (const d of disposables) d.dispose();
      group.removeFromParent();
      fx.removeFromParent();
    },
  };
  return organ;
}

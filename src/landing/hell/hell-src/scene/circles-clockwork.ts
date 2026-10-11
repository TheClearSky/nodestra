// COPIED from .claude/pages/ad/experiments/hell-src/scene/circles-clockwork.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Circles option "clockwork": "The Summoning" — the whole sky as a magic
 * construction drawn by an unseen hand, with the living seal at its heart.
 *
 * Owner, 2026-10-11: "the whole sky needs to do an intertwined magic circles
 * dance with the magic circles rotating like clockwork with lines not
 * perfect … hand drawn … varying line width and small breaks", then: "0
 * perfect circles, all ovals … really bad animations … needs some half
 * circles too, some circles need to be always fully drawn and powerful,
 * smaller ones. Some larger circles need to be mostly drawn in breaks and
 * appear as a reason from drawing small circles, there needs to be a
 * hierarchy, there needs to be a story … i loved the living seal sequence,
 * use it somewhere for the main circle in the sky".
 *
 * THE IDEA (compass-and-straightedge construction): big figures are never
 * drawn directly. Points are set down first; compass arcs (half circles)
 * swing from them; where arcs cross, new points are found; the great
 * circles are only the CONSEQUENCE, drawn through the found points — so they
 * are faint, broken and sketchy, while the points are bold.
 *
 * HIERARCHY (brightest → faintest):
 *   1. the main seal — the hell-02 living seal (scene/circles-life.ts)
 *   2. seven kindled seals: small, always fully drawn, bold, never broken
 *   3. construction: half circles, the great ring through the seals, the
 *      heptagram, compass arcs, the outer ring through their crossings,
 *      spokes — thin, broken
 *   4. far rings and far arcs across the whole sky: faint, mostly gaps
 *
 * THE STORY (one loop, PERIOD s; times in the TL table below):
 *   Silence    empty sky.
 *   Kindling   the seven seals ignite one by one round the point above the
 *              spire: a pen stroke round each rim, then a white flash.
 *   Construction  each seal swings a half circle as it lights; the great
 *              ring joins seal to seal in broken strokes; the heptagram is
 *              drawn; compass arcs cross outside the ring and a mark sparks
 *              at each crossing; the outer ring is drawn through the marks
 *              (mostly breaks, ticked); dashed spokes reach for the centre;
 *              the far rings fade in across the sky.
 *   The Seal   the living seal draws itself on in the centre and ignites
 *              white-hot — every seal flares with it; each of its pulses
 *              sends beads of light out along the spokes and the seals
 *              flare as they arrive. From the ignition the mechanism turns
 *              like clockwork: the ring of seals in eased steps, the outer
 *              ring the other way, each seal's star spinning. Energy runs
 *              along two long arcs to the sky's edges, where two echoes of
 *              three seals kindle.
 *   Collapse   the main seal flickers and vanishes (burn, shatter or
 *              un-draw — a different one each loop); everything retracts in
 *              the reverse order it was drawn; the seven seals go out last,
 *              one by one, each with a final flash.
 *
 * Everything is drawn on one sky dome behind everything (part of the sky,
 * far away); circles are true circles on the sky sphere (no squash). Strokes
 * are hand-drawn: pressure width, small breaks, a slight static wobble.
 */

import * as THREE from 'three';
import { createLifeSeal } from './circles-life';
import type { ScenePalette } from './palette';

const D2R = Math.PI / 180;
const TAU = Math.PI * 2;
const NA = 13; // anchor seals: 7 main + 2×3 echoes
const NARC = 44;
const NSEG = 26;
const NSP = 20;

// ── layout (degrees on the sky) ──────────────────────────────────────────
/** The construction's centre: straight ahead, above the castle (spire tip ≈ 27°). */
const POLE = { az: 0, el: 17 };
/** The great ring through the seven seals. */
const RING = 12;
const SEAL_R = 1.55;
/** The main living seal's angular radius. */
const MAIN_R = 8.2;
/** The two echoes: centre, radius, seal size. */
const ECHOES = [
  { az: -29, el: 13, r: 4.2, seal: 0.9 },
  { az: 29, el: 20, r: 3.8, seal: 0.85 },
];
/** Far rings: [centre az, el, radius°, rotation speed rad/s]. */
const FAR: [number, number, number, number][] = [
  [0, 18, 31, 0.006],
  [0, 18, 44, -0.004],
  [-34, 52, 36, 0.005],
  [38, 46, 30, -0.006],
];
/** Far great arcs: [start az, el, end az, el]. */
const FAR_ARCS: [number, number, number, number][] = [
  [-75, 6, 20, 58],
  [70, 4, -30, 60],
  [-60, 40, 75, 30],
];

// ── timeline (seconds into the loop) ─────────────────────────────────────
const TL = {
  kindle0: 1.5, kindleStep: 0.8, kindleDur: 0.55,
  half0: 2.1, halfDur: 0.9,
  ringDur: 0.8,
  star0: 8.0, starStep: 0.35, starDur: 1.2,
  compass0: 9.4, compassStep: 0.3, compassDur: 0.8,
  outer0: 10.9, outerStep: 0.28, outerDur: 0.9,
  spokes0: 11.8, spokesDur: 1.0,
  far0: 11.5, farDur: 4.5,
  main0: 12.5, // living seal restart: its draw-on, ignition at +4.5, pulses every 4 s from +6
  ignite: 17.0,
  links0: 19.0, linksDur: 2.0,
  echo0: 21.0,
  turnEnd: 35.0,
  collapse: 35.0,
  out0: 39.2, outStep: 0.45,
  period: 46,
};
const PERIOD = TL.period;
const MAIN_DIST = 1500;

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
#define NA ${NA}
#define NARC ${NARC}
#define NSEG ${NSEG}
#define NSP ${NSP}
#define PI 3.14159265
#define TAU 6.2831853
#define R2D 57.29578

uniform vec3 uAc[NA];
uniform vec4 uAp[NA];   // radius°, draw 0..1, flash, strength
uniform vec4 uAq[NA];   // spin, seed, cos of reach, -
uniform vec3 uArcC[NARC]; uniform vec3 uArcU[NARC];
uniform vec4 uArcP[NARC]; // radius°, span rad, reveal 0..1, width°
uniform vec4 uArcQ[NARC]; // broken 0..1, ticks, strength, phase°
uniform vec2 uArcB[NARC]; // cos bounds of the stroke's band: (cos outer, cos inner)
uniform vec3 uSegA[NSEG]; uniform vec3 uSegN[NSEG];
uniform vec4 uSegP[NSEG]; // length°, reveal 0..1, width°, broken
uniform vec4 uSegQ[NSEG]; // strength, bead 0..1 (<0 none), style (0 solid, 1 dashed, 2 moons), seed
uniform vec4 uSegM[NSEG]; // midpoint direction, cos of (half length + margin)
uniform vec4 uSp[NSP];    // direction, strength
uniform vec3 uCol;
uniform float uTime;
// Live counts. The loops run to these (not to the array sizes): a loop
// with a constant bound is fully unrolled by the D3D compiler, and the
// unrolled program took so long to compile that the GPU watchdog killed
// the context (2026-10-11).
uniform int uNArc; uniform int uNSeg; uniform int uNA; uniform int uNSp;
// 1 = the "sketched" look: big circles scratchy and noisy, almost unbroken.
uniform float uSketch;
varying vec3 vWorld;

float h11(float x) { return fract(sin(x * 127.1 + 1.7) * 43758.5453); }
float n11(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h11(i), h11(i + 1.0), f); }

vec3 ink;   // x: line core, y: red halo, z: white heat
float pix;  // one pixel, in degrees

/** A hand-drawn stroke: d = distance from the ideal line (°), s = along it (°). */
void stroke(float d, float s, float w, float broken, float seed, float k) {
  if (k <= 0.001) return;
  d += (n11(s * 0.09 + seed * 3.7) - 0.5) * w * 1.2;   // never perfect: a slow wobble
  float press = 0.45 + 0.9 * n11(s * 0.5 + seed * 13.1);
  float gap = n11(s * 0.3 + seed * 7.3 + 40.0);
  float thr = mix(0.88, 0.36, broken);
  float brk = smoothstep(thr, thr - 0.05, gap);
  float ww = w * press * brk;
  float a = abs(d);
  float core = (1.0 - smoothstep(ww * 0.5 - pix * 0.5, ww * 0.5 + pix, a)) * min(1.0, ww / pix + 0.15);
  ink.x += core * k;
  ink.y += exp(-a / max(w * 2.5, pix * 2.0)) * brk * k * 0.2;
}

/**
 * The sketched look for the big circles: a fast jitter on top of the slow
 * wobble, a second loose pass beside the first (a pencil going round twice),
 * and almost no breaks.
 */
void sketchy(float d, float s, float w, float broken, float seed, float k) {
  float jit = (n11(s * 2.6 + seed * 5.1) - 0.5) * w * 0.8 + (n11(s * 0.06 + seed) - 0.5) * w * 1.4;
  stroke(d + jit, s, w * 1.1, broken * 0.12, seed, k);
  float jit2 = (n11(s * 3.1 + seed * 9.7) - 0.5) * w * 0.9 - w * 1.1 * (n11(s * 0.15 + seed * 2.0) - 0.3);
  stroke(d + jit2, s * 1.3, w * 0.65, broken * 0.25, seed + 17.0, k * 0.55);
}

/** A bold, unbroken stroke (the kindled seals). */
void solid(float d, float s, float w, float seed, float k) {
  float press = 0.8 + 0.35 * n11(s * 0.6 + seed);
  float ww = w * press;
  float a = abs(d);
  ink.x += (1.0 - smoothstep(ww * 0.5 - pix * 0.5, ww * 0.5 + pix, a)) * min(1.0, ww / pix + 0.2) * k;
  ink.y += exp(-a / max(w * 2.0, pix * 2.0)) * k * 0.15;
}

float seg2(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

void anchorSeal(int i, vec3 d) {
  vec4 P = uAp[i];
  if (P.w <= 0.001 && P.z <= 0.001) return;
  vec3 c = uAc[i];
  float R = P.x;
  float cd = dot(d, c);
  if (cd < uAq[i].z) return;
  float rho = acos(clamp(cd, -1.0, 1.0)) * R2D;
  vec3 u = normalize(cross(vec3(0.0, 1.0, 0.0), c));
  vec3 v = cross(c, u);
  float a = atan(dot(d, v), dot(d, u));
  float spin = uAq[i].x;
  float seed = uAq[i].y;
  float k = P.w;
  // The ignition: white-hot, a wide red bloom.
  ink.z += P.z * exp(-rho / (R * 0.55)) * 1.6;
  ink.y += P.z * exp(-rho / (R * 0.9)) * 0.5;
  float draw = P.y;
  float ang = fract((a - PI * 0.5) / TAU + 1.0);      // the pen starts at the top
  float pen = step(ang, draw);
  // Rim: bold, fully drawn.
  solid(rho - R, a * R, 0.15, seed, k * pen);
  // Inner ring + ticks turning with the seal.
  float inner = clamp(draw * 1.6 - 0.6, 0.0, 1.0);
  solid(rho - R * 0.76, a * R, 0.07, seed + 2.0, k * inner);
  float as = a - spin;
  float tk = abs(fract(as / TAU * 16.0 + 0.5) - 0.5) * TAU / 16.0 * rho;
  float band = step(R * 0.8, rho) * step(rho, R * 0.94);
  solid(tk, rho, 0.06, seed + 4.0, k * inner * band);
  // Pentagram, turning the other way.
  vec2 q = vec2(cos(a), sin(a)) * rho;
  float pd = 1e9;
  for (int j = 0; j < 5; j++) {
    float a0 = -spin * 1.5 + TAU * float(j) / 5.0 + PI * 0.5;
    float a1 = a0 + TAU * 2.0 / 5.0;
    pd = min(pd, seg2(q, vec2(cos(a0), sin(a0)) * R * 0.62, vec2(cos(a1), sin(a1)) * R * 0.62));
  }
  solid(pd, a * R, 0.055, seed + 6.0, k * inner);
  // Heart.
  solid(rho, 0.0, R * 0.22, seed + 8.0, k * inner);
}

void arcStroke(int i, vec3 d) {
  vec4 P = uArcP[i];
  vec4 Q = uArcQ[i];
  if (Q.z <= 0.001 || P.z <= 0.0) return;
  vec3 c = uArcC[i];
  // Cheap reject first (one dot): only pixels in the ring's band go on.
  float cd = dot(d, c);
  if (cd < uArcB[i].x || cd > uArcB[i].y) return;
  float rho = acos(clamp(cd, -1.0, 1.0)) * R2D;
  float dist = rho - P.x;
  vec3 u = uArcU[i];
  vec3 v = cross(c, u);
  float rel = mod(atan(dot(d, v), dot(d, u)), TAU);
  float end = P.y * P.z;
  if (rel > end) return;
  float s = rel * P.x + Q.w;                            // along, °
  float seed = float(i) * 1.73;
  if (uSketch > 0.5 && P.x > 1.5) sketchy(dist, s, P.w, Q.x, seed, Q.z);
  else stroke(dist, s, P.w, Q.x, seed, Q.z);
  if (Q.y > 0.0) {
    float n = Q.y;
    float relT = rel + Q.w / max(P.x, 1e-3);
    float dt = abs(fract(relT / TAU * n + 0.5) - 0.5) * TAU / n * rho;
    float tb = step(0.0, dist) * step(dist, P.x * 0.03);
    stroke(dt, s * 3.0, P.w * 0.8, Q.x, seed + 2.0, Q.z * tb * 0.8);
  }
  // The pen tip while it draws.
  if (P.z < 1.0) ink.z += exp(-length(vec2((end - rel) * P.x, dist)) / 0.22) * Q.z * 0.7;
}

void segStroke(int i, vec3 d) {
  vec4 P = uSegP[i];
  vec4 Q = uSegQ[i];
  if (Q.x <= 0.001 || P.y <= 0.0) return;
  vec3 n = uSegN[i];
  float dn = dot(d, n);
  if (abs(dn) > 0.056) return;                       // > 3.2° off the line
  if (dot(d, uSegM[i].xyz) < uSegM[i].w) return;     // beyond its ends
  float dist = asin(dn) * R2D;
  vec3 A = uSegA[i];
  vec3 t = cross(n, A);
  float s = atan(dot(d, t), dot(d, A)) * R2D;
  float end = P.x * P.y;
  if (s < -0.5 || s > end + 0.5) return;
  float inside = step(0.0, s) * step(s, end);
  float dash = Q.z > 0.5 && Q.z < 1.5 ? step(fract(s / 1.3), 0.55) : 1.0;
  stroke(dist, s, P.z, P.w, Q.w, Q.x * dash * inside);
  if (P.y < 1.0) ink.z += exp(-length(vec2(end - s, dist)) / 0.22) * Q.x * 0.7;
  if (Q.y >= 0.0) {
    float l = length(vec2(s - Q.y * P.x, dist));
    ink.z += exp(-l / 0.3) * Q.x * 1.1;
    ink.y += exp(-l / 1.1) * Q.x * 0.4;
  }
  if (Q.z > 1.5) {
    // Three crescent moons riding the arc, waxing.
    for (int m = 0; m < 3; m++) {
      float at = P.x * (0.42 + float(m) * 0.06);
      vec2 p = vec2(s - at, dist + 1.9);
      if (length(p) > 1.5 || at > end) continue;
      float disc = 1.0 - smoothstep(0.75 - pix, 0.75 + pix, length(p));
      float off = mix(0.3, 1.0, float(m) / 2.0);
      float bite = 1.0 - smoothstep(0.75 - pix, 0.75 + pix, length(p - vec2(-off, 0.2)));
      ink.x += disc * (1.0 - bite) * Q.x * 1.2;
    }
  }
}

void main() {
  vec3 d = normalize(vWorld - cameraPosition);
  float elev = asin(clamp(d.y, -1.0, 1.0)) * R2D;
  if (elev < -1.0) discard;
  pix = max(fwidth(elev), 0.02);
  ink = vec3(0.0);
  for (int i = 0; i < uNArc; i++) arcStroke(i, d);
  for (int i = 0; i < uNSeg; i++) segStroke(i, d);
  for (int i = 0; i < uNA; i++) anchorSeal(i, d);
  // Four-point sparkles (crossings found, seals igniting).
  for (int i = 0; i < uNSp; i++) {
    vec4 S = uSp[i];
    if (S.w <= 0.001) continue;
    if (dot(d, S.xyz) < 0.9975) continue;
    vec3 t1 = normalize(cross(S.xyz, vec3(0.0, 1.0, 0.0)));
    vec3 t2 = cross(t1, S.xyz);
    vec2 o = vec2(dot(d, t1), dot(d, t2)) * R2D;
    float len = 0.6 + 1.6 * S.w;
    float rays = exp(-abs(o.x) / (pix * 0.9)) * exp(-abs(o.y) / len) + exp(-abs(o.y) / (pix * 0.9)) * exp(-abs(o.x) / len);
    ink.z += (rays * 0.8 + exp(-length(o) / 0.25)) * S.w;
    ink.y += exp(-length(o) / 0.9) * S.w * 0.4;
  }
  float fade = smoothstep(-1.0, 6.0, elev);
  vec3 col = uCol * (min(ink.x, 1.8) * 1.25 + ink.y * 0.9) + (vec3(1.0, 0.82, 0.72) * 0.9 + uCol * 0.6) * min(ink.z, 3.0);
  gl_FragColor = vec4(col * fade, 1.0);
}
`;

export type Clockwork = {
  group: THREE.Group;
  restart(): void;
  /** The sketched look: big circles noisy and scratchy, almost unbroken. */
  setSketch(on: boolean): void;
  update(t: number, dt: number): void;
  recolour(p: ScenePalette): void;
  params(): Record<string, string | number | boolean>;
};

// ── small helpers ─────────────────────────────────────────────────────────
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};
/** 0→1 over [t0, t0 + dur]. */
const ramp = (t: number, t0: number, dur: number) => ease((t - t0) / dur);
/** Drawn in over [t0, t0+dur], un-drawn over [t1, t1+dur2]. */
const life = (t: number, t0: number, dur: number, t1: number, dur2: number) => ramp(t, t0, dur) * (1 - ramp(t, t1, dur2));
/** Clockwork: eased steps of `step` radians every `period` seconds from t0 (held after t1). */
const clock = (t: number, t0: number, t1: number, period: number, step: number) => {
  const x = (Math.min(t, t1) - t0) / period;
  if (x <= 0) return 0;
  return (Math.floor(x) + ease(Math.min(1, (x - Math.floor(x)) / 0.35))) * step;
};

function dirAt(az: number, el: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(az * D2R) * Math.cos(el * D2R), Math.sin(el * D2R), -Math.cos(az * D2R) * Math.cos(el * D2R));
}
/** A tangent frame at direction c: right, up. */
function frame(c: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const right = new THREE.Vector3(0, 1, 0).cross(c).normalize().negate();
  const up = new THREE.Vector3().crossVectors(right, c);
  return [right, up];
}
/** The point `dist`° from c toward angle θ in c's (right, up) frame. */
function around(c: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, theta: number, dist: number): THREE.Vector3 {
  const r = dist * D2R;
  return c.clone().multiplyScalar(Math.cos(r)).addScaledVector(right, Math.sin(r) * Math.cos(theta)).addScaledVector(up, Math.sin(r) * Math.sin(theta)).normalize();
}
const angleBetween = (a: THREE.Vector3, b: THREE.Vector3) => Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) / D2R;
/** The unit tangent at a pointing toward b. */
const toward = (a: THREE.Vector3, b: THREE.Vector3) => b.clone().addScaledVector(a, -a.dot(b)).normalize();

export function createClockwork(renderer: THREE.WebGLRenderer, env: Record<string, { value: unknown }>, pixelRatio: number, eye: THREE.Vector3): Clockwork {
  const group = new THREE.Group();
  group.name = 'circles-clockwork';
  const v3 = (n: number) => Array.from({ length: n }, () => new THREE.Vector3());
  const v4 = (n: number) => Array.from({ length: n }, () => new THREE.Vector4());
  const u = {
    uAc: { value: v3(NA) }, uAp: { value: v4(NA) }, uAq: { value: v4(NA) },
    uArcC: { value: v3(NARC) }, uArcU: { value: v3(NARC) }, uArcP: { value: v4(NARC) }, uArcQ: { value: v4(NARC) },
    uArcB: { value: Array.from({ length: NARC }, () => new THREE.Vector2()) },
    uSegA: { value: v3(NSEG) }, uSegN: { value: v3(NSEG) }, uSegP: { value: v4(NSEG) }, uSegQ: { value: v4(NSEG) },
    uSegM: { value: v4(NSEG) },
    uSp: { value: v4(NSP) },
    uCol: { value: new THREE.Color() },
    uTime: { value: 0 },
    uNArc: { value: 0 }, uNSeg: { value: 0 }, uNA: { value: 0 }, uNSp: { value: 0 },
    uSketch: { value: 0 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(5000, 64, 32),
    new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    }),
  );
  dome.frustumCulled = false;
  dome.renderOrder = -9; // right after the sky, before every cloud layer
  group.add(dome);

  // ── the main seal: the living seal (hell-02 lifecycle) at the centre ──
  const P = dirAt(POLE.az, POLE.el);
  const [PR, PU] = frame(P);
  const main = createLifeSeal(renderer, env, pixelRatio, [[eye.clone().addScaledVector(P, MAIN_DIST), MAIN_DIST * Math.tan(MAIN_R * D2R)]], eye, 0);
  group.add(main.group);

  // ── per-frame writers ──
  let na = 0, nArc = 0, nSeg = 0, nSp = 0;
  function anchor(c: THREE.Vector3, R: number, draw: number, flash: number, strength: number, spin: number, seed: number) {
    if (na >= NA) return;
    u.uAc.value[na].copy(c);
    u.uAp.value[na].set(R, draw, flash, strength);
    u.uAq.value[na].set(spin, seed, Math.cos(Math.min(170, R * (1.3 + 3 * flash) + 0.6) * D2R), 0);
    na++;
  }
  /** An arc round c (radius R°), from tangent `start`, sweeping `span` toward cross(c, start). */
  function arc(c: THREE.Vector3, start: THREE.Vector3, R: number, span: number, reveal: number, width: number, broken: number, strength: number, ticks = 0, phase = 0) {
    if (nArc >= NARC || reveal <= 0 || strength <= 0.001) return;
    u.uArcC.value[nArc].copy(c);
    u.uArcU.value[nArc].copy(start);
    u.uArcP.value[nArc].set(R, span, reveal, width);
    u.uArcQ.value[nArc].set(broken, ticks, strength, phase);
    const margin = width * 4 + (ticks > 0 ? R * 0.035 : 0) + 0.6;
    u.uArcB.value[nArc].set(Math.cos(Math.min(180, R + margin) * D2R), Math.cos(Math.max(0, R - margin) * D2R));
    nArc++;
  }
  /** A great-circle stroke from a toward b. */
  function seg(a: THREE.Vector3, b: THREE.Vector3, reveal: number, width: number, broken: number, strength: number, bead = -1, style = 0, seed = 0) {
    if (nSeg >= NSEG || reveal <= 0 || strength <= 0.001) return;
    const n = new THREE.Vector3().crossVectors(a, b).normalize();
    u.uSegA.value[nSeg].copy(a);
    u.uSegN.value[nSeg].copy(n);
    u.uSegP.value[nSeg].set(angleBetween(a, b), reveal, width, broken);
    u.uSegQ.value[nSeg].set(strength, bead, style, seed);
    const half = angleBetween(a, b) / 2;
    const mid = a.clone().add(b).normalize();
    u.uSegM.value[nSeg].set(mid.x, mid.y, mid.z, Math.cos(Math.min(180, half + 3.5) * D2R));
    nSeg++;
  }
  function spark(c: THREE.Vector3, strength: number) {
    if (nSp >= NSP || strength <= 0.01) return;
    u.uSp.value[nSp].set(c.x, c.y, c.z, strength);
    nSp++;
  }
  /** Start tangent so a sweep of `span` is centred on tangent `mid` at c. */
  const startFor = (c: THREE.Vector3, mid: THREE.Vector3, span: number) => mid.clone().applyAxisAngle(c, -span / 2);

  let T = 0;
  let loops = 0;
  /** Sketched look: the rings round the seals are whole circles, not half. */
  let sketch = false;
  const ringSpan = () => (sketch ? TAU : Math.PI);
  let mainOn = false;
  let warm = 2;

  /** Light beads leave the centre on each main-seal pulse (living seal: ignite + 1.5 s, then every 4 s). */
  const beadAt = (t: number) => {
    const since = t - (TL.ignite + 1.5);
    if (since < 0 || t > TL.collapse) return -1;
    const ph = since % 4;
    return ph < 1.2 ? ph / 1.2 : -1;
  };

  function build(t: number) {
    na = nArc = nSeg = nSp = 0;
    const collapse = TL.collapse;
    // The mechanism's turn: eased steps from the ignition to the collapse.
    const ringRot = clock(t, TL.ignite, TL.turnEnd, 1.6, TAU / 28);
    const outerRot = -clock(t, TL.ignite + 0.8, TL.turnEnd, 2.4, TAU / 56);
    const flare = Math.exp(-Math.max(0, t - TL.ignite) * 2.2) * (t >= TL.ignite ? 1 : 0);
    const bead = beadAt(t);
    const arrive = bead >= 0 ? Math.exp(-Math.abs(bead - 1) * 8) : 0;
    const flicker = t > collapse - 2 && t < collapse + 4 ? 0.75 + 0.25 * Math.sin(t * 37) * Math.sin(t * 13) : 1;

    // The seven seals' positions: the top one first, then clockwise — the
    // direction every arc sweeps (from u toward cross(c, u)).
    const seals = Array.from({ length: 7 }, (_, i) => around(P, PR, PU, Math.PI / 2 - (i * TAU) / 7 + ringRot, RING));
    // Compass crossings outside the ring (equilateral apex between neighbours).
    const chordDeg = angleBetween(seals[0], seals[1]);
    const outerR = RING * Math.cos(Math.PI / 7) + chordDeg * Math.sin(Math.PI / 3);
    const apex = Array.from({ length: 7 }, (_, i) => around(P, PR, PU, Math.PI / 2 - ((i + 0.5) * TAU) / 7 + ringRot, outerR));

    // ── tier 4: far rings and arcs (faint, mostly gaps) ──
    FAR.forEach(([az, el, R, speed], i) => {
      const c = dirAt(az, el);
      const [r] = frame(c);
      const rot = speed * Math.max(0, t - TL.far0);
      const rev = ramp(t, TL.far0 + i * 0.6, TL.farDur);
      const fade = 1 - ramp(t, collapse + 1 + i * 0.3, 2.5);
      arc(c, r.clone().applyAxisAngle(c, rot), R, TAU, rev, 0.05, 0.82, 0.5 * fade, i % 2 ? 0 : 160, rot * 40);
    });
    FAR_ARCS.forEach(([az0, el0, az1, el1], i) => {
      const rev = ramp(t, TL.far0 + 1 + i * 0.8, 3.5) * (1 - ramp(t, collapse + 0.5, 2.5));
      seg(dirAt(az0, el0), dirAt(az1, el1), rev, 0.05, 0.7, 0.45, -1, i === 1 ? 1 : 0, 50 + i);
    });

    // ── tier 3: construction ──
    for (let i = 0; i < 7; i++) {
      const lit = TL.kindle0 + i * TL.kindleStep;
      const c = seals[i];
      const outward = toward(c, P).negate();
      // The half circle each seal swings as it lights (opening outward).
      const hs = life(t, TL.half0 + i * TL.kindleStep, TL.halfDur, TL.collapse + 3 + (6 - i) * 0.15, 0.9);
      arc(c, startFor(c, outward, ringSpan()), 3.1, ringSpan(), hs, 0.085, 0.3, 1.0 * flicker);
      // The great ring, joined seal to seal as each pair is lit.
      const next = seals[(i + 1) % 7];
      const rs = life(t, lit + TL.kindleStep, TL.ringDur, collapse + 2.5 + (6 - i) * 0.1, 0.8);
      const tan = toward(P, c);
      const tanNext = toward(P, next);
      const sweep = Math.acos(Math.min(1, tan.dot(tanNext)));
      arc(P, tan, RING, sweep, rs, 0.08, 0.45, 1.0 * flicker);
      // The heptagram {7/3}.
      const ss = life(t, TL.star0 + i * TL.starStep, TL.starDur, collapse + 1.5 + i * 0.1, 1.0);
      // (broken only very little — owner: "make the inner star … more continuous")
      seg(c, seals[(i + 3) % 7], ss, 0.065, 0.1, 0.85 * flicker, -1, 0, 10 + i);
      // Compass arcs from this seal and its neighbour, crossing at the apex.
      const cs = life(t, TL.compass0 + i * TL.compassStep, TL.compassDur, collapse + 1, 0.8);
      const ap = apex[i];
      const cr = angleBetween(c, ap);
      arc(c, startFor(c, toward(c, ap), 0.5), cr, 0.5, cs, 0.06, 0.35, 0.8);
      arc(next, startFor(next, toward(next, ap), 0.5), cr, 0.5, cs, 0.06, 0.35, 0.8);
      // The crossing found: a spark.
      const found = TL.compass0 + i * TL.compassStep + TL.compassDur;
      spark(ap, (t > found ? Math.exp(-(t - found) * 1.5) * 0.9 + 0.12 : 0) * (1 - ramp(t, collapse + 1, 1)));
      // The outer ring through the crossings: mostly breaks, ticked, turning the other way.
      const os = life(t, TL.outer0 + i * TL.outerStep, TL.outerDur, collapse + 1.2, 1.0);
      const tanA = toward(P, ap);
      const tanB = toward(P, apex[(i + 1) % 7]);
      arc(P, tanA, outerR, Math.acos(Math.min(1, tanA.dot(tanB))), os, 0.075, 0.72, 0.9 * flicker * (1 + flare * 2), 140, outerRot * 300);
      // Spokes to the centre (dashed); beads ride them out on each pulse.
      const sp = life(t, TL.spokes0 + i * 0.08, TL.spokesDur, collapse, 0.6);
      const rim = around(P, PR, PU, Math.PI / 2 - (i * TAU) / 7 + ringRot, MAIN_R * 1.05);
      seg(rim, c, sp, 0.05, 0.3, 0.7, bead >= 0 ? bead : -1, 1, 20 + i);
    }

    // ── tier 2: the seven seals ──
    for (let i = 0; i < 7; i++) {
      const lit = TL.kindle0 + i * TL.kindleStep;
      if (t < lit) continue;
      const draw = ramp(t, lit, TL.kindleDur);
      const out = TL.out0 + (6 - i) * TL.outStep;
      const ignite = Math.exp(-Math.max(0, t - lit - TL.kindleDur) * 3) * (t > lit + TL.kindleDur * 0.8 ? 1 : 0);
      const last = t > out ? Math.exp(-(t - out) * 4) * 1.4 : 0;
      const alive = t < out ? 1 : 0;
      const spin = clock(t, lit, TL.turnEnd + 4, 0.9, -TAU / 20) + t * 0.05;
      anchor(seals[i], SEAL_R, draw, ignite + flare * 0.8 + arrive * 0.6 + last, alive * flicker * (1 + flare), spin, i * 3.1);
      spark(seals[i], ignite * 1.2 + last);
    }

    // ── echoes: energy carried out along two long arcs, three seals kindle ──
    ECHOES.forEach((e, k) => {
      const ec = dirAt(e.az, e.el);
      const [er, eu] = frame(ec);
      const from = seals[k === 0 ? 2 : 6];
      const link = life(t, TL.links0 + k * 0.6, TL.linksDur, collapse + 0.4, 1.2);
      seg(from, ec, link, 0.07, 0.4, 0.85, link < 1 ? -1 : (t * 0.6 + k * 0.5) % 1, k === 0 ? 2 : 0, 30 + k);
      const turn = clock(t, TL.echo0 + 1.5, TL.turnEnd, 1.3, (k ? -1 : 1) * TAU / 12);
      const pts = [0, 1, 2].map((j) => around(ec, er, eu, Math.PI / 2 + (j * TAU) / 3 + turn, e.r));
      const ringS = life(t, TL.echo0 + 1.2, 1.2, collapse, 0.9);
      arc(ec, er, e.r, TAU, ringS, 0.065, 0.55, 0.8);
      pts.forEach((p, j) => {
        const lit = TL.echo0 + j * 0.45 + k * 0.3;
        const tri = life(t, lit + 0.8, 0.7, collapse + 0.2, 0.7);
        seg(p, pts[(j + 1) % 3], tri, 0.06, 0.45, 0.75);
        const hs = life(t, lit + 0.3, 0.7, collapse + 0.3, 0.7);
        arc(p, startFor(p, toward(p, ec).negate(), ringSpan()), 1.9, ringSpan(), hs, 0.065, 0.3, 0.85);
        if (t >= lit && t < collapse + 1.5) {
          const ig = Math.exp(-(t - lit - 0.4) * 3) * (t > lit + 0.35 ? 1 : 0);
          const gone = t > collapse + 0.6 ? Math.exp(-(t - collapse - 0.6) * 4) : 0;
          anchor(p, e.seal, ramp(t, lit, 0.4), ig + gone, t < collapse + 0.6 ? flicker : 0, clock(t, lit, TL.turnEnd, 0.7, TAU / 16), 40 + j + k * 3);
        }
      });
    });

    u.uNArc.value = nArc;
    u.uNSeg.value = nSeg;
    u.uNA.value = na;
    u.uNSp.value = nSp;
  }

  return {
    group,
    setSketch(on) {
      sketch = on;
      u.uSketch.value = on ? 1 : 0;
    },
    restart() {
      T = 0;
      loops = 0;
      mainOn = false;
    },
    update(t, dt) {
      const step = Math.min(dt, 0.1);
      const prev = T;
      T = (T + step) % PERIOD;
      if (T < prev) loops++;
      // The main seal: restarted at its cue (a different vanish each loop),
      // shown until its vanish has played out.
      if (prev < TL.main0 && T >= TL.main0) {
        main.restart(loops % 2);
        mainOn = true;
      }
      if (T < TL.main0 || T > TL.collapse + 3.2) mainOn = false;
      // Compile its shaders up front (the first frames show it once).
      main.group.visible = mainOn || warm > 0;
      if (main.group.visible) main.update(mainOn ? step : 0);
      if (warm > 0) warm--;
      u.uTime.value = t;
      dome.position.copy(eye);
      build(T);
    },
    recolour(p) {
      u.uCol.value.set(p.glow.circles);
      main.recolour(p);
    },
    params() {
      return {
        story: 'The Summoning: kindling → construction → the living seal → clockwork turn + echoes → collapse → silence',
        loopSeconds: PERIOD,
        mainSeal: `hell-02 living seal, ${MAIN_R}° radius, restarts at ${TL.main0} s, vanish varies per loop`,
        kindledSeals: `7 bold seals on a ${RING}° ring + 2×3 echoes`,
        construction: 'half circles, great ring, heptagram, compass arcs + crossings, outer ring (mostly breaks, ticked), dashed spokes',
        far: `${FAR.length} faint broken rings + ${FAR_ARCS.length} far arcs (one with moons)`,
        clockwork: 'eased steps: ring 1/28 turn per 1.6 s, outer ring back 1/56 per 2.4 s, seal stars spin',
        line: u.uSketch.value
          ? 'sketched: every ring (> 1.5°, incl. the now-whole rings round the seals) lightly scratchy — gentle jitter + slow wobble + a second loose pass — almost no breaks; seals bold'
          : 'hand-drawn: pressure width, breaks (construction only), static wobble; seals bold and unbroken',
      };
    },
  };
}

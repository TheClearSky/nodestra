// COPIED from .claude/pages/ad/experiments/hell-src/hell-02-circle-motion-glsl.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * GLSL for HELL-02 (magic circle motion and reveal).
 *
 * Two stages, so the circle stays cheap enough for 60 fps:
 *
 *  1. BAKE (once, at start-up). The stand-in design is drawn as 2D signed
 *     distances, one layer at a time, into a small POLAR texture per layer
 *     (x = angle round the ring, y = radius across the layer's annulus):
 *       R = line coverage   G = soft halo
 *       B = stroke draw-order (0 = "drawn by angle", else when the pen gets here)
 *       A = glyph coverage (script bands only, so glyphs can pop and scroll)
 *
 *  2. RUNTIME (every frame). One annulus mesh per layer reads its texture at
 *     (angle + ring angle, radius): rotation and scroll are just an offset in
 *     x. Draw-on, stroke order, glyph pop, flicker, erosion, burn, pulse and
 *     flash are cheap analytic masks on top. All TIMING lives in TypeScript;
 *     the shader only receives per-ring numbers.
 *
 * See `.claude/research/hellscape/techniques/hell-02-circle-motion.md` (T1-T16).
 *
 * The circle is six rotation layers, inner to outer:
 *   L0 centre seal (two rings + hexagram)   L1 bead chain between two rings
 *   L2 inner script band                    L3 pentagram + ring + 5 satellites
 *   L4 tick ring (72 ticks)                 L5 outer script band + double rim
 */

import { ENV_GLSL } from '../env-src/lab';

/** The burn front's "when does this point burn" field (shared with the sparks). */
const BURN_FIELD = /* glsl */ `
float burnField(vec2 p) {
  // Low near the rim, so the circle is eaten from the outside; noise rags the front.
  return clamp(mix(1.0 - length(p), fbm(p * 2.6 + uSeed * 7.0), 0.5), 0.0, 1.0);
}
`;

/** Line, halo and hot colours: dark blood red (default), hot ember, or black-red ink. */
const PALETTE = /* glsl */ `
void palette(int c, out vec3 lineCol, out vec3 haloCol, out vec3 hotCol) {
  lineCol = vec3(1.25, 0.06, 0.045);
  haloCol = vec3(0.42, 0.018, 0.022);
  hotCol = vec3(3.2, 0.75, 0.22);
  if (c == 1) {
    lineCol = vec3(3.4, 0.55, 0.14);
    haloCol = vec3(0.85, 0.08, 0.03);
    hotCol = vec3(5.0, 1.8, 0.6);
  } else if (c == 2) {
    lineCol = vec3(0.16, 0.0, 0.004);
    haloCol = vec3(0.34, 0.012, 0.016);
    hotCol = vec3(3.0, 0.6, 0.2);
  }
}
`;

const COMMON = /* glsl */ `
#define PI 3.14159265359
#define TAU 6.28318530718
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
// Clockwise position round the ring from 12 o'clock, 0..1.
float clockU(vec2 q) { return fract(0.25 - atan(q.y, q.x) / TAU); }
float easeOutBack(float x) {
  float y = x - 1.0;
  return 1.0 + 2.70158 * y * y * y + 1.70158 * y * y;
}
`;

// ════════════════════════════════════════════════════════════════════════
// Shared vertex shader (layer meshes, fx disc, shards)
// ════════════════════════════════════════════════════════════════════════

export const CIRCLE_VERT = /* glsl */ `
uniform float uShatter;
varying vec2 vP;
varying float vFade;
varying float vEdge;
#ifdef SHARD
attribute vec2 aCentroid;
attribute vec3 aRand;
attribute float aEdge;
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
#endif
void main() {
  vec3 pos = position;
  vP = position.xy;           // the pattern is always sampled at the REST position
  vFade = 1.0;
  vEdge = 0.0;
#ifdef SHARD
  // Each shard waits its own delay, then flies out along its centroid
  // direction, spins about its centroid, sags and tips out of the plane.
  float delay = aRand.x * 0.3 + (1.0 - min(length(aCentroid), 1.0)) * 0.12;
  float e = clamp((uShatter - delay) / (1.0 - delay), 0.0, 1.0);
  float ee = 1.0 - (1.0 - e) * (1.0 - e);
  vec2 local = (position.xy - aCentroid) * (1.0 - 0.25 * e);
  local = rot2((aRand.y - 0.5) * 2.4 * ee) * local;
  vec2 dir = normalize(aCentroid + vec2(1e-3, 0.0));
  vec2 drift = dir * (0.16 + 0.4 * aRand.z) * ee + vec2(0.0, -0.22 * e * e);
  pos = vec3(aCentroid + local + drift, (aRand.z - 0.3) * 0.5 * ee);
  vFade = 1.0 - smoothstep(0.35, 1.0, e);
  vEdge = aEdge;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

// ════════════════════════════════════════════════════════════════════════
// 1. BAKE: the stand-in design as SDFs, one layer per texture
// ════════════════════════════════════════════════════════════════════════

export const BAKE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);   // a full-screen quad
}
`;

export const BAKE_FRAG = /* glsl */ `
${ENV_GLSL}
${COMMON}
uniform int uBakeLayer;
uniform float uR0;
uniform float uR1;
uniform float uPx;          // anti-alias width in circle-plane units
uniform float uSeed;
varying vec2 vUv;

float gPx;
float gCov;   // line coverage
float gHalo;  // soft glow
float gBest;  // strongest influence so far (decides gT)
float gT;     // encoded draw-order of the nearest element (0 = by angle)
float gGly;   // glyph coverage

// Draw order t (0..1) is stored as 0.04 + 0.96 t, so 0 can mean "a ring".
float enc(float t) { return 0.04 + 0.96 * clamp(t, 0.0, 1.0); }

// Add one line: d = distance to its centre line, w = half width, b = strength.
void addLine(float d, float w, float b, float t) {
  if (b <= 0.0) return;
  w = max(w, 0.55 * gPx);
  float cov = clamp((w - d) / gPx + 0.5, 0.0, 1.0) * b;
  float infl = exp(-max(d - w, 0.0) * 75.0) * b;
  gCov = max(gCov, cov);
  gHalo += infl * 0.16;
  if (infl > gBest + 1e-4) { gBest = infl; gT = t; }
}

void ring(vec2 q, float rad, float w, float b) {
  float d = abs(length(q) - rad);
  if (d > 0.07) return;
  addLine(d, w, b, 0.0);
}

float sdSegH(vec2 p, vec2 a, vec2 b, out float h) {
  vec2 pa = p - a, ba = b - a;
  h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
float sdSeg(vec2 p, vec2 a, vec2 b) { float h; return sdSegH(p, a, b, h); }

// A straight pen stroke from a to c, drawn during draw-order t0..t1 (T4).
void stroke(vec2 q, vec2 a, vec2 c, float w, float b, float t0, float t1) {
  float h;
  float d = sdSegH(q, a, c, h);
  if (d > 0.07) return;
  addLine(d, w, b, enc(mix(t0, t1, h)));
}

// Procedural glyph: strokes on a 3x3 grid, picked by hash (a stand-in for hell-01's alphabet).
float glyphSD(vec2 g, float id) {
  float d = 1e3;
  float spine = hash12(vec2(id, 91.0));
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float on = step(hash12(vec2(id * 1.37 + 0.5, fi * 7.1)), 0.34);
    if (i == 8 && spine < 0.5) on = 1.0;
    if (i == 2 && spine >= 0.5) on = 1.0;
    if (on < 0.5) continue;
    vec2 a;
    vec2 c;
    if (i < 6) {
      float row = float(i / 2) - 1.0;
      float col = float(i - (i / 2) * 2) - 1.0;
      a = vec2(col, row);
      c = vec2(col + 1.0, row);
    } else if (i < 12) {
      int j = i - 6;
      float col = float(j / 2) - 1.0;
      float row = float(j - (j / 2) * 2) - 1.0;
      a = vec2(col, row);
      c = vec2(col, row + 1.0);
    } else {
      int j = i - 12;
      a = vec2(0.0);
      c = vec2((j == 0 || j == 2) ? 1.0 : -1.0, j < 2 ? 1.0 : -1.0);
    }
    d = min(d, sdSeg(g, a * 0.3, c * 0.3));
  }
  if (hash12(vec2(id, 47.0)) > 0.78) d = min(d, abs(length(g) - 0.16));
  return d;
}

// A script band between r0 and r1: border rings (by angle) and one glyph per cell (A channel).
void band(vec2 q, float r0, float r1, float cells, float bandId) {
  float r = length(q);
  ring(q, r0, 0.003, 1.0);
  ring(q, r1, 0.003, 1.0);
  if (r < r0 + 0.004 || r > r1 - 0.004) return;
  float cellF = clockU(q) * cells;
  float c = floor(cellF);
  float H = r1 - r0;
  float rc = 0.5 * (r0 + r1);
  float cellW = TAU * rc / cells;
  vec2 g = vec2((0.5 - fract(cellF)) * cellW, r - rc) / H;
  float d = glyphSD(g, c + bandId * 101.0 + uSeed * 13.0) * H;
  float w = max(0.0028, 0.55 * gPx);
  gGly = max(gGly, clamp((w - d) / gPx + 0.5, 0.0, 1.0));
}

void layer0(vec2 q) {
  float r = length(q);
  ring(q, 0.215, 0.0045, 1.0);
  ring(q, 0.19, 0.0022, 1.0);
  // Hexagram: all six strokes drawn together, tip to tip.
  for (int t = 0; t < 2; t++) {
    for (int e = 0; e < 3; e++) {
      float a0 = PI * 0.5 + float(t) * PI + float(e) * TAU / 3.0;
      vec2 A = 0.19 * vec2(cos(a0), sin(a0));
      vec2 B = 0.19 * vec2(cos(a0 + TAU / 3.0), sin(a0 + TAU / 3.0));
      stroke(q, A, B, 0.0026, 1.0, 0.0, 1.0);
    }
  }
  // Centre eye lands late in the stroke order.
  addLine(abs(r - 0.05), 0.003, 1.0, enc(0.75));
  addLine(r, 0.014, 1.0, enc(0.75));
}

void layer1(vec2 q) {
  float r = length(q);
  ring(q, 0.300, 0.0035, 1.0);
  ring(q, 0.345, 0.0022, 1.0);
  float cellF = clockU(q) * 36.0;
  float x = (fract(cellF) - 0.5) * TAU * 0.3225 / 36.0;
  float dd = length(vec2(x, r - 0.3225));
  bool big = mod(floor(cellF), 3.0) < 0.5;
  addLine(dd, big ? 0.0065 : 0.0032, 1.0, 0.0);
}

vec2 starV(float j) {
  float a = PI * 0.5 - TAU * j / 5.0;
  return 0.66 * vec2(cos(a), sin(a));
}

void layer3(vec2 q) {
  float r = length(q);
  // Satellites at the star points, by polar repetition (one evaluation).
  float v = mod(floor(clockU(q) * 5.0 + 0.5), 5.0);
  vec2 lq = q - starV(v);
  float lr = length(lq);
  float cut = smoothstep(0.066, 0.074, lr);
  ring(q, 0.66, 0.005, cut);
  ring(q, 0.635, 0.0022, cut);
  // Pentagram {5/2}: one unicursal pen path, stroke s drawn during t = s/5..(s+1)/5.
  if (r < 0.70) {
    float bandCut = 1.0 - smoothstep(0.372, 0.382, r) * (1.0 - smoothstep(0.488, 0.498, r));
    for (int s = 0; s < 5; s++) {
      vec2 A = starV(float((2 * s) % 5));
      vec2 B = starV(float((2 * s + 2) % 5));
      stroke(q, A, B, 0.0038, bandCut * cut, float(s) / 5.0, float(s + 1) / 5.0);
    }
  }
  if (lr < 0.11) {
    // The pen reaches vertex v at stroke o(v): the satellite pops then.
    float o = v < 0.5 ? 0.0 : v < 1.5 ? 3.0 : v < 2.5 ? 1.0 : v < 3.5 ? 4.0 : 2.0;
    float t = enc(o / 5.0 + 0.01);
    vec2 sq = rot2(-v * 1.3) * lq;
    float sr = length(sq);
    addLine(abs(sr - 0.068), 0.0035, 1.0, t);
    addLine(abs(sr - 0.045), 0.002, 1.0, t);
    addLine(sr, 0.009, 1.0, t);
    for (int i = 0; i < 3; i++) {
      float aa = TAU * float(i) / 3.0;
      addLine(sdSeg(sq, vec2(0.0), 0.045 * vec2(cos(aa), sin(aa))), 0.0018, 1.0, t);
    }
  }
}

void layer4(vec2 q) {
  float r = length(q);
  ring(q, 0.765, 0.0025, 1.0);
  ring(q, 0.805, 0.0025, 1.0);
  float cellF = clockU(q) * 72.0;
  float c = floor(cellF);
  float x = abs(fract(cellF) - 0.5) * TAU * r / 72.0;
  bool isLong = mod(c, 6.0) < 0.5;
  float r0 = isLong ? 0.75 : 0.772;
  float r1 = isLong ? 0.82 : 0.798;
  float dy = max(max(r0 - r, r - r1), 0.0);
  addLine(length(vec2(x, dy)), isLong ? 0.0028 : 0.0016, 1.0, 0.0);
}

void layer5(vec2 q) {
  band(q, 0.845, 0.935, 44.0, 2.0);
  ring(q, 0.968, 0.0075, 1.0);
  ring(q, 0.995, 0.0022, 1.0);
}

void main() {
  // Texel -> circle-plane point: x is clockwise angle from 12 o'clock, y is radius.
  float r = mix(uR0, uR1, vUv.y);
  float a = TAU * (0.25 - vUv.x);
  vec2 q = r * vec2(cos(a), sin(a));
  gPx = uPx;
  gCov = 0.0;
  gHalo = 0.0;
  gBest = 0.0;
  gT = 0.0;
  gGly = 0.0;
  if (uBakeLayer == 0) layer0(q);
  else if (uBakeLayer == 1) layer1(q);
  else if (uBakeLayer == 2) band(q, 0.385, 0.49, 22.0, 1.0);
  else if (uBakeLayer == 3) layer3(q);
  else if (uBakeLayer == 4) layer4(q);
  else layer5(q);
  gl_FragColor = vec4(gCov, min(gHalo, 1.0), gT, gGly);
}
`;

// ════════════════════════════════════════════════════════════════════════
// 2. RUNTIME: one annulus mesh per layer (uLayer 0..5) + the fx disc (6)
// ════════════════════════════════════════════════════════════════════════

export const CIRCLE_FRAG = /* glsl */ `
${ENV_GLSL}
${COMMON}
uniform int uLayer;          // 0..5 = one layer (its own annulus mesh), 6 = the fx disc
uniform sampler2D uTex;      // this layer's baked polar texture
uniform float uR0;           // the texture's radius range
uniform float uR1;
uniform float uCells;        // glyph cells in this layer's script band (0 = none)
uniform float uBandV;        // band centre / half height, in texture y
uniform float uBandHalfV;
uniform float uBandId;       // 1 = inner band (uScroll[0]), 2 = outer band (uScroll[1])
uniform float uSegs;         // flicker segments round this layer

uniform float uSeed;
uniform float uTheta[6];     // per-layer angle (integrated in TS)
uniform float uGhostStep[6]; // clockwork: last tick's step, for afterimages
uniform float uGhostAmt[6];
uniform float uScroll[2];    // script scroll relative to its ring (L2, L5)
uniform float uReveal[6];    // per-layer angular draw-on, 0..1
uniform float uStar;         // pentagram strokes, 0..1 over the 5 strokes
uniform float uGlyphT;       // seconds since the glyph pop started (>= 100: all shown)
uniform float uErode;        // alpha-erosion threshold (>= 1.9: off)
uniform int uErodeField;
uniform float uPulseR;
uniform float uPulseAmp;
uniform float uBreath;
uniform float uFlash;        // ignition envelope 1 = white-hot
uniform float uShockR;
uniform float uShockAmp;
uniform float uBurn;         // 0 = intact, 0..1.05 burn front
uniform float uFlicker;      // share of segments dropped out
uniform float uClock;
uniform float uGain;
uniform float uSwell;
uniform float uCursor;
uniform int uColour;

varying vec2 vP;

${BURN_FIELD}
${PALETTE}

// Failing seal (T13): each segment re-rolls on its own stepped rate.
float flick(float u) {
  if (uFlicker <= 0.0) return 1.0;
  float k = float(uLayer);
  float seg = floor(u * uSegs);
  float rate = mix(3.0, 12.0, hash12(vec2(seg, k * 17.0 + 3.0)));
  float tick = floor(uClock * rate);
  float on = step(uFlicker, hash12(vec2(seg + k * 31.0, tick)));
  float was = step(uFlicker, hash12(vec2(seg + k * 31.0, tick - 1.0)));
  return on * (1.0 + 2.0 * (1.0 - was));               // re-ignited segments flash
}

// Appear-time field for alpha erosion (T6), 0..1.
float erodeField(vec2 p, float r) {
  float u = clockU(p);
  if (uErodeField == 0) return clamp(r * 0.62 + u * 0.38, 0.0, 1.0);         // spiral sweep
  if (uErodeField == 1) return clamp(r, 0.0, 1.0);                             // centre outward
  if (uErodeField == 2) return (min(floor(r * 6.0), 5.0) + u) / 6.0;           // ring after ring
  return clamp(r * 0.85 + (fbm(p * 3.0 + uSeed * 5.0) - 0.5) * 0.5, 0.0, 1.0); // ink bleed
}

// Ignition temperature ramp (T9): white-hot -> yellow -> orange -> rest colour.
vec3 flashRamp(float F, vec3 rest) {
  if (F > 0.66) return mix(vec3(3.0, 1.2, 0.4), vec3(6.0), (F - 0.66) / 0.34);
  if (F > 0.33) return mix(vec3(2.4, 0.5, 0.12), vec3(3.0, 1.2, 0.4), (F - 0.33) / 0.33);
  return mix(rest, vec3(2.4, 0.5, 0.12), F / 0.33);
}

void main() {
  vec2 p = vP;
  float r = length(p);
  float gPx = max(length(fwidth(p)), 1e-5);
  float inDisc = 1.0 - smoothstep(1.0, 1.02, r);
  bool fx = uLayer == 6;

  // Texture-space derivatives, taken before any branch. The angle wraps at
  // 12 o'clock, so use whichever of u and u + 0.5 is continuous here.
  float base = clockU(p);
  float baseB = fract(base + 0.5);
  float dux = abs(dFdx(base)) < abs(dFdx(baseB)) ? dFdx(base) : dFdx(baseB);
  float duy = abs(dFdy(base)) < abs(dFdy(baseB)) ? dFdy(base) : dFdy(baseB);
  float v = (r - uR0) / max(uR1 - uR0, 1e-3);
  vec2 gx = vec2(dux, dFdx(v));
  vec2 gy = vec2(duy, dFdy(v));

  float cov = 0.0;
  float halo = 0.0;
  float hot = 0.0;
  if (!fx && uGain > 0.0) {
    float th = uTheta[uLayer];
    float uRing = fract(base + th / TAU);           // T1: rotation is an offset in x
    vec4 s = textureGrad(uTex, vec2(uRing, v), gx, gy);
    float fl = flick(uRing);

    // Draw-on (T3): rings appear where the angle is behind the pen.
    float P = uReveal[uLayer];
    float du = gPx / max(r, 0.02) / TAU;
    float ang = P >= 1.0 ? 1.0 : (P <= 0.0 ? 0.0 : 1.0 - smoothstep(P - du, P, uRing));
    float hotA = (P > 0.0 && P < 1.0) ? ang * exp(-(P - uRing) * TAU * r * 30.0) : 0.0;
    // Strokes (T4): the hexagram follows P, the pentagram follows uStar, in pen order.
    float isStroke = step(0.02, s.b);
    float tt = (s.b - 0.04) / 0.96;
    float Ps = uLayer == 3 ? uStar : P;
    float st = Ps >= 1.0 ? 1.0 : (Ps <= 0.0 ? 0.0 : 1.0 - smoothstep(Ps - 0.012, Ps, tt));
    float hotS = (Ps > 0.0 && Ps < 1.0) ? st * exp(-(Ps - tt) * 28.0) : 0.0;
    float m = mix(ang, st, isStroke) * fl;
    cov = s.r * m;
    halo = s.g * m;
    hot = mix(hotA, hotS, isStroke) * (s.r + 0.3 * s.g) * 1.4 * fl;

    // Clockwork afterimages (T16): the same layer one and two ticks back.
    float ga = uGhostAmt[uLayer];
    if (ga > 0.01) {
      float st1 = uGhostStep[uLayer] / TAU;
      vec4 g1 = textureGrad(uTex, vec2(fract(uRing - st1), v), gx, gy);
      vec4 g2 = textureGrad(uTex, vec2(fract(uRing - 2.0 * st1), v), gx, gy);
      cov += ga * (0.45 * (g1.r + g1.a) + 0.2 * (g2.r + g2.a));
      halo += ga * (0.45 * g1.g + 0.2 * g2.g);
    }

    // Script band (T5, T7): glyphs slide by uScroll inside the ring and pop in.
    if (uCells > 0.0) {
      float scroll = uBandId < 1.5 ? uScroll[0] : uScroll[1];
      float uText = fract(base + (th + scroll) / TAU);
      float c = floor(uText * uCells);
      float uc = (c + 0.5) / uCells;
      float pop = 1.0;
      float fls = 0.0;
      float shown = 1.0;
      if (uGlyphT < 100.0) {
        float tc = (c / uCells) * 1.3;
        float k = clamp((uGlyphT - tc) / 0.2, 0.0, 1.0);
        shown = step(0.0001, k);
        pop = max(easeOutBack(k), 0.05);
        fls = shown * exp(-(uGlyphT - tc) * 10.0);
      }
      float uu = uc + (uText - uc) / pop;
      float vv = uBandV + (v - uBandV) / pop;
      float inCell = step(abs(uu - uc) * uCells, 0.5) * step(abs(vv - uBandV), uBandHalfV);
      float gl = textureGrad(uTex, vec2(uu, vv), gx / pop, gy / pop).a * inCell * shown;
      gl *= (P >= 1.0 ? 1.0 : step(uRing, P)) * fl;
      // Reading cursor: one bright cell travels along the inscription.
      float cur = 0.0;
      if (uCursor > 0.0) {
        float cu = fract(uClock * 0.11 + uBandId * 0.37);
        float dc = abs(fract(uText - cu + 0.5) - 0.5) * uCells;
        cur = uCursor * exp(-dc * dc * 1.2) * 2.5;
      }
      cov = max(cov, gl * (1.0 + 2.5 * fls + cur));
      halo += gl * 0.3 * (1.0 + cur);
      hot += gl * fls;
    }
    // Swell (ignition, surges): lines read thicker and brighter.
    cov *= 1.0 + uSwell;
    halo *= 1.0 + 2.0 * uSwell;
  }

  vec3 lineCol, haloCol, hotCol;
  palette(uColour, lineCol, haloCol, hotCol);

  // Alpha erosion (T6): visible where the appear-time is below the threshold, hot band at the front.
  float vis = 1.0;
  float edge = 0.0;
  if (uErode < 1.9 && !fx) {
    float T = erodeField(p, r);
    vis = 1.0 - smoothstep(uErode - 0.012, uErode, T);
    edge = vis * (1.0 - smoothstep(0.0, 0.06, uErode - T));
  }
  // Burn dissolve (T10): noise front from the rim, ember edge, a lingering char line.
  float alive = 1.0;
  float ember = 0.0;
  float charred = 0.0;
  if (uBurn > 0.0) {
    float D = burnField(p);
    float bw = 0.07 * step(0.001, uBurn) * step(uBurn, 0.999);
    alive = smoothstep(uBurn - 0.005, uBurn + 0.005, D);
    ember = alive * (1.0 - smoothstep(uBurn, uBurn + bw, D));
    charred = (1.0 - alive) * exp(-(uBurn - D) * 18.0);
  }
  float m = vis * alive;

  // Pulse wave (T8) lights the LINES it passes (and a faint fill on the fx disc).
  float pr = (r - uPulseR) / 0.07;
  float wave = uPulseAmp * exp(-pr * pr);
  float lift = uBreath * (1.0 + 3.0 * wave);

  float lineCov = cov * m;
  vec3 col = vec3(0.0);
  if (fx) {
    // Disc-wide light: drawn once, by the fx mesh only.
    col += hotCol * ember * 0.05 * inDisc;
    col += haloCol * wave * 0.08 * inDisc;
    if (uFlash > 0.0) col += flashRamp(uFlash, lineCol) * uFlash * 0.05 * exp(-r * 2.5) * inDisc;
    if (uShockAmp > 0.0) {
      float sk = (r - uShockR) / 0.022;
      col += hotCol * uShockAmp * exp(-sk * sk) * 0.6 * (1.0 - smoothstep(1.3, 1.58, r));
    }
  } else {
    col = (lineCol * lineCov + haloCol * halo * m) * lift;
    col += hotCol * (hot * m + edge * (cov * 1.6 + halo * 0.4));
    col += hotCol * ember * (cov * 2.2 + halo * 0.6);
    col += vec3(0.5, 0.02, 0.01) * charred * (cov + 0.2 * halo);
    if (uFlash > 0.0) {
      vec3 fc = flashRamp(uFlash, lineCol);
      col = mix(col, fc * (lineCov + halo * 0.5) + hotCol * hot, smoothstep(0.0, 0.35, uFlash));
    }
  }
  // Ink mode darkens the sky under its lines (premultiplied alpha blend).
  float alpha = uColour == 2 ? min(lineCov, 1.0) * 0.85 : 0.0;
  gl_FragColor = vec4(col * uGain, alpha * uGain);
}
`;

/** Half-size of the square the shatter snapshot covers (circle plane units). */
export const SNAP_EXTENT = 1.08;

/**
 * Shards (T11): they sample a SNAPSHOT of the intact circle (the six layer
 * meshes rendered flat into a texture each frame while shattering), so the
 * pieces carry exactly what was on screen.
 */
export const SHARD_FRAG = /* glsl */ `
${PALETTE}
uniform sampler2D uSnap;
uniform float uCrack;
uniform float uFill;
uniform float uGain;
uniform int uColour;
varying vec2 vP;
varying float vFade;
varying float vEdge;
void main() {
  vec4 snap = texture2D(uSnap, vP / ${(SNAP_EXTENT * 2).toFixed(3)} + 0.5);
  float r = length(vP);
  float inDisc = 1.0 - smoothstep(1.0, 1.02, r);
  vec3 lineCol, haloCol, hotCol;
  palette(uColour, lineCol, haloCol, hotCol);
  // Crack lines: the shard's own outline glows (vEdge is 1 on the outline).
  float ew = fwidth(vEdge);
  float crack = 1.0 - smoothstep(0.0, ew * 1.8 + 1e-4, 1.0 - vEdge);
  float lum = clamp(dot(snap.rgb, vec3(0.5, 0.3, 0.2)), 0.0, 1.0);
  vec3 extra = hotCol * uCrack * crack * inDisc * (0.5 + 2.0 * lum) + haloCol * uFill * 0.12 * inDisc;
  gl_FragColor = vec4((snap.rgb + extra * uGain) * vFade, snap.a * vFade);
}
`;

export const SPARK_VERT = /* glsl */ `
${ENV_GLSL}
uniform float uSeed;
uniform float uBurnStart;
uniform float uBurnDur;
uniform float uProgT;
uniform float uTheta[6];
uniform float uPixelRatio;
attribute vec2 aRest;
attribute vec3 aRand;
attribute float aKind;
varying float vHeat;
${BURN_FIELD}
void main() {
  // Each spark sits on a line. The burn front reaches it at a time we can
  // compute from the same field, so it is born exactly on the burning edge.
  vec2 rest = aRest;
  if (aKind > 0.5) {
    float a = uTheta[3];
    float c = cos(a), s = sin(a);
    rest = vec2(c * rest.x - s * rest.y, s * rest.x + c * rest.y);
  }
  float D = burnField(rest);
  float age = uProgT - (uBurnStart + D * uBurnDur);
  float life = mix(0.5, 1.5, aRand.x);
  vHeat = 0.0;
  if (uBurnDur <= 0.0 || age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float k = age / life;
  vHeat = 1.0 - k;
  vec2 dir = normalize(rest + vec2(1e-4));
  vec2 side = vec2(-dir.y, dir.x);
  vec2 pos = rest + dir * mix(0.03, 0.2, aRand.y) * age + side * (aRand.z - 0.5) * 0.12 * age + vec2(0.0, 0.09) * age * age;
  vec4 mv = modelViewMatrix * vec4(pos, 0.01, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = mix(1.6, 4.2, aRand.z) * (1.0 - 0.6 * k) * uPixelRatio * (300.0 / max(-mv.z, 1.0));
}
`;
export const SPARK_FRAG = /* glsl */ `
varying float vHeat;
void main() {
  float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
  vec3 col = mix(vec3(0.9, 0.05, 0.02), vec3(5.0, 2.0, 0.7), vHeat * vHeat);
  gl_FragColor = vec4(col * a, a);
}
`;

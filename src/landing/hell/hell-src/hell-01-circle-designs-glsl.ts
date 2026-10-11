// COPIED from .claude/pages/ad/experiments/hell-src/hell-01-circle-designs-glsl.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-01 shaders.
 *
 * CIRCLE_FRAG draws a whole magic circle in ONE fragment shader on one quad
 * (research T1): every element is a 2D distance in the circle's own plane,
 * read from a uniform layer list (T16) so a new seed never recompiles.
 * One line-style function (T10) turns distance into light; one palette
 * (T12) turns light into colour. Output is PREMULTIPLIED: the rgb is added,
 * the alpha darkens the sky behind (the "dark halo" that lets a dark red
 * line read on a dark red sky).
 *
 * BAKED_FRAG shows a pre-rendered circle (Canvas2D bake or GPU bake) with
 * the same palette maths, so the techniques can be compared like for like.
 */

import { ENV_GLSL } from '../env-src/lab';
import { MAX_EDGES } from './hell-01-circle-designs-designs';

export const MAXL = 28;

export const CIRCLE_VERT = /* glsl */ `
uniform float uBake;
varying vec2 vP;
void main() {
  vP = position.xy;
  // Bake mode: the quad fills the render target exactly (no camera).
  if (uBake > 0.5) gl_Position = vec4(position.xy / 1.15, 0.0, 1.0);
  else gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Palette + final compositing, shared by the live and the baked shader. */
const PALETTE_GLSL = /* glsl */ `
uniform vec3 uLine;      // line body
uniform vec3 uCore;      // hot core (multiplied by uHot -> HDR -> bloom)
uniform vec3 uHalo;      // tight glow / tinted shadow colour
uniform vec3 uAccent;    // gold flecks
uniform float uHot;
uniform float uGlowAmt;
uniform float uDark;     // how much the halo darkens the sky (premultiplied alpha)
uniform float uRim;      // 0 = hot centre line, 1 = hot rim on a dark body
uniform float uAccentAmt;
uniform float uFringe;   // chromatic fringe on bands (Eva)
uniform float uFade;

vec4 composeCircle(float A, float K, float G, float D, float accentMask, vec3 fringe) {
  vec3 body = mix(uLine, uCore * uHot, clamp(K, 0.0, 1.0));
  vec3 col = body * A + uHalo * G * uGlowAmt;
  col = mix(col, uAccent * 1.8, clamp(accentMask * uAccentAmt, 0.0, 1.0));
  col += (vec3(1.0, 0.12, 0.25) * fringe.x + vec3(0.35, 0.3, 1.0) * fringe.z) * uFringe * 1.6;
  float alpha = clamp(max(A, uDark * D), 0.0, 1.0);
  return vec4(col, alpha);
}
`;

export const CIRCLE_FRAG = /* glsl */ `
${ENV_GLSL}
${PALETTE_GLSL}
#define MAXL ${MAXL}
uniform vec4 uA[MAXL];   // (type, radius, half width, intensity)
uniform vec4 uB[MAXL];   // type-specific parameters
uniform vec4 uC[MAXL];   // (rotation, spin, seed, reach)
uniform int uCount;
uniform vec4 uEdge[${MAX_EDGES}];
uniform ivec2 uGlyph[64];
uniform float uGlyphN;
uniform sampler2D uAtlas;
uniform float uStyle;    // 0 hairline, 1 core+glow, 2 double, 3 dashed, 4 brush ink, 5 burnt chalk
uniform float uGlowR;
uniform float uSpinT;    // seconds of counter-rotation (0 when still)
uniform float uGlobalRot;
uniform float uDraw;     // draw-on progress 0..1 (1 = complete)
uniform float uWave;     // outward light wave (breathe)
uniform float uSeed;
varying vec2 vP;

const float TAU = 6.2831853;
const float PI = 3.14159265;

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

float sdSeg(vec2 p, vec2 a, vec2 b, out float h) {
  vec2 pa = p - a, ba = b - a;
  h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  return length(pa - ba * h);
}

// Fold p into one of n sectors round the centre (sector 0 is centred on +x).
// Returns the sector id 0..n-1 (research T5: one motif evaluated, n drawn).
float polarFold(inout vec2 p, float n) {
  float sector = TAU / n;
  float a = atan(p.y, p.x) + sector * 0.5;
  float cell = floor(a / sector);
  a -= cell * sector + sector * 0.5;
  p = length(p) * vec2(cos(a), sin(a));
  return mod(cell + n, n);
}

// Star polygon {n/m} as n chords; 'show' draws chords one by one (draw-on).
// When mOver > 0 it also returns the distance to a second {n/mOver} star on
// the same circle (for weaving), in the same loop.
float starWoven(vec2 q, float R, float n, float m, float mOver, float show, out float hOut, out float dOver) {
  float best = 1e9;
  dOver = 1e9;
  hOut = 0.0;
  for (int k = 0; k < 12; k++) {
    if (float(k) >= n) break;
    float a0 = TAU * float(k) / n;
    vec2 P0 = R * vec2(cos(a0), sin(a0));
    float h;
    if (mOver > 0.5) {
      float a2 = TAU * (float(k) + mOver) / n;
      dOver = min(dOver, sdSeg(q, P0, R * vec2(cos(a2), sin(a2)), h));
    }
    float part = clamp(show * n - float(k), 0.0, 1.0);
    if (part <= 0.0) continue;
    float a1 = TAU * (float(k) + m) / n;
    vec2 P1 = R * vec2(cos(a1), sin(a1));
    float d = sdSeg(q, P0, mix(P0, P1, part), h);
    if (d < best) { best = d; hOut = h * part; }
  }
  return best;
}

// Regular n-gon outline of circumradius R (vertices at ±PI/n of each sector).
float polyLine(vec2 q, float R, float n) {
  polarFold(q, n);
  float apo = R * cos(PI / n), half_ = R * sin(PI / n);
  return length(vec2(q.x - apo, max(abs(q.y) - half_, 0.0)));
}

// One glyph of the stroke alphabet (research T7). g: glyph box -0.5..0.5.
// 'reveal' = how many strokes are drawn (draw-on); 10 = all.
float glyphSdf(vec2 g, int id, float reveal) {
  ivec2 code = uGlyph[id];
  float d = 1e9;
  for (int j = 0; j < 10; j++) {
    int word = j < 5 ? code.x : code.y;
    int e = (word >> (6 * (j < 5 ? j : j - 5))) & 63;
    if (e == 63) break;
    float part = clamp(reveal - float(j), 0.0, 1.0);
    if (part <= 0.0) break;
    vec4 E = uEdge[e];
    float h;
    float dd = sdSeg(g, E.xy, mix(E.xy, E.zw, part), h);
    if (E.x == E.z && E.y == E.w) dd -= 0.045; // a dot
    d = min(d, dd);
  }
  return d;
}

// Atlas glyph (Canvas2D fillText, research T8): returns (crisp, blurred).
vec2 atlasGlyph(vec2 g, float idx, float cellPx) {
  if (abs(g.x) > 0.5 || abs(g.y) > 0.5) return vec2(0.0);
  float cc = mod(idx, 8.0), rr = floor(idx / 8.0);
  vec2 uv = vec2((cc + 0.5 + g.x) / 8.0, 1.0 - (rr + 0.5 - g.y) / 8.0);
  // Explicit mip level from the glyph's size on screen (atan seams would
  // break automatic mip selection).
  float lod = max(log2(128.0 / max(cellPx, 1.0)), 0.0);
  return textureLod(uAtlas, uv, lod).rg;
}

// Hot core of a FILLED atlas glyph: only the thick middles of strokes (where
// the blurred copy is strong) run hot, and less so on white-hot palettes —
// otherwise a whole glyph turns into a solid white block that blooms.
float atlasCore(vec2 tex) {
  float inner = mix(0.3, 0.8, smoothstep(0.45, 0.85, tex.y));
  return inner * (uRim > 0.5 ? 0.5 : 1.0) * min(1.0, 1.8 / uHot);
}

float sdVesica(vec2 p, float r, float d) {
  p = abs(p);
  float b = sqrt(max(r * r - d * d, 0.0));
  return ((p.y - b) * d > p.x * b) ? length(p - vec2(0.0, b)) : length(p - vec2(-d, 0.0)) - r;
}

float sdMoon(vec2 p, float d, float ra, float rb) {
  p.y = abs(p.y);
  float a = (ra * ra - rb * rb + d * d) / (2.0 * d);
  float b = sqrt(max(ra * ra - a * a, 0.0));
  if (d * (p.x * b - p.y * a) > d * d * max(b - p.y, 0.0)) return length(p - vec2(a, b));
  return max(length(p) - ra, -(length(p - vec2(d, 0.0)) - rb));
}

float gErode;

// Distance to a line's centre -> (coverage, hot core, glow, dark halo).
// s = position along the line in dash periods (-1 = not dashable).
vec4 shadeLine(float dc, float w, float s, float px, float seed) {
  int st = int(uStyle + 0.5);
  float wv = max(w, 0.6 * px);
  float fade = w / wv;   // lines thinner than a pixel keep their average coverage
  float a, core, glow, dark;
  if (st == 2) {
    // Double line: two thin lines either side of the centre (a ribbon).
    float off = wv + max(wv * 0.9, 1.6 * px);
    float w2 = max(wv * 0.5, 0.6 * px);
    float dd = abs(dc - off);
    a = 1.0 - smoothstep(w2 - 0.6 * px, w2 + 0.6 * px, dd);
    core = a * 0.45;
    glow = exp(-max(dd - w2, 0.0) / (uGlowR * 0.7)) * 0.7;
    dark = exp(-max(dc - off - w2, 0.0) / 0.022);
    return vec4(a, core, glow, dark) * vec4(fade, fade, fade, 1.0);
  }
  if (st == 4 && s >= 0.0) {
    // Brush ink: width swells and thins along the stroke, re-drawn 8×/s (boil).
    wv *= 0.4 + 1.1 * vnoise(vec2(s * 0.55, seed * 7.0 + floor(uTime * 8.0) * 3.1));
  }
  a = 1.0 - smoothstep(wv - 0.6 * px, wv + 0.6 * px, dc);
  float centre = 1.0 - smoothstep(0.0, wv * 0.55 + 0.5 * px, dc);
  float thin = 1.0 - clamp((wv - px) / px, 0.0, 1.0);
  float edge = a * clamp(smoothstep(wv * 0.25, wv, dc) * 1.4 + thin, 0.0, 1.0);
  core = mix(centre, edge, uRim);
  glow = exp(-max(dc - wv, 0.0) / uGlowR);
  dark = exp(-max(dc - wv, 0.0) / 0.022);
  if (st == 0) { core *= 0.55; glow *= 0.18; }
  if (st == 3 && s >= 0.0) {
    float m = fract(s);
    float aa = 0.08;
    float dash = (1.0 - smoothstep(0.55 - aa, 0.55 + aa, m)) * smoothstep(0.0, aa, m);
    a *= dash; core *= dash; glow *= mix(0.35, 1.0, dash);
  }
  if (st == 4) { core *= 0.25; glow *= 0.12; dark *= 1.2; }
  if (st == 5) {
    // Burnt chalk: grainy erosion, embers where the line is thinnest, soot halo.
    float er = smoothstep(0.34, 0.5, gErode);
    float ember = a * (1.0 - smoothstep(0.0, 0.1, gErode - 0.34));
    a *= er;
    core = max(core * er * 0.5, ember * 1.2);
    glow *= 0.3 * er;
    dark *= 1.5;
  }
  return vec4(a * fade, core * fade, glow * fade, dark);
}

void main() {
  vec2 p0 = vP;
  float r0 = length(p0);
  if (r0 > 1.15) discard;
  // One pixel in circle units, measured once (research T11): free of the
  // cracks that atan/fract seams put into per-layer derivatives.
  float px = length(fwidth(p0));
  vec2 p = rot2(-uGlobalRot) * p0;
  int st = int(uStyle + 0.5);
  if (st == 4) {
    float boil = floor(uTime * 8.0);
    p += 0.005 * (vec2(vnoise(p * 9.0 + boil * 1.7), vnoise(p * 9.0 + 5.3 + boil * 2.3)) - 0.5);
  }
  // Chalk grain is sized in PIXELS (about 9 px per blob), so a small circle
  // does not turn into single-pixel speckle.
  gErode = st == 5 ? fbm3(p * clamp(0.11 / px, 9.0, 34.0) + uSeed * 0.37) : 1.0;
  float r = length(p);

  float A = 0.0, K = 0.0, G = 0.0, D = 0.0, accentMask = 0.0, black = 0.0;
  vec3 fringe = vec3(0.0);
  float margin = max(uGlowR * 5.0, 0.09) + 3.0 * px;

  for (int i = 0; i < MAXL; i++) {
    if (i >= uCount) break;
    vec4 La = uA[i], Lb = uB[i], Lc = uC[i];
    float R = La.y;
    if (abs(r - R) > Lc.w + margin) continue;           // radial early-out (T19)
    float lp = clamp(uDraw * (float(uCount) + 2.0) - float(i), 0.0, 1.0);
    if (lp <= 0.0) continue;
    int type = int(La.x + 0.5);
    float w = La.z;
    float inten = La.w;
    vec2 q = rot2(-(Lc.x + Lc.y * uSpinT)) * p;
    float qa = atan(q.y, q.x);
    float sweep = qa / TAU + 0.5;                        // 0..1 round the ring
    float dc = 1e9, s = -1.0, mul = 1.0, cellAccent = 0.0;

    if (type == 0 || type == 12 || type == 14 || type == 1) {
      // RING / DASH / ARCS / RING2
      dc = type == 1 ? abs(abs(r - R) - Lb.x) : abs(r - R);
      s = sweep * max(1.0, floor(TAU * R / 0.045 + 0.5));
      if (type == 12) {
        float m = fract(sweep * Lb.x);
        float aa = px * Lb.x / (TAU * R) * 1.2;
        mul = (1.0 - smoothstep(Lb.y - aa, Lb.y + aa, m)) * smoothstep(0.0, aa, m);
        s = -1.0;
      }
      if (type == 14) {
        vec2 c = q;
        polarFold(c, Lb.x);
        float gapHalf = Lb.y * PI / Lb.x;
        float la = atan(c.y, c.x);
        if (abs(la) < gapHalf) dc = length(c - R * vec2(cos(gapHalf), sign(la) * sin(gapHalf)));
      }
      if (sweep > lp) dc = 1e9;
    } else if (type == 2) {
      // BAND (Eva): filled band, white-hot core line, streaks, chromatic fringe.
      dc = abs(r - R);
      float hw = w;
      float aB = 1.0 - smoothstep(hw - 0.6 * px, hw + 0.6 * px, dc);
      float streak = vnoise(vec2(cos(qa), sin(qa)) * (R * 9.0) + Lc.z);
      // The band glows from inside: a soft hot ramp across its whole width
      // (white-hot middle, saturated edges) plus a thin hot core line.
      float across = clamp(1.0 - dc / max(hw, px), 0.0, 1.0);
      float coreLine = 1.0 - smoothstep(0.0, max(hw * 0.18, px * 0.9), dc);
      float coreB = max(across * across * 0.75, coreLine) * (0.6 + 0.6 * streak);
      float aR = 1.0 - smoothstep(hw - px, hw + px, abs(r * 0.994 - R));
      float aBl = 1.0 - smoothstep(hw - px, hw + px, abs(r * 1.006 - R));
      float rev = step(sweep, lp);
      A = max(A, aB * (0.6 + 0.4 * streak) * rev);
      K = max(K, coreB * inten * rev);
      G = max(G, exp(-max(dc - hw, 0.0) / uGlowR) * 0.8 * inten * rev);
      D = max(D, exp(-max(dc - hw, 0.0) / 0.022) * rev);
      fringe = max(fringe, vec3(max(aR - aB, 0.0), 0.0, max(aBl - aB, 0.0)) * inten * rev);
      continue;
    } else if (type == 3) {
      // STAR {n/m}
      float h;
      float dOver;
      dc = starWoven(q, R, Lb.x, Lb.y, Lb.z, lp, h, dOver);
      if (Lb.z > 0.5) {
        // Woven under the {n/Lb.z} star: cut a gap (its width + air) where they cross.
        float gap = Lb.w + w + max(0.006, 2.5 * px);
        mul = smoothstep(gap, gap + 1.5 * px, dOver);
      }
      s = h * 2.0 * R * sin(PI * Lb.y / Lb.x) / 0.045;
    } else if (type == 4) {
      // GLYPH BAND (research T6): unroll the band into square cells.
      float h = Lb.x, cells = Lb.y;
      float u = (0.5 - qa / TAU) * cells;                // clockwise: upright and left-to-right at the top
      float id = mod(floor(u), cells);
      vec2 g = vec2((fract(u) - 0.5) * (TAU * r / cells) / h, (r - R) / h);
      float reveal = clamp(lp * cells - id, 0.0, 1.0) * 10.0;
      if (hash12(vec2(id, Lc.z)) < Lb.z && reveal > 0.0) {
        int gid = int(hash12(vec2(id * 1.37 + 3.1, Lc.z + 11.0)) * uGlyphN);
        dc = glyphSdf(g * 1.15, gid, reveal) / 1.15 * h;
        cellAccent = step(0.84, hash12(vec2(id, Lc.z + 5.0)));
      }
      if (Lb.w > 0.5 && reveal > 0.0) {
        // separator dots between glyphs
        vec2 gs = vec2((fract(u + 0.5) - 0.5) * (TAU * r / cells) / h, g.y);
        dc = min(dc, max(length(gs) * h - 0.035 * h, 0.0));
      }
    } else if (type == 5) {
      // SATELLITES at the star tips, each with its own seeded glyph.
      vec2 c = q;
      float id = polarFold(c, Lb.x);
      vec2 l = c - vec2(R, 0.0);
      float size = Lb.y;
      int flags = int(Lb.z + 0.5);
      float show = clamp(lp * Lb.x - id, 0.0, 1.0);
      if (show > 0.0) {
        float ls = atan(l.y, -l.x) / TAU + 0.5;
        if ((flags & 8) == 0 && ls <= show) dc = abs(length(l) - size);
        if ((flags & 2) != 0 && ls <= show) dc = min(dc, abs(length(l) - size * 0.8));
        if ((flags & 1) != 0) {
          vec2 g = vec2(-l.y, l.x) / size * 1.1;          // glyph "up" points outward
          int gid = int(hash12(vec2(id + 0.5, Lc.z)) * uGlyphN);
          dc = min(dc, glyphSdf(g, gid, show * 10.0) * size / 1.1);
          cellAccent = step(0.7, hash12(vec2(id, Lc.z + 2.0)));
        }
        if ((flags & 4) != 0) dc = min(dc, polyLine(vec2(-l.x, l.y), size * 0.62, 3.0));
      }
    } else if (type == 6) {
      // TICKS: every longEvery-th tick is long (clock grammar).
      vec2 c = q;
      float id = polarFold(c, Lb.x);
      float len = Lb.y * ((Lb.z > 0.5 && mod(id, Lb.z) < 0.5) ? 2.2 : 1.0);
      float h;
      if (id / Lb.x <= lp) dc = sdSeg(c, vec2(R, 0.0), vec2(R + len, 0.0), h);
    } else if (type == 7) {
      // SPOKES
      vec2 c = q;
      float id = polarFold(c, Lb.x);
      float h;
      if (id / Lb.x <= lp) dc = sdSeg(c, vec2(Lb.y, 0.0), vec2(Lb.z, 0.0), h);
    } else if (type == 8) {
      // BEAD CHAIN (alternating big/small, filled or open)
      vec2 c = q;
      float id = polarFold(c, Lb.x);
      float br = Lb.y * ((Lb.z > 0.5 && mod(id, 2.0) > 0.5) ? 0.55 : 1.0);
      float dd = length(c - vec2(R, 0.0)) - br;
      if (id / Lb.x <= lp) dc = Lb.w > 0.5 ? abs(dd) : max(dd, 0.0);
    } else if (type == 9) {
      // CRESCENTS opening outward
      vec2 c = q;
      float id = polarFold(c, Lb.x);
      float sz = Lb.y;
      if (id / Lb.x <= lp) dc = max(sdMoon(c - vec2(R, 0.0), sz * Lb.z, sz, sz * 0.9), 0.0);
    } else if (type == 10) {
      // POLYGON outline (nested squares at 45° = the transmutation grammar)
      if (sweep <= lp) dc = polyLine(q, R, Lb.x);
    } else if (type == 13) {
      // ATLAS BAND: Canvas2D kanji / runes sampled in polar cells.
      float h = Lb.x, cells = Lb.y;
      float u = (0.5 - qa / TAU) * cells;
      float id = mod(floor(u), cells);
      vec2 g = vec2((fract(u) - 0.5) * (TAU * r / cells) / h, (r - R) / h);
      if (hash12(vec2(id, Lc.z)) < Lb.z && id / cells <= lp) {
        float base = Lb.w < 0.5 ? 0.0 : (Lb.w < 1.5 ? 16.0 : 0.0);
        float count = Lb.w < 0.5 ? 16.0 : (Lb.w < 1.5 ? 24.0 : 40.0);
        float idx = base + floor(hash12(vec2(id * 1.37 + 3.1, Lc.z + 11.0)) * count);
        vec2 tex = atlasGlyph(g * 1.05, idx, h / px);
        A = max(A, tex.x);
        K = max(K, tex.x * atlasCore(tex));
        G = max(G, tex.y * 0.9);
        D = max(D, tex.y);
        accentMask = max(accentMask, tex.x * step(0.84, hash12(vec2(id, Lc.z + 5.0))));
      }
      continue;
    } else if (type == 11) {
      // CENTRE motifs (M7)
      int kind = int(Lb.x + 0.5);
      if (kind == 1) {
        // Black sun: black disc, lumpy flickering corona (two-scale glow).
        float lump = fbm3(vec2(cos(qa), sin(qa)) * 2.6 + vec2(uTime * 0.35, Lc.z));
        float rc = R * (1.0 + 0.16 * (lump - 0.45));
        float flick = 0.82 + 0.18 * vnoise(vec2(uTime * 9.0, Lc.z));
        float outR = max(r - R, 0.0);
        float tight = exp(-max(r - rc, 0.0) / 0.012) * step(R, r + px);
        float wide = exp(-outR / 0.13);
        black = max(black, (1.0 - smoothstep(R - px, R + px, r)) * lp);
        A = max(A, tight * flick * lp);
        K = max(K, tight * flick * 0.9 * lp);
        G = max(G, (tight * 0.6 + wide * 0.75) * flick * lp);
        D = max(D, wide);
        continue;
      }
      if (kind == 2) {
        // Eye: almond, iris ring, slit pupil.
        float almond = abs(sdVesica(vec2(q.y, q.x), R, R * 0.62));
        float iris = abs(length(q) - R * 0.33);
        float pupil = max(sdVesica(q, R * 0.3, R * 0.255), 0.0);
        dc = min(min(almond, iris), pupil);
      } else if (kind == 3) {
        // Vortex: log-spiral arms turning inward.
        float arms = 5.0;
        float v = fract(qa / TAU * arms + log(max(r, 1e-3)) * 1.6 - uTime * 0.12);
        dc = abs(v - 0.5) * (TAU * r / arms) * 0.9;
        mul = smoothstep(0.015, R * 0.45, r) * step(r, R);
        dc = min(dc / max(mul, 0.05), abs(r - R));
        mul = 1.0;
      } else if (kind == 4) {
        // One big seal glyph inside a ring.
        int gid = int(hash12(vec2(Lc.z, 77.0)) * uGlyphN);
        dc = min(glyphSdf(q / R * 0.62, gid, lp * 10.0) * R / 0.62, abs(r - R));
      } else if (kind == 5) {
        // Kanji (封) in a square hanko frame.
        vec2 tex = atlasGlyph(vec2(q.x, q.y) / (R * 1.5), 1.0, R * 1.5 / px);
        A = max(A, tex.x * lp);
        K = max(K, tex.x * atlasCore(tex) * lp);
        G = max(G, tex.y * lp);
        D = max(D, tex.y);
        dc = polyLine(q, R * 1.02, 4.0);
      } else if (kind == 6) {
        float h, hd;
        dc = min(abs(r - R), starWoven(rot2(-PI / 2.0) * q, R * 0.86, 6.0, 2.0, 0.0, lp, h, hd));
      }
      if (lp < 1.0 && sweep > lp) dc = 1e9;
    }

    if (dc < 1e8) {
      vec4 sh = shadeLine(dc, w, s, px, Lc.z + float(i));
      A = max(A, sh.x * mul);
      K = max(K, sh.y * inten * mul);
      G = max(G, sh.z * inten * mul);
      D = max(D, sh.w * mul);
      accentMask = max(accentMask, cellAccent * sh.x);
    }
  }

  // Breathe: a wave of light runs outward through the rings (M12 hook).
  if (uWave > 0.0) {
    float wr = fract(uTime * 0.22) * 1.3 - 0.1;
    float wv = exp(-pow((r - wr) / 0.06, 2.0));
    K = max(K, A * wv * uWave);
    G *= 1.0 + 1.5 * wv * uWave;
  }
  // Gold flecks: sparse sparkle along the lines (only palettes with an accent use it).
  float sparkle = step(0.985, hash12(floor(p * 170.0) + uSeed)) * A;
  vec4 outc = composeCircle(A, K, G, D, max(accentMask, sparkle), fringe);
  outc.rgb *= 1.0 - black;
  outc.a = max(outc.a, black);
  float edgeFade = 1.0 - smoothstep(1.07, 1.14, r0);
  gl_FragColor = outc * edgeFade * uFade;
}
`;

export const BAKED_VERT = /* glsl */ `
varying vec2 vP;
varying vec2 vUv;
void main() {
  vP = position.xy;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const BAKED_FRAG = /* glsl */ `
${PALETTE_GLSL}
uniform sampler2D uTex;
uniform float uMode;     // 0 = Canvas2D bake (R line, G glow, B core), 1 = GPU bake (premultiplied colour)
uniform float uBlackR;   // black-sun disc radius (drawn analytically), 0 = none
varying vec2 vP;
varying vec2 vUv;
void main() {
  float r0 = length(vP);
  if (r0 > 1.15) discard;
  float edgeFade = 1.0 - smoothstep(1.07, 1.14, r0);
  vec4 t = texture2D(uTex, vUv);
  if (uMode > 0.5) { gl_FragColor = t * edgeFade * uFade; return; }
  float A = t.r, G = t.g, K = t.b;
  vec4 outc = composeCircle(A, K, G, min(G * 1.6, 1.0), 0.0, vec3(0.0));
  if (uBlackR > 0.0) {
    float px = length(fwidth(vP));
    float black = 1.0 - smoothstep(uBlackR - px, uBlackR + px, r0);
    outc.rgb *= 1.0 - black;
    outc.a = max(outc.a, black);
  }
  gl_FragColor = outc * edgeFade * uFade;
}
`;

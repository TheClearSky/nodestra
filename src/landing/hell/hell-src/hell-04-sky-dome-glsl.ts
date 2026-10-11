// COPIED from .claude/pages/ad/experiments/hell-src/hell-04-sky-dome-glsl.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-04 sky dome shader. One fragment shader, many looks: every element of
 * the sky (ramp, banding, sun / black sun / moon, ceiling, aurora, stars,
 * horizon band) is switched by a uniform, so the HUD can mix them live.
 *
 * Everything is a function of the view DIRECTION `d` (plus time), never of
 * screen position, so nothing swims when the camera pans. The only screen-space
 * term is the invisible ±1 LSB dither at the very end.
 *
 * Technique notes: `.claude/research/hellscape/techniques/hell-04-sky-dome.md`
 * (T1 … T12 below refer to its sections).
 */

import { ENV_GLSL } from '../env-src/lab';

export const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // on the far plane
}
`;

export const SKY_FRAGMENT = /* glsl */ `
${ENV_GLSL}
uniform sampler2D uRamp;   // 256x1 linear colour ramp, t = 0 horizon … 1 zenith (OKLab-mixed on the CPU)
uniform float uSkyT;       // the sky's own clock (the Motion group scales it)
uniform float uPulse;      // heartbeat multiplier on the glowing parts (1 = off)
uniform float uRampPow;    // ramp shaping: small = colour changes fast near the horizon
uniform float uLip;        // horizon haze lip strength
uniform vec3 uLipCol;
uniform float uSwallow;    // how much the bottom few degrees melt into the horizon colour
uniform float uBandMode;   // 0 smooth, 1 poster hard, 2 poster painted, 3 Bayer-dithered bands, 4 flat cel
uniform float uBandN;
uniform float uWobble;
uniform float uDither;     // 0 off, 1 moving mono IGN, 2 static mono IGN, 3 moving per-channel IGN

// FOCAL (define): 0 none, 1 red sun, 2 black sun, 3 cracked moon, 4 caged moon (red grid), 5 cel disc
uniform vec3 uFDir;        // focal centre direction and its frame (right, up), built on the CPU
uniform vec3 uFT;
uniform vec3 uFB;
uniform float uFSin;       // sin(angular radius)
uniform float uGlow;       // Henyey–Greenstein glow round the focal direction
uniform vec3 uGlowCol;
uniform mat3 uSpin;        // moon spin
uniform vec3 uMoonLight;   // light direction in the moon's local frame

// CEIL (define): 0 none, 1 churning painted ceiling, 2 torn black clouds, 3 vortex eye
uniform float uCeilEdge;
uniform vec3 uCrown;       // pillar crown direction + frame
uniform vec3 uCT;
uniform vec3 uCB;
uniform vec3 uVT;          // vortex frame (its centre is uVDir)
uniform vec3 uVB;
uniform vec3 uVDir;

// SPECKS (define): 0 none, 1 stars, 2 dark specks, 3 falling ash; AURORA (define): 0 / 1
uniform float uAurora;
uniform float uRays;
uniform float uHalo;
uniform vec3 uDog1;
uniform vec3 uDog2;
uniform float uHBand;
uniform vec3 uHBandCol;
uniform float uSplit;
uniform vec3 uWarm;
uniform vec3 uViolet;

varying vec3 vDir;

// ── helpers ───────────────────────────────────────────────────────────────

vec3 ramp(float t) { return texture2D(uRamp, vec2(clamp(t, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).rgb; }

float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

// Interleaved gradient noise (Jimenez 2014).
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

float hash13(vec3 p) { return hash12(p.xy + p.z * 17.13); }

// Henyey–Greenstein phase: g near 1 = tight glow, g ~ 0.5 = broad wash.
float hg(float c, float g) { float g2 = g * g; return 0.0795775 * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5); }

// Two octaves: enough for warp offsets (the eye cannot see octaves 3+ of a warp).
float fbm2(vec2 p) { return (vnoise(p) * 0.5 + vnoise(FBM_ROT * p) * 0.25) / 0.75; }
float fbm4(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = FBM_ROT * p; a *= 0.5; }
  return s / 0.9375;
}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// Voronoi F2 - F1: ~0 on the borders between cells (cracks).
float vorEdge(vec2 p) {
  vec2 n = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 r = g + hash22(n + g) - f;
    float dd = dot(r, r);
    if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) { d2 = dd; }
  }
  return sqrt(d2) - sqrt(d1);
}

// ── T1–T3, T8 · the base ramp and its banding style ────────────────────────

vec3 baseSky(vec3 d) {
  float h = max(d.y, 0.0);
  float t = pow(h, uRampPow);
  vec3 col;
  if (uBandMode < 0.5) {
    col = ramp(t);
  } else if (uBandMode < 2.5) {
    // Posterised: quantise the ramp PARAMETER so each band is one exact colour.
    if (uBandMode > 1.5) {
      vec2 pp = d.xz / (d.y + 0.25);
      t += (fbm3(pp * 1.4 + uSkyT * 0.01) - 0.5) * uWobble; // hand-painted wandering band edges
    }
    float s = clamp(t, 0.0, 0.9999) * uBandN;
    float i = floor(s), f = s - i;
    float w = max(fwidth(s), 1e-4);
    float q = min(i + smoothstep(1.0 - w, 1.0, f), uBandN - 1.0); // anti-aliased staircase
    col = ramp((q + 0.5) / uBandN);
    // Painted: a slightly lighter brush lip where two fills meet.
    if (uBandMode > 1.5) col *= 1.0 + 0.18 * (1.0 - smoothstep(0.0, 5.0 * w, 1.0 - f)) * step(i, uBandN - 1.5);
  } else if (uBandMode < 3.5) {
    // Ordered (Bayer) dither in the top of each band, the pattern pinned to the sky sphere.
    float s = clamp(t, 0.0, 0.9999) * uBandN;
    float i = floor(s), f = s - i;
    float thr = bayer4(d.xz / (1.0 + d.y) * 240.0);
    float z = 0.5;
    float q = min(i + step(thr, (f - (1.0 - z)) / z), uBandN - 1.0);
    col = ramp((q + 0.5) / uBandN);
  } else {
    // Flat cel: two flat values and one hard horizon band (a painted join line on top).
    float az = d.x / (abs(d.z) + 1.0);
    float edge = 0.115 + (vnoise(vec2(az * 6.0, 3.0)) - 0.5) * uWobble;
    float w = fwidth(d.y);
    float band = 1.0 - smoothstep(edge - w, edge + w, d.y);
    col = mix(ramp(0.92), ramp(0.06), band);
    col += ramp(0.06) * 0.45 * (1.0 - smoothstep(0.0, 1.5 * w, abs(d.y - edge - 1.5 * w)));
  }
  col = mix(col, uLipCol, exp(-h * 14.0) * uLip);
  return col;
}

// ── T12 · horizon heat band and the warm / violet split ───────────────────

vec3 heatBand(vec3 d, vec3 col) {
  if (uSplit > 0.0) {
    // Violet zenith over the crimson horizon. On the sun side the violet starts
    // higher (warm air rises there); on the far side it comes right down.
    float side = dot(normalize(d.xz + 1e-4), normalize(uFDir.xz + 1e-4));
    float sunSide = smoothstep(-0.4, 0.9, side);
    // Crimson stays the dominant hue: the violet only owns the upper half.
    float lo = mix(0.07, 0.2, sunSide);
    float amt = smoothstep(lo, lo + 0.55, d.y);
    vec3 upper = mix(uViolet, uWarm, sunSide * (1.0 - smoothstep(0.1, 0.35, d.y)) * 0.5);
    col = mix(col, upper, amt * uSplit);
  }
  if (uHBand > 0.0) {
    float shimmer = (vnoise(vec2(d.x * 40.0 / (abs(d.z) + 1.0), uSkyT * 1.3)) - 0.5) * 0.006;
    float y = d.y - 0.012 - shimmer;
    float band = exp(-pow(y / 0.035, 2.0));
    col *= 1.0 - 0.3 * uHBand * exp(-pow((y - 0.11) / 0.05, 2.0)); // the dark lid above the glow
    float sunSide = 0.55 + 0.45 * pow(max(dot(normalize(d.xz + 1e-4), normalize(uFDir.xz + 1e-4)), 0.0), 3.0);
    col += uHBandCol * band * sunSide * uHBand * uPulse;
  }
  return col;
}

// ── T10 · stars and specks on a 3D direction grid ──────────────────────────

// magPow > 1 gives a real star field: many faint points, a few bright ones.
float starLayer(vec3 d, float K, float density, float radiusPx, vec3 drift, float magPow) {
  vec3 g = d * K + drift;
  vec3 c = floor(g), f = fract(g) - 0.5;
  float h = hash13(c);
  if (h > density) return 0.0;
  vec3 o = (vec3(hash13(c + 1.3), hash13(c + 2.7), hash13(c + 4.1)) - 0.5) * 0.5;
  float dist = length(f - o) / K;
  float px = length(fwidth(d));
  float s = 1.0 - smoothstep(radiusPx * px * 0.5, radiusPx * px * 1.5, dist);
  float tw = 0.65 + 0.35 * sin(uSkyT * (1.0 + 3.0 * h) + h * 40.0);
  float mag = pow(hash13(c + 9.0), magPow);
  return s * tw * (0.25 + 0.75 * mag) * mix(0.8, 1.6, mag);
}

// ── T4 · huge red sun (AoT B7) ────────────────────────────────────────────

vec3 redSun(vec3 d, vec3 col, out float mask) {
  vec2 uv = vec2(dot(d, uFT), dot(d, uFB)) / uFSin;
  float r = length(uv);
  mask = 0.0;
  if (r > 1.3 || dot(d, uFDir) < 0.0) return col;
  float aa = fwidth(r) * 1.5;
  float disc = 1.0 - smoothstep(0.93 - aa, 1.0 + aa, r);
  float mu0 = sqrt(max(1.0 - r * r, 0.0));
  float limb = 1.0 - 0.3 * (1.0 - mu0);
  // Hotter, yellower low down, where it sits in the steam.
  vec3 sunCol = mix(srgb(vec3(0.94, 0.50, 0.38)), srgb(vec3(0.96, 0.72, 0.46)) * 1.25, smoothstep(0.3, -0.95, uv.y));
  // Dark cloud wisps drifting across the face.
  float wisp = fbm3(vec2(uv.x * 1.3 + uSkyT * 0.015, uv.y * 4.5 + 2.0));
  sunCol *= mix(1.0, 0.7, smoothstep(0.5, 0.75, wisp));
  vec3 sunLit = sunCol * limb * 1.05 * mix(1.0, uPulse, 0.4);
  col = mix(col, sunLit, disc * 0.94);
  mask = disc;
  return col;
}

// ── T4 (flat) · cel disc with a 1-px lighter rim ──────────────────────────

vec3 celDisc(vec3 d, vec3 col, out float mask) {
  vec2 uv = vec2(dot(d, uFT), dot(d, uFB)) / uFSin;
  float r = length(uv);
  mask = 0.0;
  if (r > 1.4 || dot(d, uFDir) < 0.0) return col;
  float aa = fwidth(r);
  float disc = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
  vec3 c = srgb(vec3(0.95, 0.42, 0.28)) * 1.3 * uPulse;
  c += srgb(vec3(1.0, 0.8, 0.6)) * (1.0 - smoothstep(0.0, 2.0 * aa, abs(r - 1.0 + 2.0 * aa))) * 0.6;
  col = mix(col, c, disc);
  mask = disc;
  return col;
}

// ── T5 · black sun with a flame ring (Inuyasha FA) ─────────────────────────

vec3 blackSun(vec3 d, vec3 col, out float mask) {
  vec2 uv = vec2(dot(d, uFT), dot(d, uFB)) / uFSin;
  float r = length(uv);
  mask = 0.0;
  if (r > 5.0 || dot(d, uFDir) < 0.0) return col;
  vec2 dir = uv / max(r, 1e-4); // unit circle: no atan seam
  float T = uSkyT;
  // Flame edge: the ring radius breathes with angular noise that crawls round the rim.
  // Many small tongues (crenellated, like the reference), not a few big lobes.
  float flame = fbm3(rot(T * 0.05) * dir * 6.0 + vec2(T * 0.13, -T * 0.09));
  float edgeR = 1.0 + 0.08 * (flame - 0.5);
  float ring = exp(-pow((r - edgeR) / 0.035, 2.0));
  // Short streamers rushing outward, barely swirled.
  vec2 sdir = rot(r * 0.2) * dir;
  float f1 = fbm3(sdir * 9.0 + vec2(0.0, r * 1.5 - T * 0.35));
  float f2 = vnoise(sdir * 4.0 - T * 0.05);
  float out1 = step(edgeR, r);
  float corona = pow(f1 * f2 * 2.0, 2.0) * exp(-(r - 1.0) * 4.5) * out1;
  float halo = exp(-(r - 1.0) / 0.9) * out1 * 0.7;
  float flick = (0.86 + 0.14 * vnoise(vec2(uTime * 13.0, 7.3))) * uPulse;
  vec3 ringC = srgb(vec3(0.86, 0.06, 0.22));   // crimson-magenta, between #ff2030 and #b91553
  vec3 haloC = srgb(vec3(0.36, 0.06, 0.16));   // ≈ #5c1029
  vec3 core = srgb(vec3(0.03, 0.004, 0.012));  // near-black with a red cast
  col = mix(col, core, 1.0 - smoothstep(edgeR - 0.03, edgeR, r));
  col += (ringC * (ring * 3.2 + corona * 1.6) + haloC * halo * 0.7) * flick;
  mask = (ring + corona) * flick;
  return col;
}

// ── T11 · giant cracked (or caged) moon, slowly turning ───────────────────

vec3 moon(vec3 d, vec3 col, bool caged, out float mask) {
  vec2 uv = vec2(dot(d, uFT), dot(d, uFB)) / uFSin;
  float r2 = dot(uv, uv);
  float r = sqrt(r2);
  mask = 0.0;
  if (dot(d, uFDir) < 0.0) return col;
  // A faint crimson glow hugging the limb.
  col += srgb(vec3(0.5, 0.05, 0.06)) * exp(-max(r - 1.0, 0.0) * 9.0) * step(1.0, r) * 0.35 * uPulse;
  if (r2 > 1.02) return col;
  vec3 nV = vec3(uv, sqrt(max(1.0 - r2, 0.0)));
  vec3 s = uSpin * nV; // the surface turns: detail is evaluated on the rotated normal
  vec3 wts = pow(abs(s), vec3(6.0));
  wts /= dot(wts, vec3(1.0));
  // Triplanar, but a face whose weight is ~0 is skipped (most pixels need one or two faces).
  float maria = 0.0, fine = 0.0, blood = 0.0, zone = 0.0, e1 = 0.0, e2 = 0.0;
  if (wts.x > 0.01) {
    maria += wts.x * fbm3(s.yz * 1.6 + 3.0);
    fine += wts.x * vnoise(s.yz * 14.0 + 2.0);
    blood += wts.x * fbm3(s.yz * 5.0 + 11.0);
    zone += wts.x * vnoise(s.yz * 1.3 + 6.0);
    if (!caged) { e1 += wts.x * vorEdge(s.yz * 2.6 + 1.0); e2 += wts.x * vorEdge(s.yz * 6.5 + 2.0); }
  }
  if (wts.y > 0.01) {
    maria += wts.y * fbm3(s.zx * 1.6 + 7.0);
    fine += wts.y * vnoise(s.zx * 14.0 + 4.0);
    blood += wts.y * fbm3(s.zx * 5.0 + 5.0);
    zone += wts.y * vnoise(s.zx * 1.3 + 2.0);
    if (!caged) { e1 += wts.y * vorEdge(s.zx * 2.6 + 4.0); e2 += wts.y * vorEdge(s.zx * 6.5 + 5.0); }
  }
  if (wts.z > 0.01) {
    maria += wts.z * fbm3(s.xy * 1.6 + 1.0);
    fine += wts.z * vnoise(s.xy * 14.0 + 8.0);
    blood += wts.z * fbm3(s.xy * 5.0 + 9.0);
    zone += wts.z * vnoise(s.xy * 1.3 + 3.0);
    if (!caged) { e1 += wts.z * vorEdge(s.xy * 2.6 + 7.0); e2 += wts.z * vorEdge(s.xy * 6.5 + 8.0); }
  }
  float wsum = max(dot(wts, step(vec3(0.01), wts)), 1e-3);
  maria /= wsum;
  fine /= wsum;
  blood /= wsum;
  zone /= wsum;
  e1 /= wsum;
  e2 /= wsum;
  // Wrapped light from the hidden sun, with an anime-soft terminator.
  float lam = clamp(dot(nV, uMoonLight) * 0.6 + 0.45, 0.0, 1.0);
  lam = smoothstep(0.2, 0.75, lam);
  // Pale rose dust, tinted by the red air; the dark side keeps a crimson cast.
  vec3 lit = srgb(vec3(0.74, 0.60, 0.60));
  vec3 dark = srgb(vec3(0.13, 0.035, 0.05));
  // Maria: soft grey-violet seas, plus fine grit (two value steps, painted).
  float sea = smoothstep(0.45, 0.6, maria);
  vec3 m = mix(dark, lit, lam) * mix(1.0, 0.62, sea) * (0.92 + 0.12 * fine);
  m = mix(m, m * srgb(vec3(0.8, 0.78, 0.95)), sea * 0.6);
  // Blood splotches: smaller, sharp-edged stains (Eva C0797), darker on the night side.
  float stain = smoothstep(0.63, 0.66, blood + (fine - 0.5) * 0.08);
  m = mix(m, srgb(vec3(0.40, 0.025, 0.04)) * mix(0.3, 1.0, lam), stain * 0.85);
  // Limb darkening so it reads as a ball, not a plate.
  m *= 0.75 + 0.25 * nV.z;
  float glow;
  if (!caged) {
    // Cracks: Voronoi borders, only inside a "shattered" zone so they spread
    // from one side instead of tiling the whole ball like a football.
    float shatter = smoothstep(0.42, 0.62, zone);
    float w = fwidth(e1) + 0.002;
    glow = (1.0 - smoothstep(0.0, 0.022 + w, e1)) * shatter + 0.45 * (1.0 - smoothstep(0.0, 0.014 + w, e2)) * smoothstep(0.55, 0.75, zone);
    m *= 1.0 - 0.55 * (1.0 - smoothstep(0.0, 0.09, e1)) * shatter; // dark shoulders beside each crack
  } else {
    // The Eva "red grid": latitude / longitude lines with cross stars at the joints.
    float lat = asin(clamp(s.y, -1.0, 1.0)) * 12.0 / 3.14159;
    float lon = atan(s.z, s.x) * 12.0 / 3.14159;
    vec2 g = abs(fract(vec2(lat, lon)) - 0.5);
    vec2 w = fwidth(vec2(lat, lon)) * 1.2 + 0.01;
    float lines = max(1.0 - smoothstep(w.x * 0.5, w.x * 1.6, 0.5 - g.x), 1.0 - smoothstep(w.y * 0.5, w.y * 1.6, 0.5 - g.y));
    float joint = pow(max(1.0 - length((0.5 - g) * vec2(4.0, 4.0)), 0.0), 3.0);
    glow = lines * 0.8 + joint * 2.0;
  }
  float pulse = (0.8 + 0.2 * sin(uSkyT * 0.8)) * uPulse;
  m += srgb(vec3(1.0, 0.12, 0.08)) * glow * 1.8 * pulse;
  float aa = fwidth(r) * 1.5;
  float disc = 1.0 - smoothstep(1.0 - aa, 1.0, r);
  col = mix(col, m, disc);
  mask = disc * glow * 0.5;
  return col;
}

// ── extra · painted sunburst rays from the hidden sun ─────────────────────

vec3 sunRays(vec3 d, vec3 col) {
  vec2 uv = vec2(dot(d, uFT), dot(d, uFB)) / uFSin;
  float r = length(uv);
  if (dot(d, uFDir) < 0.0) return col;
  vec2 dir = rot(uSkyT * 0.004) * (uv / max(r, 1e-4));
  float n = vnoise(dir * 9.0 + 3.0) * 0.65 + vnoise(dir * 23.0 + 9.0) * 0.35;
  float w = fwidth(n) + 1e-3;
  float rays = smoothstep(0.52 - w, 0.52 + w, n); // hard-edged, very anime
  float fade = exp(-r * 0.12) * smoothstep(0.6, 2.0, r);
  col = mix(col, col * 1.45 + srgb(vec3(0.35, 0.06, 0.04)) * 0.25, rays * fade * uRays);
  return col;
}

// ── extra · crimson 22° halo ring with sun dogs and sigil ticks ───────────

vec3 halo22(vec3 d, vec3 col) {
  float mu = clamp(dot(d, uFDir), -1.0, 1.0);
  float ang = acos(mu);
  float k = (ang - 0.384) / 0.009;
  vec3 ring = srgb(vec3(1.0, 0.25, 0.18)) * exp(-k * k) + srgb(vec3(0.5, 0.03, 0.05)) * exp(-pow((ang - 0.405) / 0.02, 2.0)) * 0.6;
  // Tick marks round the ring (a quiet hint of a sigil).
  vec2 uv = vec2(dot(d, uFT), dot(d, uFB));
  float a = atan(uv.x, -uv.y) / 6.28318 * 36.0;
  float tick = smoothstep(0.42, 0.47, abs(fract(a) - 0.5)) * exp(-pow((ang - 0.43) / 0.012, 2.0));
  float big = 0.0;
  float a8 = abs(fract(a / 4.5) - 0.5);
  big = smoothstep(0.47, 0.49, a8) * exp(-pow((ang - 0.45) / 0.02, 2.0));
  ring += srgb(vec3(0.9, 0.15, 0.12)) * (tick * 0.6 + big * 0.5);
  // The 46° outer ring, faint.
  ring += srgb(vec3(0.5, 0.05, 0.06)) * exp(-pow((ang - 0.803) / 0.015, 2.0)) * 0.35;
  // Sun dogs: bright smudges left and right of the sun on the 22° ring.
  float dog = pow(max(dot(d, uDog1), 0.0), 3000.0) + pow(max(dot(d, uDog2), 0.0), 3000.0);
  ring += srgb(vec3(1.0, 0.45, 0.3)) * dog * 1.1;
  return col + ring * uHalo * uPulse * 0.8;
}

// ── T9 (b) · red aurora fan from the pillar crown ─────────────────────────

vec3 aurora(vec3 d, vec3 col) {
  vec2 uv = vec2(dot(d, uCT), dot(d, uCB));
  float r = length(uv);
  if (dot(d, uCrown) < 0.0 || r < 0.005) return col;
  float ang = atan(uv.x, uv.y); // 0 = straight up; the seam points down behind the pillar
  float T = uSkyT;
  // Ribbons fan out and curve away from the centre line, and wave sideways
  // more the further they travel from the root (like the AoT Paths streams).
  float wave = (fbm2(vec2(r * 2.4 - T * 0.05, ang * 1.6 + 3.0)) - 0.5) * 0.7 * r;
  float bend = ang + 0.4 * r * sign(ang) + wave;
  float count = 7.0;
  float k = bend * count / 3.14159;
  float id = floor(k), fk = fract(k);
  // Soft body plus a brighter folded edge on one side of each curtain.
  float width = 0.5 + 0.25 * vnoise(vec2(id * 3.1, r * 2.0 - T * 0.06));
  float body = exp(-pow((fk - 0.5) / (0.5 * width), 2.0));
  float fold = exp(-pow((fk - 0.5 + 0.32 * width) / 0.06, 2.0));
  // Wispy painted clumps that drift outward along each ribbon.
  float wisp = smoothstep(0.3, 0.75, fbm3(vec2(k * 2.2, r * 4.5 - T * 0.12)));
  float streak = 0.55 + 0.45 * vnoise(vec2(k * 26.0, r * 1.2 - T * 0.2));
  float fan = 1.0 - smoothstep(1.1, 1.5, abs(ang));
  float along = smoothstep(0.0, 0.1, r) * exp(-r * 1.8);
  float dens = (body * 0.65 * (0.35 + 0.65 * wisp) + fold * wisp * 0.9) * streak * fan * along;
  // Hot red at the root, cooling to a wine-magenta at the tips.
  vec3 aur = mix(srgb(vec3(1.0, 0.18, 0.10)), srgb(vec3(0.7, 0.08, 0.38)), smoothstep(0.05, 0.7, r));
  // A faint wash under the whole fan so the ribbons sit IN the air.
  float wash = fan * smoothstep(0.0, 0.15, r) * exp(-r * 2.5) * 0.12;
  return col + aur * (dens * 1.6 + wash) * uAurora * uPulse;
}

// ── T6 · churning painted ceiling (Scarlet) ───────────────────────────────

vec3 churnCeiling(vec3 d, vec3 col) {
  float cover = smoothstep(uCeilEdge, uCeilEdge + 0.16, d.y);
  if (cover <= 0.0) return col;
  // Squashed along the view so the billows read as long rolls overhead.
  vec2 p = d.xz / (d.y + 0.12) * vec2(2.4, 3.6);
  float T = uSkyT * 0.035;
  vec2 q = vec2(fbm2(p + 0.3 * T), fbm2(p + vec2(5.2, 1.3) - 0.2 * T));
  vec2 rr = vec2(fbm2(p + 2.0 * q + vec2(1.7, 9.2) + 0.15 * T), fbm2(p + 2.0 * q + vec2(8.3, 2.8) + 0.126 * T));
  vec2 pw = p + 1.8 * rr;
  float n = fbm4(pw);
  // Directional derivative toward the horizon (lit from below / the hidden sun);
  // both samples use the cheap 3-octave field so the difference is consistent.
  float nl = fbm2(pw + normalize(uFDir.xz + 1e-4) * 0.09);
  float lit = clamp((fbm2(pw) - nl) * 7.0 + 0.5, 0.0, 1.0);
  // Painted: three flat tones, their borders nudged by q so they aren't iso-lines.
  float lt = lit + (q.x - 0.5) * 0.25;
  float w = fwidth(lt) + 0.01;
  float tone = 0.5 * smoothstep(0.42 - w, 0.42 + w, lt) + 0.5 * smoothstep(0.66 - w, 0.66 + w, lt);
  vec3 shade = mix(srgb(vec3(0.06, 0.012, 0.025)), srgb(vec3(0.15, 0.03, 0.05)), clamp(length(q), 0.0, 1.0));
  vec3 light = mix(srgb(vec3(0.38, 0.06, 0.08)), srgb(vec3(0.50, 0.17, 0.20)), rr.x);
  vec3 ceil = mix(shade, light, tone);
  // Thin pale crest lines along the wave tops.
  float crest = pow(1.0 - abs(2.0 * n - 1.0), 14.0);
  ceil += srgb(vec3(0.85, 0.5, 0.55)) * crest * 0.22;
  // Directional brush grain (±8 %).
  ceil *= 0.92 + 0.16 * vnoise(rot(rr.x * 6.28) * p * vec2(30.0, 3.0));
  return mix(col, ceil, cover);
}

// ── T7 · torn black clouds with hot crimson edges (Hell Verse) ────────────

vec3 tornClouds(vec3 d, vec3 col) {
  float fade = smoothstep(0.03, 0.2, d.y);
  if (fade <= 0.0) return col;
  // Ceiling-plane coordinates, centred on the pillar crown.
  vec2 p = d.xz / (d.y + 0.15);
  vec2 piv = uCrown.xz / (uCrown.y + 0.15);
  vec2 rel = p - piv;
  float rl = length(rel);
  // Polar coordinates round the crown, so the masses stream OUTWARD from the
  // tower like the Hell Verse frame. atan's seam points straight away from the
  // camera (behind the pillar, down at the horizon) where the clouds fade out.
  float ang = atan(rel.x, rel.y);
  float lr = log(rl + 0.25);
  float T = uSkyT * 0.02;
  vec2 pol = vec2(ang * 2.4 + 0.25 * lr, lr * 1.3 - T); // short across, long along the radius
  vec2 warp = vec2(fbm2(pol * 1.3 + 4.0), fbm2(pol * 1.3 + 9.0)) - 0.5;
  float n = fbm4(pol * 0.9 + warp * 0.9);
  n += (vnoise(rel * 9.0 + T) - 0.5) * 0.12;          // ragged, torn edge
  n += (vnoise(rel * 26.0 - T) - 0.5) * 0.04;
  // Thin the masses out near the crown, where the polar lines converge.
  n -= 0.35 * (1.0 - smoothstep(0.2, 0.9, rl));
  float cut = 0.52; // lower = bigger, heavier masses
  float w = fwidth(n) + 1e-3;
  float body = smoothstep(cut - w, cut + w, n);
  // A thin hot rim on the lit edge only, not a glowing outline all round.
  float rim = (smoothstep(cut - 0.03, cut, n) - body) * 0.6;
  // Jagged lightning cracks INSIDE the dark masses, hugging their edges.
  float cr = abs(fbm2(rel * 3.2 + warp * 2.0 + 17.0) - 0.5);
  float cw = fwidth(cr) + 0.004;
  float crack = (1.0 - smoothstep(0.0, 0.012 + cw, cr)) * body * (1.0 - smoothstep(cut + 0.03, cut + 0.14, n));
  // Each crack region flares now and then (a slow random flicker per cell).
  float cell = hash12(floor(rel * 1.5));
  float zap = 0.35 + 0.65 * pow(max(0.0, sin(uSkyT * 0.6 + cell * 6.28)), 6.0);
  vec3 cloudC = srgb(vec3(0.045, 0.008, 0.02));
  vec3 hotC = srgb(vec3(1.0, 0.18, 0.28)) * uPulse;
  vec3 c = mix(col, cloudC, body);
  c += hotC * (rim * 0.9 + crack * zap * 2.2);
  return mix(col, c, fade);
}

// ── extra · vortex eye above the pillar ───────────────────────────────────

vec3 vortex(vec3 d, vec3 col) {
  if (dot(d, uVDir) < 0.0) return col;
  vec2 uv = vec2(dot(d, uVT), dot(d, uVB)) / 0.55;
  float r = length(uv);
  float T = uSkyT;
  // Rings turn by an angle that grows inward: spiral arms (rotation keeps it seam-free).
  float a = 2.4 * log(r + 0.04) - T * 0.06 / (r + 0.35);
  vec2 q = rot(a) * uv;
  float n = fbm(q * 1.7 + 4.0);
  n += (vnoise(q * 14.0) - 0.5) * 0.12;
  float cut = mix(0.62, 0.42, smoothstep(1.6, 0.4, r)); // denser toward the eye
  float w = fwidth(n) + 1e-3;
  float body = smoothstep(cut - w, cut + w, n);
  float rim = smoothstep(cut - 0.07, cut, n) * (1.0 - body);
  float far = smoothstep(2.4, 1.2, r) * smoothstep(0.02, 0.18, d.y);
  // The eye: an open hole right above the crown, hot only at its lip and
  // dark in the middle, so it reads as a hole, not a ball (or a second sun).
  float eye = 1.0 - smoothstep(0.12, 0.155, r);
  vec3 eyeC = mix(srgb(vec3(0.07, 0.006, 0.012)), srgb(vec3(1.0, 0.2, 0.1)) * 1.3, smoothstep(0.085, 0.15, r)) * uPulse;
  body *= 1.0 - eye;
  rim *= 1.0 - eye;
  vec3 c = mix(col, eyeC, eye);
  c += srgb(vec3(0.6, 0.06, 0.06)) * exp(-r * 4.0) * 0.1;  // the eye's glow on the surrounding sky
  c = mix(c, srgb(vec3(0.045, 0.008, 0.016)), body);
  c += srgb(vec3(1.0, 0.16, 0.16)) * rim * 0.6 * mix(1.0, 0.4, smoothstep(0.3, 1.5, r)) * uPulse;
  return mix(col, c, far);
}

// ── the dome ──────────────────────────────────────────────────────────────

// The heavy features are picked by compile-time defines (FOCAL, CEIL, SPECKS,
// AURORA, set from the HUD), so each look compiles and runs only its own code
// instead of one huge branchy shader (slow to compile on D3D, register-heavy).
vec3 focal(vec3 d, vec3 col, out float mask) {
  mask = 0.0;
#if FOCAL == 1
  return redSun(d, col, mask);
#elif FOCAL == 2
  return blackSun(d, col, mask);
#elif FOCAL == 3
  return moon(d, col, false, mask);
#elif FOCAL == 4
  return moon(d, col, true, mask);
#elif FOCAL == 5
  return celDisc(d, col, mask);
#else
  return col;
#endif
}

vec3 ditherDisplay(vec3 lin) {
  if (uDither < 0.5) return lin;
  vec2 p = gl_FragCoord.xy + (uDither > 1.5 && uDither < 2.5 ? 0.0 : 5.588238 * mod(uFrame, 64.0));
  float n = ign(p) + ign(p + vec2(37.0, 17.0)) - 1.0; // triangular PDF, -1 … 1
  vec3 nn = vec3(n);
  if (uDither > 2.5) nn = vec3(n, ign(p + vec2(11.0, 53.0)) + ign(p + vec2(71.0, 29.0)) - 1.0, ign(p + vec2(5.0, 91.0)) + ign(p + vec2(43.0, 7.0)) - 1.0);
  vec3 s = pow(max(lin, 0.0), vec3(1.0 / 2.2)); // ≈ display space
  s += nn / 255.0;
  return pow(max(s, 0.0), vec3(2.2));
}

void main() {
  vec3 d = normalize(vDir);
  if (uOcclusion > 0.5) {
    // God-ray buffer: only the focal light (a black sun writes its ring only).
    float m = 0.0;
    vec3 c = focal(d, vec3(0.0), m);
    gl_FragColor = vec4(uGlowCol * m, 1.0);
    return;
  }
  vec3 low = mix(ramp(0.0), uLipCol, uLip * 0.6);
  if (d.y < -0.03) { gl_FragColor = vec4(low * 0.85, 1.0); return; } // the dunes cover it anyway
  vec3 col = baseSky(d);
  col = heatBand(d, col);

  // Glow round the focal direction (two HG lobes: broad wash + tighter heat).
  float mu = dot(d, uFDir);
  col += uGlowCol * uGlow * (hg(mu, 0.55) * 0.5 + hg(mu, 0.88) * 0.06) * mix(1.0, uPulse, 0.5);

#if SPECKS == 1
  {
    // Sparse: a few bright stars plus a fainter dust of small ones.
    float stars = starLayer(d, 90.0, 0.02, 1.2, vec3(0.0), 3.0) + starLayer(d, 260.0, 0.012, 0.9, vec3(0.0), 2.0) * 0.4;
    float lum = dot(col, vec3(0.3, 0.6, 0.1));
    stars *= 1.0 - smoothstep(0.03, 0.12, lum);
    col += srgb(vec3(1.0, 0.82, 0.8)) * stars * 1.1;
  }
#endif
  if (uRays > 0.0) col = sunRays(d, col);
  if (uHalo > 0.0) col = halo22(d, col);
  float fm = 0.0;
  col = focal(d, col, fm);
#if AURORA == 1
  col = aurora(d, col);
#endif
#if CEIL == 3
  col = vortex(d, col);
#elif CEIL == 2
  col = tornClouds(d, col);
#elif CEIL == 1
  col = churnCeiling(d, col);
#endif

#if SPECKS >= 2
  {
    // Dark soot specks; "falling ash" lets the whole lattice sink slowly.
#if SPECKS == 3
    vec3 drift = vec3(sin(uSkyT * 0.11) * 0.6, uSkyT * 0.9, 0.0);
#else
    vec3 drift = vec3(0.0);
#endif
    float sp = starLayer(d, 120.0, 0.07, 2.2, drift, 1.0) + starLayer(d, 300.0, 0.05, 1.4, drift * 2.0, 1.0) * 0.7;
    col *= 1.0 - 0.75 * clamp(sp, 0.0, 1.0) * smoothstep(0.0, 0.08, d.y);
  }
#endif

  // Hidden bases: the bottom few degrees melt into the horizon colour.
  col = mix(col, low, (1.0 - smoothstep(0.0, 0.07, d.y)) * uSwallow);
  if (d.y < 0.0) col = low * 0.85;
  gl_FragColor = vec4(ditherDisplay(col), 1.0);
}
`;

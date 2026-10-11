// COPIED from .claude/pages/ad/experiments/hell-src/scene/dunes-field.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * The dune field for the full scene (hell-20). A LEAN COPY of
 * hell-08-dunes-field.ts (that file stays untouched): only the parts the
 * curated options use, plus two changes so the dunes fit the shared LAYOUT.
 *
 *   1. The ground under the pillar's dish and under the bones' bed sits
 *      exactly at LAYOUT.groundY (the experiment sank the whole field).
 *   2. The bones' bed only gets low drifts, so the ribcage stays readable.
 *
 * ONE height function (`duneH`, GLSL) drives everything: the vertex shader
 * lifts a dense grid with it and the fragment shader takes a per-pixel
 * normal from it by finite differences, so crests stay crisp.
 *
 *   shape   0 swell (domain-warped sine)  2 pillow (Worley domes)
 *   ripple  0 none  6 soft swell bands (AoT's sea of sand)
 *   shade   0 soft wrap  1 Journey contrast
 *   crest   0 off  1 fresnel rim  3 crest pink wash
 *   ground  0 clean  1 Voronoi crust cracks (glowing seams)
 *
 * Colours are uniforms the dunes class fills from the scene palette; the
 * far field tints toward uFarCol (palette.sand.far) before the fog, so the
 * hazy ranges are their own colour, not the near sand fogged.
 */

import * as THREE from 'three';
import { ENV_GLSL, type EnvUniforms } from '../../env-src/lab';

export type FieldPlacement = {
  /** World xz of the pillar and the radius of its flat dish. */
  pillar: THREE.Vector2;
  dishR: number;
  /** World xz of the bones and the radius of their low-drift bed. */
  bones: THREE.Vector2;
  bedR: number;
  /** World xz of the camera: the low ledge the eye stands on. */
  eye: THREE.Vector2;
  /** Ground height (m) under the pillar and the bones. */
  groundY: number;
};

export function createFieldUniforms(place: FieldPlacement) {
  return {
    uShape: { value: 0 },
    // Ridges run across the wind; the wind blows away from the camera, a little right.
    uDuneWind: { value: new THREE.Vector2(0.45, -1).normalize() },
    uPillar: { value: place.pillar.clone() },
    uDishR: { value: place.dishR },
    // Height of the dish's raised lip: it hides the pillar's foot from the low eye.
    uLipH: { value: 12 },
    uBones: { value: new THREE.Vector3(place.bones.x, place.bones.y, place.bedR) },
    uCamXZ: { value: place.eye.clone() },
    uGroundY: { value: place.groundY },
    // Dunes grow from small near the eye to full size this far out.
    uNearR: { value: 180 },
    // The far field rises into big hazy sand ranges that hide the horizon.
    uFarRise: { value: 1 },
    uAmp: { value: 15 },
    uLambda: { value: 135 },
    uMotion: { value: 1 },
    uFogCol: { value: new THREE.Color('#3a0c10') },
    uFogDen: { value: 0.0016 },
    // The look (fragment only).
    uRipple: { value: 0 },
    uRipL: { value: 9 },
    uRipAmp: { value: 0.4 },
    uShade: { value: 0 },
    uCrest: { value: 1 },
    uGrain: { value: 0 },
    uGlintRate: { value: 0.06 },
    uGround: { value: 0 },
    uGlow: { value: 0 },
    uDuneL: { value: new THREE.Vector3(-0.45, 0.38, -0.8).normalize() },
    uLit: { value: new THREE.Color('#9a3424') },
    uMid: { value: new THREE.Color('#d0391f') },
    uShadow: { value: new THREE.Color('#4a1210') },
    uTrough: { value: new THREE.Color('#1e0608') },
    uCrestCol: { value: new THREE.Color('#e0705a') },
    uRimCol: { value: new THREE.Color('#ff6a4a') },
    uGlintCol: { value: new THREE.Color('#ffc8b0') },
    uChar: { value: new THREE.Color('#120403') },
    // The far ranges' own tint (aerial perspective before the fog).
    uFarCol: { value: new THREE.Color('#4a1210') },
    uGlowCore: { value: new THREE.Color('#ec8b15') },
    uGlowHalo: { value: new THREE.Color('#bf2a10') },
  };
}
export type FieldUniforms = ReturnType<typeof createFieldUniforms>;

/** The shared height function and its helpers. Needs ENV_GLSL first. */
const FIELD_GLSL = /* glsl */ `
uniform float uShape;
uniform vec2 uDuneWind;
uniform vec2 uPillar;
uniform float uDishR;
uniform float uLipH;
uniform vec3 uBones;
uniform vec2 uCamXZ;
uniform float uGroundY;
uniform float uNearR;
uniform float uFarRise;
uniform float uAmp;
uniform float uLambda;
uniform float uMotion;
uniform vec3 uFogCol;
uniform float uFogDen;

const float TAU = 6.28318530718;

// Value noise with its gradient (iq): returns (value, d/dx, d/dy).
vec3 vnoiseD(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  float k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y,
              du * vec2(b - a + k * u.y, c - a + k * u.x));
}
// Three octaves, same as ENV_GLSL's fbm3, plus the gradient.
vec3 fbm3D(vec2 p) {
  float s = 0.0;
  vec2 g = vec2(0.0);
  float a = 0.5;
  mat2 m = mat2(1.0);
  for (int i = 0; i < 3; i++) {
    vec3 n = vnoiseD(p);
    s += a * n.x;
    g += a * (n.yz * m);
    p = FBM_ROT * p;
    m = FBM_ROT * m;
    a *= 0.5;
  }
  return vec3(s, g) / 0.875;
}

// Warp: how far the crests meander (in periods). Returns (warp, d/dx, d/dz).
vec3 duneWarpD(vec2 p) {
  vec2 Wp = vec2(-uDuneWind.y, uDuneWind.x);
  vec3 f = fbm3D(p * 0.004 + 1.3);
  float s = dot(p, Wp) * 0.006;
  return vec3(0.6 * (f.x - 0.5) + 0.12 * sin(s), 0.6 * 0.004 * f.yz + 0.12 * 0.006 * cos(s) * Wp);
}
// Big: a slow swell, so some dunes are taller and the field rolls.
vec3 duneBigD(vec2 p) {
  vec3 f = fbm3D(p * 0.0016 + 3.7);
  return vec3(f.x, f.yz * 0.0016);
}

// Pillow mounds: the nearest jittered cell point (Worley F1), in world xz.
vec2 pillowCell(vec2 p) {
  float cell = uLambda * 0.85;
  vec2 q = p / cell;
  vec2 i = floor(q);
  vec2 f = fract(q);
  float best = 8.0;
  vec2 bp = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = 0.2 + 0.6 * hash22(i + g);
      vec2 r = g + o - f;
      float dd = dot(r, r);
      if (dd < best) { best = dd; bp = i + g + o; }
    }
  }
  return bp * cell;
}
vec2 pillowPoint(vec2 p) { return uShape > 1.5 ? pillowCell(p) : vec2(0.0); }

// 1 where the ground must sit at groundY (the pillar's dish, the bones' bed).
float duneKeep(vec2 p) {
  float dish = 1.0 - smoothstep(uDishR, uDishR * 1.9, length(p - uPillar));
  float bed = 1.0 - smoothstep(uBones.z * 0.6, uBones.z * 1.9, length(p - uBones.xy));
  return max(dish, bed);
}
// Near the eye the dunes are small (the ledge it stands on) ...
float duneNear(vec2 p) {
  float dc = length(p - uCamXZ);
  return mix(mix(0.0, 0.08, smoothstep(2.0, 20.0, dc)), 1.0, smoothstep(10.0, uNearR, dc));
}
// ... the open field drops away below it, so the crests sit under the eye
// line and stack up as depth planes, and far out it rises again into tall
// hazy ranges. The dish and the bed stay at groundY. Returns metres DOWN.
float duneSink(vec2 p) {
  float dc = length(p - uCamXZ);
  float s = uAmp * 2.0 * smoothstep(20.0, 110.0, dc) - uFarRise * 150.0 * smoothstep(450.0, 1500.0, dc);
  return s * (1.0 - duneKeep(p));
}
// 0 in a trough … 1 on a crest, from a height above groundY.
float duneRel(vec2 p, float h) {
  return clamp((h + duneSink(p)) / (uAmp * 1.8 * duneNear(p)), 0.0, 1.0);
}

// The height before the sink, given the slow fields at p (and its dome).
float duneHFrom(vec2 p, float warp, float big, vec2 dome) {
  float ph = dot(p, uDuneWind) / uLambda + warp;
  float h;
  if (uShape < 1.5) {
    h = 0.5 + 0.5 * sin(fract(ph) * TAU);
  } else {
    vec2 r = (p - dome) / (uLambda * 0.85);
    h = mix(exp(-dot(r, r) * 3.4), 0.5 + 0.5 * sin(ph * TAU), 0.2);
  }
  h = h * uAmp * (0.4 + 1.2 * big) + big * uAmp * 0.9;
  // The pillar's dish: a flat floor and a raised lip that hides its foot.
  float d = length(p - uPillar);
  h *= smoothstep(uDishR * 0.85, uDishR * 2.1, d);
  float lip = (d - uDishR * 1.4) / (uDishR * 0.28);
  h += uLipH * exp(-lip * lip);
  // The bones' bed: lower drifts, so the ribcage reads (half buried, not hidden).
  h *= 1.0 - 0.65 * (1.0 - smoothstep(uBones.z * 0.5, uBones.z * 1.2, length(p - uBones.xy)));
  return h * duneNear(p);
}

// Fog that ends in the sky's own colour along the view ray, so the far
// ranges melt into the sky under any grade instead of standing as a band.
vec4 duneFog(vec3 worldPos) {
  vec3 dir = normalize(worldPos - cameraPosition);
  float dist = length(worldPos - cameraPosition);
  float f = 1.0 - exp(-pow(dist * uFogDen, 2.0));
  vec3 sky = skyGradient(normalize(vec3(dir.x, max(dir.y, 0.015), dir.z)));
  return vec4(mix(uFogCol, sky, mix(0.6, 1.0, f * f)), f);
}
`;

const VERTEX = /* glsl */ `
${ENV_GLSL}
${FIELD_GLSL}
varying vec3 vWorld;
varying vec4 vSlow;    // warp, big, band wobble, cloud shade
varying vec4 vSlowG;   // d(warp)/dxz, d(big)/dxz
varying vec4 vFog;     // fog colour (rgb) and amount (a)
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec2 p = w.xz;
  vec3 warpD = duneWarpD(p);
  vec3 bigD = duneBigD(p);
  vSlowG = vec4(warpD.yz, bigD.yz);
  float cloud = fbm3(p * 0.004 - uDuneWind * uTime * 0.006 * uMotion + 4.0);
  vSlow = vec4(warpD.x, bigD.x, fbm3(p * 0.012), cloud);
  w.y = uGroundY + duneHFrom(p, warpD.x, bigD.x, pillowPoint(p)) - duneSink(p);
  vWorld = w.xyz;
  vFog = duneFog(w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAGMENT = /* glsl */ `
${ENV_GLSL}
${FIELD_GLSL}
uniform float uRipple;
uniform float uRipL;
uniform float uRipAmp;
uniform float uShade;
uniform float uCrest;
uniform float uGrain;
uniform float uGlintRate;
uniform float uGround;
uniform float uGlow;
uniform vec3 uDuneL;
uniform vec3 uLit;
uniform vec3 uMid;
uniform vec3 uShadow;
uniform vec3 uTrough;
uniform vec3 uCrestCol;
uniform vec3 uRimCol;
uniform vec3 uGlintCol;
uniform vec3 uChar;
uniform vec3 uFarCol;
uniform vec3 uGlowCore;
uniform vec3 uGlowHalo;
varying vec3 vWorld;
varying vec4 vSlow;
varying vec4 vSlowG;
varying vec4 vFog;

// NOTE: no dFdx/dFdy/fwidth inside an if (ANGLE/D3D would flatten every
// branch); all derivatives are taken once at the top of main().

// Height above groundY at p + dp: the slow fields extended along their gradients.
float hAt(vec2 p, vec2 dp, vec2 dome) {
  return duneHFrom(p + dp, vSlow.x + dot(vSlowG.xy, dp), vSlow.y + dot(vSlowG.zw, dp), dome) - duneSink(p + dp);
}

// iq's exact Voronoi border distance (two passes): even-width cracks.
vec2 voronoiBorder(vec2 x) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + hash22(n + g) - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
  }
  md = 8.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 r = g + hash22(n + g) - f;
      if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
    }
  }
  return vec2(md, hash12(n + mg));
}

void main() {
  vec3 P = vWorld;
  vec2 p = P.xz;
  float dist = length(P - cameraPosition);
  vec3 V = normalize(cameraPosition - P);
  vec3 L = normalize(uDuneL);
  vec2 dpx = dFdx(p);
  vec2 dpy = dFdy(p);
  float px = max(length(abs(dpx) + abs(dpy)), 1e-4);   // metres per pixel here

  // Per-pixel normal from the height function itself (crisp crests).
  float e = clamp(dist * 0.002, 0.1, 2.5);
  vec2 dome = pillowPoint(p);
  float h0 = hAt(p, vec2(0.0), dome);
  float hx = hAt(p, vec2(e, 0.0), dome);
  float hz = hAt(p, vec2(0.0, e), dome);
  vec3 N = normalize(vec3(h0 - hx, e, h0 - hz));
  float hn = duneRel(p, h0);                      // 0 trough … 1 crest
  float dPillar = length(p - uPillar);

  // Soft swell bands: a true sine tilt of the normal, never geometry.
  float rippleVal = 0.0;
  if (uRipple > 5.5) {
    vec2 W = uDuneWind;
    vec2 Wp = vec2(-W.y, W.x);
    float ph = dot(p, W) / uRipL + 2.5 * vSlow.z + 0.6 * sin(dot(p, Wp) * 0.025);
    vec2 g = W / uRipL + 0.6 * 0.025 * cos(dot(p, Wp) * 0.025) * Wp;
    float fw = abs(dot(g, dpx)) + abs(dot(g, dpy));
    float mask = (1.0 - smoothstep(0.12, 0.3, fw)) * (1.0 - smoothstep(0.12, 0.25, 1.0 - N.y));
    vec2 gd = g / max(length(g), 1e-6);
    float f = fract(ph);
    N = normalize(N - vec3(gd.x, 0.0, gd.y) * cos(TAU * f) * uRipAmp * mask);
    rippleVal = 0.5 * sin(TAU * f) * mask;
  }

  // Shading: colour ramps, never grey.
  float d = dot(N, L);
  vec3 col;
  if (uShade < 0.5) {
    float wrapL = clamp((d + 0.25) / 1.25, 0.0, 1.0);
    col = mix(uShadow, uLit, smoothstep(0.1, 0.75, wrapL));
    col = mix(col, uMid, smoothstep(0.75, 1.0, wrapL) * 0.6);   // hot faces toward the light
  } else {
    vec3 Nc = normalize(vec3(N.x, N.y * 0.3, N.z));            // Journey's diffuse contrast
    col = mix(uShadow, uLit, clamp(4.0 * dot(Nc, L), 0.0, 1.0));
  }
  col *= 1.0 + rippleVal * 0.35;
  // Valleys sink toward the deep hue (painted occlusion).
  col = mix(uTrough, col, mix(0.3, 1.0, smoothstep(0.0, 0.55, hn)));
  // Drifting cloud shade: big slow patches.
  col *= mix(1.0, 0.72, smoothstep(0.5, 0.62, vSlow.w));

  // Crest light: rim only faces tilting away from the eye more than flat sand.
  float away = V.y - dot(N, V);
  float fres = smoothstep(0.0, 0.3, away) * smoothstep(0.1, 0.5, hn);
  float fwd = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  if (uCrest > 0.5) col += uRimCol * fres * (0.2 + 1.3 * fwd) * 0.7;
  if (uCrest > 2.5) col = mix(col, uCrestCol, smoothstep(0.35, 1.0, hn) * (0.3 + 0.7 * fres) * 0.9);

  // Sparkle: hashed grain mirrors in world cells.
  if (uGrain > 0.5) {
    float dens = 2.5;
    vec2 cp = p * dens;
    vec2 cell = floor(cp);
    float roll = floor(uTime * 1.5 * uMotion);
    vec2 r2 = hash22(cell + roll * 17.0);
    vec3 G = normalize(vec3(r2.x - 0.5, 0.25, r2.y - 0.5) + N * 0.5);
    float s = smoothstep(0.86, 0.99, dot(reflect(-L, G), V));
    s *= step(1.0 - uGlintRate, hash12(cell + roll * 31.0 + 3.1));
    vec2 spot = hash22(cell + 9.7) * 0.6 + 0.2;
    float rad = max(0.07, px * dens * 0.7);
    s *= 1.0 - smoothstep(rad * 0.4, rad, length(fract(cp) - spot));
    s *= 1.0 - smoothstep(0.35, 0.8, px * dens);
    col += uGlintCol * s * 5.0 * (0.4 + 0.6 * smoothstep(-0.1, 0.3, d));
  }

  // Crust cracks: dried plates in the troughs, the dish and the eye's ledge;
  // only the big plate seams glow, the fine crazing stays dark.
  if (uGround > 0.5) {
    float smask = max(1.0 - smoothstep(0.06, 0.28, hn), 1.0 - smoothstep(uDishR * 0.8, uDishR * 1.05, dPillar));
    smask = max(smask, 1.0 - smoothstep(35.0, 80.0, length(p - uCamXZ)));
    if (smask > 0.01) {
      vec2 vb = voronoiBorder(p / 9.0);
      vec2 vb2 = vec2(8.0, 0.0);
      if (px < 0.3) vb2 = voronoiBorder(p / 2.6 + 3.7);   // fine crazing, near only
      float sd = min(vb.x * 9.0, vb2.x * 2.6 + 0.12 + smoothstep(0.2, 0.3, px) * 8.0);
      float gsd = vb.x * 9.0;
      float sw = 0.16 * (0.4 + vnoise(p * 0.2));
      float along = vb.y * 40.0 + dot(p, vec2(0.05));
      float line = 1.0 - smoothstep(sw, sw + px, sd);
      float far = 1.0 - smoothstep(sw * 2.0, sw * 10.0, px);
      col *= 1.0 - 0.4 * exp(-sd / (sw * 5.0 + 0.4)) * smask * far;     // scorched halo
      col = mix(col, uChar, line * 0.92 * smask * far);
      if (uGlow > 0.0) {
        float flick = 0.75 + 0.25 * vnoise(vec2(uTime * 2.0 * uMotion + along * 0.3, along));
        float pulse = (0.65 + 0.35 * sin(uTime * 1.5 * uMotion - along * 0.2)) * flick;
        float gline = 1.0 - smoothstep(sw, sw + px, gsd);
        vec3 em = uGlowCore * gline * 3.0 * mix(1.0, 0.5, 1.0 - far)
                + uGlowHalo * exp(-gsd / (sw * 3.0 + 0.5)) * 0.9 * 0.35
                + uGlowHalo * exp(-gsd / 4.0) * 0.25 * 0.35;           // light spill onto the sand
        col += em * pulse * uGlow * smask;
      }
    }
  }

  // Far ranges: their own hue (palette sand.far), still shaded by the light.
  float farT = smoothstep(380.0, 1300.0, dist);
  vec3 farC = uFarCol * (0.55 + 0.6 * smoothstep(-0.2, 0.8, d));
  col = mix(col, farC, farT * 0.75);

  col = mix(col, vFog.rgb, vFog.a);
  gl_FragColor = vec4(col, 1.0);
}
`;

/** A grid whose spacing is fine near (cx, cz) and grows outward (u + u^5). */
function warpedGrid(n: number, half: number, cx: number, cz: number) {
  const warp = (u: number) => half * (0.2 * u + 0.8 * u ** 5);
  const positions = new Float32Array((n + 1) * (n + 1) * 3);
  let k = 0;
  for (let j = 0; j <= n; j++) {
    const z = cz + warp(-1 + (2 * j) / n);
    for (let i = 0; i <= n; i++) {
      positions[k++] = cx + warp(-1 + (2 * i) / n);
      positions[k++] = 0;
      positions[k++] = z;
    }
  }
  const index = new Uint32Array(n * n * 6);
  k = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + n + 1;
      const d = c + 1;
      index[k++] = a;
      index[k++] = c;
      index[k++] = b;
      index[k++] = b;
      index[k++] = c;
      index[k++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

/** The dune mesh. `centre` is where the grid is densest (world xz). */
export function createDuneMesh(env: EnvUniforms, U: FieldUniforms, centre: THREE.Vector2) {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env, ...U },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
  const mesh = new THREE.Mesh(warpedGrid(352, 1800, centre.x, centre.y), material);
  mesh.name = 'dunes';
  mesh.frustumCulled = false;
  return mesh;
}

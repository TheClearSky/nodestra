// COPIED from .claude/pages/ad/experiments/hell-src/scene/sky.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Sky class: the sky dome and its focal light (black sun / big sun / none).
 * Colour comes from the scene palette (scene/palette.ts, the "Colour" row):
 * the dome ramp is palette.sky (zenith → mid → horizon), the focal glow is
 * palette.sky.glow, and every option only keeps its SHAPE (eclipse, torn
 * masses, big disc, aurora fan). The shared environment, lights and fog are
 * colour.ts's; this class never writes them, it only meets them at the
 * horizon (the dome's horizon is the palette horizon, its lip the haze).
 *
 * The dome shader is IMPORTED read-only from hell-04-sky-dome-glsl.ts and
 * patched IN MEMORY (its hard-coded reds become palette uniforms); the
 * presets' shapes are COPIED from hell-04-sky-dome.ts (never imported: that
 * module is the experiment's page and would start its own lab). The options
 * are the four looks the hell-04 review called strongest, each a different
 * technique: an eclipse focal, a torn cloud ceiling, a huge low sun, and an
 * aurora fan over a starry night.
 */

import * as THREE from 'three';
import { SKY_FRAGMENT, SKY_VERTEX } from '../hell-04-sky-dome-glsl';
import type { AssetFactory, AssetOption } from './contract';
import type { ScenePalette } from './palette';
import { makeRampTexture, okHue, okMix, okShade, writeRamp, type Stop } from './sky-ramp';

/** Where the focal light sits, seen from the layout camera. */
type Aim = 'circles' | 'lowBehindPillar' | 'horizon';

/** How the option reads the palette ramp: a night darkens it, the hot haze brightens its foot. */
type Mood = 'night' | 'open' | 'haze' | 'deepNight';

type SkyOption = AssetOption & {
  mood: Mood;
  rampPow: number;
  lip: number;
  swallow: number;
  /** Compile-time switches of the hell-04 shader. */
  focal: number; // 0 none, 1 big sun disc, 2 black sun
  ceiling: number; // 0 none, 2 torn clouds
  specks: number; // 0 none, 1 stars, 2 dark specks
  aurora: number;
  aim: Aim;
  /** World point the torn clouds swirl round / the aurora fans out from. */
  root: 'crown' | 'circles';
  /** Angular radius of the focal disc (radians). */
  radius: number;
  glow: number;
  hband: number;
};

// Shapes from hell-04 PRESETS (blackSun, torn, redSun, aurora); colours from the palette.
const OPTIONS: SkyOption[] = [
  {
    id: 'eclipse',
    label: 'Black sun eclipse',
    description: 'The palette sky, darkened to night, with a black sun and a flickering flame ring in the palette glow, framed by the magic circles behind the pillar; dark soot specks.',
    source: 'hell-04 design:blackSun',
    mood: 'night', rampPow: 0.45, lip: 0.2, swallow: 0.6,
    focal: 2, ceiling: 0, specks: 2, aurora: 0, aim: 'circles', root: 'crown', radius: 0.085,
    glow: 0.28, hband: 0,
  },
  {
    id: 'torn',
    label: 'Torn black clouds',
    description: 'The palette sky at full brightness, no sun: hard-cut near-black cloud masses stream outward round the pillar crown, rimmed and cracked in the palette glow.',
    source: 'hell-04 design:torn',
    mood: 'open', rampPow: 0.6, lip: 0.2, swallow: 0.5,
    focal: 0, ceiling: 2, specks: 0, aurora: 0, aim: 'horizon', root: 'crown', radius: 0.05,
    glow: 0.3, hband: 0,
  },
  {
    id: 'redSun',
    label: 'Huge low sun',
    description: 'A bright hot-haze sky: a giant disc in the palette glow low behind the pillar, its base swallowed by a glowing heat band.',
    source: 'hell-04 design:redSun',
    mood: 'haze', rampPow: 0.5, lip: 0.55, swallow: 0.85,
    focal: 1, ceiling: 0, specks: 0, aurora: 0, aim: 'lowBehindPillar', root: 'crown', radius: 0.3,
    glow: 0.55, hband: 0.55,
  },
  {
    id: 'aurora',
    label: 'Aurora fan',
    description: 'The darkest night: the palette sky deepened, sparse stars and a fan of waving aurora ribbons (glow at the root, the sky hue at the tips) rising from behind the magic circles.',
    source: 'hell-04 design:aurora',
    mood: 'deepNight', rampPow: 0.45, lip: 0.3, swallow: 0.6,
    focal: 0, ceiling: 0, specks: 1, aurora: 1, aim: 'horizon', root: 'circles', radius: 0.05,
    glow: 0.15, hband: 0,
  },
];

/** Every colour the dome uses for one option under one palette (sRGB hex). */
type Tones = {
  ramp: Stop[];
  lip: string;
  glow: string;
  hband: string;
  sunTop: string;
  sunFoot: string;
  ring: string;
  ringHalo: string;
  core: string;
  torn: string;
  tornHot: string;
  auroraRoot: string;
  auroraTip: string;
  stars: string;
};

function tonesFor(o: SkyOption, p: ScenePalette): Tones {
  const { zenith, mid, horizon, glow } = p.sky;
  // The foot of the ramp is ALWAYS the palette horizon and the lip is the
  // palette haze: colour.ts gives the env horizon/haze and the fog the same
  // family, so the dome, the fog and the far dunes meet without a line.
  let ramp: Stop[];
  if (o.mood === 'night') {
    ramp = [{ t: 0, hex: horizon }, { t: 0.3, hex: okShade(mid, 0.8) }, { t: 0.7, hex: okShade(zenith, 0.75) }, { t: 1, hex: okShade(zenith, 0.55) }];
  } else if (o.mood === 'deepNight') {
    ramp = [{ t: 0, hex: horizon }, { t: 0.25, hex: okShade(mid, 0.55) }, { t: 0.6, hex: okShade(zenith, 0.55) }, { t: 1, hex: okShade(zenith, 0.35) }];
  } else if (o.mood === 'haze') {
    ramp = [{ t: 0, hex: okMix(horizon, glow, 0.25) }, { t: 0.18, hex: okMix(horizon, mid, 0.45) }, { t: 0.5, hex: mid }, { t: 1, hex: zenith }];
  } else {
    ramp = [{ t: 0, hex: horizon }, { t: 0.3, hex: mid }, { t: 1, hex: zenith }];
  }
  return {
    ramp,
    lip: p.haze,
    glow: o.focal === 2 ? okMix(glow, mid, 0.4) : glow,
    hband: okMix(glow, horizon, 0.35),
    // Big disc: the glow at its foot (hotter, in the haze), a little of the sky's mid hue on top.
    sunTop: okMix(glow, mid, 0.3),
    sunFoot: glow,
    // Black sun: a flame ring in the glow, a halo between glow and sky, a core near-black in the zenith hue.
    // The shader drives the ring at 3.2x: hell-04's crimson ring had a luminance of ~0.16, so a pale
    // palette glow is darkened toward that (it must not blow out the circles in front of it).
    ring: okShade(okMix(glow, mid, 0.25), 0.75),
    ringHalo: okShade(okMix(glow, mid, 0.55), 0.55),
    core: okShade(zenith, 0.12),
    // Torn masses: near-black in the zenith hue; rim and cracks between the glow and the events light.
    torn: okShade(zenith, 0.14),
    // Rim / cracks / aurora root: darkened toward hell-04's emissive strength (its reds had luminance ~0.25).
    tornHot: okShade(okMix(glow, p.glow.events, 0.5), 0.8),
    auroraRoot: okShade(glow, 0.7),
    auroraTip: okHue(mid, 0.55, 0.17),
    stars: okMix('#ffffff', glow, 0.4),
  };
}

// The torn clouds' polar seam (atan's ±π line) points behind the pivot, down
// the frame's centre line here because the pillar top is above the frame. In
// this scene's COPY of the shader text it points toward the camera instead,
// overhead and out of view (the experiment's file is not touched).
// The other patches turn the experiment's hard-coded reds into uniforms the
// palette fills (same maths; only the colours change).
const PATCHES: [string, string][] = [
  ['float ang = atan(rel.x, rel.y);', 'float ang = atan(rel.x, -rel.y);'],
  ['uniform vec3 uViolet;', 'uniform vec3 uViolet;\nuniform vec3 uSunTop, uSunFoot, uRingC, uRingHaloC, uCoreC, uTornC, uTornHot, uAurRoot, uAurTip, uStarC;'],
  ['mix(srgb(vec3(0.94, 0.50, 0.38)), srgb(vec3(0.96, 0.72, 0.46)) * 1.25,', 'mix(uSunTop, uSunFoot * 1.25,'],
  ['vec3 ringC = srgb(vec3(0.86, 0.06, 0.22));', 'vec3 ringC = uRingC;'],
  ['vec3 haloC = srgb(vec3(0.36, 0.06, 0.16));', 'vec3 haloC = uRingHaloC;'],
  ['vec3 core = srgb(vec3(0.03, 0.004, 0.012));', 'vec3 core = uCoreC;'],
  ['vec3 cloudC = srgb(vec3(0.045, 0.008, 0.02));', 'vec3 cloudC = uTornC;'],
  ['vec3 hotC = srgb(vec3(1.0, 0.18, 0.28)) * uPulse;', 'vec3 hotC = uTornHot * uPulse;'],
  ['mix(srgb(vec3(1.0, 0.18, 0.10)), srgb(vec3(0.7, 0.08, 0.38)), smoothstep(0.05, 0.7, r));', 'mix(uAurRoot, uAurTip, smoothstep(0.05, 0.7, r));'],
  ['col += srgb(vec3(1.0, 0.82, 0.8)) * stars * 1.1;', 'col += uStarC * stars * 1.1;'],
];
let FRAGMENT = SKY_FRAGMENT;
for (const [from, to] of PATCHES) {
  if (FRAGMENT.includes(from)) FRAGMENT = FRAGMENT.replace(from, to);
  else console.error(`[hell-20 sky] shader patch not found: ${from}`);
}

const UP = new THREE.Vector3(0, 1, 0);
const dirFrom = (az: number, el: number) => new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
/** Orthonormal frame round a sky direction: t = right on the sky, b = up. */
function frame(c: THREE.Vector3, t: THREE.Vector3, b: THREE.Vector3) {
  t.crossVectors(c, UP).normalize();
  b.crossVectors(t, c).normalize();
}

export const create: AssetFactory = ({ lab, backdrop, scene, camera, layout, palette }) => {
  // Hide the stand-in dome: this class brings the sky.
  backdrop.group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry instanceof THREE.SphereGeometry) o.visible = false;
  });

  const rampTex = makeRampTexture();
  const colour = () => new THREE.Color();
  const u = {
    uRamp: { value: rampTex },
    uSkyT: { value: 0 },
    uPulse: { value: 1 },
    uRampPow: { value: 0.45 },
    uLip: { value: 0.3 },
    uLipCol: { value: colour() },
    uSwallow: { value: 0.6 },
    uBandMode: { value: 0 }, // smooth ramp
    uBandN: { value: 5 },
    uWobble: { value: 0.035 },
    uDither: { value: 1 }, // moving IGN dither: no 8-bit contour lines
    uFDir: { value: new THREE.Vector3(0, 0, -1) },
    uFT: { value: new THREE.Vector3(1, 0, 0) },
    uFB: { value: new THREE.Vector3(0, 1, 0) },
    uFSin: { value: 0.1 },
    uGlow: { value: 0 },
    uGlowCol: { value: colour() },
    uSpin: { value: new THREE.Matrix3() },
    uMoonLight: { value: new THREE.Vector3(-0.7, 0.45, 0.55).normalize() },
    uCeilEdge: { value: 0.17 },
    uCrown: { value: new THREE.Vector3(0, 0.4, -1).normalize() },
    uCT: { value: new THREE.Vector3(1, 0, 0) },
    uCB: { value: new THREE.Vector3(0, 1, 0) },
    uVDir: { value: new THREE.Vector3(0, 0.5, -1).normalize() },
    uVT: { value: new THREE.Vector3(1, 0, 0) },
    uVB: { value: new THREE.Vector3(0, 1, 0) },
    uAurora: { value: 0 },
    uRays: { value: 0 },
    uHalo: { value: 0 },
    uDog1: { value: new THREE.Vector3(0, 0, -1) },
    uDog2: { value: new THREE.Vector3(0, 0, -1) },
    uHBand: { value: 0 },
    uHBandCol: { value: colour() },
    uSplit: { value: 0 },
    uWarm: { value: colour() },
    uViolet: { value: colour() },
    // Palette colours of the patched features.
    uSunTop: { value: colour() },
    uSunFoot: { value: colour() },
    uRingC: { value: colour() },
    uRingHaloC: { value: colour() },
    uCoreC: { value: colour() },
    uTornC: { value: colour() },
    uTornHot: { value: colour() },
    uAurRoot: { value: colour() },
    uAurTip: { value: colour() },
    uStarC: { value: colour() },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: { ...lab.env, ...u },
    // Heavy parts are compile-time switches: each option runs only its own code.
    defines: { FOCAL: 0, CEIL: 0, SPECKS: 0, AURORA: 0 },
    vertexShader: SKY_VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 64, 32), material);
  dome.name = 'scene-sky';
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  dome.onBeforeRender = (_r, _s, cam) => dome.position.copy(cam.position);
  scene.add(dome);

  // Directions seen from the layout camera (the sky is at infinity).
  const eye = new THREE.Vector3(...layout.camera.position);
  const toward = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).sub(eye).normalize();
  const pillarAz = Math.atan2(layout.pillar.x - eye.x, eye.z - layout.pillar.z);
  const aimDir = (aim: Aim) =>
    aim === 'circles' ? toward(layout.circles.x, layout.circles.y, layout.circles.z)
    : aim === 'lowBehindPillar' ? dirFrom(pillarAz, 0.1)
    : dirFrom(pillarAz, 0.12);
  // The pillar top sits above the frame, so the aurora roots lower, at the circles' centre.
  const roots = {
    crown: new THREE.Vector3(layout.pillar.x, layout.groundY + layout.pillar.height, layout.pillar.z),
    circles: new THREE.Vector3(layout.circles.x, layout.circles.y, layout.circles.z),
  };

  let current = OPTIONS[0];
  let pal = palette.current();
  let tones = tonesFor(current, pal);

  // Colours only: uniform writes and one ramp re-upload, never a recompile.
  const recolour = () => {
    tones = tonesFor(current, pal);
    writeRamp(rampTex, tones.ramp);
    u.uLipCol.value.set(tones.lip);
    u.uGlowCol.value.set(tones.glow);
    u.uHBandCol.value.set(tones.hband);
    u.uSunTop.value.set(tones.sunTop);
    u.uSunFoot.value.set(tones.sunFoot);
    u.uRingC.value.set(tones.ring);
    u.uRingHaloC.value.set(tones.ringHalo);
    u.uCoreC.value.set(tones.core);
    u.uTornC.value.set(tones.torn);
    u.uTornHot.value.set(tones.tornHot);
    u.uAurRoot.value.set(tones.auroraRoot);
    u.uAurTip.value.set(tones.auroraTip);
    u.uStarC.value.set(tones.stars);
  };

  const apply = (o: SkyOption) => {
    u.uRampPow.value = o.rampPow;
    u.uLip.value = o.lip;
    u.uSwallow.value = o.swallow;
    u.uFDir.value.copy(aimDir(o.aim));
    frame(u.uFDir.value, u.uFT.value, u.uFB.value);
    u.uFSin.value = Math.sin(o.radius);
    u.uGlow.value = o.glow;
    // Aurora toned down from 1: it must not outshine the magic circles at its root.
    u.uAurora.value = o.aurora * 0.7;
    u.uHBand.value = o.hband;
    const next = { FOCAL: o.focal, CEIL: o.ceiling, SPECKS: o.specks, AURORA: o.aurora };
    const cur = material.defines as Record<string, number>;
    if (!Object.keys(next).every((k) => cur[k] === next[k as keyof typeof next])) {
      material.defines = { ...next };
      material.needsUpdate = true;
    }
    recolour();
  };
  apply(current);
  palette.subscribe((p) => {
    pal = p;
    recolour();
  });

  let skyT = 0;
  const tmp = new THREE.Vector3();

  return {
    id: 'sky',
    label: 'Sky',
    options: OPTIONS.map(({ id, label, description, source }) => ({ id, label, description, source })),
    setOption(id) {
      current = OPTIONS.find((o) => o.id === id) ?? OPTIONS[0];
      apply(current);
    },
    update(_t, dt) {
      skyT += dt;
      u.uSkyT.value = skyT;
      // Root direction from the live camera (torn-cloud swirl, aurora root).
      u.uCrown.value.copy(tmp.copy(roots[current.root]).sub(camera.position).normalize());
      frame(u.uCrown.value, u.uCT.value, u.uCB.value);
    },
    params() {
      const d = u.uFDir.value;
      const t = tones;
      const out: Record<string, string | number | boolean> = {
        option: current.id,
        palette: pal.id,
        ramp: t.ramp.map((s) => s.hex).join('→'),
        lip: t.lip,
        glow: t.glow,
        focal: ['none', 'sunDisc', 'blackSun'][current.focal] ?? 'none',
        ceiling: current.ceiling === 2 ? 'torn' : 'none',
        specks: ['none', 'stars', 'dark'][current.specks] ?? 'none',
        aurora: current.aurora === 1,
        focalAzDeg: +THREE.MathUtils.radToDeg(Math.atan2(d.x, -d.z)).toFixed(1),
        focalElDeg: +THREE.MathUtils.radToDeg(Math.asin(d.y)).toFixed(1),
        focalRadiusDeg: +THREE.MathUtils.radToDeg(current.radius).toFixed(1),
      };
      if (current.focal === 2) Object.assign(out, { ring: t.ring, ringHalo: t.ringHalo, core: t.core });
      if (current.focal === 1) Object.assign(out, { discTop: t.sunTop, discFoot: t.sunFoot, heatBand: t.hband });
      if (current.ceiling === 2) Object.assign(out, { masses: t.torn, rim: t.tornHot });
      if (current.aurora === 1) Object.assign(out, { auroraRoot: t.auroraRoot, auroraTip: t.auroraTip, stars: t.stars });
      return out;
    },
  };
};

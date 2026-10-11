// COPIED from .claude/pages/ad/experiments/hell-src/scene/events.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Events class: light shafts and sky events, from hell-11-sky-events.
 *
 *   storm      physical weather: branched blue-white lightning with a local
 *              sky flash, now and then a meteor with a smoke trail that hits
 *              the horizon (random, every 8–20 s)
 *   discharge  the magic circles discharge: a crimson flash at the circle
 *              centre, hairline shock rings racing out over the sky, then a
 *              crimson bolt dropping out of the circle (every 14–28 s)
 *   shafts     no events: steady light shafts pouring down from a hidden
 *              source behind the pillar, breathing slowly
 *   none       a quiet sky
 *
 * The hell-11 helper modules (sky layer, fx uniforms, bolt, meteor) are
 * IMPORTED read-only; the event envelopes and the director are COPIED from
 * hell-11-sky-events.ts (its page module is never imported). No post passes
 * (only the post class adds those) and no grade/exposure changes (sky owns
 * colour): the flash lights the sky layer only.
 */

import * as THREE from 'three';
import { seededRandom } from '../../env-src/lab';
import { createBolt, createMeteor, type BoltStyle } from '../hell-11-sky-events-bolt';
import { createSkyLayer, makeFx } from '../hell-11-sky-events-world';
import type { AssetFactory, AssetOption } from './contract';
import { createShafts } from './events-shafts';
import type { ScenePalette } from './palette';
import { swapShaderText } from './particles-ground';

/**
 * The meteor's fire, smoke and head have hell-11's ember colours as
 * constants; on OUR material instances they become the palette's embers
 * (the experiment's module is untouched). The smoke is neutral.
 */
const METEOR_GLSL = 'uniform vec3 uEmberCol;\n';
const METEOR_SWAPS: [string, string][] = [
  ['srgb(vec3(0.48, 0.08, 0.08))', '(uEmberCol * 0.2)'],
  ['srgb(vec3(0.98, 0.43, 0.09))', 'uEmberCol'],
  ['srgb(vec3(1.0, 0.94, 0.47))', 'mix(uEmberCol, vec3(1.0), 0.75)'],
  ['srgb(vec3(0.2, 0.15, 0.14))', 'vec3(0.025)'],
  ['vec3(1.0, 0.75, 0.35) * g', 'mix(uEmberCol, vec3(1.0), 0.45) * g'],
];

/** A light colour's deep, saturated version (same hue): the glow round a bolt's white core. */
function deepen(out: THREE.Color, hex: string, lightness: number) {
  const hsl = { h: 0, s: 0, l: 0 };
  out.set(hex).getHSL(hsl);
  return out.setHSL(hsl.h, Math.max(hsl.s, 0.7), lightness);
}
const WHITE = new THREE.Color(1, 1, 1);

const OPTIONS: AssetOption[] = [
  {
    id: 'storm',
    label: 'Lightning & meteors',
    description:
      'Physical weather: branched blue-white bolts drop out of the sky beside the pillar with a local sky flash and restrikes; now and then a meteor streaks down to the horizon trailing fraying smoke. Random, every 8–20 s.',
    source: 'hell-11 fire:bolt bolt:branched + fire:meteor, director',
  },
  {
    id: 'discharge',
    label: 'Circle discharge',
    description:
      'Magic, not weather: a crimson flash at the magic-circle centre, a few hairline light/dark shock rings charging out over the sky, then a crimson bolt falling out of the circle. Every 14–28 s.',
    source: 'hell-11 fire:discharge + rings:hairline + bolt:crimson (no hit-frame pass)',
  },
  {
    id: 'shafts',
    label: 'Light shafts',
    description:
      'No events: steady god-ray shafts pour down from a hidden source high behind the pillar and fan toward the camera; each one breathes slowly, and the pillar, bones and islands cut them.',
    source: 'hell-11 rays:cards (cone cards, re-laid for the scene)',
  },
  {
    id: 'none',
    label: 'None',
    description: 'A quiet sky: no shafts and no events.',
    source: '—',
  },
];

type Kind = 'bolt' | 'meteor' | 'flash' | 'rings' | 'discharge';
const NEVER = -1e9;

// Lightning envelope (copied from hell-11): leader, 2-frame main flash,
// restrikes, afterglow.
const RESTRIKES: [number, number][] = [
  [0.26, 0.75],
  [0.5, 0.5],
  [0.86, 0.7],
  [1.3, 0.45],
  [1.62, 0.6],
  [2.1, 0.4],
];
const smooth = THREE.MathUtils.smoothstep;
function boltEnvelope(age: number) {
  if (age < 0 || age > 3.2) return { I: 0, flash: 0, reveal: 0 };
  const reveal = Math.min(1.05, age / 0.09 + 0.02);
  let spike = 0;
  if (age < 0.09) spike = 0.3;
  else if (age < 0.125) spike = 1;
  for (const [t0, amp] of RESTRIKES) if (age >= t0 && age < t0 + 0.07) spike = Math.max(spike, amp);
  const glow = 0.32 * (1 - smooth(age, 0.2, 2.9));
  const I = Math.max(spike, glow);
  const main = age < 0.125;
  const flash = spike > 0.29 ? spike * (main ? 1 : 0.5) : 0.06 * Math.exp(-age * 3);
  return { I, flash, reveal };
}

export const create: AssetFactory = ({ lab, scene, layout, palette }) => {
  const { env } = lab;
  const eye = new THREE.Vector3(...layout.camera.position);
  const { circles, pillar, groundY } = layout;
  // Direction from the camera to the magic-circle centre (the ring centre).
  const circleDir = new THREE.Vector3(circles.x, circles.y, circles.z).sub(eye).normalize();

  const fx = makeFx();
  const skyLayer = createSkyLayer(env, fx);
  const bolt = createBolt(env, fx);
  const meteor = createMeteor(env, fx);
  const eventCol = { value: new THREE.Color() };
  const shafts = createShafts(env, layout, eventCol);
  const emberCol = { value: new THREE.Color() };
  swapShaderText(meteor.group, METEOR_GLSL, METEOR_SWAPS, { uEmberCol: emberCol }, 'events');
  const group = new THREE.Group();
  group.name = 'events';
  group.add(skyLayer, bolt.mesh, meteor.group, shafts.mesh);
  scene.add(group);
  skyLayer.visible = false;
  bolt.mesh.visible = false;

  lab.onResize((w, h) => {
    bolt.uniforms.uRes.value.set(w, h);
    meteor.uRes.value.set(w, h);
    bolt.uniforms.uWidthPx.value = lab.pixelRatio;
  });

  // ── event state ──
  const rng = seededRandom(77);
  const started: Record<Kind, number> = { bolt: NEVER, meteor: NEVER, flash: NEVER, rings: NEVER, discharge: NEVER };
  let pending: { kind: Kind; at: number }[] = [];
  let current = 'storm';
  let now = 0;
  let nextAt = 0;
  let lastKind: Kind | '' = '';

  // ── colour: storm light from glow.events, the circle's discharge from
  // glow.circles, the meteor's fire from glow.embers ──
  const col = {
    storm: new THREE.Color(),
    stormCore: new THREE.Color(),
    stormGlow: new THREE.Color(),
    circle: new THREE.Color(),
    circleCore: new THREE.Color(),
    circleGlow: new THREE.Color(),
    ember: new THREE.Color(),
  };
  let boltFlash = col.storm;
  const paint = (p: ScenePalette) => {
    col.storm.set(p.glow.events);
    col.stormCore.set(p.glow.events).lerp(WHITE, 0.6);
    deepen(col.stormGlow, p.glow.events, 0.68);
    // the discharge flash: the circles' red, brightened toward a hot pink-white
    col.circle.set(p.glow.circles).lerp(WHITE, 0.12).multiplyScalar(1.3);
    col.circleCore.set(p.glow.circles).lerp(WHITE, 0.85);
    col.circleGlow.set(p.glow.circles).multiplyScalar(1.3);
    col.ember.set(p.glow.embers);
    emberCol.value.set(p.glow.embers);
    eventCol.value.set(p.glow.events);
    fx.uGlowColor.value.set(p.glow.embers);
    fx.uCoronaCol.value.set(p.glow.circles);
    // Ring hairlines: a pale light of the circles' hue (hell-11: #ffb0a0 × 0.22).
    fx.uRingLight.value.set(p.glow.circles).lerp(WHITE, 0.6).multiplyScalar(0.22);
    paintBolt();
  };
  const paintBolt = () => {
    const discharge = current === 'discharge';
    bolt.uniforms.uCore.value.copy(discharge ? col.circleCore : col.stormCore);
    bolt.uniforms.uGlow.value.copy(discharge ? col.circleGlow : col.stormGlow);
  };

  /** Storm bolt: beside the pillar (never behind it or the circle), dropping
   *  from just above the frame top. */
  function stormStrike() {
    const side = rng() < 0.5 ? -1 : 1;
    const az = side * (0.24 + rng() * 0.26);
    const d = 520 + rng() * 380;
    const top = new THREE.Vector3(eye.x + Math.sin(az) * d, 0, eye.z - Math.cos(az) * d);
    top.y = eye.y + d * 0.62;
    bolt.strike(rng, top, eye);
  }

  /** Discharge bolt: out of the lower part of the circle, to the ground. */
  function circleStrike() {
    const side = rng() < 0.5 ? -1 : 1;
    const top = new THREE.Vector3(circles.x + side * (50 + rng() * 70), circles.y - 40, circles.z + 60);
    top.y = Math.max(top.y, groundY + 120);
    bolt.strike(rng, top, eye);
  }

  function fire(kind: Kind) {
    started[kind] = now;
    if (kind === 'bolt') {
      if (current === 'discharge') circleStrike();
      else stormStrike();
    } else if (kind === 'meteor') {
      meteor.launch(rng, eye);
    } else if (kind === 'discharge') {
      // Anime beat: crimson flash, the rings charge out, then the bolt.
      started.flash = now;
      pending.push({ kind: 'rings', at: now + 0.1 }, { kind: 'bolt', at: now + 1.2 });
    }
  }

  function direct() {
    if (now < nextAt) return;
    if (current === 'storm') {
      // Mostly lightning; never two meteors in a row.
      const kind: Kind = lastKind !== 'meteor' && rng() < 0.3 ? 'meteor' : 'bolt';
      lastKind = kind;
      fire(kind);
      nextAt = now + 8 + rng() * 12;
    } else if (current === 'discharge') {
      fire('discharge');
      nextAt = now + 14 + rng() * 14;
    }
  }

  const tmp = new THREE.Vector3();
  const flashDir = new THREE.Vector3();
  const flashColor = new THREE.Color();

  function updateEvents() {
    for (const p of pending.filter((q) => now >= q.at)) fire(p.kind);
    pending = pending.filter((q) => now < q.at);

    let best = 0;
    let sum = 0;
    const addFlash = (I: number, dir: THREE.Vector3, color: THREE.Color) => {
      if (I <= 0) return;
      sum += I;
      if (I > best) {
        best = I;
        flashDir.copy(dir);
        flashColor.copy(color);
      }
    };

    // Lightning.
    const b = boltEnvelope(now - started.bolt);
    bolt.update(b.I, b.reveal);
    if (b.flash > 0) {
      tmp.copy(bolt.quad.position).sub(eye).normalize();
      addFlash(b.flash, tmp, boltFlash);
    }

    // Meteor + its horizon impact glow.
    const ma = now - started.meteor;
    meteor.update(ma);
    if (ma >= meteor.FALL && ma < meteor.FALL + 4.5) {
      const ia = ma - meteor.FALL;
      tmp.copy(meteor.impact()).sub(eye).normalize();
      fx.uHorizonGlow.value.set(tmp.x, tmp.y, tmp.z, smooth(ia, 0, 0.1) * (1 - smooth(ia, 0.3, 4.5)) * 1.6);
      addFlash(0.55 * Math.exp(-ia * 4), tmp, col.ember);
    } else fx.uHorizonGlow.value.w = 0;

    // Shock rings round the circle centre (+ their own crimson hit flash).
    const ra = now - started.rings;
    if (ra >= 0 && ra < 9.5) {
      const k = Math.min(ra / 6.5, 1);
      fx.uRingR.value = 0.04 + 1.5 * (1 - (1 - k) * (1 - k));
      fx.uRingAge.value = ra;
      fx.uRingAmp.value = smooth(ra, 0, 0.25) * (1 - smooth(ra, 6, 9.5));
      if (ra < 0.8) addFlash(0.9 * Math.exp(-ra * 6), circleDir, col.circle);
    } else fx.uRingAmp.value = 0;

    // The discharge's opening crimson flash.
    const xa = now - started.flash;
    if (xa >= 0 && xa < 0.6) addFlash(1.2 * Math.exp(-xa * 7), circleDir, col.circle);

    fx.uFlash.value.set(flashDir.x, flashDir.y, flashDir.z, Math.min(sum, 1.1));
    fx.uFlashColor.value.copy(flashColor);
    // The sky layer costs a pass over the sky: draw it only while it shows.
    skyLayer.visible = sum > 0 || fx.uRingAmp.value > 0 || fx.uHorizonGlow.value.w > 0;
  }

  function setOption(id: string) {
    current = OPTIONS.some((o) => o.id === id) ? id : 'storm';
    // Stop whatever was running.
    pending = [];
    for (const k of Object.keys(started) as Kind[]) started[k] = NEVER;
    shafts.mesh.visible = current === 'shafts';
    fx.uSrcDir.value.copy(circleDir);

    const style: BoltStyle = current === 'discharge' ? 'crimson' : 'branched';
    bolt.setStyle(style);
    // (setStyle sets hell-11's fixed colours; the palette's replace them)
    paintBolt();
    boltFlash = current === 'discharge' ? col.circle : col.storm;
    // Hairline emboss rings (hell-11 rings:hairline), but sparser than its
    // 45 per radian: over this bright sky the dense set read as a lattice.
    fx.uRingStyle.value.set(16, 0.03, 2.5, 1);
    fx.uRingDark.value = 0.12;

    // Preview on pick: storm shows a meteor and a bolt, discharge its combo.
    if (current === 'storm') {
      fire('meteor');
      lastKind = 'meteor';
      pending.push({ kind: 'bolt', at: now + 1.2 });
      nextAt = now + 9;
    } else if (current === 'discharge') {
      fire('discharge');
      nextAt = now + 14;
    }
  }

  palette.subscribe(paint);

  return {
    id: 'events',
    label: 'Sky events',
    options: OPTIONS,
    setOption,
    update(t) {
      now = t;
      if (current === 'storm' || current === 'discharge') direct();
      updateEvents();
    },
    params(): Record<string, string | number | boolean> {
      if (current === 'storm') return { option: current, every: '8–20 s', bolt: `branched, glow.events ${palette.current().glow.events}`, meteorShare: 0.3, boltDistance: '520–900 m' };
      if (current === 'discharge') return { option: current, every: '14–28 s', bolt: `glow.circles ${palette.current().glow.circles}`, rings: 'hairline 16/rad', ringCentre: 'circles' };
      if (current === 'shafts') return { option: current, shafts: shafts.count, source: `behind pillar, y 1500, z ${pillar.z - 1500}` };
      return { option: current };
    },
  };
};

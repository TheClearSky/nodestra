// COPIED from .claude/pages/ad/experiments/hell-src/scene/circles.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Circles class: the dark red magic circles in the sky. Each option is a
 * complete look (design + motion + placement), and each uses a different
 * technique from the experiments:
 *
 *   clockwork     the whole sky as a hand-drawn magic chart: wheels ticking
 *                 like clockwork, weaving round each other, great arcs, moons,
 *                 sparkles; draws on, dances, un-draws (scene/circles-clockwork.ts)
 *   overhead      the great seal laid flat high in the sky, two smaller seals
 *                 tilted beside it (2026-10-11: "i want red magic circles to
 *                 be in the sky"); the same live SDF quads as seal
 *   seal          one huge upright hell-01 sigil behind the pillar (live SDF quad)
 *   life          hell-02 lifecycle: three circles draw on, ignite, burn /
 *                 shatter / un-draw and rest (polar-baked layers, shards, sparks)
 *   constellation hell-03 decal ×8: seven sigils of different sizes and tilts
 *                 spread over the sky, lighting up one after another (sky decal)
 *   canopy        hell-03 cloud-deck circle: one vast flat circle far behind
 *                 everything, with AoT hairline shock waves (sky decal)
 *
 * Experiment modules are IMPORTED read-only (only helper modules, never a
 * page module); anything else is COPIED into the scene/circles-*.ts files.
 */

import * as THREE from 'three';
import { makeCircleUniforms } from '../hell-03-circle-sky-glsl';
import { createDecalDome, resolveAxes, type Circle } from '../hell-03-circle-sky-carriers';
import type { AssetFactory, AssetOption } from './contract';
import type { ScenePalette } from './palette';
import { createLifeSeal } from './circles-life';
import { createSeal } from './circles-seal';
import { createClockwork } from './circles-clockwork';

const OPTIONS: AssetOption[] = [
  {
    id: 'clockwork',
    label: 'Clockwork sky',
    description:
      '"The Summoning", a 46 s story drawn across the sky: seven small bold seals kindle one by one above the spire, each swinging a half circle; compass arcs find new points and the big rings appear through them, mostly in breaks; the living seal draws on and ignites at the centre, pulses send light out to the seals, the whole mechanism turns like clockwork and two echoes kindle at the sky’s edges; then it all collapses in reverse and the sky rests.',
    source: 'new (scene/circles-clockwork.ts), after the owner’s astrolabe-sky reference (image.png)',
  },
  {
    id: 'sketch',
    label: 'Clockwork sky — sketched',
    description:
      'The same "Summoning" story as Clockwork sky, but the big circles (the great ring, the outer ring, the far rings, the compass arcs, the echo rings) are drawn scratchy and noisy — a fast jitter, a second loose pass beside the first, like a pencil going round twice — with almost no breaks. The small seals stay bold.',
    source: 'scene/circles-clockwork.ts with uSketch (owner: "bigger circles have noisy lines but very less breaks")',
  },
  {
    id: 'overhead',
    label: 'Seals overhead',
    description:
      'The great heptagram seal laid flat high in the sky, seen from below as a vast ellipse the tower reaches into, with two smaller seals tilted in the sky to either side; all dark red, counter-turning, drawing themselves on.',
    source: 'hell-01 design:heptagram + clockwork + classic, palette:blackred; flat sky placement new for this scene',
  },
  {
    id: 'seal',
    label: 'Great seal',
    description:
      'One huge upright heptagram sigil behind the pillar (the pillar cuts it), black-red rim lines, its rings counter-turning; draws itself on when picked.',
    source: 'hell-01 design:heptagram palette:blackred + hell-03 layout:screen',
  },
  {
    id: 'life',
    label: 'Living seals',
    description:
      'Three circles that live and die: each draws on, ignites white-hot, pulses, flickers, then burns, shatters or un-draws, and the sky rests empty before the next cycle.',
    source: 'hell-02 motion:lifecycle',
  },
  {
    id: 'constellation',
    label: 'Sigil constellation',
    description:
      'Seven smaller sigils at different distances and tilts scattered over the whole sky, behind the islands; they light up one after another in a slow chain.',
    source: 'hell-03 layout:decal (sky-dome decal ×8, glow:neon)',
  },
  {
    id: 'canopy',
    label: 'Sky canopy',
    description:
      'One vast flat circle far behind everything, seen from below as a wide ellipse over the horizon; clouds and islands cut it, and AoT hairline shock waves sweep the sky every 9 s.',
    source: 'hell-03 layout:deck (sky decal, shock:angular)',
  },
];

/**
 * hell-03 colour "dark red": lines under the bloom threshold, only the glow
 * halos them. Re-expressed around the palette's circles colour C (linear
 * multipliers), so C = #e0182a gives back hell-03's own #3a0408 line,
 * #b3121a ember, (1.6, 0.09, 0.06) hot core and #9a0c12 glow.
 */
const DARK = { line: 0.05, ember: 0.6, core: 2.15, coreWarm: [0, 0.078, 0.02] as [number, number, number], glow: 0.44 };

const UP = new THREE.Vector3(0, 1, 0);
const SHOCK_PERIOD = 9;
/** One sigil lights up every CHAIN_STEP seconds (constellation). */
const CHAIN_STEP = 1.4;

export const create: AssetFactory = ({ lab, scene, layout, palette, lean }) => {
  const env = lab.env as unknown as Record<string, { value: unknown }>;
  const eye = new THREE.Vector3(...layout.camera.position);
  const c0 = new THREE.Vector3(layout.circles.x, layout.circles.y, layout.circles.z);
  const R = layout.circles.radius;

  const root = new THREE.Group();
  root.name = 'circles';
  scene.add(root);

  // ── seal: hell-01 heptagram on one upright quad at the layout spot ──
  const seal = createSeal(lab.renderer, env, c0, R, eye, {
    design: 'heptagram',
    seed: 7,
    glyphs: 'script4',
    palette: 'blackred',
    style: 1,
  });
  root.add(seal.mesh);

  // ── overhead: the same seal laid flat in the sky + two tilted ones ──
  // Placed by elevation from the eye (the frame spans about −10° … 30°): the
  // flat seal's near rim sits at ~31° (just cropped) and its far rim at ~19°,
  // so it reads as a ceiling over the tower; the side seals hang at ~22°.
  const OVER = { lift: 420, dist: 960, radius: 260 };
  const overCentre = new THREE.Vector3(eye.x, eye.y + OVER.lift, eye.z - OVER.dist);
  const over = [
    createSeal(lab.renderer, env, overCentre, OVER.radius, eye, { design: 'heptagram', seed: 7, glyphs: 'script4', palette: 'blackred', style: 1 }),
    createSeal(lab.renderer, env, new THREE.Vector3(), 95, eye, { design: 'clockwork', seed: 3, glyphs: 'script4', palette: 'blackred', style: 1 }),
    createSeal(lab.renderer, env, new THREE.Vector3(), 80, eye, { design: 'classic', seed: 11, glyphs: 'script4', palette: 'blackred', style: 1 }),
  ];
  // Flat, facing down at the land.
  over[0].mesh.rotation.set(Math.PI / 2, 0, 0);
  const sideSpot = (s: (typeof over)[number], az: number, el: number, dist: number, tilt: number) => {
    const a = THREE.MathUtils.degToRad(az);
    const e = THREE.MathUtils.degToRad(el);
    s.mesh.position.copy(eye).add(new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).multiplyScalar(dist));
    // Face the eye, then tip back so they lean like plates in the sky.
    s.mesh.lookAt(eye);
    s.mesh.rotateX(-THREE.MathUtils.degToRad(tilt));
  };
  sideSpot(over[1], -27, 21, 980, 48);
  sideSpot(over[2], 29, 17, 1050, 55);
  const overGroup = new THREE.Group();
  overGroup.name = 'circles-overhead';
  for (const s of over) overGroup.add(s.mesh);
  root.add(overGroup);

  // ── clockwork: the whole sky as a hand-drawn magic chart ──
  const clockwork = createClockwork(lab.renderer, env, lab.pixelRatio, eye);
  root.add(clockwork.group);

  // ── life: the hell-02 trio, a main circle and two smaller ones higher and to the sides ──
  const life = createLifeSeal(
    lab.renderer,
    env,
    lab.pixelRatio,
    [
      [c0.clone(), R * 0.85],
      [c0.clone().add(new THREE.Vector3(-R * 1.75, R * 0.2, -R * 0.6)), R * 0.36],
      [c0.clone().add(new THREE.Vector3(R * 1.75, R * 0.28, -R * 0.6)), R * 0.36],
    ],
    eye,
    0,
  );
  root.add(life.group);

  // ── constellation + canopy: the hell-03 pattern in a far-plane sky decal dome ──
  const cu = makeCircleUniforms();
  const dome = createDecalDome(scene, lab.env, cu);

  // ── colour: every carrier from the palette's circles colour ──
  const tmp = new THREE.Color();
  palette.subscribe((p: ScenePalette) => {
    const c = p.glow.circles;
    cu.uLine.value.set(c).multiplyScalar(DARK.line);
    cu.uEmber.value.set(c).multiplyScalar(DARK.ember);
    tmp.set(c).multiplyScalar(DARK.core);
    cu.uCoreHot.value.set(tmp.r + DARK.coreWarm[0], tmp.g + DARK.coreWarm[1], tmp.b + DARK.coreWarm[2]);
    cu.uGlowCol.value.set(c).multiplyScalar(DARK.glow);
    cu.uLightCol.value.set(c);
    seal.recolour(p);
    for (const s of over) s.recolour(p);
    clockwork.recolour(p);
    life.recolour(p);
  });
  dome.mesh.visible = false;

  /** A point seen from the eye at azimuth / elevation (degrees), `dist` away. */
  const at = (az: number, el: number, dist: number) => {
    const a = THREE.MathUtils.degToRad(az);
    const e = THREE.MathUtils.degToRad(el);
    return eye.clone().add(new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).multiplyScalar(dist));
  };
  /** Normal tilted from "up" toward the eye by `deg` (0 flat halo, 90 upright), turned by `yaw`. */
  const tilted = (c: THREE.Vector3, deg: number, yaw: number) => {
    const toEye = new THREE.Vector3(eye.x - c.x, 0, eye.z - c.z).normalize().applyAxisAngle(UP, yaw);
    const a = THREE.MathUtils.degToRad(deg);
    return UP.clone().multiplyScalar(Math.cos(a)).addScaledVector(toEye, Math.sin(a));
  };

  // Constellation (hell-03 decal ×8 idea, laid out for this camera): the
  // main sigil at the layout spot, six more spread across the sky.
  // [azimuth°, elevation°, distance, angular radius°, tilt°, yaw]
  const SPOTS: [number, number, number, number, number, number][] = [
    [-24, 13, 1300, 5.5, 55, 0.4],
    [25, 8, 1000, 4, 80, -0.3],
    [-11, 25, 2300, 6, 25, 0.1],
    [17, 23, 2600, 7.5, 40, -0.5],
    [-31, 4, 1700, 3.5, 75, 0.6],
    [33, 17, 2000, 5, 60, -0.2],
  ];
  const constellation: Circle[] = [
    { c: c0.clone(), n: tilted(c0, 75, 0), r: R * 0.6, spin: 0.9, seed: 0.05, power: 1 },
    ...SPOTS.map(([az, el, dist, ang, tilt, yaw], i) => {
      const c = at(az, el, dist);
      return { c, n: tilted(c, tilt, yaw), r: dist * Math.tan(THREE.MathUtils.degToRad(ang)), spin: i % 2 ? 0.9 : -0.7, seed: 0.19 + i * 0.137, power: 1 };
    }),
  ];
  for (const c of constellation) resolveAxes(c);
  const basePower = constellation.map((_, i) => (i === 0 ? 0.85 : 0.7));

  // Canopy: pushed out along the camera ray through the layout spot, so it
  // sits where the layout circle does on screen but far behind everything.
  const canopy: Circle = { c: eye.clone().add(c0.clone().sub(eye).multiplyScalar(2)), n: UP.clone(), r: R * 4.2, spin: 0.5, seed: 0.77, power: 0.45 };
  resolveAxes(canopy);

  let current = OPTIONS[0].id;
  let frame = 0;

  const apply = () => {
    seal.mesh.visible = current === 'seal';
    overGroup.visible = current === 'overhead';
    clockwork.group.visible = current === 'clockwork' || current === 'sketch';
    clockwork.setSketch(current === 'sketch');
    life.group.visible = current === 'life';
    dome.mesh.visible = current === 'constellation' || current === 'canopy';
    // Neon (tight) glow for the many small sigils, long haze tail for the far canopy.
    cu.uGlowMode.value = current === 'constellation' ? 0 : 1;
    if (current === 'seal') seal.redraw();
    if (current === 'overhead') for (const s of over) s.redraw();
    if (current === 'clockwork' || current === 'sketch') clockwork.restart();
    if (current === 'life') life.restart();
    if (current === 'constellation') dome.sync(constellation);
    if (current === 'canopy') dome.sync([canopy]);
    if (current !== 'canopy') dome.setShock(0, 0, undefined);
  };

  return {
    id: 'circles',
    label: 'Magic circles',
    options: OPTIONS,
    setOption(id) {
      current = OPTIONS.some((o) => o.id === id) ? id : OPTIONS[0].id;
      apply();
    },
    update(t, dt) {
      // The first frames draw every carrier once so their shaders compile
      // up front, not at the first switch.
      const warm = !lean && frame++ < 2;
      if (lean && frame === 0) {
        frame = 4; // past the warm-up: just the current option, from now on
        apply();
      }
      if (warm) {
        seal.mesh.visible = overGroup.visible = clockwork.group.visible = life.group.visible = dome.mesh.visible = true;
        dome.sync(constellation);
      } else if (frame === 3) apply();
      if (current === 'seal' || warm) seal.update(t, dt);
      if (current === 'clockwork' || current === 'sketch' || warm) clockwork.update(t, dt);
      if (current === 'overhead' || warm) {
        // The side seals turn the other way, a little faster.
        over[0].update(t, dt);
        over[1].update(-t * 1.4, dt);
        over[2].update(t * 1.2, dt);
      }
      if (current === 'life' || warm) life.update(dt);

      if (current === 'constellation') {
        // A slow chain: each sigil flares in turn, then settles to a dim glow.
        const n = constellation.length;
        constellation.forEach((c, i) => {
          const age = (((t - i * CHAIN_STEP) % (n * CHAIN_STEP)) + n * CHAIN_STEP) % (n * CHAIN_STEP);
          c.power = basePower[i] * (0.55 + 0.75 * Math.exp(-age * 1.1) * Math.min(1, age * 8));
        });
        dome.sync(constellation);
      } else if (current === 'canopy') {
        dome.setShock(2, t % SHOCK_PERIOD, canopy);
      }
    },
    params(): Record<string, string | number | boolean> {
      if (current === 'clockwork' || current === 'sketch') return clockwork.params();
      if (current === 'overhead') return { designs: 'heptagram (flat) + clockwork + classic (tilted)', palette: 'blackred', height: Math.round(overCentre.y), distance: OVER.dist, radius: OVER.radius, sideRadii: '95, 80', motion: 'counter-turn + draw-on' };
      if (current === 'seal') return { design: 'heptagram', seed: 7, palette: 'blackred', radius: R, motion: 'counter-turn + draw-on' };
      if (current === 'life') return { motion: 'lifecycle', circles: 3, cycle: 30, radius: R * 0.85, colour: 'blood red' };
      if (current === 'constellation') return { sigils: constellation.length, mainRadius: R * 0.6, glow: 'neon', chainStep: CHAIN_STEP, colour: 'dark red' };
      return { radius: R * 4.2, distance: Math.round(canopy.c.distanceTo(eye)), power: canopy.power, glow: 'haze', shock: 'angular', shockPeriod: SHOCK_PERIOD };
    },
  };
};

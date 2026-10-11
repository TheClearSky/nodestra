// COPIED from .claude/pages/ad/experiments/hell-src/scene/particles.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Particles & mist: everything small that moves in the air (from hell-10).
 *
 * Four compositions, each with its own direction of motion and mood:
 *   rising  — hot streak sparks rising, a raymarched mist pool, one sand devil
 *   vortex  — embers drawn up a spiral into the sky circle, circle-lit mist
 *   gust    — wind gusts streak the embers, dust curtains, three wandering devils
 *   ashfall — dark ash falling against embers rising from the pillar, lens bokeh
 *
 * The emitters (embers, ash, bokeh, dust, devils, mist) are IMPORTED
 * read-only from hell-10's helper modules and placed on LAYOUT through their
 * uniforms. Their sand height is swapped for the scene's ground on our own
 * material instances (scene/particles-ground.ts). Their fog runs in mode 0
 * (the scene's own FogExp2), synced every frame with whatever the sky sets.
 * Heat haze is a post pass in hell-10, so it belongs to the post class.
 */

import * as THREE from 'three';
import { FOG_MODES, makeFogUniforms } from '../hell-10-particles-and-mist-glsl';
import { BOKEH_DESIGNS, EMBER_DESIGNS, createAsh, createBokeh, createEmbers } from '../hell-10-particles-and-mist-sparks';
import { createDevil, createDust, createMist } from '../hell-10-particles-and-mist-air';
import type { AssetFactory, AssetOption } from './contract';
import type { ScenePalette } from './palette';
import { fitGround, groundY, swapShaderText } from './particles-ground';

/**
 * Colour: hell-10's emitters have their ember / glow colours as constants
 * (tuned for its crimson night). On OUR material instances they are swapped
 * for palette uniforms (embers from glow.embers, the vortex and the circle-lit
 * mist top from glow.circles, the mist's inner glow from glow.pillar), and the
 * dust / mist "lift" loses its fixed red. Ash is neutral, a touch of fog.
 */
const COLOUR_GLSL = 'uniform vec3 uEmberCol;\nuniform vec3 uCircleCol;\nuniform vec3 uPillarCol;\n';
const COLOUR_SWAPS: [string, string][] = [
  // embers: cooling from hot (near white) through the ember colour to a dim ember
  ['vec3 cold = vec3(0.16, 0.012, 0.018);', 'vec3 cold = uEmberCol * 0.16;'],
  ['vec3 warm = srgb(vec3(0.984, 0.431, 0.090));', 'vec3 warm = uEmberCol;'],
  ['vec3 hot  = srgb(vec3(0.996, 0.941, 0.475));', 'vec3 hot  = mix(uEmberCol, vec3(1.0), 0.6);'],
  // the vortex embers turn the circle's colour as they are sucked into it
  ['srgb(vec3(0.62, 0.05, 0.08)) * 2.6', 'uCircleCol * 0.47 * 2.6'],
  // ash flakes burning away at the edge
  ['srgb(vec3(1.0, 0.45, 0.1)) * 4.0', 'uEmberCol * 4.0'],
  ['srgb(vec3(0.6, 0.08, 0.04)) * 0.4', 'uEmberCol * 0.12 * 0.4'],
  // ember bokeh
  ['vec3 ember = srgb(vec3(0.95, 0.30, 0.07));', 'vec3 ember = uEmberCol;'],
  // dust and mist: pale air, neutral lift (the grade tints it)
  ['vec3 lift = vec3(0.07, 0.03, 0.03);', 'vec3 lift = vec3(0.045);'],
  ['vec3 lift = vec3(0.10, 0.035, 0.04);', 'vec3 lift = vec3(0.055);'],
  // the mist pool lit from inside by the pillar, and from above by the circle
  ['srgb(vec3(1.0, 0.36, 0.1))', 'uPillarCol'],
  ['srgb(vec3(0.75, 0.04, 0.08)) * uCircleLit', 'uCircleCol * 0.7 * uCircleLit'],
];

const OPTIONS: AssetOption[] = [
  {
    id: 'rising',
    label: 'Rising sparks',
    description:
      'Velocity-stretched spark streaks rising off the sand and the pillar foot, a raymarched glowing mist pool at the foot, and one twisting sand devil with grains and a skirt.',
    source: 'hell-10 embers:streaks + mist:march + devil:grains',
  },
  {
    id: 'vortex',
    label: 'Vortex to the circle',
    description:
      'Curl-noise ember dots; a third of them are sucked up a tightening helix into the magic circle, turning its red. The mist pool is lit from above by the circle\'s pulse.',
    source: 'hell-10 embers:vortex + mist:circleLit',
  },
  {
    id: 'gust',
    label: 'Sandstorm gusts',
    description:
      'Wind every 11 s shoves the embers sideways and stretches them into streaks; dust curtains blow across the low field; three sand devils wander and respawn.',
    source: 'hell-10 embers:gust + dust:curtains + devil:three',
  },
  {
    id: 'ashfall',
    label: 'Ash fall',
    description:
      'Quiet and heavy: dark tumbling ash flakes fall everywhere while embers rise only from the pillar (convection); airbrushed mist blobs at the foot; hexagonal lens bokeh at the frame edges.',
    source: 'hell-10 ash:mix + mist:blobs + bokeh:hex',
  },
];

type Recipe = {
  embers: keyof typeof EMBER_DESIGNS;
  emberCount: number;
  vortexShare: number;
  pillarShare: number;
  rise: number; // m/s
  life: number; // s
  size: number; // ember size, m
  ash: boolean;
  bokeh: boolean;
  dust: boolean;
  devils: 0 | 1 | 3;
  mist: 'march' | 'slices' | 'blobs';
  circleLit: boolean;
};

const RECIPES: Record<string, Recipe> = {
  rising: { embers: 'streaks', emberCount: 1800, vortexShare: 0, pillarShare: 0.45, rise: 1.6, life: 14, size: 0.16, ash: false, bokeh: false, dust: false, devils: 1, mist: 'march', circleLit: false },
  // Bigger embers: the spiral is ~500 m away and must still read as a stream.
  vortex: { embers: 'vortex', emberCount: 3000, vortexShare: 0.3, pillarShare: 0.45, rise: 1.6, life: 14, size: 0.3, ash: false, bokeh: false, dust: false, devils: 0, mist: 'slices', circleLit: true },
  gust: { embers: 'gust', emberCount: 1800, vortexShare: 0, pillarShare: 0.45, rise: 1.6, life: 14, size: 0.16, ash: false, bokeh: false, dust: true, devils: 3, mist: 'march', circleLit: false },
  // As hell-10's "mix": embers born only at the pillar, rising faster, fewer.
  ashfall: { embers: 'dots', emberCount: 1100, vortexShare: 0, pillarShare: 1, rise: 2.4, life: 20, size: 0.16, ash: true, bokeh: true, dust: false, devils: 0, mist: 'blobs', circleLit: false },
};

export const create: AssetFactory = ({ lab, scene, layout, palette }) => {
  const env = lab.env;
  const L = layout;
  const pillarFoot = new THREE.Vector3(L.pillar.x, L.groundY, L.pillar.z);
  const circleCentre = new THREE.Vector3(L.circles.x, L.circles.y, L.circles.z);
  const eye = new THREE.Vector2(L.camera.position[0], L.camera.position[2]);

  // The hell-10 fog, in mode 0 (plain FogExp2) so it matches the rest of the scene.
  const sceneFog = scene.fog as THREE.FogExp2 | null;
  const fog = makeFogUniforms(env, sceneFog?.color ?? new THREE.Color(palette.current().fog.color));
  fog.uHfMode.value = FOG_MODES.base;

  const root = new THREE.Group();
  root.name = 'particles';
  scene.add(root);

  // ── embers: spread over the field between the eye and the pillar ──
  const embers = createEmbers(env, fog);
  const eu = embers.uniforms;
  (eu.uPillar.value as THREE.Vector3).copy(pillarFoot);
  // The vortex helix: hell-10 centres it on the circle. Here the circle is far
  // behind the pillar, so the helix winds up just in front of the pillar to
  // the point where the circle's hub appears on screen (seen from the eye).
  const eyeV = new THREE.Vector3(...L.camera.position);
  const helixZ = L.pillar.z + 35;
  const helixTop = eyeV.clone().lerp(circleCentre, (eyeV.z - helixZ) / (eyeV.z - circleCentre.z));
  (eu.uCircle.value as THREE.Vector3).copy(helixTop);
  (eu.uBoxCentre.value as THREE.Vector2).set(eye.x, (eye.y + L.pillar.z) * 0.45);
  (eu.uBoxSize.value as THREE.Vector2).set(420, Math.abs(L.pillar.z - eye.y) * 0.8);

  // ── ash: a column of falling flakes around and ahead of the eye ──
  const ash = createAsh(env, fog);
  (ash.uniforms.uBoxCentre.value as THREE.Vector2).set(eye.x, eye.y - 120);
  (ash.uniforms.uBoxSize.value as THREE.Vector2).set(300, 260);
  ash.uniforms.uDrop.value = 70;
  ash.uniforms.uLife.value = 55;
  ash.uniforms.uSize.value = 0.3; // bigger flakes: the column is wider and further than in hell-10
  ash.setCount(3000);

  // ── bokeh: hexagonal lens discs at the frame edges ──
  const bokeh = createBokeh(env);
  bokeh.uniforms.uDesign.value = BOKEH_DESIGNS.hex;
  bokeh.setCount(7);

  // ── dust curtains (world-placed cards across the low field) ──
  const dust = createDust(env, fog);

  // ── sand devils ──
  const devils = [0, 1, 2].map((i) => createDevil(env, fog, i));

  // ── mist pool at the pillar foot (a little wider than in hell-10: the pillar is further away) ──
  const mist = createMist(env, fog);
  const mu = mist.uniforms;
  (mu.uPillar.value as THREE.Vector3).copy(pillarFoot);
  mu.uRadius.value = 110;
  (mu.uBoxMin.value as THREE.Vector3).set(pillarFoot.x - 200, pillarFoot.y - 0.5, pillarFoot.z - 200);
  (mu.uBoxMax.value as THREE.Vector3).set(pillarFoot.x + 200, pillarFoot.y + 30, pillarFoot.z + 200);

  root.add(embers.mesh, ash.mesh, bokeh.mesh, mist.slices, mist.blobs, mist.march);
  for (const d of devils) root.add(d.group);
  fitGround(root, L);
  // The dust rides up at the crests' level, where the eye sees it across the field.
  fitGround(dust.curtains, L, 14);
  root.add(dust.curtains);

  // ── colour (see COLOUR_SWAPS) ──
  const tint = {
    uEmberCol: { value: new THREE.Color() },
    uCircleCol: { value: new THREE.Color() },
    uPillarCol: { value: new THREE.Color() },
  };
  swapShaderText(root, COLOUR_GLSL, COLOUR_SWAPS, tint, 'particles');
  const grey = new THREE.Color();
  palette.subscribe((p: ScenePalette) => {
    tint.uEmberCol.value.set(p.glow.embers);
    tint.uCircleCol.value.set(p.glow.circles);
    tint.uPillarCol.value.set(p.glow.pillar);
    // Ash: near-neutral charcoal flakes, a touch of the fog's hue.
    (ash.uniforms.uAshDark.value as THREE.Color).setRGB(0.008, 0.008, 0.008).lerp(grey.set(p.fog.color).multiplyScalar(0.05), 0.3);
    (ash.uniforms.uAshLit.value as THREE.Color).setRGB(0.07, 0.07, 0.07).lerp(grey.set(p.fog.color).multiplyScalar(0.4), 0.3);
  });

  // ── options ──
  let current = OPTIONS[0].id;
  const apply = (r: Recipe) => {
    eu.uDesign.value = EMBER_DESIGNS[r.embers];
    eu.uVortexShare.value = r.vortexShare;
    eu.uPillarShare.value = r.pillarShare;
    eu.uRise.value = r.rise;
    eu.uLife.value = r.life;
    eu.uSize.value = r.size;
    embers.setCount(r.emberCount);
    ash.mesh.visible = r.ash;
    bokeh.mesh.visible = r.bokeh;
    dust.curtains.visible = r.dust;
    devils.forEach((d, i) => {
      d.group.visible = i < r.devils;
      d.u.uHeight.value = 90 + i * 16;
      d.u.uAlpha.value = 1;
    });
    mist.march.visible = r.mist === 'march';
    mist.slices.visible = r.mist === 'slices';
    mist.blobs.visible = r.mist === 'blobs';
    mu.uCircleLit.value = r.circleLit ? 1 : 0;
  };
  apply(RECIPES[current]);

  // Devil lanes (x and z ranges): clear of the pillar's centre line and the bones.
  // The first is the single devil's: against the darker ground left of the pillar.
  const LANES = [
    { x: [-75, -35], z: [-320, -380] }, // between the bones and the pillar, behind
    { x: [30, 75], z: [-180, -240] }, // right of the pillar, mid-ground
    { x: [120, 230], z: [-300, -440] }, // far right
  ];
  const placeDevil = (i: number, t: number, wander: boolean) => {
    const lane = LANES[i];
    let x: number;
    let z: number;
    let alpha = 1;
    if (wander) {
      // Each devil lives 24 s, drifting with the wind, then respawns elsewhere in its lane.
      const u = (t + i * 8) / 24;
      const cyc = Math.floor(u);
      const f = u - cyc;
      const h = Math.sin(cyc * 12.9898 + i * 78.233) * 43758.5453;
      const r1 = h - Math.floor(h);
      const r2 = Math.abs((h * 7.13) % 1);
      x = THREE.MathUtils.lerp(lane.x[0], lane.x[1], r1) + (f - 0.5) * 24;
      z = THREE.MathUtils.lerp(lane.z[0], lane.z[1], r2);
      alpha = THREE.MathUtils.smoothstep(f, 0, 0.15) * (1 - THREE.MathUtils.smoothstep(f, 0.8, 1));
    } else {
      // One slow Lissajous path in its lane.
      x = (lane.x[0] + lane.x[1]) / 2 + Math.sin(t * 0.05) * (lane.x[1] - lane.x[0]) / 2;
      z = (lane.z[0] + lane.z[1]) / 2 + Math.sin(t * 0.037 + 1) * (lane.z[1] - lane.z[0]) / 2;
    }
    devils[i].u.uBase.value.set(x, groundY(L, x, z) - 0.5, z);
    devils[i].u.uAlpha.value = alpha;
  };

  return {
    id: 'particles',
    label: 'Particles & mist',
    options: OPTIONS,
    setOption(id) {
      if (!RECIPES[id]) return;
      current = id;
      apply(RECIPES[id]);
    },
    update(t) {
      // Fog follows whatever the sky class sets.
      const f = scene.fog as THREE.FogExp2 | null;
      if (f) {
        fog.uHfFog.value = f.color;
        if (typeof f.density === 'number') fog.uHfExp2.value = f.density;
      }
      // The circle's slow breathing lights the top of the mist (vortex option).
      mu.uCirclePulse.value = Math.pow(0.5 + 0.5 * Math.sin(t * 0.9), 2);
      const r = RECIPES[current];
      for (let i = 0; i < r.devils; i++) placeDevil(i, t, r.devils > 1);
    },
    params() {
      const r = RECIPES[current];
      return {
        embers: r.embers,
        emberCount: r.emberCount,
        vortexShare: r.vortexShare,
        emberRise: r.rise,
        emberSize: r.size,
        ash: r.ash,
        bokeh: r.bokeh ? 'hex' : 'off',
        dust: r.dust ? 'curtains' : 'off',
        devils: r.devils,
        mist: r.circleLit ? 'slices, circle-lit' : r.mist,
        mistRadius: mu.uRadius.value as number,
      };
    },
  };
};

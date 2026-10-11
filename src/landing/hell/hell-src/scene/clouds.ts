// COPIED from .claude/pages/ad/experiments/hell-src/scene/clouds.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Clouds class: cloud layers for the shared hellscape. Each option is a whole
 * cloud look with its own silhouette and technique, all from hell-05-clouds:
 *
 *   veils  (the default since 2026-10-11) thin streaky fog drifting THROUGH the
 *          landscape and round the tower's middle (a sliced volume, scene/clouds-veils.ts)
 *   sea    a dense scalloped cumulus sea burying the far plain + a puff collar on the pillar
 *          (the calm horizontal band between sky and sand)
 *   halo   Eva ribbon rings + sky ripples wrapping the upper pillar (flat painted rings)
 *   storm  a wall of black thunderheads on the horizon split by glowing cracks, lightning
 *   cel    cel-shaded cumulus towers (flat tone bands, ink rims) framing the sides
 *
 * COLOUR comes from the scene palette (scene/palette.ts): lit tops, shadow
 * sides and bellies from palette.cloud (lit, shade, belly), the ground bounce
 * from the sand, the storm seams from the embers and the lightning from the
 * events light; far layers fade toward the fog / haze. Each option keeps its
 * shape and only maps those roles onto its tone ramp (the references: white
 * clouds with pink bellies over red ground, shadows a hue, never grey).
 *
 * The hell-05 helper modules (shading, palettes, puff layer, collar) are
 * IMPORTED read-only; everything laid out for this scene lives in
 * scene/clouds-*.ts. One set of cloud uniforms is shared by every layer, so
 * an option sets palette, edge, light and storm mode once.
 */

import * as THREE from 'three';
import { seededRandom } from '../../env-src/lab';
import { makeCloudUniforms, setPalette, type CloudPalette } from '../hell-05-clouds-glsl';
import { createPuffLayer, makeCollarClusters, placeCollar, COLLAR, type Cluster } from '../hell-05-clouds-puffs';
import type { AssetFactory, AssetOption } from './contract';
import type { ScenePalette } from './palette';
import { createHalo, FLASH_PATCH } from './clouds-halo';
import { createVeils } from './clouds-veils';
import { celTowers, farLift, seaBank, stormWall } from './clouds-heaps';
import { okMix, okShade } from './sky-ramp';

const OPTIONS: AssetOption[] = [
  {
    id: 'veils',
    label: 'Drifting veils',
    description:
      'No cloud masses: thin, streaky fog that drifts through the landscape itself — pooling in the dune troughs, sliding across the ribs and the tower base in soft layers, and a sparser band wrapping the tower’s middle, lit by its glow.',
    source: 'new (scene/clouds-veils.ts): sliced-volume veils after MOODBOARD veil band (AoT ep 87, Inuyasha Tomb mist band)',
  },
  {
    id: 'sea',
    label: 'Cumulus sea + collar',
    description:
      'A dense sea of soft scalloped cumulus heaps buries the far plain behind the pillar and drifts with the wind; a fat puff collar hugs the upper pillar. Horizontal, volumetric, calm.',
    source: 'hell-05 sea:billboard count:dense edge:scallop + collar:puffs, colours from the scene palette',
  },
  {
    id: 'halo',
    label: 'Ribbon halo',
    description:
      'Flat painted cloud rings (scalloped outer rim, soft inner edge) stacked in a funnel round the upper pillar, each turning at its own speed, with faint concentric ripples under them; pale lit rims over belly-coloured undersides, seen from below. No clouds on the horizon.',
    source: 'hell-05 halo:ripples (preset:owner), colours from the scene palette',
  },
  {
    id: 'storm',
    label: 'Storm wall',
    description:
      'A wall of near-black thunderheads (in the cloud shade hue) along the horizon behind everything, ember light glowing in the crevices between their lobes, frayed edges; lightning double-strikes light them every 5–12 s.',
    source: 'hell-05 storm:crevices + storm:flash lightning (preset:crimsonStorm)',
  },
  {
    id: 'cel',
    label: 'Cel towers',
    description:
      'Bright opaque cel-shaded cumulus towers on both sides of the frame: three flat hue-shifted tone bands, crisp tops and an ink line on the shaded rims (lit tops, hued shade, belly-coloured undersides).',
    source: 'hell-05 sea:cel edge:crisp (preset:hellVerse), hell-05 evaPink slots filled from the scene palette',
  },
];

/**
 * The scene palette's cloud roles mapped onto each look's tone ramp (the same
 * slots as hell-05's CLOUD_PALETTES: deep -> belly -> mid -> top, plus the
 * ground bounce into the bellies and the shadow hue). Shade is always a hue.
 */
function cloudTones(look: string, p: ScenePalette): Omit<CloudPalette, 'label'> {
  const { lit, shade, belly } = p.cloud;
  // Bellies pick up the ground under them (Eva's pink bellies over red sand).
  const bounce = okMix(belly, p.sand.lit, 0.2);
  const shadow = okShade(shade, 0.35);
  if (look === 'storm') {
    // Near-black bodies in the shade hue; the seams carry the colour.
    return { top: okShade(shade, 0.34), mid: okShade(shade, 0.2), belly: okShade(okMix(shade, belly, 0.5), 0.15), deep: okShade(shade, 0.08), bounce: okShade(bounce, 0.5), shadow: okShade(shade, 0.12) };
  }
  if (look === 'halo') {
    // Seen from below: pale lit rims, belly-coloured undersides.
    return { top: lit, mid: okMix(lit, belly, 0.45), belly, deep: okShade(okMix(belly, shade, 0.5), 0.6), bounce, shadow };
  }
  if (look === 'cel') {
    // hell-05 evaPink slots: lit / shade / belly / a deeper belly.
    return { top: lit, mid: shade, belly, deep: okShade(okMix(belly, shade, 0.4), 0.7), bounce, shadow };
  }
  // sea: lit tops, shade sides, darker hued bases (a calm band, not a white wall).
  return { top: lit, mid: okMix(lit, shade, 0.5), belly: okMix(shade, belly, 0.45), deep: okShade(okMix(shade, belly, 0.5), 0.55), bounce, shadow };
}

type Look = {
  storm: number; // 0 off, 3 glowing crevices between lobes (lightning is separate)
  edge: number; // 1 frayed, 2 crisp, 3 scallop
  light: number; // 0 plain, 1 ground bounce, 2 circle glow
  fogDen: number;
};
const LOOKS: Record<string, Look> = {
  halo: { storm: 0, edge: 3, light: 1, fogDen: 0.0007 },
  sea: { storm: 0, edge: 3, light: 1, fogDen: 0.0005 },
  storm: { storm: 3, edge: 1, light: 0, fogDen: 0.00045 },
  cel: { storm: 0, edge: 2, light: 1, fogDen: 0.0005 },
  veils: { storm: 0, edge: 3, light: 1, fogDen: 0.0005 },
};

const HALO_PERIOD = 90; // seconds per halo turn (hell-05 brief: 60–120 s)
const WIND: Record<string, number> = { sea: 3, storm: 1.2, cel: 0, halo: 0 }; // drift, world units / s
const SPAN = 1700; // heaps wrap around in x within ±SPAN (beyond the frame edges)
const COLLAR_Y = 262; // collar height: threads the pillar at the top of the frame, above the black sun
const COLLAR_SCALE = 0.8;
/** How far the cloud fog leans from the fog colour toward the horizon haze (the far heaps sit on the horizon). */
const FOG_TO_HAZE = 0.7;

export const create: AssetFactory = ({ lab, scene, camera, layout, palette, lean }) => {
  const env = lab.env;
  const fogColor = new THREE.Color();
  const cu = makeCloudUniforms(fogColor);
  // If a look ever uses circle light, it comes from the layout circle.
  cu.uCircleC.value.set(layout.circles.x, layout.circles.y, layout.circles.z);
  cu.uCircleR.value = layout.circles.radius;
  // Calmer crack glow than hell-05's 3.2: the far wall is seen whole, not close up.
  cu.uHot.value = 1.8;

  const root = new THREE.Group();
  root.name = 'clouds';
  scene.add(root);

  const pillarAt = new THREE.Vector3(layout.pillar.x, layout.groundY, layout.pillar.z);
  const eye = new THREE.Vector3(...layout.camera.position);

  // ── layers ──
  // Far heaps draw before the circles (renderOrder below theirs), so the
  // sigils stay on top of the clouds behind them.
  const soft = createPuffLayer(env, cu, { maxPuffs: 9000, partable: false, normBlend: 0.6, renderOrder: -5, name: 'clouds-soft' });
  const cel = createPuffLayer(env, cu, { maxPuffs: 3000, partable: false, normBlend: 0.6, renderOrder: -5, name: 'clouds-cel' });
  cel.setCel(true);
  const collar = createPuffLayer(env, cu, { maxPuffs: 260, partable: false, normBlend: 0.75, renderOrder: 9, name: 'clouds-collar' });
  // Lightning colour: the experiment's flash light is a fixed pink in the
  // shared GLSL; this scene's COPY of each layer's shader text reads a uniform.
  const flashCol = { value: new THREE.Color() };
  for (const layer of [soft, cel, collar]) {
    const m = layer.material;
    if (m.fragmentShader.includes(FLASH_PATCH[0])) m.fragmentShader = 'uniform vec3 uFlashCol;\n' + m.fragmentShader.replace(FLASH_PATCH[0], FLASH_PATCH[1]);
    else console.error('[hell-20 clouds] flash patch not found');
    m.uniforms.uFlashCol = flashCol;
  }
  const halo = createHalo(env, cu, pillarAt, flashCol);
  const veils = createVeils(env, pillarAt, eye);
  root.add(soft.mesh, cel.mesh, collar.mesh, halo.group, veils.group);

  const sets: Record<string, Cluster[]> = {
    sea: seaBank(layout.groundY, SPAN, eye),
    storm: stormWall(layout.groundY, SPAN, eye),
    cel: celTowers(layout.groundY, eye),
  };
  // Height above the far ground, so drifting heaps follow the rising ranges.
  for (const list of Object.values(sets)) for (const c of list) c.data[3] = c.data[2] - farLift(c.data[0], c.data[1], eye);
  cel.set(sets.cel);
  // hell-05's collar shrunk to 0.8 (this pillar is thinner than its proxy).
  const collarClusters = makeCollarClusters();
  for (const c of collarClusters) {
    c.data[1] *= COLLAR_SCALE;
    c.data[2] *= COLLAR_SCALE;
    c.local[3] *= COLLAR_SCALE;
  }
  collar.set(collarClusters);
  const collarLift = new THREE.Vector3(pillarAt.x, COLLAR_Y - COLLAR.y, pillarAt.z);

  let current = OPTIONS[0].id;
  let ct = 0;
  let frame = 0;
  // Lightning: a double strike every 5–12 s (hell-05 timing).
  let nextFlash = 2;
  let flashT = -1;
  const rnd = seededRandom(12345);

  let pal = palette.current();
  let tones = cloudTones(current, pal);
  // Colours only (uniform writes): on a palette change and with every option.
  const recolour = () => {
    tones = cloudTones(current, pal);
    setPalette(cu, tones);
    cu.uEmber.value.set(pal.glow.embers);
    cu.uCircleCol.value.set(pal.glow.circles);
    flashCol.value.set(pal.glow.events);
    veils.u.uLit.value.set(pal.cloud.lit);
    veils.u.uShade.value.set(pal.cloud.shade);
    veils.u.uGlow.value.set(pal.glow.pillar);
    veils.u.uAccent.value.set(pal.glow.circles);
  };

  const apply = () => {
    const look = LOOKS[current];
    recolour();
    cu.uStorm.value = look.storm;
    cu.uEdgeMode.value = look.edge;
    cu.uLightMode.value = look.light;
    cu.uFogDen.value = look.fogDen;
    halo.group.visible = current === 'halo';
    veils.group.visible = current === 'veils';
    collar.mesh.visible = current === 'sea';
    cel.mesh.visible = current === 'cel';
    soft.mesh.visible = current === 'sea' || current === 'storm';
    if (soft.mesh.visible) soft.set(sets[current]);
    flashT = -1;
    cu.uFlash.value = 0;
  };

  palette.subscribe((p) => {
    pal = p;
    recolour();
  });

  const wrap = (x: number) => -SPAN + ((((x + SPAN) % (2 * SPAN)) + 2 * SPAN) % (2 * SPAN));

  return {
    id: 'clouds',
    label: 'Clouds',
    options: OPTIONS,
    setOption(id) {
      current = OPTIONS.some((o) => o.id === id) ? id : OPTIONS[0].id;
      apply();
    },
    update(_t, dt) {
      ct += dt;
      cu.uCT.value = ct;
      // The fog follows the scene fog (colour.ts), leaning toward the palette
      // haze: the far heaps sit on the horizon, where the sky is haze.
      const fog = scene.fog as THREE.FogExp2 | null;
      if (fog) fogColor.copy(fog.color).lerp(env.uHaze.value, FOG_TO_HAZE);
      const cam = camera.position;

      // The first frames show every layer once so their shaders compile up front.
      const warm = !lean && frame++ < 2;
      if (lean && frame === 0) {
        frame = 4; // past the warm-up: just the current option, from now on
        apply();
      }
      if (warm) {
        soft.mesh.visible = cel.mesh.visible = collar.mesh.visible = halo.group.visible = veils.group.visible = true;
        if (soft.clusters.length === 0) soft.set(sets.sea);
      } else if (frame === 3) apply();

      if (soft.mesh.visible) {
        // Drift downwind and wrap; a slow bob keeps the heaps alive.
        const wind = WIND[current] ?? 0;
        for (const c of soft.clusters) {
          c.anchor.x = wrap(c.data[0] + ct * wind);
          c.anchor.z = c.data[1] + Math.sin(ct * 0.02 + c.seed * 6.28) * 5;
          c.anchor.y = farLift(c.anchor.x, c.anchor.z, eye) + c.data[3];
        }
        soft.update(cam);
      }
      if (cel.mesh.visible) cel.update(cam);
      if (collar.mesh.visible) {
        placeCollar(collar.clusters, ct);
        for (const c of collar.clusters) {
          // Normals point away from the shrunken tube's core circle, then lift onto the pillar.
          const r = Math.hypot(c.anchor.x, c.anchor.z) || 1;
          const core = (COLLAR.major * COLLAR_SCALE) / r;
          c.centre.x = c.anchor.x * core - c.anchor.x;
          c.centre.z = c.anchor.z * core - c.anchor.z;
          c.anchor.add(collarLift);
        }
        collar.update(cam);
      }
      if (halo.group.visible) halo.update(ct, HALO_PERIOD);
      if (veils.group.visible) {
        veils.update(ct);
        if (fog) {
          veils.u.uFogCol.value.copy(fog.color);
          veils.u.uFogDen.value = fog.density;
        }
      }

      // Lightning, storm only: flashes somewhere along the wall.
      if (current === 'storm') {
        nextFlash -= dt;
        if (nextFlash < 0) {
          nextFlash = 5 + rnd() * 7;
          flashT = 0;
          cu.uFlashPos.value.set((rnd() - 0.5) * 1800, 160 + rnd() * 200, -1250 - rnd() * 350);
        }
      }
      if (flashT >= 0) {
        flashT += dt;
        cu.uFlash.value = flashT < 0.07 ? 1 : flashT < 0.13 ? 0.12 : flashT < 0.2 ? 0.85 : Math.max(0, 0.85 - (flashT - 0.2) * 3.5);
        if (flashT > 0.5) flashT = -1;
      } else cu.uFlash.value = 0;
    },
    params(): Record<string, string | number | boolean> {
      const look = LOOKS[current];
      const base = {
        option: current,
        palette: pal.id,
        top: tones.top,
        mid: tones.mid,
        belly: tones.belly,
        deep: tones.deep,
        bounce: tones.bounce,
        edge: ['soft', 'frayed', 'crisp', 'scallop'][look.edge],
        light: ['plain', 'ground bounce', 'circle glow'][look.light],
        cloudFog: look.fogDen,
      };
      if (current === 'halo') return { ...base, rings: 5, ripples: 2, turnSeconds: HALO_PERIOD, opacity: halo.uAlpha.value };
      if (current === 'sea') return { ...base, heaps: sets.sea.length, wind: WIND.sea, collarY: COLLAR_Y, collarRadius: COLLAR.major * COLLAR_SCALE };
      if (current === 'storm') return { ...base, towers: sets.storm.length, seams: 'lobe crevices', seamColour: pal.glow.embers, lightning: '5–12 s', flashColour: pal.glow.events, wind: WIND.storm };
      if (current === 'veils') return { option: current, palette: pal.id, lit: pal.cloud.lit, shade: pal.cloud.shade, glow: pal.glow.pillar, slices: 10, groundBand: '3–60 m', towerBand: '100–150 m', alpha: veils.u.uAlpha.value, banks: 'separate ~400–700 m patches, clear air between', bankDrift: '10 m/s', wispDrift: '4–9 m/s, sheared' };
      return { ...base, towers: sets.cel.length, cel: true };
    },
  };
};

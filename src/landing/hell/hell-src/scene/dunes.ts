// COPIED from .claude/pages/ad/experiments/hell-src/scene/dunes.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Dunes: the sand floor around the pillar (from hell-08-dunes).
 *
 * One dune mesh (scene/dunes-field.ts, a lean copy of the experiment's field
 * fitted to LAYOUT) and three looks, each a different silhouette, technique
 * or mood. Every switch is a uniform change: no rebuild, no recompile.
 * The stand-in ground of the backdrop is hidden: this class owns the ground.
 *
 * COLOUR comes from the scene palette (scene/palette.ts): lit / shade / crest
 * from palette.sand, the far ranges tint toward sand.far and then melt into
 * the fog (colour.ts sets it) and the sky's own horizon, the crust-cracks
 * seams glow in palette.glow.embers. Each look keeps its shape and lighting
 * and only reads those roles its own way (the AoT swells soft, the Eva
 * pillows saturated with a crest wash, the crust darker so its seams read).
 */

import * as THREE from 'three';
import type { AssetFactory, AssetOption } from './contract';
import type { ScenePalette } from './palette';
import { createDuneMesh, createFieldUniforms, type FieldUniforms } from './dunes-field';
import { okMix, okShade } from './sky-ramp';

// sRGB hex; THREE.Color linearises.
type Tones = { lit: string; mid: string; shadow: string; trough: string; crest: string; rim: string; glint: string; char: string; far: string; glowCore: string; glowHalo: string };

// Directions the dune light comes FROM (the sun is behind the pillar, so the dunes get an art light).
const LIGHTS: Record<string, THREE.Vector3> = {
  // From over the eye's shoulder: faces toward us lit, backs in shade.
  front: new THREE.Vector3(0.35, 0.26, 0.9).normalize(),
  // From behind the dunes: camera-facing slopes fall into shade, crests catch the light.
  back: new THREE.Vector3(-0.45, 0.38, -0.8).normalize(),
};

type Look = {
  shape: 'swell' | 'pillow';
  ripple: 'none' | 'soft';
  shade: 'soft' | 'contrast';
  crest: 'rim' | 'pink';
  grain: boolean;
  cracks: boolean;
  /** How the look reads the palette's sand roles. */
  tone: 'soft' | 'saturated' | 'crust';
  light: keyof typeof LIGHTS;
};

const LOOKS: Record<string, Look> = {
  aot: { shape: 'swell', ripple: 'soft', shade: 'soft', crest: 'rim', grain: true, cracks: false, tone: 'soft', light: 'front' },
  eva: { shape: 'pillow', ripple: 'none', shade: 'contrast', crest: 'pink', grain: false, cracks: false, tone: 'saturated', light: 'back' },
  cracks: { shape: 'swell', ripple: 'none', shade: 'soft', crest: 'rim', grain: false, cracks: true, tone: 'crust', light: 'back' },
};

const OPTIONS: AssetOption[] = [
  {
    id: 'aot',
    label: 'AoT swells',
    description: 'Soft rolling sine swells with broad swell bands, lit over the shoulder: a calm sea of sand in the palette (lit faces, hued shade) with faint grain glints.',
    source: 'hell-08 look:aot',
  },
  {
    id: 'eva',
    label: 'Eva pillows',
    description: 'Round pillow mounds (Worley domes) in one saturated sand colour, high-contrast shading, crests washing to the palette crest colour.',
    source: 'hell-08 look:eva',
  },
  {
    id: 'cracks',
    label: 'Crust cracks',
    description: 'Hell ground: back-lit swells whose troughs, the pillar dish and the near ledge are dried crust plates with seams glowing in the palette embers.',
    source: 'hell-08 look:cracks',
  },
];

/** The palette's sand roles, read the look's way. */
function tonesFor(look: Look, p: ScenePalette): Tones {
  const s = p.sand;
  const embers = p.glow.embers;
  const base = {
    far: s.far,
    // Grain glints: a pale crest, never pure white (they stay subtle).
    glint: okMix(s.crest, '#ffffff', 0.35),
    glowCore: embers,
    glowHalo: okMix(embers, p.glow.circles, 0.5),
  };
  if (look.tone === 'saturated') {
    // Eva: one colour, its shade a deeper version of the same hue, crests to the crest colour.
    return {
      ...base,
      lit: okShade(s.lit, 1.12, 1.15),
      mid: okMix(s.lit, s.crest, 0.3),
      shadow: s.shade,
      trough: okShade(s.shade, 0.55),
      crest: s.crest,
      rim: okMix(s.crest, s.lit, 0.25),
      char: okShade(s.shade, 0.25),
    };
  }
  if (look.tone === 'crust') {
    // Darker crust so the ember seams read; back light on the crests.
    return {
      ...base,
      lit: okShade(s.lit, 0.82),
      mid: okMix(s.lit, s.crest, 0.15),
      shadow: okShade(s.shade, 0.85),
      trough: okShade(s.shade, 0.45),
      crest: s.crest,
      rim: okMix(s.crest, s.lit, 0.35),
      char: okShade(s.shade, 0.2),
    };
  }
  // AoT: soft wrap light, lit faces warming toward the crest colour.
  return {
    ...base,
    lit: s.lit,
    mid: okMix(s.lit, s.crest, 0.25),
    shadow: s.shade,
    trough: okShade(s.shade, 0.5),
    crest: s.crest,
    rim: okMix(s.crest, s.lit, 0.3),
    char: okShade(s.shade, 0.25),
  };
}

const SHAPES = {
  swell: { i: 0, amp: 15, lambda: 135 },
  pillow: { i: 2, amp: 11, lambda: 105 },
};

function applyLook(U: FieldUniforms, look: Look) {
  const s = SHAPES[look.shape];
  U.uShape.value = s.i;
  U.uAmp.value = s.amp;
  U.uLambda.value = s.lambda;
  U.uRipple.value = look.ripple === 'soft' ? 6 : 0;
  U.uShade.value = look.shade === 'soft' ? 0 : 1;
  U.uCrest.value = look.crest === 'rim' ? 1 : 3;
  U.uGrain.value = look.grain ? 1 : 0;
  U.uGround.value = look.cracks ? 1 : 0;
  U.uGlow.value = look.cracks ? 1 : 0;
  U.uDuneL.value.copy(LIGHTS[look.light]);
}

function applyTones(U: FieldUniforms, t: Tones) {
  U.uLit.value.set(t.lit);
  U.uMid.value.set(t.mid);
  U.uShadow.value.set(t.shadow);
  U.uTrough.value.set(t.trough);
  U.uCrestCol.value.set(t.crest);
  U.uRimCol.value.set(t.rim);
  U.uGlintCol.value.set(t.glint);
  U.uChar.value.set(t.char);
  U.uFarCol.value.set(t.far);
  U.uGlowCore.value.set(t.glowCore);
  U.uGlowHalo.value.set(t.glowHalo);
}

export const create: AssetFactory = ({ lab, backdrop, scene, layout, palette }) => {
  backdrop.setGroundVisible(false);

  const eye = new THREE.Vector2(layout.camera.position[0], layout.camera.position[2]);
  const pillar = new THREE.Vector2(layout.pillar.x, layout.pillar.z);
  const U = createFieldUniforms({
    pillar,
    // The flat dish around the pillar's foot (wider than the pillar itself).
    dishR: Math.max(120, layout.pillar.radius * 12),
    bones: new THREE.Vector2(layout.bones.x, layout.bones.z),
    // The bones' bed: a little wider than half the ribcage's length.
    bedR: layout.bones.length * 0.5 + 20,
    eye,
    groundY: layout.groundY,
  });
  // Densest grid between the eye and the pillar, where the crests are seen closest.
  const mesh = createDuneMesh(lab.env, U, new THREE.Vector2(0, (eye.y + pillar.y) / 2));
  scene.add(mesh);

  let current = OPTIONS[0].id;
  let pal = palette.current();
  let tones = tonesFor(LOOKS[current], pal);
  const recolour = () => {
    tones = tonesFor(LOOKS[current], pal);
    applyTones(U, tones);
  };
  applyLook(U, LOOKS[current]);
  palette.subscribe((p) => {
    pal = p;
    recolour();
  });

  return {
    id: 'dunes',
    label: 'Dunes',
    options: OPTIONS,
    setOption(id) {
      if (!LOOKS[id]) return;
      current = id;
      applyLook(U, LOOKS[id]);
      recolour();
    },
    update() {
      // The fog follows the scene fog (colour.ts owns it).
      const fog = scene.fog as THREE.FogExp2 | null;
      if (fog) {
        U.uFogCol.value.copy(fog.color);
        U.uFogDen.value = fog.density;
      }
    },
    params() {
      const l = LOOKS[current];
      return {
        shape: l.shape,
        ripple: l.ripple,
        shade: l.shade,
        crest: l.crest,
        grain: l.grain,
        cracks: l.cracks,
        palette: pal.id,
        tone: l.tone,
        lit: tones.lit,
        shadow: tones.shadow,
        trough: tones.trough,
        crestColour: tones.crest,
        far: tones.far,
        ...(l.cracks ? { seams: tones.glowCore, seamHalo: tones.glowHalo } : {}),
        light: l.light,
        amp: U.uAmp.value,
        wavelength: U.uLambda.value,
        lipHeight: U.uLipH.value,
      };
    },
  };
};

// COPIED from .claude/pages/ad/experiments/hell-src/scene/post.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Post class: the anime rendering finish of the shared hellscape — bloom,
 * glow, grade, film, paper, posterise, dither. Each option is a whole LOOK
 * built from a different technique (not a parameter tweak):
 *
 *   anime    hell-12 "Recommended": tight per-mip bloom + a hue-shifting glow
 *            stack, edge fringe, a split tone, halation, grain, a tinted
 *            vignette, view-anchored paper, triangular dither
 *   mono     single-hue gradient map in the palette's hue (bright glow protected):
 *            value does the work; energy-conserving pyramid bloom (no threshold), clean, no film
 *   painted  a cel-painted backdrop: Oklab lightness posterised into a few
 *            flat value bands + brush streaks running along the forms
 *   plain    the harness as the experiments were tuned: lab bloom, dither only
 *
 * Only screen-space work lives here: toon bands and ink hulls are material
 * choices the pillar / bones / islands classes make themselves.
 *
 * COLOUR comes from the scene palette (scene/palette.ts): the split tone is
 * post.shadows / post.highlights, the halation post.halation, the vignette
 * post.vignette, the glow stack falls off highlights -> glow.circles ->
 * post.shadows, and 'mono' maps the frame through the palette's own hue
 * (sky.mid) up to post.highlights. 'plain' stays neutral. hell-12 tuned all
 * of these as fixed crimson / oxblood constants in its finish shader; this
 * scene's COPY of that shader text reads them from uniforms instead (patched
 * in memory below, before it first compiles), and the CDL's red bias is
 * neutralised so the grade no longer pulls every frame toward red.
 *
 * hell-12's pass helpers are IMPORTED read-only from hell-12-anime-post-passes
 * (a helper module with no side effects); the keyed glow stack is COPIED and
 * adapted into scene/post-glow.ts.
 *
 * Pass order (linear HDR → display):
 *   Render → [GlowStack → Halation key → PyramidBloom] → UnrealBloom (lab)
 *          → Output (tone map + sRGB) → Finish (last, draws to the canvas)
 */

import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { bakeLut, blueNoiseTexture, finishMaterial, HalationPass, HardPrepass, PyramidBloomPass } from '../hell-12-anime-post-passes';
import type { AssetFactory, AssetOption } from './contract';
import type { ScenePalette } from './palette';
import { GlowStackPass } from './post-glow';
import { okHue, srgbVec } from './sky-ramp';

const OPTIONS: AssetOption[] = [
  {
    id: 'anime',
    label: 'Anime finish',
    description:
      'Tight per-mip bloom (glyphs stay legible) + a glow stack that falls off highlight → circle glow → shadow hue, 0.5–1.5 px fringe on bright edges, a split tone in the palette shadows / highlights, palette halation, 24 fps grain, a palette-tinted vignette and paper glued to the view.',
    source: 'hell-12 look:rec (bloom:tight glow:stack fringe:brief cgrade:split film:full paper:view dither:tri)',
  },
  {
    id: 'mono',
    label: 'Single hue',
    description:
      'The world mapped through one ramp in the palette\'s own hue (near-black → the sky hue → the palette highlight): one hue, value does the work, only the brightest glow keeps its own hot colour; soft energy-conserving pyramid bloom with no threshold; clean — no grain, paper or fringe.',
    source: 'hell-12 cgrade:mono / cgrade:monop (emissive protect) + bloom:pyramid + dither:blue',
  },
  {
    id: 'painted',
    label: 'Painted cel',
    description:
      'A cel-painted backdrop: lightness posterised (hue kept) into a few flat value bands with slightly ragged edges, brush streaks running along the forms; the glow stays smooth.',
    source: 'hell-12 poster:hard5 / poster:painted + paper:brush + cgrade:split',
  },
  {
    id: 'plain',
    label: 'Plain (as tuned)',
    description: 'No anime finish: the harness bloom every experiment was tuned under, plus an invisible dither against banding. The control.',
    source: 'hell-12 look:raw (bloom:lab) + dither:tri',
  },
];

/** One whole look: every switch the passes read. */
type Look = {
  bloom: 'lab' | 'tight' | 'pyramid';
  glow: boolean;
  fringe: boolean;
  grade: 'none' | 'split' | 'mono' | 'monop';
  halo: boolean;
  vignette: number;
  grain: number;
  paper: 'off' | 'view' | 'brush';
  poster: boolean;
  dither: 'tri' | 'blue';
};

const LOOKS: Record<string, Look> = {
  anime: { bloom: 'tight', glow: true, fringe: true, grade: 'split', halo: true, vignette: 0.6, grain: 0.035, paper: 'view', poster: false, dither: 'tri' },
  mono: { bloom: 'pyramid', glow: false, fringe: false, grade: 'monop', halo: false, vignette: 0.45, grain: 0, paper: 'off', poster: false, dither: 'blue' },
  painted: { bloom: 'tight', glow: false, fringe: false, grade: 'split', halo: false, vignette: 0.35, grain: 0, paper: 'brush', poster: true, dither: 'blue' },
  plain: { bloom: 'lab', glow: false, fringe: false, grade: 'none', halo: false, vignette: 0, grain: 0, paper: 'off', poster: false, dither: 'tri' },
};

/** Value bands of the painted look (Oklab lightness 0..1). */
const POSTER_STEPS = 6;

const GRADE_ID = { none: 0, mono: 1, monop: 2, split: 3 } as const;

/**
 * Patches to this scene's COPY of hell-12's finish shader text: its fixed
 * crimson ramp, split-tone tints, red-biased CDL and oxblood vignette become
 * uniforms (display-referred sRGB, like the constants they replace).
 */
const FINISH_PATCHES: [string, string][] = [
  ['uniform float uDither, uBandFinder;', 'uniform float uDither, uBandFinder;\n      uniform vec3 uMono0, uMono1, uMono2, uMono3, uMono4, uSlope, uShadowTint, uHiTint, uVigTint;'],
  [
    'vec3 s0 = srgbHex(5.0, 1.0, 2.0), s1 = srgbHex(36.0, 7.0, 8.0), s2 = srgbHex(83.0, 9.0, 14.0), s3 = srgbHex(168.0, 32.0, 26.0), s4 = srgbHex(255.0, 210.0, 176.0);',
    'vec3 s0 = uMono0, s1 = uMono1, s2 = uMono2, s3 = uMono3, s4 = uMono4;',
  ],
  ['vec3 slope = vec3(1.06, 0.96, 0.94);', 'vec3 slope = uSlope;'],
  ['vec3 offset = vec3(0.006, -0.004, violet ? 0.004 : -0.002);', 'vec3 offset = vec3(0.0);'],
  ['vec3 power = vec3(1.08, 1.16, violet ? 1.04 : 1.14);', 'vec3 power = vec3(1.12);'],
  ['vec3 shadowTint = violet ? srgbHex(58.0, 26.0, 74.0) : srgbHex(74.0, 13.0, 26.0);', 'vec3 shadowTint = uShadowTint;'],
  ['vec3 hiTint = srgbHex(255.0, 176.0, 96.0);', 'vec3 hiTint = uHiTint;'],
  ['c = mix(c * srgbHex(150.0, 34.0, 40.0) * 0.9, c, k);', 'c = mix(c * uVigTint * 0.9, c, k);'],
];

/** Every palette colour the finish and the glow stack use (sRGB hex). */
function postTones(p: ScenePalette) {
  const hue = p.sky.mid;
  return {
    // Mono: one ramp in the palette's own hue (hell-12's crimson ramp stops' lightness and chroma).
    mono: [okHue(hue, 0.07, 0.015), okHue(hue, 0.17, 0.05), okHue(hue, 0.28, 0.09), okHue(hue, 0.48, 0.15), p.post.highlights],
    shadows: p.post.shadows,
    highlights: p.post.highlights,
    halation: p.post.halation,
    vignette: p.post.vignette,
    glow: [p.post.highlights, p.glow.circles, p.post.shadows],
  };
}

export const create: AssetFactory = ({ lab, camera, palette }) => {
  const { composer, renderer } = lab;

  // The lab's UnrealBloom: shaped per option, its defaults kept for "plain".
  const bloom = composer.passes.find((p) => p instanceof UnrealBloomPass) as UnrealBloomPass;
  const factors = bloom.compositeMaterial.uniforms.bloomFactors;
  const bloomDefault = { strength: bloom.strength, radius: bloom.radius, threshold: bloom.threshold, factors: [...(factors.value as number[])] };

  // HDR passes, in order, just before the lab's bloom.
  const glow = new GlowStackPass();
  // The circles here peak around 1.5x HDR (hell-12's ran at 4-20x): key lower, add more.
  glow.key.uniforms.uLow.value = 0.6;
  glow.key.uniforms.uHigh.value = 1.4;
  glow.composite.uniforms.uGain.value = 2.5;
  const halation = new HalationPass();
  const pyramid = new PyramidBloomPass(4);
  pyramid.amount = 0.06;
  // hell-12 keyed halation at 2.2 (its circle ran at 4-20x HDR); this scene's glow peaks lower.
  halation.key.uniforms.uThreshold.value = 1.2;
  const insertBeforeBloom = (p: Pass) => composer.insertPass(p, composer.passes.indexOf(bloom));
  [glow, halation, pyramid].forEach(insertBeforeBloom);

  // The finish pass wants hell-12's hard-forms prepass for its masks. In the
  // shared scene there is no hard-forms layer, so the prepass is a 1×1
  // target cleared once to "soft world, sky depth": paper and posterise
  // then treat the whole frame as the painted world (the glow stays
  // protected by its brightness).
  const prepass = new HardPrepass();
  prepass.setSize(1, 1);
  {
    const clear = renderer.getClearColor(new THREE.Color());
    const alpha = renderer.getClearAlpha();
    renderer.setClearColor(0x808080, 0);
    renderer.setRenderTarget(prepass.target);
    renderer.clear(true, true, false);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear, alpha);
  }

  // Display-referred finish, appended after OutputPass: it draws to the canvas.
  // A tiny LUT: the baked-LUT grade is not one of the options here.
  const finishMat = finishMaterial(prepass, halation.texture, blueNoiseTexture(64, 7), bakeLut(2));
  for (const [from, to] of FINISH_PATCHES) {
    if (finishMat.fragmentShader.includes(from)) finishMat.fragmentShader = finishMat.fragmentShader.replace(from, to);
    else console.error(`[hell-20 post] finish patch not found: ${from}`);
  }
  const fu = finishMat.uniforms;
  for (const name of ['uMono0', 'uMono1', 'uMono2', 'uMono3', 'uMono4', 'uSlope', 'uShadowTint', 'uHiTint', 'uVigTint']) fu[name] = { value: new THREE.Vector3(1, 1, 1) };
  fu.uLutSize.value = 2;
  fu.uInvProj.value = camera.projectionMatrixInverse;
  fu.uCamWorld.value = camera.matrixWorld;
  fu.uPR.value = lab.pixelRatio;
  const finish = new ShaderPass(finishMat);
  composer.addPass(finish);

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  (fu.uRes.value as THREE.Vector2).set(Math.max(1, size.x), Math.max(1, size.y));
  lab.onResize((w, h) => (fu.uRes.value as THREE.Vector2).set(w, h));

  let current = OPTIONS[0].id;
  let pal = palette.current();
  let tones = postTones(pal);

  // Colours only (uniform writes): every option reads them, 'plain' ignores them.
  const recolour = () => {
    tones = postTones(pal);
    tones.mono.forEach((hex, i) => srgbVec(hex, fu[`uMono${i}`].value as THREE.Vector3));
    srgbVec(tones.shadows, fu.uShadowTint.value as THREE.Vector3);
    srgbVec(tones.highlights, fu.uHiTint.value as THREE.Vector3);
    // CDL slope: a gentle lean toward the highlight colour (hell-12's was a fixed red lean).
    const hi = srgbVec(tones.highlights);
    const mean = (hi.x + hi.y + hi.z) / 3;
    (fu.uSlope.value as THREE.Vector3).set(1 + 0.3 * (hi.x - mean), 1 + 0.3 * (hi.y - mean), 1 + 0.3 * (hi.z - mean));
    // Vignette: hell-12 multiplied by #962228 (max channel ~0.59); same strength, palette hue.
    const vig = srgbVec(tones.vignette);
    (fu.uVigTint.value as THREE.Vector3).copy(vig.multiplyScalar(0.59 / Math.max(vig.x, vig.y, vig.z, 1e-3)));
    // Halation: the palette colour at full strength on its brightest channel.
    const hal = srgbVec(tones.halation);
    (fu.uHaloTint.value as THREE.Vector3).copy(hal.multiplyScalar(1 / Math.max(hal.x, hal.y, hal.z, 1e-3)));
    // Glow stack: highlight core → circle glow → shadow hue, at hell-12's strengths.
    const cu = glow.composite.uniforms;
    (cu.c0.value as THREE.Color).set(tones.glow[0]).multiplyScalar(0.16);
    (cu.c1.value as THREE.Color).set(tones.glow[1]).multiplyScalar(0.06);
    (cu.c2.value as THREE.Color).set(tones.glow[2]).multiplyScalar(0.16);
  };
  palette.subscribe((p) => {
    pal = p;
    recolour();
  });

  const apply = (look: Look) => {
    // bloom
    const tints = bloom.bloomTintColors;
    tints.forEach((t) => t.set(1, 1, 1));
    pyramid.enabled = look.bloom === 'pyramid';
    bloom.enabled = look.bloom !== 'pyramid';
    if (look.bloom === 'tight') {
      // core + a ~4 %-of-frame halo: only mips 0-1 contribute
      bloom.strength = 0.7;
      bloom.radius = 0;
      bloom.threshold = 0.85;
      factors.value = [1.0, 0.7, 0.08, 0.0, 0.0];
    } else {
      bloom.strength = bloomDefault.strength;
      bloom.radius = bloomDefault.radius;
      bloom.threshold = bloomDefault.threshold;
      factors.value = [...bloomDefault.factors];
    }
    glow.enabled = look.glow;

    // fringe: R/B split along the brightness gradient, 0.5 px rising to 1.5 px at bright edges
    fu.uFringeMin.value = 0.5;
    fu.uFringeMax.value = look.fringe ? 1.5 : 0;
    fu.uFringeMode.value = 0;

    // grade
    fu.uGrade.value = GRADE_ID[look.grade];

    // film: halation (soft core cut), tinted vignette, mono grain at 24 fps
    halation.enabled = look.halo;
    fu.uHalo.value = look.halo ? 0.28 : 0;
    fu.uHaloCore.value = look.halo ? 0.6 : 0;
    fu.uVig.value = look.vignette;
    fu.uVigMode.value = 0;
    fu.uGrain.value = look.grain;
    fu.uGrainFps.value = 24;
    fu.uGrainChroma.value = 0;

    // paper: view-anchored tooth + fibres, or brush streaks along the forms
    fu.uPaper.value = look.paper === 'off' ? 0 : look.paper === 'brush' ? 0.55 : 0.25;
    fu.uPaperMode.value = look.paper === 'brush' ? 2 : 0;

    // posterise-lite: flat lightness bands (hue kept), edges a little ragged with blue noise
    fu.uPoster.value = look.poster ? POSTER_STEPS : 0;
    fu.uPosterSoft.value = 0.05;
    fu.uPosterJitter.value = 0.12;
    fu.uPosterMask.value = 0;

    // dither (always on: dark skies band without it)
    fu.uDither.value = look.dither === 'blue' ? 3 : 2;
    fu.uBandFinder.value = 0;
  };

  apply(LOOKS[current]);

  return {
    id: 'post',
    label: 'Post',
    options: OPTIONS,
    setOption(id) {
      if (!LOOKS[id]) return;
      current = id;
      apply(LOOKS[id]);
    },
    update(t) {
      fu.uTime.value = t;
      fu.uFrame.value = lab.env.uFrame.value;
    },
    params() {
      const look = LOOKS[current];
      return {
        bloom: look.bloom,
        bloomStrength: look.bloom === 'pyramid' ? pyramid.amount : bloom.strength,
        bloomThreshold: look.bloom === 'pyramid' ? 0 : bloom.threshold,
        glowStack: look.glow,
        fringePx: look.fringe ? '0.5-1.5' : 0,
        grade: look.grade,
        halation: look.halo,
        vignette: look.vignette,
        grain: look.grain,
        paper: look.paper,
        posterSteps: look.poster ? POSTER_STEPS : 0,
        dither: look.dither,
        palette: pal.id,
        ...(look.grade === 'split' ? { splitShadows: tones.shadows, splitHighlights: tones.highlights } : {}),
        ...(look.grade === 'monop' ? { monoRamp: tones.mono.join('→') } : {}),
        ...(look.halo ? { halationColour: tones.halation } : {}),
        ...(look.vignette > 0 ? { vignetteColour: tones.vignette } : {}),
        ...(look.glow ? { glowColours: tones.glow.join('→') } : {}),
      };
    },
  };
};

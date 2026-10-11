// COPIED from .claude/pages/ad/experiments/hell-src/scene/circles-seal.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Circles option "great seal": one huge hell-01 sigil standing upright in
 * the sky behind the pillar, its layers counter-turning.
 *
 * The live SDF shader, the design builder, the glyph alphabet and the glyph
 * atlas are IMPORTED read-only from the hell-01 helper modules. The palette
 * values and the slot/upload code are COPIED from hell-01-circle-designs.ts
 * (that module is the experiment's page and must not be imported).
 */

import * as THREE from 'three';
import { buildAtlas } from '../hell-01-circle-designs-bake';
import { buildDesign, makeAlphabet, reachOf, type AlphabetMode } from '../hell-01-circle-designs-designs';
import { CIRCLE_FRAG, CIRCLE_VERT, MAXL } from '../hell-01-circle-designs-glsl';
import type { ScenePalette } from './palette';

/**
 * hell-01 palettes the reviewers rated strongest, re-expressed around the
 * scene palette's circles colour C: line / core / halo are C × these (linear),
 * so with C = #e0182a they give back hell-01's own colours (blackred: line
 * #0a0204, core #e0182a, halo #7a0a16; ember: line #5a080e, core #ff3a1c,
 * halo #90140f). The accent line (off by default) is the embers' colour.
 */
export const SEAL_PALETTES = {
  blackred: { line: 0.0012, core: 1, hot: 1.8, halo: 0.26, glowAmt: 0.55, dark: 0.8, rim: 1 },
  ember: { line: 0.14, core: 1.34, hot: 2.0, halo: 0.37, glowAmt: 0.7, dark: 0.55, rim: 0 },
};

export type SealConfig = {
  design: string; // a hell-01 DESIGNS id
  seed: number;
  glyphs: AlphabetMode;
  palette: keyof typeof SEAL_PALETTES;
  style: number; // 0 hairline, 1 core+glow, 2 double, ...
};

export type Seal = {
  mesh: THREE.Mesh;
  /** Start the draw-on reveal again (when the option is picked). */
  redraw(): void;
  update(t: number, dt: number): void;
  /** Take the circles' colour from the palette. */
  recolour(p: ScenePalette): void;
};

export function createSeal(
  renderer: THREE.WebGLRenderer,
  env: Record<string, { value: unknown }>,
  centre: THREE.Vector3,
  radius: number,
  eye: THREE.Vector3,
  cfg: SealConfig,
): Seal {
  const alphabet = makeAlphabet(cfg.seed, cfg.glyphs);
  const atlas = buildAtlas(renderer, makeAlphabet(1, 'script4'));
  const p = SEAL_PALETTES[cfg.palette];
  const uniforms = {
    ...env,
    uLine: { value: new THREE.Color() },
    uCore: { value: new THREE.Color() },
    uHalo: { value: new THREE.Color() },
    uAccent: { value: new THREE.Color() },
    uHot: { value: p.hot },
    uGlowAmt: { value: p.glowAmt },
    uDark: { value: p.dark },
    uRim: { value: p.rim },
    uAccentAmt: { value: 0 },
    uFringe: { value: 0 },
    uStyle: { value: cfg.style },
    uGlowR: { value: 0.012 },
    uSpinT: { value: 0 },
    uDraw: { value: 1 },
    uWave: { value: 0 },
    uA: { value: new Float32Array(MAXL * 4) },
    uB: { value: new Float32Array(MAXL * 4) },
    uC: { value: new Float32Array(MAXL * 4) },
    uCount: { value: 0 },
    uEdge: { value: new Float32Array(58 * 4) },
    uGlyph: { value: new Int32Array(64 * 2) },
    uGlyphN: { value: 64 },
    uAtlas: { value: atlas.texture },
    uSeed: { value: cfg.seed % 1000 },
    uGlobalRot: { value: 0 },
    uBake: { value: 0 },
    uFade: { value: 1 },
  };

  // Pack the design into the uniform arrays (copied from hell-01 upload()).
  const design = buildDesign(cfg.design, cfg.seed, null);
  const layers = design.layers.slice(0, MAXL);
  layers.forEach((l, i) => {
    uniforms.uA.value.set([l.type, l.r, l.w, l.inten ?? 1], i * 4);
    uniforms.uB.value.set(l.p ?? [0, 0, 0, 0], i * 4);
    uniforms.uC.value.set([l.rot ?? 0, l.spin ?? 0, (l.seed ?? 0) % 1000, reachOf(l)], i * 4);
  });
  uniforms.uCount.value = layers.length;
  uniforms.uEdge.value.set(alphabet.flat);
  uniforms.uGlyph.value.set(alphabet.packed);

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: CIRCLE_VERT,
    fragmentShader: CIRCLE_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // Premultiplied: rgb is light added, alpha darkens what is behind.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), material);
  mesh.name = `circles-seal-${cfg.design}`;
  mesh.position.copy(centre);
  mesh.scale.setScalar(radius);
  mesh.lookAt(eye); // upright, facing the scene camera
  mesh.frustumCulled = false;

  let drawT = 0;
  return {
    mesh,
    redraw() {
      drawT = 0;
    },
    recolour(palette) {
      const c = palette.glow.circles;
      uniforms.uLine.value.set(c).multiplyScalar(p.line);
      uniforms.uCore.value.set(c).multiplyScalar(p.core);
      uniforms.uHalo.value.set(c).multiplyScalar(p.halo);
      uniforms.uAccent.value.set(palette.glow.embers);
    },
    update(t, dt) {
      drawT += Math.min(dt, 0.1);
      // Layers counter-turn (their own spins) while the whole seal turns slowly.
      uniforms.uSpinT.value = t;
      uniforms.uGlobalRot.value = t * 0.02;
      // Draw-on over ~5 s after the option is picked (hell-01 motion:draw).
      uniforms.uDraw.value = Math.min(1, drawT / 5);
    },
  };
}

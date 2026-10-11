// COPIED from .claude/pages/ad/experiments/hell-src/scene/particles-ground.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Ground fit for the particles class.
 *
 * The HELL-10 shaders (imported read-only) find the sand with a GLSL
 * `duneY(xz)` baked in from DUNE_GLSL: the experiment's own low dunes. The
 * full scene's dunes are different (a flat dish around the pillar with a
 * raised lip, a low bed under the bones, and an open field that sinks below
 * the eye and rises again far out). So, on OUR material instances only, the
 * DUNE_GLSL text is swapped for `groundGlsl()`: the MEAN surface of the
 * scene's dune field (no single crests, so it fits every dunes option well
 * enough for soft contacts, spawn heights and devil feet).
 *
 * The numbers mirror scene/dunes-field.ts (dish, lip, bed, sink); they are an
 * approximation, kept here so the particles never depend on the dunes class.
 */

import * as THREE from 'three';
import { DUNE_GLSL } from '../hell-10-particles-and-mist-glsl';
import type { LAYOUT } from './contract';

type Layout = typeof LAYOUT;

/** The fixed numbers of the ground, from the layout. */
function groundNumbers(layout: Layout) {
  return {
    px: layout.pillar.x,
    pz: layout.pillar.z,
    dishR: Math.max(120, layout.pillar.radius * 12),
    bx: layout.bones.x,
    bz: layout.bones.z,
    bedR: layout.bones.length * 0.5 + 20,
    ex: layout.camera.position[0],
    ez: layout.camera.position[2],
    y0: layout.groundY,
    mean: 14, // mean dune height above the floor, metres
    lipH: 12,
  };
}

const f = (n: number) => n.toFixed(3);

/** GLSL `float duneY(vec2 xz)`: the scene's mean sand height. */
export function groundGlsl(layout: Layout, lift = 0): string {
  const g = groundNumbers(layout);
  return /* glsl */ `
float duneY(vec2 xz) {
  float dp = length(xz - vec2(${f(g.px)}, ${f(g.pz)}));
  float db = length(xz - vec2(${f(g.bx)}, ${f(g.bz)}));
  float dc = length(xz - vec2(${f(g.ex)}, ${f(g.ez)}));
  // Dune height: flat in the pillar's dish, a lip around it, low in the bones' bed.
  float h = ${f(g.mean)} * smoothstep(${f(g.dishR * 0.85)}, ${f(g.dishR * 2.1)}, dp);
  float lip = (dp - ${f(g.dishR * 1.4)}) / ${f(g.dishR * 0.28)};
  h += ${f(g.lipH)} * exp(-lip * lip);
  h *= 1.0 - 0.65 * (1.0 - smoothstep(${f(g.bedR * 0.5)}, ${f(g.bedR * 1.2)}, db));
  // Small near the eye (the ledge it stands on).
  h *= mix(mix(0.0, 0.08, smoothstep(2.0, 20.0, dc)), 1.0, smoothstep(10.0, 180.0, dc));
  // The open field sinks below the eye, then rises far out; dish and bed stay put.
  float keep = max(1.0 - smoothstep(${f(g.dishR)}, ${f(g.dishR * 1.9)}, dp),
                   1.0 - smoothstep(${f(g.bedR * 0.6)}, ${f(g.bedR * 1.9)}, db));
  float sink = (30.0 * smoothstep(20.0, 110.0, dc) - 150.0 * smoothstep(450.0, 1500.0, dc)) * (1.0 - keep);
  return ${f(g.y0 + lift)} + h - sink;
}
`;
}

/** The same surface in JS (for placing the sand devils' feet). */
export function groundY(layout: Layout, x: number, z: number): number {
  const g = groundNumbers(layout);
  const ss = (a: number, b: number, v: number) => THREE.MathUtils.smoothstep(v, a, b);
  const dp = Math.hypot(x - g.px, z - g.pz);
  const db = Math.hypot(x - g.bx, z - g.bz);
  const dc = Math.hypot(x - g.ex, z - g.ez);
  let h = g.mean * ss(g.dishR * 0.85, g.dishR * 2.1, dp);
  const lip = (dp - g.dishR * 1.4) / (g.dishR * 0.28);
  h += g.lipH * Math.exp(-lip * lip);
  h *= 1 - 0.65 * (1 - ss(g.bedR * 0.5, g.bedR * 1.2, db));
  h *= THREE.MathUtils.lerp(THREE.MathUtils.lerp(0, 0.08, ss(2, 20, dc)), 1, ss(10, 180, dc));
  const keep = Math.max(1 - ss(g.dishR, g.dishR * 1.9, dp), 1 - ss(g.bedR * 0.6, g.bedR * 1.9, db));
  const sink = (30 * ss(20, 110, dc) - 150 * ss(450, 1500, dc)) * (1 - keep);
  return g.y0 + h - sink;
}

/**
 * Swap colour constants in the shader text of every ShaderMaterial under
 * `root` (OUR instances, before their first compile; both stages, since some
 * emitters colour in the vertex shader), prepend `decls` and merge `uniforms`
 * into each material that a swap touched. Logs any swap found nowhere.
 */
export function swapShaderText(root: THREE.Object3D, decls: string, swaps: [string, string][], uniforms: Record<string, { value: unknown }>, who: string) {
  const found = new Set<string>();
  root.traverse((o) => {
    const material = (o as THREE.Mesh).material;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      if (!(m instanceof THREE.ShaderMaterial)) continue;
      let touched = false;
      for (const stage of ['vertexShader', 'fragmentShader'] as const) {
        let src = m[stage];
        for (const [from, to] of swaps) {
          if (!src.includes(from)) continue;
          src = src.split(from).join(to);
          found.add(from);
          touched = true;
        }
        m[stage] = src;
      }
      if (!touched) continue;
      m.vertexShader = decls + m.vertexShader;
      m.fragmentShader = decls + m.fragmentShader;
      Object.assign(m.uniforms, uniforms);
      m.needsUpdate = true;
    }
  });
  for (const [from] of swaps) if (!found.has(from)) console.error(`[${who}] shader text not found, colour not swapped: ${from}`);
}

/** Swap the experiment's dune function for the scene's ground in every
 *  ShaderMaterial under `root` (before their first compile). `lift` raises
 *  that ground (metres), e.g. to set dust up at the crests' level. */
export function fitGround(root: THREE.Object3D, layout: Layout, lift = 0) {
  const glsl = groundGlsl(layout, lift);
  root.traverse((o) => {
    const material = (o as THREE.Mesh).material;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      if (!(m instanceof THREE.ShaderMaterial)) continue;
      m.vertexShader = m.vertexShader.split(DUNE_GLSL).join(glsl);
      m.fragmentShader = m.fragmentShader.split(DUNE_GLSL).join(glsl);
      m.needsUpdate = true;
    }
  });
}

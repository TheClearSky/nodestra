// COPIED from .claude/pages/ad/experiments/env-src/scene-motes.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * Glowing motes as INSTANCED camera-facing quads (not THREE.Points).
 *
 * Why: on this machine (Intel UHD, ANGLE → D3D11) GL point sprites are
 * emulated, and 260 `THREE.Points` drawn into the composer's 4× MSAA target
 * stalled the whole frame to ~0 fps (bisected 2026-10-04). Quads cost the
 * same and keep gtr-02's look: size = aSize · (k / depth) px, a soft round
 * core, additive.
 */

import * as THREE from 'three';

export type MoteCloud = {
  mesh: THREE.Mesh;
  count: number;
  /** xyz per mote (write, then `commit()`). */
  position: Float32Array;
  alpha: Float32Array;
  size: Float32Array;
  commit(): void;
  dispose(): void;
};

export function createMoteCloud(
  count: number,
  options: { color: THREE.Color; pixelRatio: number; scale?: number; minPx?: number },
): MoteCloud {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const position = new Float32Array(count * 3);
  const alpha = new Float32Array(count);
  const size = new Float32Array(count);
  const aPos = new THREE.InstancedBufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage);
  const aAlpha = new THREE.InstancedBufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage);
  const aSize = new THREE.InstancedBufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPos', aPos);
  geo.setAttribute('aAlpha', aAlpha);
  geo.setAttribute('aSize', aSize);
  geo.instanceCount = count;
  const viewport = new THREE.Vector2(1600, 1000);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPR: { value: options.pixelRatio },
      uScale: { value: options.scale ?? 0.35 },
      uMinPx: { value: options.minPx ?? 1.5 },
      uViewport: { value: viewport },
      uColor: { value: options.color },
    },
    vertexShader: /* glsl */ `
      uniform float uPR;
      uniform float uScale;
      uniform float uMinPx;
      uniform vec2 uViewport;
      attribute vec3 aPos;
      attribute float aAlpha;
      attribute float aSize;
      varying vec2 vUv;
      varying float vA;
      void main() {
        vUv = position.xy;
        vA = aAlpha;
        if (aAlpha <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec4 v = viewMatrix * vec4(aPos, 1.0);
        vec4 clip = projectionMatrix * v;
        float px = max(aSize * uPR * (uScale / max(-v.z, 1e-3)), uMinPx * uPR);
        clip.xy += position.xy * px / uViewport * clip.w;
        gl_Position = clip;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec2 vUv;
      varying float vA;
      void main() {
        float d = length(vUv) * 0.5;
        float core = smoothstep(0.5, 0.0, d);
        core *= core;
        if (core * vA < 0.002) discard;
        gl_FragColor = vec4(uColor * core * vA, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 50;
  mesh.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(viewport);
  };
  return {
    mesh,
    count,
    position,
    alpha,
    size,
    commit() {
      aPos.needsUpdate = true;
      aAlpha.needsUpdate = true;
      aSize.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}

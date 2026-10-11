// COPIED from .claude/pages/ad/experiments/hell-src/scene/pillar-chains.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * The chains of light for the "Chained tower" pillar, placed in the shared
 * scene. COPIED from hell-06-pillar-parts.ts (makeChains) and changed only so
 * it takes the pillar's foot, a scale and the ground height instead of the
 * experiment's own FOOT / stand-in dunes, and skips chains that would land on
 * another asset (the bones). The experiment file is untouched.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENV_GLSL, seededRandom, type EnvUniforms } from '../../env-src/lab';
import { H, PILLAR_GLSL, type PillarUniforms } from '../hell-06-pillar-glsl';

export type ChainPlacement = {
  /** World position of the pillar's foot. */
  foot: THREE.Vector3;
  /** Experiment metres → scene metres. */
  scale: number;
  /** Where the chains leave the shaft, metres above the foot (scene units). */
  summitY: number;
  count: number;
  seed: number;
  /** The ground height: the chains end just under it. */
  groundY: number;
  /** Ground spots (world xz + radius) no chain may land in. */
  avoid: { x: number; z: number; r: number }[];
  fovY: { value: number };
};

export function makeSceneChains(env: EnvUniforms, P: PillarUniforms, o: ChainPlacement): THREE.Mesh {
  const rand = seededRandom(o.seed);
  const s = o.scale;
  const segs = 80;
  const strips: THREE.BufferGeometry[] = [];
  for (let k = 0; k < o.count; k++) {
    // Uneven fan: mostly to the sides and toward the camera.
    const a = Math.PI * 0.5 + ((k + 0.5) / o.count - 0.5) * Math.PI * 1.9 + (rand() - 0.5) * 0.3;
    const dist = H * s * (0.3 + rand() * 0.55);
    const bx = o.foot.x + Math.cos(a) * dist * 1.25;
    const bz = o.foot.z + Math.sin(a) * dist * 0.8;
    const summit = o.summitY - rand() * 20 * s;
    const sag = 0.01 + rand() * 0.025;
    const s0 = rand() * 10;
    // Keep clear of the other assets on the ground.
    if (o.avoid.some((p) => Math.hypot(bx - p.x, bz - p.z) < p.r)) continue;
    const A = new THREE.Vector3(o.foot.x + Math.cos(a) * 8 * s, o.foot.y + summit, o.foot.z + Math.sin(a) * 8 * s);
    const B = new THREE.Vector3(bx, o.groundY - 2, bz);
    const pos: number[] = [];
    const aA: number[] = [];
    const aB: number[] = [];
    const prm: number[] = [];
    const idx: number[] = [];
    const len = A.distanceTo(B);
    for (let i = 0; i <= segs; i++) {
      for (const side of [-1, 1]) {
        pos.push(side, i / segs, 0);
        aA.push(A.x, A.y, A.z);
        aB.push(B.x, B.y, B.z);
        prm.push(sag, s0, 1.8 * s, len);
      }
      if (i < segs) {
        const b = i * 2;
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aA', new THREE.Float32BufferAttribute(aA, 3));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(aB, 3));
    g.setAttribute('aPrm', new THREE.Float32BufferAttribute(prm, 4));
    g.setIndex(idx);
    strips.push(g);
  }
  const m = new THREE.ShaderMaterial({
    uniforms: { ...env, ...P, uFovY: o.fovY, uLink: { value: 7 * s } },
    vertexShader: /* glsl */ `
      uniform float uMT; uniform float uFovY; uniform vec2 uRes;
      attribute vec3 aA; attribute vec3 aB; attribute vec4 aPrm;
      varying float vM; varying float vSide; varying float vSeed; varying vec3 vWorld; varying float vCover;
      vec3 at(float s) {
        // A nearly taut chain: straight line plus a parabolic sag, slowly throbbing.
        float sag = aPrm.x * (1.0 + 0.4 * sin(uMT * 3.1 + aPrm.y));
        return mix(aA, aB, s) - vec3(0.0, 4.0 * sag * s * (1.0 - s) * aPrm.w, 0.0);
      }
      void main() {
        float s = position.y;
        vec3 p = at(s);
        vec3 t = normalize(at(min(s + 0.01, 1.0)) - at(max(s - 0.01, 0.0)));
        vec3 side = normalize(cross(t, normalize(cameraPosition - p)));
        // Phone-wire AA: never thinner than ~1.5 px; fade instead.
        float px = length(cameraPosition - p) * 2.0 * tan(uFovY * 0.5) / uRes.y;
        float w = aPrm.z * 3.0;
        float wd = max(w, px * 2.5);
        vCover = w / wd;
        p += side * position.x * wd;
        vM = s * aPrm.w;
        vSide = position.x;
        vSeed = aPrm.y;
        vWorld = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${PILLAR_GLSL}
      uniform float uLink;
      varying float vM; varying float vSide; varying float vSeed; varying vec3 vWorld; varying float vCover;
      void main() {
        // Links crawl toward the summit; dash : gap ≈ 1 : 0.6.
        float link = fract(vM / uLink + uMT * 1.2 + vSeed);
        float dash = smoothstep(0.0, 0.06, link) * (1.0 - smoothstep(0.56, 0.62, link));
        float x = abs(vSide);
        float core = 1.0 - smoothstep(0.12, 0.3, x);
        float glow = exp(-x * 3.2) * 0.5;
        vec3 c = uCore * dash * core * 2.4 + uFringe * glow * (0.5 + 0.5 * dash);
        gl_FragColor = vec4(c * vCover * fogTrans(vWorld), 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(mergeGeometries(strips)!, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  mesh.name = 'pillar-chains';
  return mesh;
}

// COPIED from .claude/pages/ad/experiments/env-src/shadow.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * The light on the ground under a tree, as a SHADOW FIELD: a top-down
 * render target (1024², re-rendered every frame so the dapple can move)
 * covering the area the crown's shadow can reach for the current sun.
 * Each texel evaluates the crown's analytic shadow (foliage.ts
 * `canopyCover`, in sun-ray coordinates) on the ground height, in one of
 * four styles:
 *
 *   S1 painted pool  — ref 1: one solid, soft-edged pool following the
 *                      crown's scalloped outline (no spots at all);
 *   S2 pinhole       — the env-02 komorebi: every gap is a pinhole camera
 *                      whose sun-disc grows with the drop below the leaves;
 *   S3 pool + spots  — the S1 pool, with a FEW soft sun-discs only near its
 *                      rim, plus faint light shafts at the crown's edge;
 *   S4 dappled paint — big painted light blotches (domain-warped noise)
 *                      drifting with the breeze.
 *
 * Grass, ground and props sample it (SHADOW_SAMPLE_GLSL) — a texture fetch
 * instead of a 100-clump loop per blade fragment.
 * Channels: R = sun visibility, G = pool cover, B = contact AO at the trunk.
 */

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { seededRandom } from './lab';
import { CANOPY_GLSL, type CanopyUniforms, type Clump } from './foliage';
import { KIT_GLSL, SLOPE_GLSL, slopeHeight, type KitUniforms } from './v2kit';

export type ShadowUniforms = {
  tShadow: { value: THREE.Texture };
  uShadowRect: { value: THREE.Vector4 };
  uShadowOn: { value: number };
};

export const SHADOW_SAMPLE_GLSL = /* glsl */ `
uniform sampler2D tShadow;
uniform vec4 uShadowRect; // minX, minZ, 1/sizeX, 1/sizeZ
uniform float uShadowOn;
/** (visibility, pool cover, trunk AO) at p, which stands 'above' metres
 *  over the ground: follow the sun ray down to where it meets the ground. */
vec3 shadowAt(vec3 p, float above) {
  vec2 xz = p.xz - uSunDir.xz / max(uSunDir.y, 0.08) * above;
  vec2 uv = (xz - uShadowRect.xy) * uShadowRect.zw;
  if (uShadowOn < 0.5 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(1.0, 0.0, 0.0);
  return texture2D(tShadow, uv).rgb;
}
`;

/** Uniforms for a page with no tree: the sample returns full sun. */
export function noShadowUniforms(): ShadowUniforms {
  const tex = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
  tex.needsUpdate = true;
  return { tShadow: { value: tex }, uShadowRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uShadowOn: { value: 0 } };
}

export type ShadowMode = 'pool' | 'pinhole' | 'spots' | 'dapple';
const MODE_INDEX: Record<ShadowMode, number> = { pool: 0, pinhole: 1, spots: 2, dapple: 3 };

export type ShadowField = {
  uniforms: ShadowUniforms;
  setMode(mode: ShadowMode): void;
  /** Point the field at a tree (or null for none); recomputes the bounds. */
  setCanopy(canopy: CanopyUniforms | null, clumps: Clump[]): void;
  /** Recompute bounds + shafts after the sun moved (light toggle). */
  refresh(): void;
  /** Render the field (call once per frame before the scene). */
  update(): void;
  /** Rim light shafts (shown for S3). */
  shafts: THREE.Mesh;
};

export function createShadowField(renderer: THREE.WebGLRenderer, u: KitUniforms, res = 1024): ShadowField {
  const target = new THREE.WebGLRenderTarget(res, res, { type: THREE.UnsignedByteType, depthBuffer: false });
  target.texture.minFilter = THREE.LinearFilter;
  target.texture.magFilter = THREE.LinearFilter;
  target.texture.generateMipmaps = false;
  const uniforms: ShadowUniforms = {
    tShadow: { value: target.texture },
    uShadowRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uShadowOn: { value: 0 },
  };
  const rect = new THREE.Vector4();
  const uMode = { value: 0 };
  let canopy: CanopyUniforms | null = null;
  let clumps: Clump[] = [];

  const fieldMaterial = new THREE.ShaderMaterial({
    uniforms: {
      ...u,
      uClumps: { value: [] as THREE.Vector4[] },
      uClumpCount: { value: 0 },
      uTrunkA: { value: new THREE.Vector3() },
      uTrunkB: { value: new THREE.Vector3() },
      uTrunkR: { value: new THREE.Vector2() },
      uCrownC: { value: new THREE.Vector3() },
      uCrownR: { value: new THREE.Vector3(1, 1, 1) },
      uRect: { value: rect },
      uMode,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      ${KIT_GLSL}
      ${CANOPY_GLSL}
      ${SLOPE_GLSL}
      uniform vec4 uRect; // minX, minZ, sizeX, sizeZ
      uniform float uMode;
      varying vec2 vUv;

      /** Pinhole sun-discs (env-02): a lattice of possible gaps; open ones
       *  project discs whose radius grows with the drop below the leaves. */
      float pinholes(vec2 rc, float drop, float cell, float seed, float openAt, float radScale) {
        vec2 g = rc / cell;
        vec2 id = floor(g);
        float best = 0.0;
        float rad = (0.05 + drop * 0.009) * radScale / cell;
        float soft = rad * 0.25 + 0.012 / cell;
        for (int i = -1; i <= 1; i++) {
          for (int j = -1; j <= 1; j++) {
            vec2 c = id + vec2(float(i), float(j));
            vec2 h = hash22(c + seed);
            float phase = h.x * 6.2832;
            vec2 sway = vec2(sin(uTime * (1.1 + h.y) + phase), cos(uTime * (0.9 + h.x) + phase * 1.3)) * 0.12 * (0.4 + uBreeze);
            vec2 centre = c + 0.2 + 0.6 * h + sway;
            float open = smoothstep(openAt, openAt + 0.15, hash12(c * 1.7 + seed) + 0.14 * sin(uTime * (1.7 + h.y * 2.0) + phase));
            float d = length(g - centre);
            best = max(best, open * (1.0 - smoothstep(rad - soft, rad + soft, d)));
          }
        }
        return best;
      }

      void main() {
        vec2 xz = uRect.xy + vUv * uRect.zw;
        vec3 p = vec3(xz.x, groundH(xz), xz.y);
        vec3 su; vec3 sv;
        sunBasis(su, sv);
        vec2 rc = vec2(dot(p, su), dot(p, sv));
        float drop; float broad;
        bool pin = uMode > 0.5 && uMode < 1.5;
        // Painted edge: wide and soft. Pinhole: the physical penumbra.
        float edge = pin ? 0.1 : 0.32;
        // The painted pool is solid: discs grown so neighbours always overlap.
        float cover = canopyCover(p, edge, pin ? 1.0 : 1.12, drop, broad);
        if (!pin) {
          // Fill the crown's core: the ray's closest approach to the crown
          // ellipsoid (in its unit-sphere space) — a painted pool has no holes.
          vec3 q = (p - uCrownC) / uCrownR;
          vec3 s = normalize(uSunDir / uCrownR);
          float along = -dot(q, s);
          float core = along > 0.0 ? length(q + s * along) : 9.0;
          cover = max(cover, 1.0 - smoothstep(0.62, 0.8, core));
          // A brushy wobble on the pool's outline.
          float wob = fbm3(rc * 1.3) - 0.5;
          cover = clamp(cover + wob * 0.5 * cover * (1.0 - cover) * 4.0, 0.0, 1.0);
        }
        float vis = 1.0 - cover;
        if (cover > 0.0) {
          if (pin) {
            float holes = max(max(pinholes(rc, drop, 0.42, 1.3, 0.55, 1.0), pinholes(rc, drop * 1.3, 0.75, 7.9, 0.55, 1.0) * 0.95), pinholes(rc, drop * 1.7, 1.2, 3.1, 0.55, 1.0) * 0.85);
            vis = mix(1.0, holes, cover);
          } else if (uMode > 1.5 && uMode < 2.5) {
            // Only near the rim of the pool, and only a few, bigger + softer.
            float rim = 1.0 - smoothstep(0.7, 0.95, broad);
            float spots = pinholes(rc, drop * 1.4, 1.4, 4.2, 0.5, 2.6) * rim;
            spots = max(spots, pinholes(rc, drop, 0.9, 9.1, 0.62, 1.8) * rim * 0.85);
            vis = mix(1.0, spots * 0.9, cover);
          } else if (uMode > 2.5) {
            // Painted blotches: domain-warped noise, drifting with the breeze.
            vec2 q = rc * 0.7;
            vec2 w = vec2(fbm3(q * 0.6 + 3.0), fbm3(q * 0.6 + 7.0)) * 1.6;
            vec2 sway = uWindDir * sin(uTime * 0.7 + rc.x * 0.2) * 0.1 * (0.3 + uBreeze);
            float n = fbm(q + w + sway);
            float blot = smoothstep(0.55, 0.59, n);
            // Brighter, bigger blotches toward the rim; sparse in the core.
            float rim = 1.0 - smoothstep(0.5, 0.95, broad);
            blot *= mix(0.55, 1.0, rim);
            vis = mix(1.0, blot * 0.92, cover);
          }
        }
        vis *= 1.0 - trunkCover(p) * 0.95;
        float ao = 1.0 - smoothstep(0.4, 2.8, length(xz - uTrunkA.xz));
        gl_FragColor = vec4(vis, cover, ao, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(fieldMaterial);

  // ── rim shafts (S3) ──
  const shaftMaterial = new THREE.ShaderMaterial({
    uniforms: { ...u, uShaftGain: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 aTop;
      attribute vec3 aBottom;
      attribute vec4 aInfo;
      varying vec2 vUv;
      varying vec4 vInfo;
      varying float vFacing;
      void main() {
        vec3 axis = aBottom - aTop;
        vec3 p = mix(aTop, aBottom, position.y);
        vec3 toCam = normalize(cameraPosition - p);
        vec3 side = normalize(cross(normalize(axis), toCam));
        float w = aInfo.x * mix(0.6, 1.5, position.y);
        p += side * position.x * w;
        vUv = position.xy;
        vInfo = aInfo;
        vFacing = abs(dot(normalize(axis), toCam));
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${KIT_GLSL}
      uniform float uShaftGain;
      varying vec2 vUv;
      varying vec4 vInfo;
      varying float vFacing;
      void main() {
        if (uOcclusion > 0.5) discard;
        float across = exp(-vUv.x * vUv.x * 3.0);
        float along = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
        float t = uTime;
        float flicker = 0.6 + 0.4 * sin(t * (0.7 + vInfo.y) + vInfo.y * 30.0) * sin(t * (1.9 + vInfo.y * 1.3) + vInfo.y * 11.0);
        float view = 0.4 + 0.6 * (1.0 - vFacing * 0.5);
        float strength = across * along * flicker * view * uShaftGain * mix(0.05, 0.16, uMist);
        gl_FragColor = vec4(uSunColor * vec3(1.0, 0.93, 0.75) * strength, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const shafts = new THREE.Mesh(new THREE.BufferGeometry(), shaftMaterial);
  shafts.frustumCulled = false;
  shafts.renderOrder = 15;
  shafts.visible = false;

  const buildShafts = () => {
    shafts.geometry.dispose();
    shafts.geometry = new THREE.BufferGeometry();
    if (!clumps.length) return;
    const sun = u.uSunDir.value.clone().normalize();
    const su = new THREE.Vector3().crossVectors(sun, new THREE.Vector3(0, 1, 0)).normalize();
    const sv = new THREE.Vector3().crossVectors(su, sun);
    const rc = (v: THREE.Vector3) => new THREE.Vector2(v.dot(su), v.dot(sv));
    const rnd = seededRandom(17);
    const centre = new THREE.Vector3();
    let top = 0;
    for (const c of clumps) {
      centre.add(c.centre);
      top = Math.max(top, c.centre.y + c.radius);
    }
    centre.divideScalar(clumps.length);
    const cRc = rc(centre);
    const list: { u: number; v: number; w: number; s: number }[] = [];
    let attempts = 0;
    while (list.length < 12 && attempts < 6000) {
      attempts++;
      const uu = cRc.x + (rnd() - 0.5) * 16;
      const vv = cRc.y + (rnd() - 0.5) * 14;
      let blocked = false;
      let minEdge = Infinity;
      for (const c of clumps) {
        const d = new THREE.Vector2(uu, vv).distanceTo(rc(c.centre));
        if (d < c.radius * 0.82) blocked = true;
        minEdge = Math.min(minEdge, d - c.radius);
      }
      // At the crown's RIM only: grazing the outer clumps, not deep inside.
      const fromCentre = new THREE.Vector2(uu, vv).distanceTo(cRc);
      if (blocked || minEdge > 0.25 || fromCentre < 3.2) continue;
      if (list.some((s) => Math.hypot(s.u - uu, s.v - vv) < 1.0)) continue;
      list.push({ u: uu, v: vv, w: 0.25 + rnd() * 0.35, s: rnd() });
    }
    const pos: number[] = [];
    const aTop: number[] = [];
    const aBottom: number[] = [];
    const aInfo: number[] = [];
    const idx: number[] = [];
    list.forEach((s, i) => {
      const on = su.clone().multiplyScalar(s.u).addScaledVector(sv, s.v);
      const t0 = (top - on.y) / sun.y;
      const a = on.clone().addScaledVector(sun, t0);
      const ground = on.clone().addScaledVector(sun, (0 - on.y) / sun.y);
      ground.y = slopeHeight(ground.x, ground.z);
      for (let j = 0; j < 4; j++) {
        pos.push(j === 0 || j === 3 ? -1 : 1, j < 2 ? 0 : 1, 0);
        aTop.push(a.x, a.y, a.z);
        aBottom.push(ground.x, ground.y, ground.z);
        aInfo.push(s.w, s.s, 0, 0);
      }
      const k = i * 4;
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    });
    const g = shafts.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aTop', new THREE.Float32BufferAttribute(aTop, 3));
    g.setAttribute('aBottom', new THREE.Float32BufferAttribute(aBottom, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(aInfo, 4));
    g.setIndex(idx);
  };

  const computeBounds = () => {
    if (!clumps.length) return;
    const sun = u.uSunDir.value.clone().normalize();
    const k = 1 / Math.max(sun.y, 0.08);
    let minX = -3;
    let maxX = 3;
    let minZ = -3;
    let maxZ = 3;
    for (const c of clumps) {
      // The clump's shadow on y≈0 (stretched along the sun's azimuth).
      const gx = c.centre.x - sun.x * c.centre.y * k;
      const gz = c.centre.z - sun.z * c.centre.y * k;
      const r = c.radius * (1 + k * 0.3) + 1.5;
      minX = Math.min(minX, gx - r);
      maxX = Math.max(maxX, gx + r);
      minZ = Math.min(minZ, gz - r);
      maxZ = Math.max(maxZ, gz + r);
    }
    rect.set(minX, minZ, maxX - minX, maxZ - minZ);
    uniforms.uShadowRect.value.set(minX, minZ, 1 / (maxX - minX), 1 / (maxZ - minZ));
  };

  return {
    uniforms,
    shafts,
    setMode(mode) {
      uMode.value = MODE_INDEX[mode];
      shafts.visible = mode === 'spots';
    },
    setCanopy(c, list) {
      canopy = c;
      clumps = list;
      uniforms.uShadowOn.value = c ? 1 : 0;
      if (c) {
        const fu = fieldMaterial.uniforms;
        for (const key of Object.keys(c) as (keyof CanopyUniforms)[]) fu[key].value = c[key].value;
      }
      computeBounds();
      buildShafts();
    },
    refresh() {
      computeBounds();
      buildShafts();
    },
    update() {
      if (!canopy) return;
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      quad.render(renderer);
      renderer.setRenderTarget(previous);
    },
  };
}

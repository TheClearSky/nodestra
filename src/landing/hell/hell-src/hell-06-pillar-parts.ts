// COPIED from .claude/pages/ad/experiments/hell-src/hell-06-pillar-parts.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-06 building blocks: materials (toon stone, light column, ink hull,
 * axial halo), crowns (canopy + ribbons, cloud rings, spikes, pyramid,
 * sigil discs), the chains of light, the pillar of blades, the bases (pit,
 * mist pool, skirt, block), the light pool on the sand and the post pass
 * (masked RGB fringe + heat haze).
 *
 * Everything is procedural. Seeded randomness only, so ?v= picks and the
 * screenshots are reproducible.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENV_GLSL, seededRandom, type EnvUniforms } from '../env-src/lab';
import { BODY_VERT, FOOT, H, PILLAR_GLSL, duneY, type PillarUniforms } from './hell-06-pillar-glsl';

export type Profile = (y: number) => number;
type U = Record<string, { value: unknown }>;

/** The key light the toon stone uses (front-left), independent of the sun. */
export const KEY = new THREE.Vector3(-0.65, 0.35, 0.65).normalize();

const col = (hex: string) => new THREE.Color(hex);

// ── geometry helpers ────────────────────────────────────────────────────

/**
 * A lathe body from a radius profile r(y): y from y0 (buried) to y1, closed
 * on top. The seam (u = 0) faces away from the camera.
 */
export function latheBody(profile: Profile, y0: number, y1: number, segments = 64, steps = 180, faceted = false): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps;
    pts.push(new THREE.Vector2(Math.max(0.05, profile(y)), y));
  }
  pts.push(new THREE.Vector2(0.001, y1 + 0.01));
  let g: THREE.BufferGeometry = new THREE.LatheGeometry(pts, segments, Math.PI);
  if (faceted) {
    g = g.toNonIndexed();
    g.computeVertexNormals();
  }
  return g;
}

/** Flat-shaded copy (each face its own normal): crisp toon facets. */
function faceted(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const f = g.index ? g.toNonIndexed() : g;
  f.computeVertexNormals();
  return f;
}

// ── materials ───────────────────────────────────────────────────────────

export type StoneOptions = {
  lit: string;
  shade: string;
  deep: string;
  bands?: number;
  rim?: string;
  rimW?: number;
  rimHDR?: number;
  /** Lava veins: strength (0 = none), cells around, vertical squash, width, shaft radius. */
  vein?: { amount: number; n: number; squash: number; width: number; radius: number };
  /** Snapped top: break height and roughness (metres, object space). */
  snap?: { y: number; amp: number };
  windows?: number;
  sigilY?: [number, number, number];
  tipGlow?: number;
  /** 1 = the body is a hole in the sky: near-black with faint fixed stars. */
  void?: number;
  contact?: number;
  /** Hairline pole radius for phone-wire AA. */
  wire?: number;
  side?: THREE.Side;
};

export function makeStone(env: EnvUniforms, P: PillarUniforms, o: StoneOptions, fov: { value: number }): THREE.ShaderMaterial {
  const v = o.vein ?? { amount: 0, n: 12, squash: 0.6, width: 0.08, radius: 30 };
  const uniforms: U = {
    ...env,
    ...P,
    uFovY: fov,
    uWire: { value: o.wire ?? 0 },
    uLit: { value: col(o.lit) },
    uShade: { value: col(o.shade) },
    uDeep: { value: col(o.deep) },
    uLightDir: { value: KEY },
    uBands: { value: o.bands ?? 3 },
    uRimCol: { value: col(o.rim ?? '#ff4a2a') },
    uRimW: { value: o.rimW ?? 0.3 },
    uRimHDR: { value: o.rimHDR ?? 1.2 },
    uVein: { value: v.amount },
    uVeinN: { value: v.n },
    uVeinSq: { value: v.squash },
    uVeinW: { value: v.width },
    uVeinR: { value: v.radius },
    uSnap: { value: o.snap?.y ?? 0 },
    uSnapAmp: { value: o.snap?.amp ?? 0 },
    uWindows: { value: o.windows ?? 0 },
    uSigilBands: { value: o.sigilY ? 1 : 0 },
    uSigilY: { value: new THREE.Vector3(...(o.sigilY ?? [0, 0, 0])) },
    uTipGlow: { value: o.tipGlow ?? 0 },
    uVoid: { value: o.void ?? 0 },
    uContact: { value: o.contact ?? 0.45 },
    uInterior: { value: col('#0c0306') },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: BODY_VERT,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${PILLAR_GLSL}
      uniform vec3 uLit; uniform vec3 uShade; uniform vec3 uDeep; uniform vec3 uLightDir;
      uniform float uBands; uniform vec3 uRimCol; uniform float uRimW; uniform float uRimHDR;
      uniform float uVein; uniform float uVeinN; uniform float uVeinSq; uniform float uVeinW; uniform float uVeinR;
      uniform float uSnap; uniform float uSnapAmp; uniform float uWindows;
      uniform float uSigilBands; uniform vec3 uSigilY; uniform float uTipGlow; uniform float uContact;
      uniform vec3 uInterior; uniform float uVoid;
      varying vec3 vWorld; varying vec3 vN; varying vec3 vLocal; varying vec2 vUv; varying vec3 vInst; varying float vCover;
      void main() {
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vWorld);
        float u = atan(vLocal.x, vLocal.z) / TAU + 0.5;   // 0..1 around, seam at the back
        float y = vLocal.y;
        vec3 glow = vec3(0.0);

        // Snapped top: a jagged break line; hollow shell, embers on the edge.
        if (uSnap > 0.0) {
          vec2 c = vec2(cos(u * TAU), sin(u * TAU));
          float hb = uSnap + uSnapAmp * ((fbm3(c * 2.2 + 3.0) - 0.5) * 2.4 + 0.7 * abs(fract(u * 5.0) - 0.5));
          if (y > hb) discard;
          float edge = 1.0 - smoothstep(0.0, 7.0, hb - y);
          glow += mix(uHalo, uFringe, edge) * edge * edge * 1.8;
        }

        vec3 col = toonStone(N, normalize(uLightDir), uLit * vInst, uShade * vInst, uDeep * vInst, uBands);
        if (!gl_FrontFacing) col = uInterior;
        // Contact darkening where the stone meets the sand.
        col *= mix(1.0 - uContact, 1.0, smoothstep(0.0, 28.0, vWorld.y - duneY(vWorld.xz)));

        // Lava / crimson veins: warped Voronoi borders on the shaft.
        if (uVein > 0.0) {
          vec2 x = vec2(u * uVeinN, y * uVeinN / (TAU * uVeinR) * uVeinSq);
          x += 0.35 * vec2(fbm3(x * 0.5), fbm3(x * 0.5 + 5.2));
          float d = veinDist(x, uVeinN);
          float vein = 1.0 - smoothstep(0.0, uVeinW, d);
          float bleed = exp(-d / (uVeinW * 3.0)) * 0.45;
          float pulse = 0.55 + 0.45 * sin(y * 0.05 - uMT * 1.8 + hash12(floor(x)) * 6.28);
          float density = mix(1.0, 0.3, smoothstep(0.05, 0.95, y / uH));   // densest at the base
          vec3 hot = mix(uHalo, mix(uFringe, uCore, 0.5 * vein * pulse), vein * pulse);
          glow += hot * (vein * 2.4 * pulse + bleed) * uVein * density;
          col *= 1.0 - vein * 0.5;
        }

        // Rows of tall slit windows (Hueco Mundo ruins), sparse, a few lit.
        if (uWindows > 0.0) {
          vec2 cell = vec2(u * 28.0, y / 22.0);
          vec2 f = fract(cell);
          float aw = fwidth(cell.x) + 1e-4;
          float win = smoothstep(0.42 - aw, 0.42 + aw, f.x) * (1.0 - smoothstep(0.58 - aw, 0.58 + aw, f.x)) * step(0.25, f.y) * step(f.y, 0.75);
          win *= step(0.35, hash12(floor(cell) + 3.1));          // some rows/columns blind
          float on = step(0.75, hash12(floor(cell)));
          col *= 1.0 - win * 0.65;
          glow += uFringe * win * on * uWindows;
        }

        // Emissive bands where the sigil discs pierce the shaft.
        if (uSigilBands > 0.0) {
          vec3 dy = abs(vec3(y) - uSigilY);
          float core = dot(exp(-dy / 2.0), vec3(1.0));
          float wide = dot(exp(-dy / 16.0), vec3(1.0));
          glow += (uCore * core * 2.2 + uHalo * wide * 0.7) * uSigilBands;
        }

        // Glowing tips (spikes: local y runs 0..1 along the cone).
        if (uTipGlow > 0.0) {
          float tip = smoothstep(0.5, 1.0, vLocal.y);
          glow += mix(uHalo, uFringe * 1.6, tip) * tip * uTipGlow;
        }

        // A hole in the sky: near-black, faint red stars fixed to the view
        // direction (they do not move with the surface), a slow ember swirl.
        if (uVoid > 0.0) {
          vec3 rd = -V;
          vec2 sp = vec2(atan(rd.x, -rd.z), rd.y) * 160.0;
          vec2 cell = floor(sp);
          vec2 jit = hash22(cell) - 0.5;
          float star = step(0.95, hash12(cell)) * (1.0 - smoothstep(0.08, 0.3, length(fract(sp) - 0.5 - jit * 0.5)));
          float swirl = fbm3(sp * 0.03 + vec2(uMT * 0.05, -uMT * 0.02));
          vec3 hole = vec3(0.006, 0.0015, 0.003) + uHalo * 0.06 * smoothstep(0.45, 0.9, swirl)
                    + mix(uFringe, uCore, 0.3) * star * (0.35 + 0.9 * hash12(cell + 7.0));
          col = mix(col, hole, uVoid);
        }

        col += rimLight(N, V, uRimW, uRimCol, uRimHDR);
        // (the hole counts as emissive, so the fog only half covers it)
        float e = clamp(max(max(max(glow.r, glow.g), glow.b), uVoid * 0.7), 0.0, 1.0);
        col += glow;
        col = fogSolid(col, vWorld, e);
        if (vCover < 1.0) col = mix(fogColour(vWorld), col, vCover);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: o.side ?? THREE.FrontSide,
  });
}

/** Ink outline: an inverted hull pushed out in clip space (constant pixel width). */
export function makeHull(env: EnvUniforms, P: PillarUniforms, ink = '#14040a'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...env, ...P, uInk: { value: col(ink) } },
    vertexShader: /* glsl */ `
      uniform float uInkPx;
      uniform vec2 uRes;
      varying vec3 vWorld;
      void main() {
        vec4 lp = vec4(position, 1.0);
        vec3 n = normal;
        #ifdef USE_INSTANCING
          lp = instanceMatrix * lp;
          n = mat3(instanceMatrix) * n;
        #endif
        vec4 wp = modelMatrix * lp;
        vWorld = wp.xyz;
        vec3 wn = normalize(mat3(modelMatrix) * n);
        vec4 c0 = projectionMatrix * viewMatrix * wp;
        vec4 c1 = projectionMatrix * viewMatrix * vec4(wp.xyz + wn, 1.0);
        vec2 d = c1.xy / c1.w - c0.xy / c0.w;
        d.x *= uRes.x / uRes.y;
        d = normalize(d + 1e-6);
        d.x *= uRes.y / uRes.x;
        c0.xy += d * uInkPx * 2.0 / uRes.y * c0.w;
        gl_Position = c0;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${PILLAR_GLSL}
      uniform vec3 uInk;
      varying vec3 vWorld;
      void main() {
        // The line fades with the air, or a far pillar gets a black wireframe.
        gl_FragColor = vec4(fogSolid(uInk, vWorld, 0.0), 1.0);
      }
    `,
    side: THREE.BackSide,
  });
}

export type LightOptions = { threads: number; threadW?: number; coreHDR?: number; threadHDR?: number; solid?: number };

/** The HDR light column: white-hot centre, coloured edge, threads scrolling up. */
export function makeLight(env: EnvUniforms, P: PillarUniforms, o: LightOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...env,
      ...P,
      uFovY: { value: 0.7 },
      uWire: { value: 0 },
      uThreadN: { value: o.threads },
      uThreadW: { value: o.threadW ?? 1 },
      uCoreHDR: { value: o.coreHDR ?? 3 },
      uThreadHDR: { value: o.threadHDR ?? 1.4 },
      uSolid: { value: o.solid ?? 0 },
    },
    vertexShader: BODY_VERT,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${PILLAR_GLSL}
      uniform float uThreadN; uniform float uThreadW; uniform float uCoreHDR; uniform float uThreadHDR; uniform float uSolid;
      varying vec3 vWorld; varying vec3 vN; varying vec3 vLocal; varying vec2 vUv; varying vec3 vInst; varying float vCover;
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWorld);
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float u = atan(vLocal.x, vLocal.z) / TAU + 0.5;
        float y = vLocal.y;
        float th = threads(u, y, uMT, uThreadN, uThreadW);
        // Cross-section: white-hot centre, coloured fringe at the silhouette.
        float centre = smoothstep(0.08, 0.75, ndv);
        // (pow: the white core stays tight, the ember edge is wide)
        vec3 c = mix(uFringe * 2.0, uCore * uCoreHDR, pow(centre, 3.0));
        c *= 0.8 + 0.7 * th;
        c += mix(uCore, uFringe, 0.35) * th * uThreadHDR * (1.0 - 0.5 * centre);
        // Slow breathing travelling up the column.
        c *= 0.88 + 0.12 * sin(uMT * 1.1 - y * 0.012);
        // Kokuto-style: a painted pale glowing stone instead of pure light.
        if (uSolid > 0.0) {
          float hatch = 0.85 + 0.15 * step(0.5, fract((u * 40.0 + y * 0.05) + fbm3(vec2(u * 30.0, y * 0.02))));
          vec3 stone = mix(uFringe * 0.9, uCore * 1.6, centre * 0.7) * hatch;
          c = mix(c, stone + uFringe * th * 0.6, uSolid);
        }
        // Up close the column fills the frame and bloom turns it into a white
        // haze, so the HDR is eased down when the camera is near (core stays white).
        c *= mix(0.5, 1.0, smoothstep(180.0, 520.0, length(cameraPosition - vWorld)));
        // Emissive: the air dims it a little but never greys it out.
        c = mix(c, fogColour(vWorld), fogAmount(vWorld) * 0.25);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

/**
 * Axial-billboard halo around a column: a tall quad turning only about the
 * vertical axis, with a drawn glow profile (tight, ~4% of the frame), so the
 * glow shape does not depend on bloom.
 */
export function makeHalo(env: EnvUniforms, P: PillarUniforms, profile: Profile, top: number, spread: number, fall: number, gain = 1): THREE.Mesh {
  const g = new THREE.PlaneGeometry(1, 1, 1, 96);
  g.translate(0, 0.5, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const aR = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) aR[i] = profile(pos.getY(i) * top);
  g.setAttribute('aR', new THREE.BufferAttribute(aR, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { ...env, ...P, uTop: { value: top }, uSpread: { value: spread }, uFall: { value: fall }, uGain: { value: gain } },
    vertexShader: /* glsl */ `
      uniform vec3 uFoot; uniform float uTop; uniform float uSpread;
      attribute float aR;
      varying float vX; varying float vR; varying float vY; varying vec3 vWorld;
      void main() {
        vec3 toCam = cameraPosition - uFoot;
        toCam.y = 0.0;
        vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), normalize(toCam)));
        float half_ = aR + uSpread;
        vX = position.x * 2.0 * half_;
        vR = aR;
        vY = position.y;
        vec3 wp = uFoot + vec3(0.0, position.y * uTop, 0.0) + side * vX;
        vWorld = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${PILLAR_GLSL}
      uniform float uFall; uniform float uGain; uniform float uSpread;
      varying float vX; varying float vR; varying float vY; varying vec3 vWorld;
      void main() {
        float d = max(abs(vX) - vR, 0.0);
        vec3 fall = uSpectral > 0.5 ? uFall * vec3(1.25, 1.0, 0.8) : vec3(uFall);
        vec3 halo = exp(-d / fall);
        vec3 fringe = exp(-d / (fall * 0.22));
        vec3 c = uHalo * halo * 0.55 + uFringe * fringe * 0.6;
        // Soft ends: buried at the foot, dying above the crown, zero at the quad edge.
        c *= smoothstep(0.0, 0.03, vY) * (1.0 - smoothstep(0.85, 1.0, vY));
        c *= 1.0 - smoothstep(0.75, 1.0, abs(vX) / (vR + uSpread));
        // Same near-camera easing as the column, so a close view is not all haze.
        float near = mix(0.35, 1.0, smoothstep(180.0, 520.0, length(cameraPosition - vWorld)));
        gl_FragColor = vec4(c * uGain * near * fogTrans(vWorld), 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.name = 'pillar-halo';
  return mesh;
}

// ── crown: branching light canopy that turns into ribbons (T8) ──────────

export function makeCanopy(env: EnvUniforms, P: PillarUniforms, o: { top: number; depth: number; roots: number; len: number; radius: number; ribbons: number; ribbonLen: number; seed: number }): THREE.Group {
  const rand = seededRandom(o.seed);
  const group = new THREE.Group();
  group.name = 'canopy';
  const tubes: THREE.BufferGeometry[] = [];
  const tips: { p: THREE.Vector3; d: THREE.Vector3; dist: number }[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  let maxDist = 1;

  // Recursive branching: children rotate outward, shrink by 0.68.
  const grow = (start: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number, dist: number) => {
    const end = start.clone().addScaledVector(dir, len);
    // Gravity: outer branches bow down a little, like the AoT canopy.
    end.y -= len * 0.12 * (o.depth - depth);
    const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3((rand() - 0.5) * len * 0.25, len * 0.08, (rand() - 0.5) * len * 0.25));
    const curve = new THREE.CatmullRomCurve3([start, mid, end]);
    const tube = new THREE.TubeGeometry(curve, 10, rad, 7, false);
    const n = tube.attributes.position.count;
    const info = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) info.set([dist, len, rand()], i * 3);
    tube.setAttribute('aInfo', new THREE.BufferAttribute(info, 3));
    tubes.push(tube);
    maxDist = Math.max(maxDist, dist + len);
    const endDir = end.clone().sub(mid).normalize();
    if (depth >= o.depth) {
      tips.push({ p: end, d: endDir, dist: dist + len });
      return;
    }
    const kids = depth === 0 ? 3 : 2 + (rand() < 0.6 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      // Rotate outward (away from the axis) and spin around the parent.
      const outward = new THREE.Vector3(end.x, 0, end.z).normalize();
      if (outward.lengthSq() < 0.01) outward.set(Math.cos(k * 2.1), 0, Math.sin(k * 2.1));
      const spin = new THREE.Quaternion().setFromAxisAngle(endDir, (k / kids) * Math.PI * 2 + rand());
      const d = endDir.clone().lerp(outward, 0.25 + rand() * 0.3).applyQuaternion(spin).normalize();
      d.lerp(endDir, 0.45).normalize();
      grow(end, d, len * (0.62 + rand() * 0.14), rad * 0.62, depth + 1, dist + len);
    }
  };
  for (let i = 0; i < o.roots; i++) {
    const a = (i / o.roots) * Math.PI * 2 + rand() * 0.5;
    const el = THREE.MathUtils.degToRad(30 + rand() * 30);
    const d = new THREE.Vector3(Math.cos(a) * Math.sin(el), Math.cos(el), Math.sin(a) * Math.sin(el));
    grow(new THREE.Vector3(Math.cos(a) * o.radius * 0.5, o.top, Math.sin(a) * o.radius * 0.5), d, o.len, o.radius * 0.18, 1, 0);
  }
  void up;

  const branchMat = new THREE.ShaderMaterial({
    uniforms: { ...env, ...P, uMaxDist: { value: maxDist } },
    vertexShader: /* glsl */ `
      attribute vec3 aInfo;
      varying float vDist; varying float vSeed; varying vec3 vWorld; varying vec3 vN;
      void main() {
        vDist = aInfo.x + uv.x * aInfo.y;
        vSeed = aInfo.z;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${PILLAR_GLSL}
      uniform float uMaxDist;
      varying float vDist; varying float vSeed; varying vec3 vWorld; varying vec3 vN;
      void main() {
        float f = vDist / uMaxDist;
        // A tube of light, not a solid pipe: bright along its axis, fading to
        // nothing at the silhouette (no facets, soft overlaps).
        float ndv = abs(dot(normalize(vN), normalize(cameraPosition - vWorld)));
        float tubeGlow = pow(ndv, 1.6);
        // Pulses running outward along the branches.
        float pulse = smoothstep(0.82, 1.0, fract(vDist / 70.0 - uMT * 0.35 + vSeed));
        vec3 c = mix(uCore * 2.6, mix(uFringe * 1.3, uHalo, smoothstep(0.4, 1.0, f)), smoothstep(0.0, 0.55, f));
        c *= 0.6 + 1.6 * pulse;
        c *= 1.0 - smoothstep(0.7, 1.0, f) * 0.7;
        c *= tubeGlow * 1.1;
        gl_FragColor = vec4(c * fogTrans(vWorld), 1.0);
      }
    `,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const branches = new THREE.Mesh(mergeGeometries(tubes)!, branchMat);
  branches.renderOrder = 6;
  branches.frustumCulled = false;
  group.add(branches);

  // Ribbons: flat strips continuing from some tips, swaying like aurora.
  if (o.ribbons > 0) {
    const pick = tips.slice().sort(() => rand() - 0.5).slice(0, o.ribbons);
    const segs = 48;
    const strips: THREE.BufferGeometry[] = [];
    for (const tip of pick) {
      const pos: number[] = [];
      const start: number[] = [];
      const dir: number[] = [];
      const prm: number[] = [];
      const idx: number[] = [];
      const len = o.ribbonLen * (0.6 + rand() * 0.8);
      const seed = rand() * 10;
      const width = 4 + rand() * 3;
      const out = new THREE.Vector3(tip.p.x, 0, tip.p.z).normalize();
      const d = tip.d.clone().lerp(out, 0.6).normalize();
      for (let i = 0; i <= segs; i++) {
        for (const side of [-1, 1]) {
          pos.push(side, i / segs, 0);
          start.push(tip.p.x, tip.p.y, tip.p.z);
          dir.push(d.x, d.y, d.z);
          prm.push(len, width, seed, 0.35 + (seed % 1) * 0.3);
        }
        if (i < segs) {
          const a = i * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aStart', new THREE.Float32BufferAttribute(start, 3));
      g.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
      g.setAttribute('aPrm', new THREE.Float32BufferAttribute(prm, 4));
      g.setIndex(idx);
      strips.push(g);
    }
    const ribbonMat = new THREE.ShaderMaterial({
      uniforms: { ...env, ...P },
      vertexShader: /* glsl */ `
        uniform float uMT;
        attribute vec3 aStart; attribute vec3 aDir; attribute vec4 aPrm;
        varying float vS; varying float vSide; varying vec3 vWorld;
        vec3 at(float s) {
          vec3 p = aStart + aDir * s * aPrm.x;
          p.y -= aPrm.w * aPrm.x * s * s;                      // droop
          vec3 across = normalize(cross(aDir, vec3(0.0, 1.0, 0.0)) + 1e-4);
          float sway = sin(s * 5.0 - uMT * 0.45 + aPrm.z) + 0.5 * sin(s * 11.0 - uMT * 0.8 + aPrm.z * 2.0);
          p += across * sway * s * aPrm.x * 0.12;
          p.y += sin(s * 4.0 - uMT * 0.3 + aPrm.z) * s * aPrm.x * 0.06;
          return p;
        }
        void main() {
          float s = position.y;
          vec3 p = at(s);
          vec3 t = normalize(at(min(s + 0.02, 1.0)) - at(max(s - 0.02, 0.0)));
          vec3 side = normalize(cross(t, normalize(cameraPosition - p)));
          float w = aPrm.y * (1.0 - 0.75 * s);
          p += side * position.x * w;
          vS = s;
          vSide = position.x;
          vWorld = p;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${ENV_GLSL}
        ${PILLAR_GLSL}
        varying float vS; varying float vSide; varying vec3 vWorld;
        void main() {
          float across = exp(-abs(vSide) * 2.6);
          float core = 1.0 - smoothstep(0.1, 0.35, abs(vSide));
          float fade = (1.0 - smoothstep(0.35, 1.0, vS)) * smoothstep(0.0, 0.05, vS);
          vec3 c = (uFringe * across * 0.9 + uCore * core * 1.4) * fade;
          gl_FragColor = vec4(c * fogTrans(vWorld), 1.0);
        }
      `,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ribbons = new THREE.Mesh(mergeGeometries(strips)!, ribbonMat);
    ribbons.renderOrder = 6;
    ribbons.frustumCulled = false;
    group.add(ribbons);
  }
  return group;
}

// ── cloud rings / halos / threaded cumulus (T9) ─────────────────────────

export type Ring = { y: number; radius: number; count: number; size: number; squash: number; speed: number; thick: number; spread?: number };

/** `pale` 0..1 pulls the lit side toward an off-white (Eva's white cloud rings). */
export function makeCloudRings(env: EnvUniforms, P: PillarUniforms, rings: Ring[], seed: number, pale = 0, centre = FOOT): THREE.Mesh {
  const rand = seededRandom(seed);
  const base = new THREE.PlaneGeometry(2, 2);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  const puffs: number[] = [];
  const ringData: number[] = [];
  for (const r of rings) {
    for (let i = 0; i < r.count; i++) {
      const a = (i / r.count) * Math.PI * 2 + (rand() - 0.5) * 0.25;
      const rad = r.radius * (1 + (rand() - 0.5) * (r.spread ?? 0.1));
      puffs.push(a, rad, r.y + (rand() - 0.5) * r.thick, r.size * (0.55 + rand() * 0.8));
      ringData.push(r.speed, rand(), r.squash, r.thick * 0.3);
    }
  }
  g.setAttribute('aPuff', new THREE.InstancedBufferAttribute(new Float32Array(puffs), 4));
  g.setAttribute('aRing', new THREE.InstancedBufferAttribute(new Float32Array(ringData), 4));
  g.instanceCount = puffs.length / 4;
  const m = new THREE.ShaderMaterial({
    uniforms: { ...env, ...P, uCentre: { value: centre.clone() }, uKey: { value: KEY }, uPale: { value: pale } },
    vertexShader: /* glsl */ `
      uniform vec3 uCentre; uniform float uMT;
      attribute vec4 aPuff; attribute vec4 aRing;
      varying vec2 vP; varying float vSeed; varying vec3 vC; varying vec3 vRight; varying vec3 vUp;
      void main() {
        float ang = aPuff.x + uMT * aRing.x;
        vec3 c = uCentre + vec3(cos(ang) * aPuff.y, aPuff.z, sin(ang) * aPuff.y);
        c.y += sin(ang * 3.0 + aRing.y * 6.28) * aRing.w;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 wp = c + right * position.x * aPuff.w + up * position.y * aPuff.w * aRing.z;
        vP = position.xy;
        vSeed = aRing.y;
        vC = c;
        vRight = right;
        vUp = up;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${PILLAR_GLSL}
      uniform vec3 uKey; uniform float uPale;
      varying vec2 vP; varying float vSeed; varying vec3 vC; varying vec3 vRight; varying vec3 vUp;
      void main() {
        float r2 = dot(vP, vP);
        // Lumpy, hard-edged anime puff.
        float edge = r2 + 0.45 * (fbm3(vP * 2.0 + vSeed * 17.0) - 0.5);
        if (edge > 0.92) discard;
        vec3 toCam = normalize(cameraPosition - vC);
        vec3 n = normalize(vRight * vP.x + vUp * vP.y + toCam * sqrt(max(1.0 - r2, 0.0)));
        float l = smoothstep(-0.05, 0.1, dot(n, uKey) + (fbm3(vP * 3.0 + vSeed * 5.0) - 0.5) * 0.4);
        vec3 lit = uHorizon * 1.5 + uSunColor * 0.35 + vec3(0.05);
        vec3 shade = mix(uAmbient, uZenith, 0.35) * 0.9 + uHorizon * 0.15;
        // Pale rings: an off-white lit side, a cool violet shade (Eva C0812B).
        lit = mix(lit, vec3(0.92, 0.84, 0.86), uPale);
        shade = mix(shade, vec3(0.36, 0.26, 0.38) + uHorizon * 0.2, uPale * 0.8);
        vec3 c = mix(shade, lit, l);
        // The belly picks up the pillar light from below.
        c = mix(c, uHalo * 0.9 + shade * 0.3, smoothstep(0.0, -0.75, n.y) * 0.65 * (1.0 - 0.5 * uPale));
        // Backlit silver lining.
        c += uSunColor * pow(1.0 - max(dot(n, toCam), 0.0), 3.0) * 0.3;
        gl_FragColor = vec4(fogSolid(c, vC, 0.0), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.name = 'cloud-rings';
  return mesh;
}

// ── spikes (T10) ────────────────────────────────────────────────────────

export type SpikeRing = { n: number; y: number; radius: number; h: number; w: number; tilt: number; jitter: number };

export function spikeMatrices(rings: SpikeRing[], seed: number): THREE.Matrix4[] {
  const rand = seededRandom(seed);
  const out: THREE.Matrix4[] = [];
  for (const r of rings) {
    for (let i = 0; i < r.n; i++) {
      const a = (i / r.n) * Math.PI * 2 + (rand() - 0.5) * 0.15;
      const radial = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const tilt = THREE.MathUtils.degToRad(r.tilt + (rand() - 0.5) * 12);
      const axis = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(-radial.z, 0, radial.x), -tilt);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6));
      const h = r.h * (1 + (rand() - 0.5) * r.jitter);
      out.push(new THREE.Matrix4().compose(radial.multiplyScalar(r.radius).setY(r.y), q, new THREE.Vector3(r.w, h, r.w)));
    }
  }
  return out;
}

export function coneGeometry(sides = 5): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(1, 1, sides, 1);
  g.translate(0, 0.5, 0);
  return faceted(g);
}

/** An InstancedMesh with a sibling ink hull sharing its matrices. */
export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, hull: THREE.Material | null, matrices: THREE.Matrix4[], colours?: THREE.Color[]): THREE.Group {
  const g = new THREE.Group();
  const mk = (m: THREE.Material) => {
    const im = new THREE.InstancedMesh(geo, m, matrices.length);
    matrices.forEach((x, i) => im.setMatrixAt(i, x));
    if (colours) colours.forEach((c, i) => im.setColorAt(i, c));
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    return im;
  };
  g.add(mk(mat));
  if (hull) g.add(mk(hull));
  return g;
}

// ── pillar of blades (T13) ──────────────────────────────────────────────

export function bladeGeometry(): THREE.BufferGeometry {
  // A long single-edged blade with a short tang, 1 m long, 0.1 m wide.
  const s = new THREE.Shape();
  s.moveTo(-0.02, 0);
  s.lineTo(0.02, 0);
  s.lineTo(0.02, 0.1);
  s.lineTo(0.06, 0.11);
  s.lineTo(0.05, 0.6);
  s.lineTo(0.0, 1.0);
  s.lineTo(-0.045, 0.62);
  s.lineTo(-0.05, 0.11);
  s.lineTo(-0.02, 0.1);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.008, bevelSegments: 1 });
  g.translate(0, 0, -0.006);
  return faceted(g);
}

export function bladeMatrices(profile: Profile, top: number, count: number, seed: number): { m: THREE.Matrix4[]; c: THREE.Color[] } {
  const rand = seededRandom(seed);
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const steel = col('#6a6470');
  const rust = col('#5e1a0f');
  const dark = col('#2a2228');
  const m: THREE.Matrix4[] = [];
  const c: THREE.Color[] = [];
  for (let i = 0; i < count; i++) {
    const f = i / count;
    const y = -10 + f * (top + 10);
    const crown = THREE.MathUtils.smoothstep(f, 0.86, 1.0);
    const ang = i * GOLDEN + (rand() - 0.5) * 0.3;
    const radial = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const rad = profile(y) * (0.55 + 0.5 * rand()) * (1 + crown * 0.8);
    const tilt = THREE.MathUtils.degToRad(6 + 22 * rand() + crown * 40);
    const along = new THREE.Vector3(0, Math.cos(tilt), 0).addScaledVector(radial, Math.sin(tilt)).normalize();
    const tangent = new THREE.Vector3(-radial.z, 0, radial.x);
    const twist = (rand() - 0.5) * 1.2;
    tangent.applyAxisAngle(along, twist);
    const xb = tangent.clone().sub(along.clone().multiplyScalar(tangent.dot(along))).normalize();
    const zb = new THREE.Vector3().crossVectors(xb, along).normalize();
    const len = (40 + rand() * 50) * (1 + crown * 0.8);
    const w = len * (0.9 + rand() * 0.6);
    const mat = new THREE.Matrix4().makeBasis(xb.multiplyScalar(w), along.multiplyScalar(len), zb.multiplyScalar(len));
    mat.setPosition(radial.multiplyScalar(rad).setY(y));
    m.push(mat);
    const k = rand();
    c.push(k < 0.55 ? steel.clone().lerp(dark, rand() * 0.6) : k < 0.85 ? rust.clone().lerp(steel, rand() * 0.4) : dark.clone());
  }
  return { m, c };
}

// ── chains of light (T12) ───────────────────────────────────────────────

export function makeChains(env: EnvUniforms, P: PillarUniforms, summitY: number, count: number, seed: number): THREE.Mesh {
  const rand = seededRandom(seed);
  const segs = 80;
  const strips: THREE.BufferGeometry[] = [];
  for (let k = 0; k < count; k++) {
    // Uneven fan: mostly to the sides and toward the camera, some far off-frame.
    const a = Math.PI * 0.5 + ((k + 0.5) / count - 0.5) * Math.PI * 1.9 + (rand() - 0.5) * 0.3;
    const dist = H * (0.3 + rand() * 0.55);
    const bx = FOOT.x + Math.cos(a) * dist * 1.25;
    const bz = FOOT.z + Math.sin(a) * dist * 0.8;
    const A = new THREE.Vector3(FOOT.x + Math.cos(a) * 8, FOOT.y + summitY - rand() * 20, FOOT.z + Math.sin(a) * 8);
    const B = new THREE.Vector3(bx, duneY(bx, bz) - 1, bz);
    const pos: number[] = [];
    const aA: number[] = [];
    const aB: number[] = [];
    const prm: number[] = [];
    const idx: number[] = [];
    const len = A.distanceTo(B);
    const sag = 0.01 + rand() * 0.025;
    const s0 = rand() * 10;
    for (let i = 0; i <= segs; i++) {
      for (const side of [-1, 1]) {
        pos.push(side, i / segs, 0);
        aA.push(A.x, A.y, A.z);
        aB.push(B.x, B.y, B.z);
        prm.push(sag, s0, 1.8, len);
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
    uniforms: { ...env, ...P, uFovY: { value: 0.7 } },
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
      varying float vM; varying float vSide; varying float vSeed; varying vec3 vWorld; varying float vCover;
      void main() {
        // Links crawl toward the summit; dash : gap ≈ 1 : 0.6.
        float link = fract(vM / 7.0 + uMT * 1.2 + vSeed);
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
  mesh.name = 'chains';
  return mesh;
}

// ── sigil discs pierced by the shaft (extra idea X1) ────────────────────

export function makeSigils(env: EnvUniforms, P: PillarUniforms, discs: { y: number; r: number; dir: number }[]): THREE.Group {
  const group = new THREE.Group();
  discs.forEach((d, i) => {
    const g = new THREE.PlaneGeometry(2, 2);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.ShaderMaterial({
      uniforms: { ...env, ...P, uSpin: { value: d.dir }, uSeed: { value: i * 7.3 + 1.0 } },
      vertexShader: /* glsl */ `
        varying vec2 vP; varying vec3 vWorld;
        void main() {
          vP = position.xz;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        ${ENV_GLSL}
        ${PILLAR_GLSL}
        uniform float uSpin; uniform float uSeed;
        varying vec2 vP; varying vec3 vWorld;
        mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
        float ring(float r, float r0, float w, float aa) { return 1.0 - smoothstep(w, w + aa, abs(r - r0)); }
        float seg(vec2 p, vec2 a, vec2 b, float w, float aa) {
          vec2 pa = p - a, ba = b - a;
          float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
          return 1.0 - smoothstep(w, w + aa, length(pa - ba * h));
        }
        void main() {
          vec2 p = vP;
          float r = length(p);
          if (r > 1.0 || r < 0.06) discard;
          float aa = fwidth(r) * 1.2 + 1e-4;
          float t = uMT * uSpin;
          float s = 0.0;
          s += ring(r, 0.975, 0.008, aa) + ring(r, 0.93, 0.004, aa) + ring(r, 0.70, 0.006, aa) + ring(r, 0.655, 0.003, aa) + ring(r, 0.2, 0.006, aa);
          // Tick marks between the two outer rings.
          float a = atan(p.y, p.x) + t * 0.15;
          float tk = abs(fract(a / TAU * 144.0) - 0.5);
          s += (1.0 - smoothstep(0.08, 0.16, tk)) * step(0.935, r) * step(r, 0.968);
          // Rune band: blocky hashed glyphs in rotating cells.
          float ar = atan(p.y, p.x) - t * 0.25;
          // (28 glyphs of 3x3 strokes: fewer, bigger marks read as script, not noise)
          float cells = 28.0;
          float cu = ar / TAU * cells;
          float cid = floor(cu);
          float rr = (r - 0.735) / 0.16;
          if (rr > 0.12 && rr < 0.88) {
            float gx = (fract(cu) - 0.2) / 0.6;              // 0..1 inside the glyph box
            float gy = (rr - 0.12) / 0.76;
            if (gx > 0.0 && gx < 1.0) {
              vec2 gcell = floor(vec2(gx, gy) * 3.0);
              vec2 gf = fract(vec2(gx, gy) * 3.0);
              float id = mod(cid, cells) * 9.0 + gcell.y * 3.0 + gcell.x + uSeed * 31.0;
              // Each glyph cell holds a horizontal or vertical stroke, or nothing.
              float h = hash12(vec2(id, 1.7));
              float hor = step(h, 0.3) * step(abs(gf.y - 0.5), 0.16);
              float ver = step(0.3, h) * step(h, 0.62) * step(abs(gf.x - 0.5), 0.16);
              s += (hor + ver) * 0.85;
            }
          }
          // Hexagram (two triangles) turning the other way.
          vec2 q = rot(-t * 0.3) * p;
          for (int k = 0; k < 6; k++) {
            float a0 = float(k) * TAU / 6.0;
            float a1 = a0 + TAU / 3.0;
            s += seg(q, 0.65 * vec2(cos(a0), sin(a0)), 0.65 * vec2(cos(a1), sin(a1)), 0.004, aa) * 0.9;
          }
          // Inner pentagon star.
          vec2 q2 = rot(t * 0.5) * p;
          for (int k = 0; k < 5; k++) {
            float a0 = float(k) * TAU / 5.0;
            float a1 = a0 + TAU * 2.0 / 5.0;
            s += seg(q2, 0.2 * vec2(cos(a0), sin(a0)), 0.2 * vec2(cos(a1), sin(a1)), 0.004, aa);
          }
          s = clamp(s, 0.0, 1.4);
          float fill = smoothstep(1.0, 0.6, r) * 0.08 + exp(-abs(r - 0.7) * 12.0) * 0.08;
          float flick = 0.85 + 0.15 * sin(uMT * 2.0 + uSeed);
          // Dark red lines with a thin hot core; the owner's "dark red magic circles".
          vec3 c = (mix(uHalo, uFringe, 0.3) * s * 2.4 * flick + uHalo * fill);
          gl_FragColor = vec4(c * fogTrans(vWorld), 1.0);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.scale.setScalar(d.r);
    mesh.position.y = d.y;
    mesh.renderOrder = 7;
    group.add(mesh);
  });
  return group;
}

// ── bases (T15) ─────────────────────────────────────────────────────────

/** Highest and lowest stand-in dune around the foot, within a radius. */
function duneRange(r: number): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 24; i++) {
    for (let k = 1; k <= 6; k++) {
      const a = (i / 24) * Math.PI * 2;
      const rr = (k / 6) * r;
      const y = duneY(FOOT.x + Math.cos(a) * rr, FOOT.z + Math.sin(a) * rr);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
  }
  return { lo, hi };
}

/**
 * (a) Toothed pit with a violet interior (Eva). A raised crater lip with
 * teeth, and a flat "window" disc that ray-traces the funnel below: walls
 * (violet at the lip to deep red), the floor glowing, the pole running down
 * into a dark anchoring block. No hole in the ground is needed.
 */
export function makePit(env: EnvUniforms, P: PillarUniforms, ground: THREE.Material, R: number, poleR: number, hull: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const outer = R * 1.7;
  const { hi } = duneRange(R * 1.05);
  const { lo } = duneRange(outer);
  const lip = hi + 2.5;
  // Crater wall: a ground-coloured lathe ring rising from below the dunes to the lip.
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const f = i / 24;
    const r = THREE.MathUtils.lerp(outer, R, f);
    const y = THREE.MathUtils.lerp(lo - 4, lip, Math.pow(f, 1.8));
    pts.push(new THREE.Vector2(r, y));
  }
  pts.push(new THREE.Vector2(R * 0.995, lip));
  const wall = new THREE.Mesh(new THREE.LatheGeometry(pts.reverse(), 96), ground);
  wall.position.set(FOOT.x, 0, FOOT.z);
  group.add(wall);

  // Teeth on the lip: small dark wedges, per-tooth height.
  const rand = seededRandom(66);
  const teeth: THREE.Matrix4[] = [];
  const N = 110;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const h = 2.2 + rand() * 2.8;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    teeth.push(new THREE.Matrix4().compose(new THREE.Vector3(FOOT.x + Math.cos(a) * R, lip - 0.5, FOOT.z + Math.sin(a) * R), q, new THREE.Vector3(1.4, h, (Math.PI * 2 * R) / N * 0.5)));
  }
  const toothMat = makeStone(env, P, { lit: '#5a2026', shade: '#2a0c14', deep: '#14050a', rim: '#ff4a2a', rimW: 0.4, rimHDR: 0.8, contact: 0 }, { value: 0.7 });
  group.add(instanced(coneGeometry(4), toothMat, hull, teeth));

  const pitWindow = new THREE.Mesh(new THREE.CircleGeometry(R, 96).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: { ...env, ...P, uR: { value: R }, uD: { value: R * 0.9 }, uR1: { value: R * 0.35 }, uPole: { value: poleR }, uBlock: { value: Math.max(poleR * 3, R * 0.12) }, uLip: { value: lip } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${PILLAR_GLSL}
      uniform float uR; uniform float uD; uniform float uR1; uniform float uPole; uniform float uBlock; uniform float uLip;
      varying vec3 vWorld;
      void main() {
        vec3 rd = normalize(vWorld - cameraPosition);
        vec3 o = vWorld - vec3(uFoot.x, uLip, uFoot.z);     // lip plane at y = 0
        // Funnel wall: r(y) = a + b·y for -D < y < 0.
        float a0 = uR, b0 = (uR - uR1) / uD;
        float A = rd.x * rd.x + rd.z * rd.z - b0 * b0 * rd.y * rd.y;
        float B = 2.0 * (o.x * rd.x + o.z * rd.z - b0 * rd.y * (a0 + b0 * o.y));
        float C = o.x * o.x + o.z * o.z - (a0 + b0 * o.y) * (a0 + b0 * o.y);
        float tHit = 1e9; int kind = 0;
        float disc = B * B - 4.0 * A * C;
        if (disc > 0.0 && abs(A) > 1e-6) {
          float s = sqrt(disc);
          float t1 = (-B - s) / (2.0 * A), t2 = (-B + s) / (2.0 * A);
          float ya = o.y + t1 * rd.y, yb = o.y + t2 * rd.y;
          if (t1 > 0.01 && ya < 0.0 && ya > -uD) { tHit = t1; kind = 1; }
          if (t2 > 0.01 && t2 < tHit && yb < 0.0 && yb > -uD) { tHit = t2; kind = 1; }
        }
        float tF = (-uD - o.y) / rd.y;
        if (rd.y < 0.0 && tF < tHit) { tHit = tF; kind = 2; }
        // The pole, down into the pit.
        float A2 = rd.x * rd.x + rd.z * rd.z, B2 = o.x * rd.x + o.z * rd.z, C2 = o.x * o.x + o.z * o.z - uPole * uPole;
        float d2 = B2 * B2 - A2 * C2;
        if (d2 > 0.0) { float tp = (-B2 - sqrt(d2)) / A2; if (tp > 0.0 && tp < tHit) { tHit = tp; kind = 3; } }
        // The anchoring block on the floor (slab test).
        vec3 bmin = vec3(-uBlock, -uD, -uBlock), bmax = vec3(uBlock, -uD + uBlock * 1.2, uBlock);
        vec3 inv = 1.0 / rd;
        vec3 ta = (bmin - o) * inv, tb = (bmax - o) * inv;
        vec3 tmn = min(ta, tb), tmx = max(ta, tb);
        float tn = max(max(tmn.x, tmn.y), tmn.z), tx = min(min(tmx.x, tmx.y), tmx.z);
        vec3 bn = vec3(0.0);
        if (tn < tx && tn > 0.0 && tn < tHit) { tHit = tn; kind = 4; bn = -sign(rd) * step(tmn.yzx, tmn.xyz) * step(tmn.zxy, tmn.xyz); }
        if (kind == 0) tHit = (-uD - o.y) / min(rd.y, -1e-3);   // (never "infinitely far")
        vec3 h = o + rd * tHit;
        float depth = clamp(-h.y / uD, 0.0, 1.0);
        float glowUp = exp(-clamp(h.y + uD, 0.0, uD) / (uD * 0.28));
        vec3 violet = srgb(vec3(0.34, 0.08, 0.33));
        vec3 red = srgb(vec3(0.30, 0.0, 0.0));
        vec3 c;
        if (kind == 1 || kind == 0) {
          float ang = atan(h.z, h.x);
          // Streaky "grass" walls running down the funnel (90 streaks: no moiré).
          float sx = ang / TAU * 90.0 + fbm3(vec2(ang * 4.0, h.y * 0.06)) * 2.0;
          float aw = fwidth(sx) + 1e-3;
          float line = smoothstep(0.32 - aw, 0.5, abs(fract(sx) - 0.5));
          // Violet at the lip, through red, to near-black low on the walls.
          c = mix(violet, red, smoothstep(0.1, 0.6, depth)) * (0.75 + 0.5 * line);
          c *= mix(1.0, 0.25, smoothstep(0.45, 0.95, depth));
          c *= 0.6 + 0.6 * smoothstep(-0.2, 0.6, dot(normalize(vec3(-h.x, 0.0, -h.z)), KEY_DIR));
          c += uHalo * glowUp * 0.9;
        } else if (kind == 2) {
          float r = length(h.xz);
          c = red * 0.3 + uHalo * (0.35 + 1.6 * exp(-r / (uBlock * 1.5))) * (0.6 + 0.4 * fbm3(h.xz * 0.15 + uMT * 0.05));
        } else if (kind == 3) {
          c = srgb(vec3(0.08, 0.03, 0.05)) + uHalo * glowUp * 0.7;
        } else {
          c = mix(srgb(vec3(0.07, 0.02, 0.04)), srgb(vec3(0.16, 0.05, 0.08)), max(dot(bn, KEY_DIR), 0.0)) + uHalo * glowUp * 0.6;
        }
        float e = kind == 2 ? 1.0 : 0.4;
        vec3 wp = vec3(uFoot.x, uLip, uFoot.z) + h;
        gl_FragColor = vec4(fogSolid(c, wp, e), 1.0);
      }
    `.replace(/KEY_DIR/g, 'vec3(-0.65, 0.35, 0.65)'),
  }));
  pitWindow.position.set(FOOT.x, lip - 0.15, FOOT.z);
  group.add(pitWindow);
  return group;
}

/**
 * (b) Mist pool: one capped proxy cylinder; the fragment integrates IQ's
 * height fog along the ray inside it, noise-lumped, lit from inside by the
 * pillar (closed-form line glow). No depth texture needed.
 */
export function makeMist(env: EnvUniforms, P: PillarUniforms, R: number, Hm: number, coreR: number): THREE.Mesh {
  const g = new THREE.CylinderGeometry(R, R, Hm, 64, 1, false);
  const floor = FOOT.y - 3;
  g.translate(0, Hm / 2, 0);
  const m = new THREE.ShaderMaterial({
    uniforms: { ...env, ...P, uR: { value: R }, uTopY: { value: floor + Hm }, uFloorY: { value: floor }, uCoreR: { value: coreR } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${PILLAR_GLSL}
      uniform float uR; uniform float uTopY; uniform float uFloorY; uniform float uCoreR;
      varying vec3 vWorld;
      void main() {
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vWorld - ro);
        float t0 = length(vWorld - ro);
        vec2 o = ro.xz - uFoot.xz;
        vec2 d = rd.xz;
        float a = max(dot(d, d), 1e-6), b = dot(o, d), c = dot(o, o) - uR * uR;
        float t1 = (-b + sqrt(max(b * b - a * c, 0.0))) / a;
        if (rd.y < 0.0) t1 = min(t1, (uFloorY - ro.y) / rd.y);
        if (rd.y > 0.0) t1 = min(t1, (uTopY - ro.y) / rd.y);
        // Only the air IN FRONT of the pillar: stop at the closest approach to
        // the axis, or earlier where the ray meets the pillar's foot cylinder.
        // Both stops agree at the silhouette, so there is no hard edge there
        // (cutting at the core alone drew the pillar as a hard-edged box).
        float tMid = -b / a;
        t1 = min(t1, max(tMid, t0));
        float c2 = dot(o, o) - uCoreR * uCoreR;
        float dc = b * b - a * c2;
        if (dc > 0.0) { float tc = (-b - sqrt(dc)) / a; if (tc > t0) t1 = min(t1, tc); }
        float len = max(t1 - t0, 0.0);
        // Height-fog integral from the entry point (density a·exp(-B·y)).
        float Bk = 1.0 / 10.0;
        float y0 = vWorld.y - uFloorY;
        float k = rd.y * Bk;
        float od = 0.09 * exp(-y0 * Bk) * (abs(k) < 1e-5 ? len : (1.0 - exp(-len * k)) / k);
        // Rays entering high up (through the side near the top) fade out, so
        // the proxy's top edge never shows.
        // Steeply descending rays (the close base view looks DOWN into the
        // pool) keep it all; the fade is only for the low, near-level views.
        // (Keyed on the ray, not the entry face, so cap and wall agree.)
        float steep = smoothstep(0.06, 0.25, -rd.y);
        od *= mix(1.0 - smoothstep(0.3, 0.85, (vWorld.y - uFloorY) / (uTopY - uFloorY)), 1.0, steep);
        // Lumpy, drifting, thinning toward the rim.
        vec3 pc = ro + rd * mix(t0, t1, 0.5);
        float rad = length(pc.xz - uFoot.xz) / uR;
        float n = fbm3(pc.xz * 0.025 + vec2(uMT * 0.03, uMT * 0.012));
        od *= (1.0 - smoothstep(0.35, 1.0, rad)) * (0.35 + 1.3 * n);
        float alpha = 1.0 - exp(-od);
        // Lit from inside by the pillar: closed-form line glow along the same ray.
        float g = lineGlow(ro, rd, uFoot.xz, uCoreR * 1.5, t0, t1) * uCoreR * 0.5;
        float lit = 1.0 - exp(-g);
        // Paler than the sand (a dusty rose-violet), or it vanishes into the
        // red ground; near the pillar it takes the light's own colour.
        vec3 base = mix(uHorizon, uAmbient, 0.45) * 1.5 + uFringe * 0.12 + vec3(0.03, 0.02, 0.03);
        vec3 col = mix(base, uFringe * 0.9 + uCore * 0.45, lit);
        alpha = clamp(alpha + lit * alpha * 0.4, 0.0, 0.85);
        gl_FragColor = vec4(fogSolid(col, pc, lit), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(FOOT.x, floor, FOOT.z);
  mesh.renderOrder = 8;
  mesh.name = 'mist-pool';
  return mesh;
}

/** (c) Flared skirt: a concave lathe flare round the foot, darkened at the ground. */
export function skirtProfile(baseR: number): Profile {
  return (y) => baseR * (1 + 1.6 * Math.exp(-Math.max(y, 0) / 26));
}

// ── light pool on the sand (T16) ───────────────────────────────────────

export function makePool(env: EnvUniforms, P: PillarUniforms, R: number): { mesh: THREE.Mesh; uRipple: { value: number }; uGain: { value: number }; uR0: { value: number } } {
  const g = new THREE.PlaneGeometry(R * 2, R * 2, 120, 120);
  g.rotateX(-Math.PI / 2);
  const uRipple = { value: 0 };
  const uGain = { value: 1 };
  const uR0 = { value: 40 };
  const m = new THREE.ShaderMaterial({
    uniforms: { ...env, ...P, uRipple, uGain, uR0, uR: { value: R } },
    // Vertex stage: only the dune height (PILLAR_GLSL uses fwidth, which is
    // fragment-only in GLSL ES 3.00).
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      float duneY(vec2 xz) {
        float s = sin(xz.x * 0.018 + sin(xz.y * 0.006) * 2.2) * 6.0;
        float t = sin((xz.x * 0.6 + xz.y) * 0.01) * 9.0;
        return max(0.0, s + t + 4.0) * 0.8 - 2.0;
      }
      void main() {
        vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
        p.y = duneY(p.xz) + 0.35;   // hug the sand
        vWorld = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${PILLAR_GLSL}
      uniform float uRipple; uniform float uGain; uniform float uR0; uniform float uR;
      varying vec3 vWorld;
      void main() {
        float r = length(vWorld.xz - uFoot.xz);
        float q = r / uR0;
        float pool = 1.0 / (1.0 + q * q);
        // AoT ep 78: concentric ripples centred on the pillar, slowly moving out.
        // (noise only when the ripples are on: this disc covers much of the screen)
        float ring = 1.0;
        if (uRipple > 0.0) {
          float rip = 0.5 + 0.5 * sin(r * 0.32 - uMT * 0.8 + fbm3(vWorld.xz * 0.02) * 3.0);
          ring = mix(1.0, 0.35 + 1.4 * smoothstep(0.55, 0.8, rip), uRipple);
        }
        float edge = 1.0 - smoothstep(0.7, 1.0, r / uR);
        vec3 c = mix(uHalo, uFringe, pool * 0.5) * pool * ring * edge * uGain * 0.9;
        gl_FragColor = vec4(c * fogTrans(vWorld), 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(FOOT.x, 0, FOOT.z);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.name = 'light-pool';
  return { mesh, uRipple, uGain, uR0 };
}

// ── post: masked RGB fringe + heat haze (T17a, X2) ──────────────────────

export const PILLAR_POST = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uFringePx: { value: 0 },
    uHaze: { value: 0 },
    uAxisX: { value: 0.5 },
    uSpread: { value: 0.05 },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1280, 720) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uFringePx; uniform float uHaze; uniform float uAxisX; uniform float uSpread; uniform float uTime;
    uniform vec2 uRes;
    varying vec2 vUv;
    float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vn(vec2 p) {
      vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y);
    }
    void main() {
      vec2 uv = vUv;
      float dx = vUv.x - uAxisX;
      float mask = exp(-abs(dx) / uSpread);
      if (uHaze > 0.0) {
        // Heat shimmer rising around the column: the sky ripples behind it.
        vec2 q = vec2(vUv.x * uRes.x / uRes.y, vUv.y) * 22.0 + vec2(0.0, -uTime * 1.6);
        vec2 w = vec2(vn(q) - 0.5, vn(q + 7.3) - 0.5);
        // (small: a big offset makes the silhouette wobble like a glitch)
        uv += w * uHaze * mask / uRes.y * 2.2;
      }
      vec4 c = texture2D(tDiffuse, uv);
      if (uFringePx > 0.0) {
        vec2 off = vec2(sign(dx) * uFringePx / uRes.x * (0.25 + mask), 0.0);
        c.r = texture2D(tDiffuse, uv + off).r;
        c.b = texture2D(tDiffuse, uv - off).b;
      }
      gl_FragColor = c;
    }
  `,
};

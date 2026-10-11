// COPIED from .claude/pages/ad/experiments/hell-src/hell-11-sky-events-bolt.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-11 lightning and meteors.
 *
 *  - makeBolt: midpoint displacement (krazydad): split each segment, kick
 *    the midpoint sideways, halve the kick per level; forks spawn at
 *    midpoints at an angle, shorter and thinner (gen + 1).
 *  - Ribbon: every segment becomes a quad pushed sideways in CLIP space, so
 *    its width is in pixels at any distance (WebGL lines are always 1 px).
 *    The bolt fragment draws a Gaussian core + wide glow (or, Kanada style,
 *    a flat two-tone core with a hard edge).
 *  - Shader bolt (T5): one camera-facing quad; the line is an fbm-displaced
 *    centre line with a 1/d glow, re-rolled 12 times a second (limited
 *    animation).
 *  - Meteor: a head sprite, a short fire ribbon (additive, hot head → red
 *    tail) and a long charcoal smoke ribbon that widens and erodes with age.
 */

import * as THREE from 'three';
import { ENV_GLSL, type EnvUniforms } from '../env-src/lab';
import { FX_GLSL, type Fx } from './hell-11-sky-events-world';

// ── bolt shape ──────────────────────────────────────────────────────────

export type Seg2 = { ax: number; ay: number; bx: number; by: number; gen: number; d0: number; d1: number };

export function makeBolt(rand: () => number, opts: { height: number; levels: number; disp: number; branchP: number; drift: number }): Seg2[] {
  const H = opts.height;
  let segs: Seg2[] = [{ ax: 0, ay: 0, bx: (rand() - 0.5) * opts.drift * H, by: -H, gen: 0, d0: 0, d1: 1 }];
  let disp = opts.disp * H;
  for (let level = 0; level < opts.levels; level++) {
    const next: Seg2[] = [];
    for (const s of segs) {
      const mx = (s.ax + s.bx) / 2;
      const my = (s.ay + s.by) / 2;
      const dx = s.bx - s.ax;
      const dy = s.by - s.ay;
      const len = Math.hypot(dx, dy) || 1;
      // Kick the midpoint along the perpendicular; forks kick less.
      const k = ((rand() * 2 - 1) * disp) / (1 + s.gen);
      const px = mx + (-dy / len) * k;
      const py = my + (dx / len) * k;
      const dm = (s.d0 + s.d1) / 2;
      next.push({ ax: s.ax, ay: s.ay, bx: px, by: py, gen: s.gen, d0: s.d0, d1: dm });
      next.push({ ax: px, ay: py, bx: s.bx, by: s.by, gen: s.gen, d0: dm, d1: s.d1 });
      // Fork: off at an angle from the midpoint, mostly downward.
      if (s.gen < 3 && level < opts.levels - 1 && rand() < opts.branchP / (1 + s.gen * 1.5)) {
        const ang = (rand() < 0.5 ? -1 : 1) * (0.35 + rand() * 0.5);
        const vx = px - s.ax;
        const vy = py - s.ay;
        const c = Math.cos(ang);
        const sn = Math.sin(ang);
        const scale = 0.7 + rand() * 0.5;
        const bx = px + (vx * c - vy * sn) * scale;
        const by = py + (vx * sn + vy * c) * scale;
        next.push({ ax: px, ay: py, bx, by, gen: s.gen + 1, d0: dm, d1: dm + (s.d1 - s.d0) * 0.6 });
      }
    }
    segs = next;
    disp *= 0.5;
  }
  return segs;
}

// ── screen-width ribbon ─────────────────────────────────────────────────

const RIBBON_VS = /* glsl */ `
  #ifndef RIBBON_OVERLAP
  #define RIBBON_OVERLAP 0.35
  #endif
  attribute vec3 aO;
  attribute float aSide;
  attribute float aEnd;
  attribute vec4 aParam;
  uniform vec2 uRes;
  uniform float uWidthPx;
  varying float vSide;
  varying vec4 vParam;
  varying vec3 vWorld;
  float ribbonWidth(vec4 p);
  void main() {
    vec4 cp = projectionMatrix * viewMatrix * vec4(position, 1.0);
    vec4 co = projectionMatrix * viewMatrix * vec4(aO, 1.0);
    vec2 aspect = vec2(uRes.x / uRes.y, 1.0);
    vec2 sp = cp.xy / cp.w;
    vec2 so = co.xy / co.w;
    vec2 dir = normalize((aEnd < 0.5 ? so - sp : sp - so) * aspect + 1e-6);
    vec2 n = vec2(-dir.y, dir.x);
    float w = ribbonWidth(aParam) * uWidthPx;
    // Sideways for width, a little along the segment so joints overlap
    // (additive ribbons only: on alpha-blended smoke the overlap darkens).
    vec2 offs = (n * aSide * w + dir * (aEnd * 2.0 - 1.0) * w * RIBBON_OVERLAP) * (2.0 / uRes.y) / aspect;
    cp.xy += offs * cp.w;
    vSide = aSide;
    vParam = aParam;
    vWorld = position;
    gl_Position = cp;
  }
`;

export class Ribbon {
  readonly geometry = new THREE.BufferGeometry();
  private readonly p: Float32Array;
  private readonly o: Float32Array;
  private readonly param: Float32Array;
  constructor(readonly maxSegments: number) {
    const v = maxSegments * 4;
    this.p = new Float32Array(v * 3);
    this.o = new Float32Array(v * 3);
    this.param = new Float32Array(v * 4);
    const side = new Float32Array(v);
    const end = new Float32Array(v);
    const index: number[] = [];
    for (let s = 0; s < maxSegments; s++) {
      side.set([-1, 1, -1, 1], s * 4);
      end.set([0, 0, 1, 1], s * 4);
      const k = s * 4;
      // Counter-clockwise on screen (A−n, B−n, A+n …): the side offset is
      // always to the left of the segment, so this winding is front-facing
      // for every segment (the other order is culled as a back face).
      index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
    const dyn = (arr: Float32Array, n: number) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', dyn(this.p, 3));
    this.geometry.setAttribute('aO', dyn(this.o, 3));
    this.geometry.setAttribute('aParam', dyn(this.param, 4));
    this.geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    this.geometry.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.geometry.setIndex(index);
    this.geometry.setDrawRange(0, 0);
  }
  /** Write segment i: endpoints a, b and per-end params. */
  set(i: number, a: THREE.Vector3, b: THREE.Vector3, pa: number[], pb: number[]) {
    const k = i * 4;
    for (let j = 0; j < 4; j++) {
      const atA = j < 2;
      const P = atA ? a : b;
      const O = atA ? b : a;
      this.p.set([P.x, P.y, P.z], (k + j) * 3);
      this.o.set([O.x, O.y, O.z], (k + j) * 3);
      this.param.set(atA ? pa : pb, (k + j) * 4);
    }
  }
  commit(count: number) {
    this.geometry.setDrawRange(0, count * 6);
    for (const name of ['position', 'aO', 'aParam']) (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ── the bolt ────────────────────────────────────────────────────────────

export type BoltStyle = 'branched' | 'crimson' | 'kanada' | 'shader';

export function createBolt(env: EnvUniforms, fx: Fx) {
  const ribbon = new Ribbon(1400);
  const uniforms = {
    uRes: { value: new THREE.Vector2(1280, 720) },
    uWidthPx: { value: 1 },
    uI: { value: 0 },
    uReveal: { value: 1 },
    uKanada: { value: 0 },
    uCore: { value: new THREE.Color('#eef2ff') },
    uGlow: { value: new THREE.Color('#6f86ff') },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env, ...uniforms },
    vertexShader: /* glsl */ `
      uniform float uKanada;
      ${RIBBON_VS}
      // gen 0 trunk is widest; forks thin out.
      float ribbonWidth(vec4 p) { return mix(9.0, 5.0, uKanada) * pow(0.55, p.x); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uI;
      uniform float uReveal;
      uniform float uKanada;
      uniform vec3 uCore;
      uniform vec3 uGlow;
      varying float vSide;
      varying vec4 vParam;
      void main() {
        // Leader: segments appear tip-first by path distance.
        if (vParam.y > uReveal) discard;
        float b = pow(0.62, vParam.x);
        float x = vSide;
        vec3 col;
        if (uKanada > 0.5) {
          // Flat two-tone cel bolt: hot core, coloured edge, hard cut.
          float core = step(abs(x), 0.42);
          float edge = step(abs(x), 0.98);
          col = mix(uGlow * 1.6, uCore * 3.5, core) * edge;
        } else {
          float core = exp(-x * x * 16.0);
          float glow = exp(-x * x * 2.2) * 0.4;
          col = uCore * core * 4.0 + uGlow * glow * 2.0;
        }
        gl_FragColor = vec4(col * b * uI, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(ribbon.geometry, material);
  mesh.name = 'bolt';
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;

  // Shader-only bolt (T5): one quad, line drawn in the fragment.
  const qUniforms = { uI: { value: 0 }, uSeed: { value: 0 }, uReveal: { value: 1 } };
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      uniforms: { ...env, ...fx, ...qUniforms, uCore: uniforms.uCore, uGlow: uniforms.uGlow },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        ${ENV_GLSL}
        uniform float uI;
        uniform float uSeed;
        uniform float uReveal;
        uniform vec3 uCore;
        uniform vec3 uGlow;
        varying vec2 vUv;
        float boltLine(vec2 uv, float seed, float amp) {
          float tq = floor(uTime * 12.0) / 12.0; // re-roll 12x a second
          float wig = (fbm3(vec2(uv.y * 2.2, seed + tq * 5.0)) - 0.5) * amp
                    + (vnoise(vec2(uv.y * 16.0, seed * 3.0 + tq * 9.0)) - 0.5) * amp * 0.25;
          return abs(uv.x - wig);
        }
        void main() {
          vec2 uv = vUv * 2.0 - 1.0;
          uv.x *= 0.65;
          if (vUv.y < 1.0 - uReveal) discard;
          float d = boltLine(uv, uSeed, 0.9);
          // A fork leaving the trunk partway down, wandering further.
          float fy = smoothstep(0.35, -0.2, uv.y);
          float d2 = boltLine(uv + vec2(-0.25 * (0.35 - uv.y), 0.0), uSeed + 7.0, 1.1) + (1.0 - fy) * 9.0;
          float g = pow(0.009 / max(d, 1e-3), 1.35) + 0.5 * pow(0.006 / max(d2, 1e-3), 1.35);
          float ends = smoothstep(-1.0, -0.85, uv.y) * smoothstep(1.0, 0.92, uv.y);
          float edgeX = 1.0 - smoothstep(0.45, 0.65, abs(uv.x));
          vec3 col = mix(uGlow, uCore, smoothstep(0.6, 3.0, g)) * min(g, 6.0);
          gl_FragColor = vec4(col * ends * edgeX * uI, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  quad.name = 'shader-bolt';
  quad.renderOrder = 3;
  quad.visible = false;

  let style: BoltStyle = 'branched';
  const setStyle = (s: BoltStyle) => {
    style = s;
    uniforms.uKanada.value = s === 'kanada' ? 1 : 0;
    if (s === 'crimson') {
      uniforms.uCore.value.set('#ffe3dc');
      uniforms.uGlow.value.set('#ff2a3a');
    } else if (s === 'kanada') {
      uniforms.uCore.value.set('#fff6b0');
      uniforms.uGlow.value.set('#e0141e');
    } else {
      uniforms.uCore.value.set('#eef2ff');
      uniforms.uGlow.value.set('#6f86ff');
    }
  };

  /** Build a new bolt from `top` (cloud base) down, in a plane facing `eye`. */
  const strike = (rand: () => number, top: THREE.Vector3, eye: THREE.Vector3) => {
    const toward = new THREE.Vector3(eye.x - top.x, 0, eye.z - top.z).normalize();
    const right = new THREE.Vector3(-toward.z, 0, toward.x);
    const up = new THREE.Vector3(0, 1, 0);
    const kanada = style === 'kanada';
    const segs = makeBolt(rand, { height: top.y + 20, levels: kanada ? 4 : 7, disp: kanada ? 0.3 : 0.17, branchP: kanada ? 0.55 : 0.42, drift: 0.5 });
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const n = Math.min(segs.length, ribbon.maxSegments);
    for (let i = 0; i < n; i++) {
      const s = segs[i];
      a.copy(top).addScaledVector(right, s.ax).addScaledVector(up, s.ay);
      b.copy(top).addScaledVector(right, s.bx).addScaledVector(up, s.by);
      ribbon.set(i, a, b, [s.gen, s.d0, 0, 0], [s.gen, s.d1, 0, 0]);
    }
    ribbon.commit(n);
    // The shader bolt stands in the same place, facing the camera.
    quad.position.copy(top).addScaledVector(up, -(top.y + 20) / 2);
    quad.scale.set(top.y * 0.75, top.y + 20, 1);
    quad.lookAt(eye.x, quad.position.y, eye.z);
    qUniforms.uSeed.value = rand() * 100;
  };

  /** Drive the bolt from its envelope (intensity, leader reveal). */
  const update = (intensity: number, reveal: number) => {
    const shader = style === 'shader';
    mesh.visible = !shader && intensity > 0.001;
    quad.visible = shader && intensity > 0.001;
    uniforms.uI.value = intensity;
    uniforms.uReveal.value = reveal;
    qUniforms.uI.value = intensity;
    qUniforms.uReveal.value = Math.min(1, reveal);
  };

  return { mesh, quad, uniforms, strike, update, setStyle, style: () => style };
}

// ── meteor ──────────────────────────────────────────────────────────────

export function createMeteor(env: EnvUniforms, fx: Fx) {
  const FIRE = 28;
  const SMOKE = 48;
  const fire = new Ribbon(FIRE);
  const smoke = new Ribbon(SMOKE);
  const uRes = { value: new THREE.Vector2(1280, 720) };
  const uI = { value: 0 };
  const uSmokeA = { value: 0 };
  const fireMat = new THREE.ShaderMaterial({
    uniforms: { ...env, uRes, uWidthPx: { value: 1 }, uI },
    vertexShader: /* glsl */ `
      ${RIBBON_VS}
      // p.x = 0 at the head … 1 at the tail.
      float ribbonWidth(vec4 p) { return mix(14.0, 3.0, p.x); }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      uniform float uI;
      varying float vSide;
      varying vec4 vParam;
      void main() {
        float u = clamp(vParam.x, 0.0, 1.0); // pow() below must never see < 0
        float across = exp(-vSide * vSide * 5.0);
        float heat = pow(1.0 - u, 2.2);
        vec3 col = mix(srgb(vec3(0.48, 0.08, 0.08)), srgb(vec3(0.98, 0.43, 0.09)), heat);
        col = mix(col, srgb(vec3(1.0, 0.94, 0.47)) * 2.5, smoothstep(0.85, 1.0, 1.0 - u) * across);
        gl_FragColor = vec4(col * across * (0.25 + heat) * 3.0 * uI, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const smokeMat = new THREE.ShaderMaterial({
    defines: { RIBBON_OVERLAP: '0.0' },
    uniforms: { ...env, ...fx, uRes, uWidthPx: { value: 1 }, uSmokeA },
    vertexShader: /* glsl */ `
      ${RIBBON_VS}
      // p.y = age of this bit of trail (s): smoke widens as it ages.
      float ribbonWidth(vec4 p) { return 2.5 + p.y * 9.0; }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      uniform float uSmokeA;
      varying float vSide;
      varying vec4 vParam;
      void main() {
        float u = vParam.x;
        float age = vParam.y;
        float across = 1.0 - smoothstep(0.3, 1.0, abs(vSide));
        // Alpha erosion: older parts of the trail fray apart.
        float n = fbm3(vec2(u * 14.0 + vParam.z, vSide * 1.5 + age * 0.4));
        float thr = mix(-0.1, 0.95, clamp(age / 4.0, 0.0, 1.0));
        float a = smoothstep(thr - 0.12, thr + 0.12, n) * across * smoothstep(0.0, 0.08, u);
        vec3 c = mix(srgb(vec3(0.2, 0.15, 0.14)), uHaze * 0.7, 0.4);
        c += srgb(vec3(0.98, 0.43, 0.09)) * (1.0 - smoothstep(0.0, 0.4, age)) * 0.6;
        gl_FragColor = vec4(c, a * 0.75 * uSmokeA);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const headMat = new THREE.ShaderMaterial({
    uniforms: { ...env, uI },
    vertexShader: /* glsl */ `
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 34.0;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uI;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float g = exp(-r * r * 6.0) * 2.5 + exp(-r * r * 40.0) * 4.0;
        gl_FragColor = vec4(vec3(1.0, 0.75, 0.35) * g * uI, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const headGeom = new THREE.BufferGeometry();
  headGeom.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const head = new THREE.Points(headGeom, headMat);
  const fireMesh = new THREE.Mesh(fire.geometry, fireMat);
  const smokeMesh = new THREE.Mesh(smoke.geometry, smokeMat);
  for (const m of [fireMesh, smokeMesh, head]) {
    m.frustumCulled = false;
    m.visible = false;
  }
  fireMesh.renderOrder = 4;
  head.renderOrder = 4;
  smokeMesh.renderOrder = -3;
  const group = new THREE.Group();
  group.name = 'meteor';
  group.add(smokeMesh, fireMesh, head);

  const FALL = 2.6;
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const pathAt = (s: number, out: THREE.Vector3) => {
    const k = Math.min(Math.max(s / FALL, 0), 1);
    const e = Math.pow(k, 1.35); // accelerates
    out.lerpVectors(from, to, e);
    out.y += Math.sin(k * Math.PI) * 40; // a slight arc
    return out;
  };
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  return {
    group,
    uRes,
    FALL,
    /** New path: from high in the sky to the horizon. */
    launch(rand: () => number, eye: THREE.Vector3) {
      const dirAt = (az: number, el: number, d: number) =>
        new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(d).add(eye);
      const side = rand() < 0.5 ? -1 : 1;
      from.copy(dirAt(side * (0.45 + rand() * 0.2), 0.42 + rand() * 0.12, 1500));
      to.copy(dirAt(side * (-0.05 + rand() * 0.15), -0.02, 1900));
    },
    /** Impact point (for the horizon flash). */
    impact: () => to,
    update(age: number) {
      const alive = age >= 0 && age < 9;
      group.visible = alive;
      if (!alive) return;
      const falling = age < FALL;
      // Fire trail: the last 0.55 s of the path.
      for (let i = 0; i < FIRE; i++) {
        const u0 = i / FIRE;
        const u1 = (i + 1) / FIRE;
        pathAt(age - u0 * 0.55, a);
        pathAt(age - u1 * 0.55, b);
        fire.set(i, a, b, [u0, 0, 0, 0], [u1, 0, 0, 0]);
      }
      fire.commit(FIRE);
      // Smoke trail: the last 1.8 s, staying in the sky after the impact.
      for (let i = 0; i < SMOKE; i++) {
        const u0 = i / SMOKE;
        const u1 = (i + 1) / SMOKE;
        const s0 = Math.min(age, FALL) - u0 * 1.8;
        const s1 = Math.min(age, FALL) - u1 * 1.8;
        pathAt(s0, a);
        pathAt(s1, b);
        smoke.set(i, a, b, [u0, age - s0, 3.0, 0], [u1, age - s1, 3.0, 0]);
      }
      smoke.commit(SMOKE);
      pathAt(age, a);
      head.position.copy(a);
      uI.value = falling ? Math.min(1, age / 0.2) : 0;
      fireMesh.visible = falling;
      head.visible = falling;
      smokeMesh.visible = true;
      uSmokeA.value = Math.min(1, age / 0.3) * (1 - THREE.MathUtils.smoothstep(age, 5, 9));
    },
  };
}

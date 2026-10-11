// COPIED from .claude/pages/ad/experiments/hell-src/hell-03-circle-sky-carriers.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-03 carriers: three ways to put the same magic circle in the sky.
 *
 *  WORLD QUAD     a real plane mesh per circle; depth-tested, so the pillar
 *                 and clouds can be in front of or behind it; exact
 *                 perspective; can clip into clouds/ground.
 *  SKY DECAL      a second far-plane dome; each sky pixel intersects its view
 *                 ray with every circle's (virtual) plane. No geometry, never
 *                 clips, always the farthest layer. Also draws the shock rings.
 *  SCREEN OVERLAY a full-screen pass; each circle is an AFFINE ellipse anchored
 *                 to its projected centre (no perspective taper), drawn over
 *                 everything (no depth).
 *
 * Plus a red halation post pass (film-style red halo around bright edges).
 */

import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { ENV_GLSL, type EnvUniforms } from '../env-src/lab';
import { CIRCLE_GLSL, SLAB_GLSL, premultipliedBlend, type CircleUniforms } from './hell-03-circle-sky-glsl';

/** One circle in the sky. */
export type Circle = {
  c: THREE.Vector3; // centre
  n: THREE.Vector3; // plane normal
  r: number; // radius (world units)
  spin: number; // spin speed and direction
  seed: number; // picks the design
  power: number; // brightness
  sun?: boolean; // black sun at the centre
  lattice?: boolean; // decal only: tile the whole plane with sigils
  u?: THREE.Vector3; // in-plane axes (filled by resolveAxes)
  v?: THREE.Vector3;
};

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

/** T1: one orthonormal frame for every tilt. */
export function resolveAxes(c: Circle) {
  c.n.normalize();
  c.u = (c.u ?? new THREE.Vector3()).crossVectors(Math.abs(c.n.y) < 0.99 ? UP : X, c.n).normalize();
  c.v = (c.v ?? new THREE.Vector3()).crossVectors(c.n, c.u);
}

export const MAX = 8;

// ── world quads ─────────────────────────────────────────────────────────

export type QuadPool = {
  meshes: THREE.Mesh[];
  sync(list: Circle[], renderOrder: number, inside: boolean): void;
};

export function createQuadPool(scene: THREE.Scene, env: EnvUniforms, cu: CircleUniforms): QuadPool {
  const geometry = new THREE.PlaneGeometry(2.6, 2.6);
  const meshes: THREE.Mesh[] = [];
  const basis = new THREE.Matrix4();
  for (let i = 0; i < MAX; i++) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...env,
        ...cu,
        uP: { value: new THREE.Vector4(1, 1, 0, 1) }, // r, spin, seed, power
        uSun: { value: 0 },
        uInside: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = position.xy; // the plane is 2.6 wide, scaled by R: uv units of R
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        ${ENV_GLSL}
        ${CIRCLE_GLSL}
        ${SLAB_GLSL}
        uniform vec4 uP;
        uniform float uSun;
        uniform float uInside;
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vec2 uv = vUv;
          vec2 dx = dFdx(uv);
          vec2 dy = dFdy(uv);
          float r = length(uv);
          vec2 nr = uv / max(r, 1e-4);
          float pxR = abs(dot(nr, dx)) + abs(dot(nr, dy));
          float pxD = max(length(dx), length(dy)) * 1.2;
          vec4 p = circlePattern(uv, pxR, pxD, uTime * uP.y, uP.z, uSun);
          vec4 s = shadeCircle(p, r, length(vWorld - cameraPosition), uP.w);
          if (uInside > 0.5) {
            // Inside a cloud: break the lines by cloud density (soft-particle
            // idea, density instead of depth) and bleed red light into the cloud.
            float dens = slabDensity(vWorld);
            float vis = 1.0 - 0.9 * smoothstep(0.25, 0.9, dens);
            float scat = dens * (1.0 - dens) * 4.0 * smoothstep(1.25, 0.2, r);
            s = vec4(s.rgb * vis + uGlowCol * scat * 0.35 * uP.w, s.a * vis);
          }
          gl_FragColor = s;
        }
      `,
      side: THREE.DoubleSide,
    });
    premultipliedBlend(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `circle-quad-${i}`;
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.visible = false;
    scene.add(mesh);
    meshes.push(mesh);
  }
  return {
    meshes,
    sync(list, renderOrder, inside) {
      for (let i = 0; i < MAX; i++) {
        const mesh = meshes[i];
        const c = list[i];
        mesh.visible = !!c;
        if (!c) continue;
        basis.makeBasis(c.u!, c.v!, c.n);
        basis.scale(new THREE.Vector3(c.r, c.r, c.r));
        basis.setPosition(c.c);
        mesh.matrix.copy(basis);
        mesh.matrixWorldNeedsUpdate = true;
        mesh.renderOrder = renderOrder;
        const u = (mesh.material as THREE.ShaderMaterial).uniforms;
        u.uP.value.set(c.r, c.spin, c.seed, c.power);
        u.uSun.value = c.sun ? 1 : 0;
        u.uInside.value = inside ? 1 : 0;
      }
    },
  };
}

// ── sky-dome decal (+ shock rings) ──────────────────────────────────────

export type DecalDome = {
  mesh: THREE.Mesh;
  sync(list: Circle[]): void;
  /** 0 off, 1 planar, 2 angular hairlines, 3 both. */
  setShock(mode: number, age: number, source: Circle | undefined): void;
};

export function createDecalDome(scene: THREE.Scene, env: EnvUniforms, cu: CircleUniforms): DecalDome {
  const arr3 = () => Array.from({ length: MAX }, () => new THREE.Vector3());
  const uniforms = {
    ...env,
    ...cu,
    uC: { value: arr3() },
    uN: { value: arr3() },
    uU: { value: arr3() },
    uV: { value: arr3() },
    uP: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) },
    uQ: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) },
    uCount: { value: 0 },
    uShockMode: { value: 0 },
    uShockAge: { value: 0 },
    uSC: { value: new THREE.Vector3() },
    uSN: { value: new THREE.Vector3(0, 1, 0) },
    uSR: { value: 100 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // on the far plane: behind everything
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${CIRCLE_GLSL}
      uniform vec3 uC[${MAX}];
      uniform vec3 uN[${MAX}];
      uniform vec3 uU[${MAX}];
      uniform vec3 uV[${MAX}];
      uniform vec4 uP[${MAX}]; // r, spin, seed, power
      uniform vec4 uQ[${MAX}]; // black sun, lattice
      uniform int uCount;
      uniform float uShockMode;
      uniform float uShockAge;
      uniform vec3 uSC;
      uniform vec3 uSN;
      uniform float uSR;
      varying vec3 vDir;

      void main() {
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vDir);
        // Ray derivatives taken ONCE, outside the loop (uniform control flow);
        // each circle's uv footprint is then derived analytically.
        vec3 drx = dFdx(rd);
        vec3 dry = dFdy(rd);
        vec3 col = vec3(0.0);
        float a = 0.0;
        for (int i = 0; i < ${MAX}; i++) {
          if (i >= uCount) break;
          float dn = dot(rd, uN[i]);
          if (abs(dn) < 1e-4) continue;
          float tt = -dot(ro - uC[i], uN[i]) / dn;           // ray-plane hit (Quilez)
          if (tt <= 0.0) continue;
          vec3 q = ro + rd * tt - uC[i];
          float R = uP[i].x;
          vec2 uv = vec2(dot(q, uU[i]), dot(q, uV[i])) / R;
          float seed = uP[i].z;
          float spin = uP[i].y;
          float power = uP[i].w;
          if (uQ[i].y > 0.5) {
            // Lattice: the whole plane tiled with sigils, fading far away.
            vec2 cellId = floor(uv / 2.7 + 0.5);
            uv -= cellId * 2.7;
            float hc = hash12(cellId + 17.0);
            seed += floor(hc * 9.0) * 0.37;
            spin *= hc < 0.5 ? -1.0 : 1.0;
            power *= smoothstep(6000.0, 1200.0, tt) * (0.5 + 0.5 * hc);
          } else if (dot(uv, uv) > 1.69) continue;
          // d(hit)/d(ray) = tt * (dr - rd * dot(dr, n) / dot(rd, n))
          vec3 qx = tt * (drx - rd * dot(drx, uN[i]) / dn);
          vec3 qy = tt * (dry - rd * dot(dry, uN[i]) / dn);
          vec2 dx = vec2(dot(qx, uU[i]), dot(qx, uV[i])) / R;
          vec2 dy = vec2(dot(qy, uU[i]), dot(qy, uV[i])) / R;
          float r = length(uv);
          vec2 nr = uv / max(r, 1e-4);
          float pxR = abs(dot(nr, dx)) + abs(dot(nr, dy));
          float pxD = max(length(dx), length(dy)) * 1.2;
          vec4 p = circlePattern(uv, pxR, pxD, uTime * spin, seed, uQ[i].x);
          vec4 s = shadeCircle(p, r, tt, power);
          col = col * (1.0 - s.a) + s.rgb;
          a = a + s.a * (1.0 - a);
        }

        // Shock rings (S10).
        if (uShockMode > 0.5) {
          float fade = exp(-uShockAge / 2.6) * smoothstep(0.0, 0.2, uShockAge);
          if (uShockMode < 1.5 || uShockMode > 2.5) {
            // Planar: rings expanding IN the circle's plane (perspective ellipses).
            float dn = dot(rd, uSN);
            float tt = -dot(ro - uSC, uSN) / (abs(dn) < 1e-4 ? 1e-4 : dn);
            if (tt > 0.0) {
              float rr = length(ro + rd * tt - uSC) / uSR;
              float sum = 0.0;
              for (int j = 0; j < 3; j++) {
                float fr = 1.0 + uShockAge * (1.5 - float(j) * 0.25);
                float x = rr - fr;
                float w = 0.012 * fr;
                sum += exp(-x * x / (w * w)) * (1.0 - float(j) * 0.3) + exp(-max(fr - rr, 0.0) * 5.0) * step(rr, fr) * 0.04;
              }
              float hz = 1.0 - exp(-pow(uCircleFog * tt, 2.0));
              col += (uGlowCol * 0.9 + uCoreHot * 0.12) * sum * fade * (1.0 - hz * 0.7);
            }
          }
          if (uShockMode > 1.5) {
            // Angular: dozens of hairlines on the sky sphere trailing a wavefront,
            // lifting the sky toward its own hue (AoT ep 87 B5).
            vec3 cdir = normalize(uSC - ro);
            float theta = acos(clamp(dot(rd, cdir), -1.0, 1.0));
            float front = uShockAge * 0.17;
            float behind = front - theta;
            float env = smoothstep(0.0, 0.015, behind) * exp(-behind / 0.3);
            float sp = 0.011;
            float px = length(drx) + length(dry); // one pixel, in radians
            float lines = aaStroke((fract(theta / sp) - 0.5) * sp, sp * 0.05, px);
            float flash = exp(-pow((theta - front) / 0.01, 2.0));
            vec3 lift = uHorizon * 0.6 + uGlowCol * 0.25;
            col += lift * (lines * env * 0.9 + flash * 0.6) * exp(-uShockAge / 5.0) * smoothstep(0.0, 0.3, uShockAge);
          }
        }
        gl_FragColor = vec4(col, a);
      }
    `,
    side: THREE.BackSide,
  });
  premultipliedBlend(material);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), material);
  mesh.name = 'circle-decal-dome';
  mesh.frustumCulled = false;
  mesh.renderOrder = -9; // right after the shared sky dome
  mesh.onBeforeRender = (_r, _s, camera) => mesh.position.copy(camera.position);
  scene.add(mesh);
  return {
    mesh,
    sync(list) {
      const n = Math.min(list.length, MAX);
      uniforms.uCount.value = n;
      for (let i = 0; i < n; i++) {
        const c = list[i];
        uniforms.uC.value[i].copy(c.c);
        uniforms.uN.value[i].copy(c.n);
        uniforms.uU.value[i].copy(c.u!);
        uniforms.uV.value[i].copy(c.v!);
        uniforms.uP.value[i].set(c.r, c.spin, c.seed, c.power);
        uniforms.uQ.value[i].set(c.sun ? 1 : 0, c.lattice ? 1 : 0, 0, 0);
      }
    },
    setShock(mode, age, source) {
      uniforms.uShockMode.value = source ? mode : 0;
      uniforms.uShockAge.value = age;
      if (source) {
        uniforms.uSC.value.copy(source.c);
        uniforms.uSN.value.copy(source.n);
        uniforms.uSR.value = source.r;
      }
    },
  };
}

// ── screen overlay ──────────────────────────────────────────────────────

export class OverlayPass extends Pass {
  private readonly quad: FullScreenQuad;
  private readonly material: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;
  private readonly tmp = new THREE.Vector3();
  private readonly view = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    env: EnvUniforms,
    cu: CircleUniforms,
  ) {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...env,
        ...cu,
        tDiffuse: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uCentre: { value: Array.from({ length: MAX }, () => new THREE.Vector2()) },
        uInv: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) }, // inverse affine (column-major mat2)
        uP: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) }, // dist, spin, seed, power
        uQ: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) },
        uCount: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        ${ENV_GLSL}
        ${CIRCLE_GLSL}
        uniform sampler2D tDiffuse;
        uniform vec2 uRes;
        uniform vec2 uCentre[${MAX}];
        uniform vec4 uInv[${MAX}];
        uniform vec4 uP[${MAX}];
        uniform vec4 uQ[${MAX}];
        uniform int uCount;
        varying vec2 vUv;
        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          vec3 col = base.rgb;
          vec2 frag = vUv * uRes;
          for (int i = 0; i < ${MAX}; i++) {
            if (i >= uCount) break;
            mat2 inv = mat2(uInv[i].xy, uInv[i].zw);
            vec2 uv = inv * (frag - uCentre[i]);
            if (dot(uv, uv) > 1.69) continue;
            vec2 dx = inv[0];
            vec2 dy = inv[1];
            float r = length(uv);
            vec2 nr = uv / max(r, 1e-4);
            float pxR = abs(dot(nr, dx)) + abs(dot(nr, dy));
            float pxD = max(length(dx), length(dy)) * 1.2;
            vec4 p = circlePattern(uv, pxR, pxD, uTime * uP[i].y, uP[i].z, uQ[i].x);
            vec4 s = shadeCircle(p, r, uP[i].x, uP[i].w);
            col = col * (1.0 - s.a) + s.rgb;
          }
          gl_FragColor = vec4(col, base.a);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setSize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.material.uniforms.uRes.value.set(width, height);
  }

  private toPixels(p: THREE.Vector3, out: THREE.Vector2) {
    this.tmp.copy(p).project(this.camera);
    out.set((this.tmp.x * 0.5 + 0.5) * this.width, (this.tmp.y * 0.5 + 0.5) * this.height);
  }

  /** Re-anchor every circle to its projected centre this frame (T5). */
  sync(list: Circle[]) {
    const u = this.material.uniforms;
    let n = 0;
    const c2 = new THREE.Vector2();
    const a2 = new THREE.Vector2();
    const b2 = new THREE.Vector2();
    for (const c of list) {
      if (n >= MAX) break;
      // Skip circles behind the camera.
      this.view.copy(c.c).applyMatrix4(this.camera.matrixWorldInverse);
      if (this.view.z > -1) continue;
      this.toPixels(c.c, c2);
      this.toPixels(this.tmp.copy(c.c).addScaledVector(c.u!, c.r), a2);
      const ax = a2.x - c2.x;
      const ay = a2.y - c2.y;
      this.toPixels(this.tmp.copy(c.c).addScaledVector(c.v!, c.r), b2);
      const bx = b2.x - c2.x;
      const by = b2.y - c2.y;
      // Affine A = [a b] (columns); the overlay has no perspective taper.
      const det = ax * by - bx * ay;
      if (Math.abs(det) < 1e-3) continue;
      u.uCentre.value[n].copy(c2);
      u.uInv.value[n].set(by / det, -ay / det, -bx / det, ax / det);
      u.uP.value[n].set(c.c.distanceTo(this.camera.position), c.spin, c.seed, c.power);
      u.uQ.value[n].set(c.sun ? 1 : 0, 0, 0, 0);
      n++;
    }
    u.uCount.value = n;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

// ── halation ────────────────────────────────────────────────────────────

/**
 * Film halation: bright highlights bleed a RED halo (light passes the
 * emulsion, bounces off the film base and re-exposes the red layer).
 * Extract the brightest parts at half resolution, blur them wide, add back
 * tinted red-orange, strongest at hard bright edges.
 */
export class HalationPass extends Pass {
  private readonly a = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private readonly b = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private readonly extract: FullScreenQuad;
  private readonly blur: FullScreenQuad;
  private readonly composite: FullScreenQuad;
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly extractMaterial: THREE.ShaderMaterial;
  amount = 1.0;

  constructor() {
    super();
    const vertexShader = /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `;
    this.extractMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = max(c.r * 0.6, dot(c, vec3(0.2126, 0.7152, 0.0722)));
          gl_FragColor = vec4(c * smoothstep(0.55, 1.4, l), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 uDir;
        varying vec2 vUv;
        void main() {
          vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2;
          float w[4];
          w[0] = 0.17; w[1] = 0.13; w[2] = 0.08; w[3] = 0.04;
          for (int i = 0; i < 4; i++) {
            vec2 o = uDir * float(i + 1) * 2.5;
            s += (texture2D(tDiffuse, vUv + o).rgb + texture2D(tDiffuse, vUv - o).rgb) * w[i];
          }
          gl_FragColor = vec4(s, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tHalo: { value: this.a.texture }, uAmount: { value: 1 } },
      vertexShader,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tHalo;
        uniform float uAmount;
        varying vec2 vUv;
        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          vec3 halo = texture2D(tHalo, vUv).rgb;
          float l = dot(halo, vec3(0.3, 0.6, 0.1));
          gl_FragColor = vec4(base.rgb + vec3(1.0, 0.16, 0.07) * l * 1.6 * uAmount, base.a);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.extract = new FullScreenQuad(this.extractMaterial);
    this.blur = new FullScreenQuad(this.blurMaterial);
    this.composite = new FullScreenQuad(this.compositeMaterial);
  }

  setSize(width: number, height: number) {
    const w = Math.max(1, Math.round(width / 2));
    const h = Math.max(1, Math.round(height / 2));
    this.a.setSize(w, h);
    this.b.setSize(w, h);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.extractMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.a);
    this.extract.render(renderer);
    for (let pass = 0; pass < 2; pass++) {
      this.blurMaterial.uniforms.tDiffuse.value = this.a.texture;
      this.blurMaterial.uniforms.uDir.value.set(1 / this.a.width, 0);
      renderer.setRenderTarget(this.b);
      this.blur.render(renderer);
      this.blurMaterial.uniforms.tDiffuse.value = this.b.texture;
      this.blurMaterial.uniforms.uDir.value.set(0, 1 / this.a.height);
      renderer.setRenderTarget(this.a);
      this.blur.render(renderer);
    }
    this.compositeMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    this.compositeMaterial.uniforms.uAmount.value = this.amount;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.composite.render(renderer);
  }
}

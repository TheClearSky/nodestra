// COPIED from .claude/pages/ad/experiments/hell-src/hell-12-anime-post-passes.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-12 helpers, part 2: the POST passes.
 *
 * Linear HDR (before the lab's bloom):
 *   InkPass          screen-space Sobel outlines from a hard-forms prepass
 *   CircleGlowPass   cel-era "transmitted light" glow for the magic circles
 *   HalationPass     HDR key -> quarter-res blur (read later by the finish)
 *   PyramidBloomPass energy-conserving mip-pyramid bloom (CoD AW style)
 * Display-referred (after OutputPass, the very last pass):
 *   finishMaterial   fringe, halation, grade/LUT, posterise, vignette,
 *                    paper, grain, dither — one pass, uniform switches.
 * Plus code-generated textures: a void-and-cluster blue-noise tile and a
 * baked 3D LUT.
 */

import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

const QUAD_VS = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const COMMON_GLSL = /* glsl */ `
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

function halfTarget(depth = false): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: depth, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
}

/** A 9-tap separable gaussian (linear-sampling taps). */
function blurMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uStep: { value: new THREE.Vector2() } },
    vertexShader: QUAD_VS,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSrc;
      uniform vec2 uStep;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
        c += texture2D(tSrc, vUv + uStep * 1.3846).rgb * 0.316216;
        c += texture2D(tSrc, vUv - uStep * 1.3846).rgb * 0.316216;
        c += texture2D(tSrc, vUv + uStep * 3.2308).rgb * 0.070270;
        c += texture2D(tSrc, vUv - uStep * 3.2308).rgb * 0.070270;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

// ── prepass: hard-forms normals + id + depth ─────────────────────────────

/** Renders layer 1 (hard forms + the ground as an occluder) into a
 *  normal/id buffer with a depth texture. Alpha = 1 on hard forms, 0 on the
 *  ground, 0 + depth 1 on the sky. This one buffer drives the Sobel lines
 *  AND the hard/soft mask the finish pass uses for the shading split. */
export class HardPrepass {
  target: THREE.WebGLRenderTarget;
  hardMat: THREE.ShaderMaterial;
  groundMat: THREE.ShaderMaterial;
  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
    this.target.depthTexture = new THREE.DepthTexture(1, 1);
    const make = (id: number) =>
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          varying vec3 vN;
          void main() {
            vN = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vN;
          void main() {
            vec3 n = normalize(vN);
            if (!gl_FrontFacing) n = -n;
            gl_FragColor = vec4(n * 0.5 + 0.5, ${id.toFixed(1)});
          }
        `,
        side: THREE.DoubleSide,
      });
    this.hardMat = make(1);
    this.groundMat = make(0);
  }
  private full = new THREE.Vector2(1, 1);
  private scale = 1;
  setSize(w: number, h: number) {
    this.full.set(w, h);
    this.target.setSize(Math.max(1, Math.round(w * this.scale)), Math.max(1, Math.round(h * this.scale)));
  }
  /** Full resolution for the Sobel lines; half is plenty when it is only a mask. */
  setScale(scale: number) {
    if (scale === this.scale) return;
    this.scale = scale;
    this.setSize(this.full.x, this.full.y);
  }
  /** `ground` (an occluder, id 0) is only needed when the sky must be told apart from the dunes.
   *  `veils` are the mist / cloud cards with their mask twins: drawn after the
   *  forms, they fade the id where mist covers a form (no ink through mist). */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, hard: THREE.Mesh[], veils: [THREE.Mesh, THREE.Material][], ground: THREE.Mesh, withGround: boolean) {
    const saved = hard.map((m) => m.material);
    const savedVeils = veils.map(([m]) => m.material);
    const savedGround = ground.material;
    const groundWasVisible = ground.visible;
    hard.forEach((m) => (m.material = this.hardMat));
    veils.forEach(([m, mask]) => (m.material = mask));
    ground.material = this.groundMat;
    ground.visible = groundWasVisible && withGround;
    const mask = camera.layers.mask;
    camera.layers.set(1);
    const fog = scene.fog;
    scene.fog = null;
    const clear = renderer.getClearColor(new THREE.Color());
    const alpha = renderer.getClearAlpha();
    renderer.setClearColor(0x808080, 0);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear, alpha);
    scene.fog = fog;
    camera.layers.mask = mask;
    hard.forEach((m, i) => (m.material = saved[i]));
    veils.forEach(([m], i) => (m.material = savedVeils[i]));
    ground.material = savedGround;
    ground.visible = groundWasVisible;
  }
}

// ── Sobel ink lines ──────────────────────────────────────────────────────

export class InkPass extends Pass {
  material: THREE.ShaderMaterial;
  quad: FullScreenQuad;
  constructor(pre: HardPrepass, camera: THREE.PerspectiveCamera, fog: THREE.FogExp2) {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tPre: { value: pre.target.texture },
        tDepth: { value: pre.target.depthTexture },
        uRes: { value: new THREE.Vector2(1, 1) },
        uNear: { value: camera.near },
        uFar: { value: camera.far },
        uWidth: { value: 1.25 },
        uMode: { value: 1 },
        uBoil: { value: 0 },
        uStepTime: { value: 0 },
        uInk: { value: new THREE.Color('#1a0306') },
        uFogDensity: { value: fog.density },
      },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tDiffuse, tPre, tDepth;
        uniform vec2 uRes;
        uniform float uNear, uFar, uWidth, uMode, uBoil, uStepTime, uFogDensity;
        uniform vec3 uInk;
        varying vec2 vUv;
        ${COMMON_GLSL}
        float viewZ(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          vec2 px = uWidth / uRes;
          vec2 uv = vUv;
          // Hand-drawn boil: a stepped, low-frequency wobble of the taps.
          if (uBoil > 0.5) {
            vec2 g = gl_FragCoord.xy * 0.02 + uStepTime * 3.1;
            uv += (vec2(vnoise(g), vnoise(g + 17.3)) - 0.5) * px * 3.0;
          }
          float d[9];
          vec3 n[9];
          float idMax = 0.0;
          for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
            vec2 o = vec2(float(i - 1), float(j - 1)) * px;
            vec4 s = texture2D(tPre, uv + o);
            d[j * 3 + i] = viewZ(uv + o);
            n[j * 3 + i] = s.xyz * 2.0 - 1.0;
            idMax = max(idMax, s.a);
          }
          if (idMax < 0.05) { gl_FragColor = base; return; }
          // Sobel on linear depth (relative) and on the normals.
          float gxd = (d[2] + 2.0 * d[5] + d[8]) - (d[0] + 2.0 * d[3] + d[6]);
          float gyd = (d[6] + 2.0 * d[7] + d[8]) - (d[0] + 2.0 * d[1] + d[2]);
          float dmin = min(min(min(d[1], d[3]), min(d[5], d[7])), d[4]);
          float gd = length(vec2(gxd, gyd)) / max(dmin, 0.1);
          vec3 gxn = (n[2] + 2.0 * n[5] + n[8]) - (n[0] + 2.0 * n[3] + n[6]);
          vec3 gyn = (n[6] + 2.0 * n[7] + n[8]) - (n[0] + 2.0 * n[1] + n[2]);
          float gn = sqrt(dot(gxn, gxn) + dot(gyn, gyn));
          // Grazing surfaces need a higher depth threshold (no false lines).
          float ndv = clamp(n[4].z, 0.0, 1.0);
          float thr = 0.12 * (1.0 + 5.0 * (1.0 - ndv));
          float eDepth = smoothstep(thr, thr * 1.6, gd);
          float eNorm = smoothstep(0.9, 1.5, gn);
          float edge = uMode > 1.5 ? eNorm * smoothstep(0.3, 0.9, texture2D(tPre, uv).a) : max(eDepth, eNorm);
          // Mist over a form fades its id (see the veil masks): no ink through mist.
          edge *= smoothstep(0.15, 0.85, idMax);
          // Lines fade with the fog, like the forms they belong to.
          float f = 1.0 - exp(-uFogDensity * uFogDensity * dmin * dmin);
          edge *= 1.0 - 0.85 * f;
          vec3 ink = base.rgb * 0.18 + uInk;
          gl_FragColor = vec4(mix(base.rgb, ink, edge), base.a);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  setSize(w: number, h: number) {
    this.material.uniforms.uRes.value.set(w, h);
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

// ── E1: transmitted-light glow for the circles ───────────────────────────

/** Renders ONLY the circles (layer 2) at half resolution, blurs three
 *  levels and adds them back tinted along a ramp: a white-pink core, a hot
 *  crimson middle and a deep oxblood far halo (the bi-pack double exposure). */
export class CircleGlowPass extends Pass {
  scene: THREE.Scene;
  camera: THREE.Camera;
  levels = [halfTarget(), halfTarget(), halfTarget()];
  temps = [halfTarget(), halfTarget(), halfTarget()];
  blur = blurMaterial();
  blurQuad: FullScreenQuad;
  composite: THREE.ShaderMaterial;
  compQuad: FullScreenQuad;
  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.blurQuad = new FullScreenQuad(this.blur);
    this.composite = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        t0: { value: this.levels[0].texture },
        t1: { value: this.levels[1].texture },
        t2: { value: this.levels[2].texture },
        c0: { value: new THREE.Color('#ffb8b0').multiplyScalar(0.16) },
        c1: { value: new THREE.Color('#e01408').multiplyScalar(0.06) },
        c2: { value: new THREE.Color('#4a000c').multiplyScalar(0.16) },
      },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse, t0, t1, t2;
        uniform vec3 c0, c1, c2;
        varying vec2 vUv;
        float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)) + c.r * 0.3; }
        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          // Each level becomes a single hue keyed by its brightness: the glow shifts colour as it falls off.
          vec3 g = c0 * lum(texture2D(t0, vUv).rgb) + c1 * lum(texture2D(t1, vUv).rgb) + c2 * lum(texture2D(t2, vUv).rgb);
          gl_FragColor = vec4(base.rgb + g, base.a);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.compQuad = new FullScreenQuad(this.composite);
  }
  setSize(w: number, h: number) {
    [2, 4, 8].forEach((div, i) => {
      this.levels[i].setSize(Math.max(1, Math.round(w / div)), Math.max(1, Math.round(h / div)));
      this.temps[i].setSize(Math.max(1, Math.round(w / div)), Math.max(1, Math.round(h / div)));
    });
  }
  private blurInto(src: THREE.Texture, srcW: number, srcH: number, tmp: THREE.WebGLRenderTarget, dst: THREE.WebGLRenderTarget, renderer: THREE.WebGLRenderer, spread: number) {
    this.blur.uniforms.tSrc.value = src;
    this.blur.uniforms.uStep.value.set(spread / srcW, 0);
    renderer.setRenderTarget(tmp);
    this.blurQuad.render(renderer);
    this.blur.uniforms.tSrc.value = tmp.texture;
    this.blur.uniforms.uStep.value.set(0, spread / tmp.height);
    renderer.setRenderTarget(dst);
    this.blurQuad.render(renderer);
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    // 1. the circles alone, at half resolution
    const mask = this.camera.layers.mask;
    this.camera.layers.set(2);
    const clear = renderer.getClearColor(new THREE.Color());
    const alpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 1);
    const [l0, l1, l2] = this.levels;
    const [t0, t1, t2] = this.temps;
    renderer.setRenderTarget(l0);
    renderer.clear();
    const bg = this.scene.background;
    this.scene.background = null;
    renderer.render(this.scene, this.camera);
    this.scene.background = bg;
    this.camera.layers.mask = mask;
    renderer.setClearColor(clear, alpha);
    // 2. three blur levels: 1/2, 1/4, 1/8 (each blurs the previous one)
    this.blurInto(l0.texture, l0.width, l0.height, t0, l0, renderer, 1.0);
    this.blurInto(l0.texture, l0.width, l0.height, t1, l1, renderer, 1.6);
    this.blurInto(l1.texture, l1.width, l1.height, t2, l2, renderer, 2.2);
    // 3. composite onto the HDR frame
    this.composite.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.compQuad.render(renderer);
  }
}

// ── halation: HDR key at quarter resolution, blurred ─────────────────────

export class HalationPass extends Pass {
  key: THREE.ShaderMaterial;
  keyQuad: FullScreenQuad;
  blur = blurMaterial();
  blurQuad: FullScreenQuad;
  a = halfTarget();
  b = halfTarget();
  constructor() {
    super();
    this.needsSwap = false; // only writes its own targets; the finish pass reads them
    this.key = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 2.2 } },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 uTexel;
        uniform float uThreshold;
        varying vec2 vUv;
        vec3 keyed(vec2 uv) {
          vec3 c = texture2D(tDiffuse, uv).rgb;
          float l = max(c.r, max(c.g, c.b));
          return c * smoothstep(uThreshold, uThreshold * 2.0, l);
        }
        void main() {
          // 4-tap box while downsampling 4x
          vec3 c = keyed(vUv + uTexel * vec2(-1.0, -1.0)) + keyed(vUv + uTexel * vec2(1.0, -1.0))
                 + keyed(vUv + uTexel * vec2(-1.0, 1.0)) + keyed(vUv + uTexel * vec2(1.0, 1.0));
          gl_FragColor = vec4(c * 0.25, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.keyQuad = new FullScreenQuad(this.key);
    this.blurQuad = new FullScreenQuad(this.blur);
  }
  get texture() {
    return this.a.texture;
  }
  setSize(w: number, h: number) {
    this.a.setSize(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)));
    this.b.setSize(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)));
    this.key.uniforms.uTexel.value.set(1 / w, 1 / h);
  }
  render(renderer: THREE.WebGLRenderer, _w: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.key.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.a);
    this.keyQuad.render(renderer);
    for (let i = 0; i < 2; i++) {
      this.blur.uniforms.tSrc.value = this.a.texture;
      this.blur.uniforms.uStep.value.set((1 + i) / this.a.width, 0);
      renderer.setRenderTarget(this.b);
      this.blurQuad.render(renderer);
      this.blur.uniforms.tSrc.value = this.b.texture;
      this.blur.uniforms.uStep.value.set(0, (1 + i) / this.a.height);
      renderer.setRenderTarget(this.a);
      this.blurQuad.render(renderer);
    }
  }
}

// ── energy-conserving pyramid bloom ──────────────────────────────────────

/** LearnOpenGL "physically based bloom" / CoD AW: a 13-tap downsample chain
 *  (Karis average on the first step against fireflies), a tent-filter
 *  upsample chain added level by level, then mix(hdr, bloom, ~4 %). No
 *  threshold: only truly HDR pixels (the circles, rims) bloom visibly. */
export class PyramidBloomPass extends Pass {
  mips: THREE.WebGLRenderTarget[] = [];
  down: THREE.ShaderMaterial;
  up: THREE.ShaderMaterial;
  mix: THREE.ShaderMaterial;
  quad = new FullScreenQuad();
  amount = 0.05;
  constructor(levels = 4) {
    super();
    for (let i = 0; i < levels; i++) this.mips.push(halfTarget());
    this.down = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 } },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform vec2 uTexel;
        uniform float uKaris;
        varying vec2 vUv;
        vec3 s(float x, float y) { return texture2D(tSrc, vUv + uTexel * vec2(x, y)).rgb; }
        float kw(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
        void main() {
          vec3 a = s(-2.0, 2.0), b = s(0.0, 2.0), c = s(2.0, 2.0);
          vec3 d = s(-2.0, 0.0), e = s(0.0, 0.0), f = s(2.0, 0.0);
          vec3 g = s(-2.0, -2.0), h = s(0.0, -2.0), i = s(2.0, -2.0);
          vec3 j = s(-1.0, 1.0), k = s(1.0, 1.0), l = s(-1.0, -1.0), m = s(1.0, -1.0);
          vec3 o;
          if (uKaris > 0.5) {
            // Karis average per 2x2 group: bright single pixels cannot flicker.
            vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
            float w0 = kw(g0), w1 = kw(g1), w2 = kw(g2), w3 = kw(g3), w4 = kw(g4);
            o = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5)
              / (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5);
          } else {
            o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
          }
          gl_FragColor = vec4(max(o, 0.0001), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.up = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uRadius: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform vec2 uRadius;
        varying vec2 vUv;
        vec3 s(float x, float y) { return texture2D(tSrc, vUv + uRadius * vec2(x, y)).rgb; }
        void main() {
          vec3 o = s(0.0, 0.0) * 4.0 + (s(-1.0, 0.0) + s(1.0, 0.0) + s(0.0, -1.0) + s(0.0, 1.0)) * 2.0
                 + s(-1.0, -1.0) + s(1.0, -1.0) + s(-1.0, 1.0) + s(1.0, 1.0);
          gl_FragColor = vec4(o / 16.0, 1.0);
        }
      `,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mix = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tBloom: { value: null }, uAmount: { value: 0.05 }, uLevels: { value: levels } },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse, tBloom;
        uniform float uAmount, uLevels;
        varying vec2 vUv;
        void main() {
          vec4 hdr = texture2D(tDiffuse, vUv);
          vec3 bloom = texture2D(tBloom, vUv).rgb / uLevels;
          gl_FragColor = vec4(mix(hdr.rgb, bloom, uAmount), hdr.a);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
  }
  setSize(w: number, h: number) {
    let mw = w;
    let mh = h;
    for (const m of this.mips) {
      mw = Math.max(1, Math.floor(mw / 2));
      mh = Math.max(1, Math.floor(mh / 2));
      m.setSize(mw, mh);
    }
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    // down
    this.quad.material = this.down;
    let src = readBuffer.texture;
    let sw = readBuffer.width;
    let sh = readBuffer.height;
    this.mips.forEach((m, i) => {
      this.down.uniforms.tSrc.value = src;
      this.down.uniforms.uTexel.value.set(1 / sw, 1 / sh);
      this.down.uniforms.uKaris.value = i === 0 ? 1 : 0;
      renderer.setRenderTarget(m);
      this.quad.render(renderer);
      src = m.texture;
      sw = m.width;
      sh = m.height;
    });
    // up: add each smaller level onto the next larger one
    this.quad.material = this.up;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    for (let i = this.mips.length - 1; i > 0; i--) {
      const small = this.mips[i];
      this.up.uniforms.tSrc.value = small.texture;
      this.up.uniforms.uRadius.value.set(1 / small.width, 1 / small.height);
      renderer.setRenderTarget(this.mips[i - 1]);
      this.quad.render(renderer);
    }
    renderer.autoClear = autoClear;
    // mix
    this.quad.material = this.mix;
    this.mix.uniforms.tDiffuse.value = readBuffer.texture;
    this.mix.uniforms.tBloom.value = this.mips[0].texture;
    this.mix.uniforms.uAmount.value = this.amount;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

// ── code-generated blue noise (void-and-cluster) ─────────────────────────

/** Ulichney's void-and-cluster on a 64x64 torus with a windowed gaussian
 *  energy (sigma 1.5). Returns ranks / N in a float texture. ~50-150 ms. */
export function blueNoiseTexture(size = 64, seed = 7): THREE.DataTexture {
  const N = size * size;
  const sigma = 1.5;
  const R = 6;
  const kernel: number[] = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) kernel.push(Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)));
  const energy = new Float32Array(N);
  const bits = new Uint8Array(N);
  const splat = (idx: number, sign: number) => {
    const x = idx % size;
    const y = (idx / size) | 0;
    let k = 0;
    for (let dy = -R; dy <= R; dy++) {
      const yy = ((y + dy) % size + size) % size;
      for (let dx = -R; dx <= R; dx++) {
        const xx = ((x + dx) % size + size) % size;
        energy[yy * size + xx] += sign * kernel[k++];
      }
    }
  };
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  // initial pattern: ~10 % random ones
  const ones0 = Math.floor(N * 0.1);
  let placed = 0;
  while (placed < ones0) {
    const i = Math.floor(rand() * N);
    if (!bits[i]) {
      bits[i] = 1;
      splat(i, 1);
      placed++;
    }
  }
  const tightest = () => {
    let best = -1;
    let bestE = -Infinity;
    for (let i = 0; i < N; i++) if (bits[i] && energy[i] > bestE) { bestE = energy[i]; best = i; }
    return best;
  };
  const largestVoid = () => {
    let best = -1;
    let bestE = Infinity;
    for (let i = 0; i < N; i++) if (!bits[i] && energy[i] < bestE) { bestE = energy[i]; best = i; }
    return best;
  };
  // relax: move the tightest cluster into the largest void until stable
  for (let iter = 0; iter < 4000; iter++) {
    const c = tightest();
    bits[c] = 0;
    splat(c, -1);
    const v = largestVoid();
    bits[v] = 1;
    splat(v, 1);
    if (v === c) break;
  }
  const rank = new Int32Array(N).fill(-1);
  // phase 1: remove ones (from a copy) to rank them downward
  const bitsCopy = bits.slice();
  const energyCopy = energy.slice();
  let ones = ones0;
  while (ones > 0) {
    const c = tightest();
    bits[c] = 0;
    splat(c, -1);
    ones--;
    rank[c] = ones;
  }
  bits.set(bitsCopy);
  energy.set(energyCopy);
  // phase 2+3: fill voids upward
  for (let r = ones0; r < N; r++) {
    const v = largestVoid();
    bits[v] = 1;
    splat(v, 1);
    rank[v] = r;
  }
  const data = new Float32Array(N);
  for (let i = 0; i < N; i++) data[i] = (rank[i] + 0.5) / N;
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ── baked 3D LUT ─────────────────────────────────────────────────────────

/** "Hellfire film": an S-curve, every hue pulled toward crimson in the
 *  shadows and toward ember in the highlights, highlights desaturated
 *  toward peach. Too costly to run per pixel by hand? Bake it once. */
export function bakeLut(size = 33): THREE.Data3DTexture {
  const data = new Uint16Array(size * size * size * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;
  const hsl = { h: 0, s: 0, l: 0 };
  const c = new THREE.Color();
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    // display-referred input (no colour management: raw values)
    c.setRGB(r / (size - 1), g / (size - 1), b / (size - 1), THREE.LinearSRGBColorSpace);
    c.getHSL(hsl, THREE.LinearSRGBColorSpace);
    // S-curve on lightness, lifted toe so the darkest red stays red, not black
    const L = hsl.l;
    const s = L * L * (3 - 2 * L);
    const lOut = 0.015 + 0.97 * (0.55 * s + 0.45 * L);
    // hue: shadows -> crimson (355 deg), highlights -> ember (22 deg)
    const target = (1 - smooth(0.25, 0.75, L)) * (-5 / 360) + smooth(0.25, 0.75, L) * (22 / 360);
    let h = hsl.h > 0.5 ? hsl.h - 1 : hsl.h;
    const pull = 0.55 + 0.3 * (1 - hsl.s);
    h = h + (target - h) * pull;
    if (h < 0) h += 1;
    const sat = Math.min(1, hsl.s * 1.1 + 0.35) * (1 - 0.45 * smooth(0.7, 1.0, L));
    c.setHSL(h, sat, lOut, THREE.LinearSRGBColorSpace);
    const i = 4 * (r + size * (g + size * b));
    data[i] = toHalf(c.r);
    data[i + 1] = toHalf(c.g);
    data[i + 2] = toHalf(c.b);
    data[i + 3] = toHalf(1);
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.HalfFloatType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

// ── the finish pass (display-referred, last) ─────────────────────────────

export type FinishUniforms = Record<string, { value: unknown }>;

export function finishMaterial(pre: HardPrepass, halo: THREE.Texture, blue: THREE.Texture, lut: THREE.Data3DTexture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      tPre: { value: pre.target.texture },
      tPreDepth: { value: pre.target.depthTexture },
      tHalo: { value: halo },
      tBlue: { value: blue },
      tLut: { value: lut },
      uLutSize: { value: 33 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uPR: { value: 1 },
      uTime: { value: 0 },
      uFrame: { value: 0 },
      // fringe
      uFringeMin: { value: 0.5 },
      uFringeMax: { value: 1.5 },
      uFringeMode: { value: 0 },
      // halation
      uHalo: { value: 0 },
      uHaloCore: { value: 0 },
      uHaloTint: { value: new THREE.Vector3(1.0, 0.16, 0.06) },
      // grade
      uGrade: { value: 0 },
      // posterise
      uPoster: { value: 0 },
      uPosterSoft: { value: 0.02 },
      uPosterJitter: { value: 0 },
      uPosterMask: { value: 0 },
      // vignette / grain
      uVig: { value: 0 },
      uVigMode: { value: 0 },
      uGrain: { value: 0 },
      uGrainFps: { value: 24 },
      uGrainChroma: { value: 0 },
      // paper
      uPaper: { value: 0 },
      uPaperMode: { value: 0 },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      // dither
      uDither: { value: 0 },
      uBandFinder: { value: 0 },
    },
    vertexShader: QUAD_VS,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse, tPre, tPreDepth, tHalo, tBlue;
      uniform highp sampler3D tLut;
      uniform float uLutSize;
      uniform vec2 uRes;
      uniform float uPR, uTime, uFrame;
      uniform float uFringeMin, uFringeMax, uFringeMode;
      uniform float uHalo, uHaloCore;
      uniform vec3 uHaloTint;
      uniform float uGrade;
      uniform float uPoster, uPosterSoft, uPosterJitter, uPosterMask;
      uniform float uVig, uVigMode;
      uniform float uGrain, uGrainFps, uGrainChroma;
      uniform float uPaper, uPaperMode;
      uniform mat4 uInvProj, uCamWorld;
      uniform float uDither, uBandFinder;
      varying vec2 vUv;
      ${COMMON_GLSL}

      vec3 srgbHex(float r, float g, float b) { return vec3(r, g, b) / 255.0; }
      // Single-hue crimson ramp: value does all the work.
      vec3 crimsonRamp(float L) {
        vec3 s0 = srgbHex(5.0, 1.0, 2.0), s1 = srgbHex(36.0, 7.0, 8.0), s2 = srgbHex(83.0, 9.0, 14.0), s3 = srgbHex(168.0, 32.0, 26.0), s4 = srgbHex(255.0, 210.0, 176.0);
        if (L < 0.08) return mix(s0, s1, L / 0.08);
        if (L < 0.22) return mix(s1, s2, (L - 0.08) / 0.14);
        if (L < 0.5) return mix(s2, s3, (L - 0.22) / 0.28);
        return mix(s3, s4, clamp((L - 0.5) / 0.5, 0.0, 1.0));
      }
      vec3 toLin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
      vec3 toSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
      vec3 rgb2oklab(vec3 c) {
        float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
        float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
        float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
        l = pow(l, 1.0 / 3.0); m = pow(m, 1.0 / 3.0); s = pow(s, 1.0 / 3.0);
        return vec3(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
                    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
                    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
      }
      vec3 oklab2rgb(vec3 c) {
        float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
        float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
        float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
        l = l * l * l; m = m * m * m; s = s * s * s;
        return vec3(4.0767416621 * l - 3.3077085913 * m + 0.2309699292 * s,
                   -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                   -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
      }
      float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
      float blue(vec2 p) { return texelFetch(tBlue, ivec2(mod(p, 64.0)), 0).r; }
      float fibres(vec2 p) {
        float f = 0.0;
        for (int k = 0; k < 3; k++) {
          float a = float(k) * 2.1 + 0.4;
          mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
          f += vnoise((r * p) * vec2(1.0, 9.0));
        }
        return f / 3.0;
      }

      void main() {
        vec2 tx = 1.0 / uRes;
        vec3 c0 = texture2D(tDiffuse, vUv).rgb;
        float lxp = luma(texture2D(tDiffuse, vUv + vec2(tx.x, 0.0)).rgb);
        float lxm = luma(texture2D(tDiffuse, vUv - vec2(tx.x, 0.0)).rgb);
        float lyp = luma(texture2D(tDiffuse, vUv + vec2(0.0, tx.y)).rgb);
        float lym = luma(texture2D(tDiffuse, vUv - vec2(0.0, tx.y)).rgb);
        vec2 grad = vec2(lxp - lxm, lyp - lym);
        float gl = length(grad);
        float L0 = luma(c0);
        vec3 c = c0;

        // R4 chromatic fringe: strongest at bright edges.
        if (uFringeMax > 0.0) {
          float edge = smoothstep(0.03, 0.18, gl) * smoothstep(0.15, 0.6, L0 + gl);
          vec2 dir;
          float px;
          if (uFringeMode > 0.5) {
            vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
            dir = q;
            px = uFringeMax * min(length(q) * 1.6, 1.0) * (0.35 + 0.65 * edge);
          } else {
            dir = grad;
            px = mix(uFringeMin, uFringeMax, edge) * step(0.001, edge);
          }
          dir /= max(length(dir), 1e-5);
          vec2 off = dir * px * uPR * tx;
          c = vec3(texture2D(tDiffuse, vUv + off).r, c0.g, texture2D(tDiffuse, vUv - off).b);
        }

        // R6 red halation: a red ring around the brightest things.
        if (uHalo > 0.0) {
          vec3 h = texture2D(tHalo, vUv).rgb;
          float hl = max(h.r, max(h.g, h.b));
          float ring = 1.0 - uHaloCore * smoothstep(0.35, 0.8, L0);
          vec3 add = uHaloTint * (1.0 - exp(-hl * uHalo)) * ring;
          c = c + add * (1.0 - c); // screen
        }

        // R5 grade.
        float L = luma(c);
        if (uGrade > 0.5 && uGrade < 2.5) {
          vec3 g = crimsonRamp(L);
          float protect = uGrade > 1.5 ? smoothstep(0.35, 0.75, L) * 0.85 : 0.0;
          c = mix(c, g, 0.88 * (1.0 - protect));
        } else if (uGrade > 2.5 && uGrade < 4.5) {
          // ASC CDL then a shadow / highlight split.
          bool violet = uGrade > 3.5;
          vec3 slope = vec3(1.06, 0.96, 0.94);
          vec3 offset = vec3(0.006, -0.004, violet ? 0.004 : -0.002);
          vec3 power = vec3(1.08, 1.16, violet ? 1.04 : 1.14);
          c = pow(max(c * slope + offset, 0.0), power);
          float l2 = luma(c);
          float wS = 1.0 - smoothstep(0.0, 0.32, l2);
          float wH = smoothstep(0.3, 0.95, l2);
          vec3 shadowTint = violet ? srgbHex(58.0, 26.0, 74.0) : srgbHex(74.0, 13.0, 26.0);
          vec3 hiTint = srgbHex(255.0, 176.0, 96.0);
          c += (shadowTint - 0.18) * wS * 0.22;
          c = mix(c, c * (hiTint * 1.15), wH * 0.45);
          c = mix(vec3(luma(c)), c, 1.12);
        } else if (uGrade > 4.5) {
          vec3 uvw = clamp(c, 0.0, 1.0) * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize;
          c = texture(tLut, uvw).rgb;
        }
        c = max(c, 0.0);

        // Posterise-lite: quantise LIGHTNESS only (hue kept), soft painted steps.
        if (uPoster > 0.5) {
          vec4 pre = texture2D(tPre, vUv);
          float sky = step(0.99999, texture2D(tPreDepth, vUv).x);
          float m = uPosterMask < 0.5 ? 1.0 - pre.a : (uPosterMask < 1.5 ? sky : 1.0);
          if (uPosterMask < 1.5) m *= 1.0 - smoothstep(0.45, 0.75, luma(c)); // keep the circles' glow smooth
          vec3 lab = rgb2oklab(toLin(c));
          float x = lab.x * uPoster;
          float f = fract(x) + (blue(gl_FragCoord.xy) - 0.5) * uPosterJitter;
          float q = (floor(x) + smoothstep(0.5 - uPosterSoft, 0.5 + uPosterSoft, f)) / uPoster;
          lab.x = mix(lab.x, q, m);
          c = toSrgb(oklab2rgb(lab));
        }

        // Vignette: cos^4, tinted oxblood (mode 0) or plain darkening (mode 1, muddy).
        if (uVig > 0.0) {
          vec2 d = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
          float v = pow(cos(clamp(length(d) * 0.95, 0.0, 1.5707)), 4.0);
          float k = mix(1.0, v, uVig);
          if (uVigMode < 0.5) c = mix(c * srgbHex(150.0, 34.0, 40.0) * 0.9, c, k);
          else c = mix(vec3(luma(c)) * 0.35, c, k);
        }

        // R7 paper / brush texture on FLAT areas, mostly the soft world.
        if (uPaper > 0.0) {
          vec2 sp;
          if (uPaperMode > 0.5 && uPaperMode < 1.5) {
            sp = vUv * vec2(uRes.x / uRes.y, 1.0) * 1.4;          // glued to the screen (shower door)
          } else {
            vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
            vec3 dir = normalize((uCamWorld * vec4(vp.xyz / vp.w, 0.0)).xyz);
            sp = vec2(atan(dir.x, -dir.z), asin(clamp(dir.y, -1.0, 1.0)));  // glued to the view sphere
          }
          float p;
          if (uPaperMode > 1.5) {
            // Brush: streaks running ALONG the forms (perpendicular to the brightness gradient).
            vec2 t = gl > 0.004 ? normalize(vec2(-grad.y, grad.x)) : vec2(0.94, 0.34);
            vec2 nrm = vec2(-t.y, t.x);
            vec2 q = vec2(dot(sp, t), dot(sp, nrm));
            p = 0.65 * vnoise(q * vec2(28.0, 420.0)) + 0.35 * vnoise(q * vec2(9.0, 120.0) + 3.0);
          } else {
            p = 0.45 * vnoise(sp * 520.0) + 0.35 * fibres(sp * 140.0) + 0.2 * vnoise(sp * 22.0);
            p -= 0.18 * smoothstep(0.82, 0.92, vnoise(sp * 90.0 + 7.0)); // a few small pigment drops
          }
          float flatness = 1.0 - smoothstep(0.015, 0.09, gl);
          float hard = texture2D(tPre, vUv).a;
          float w = flatness * mix(1.0, 0.35, hard);
          c *= mix(1.0, 0.86 + 0.28 * p, uPaper * w);
        }

        // R6 film grain: luminance-weighted, held for 1/fps.
        if (uGrain > 0.0) {
          float tt = floor(uTime * uGrainFps);
          vec2 gp = floor(gl_FragCoord.xy / max(uPR, 1.0));
          float n = hash12(gp + tt * 17.13) - 0.5;
          float l3 = luma(c);
          float w = smoothstep(0.0, 0.2, l3) * (1.0 - smoothstep(0.7, 1.0, l3)) * 0.8 + 0.2;
          vec3 nc = uGrainChroma > 0.5 ? vec3(n, hash12(gp + tt * 9.7 + 3.0) - 0.5, hash12(gp + tt * 5.3 + 7.0) - 0.5) : vec3(n);
          c += nc * uGrain * w;
        }

        // R8 dither: the very last thing before the 8-bit canvas.
        c = clamp(c, 0.0, 1.0);
        float dn = 0.0;
        if (uDither > 0.5 && uDither < 1.5) dn = ign(gl_FragCoord.xy) - 0.5;
        else if (uDither > 1.5 && uDither < 2.5) {
          vec2 p = gl_FragCoord.xy + mod(uFrame, 64.0) * 5.588238;
          dn = ign(p) + ign(p + vec2(47.0, 17.0)) - 1.0;           // triangular, -1..1 LSB
        } else if (uDither > 2.5) {
          float g1 = fract(blue(gl_FragCoord.xy) + uFrame * 0.618034);
          float g2 = fract(blue(gl_FragCoord.xy + vec2(32.0, 17.0)) + uFrame * 0.618034 + 0.5);
          dn = g1 + g2 - 1.0;
        }
        if (uBandFinder > 0.5) {
          // Debug: quantise to 8 bits HERE (with the chosen dither) and show the
          // rounding error (in LSB, mid-grey = none) over a dimmed frame. Without
          // dither every smooth gradient turns into a ladder of sawtooth stripes,
          // one per 8-bit band; with dither it dissolves into even, fine noise.
          vec3 q = floor(c * 255.0 + 0.5 + dn) / 255.0;
          float err = luma(q - c) * 255.0;
          c = mix(c * 0.35, vec3(0.5 + 0.55 * err), 0.8);
        } else {
          c += dn / 255.0;
        }
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

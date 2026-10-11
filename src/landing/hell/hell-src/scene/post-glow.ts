// COPIED from .claude/pages/ad/experiments/hell-src/scene/post-glow.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Post class helper: a "transmitted light" (透過光) glow stack.
 *
 * COPIED and adapted from hell-12's CircleGlowPass (hell-12-anime-post-passes.ts).
 * hell-12 rendered the circle alone on its own layer; in the shared scene the
 * circles belong to another class, so this version KEYS the bright HDR pixels
 * out of the frame instead (anything glowing: circles, veins, bolts, the sun).
 * The key is blurred at 1/2, 1/4 and 1/8 resolution and each level is added
 * back in its own hue, so the glow shifts colour as it falls off. hell-12 used
 * a fixed white-pink core, crimson middle and oxblood far halo; here c0, c1, c2
 * are filled by the post class from the scene palette (post.highlights →
 * glow.circles → post.shadows), and the defaults below are only placeholders.
 */

import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

const QUAD_VS = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function target(): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
}

/** A 9-tap separable gaussian (linear-sampling taps), as in hell-12. */
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

export class GlowStackPass extends Pass {
  levels = [target(), target(), target()];
  temps = [target(), target(), target()];
  key: THREE.ShaderMaterial;
  keyQuad: FullScreenQuad;
  blur = blurMaterial();
  blurQuad: FullScreenQuad;
  composite: THREE.ShaderMaterial;
  compQuad: FullScreenQuad;

  constructor() {
    super();
    // Key: keep only the HDR-bright pixels (soft knee), 4 taps while halving.
    this.key = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uLow: { value: 0.8 }, uHigh: { value: 1.8 } },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 uTexel;
        uniform float uLow, uHigh;
        varying vec2 vUv;
        vec3 keyed(vec2 uv) {
          vec3 c = texture2D(tDiffuse, uv).rgb;
          float m = max(c.r, max(c.g, c.b));
          return min(c, vec3(8.0)) * smoothstep(uLow, uHigh, m);
        }
        void main() {
          vec3 c = keyed(vUv + uTexel * vec2(-0.5, -0.5)) + keyed(vUv + uTexel * vec2(0.5, -0.5))
                 + keyed(vUv + uTexel * vec2(-0.5, 0.5)) + keyed(vUv + uTexel * vec2(0.5, 0.5));
          gl_FragColor = vec4(c * 0.25, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.keyQuad = new FullScreenQuad(this.key);
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
        uGain: { value: 1 },
      },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse, t0, t1, t2;
        uniform vec3 c0, c1, c2;
        uniform float uGain;
        varying vec2 vUv;
        float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)) + c.r * 0.3; }
        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          // Each level becomes one hue keyed by its brightness (hue shifts with the fall-off).
          vec3 g = c0 * lum(texture2D(t0, vUv).rgb) + c1 * lum(texture2D(t1, vUv).rgb) + c2 * lum(texture2D(t2, vUv).rgb);
          gl_FragColor = vec4(base.rgb + g * uGain, base.a);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.compQuad = new FullScreenQuad(this.composite);
  }

  setSize(w: number, h: number) {
    [2, 4, 8].forEach((div, i) => {
      const lw = Math.max(1, Math.round(w / div));
      const lh = Math.max(1, Math.round(h / div));
      this.levels[i].setSize(lw, lh);
      this.temps[i].setSize(lw, lh);
    });
    this.key.uniforms.uTexel.value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
  }

  private blurInto(src: THREE.WebGLRenderTarget, tmp: THREE.WebGLRenderTarget, dst: THREE.WebGLRenderTarget, renderer: THREE.WebGLRenderer, spread: number) {
    this.blur.uniforms.tSrc.value = src.texture;
    this.blur.uniforms.uStep.value.set(spread / src.width, 0);
    renderer.setRenderTarget(tmp);
    this.blurQuad.render(renderer);
    this.blur.uniforms.tSrc.value = tmp.texture;
    this.blur.uniforms.uStep.value.set(0, spread / tmp.height);
    renderer.setRenderTarget(dst);
    this.blurQuad.render(renderer);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const [l0, l1, l2] = this.levels;
    const [t0, t1, t2] = this.temps;
    // 1. the bright pixels alone, at half resolution
    this.key.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(l0);
    this.keyQuad.render(renderer);
    // 2. three blur levels: 1/2, 1/4, 1/8 (each from the previous one)
    this.blurInto(l0, t0, l0, renderer, 1.0);
    this.blurInto(l0, t1, l1, renderer, 1.6);
    this.blurInto(l1, t2, l2, renderer, 2.2);
    // 3. add the tinted levels onto the HDR frame
    this.composite.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.compQuad.render(renderer);
  }
}

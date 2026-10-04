// COPIED from .claude/pages/ad/experiments/env-src/godrays.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * Screen-space light scattering (GPU Gems 3, ch. 13, Kenny Mitchell):
 *  1. render an occlusion buffer at half resolution — the sun and its near
 *     glow bright, everything else black (all our materials honour
 *     `uOcclusion`, so the alpha-cut leaves keep their gaps);
 *  2. radially blur it toward the sun's screen position, with a per-pixel
 *     dither so 64 taps do not band;
 *  3. add the result over the frame, tinted warm.
 */

import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import type { EnvUniforms } from './lab';

export class GodRaysPass extends Pass {
  readonly occlusion: THREE.WebGLRenderTarget;
  readonly blurred: THREE.WebGLRenderTarget;
  readonly params = { density: 0.95, decay: 0.972, weight: 0.5, exposure: 0.9, gain: 1 };
  private readonly blurQuad: FullScreenQuad;
  private readonly compositeQuad: FullScreenQuad;
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly sunScreen = new THREE.Vector3();
  private readonly clearColor = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly env: EnvUniforms,
  ) {
    super();
    this.occlusion = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.blurred = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.blurMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tOcclusion: { value: this.occlusion.texture },
        uSun: { value: new THREE.Vector2(0.5, 0.5) },
        uDensity: { value: 0.9 },
        uDecay: { value: 0.965 },
        uWeight: { value: 0.42 },
        uExposure: { value: 0.55 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tOcclusion;
        uniform vec2 uSun;
        uniform float uDensity;
        uniform float uDecay;
        uniform float uWeight;
        uniform float uExposure;
        varying vec2 vUv;
        const int TAPS = 64;
        void main() {
          vec2 delta = (vUv - uSun) * uDensity / float(TAPS);
          float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          vec2 tc = vUv - delta * dither;
          float illum = 1.0;
          vec3 sum = vec3(0.0);
          for (int i = 0; i < TAPS; i++) {
            tc -= delta;
            sum += texture2D(tOcclusion, tc).rgb * illum * uWeight;
            illum *= uDecay;
          }
          gl_FragColor = vec4(sum * uExposure / float(TAPS) * 8.0, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tRays: { value: this.blurred.texture },
        uTint: { value: new THREE.Color(1.0, 0.9, 0.72) },
        uGain: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tRays;
        uniform vec3 uTint;
        uniform float uGain;
        varying vec2 vUv;
        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          vec3 rays = texture2D(tRays, vUv).rgb;
          gl_FragColor = vec4(base.rgb + rays * uTint * uGain, base.a);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.blurQuad = new FullScreenQuad(this.blurMaterial);
    this.compositeQuad = new FullScreenQuad(this.compositeMaterial);
  }

  setSize(width: number, height: number) {
    const w = Math.max(1, Math.round(width / 2));
    const h = Math.max(1, Math.round(height / 2));
    this.occlusion.setSize(w, h);
    this.blurred.setSize(w, h);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    // Sun position on screen; fade out when it is behind the camera.
    this.sunScreen.copy(this.env.uSunDir.value).multiplyScalar(1000).add(this.camera.position).project(this.camera);
    const toSun = this.env.uSunDir.value.clone();
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const facing = THREE.MathUtils.smoothstep(forward.dot(toSun), 0.0, 0.35);
    const u = this.blurMaterial.uniforms;
    u.uSun.value.set(this.sunScreen.x * 0.5 + 0.5, this.sunScreen.y * 0.5 + 0.5);
    u.uDensity.value = this.params.density;
    u.uDecay.value = this.params.decay;
    u.uWeight.value = this.params.weight;
    u.uExposure.value = this.params.exposure;

    // 1. occlusion buffer.
    const previousClear = renderer.getClearColor(this.clearColor).clone();
    const previousAlpha = renderer.getClearAlpha();
    const previousBackground = this.scene.background;
    this.scene.background = null;
    renderer.setClearColor(0x000000, 1);
    this.env.uOcclusion.value = 1;
    renderer.setRenderTarget(this.occlusion);
    renderer.clear();
    // Layer 1 (ground cover: grass, flowers, motes) never hides the sun —
    // skip it here; it is most of the frame's vertices.
    const mask = this.camera.layers.mask;
    this.camera.layers.set(0);
    renderer.render(this.scene, this.camera);
    this.camera.layers.mask = mask;
    this.env.uOcclusion.value = 0;
    this.scene.background = previousBackground;
    renderer.setClearColor(previousClear, previousAlpha);

    // 2. radial blur.
    renderer.setRenderTarget(this.blurred);
    this.blurQuad.render(renderer);

    // 3. composite.
    this.compositeMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    this.compositeMaterial.uniforms.uGain.value = this.params.gain * facing;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.compositeQuad.render(renderer);
  }

  dispose() {
    this.occlusion.dispose();
    this.blurred.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
    this.blurQuad.dispose();
    this.compositeQuad.dispose();
  }
}

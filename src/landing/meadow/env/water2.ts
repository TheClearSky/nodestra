// COPIED from .claude/pages/ad/experiments/env-src/water2.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * v2 water: one river surface with two painted looks, a cheap blurred
 * planar mirror, and 4-point star sparkles.
 *
 *  - MIRROR: the scene is re-rendered from the camera reflected in the water
 *    plane (oblique near plane = the water, Lengyel's trick, as three's
 *    Reflector), at ~0.4× resolution and without the grass layer, then
 *    blurred with a separable gaussian (stronger vertically, as reflections
 *    smear). The first blur pass also turns the mirror's depth buffer into a
 *    0/1 "something is reflected here" mask in alpha.
 *  - "Cel painted" (ref 2): flat cobalt→turquoise body, a few soft light
 *    bands, the mirror mask painted as ONE flat dark-teal reflection band,
 *    and a thin dark line where the bank meets the water (constant pixel
 *    width from fwidth of the water depth).
 *  - "Mirror calm" (ref 3): the blurred mirror, tinted teal, faded by a
 *    stylised fresnel into a deep body colour, faint slow ripples bending it.
 *  - Sparkles: discrete 4-point stars (or dots) that pop in, hold and fade
 *    over 0.2–0.6 s. A cluster pool samples points in an angular window
 *    round the sun's mirror point and keeps each with the Cox–Munk
 *    probability that a wave facet there mirrors the sun into the eye
 *    (exp(−tan²θ_h/σ²), the env-03 placement), so they gather in one loose
 *    patch; a small scatter pool sprinkles single stars over the river.
 */

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { ENV_GLSL, seededRandom } from './lab';
import { RIVER_GLSL } from './river';
import { CHANNEL_GLSL, MIST_GLSL } from './v2-glsl';
import { RIVER, riverCentre, type Env2 } from './v2-kit';

// ── mirror ──────────────────────────────────────────────────────────────

export type Mirror = {
  /** Blurred reflection (rgb) + reflected-geometry mask (a). */
  texture: THREE.Texture;
  textureMatrix: THREE.Matrix4;
  enabled: boolean;
  /** Objects hidden while the mirror renders (the water itself, sparkles…). */
  hide: THREE.Object3D[];
  /** Blur radii in mirror texels: [horizontal, vertical]. */
  blur: [number, number];
  update(): void;
  setSize(width: number, height: number): void;
};

export function createMirror(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  waterY: number,
  scale = 0.4,
): Mirror {
  const depthTexture = new THREE.DepthTexture(1, 1);
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture });
  const a = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const b = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const vcam = new THREE.PerspectiveCamera();
  vcam.layers.set(0);
  const textureMatrix = new THREE.Matrix4();
  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tColor: { value: null }, tDepth: { value: depthTexture }, uStep: { value: new THREE.Vector2() }, uFirst: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tColor;
      uniform sampler2D tDepth;
      uniform vec2 uStep;
      uniform float uFirst;
      varying vec2 vUv;
      vec4 fetch(vec2 uv) {
        vec4 c = texture2D(tColor, uv);
        if (uFirst > 0.5) c.a = step(texture2D(tDepth, uv).x, 0.99999);
        return c;
      }
      void main() {
        vec4 s = fetch(vUv) * 0.2270270270;
        s += (fetch(vUv + uStep * 1.3846153846) + fetch(vUv - uStep * 1.3846153846)) * 0.3162162162;
        s += (fetch(vUv + uStep * 3.2307692308) + fetch(vUv - uStep * 3.2307692308)) * 0.0702702703;
        gl_FragColor = s;
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(blurMat);
  const plane = new THREE.Plane();
  const clipPlane = new THREE.Vector4();
  const q = new THREE.Vector4();
  const camPos = new THREE.Vector3();
  const target = new THREE.Vector3();
  const up = new THREE.Vector3();
  const rot = new THREE.Matrix4();
  let w = 1;
  let h = 1;

  const mirror: Mirror = {
    texture: b.texture,
    textureMatrix,
    enabled: true,
    hide: [],
    blur: [1.2, 2.2],
    setSize(width, height) {
      w = Math.max(2, Math.round(width * scale));
      h = Math.max(2, Math.round(height * scale));
      rt.setSize(w, h);
      a.setSize(w, h);
      b.setSize(w, h);
    },
    update() {
      if (!mirror.enabled) return;
      camera.updateMatrixWorld();
      camPos.setFromMatrixPosition(camera.matrixWorld);
      rot.extractRotation(camera.matrixWorld);
      target.set(0, 0, -1).applyMatrix4(rot).add(camPos);
      up.set(0, 1, 0).applyMatrix4(rot);
      vcam.position.set(camPos.x, 2 * waterY - camPos.y, camPos.z);
      vcam.up.set(up.x, -up.y, up.z);
      vcam.lookAt(target.x, 2 * waterY - target.y, target.z);
      vcam.far = camera.far;
      vcam.updateMatrixWorld();
      vcam.projectionMatrix.copy(camera.projectionMatrix);
      textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      textureMatrix.multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);
      // Oblique near plane = the water (a hair below, so the waterline closes).
      plane.set(new THREE.Vector3(0, 1, 0), -(waterY - 0.03));
      plane.applyMatrix4(vcam.matrixWorldInverse);
      clipPlane.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const e = vcam.projectionMatrix.elements;
      q.x = (Math.sign(clipPlane.x) + e[8]) / e[0];
      q.y = (Math.sign(clipPlane.y) + e[9]) / e[5];
      q.z = -1;
      q.w = (1 + e[10]) / e[14];
      clipPlane.multiplyScalar(2 / clipPlane.dot(q));
      e[2] = clipPlane.x;
      e[6] = clipPlane.y;
      e[10] = clipPlane.z + 1;
      e[14] = clipPlane.w;
      vcam.projectionMatrixInverse.copy(vcam.projectionMatrix).invert();

      const visible = mirror.hide.map((o) => o.visible);
      for (const o of mirror.hide) o.visible = false;
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, vcam);
      mirror.hide.forEach((o, i) => (o.visible = visible[i]));

      const [bh, bv] = mirror.blur;
      const pass = (src: THREE.Texture, dst: THREE.WebGLRenderTarget, dx: number, dy: number, first: number) => {
        blurMat.uniforms.tColor.value = src;
        blurMat.uniforms.uFirst.value = first;
        blurMat.uniforms.uStep.value.set(dx / w, dy / h);
        renderer.setRenderTarget(dst);
        quad.render(renderer);
      };
      pass(rt.texture, a, bh, 0, 1);
      pass(a.texture, b, 0, bv, 0);
      pass(b.texture, a, bh * 1.8, 0, 0);
      pass(a.texture, b, 0, bv * 1.8, 0);
      renderer.setRenderTarget(previous);
    },
  };
  return mirror;
}

// ── the water surface ───────────────────────────────────────────────────

export type WaterMode = 'cel' | 'mirror' | 'hybrid';

export type Water2 = {
  mesh: THREE.Mesh;
  setMode(mode: WaterMode): void;
  uniforms: Record<string, { value: unknown }>;
};

export function createWater2(env: Env2, mirror: Mirror, near: number, far: number): Water2 {
  const along = 700;
  const across = 12;
  const half = 7.6;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= along; i++) {
    const u = i / along;
    const z = near - Math.pow(u, 1.8) * (near - far);
    const c = riverCentre(z);
    for (let j = 0; j <= across; j++) positions.push(c + ((j / across) * 2 - 1) * half, RIVER.waterY, z);
  }
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < across; j++) {
      const a = i * (across + 1) + j;
      const b = a + across + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);

  const uniforms = {
    ...env,
    tMirror: { value: mirror.texture },
    uTexMat: { value: mirror.textureMatrix },
    uMode: { value: 0 },
    uWaterY: { value: RIVER.waterY },
    uRipple: { value: 0.3 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform mat4 uTexMat;
      varying vec3 vWorld;
      varying vec4 vMirror;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vMirror = uTexMat * w;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${MIST_GLSL}
      ${RIVER_GLSL}
      ${CHANNEL_GLSL}
      uniform sampler2D tMirror;
      uniform float uMode;
      uniform float uWaterY;
      uniform float uRipple;
      varying vec3 vWorld;
      varying vec4 vMirror;

      // Slow swell + wind ripples, carried downstream (+z).
      float swell(vec2 q) {
        float t = uTime;
        return vnoise(q * vec2(0.32, 0.11) + vec2(0.0, -t * 0.09)) * 0.5
             + vnoise(q * vec2(1.1, 0.42) + vec2(t * 0.03, -t * 0.22) + 5.0) * 0.32
             + vnoise(q * vec2(3.2, 1.5) + vec2(-t * 0.08, -t * 0.45) + 9.0) * 0.18;
      }

      void main() {
        if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec2 p = vWorld.xz;
        vec2 q = vec2(p.x - riverCentre(p.y), p.y);
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        float e = 0.1;
        float h0 = swell(q);
        vec2 slope = vec2(swell(q + vec2(e, 0.0)) - h0, swell(q + vec2(0.0, e)) - h0) / e;
        float amp = uRipple / (1.0 + dist * 0.035);
        vec3 n = normalize(vec3(-slope.x * amp, 1.0, -slope.y * amp));
        float depth = uWaterY - channelHeight(p);
        float fw = max(fwidth(depth), 1e-4);
        vec2 muv = vMirror.xy / vMirror.w;
        float sv = cloudShadow(vWorld);

        // Screen-aligned frame for the light bands (wide, horizontal on screen).
        vec3 rightW = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 fwdW = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        vec2 rel = p - cameraPosition.xz;
        float lat = dot(rel, normalize(rightW.xz + 1e-5));
        float dep = dot(rel, normalize(fwdW.xz + 1e-5));
        float bandN = fbm3(vec2(lat * 0.03, dep * 0.3) + vec2(uTime * 0.012, -uTime * 0.05));

        vec3 col;
        if (uMode < 0.5) {
          // ── cel painted (ref 2) ──
          // Measured on ref 2: near (25,120,150), middle (48,166,194), far (72,176,210).
          float graze = 1.0 - smoothstep(0.02, 0.3, V.y);
          vec3 nearC = srgb(vec3(0.10, 0.45, 0.59));
          vec3 midC = srgb(vec3(0.19, 0.65, 0.76));
          vec3 farC = srgb(vec3(0.30, 0.70, 0.83));
          col = mix(mix(nearC, midC, smoothstep(0.0, 0.6, graze)), farC, smoothstep(0.6, 1.0, graze));
          // Soft lighter washes, wide and flat on screen.
          float band = smoothstep(0.56, 0.76, bandN) * smoothstep(3.0, 12.0, dist);
          col = mix(col, farC * 1.08, band * 0.4);
          // Paper / brush grain, only up close (no shimmer far away).
          float grain = vnoise(vec2(lat * 2.2, dep * 0.9)) * 0.6 + vnoise(vec2(lat * 7.0, dep * 2.6)) * 0.4;
          col *= 1.0 + (grain - 0.5) * 0.07 * (1.0 - smoothstep(8.0, 30.0, dist));
          // The sun's patch: a broad, soft lift of the colour.
          vec3 R = vec3(-V.x, V.y, -V.z);
          float sp = max(dot(R, uSunDir), 0.0);
          col = mix(col, midC * 1.25, smoothstep(0.9, 0.98, sp) * 0.3 * sv);
          // One flat reflection band for everything the river mirrors; its
          // edge breaks into short horizontal dashes like painted ripples.
          float wav = vnoise(vec2(lat * 0.8, dep * 5.0) + vec2(0.0, uTime * 0.35)) - 0.5;
          vec4 m = texture2D(tMirror, muv + vec2(0.0, wav * 0.014));
          float mask = smoothstep(0.42, 0.56, m.a);
          float luma = dot(m.rgb / max(m.a, 0.05), vec3(0.3, 0.55, 0.15));
          vec3 reflDark = srgb(vec3(0.07, 0.33, 0.45));
          vec3 reflLight = srgb(vec3(0.12, 0.45, 0.56));
          vec3 reflC = mix(reflDark, reflLight, smoothstep(0.3, 0.7, luma));
          reflC *= 0.95 + 0.1 * vnoise(vec2(lat * 1.6, 0.5));
          col = mix(col, reflC, mask * 0.88);
          // Thin dark line where the bank meets the water (ref 2: a dark
          // brown-violet edge under the grass).
          float line = 1.0 - smoothstep(fw * 0.8, fw * 2.2, depth);
          col = mix(col, srgb(vec3(0.13, 0.08, 0.12)), line * 0.9);
        } else {
          // ── mirror calm (ref 3) / hybrid ──
          vec2 duv = n.xz * vec2(0.07, 0.2);
          vec4 m = texture2D(tMirror, muv + duv);
          float cosT = max(dot(n, V), 0.0);
          float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
          fres = mix(0.55, 1.0, fres);
          vec3 deep = srgb(vec3(0.035, 0.15, 0.19));
          vec3 shallow = srgb(vec3(0.14, 0.32, 0.30));
          vec3 body = mix(deep, shallow, 1.0 - smoothstep(0.0, 0.45, depth));
          body *= uAmbient * 0.9 + uSunColor * 0.35;
          // Anime water paints its reflections a little darker and richer
          // than the world above; in the mist much darker (ref 3).
          vec3 tint = mix(vec3(0.80, 0.93, 0.95), vec3(0.6, 0.7, 0.76), uMist);
          vec3 r = m.rgb * tint;
          r = mix(vec3(dot(r, vec3(0.3, 0.55, 0.15))), r, 1.0 + 0.25 * uMist);
          col = mix(body, r, fres);
          // Faint wind lines: calm strips mirror a touch more light.
          float band = smoothstep(0.62, 0.76, bandN) * smoothstep(4.0, 14.0, dist);
          col += mix(uHorizon, uSunColor, 0.4) * band * 0.035;
          float line = 1.0 - smoothstep(fw * 1.0, fw * 4.0, depth);
          col *= 1.0 - line * 0.4;
        }
        col = mistFade(col, vWorld);
        if (uDebug > 2.5) col = texture2D(tMirror, muv).rgb;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  // After every opaque thing, without writing depth: what is under the water
  // is painted over; sparkle sprites are only hidden by real occluders.
  mesh.renderOrder = 10;
  return {
    mesh,
    uniforms,
    setMode(mode) {
      uniforms.uMode.value = mode === 'cel' ? 0 : mode === 'mirror' ? 1 : 2;
      uniforms.uRipple.value = mode === 'cel' ? 0.3 : mode === 'mirror' ? 0.2 : 0.26;
      mirror.blur = mode === 'cel' ? [1.0, 1.6] : [1.0, 2.0];
    },
  };
}

// ── star sparkles ───────────────────────────────────────────────────────

export type SparkleStyle = 'stars' | 'dots' | 'off';

export type Sparkles = {
  mesh: THREE.Mesh;
  setStyle(style: SparkleStyle): void;
  /** density of the sun patch, density of the scatter, size gain */
  setAmount(cluster: number, scatter: number, size: number): void;
  uniforms: Record<string, { value: unknown }>;
};

export function createSparkles(env: Env2, viewW: () => number, viewH: () => number, clusterSlots = 700, scatterSlots = 110): Sparkles {
  const rnd = seededRandom(5);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const total = clusterSlots + scatterSlots;
  const slots = new Float32Array(total);
  for (let i = 0; i < total; i++) slots[i] = i + rnd() * 0.01;
  geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slots, 1));
  geo.instanceCount = total;
  const uniforms = {
    ...env,
    uStyle: { value: 1 },
    uCluster: { value: clusterSlots },
    uDensity: { value: 1 },
    uScatter: { value: 0.5 },
    uSize: { value: 1 },
    uSigma: { value: 0.24 },
    uSpread: { value: 0.18 },
    uGlintSun: { value: env.uSunDir.value },
    uWaterY: { value: RIVER.waterY },
    uViewW: { value: 1600 },
    uViewH: { value: 1000 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      ${RIVER_GLSL}
      attribute float aSlot;
      uniform float uStyle;
      uniform float uCluster;
      uniform float uDensity;
      uniform float uScatter;
      uniform float uSize;
      uniform float uSigma;
      uniform float uSpread;
      uniform vec3 uGlintSun;
      uniform float uWaterY;
      uniform float uViewW;
      uniform float uViewH;
      varying vec2 vUv;
      varying float vBright;
      varying float vPx;
      varying vec2 vArm;
      void main() {
        vUv = position.xy;
        vBright = 0.0;
        vPx = 1.0;
        vArm = vec2(1.0);
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        if (uStyle < 0.5) return;
        float slot = floor(aSlot);
        bool scatter = slot >= uCluster;
        // Each slot lives 0.2–0.6 s, then re-rolls a new spot.
        float life = mix(0.2, 0.6, hash12(vec2(slot * 0.71, 7.1)));
        float tt = uTime / life + hash12(vec2(slot * 1.31, 3.3));
        float epoch = floor(tt);
        float u = fract(tt);
        vec3 cam = cameraPosition;
        float camH = max(cam.y - uWaterY, 0.2);
        vec3 L = normalize(uGlintSun);
        float sunAz = atan(L.x, -L.z);
        float el = asin(clamp(L.y, 0.0, 1.0));
        vec3 P = vec3(0.0);
        bool found = false;
        for (int k = 0; k < 4; k++) {
          vec2 h1 = hash22(vec2(slot * 1.37 + float(k) * 17.13, epoch * 0.731 + 3.1));
          vec2 h2 = hash22(vec2(slot * 2.11 + float(k) * 5.71, epoch * 1.913 + 0.7));
          vec3 C;
          if (!scatter) {
            // Angular window round the sun's mirror point (≈ uniform on screen).
            float dep = clamp(el + (h1.x - 0.5) * 2.0 * uSpread, 0.03, 1.45);
            float az = sunAz + (h1.y - 0.5) * 2.0 * uSpread * 1.7;
            float r = camH / tan(dep);
            C = vec3(cam.x + sin(az) * r, uWaterY, cam.z - cos(az) * r);
          } else {
            float invD = mix(1.0 / 4.0, 1.0 / 110.0, h1.x);
            float z = cam.z - 1.0 / invD;
            C = vec3(riverCentre(z) + (h1.y - 0.5) * 12.4, uWaterY, z);
          }
          if (abs(C.x - riverCentre(C.z)) > 6.3) continue;
          vec3 V = normalize(cam - C);
          vec3 H = normalize(L + V);
          float tan2 = dot(H.xz, H.xz) / max(H.y * H.y, 1e-4);
          float pr = exp(-tan2 / (uSigma * uSigma));
          pr = scatter ? uScatter * (0.25 + 0.75 * pr) : uDensity * pr;
          pr *= cloudShadow(C);
          if (h2.x < pr) { P = C; found = true; break; }
        }
        if (!found) return;
        // Same pixel, nearer depth: the arms are not cut by the water's own
        // nearer surface (the water writes no depth anyway; this guards the bed).
        vec3 Pd = cam + (P + vec3(0.0, 0.02, 0.0) - cam) * 0.85;
        vec4 clip = projectionMatrix * viewMatrix * vec4(Pd, 1.0);
        if (clip.w <= 0.0) return;
        float dist = length(cam - P);
        float hs = hash12(vec2(slot * 3.7 + 1.0, epoch * 1.37));
        float k = uViewH / 1000.0 * mix(0.5, 1.0, clamp(16.0 / dist, 0.0, 1.0)) * uSize;
        float px = uStyle < 1.5 ? (5.0 + 22.0 * pow(hs, 3.0)) * k : (1.6 + 2.6 * hs) * k;
        if (scatter) px *= 0.75;
        // Pop in fast, hold, fade out while shrinking a little.
        float popIn = smoothstep(0.0, 0.12, u);
        float fade = 1.0 - smoothstep(0.5, 1.0, u);
        float s = px * mix(0.35, 1.0, popIn) * mix(0.55, 1.0, fade);
        clip.xy += position.xy * s / vec2(uViewW, uViewH) * 2.0 * clip.w;
        gl_Position = clip;
        vPx = s;
        vBright = popIn * fade * (0.55 + 0.45 * hs);
        // Some stars are wider than tall.
        float wide = hash12(vec2(slot * 5.1, epoch * 0.53));
        vArm = wide > 0.6 ? vec2(1.0, 0.7) : vec2(0.85, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOcclusion;
      uniform float uStyle;
      varying vec2 vUv;
      varying float vBright;
      varying float vPx;
      varying vec2 vArm;
      void main() {
        if (uOcclusion > 0.5 || vBright <= 0.0) discard;
        vec2 uv = vUv;
        float r2 = dot(uv, uv);
        float I;
        if (uStyle < 1.5) {
          // Arms about 1.1 px wide whatever the star's size: crisp crosses.
          float k = clamp(vPx / 1.1, 6.0, 40.0);
          float ax = abs(uv.x) / vArm.x;
          float ay = abs(uv.y) / vArm.y;
          float armH = exp(-abs(uv.y) * k) * pow(max(1.0 - ax, 0.0), 2.0);
          float armV = exp(-abs(uv.x) * k) * pow(max(1.0 - ay, 0.0), 2.0);
          float core = exp(-r2 * 70.0);
          float glow = exp(-r2 * 10.0);
          I = armH + armV + core * 1.3 + glow * 0.1;
        } else {
          I = exp(-r2 * 5.0) * 1.1;
        }
        vec3 c = mix(vec3(0.62, 0.9, 1.0), vec3(1.0, 0.995, 0.97), clamp(I * 1.2, 0.0, 1.0));
        gl_FragColor = vec4(c * I * vBright * 2.0, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 40;
  mesh.onBeforeRender = () => {
    uniforms.uViewW.value = viewW();
    uniforms.uViewH.value = viewH();
  };
  return {
    mesh,
    uniforms,
    setStyle(style) {
      uniforms.uStyle.value = style === 'off' ? 0 : style === 'stars' ? 1 : 2;
    },
    setAmount(cluster, scatter, size) {
      uniforms.uDensity.value = cluster;
      uniforms.uScatter.value = scatter;
      uniforms.uSize.value = size;
    },
  };
}

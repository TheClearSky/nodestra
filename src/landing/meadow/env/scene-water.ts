// COPIED from .claude/pages/ad/experiments/env-src/scene-water.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * W1 "Cel painted" water + 4-point star sparkles for the instrument scenes.
 *
 * A COPY of water2.ts's `createWater2` (cel branch only, the user's pick) and
 * `createSparkles`, re-pointed at this scene's river (scene-terrain.ts:
 * `riverX`, `WATER_Y`, and the carved terrain for the shoreline line)
 * instead of river.ts's. The look and the maths are unchanged; the blurred
 * planar mirror is water2.ts's own `createMirror`, imported as is.
 */

import * as THREE from 'three';
import { ENV_GLSL, seededRandom } from './lab';
import { MIST_GLSL } from './v2-glsl';
import type { Env2 } from './v2-kit';
import type { Mirror } from './water2';
import { TERRAIN_GLSL, WATER_HALF, WATER_Y, riverX } from './scene-terrain';

export function createSceneWater(env: Env2, mirror: Mirror, near: number, far: number): THREE.Mesh {
  const along = 700;
  const across = 12;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= along; i++) {
    const u = i / along;
    const z = near - Math.pow(u, 1.8) * (near - far);
    const c = riverX(z);
    for (let j = 0; j <= across; j++) positions.push(c + ((j / across) * 2 - 1) * WATER_HALF, WATER_Y, z);
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
  mirror.blur = [1.0, 1.6];

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...env,
      tMirror: { value: mirror.texture },
      uTexMat: { value: mirror.textureMatrix },
      uWaterY: { value: WATER_Y },
    },
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
      ${TERRAIN_GLSL}
      uniform sampler2D tMirror;
      uniform float uWaterY;
      varying vec3 vWorld;
      varying vec4 vMirror;

      void main() {
        if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec2 p = vWorld.xz;
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        float depth = uWaterY - sceneHeight(p);
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

        // ── cel painted (ref 2) ── measured on ref 2: near (25,120,150),
        // middle (48,166,194), far (72,176,210).
        float graze = 1.0 - smoothstep(0.02, 0.3, V.y);
        vec3 nearC = srgb(vec3(0.10, 0.45, 0.59));
        vec3 midC = srgb(vec3(0.19, 0.65, 0.76));
        vec3 farC = srgb(vec3(0.30, 0.70, 0.83));
        vec3 col = mix(mix(nearC, midC, smoothstep(0.0, 0.6, graze)), farC, smoothstep(0.6, 1.0, graze));
        float band = smoothstep(0.56, 0.76, bandN) * smoothstep(3.0, 12.0, dist);
        col = mix(col, farC * 1.08, band * 0.4);
        float grain = vnoise(vec2(lat * 2.2, dep * 0.9)) * 0.6 + vnoise(vec2(lat * 7.0, dep * 2.6)) * 0.4;
        col *= 1.0 + (grain - 0.5) * 0.07 * (1.0 - smoothstep(8.0, 30.0, dist));
        vec3 R = vec3(-V.x, V.y, -V.z);
        float sp = max(dot(R, uSunDir), 0.0);
        col = mix(col, midC * 1.25, smoothstep(0.9, 0.98, sp) * 0.3 * sv);
        // One flat reflection band for everything the river mirrors.
        float wav = vnoise(vec2(lat * 0.8, dep * 5.0) + vec2(0.0, uTime * 0.35)) - 0.5;
        vec4 m = texture2D(tMirror, muv + vec2(0.0, wav * 0.014));
        float mask = smoothstep(0.42, 0.56, m.a);
        float luma = dot(m.rgb / max(m.a, 0.05), vec3(0.3, 0.55, 0.15));
        vec3 reflDark = srgb(vec3(0.07, 0.33, 0.45));
        vec3 reflLight = srgb(vec3(0.12, 0.45, 0.56));
        vec3 reflC = mix(reflDark, reflLight, smoothstep(0.3, 0.7, luma));
        reflC *= 0.95 + 0.1 * vnoise(vec2(lat * 1.6, 0.5));
        col = mix(col, reflC, mask * 0.88);
        // Thin dark line where the bank meets the water.
        float line = 1.0 - smoothstep(fw * 0.8, fw * 2.2, depth);
        col = mix(col, srgb(vec3(0.13, 0.08, 0.12)), line * 0.9);
        col = mistFade(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  // After every opaque thing, without writing depth (as water2.ts).
  mesh.renderOrder = 10;
  mesh.name = 'water';
  return mesh;
}

/** water2.ts `createSparkles` (stars), on this scene's river. */
export function createSceneSparkles(env: Env2, viewW: () => number, viewH: () => number, clusterSlots = 700, scatterSlots = 110): THREE.Mesh {
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
    uCluster: { value: clusterSlots },
    uDensity: { value: 1 },
    uScatter: { value: 0.5 },
    uSize: { value: 1 },
    uSigma: { value: 0.24 },
    uSpread: { value: 0.18 },
    uGlintSun: { value: env.uSunDir.value },
    uWaterY: { value: WATER_Y },
    uViewW: { value: 1600 },
    uViewH: { value: 1000 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      ${TERRAIN_GLSL}
      attribute float aSlot;
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
        float slot = floor(aSlot);
        bool scatter = slot >= uCluster;
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
            float dep = clamp(el + (h1.x - 0.5) * 2.0 * uSpread, 0.03, 1.45);
            float az = sunAz + (h1.y - 0.5) * 2.0 * uSpread * 1.7;
            float r = camH / tan(dep);
            C = vec3(cam.x + sin(az) * r, uWaterY, cam.z - cos(az) * r);
          } else {
            float invD = mix(1.0 / 4.0, 1.0 / 110.0, h1.x);
            float z = cam.z - 1.0 / invD;
            C = vec3(sceneRiverX(z) + (h1.y - 0.5) * 12.4, uWaterY, z);
          }
          if (abs(C.x - sceneRiverX(C.z)) > 6.3) continue;
          vec3 V = normalize(cam - C);
          vec3 H = normalize(L + V);
          float tan2 = dot(H.xz, H.xz) / max(H.y * H.y, 1e-4);
          float pr = exp(-tan2 / (uSigma * uSigma));
          pr = scatter ? uScatter * (0.25 + 0.75 * pr) : uDensity * pr;
          pr *= cloudShadow(C);
          if (h2.x < pr) { P = C; found = true; break; }
        }
        if (!found) return;
        vec3 Pd = cam + (P + vec3(0.0, 0.02, 0.0) - cam) * 0.85;
        vec4 clip = projectionMatrix * viewMatrix * vec4(Pd, 1.0);
        if (clip.w <= 0.0) return;
        float dist = length(cam - P);
        float hs = hash12(vec2(slot * 3.7 + 1.0, epoch * 1.37));
        float k = uViewH / 1000.0 * mix(0.5, 1.0, clamp(16.0 / dist, 0.0, 1.0)) * uSize;
        float px = (5.0 + 22.0 * pow(hs, 3.0)) * k;
        if (scatter) px *= 0.75;
        float popIn = smoothstep(0.0, 0.12, u);
        float fade = 1.0 - smoothstep(0.5, 1.0, u);
        float s = px * mix(0.35, 1.0, popIn) * mix(0.55, 1.0, fade);
        clip.xy += position.xy * s / vec2(uViewW, uViewH) * 2.0 * clip.w;
        gl_Position = clip;
        vPx = s;
        vBright = popIn * fade * (0.55 + 0.45 * hs);
        float wide = hash12(vec2(slot * 5.1, epoch * 0.53));
        vArm = wide > 0.6 ? vec2(1.0, 0.7) : vec2(0.85, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOcclusion;
      varying vec2 vUv;
      varying float vBright;
      varying float vPx;
      varying vec2 vArm;
      void main() {
        if (uOcclusion > 0.5 || vBright <= 0.0) discard;
        vec2 uv = vUv;
        float r2 = dot(uv, uv);
        // Arms about 1.1 px wide whatever the star's size: crisp crosses.
        float k = clamp(vPx / 1.1, 6.0, 40.0);
        float ax = abs(uv.x) / vArm.x;
        float ay = abs(uv.y) / vArm.y;
        float armH = exp(-abs(uv.y) * k) * pow(max(1.0 - ax, 0.0), 2.0);
        float armV = exp(-abs(uv.x) * k) * pow(max(1.0 - ay, 0.0), 2.0);
        float core = exp(-r2 * 70.0);
        float glow = exp(-r2 * 10.0);
        float I = armH + armV + core * 1.3 + glow * 0.1;
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
  mesh.name = 'sparkles';
  mesh.onBeforeRender = () => {
    uniforms.uViewW.value = viewW();
    uniforms.uViewH.value = viewH();
  };
  return mesh;
}

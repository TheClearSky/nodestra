// COPIED from .claude/pages/ad/experiments/env-src/sky.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * Anime sky: gradient dome + painted cloud layer (2D fbm projected on the
 * sky plane, lit by a directional derivative toward the sun), towering
 * cumulus built from billboard "puffs" with cel-banded spherical shading,
 * and layered distant hills with aerial perspective.
 */

import * as THREE from 'three';
import { BILLBOARD_GLSL, ENV_GLSL, seededRandom, type EnvUniforms } from './lab';

// ── dome ────────────────────────────────────────────────────────────────

export type SkyDome = {
  mesh: THREE.Mesh;
  /** 0 = no painted layer, 1 = painted layer. */
  uLayer: { value: number };
  /** 0 = soft painted, 1 = cel (hard-edged anime tones). */
  uCel: { value: number };
  uCover: { value: number };
};

export function createSkyDome(env: EnvUniforms): SkyDome {
  const uLayer = { value: 1 };
  const uCel = { value: 0 };
  const uCover = { value: 0.6 };
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env, uLayer, uCel, uCover },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // on the far plane
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      uniform float uLayer;
      uniform float uCel;
      uniform float uCover;
      varying vec3 vDir;

      float cloudField(vec2 p) {
        // Domain-warped fbm: rounded heaps rather than uniform noise.
        vec2 w = vec2(vnoise(p * 0.6 + 1.7), vnoise(p * 0.6 + 8.3)) - 0.5;
        return fbm(p + w * 0.9);
      }
      float cloudFieldLite(vec2 p) {
        vec2 w = vec2(vnoise(p * 0.6 + 1.7), vnoise(p * 0.6 + 8.3)) - 0.5;
        return fbm3(p + w * 0.9);
      }

      void main() {
        vec3 d = normalize(vDir);
        if (uOcclusion > 0.5) {
          // Occlusion buffer: only the sun and its near glow.
          float mu = max(dot(d, uSunDir), 0.0);
          float m = smoothstep(0.9975, 0.9992, mu) * 1.0 + pow(mu, 180.0) * 0.6;
          gl_FragColor = vec4(uSunColor * m, 1.0);
          return;
        }
        vec3 col = skyGradient(d);
        // Sun disc (bloom turns it into a soft blaze).
        float mu = dot(d, uSunDir);
        col += uSunColor * smoothstep(0.9988, 0.9994, mu) * 6.0;

        if (uLayer > 0.5 && d.y > 0.0) {
          vec2 p = d.xz / (d.y + 0.1) * 2.3 + vec2(uTime * 0.006, uTime * 0.002);
          float n = cloudField(p);
          float horizonFade = smoothstep(0.0, 0.22, d.y);
          // Crisp-ish painted edge; a fine octave frays it.
          float fray = (vnoise(p * 9.0) - 0.5) * 0.07;
          float dens = smoothstep(uCover, uCover + 0.09, n + fray) * horizonFade;
          if (dens > 0.001) {
            vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.09;
            // Directional derivative toward the sun (cheaper octaves suffice).
            float nl = cloudFieldLite(p + toSun) + (n - cloudFieldLite(p));
            float lit = clamp((n - nl) * 7.0 + 0.55, 0.0, 1.0);
            vec3 sunTint = mix(vec3(1.0), uSunColor / max(max(uSunColor.r, uSunColor.g), uSunColor.b), 0.55);
            vec3 shadowC = mix(mix(srgb(vec3(0.62, 0.68, 0.86)), srgb(vec3(0.76, 0.72, 0.88)), 0.3), uAmbient, 0.25);
            vec3 litC = srgb(vec3(1.0, 0.995, 0.98)) * 1.06 * sunTint;
            float band = uCel > 0.5 ? smoothstep(0.5, 0.53, lit) : smoothstep(0.2, 0.85, lit);
            vec3 c = mix(shadowC, litC, band);
            // Thin edges let the sky through; thick cores keep their shade.
            float thick = smoothstep(uCover + 0.05, uCover + 0.3, n);
            c = mix(mix(col, c, 0.75), c, thick);
            // Silver lining where the cloud is thin and faces the sun.
            float rim = (1.0 - thick) * pow(max(mu, 0.0), 5.0);
            c += uSunColor * rim * 0.8;
            c = mix(c, col, (1.0 - horizonFade) * 0.6);
            col = mix(col, c, dens * 0.96);
          }
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 64, 32), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.onBeforeRender = (_r, _s, camera) => mesh.position.copy(camera.position);
  return { mesh, uLayer, uCel, uCover };
}

// ── cumulus (billboard puffs) ───────────────────────────────────────────

export type CloudPlacement = {
  /** Azimuth (radians, 0 = −z, positive towards +x) and distance from origin. */
  azimuth: number;
  distance: number;
  base: number;
  width: number;
  height: number;
  seed: number;
};

export type Cumulus = { mesh: THREE.Mesh; uCel: { value: number }; visible(on: boolean): void };

/**
 * A cumulus is a flat-bottomed heap of spheres: a wide base row, a towering
 * stack of shrinking domes, and smaller lobes budding on their upper
 * surfaces (two levels) — the "cauliflower". Each sphere is drawn as a
 * camera-facing puff whose fragment rebuilds a sphere normal, blended with
 * the whole cloud's normal so the heap reads as one form, then lit in
 * anime tones: lavender-blue shade, white body, warm rim on the sun side.
 */
export function createCumulus(env: EnvUniforms, clouds: CloudPlacement[], viewFrom: THREE.Vector3): Cumulus {
  type Puff = { p: THREE.Vector3; r: number; cloud: THREE.Vector3; base: number; h: number };
  const puffs: Puff[] = [];
  for (const cloud of clouds) {
    const rnd = seededRandom(cloud.seed);
    const centre = new THREE.Vector3(Math.sin(cloud.azimuth) * cloud.distance, cloud.base, -Math.cos(cloud.azimuth) * cloud.distance);
    const right = new THREE.Vector3(Math.cos(cloud.azimuth), 0, Math.sin(cloud.azimuth));
    const toward = new THREE.Vector3(-Math.sin(cloud.azimuth), 0, Math.cos(cloud.azimuth));
    const own: Puff[] = [];
    const add = (p: THREE.Vector3, r: number) => own.push({ p, r, cloud: new THREE.Vector3(), base: cloud.base, h: cloud.height });
    // Base row.
    const baseCount = 7 + Math.floor(rnd() * 4);
    for (let i = 0; i < baseCount; i++) {
      const u = (i / (baseCount - 1) - 0.5) * cloud.width;
      const r = cloud.width * (0.12 + rnd() * 0.06) * (1 - Math.abs(u / cloud.width) * 0.8);
      add(centre.clone().addScaledVector(right, u).addScaledVector(toward, (rnd() - 0.5) * cloud.width * 0.25).setY(cloud.base + r * 0.55), r);
    }
    // Tower: shrinking domes, drifting off-centre a little.
    let x = (rnd() - 0.5) * cloud.width * 0.2;
    let y = cloud.base + cloud.width * 0.1;
    let r = cloud.width * 0.24;
    while (y < cloud.base + cloud.height) {
      const n = 2 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        add(
          centre.clone().addScaledVector(right, x + (rnd() - 0.5) * r * 1.6).addScaledVector(toward, (rnd() - 0.5) * r).setY(y + rnd() * r * 0.3),
          r * (0.75 + rnd() * 0.35),
        );
      }
      y += r * 0.8;
      x += (rnd() - 0.5) * r * 0.5;
      r *= 0.82;
    }
    // Budding lobes on the upper surfaces.
    const parents = own.slice();
    for (const parent of parents) {
      const buds = 2 + Math.floor(rnd() * 2);
      for (let i = 0; i < buds; i++) {
        const theta = rnd() * Math.PI * 2;
        const phi = rnd() * 1.1; // upper cap only
        const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
        const rr = parent.r * (0.42 + rnd() * 0.18);
        add(parent.p.clone().addScaledVector(dir, parent.r * 0.7), rr);
      }
    }
    // Cloud centre of mass (for the blended normal).
    const mass = new THREE.Vector3();
    for (const puff of own) mass.add(puff.p);
    mass.divideScalar(own.length);
    for (const puff of own) {
      puff.cloud.copy(mass);
      puffs.push(puff);
    }
  }
  // Back to front from the viewpoint (one global sort; the camera barely moves).
  puffs.sort((a, b) => b.p.distanceToSquared(viewFrom) - a.p.distanceToSquared(viewFrom));

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const aPuff = new Float32Array(puffs.length * 4);
  const aCloud = new Float32Array(puffs.length * 4);
  puffs.forEach((puff, i) => {
    aPuff.set([puff.p.x, puff.p.y, puff.p.z, puff.r], i * 4);
    aCloud.set([puff.cloud.x, puff.cloud.y, puff.cloud.z, puff.base], i * 4);
  });
  geometry.setAttribute('aPuff', new THREE.InstancedBufferAttribute(aPuff, 4));
  geometry.setAttribute('aCloud', new THREE.InstancedBufferAttribute(aCloud, 4));
  geometry.instanceCount = puffs.length;

  const uCel = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env, uCel },
    vertexShader: /* glsl */ `
      ${BILLBOARD_GLSL}
      attribute vec4 aPuff;
      attribute vec4 aCloud;
      varying vec2 vUv;
      varying vec3 vCentre;
      varying vec3 vCloud;
      varying float vR;
      varying float vBase;
      varying vec3 vWorld;
      void main() {
        vUv = position.xy;
        vR = aPuff.w;
        vCentre = aPuff.xyz;
        vCloud = aCloud.xyz;
        vBase = aCloud.w;
        vec3 w = billboard(aPuff.xyz, position.xy, vec2(aPuff.w * 1.15));
        vWorld = w;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      uniform float uCel;
      varying vec2 vUv;
      varying vec3 vCentre;
      varying vec3 vCloud;
      varying float vR;
      varying float vBase;
      varying vec3 vWorld;
      void main() {
        vec2 uv = vUv * 1.15;
        float r = length(uv);
        if (r > 1.12) discard;
        // Eroded, slightly wispy edge.
        vec2 en = uv * 2.5 + vCentre.xz * 0.01;
        float edgeNoise = (vnoise(en) * 0.65 + vnoise(en * 2.3) * 0.35) - 0.5;
        float edge = r + edgeNoise * 0.22;
        float alpha = smoothstep(1.0, 0.7, edge);
        // Flat base: cut everything below the condensation level.
        alpha *= smoothstep(vBase - 2.0, vBase + 6.0, vWorld.y + edgeNoise * 6.0);
        if (alpha < 0.01) discard;
        if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, alpha); return; }
        // Sphere normal in view space → world, blended with the cloud's.
        float z = sqrt(max(0.0, 1.0 - min(r, 1.0) * min(r, 1.0)));
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 fwd = normalize(cameraPosition - vCentre);
        vec3 nPuff = normalize(right * uv.x + up * uv.y + fwd * z);
        vec3 nCloud = normalize(vWorld - vCloud);
        vec3 n = normalize(mix(nPuff, nCloud, 0.6));
        float l = dot(n, uSunDir) * 0.5 + 0.5;
        float height = clamp((vWorld.y - vBase) / 220.0, 0.0, 1.0);
        vec3 sunTint = mix(vec3(1.0), uSunColor / max(max(uSunColor.r, uSunColor.g), uSunColor.b), 0.85);
        vec3 shadeC = mix(srgb(vec3(0.58, 0.63, 0.82)), uAmbient, 0.25);
        vec3 midC = srgb(vec3(0.90, 0.92, 0.98)) * mix(vec3(1.0), sunTint, 0.6);
        vec3 litC = srgb(vec3(1.0, 0.985, 0.95)) * 1.12 * sunTint;
        float band = uCel > 0.5
          ? 0.5 * smoothstep(0.38, 0.42, l) + 0.5 * smoothstep(0.68, 0.71, l)
          : smoothstep(0.2, 0.9, l);
        vec3 c = mix(shadeC, midC, smoothstep(0.0, 0.55, band));
        c = mix(c, litC, smoothstep(0.55, 1.0, band));
        // Underside in shade; a touch of sky blue bounced into the shadows.
        c = mix(c, shadeC * 0.92, (1.0 - smoothstep(0.0, 0.25, height)) * 0.55);
        c += uZenith * 0.06 * (1.0 - band);
        // Faint crevices between lobes on the shaded side: the drawn look.
        c *= 1.0 - smoothstep(0.75, 1.0, r) * (1.0 - band) * 0.12;
        // Warm rim on the CLOUD's silhouette (not each puff's) towards the sun.
        vec3 toCam = normalize(cameraPosition - vWorld);
        float sil = pow(1.0 - max(dot(nCloud, toCam), 0.0), 3.0);
        c += uSunColor * sil * pow(max(dot(-toCam, uSunDir), 0.0), 2.0) * 0.5;
        c = airFade(c, vWorld, 0.00045);
        gl_FragColor = vec4(c, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -5;
  return {
    mesh,
    uCel,
    visible(on) {
      mesh.visible = on;
    },
  };
}

// ── distant hills ───────────────────────────────────────────────────────

export type HillLayer = { distance: number; height: number; roughness: number; color: string; haze: number; trees?: boolean; seed: number };

/**
 * Hills as arcs of ridge-line strips round the viewer: each layer is a
 * curtain whose top follows a 1-D fractal ridge (with a fine "tree-line"
 * bump on the nearer layers), coloured flat and faded into the haze by
 * layer — painterly aerial perspective.
 */
export function createHills(env: EnvUniforms, layers: HillLayer[], centreAzimuth = 0, span = Math.PI * 1.2): THREE.Group {
  const group = new THREE.Group();
  for (const layer of layers) {
    const rnd = seededRandom(layer.seed);
    const segments = 600;
    const phase = Array.from({ length: 8 }, () => rnd() * 100);
    // Ridged fractal: sharp crests, soft valleys (1 − |sin|, squared).
    const ridge = (u: number) => {
      let h = 0;
      let amp = 1;
      let freq = 1.2;
      for (let o = 0; o < 6; o++) {
        const v = 1 - Math.abs(Math.sin(u * freq * Math.PI * 2 + phase[o]));
        h += amp * v * v;
        amp *= layer.roughness;
        freq *= 2.13;
      }
      let trees = 0;
      if (layer.trees) {
        const k = u * 1400;
        trees = Math.abs(Math.sin(k + phase[6])) * 0.6 + Math.abs(Math.sin(k * 1.73 + phase[7])) * 0.4;
      }
      return h * 0.6 + trees * 0.025;
    };
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      const a = centreAzimuth + (u - 0.5) * span;
      const x = Math.sin(a) * layer.distance;
      const z = -Math.cos(a) * layer.distance;
      const top = ridge(u) * layer.height;
      positions.push(x, -20, z, x, top, z);
      uvs.push(u, 0, u, 1);
      if (i < segments) {
        const k = i * 2;
        indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...env,
        uColor: { value: new THREE.Color(layer.color) },
        uHazeAmt: { value: layer.haze },
        uTop: { value: layer.height },
        uForest: { value: layer.trees ? 1 : 0 },
        uArc: { value: layer.distance * span },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying float vV;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vV = uv.x;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        ${ENV_GLSL}
        uniform vec3 uColor;
        uniform float uHazeAmt;
        uniform float uTop;
        uniform float uForest;
        uniform float uArc;
        varying vec3 vWorld;
        varying float vV;
        void main() {
          if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          vec3 dir = normalize(vWorld - cameraPosition);
          // Painted ground haze: denser low down, warmer towards the sun.
          float low = 1.0 - smoothstep(-5.0, uTop * 0.9, vWorld.y);
          vec3 c = uColor;
          // Slopes: a lumpy surface lit by a directional derivative toward the
          // sun (sunny flanks, shaded gullies); forest clumps on near layers.
          vec2 q = vec2(vV * uArc, vWorld.y) / max(uTop, 1.0) * vec2(1.0, 2.2) * 1.6;
          vec2 sunQ = normalize(vec2(-uSunDir.x, uSunDir.y) + 1e-4) * 0.12;
          float f0 = fbm(q);
          float f1 = fbm(q + sunQ);
          float lit = clamp((f0 - f1) * 5.0 + 0.5, 0.0, 1.0);
          c *= mix(0.78, 1.18, lit);
          if (uForest > 0.5) {
            float clumps = fbm(q * 5.0);
            c *= mix(0.82, 1.08, smoothstep(0.35, 0.65, clumps));
          }
          // Sunlit crest tops.
          c = mix(c, c * 1.25 + uSunColor * 0.05, smoothstep(uTop * 0.45, uTop, vWorld.y) * 0.5);
          float sunSide = pow(max(dot(dir, uSunDir), 0.0), 4.0);
          vec3 hazeCol = mix(uHaze, uHorizon, 0.3) + uSunColor * 0.15 * sunSide;
          c = mix(c, hazeCol, clamp(uHazeAmt + low * 0.35, 0.0, 1.0));
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -4;
    group.add(mesh);
  }
  return group;
}

/** A sensible default sky set used by the other environment pages. */
export function defaultClouds(): CloudPlacement[] {
  return [
    { azimuth: -0.55, distance: 1500, base: 120, width: 520, height: 420, seed: 11 },
    { azimuth: 0.15, distance: 1800, base: 140, width: 420, height: 300, seed: 23 },
    { azimuth: 0.62, distance: 1400, base: 110, width: 600, height: 520, seed: 37 },
    { azimuth: -1.1, distance: 1700, base: 130, width: 380, height: 260, seed: 41 },
    { azimuth: 1.05, distance: 1900, base: 150, width: 360, height: 220, seed: 53 },
  ];
}

export function defaultHills(): HillLayer[] {
  return [
    { distance: 950, height: 230, roughness: 0.5, color: '#6f93bd', haze: 0.5, seed: 3 },
    { distance: 560, height: 95, roughness: 0.45, color: '#3f7186', haze: 0.32, trees: true, seed: 5 },
    { distance: 300, height: 34, roughness: 0.42, color: '#2f5f3c', haze: 0.16, trees: true, seed: 9 },
  ];
}

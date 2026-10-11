// COPIED from .claude/pages/ad/experiments/hell-src/hell-05-clouds-puffs.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-05 billboard puffs: the cumulus sea (C1), the halo torus of puffs
 * (C3a) and the cloud collar of puffs (C6a).
 *
 * Each puff is one camera-facing quad whose fragment rebuilds a sphere
 * normal and blends it with the whole cluster's normal, so a heap of puffs
 * shades as one form (research B1). Edges use the Edge group (B2/B3). Puffs
 * are grouped into clusters; every frame the owner moves the clusters, and
 * the layer sorts clusters back to front and rewrites the instance buffer
 * (cheap for a few thousand puffs, and it keeps orbiting rings pop-free).
 */

import * as THREE from 'three';
import { BILLBOARD_GLSL, ENV_GLSL, seededRandom, type EnvUniforms } from '../env-src/lab';
import { CLOUD_GLSL, type CloudUniforms } from './hell-05-clouds-glsl';

export type Cluster = {
  /** World anchor, moved by the owner every frame. */
  anchor: THREE.Vector3;
  /** Puffs relative to the anchor: x, y, z, radius, … */
  local: number[];
  /** Point (relative to the anchor) the cluster normal points away from. */
  centre: THREE.Vector3;
  /** Flat-base height relative to the anchor (very negative = no cut). */
  base: number;
  seed: number;
  /** Free data for the owner's motion (start position, ring angle …). */
  data: number[];
  /** Width, used for shadow blobs. */
  width: number;
};

export type PuffLayer = {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  uCel: { value: number };
  clusters: Cluster[];
  set(clusters: Cluster[]): void;
  update(camera: THREE.Vector3): void;
  setCel(on: boolean): void;
};

const VERT = /* glsl */ `
${BILLBOARD_GLSL}
uniform float uLightMode;
uniform vec3 uCircleC;
uniform float uCircleR;
uniform float uPartable;
attribute vec4 aPuff;
attribute vec4 aCloud;
attribute float aSeed;
varying vec2 vUv;
varying vec3 vCentre;
varying vec3 vCloud;
varying float vBase;
varying vec3 vWorld;
varying float vSeed;
varying float vCamFade;
varying float vRadius;
void main() {
  float r = aPuff.w;
  // Deck opening under the magic circle: puffs shrink away near its axis.
  if (uLightMode > 3.5 && uPartable > 0.5) {
    r *= smoothstep(0.55, 1.15, length(aPuff.xz - uCircleC.xz) / uCircleR);
  }
  // Camera fade: puffs never slice the near plane (camera in the cloud layer).
  float dc = length(aPuff.xyz - cameraPosition);
  vCamFade = smoothstep(r * 0.9 + 2.0, r * 2.2 + 14.0, dc);
  if (r < 0.05 || vCamFade < 0.002) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  vUv = position.xy;
  vCentre = aPuff.xyz;
  vCloud = aCloud.xyz;
  vBase = aCloud.w;
  vSeed = aSeed;
  vRadius = r;
  vec3 w = billboard(aPuff.xyz, position.xy, vec2(r * 1.15));
  vWorld = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const FRAG = /* glsl */ `
${ENV_GLSL}
${CLOUD_GLSL}
uniform float uPartable;
uniform float uNormBlend;
varying vec2 vUv;
varying vec3 vCentre;
varying vec3 vCloud;
varying float vBase;
varying vec3 vWorld;
varying float vSeed;
varying float vCamFade;
varying float vRadius;
void main() {
  vec2 uv = vUv * 1.15;
  float r = length(uv);
  if (r > 1.14) discard;
  vec2 en = uv * 2.5 + vSeed * 17.0;
  float eN = vnoise(en) * 0.65 + vnoise(en * 2.3) * 0.35 - 0.5;
  float distCam = length(vWorld - cameraPosition);
  float alpha;
  if (uEdgeMode < 0.5) {
    // Soft airbrush: smoothstep over the outer ~25 %.
    alpha = smoothstep(1.0, 0.72, r + eN * 0.2);
  } else if (uEdgeMode < 1.5) {
    // Frayed: strong erosion plus a fine octave.
    float e = r + eN * 0.38 + (vnoise(uv * 9.0 + vSeed * 3.0) - 0.5) * 0.22;
    alpha = smoothstep(0.98, 0.62, e);
  } else if (uEdgeMode < 2.5) {
    // Crisp: an anti-aliased step (cel tops).
    float e = r + eN * 0.1;
    float fw = fwidth(e) * 1.5;
    alpha = 1.0 - smoothstep(0.9 - fw, 0.9 + fw, e);
  } else if (uEdgeMode < 3.5) {
    // Scalloped: polar bumps on the upper half, soft round base.
    float ang = atan(uv.y, uv.x);
    float rEdge = 0.8 + 0.17 * abs(cos(ang * 3.5 + vSeed * 6.0));
    rEdge = mix(0.9, rEdge, smoothstep(-0.2, 0.3, uv.y));
    float fw = fwidth(r) * 1.5 + 0.02;
    alpha = smoothstep(rEdge + fw, rEdge - fw, r + eN * 0.05);
  } else {
    // Sea of Thieves: soft near, sharp far.
    float ew = mix(0.28, 0.03, smoothstep(220.0, 1100.0, distCam));
    alpha = smoothstep(0.95, 0.95 - ew, r + eN * 0.12);
  }
  // Flat base: everything below the condensation level is cut.
  alpha *= smoothstep(vBase - 1.0, vBase + 5.0, vWorld.y + eN * 5.0);
  alpha *= vCamFade;
  if (uPartable > 0.5) alpha *= partMask(vWorld.xz);
  if (uCel > 0.5) {
    if (alpha < 0.5) discard;
    alpha = 1.0;
  }
  if (alpha < 0.01) discard;

  // Sphere normal of this puff, blended with the cluster's normal.
  float rc = min(r, 1.0);
  float z = sqrt(max(0.0, 1.0 - rc * rc));
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 fwd = normalize(cameraPosition - vCentre);
  vec3 nPuff = normalize(right * uv.x + up * uv.y + fwd * z);
  vec3 nCloud = normalize(vWorld - vCloud + vec3(0.0, 0.001, 0.0));
  vec3 n = normalize(mix(nPuff, nCloud, uNormBlend));
  float lit = dot(n, cloudKey()) * 0.5 + 0.5;
  if (uCel > 0.5 && vBase > -1e4) {
    // Cel heaps: light by height inside the heap (flat bands that run across
    // the whole heap), nudged by each lobe's bulge so the band edges scallop.
    float hN = clamp((vWorld.y - vBase) / max((vCloud.y - vBase) * 2.4, 1.0), 0.0, 1.0);
    lit = 0.2 + 0.75 * hN + 0.22 * dot(nPuff, cloudKey());
  }
  // Thin silhouette of the whole cluster: the silver lining lives there.
  vec3 toCam = normalize(cameraPosition - vWorld);
  float sil = pow(1.0 - max(dot(nCloud, toCam), 0.0), 2.0);
  float thin = sil * smoothstep(0.5, 1.0, r);
  // Shade at the point on the puff's imagined sphere, not on the flat card:
  // projected patterns (glyph print, storm cracks) then wrap round the
  // lobe instead of smearing into vertical stripes.
  vec3 pSurf = vCentre + nPuff * vRadius;
  vec3 c = cloudColour(pSurf, n, lit, r, thin);
  // Cel: a dark ink line on the shaded rim only.
  if (uCel > 0.5) c *= 1.0 - 0.3 * smoothstep(0.86, 0.9, r) * (1.0 - step(0.4, lit));
  c = cloudFog(c, vWorld);
  gl_FragColor = vec4(c, alpha);
}
`;

export function createPuffLayer(
  env: EnvUniforms,
  cu: CloudUniforms,
  options: { maxPuffs: number; partable: boolean; normBlend: number; renderOrder: number; name: string },
): PuffLayer {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const aPuff = new THREE.InstancedBufferAttribute(new Float32Array(options.maxPuffs * 4), 4);
  const aCloud = new THREE.InstancedBufferAttribute(new Float32Array(options.maxPuffs * 4), 4);
  const aSeed = new THREE.InstancedBufferAttribute(new Float32Array(options.maxPuffs), 1);
  for (const a of [aPuff, aCloud, aSeed]) a.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aPuff', aPuff);
  geometry.setAttribute('aCloud', aCloud);
  geometry.setAttribute('aSeed', aSeed);
  geometry.instanceCount = 0;

  const uCel = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...env,
      ...cu,
      uCel,
      uPartable: { value: options.partable ? 1 : 0 },
      // Storm cracks live in the cloud bodies (puffs), not in thin layers.
      uSeams: { value: 1 },
      uNormBlend: { value: options.normBlend },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = options.name;
  mesh.frustumCulled = false;
  mesh.renderOrder = options.renderOrder;

  let clusters: Cluster[] = [];
  const dist: number[] = [];
  const order: number[] = [];
  return {
    mesh,
    material,
    uCel,
    get clusters() {
      return clusters;
    },
    set(next) {
      clusters = next;
    },
    update(cam) {
      // Back to front by cluster; puffs inside a cluster keep their order.
      order.length = 0;
      for (let i = 0; i < clusters.length; i++) {
        dist[i] = clusters[i].anchor.distanceToSquared(cam);
        order.push(i);
      }
      order.sort((a, b) => dist[b] - dist[a]);
      const P = aPuff.array as Float32Array;
      const C = aCloud.array as Float32Array;
      const S = aSeed.array as Float32Array;
      let n = 0;
      for (const index of order) {
        const c = clusters[index];
        const a = c.anchor;
        for (let k = 0; k < c.local.length && n < options.maxPuffs; k += 4) {
          P[n * 4] = a.x + c.local[k];
          P[n * 4 + 1] = a.y + c.local[k + 1];
          P[n * 4 + 2] = a.z + c.local[k + 2];
          P[n * 4 + 3] = c.local[k + 3];
          C[n * 4] = a.x + c.centre.x;
          C[n * 4 + 1] = a.y + c.centre.y;
          C[n * 4 + 2] = a.z + c.centre.z;
          C[n * 4 + 3] = a.y + c.base;
          S[n] = c.seed + k * 0.0371;
          n++;
        }
      }
      geometry.instanceCount = n;
      aPuff.needsUpdate = true;
      aCloud.needsUpdate = true;
      aSeed.needsUpdate = true;
    },
    setCel(on) {
      uCel.value = on ? 1 : 0;
      // Cel bands follow the whole heap (one form), not each bubble.
      material.uniforms.uNormBlend.value = on ? Math.max(options.normBlend, 0.88) : options.normBlend;
      // Cel puffs are opaque cut-outs: depth-written, no sorting problems.
      material.transparent = !on;
      material.depthWrite = on;
      material.needsUpdate = true;
    },
  };
}

// ── cluster builders ─────────────────────────────────────────────────────

/** Deck extent the sea wraps around in (x), and its depth range (z). */
export const SEA_X = 1300;

/**
 * Cumulus sea: flat-bottomed heaps (base row → shrinking domes → buds),
 * scattered on a jittered grid. Count sets coverage: sparse = Eva's lone
 * puffs over the plain, dense = a continuous deck.
 */
export function makeSeaClusters(count: string, camera: THREE.Vector3): Cluster[] {
  const n = count === 'sparse' ? 34 : count === 'dense' ? 120 : 66;
  const sizeK = count === 'sparse' ? 0.36 : count === 'dense' ? 1.0 : 0.62;
  const rnd = seededRandom(5051 + n);
  const zMin = -1300;
  const zMax = 100; // heaps closer than ~370 u to the camera only cost fill rate and read as balls
  const area = (2 * SEA_X) * (zMax - zMin);
  const spacing = Math.sqrt(area / n);
  const cols = Math.ceil((2 * SEA_X) / spacing);
  const rows = Math.ceil((zMax - zMin) / spacing);
  const clusters: Cluster[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = -SEA_X + (col + 0.15 + rnd() * 0.7) * spacing;
      const z = zMin + (row + 0.15 + rnd() * 0.7) * spacing;
      if (Math.hypot(x, z) < 45) continue;
      const d = Math.hypot(x - camera.x, z - camera.z);
      const width = spacing * sizeK * (0.7 + rnd() * 0.6) * (0.85 + d / 2600);
      const base = 17 + rnd() * 6;
      clusters.push(buildHeap(new THREE.Vector3(x, base, z), width, Math.min(width * (0.14 + rnd() * 0.08), 15 + rnd() * 9), Math.floor(rnd() * 1e6)));
    }
  }
  return clusters;
}

function buildHeap(anchor: THREE.Vector3, width: number, height: number, seed: number): Cluster {
  const rnd = seededRandom(seed);
  type P = { x: number; y: number; z: number; r: number };
  const own: P[] = [];
  // Flat, wide sea heaps: a footprint of small base puffs (an ellipse),
  // a ridge of bigger domes along the middle, buds on top. Puff size is
  // tied to the HEIGHT, so wide clouds stay low (the deck is below the eye).
  const rBase = Math.max(height * 0.6, width * 0.075);
  const across = Math.max(3, Math.round(width / (rBase * 1.3)));
  const deep = Math.max(1, Math.round((width * 0.45) / (rBase * 1.5)));
  for (let i = 0; i < across; i++) {
    for (let j = 0; j < deep; j++) {
      const u = (i / Math.max(across - 1, 1) - 0.5) * width + (rnd() - 0.5) * rBase * 0.6;
      const v = (deep === 1 ? 0 : j / (deep - 1) - 0.5) * width * 0.45 + (rnd() - 0.5) * rBase * 0.6;
      const e = (u / (width * 0.5)) ** 2 + (v / (width * 0.23)) ** 2;
      if (e > 1.15) continue;
      const r = rBase * (0.8 + rnd() * 0.4) * (1 - 0.3 * Math.min(e, 1));
      own.push({ x: u, y: r * 0.45, z: v, r });
    }
  }
  // Domes along a gently wandering ridge, tallest near the middle.
  const domes = Math.max(2, Math.round(across * 0.55));
  let ridgeZ = (rnd() - 0.5) * width * 0.1;
  for (let i = 0; i < domes; i++) {
    const u = (i / Math.max(domes - 1, 1) - 0.5) * width * 0.7 + (rnd() - 0.5) * rBase;
    const mid = 1 - Math.abs(u / (width * 0.35));
    const r = rBase * (0.9 + rnd() * 0.45) * (0.65 + 0.45 * Math.max(mid, 0));
    own.push({ x: u, y: rBase * 0.6 + r * 0.5 * Math.max(mid, 0.2), z: ridgeZ, r });
    ridgeZ += (rnd() - 0.5) * rBase * 0.6;
  }
  // Buds on upper surfaces: the cauliflower.
  const parents = own.slice();
  for (const parent of parents) {
    const buds = parent.y > rBase * 0.7 ? 2 + Math.floor(rnd() * 2) : Math.floor(rnd() * 1.6);
    for (let i = 0; i < buds; i++) {
      const theta = rnd() * Math.PI * 2;
      const phi = rnd() * 1.1;
      own.push({
        x: parent.x + Math.sin(phi) * Math.cos(theta) * parent.r * 0.7,
        y: parent.y + Math.cos(phi) * parent.r * 0.7,
        z: parent.z + Math.sin(phi) * Math.sin(theta) * parent.r * 0.7,
        r: parent.r * (0.42 + rnd() * 0.18),
      });
    }
  }
  // Keep the deck low: no puff may rise above ~1.2 × the heap height.
  for (const p of own) {
    const lid = height * 1.2 - p.r * 0.8;
    if (p.y > lid) p.y = Math.max(lid, p.r * 0.3);
  }
  // Far puffs first (the camera looks toward −z).
  own.sort((a, b) => a.z - b.z);
  const centre = new THREE.Vector3();
  for (const p of own) centre.add(new THREE.Vector3(p.x, p.y, p.z));
  centre.divideScalar(own.length);
  const local: number[] = [];
  for (const p of own) local.push(p.x, p.y, p.z, p.r);
  return { anchor: anchor.clone(), local, centre, base: 0, seed: (seed % 997) / 997, data: [anchor.x, anchor.z], width };
}

export type Ring = { y: number; radius: number; ex: number; ez: number; tilt: number; speed: number };

/** Eva C0812B: four stacked rings (funnel, widest on top) + one lower ring. */
export const HALO_RINGS: Ring[] = [
  { y: 272, radius: 122, ex: 8, ez: -4, tilt: 0.04, speed: 1.0 },
  { y: 250, radius: 100, ex: -6, ez: 5, tilt: -0.05, speed: 1.12 },
  { y: 229, radius: 80, ex: 5, ez: 6, tilt: 0.06, speed: 0.92 },
  { y: 210, radius: 62, ex: -3, ez: -5, tilt: -0.04, speed: 1.25 },
  { y: 168, radius: 44, ex: 2, ez: 2, tilt: 0.03, speed: 0.85 },
];

/**
 * Torus of soft puffs: one-puff clusters on each ring (sorted per frame).
 * Puffs overlap heavily (spacing ~ half a puff) in two loose lanes, so a
 * ring reads as one soft tube rather than a string of beads.
 */
export function makeHaloClusters(): Cluster[] {
  const rnd = seededRandom(7211);
  const out: Cluster[] = [];
  HALO_RINGS.forEach((ring, k) => {
    const count = Math.round(ring.radius * 0.95);
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2 + rnd() * 0.04;
      const dr = (rnd() - 0.4) * ring.radius * 0.16; // more puffs on the outside
      const dy = (rnd() - 0.5) * ring.radius * 0.06;
      const r = (ring.radius * 0.11 + 5) * (0.75 + rnd() * 0.45) * (dr > 0 ? 1 : 0.85);
      out.push({ anchor: new THREE.Vector3(), local: [0, 0, 0, r], centre: new THREE.Vector3(), base: -1e5, seed: rnd(), data: [k, theta, dr, dy], width: r });
    }
  });
  return out;
}

/** Place halo/collar clusters for the cloud time ct (one turn per period). */
export function placeHalo(clusters: Cluster[], ct: number, period: number) {
  for (const c of clusters) {
    const ring = HALO_RINGS[c.data[0]];
    const theta = c.data[1] + (ct / period) * Math.PI * 2 * ring.speed;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const radius = ring.radius + c.data[2];
    c.anchor.set(ring.ex + cos * radius, ring.y + c.data[3] + sin * ring.radius * ring.tilt, ring.ez + sin * radius);
    // Normal points away from the ring's core line: a torus.
    c.centre.set(-cos * c.data[2], -c.data[3], -sin * c.data[2]);
  }
}

/**
 * Collar of puffs: a lumpy torus hugging the upper pillar (Re:Zero ep 73).
 * Puffs fill a squashed ring (major radius ~40, half-height ~16) and are
 * biggest on the outside; each puff's normal points away from the ring's
 * core line, so the collar shades as one fat tube with a lit top.
 */
export const COLLAR = { y: 128, major: 40, minor: 24, squash: 0.62 };
export function makeCollarClusters(): Cluster[] {
  const rnd = seededRandom(9133);
  const out: Cluster[] = [];
  for (let i = 0; i < 210; i++) {
    const theta = rnd() * Math.PI * 2;
    // A point inside the tube's cross-section, pushed toward its skin.
    const phi = rnd() * Math.PI * 2;
    const rr = COLLAR.minor * Math.sqrt(0.35 + 0.65 * rnd());
    const radial = COLLAR.major + Math.cos(phi) * rr;
    const dy = Math.sin(phi) * rr * COLLAR.squash;
    if (radial < 15) continue; // never inside the shaft
    const outside = Math.cos(phi) * 0.5 + 0.5;
    const r = (8 + rnd() * 7) * (0.8 + 0.5 * outside);
    out.push({ anchor: new THREE.Vector3(), local: [0, 0, 0, r], centre: new THREE.Vector3(), base: -1e5, seed: rnd(), data: [theta, radial, dy], width: r });
  }
  return out;
}

export function placeCollar(clusters: Cluster[], ct: number) {
  for (const c of clusters) {
    const theta = c.data[0] + ct * 0.018;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    c.anchor.set(cos * c.data[1], COLLAR.y + c.data[2], sin * c.data[1]);
    // Normal centre = the nearest point on the tube's core circle.
    c.centre.set(cos * COLLAR.major - c.anchor.x, COLLAR.y - c.anchor.y, sin * COLLAR.major - c.anchor.z);
  }
}

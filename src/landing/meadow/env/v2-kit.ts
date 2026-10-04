// COPIED from .claude/pages/ad/experiments/env-src/v2-kit.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * Shared set for the v2 water / bridge / petal experiments: the env-03 river
 * channel (river.ts) with banks, a snapshot of the meadow grass, stand-in
 * tree masses (green broadleaf + cherry) so reflections have something to
 * reflect, two lights ("bright day", refs 1–2; "misty backlit", ref 3) and
 * the camera views. Everything procedural.
 */

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { applyPalette, ENV_GLSL, seededRandom, type EnvUniforms, type Lab, type Palette } from './lab';
import { createCumulus, createHills, createSkyDome, defaultClouds, type CloudPlacement, type HillLayer } from './sky';
import { createMeadow } from './rw-meadow';
import { MIST_GLSL } from './v2-glsl';
import { RIVER, riverCentre, riverHeight } from './river';

export { RIVER, riverCentre, riverHeight };

/** The bank's waterline: |x − centre| where riverHeight() = waterY. */
export const SHORE = 6.88;

/** Env uniforms + the v2 extras (mist). Spread into every v2 material. */
export type Env2 = EnvUniforms & { uMist: { value: number }; uMistY: { value: number }; uCherry: { value: number } };

export function makeEnv2(env: EnvUniforms): Env2 {
  return Object.assign(env, { uMist: { value: 0 }, uMistY: { value: RIVER.waterY }, uCherry: { value: 0 } });
}

export const BRIDGE_Z = -14;

// ── views ───────────────────────────────────────────────────────────────

export type ViewId = 'bank' | 'along' | 'bridge34' | 'railing';
export type View = { eye: THREE.Vector3; look: THREE.Vector3; fov: number };

export function viewFor(id: ViewId): View {
  switch (id) {
    case 'bank': {
      // Ref 2: on the right bank, the river running away to the left.
      const ez = 10;
      return { eye: new THREE.Vector3(riverCentre(ez) + 9.2, 1.7, ez), look: new THREE.Vector3(riverCentre(-45) - 3.5, -1.2, -45), fov: 44 };
    }
    case 'along': {
      // Ref 3: low over the water, looking down the river at the bridge.
      const ez = 7;
      return { eye: new THREE.Vector3(riverCentre(ez) + 0.4, RIVER.waterY + 1.3, ez), look: new THREE.Vector3(riverCentre(BRIDGE_Z) + 0.3, 1.55, BRIDGE_Z), fov: 46 };
    }
    case 'bridge34': {
      // Three-quarter view of the bridge from the right bank, downstream.
      const ez = 3;
      return { eye: new THREE.Vector3(riverCentre(ez) + 7.5, 1.0, ez), look: new THREE.Vector3(riverCentre(BRIDGE_Z) - 1.0, 1.3, BRIDGE_Z), fov: 42 };
    }
    case 'railing': {
      // Close on the railing and a capped post.
      const ez = BRIDGE_Z + 5.5;
      return { eye: new THREE.Vector3(riverCentre(ez) + 6.0, 2.2, ez), look: new THREE.Vector3(riverCentre(BRIDGE_Z) + 5.4, 1.6, BRIDGE_Z), fov: 40 };
    }
  }
}

// ── lights ──────────────────────────────────────────────────────────────

export type LightId = 'bright' | 'misty';

const BRIGHT: Palette = {
  sunDir: new THREE.Vector3(0, 1, 0),
  sun: '#fff3dc',
  zenith: '#1a52c4',
  horizon: '#a6dcf2',
  haze: '#d9f0f7',
  ambient: '#8fb0d8',
};
const MISTY: Palette = {
  sunDir: new THREE.Vector3(0, 1, 0),
  sun: '#ffdcae',
  zenith: '#7e9cc6',
  horizon: '#f0dccd',
  haze: '#f0ddd2',
  ambient: '#a99cc8',
};

/** Sun direction from a view: `az` radians left (+) of the view heading, `el` elevation. */
export function sunFromView(view: View, az: number, el: number): THREE.Vector3 {
  const heading = Math.atan2(view.look.x - view.eye.x, -(view.look.z - view.eye.z));
  const a = heading - az;
  return new THREE.Vector3(Math.sin(a) * Math.cos(el), Math.sin(el), -Math.cos(a) * Math.cos(el));
}

export function sunFor(light: LightId, view: ViewId): THREE.Vector3 {
  const v = viewFor(view);
  if (light === 'misty') return sunFromView(v, view === 'bank' ? 0.25 : 0.12, 0.4);
  // Bright: high afternoon sun off to the left and in front, so its
  // reflection patch lands on the water in frame.
  if (view === 'bank') return sunFromView(v, 0.12, 0.42);
  if (view === 'along') return sunFromView(v, 0.3, 0.46);
  return sunFromView(v, 0.55, 0.5);
}

// ── stand-in trees ──────────────────────────────────────────────────────

export type TreeSpec = { x: number; z: number; kind: 'green' | 'cherry'; size: number; seed: number };

function hash3(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  let r = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
    const w = (dx ? ux : 1 - ux) * (dy ? uy : 1 - uy) * (dz ? uz : 1 - uz);
    r += w * hash3(ix + dx, iy + dy, iz + dz);
  }
  return r;
}

/**
 * Stand-in trees: a tapered trunk with a few limbs and a crown of noisy
 * blobs, shaded as ONE painted mass (normals spherised toward the blob and
 * the crown, a leafy noise in the terminator, sky fill, warm rim when
 * backlit). Green broadleaf, or cherry blossom when `uCherry` is up.
 */
export function createStandInTrees(env: Env2, specs: TreeSpec[], heightAt: (x: number, z: number) => number): THREE.Group {
  const group = new THREE.Group();
  const crowns: THREE.BufferGeometry[] = [];
  const trunks: THREE.BufferGeometry[] = [];
  for (const spec of specs) {
    const rnd = seededRandom(spec.seed);
    const y0 = heightAt(spec.x, spec.z) - 0.2;
    const cherry = spec.kind === 'cherry';
    const s = spec.size;
    const trunkH = (cherry ? 2.6 : 3.4) * s;
    const crownC = new THREE.Vector3(spec.x, y0 + trunkH + (cherry ? 1.2 : 2.4) * s, spec.z);
    const crownR = new THREE.Vector3((cherry ? 5.2 : 4.0) * s, (cherry ? 2.4 : 3.4) * s, (cherry ? 4.6 : 3.8) * s);
    // Trunk + limbs.
    const trunk = new THREE.CylinderGeometry(0.22 * s, 0.42 * s, trunkH + 0.4, 9, 4);
    trunk.translate(spec.x, y0 + trunkH / 2, spec.z);
    trunks.push(trunk);
    const limbs = cherry ? 4 : 3;
    for (let i = 0; i < limbs; i++) {
      const a = (i / limbs) * Math.PI * 2 + rnd() * 0.8;
      const tip = crownC.clone().add(new THREE.Vector3(Math.cos(a) * crownR.x * 0.55, (rnd() - 0.2) * crownR.y * 0.5, Math.sin(a) * crownR.z * 0.55));
      const base = new THREE.Vector3(spec.x, y0 + trunkH * (0.75 + rnd() * 0.2), spec.z);
      const len = tip.distanceTo(base);
      const limb = new THREE.CylinderGeometry(0.07 * s, 0.17 * s, len, 6, 1);
      limb.translate(0, len / 2, 0);
      limb.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip.clone().sub(base).normalize()));
      limb.translate(base.x, base.y, base.z);
      trunks.push(limb);
    }
    // Crown blobs.
    const blobs = cherry ? 16 : 13;
    for (let i = 0; i < blobs; i++) {
      // Bias outward so the crown reads as a shell of clumps.
      const u = rnd() * Math.PI * 2;
      const v = Math.acos(1 - 2 * Math.pow(rnd(), cherry ? 0.7 : 0.9));
      const rr = 0.55 + 0.4 * rnd();
      const dir = new THREE.Vector3(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u));
      const c = crownC.clone().add(new THREE.Vector3(dir.x * crownR.x, dir.y * crownR.y, dir.z * crownR.z).multiplyScalar(rr));
      if (cherry && c.y < crownC.y - crownR.y * 0.2) c.y = crownC.y - crownR.y * 0.2 - rnd() * 0.6 * s;
      const r = (cherry ? 1.9 : 1.8) * s * (0.75 + rnd() * 0.5);
      const ico = new THREE.IcosahedronGeometry(r, 3);
      ico.deleteAttribute('normal');
      ico.deleteAttribute('uv');
      // Shared vertices, so the displaced blob gets SMOOTH normals.
      const g = mergeVertices(ico);
      const p = g.attributes.position;
      const seed = rnd() * 50;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        const n = new THREE.Vector3(x, y, z).normalize();
        const d =
          (noise3(n.x * 1.6 + seed, n.y * 1.6, n.z * 1.6) - 0.5) * 0.45 +
          (noise3(n.x * 5 + seed, n.y * 5, n.z * 5) - 0.5) * 0.35 +
          (noise3(n.x * 11 + seed, n.y * 11, n.z * 11) - 0.5) * 0.2;
        const k2 = 1 + d * 0.55;
        p.setXYZ(k, x * k2, y * k2 * 0.85, z * k2);
      }
      g.translate(c.x, c.y, c.z);
      g.computeVertexNormals();
      const nv = p.count;
      const blob = new Float32Array(nv * 4);
      const crown = new Float32Array(nv * 4);
      for (let k = 0; k < nv; k++) {
        blob.set([c.x, c.y, c.z, cherry ? 1 : 0], k * 4);
        crown.set([crownC.x, crownC.y, crownC.z, crownR.x], k * 4);
      }
      g.setAttribute('aBlob', new THREE.BufferAttribute(blob, 4));
      g.setAttribute('aCrown', new THREE.BufferAttribute(crown, 4));
      crowns.push(g);
    }
  }
  const crownGeo = mergeGeometries(crowns);
  const trunkGeo = mergeGeometries(trunks.map((g) => {
    g.deleteAttribute('uv');
    return g;
  }));
  const crownMat = new THREE.ShaderMaterial({
    uniforms: { ...env },
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      attribute vec4 aBlob;
      attribute vec4 aCrown;
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec4 vBlob;
      varying vec4 vCrown;
      void main() {
        vec3 p = position;
        // Slow sway of the crown, more at the top.
        float lift = clamp((p.y - aCrown.y + aCrown.w) / (2.0 * aCrown.w), 0.0, 1.0);
        float sw = sin(uTime * 0.9 + aCrown.x * 0.3) * 0.06 + sin(uTime * 2.1 + aBlob.x) * 0.025;
        p.xz += uWindDir * sw * lift * uBreeze;
        vWorld = p;
        vN = normal;
        vBlob = aBlob;
        vCrown = aCrown;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${MIST_GLSL}
      uniform float uCherry;
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec4 vBlob;
      varying vec4 vCrown;
      vec3 hash33(vec3 p) {
        p = fract(p * vec3(0.1031, 0.1030, 0.0973));
        p += dot(p, p.yxz + 33.33);
        return fract((p.xxy + p.yxx) * p.zyx);
      }
      void worley(vec3 p, out vec3 f1, out float d1, out float d2) {
        vec3 i = floor(p);
        d1 = 8.0;
        d2 = 8.0;
        f1 = i;
        for (int x = -1; x <= 1; x++)
        for (int y = -1; y <= 1; y++)
        for (int z = -1; z <= 1; z++) {
          vec3 c = i + vec3(float(x), float(y), float(z));
          vec3 fp = c + hash33(c) * 0.8 + 0.1;
          float d = length(p - fp);
          if (d < d1) { d2 = d1; d1 = d; f1 = fp; } else if (d < d2) { d2 = d; }
        }
      }
      void main() {
        if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec3 nB = normalize(vWorld - vBlob.xyz);
        vec3 nC = normalize((vWorld - vCrown.xyz) * vec3(1.0, 1.5, 1.0));
        vec3 V = normalize(cameraPosition - vWorld);
        float cherry = vBlob.w * uCherry;
        // Leaf clumps: a 3-D Worley cell per clump; each clump is lit as its
        // own little dome (the scalloped anime tree), seams between clumps
        // fall into shade.
        float cell = mix(0.85, 0.6, vBlob.w) * clamp(vCrown.w / 4.5, 0.8, 1.6);
        vec3 q = vWorld / cell;
        // Warp the cells so clumps are rounded and uneven, not tiles.
        q += (vec3(vnoise(q.xy * 1.3 + 2.0), vnoise(q.yz * 1.3 + 5.0), vnoise(q.zx * 1.3 + 9.0)) - 0.5) * 0.9;
        vec3 F;
        float d1;
        float d2;
        worley(q, F, d1, d2);
        vec3 nK = normalize(q - F);
        vec3 n = normalize(nK * 0.32 + normalize(mix(nB, nC, 0.6)) * 0.6 + normalize(vN) * 0.15);
        float l = dot(n, uSunDir) * 0.5 + 0.5;
        float lit = smoothstep(0.5, 0.58, l);
        float hi = smoothstep(0.76, 0.82, l);
        vec3 shade = mix(srgb(vec3(0.06, 0.24, 0.24)), srgb(vec3(0.80, 0.63, 0.72)), cherry);
        vec3 mid = mix(srgb(vec3(0.24, 0.50, 0.18)), srgb(vec3(0.98, 0.81, 0.86)), cherry);
        vec3 hiC = mix(srgb(vec3(0.66, 0.85, 0.27)), srgb(vec3(1.0, 0.95, 0.96)), cherry);
        vec3 sunT = uSunColor / max(max(uSunColor.r, uSunColor.g), uSunColor.b);
        // Blossom stays pink-white under a warm sun (no salmon cast).
        sunT = mix(sunT, vec3(1.0), cherry * 0.6);
        vec3 c = mix(shade * (0.55 + uAmbient * 0.6), mid * sunT, lit);
        c = mix(c, hiC * sunT, hi * 0.85);
        // Sky-blue fill on upward clumps in shade; seams and the crown core darker.
        c += uZenith * 0.06 * max(n.y, 0.0) * (1.0 - lit);
        c *= mix(0.7, 1.0, smoothstep(-0.6, 0.2, nC.y));
        // Backlit rim: the sun pierces the crown's edge.
        float rim = pow(1.0 - max(dot(normalize(mix(nB, nC, 0.5)), V), 0.0), 3.0);
        float back = pow(max(dot(-V, uSunDir), 0.0), 2.0);
        vec3 rimC = mix(srgb(vec3(0.85, 1.0, 0.45)), srgb(vec3(1.0, 0.88, 0.92)), cherry);
        c += rimC * uSunColor * rim * (0.08 + 0.9 * back);
        c = mistFade(c, vWorld);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const trunkMat = new THREE.ShaderMaterial({
    uniforms: { ...env },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vWorld = position;
        vN = normal;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${MIST_GLSL}
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec3 n = normalize(vN);
        float l = smoothstep(0.35, 0.65, dot(n, uSunDir) * 0.5 + 0.5);
        float bark = vnoise(vec2(atan(n.z, n.x) * 6.0, vWorld.y * 1.5));
        vec3 base = srgb(vec3(0.24, 0.17, 0.13)) * (0.8 + 0.35 * bark);
        vec3 c = mix(base * (0.35 + uAmbient * 0.35), base * uSunColor * 1.3, l);
        c = mistFade(c, vWorld);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const crownMesh = new THREE.Mesh(crownGeo, crownMat);
  crownMesh.name = 'crowns';
  const trunkMesh = new THREE.Mesh(trunkGeo, trunkMat);
  trunkMesh.name = 'trunks';
  group.add(trunkMesh, crownMesh);
  return group;
}

/** Trees along both banks; cherries frame the bridge. */
export function defaultTrees(): TreeSpec[] {
  const L = (z: number, off: number) => riverCentre(z) - off;
  const R = (z: number, off: number) => riverCentre(z) + off;
  return [
    // Left bank.
    { x: L(4, 13), z: 4, kind: 'cherry', size: 1.15, seed: 1 },
    { x: L(-12, 15), z: -12, kind: 'green', size: 1.2, seed: 2 },
    { x: L(-26, 12.5), z: -26, kind: 'cherry', size: 1.0, seed: 3 },
    { x: L(-44, 16), z: -44, kind: 'green', size: 1.3, seed: 4 },
    { x: L(-64, 13), z: -64, kind: 'cherry', size: 1.1, seed: 5 },
    { x: L(-95, 18), z: -95, kind: 'green', size: 1.5, seed: 6 },
    // Right bank.
    { x: R(-4, 14), z: -4, kind: 'cherry', size: 1.1, seed: 7 },
    { x: R(-24, 13.5), z: -24, kind: 'green', size: 1.25, seed: 8 },
    { x: R(-36, 12.5), z: -36, kind: 'cherry', size: 1.0, seed: 9 },
    { x: R(-58, 17), z: -58, kind: 'green', size: 1.4, seed: 10 },
    { x: R(-85, 14), z: -85, kind: 'cherry', size: 1.2, seed: 11 },
    // Distant groves.
    { x: L(-130, 10), z: -130, kind: 'green', size: 1.8, seed: 12 },
    { x: R(-140, 12), z: -140, kind: 'green', size: 1.9, seed: 13 },
    { x: L(-170, 26), z: -170, kind: 'cherry', size: 1.8, seed: 14 },
    { x: R(-190, 24), z: -190, kind: 'green', size: 2.0, seed: 15 },
  ];
}

// ── the set ─────────────────────────────────────────────────────────────

export type SetOptions = { grass?: number; trees?: TreeSpec[]; clouds?: CloudPlacement[]; hills?: HillLayer[] };

export type RiverSet = {
  env: Env2;
  heightAt: (x: number, z: number) => number;
  trees: THREE.Group;
  meadow: THREE.Group;
  dome: ReturnType<typeof createSkyDome>;
  setLight(light: LightId, view: ViewId): void;
  setView(view: ViewId): void;
  /** Call right after lab.start(): applies a view chosen before the camera API existed. */
  afterStart(): void;
};

export function heightAt(x: number, z: number): number {
  const d = Math.abs(x - riverCentre(z));
  // Gentle swells away from the channel (the banks stay as river.ts carves them).
  const away = THREE.MathUtils.smoothstep(d, 10, 22);
  return riverHeight(x, z) + away * (0.5 * Math.sin(x * 0.07 + 1.3) * Math.sin(z * 0.05) + 0.4);
}

export function createRiverSet(lab: Lab, options: SetOptions = {}): RiverSet {
  const env = makeEnv2(lab.env);
  lab.camera.layers.enable(1);
  const dome = createSkyDome(env);
  dome.mesh.name = 'sky';
  const clouds = createCumulus(env, options.clouds ?? defaultClouds(), new THREE.Vector3(0, 2, 10));
  clouds.mesh.name = 'clouds';
  const hills = createHills(
    env,
    options.hills ?? [
      { distance: 950, height: 210, roughness: 0.5, color: '#6f93bd', haze: 0.5, seed: 3 },
      { distance: 560, height: 85, roughness: 0.45, color: '#3f7186', haze: 0.32, trees: true, seed: 5 },
      { distance: 300, height: 26, roughness: 0.42, color: '#2f5f3c', haze: 0.16, trees: true, seed: 9 },
    ],
  );
  hills.name = 'hills';
  lab.scene.add(dome.mesh, clouds.mesh, hills);

  // Ground: a fine grid round the river, a coarse ring beyond.
  const nearGround = new THREE.PlaneGeometry(160, 300, 240, 450);
  nearGround.rotateX(-Math.PI / 2);
  nearGround.translate(0, 0, -110);
  const ring = new THREE.Shape([
    new THREE.Vector2(-1500, -1500),
    new THREE.Vector2(1500, -1500),
    new THREE.Vector2(1500, 1500),
    new THREE.Vector2(-1500, 1500),
  ]);
  ring.holes.push(new THREE.Path([new THREE.Vector2(-80, -40), new THREE.Vector2(-80, 260), new THREE.Vector2(80, 260), new THREE.Vector2(80, -40)]));
  const farGround = new THREE.ShapeGeometry(ring);
  farGround.rotateX(-Math.PI / 2);

  // Grass roots: dense near both viewpoints, sparser further out; never in the water.
  const eyes = [viewFor('bank').eye, viewFor('along').eye, viewFor('bridge34').eye];
  const place = (rnd: () => number): [number, number] | null => {
    let x: number;
    let z: number;
    const pick = rnd();
    if (pick < 0.7) {
      const e = eyes[Math.floor(rnd() * eyes.length)];
      const r = 0.8 * Math.pow(70 / 0.8, rnd());
      const a = rnd() * Math.PI * 2;
      x = e.x + Math.sin(a) * r;
      z = e.z - Math.abs(Math.cos(a)) * r * (rnd() < 0.85 ? 1 : -0.2);
    } else {
      z = 18 - rnd() * 110;
      x = riverCentre(z) + (rnd() * 2 - 1) * 40;
    }
    if (Math.abs(x - riverCentre(z)) < SHORE + 0.15) return null;
    return [x, z];
  };
  const meadow = createMeadow(env, {
    count: Number(new URLSearchParams(location.search).get('grass') ?? options.grass ?? 140_000),
    seed: 21,
    place,
    heightAt,
    bladeHeight: [0.22, 0.55],
    ground: { geometries: [nearGround, farGround] },
    flowers: 420,
  });
  meadow.group.name = 'meadow';
  lab.scene.add(meadow.group);

  const trees = createStandInTrees(env, options.trees ?? defaultTrees(), heightAt);
  trees.name = 'trees';
  lab.scene.add(trees);

  const bloom = lab.composer.passes.find((p) => p instanceof UnrealBloomPass) as UnrealBloomPass | undefined;

  let pendingView: ViewId | null = null;
  const setView = (view: ViewId) => {
    if (!window.__env) {
      pendingView = view;
      return;
    }
    const v = viewFor(view);
    lab.camera.fov = v.fov;
    lab.camera.updateProjectionMatrix();
    window.__env?.setCamera(v.eye.toArray() as [number, number, number], v.look.toArray() as [number, number, number]);
  };

  return {
    env,
    heightAt,
    trees,
    meadow: meadow.group,
    dome,
    setView,
    afterStart() {
      if (pendingView) setView(pendingView);
      pendingView = null;
    },
    setLight(light, view) {
      const palette = light === 'misty' ? MISTY : BRIGHT;
      applyPalette(env, { ...palette, sunDir: sunFor(light, view) });
      env.uMist.value = light === 'misty' ? 1 : 0;
      env.uCherry.value = light === 'misty' ? 1 : 0;
      env.uCloudShadow.value = light === 'misty' ? 0 : 0.6;
      dome.uCover.value = light === 'misty' ? 0.72 : 0.6;
      clouds.mesh.visible = light !== 'misty';
      lab.renderer.toneMappingExposure = light === 'misty' ? 1.02 : 1.0;
      if (bloom) {
        bloom.strength = light === 'misty' ? 0.45 : 0.45;
        bloom.radius = light === 'misty' ? 0.75 : 0.5;
        bloom.threshold = light === 'misty' ? 0.9 : 0.95;
      }
    },
  };
}

/** The "Judge:" line, styled the same on every page. */
export function judge(text: string): string {
  return `<br><b>Judge:</b> ${text}`;
}

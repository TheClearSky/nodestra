// COPIED from .claude/pages/ad/experiments/env-src/meadow.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * The meadow: GPU-instanced grass blades bent by the shared breeze (gusts
 * roll across as visible waves), a ground plane painted to match the grass
 * top colour at distance, flower heads riding the same wind, and pollen
 * motes that only glow where the sun reaches them.
 *
 * `lightGLSL` lets a page supply `float sunVis(vec3 p)` — the canopy page
 * plugs its komorebi dapple in there, so blades, ground and motes all share
 * the same pattern of light.
 */

import * as THREE from 'three';
import { ENV_GLSL, seededRandom, type EnvUniforms } from './lab';

export const DEFAULT_LIGHT_GLSL = /* glsl */ `float sunVis(vec3 p) { return cloudShadow(p); }`;

/** Big painterly colour patches shared by blades and ground (0…1). */
const MEADOW_GLSL = /* glsl */ `
uniform float uStyle;
vec3 meadowTint(vec2 xz) {
  float n = fbm3(xz * 0.035 + 4.0);
  float m = fbm3(xz * 0.11 + 9.0);
  vec3 warm = srgb(vec3(0.62, 0.76, 0.26));
  vec3 cool = srgb(vec3(0.24, 0.52, 0.30));
  vec3 c = mix(cool, warm, smoothstep(0.35, 0.7, n));
  return c * (0.88 + 0.24 * m);
}
`;

/** Grass palette per style: root, mid, tip, shade tint, translucency gain. */
const PALETTE_GLSL = /* glsl */ `
void grassPalette(out vec3 root, out vec3 shadeTint, out float transGain, out float sheenGain) {
  if (uStyle < 0.5) {            // soft painted (Ghibli)
    root = srgb(vec3(0.07, 0.17, 0.10));
    shadeTint = srgb(vec3(0.50, 0.62, 0.82));
    transGain = 1.0; sheenGain = 0.8;
  } else if (uStyle < 1.5) {     // cel bands (toon)
    root = srgb(vec3(0.12, 0.28, 0.16));
    shadeTint = srgb(vec3(0.50, 0.64, 0.84));
    transGain = 0.8; sheenGain = 0.35;
  } else {                       // Shinkai: saturated, cyan shade, hot rims
    root = srgb(vec3(0.02, 0.13, 0.13));
    shadeTint = srgb(vec3(0.40, 0.62, 0.86));
    transGain = 1.25; sheenGain = 0.6;
  }
}
`;

/** Cheap 2-D hash → 0…1 (CPU side, for clump layout). */
function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export type MeadowOptions = {
  count: number;
  seed: number;
  /** Rejection sampler for blade roots: return [x, z] or null. */
  place: (rnd: () => number) => [number, number] | null;
  heightAt?: (x: number, z: number) => number;
  lightGLSL?: string;
  bladeHeight?: [number, number];
  /** Ground: a square plane, or ready-made flat geometries (y is set from heightAt). */
  ground?: { size: number; centre: [number, number]; segments?: number } | { geometries: THREE.BufferGeometry[] };
  flowers?: number;
  motes?: { count: number; centre: THREE.Vector3; size: THREE.Vector3 };
};

export type Meadow = {
  group: THREE.Group;
  uStyle: { value: number };
  setCount(n: number): void;
  maxCount: number;
};

export function createMeadow(env: EnvUniforms, options: MeadowOptions): Meadow {
  const group = new THREE.Group();
  const heightAt = options.heightAt ?? (() => 0);
  const light = options.lightGLSL ?? DEFAULT_LIGHT_GLSL;
  const uStyle = { value: 0 };
  const rnd = seededRandom(options.seed);

  // ── blades ──
  const SEGMENTS = 6;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const t = i / SEGMENTS;
    positions.push(-1, t, 0, 1, t, 0);
  }
  positions.push(0, 1, 0);
  for (let i = 0; i < SEGMENTS - 1; i++) {
    const k = i * 2;
    indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  const tipBase = (SEGMENTS - 1) * 2;
  indices.push(tipBase, tipBase + 1, SEGMENTS * 2);

  const max = options.count;
  const roots = new Float32Array(max * 3);
  const shapes = new Float32Array(max * 4);
  const [hMin, hMax] = options.bladeHeight ?? [0.35, 0.85];
  let placed = 0;
  let guard = 0;
  while (placed < max && guard < max * 30) {
    guard++;
    const spot = options.place(rnd);
    if (!spot) continue;
    const [x, z] = spot;
    // Clumps (Ghost of Tsushima): blades belong to the nearest jittered
    // grid point; a clump shares height, tint and splays out from its centre.
    const CELL = 0.55;
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    let bh = 0;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const h1 = hash2(cx + i, cz + j);
        const h2 = hash2(cz + j + 17.3, cx + i - 5.1);
        const px = (cx + i + h1) * CELL;
        const pz = (cz + j + h2) * CELL;
        const d = (px - x) ** 2 + (pz - z) ** 2;
        if (d < best) {
          best = d;
          bx = px;
          bz = pz;
          bh = hash2(cx + i + 3.7, cz + j + 9.1);
        }
      }
    }
    const away = Math.atan2(z - bz, x - bx);
    const height = (hMin + (hMax - hMin) * (0.45 * bh + 0.55 * Math.pow(rnd(), 0.8))) * (0.85 + 0.3 * rnd());
    // Facing: perpendicular-ish to the splay so the clump fans open.
    const facing = away + (rnd() - 0.5) * 1.2;
    roots.set([x, heightAt(x, z), z], placed * 3);
    shapes.set([height, 0.035 + rnd() * 0.03, facing, 0.65 * bh + 0.35 * rnd()], placed * 4);
    placed++;
  }
  // Shuffle so lowering instanceCount thins the field evenly.
  for (let i = placed - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    for (let k = 0; k < 3; k++) [roots[i * 3 + k], roots[j * 3 + k]] = [roots[j * 3 + k], roots[i * 3 + k]];
    for (let k = 0; k < 4; k++) [shapes[i * 4 + k], shapes[j * 4 + k]] = [shapes[j * 4 + k], shapes[i * 4 + k]];
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.setAttribute('aRoot', new THREE.InstancedBufferAttribute(roots, 3));
  geometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(shapes, 4));
  geometry.instanceCount = placed;

  const bladeMaterial = new THREE.ShaderMaterial({
    uniforms: { ...env, uStyle },
    vertexShader: /* glsl */ `
      ${ENV_GLSL}
      attribute vec3 aRoot;
      attribute vec4 aShape;
      varying float vT;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vGust;
      varying float vSeed;
      varying float vSide;
      void main() {
        float t = position.y;
        float side = position.x;
        float h = aShape.x;
        float seed = aShape.w;
        vec2 face = vec2(cos(aShape.z), sin(aShape.z));
        vec2 right = vec2(-face.y, face.x);
        float gust;
        vec2 wind = windAt(aRoot.xz, uTime + seed * 0.4, gust);
        vec2 bend = face * (0.12 + 0.3 * fract(seed * 13.7)) + wind;
        float bl = length(bend);
        float curve = t * t;
        vec2 dxz = bend * h * curve * 0.9;
        float y = h * t * (1.0 - 0.32 * min(bl * bl, 1.6) * t);
        // Blades further away are drawn wider so the field stays solid.
        float dist = length(aRoot - cameraPosition);
        float width = aShape.y * (1.0 + dist * 0.035) * (1.0 - pow(t, 1.3));
        vec3 p = aRoot + vec3(right.x * side * width + dxz.x, y, right.y * side * width + dxz.y);
        // Rounded blade normal (tilted out at the edges), leaning with the bend.
        vec3 n = normalize(vec3(face.x, 0.0, face.y) + vec3(right.x, 0.0, right.y) * side * 0.5 - vec3(bend.x, -0.4, bend.y) * t * 0.5);
        vT = t;
        vWorld = p;
        vNormal = n;
        vGust = gust;
        vSeed = seed;
        vSide = side;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${MEADOW_GLSL}
      ${PALETTE_GLSL}
      ${light}
      varying float vT;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vGust;
      varying float vSeed;
      varying float vSide;
      void main() {
        if (uDebug > 0.5 && uDebug < 1.5) discard;
        if (uDebug > 1.5) { gl_FragColor = vec4(vec3(sunVis(vec3(vWorld.x, vWorld.y * 0.25, vWorld.z))), 1.0); return; }
        if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec3 root; vec3 shadeTint; float transGain; float sheenGain;
        grassPalette(root, shadeTint, transGain, sheenGain);
        // Per-blade value jitter: a few darker blades give the field texture.
        vec3 tip = meadowTint(vWorld.xz) * (0.72 + 0.4 * vSeed);
        vec3 base = mix(root, tip, smoothstep(0.0, 0.85, vT));
        // Gust sheen: bent blades show their pale side — the silver wave.
        base = mix(base, srgb(vec3(0.86, 0.94, 0.62)), vGust * smoothstep(0.3, 1.0, vT) * sheenGain);

        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        vec3 bladeN = n;
        // Lit half like the ground beneath it: calm, painterly, no speckle.
        n = normalize(mix(n, vec3(0.0, 1.0, 0.0), 0.55));
        // Dapple as a near-ground decal: the painted look, not sliced per blade.
        // Low sun (dusk): the land falls into shade.
        float sv = sunVis(vec3(vWorld.x, vWorld.y * 0.1, vWorld.z)) * smoothstep(-0.02, 0.18, uSunDir.y);
        float ndl = dot(n, uSunDir);
        float wrap = clamp(ndl * 0.6 + 0.45, 0.0, 1.0);
        vec3 toFrag = normalize(vWorld - cameraPosition);
        float back = pow(max(dot(toFrag, uSunDir), 0.0), 3.0);
        float ao = mix(0.22, 1.0, smoothstep(0.0, 0.8, vT));

        vec3 col;
        if (uStyle > 0.5 && uStyle < 1.5) {
          float lit = wrap * sv;
          float band = smoothstep(0.32, 0.36, lit) * 0.55 + smoothstep(0.62, 0.66, lit) * 0.45;
          vec3 shadeC = base * shadeTint * 0.9;
          vec3 litC = base * uSunColor * 1.15;
          col = mix(shadeC, litC, band) * mix(0.55, 1.0, step(0.25, vT));
          col += tip * uSunColor * back * sv * step(0.55, vT) * 0.6 * transGain;
        } else {
          vec3 ambient = base * shadeTint * 0.8;
          vec3 direct = base * uSunColor * wrap * 1.0;
          col = (ambient + direct * sv) * ao;
          // Backlit translucency: tips glow when the sun is behind them.
          vec3 glow = mix(tip, srgb(vec3(0.95, 0.95, 0.45)), 0.35);
          col += glow * uSunColor * back * sv * smoothstep(0.35, 1.0, vT) * 0.7 * transGain;
          // Sheen: blades turned just right catch the sun along their length
          // — the drawn highlight strokes of an anime meadow.
          float spec = pow(max(dot(reflect(toFrag, bladeN), uSunDir), 0.0), uStyle > 1.5 ? 12.0 : 24.0);
          col += mix(tip, vec3(1.0), 0.5) * uSunColor * spec * smoothstep(0.3, 0.9, vT) * sv * (uStyle > 1.5 ? 0.9 : 0.45);
        }
        col = airFade(col, vWorld, 0.0016);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
  const blades = new THREE.Mesh(geometry, bladeMaterial);
  blades.frustumCulled = false;
  group.add(blades);

  // ── ground ──
  if (options.ground) {
    let groundGeometries: THREE.BufferGeometry[];
    if ('geometries' in options.ground) {
      groundGeometries = options.ground.geometries;
    } else {
      const { size, centre, segments = 200 } = options.ground;
      const plane = new THREE.PlaneGeometry(size, size, segments, segments);
      plane.rotateX(-Math.PI / 2);
      plane.translate(centre[0], 0, centre[1]);
      groundGeometries = [plane];
    }
    for (const g of groundGeometries) {
      const gp = g.attributes.position;
      for (let i = 0; i < gp.count; i++) gp.setY(i, heightAt(gp.getX(i), gp.getZ(i)));
      g.computeVertexNormals();
    }
    const groundMaterial = new THREE.ShaderMaterial({
      uniforms: { ...env, uStyle },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec3 vNormal;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vNormal = normal;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        ${ENV_GLSL}
        ${MEADOW_GLSL}
        ${PALETTE_GLSL}
        ${light}
        varying vec3 vWorld;
        varying vec3 vNormal;
        void main() {
          if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          if (uDebug > 0.5) { gl_FragColor = vec4(vec3(sunVis(vWorld)), 1.0); return; }
          vec3 root; vec3 shadeTint; float transGain; float sheenGain;
          grassPalette(root, shadeTint, transGain, sheenGain);
          float dist = length(vWorld - cameraPosition);
          vec3 tip = meadowTint(vWorld.xz);
          // Near: the shaded floor between blades. Far: the blade tops.
          float far = smoothstep(6.0, 45.0, dist);
          vec3 base = mix(mix(root, tip, 0.35), tip * 0.95, far);
          float gust;
          windAt(vWorld.xz, uTime, gust);
          base = mix(base, srgb(vec3(0.86, 0.94, 0.62)), gust * far * sheenGain * 0.8);
          float sv = sunVis(vWorld) * smoothstep(-0.02, 0.18, uSunDir.y);
          float wrap = clamp(dot(normalize(vNormal), uSunDir) * 0.6 + 0.45, 0.0, 1.0);
          vec3 col = base * shadeTint * 0.8 + base * uSunColor * wrap * 1.0 * sv;
          col *= mix(0.45, 0.95, far);
          col = airFade(col, vWorld, 0.0016);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    for (const g of groundGeometries) {
      const ground = new THREE.Mesh(g, groundMaterial);
      ground.renderOrder = -1;
      group.add(ground);
    }
  }

  // ── flowers: instanced discs facing the sky (ellipses from the side) ──
  if (options.flowers && options.flowers > 0) {
    const n = options.flowers;
    const fr = new Float32Array(n * 3);
    const fa = new Float32Array(n * 4);
    let k = 0;
    let tries = 0;
    while (k < n && tries < n * 60) {
      tries++;
      const spot = options.place(rnd);
      if (!spot) continue;
      const [x, z] = spot;
      // Flowers grow in drifts.
      if (Math.sin(x * 0.31 + 1.2) * Math.sin(z * 0.27 + 0.4) < 0.15) continue;
      fr.set([x, heightAt(x, z), z], k * 3);
      fa.set([hMax * (0.8 + rnd() * 0.45), rnd(), rnd(), 0.75 + rnd() * 0.5], k * 4);
      k++;
    }
    const fg = new THREE.InstancedBufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
    fg.setIndex([0, 2, 1, 0, 3, 2]);
    fg.setAttribute('aRoot', new THREE.InstancedBufferAttribute(fr.slice(0, k * 3), 3));
    fg.setAttribute('aFlower', new THREE.InstancedBufferAttribute(fa.slice(0, k * 4), 4));
    fg.instanceCount = k;
    const flowerMaterial = new THREE.ShaderMaterial({
      uniforms: { ...env },
      vertexShader: /* glsl */ `
        ${ENV_GLSL}
        attribute vec3 aRoot;
        attribute vec4 aFlower;
        varying vec2 vUv;
        varying vec3 vColor;
        varying vec3 vWorld;
        varying float vSpin;
        varying vec3 vN;
        void main() {
          float gust;
          vec2 wind = windAt(aRoot.xz, uTime + aFlower.z * 0.4, gust);
          vec2 bend = wind * 0.8 + vec2(0.06, 0.04);
          float h = aFlower.x;
          vec3 head = aRoot + vec3(bend.x * h * 0.9, h * (1.0 - 0.3 * min(dot(bend, bend), 1.6)), bend.y * h * 0.9);
          // Face: up, nodding with the stem and a little towards the sun.
          float a = aFlower.z * 6.2832;
          vec3 toCam = normalize(cameraPosition - head);
          vec3 n = normalize(vec3(0.0, 1.0, 0.0) + vec3(bend.x, 0.0, bend.y) * 0.6 + vec3(cos(a), 0.0, sin(a)) * 0.3 + toCam * 0.6);
          vec3 t = normalize(cross(n, vec3(0.0, 0.0, 1.0)));
          vec3 b = cross(t, n);
          float size = 0.032 * aFlower.w;
          vec3 p = head + (t * position.x + b * position.z) * size;
          float kind = aFlower.y;
          vColor = kind < 0.55 ? srgb(vec3(0.97, 0.96, 0.92)) : kind < 0.8 ? srgb(vec3(1.0, 0.84, 0.34)) : srgb(vec3(0.76, 0.78, 1.0));
          vUv = position.xz;
          vSpin = a;
          vWorld = p;
          vN = n;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${ENV_GLSL}
        ${light}
        varying vec2 vUv;
        varying vec3 vColor;
        varying vec3 vWorld;
        varying float vSpin;
        varying vec3 vN;
        void main() {
          float r = length(vUv);
          float a = atan(vUv.y, vUv.x) + vSpin;
          float petal = 0.6 + 0.4 * cos(a * 5.0);
          if (r > petal) discard;
          if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          vec3 c = mix(srgb(vec3(1.0, 0.74, 0.16)), vColor, smoothstep(0.2, 0.28, r));
          // Petal veins / cupping: darker towards the centre.
          c *= 0.78 + 0.22 * smoothstep(0.2, 0.9, r);
          float sv = sunVis(vWorld);
          float ndl = max(dot(normalize(vN), uSunDir), 0.0) * 0.6 + 0.4;
          if (!gl_FrontFacing) ndl *= 0.55;
          vec3 col = c * (uAmbient * 0.5 + uSunColor * ndl * sv);
          col = airFade(col, vWorld, 0.0016);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.DoubleSide,
    });
    const flowers = new THREE.Mesh(fg, flowerMaterial);
    flowers.frustumCulled = false;
    group.add(flowers);
  }

  // ── pollen motes ──
  if (options.motes) {
    const { count, centre, size } = options.motes;
    const mp = new Float32Array(count * 3);
    const ms = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      mp.set([(rnd() - 0.5) * size.x, rnd() * size.y, (rnd() - 0.5) * size.z], i * 3);
      ms[i] = rnd();
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    mg.setAttribute('aSeed', new THREE.BufferAttribute(ms, 1));
    const moteMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...env,
        uCentre: { value: centre },
        uSize: { value: size },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.75) },
        uViewport: { value: innerHeight },
      },
      vertexShader: /* glsl */ `
        ${ENV_GLSL}
        ${light}
        uniform vec3 uCentre;
        uniform vec3 uSize;
        uniform float uPixelRatio;
        uniform float uViewport;
        attribute float aSeed;
        varying float vGlow;
        void main() {
          // Carried downwind and wrapped round the box; a lazy wobble on top.
          vec3 p = position;
          vec2 drift = uWindDir * uTime * (0.35 + 0.5 * aSeed) * (0.5 + uBreeze);
          p.xz = mod(p.xz + drift + uSize.xz * 0.5, uSize.xz) - uSize.xz * 0.5;
          p += uCentre;
          p.x += sin(uTime * 0.7 + aSeed * 40.0) * 0.15;
          p.y += sin(uTime * 0.5 + aSeed * 23.0) * 0.25;
          p.z += cos(uTime * 0.6 + aSeed * 31.0) * 0.15;
          vec3 toP = normalize(p - cameraPosition);
          // Forward scattering: motes between you and the sun light up.
          float forward = 0.25 + 1.5 * pow(max(dot(toP, uSunDir), 0.0), 4.0);
          float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + aSeed * 2.0) + aSeed * 50.0);
          vGlow = sunVis(p) * forward * twinkle;
          vec4 view = viewMatrix * vec4(p, 1.0);
          gl_PointSize = (0.012 + 0.018 * aSeed) * uPixelRatio * uViewport / -view.z * 1.6;
          gl_Position = projectionMatrix * view;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOcclusion;
        uniform vec3 uSunColor;
        varying float vGlow;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float disc = smoothstep(0.5, 0.0, d);
          if (uOcclusion > 0.5) discard;
          gl_FragColor = vec4(uSunColor * vec3(1.0, 0.93, 0.75) * disc * disc * vGlow * 1.6, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const motes = new THREE.Points(mg, moteMaterial);
    motes.frustumCulled = false;
    motes.renderOrder = 20;
    group.add(motes);
  }

  return {
    group,
    uStyle,
    maxCount: placed,
    setCount(n) {
      geometry.instanceCount = Math.max(0, Math.min(placed, Math.round(n)));
    },
  };
}

/** Roots spread over a fan in front of a viewpoint: half log-distributed
 *  (dense near the eye), half area-uniform, inside ±halfAngle of `yaw`. */
export function fanSampler(
  eye: [number, number],
  yaw: number,
  halfAngle: number,
  near: number,
  far: number,
  reject?: (x: number, z: number) => boolean,
) {
  return (rnd: () => number): [number, number] | null => {
    const u = rnd();
    const r = rnd() < 0.5 ? near * Math.pow(far / near, u) : Math.sqrt(near * near + u * (far * far - near * near));
    // Near the eye the fan opens to a full circle: a ground ray from the
    // eye's own foot shows up on screen as a diagonal edge otherwise.
    const open = 1 - THREE.MathUtils.smoothstep(r, 3, 10);
    const a = yaw + (rnd() * 2 - 1) * (halfAngle + (Math.PI - halfAngle) * open);
    const x = eye[0] + Math.sin(a) * r;
    const z = eye[1] - Math.cos(a) * r;
    if (reject && reject(x, z)) return null;
    return [x, z];
  };
}

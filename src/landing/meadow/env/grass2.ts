// COPIED from .claude/pages/ad/experiments/env-src/grass2.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * v2 grass for the anime meadow (refs 1–2):
 *
 *  G1 painted lime — blue-green bases → lime-yellow sunlit tips, big painted
 *     colour patches, a few pale "highlight stroke" blades and a few dark
 *     ones (the brush texture of ref 1's foreground);
 *  G2 cel bands    — three hard tones (dark / mid / lime), one step darker in
 *     shadow (the 90s cel meadow of ref 2);
 *  G4 spring       — G1 with every wildflower instance shown.
 *  (G3 "previous soft painted" is meadow.ts itself, built by the page.)
 *
 * Plus taller TUFTS in the foreground (fans of long curved blades), a
 * painted ground under everything, and three flower sets:
 *  daisy  — white daisies + orange blooms (ref 1);
 *  tiny   — tiny pink/white flowers in drifts (ref 2);
 *  petals — fallen cherry petals lying on the grass tops (ref 3).
 *
 * The tree's light comes from shadow.ts (one texture fetch per fragment).
 */

import * as THREE from 'three';
import { seededRandom } from './lab';
import { KIT_GLSL, type KitUniforms } from './v2kit';
import { SHADOW_SAMPLE_GLSL, type ShadowUniforms } from './shadow';

export type GrassStyle = 'painted' | 'cel' | 'spring';
export type FlowerSet = 'daisy' | 'tiny' | 'petals';

export type Grass2Options = {
  count: number;
  seed: number;
  place: (rnd: () => number) => [number, number] | null;
  heightAt: (x: number, z: number) => number;
  bladeHeight: [number, number];
  tufts?: { count: number; place: (rnd: () => number) => [number, number] | null };
  flowers: { count: number; place?: (rnd: () => number) => [number, number] | null };
  shadow: ShadowUniforms;
  /** Ground: an exponential grid out to `extent` metres round `centre`. */
  ground?: { centre: [number, number]; extent: number };
};

export type Grass2 = {
  group: THREE.Group;
  setStyle(style: GrassStyle): void;
  setFlowers(set: FlowerSet): void;
  setCount(n: number): void;
  maxCount: number;
  dispose(): void;
};

/** Shared palette + painterly patches (blades AND ground use it). */
const PAINT_GLSL = /* glsl */ `
uniform float uStyle; // 0 painted lime, 1 cel, 2 spring (= painted)
/** 0…1 big painted patches: 1 = warm lime-yellow, 0 = cooler green. */
float paintPatch(vec2 xz) {
  float n = fbm3(xz * 0.05 + 4.0);
  float m = fbm3(xz * 0.17 + vec2(9.0, 2.0));
  return clamp(smoothstep(0.3, 0.68, n) * 0.8 + (m - 0.5) * 0.5 + 0.18, 0.0, 1.0);
}
vec3 litTip(float pch) { return mix(srgb(vec3(0.62, 0.82, 0.29)), srgb(vec3(0.92, 0.93, 0.48)), pch); }
vec3 litMid(float pch) { return mix(srgb(vec3(0.24, 0.56, 0.24)), srgb(vec3(0.58, 0.78, 0.28)), pch); }
vec3 rootLit() { return srgb(vec3(0.05, 0.24, 0.20)); }
vec3 shadeTip() { return srgb(vec3(0.09, 0.36, 0.34)); }
vec3 shadeRoot() { return srgb(vec3(0.02, 0.13, 0.15)); }
/** Cel tones (ref 2): dark, mid, lime; and the shaded set. */
vec3 celTone(float level, float inShade) {
  vec3 c0 = srgb(vec3(0.07, 0.36, 0.24));
  vec3 c1 = srgb(vec3(0.30, 0.64, 0.22));
  vec3 c2 = srgb(vec3(0.66, 0.86, 0.34));
  vec3 s0 = srgb(vec3(0.03, 0.20, 0.20));
  vec3 s1 = srgb(vec3(0.08, 0.34, 0.32));
  vec3 lit = level < 0.4 ? c0 : level < 0.68 ? c1 : c2;
  vec3 shd = level < 0.55 ? s0 : s1;
  return mix(lit, shd, inShade);
}
`;

/** A ground grid whose spacing grows exponentially from `centre` (≈9 cm
 *  cells near it, hundreds of metres at the rim), following heightAt. */
export function makeGroundGrid(centre: [number, number], extent: number, heightAt: (x: number, z: number) => number, N = 160): THREE.BufferGeometry {
  const coord = (i: number) => {
    const s = (i / N) * 2 - 1;
    return Math.sign(s) * (Math.exp(Math.abs(s) * Math.log(extent + 1)) - 1);
  };
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = centre[0] + coord(i);
      const z = centre[1] + coord(j);
      pos.push(x, heightAt(x, z), z);
    }
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  return geometry;
}

export function createGrass2(u: KitUniforms, o: Grass2Options): Grass2 {
  const group = new THREE.Group();
  const rnd = seededRandom(o.seed);
  const uStyle = { value: 0 };
  const uFlowerSet = { value: 0 };

  // ── blade geometry: 7 segments + tip ──
  const SEG = 7;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < SEG; i++) {
    const t = i / SEG;
    positions.push(-1, t, 0, 1, t, 0);
  }
  positions.push(0, 1, 0);
  for (let i = 0; i < SEG - 1; i++) {
    const k = i * 2;
    indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  const tipBase = (SEG - 1) * 2;
  indices.push(tipBase, tipBase + 1, SEG * 2);

  const tuftCount = o.tufts?.count ?? 0;
  const max = o.count + tuftCount * 14;
  const roots = new Float32Array(max * 4);
  const shapes = new Float32Array(max * 4);
  const [hMin, hMax] = o.bladeHeight;
  let placed = 0;
  let guard = 0;
  const hash2 = (x: number, z: number) => {
    const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  while (placed < o.count && guard < o.count * 30) {
    guard++;
    const spot = o.place(rnd);
    if (!spot) continue;
    const [x, z] = spot;
    // Clumps (Ghost of Tsushima): blades share height + tint with the
    // nearest jittered cell point and splay away from it.
    const CELL = 0.5;
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    let bh = 0;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const px = (cx + i + hash2(cx + i, cz + j)) * CELL;
        const pz = (cz + j + hash2(cz + j + 17.3, cx + i - 5.1)) * CELL;
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
    const height = (hMin + (hMax - hMin) * (0.5 * bh + 0.5 * Math.pow(rnd(), 0.8))) * (0.85 + 0.3 * rnd());
    roots.set([x, o.heightAt(x, z), z, 0], placed * 4);
    shapes.set([height, 0.03 + rnd() * 0.028, away + (rnd() - 0.5) * 1.3, 0.6 * bh + 0.4 * rnd()], placed * 4);
    placed++;
  }
  // Foreground tufts: fans of 9–14 long, broad, strongly curved blades.
  if (o.tufts) {
    let t = 0;
    let tries = 0;
    while (t < o.tufts.count && tries < o.tufts.count * 50) {
      tries++;
      const spot = o.tufts.place(rnd);
      if (!spot) continue;
      const [x, z] = spot;
      const n = 9 + Math.floor(rnd() * 6);
      const tall = hMax * (1.2 + rnd() * 0.9);
      for (let k = 0; k < n && placed < max; k++) {
        const a = (k / n) * Math.PI * 2 + rnd() * 0.5;
        const rx = x + Math.cos(a) * 0.04 * rnd();
        const rz = z + Math.sin(a) * 0.04 * rnd();
        roots.set([rx, o.heightAt(rx, rz), rz, 1], placed * 4);
        shapes.set([tall * (0.55 + 0.45 * rnd()), 0.05 + rnd() * 0.035, a, rnd()], placed * 4);
        placed++;
      }
      t++;
    }
  }
  // Shuffle the field part so lowering instanceCount thins it evenly (the
  // tufts are appended after it and stay).
  const fieldN = Math.min(placed, o.count);
  for (let i = fieldN - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    for (let k = 0; k < 4; k++) {
      [roots[i * 4 + k], roots[j * 4 + k]] = [roots[j * 4 + k], roots[i * 4 + k]];
      [shapes[i * 4 + k], shapes[j * 4 + k]] = [shapes[j * 4 + k], shapes[i * 4 + k]];
    }
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.setAttribute('aRoot', new THREE.InstancedBufferAttribute(roots.slice(0, placed * 4), 4));
  geometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(shapes.slice(0, placed * 4), 4));
  geometry.instanceCount = placed;

  const bladeMaterial = new THREE.ShaderMaterial({
    uniforms: { ...u, ...o.shadow, uStyle },
    vertexShader: /* glsl */ `
      ${KIT_GLSL}
      attribute vec4 aRoot;
      attribute vec4 aShape;
      varying float vT;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vGust;
      varying float vSeed;
      varying float vAbove;
      varying float vTuft;
      void main() {
        float t = position.y;
        float side = position.x;
        float h = aShape.x;
        float seed = aShape.w;
        float tuft = aRoot.w;
        vec2 face = vec2(cos(aShape.z), sin(aShape.z));
        vec2 right = vec2(-face.y, face.x);
        float gust;
        vec2 wind = windAt(aRoot.xz, uTime + seed * 0.4, gust);
        // Tuft blades arch out of their fan; field blades lean a little.
        float splay = tuft > 0.5 ? 0.45 + 0.45 * fract(seed * 13.7) : 0.08 + 0.22 * fract(seed * 13.7);
        vec2 bend = face * splay + wind * (tuft > 0.5 ? 0.6 : 0.75);
        float bl = length(bend);
        float curve = t * t;
        vec2 dxz = bend * h * curve * 0.9;
        float y = h * t * (1.0 - 0.34 * min(bl * bl, 1.6) * t);
        float dist = length(aRoot.xyz - cameraPosition);
        float width = aShape.y * (1.0 + dist * 0.03) * (1.0 - pow(t, tuft > 0.5 ? 1.6 : 1.3));
        vec3 p = aRoot.xyz + vec3(right.x * side * width + dxz.x, y, right.y * side * width + dxz.y);
        vec3 n = normalize(vec3(face.x, 0.0, face.y) + vec3(right.x, 0.0, right.y) * side * 0.5 - vec3(bend.x, -0.4, bend.y) * t * 0.5);
        vT = t;
        vWorld = p;
        vNormal = n;
        vGust = gust;
        vSeed = seed;
        vAbove = y;
        vTuft = tuft;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${KIT_GLSL}
      ${SHADOW_SAMPLE_GLSL}
      ${PAINT_GLSL}
      varying float vT;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vGust;
      varying float vSeed;
      varying float vAbove;
      varying float vTuft;
      void main() {
        if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec3 sh = shadowAt(vWorld, vAbove);
        // Low sun: the land falls into shade.
        float sv = sh.r * cloudShadow(vWorld) * smoothstep(-0.02, 0.15, uSunDir.y);
        float ao = 1.0 - sh.b * 0.5 * (1.0 - vT);
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        vec3 nr = normalize(mix(n, vec3(0.0, 1.0, 0.0), 0.3));
        float face = clamp(dot(nr, uSunDir) * 0.7 + 0.45, 0.0, 1.0);
        float dist = length(vWorld - cameraPosition);
        // Per-blade value jitter: strong up close (brush texture), calm far away.
        float near = 1.0 - smoothstep(6.0, 30.0, dist);
        float value = mix(1.0, mix(0.74, 1.1, fract(vSeed * 37.3)) * mix(0.9, 1.06, vSeed), 0.35 + 0.65 * near);
        vec3 V = normalize(vWorld - cameraPosition);
        float back = pow(max(dot(V, uSunDir), 0.0), 3.0);
        float pch = paintPatch(vWorld.xz);
        float pick = fract(vSeed * 91.7);
        vec3 col;
        if (uStyle > 0.5 && uStyle < 1.5) {
          // G2 cel: one tone per blade section, hard steps, one band darker in shade.
          float level = vT * 0.62 + face * 0.2 + pch * 0.22 - (pick < 0.12 ? 0.3 : 0.0);
          float shade = 1.0 - step(0.5, sv);
          col = celTone(level, shade);
          col += celTone(1.0, 0.0) * back * sv * step(0.7, vT) * 0.35;
        } else {
          // G1 / G4 painted lime.
          // Tufts keep their dark bodies longer (crisp foreground fans).
          float tipAt = vTuft > 0.5 ? 0.62 : 0.4;
          vec3 lit = mix(rootLit(), litMid(pch), smoothstep(0.0, tipAt, vT));
          lit = mix(lit, litTip(pch), smoothstep(tipAt, 0.98, vT));
          lit *= (0.78 + 0.32 * face) * value;
          vec3 shd = mix(shadeRoot(), shadeTip(), smoothstep(0.0, 0.9, vT));
          shd *= (0.82 + 0.3 * face) * value;
          // Backlit (mist): the lit faces turn away from us — darker, glowing tips.
          col = mix(shd, lit * mix(1.0, 0.8, uMist), sv * mix(1.0, 0.4, uMist));
          // Brush texture: a few pale highlight strokes, a few dark blades.
          if (pick > 0.93 && near > 0.2) col = mix(col, srgb(vec3(0.95, 0.95, 0.62)), smoothstep(0.3, 0.75, vT) * sv * 0.75);
          else if (pick < 0.16 * near + 0.04) col = mix(col, mix(rootLit(), shadeTip(), 0.5) * 1.1, 0.65 * smoothstep(0.1, 0.6, vT));
          // Gust sheen: bent blades flash their pale side (the silver wave).
          col = mix(col, srgb(vec3(0.88, 0.95, 0.62)), vGust * smoothstep(0.3, 1.0, vT) * 0.45 * sv);
          // Backlit tips glow (the misty light).
          col += mix(litTip(pch), srgb(vec3(1.0, 0.95, 0.55)), 0.4) * uSunColor * back * sv * smoothstep(0.55, 1.0, vT) * mix(0.4, 0.75, uMist);
        }
        col *= ao;
        // Painterly depth: the foreground sinks into deeper blue-green (ref 1's bottom band).
        float fg = 1.0 - smoothstep(0.8, 7.0, dist);
        col = mix(col, col * srgb(vec3(0.62, 0.8, 0.84)), fg * 0.7 * (uStyle > 0.5 && uStyle < 1.5 ? 0.0 : 1.0));
        col = mistFade(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
  const blades = new THREE.Mesh(geometry, bladeMaterial);
  blades.frustumCulled = false;
  blades.layers.set(1);
  group.add(blades);

  // ── ground: an exponential grid (dense near the centre, sparse far) ──
  let groundGeometry: THREE.BufferGeometry | null = null;
  let groundMaterial: THREE.ShaderMaterial | null = null;
  if (o.ground) {
    groundGeometry = makeGroundGrid(o.ground.centre, o.ground.extent, o.heightAt);
    groundMaterial = new THREE.ShaderMaterial({
      uniforms: { ...u, ...o.shadow, uStyle },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec3 vNormal;
        void main() {
          vWorld = position;
          vNormal = normal;
          gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${KIT_GLSL}
        ${SHADOW_SAMPLE_GLSL}
        ${PAINT_GLSL}
        varying vec3 vWorld;
        varying vec3 vNormal;
        void main() {
          if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          vec3 sh = shadowAt(vWorld, 0.0);
          float sv = sh.r * cloudShadow(vWorld) * smoothstep(-0.02, 0.15, uSunDir.y);
          float dist = length(vWorld - cameraPosition);
          // Near: the dark floor between blades. Far: the painted blade tops.
          float far = smoothstep(5.0, 40.0, dist);
          float pch = paintPatch(vWorld.xz);
          // Long brush strokes across the slope (painted ground texture).
          float stroke = vnoise(vec2(vWorld.x * 0.6 + vWorld.z * 0.25, vWorld.z * 2.6 - vWorld.x * 0.3));
          vec3 col;
          if (uStyle > 0.5 && uStyle < 1.5) {
            float level = mix(0.35, 0.62 + pch * 0.25, far) + (stroke - 0.5) * 0.1;
            col = celTone(level, 1.0 - step(0.5, sv));
          } else {
            vec3 litNear = mix(rootLit(), litMid(pch), 0.55);
            vec3 litFar = mix(litMid(pch), litTip(pch), 0.75);
            vec3 lit = mix(litNear, litFar, far) * (0.9 + 0.2 * stroke);
            vec3 shd = mix(shadeRoot(), shadeTip(), mix(0.35, 0.75, far)) * (0.9 + 0.2 * stroke);
            col = mix(shd, lit, sv * mix(1.0, 0.55, uMist));
            float gust;
            windAt(vWorld.xz, uTime, gust);
            col = mix(col, srgb(vec3(0.88, 0.95, 0.62)), gust * far * 0.3 * sv);
          }
          col *= 1.0 - sh.b * 0.45;
          col = mistFade(col, vWorld);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.renderOrder = -1;
    ground.layers.set(1);
    group.add(ground);
  }

  // ── flowers: head (4 verts) + stem (4 verts) per instance ──
  const flowerPlace = o.flowers.place ?? o.place;
  const FN = o.flowers.count;
  const fr = new Float32Array(FN * 3);
  const fa = new Float32Array(FN * 4);
  let fk = 0;
  let ftries = 0;
  while (fk < FN && ftries < FN * 80) {
    ftries++;
    const spot = flowerPlace(rnd);
    if (!spot) continue;
    const [x, z] = spot;
    // Drifts: flowers cluster in soft patches (ref 1's foreground band).
    const drift = Math.sin(x * 0.37 + 1.2) * Math.sin(z * 0.29 + 0.4) + Math.sin(x * 0.11 - z * 0.13) * 0.6;
    if (drift < 0.1 + rnd() * 0.5) continue;
    fr.set([x, o.heightAt(x, z), z], fk * 3);
    fa.set([hMax * (0.65 + rnd() * 0.5), rnd(), rnd(), 0.75 + rnd() * 0.5], fk * 4);
    fk++;
  }
  const fg = new THREE.InstancedBufferGeometry();
  fg.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        // head (x, z in the head plane; y = 0 → head flag)
        -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1,
        // stem (x = side, y = 1 → stem flag, z = along 0…1)
        -1, 1, 0, 1, 1, 0, 1, 1, 1, -1, 1, 1,
      ],
      3,
    ),
  );
  fg.setIndex([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7]);
  fg.setAttribute('aRoot', new THREE.InstancedBufferAttribute(fr.slice(0, fk * 3), 3));
  fg.setAttribute('aFlower', new THREE.InstancedBufferAttribute(fa.slice(0, fk * 4), 4));
  fg.instanceCount = fk;
  const flowerMaterial = new THREE.ShaderMaterial({
    uniforms: { ...u, ...o.shadow, uFlowerSet },
    vertexShader: /* glsl */ `
      ${KIT_GLSL}
      uniform float uFlowerSet;
      attribute vec4 aFlower;
      attribute vec3 aRoot;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vN;
      varying float vKind;
      varying float vStem;
      varying float vSpin;
      varying float vAbove;
      void main() {
        bool petals = uFlowerSet > 1.5;
        float gust;
        vec2 wind = windAt(aRoot.xz, uTime + aFlower.z * 0.4, gust);
        vec2 bend = wind * 0.8 + vec2(0.06, 0.04);
        float h = aFlower.x * (petals ? 0.9 : 1.0);
        vec3 head = aRoot + vec3(bend.x * h * 0.9, h * (1.0 - 0.3 * min(dot(bend, bend), 1.6)), bend.y * h * 0.9);
        if (petals) head = aRoot + vec3(bend.x * h * 0.5, h, bend.y * h * 0.5);
        float a = aFlower.z * 6.2832;
        vec3 toCam = normalize(cameraPosition - head);
        vec3 n;
        if (petals) n = normalize(vec3(cos(a) * 0.5, 1.0, sin(a) * 0.5));
        else n = normalize(vec3(0.0, 1.0, 0.0) + vec3(bend.x, 0.0, bend.y) * 0.6 + vec3(cos(a), 0.0, sin(a)) * 0.25 + toCam * 0.7);
        vec3 t = normalize(cross(n, vec3(0.0, 0.0, 1.0)));
        vec3 b = cross(t, n);
        // Sizes: ref 1 daisies ~4 cm, ref 2 tiny flowers ~2 cm, petals ~1.5 cm.
        float size = (uFlowerSet < 0.5 ? 0.034 : uFlowerSet < 1.5 ? 0.022 : 0.021) * aFlower.w;
        if (uFlowerSet < 0.5 && aFlower.y > 0.62) size *= 0.85;
        vec3 p;
        vStem = position.y;
        if (position.y > 0.5) {
          // Stem: a thin camera-facing strip from the root to the head.
          if (petals) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
          vec3 along = mix(aRoot, head, position.z);
          vec3 sideV = normalize(cross(head - aRoot, toCam));
          p = along + sideV * position.x * 0.0035;
          vUv = vec2(position.x, position.z);
        } else {
          p = head + (t * position.x + b * position.z) * size;
          vUv = position.xz;
        }
        vWorld = p;
        vN = n;
        vKind = aFlower.y;
        vSpin = a;
        vAbove = p.y - aRoot.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${KIT_GLSL}
      ${SHADOW_SAMPLE_GLSL}
      uniform float uFlowerSet;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vN;
      varying float vKind;
      varying float vStem;
      varying float vSpin;
      varying float vAbove;
      void main() {
        if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec3 sh = shadowAt(vWorld, vAbove);
        float sv = sh.r * cloudShadow(vWorld);
        vec3 c;
        if (vStem > 0.5) {
          c = srgb(vec3(0.16, 0.42, 0.2));
        } else {
          float r = length(vUv);
          float a = atan(vUv.y, vUv.x) + vSpin;
          if (uFlowerSet < 0.5) {
            if (vKind < 0.62) {
              // Daisy: ~13 slim white rays round a yellow eye.
              float ray = pow(abs(cos(a * 6.5)), 0.6);
              if (r > 0.32 + 0.68 * ray) discard;
              c = r < 0.28 ? srgb(vec3(1.0, 0.78, 0.2)) : srgb(vec3(0.98, 0.97, 0.92));
              c *= 0.82 + 0.18 * smoothstep(0.25, 0.8, r);
            } else {
              // Orange bloom (small): five round petals, darker heart.
              if (r > (0.72 + 0.28 * cos(a * 5.0)) * 0.7) discard;
              c = mix(srgb(vec3(0.85, 0.36, 0.08)), srgb(vec3(1.0, 0.64, 0.18)), smoothstep(0.15, 0.6, r));
            }
          } else if (uFlowerSet < 1.5) {
            // Tiny five-petal flowers: pale pink and white.
            if (r > 0.58 + 0.42 * cos(a * 5.0)) discard;
            c = vKind < 0.55 ? srgb(vec3(0.97, 0.74, 0.84)) : srgb(vec3(0.99, 0.96, 0.97));
            if (vKind > 0.9) c = srgb(vec3(0.82, 0.74, 0.98));
            c = mix(srgb(vec3(1.0, 0.85, 0.4)), c, smoothstep(0.12, 0.2, r));
          } else {
            // A fallen cherry petal: an oval with the notch at its tip.
            vec2 q = vec2(cos(vSpin) * vUv.x - sin(vSpin) * vUv.y, sin(vSpin) * vUv.x + cos(vSpin) * vUv.y);
            float notch = smoothstep(0.22, 0.0, abs(q.y)) * smoothstep(0.55, 1.0, q.x) * 0.5;
            if (1.0 - length(q * vec2(0.8, 1.25)) - notch < 0.0) discard;
            c = mix(srgb(vec3(0.96, 0.7, 0.8)), srgb(vec3(1.0, 0.93, 0.95)), vKind);
          }
        }
        float ndl = max(dot(normalize(vN), uSunDir), 0.0) * 0.5 + 0.5;
        // Shade: the cool blue-green of the pool.
        vec3 lightC = mix(uAmbient * 0.42 + srgb(vec3(0.0, 0.08, 0.08)), uSunColor * ndl * 1.05, sv);
        vec3 col = c * lightC;
        col = mistFade(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
  const flowers = new THREE.Mesh(fg, flowerMaterial);
  flowers.frustumCulled = false;
  flowers.layers.set(1);
  group.add(flowers);

  let flowerShare = 0.4;
  // Tiny flowers and fallen petals are small: show more of them.
  const applyFlowers = () => (fg.instanceCount = Math.round(fk * Math.min(1, flowerShare * (uFlowerSet.value > 0.5 ? 2.5 : 1))));

  return {
    group,
    maxCount: placed,
    setStyle(style) {
      uStyle.value = style === 'painted' ? 0 : style === 'cel' ? 1 : 2;
      flowerShare = style === 'spring' ? 1 : 0.3;
      applyFlowers();
    },
    setFlowers(set) {
      uFlowerSet.value = set === 'daisy' ? 0 : set === 'tiny' ? 1 : 2;
      applyFlowers();
    },
    setCount(n) {
      geometry.instanceCount = Math.max(0, Math.min(placed, Math.round(n)));
    },
    dispose() {
      geometry.dispose();
      bladeMaterial.dispose();
      groundGeometry?.dispose();
      groundMaterial?.dispose();
      fg.dispose();
      flowerMaterial.dispose();
    },
  };
}

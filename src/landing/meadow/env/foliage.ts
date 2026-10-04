// COPIED from .claude/pages/ad/experiments/env-src/foliage.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * Shared machinery for the v2 painted trees (tree2.ts = Ghibli oak,
 * sakura.ts = cherry):
 *
 *  - CANOPY: the crown as a list of spherical CLUMPS. `CANOPY_GLSL` gives any
 *    shader the analytic shadow of the crown in sun-ray coordinates (as the
 *    env-02 komorebi did), plus the trunk's shadow;
 *  - LEAF ATLAS: a 2×2 canvas atlas of "brush dabs" (oak: jagged leaf
 *    stamps; sakura: five-petal blossoms). Each dab is filled with a colour
 *    that ENCODES its own centre (R,G) and a random value (B), so the
 *    fragment shader can light the whole dab at one point: every leaf comes
 *    out as one flat stroke of paint — the mosaic of ref 1's canopy;
 *  - CARDS: camera-facing quads scattered through each clump, shaded with a
 *    spherised normal (clump + crown), a per-vertex sun occlusion through the
 *    other clumps (ray–sphere, in the vertex shader, so it follows the light
 *    toggle live), and backlit translucency;
 *  - BARK: tapered tubes with painted 3-tone shading under the crown shadow;
 *  - FALLING leaves / petals.
 *
 * All procedural: canvas-drawn atlas, no image files.
 */

import * as THREE from 'three';
import { seededRandom } from './lab';
import { KIT_GLSL, type KitUniforms } from './v2kit';

export const MAXC = 128;

/** A clump of leaves; `lobe` = the bigger mass it belongs to (shading). */
export type Clump = { centre: THREE.Vector3; radius: number; lobe?: { centre: THREE.Vector3; radius: number } };

export type CanopyUniforms = {
  uClumps: { value: THREE.Vector4[] };
  uClumpCount: { value: number };
  uTrunkA: { value: THREE.Vector3 };
  uTrunkB: { value: THREE.Vector3 };
  uTrunkR: { value: THREE.Vector2 };
  uCrownC: { value: THREE.Vector3 };
  uCrownR: { value: THREE.Vector3 };
};

export function makeCanopyUniforms(
  clumps: Clump[],
  trunk: { a: THREE.Vector3; b: THREE.Vector3; r: [number, number] },
  crown: { centre: THREE.Vector3; radii: THREE.Vector3 },
): CanopyUniforms {
  if (clumps.length > MAXC) throw new Error(`too many clumps: ${clumps.length}`);
  return {
    uClumps: {
      value: Array.from({ length: MAXC }, (_, i) =>
        i < clumps.length ? new THREE.Vector4(clumps[i].centre.x, clumps[i].centre.y, clumps[i].centre.z, clumps[i].radius) : new THREE.Vector4(),
      ),
    },
    uClumpCount: { value: clumps.length },
    uTrunkA: { value: trunk.a.clone() },
    uTrunkB: { value: trunk.b.clone() },
    uTrunkR: { value: new THREE.Vector2(...trunk.r) },
    uCrownC: { value: crown.centre.clone() },
    uCrownR: { value: crown.radii.clone() },
  };
}

export const CANOPY_GLSL = /* glsl */ `
#define MAXC ${MAXC}
uniform vec4 uClumps[MAXC];
uniform int uClumpCount;
uniform vec3 uTrunkA;
uniform vec3 uTrunkB;
uniform vec2 uTrunkR;
uniform vec3 uCrownC;
uniform vec3 uCrownR;

/** Two axes perpendicular to the sun: in these "ray coordinates" every
 *  point along one sun ray shares the same 2-D position. */
void sunBasis(out vec3 su, out vec3 sv) {
  su = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));
  sv = cross(su, uSunDir);
}

/** The crown's shadow at p: the union of the clumps' ragged discs.
 *  edge = soft edge width (m). broad = a wide falloff (1 deep inside the
 *  pool, 0 at the rim). drop = how far above p (along the ray) the leaves are. */
float canopyCover(vec3 p, float edge, float grow, out float drop, out float broad) {
  vec3 su; vec3 sv;
  sunBasis(su, sv);
  vec2 rc = vec2(dot(p, su), dot(p, sv));
  float cover = 0.0;
  broad = 0.0;
  drop = 0.0;
  for (int i = 0; i < MAXC; i++) {
    if (i >= uClumpCount) break;
    vec4 c = uClumps[i];
    float t = dot(c.xyz - p, uSunDir);
    if (t < -c.w * 0.3) continue;
    vec2 dv = rc - vec2(dot(c.xyz, su), dot(c.xyz, sv));
    float dl = length(dv);
    if (dl > c.w * 1.2 * grow + edge) continue;
    float ang = atan(dv.y, dv.x);
    float ragged = c.w * grow * (0.86 + 0.09 * sin(ang * 5.0 + c.x * 3.1) + 0.05 * sin(ang * 9.0 + c.z * 4.7));
    float k = 1.0 - smoothstep(ragged - edge, ragged + edge * 0.35, dl);
    if (k > cover) { cover = k; drop = max(t, 0.0); }
    broad = max(broad, 1.0 - smoothstep(-0.6 * c.w, ragged, dl));
  }
  return cover;
}

/** The trunk's shadow (a tapered capsule seen along the sun). */
float trunkCover(vec3 p) {
  vec3 su; vec3 sv;
  sunBasis(su, sv);
  vec3 mid = (uTrunkA + uTrunkB) * 0.5;
  if (dot(mid - p, uSunDir) < 0.0) return 0.0;
  vec2 rc = vec2(dot(p, su), dot(p, sv));
  vec2 a = vec2(dot(uTrunkA, su), dot(uTrunkA, sv));
  vec2 b = vec2(dot(uTrunkB, su), dot(uTrunkB, sv));
  vec2 ab = b - a;
  float h = clamp(dot(rc - a, ab) / dot(ab, ab), 0.0, 1.0);
  float r = mix(uTrunkR.x, uTrunkR.y, h);
  return 1.0 - smoothstep(r * 0.8, r * 1.25, length(rc - (a + ab * h)));
}

/** Sun occlusion through the OTHER clumps (soft spheres), for a leaf card. */
float clumpOcclusion(vec3 p, float self) {
  float occ = 0.0;
  for (int i = 0; i < MAXC; i++) {
    if (i >= uClumpCount) break;
    if (abs(float(i) - self) < 0.5) continue;
    vec4 c = uClumps[i];
    vec3 d = c.xyz - p;
    float t = dot(d, uSunDir);
    if (t < 0.0) continue;
    float d2 = dot(d, d) - t * t;
    float r2 = c.w * c.w;
    occ += (1.0 - smoothstep(r2 * 0.1, r2 * 1.1, d2)) * min(t / c.w, 1.0);
  }
  return 1.0 - exp(-occ * 0.85);
}
`;

/** The whole crown leans with the gusts and sways slowly; a smooth field in
 *  space, so the bark (same function) stays attached to its leaves. */
export const SWAY_GLSL = /* glsl */ `
vec3 treeSway(vec3 p) {
  float k = smoothstep(2.0, 10.0, p.y) * (0.55 + 0.45 * smoothstep(0.0, 6.0, length(p.xz)));
  float gust;
  vec2 w = windAt(p.xz * 0.12, uTime, gust);
  vec3 s = vec3(w.x, 0.0, w.y) * 0.2 * k;
  s += vec3(sin(uTime * 0.9 + p.y * 0.5 + p.x * 0.3), 0.0, cos(uTime * 0.73 + p.z * 0.4 + p.y * 0.3)) * 0.05 * k * (0.35 + uBreeze);
  s.y -= length(s.xz) * 0.12;
  return s;
}
`;

// ── tapered tube (a copy of tree.ts's, plus a gnarl hook) ───────────────

export function taperedTube(
  curve: THREE.Curve<THREE.Vector3>,
  segments: number,
  radial: number,
  radius: (t: number, angle: number) => number,
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(segments, false);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const length = curve.getLength();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, p);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      n.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a)).normalize();
      const r = radius(t, a);
      positions.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      normals.push(n.x, n.y, n.z);
      uvs.push(j / radial, t * length);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

// ── leaf / blossom atlas (canvas, 2×2 cells) ───────────────────────────

export type AtlasKind = 'oak' | 'sakura';

/** Each dab's fill colour = (centre.x, centre.y, random) of the dab in its
 *  cell, alpha = coverage. The shader lights the whole dab at that centre. */
export function makeLeafAtlas(kind: AtlasKind, seed: number): THREE.Texture {
  const SIZE = 1024;
  const CELL = SIZE / 2;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, SIZE, SIZE);
  const rnd = seededRandom(seed);
  const fill = (cx: number, cy: number, r: number) => {
    // cx, cy in cell units 0…1 (y down in the canvas, up in the shader: flip).
    ctx.fillStyle = `rgb(${Math.round(cx * 255)}, ${Math.round((1 - cy) * 255)}, ${Math.round(r * 255)})`;
  };
  // Pointed oval (leaf) along +x of the current transform.
  const leafPath = (len: number, width: number) => {
    ctx.beginPath();
    ctx.moveTo(-len * 0.5, 0);
    ctx.bezierCurveTo(-len * 0.2, -width, len * 0.25, -width * 0.9, len * 0.5, 0);
    ctx.bezierCurveTo(len * 0.25, width * 0.9, -len * 0.2, width, -len * 0.5, 0);
    ctx.closePath();
  };
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * CELL;
    const oy = Math.floor(cell / 2) * CELL;
    if (kind === 'oak') {
      // A rounded spray of jagged leaf stamps, pointing outward.
      const count = 44 + Math.floor(rnd() * 10);
      for (let i = 0; i < count; i++) {
        const a = rnd() * Math.PI * 2;
        const r = 0.34 * Math.sqrt(rnd());
        const cx = 0.5 + Math.cos(a) * r;
        const cy = 0.5 + Math.sin(a) * r;
        const len = (0.13 + rnd() * 0.09) * (1 - r * 0.6);
        const rot = a + (rnd() - 0.5) * 1.3;
        fill(cx, cy, rnd());
        ctx.save();
        ctx.translate(ox + cx * CELL, oy + cy * CELL);
        ctx.rotate(rot);
        // Two to three overlapping blades = a jagged painted stamp.
        const lobes = 2 + Math.floor(rnd() * 2);
        for (let k = 0; k < lobes; k++) {
          ctx.save();
          ctx.rotate((k - (lobes - 1) / 2) * 0.55 + (rnd() - 0.5) * 0.2);
          ctx.translate(len * 0.12, 0);
          leafPath(len * CELL * (k === 1 ? 1 : 0.8), len * CELL * 0.24);
          ctx.fill();
          ctx.restore();
        }
        ctx.restore();
      }
    } else {
      // Bunches of five-petal blossoms (sakura grow in umbels of 3–5).
      const bunches = 6 + Math.floor(rnd() * 3);
      for (let b = 0; b < bunches; b++) {
        const ba = rnd() * Math.PI * 2;
        const br = 0.3 * Math.sqrt(rnd());
        const bx = 0.5 + Math.cos(ba) * br;
        const by = 0.5 + Math.sin(ba) * br;
        const n = 6 + Math.floor(rnd() * 6);
        for (let i = 0; i < n; i++) {
          const a = rnd() * Math.PI * 2;
          const r = 0.09 * Math.sqrt(rnd());
          const cx = bx + Math.cos(a) * r;
          const cy = by + Math.sin(a) * r;
          if (Math.hypot(cx - 0.5, cy - 0.5) > 0.43) continue;
          const size = (0.032 + rnd() * 0.022) * CELL;
          const spin = rnd() * Math.PI * 2;
          const tone = rnd();
          ctx.save();
          ctx.translate(ox + cx * CELL, oy + cy * CELL);
          ctx.rotate(spin);
          fill(cx, cy, 0.12 + tone * 0.88);
          for (let k = 0; k < 5; k++) {
            ctx.save();
            ctx.rotate((k / 5) * Math.PI * 2);
            // Petal: a rounded oval with the cherry's notch at the tip.
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.bezierCurveTo(size * 0.55, -size * 0.55, size * 1.05, -size * 0.4, size * 1.0, -size * 0.08);
            ctx.lineTo(size * 0.86, 0);
            ctx.lineTo(size * 1.0, size * 0.08);
            ctx.bezierCurveTo(size * 1.05, size * 0.4, size * 0.55, size * 0.55, 0, 0);
            ctx.fill();
            ctx.restore();
          }
          // The blossom's eye (B ≈ 0 flags it for a deeper pink).
          fill(cx, cy, 0.02);
          ctx.beginPath();
          ctx.arc(0, 0, size * 0.28, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

// ── leaf cards ──────────────────────────────────────────────────────────

export type CardOptions = {
  /** Cards per clump per m² of the clump's cross-section. */
  density: number;
  size: [number, number];
  /** Vertical squash of each clump (sakura clumps are flatter). */
  flatten: number;
  /** Surface bias: higher = cards hug the clump surface. */
  shell: number;
};

export function buildCards(clumps: Clump[], rnd: () => number, options: CardOptions): THREE.InstancedBufferGeometry {
  const aCard: number[] = [];
  const aClump: number[] = [];
  const aInfo: number[] = [];
  const aLobe: number[] = [];
  clumps.forEach((clump, ci) => {
    const lobe = clump.lobe ?? clump;
    const count = Math.max(6, Math.round(options.density * clump.radius * clump.radius));
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
      const l = dir.lengthSq();
      if (l > 1 || l < 1e-4) {
        i--;
        continue;
      }
      dir.normalize();
      dir.y *= options.flatten;
      const depth = Math.pow(rnd(), 1 / options.shell);
      const p = clump.centre.clone().addScaledVector(dir, clump.radius * depth);
      const size = options.size[0] + rnd() * (options.size[1] - options.size[0]);
      aCard.push(p.x, p.y, p.z, size * (0.75 + 0.25 * clump.radius / 1.4));
      aClump.push(clump.centre.x, clump.centre.y, clump.centre.z, clump.radius);
      aLobe.push(lobe.centre.x, lobe.centre.y, lobe.centre.z, lobe.radius);
      aInfo.push(Math.floor(rnd() * 4) + ci * 4, rnd() * Math.PI * 2, rnd(), depth);
    }
  });
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('aCard', new THREE.InstancedBufferAttribute(new Float32Array(aCard), 4));
  geometry.setAttribute('aClump', new THREE.InstancedBufferAttribute(new Float32Array(aClump), 4));
  geometry.setAttribute('aInfo', new THREE.InstancedBufferAttribute(new Float32Array(aInfo), 4));
  geometry.setAttribute('aLobe', new THREE.InstancedBufferAttribute(new Float32Array(aLobe), 4));
  geometry.instanceCount = aCard.length / 4;
  return geometry;
}

export type FoliageLook = {
  /** Five painted tones, darkest → brightest (sRGB hex). */
  tones: [string, string, string, string, string];
  /** Light-level thresholds between the tones. */
  steps: [number, number, number, number];
  /** Backlit translucency colour (sRGB hex) and gain. */
  glow: string;
  trans: number;
  /** Colour of a blossom's eye (sakura) — unused for leaves. */
  eye: string;
  /** Normal blend weights: clump, lobe (big mass), whole crown. */
  weights: [number, number, number];
  /** Extra "sky" lift of the light direction (tops stay lit when the sun is behind). */
  lift: number;
  /** Per-dab random spread of the light level. */
  jitter: number;
  /** How much other clumps darken a card. */
  occlusion: number;
  /** Ambient floor (sakura blossoms stay luminous in their shade). */
  floor: number;
  /** Soft tone edges (0 = hard painted dabs). */
  soften: number;
};

export function createFoliageMaterial(u: KitUniforms, canopy: CanopyUniforms, atlas: THREE.Texture, look: FoliageLook) {
  const uniforms = {
    ...u,
    ...canopy,
    tLeaf: { value: atlas },
    uTone: { value: look.tones.map((t) => new THREE.Color(t)) },
    uSteps: { value: new THREE.Vector4(...look.steps) },
    uGlow: { value: new THREE.Color(look.glow) },
    uTrans: { value: look.trans },
    uEye: { value: new THREE.Color(look.eye) },
    uWeights: { value: new THREE.Vector3(...look.weights) },
    uLift: { value: look.lift },
    uJitter: { value: look.jitter },
    uOccl: { value: look.occlusion },
    uFloor: { value: look.floor },
    uSoften: { value: look.soften },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${KIT_GLSL}
      ${CANOPY_GLSL}
      ${SWAY_GLSL}
      attribute vec4 aCard;
      attribute vec4 aClump;
      attribute vec4 aInfo;
      attribute vec4 aLobe;
      varying vec4 vLobe;
      varying vec2 vUv;
      varying vec3 vCentre;
      varying vec3 vAxX;
      varying vec3 vAxY;
      varying vec4 vClump;
      varying float vOcc;
      varying float vDepth;
      void main() {
        float cell = mod(aInfo.x, 4.0);
        float self = floor(aInfo.x / 4.0);
        vec3 sway = treeSway(aClump.xyz);
        float fl = sin(uTime * (2.2 + aInfo.z * 3.0) + aInfo.z * 40.0) * 0.07 * (0.25 + uBreeze);
        vec3 centre = aCard.xyz + sway + vec3(0.0, fl * 0.12, 0.0);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float a = aInfo.y + fl;
        vec3 ax = (right * cos(a) + up * sin(a)) * aCard.w;
        vec3 ay = (-right * sin(a) + up * cos(a)) * aCard.w;
        vec3 p = centre + ax * position.x + ay * position.y;
        vUv = (vec2(mod(cell, 2.0), floor(cell / 2.0)) + position.xy * 0.5 + 0.5) * 0.5;
        // The canvas row 0 is the top: flip v inside the atlas.
        vUv.y = 1.0 - vUv.y;
        vCentre = centre;
        vAxX = ax;
        vAxY = ay;
        vClump = vec4(aClump.xyz + sway, aClump.w);
        vLobe = vec4(aLobe.xyz + sway, aLobe.w);
        vOcc = clumpOcclusion(aCard.xyz, self);
        vDepth = aInfo.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${KIT_GLSL}
      uniform vec3 uCrownC;
      uniform vec3 uCrownR;
      uniform sampler2D tLeaf;
      uniform vec3 uTone[5];
      uniform vec4 uSteps;
      uniform vec3 uGlow;
      uniform float uTrans;
      uniform vec3 uEye;
      uniform vec3 uWeights;
      uniform float uLift;
      uniform float uJitter;
      varying vec4 vLobe;
      uniform float uOccl;
      uniform float uFloor;
      uniform float uSoften;
      varying vec2 vUv;
      varying vec3 vCentre;
      varying vec3 vAxX;
      varying vec3 vAxY;
      varying vec4 vClump;
      varying float vOcc;
      varying float vDepth;
      float band(float x, float edge) { return smoothstep(edge - uSoften - 0.004, edge + uSoften + 0.004, x); }
      void main() {
        vec4 tx = texture2D(tLeaf, vUv);
        if (tx.a < 0.4) discard;
        // The dab's own centre on the card (atlas cell space → card space).
        vec2 lc = vec2(tx.r, tx.g) * 2.0 - 1.0;
        vec3 L = vCentre + vAxX * lc.x + vAxY * lc.y;
        vec3 nC = normalize(L - vClump.xyz);
        vec3 nK = normalize((L - uCrownC) / uCrownR);
        vec3 nL = normalize(L - vLobe.xyz);
        vec3 n = normalize(nC * uWeights.x + nL * uWeights.y + nK * uWeights.z);
        vec3 V = normalize(L - cameraPosition);
        float ndl = dot(n, normalize(uSunDir + vec3(0.0, uLift, 0.0)));
        float occ = vOcc * uOccl;
        float back = pow(max(dot(V, uSunDir), 0.0), 3.0);
        float rim = 1.0 - abs(dot(nK, V));
        float thin = (1.0 - occ) * mix(0.55, 1.0, vDepth);
        float glow = back * thin * (0.35 + 0.65 * rim) * uTrans;
        if (uOcclusion > 0.5) {
          gl_FragColor = vec4(uSunColor * uGlow * glow * 0.35, 1.0);
          return;
        }
        float light = (ndl * 0.5 + 0.5) * (1.0 - occ * 0.75);
        light *= mix(0.82, 1.0, vDepth);
        light = mix(light, 1.0, uFloor * (1.0 - 0.5 * uMist));
        light += (tx.b - 0.5) * uJitter;
        // Sky light on the tops of the big masses (lobes read even in shade).
        light += max(nL.y, 0.0) * 0.12;
        // Big brush-pressure variation across the crown.
        light += (fbm3(L.xz * 0.45 + L.y * 0.3) - 0.5) * 0.16;
        vec3 col = uTone[0];
        col = mix(col, uTone[1], band(light, uSteps.x));
        col = mix(col, uTone[2], band(light, uSteps.y));
        col = mix(col, uTone[3], band(light, uSteps.z));
        col = mix(col, uTone[4], band(light, uSteps.w));
        // A blossom's eye: a deeper pink at its centre.
        if (tx.b < 0.06) col = mix(col, uEye * (0.55 + 0.6 * light), 0.75);
        // Light colour: warm sun in the lit tones, sky in the shade.
        col *= mix(uAmbient * 1.15, uSunColor, smoothstep(0.3, 0.7, light)) * 0.25 + 0.78;
        // Backlit translucency: the sun pierces the thin rim of the crown.
        col += uGlow * uSunColor * glow * (0.55 + 0.35 * uMist);
        col = mistFade(col, L);
        gl_FragColor = vec4(col, smoothstep(0.4, 0.62, tx.a));
      }
    `,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
  });
}

// ── bark ────────────────────────────────────────────────────────────────

export type BarkLook = { dark: string; mid: string; lit: string; moss: string; stripes: number };

export function createBarkMaterial(u: KitUniforms, canopy: CanopyUniforms, look: BarkLook) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...u,
      ...canopy,
      uDark: { value: new THREE.Color(look.dark) },
      uMid: { value: new THREE.Color(look.mid) },
      uLit: { value: new THREE.Color(look.lit) },
      uMoss: { value: new THREE.Color(look.moss) },
      uStripes: { value: look.stripes },
    },
    vertexShader: /* glsl */ `
      ${KIT_GLSL}
      ${SWAY_GLSL}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        w.xyz += treeSway(w.xyz);
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${KIT_GLSL}
      ${CANOPY_GLSL}
      uniform vec3 uDark;
      uniform vec3 uMid;
      uniform vec3 uLit;
      uniform vec3 uMoss;
      uniform float uStripes;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec3 n = normalize(vNormal);
        float drop; float broad;
        float cover = canopyCover(vWorld + n * 0.05, 0.35, 1.0, drop, broad);
        float vis = 1.0 - cover * 0.9;
        // Painters keep the limbs under a crown in shade (ref 1).
        float inside = 1.0 - smoothstep(0.5, 1.0, length((vWorld.xz - uCrownC.xz) / uCrownR.xz));
        vis *= 1.0 - 0.8 * inside * smoothstep(uTrunkB.y - 0.2, uTrunkB.y + 1.2, vWorld.y);
        float ndl = dot(n, uSunDir);
        // Painted strokes along the limb (furrows) or across it (cherry lenticels).
        float furrow = fbm(vec2(vUv.x * 14.0, vUv.y * 1.3));
        float across = smoothstep(0.55, 0.8, vnoise(vec2(vUv.x * 3.0, vUv.y * 9.0)));
        float stroke = mix(furrow, 1.0 - across * 0.8, uStripes);
        float lit = clamp(ndl * 0.6 + 0.4, 0.0, 1.0) * vis + (stroke - 0.5) * 0.25;
        vec3 col = mix(uDark, uMid, smoothstep(0.24, 0.3, lit));
        col = mix(col, uLit, smoothstep(0.56, 0.62, lit));
        float moss = smoothstep(0.5, 0.75, fbm(vUv * vec2(5.0, 0.7) + 3.0)) * (1.0 - smoothstep(0.2, 2.2, vWorld.y)) * clamp(-ndl + 0.6, 0.0, 1.0);
        col = mix(col, uMoss, moss * 0.6);
        // Sky bounce from above, warm grass bounce from below.
        col += uAmbient * 0.04 * clamp(n.y, 0.0, 1.0) + uMoss * 0.06 * clamp(-n.y, 0.0, 1.0);
        // Backlit rim (misty light): the silhouette edge catches the sun.
        vec3 V = normalize(vWorld - cameraPosition);
        float rim = pow(1.0 - abs(dot(n, -V)), 3.0) * pow(max(dot(V, uSunDir), 0.0), 2.0);
        col += uSunColor * vec3(1.0, 0.85, 0.7) * rim * (1.0 - cover * 0.6) * 0.5;
        col = mistFade(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

// ── falling leaves / petals ─────────────────────────────────────────────

export type FallOptions = {
  count: number;
  /** Spawn box (inside the crown). */
  min: THREE.Vector3;
  max: THREE.Vector3;
  colorA: string;
  colorB: string;
  size: number;
  fallSpeed: number;
  /** 0 = leaf (pointed oval), 1 = petal (notched round). */
  shape: number;
  seed: number;
};

export function createFalling(u: KitUniforms, o: FallOptions): THREE.Mesh {
  const rnd = seededRandom(o.seed);
  const seeds = new Float32Array(o.count * 4);
  for (let i = 0; i < o.count; i++) seeds.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = o.count;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...u,
      uMin: { value: o.min },
      uMax: { value: o.max },
      uColA: { value: new THREE.Color(o.colorA) },
      uColB: { value: new THREE.Color(o.colorB) },
      uSize: { value: o.size },
      uFall: { value: o.fallSpeed },
      uShape: { value: o.shape },
    },
    vertexShader: /* glsl */ `
      ${KIT_GLSL}
      uniform vec3 uMin;
      uniform vec3 uMax;
      uniform float uSize;
      uniform float uFall;
      uniform float uShape;
      attribute vec4 aSeed;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vN;
      varying float vTone;
      varying float vFade;
      mat3 rotAxis(vec3 a, float ang) {
        float c = cos(ang); float s = sin(ang); float t = 1.0 - c;
        return mat3(t*a.x*a.x + c, t*a.x*a.y + s*a.z, t*a.x*a.z - s*a.y,
                    t*a.x*a.y - s*a.z, t*a.y*a.y + c, t*a.y*a.z + s*a.x,
                    t*a.x*a.z + s*a.y, t*a.y*a.z - s*a.x, t*a.z*a.z + c);
      }
      void main() {
        float speed = uFall * (0.7 + 0.6 * aSeed.w);
        float drop = uMax.y + 0.5;           // fall the crown height and below
        float period = drop / speed + 2.0;
        float age = mod(uTime + aSeed.x * period * 7.0, period);
        vec3 start = mix(uMin, uMax, aSeed.xyz);
        vec3 p = start;
        p.y -= age * speed;
        // Carried downwind, swinging like a pendulum leaf.
        p.xz += uWindDir * age * (0.5 + 0.9 * uBreeze);
        p.x += sin(age * 1.7 + aSeed.y * 20.0) * 0.45;
        p.z += cos(age * 1.3 + aSeed.z * 20.0) * 0.35;
        vFade = smoothstep(0.0, 0.6, age) * (1.0 - smoothstep(-0.1, 0.25, -p.y));
        vec3 axis = normalize(vec3(aSeed.y - 0.5, 0.6, aSeed.z - 0.5));
        mat3 R = rotAxis(axis, age * (2.0 + aSeed.w * 3.0) + aSeed.x * 6.28);
        vec3 corner = R * vec3(position.x, position.y * mix(0.55, 0.85, uShape), 0.0) * uSize * (0.7 + 0.6 * aSeed.y) * vFade;
        vN = R * vec3(0.0, 0.0, 1.0);
        vUv = position.xy;
        vTone = aSeed.z;
        vWorld = p + corner;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${KIT_GLSL}
      uniform vec3 uColA;
      uniform vec3 uColB;
      uniform float uShape;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vN;
      varying float vTone;
      varying float vFade;
      void main() {
        vec2 q = vUv;
        float inside;
        if (uShape < 0.5) {
          // Leaf: pointed oval.
          float k = q.x;
          inside = (1.0 - k * k) * 0.95 - abs(q.y);
        } else {
          // Petal: round with a notch at the tip.
          float notch = smoothstep(0.25, 0.0, abs(q.y)) * smoothstep(0.55, 1.0, q.x) * 0.45;
          inside = 1.0 - length(q * vec2(0.85, 1.0)) - notch;
        }
        if (inside < 0.0 || vFade < 0.01) discard;
        if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec3 base = mix(uColA, uColB, vTone);
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        float ndl = abs(dot(n, uSunDir));
        vec3 V = normalize(vWorld - cameraPosition);
        float back = pow(max(dot(V, uSunDir), 0.0), 3.0);
        vec3 col = base * (uAmbient * 0.55 + uSunColor * (0.45 + 0.55 * ndl));
        col += base * uSunColor * back * 0.9;
        col = mistFade(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

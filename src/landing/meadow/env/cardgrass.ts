// COPIED from .claude/pages/ad/experiments/env-src/cardgrass.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * CARD GRASS — plane-scattered grass + flowers for the anime meadow (v3).
 *
 * The technique (Blender anime-grass tutorials → real time):
 *  - Grass is a few thousand CARDS (alpha-cut planes), each carrying a whole
 *    painted clump of blades in a procedural canvas texture. Nothing is
 *    modelled per blade, so the cost is a few triangles per clump.
 *  - NORMAL TRANSFER: every card is shaded with the GROUND's normal at its
 *    root (Blender: Data Transfer → custom normals from the ground plane;
 *    Genshin/UE: normals pointing up), never its own. Cards therefore light
 *    exactly like the terrain and can never darken each other.
 *  - No shadow casting at all. Cards only RECEIVE the scene's shadow field
 *    (shadow.ts S3 pool + sparse spots) and the drifting cloud shadows.
 *  - Colour is a GROUND-SPACE painting: painted patches (world-xz noise,
 *    shared with the ground shader) + a root→tip gradient up the card. A
 *    card's root is the same colour as the ground under it, so clumps melt
 *    into the floor (no dark contact lines) and only their lime-yellow tips
 *    read as strokes.
 *  - Alpha-to-coverage (MSAA) with a fwidth-sharpened, mip-compensated alpha
 *    (Ben Golus): crisp, non-shimmering blade edges without sorting.
 *  - Breeze: the shared `windAt()` model (steady push, sway, flutter, gust
 *    fronts rolling downwind) bends each card; a small UV shear wiggles the
 *    painted blades inside the card (Rei's "cards that rotate with the UVs
 *    deforming"). Gust fronts flash a pale sheen over the tips.
 *  - LOD: cross clumps collapse to one camera-facing plane beyond `lod`
 *    metres; past `fade` cards GROW DOWN into the ground (BotW-style, no
 *    pop) where the painted ground already carries the far field's colour.
 *    Instances are sorted front-to-back from the eye (early-z).
 *  - Flowers live in the same system: camera-facing head cards + a thin
 *    stem strip (daisies + orange blooms, tiny pink/white clusters), and
 *    fallen cherry petals as flat quads on the grass tops.
 *  - The ATC materials write colour but KEEP the destination alpha (see
 *    KEEP_ALPHA): the lab canvas composites its alpha with the page, so a
 *    coverage alpha < 1 left in the buffer shows as a fringe/tint.
 *
 * Designs: 'cross' = 3 offset, outward-leaned planes per clump (one
 * camera-facing plane past `lod`); 'tuft' = one camera-facing clump card;
 * 'mass' = wide camera-facing "grass mass" strokes beyond ~9 m from the eye
 * and billboarded clumps inside ~5 m (mixed in between).
 *
 * Shared state it touches: it WRITES uniforms.uBreeze (eased toward the
 * breeze target in update()); setLight() only switches the module's own
 * backlit-tip uniform — the palette / uMist come from the kit's light.
 *
 * API (drop-in for the combined scenes):
 *
 *   createCardGrass(scene: THREE.Object3D, options: CardGrassOptions): CardGrass
 *
 *   CardGrassOptions = {
 *     uniforms: KitUniforms;            // shared env (uTime, uSunDir, uBreeze, uMist, …) — v2kit createKit().u
 *     terrain: { heightAt(x, z): number; normalAt?(x, z): THREE.Vector3 };
 *     area: { eye: [x, z]; yaw: number; halfAngle?: number; near?: number; far?: number;
 *             reject?(x, z): boolean };  // the fan of ground the camera sees (yaw 0 = looking to −z)
 *     shadowField?: ShadowUniforms;     // createShadowField(...).uniforms (S3: setMode('spots'))
 *     design?: 'cross' | 'tuft' | 'mass';   // card design (default 'cross')
 *     density?: number;                 // 1 = default clump count, 0.5 … 2
 *     flowers?: 'none' | 'daisy' | 'tiny' | 'petals' | 'all' | ('daisy' | 'tiny' | 'petals')[];
 *     breeze?: 'calm' | 'cold' | 'gusty' | number;  // sets uniforms.uBreeze (eased in update())
 *     tufts?: { count: number; near?: number; far?: number };   // tall foreground tufts
 *     ground?: boolean | { extent: number };   // painted ground under the cards (default on, 1200 m)
 *     fade?: [number, number];          // metres: cards grow down into the ground over this band
 *     lod?: number;                     // metres: cross clumps → one billboard plane beyond this
 *     seed?: number; layer?: number;    // layout seed; three.js layer for every mesh (default 0)
 *   }
 *
 *   CardGrass = {
 *     group: THREE.Group;
 *     update(t: number, dt: number): void;     // eases the breeze; call once per frame
 *     setLight(mode: 'bright' | 'misty'): void;
 *     setDesign(d), setDensity(n), setFlowers(f), setBreeze(b), setVisible(on): void;
 *     stats(): { drawCalls: number; triangles: number; instances: number; flowers: number };
 *     dispose(): void;
 *   }
 */

import * as THREE from 'three';
import { seededRandom } from './lab';
import { KIT_GLSL, type KitUniforms } from './v2kit';
import { SHADOW_SAMPLE_GLSL, noShadowUniforms, type ShadowUniforms } from './shadow';
import { makeGroundGrid } from './grass2';

export type CardDesign = 'cross' | 'tuft' | 'mass';
export type FlowerKind = 'daisy' | 'tiny' | 'petals';
export type FlowerChoice = 'none' | FlowerKind | 'all' | FlowerKind[];
export type BreezeMode = 'calm' | 'cold' | 'gusty';
export type LightMode = 'bright' | 'misty';

export type CardGrassOptions = {
  uniforms: KitUniforms;
  terrain: { heightAt: (x: number, z: number) => number; normalAt?: (x: number, z: number) => THREE.Vector3 };
  area: { eye: [number, number]; yaw: number; halfAngle?: number; near?: number; far?: number; reject?: (x: number, z: number) => boolean };
  shadowField?: ShadowUniforms;
  design?: CardDesign;
  density?: number;
  flowers?: FlowerChoice;
  breeze?: BreezeMode | number;
  tufts?: { count: number; near?: number; far?: number };
  ground?: boolean | { extent: number };
  fade?: [number, number];
  lod?: number;
  seed?: number;
  layer?: number;
};

export type CardGrass = {
  group: THREE.Group;
  update(t: number, dt: number): void;
  setLight(mode: LightMode): void;
  setDesign(design: CardDesign): void;
  setDensity(density: number): void;
  setFlowers(flowers: FlowerChoice): void;
  setBreeze(breeze: BreezeMode | number): void;
  setVisible(on: boolean): void;
  stats(): { drawCalls: number; triangles: number; instances: number; flowers: number };
  dispose(): void;
};

export const BREEZE_LEVEL: Record<BreezeMode, number> = { calm: 0.35, cold: 1, gusty: 1.6 };

/** Clumps per design at density 1 (the fan out to `far`). */
const BASE_COUNT: Record<CardDesign, number> = { cross: 26000, tuft: 34000, mass: 9000 };
/** Card segments: each plane is a 2-row strip (4 triangles). */
const SEGMENTS = 2;
const PLANES: Record<CardDesign, number> = { cross: 3, tuft: 1, mass: 1 };
/** Metres from the eye inside which clumps are thinned (overdraw budget). */
const NEAR_THIN = 5;

// ── procedural textures ─────────────────────────────────────────────────

/**
 * Grass atlas, 2048×1024, non-colour data:
 *   R = painted stroke value (0.5 neutral; a few dark strokes, a few pale
 *       highlight strokes), G = height along the stroke (0 root → 1 tip),
 *   A = coverage.
 * Top row (v 0.5…1): four 512² cells — clumps A, B, C and the tall tuft.
 * Bottom row (v 0…0.5): one 2048×512 "grass mass" band (solid base, ragged
 * top of many short strokes) for the painted-mass billboards.
 */
function makeGrassAtlas(seed: number): THREE.CanvasTexture {
  const W = 2048;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  const rnd = seededRandom(seed);

  /** One tapered, curved blade from (x0,y0) (canvas px, y down) leaning by
   *  `lean` (radians from vertical), `len` px long, base width `w`. */
  const blade = (x0: number, y0: number, len: number, lean: number, curl: number, w: number, value: number) => {
    const tipX = x0 + Math.sin(lean) * len;
    const tipY = y0 - Math.cos(lean) * len;
    // Control point: bends the blade further over toward its tip.
    const cx = x0 + Math.sin(lean * 0.4) * len * 0.55 + curl * len * 0.1;
    const cy = y0 - Math.cos(lean * 0.4) * len * 0.6;
    const nx = Math.cos(lean * 0.4);
    const ny = Math.sin(lean * 0.4);
    const grad = g.createLinearGradient(x0, y0, tipX, tipY);
    const v = Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255);
    grad.addColorStop(0, `rgb(${v},0,0)`);
    grad.addColorStop(1, `rgb(${v},255,0)`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x0 - (w / 2) * nx, y0 - (w / 2) * ny);
    g.quadraticCurveTo(cx - w * 0.3 * nx, cy - w * 0.3 * ny, tipX, tipY);
    g.quadraticCurveTo(cx + w * 0.3 * nx, cy + w * 0.3 * ny, x0 + (w / 2) * nx, y0 + (w / 2) * ny);
    g.closePath();
    g.fill();
  };
  const strokeValue = () => {
    const p = rnd();
    if (p < 0.1) return 0.12 + rnd() * 0.12; // a few darker blades (ref 2)
    if (p > 0.92) return 0.85 + rnd() * 0.15; // pale highlight strokes (ref 1)
    return 0.42 + rnd() * 0.18;
  };

  // Clumps: blades fan out of a narrow base, back (dark, short) to front.
  const clump = (cell: number, n: number, spread: number, tall: number, wBase: number, fan: number) => {
    const ox = cell * 512;
    const blades: { x: number; len: number; lean: number; curl: number; w: number; v: number }[] = [];
    for (let i = 0; i < n; i++) {
      const s = (rnd() * 2 - 1) * (0.6 + 0.4 * rnd());
      const lean = s * fan + (rnd() - 0.5) * 0.25;
      blades.push({
        x: ox + 256 + s * spread + (rnd() - 0.5) * 30,
        len: 512 * tall * (0.45 + 0.55 * Math.pow(rnd(), 0.6)) * (1 - 0.35 * Math.abs(s)),
        lean,
        curl: Math.sign(lean) * (0.5 + rnd()),
        w: wBase * (0.7 + 0.6 * rnd()),
        v: strokeValue(),
      });
    }
    // Paint the darker strokes first (behind), then the rest.
    blades.sort((a, b) => a.v - b.v + (rnd() - 0.5) * 0.3);
    for (const b of blades) blade(b.x, 512 - 2, b.len, b.lean, b.curl, b.w, b.v);
  };
  clump(0, 22, 120, 0.9, 46, 0.7);
  clump(1, 30, 170, 0.78, 40, 0.85);
  clump(2, 18, 90, 0.96, 52, 0.55);
  // Tall foreground tuft: long, broad, strongly arched blades.
  {
    const ox = 3 * 512;
    for (let i = 0; i < 16; i++) {
      const s = (i / 15) * 2 - 1 + (rnd() - 0.5) * 0.15;
      const lean = s * 1.0 + (rnd() - 0.5) * 0.3;
      blade(ox + 256 + s * 40, 510, 512 * (0.6 + 0.38 * rnd()) * (1 - 0.3 * Math.abs(s)), lean, Math.sign(lean) * (1.4 + rnd()), 34 + rnd() * 18, strokeValue());
    }
  }
  // Grass mass band: a solid painted base with a ragged top of short strokes.
  {
    const y0 = 1024;
    const base = g.createLinearGradient(0, y0, 0, y0 - 220);
    base.addColorStop(0, 'rgb(128,0,0)');
    base.addColorStop(1, 'rgb(128,110,0)');
    g.fillStyle = base;
    // Wavy top edge of the solid part (fades out at both ends).
    g.beginPath();
    g.moveTo(0, y0);
    for (let x = 0; x <= W; x += 16) {
      const end = Math.min(x, W - x) / 300;
      const top = 180 + 40 * Math.sin(x * 0.011 + 1.3) + 25 * Math.sin(x * 0.037);
      g.lineTo(x, y0 - Math.max(0, Math.min(1, end)) * top);
    }
    g.lineTo(W, y0);
    g.closePath();
    g.fill();
    for (let i = 0; i < 170; i++) {
      const x = 120 + rnd() * (W - 240);
      const end = Math.min(1, Math.min(x, W - x) / 400);
      const lean = (rnd() - 0.5) * 1.1;
      blade(x, y0 - 120 * end, (150 + rnd() * 330) * end, lean, Math.sign(lean) * rnd(), 34 + rnd() * 22, strokeValue());
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.premultiplyAlpha = false;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Flower atlas, 512×256 sRGB colour, 4×2 cells of 128²:
 *  0 daisy (seen from a low angle: a squashed ring of rays), 1 daisy (more
 *  face-on), 2 orange bloom, 3 orange bud pair, 4 tiny pink cluster,
 *  5 tiny white cluster, 6 / 7 cherry petals (top view).
 */
function makeFlowerAtlas(seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const g = canvas.getContext('2d')!;
  const rnd = seededRandom(seed);
  const cell = (i: number) => [(i % 4) * 128 + 64, Math.floor(i / 4) * 128 + 64] as const;
  const daisy = (i: number, squash: number) => {
    const [cx, cy] = cell(i);
    g.save();
    g.translate(cx, cy);
    g.scale(1, squash);
    const rays = 14;
    for (let k = 0; k < rays; k++) {
      const a = (k / rays) * Math.PI * 2 + rnd() * 0.15;
      g.save();
      g.rotate(a);
      g.fillStyle = k % 3 === 0 ? '#f1eee6' : '#fbfaf5';
      g.beginPath();
      g.ellipse(30, 0, 27 + rnd() * 5, 7.5, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.fillStyle = '#f5b41e';
    g.beginPath();
    g.arc(0, 0, 13, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e08a10';
    g.beginPath();
    g.arc(2, 3, 7, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  daisy(0, 0.5);
  daisy(1, 0.78);
  const bloom = (i: number, r: number, dx: number, dy: number) => {
    const [cx, cy] = cell(i);
    g.save();
    g.translate(cx + dx, cy + dy);
    g.scale(1, 0.7);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      g.fillStyle = k % 2 ? '#f0731c' : '#f88a26';
      g.beginPath();
      g.ellipse(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.55, r * 0.42, a, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#b8430c';
    g.beginPath();
    g.arc(0, 0, r * 0.28, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffd25a';
    g.beginPath();
    g.arc(-r * 0.08, -r * 0.1, r * 0.12, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  bloom(2, 52, 0, 0);
  bloom(3, 30, -22, 10);
  bloom(3, 24, 26, -16);
  const cluster = (i: number, cols: string[]) => {
    const [cx, cy] = cell(i);
    const n = 5;
    for (let k = 0; k < n; k++) {
      const x = cx + (rnd() - 0.5) * 80;
      const y = cy + (rnd() - 0.5) * 56;
      const r = 13 + rnd() * 8;
      const col = cols[k % cols.length];
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2 + rnd();
        g.fillStyle = col;
        g.beginPath();
        g.ellipse(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.38, r * 0.5, r * 0.36, a, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#ffd95c';
      g.beginPath();
      g.arc(x, y, r * 0.2, 0, Math.PI * 2);
      g.fill();
    }
  };
  cluster(4, ['#f7b6cf', '#f4a3c2', '#fbd0df']);
  cluster(5, ['#fbf7f4', '#f2eef6', '#fff8fb']);
  const petal = (i: number, fill: string, edge: string) => {
    const [cx, cy] = cell(i);
    const grad = g.createLinearGradient(cx - 50, cy, cx + 50, cy);
    grad.addColorStop(0, edge);
    grad.addColorStop(1, fill);
    g.fillStyle = grad;
    g.beginPath();
    // An oval petal with the notch at its tip.
    g.moveTo(cx - 52, cy);
    g.bezierCurveTo(cx - 40, cy - 46, cx + 34, cy - 44, cx + 52, cy - 10);
    g.lineTo(cx + 38, cy);
    g.lineTo(cx + 52, cy + 10);
    g.bezierCurveTo(cx + 34, cy + 44, cx - 40, cy + 46, cx - 52, cy);
    g.fill();
  };
  petal(6, '#fde6ee', '#f2a9c3');
  petal(7, '#fff4f7', '#f6c4d6');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ── shared GLSL ─────────────────────────────────────────────────────────

/** Ground-space painting shared by cards, ground and flowers. */
const PAINT_CORE_GLSL = /* glsl */ `
/** 0…1 big painted patches: 1 = warm lime-yellow, 0 = cooler green. */
float paintPatch(vec2 xz) {
  float n = fbm3(xz * 0.05 + 4.0);
  float m = fbm3(xz * 0.17 + vec2(9.0, 2.0));
  return clamp(smoothstep(0.32, 0.62, n) * 0.95 + (m - 0.5) * 0.6 + 0.1, 0.0, 1.0);
}
/** Lambert from the ground normal, flattened (the painting is mostly flat). */
float groundLambert(vec3 n) { return 0.86 + 0.18 * clamp(dot(n, uSunDir), 0.0, 1.0); }
/** mistFade() split for per-vertex use: (haze colour, amount). */
vec4 mistHaze(vec3 worldPos) {
  vec3 d = worldPos - cameraPosition;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-4);
  float f = 1.0 - exp(-dist * mix(0.0016, 0.0055, uMist));
  float sunSide = pow(max(dot(dir, uSunDir), 0.0), mix(6.0, 5.0, uMist));
  return vec4(mix(uHaze, uHorizon, 0.35) + uSunColor * mix(0.12, 0.22, uMist) * sunSide, f);
}
`;

/** Shading shared by cards, ground and flowers (fragment side). */
const CARD_PAINT_GLSL = /* glsl */ `
${PAINT_CORE_GLSL}
uniform float uBacklight; // 0 bright day, 1 misty backlit
/** The painted grass colour at 'tip' (0 = the floor between clumps,
 *  1 = sunlit blade tips), in sun (sv = 1) or the pool's shade (sv = 0). */
vec3 grassPaint(float tip, float pch, float sv, float lambert) {
  vec3 floorLit = mix(srgb(vec3(0.17, 0.45, 0.24)), srgb(vec3(0.36, 0.62, 0.22)), pch);
  vec3 midLit = mix(srgb(vec3(0.29, 0.59, 0.23)), srgb(vec3(0.58, 0.77, 0.24)), pch);
  vec3 tipLit = mix(srgb(vec3(0.60, 0.81, 0.28)), srgb(vec3(0.91, 0.92, 0.46)), pch);
  vec3 lit = mix(floorLit, midLit, smoothstep(0.0, 0.5, tip));
  lit = mix(lit, tipLit, smoothstep(0.45, 0.95, tip));
  vec3 shd = mix(srgb(vec3(0.07, 0.27, 0.27)), srgb(vec3(0.15, 0.42, 0.38)), smoothstep(0.0, 1.0, tip));
  lit *= lambert;
  // Backlit (mist): the lit faces turn away from us — a softer, cooler body.
  lit = mix(lit, lit * vec3(0.86, 0.9, 0.86), uBacklight);
  return mix(shd, lit, sv);
}
/** Full light at a point: tree shadow field × cloud shadow × low-sun fade. */
float sunVis(vec3 p, float above) {
  return shadowAt(p, above).r * cloudShadow(p) * smoothstep(-0.02, 0.15, uSunDir.y);
}
`;

/**
 * Alpha-to-coverage takes the coverage from the fragment's alpha, but the
 * alpha is ALSO stored in the colour buffer — and the lab canvas composites
 * its alpha with the page (a coverage-blended alpha < 1 shows up as a
 * lighter/darker fringe, and an additive object such as the S3 shafts
 * "repairs" it in its own screen footprint). Keep the destination alpha:
 * colour replaces (as opaque), alpha is never written.
 */
const KEEP_ALPHA = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.ZeroFactor,
  blendEquationAlpha: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

// ── module ──────────────────────────────────────────────────────────────

export function createCardGrass(scene: THREE.Object3D, o: CardGrassOptions): CardGrass {
  const u = o.uniforms;
  const shadowU = o.shadowField ?? noShadowUniforms();
  const seed = o.seed ?? 21;
  const layer = o.layer ?? 0;
  const group = new THREE.Group();
  group.name = 'cardgrass';
  scene.add(group);

  const heightAt = o.terrain.heightAt;
  const normalAt =
    o.terrain.normalAt ??
    ((x: number, z: number) => {
      const e = 0.25;
      return new THREE.Vector3(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
    });
  const area = { halfAngle: 0.95, near: 0.6, far: 70, ...o.area };
  const fade = o.fade ?? [area.far * 0.55, area.far * 0.92];

  const uDesign = { value: 0 };
  const uFade = { value: new THREE.Vector2(fade[0], fade[1]) };
  const uLod = { value: o.lod ?? 22 };
  const uBacklight = { value: 0 };
  const uFlowerMask = { value: new THREE.Vector3(1, 0, 0) };

  const atlas = makeGrassAtlas(seed * 13 + 5);
  const flowerAtlas = makeFlowerAtlas(seed * 7 + 3);

  let design: CardDesign = o.design ?? 'cross';
  let density = o.density ?? 1;
  let breezeTarget = typeof o.breeze === 'number' ? o.breeze : BREEZE_LEVEL[o.breeze ?? 'cold'];
  u.uBreeze.value = breezeTarget;

  /** Fan sampler around the eye (log + area mix, open circle near the eye). */
  const fan = (near: number, far: number, half: number) => (rnd: () => number): [number, number] | null => {
    const s = rnd();
    const r = rnd() < 0.5 ? near * Math.pow(far / near, s) : Math.sqrt(near * near + s * (far * far - near * near));
    const open = 1 - THREE.MathUtils.smoothstep(r, 3, 10);
    const a = area.yaw + (rnd() * 2 - 1) * (half + (Math.PI - half) * open);
    const x = area.eye[0] + Math.sin(a) * r;
    const z = area.eye[1] - Math.cos(a) * r;
    if (area.reject?.(x, z)) return null;
    return [x, z];
  };

  // ── cards ───────────────────────────────────────────────────────────
  // Template: per plane a (SEGMENTS+1)×2 vertex strip; position = (x −0.5…0.5, y 0…1, plane index).
  const template = (planes: number) => {
    const pos: number[] = [];
    const idx: number[] = [];
    for (let p = 0; p < planes; p++) {
      const base = pos.length / 3;
      for (let s = 0; s <= SEGMENTS; s++) {
        const y = s / SEGMENTS;
        pos.push(-0.5, y, p, 0.5, y, p);
      }
      for (let s = 0; s < SEGMENTS; s++) {
        const k = base + s * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    return { pos, idx };
  };

  const cardMaterial = new THREE.ShaderMaterial({
    uniforms: { ...u, ...shadowU, tAtlas: { value: atlas }, uDesign, uFade, uLod, uBacklight },
    vertexShader: /* glsl */ `
      ${KIT_GLSL}
      ${PAINT_CORE_GLSL}
      uniform float uDesign; // 0 cross, 1 tuft billboard, 2 mass billboard
      uniform vec2 uFade;
      uniform float uLod;
      attribute vec4 aRoot;  // x y z seed
      attribute vec4 aShape; // height width yaw cell (0..2 clumps, 3 tall tuft, 4 mass band)
      attribute vec2 aGN;    // ground normal xz at the root
      varying vec2 vUv;
      varying vec2 vLocal;   // x −0.5…0.5, y 0…1 on the card
      varying vec3 vWorld;
      varying float vAbove;
      varying vec4 vA; // paint patch, cloud × sun-up, near, detail
      varying vec4 vB; // foreground, fade, gust, clump jitter
      varying vec4 vHaze; // mist colour, mist amount
      varying float vLam;
      void main() {
        float seed = aRoot.w;
        vec3 root = aRoot.xyz;
        float plane = position.z;
        float tuft = step(2.5, aShape.w) * step(aShape.w, 3.5);
        float mass = step(3.5, aShape.w);
        vec3 toCam = cameraPosition - root;
        float dist = length(toCam);
        // Far: grow down into the ground over a ragged band (no pop).
        float fade = 1.0 - smoothstep(uFade.x, uFade.y, dist * (0.85 + 0.3 * fract(seed * 7.31)));
        float h = aShape.x * fade;
        float w = aShape.y;
        bool billboard = uDesign > 0.5 || aShape.w > 2.5;
        // Cross LOD: far clumps keep one camera-facing plane.
        bool lodOne = !billboard && dist > uLod * (0.9 + 0.2 * fract(seed * 3.7));
        if ((lodOne && plane > 0.5) || h < 0.004) {
          gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
          return;
        }
        vec2 camDir = normalize(toCam.xz + 1e-4);
        float yaw;
        if (billboard || lodOne) {
          // Cylindrical billboard (+ a little per-card swing so rows break up).
          yaw = atan(camDir.y, camDir.x) + 1.5708 + (fract(seed * 5.13) - 0.5) * (tuft > 0.5 ? 0.9 : 0.35);
        } else {
          yaw = aShape.z + plane * 1.0472;
        }
        vec2 along = vec2(cos(yaw), sin(yaw));
        vec2 nrm = vec2(-along.y, along.x);
        float x = position.x;
        float y = position.y;
        // Cross planes: offset from the centre and leaned outward, so the
        // clump never shows a thin edge and still reads from above.
        vec2 off = vec2(0.0);
        float lean = 0.0;
        if (!billboard && !lodOne) {
          float side = plane == 1.0 ? -1.0 : 1.0;
          off = nrm * side * w * 0.1 * (0.6 + fract(seed * 11.3));
          lean = side * (0.22 + 0.18 * fract(seed * 17.9));
        }
        float gust;
        vec2 wind = windAt(root.xz, uTime + seed * 0.4, gust);
        float bendK = tuft > 0.5 ? 0.6 : 0.8;
        vec2 bend = wind * bendK;
        float bl = dot(bend, bend);
        float curve = y * y;
        vec3 p = root;
        p.xz += off + along * x * w + nrm * lean * y * h + bend * h * curve;
        p.y += h * y * (1.0 - 0.3 * min(bl, 1.5) * y);
        // UV: atlas cell (top row) or the mass band (bottom row); the top of
        // the card shears a little (blades wiggle inside the card).
        float wig = sin(uTime * (2.2 + fract(seed * 9.1)) + seed * 40.0) * 0.025 * (0.4 + uBreeze) * y * y;
        vec2 cellUv = vec2(x + 0.5 + wig, y);
        if (mass > 0.5) {
          vUv = vec2(clamp(cellUv.x, 0.002, 0.998), cellUv.y * 0.5);
        } else {
          vUv = vec2((aShape.w + clamp(cellUv.x, 0.002, 0.998)) * 0.25, 0.5 + cellUv.y * 0.5);
        }
        vLocal = vec2(x, y);
        vWorld = p;
        vAbove = p.y - root.y;
        // Per-card terms (cheap here, costly per fragment × overdraw).
        float gy = sqrt(max(1.0 - dot(aGN, aGN), 0.0));
        vLam = groundLambert(vec3(aGN.x, gy, aGN.y));
        vA = vec4(paintPatch(root.xz), cloudShadow(root) * smoothstep(-0.02, 0.15, uSunDir.y),
                  1.0 - smoothstep(8.0, 30.0, dist), 1.0 - smoothstep(10.0, 38.0, dist));
        vB = vec4(1.0 - smoothstep(0.8, 6.0, dist), fade, gust, (fract(seed * 53.7) - 0.5) * 0.12);
        vHaze = mistHaze(p);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${KIT_GLSL}
      ${SHADOW_SAMPLE_GLSL}
      ${CARD_PAINT_GLSL}
      uniform sampler2D tAtlas;
      varying vec2 vUv;
      varying vec2 vLocal;
      varying vec3 vWorld;
      varying float vAbove;
      varying vec4 vA;
      varying vec4 vB;
      varying vec4 vHaze;
      varying float vLam;
      void main() {
        vec4 tex = texture2D(tAtlas, vUv);
        // Mip-compensated, fwidth-sharpened alpha for alpha-to-coverage. No
        // discard: zero coverage writes nothing, and early-z keeps working.
        vec2 texel = vUv * vec2(2048.0, 1024.0);
        float mip = max(0.0, 0.5 * log2(max(dot(dFdx(texel), dFdx(texel)), dot(dFdy(texel), dFdy(texel)))));
        float a = tex.a * (1.0 + mip * 0.22);
        a = (a - 0.42) / max(fwidth(a), 1e-4) + 0.5;
        if (uOcclusion > 0.5) { if (a < 0.5) discard; gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        // Empty texels: zero coverage, skip the shading.
        if (a <= 0.0) { gl_FragColor = vec4(0.0); return; }
        float near = vA.z;
        float detail = vA.w;
        // Tip-ness: the card's height AND the painted stroke's own gradient.
        // Far away the strokes flatten into soft painted masses (no speckle).
        float tip = clamp(vLocal.y * 0.55 + tex.g * 0.4 * mix(0.35, 1.0, detail) + 0.05, 0.0, 1.0);
        tip = mix(mix(0.42, 0.62, vLocal.y), tip, mix(0.35, 1.0, detail));
        tip *= mix(0.6, 1.0, vB.y);
        float sv = shadowAt(vWorld, vAbove).r * vA.y;
        vec3 col = grassPaint(tip, vA.x, sv, vLam);
        // Painted stroke value: darker blades + pale highlight strokes (near only).
        float v = (tex.r - 0.5);
        col *= 1.0 + v * mix(0.08, 0.5, near) * smoothstep(0.05, 0.4, tip);
        if (tex.r > 0.84) col = mix(col, srgb(vec3(0.96, 0.96, 0.66)), smoothstep(0.35, 0.9, tex.g) * sv * 0.55 * near);
        // Per-clump value jitter (clumps read as clumps up close, calm far away).
        col *= 1.0 + vB.w * near;
        // Painterly depth (ref 1's bottom band): near the eye the clump BODIES
        // sink into a deeper blue-green while the tips stay lit — a smooth
        // gradient, not blade-on-blade shadow.
        col = mix(col, col * srgb(vec3(0.66, 0.82, 0.86)), vB.x * 0.55 * (1.0 - smoothstep(0.35, 0.9, tip)));
        // Gust sheen: bent clumps flash their pale side (the silver wave).
        col = mix(col, srgb(vec3(0.88, 0.95, 0.62)), vB.z * smoothstep(0.3, 1.0, tip) * 0.4 * sv);
        // Backlit tips glow (the misty light).
        vec3 V = normalize(vWorld - cameraPosition);
        float back = pow(max(dot(V, uSunDir), 0.0), 3.0);
        col += srgb(vec3(0.95, 0.92, 0.55)) * uSunColor * back * sv * smoothstep(0.5, 1.0, tip) * mix(0.25, 0.8, uBacklight);
        col = mix(col, vHaze.rgb, vHaze.a);
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }
    `,
    side: THREE.DoubleSide,
    alphaToCoverage: true,
    ...KEEP_ALPHA,
  });

  let cardGeometry: THREE.InstancedBufferGeometry | null = null;
  const cards = new THREE.Mesh(new THREE.BufferGeometry(), cardMaterial);
  cards.frustumCulled = false;
  cards.layers.set(layer);
  group.add(cards);
  let cardInstances = 0;

  const buildCards = () => {
    const rnd = seededRandom(seed + (design === 'cross' ? 0 : design === 'tuft' ? 1 : 2));
    const count = Math.round(BASE_COUNT[design] * density);
    const tuftCount = o.tufts?.count ?? 40;
    const max = count + tuftCount;
    const roots = new Float32Array(max * 4);
    const shapes = new Float32Array(max * 4);
    const gns = new Float32Array(max * 2);
    const dists = new Float32Array(max);
    let n = 0;
    const place = fan(area.near, area.far, area.halfAngle);
    const put = (x: number, z: number, h: number, w: number, yaw: number, cell: number) => {
      const gn = normalAt(x, z);
      roots.set([x, heightAt(x, z), z, rnd()], n * 4);
      shapes.set([h, w, yaw, cell], n * 4);
      gns.set([gn.x, gn.z], n * 2);
      dists[n] = Math.hypot(x - area.eye[0], z - area.eye[1]);
      n++;
    };
    let guard = 0;
    while (n < count && guard < count * 20) {
      guard++;
      const spot = place(rnd);
      if (!spot) continue;
      const [x, z] = spot;
      const r = Math.hypot(x - area.eye[0], z - area.eye[1]);
      // Overdraw budget: near the eye every card covers a big piece of the
      // screen, so thin the clumps there (the log fan would pile them up).
      if (r < NEAR_THIN && rnd() > Math.max(0.22, Math.pow(r / NEAR_THIN, 1.5))) continue;
      // Clump size grows with distance (keeps screen coverage) — wider faster than taller.
      const grow = 1 + r / (design === 'mass' ? 30 : 22);
      const tall = 1 + r / 70;
      // Height: a slow field so neighbouring clumps share a height.
      const field = 0.5 + 0.5 * Math.sin(x * 0.31 + Math.sin(z * 0.23) * 2.0) * Math.sin(z * 0.27 + 0.7);
      // Mass design: clumps near the eye, mass strokes beyond — mixed over 5…9 m (no seam).
      if (design === 'mass' && rnd() < THREE.MathUtils.smoothstep(r, 5, 9)) {
        put(x, z, (0.26 + 0.14 * field + 0.08 * rnd()) * tall, (1.3 + 0.6 * rnd()) * grow, 0, 4);
      } else if (design === 'mass') {
        // Close to the eye a mass band reads as a flat cut-out: clumps instead (billboarded).
        const h = 0.24 + 0.16 * field + 0.1 * rnd();
        put(x, z, h, h * 1.45 * (0.85 + 0.3 * rnd()), 0, Math.floor(rnd() * 3));
      } else {
        const h = (0.24 + 0.16 * field + 0.1 * rnd()) * tall;
        const w = h * (design === 'tuft' ? 1.45 : 1.2) * (0.85 + 0.3 * rnd()) * grow / tall;
        put(x, z, h, w, rnd() * Math.PI, Math.floor(rnd() * 3));
      }
    }
    // Tall foreground tufts (ref 1/2's bottom edge).
    const tNear = o.tufts?.near ?? 0.9;
    const tFar = o.tufts?.far ?? 8;
    const tplace = fan(tNear, tFar, area.halfAngle * 0.7);
    let t = 0;
    guard = 0;
    while (t < tuftCount && guard < tuftCount * 50) {
      guard++;
      const spot = tplace(rnd);
      if (!spot) continue;
      const h = 0.5 + rnd() * 0.45;
      put(spot[0], spot[1], h, h * (1.1 + rnd() * 0.3), rnd() * Math.PI, 3);
      t++;
    }
    // Front-to-back (early-z rejects the cards behind).
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => dists[a] - dists[b]);
    const R = new Float32Array(n * 4);
    const S = new Float32Array(n * 4);
    const G = new Float32Array(n * 2);
    order.forEach((src, dst) => {
      R.set(roots.subarray(src * 4, src * 4 + 4), dst * 4);
      S.set(shapes.subarray(src * 4, src * 4 + 4), dst * 4);
      G.set(gns.subarray(src * 2, src * 2 + 2), dst * 2);
    });
    const tpl = template(PLANES[design]);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(tpl.pos, 3));
    geometry.setIndex(tpl.idx);
    geometry.setAttribute('aRoot', new THREE.InstancedBufferAttribute(R, 4));
    geometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(S, 4));
    geometry.setAttribute('aGN', new THREE.InstancedBufferAttribute(G, 2));
    geometry.instanceCount = n;
    cardGeometry?.dispose();
    cardGeometry = geometry;
    cards.geometry = geometry;
    cardInstances = n;
    uDesign.value = design === 'cross' ? 0 : design === 'tuft' ? 1 : 2;
  };

  // ── ground ──────────────────────────────────────────────────────────
  let groundGeometry: THREE.BufferGeometry | null = null;
  let groundMaterial: THREE.ShaderMaterial | null = null;
  if (o.ground !== false) {
    const extent = typeof o.ground === 'object' ? o.ground.extent : 1200;
    groundGeometry = makeGroundGrid(area.eye, extent, heightAt);
    groundMaterial = new THREE.ShaderMaterial({
      uniforms: { ...u, ...shadowU, uFade, uBacklight },
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
        ${CARD_PAINT_GLSL}
        uniform vec2 uFade;
        varying vec3 vWorld;
        varying vec3 vNormal;
        void main() {
          if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          float sv = sunVis(vWorld, 0.0);
          float dist = length(vWorld - cameraPosition);
          float pch = paintPatch(vWorld.xz);
          // Near: the floor between clumps (= the cards' roots). Far, where the
          // cards have grown away: the painted mean of the clump tops.
          float far = smoothstep(uFade.x * 0.45, uFade.y, dist);
          float stroke = vnoise(vec2(vWorld.x * 0.6 + vWorld.z * 0.25, vWorld.z * 2.6 - vWorld.x * 0.3));
          float tip = mix(0.08, 0.5, far) + (stroke - 0.5) * mix(0.06, 0.2, far);
          vec3 col = grassPaint(tip, pch, sv, groundLambert(normalize(vNormal)));
          float gust;
          windAt(vWorld.xz, uTime, gust);
          col = mix(col, srgb(vec3(0.88, 0.95, 0.62)), gust * far * 0.3 * sv);
          col *= 1.0 - shadowAt(vWorld, 0.0).b * 0.3;
          col = mistFade(col, vWorld);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.name = 'cardgrass-ground';
    ground.renderOrder = -1;
    ground.layers.set(layer);
    group.add(ground);
  }

  // ── flowers: head card (4 verts) + stem strip (4 verts) per instance ──
  const flowerRnd = seededRandom(seed * 3 + 1);
  /** Per set: count, nearest distance, drift threshold (0 = everywhere). */
  const FLOWER_SETS = [
    { count: 2600, near: 1.2, drift: -0.15 }, // daisy + orange (ref 1)
    { count: 5200, near: 1.0, drift: 0.0 }, // tiny pink / white (ref 2)
    { count: 5200, near: 0.8, drift: -9 }, // fallen cherry petals (ref 3)
  ];
  const FN = FLOWER_SETS.reduce((n, f) => n + f.count, 0);
  const fRoot = new Float32Array(FN * 4);
  const fInfo = new Float32Array(FN * 4);
  const fGN = new Float32Array(FN * 2);
  let fk = 0;
  FLOWER_SETS.forEach((fs, set) => {
    const place = fan(Math.max(area.near, fs.near), Math.min(area.far * 0.6, 45), area.halfAngle * 0.85);
    let made = 0;
    let tries = 0;
    while (made < fs.count && tries < fs.count * 80) {
      tries++;
      const spot = place(flowerRnd);
      if (!spot) continue;
      const [x, z] = spot;
      // Drifts: flowers cluster in soft patches (ref 1's foreground band).
      const drift = Math.sin(x * 0.37 + 1.2 + set) * Math.sin(z * 0.29 + 0.4) + Math.sin(x * 0.11 - z * 0.13) * 0.6;
      if (drift < fs.drift + flowerRnd() * 0.5) continue;
      const r = Math.hypot(x - area.eye[0], z - area.eye[1]);
      const k = flowerRnd();
      let cell: number;
      let size: number;
      let h: number;
      if (set === 0) {
        cell = k < 0.45 ? 0 : k < 0.68 ? 1 : k < 0.86 ? 2 : 3;
        size = cell < 2 ? 0.024 : cell === 2 ? 0.022 : 0.026;
        h = 0.3 + 0.24 * flowerRnd(); // heads just over the clump tops
      } else if (set === 1) {
        cell = k < 0.6 ? 4 : 5;
        size = 0.034;
        h = 0.27 + 0.18 * flowerRnd();
      } else {
        cell = k < 0.5 ? 6 : 7;
        size = 0.022;
        h = 0.3 + 0.16 * flowerRnd(); // resting on the clump tops
      }
      // Far flowers grow a little so the drifts still read as colour.
      size *= (0.75 + 0.5 * flowerRnd()) * (1 + r / 28);
      const gn = normalAt(x, z);
      fRoot.set([x, heightAt(x, z), z, flowerRnd()], fk * 4);
      fInfo.set([h, size, cell, set], fk * 4);
      fGN.set([gn.x, gn.z], fk * 2);
      fk++;
      made++;
    }
  });
  const fg = new THREE.InstancedBufferGeometry();
  fg.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        // head (x, y in −1…1, z = 0 → head flag)
        -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
        // stem (x = side, y = along 0…1, z = 1 → stem flag)
        -1, 0, 1, 1, 0, 1, 1, 1, 1, -1, 1, 1,
      ],
      3,
    ),
  );
  fg.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  fg.setAttribute('aRoot', new THREE.InstancedBufferAttribute(fRoot.slice(0, fk * 4), 4));
  fg.setAttribute('aInfo', new THREE.InstancedBufferAttribute(fInfo.slice(0, fk * 4), 4));
  fg.setAttribute('aGN', new THREE.InstancedBufferAttribute(fGN.slice(0, fk * 2), 2));
  fg.instanceCount = fk;
  const flowerMaterial = new THREE.ShaderMaterial({
    uniforms: { ...u, ...shadowU, tFlowers: { value: flowerAtlas }, uFlowerMask, uFade, uBacklight },
    vertexShader: /* glsl */ `
      ${KIT_GLSL}
      uniform vec3 uFlowerMask;
      uniform vec2 uFade;
      attribute vec4 aRoot; // x y z seed
      attribute vec4 aInfo; // height size cell set
      attribute vec2 aGN;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vGN;
      varying float vStem;
      varying float vAbove;
      void main() {
        float set = aInfo.w;
        float on = set < 0.5 ? uFlowerMask.x : set < 1.5 ? uFlowerMask.y : uFlowerMask.z;
        vec3 root = aRoot.xyz;
        float dist = length(cameraPosition - root);
        float fade = 1.0 - smoothstep(uFade.x * 0.5, uFade.x * 0.8, dist);
        if (on < 0.5 || fade < 0.01) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
        bool petal = set > 1.5;
        float seed = aRoot.w;
        float gust;
        vec2 wind = windAt(root.xz, uTime + seed * 0.4, gust);
        vec2 bend = wind * 0.8 + vec2(0.05, 0.03);
        float h = aInfo.x;
        vec3 head = root + vec3(bend.x * h * 0.9, h * (1.0 - 0.3 * min(dot(bend, bend), 1.6)), bend.y * h * 0.9);
        float size = aInfo.y * fade;
        vec3 p;
        vStem = position.z;
        vec3 toCam = normalize(cameraPosition - head);
        if (petal) {
          // Fallen petal: flat on the grass tops, slowly rocking in the breeze.
          if (position.z > 0.5) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
          head = root + vec3(0.0, h, 0.0);
          float a = seed * 6.2832 + sin(uTime * 0.7 + seed * 20.0) * 0.15 * uBreeze;
          vec3 t = vec3(cos(a), 0.12 * sin(seed * 31.0), sin(a));
          vec3 b = normalize(cross(t, vec3(0.0, 1.0, 0.0) + vec3(wind.x, 0.0, wind.y) * 0.15));
          p = head + (t * position.x + b * position.y * 0.62) * size;
          vUv = position.xy;
        } else if (position.z > 0.5) {
          // Stem: a thin camera-facing strip from the root to the head.
          vec3 along = mix(root, head, position.y);
          vec3 sideV = normalize(cross(head - root, toCam));
          p = along + sideV * position.x * 0.0024 * (1.0 + dist * 0.02);
          vUv = position.xy;
        } else {
          // Head: a camera-facing card (the atlas draws it foreshortened).
          vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
          vec3 up = normalize(cross(toCam, right));
          p = head + (right * position.x + up * position.y) * size;
          vUv = position.xy;
        }
        // Atlas cell (4×2; canvas row 0 is the top, flipY puts it at v 0.5…1).
        float cell = aInfo.z;
        vec2 c = vec2(mod(cell, 4.0), floor(cell / 4.0));
        vec2 local = vUv * 0.5 + 0.5;
        vUv = vec2((c.x + local.x) * 0.25, (1.0 - c.y + local.y) * 0.5);
        if (position.z > 0.5 && !petal) vUv = vec2(-1.0);
        vWorld = p;
        float gy = sqrt(max(1.0 - dot(aGN, aGN), 0.0));
        vGN = vec3(aGN.x, gy, aGN.y);
        vAbove = p.y - root.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${KIT_GLSL}
      ${SHADOW_SAMPLE_GLSL}
      ${CARD_PAINT_GLSL}
      uniform sampler2D tFlowers;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vGN;
      varying float vStem;
      varying float vAbove;
      void main() {
        vec4 c;
        if (vUv.x < 0.0) {
          // Stem: the mid grass tone.
          c = vec4(srgb(vec3(0.36, 0.64, 0.26)), 1.0);
        } else {
          c = texture2D(tFlowers, vUv);
        }
        float a = (c.a - 0.45) / max(fwidth(c.a), 1e-4) + 0.5;
        if (a <= 0.0) discard;
        if (uOcclusion > 0.5) { if (a < 0.5) discard; gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        float sv = sunVis(vWorld, vAbove);
        float lam = groundLambert(normalize(vGN));
        // Shade: the cool blue-green of the pool; sun: near-white light.
        vec3 lightC = mix(uAmbient * 0.48 + srgb(vec3(0.0, 0.08, 0.08)), uSunColor * lam * 1.02, sv);
        vec3 col = c.rgb * lightC;
        col = mistFade(col, vWorld);
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }
    `,
    side: THREE.DoubleSide,
    alphaToCoverage: true,
    ...KEEP_ALPHA,
  });
  const flowers = new THREE.Mesh(fg, flowerMaterial);
  flowers.frustumCulled = false;
  flowers.layers.set(layer);
  group.add(flowers);

  const applyFlowers = (f: FlowerChoice) => {
    const list: FlowerKind[] = f === 'none' ? [] : f === 'all' ? ['daisy', 'tiny', 'petals'] : Array.isArray(f) ? f : [f];
    uFlowerMask.value.set(list.includes('daisy') ? 1 : 0, list.includes('tiny') ? 1 : 0, list.includes('petals') ? 1 : 0);
    flowers.visible = list.length > 0;
  };
  applyFlowers(o.flowers ?? 'daisy');
  buildCards();

  const setBreeze = (b: BreezeMode | number) => {
    breezeTarget = typeof b === 'number' ? b : BREEZE_LEVEL[b];
  };

  return {
    group,
    update(_t, dt) {
      // Ease the breeze so a calm → gusty switch rolls in.
      const k = 1 - Math.exp(-dt * 1.5);
      u.uBreeze.value += (breezeTarget - u.uBreeze.value) * k;
    },
    setLight(mode) {
      uBacklight.value = mode === 'misty' ? 1 : 0;
    },
    setDesign(d) {
      if (d === design) return;
      design = d;
      buildCards();
    },
    setDensity(d) {
      if (d === density) return;
      density = d;
      buildCards();
    },
    setFlowers: applyFlowers,
    setBreeze,
    setVisible(on) {
      group.visible = on;
    },
    stats() {
      const m = uFlowerMask.value;
      // Flower instances of the enabled sets (≈ a third each).
      const fl = flowers.visible ? Math.round(FLOWER_SETS[0].count * m.x + FLOWER_SETS[1].count * m.y + FLOWER_SETS[2].count * m.z) : 0;
      const cardTris = cardInstances * PLANES[design] * SEGMENTS * 2;
      const groundTris = groundGeometry ? (groundGeometry.index?.count ?? 0) / 3 : 0;
      return {
        drawCalls: 1 + (groundGeometry ? 1 : 0) + (flowers.visible ? 1 : 0),
        triangles: cardTris + groundTris + (flowers.visible ? fk * 4 : 0),
        instances: cardInstances,
        flowers: fl,
      };
    },
    dispose() {
      group.removeFromParent();
      cardGeometry?.dispose();
      cards.geometry.dispose();
      cardMaterial.dispose();
      groundGeometry?.dispose();
      groundMaterial?.dispose();
      fg.dispose();
      flowerMaterial.dispose();
      atlas.dispose();
      flowerAtlas.dispose();
    },
  };
}

// COPIED from .claude/pages/ad/experiments/gtr-guitar.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * EXPERIMENT — a procedural acoustic guitar for the "Play the guitar" stage.
 * Shared by gtr-01 (model), gtr-02 (strings) and gtr-03 (anime grade).
 * No image or model files: every texture is painted on a canvas here.
 *
 * Guitar frame (metres): origin = bottom centre of the body ON the top
 * plane; +y runs up the neck to the headstock, +z points out of the
 * soundboard, the bass side (low E) is at −x — a right-handed guitar seen
 * from the front with its neck up.
 */
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export type BodyStyle = 'dreadnought' | 'classical';
export type Finish = 'natural' | 'sunburst' | 'satin';
export type StringMode = 0 | 1 | 2; // 0 slow-motion standing wave, 1 real-speed blur, 2 rolling shutter

/** Open strings, low E → high e (MIDI). */
export const OPEN_MIDI = [40, 45, 50, 55, 59, 64];

type Spec = {
  length: number;
  outline: [number, number][]; // right half, bottom → top
  depthTail: number;
  depthHeel: number;
  soundholeR: number;
  soundholeY: number;
  scale: number;
  jointFret: number;
  frets: number;
  nutWidth: number;
  width12: number;
  spreadNut: number;
  spreadSaddle: number;
  gauges: number[]; // diameters, metres
  wound: boolean[];
  nylon: boolean;
  radius: number; // fingerboard radius, Infinity = flat
  headAngle: number;
};

export const SPECS: Record<BodyStyle, Spec> = {
  // Martin D-style: 20" body, 15 5/8" lower bout, 25.4" scale, 14-fret neck.
  dreadnought: {
    length: 0.508,
    outline: [
      [0, 0], [0.07, 0.006], [0.13, 0.026], [0.172, 0.06], [0.194, 0.11], [0.1985, 0.155],
      [0.192, 0.205], [0.172, 0.255], [0.149, 0.292], [0.138, 0.316], [0.139, 0.342],
      [0.144, 0.375], [0.146, 0.405], [0.143, 0.44], [0.131, 0.474], [0.1, 0.498], [0.05, 0.506], [0, 0.508],
    ],
    depthTail: 0.122,
    depthHeel: 0.102,
    soundholeR: 0.0505,
    soundholeY: 0.358,
    scale: 0.645,
    jointFret: 14,
    frets: 20,
    nutWidth: 0.043,
    width12: 0.054,
    spreadNut: 0.0355,
    spreadSaddle: 0.054,
    gauges: [1.35, 1.07, 0.81, 0.61, 0.41, 0.3].map((mm) => mm / 1000),
    wound: [true, true, true, true, false, false],
    nylon: false,
    radius: 0.406,
    headAngle: 0.24,
  },
  // Torres-style classical: 485–495 mm body, 650 scale, 12-fret neck, slotted head.
  classical: {
    length: 0.49,
    outline: [
      [0, 0], [0.065, 0.006], [0.12, 0.025], [0.158, 0.056], [0.178, 0.095], [0.1825, 0.135],
      [0.177, 0.18], [0.16, 0.225], [0.136, 0.265], [0.12, 0.296], [0.121, 0.328], [0.132, 0.36],
      [0.14, 0.395], [0.137, 0.43], [0.12, 0.46], [0.087, 0.481], [0.045, 0.488], [0, 0.49],
    ],
    depthTail: 0.1,
    depthHeel: 0.094,
    soundholeR: 0.043,
    soundholeY: 0.345,
    scale: 0.65,
    jointFret: 12,
    frets: 18,
    nutWidth: 0.052,
    width12: 0.061,
    spreadNut: 0.043,
    spreadSaddle: 0.058,
    gauges: [1.07, 0.89, 0.76, 1.04, 0.82, 0.71].map((mm) => mm / 1000),
    wound: [true, true, true, false, false, false],
    nylon: true,
    radius: Infinity,
    headAngle: 0.21,
  },
};

// ── helpers ─────────────────────────────────────────────────────────────

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Quads between consecutive cross-sections (same point count each). */
function loft(sections: THREE.Vector3[][], closed = false, crease = 0): THREE.BufferGeometry {
  const ring = sections[0].length;
  const positions: number[] = [];
  const uvs: number[] = [];
  sections.forEach((section, i) =>
    section.forEach((p, j) => {
      positions.push(p.x, p.y, p.z);
      uvs.push(j / (ring - 1), i / (sections.length - 1));
    }),
  );
  const index: number[] = [];
  const span = closed ? ring : ring - 1;
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < span; j++) {
      const a = i * ring + j;
      const b = i * ring + ((j + 1) % ring);
      const c = (i + 1) * ring + j;
      const d = (i + 1) * ring + ((j + 1) % ring);
      index.push(a, b, c, b, d, c);
    }
  }
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  if (crease > 0) geometry = toCreasedNormals(geometry, crease);
  else geometry.computeVertexNormals();
  return geometry;
}

/** Flip winding (and normals) when the first normal disagrees with `outward`. */
function orient(geometry: THREE.BufferGeometry, outward: THREE.Vector3, probe = 0): THREE.BufferGeometry {
  const normal = geometry.getAttribute('normal');
  const n = v3(normal.getX(probe), normal.getY(probe), normal.getZ(probe));
  if (n.dot(outward) >= 0) return geometry;
  const index = geometry.getIndex();
  if (index) {
    const array = index.array as Uint32Array | Uint16Array;
    for (let i = 0; i < array.length; i += 3) {
      const t = array[i + 1];
      array[i + 1] = array[i + 2];
      array[i + 2] = t;
    }
    index.needsUpdate = true;
  } else {
    const pos = geometry.getAttribute('position');
    const attrs = Object.values(geometry.attributes);
    for (let i = 0; i < pos.count; i += 3) {
      for (const attr of attrs) {
        for (let k = 0; k < attr.itemSize; k++) {
          const a = attr.getComponent(i + 1, k);
          attr.setComponent(i + 1, k, attr.getComponent(i + 2, k));
          attr.setComponent(i + 2, k, a);
        }
      }
    }
  }
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
  normal.needsUpdate = true;
  return geometry;
}

function signedArea(points: THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function insetPolygon(points: THREE.Vector2[], distance: number): THREE.Vector2[] {
  const sign = signedArea(points) > 0 ? 1 : -1;
  const n = points.length;
  return points.map((point, i) => {
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const t = next.clone().sub(prev).normalize();
    const normal = new THREE.Vector2(-t.y * sign, t.x * sign);
    return point.clone().addScaledVector(normal, distance);
  });
}

// ── canvas painting ─────────────────────────────────────────────────────

/** Texture space of the body canvases: x ∈ [−CW/2, CW/2], y ∈ [0, CH]. */
const CW = 0.42;
const CH = 0.525;
const PX = 2048 / CW; // pixels per metre (~4.9 px/mm)
const CANVAS_W = 2048;
const CANVAS_H = Math.round(CH * PX);
const toPx = (x: number, y: number): [number, number] => [(x + CW / 2) * PX, (CH - y) * PX];

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Straight vertical grain, book-matched about the centre line. */
function paintGrain(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: string,
  dark: [number, number, number],
  light: [number, number, number],
  density: number,
  wave: number,
  seed: number,
  contrast = 1,
) {
  const random = seededRandom(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const half = w / 2;
  g.save();
  g.beginPath();
  g.rect(half, 0, half, h);
  g.clip();
  // broad tone bands
  for (let i = 0; i < 26; i++) {
    const x = half + random() * half;
    const bw = 20 + random() * 120;
    const tone = random() < 0.5 ? dark : light;
    g.fillStyle = `rgba(${tone[0]},${tone[1]},${tone[2]},${(0.04 + random() * 0.08) * contrast})`;
    g.fillRect(x, 0, bw, h);
  }
  const lines = Math.round(half * density);
  for (let i = 0; i < lines; i++) {
    const x0 = half + (i / lines) * half + random() * 2;
    const amp = wave * (0.4 + random());
    const freq = 0.0015 + random() * 0.003;
    const phase = random() * 6.28;
    const isDark = random() < 0.7;
    const tone = isDark ? dark : light;
    g.strokeStyle = `rgba(${tone[0]},${tone[1]},${tone[2]},${(isDark ? 0.12 + random() * 0.3 : 0.05 + random() * 0.1) * contrast})`;
    g.lineWidth = 0.6 + random() * (isDark ? 1.6 : 1);
    g.beginPath();
    for (let y = -10; y <= h + 40; y += 40) {
      const x = x0 + Math.sin(y * freq + phase) * amp + Math.sin(y * 0.0007 + phase * 2) * amp * 2;
      if (y < 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.restore();
  // book-match: mirror the right half onto the left
  g.save();
  g.translate(half, 0);
  g.scale(-1, 1);
  g.drawImage(g.canvas, half, 0, half, h, 0, 0, half, h);
  g.restore();
}

function outlinePath(g: CanvasRenderingContext2D, outline: THREE.Vector2[]) {
  g.beginPath();
  outline.forEach((p, i) => {
    const [x, y] = toPx(p.x, p.y);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.closePath();
}

type TopPaint = { finish: Finish; style: BodyStyle; outline: THREE.Vector2[]; spec: Spec };

function paintTop({ finish, style, outline, spec }: TopPaint): HTMLCanvasElement {
  const { c, g } = canvas(CANVAS_W, CANVAS_H);
  const cedar = finish === 'satin';
  paintGrain(
    g, CANVAS_W, CANVAS_H,
    cedar ? '#b5713f' : '#e3c48b',
    cedar ? [110, 52, 22] : [168, 116, 58],
    cedar ? [235, 170, 120] : [255, 236, 196],
    cedar ? 0.24 : 0.3,
    1.6,
    style === 'dreadnought' ? 21 : 33,
    0.8,
  );
  // silking: medullary rays across the grain
  const random = seededRandom(9);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(255,245,220,${0.03 + random() * 0.05})`;
    g.fillRect(random() * CANVAS_W, random() * CANVAS_H, 8 + random() * 40, 1 + random() * 1.5);
  }
  g.save();
  outlinePath(g, outline);
  g.clip();
  if (finish === 'sunburst') {
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgba(230,150,60,0.55)';
    g.fillRect(0, 0, CANVAS_W, CANVAS_H);
    g.globalCompositeOperation = 'source-over';
    g.filter = 'blur(60px)';
    outlinePath(g, outline);
    g.lineWidth = 300;
    g.strokeStyle = 'rgba(60,24,6,0.9)';
    g.stroke();
    g.lineWidth = 120;
    g.strokeStyle = 'rgba(20,8,2,0.95)';
    g.stroke();
    g.filter = 'none';
  }
  // purfling bands, measured inwards from the edge (mm)
  const band = (mm: number, color: string, dash?: number[]) => {
    outlinePath(g, outline);
    g.lineWidth = 2 * mm * (PX / 1000);
    g.strokeStyle = color;
    g.setLineDash(dash ?? []);
    g.stroke();
    g.setLineDash([]);
  };
  if (style === 'dreadnought') {
    band(5.2, '#15100b');
    band(4.6, '#e9dcc0');
    band(4.6, 'rgba(60,34,16,0.55)', [4, 4]);
    band(2.5, '#15100b');
    band(1.9, '#efe6d0');
    band(1.3, '#15100b');
  } else {
    band(4.5, '#2b170c');
    band(3.8, '#d9b88a');
    band(3.8, '#5a2c12', [3, 3]);
    band(2.2, '#24130a');
    band(1.4, '#c7965f');
  }
  g.restore();

  // rosette
  const [cx, cy] = toPx(0, spec.soundholeY);
  const mm = PX / 1000;
  const r0 = spec.soundholeR * PX;
  const ring = (inner: number, outer: number, color: string) => {
    g.beginPath();
    g.arc(cx, cy, r0 + outer * mm, 0, Math.PI * 2);
    g.arc(cx, cy, r0 + inner * mm, 0, Math.PI * 2, true);
    g.fillStyle = color;
    g.fill();
  };
  if (style === 'dreadnought') {
    ring(4, 5, '#120c08');
    ring(5, 5.8, '#efe6d2');
    ring(5.8, 6.6, '#120c08');
    ring(6.6, 11.6, '#20323a'); // abalone sits here (separate iridescent mesh)
    ring(11.6, 12.4, '#120c08');
    ring(12.4, 13.2, '#efe6d2');
    ring(13.2, 14, '#120c08');
  } else {
    // Spanish mosaic: a 9 × 7 tile motif repeated round the ring
    const inner = r0 + 6 * mm;
    const outer = r0 + 17 * mm;
    ring(2.5, 4, '#2a160a');
    ring(4, 5, '#d8c29a');
    ring(5, 6, '#2a160a');
    ring(17, 18, '#2a160a');
    ring(18, 19, '#d8c29a');
    ring(19, 20.5, '#2a160a');
    const img = g.getImageData(Math.floor(cx - outer), Math.floor(cy - outer), Math.ceil(outer * 2), Math.ceil(outer * 2));
    const motif = [
      '..oo.oo..', '.o.gg.o..', 'o.gRRg.o.', 'ogRYYRgo.', 'o.gRRg.o.', '.o.gg.o..', '..oo.oo..',
    ];
    const colors: Record<string, [number, number, number]> = {
      '.': [226, 205, 160], o: [52, 26, 12], g: [58, 98, 66], R: [150, 38, 30], Y: [214, 170, 70],
    };
    const tiles = 64;
    for (let py = 0; py < img.height; py++) {
      for (let px = 0; px < img.width; px++) {
        const dx = px + Math.floor(cx - outer) - cx;
        const dy = py + Math.floor(cy - outer) - cy;
        const r = Math.hypot(dx, dy);
        if (r < inner || r > outer) continue;
        const a = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
        const col = Math.floor(((a * tiles) % 1) * 9);
        const row = Math.floor(((r - inner) / (outer - inner)) * 7);
        const rgb = colors[motif[Math.min(6, row)][col]];
        const k = (py * img.width + px) * 4;
        img.data[k] = rgb[0];
        img.data[k + 1] = rgb[1];
        img.data[k + 2] = rgb[2];
      }
    }
    g.putImageData(img, Math.floor(cx - outer), Math.floor(cy - outer));
  }
  return c;
}

type WoodKind = 'rosewood' | 'mahogany' | 'ebony' | 'neck' | 'darkmahogany';

function paintWood(kind: WoodKind, w = 1024, h = 2048, seed = 5): HTMLCanvasElement {
  const { c, g } = canvas(w, h);
  if (kind === 'rosewood') {
    paintGrain(g, w, h, '#4d2416', [24, 8, 4], [150, 72, 38], 0.18, 9, seed, 1.5);
    // rosewood's darker, irregular streaks
    const random = seededRandom(seed + 7);
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(18,6,3,${0.15 + random() * 0.3})`;
      g.lineWidth = 2 + random() * 9;
      g.beginPath();
      const x = random() * w;
      for (let y = 0; y <= h; y += 64) g.lineTo(x + Math.sin(y * 0.004 + i) * 14 + random() * 4, y);
      g.stroke();
    }
  } else if (kind === 'mahogany' || kind === 'darkmahogany' || kind === 'neck') {
    const darker = kind === 'darkmahogany';
    paintGrain(
      g, w, h,
      darker ? '#5a2a14' : '#8a4422',
      darker ? [36, 12, 4] : [70, 26, 10],
      darker ? [150, 80, 40] : [200, 118, 70],
      0.22, 3, seed, 1.1,
    );
    // ribbon figure: soft alternating bands
    for (let x = 0; x < w; x += 46) {
      const grad = g.createLinearGradient(x, 0, x + 46, 0);
      grad.addColorStop(0, 'rgba(255,190,140,0.0)');
      grad.addColorStop(0.5, 'rgba(255,190,140,0.07)');
      grad.addColorStop(1, 'rgba(255,190,140,0.0)');
      g.fillStyle = grad;
      g.fillRect(x, 0, 46, h);
    }
  } else {
    paintGrain(g, w, h, '#191210', [4, 2, 1], [70, 48, 36], 0.16, 4, seed, 0.9);
  }
  return c;
}

function paintTortoise(): HTMLCanvasElement {
  const { c, g } = canvas(512, 512);
  const random = seededRandom(77);
  g.fillStyle = '#5e260c';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 220; i++) {
    const x = random() * 512;
    const y = random() * 512;
    const r = 6 + random() * 28;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const amber = random() < 0.6;
    grad.addColorStop(0, amber ? 'rgba(200,104,34,0.5)' : 'rgba(26,8,2,0.55)');
    grad.addColorStop(1, 'rgba(60,20,6,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(x, y, r * 2.4, r * 0.55, 0.5 + random() * 0.4, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

function paintAbalone(): HTMLCanvasElement {
  const { c, g } = canvas(1024, 64);
  const random = seededRandom(91);
  // paua: deep teal/green with violet and pink flashes, in elongated patches
  const palette = ['#1f6f6a', '#2a8f7a', '#3b5fa0', '#5b3f8f', '#8a4f8a', '#2f7f9f', '#6fa08a', '#c08aa0'];
  g.fillStyle = '#1d4f5a';
  g.fillRect(0, 0, 1024, 64);
  for (let i = 0; i < 420; i++) {
    const x = random() * 1024;
    const y = random() * 64;
    const rx = 6 + random() * 26;
    const grad = g.createRadialGradient(x, y, 0, x, y, rx);
    const col = palette[Math.floor(random() * palette.length)];
    grad.addColorStop(0, col);
    grad.addColorStop(1, col + '00');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(x, y, rx, rx * (0.25 + random() * 0.4), (random() - 0.5) * 0.6, 0, Math.PI * 2);
    g.fill();
  }
  // fine bright flecks
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(220,255,240,${0.08 + random() * 0.2})`;
    g.fillRect(random() * 1024, random() * 64, 1 + random() * 3, 1);
  }
  return c;
}

// ── string shader ───────────────────────────────────────────────────────

const STRING_DISPLACEMENT = /* glsl */ `
uniform float uTime;
uniform float uPluckT;
uniform float uAmp;
uniform float uBeta;
uniform float uXf;
uniform float uFv;
uniform float uTau;
uniform float uMode;
uniform float uPress;
uniform float uPressDepth;
uniform float uDamp;
uniform float uRadius;
attribute float aU;
varying float vAlpha;
varying float vU;
varying float vEnv;
const float SPI = 3.14159265;
// Returns displacement (x), envelope (y).
vec2 stringMotion(float u) {
  if (u >= uXf || uAmp <= 0.0) return vec2(0.0);
  float s = u / uXf;
  float t = max(0.0, uTime - uPluckT);
  float k = 2.0 / (SPI * SPI * uBeta * (1.0 - uBeta));
  float disp = 0.0;
  float env = 0.0;
  for (int i = 1; i <= 10; i++) {
    float n = float(i);
    float c = sin(n * SPI * uBeta) / (n * n);
    float decay = exp(-t * (1.0 + 0.35 * (n - 1.0)) / uTau);
    float shape = c * sin(n * SPI * s) * decay;
    env += shape;
    float phase;
    if (uMode < 1.5) {
      // slowed standing wave: only harmonics the frame rate can show
      if (n * uFv > 27.0) continue;
      phase = 2.0 * SPI * n * uFv * t;
    } else {
      // rolling shutter: phase also runs along the string
      phase = 2.0 * SPI * n * (0.9 * t + 2.6 * u);
    }
    disp += shape * cos(phase);
  }
  return vec2(disp, abs(env)) * k * uAmp * uDamp;
}
`;

// ── the guitar ──────────────────────────────────────────────────────────

export type MeshRole =
  | 'top' | 'back' | 'sides' | 'interior' | 'binding' | 'neck' | 'fingerboard' | 'veneer'
  | 'fret' | 'pearl' | 'abalone' | 'bone' | 'bridge' | 'pin' | 'metal' | 'button' | 'pickguard'
  | 'string' | 'stringStatic';

export type StringVis = {
  mesh: THREE.Mesh;
  ribbon: THREE.Mesh;
  uniforms: Record<string, { value: number }>;
  start: THREE.Vector3; // saddle end (u = 0)
  end: THREE.Vector3; // nut end (u = 1)
  radius: number;
  pluckAt: THREE.Vector3; // world-ish (guitar frame) point last plucked
  baseMaterial: THREE.MeshPhysicalMaterial;
};

export type Layout = {
  saddleY: number;
  nutY: number;
  fbTop: number;
  fretTop: number;
  fretY: (f: number) => number;
  fbWidth: (y: number) => number;
  soundholeY: number;
  soundholeR: number;
  bodyLength: number;
  stringX: (i: number, u: number) => number;
  stringZ: (i: number, u: number) => number;
  headTop: THREE.Vector3;
};

export type Guitar = {
  group: THREE.Group;
  style: BodyStyle;
  spec: Spec;
  layout: Layout;
  strings: StringVis[];
  parts: { mesh: THREE.Mesh; role: MeshRole }[];
  setFinish(finish: Finish): void;
  setStringMode(mode: StringMode): void;
  pluck(string: number, fret: number, velocity: number, time: number): void;
  release(string: number, time: number, damp?: boolean): void;
  update(time: number): void;
  dispose(): void;
};

type GuitarOptions = { finish?: Finish; envMapIntensity?: number };

export function buildGuitar(style: BodyStyle, options: GuitarOptions = {}): Guitar {
  const spec = SPECS[style];
  const group = new THREE.Group();
  group.name = `guitar-${style}`;
  const parts: { mesh: THREE.Mesh; role: MeshRole }[] = [];
  const disposables: { dispose(): void }[] = [];
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, role: MeshRole, parent: THREE.Object3D = group) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.role = role;
    parent.add(mesh);
    parts.push({ mesh, role });
    disposables.push(geometry);
    return mesh;
  };

  // ── outline ──
  const half = spec.outline.map(([x, y]) => v3(x, y, 0));
  const loop = [...half, ...half.slice(1, -1).reverse().map((p) => v3(-p.x, p.y, 0))];
  const curve = new THREE.CatmullRomCurve3(loop, true, 'centripetal');
  const outline3 = curve.getSpacedPoints(320).slice(0, -1);
  const outline = outline3.map((p) => new THREE.Vector2(p.x, p.y));
  const L = spec.length;
  const depth = (y: number) => THREE.MathUtils.lerp(spec.depthTail, spec.depthHeel, y / L);

  // ── layout ──
  const saddleY = L - spec.scale * Math.pow(2, -spec.jointFret / 12);
  const nutY = saddleY + spec.scale;
  const fbThick = 0.0065;
  const crown = 0.0012;
  const fbTop = fbThick;
  const fretTop = fbTop + crown;
  const fretY = (f: number) => saddleY + spec.scale * Math.pow(2, -f / 12);
  const fbEndY = fretY(spec.frets) - 0.005;
  const y12 = fretY(12);
  const fbWidth = (y: number) => spec.nutWidth + ((nutY - y) / (nutY - y12)) * (spec.width12 - spec.nutWidth);
  const sag = (x: number) => (Number.isFinite(spec.radius) ? (x * x) / (2 * spec.radius) : 0);
  const stringX = (i: number, u: number) =>
    THREE.MathUtils.lerp(-spec.spreadSaddle / 2 + (i / 5) * spec.spreadSaddle, -spec.spreadNut / 2 + (i / 5) * spec.spreadNut, u);
  const saddleTop = 0.0122;
  const nutBottom = fretTop + 0.0005;
  const stringZ = (i: number, u: number) => {
    const r = spec.gauges[i] / 2;
    const zs = saddleTop + r - sag(stringX(i, 0));
    const zn = nutBottom + r - sag(stringX(i, 1));
    return THREE.MathUtils.lerp(zs, zn, u);
  };

  // ── materials ──
  const envI = options.envMapIntensity ?? 1;
  const physical = (p: THREE.MeshPhysicalMaterialParameters) => {
    const m = new THREE.MeshPhysicalMaterial({ envMapIntensity: envI, ...p });
    disposables.push(m);
    return m;
  };
  const topMat = physical({ roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.035, bumpScale: 0.6 });
  const backMat = physical({ roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.04, bumpScale: 0.4 });
  const sideMat = physical({ roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.04 });
  const neckMat = physical({ roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.12 });
  const fbMat = physical({ roughness: 0.55, clearcoat: 0.1, clearcoatRoughness: 0.4, envMapIntensity: envI * 0.5 });
  const veneerMat = physical({ roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 });
  const interiorMat = physical({ color: 0x1c0f07, roughness: 0.95, side: THREE.DoubleSide, envMapIntensity: envI * 0.3 });
  const bindingMat = physical({
    color: style === 'dreadnought' ? 0xeee3c8 : 0x4a2412,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
  });
  const fretMat = physical({ color: 0xd8d4cc, metalness: 1, roughness: 0.32 });
  const pearlMat = physical({
    color: 0xf4efe6,
    roughness: 0.25,
    iridescence: 1,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [200, 700],
    clearcoat: 1,
  });
  const abaloneTex = tex(paintAbalone());
  disposables.push(abaloneTex);
  const abaloneMat = physical({
    map: abaloneTex,
    roughness: 0.18,
    metalness: 0.2,
    iridescence: 1,
    iridescenceIOR: 1.8,
    iridescenceThicknessRange: [250, 900],
    clearcoat: 1,
    clearcoatRoughness: 0.02,
  });
  const boneMat = physical({ color: 0xf1e8d4, roughness: 0.35, sheen: 0.3, sheenColor: 0xffffff });
  const bridgeMat = physical({ roughness: 0.45, clearcoat: 0.35, clearcoatRoughness: 0.2, envMapIntensity: envI * 0.5 });
  const metalMat = physical({
    color: style === 'dreadnought' ? 0xdedbd6 : 0xd9b467,
    metalness: 1,
    roughness: 0.16,
  });
  const buttonMat = style === 'dreadnought' ? metalMat : physical({ color: 0xf2ece0, roughness: 0.2, iridescence: 0.6, clearcoat: 1 });
  const pinMat = physical({ color: 0x15100d, roughness: 0.3, clearcoat: 0.8, envMapIntensity: envI * 0.6 });
  const tortoiseTex = tex(paintTortoise());
  disposables.push(tortoiseTex);
  const guardMat = physical({ map: tortoiseTex, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.08, envMapIntensity: envI * 0.18 });

  // wood textures (re-painted by setFinish)
  const textures: THREE.Texture[] = [];
  const setFinish = (finish: Finish) => {
    for (const t of textures.splice(0)) t.dispose();
    const top = tex(paintTop({ finish, style, outline, spec }));
    const backKind: WoodKind = finish === 'natural' ? 'rosewood' : finish === 'sunburst' ? 'darkmahogany' : 'mahogany';
    const back = tex(paintWood(backKind, 1024, 2048, style === 'dreadnought' ? 5 : 6));
    const sides = back.clone();
    sides.needsUpdate = true;
    const neck = tex(paintWood(finish === 'sunburst' ? 'darkmahogany' : 'neck', 512, 1024, 8));
    const fb = tex(paintWood(style === 'dreadnought' ? 'ebony' : 'rosewood', 256, 1024, 12));
    textures.push(top, back, sides, neck, fb);
    topMat.map = top;
    topMat.bumpMap = top;
    backMat.map = back;
    backMat.bumpMap = back;
    sideMat.map = sides;
    neckMat.map = neck;
    fbMat.map = fb;
    veneerMat.map = fb;
    bridgeMat.map = fb;
    const satin = finish === 'satin';
    for (const m of [topMat, backMat, sideMat, neckMat]) {
      m.clearcoat = satin ? 0.35 : 1;
      m.clearcoatRoughness = satin ? 0.32 : 0.035;
      m.roughness = satin ? 0.62 : 0.42;
      m.needsUpdate = true;
    }
    for (const m of [fbMat, veneerMat, bridgeMat]) m.needsUpdate = true;
  };
  setFinish(options.finish ?? 'natural');

  // ── body ──
  const bodyUV = (geometry: THREE.BufferGeometry) => {
    const pos = geometry.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) + CW / 2) / CW;
      uv[i * 2 + 1] = pos.getY(i) / CH;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  };
  const topShape = new THREE.Shape(outline);
  const hole = new THREE.Path();
  hole.absarc(0, spec.soundholeY, spec.soundholeR, 0, Math.PI * 2, true);
  topShape.holes.push(hole);
  const topGeo = new THREE.ShapeGeometry(topShape, 64);
  bodyUV(topGeo);
  add(topGeo, topMat, 'top');

  const backGeo = new THREE.ShapeGeometry(new THREE.Shape(outline), 8);
  bodyUV(backGeo);
  {
    const pos = backGeo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setZ(i, -depth(pos.getY(i)));
    backGeo.computeVertexNormals();
    orient(backGeo, v3(0, 0, -1));
  }
  add(backGeo, backMat, 'back');

  // ribs, outside and (dark) inside
  const n = outline.length;
  const ribSections: THREE.Vector3[][] = [];
  const innerSections: THREE.Vector3[][] = [];
  const inner = insetPolygon(outline, 0.0025);
  for (let i = 0; i <= n; i++) {
    const p = outline[i % n];
    const q = inner[i % n];
    ribSections.push([v3(p.x, p.y, -0.0005), v3(p.x, p.y, -depth(p.y) + 0.0005)]);
    innerSections.push([v3(q.x, q.y, -0.003), v3(q.x, q.y, -depth(q.y) + 0.003)]);
  }
  const ribGeo = loft(ribSections);
  {
    // grain runs along the rib: u across height, v along the outline
    const uv = ribGeo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.12, uv.getY(i) * 2.4);
    // normals: purely horizontal, outward
    const pos = ribGeo.getAttribute('position');
    const nor = ribGeo.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const k = Math.floor(i / 2) % n;
      const a = outline[(k - 1 + n) % n];
      const b = outline[(k + 1) % n];
      const t = b.clone().sub(a).normalize();
      // the loop runs counter-clockwise? decide by area sign
      const sign = signedArea(outline) > 0 ? 1 : -1;
      nor.setXYZ(i, t.y * sign, -t.x * sign, 0);
    }
    const p0 = v3(pos.getX(0), pos.getY(0), 0);
    const n0 = v3(nor.getX(0), nor.getY(0), 0);
    // ensure faces wind outward
    const ribProbe = ribGeo.clone();
    ribProbe.computeVertexNormals();
    const computed = v3(ribProbe.getAttribute('normal').getX(0), ribProbe.getAttribute('normal').getY(0), 0);
    if (computed.dot(n0) < 0) {
      const idx = ribGeo.getIndex()!.array as Uint32Array;
      for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    }
    if (n0.dot(p0.clone().sub(v3(0, L / 2, 0))) < 0) {
      for (let i = 0; i < nor.count; i++) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), 0);
    }
    ribProbe.dispose();
  }
  add(ribGeo, sideMat, 'sides');
  add(loft(innerSections), interiorMat, 'interior');
  const floorGeo = new THREE.ShapeGeometry(new THREE.Shape(inner), 4);
  {
    const pos = floorGeo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setZ(i, -depth(pos.getY(i)) + 0.004);
    floorGeo.computeVertexNormals();
    orient(floorGeo, v3(0, 0, 1));
  }
  add(floorGeo, interiorMat, 'interior');
  // soundhole wall (end grain of the top)
  {
    const wall = new THREE.CylinderGeometry(spec.soundholeR, spec.soundholeR, 0.003, 96, 1, true);
    wall.rotateX(Math.PI / 2);
    wall.translate(0, spec.soundholeY, -0.0015);
    add(wall, interiorMat, 'interior');
  }
  // binding: a rounded bead round both edges
  const bindR = 0.0032;
  const topEdge = new THREE.CatmullRomCurve3(outline3.map((p) => v3(p.x, p.y, -0.0022)), true);
  add(new THREE.TubeGeometry(topEdge, 640, bindR, 10, true), bindingMat, 'binding');
  const backEdge = new THREE.CatmullRomCurve3(outline3.map((p) => v3(p.x, p.y, -depth(p.y) + 0.0022)), true);
  add(new THREE.TubeGeometry(backEdge, 640, bindR, 10, true), bindingMat, 'binding');
  // abalone ring (dreadnought)
  if (style === 'dreadnought') {
    const ringGeo = new THREE.RingGeometry(spec.soundholeR + 0.0066, spec.soundholeR + 0.0116, 160, 1);
    {
      // u = around, v = across
      const pos = ringGeo.getAttribute('position');
      const uv = ringGeo.getAttribute('uv');
      for (let i = 0; i < pos.count; i++) {
        const a = Math.atan2(pos.getY(i), pos.getX(i));
        uv.setXY(i, (a / (Math.PI * 2) + 1) % 1, Math.hypot(pos.getX(i), pos.getY(i)) > spec.soundholeR + 0.009 ? 1 : 0);
      }
    }
    abaloneTex.repeat.set(2, 1);
    ringGeo.translate(0, spec.soundholeY, 0.00015);
    add(ringGeo, abaloneMat, 'abalone');
    // pickguard: a teardrop on the treble side, hugging the soundhole
    const guard: THREE.Vector2[] = [];
    const gc = new THREE.Vector2(0.062, spec.soundholeY - 0.035);
    const clear = spec.soundholeR + 0.0145;
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const rx = 0.062 * (1 + 0.18 * Math.cos(a - 0.6));
      const ry = 0.07 * (1 + 0.12 * Math.sin(a));
      let p = new THREE.Vector2(gc.x + Math.cos(a) * rx, gc.y + Math.sin(a) * ry);
      const toHole = p.clone().sub(new THREE.Vector2(0, spec.soundholeY));
      if (toHole.length() < clear) p = new THREE.Vector2(0, spec.soundholeY).add(toHole.setLength(clear));
      guard.push(p);
    }
    const guardGeo = new THREE.ExtrudeGeometry(new THREE.Shape(guard), {
      depth: 0.0006,
      bevelEnabled: true,
      bevelThickness: 0.0002,
      bevelSize: 0.0004,
      bevelSegments: 2,
      curveSegments: 4,
    });
    {
      const pos = guardGeo.getAttribute('position');
      const uv = guardGeo.getAttribute('uv');
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) * 6, pos.getY(i) * 6);
    }
    guardGeo.translate(0, 0, 0.0001);
    add(guardGeo, guardMat, 'pickguard');
  }

  // ── bridge, saddle, pins ──
  if (style === 'dreadnought') {
    // Belly bridge as a loft of rounded cross-sections along x: the wings
    // thin out towards the ends and the ends round off in plan.
    const hw = 0.076;
    const sections: THREE.Vector3[][] = [];
    const steps = 72;
    for (let i = 0; i <= steps; i++) {
      const x = -hw + (i / steps) * 2 * hw;
      const ax = Math.abs(x);
      const belly = ax < 0.05 ? 0.007 * (1 - (ax / 0.05) ** 2) ** 1.5 : 0;
      let yF = 0.007;
      let yB = -0.023 - belly;
      const yc = -0.008;
      const end = ax > hw - 0.009 ? Math.sqrt(Math.max(0, 1 - ((ax - (hw - 0.009)) / 0.009) ** 2)) : 1;
      yF = yc + (yF - yc) * end;
      yB = yc + (yB - yc) * end;
      const h = 0.0092 * (1 - 0.5 * smoothstep(0.03, 0.076, ax)) * Math.sqrt(end) + 0.0002;
      const r = Math.min(0.0018, h * 0.45, (yF - yB) * 0.45 + 1e-5);
      const section: THREE.Vector3[] = [];
      section.push(v3(x, saddleY + yB, 0));
      for (let k = 0; k <= 5; k++) {
        const a = Math.PI - (k / 5) * (Math.PI / 2);
        section.push(v3(x, saddleY + yB + r + Math.cos(a) * r, h - r + Math.sin(a) * r));
      }
      for (let k = 0; k <= 5; k++) {
        const a = Math.PI / 2 - (k / 5) * (Math.PI / 2);
        section.push(v3(x, saddleY + yF - r + Math.cos(a) * r, h - r + Math.sin(a) * r));
      }
      section.push(v3(x, saddleY + yF, 0));
      sections.push(section);
    }
    const bridgeGeo = loft(sections);
    orient(bridgeGeo, v3(0, -1, 0), 0);
    {
      const pos = bridgeGeo.getAttribute('position');
      const uv = bridgeGeo.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getY(i) - saddleY) * 3, pos.getX(i) * 3 + 0.5);
    }
    add(bridgeGeo, bridgeMat, 'bridge');
    const saddle = new THREE.BoxGeometry(0.074, 0.0028, 0.006);
    saddle.translate(0, saddleY, saddleTop - 0.003);
    add(saddle, boneMat, 'bone');
    const pinHead = new THREE.SphereGeometry(0.0034, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    pinHead.rotateX(Math.PI / 2);
    pinHead.scale(1, 1, 0.8);
    const dot = new THREE.CircleGeometry(0.0011, 16);
    for (let i = 0; i < 6; i++) {
      const x = stringX(i, 0) * 0.98;
      const g = pinHead.clone();
      g.translate(x, saddleY - 0.0115, 0.0088);
      add(g, pinMat, 'pin');
      const d = dot.clone();
      d.translate(x, saddleY - 0.0115, 0.0088 + 0.0034 * 0.8 + 0.0001);
      add(d, pearlMat, 'pearl');
    }
  } else {
    const slab = (w: number, y0: number, y1: number, h: number, mat: THREE.Material, role: MeshRole) => {
      const s = new THREE.Shape();
      const r = 0.003;
      s.moveTo(-w / 2 + r, y0);
      s.lineTo(w / 2 - r, y0);
      s.quadraticCurveTo(w / 2, y0, w / 2, y0 + r);
      s.lineTo(w / 2, y1 - r);
      s.quadraticCurveTo(w / 2, y1, w / 2 - r, y1);
      s.lineTo(-w / 2 + r, y1);
      s.quadraticCurveTo(-w / 2, y1, -w / 2, y1 - r);
      s.lineTo(-w / 2, y0 + r);
      s.quadraticCurveTo(-w / 2, y0, -w / 2 + r, y0);
      const g = new THREE.ExtrudeGeometry(s, { depth: h - 0.001, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 2 });
      const pos = g.getAttribute('position');
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * 3 + 0.5, pos.getY(i) * 3);
      g.translate(0, saddleY, 0);
      return add(g, mat, role);
    };
    slab(0.185, -0.022, 0.006, 0.0055, bridgeMat, 'bridge');
    slab(0.084, -0.009, 0.006, 0.0085, bridgeMat, 'bridge');
    slab(0.084, -0.023, -0.01, 0.0105, bridgeMat, 'bridge');
    const inlay = new THREE.BoxGeometry(0.07, 0.006, 0.0006);
    inlay.translate(0, saddleY - 0.0165, 0.0106);
    add(inlay, boneMat, 'bone');
    const saddle = new THREE.BoxGeometry(0.08, 0.0028, 0.006);
    saddle.translate(0, saddleY, saddleTop - 0.003);
    add(saddle, boneMat, 'bone');
  }

  // ── neck ──
  const neckDepth = (y: number) => THREE.MathUtils.lerp(0.0215, 0.0235, smoothstep(nutY, fretY(10), y));
  const heelStart = L + 0.075;
  const heelDepth = depth(L) * 0.98;
  const shaftSections: THREE.Vector3[][] = [];
  const stations = 70;
  for (let i = 0; i <= stations; i++) {
    const y = THREE.MathUtils.lerp(nutY + 0.004, L - 0.012, i / stations);
    const w = (y > L ? fbWidth(y) : fbWidth(L)) - 0.0012;
    const heel = Math.pow(smoothstep(heelStart, L, y), 1.4);
    const d = THREE.MathUtils.lerp(neckDepth(y), heelDepth, heel);
    const narrow = THREE.MathUtils.lerp(1, 0.62, heel);
    const section: THREE.Vector3[] = [];
    for (let j = 0; j <= 24; j++) {
      const a = (j / 24) * Math.PI;
      // C-shape, a little flatter at the back; the heel tapers to a cap
      const sx = Math.cos(a) * (w / 2) * (1 - (1 - narrow) * Math.pow(Math.sin(a), 2));
      const sz = -Math.pow(Math.sin(a), 0.8) * d;
      section.push(v3(sx, y, sz));
    }
    shaftSections.push(section);
  }
  // volute: blend into the tilted headstock
  const headThick = style === 'dreadnought' ? 0.0145 : 0.019;
  const ca = Math.cos(spec.headAngle);
  const sa = Math.sin(spec.headAngle);
  const headOrigin = v3(0, nutY + 0.005, 0);
  for (let i = 1; i <= 8; i++) {
    const s = (i / 8) * 0.035;
    const cy = headOrigin.y + s * ca;
    const cz = -s * sa;
    const k = smoothstep(0, 1, i / 8);
    const d = THREE.MathUtils.lerp(neckDepth(nutY), headThick * 1.05, k);
    const w = THREE.MathUtils.lerp(spec.nutWidth - 0.0012, spec.nutWidth + 0.006, k);
    const section: THREE.Vector3[] = [];
    for (let j = 0; j <= 24; j++) {
      const a = (j / 24) * Math.PI;
      section.push(v3(Math.cos(a) * (w / 2), cy - Math.sin(a) * d * sa * 0.3, cz - Math.pow(Math.sin(a), 0.8) * d * ca));
    }
    shaftSections.unshift(section);
  }
  const shaftGeo = loft(shaftSections);
  orient(shaftGeo, v3(1, 0, 0), 0);
  {
    const uv = shaftGeo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.3, uv.getY(i) * 1.2);
  }
  add(shaftGeo, neckMat, 'neck');
  // heel cap
  {
    const last = shaftSections[shaftSections.length - 1];
    const capShape = new THREE.Shape(last.map((p) => new THREE.Vector2(p.x, p.z)));
    const cap = new THREE.ShapeGeometry(capShape);
    cap.rotateX(Math.PI / 2);
    cap.translate(0, last[0].y, 0);
    add(cap, neckMat, 'neck');
  }

  // fingerboard
  const fbSections: THREE.Vector3[][] = [];
  const fbSides: THREE.Vector3[][][] = [[], []];
  const fbStations = 60;
  for (let i = 0; i <= fbStations; i++) {
    const y = THREE.MathUtils.lerp(nutY, fbEndY, i / fbStations);
    const w = fbWidth(y);
    const section: THREE.Vector3[] = [];
    for (let j = 0; j <= 14; j++) {
      const x = -w / 2 + (j / 14) * w;
      section.push(v3(x, y, fbTop - sag(x)));
    }
    fbSections.push(section);
    fbSides[0].push([v3(-w / 2, y, 0.0003), v3(-w / 2, y, fbTop - sag(w / 2))]);
    fbSides[1].push([v3(w / 2, y, 0.0003), v3(w / 2, y, fbTop - sag(w / 2))]);
  }
  const fbGeo = loft(fbSections);
  orient(fbGeo, v3(0, 0, 1));
  {
    const uv = fbGeo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.25, uv.getY(i) * 1.5);
  }
  add(fbGeo, fbMat, 'fingerboard');
  add(orient(loft(fbSides[0]), v3(-1, 0, 0)), fbMat, 'fingerboard');
  add(orient(loft(fbSides[1]), v3(1, 0, 0)), fbMat, 'fingerboard');
  {
    const w = fbWidth(fbEndY);
    const end = new THREE.PlaneGeometry(w, fbTop);
    end.rotateX(Math.PI / 2);
    end.translate(0, fbEndY, fbTop / 2);
    add(end, fbMat, 'fingerboard');
  }
  // frets: wire bent to the radius
  const fretGeos: THREE.BufferGeometry[] = [];
  for (let f = 1; f <= spec.frets; f++) {
    const y = fretY(f);
    const w = fbWidth(y) - 0.001;
    const g = new THREE.CylinderGeometry(0.0012, 0.0012, w, 8, 12, false, 0, Math.PI);
    g.rotateZ(Math.PI / 2);
    g.rotateX(Math.PI / 2);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) * 1.0 + fbTop - sag(pos.getX(i)));
    g.translate(0, y, 0);
    fretGeos.push(g);
  }
  const fretGeo = mergeGeometries(fretGeos);
  fretGeo.computeVertexNormals();
  for (const g of fretGeos) g.dispose();
  add(fretGeo, fretMat, 'fret');
  // inlays (dreadnought): pearl dots
  if (style === 'dreadnought') {
    const dots: THREE.BufferGeometry[] = [];
    const placeDot = (x: number, y: number, r: number) => {
      const d = new THREE.CircleGeometry(r, 24);
      d.translate(x, y, fbTop - sag(x) + 0.00005);
      dots.push(d);
    };
    for (const f of [3, 5, 7, 9, 12, 15, 17]) {
      const y = (fretY(f) + fretY(f - 1)) / 2;
      if (f === 12) {
        placeDot(-0.011, y, 0.0028);
        placeDot(0.011, y, 0.0028);
      } else placeDot(0, y, 0.003);
    }
    const merged = mergeGeometries(dots);
    for (const d of dots) d.dispose();
    add(merged, pearlMat, 'pearl');
  }
  // nut
  {
    const nut = new THREE.BoxGeometry(spec.nutWidth, 0.005, nutBottom + 0.0015);
    nut.translate(0, nutY + 0.0025, (nutBottom + 0.0015) / 2);
    add(nut, boneMat, 'bone');
  }

  // ── headstock ──
  const head = new THREE.Group();
  head.position.copy(headOrigin);
  head.rotation.x = -spec.headAngle;
  group.add(head);
  const headShape = new THREE.Shape();
  const headLen = style === 'dreadnought' ? 0.186 : 0.19;
  const posts: { x: number; s: number; side: number }[] = [];
  if (style === 'dreadnought') {
    headShape.moveTo(-0.0265, 0);
    headShape.lineTo(0.0265, 0);
    headShape.lineTo(0.043, 0.168);
    headShape.quadraticCurveTo(0.0455, 0.186, 0.03, 0.186);
    headShape.quadraticCurveTo(0, 0.181, -0.03, 0.186);
    headShape.quadraticCurveTo(-0.0455, 0.186, -0.043, 0.168);
    headShape.lineTo(-0.0265, 0);
    const edge = (s: number) => 0.0265 + (s / 0.168) * (0.043 - 0.0265);
    for (const [k, s] of [[0, 0.145], [1, 0.102], [2, 0.058]] as const) posts[k] = { x: -(edge(s) - 0.0125), s, side: -1 };
    for (const [k, s] of [[3, 0.058], [4, 0.102], [5, 0.145]] as const) posts[k] = { x: edge(s) - 0.0125, s, side: 1 };
  } else {
    headShape.moveTo(-0.029, 0);
    headShape.lineTo(0.029, 0);
    headShape.lineTo(0.0335, 0.175);
    headShape.quadraticCurveTo(0.034, 0.19, 0.022, 0.19);
    headShape.quadraticCurveTo(0, 0.2, -0.022, 0.19);
    headShape.quadraticCurveTo(-0.034, 0.19, -0.0335, 0.175);
    headShape.lineTo(-0.029, 0);
    for (const side of [-1, 1]) {
      const slot = new THREE.Path();
      const x0 = side * 0.0075;
      const x1 = side * 0.0225;
      slot.moveTo(Math.min(x0, x1), 0.04);
      slot.lineTo(Math.max(x0, x1), 0.04);
      slot.lineTo(Math.max(x0, x1), 0.152);
      slot.absarc((x0 + x1) / 2, 0.152, 0.0075, 0, Math.PI, false);
      slot.lineTo(Math.min(x0, x1), 0.04);
      headShape.holes.push(slot);
    }
    for (const [k, s] of [[0, 0.13], [1, 0.095], [2, 0.06]] as const) posts[k] = { x: -0.015, s, side: -1 };
    for (const [k, s] of [[3, 0.06], [4, 0.095], [5, 0.13]] as const) posts[k] = { x: 0.015, s, side: 1 };
  }
  const headGeo = new THREE.ExtrudeGeometry(headShape, { depth: headThick - 0.002, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 2, curveSegments: 16 });
  {
    const pos = headGeo.getAttribute('position');
    const uv = headGeo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * 2 + 0.5, pos.getY(i) * 2);
  }
  headGeo.translate(0, 0, -headThick + 0.001);
  // shape (x, s) → head local (x, y=s, z)
  add(headGeo, neckMat, 'neck', head);
  const veneerGeo = new THREE.ExtrudeGeometry(headShape, { depth: 0.0012, bevelEnabled: false, curveSegments: 16 });
  {
    const pos = veneerGeo.getAttribute('position');
    const uv = veneerGeo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * 2 + 0.5, pos.getY(i) * 2);
  }
  veneerGeo.translate(0, 0, 0);
  add(veneerGeo, veneerMat, 'veneer', head);
  // tuners
  const headTop = v3(0, headLen, 0);
  const stringPost: THREE.Vector3[] = [];
  if (style === 'dreadnought') {
    for (let i = 0; i < 6; i++) {
      const p = posts[i];
      const post = new THREE.CylinderGeometry(0.0029, 0.0031, 0.016, 16);
      post.rotateX(Math.PI / 2);
      post.translate(p.x, p.s, 0.008);
      add(post, metalMat, 'metal', head);
      const bush = new THREE.CylinderGeometry(0.0052, 0.0052, 0.0022, 6);
      bush.rotateX(Math.PI / 2);
      bush.translate(p.x, p.s, 0.0031);
      add(bush, metalMat, 'metal', head);
      const box = new THREE.BoxGeometry(0.014, 0.013, 0.011);
      box.translate(p.x + p.side * 0.002, p.s, -headThick - 0.0045);
      add(box, metalMat, 'metal', head);
      const edgeX = Math.abs(p.x) + 0.0125;
      const shaft = new THREE.CylinderGeometry(0.0016, 0.0016, 0.02, 8);
      shaft.rotateZ(Math.PI / 2);
      shaft.translate(p.side * (edgeX + 0.006), p.s, -headThick - 0.0045);
      add(shaft, metalMat, 'metal', head);
      const button = new THREE.CylinderGeometry(0.0085, 0.0085, 0.004, 24);
      button.rotateX(Math.PI / 2);
      button.scale(1.25, 1, 1);
      button.translate(p.side * (edgeX + 0.022), p.s, -headThick - 0.0045);
      add(button, buttonMat, 'button', head);
      stringPost.push(v3(p.x - p.side * 0.0029, p.s, 0.0105));
    }
  } else {
    for (let i = 0; i < 6; i++) {
      const p = posts[i];
      const roller = new THREE.CylinderGeometry(0.0045, 0.0045, 0.03, 16);
      roller.rotateZ(Math.PI / 2);
      roller.translate(p.side * 0.016, p.s, -headThick / 2);
      add(roller, boneMat, 'bone', head);
      const shaft = new THREE.CylinderGeometry(0.0016, 0.0016, 0.022, 8);
      shaft.rotateZ(Math.PI / 2);
      shaft.translate(p.side * 0.04, p.s, -headThick / 2);
      add(shaft, metalMat, 'metal', head);
      const plate = new THREE.BoxGeometry(0.0012, 0.12, headThick * 0.8);
      plate.translate(p.side * 0.0342, 0.095, -headThick / 2);
      if (i === 0 || i === 3) add(plate, metalMat, 'metal', head);
      const button = new THREE.CylinderGeometry(0.0075, 0.0075, 0.0045, 24);
      button.rotateX(Math.PI / 2);
      button.scale(1.3, 1, 1);
      button.translate(p.side * 0.056, p.s, -headThick / 2);
      add(button, buttonMat, 'button', head);
      stringPost.push(v3(p.x, p.s, -headThick / 2 + 0.0045));
    }
  }

  // ── strings ──
  const strings: StringVis[] = [];
  const staticGeos: THREE.BufferGeometry[][] = [[], []];
  const bronze = new THREE.Color(spec.nylon ? 0xd8d8d8 : 0xc99a62);
  const steel = new THREE.Color(0xe6e6e6);
  const nylon = new THREE.Color(0xf0ebdf);
  head.updateMatrix();
  for (let i = 0; i < 6; i++) {
    const r = spec.gauges[i] / 2;
    const wound = spec.wound[i];
    const color = wound ? bronze : spec.nylon ? nylon : steel;
    const material = physical({
      color,
      metalness: spec.nylon && !wound ? 0 : 1,
      roughness: spec.nylon && !wound ? 0.28 : wound ? 0.3 : 0.18,
      clearcoat: spec.nylon && !wound ? 0.6 : 0,
      transparent: true,
    });
    const start = v3(stringX(i, 0), saddleY, stringZ(i, 0));
    const end = v3(stringX(i, 1), nutY, stringZ(i, 1));
    const uniforms: Record<string, { value: number }> = {
      uTime: { value: 0 },
      uPluckT: { value: -100 },
      uAmp: { value: 0 },
      uBeta: { value: 0.2 },
      uXf: { value: 1 },
      uFv: { value: 5 },
      uTau: { value: 1 },
      uMode: { value: 0 },
      uPress: { value: 0 },
      uPressDepth: { value: 0 },
      uDamp: { value: 1 },
      uRadius: { value: r },
      uWound: { value: wound ? 1 : 0 },
      uLength: { value: spec.scale },
    };
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${STRING_DISPLACEMENT}`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec2 motion = stringMotion(aU);
          float tri = aU < uXf ? aU / uXf : (1.0 - aU) / max(1e-4, 1.0 - uXf);
          transformed.z += uPress * uPressDepth * tri;
          vU = aU;
          vEnv = motion.y;
          if (uMode > 0.5 && uMode < 1.5) {
            vAlpha = clamp((uRadius * 2.2) / (uRadius * 2.0 + 2.0 * motion.y), 0.15, 1.0);
          } else {
            transformed.x += motion.x;
            transformed.z += motion.x * 0.22;
            vAlpha = 1.0;
          }`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\nvarying float vAlpha;\nvarying float vU;\nvarying float vEnv;\nuniform float uWound;\nuniform float uLength;\nuniform float uRadius;`,
        )
        .replace(
          'vec4 diffuseColor = vec4( diffuse, opacity );',
          `vec4 diffuseColor = vec4( diffuse, opacity * vAlpha );
          // winding ridges, faded out where they would alias
          float wraps = vU * uLength / (uRadius * 0.55);
          float aa = clamp(1.0 - fwidth(wraps) * 1.5, 0.0, 1.0);
          float ridge = uWound * aa * (0.5 + 0.5 * sin(wraps * 6.2831));
          diffuseColor.rgb *= 1.0 - 0.35 * ridge;`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + 0.25 * ridge, 0.0, 1.0);`,
        );
    };
    material.customProgramCacheKey = () => `gtr-string`;
    // geometry: tube from saddle (u=0) to nut (u=1)
    const segs = 220;
    const radial = 8;
    const positions: number[] = [];
    const normals: number[] = [];
    const us: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    for (let a = 0; a <= segs; a++) {
      const u = a / segs;
      const c = v3(stringX(i, u), THREE.MathUtils.lerp(saddleY, nutY, u), stringZ(i, u));
      for (let b = 0; b <= radial; b++) {
        const ang = (b / radial) * Math.PI * 2;
        const nx = Math.cos(ang);
        const nz = Math.sin(ang);
        positions.push(c.x + nx * r, c.y, c.z + nz * r);
        normals.push(nx, 0, nz);
        us.push(u);
        uvs.push(u, b / radial);
      }
    }
    for (let a = 0; a < segs; a++) {
      for (let b = 0; b < radial; b++) {
        const p = a * (radial + 1) + b;
        const q = p + radial + 1;
        index.push(p, q, p + 1, p + 1, q, q + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('aU', new THREE.Float32BufferAttribute(us, 1));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(index);
    const mesh = add(geo, material, 'string');
    // the string's shadow follows its motion (A and C modes)
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depthMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
${STRING_DISPLACEMENT}`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec2 motion = stringMotion(aU);
          float tri = aU < uXf ? aU / uXf : (1.0 - aU) / max(1e-4, 1.0 - uXf);
          transformed.z += uPress * uPressDepth * tri;
          if (uMode < 0.5 || uMode > 1.5) { transformed.x += motion.x; transformed.z += motion.x * 0.22; }`,
        );
    };
    depthMat.customProgramCacheKey = () => 'gtr-string-depth';
    disposables.push(depthMat);
    mesh.customDepthMaterial = depthMat;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    // ribbon for the real-speed blur
    const rPos: number[] = [];
    const rU: number[] = [];
    const rSide: number[] = [];
    const rIndex: number[] = [];
    for (let a = 0; a <= segs; a++) {
      const u = a / segs;
      for (const side of [-1, 1]) {
        rPos.push(stringX(i, u), THREE.MathUtils.lerp(saddleY, nutY, u), stringZ(i, u));
        rU.push(u);
        rSide.push(side);
      }
      if (a < segs) rIndex.push(a * 2, a * 2 + 1, a * 2 + 2, a * 2 + 1, a * 2 + 3, a * 2 + 2);
    }
    const rGeo = new THREE.BufferGeometry();
    rGeo.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
    rGeo.setAttribute('aU', new THREE.Float32BufferAttribute(rU, 1));
    rGeo.setAttribute('aSide', new THREE.Float32BufferAttribute(rSide, 1));
    rGeo.setIndex(rIndex);
    disposables.push(rGeo);
    const ribbonMat = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uColor: { value: color.clone().multiplyScalar(1.15) }, uSun: { value: 1 } },
      vertexShader: `${STRING_DISPLACEMENT}
        attribute float aSide;
        varying float vSide;
        void main() {
          vec2 motion = stringMotion(aU);
          vec3 p = position;
          float tri = aU < uXf ? aU / uXf : (1.0 - aU) / max(1e-4, 1.0 - uXf);
          p.z += uPress * uPressDepth * tri + uRadius * 0.6;
          p.x += aSide * (motion.y + uRadius);
          vSide = aSide;
          vEnv = motion.y;
          vU = aU;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uRadius;
        uniform float uSun;
        varying float vSide;
        varying float vEnv;
        varying float vU;
        void main() {
          if (vEnv < uRadius * 0.15) discard;
          // a string swinging sinusoidally dwells at its extremes: bright edges
          float s = abs(vSide);
          float dwell = 1.0 / sqrt(max(1.0 - s * s, 0.03));
          float coverage = (2.0 * uRadius) / (2.0 * uRadius + 2.0 * vEnv);
          float a = clamp(coverage * dwell * 0.55, 0.0, 0.9) * smoothstep(1.0, 0.92, s);
          gl_FragColor = vec4(uColor * (0.75 + 0.6 * uSun), a);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    disposables.push(ribbonMat);
    const ribbon = new THREE.Mesh(rGeo, ribbonMat);
    ribbon.frustumCulled = false;
    ribbon.visible = false;
    ribbon.renderOrder = 3;
    group.add(ribbon);
    strings.push({ mesh, ribbon, uniforms, start, end, radius: r, pluckAt: start.clone(), baseMaterial: material });

    // static runs: pin/tie → saddle, nut → post
    const nutPoint = end.clone();
    const postWorld = stringPost[i].clone().applyMatrix4(head.matrix);
    const tail =
      style === 'dreadnought'
        ? v3(stringX(i, 0) * 0.98, saddleY - 0.0115, 0.0105)
        : v3(stringX(i, 0) * 0.95, saddleY - 0.016, 0.0115);
    const runs: [THREE.Vector3, THREE.Vector3][] = [
      [tail, start],
      [nutPoint, postWorld],
    ];
    for (const [a, b] of runs) {
      const g = new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 8, r, 6);
      staticGeos[wound ? 0 : 1].push(g);
    }
  }
  const staticMats = [strings[0].baseMaterial, strings[5].baseMaterial];
  for (let k = 0; k < 2; k++) {
    if (!staticGeos[k].length) continue;
    const merged = mergeGeometries(staticGeos[k]);
    for (const g of staticGeos[k]) g.dispose();
    const plain = new THREE.MeshPhysicalMaterial().copy(staticMats[k]);
    plain.transparent = false;
    plain.onBeforeCompile = () => {};
    disposables.push(plain);
    add(merged, plain, 'stringStatic');
  }

  // ── string motion state ──
  const state = strings.map(() => ({ releaseAt: Infinity, pressFrom: 0, pressTo: 0, pressT: -10, held: false }));
  let mode: StringMode = 0;
  const pluckPointY = spec.soundholeY - 0.01; // over the soundhole, β ≈ 0.2 open
  const layout: Layout = {
    saddleY, nutY, fbTop, fretTop, fretY, fbWidth,
    soundholeY: spec.soundholeY, soundholeR: spec.soundholeR, bodyLength: L,
    stringX, stringZ, headTop: headTop.clone().applyMatrix4(head.matrix),
  };

  const guitar: Guitar = {
    group, style, spec, layout, strings, parts,
    setFinish,
    setStringMode(next) {
      mode = next;
      for (const s of strings) {
        s.uniforms.uMode.value = next;
        s.ribbon.visible = next === 1;
      }
    },
    pluck(i, fret, velocity, time) {
      const s = strings[i];
      const u = s.uniforms;
      const xf = Math.pow(2, -fret / 12);
      const f0 = 440 * Math.pow(2, (OPEN_MIDI[i] + fret - 69) / 12);
      u.uPluckT.value = time;
      // ~2.5× a real pluck so it reads at stage distance
      u.uAmp.value = (spec.nylon ? 0.0075 : 0.0062) * velocity * (1.2 - 0.3 * (i / 5));
      u.uXf.value = xf;
      u.uBeta.value = THREE.MathUtils.clamp((pluckPointY - saddleY) / (spec.scale * xf), 0.08, 0.5);
      u.uFv.value = 4.6 * Math.pow(f0 / 82.4, 0.4);
      u.uTau.value = 7 / 6.91; // GUITAR_STRING.decaySec T60 → e-folding
      u.uDamp.value = 1;
      // pressing: string bends down to the fret
      const st = state[i];
      st.pressFrom = u.uPress.value;
      st.pressTo = fret > 0 ? 1 : 0;
      st.pressT = time;
      st.releaseAt = Infinity;
      st.held = true;
      if (fret > 0) {
        const zRest = stringZ(i, xf);
        u.uPressDepth.value = fretTop + s.radius - sag(stringX(i, xf)) - zRest;
      }
      s.pluckAt.set(stringX(i, ((pluckPointY - saddleY) / spec.scale)), pluckPointY, stringZ(i, 0) + 0.002);
    },
    release(i, time, damp = true) {
      state[i].held = false;
      if (damp) state[i].releaseAt = time;
      else {
        // the finger lifts but the string rings on (demo strumming)
        state[i].pressFrom = strings[i].uniforms.uPress.value;
        state[i].pressTo = 0;
        state[i].pressT = time;
      }
    },
    update(time) {
      for (let i = 0; i < strings.length; i++) {
        const u = strings[i].uniforms;
        const st = state[i];
        u.uTime.value = time;
        // gate ↓ damps the string (the app's Damp: on), visually over ~90 ms
        if (time > st.releaseAt) u.uDamp.value = Math.max(0, 1 - (time - st.releaseAt) / 0.09);
        const k = Math.min(1, (time - st.pressT) / 0.04);
        let press = THREE.MathUtils.lerp(st.pressFrom, st.pressTo, k);
        if (time > st.releaseAt) press *= Math.max(0, 1 - (time - st.releaseAt) / 0.08);
        u.uPress.value = press;
      }
      void mode;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      for (const t of textures) t.dispose();
    },
  };
  return guitar;
}

// ── note → string & fret ────────────────────────────────────────────────

export type Fingering = { string: number; fret: number };

/**
 * Where a guitarist would play `midi`: the string whose fret lies nearest
 * the hand's current position (open strings are cheap), within 0…maxFret.
 */
export function makeFingerer(maxFret: number) {
  let hand = 5;
  return (midi: number, busy: Set<number> = new Set()): Fingering | null => {
    let best: Fingering | null = null;
    let bestCost = Infinity;
    for (let s = 5; s >= 0; s--) {
      const fret = midi - OPEN_MIDI[s];
      if (fret < 0 || fret > maxFret) continue;
      let cost = fret === 0 ? 2.2 : Math.abs(fret - (hand + 1.5));
      if (busy.has(s)) cost += 6;
      if (cost < bestCost) {
        bestCost = cost;
        best = { string: s, fret };
      }
    }
    if (best && best.fret > 0) {
      if (best.fret < hand) hand = best.fret;
      else if (best.fret > hand + 3) hand = best.fret - 3;
    }
    return best;
  };
}

export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const noteName = (midi: number) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

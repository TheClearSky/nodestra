// COPIED from .claude/pages/ad/experiments/hell-src/scene/pillar-citadel.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Pillar option "citadel": the tower as a castle — the one structure in the
 * wasteland that matters. Built from many simple stone parts, merged into a
 * few meshes (one per stone tone) so it stays cheap to draw:
 *
 *   bastion   a battered octagonal plinth, a crenellated curtain wall and
 *             eight round corner towers with machicolations and cone roofs
 *   gatehouse two flanking towers and a lit arched gate facing the camera
 *   hall      an octagonal inner hall with stepped buttresses and pinnacles,
 *             rows of lit arched windows and long banners in the circles' red
 *   drum      a sixteen-sided drum ringed by bartizan turrets
 *   keep      a tall twelve-sided keep with string courses, window rows, four
 *             slender corner towers and eight flying buttresses
 *   crown     an open belfry with a glowing core, a ring of pinnacles, a tall
 *             spire with dormers, a beacon and a thin beam into the sky
 *
 * The stone, ink and light materials are the hell-06 ones (passed in by
 * scene/pillar.ts); only the window and banner shaders are new. Shapes are
 * after the references' "important tower" cues: Re:Zero's Pleiades watchtower
 * (bell base, moulding rings, flanking shafts), Las Noches' flared towers,
 * and a European keep's silhouette for the castle read. Everything is in
 * scene metres with the foot at the origin of the returned group.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENV_GLSL, seededRandom, type EnvUniforms } from '../../env-src/lab';
import { PILLAR_GLSL, type PillarUniforms } from '../hell-06-pillar-glsl';
import { makeLight } from '../hell-06-pillar-parts';
import type { PaletteStore } from './palette';

/** Stone tones relative to the palette's stone role (see TONE in pillar.ts). */
export const CITADEL_TONE = {
  wall: [1.25, 1.05, 0.38] as [number, number, number],
  trim: [1.7, 1.35, 0.5] as [number, number, number],
  roof: [0.42, 0.36, 0.12] as [number, number, number],
  /** The inside of the hollow castle (roof variant): darker, lit by lanterns. */
  inner: [0.95, 0.78, 0.3] as [number, number, number],
};

export type CitadelKit = {
  env: EnvUniforms;
  P: PillarUniforms;
  palette: PaletteStore;
  /** A hell-06 toon stone material in one of the citadel tones. */
  stone(tone: keyof typeof CITADEL_TONE): THREE.Material;
  /** A hell-06 ink hull material. */
  hull(): THREE.Material;
  /** The citadel's own fog multiplier (it sits in thinner air than the other designs, so it keeps its presence). */
  fogK: { value: number };
};

/** Total height of the spire tip above the foot (scene metres). */
export const CITADEL_TOP = 292;

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

/** Collects transformed parts per stone tone, then merges each list. */
class Parts {
  lists: Record<keyof typeof CITADEL_TONE, THREE.BufferGeometry[]> = { wall: [], trim: [], roof: [], inner: [] };
  add(tone: keyof typeof CITADEL_TONE, g: THREE.BufferGeometry, m?: THREE.Matrix4) {
    const geo = g.index ? g.toNonIndexed() : g;
    if (m) geo.applyMatrix4(m);
    geo.deleteAttribute('uv');
    this.lists[tone].push(geo);
  }
}

/** A prism (sides ≤ 12: flat facets) from radius r0 at y0 to r1 at y1. `turn` rotates its corners. */
function prism(r0: number, r1: number, y0: number, y1: number, sides: number, turn = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, sides, 1, false, turn);
  g.translate(0, (y0 + y1) / 2, 0);
  const f = g.toNonIndexed();
  if (sides <= 12) f.computeVertexNormals();
  return f;
}

function cone(r: number, y0: number, h: number, sides: number, turn = 0): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, sides, 1, false, turn);
  g.translate(0, y0 + h / 2, 0);
  const f = g.toNonIndexed();
  f.computeVertexNormals();
  return f;
}

/** An open tube (no caps), optionally only part of the way round. */
function tube(r0: number, r1: number, y0: number, y1: number, sides: number, thetaStart = 0, thetaLength = TAU): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, sides, 1, true, thetaStart, thetaLength);
  g.translate(0, (y0 + y1) / 2, 0);
  const f = g.toNonIndexed();
  if (sides <= 12) f.computeVertexNormals();
  return f;
}

/** A flat ring at height y, facing up (or down). */
function ring(rIn: number, rOut: number, y: number, up = true, segments = 48): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(rIn, rOut, segments, 1).rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  g.translate(0, y, 0);
  return g.toNonIndexed();
}

/** The same surface seen from the other side: winding reversed, normals flipped. */
function flipped(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const f = g.index ? g.toNonIndexed() : g.clone();
  for (const name of ['position', 'normal', 'uv']) {
    const a = f.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) continue;
    const arr = a.array as Float32Array;
    for (let i = 0; i < a.count; i += 3) {
      for (let c = 0; c < a.itemSize; c++) {
        const t = arr[(i + 1) * a.itemSize + c];
        arr[(i + 1) * a.itemSize + c] = arr[(i + 2) * a.itemSize + c];
        arr[(i + 2) * a.itemSize + c] = t;
      }
    }
  }
  const n = f.getAttribute('normal').array as Float32Array;
  for (let i = 0; i < n.length; i++) n[i] *= -1;
  return f;
}

function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).toNonIndexed();
}

/** A matrix placing a part at (x, y, z), facing outward at angle θ (θ = 0 faces +z, the camera). */
function at(x: number, y: number, z: number, theta = 0, s = new THREE.Vector3(1, 1, 1)): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, theta), s);
}

/** Point on a circle of radius r at angle θ (θ = 0 toward +z, as CylinderGeometry). */
const polar = (r: number, theta: number) => new THREE.Vector2(r * Math.sin(theta), r * Math.cos(theta));

/** Merlons (crenellations) round a polygon of circumradius R with `sides` sides, each side split into `per` merlons. */
function polygonMerlons(parts: Parts, R: number, sides: number, turn: number, y: number, per: number, size: [number, number, number]) {
  for (let k = 0; k < sides; k++) {
    const a0 = turn + (k * TAU) / sides;
    const a1 = turn + ((k + 1) * TAU) / sides;
    const p0 = polar(R, a0);
    const p1 = polar(R, a1);
    const faceTheta = (a0 + a1) / 2;
    for (let i = 0; i < per; i++) {
      const t = (i + 0.5) / per;
      const p = p0.clone().lerp(p1, t);
      parts.add('trim', box(...size), at(p.x, y + size[1] / 2, p.y, faceTheta));
    }
  }
}

/** Merlons round a circle (round towers). */
function ringMerlons(parts: Parts, cx: number, cz: number, r: number, y: number, n: number, size: [number, number, number]) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const p = polar(r, a);
    parts.add('trim', box(...size), at(cx + p.x, y + size[1] / 2, cz + p.y, a));
  }
}

type Window = { m: THREE.Matrix4; lit: number; seed: number; mullion: number };

/**
 * A window on a wall: centre (x, y, z), outward normal n, size w × h. The
 * plane sits a little proud of the wall so it never z-fights the stone.
 */
function windowAt(list: Window[], x: number, y: number, z: number, n: THREE.Vector3, w: number, h: number, lit: number, seed: number, mullion = 0) {
  const zAxis = n.clone().normalize();
  const xAxis = new THREE.Vector3().crossVectors(UP, zAxis).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
  const m = new THREE.Matrix4().makeBasis(xAxis.multiplyScalar(w), yAxis.multiplyScalar(h), zAxis);
  m.setPosition(x + n.x * 0.35, y, z + n.z * 0.35);
  list.push({ m, lit, seed, mullion });
}

/** Windows on each face of a tapered prism, `rows` heights, `per` per face. */
function prismWindows(list: Window[], rand: () => number, R0: number, R1: number, y0: number, y1: number, sides: number, turn: number, rows: number[], per: number, w: number, h: number, litShare: number, skipBack = true, skipFront = false) {
  const lean = (R0 - R1) / (y1 - y0);
  for (let k = 0; k < sides; k++) {
    const theta = turn + ((k + 0.5) * TAU) / sides;
    // Faces turned away from the camera are never seen.
    if (skipBack && Math.cos(theta) < -0.35) continue;
    if (skipFront && Math.cos(theta) > 0.99) continue; // the portal is there
    const half = Math.PI / sides;
    for (const y of rows) {
      const R = THREE.MathUtils.lerp(R0, R1, (y - y0) / (y1 - y0));
      const apo = R * Math.cos(half);
      const side = 2 * R * Math.sin(half);
      for (let i = 0; i < per; i++) {
        const along = ((i + 0.5) / per - 0.5) * side * 0.8;
        const c = polar(apo, theta);
        const tangent = new THREE.Vector2(Math.cos(theta), -Math.sin(theta));
        const n = new THREE.Vector3(Math.sin(theta), lean, Math.cos(theta));
        windowAt(list, c.x + tangent.x * along, y, c.y + tangent.y * along, n, w, h, rand() < litShare ? 1 : 0, rand(), w > 3 ? 1 : 0);
      }
    }
  }
}

const WINDOW_VERT = /* glsl */ `
attribute vec3 aWin; // lit, seed, mullion
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vWin;
void main() {
  vUv = uv;
  vWin = aWin;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

function makeWindowMaterial(env: EnvUniforms, P: PillarUniforms, recess: { value: THREE.Color }, fogK: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...env, ...P, uFogK: fogK, uRecess: recess },
    vertexShader: WINDOW_VERT,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${PILLAR_GLSL}
      uniform vec3 uRecess;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vWin;
      void main() {
        // An arched window: a rectangle with a pointed (gothic) top.
        vec2 p = vUv - vec2(0.5, 0.0);
        float spring = 0.68;
        float d;
        if (vUv.y < spring) d = abs(p.x) - 0.5;
        else {
          // Two arcs meeting at the apex (lancet).
          float r = 0.85;
          float cx = r - 0.5;
          d = length(vec2(abs(p.x) + cx, (vUv.y - spring) * 2.6)) - r;
        }
        d = max(d, -vUv.y);
        float aa = fwidth(d) + 1e-4;
        float inside = 1.0 - smoothstep(-aa, aa, d);
        if (inside < 0.02) discard;
        // Mullion and transom on the big windows.
        float bar = vWin.z * max(1.0 - smoothstep(0.03, 0.03 + fwidth(p.x) * 1.5, abs(p.x)),
                                 1.0 - smoothstep(0.02, 0.02 + fwidth(vUv.y) * 1.5, abs(vUv.y - 0.45)));
        float lit = vWin.x;
        // Lit rooms: warm towards the sill, flickering slowly, a few nearly dark.
        float flick = 0.82 + 0.18 * sin(uMT * (0.7 + vWin.y * 1.3) + vWin.y * 40.0);
        float level = mix(0.45, 1.25, vWin.y) * flick;
        vec3 light = mix(uFringe, uCore, 0.35 + 0.4 * (1.0 - vUv.y)) * level * 1.6;
        vec3 col = mix(uRecess, light, lit);
        col = mix(col, uRecess * 0.6, bar);
        // The inner edge of the frame is a little darker (depth).
        col *= mix(0.55, 1.0, smoothstep(0.0, 0.08, -d));
        col = fogSolid(col, vWorld, lit * 0.8);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/** Window quad: unit square with its bottom edge at y = -0.5 … placed by centre. */
function windowGeometry(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1, 1);
}

function makeBannerMaterial(env: EnvUniforms, P: PillarUniforms, cloth: { value: THREE.Color }, trim: { value: THREE.Color }, fogK: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...env, ...P, uFogK: fogK, uCloth: cloth, uTrim: trim },
    vertexShader: /* glsl */ `
      uniform float uMT;
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec3 p = position;
        // Hanging from the top edge: the lower part sways in the wind.
        float hang = 1.0 - uv.y;
        p.z += sin(uMT * 0.9 + p.x * 0.4 + uv.y * 3.0) * hang * hang * 1.6;
        p.x += sin(uMT * 0.6 + uv.y * 2.0) * hang * hang * 0.6;
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${PILLAR_GLSL}
      uniform vec3 uCloth; uniform vec3 uTrim;
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        // A swallow-tail notch cut up from the bottom.
        if (vUv.y < 0.15 - abs(vUv.x - 0.5) * 0.3) discard;
        vec3 col = uCloth * (0.75 + 0.25 * vUv.y);
        // Gold border and a sigil ring in the middle.
        float border = max(step(0.42, abs(vUv.x - 0.5)), step(0.96, vUv.y));
        vec2 q = (vUv - vec2(0.5, 0.62)) * vec2(1.0, 4.0);
        float ring = abs(length(q) - 0.28);
        float sig = 1.0 - smoothstep(0.02, 0.02 + fwidth(ring) * 1.5, ring);
        col = mix(col, uTrim, max(border, sig) * 0.85);
        col = fogSolid(col, vWorld, 0.0);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
}

/**
 * The roof terrace floor: rings of flagstones round the oculus, and a red
 * seal inlaid under the piano (rings, a pentagram, ticks) that breathes
 * slowly — the instrument stands on a summoning circle under the sky's.
 * Works in the floor's local units (x, z = terrace plane).
 */
function makeTerraceMaterial(env: EnvUniforms, P: PillarUniforms, fogK: { value: number }, palette: PaletteStore): THREE.ShaderMaterial {
  const uStone = { value: new THREE.Color() };
  const uSeal = { value: new THREE.Color() };
  palette.subscribe((p) => {
    uStone.value.set(p.stone.lit).multiplyScalar(1.15);
    uSeal.value.set(p.glow.circles);
  });
  return new THREE.ShaderMaterial({
    uniforms: { ...env, ...P, uFogK: fogK, uStone, uSeal, uSealAt: { value: new THREE.Vector3(TERRACE.seal.x, TERRACE.seal.z, TERRACE.seal.r) } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec2 vXZ;
      void main() {
        vXZ = position.xz;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${PILLAR_GLSL}
      uniform vec3 uStone; uniform vec3 uSeal; uniform vec3 uSealAt;
      varying vec3 vWorld; varying vec2 vXZ;
      float lineAA(float d, float w) { float aa = fwidth(d) + 1e-4; return 1.0 - smoothstep(w - aa, w + aa, abs(d)); }
      void main() {
        // Flagstones: rings round the oculus, cut into cells; dark grout.
        float r = length(vXZ);
        float a = atan(vXZ.y, vXZ.x);
        float ringId = floor(r / 2.6);
        float cells = floor(6.0 + ringId * 4.0);
        float cellId = floor((a / TAU + 0.5) * cells);
        float shade = 0.86 + 0.14 * hash12(vec2(ringId, cellId));
        float px = fwidth(r) + 1e-4;
        float fr = fract(r / 2.6) * 2.6;
        float gr = 1.0 - smoothstep(0.05, 0.05 + px * 1.5, min(fr, 2.6 - fr));
        float fa = fract((a / TAU + 0.5) * cells);
        float ga = 1.0 - smoothstep(0.05, 0.05 + px * 1.5, min(fa, 1.0 - fa) * TAU / cells * r);
        vec3 col = uStone * shade * (1.0 - 0.55 * max(gr, ga));
        // The seal under the piano.
        vec2 q = vXZ - uSealAt.xy;
        float R = uSealAt.z;
        float qr = length(q);
        float qa = atan(q.y, q.x);
        float breathe = 0.75 + 0.25 * sin(uMT * 0.9);
        float seal = lineAA(qr - R, 0.07) + lineAA(qr - R * 0.93, 0.04) + lineAA(qr - R * 0.48, 0.05);
        float tk = abs(fract(qa / TAU * 48.0 + 0.5) - 0.5) * TAU / 48.0 * qr;
        seal += lineAA(tk, 0.03) * step(R * 0.93, qr) * step(qr, R);
        float pd = 1e9;
        for (int i = 0; i < 5; i++) {
          float a0 = 1.5708 + TAU * float(i) / 5.0 + uMT * 0.05;
          float a1 = a0 + TAU * 2.0 / 5.0;
          vec2 p0 = vec2(cos(a0), sin(a0)) * R * 0.9;
          vec2 p1 = vec2(cos(a1), sin(a1)) * R * 0.9;
          vec2 pa = q - p0, ba = p1 - p0;
          pd = min(pd, length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)));
        }
        seal += lineAA(pd, 0.035) * 0.9;
        col = mix(col, col * 0.4, step(qr, R) * 0.4);
        vec3 glow = uSeal * min(seal, 1.5) * 1.6 * breathe;
        col += glow;
        float e = clamp(seal, 0.0, 1.0);
        col = fogSolid(col, vWorld, e);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

export type Citadel = { group: THREE.Group; frame: (t: number) => void };

/**
 * The roof variant (hell-30, FLIGHT.md): a real gate tunnel, a hollow hall,
 * drum and keep (outer shell + an inner shell seen from inside), galleries
 * and lanterns up the shaft, and a roof terrace with an oculus in place of
 * the spire — the drone flies through it all and lands at the piano.
 */
export type CitadelOptions = { roof?: boolean };

/** Roof variant, local units: the terrace floor height, the oculus radius and the seal under the piano. */
export const TERRACE = { y: 250, oculus: 5, radius: 26.5, seal: { x: 0, z: -10.5, r: 6.6 } };

export function buildCitadel(kit: CitadelKit, options: CitadelOptions = {}): Citadel {
  const roof = options.roof === true;
  const { env, P, palette } = kit;
  const rand = seededRandom(1337);
  const parts = new Parts();
  const windows: Window[] = [];
  const group = new THREE.Group();
  group.name = 'citadel';

  // ── bastion: plinth, curtain wall, corner towers ───────────────────────
  const oct = Math.PI / 8; // octagons turned so a flat face looks at the camera
  parts.add('wall', prism(118, 108, -14, 8, 8, oct));
  parts.add('trim', prism(111, 111, 8, 10.5, 8, oct));
  const wallR = 100;
  const wallTop = 36;
  for (let k = 0; k < 8; k++) {
    const a0 = oct + (k * TAU) / 8;
    const a1 = a0 + TAU / 8;
    const mid = (a0 + a1) / 2;
    const len = 2 * wallR * Math.sin(Math.PI / 8);
    const c = polar(wallR * Math.cos(Math.PI / 8), mid);
    // The front face is the gatehouse; the others are plain curtain walls.
    if (roof && Math.cos(mid) > 0.99) {
      // A gap in line with the gate tunnel, with a lintel over it.
      const side = len / 2 - 6;
      for (const sx of [-1, 1]) parts.add('wall', box(side, wallTop - 8, 6), at(sx * (6 + side / 2), (wallTop + 8) / 2, c.y, 0));
      parts.add('wall', box(12, wallTop - 32, 6), at(0, (wallTop + 32) / 2, c.y, 0));
    } else parts.add('wall', box(len, wallTop - 8, 6), at(c.x, (wallTop + 8) / 2, c.y, mid));
    // Wall walk lip and arrow slits.
    parts.add('trim', box(len, 1.6, 8), at(c.x, wallTop - 0.8, c.y, mid));
    if (Math.cos(mid) > -0.3) {
      for (let i = 0; i < 6; i++) {
        const along = ((i + 0.5) / 6 - 0.5) * len * 0.8;
        const tangent = new THREE.Vector2(Math.cos(mid), -Math.sin(mid));
        const n = new THREE.Vector3(Math.sin(mid), 0, Math.cos(mid));
        if (Math.cos(mid) > 0.99 && Math.abs(along) < 30) continue; // the gate is there
        windowAt(windows, c.x + n.x * 3 + tangent.x * along, 22, c.y + n.z * 3 + tangent.y * along, n, 1.2, 5, rand() < 0.25 ? 1 : 0, rand());
      }
    }
  }
  polygonMerlons(parts, wallR + 0.5, 8, oct, wallTop, 12, [2.8, 3.4, 6.4]);
  for (let k = 0; k < 8; k++) {
    const a = oct + (k * TAU) / 8;
    const p = polar(wallR, a);
    tower(p.x, p.y, a, 11, 9.5, 0, 56, 13, 30, k);
  }

  /** A round tower with machicolations, merlons, a cone roof and a few slit windows. */
  function tower(x: number, z: number, outward: number, r0: number, r1: number, y0: number, y1: number, roofR: number, roofH: number, seed: number) {
    parts.add('wall', prism(r0, r1, y0, y1, 16).applyMatrix4(at(x, 0, z)));
    parts.add('trim', prism(r1 + 0.6, r1 + 1.6, y1 - 4, y1 - 1, 16).applyMatrix4(at(x, 0, z)));
    parts.add('trim', prism(r1 + 1.6, r1 + 1.6, y1 - 1, y1, 16).applyMatrix4(at(x, 0, z)));
    ringMerlons(parts, x, z, r1 + 1.1, y1, 10, [2.2, 2.8, 1.8]);
    parts.add('roof', cone(roofR, y1 + 1.5, roofH, 12).applyMatrix4(at(x, 0, z)));
    parts.add('trim', cone(0.8, y1 + 1.5 + roofH - 1, 8, 4).applyMatrix4(at(x, 0, z)));
    // Slits facing outward (and toward the camera, where it can see them).
    for (const dy of [0.42, 0.66]) {
      const y = THREE.MathUtils.lerp(y0, y1, dy);
      const r = THREE.MathUtils.lerp(r0, r1, dy);
      for (const off of [-0.6, 0, 0.6]) {
        const a = outward + off;
        if (Math.cos(a) < -0.2) continue;
        const n = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
        windowAt(windows, x + n.x * r, y, z + n.z * r, n, 1.4, 4.2, ((seed * 7 + off * 10) | 0) % 3 === 0 ? 1 : 0, rand());
      }
    }
  }

  // ── gatehouse, facing the camera ───────────────────────────────────────
  const gateZ = wallR * Math.cos(Math.PI / 8) + 6;
  if (roof) {
    // Two piers and a lintel: a real tunnel 12 wide, 21.5 high, through to the courtyard.
    for (const sx of [-1, 1]) parts.add('wall', box(9, 48, 16), at(sx * 10.5, 24, gateZ));
    parts.add('wall', box(12, 16, 16), at(0, 40, gateZ));
    parts.add('trim', box(12, 1, 19), at(0, 10, gateZ - 1.5)); // the tunnel floor, onto the plinth
    // Lanterns along both walls of the tunnel.
    for (const dz of [-6, 0, 6]) for (const sx of [-1, 1]) windowAt(windows, sx * 6, 22, gateZ + dz, new THREE.Vector3(-sx, 0, 0), 1.6, 3.4, 1, 0.9);
  } else parts.add('wall', box(30, 48, 16), at(0, 24, gateZ));
  parts.add('trim', box(32, 2, 18), at(0, 48, gateZ));
  for (let i = 0; i < 7; i++) parts.add('trim', box(2.6, 3, 2), at(-12 + i * 4, 50.5, gateZ + 8));
  if (!roof) windowAt(windows, 0, 14, gateZ + 8, new THREE.Vector3(0, 0, 1), 11, 22, 1, 0.95, 1);
  for (const x of [-9, 0, 9]) windowAt(windows, x, 36, gateZ + 8, new THREE.Vector3(0, 0, 1), 2.4, 6, 1, rand());
  tower(-19, gateZ + 2, 0, 9, 8, 0, 66, 11, 30, 31);
  tower(19, gateZ + 2, 0, 9, 8, 0, 66, 11, 30, 32);

  // ── inner hall with buttresses ─────────────────────────────────────────
  // (The roof variant's hall has straight walls, so its facade can carry a portal.)
  const hallR0 = roof ? 67 : 70;
  const hallR1 = roof ? 67 : 64;
  const hallTop = 78;
  if (roof) {
    // Hollow: an outer shell with every face but the front, an inner shell
    // seen from inside, and a front facade with a portal 18 wide, 33.5 high.
    const from = Math.PI / 8;
    const span = (TAU * 7) / 8;
    parts.add('wall', tube(hallR0, hallR1, 8, hallTop, 7, from, span));
    parts.add('inner', flipped(tube(hallR0 - 2.5, hallR1 - 2.5, 8, hallTop, 7, from, span)));
    const ap = hallR0 * Math.cos(Math.PI / 8);
    const half = hallR0 * Math.sin(Math.PI / 8);
    const side = half - 9;
    for (const sx of [-1, 1]) parts.add('wall', box(side, hallTop - 8, 2.4), at(sx * (9 + side / 2), (hallTop + 8) / 2, ap - 1.2));
    parts.add('wall', box(18, hallTop - 44, 2.4), at(0, (hallTop + 44) / 2, ap - 1.2));
    parts.add('trim', box(20, 1.6, 3.2), at(0, 44.8, ap - 1.2)); // the portal's lintel moulding
    // Roof (up) and ceiling (down) round the drum; parapet band; string course band.
    parts.add('trim', ring(48, hallR0 + 2.5, hallTop, true, 32));
    parts.add('inner', ring(46, hallR0 - 2.5, hallTop - 0.5, false, 32));
    parts.add('trim', tube(hallR1 + 2.5, hallR1 + 2.5, hallTop, hallTop + 3, 32));
    parts.add('trim', tube(hallR0 + 1.5, hallR0 + 1.5, 40, 42, 32));
    // Lanterns inside the hall, on the inner walls.
    for (let k = 0; k < 16; k++) {
      const a = (k + 0.5) * (TAU / 16);
      if (Math.cos(a) > 0.92) continue;
      const r = (hallR0 - 2.5) * Math.cos(Math.PI / 8) - 0.6;
      const p = polar(r, a);
      for (const y of [30, 56]) windowAt(windows, p.x, y, p.y, new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a)), 2.2, 5, 1, 0.8);
    }
  } else {
    parts.add('wall', prism(hallR0, hallR1, 8, hallTop, 8, oct));
    parts.add('trim', prism(hallR1 + 3, hallR1 + 3, hallTop, hallTop + 3, 8, oct));
    parts.add('trim', prism(hallR0 + 1.5, hallR0 + 1.5, 40, 42, 8, oct)); // string course
  }
  polygonMerlons(parts, hallR1 + 2.5, 8, oct, hallTop + 3, 10, [2.6, 3.2, 2.4]);
  prismWindows(windows, rand, hallR0, hallR1, 8, hallTop, 8, oct, [26, 58], 3, 4.2, 13, 0.6, true, roof);
  for (let k = 0; k < 8; k++) {
    // Stepped buttresses at the hall's corners, each topped by a pinnacle.
    const a = oct + (k * TAU) / 8;
    for (const [rr, y0, y1, w] of [
      [hallR0 + 4, 8, 62, 6],
      [hallR0 + 8.5, 8, 40, 5],
      [hallR0 + 12, 8, 22, 4],
    ] as const) {
      const p = polar(rr, a);
      parts.add('wall', box(w, y1 - y0, 7), at(p.x, (y0 + y1) / 2, p.y, a));
      parts.add('trim', box(w + 1, 1.2, 8), at(p.x, y1 + 0.6, p.y, a));
    }
    const top = polar(hallR0 + 4, a);
    parts.add('roof', cone(3.2, 63, 16, 4, Math.PI / 4).applyMatrix4(at(top.x, 0, top.y, a)));
  }

  // ── the drum, ringed by bartizans ──────────────────────────────────────
  const drumR0 = 48;
  const drumR1 = 44;
  const drumTop = 124;
  if (roof) {
    parts.add('wall', tube(drumR0, drumR1, hallTop, drumTop, 16));
    parts.add('inner', flipped(tube(drumR0 - 2, drumR1 - 2, hallTop, drumTop, 16)));
    parts.add('trim', tube(drumR1 + 2.5, drumR1 + 2.5, drumTop, drumTop + 2.5, 16));
    parts.add('trim', ring(31, drumR1 + 2.5, drumTop, true, 32)); // the drum's roof round the keep
    parts.add('inner', ring(29, drumR1 - 2, drumTop - 0.5, false, 32)); // its ceiling, seen from the shaft
    parts.add('trim', tube(drumR0 + 1, drumR0 + 1, 96, 97.5, 16));
  } else {
    parts.add('wall', prism(drumR0, drumR1, hallTop, drumTop, 16));
    parts.add('trim', prism(drumR1 + 2.5, drumR1 + 2.5, drumTop, drumTop + 2.5, 16));
    parts.add('trim', prism(drumR0 + 1, drumR0 + 1, 96, 97.5, 16));
  }
  polygonMerlons(parts, drumR1 + 2, 16, 0, drumTop + 2.5, 3, [2.4, 3, 2.2]);
  prismWindows(windows, rand, drumR0, drumR1, hallTop, drumTop, 16, 0, [88, 110], 1, 3.2, 12, 0.55);
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * TAU) / 8;
    const p = polar(drumR1 + 2, a);
    parts.add('wall', prism(4.6, 4.6, drumTop - 22, drumTop + 10, 12).applyMatrix4(at(p.x, 0, p.y)));
    // A corbel cone under each bartizan.
    parts.add('trim', cone(4.6, 0, 8, 12).applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI)).applyMatrix4(at(p.x, drumTop - 22, p.y)));
    parts.add('roof', cone(5.6, drumTop + 10, 18, 10).applyMatrix4(at(p.x, 0, p.y)));
  }

  // ── the keep ───────────────────────────────────────────────────────────
  const keepR0 = 31;
  const keepR1 = 24;
  const keepTop = 222;
  const dodec = Math.PI / 12;
  /** Lights inside the hollow castle (roof variant): gallery rings, a spiral up the walls, braziers. */
  const lamps: THREE.Matrix4[] = [];
  const keepInner = (y: number) => THREE.MathUtils.lerp(keepR0 - 2, keepR1 - 2, (y - drumTop) / (keepTop - drumTop));
  if (roof) {
    parts.add('wall', tube(keepR0, keepR1, drumTop, keepTop, 12, dodec));
    parts.add('inner', flipped(tube(keepR0 - 2, keepR1 - 2, drumTop, keepTop, 12, dodec)));
    for (const y of [148, 172, 196]) {
      const r = THREE.MathUtils.lerp(keepR0, keepR1, (y - drumTop) / (keepTop - drumTop));
      parts.add('trim', tube(r + 1.6, r + 1.6, y, y + 1.8, 12, dodec));
      // A gallery floor inside, with a hole for the shaft; lanterns round its rim.
      const ri = keepInner(y);
      parts.add('inner', ring(11, ri, y + 0.75, true, 36));
      parts.add('inner', ring(11, ri, y - 0.75, false, 36));
      parts.add('inner', flipped(tube(11, 11, y - 0.75, y + 0.75, 36)));
      for (let k = 0; k < 12; k++) {
        const p = polar(12.2, (k / 12) * TAU);
        lamps.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, y + 1.6, p.y), new THREE.Quaternion(), new THREE.Vector3(0.7, 1.4, 0.7)));
      }
    }
    // A spiral of lanterns climbing the walls, from the hall to the belfry.
    for (let i = 0; i < 72; i++) {
      const y = 84 + i * 1.95;
      const r = (y < drumTop ? THREE.MathUtils.lerp(drumR0 - 2, drumR1 - 2, (y - hallTop) / (drumTop - hallTop)) : keepInner(y)) - 1.2;
      const p = polar(r, i * 0.55);
      lamps.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, y, p.y), new THREE.Quaternion(), new THREE.Vector3(1.0, 2.0, 1.0)));
    }
  } else {
    parts.add('wall', prism(keepR0, keepR1, drumTop, keepTop, 12, dodec));
    for (const y of [148, 172, 196]) {
      const r = THREE.MathUtils.lerp(keepR0, keepR1, (y - drumTop) / (keepTop - drumTop));
      parts.add('trim', prism(r + 1.6, r + 1.6, y, y + 1.8, 12, dodec));
    }
  }
  prismWindows(windows, rand, keepR0, keepR1, drumTop, keepTop, 12, dodec, [136, 160, 184, 208], 1, 2.8, 11, 0.5);
  // Pilasters on the keep's corners.
  for (let k = 0; k < 12; k++) {
    const a = dodec + (k * TAU) / 12;
    const b = polar(keepR0 + 0.6, a);
    const t = polar(keepR1 + 0.6, a);
    const bottom = new THREE.Vector3(b.x, drumTop, b.y);
    const topP = new THREE.Vector3(t.x, keepTop, t.y);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, topP.clone().sub(bottom).normalize());
    parts.add('trim', box(2.2, bottom.distanceTo(topP), 2.2), new THREE.Matrix4().compose(bottom.add(topP).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  }
  // Four slender corner towers on the keep.
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * TAU) / 4;
    const p = polar(keepR0 + 4, a);
    const top = 236 + (k % 2) * 10;
    parts.add('wall', prism(6.5, 5.2, drumTop - 4, top, 12, dodec).applyMatrix4(at(p.x, 0, p.y)));
    for (const y of [160, 200]) parts.add('trim', prism(6.6, 6.6, y, y + 1.4, 12, dodec).applyMatrix4(at(p.x, 0, p.y)));
    parts.add('trim', prism(5.4, 6.8, top - 3, top, 12, dodec).applyMatrix4(at(p.x, 0, p.y)));
    parts.add('roof', cone(7.4, top, 30, 12).applyMatrix4(at(p.x, 0, p.y)));
    parts.add('trim', cone(0.7, top + 29, 9, 4).applyMatrix4(at(p.x, 0, p.y)));
    if (Math.cos(a) > -0.3) {
      for (const y of [150, 180, 214]) {
        const r = THREE.MathUtils.lerp(6.5, 5.2, (y - drumTop) / (top - drumTop));
        const n = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
        windowAt(windows, p.x + n.x * r, y, p.y + n.z * r, n, 1.6, 5, rand() < 0.6 ? 1 : 0, rand());
      }
    }
  }
  // Flying buttresses: from the hall's buttress heads up to the keep.
  for (let k = 0; k < 8; k++) {
    const a = oct + (k * TAU) / 8;
    const p0 = polar(hallR0 + 4, a);
    const from = new THREE.Vector3(p0.x, 62, p0.y);
    const tp = polar(keepR0 - 1, a);
    const to = new THREE.Vector3(tp.x, 166, tp.y);
    // Nearly straight struts with a slight upward arch (gothic flyers, not hoops).
    const ctrl = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 10, 0));
    const curve = new THREE.QuadraticBezierCurve3(from, ctrl, to);
    const steps = 14;
    for (let i = 0; i < steps; i++) {
      const s0 = curve.getPoint(i / steps);
      const s1 = curve.getPoint((i + 1) / steps);
      const mid = s0.clone().add(s1).multiplyScalar(0.5);
      const len = s0.distanceTo(s1) + 0.6;
      const dir = s1.clone().sub(s0).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
      // Keep the strut's flat side facing sideways (its width is tangential).
      const side = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      const local = side.clone().applyQuaternion(q.clone().invert());
      q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(-local.z, local.x)));
      parts.add('wall', box(3.4, len, 5.5), new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
    }
  }

  // ── crown: belfry, pinnacles, spire ────────────────────────────────────
  const belfry0 = keepTop + 3;
  const belfry1 = belfry0 + 22;
  if (roof) {
    // The balcony as a ring: the shaft opens into the belfry.
    parts.add('trim', tube(keepR1 + 4, keepR1 + 4, keepTop, belfry0, 12, dodec));
    parts.add('trim', ring(keepR1 - 2, keepR1 + 4, belfry0, true, 36));
  } else parts.add('trim', prism(keepR1 + 4, keepR1 + 4, keepTop, belfry0, 12, dodec)); // balcony slab
  polygonMerlons(parts, keepR1 + 3.6, 12, dodec, belfry0, 3, [1.4, 2.2, 1]);
  for (let k = 0; k < 12; k++) {
    const a = dodec + (k * TAU) / 12;
    const p = polar(keepR1 - 1.5, a);
    parts.add('wall', box(2.4, belfry1 - belfry0, 2.4), at(p.x, (belfry0 + belfry1) / 2, p.y, a));
  }
  /** The roof terrace's floor (its own material: flagstones and the inlaid seal). */
  let terraceFloor: THREE.BufferGeometry | null = null;
  if (roof) {
    // The terrace: a floor with an oculus over the shaft, a parapet with
    // merlons, pinnacles round it, braziers. (TERRACE.y = belfry1 + 3.)
    const ty = belfry1 + 3;
    parts.add('trim', tube(TERRACE.radius, TERRACE.radius, belfry1, ty + 2.5, 36));
    parts.add('inner', ring(TERRACE.oculus, keepR1 - 1, belfry1, false, 36)); // the belfry's ceiling
    parts.add('inner', flipped(tube(TERRACE.oculus, TERRACE.oculus, belfry1, ty, 36))); // the oculus' rim
    terraceFloor = ring(TERRACE.oculus, TERRACE.radius, ty, true, 72);
    polygonMerlons(parts, TERRACE.radius, 24, 0, ty + 2.5, 1, [2.2, 2.4, 1.4]);
    for (let k = 0; k < 12; k++) {
      const a = dodec + (k * TAU) / 12;
      const p = polar(TERRACE.radius + 1.6, a);
      parts.add('trim', box(2.4, 3, 2.4), at(p.x, ty + 1.5, p.y, a));
      parts.add('roof', cone(1.5, ty + 3, 12, 4, Math.PI / 4).applyMatrix4(at(p.x, 0, p.y)));
    }
    for (let k = 0; k < 4; k++) {
      const p = polar(20.5, Math.PI / 4 + (k * TAU) / 4);
      parts.add('trim', prism(0.5, 1.6, ty, ty + 2.2, 8).applyMatrix4(at(p.x, 0, p.y)));
      lamps.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, ty + 3.2, p.y), new THREE.Quaternion(), new THREE.Vector3(1.0, 1.8, 1.0)));
    }
  } else {
    parts.add('trim', prism(keepR1 + 1, keepR1 + 2.5, belfry1, belfry1 + 3, 12, dodec));
    for (let k = 0; k < 12; k++) {
      const a = dodec + (k * TAU) / 12;
      const p = polar(keepR1 + 1, a);
      parts.add('roof', cone(1.5, belfry1 + 3, 12, 4, Math.PI / 4).applyMatrix4(at(p.x, 0, p.y)));
    }
  }
  const spire0 = belfry1 + 3;
  if (!roof) parts.add('roof', cone(keepR1 - 2, spire0, CITADEL_TOP - 8 - spire0, 12, dodec));
  for (let k = 0; k < (roof ? 0 : 4); k++) {
    // Dormers on the spire.
    const a = (k * TAU) / 4;
    const p = polar(keepR1 - 9, a);
    parts.add('wall', box(4, 6, 4), at(p.x, spire0 + 12, p.y, a));
    parts.add('roof', cone(3.6, spire0 + 15, 6, 4, Math.PI / 4).applyMatrix4(at(p.x, 0, p.y, a)));
  }
  if (!roof) parts.add('trim', cone(1.0, CITADEL_TOP - 10, 10, 6));

  // ── merge into one mesh (+ ink) per tone ──────────────────────────────
  for (const tone of Object.keys(parts.lists) as (keyof typeof CITADEL_TONE)[]) {
    if (parts.lists[tone].length === 0) continue; // (only the roof variant has an inside)
    const geo = mergeGeometries(parts.lists[tone], false);
    if (!geo) {
      console.error(`[hell-20 citadel] merge failed for ${tone}`);
      continue;
    }
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, kit.stone(tone));
    mesh.frustumCulled = false;
    group.add(mesh);
    // The inside is seen from inside: no ink (the outline is drawn from back faces).
    if (tone !== 'inner') {
      const ink = new THREE.Mesh(geo, kit.hull());
      ink.frustumCulled = false;
      group.add(ink);
    }
  }

  // ── windows ────────────────────────────────────────────────────────────
  const recess = { value: new THREE.Color() };
  const winMat = makeWindowMaterial(env, P, recess, kit.fogK);
  const winGeo = windowGeometry();
  const aWin = new Float32Array(windows.length * 3);
  windows.forEach((w, i) => aWin.set([w.lit, w.seed, w.mullion], i * 3));
  winGeo.setAttribute('aWin', new THREE.InstancedBufferAttribute(aWin, 3));
  const winMesh = new THREE.InstancedMesh(winGeo, winMat, windows.length);
  windows.forEach((w, i) => winMesh.setMatrixAt(i, w.m));
  winMesh.frustumCulled = false;
  group.add(winMesh);

  // ── light: belfry core, beacon, beam into the sky ──────────────────────
  const lightMat = makeLight(env, P, { threads: 10, coreHDR: 1.8, threadHDR: 1.1 });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(keepR1 - 6, keepR1 - 6, belfry1 - belfry0, 24, 1, true), lightMat);
  core.position.y = (belfry0 + belfry1) / 2;
  if (roof) {
    // The drone flies up through the core: draw it from inside too (its own material).
    const coreMat = makeLight(env, P, { threads: 10, coreHDR: 1.8, threadHDR: 1.1 });
    coreMat.side = THREE.DoubleSide;
    core.material = coreMat;
  }
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), lightMat);
  beacon.scale.set(2.2, 4.5, 2.2);
  beacon.position.y = CITADEL_TOP + 4;
  const beamMat = makeLight(env, P, { threads: 3, coreHDR: 1.1, threadHDR: 0.8 });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.9, 900, 8, 1, true), beamMat);
  beam.position.y = roof ? TERRACE.y + 450 : CITADEL_TOP + 8 + 450;
  // On the roof the beam is seen from a few metres: thinner and calmer there.
  if (roof) {
    beam.geometry = new THREE.CylinderGeometry(0.28, 0.4, 900, 8, 1, true);
    beam.material = makeLight(env, P, { threads: 3, coreHDR: 0.8, threadHDR: 0.6 });
  }
  core.frustumCulled = beacon.frustumCulled = beam.frustumCulled = false;
  group.add(core, beam);
  if (!roof) group.add(beacon);
  if (lamps.length > 0) {
    const lampMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), lightMat, lamps.length);
    lamps.forEach((m, i) => lampMesh.setMatrixAt(i, m));
    lampMesh.frustumCulled = false;
    group.add(lampMesh);
  }
  if (terraceFloor) {
    const floor = new THREE.Mesh(terraceFloor, makeTerraceMaterial(env, P, kit.fogK, palette));
    floor.frustumCulled = false;
    group.add(floor);
  }

  // ── banners on the hall, facing the camera ─────────────────────────────
  const cloth = { value: new THREE.Color() };
  const trimCol = { value: new THREE.Color() };
  const bannerGeo = new THREE.PlaneGeometry(1, 1, 4, 12);
  bannerGeo.translate(0, -0.5, 0); // hangs from its top edge
  const banners: THREE.Matrix4[] = [];
  // Hung from beams just clear of the leaning wall (its foot is the widest point).
  for (const theta of roof ? [-Math.PI / 4, -0.3, 0.3, Math.PI / 4] : [-Math.PI / 4, -0.1, 0.1, Math.PI / 4]) {
    const p = polar(hallR0 * Math.cos(Math.PI / 8) + 0.6, theta);
    banners.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, hallTop - 2, p.y), new THREE.Quaternion().setFromAxisAngle(UP, theta), new THREE.Vector3(7, 44, 1)));
  }
  for (const x of [-26, 26]) banners.push(new THREE.Matrix4().compose(new THREE.Vector3(x, wallTop + 6, gateZ + 2), new THREE.Quaternion(), new THREE.Vector3(5, 30, 1)));
  const bannerMesh = new THREE.InstancedMesh(bannerGeo, makeBannerMaterial(env, P, cloth, trimCol, kit.fogK), banners.length);
  banners.forEach((m, i) => bannerMesh.setMatrixAt(i, m));
  bannerMesh.frustumCulled = false;
  group.add(bannerMesh);

  palette.subscribe((p) => {
    recess.value.set(p.stone.shade).multiplyScalar(0.12);
    // Banners in the circles' red, darkened to cloth; the trim in the pillar's light.
    cloth.value.set(p.glow.circles).multiplyScalar(0.32);
    trimCol.value.set(p.glow.pillar).multiplyScalar(0.7);
  });

  return {
    group,
    frame(t) {
      beacon.rotation.y = t * 0.4;
    },
  };
}

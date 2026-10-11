// COPIED from .claude/pages/ad/experiments/hell-src/scene/piano-toon.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * The grand piano on the citadel's roof terrace (hell-30, FLIGHT.md), drawn
 * the scene's way: the hell-06 banded toon stone and ink outline, not PBR
 * (the Nodestra landing piano is physically shaded and would look pasted
 * in). Black lacquer case with a peach rim light, raised lid over a gold
 * harp plate, 88 keys that go down and glow when played, music desk, lyre
 * and pedals, three legs, a bench.
 *
 * Local metres: the origin is on the floor under the front edge of the
 * keyboard; the keys run along x, the player sits at +z, the tail is at −z.
 */

import * as THREE from 'three';
import type { EnvUniforms } from '../../env-src/lab';
import type { PillarUniforms } from '../hell-06-pillar-glsl';
import { makeHull, makeStone } from '../hell-06-pillar-parts';

export type ToonPiano = {
  group: THREE.Group;
  /** Press (down = true) or release a key, by MIDI note (21 … 108). */
  press(midi: number, down: boolean): void;
  update(dt: number): void;
};

/** The piano currently on the roof, for the page that plays it. */
export const pianoHandle: { current: ToonPiano | null } = { current: null };

const WHITE_W = 1.22 / 52;
const BLACK = new Set([1, 3, 6, 8, 10]);
const KEY_TOP = 0.722;

export function buildToonPiano(env: EnvUniforms, P: PillarUniforms, fov: { value: number }, fogK: { value: number }): ToonPiano {
  const group = new THREE.Group();
  group.name = 'piano';
  const toon = (lit: string, shade: string, deep: string, rim: string, rimW: number, rimHDR: number) => {
    const m = makeStone(env, P, { lit, shade, deep, rim, rimW, rimHDR, contact: 0 }, fov);
    m.uniforms.uFogK = fogK;
    return m;
  };
  const lacquer = toon('#3b3346', '#17131d', '#09070c', '#fcc29d', 0.35, 1.6);
  // Ivory under the bloom threshold: only a played key glows.
  const ivory = toon('#d6ccc2', '#a2968f', '#5f525a', '#ffe0cc', 0.15, 0.25);
  const spruce = toon('#c99a5b', '#7a5532', '#3d2818', '#ffd6c0', 0.1, 0.3);
  const gold = toon('#d9b04f', '#8a6a23', '#4a3610', '#fff0d0', 0.2, 0.9);
  const ink = makeHull(env, P);
  ink.uniforms.uFogK = fogK;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, m?: THREE.Matrix4, outline = true) => {
    if (m) geo.applyMatrix4(m);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
    if (outline) {
      const hull = new THREE.Mesh(geo, ink);
      hull.frustumCulled = false;
      group.add(hull);
    }
    return mesh;
  };
  const flat = (g: THREE.BufferGeometry) => {
    const f = g.index ? g.toNonIndexed() : g;
    f.computeVertexNormals();
    return f;
  };
  const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));

  // ── the case: a grand's outline, straight bass side, curved bentside ──
  // Shape coordinates are (x, depth), depth = −z.
  const outline = (inset = 0) => {
    const s = new THREE.Shape();
    const L = -0.74 + inset;
    const R = 0.74 - inset;
    s.moveTo(L, 0.12 + inset);
    s.lineTo(L, 1.95 - inset * 0.5);
    s.quadraticCurveTo(L, 2.3 - inset, -0.32, 2.3 - inset);
    s.bezierCurveTo(0.38 - inset, 2.27 - inset, 0.22 - inset, 1.3, R, 1.05);
    s.lineTo(R, 0.12 + inset);
    s.lineTo(L, 0.12 + inset);
    return s;
  };
  const toFloor = new THREE.Matrix4().makeRotationX(-Math.PI / 2); // (x, depth, h) → (x, h, −depth)
  const caseGeo = new THREE.ExtrudeGeometry(outline(), { depth: 0.3, bevelEnabled: false, curveSegments: 24 });
  add(flat(caseGeo), lacquer, new THREE.Matrix4().makeTranslation(0, 0.62, 0).multiply(toFloor));
  // Inside under the lid: spruce soundboard and the gold harp plate.
  add(flat(new THREE.ShapeGeometry(outline(0.04), 24)), spruce, new THREE.Matrix4().makeTranslation(0, 0.905, 0).multiply(toFloor), false);
  add(flat(new THREE.ShapeGeometry(outline(0.12), 24)), gold, new THREE.Matrix4().makeTranslation(0, 0.912, 0).multiply(toFloor), false);
  // The lid, hinged on the bass side, propped open.
  const LID = 0.62;
  const lidGeo = flat(new THREE.ExtrudeGeometry(outline(), { depth: 0.025, bevelEnabled: false, curveSegments: 24 }));
  lidGeo.applyMatrix4(toFloor);
  lidGeo.translate(0.74, 0, 0); // hinge line on x = 0
  add(lidGeo, lacquer, new THREE.Matrix4().makeTranslation(-0.74, 0.925, 0).multiply(new THREE.Matrix4().makeRotationZ(LID)));
  {
    // The prop stick from the rim to the lid's underside.
    const foot = new THREE.Vector3(0.6, 0.92, -1.15);
    const reach = 1.34;
    const top = new THREE.Vector3(-0.74 + reach * Math.cos(LID), 0.925 + reach * Math.sin(LID), -1.15);
    const dir = top.clone().sub(foot);
    const stick = new THREE.CylinderGeometry(0.012, 0.012, dir.length(), 6);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    add(stick, lacquer, new THREE.Matrix4().compose(foot.clone().add(top).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)), false);
  }
  // Key bed, cheeks, nameboard, music desk.
  add(flat(new THREE.BoxGeometry(1.36, 0.08, 0.17)), lacquer, at(0, 0.66, -0.065));
  for (const sx of [-1, 1]) add(flat(new THREE.BoxGeometry(0.07, 0.17, 0.17)), lacquer, at(sx * 0.645, 0.7, -0.065));
  add(flat(new THREE.BoxGeometry(1.24, 0.09, 0.03)), lacquer, at(0, 0.765, -0.165));
  add(flat(new THREE.BoxGeometry(0.82, 0.32, 0.02)), lacquer, at(0, 1.08, -0.34, -0.26));
  add(flat(new THREE.BoxGeometry(0.84, 0.03, 0.06)), lacquer, at(0, 0.93, -0.3));
  // Legs, lyre, pedals.
  for (const [x, z] of [[-0.62, -0.3], [0.62, -0.3], [-0.25, -1.95]] as const) {
    add(flat(new THREE.CylinderGeometry(0.06, 0.042, 0.62, 10)), lacquer, at(x, 0.31, z));
  }
  add(flat(new THREE.BoxGeometry(0.14, 0.5, 0.05)), lacquer, at(0, 0.33, -0.36));
  for (const x of [-0.05, 0, 0.05]) add(flat(new THREE.BoxGeometry(0.028, 0.014, 0.08)), gold, at(x, 0.07, -0.3), false);
  // The bench.
  add(flat(new THREE.BoxGeometry(0.78, 0.07, 0.36)), lacquer, at(0, 0.5, 0.62));
  for (const [x, z] of [[-0.34, 0.47], [0.34, 0.47], [-0.34, 0.77], [0.34, 0.77]] as const) add(flat(new THREE.BoxGeometry(0.05, 0.47, 0.05)), lacquer, at(x, 0.235, z));

  // ── the keys ──
  type Key = { midi: number; black: boolean; x: number; down: number; target: number; mesh: THREE.InstancedMesh; index: number };
  const keys: Key[] = [];
  let whites = 0;
  const whiteList: { midi: number; x: number }[] = [];
  const blackList: { midi: number; x: number }[] = [];
  for (let midi = 21; midi <= 108; midi++) {
    if (BLACK.has(midi % 12)) blackList.push({ midi, x: -0.61 + whites * WHITE_W });
    else {
      whiteList.push({ midi, x: -0.61 + (whites + 0.5) * WHITE_W });
      whites++;
    }
  }
  const whiteGeo = flat(new THREE.BoxGeometry(WHITE_W - 0.0016, 0.022, 0.145));
  const blackGeo = flat(new THREE.BoxGeometry(0.0125, 0.024, 0.09));
  const whiteMesh = new THREE.InstancedMesh(whiteGeo, ivory, whiteList.length);
  const blackMesh = new THREE.InstancedMesh(blackGeo, lacquer, blackList.length);
  whiteMesh.frustumCulled = blackMesh.frustumCulled = false;
  const plain = new THREE.Color(1, 1, 1);
  whiteList.forEach((k, i) => {
    keys.push({ midi: k.midi, black: false, x: k.x, down: 0, target: 0, mesh: whiteMesh, index: i });
    whiteMesh.setColorAt(i, plain);
  });
  blackList.forEach((k, i) => {
    keys.push({ midi: k.midi, black: true, x: k.x, down: 0, target: 0, mesh: blackMesh, index: i });
    blackMesh.setColorAt(i, plain);
  });
  const byMidi = new Map(keys.map((k) => [k.midi, k]));
  const m4 = new THREE.Matrix4();
  const glow = new THREE.Color();
  /** A key pivots at its back end; the front goes down ~1 cm and glows in the circles' red. */
  function place(k: Key) {
    const len = k.black ? 0.09 : 0.145;
    const back = k.black ? -0.16 : -0.145;
    const yTop = k.black ? KEY_TOP + 0.02 : KEY_TOP;
    const a = k.down * 0.07;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
    const centre = new THREE.Vector3(0, -0.011, len / 2).applyQuaternion(q).add(new THREE.Vector3(k.x, yTop, back));
    m4.compose(centre, q, new THREE.Vector3(1, 1, 1));
    k.mesh.setMatrixAt(k.index, m4);
    glow.setRGB(1 + 1.6 * k.down, 1 - 0.35 * k.down, 1 - 0.4 * k.down);
    k.mesh.setColorAt(k.index, glow);
  }
  for (const k of keys) place(k);
  group.add(whiteMesh, blackMesh);

  const moving = new Set<Key>();
  return {
    group,
    press(midi, down) {
      const k = byMidi.get(midi);
      if (!k) return;
      k.target = down ? 1 : 0;
      moving.add(k);
    },
    update(dt) {
      if (moving.size === 0) return;
      for (const k of moving) {
        // Down fast, up a little slower (a real action).
        const rate = k.target > k.down ? 40 : 14;
        k.down += (k.target - k.down) * Math.min(1, dt * rate);
        if (Math.abs(k.target - k.down) < 0.002) {
          k.down = k.target;
          moving.delete(k);
        }
        place(k);
      }
      whiteMesh.instanceMatrix.needsUpdate = blackMesh.instanceMatrix.needsUpdate = true;
      if (whiteMesh.instanceColor) whiteMesh.instanceColor.needsUpdate = true;
      if (blackMesh.instanceColor) blackMesh.instanceColor.needsUpdate = true;
    },
  };
}

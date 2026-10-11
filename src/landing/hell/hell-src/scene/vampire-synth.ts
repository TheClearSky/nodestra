// COPIED from .claude/pages/ad/experiments/hell-src/scene/vampire-synth.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * The Vampire Synth on the citadel's roof (hell-30; owner, 2026-10-11:
 * "have vampire synth demo on it at C2, make a procedural model that is
 * appropriate"). It replaces the grand piano on the pedestal and plays
 * Nodestra's "Vampire Synth — Nosferatu" demo, transposed to C.
 *
 * A gothic analog synthesizer, drawn the scene's way (hell-06 banded toon
 * stone + ink outline):
 *   - a coffin-shaped body in black lacquer, crimson velvet inlaid on top,
 *     a brass trim;
 *   - 61 keys, C1 … C6 (the demo, in C, runs C1 … G4), that go down and
 *     glow when played;
 *   - a slanted control panel: three rows of brass knobs, six sliders, a
 *     crimson oscilloscope that draws the wave, pitch and mod wheels;
 *   - behind it a pointed-arch organ façade with seven vacuum tubes standing
 *     like organ pipes, glowing red and pulsing with the music, bat-wing
 *     cheeks, two candles;
 *   - a stand with pointed-arch legs.
 *
 * Local metres: the origin is on the floor under the front edge of the
 * keyboard; the keys run along x, the player stands at +z.
 */

import * as THREE from 'three';
import type { EnvUniforms } from '../../env-src/lab';
import type { PillarUniforms } from '../hell-06-pillar-glsl';
import { makeHull, makeLight, makeStone } from '../hell-06-pillar-parts';

export type VampireSynth = {
  group: THREE.Group;
  /** Press (down = true) or release a key, by MIDI note (24 … 84). */
  press(midi: number, down: boolean): void;
  update(dt: number): void;
};

const LOW = 24; // C1
const HIGH = 84; // C6
const WHITE_W = 0.0225;
const BLACK = new Set([1, 3, 6, 8, 10]);
const KEY_TOP = 0.905;

export function buildVampireSynth(env: EnvUniforms, P: PillarUniforms, fov: { value: number }, fogK: { value: number }): VampireSynth {
  const group = new THREE.Group();
  group.name = 'vampire-synth';
  const toon = (lit: string, shade: string, deep: string, rim: string, rimW: number, rimHDR: number) => {
    const m = makeStone(env, P, { lit, shade, deep, rim, rimW, rimHDR, contact: 0 }, fov);
    m.uniforms.uFogK = fogK;
    return m;
  };
  const lacquer = toon('#2f2a38', '#14111a', '#08060b', '#fcc29d', 0.35, 1.5);
  const velvet = toon('#7a1426', '#3a0812', '#1a0308', '#ff8a7a', 0.2, 0.6);
  const brass = toon('#d7ae5a', '#8b6a2a', '#463312', '#fff0d0', 0.25, 1.0);
  const silver = toon('#c9c4cf', '#7c7684', '#3c3844', '#ffffff', 0.25, 0.8);
  const ivory = toon('#d6ccc2', '#a2968f', '#5f525a', '#ffe0cc', 0.15, 0.25);
  const ink = makeHull(env, P);
  ink.uniforms.uFogK = fogK;
  const flat = (g: THREE.BufferGeometry) => {
    const f = g.index ? g.toNonIndexed() : g;
    f.computeVertexNormals();
    return f;
  };
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
  const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
  // Shapes are drawn in (x, depth) with depth = −z, then laid flat.
  const toFloor = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  const slab = (shape: THREE.Shape, y: number, h: number, mat: THREE.Material, outline = true) =>
    add(flat(new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 12 })), mat, new THREE.Matrix4().makeTranslation(0, y, 0).multiply(toFloor), outline);

  // ── the coffin body ──
  const coffin = (inset: number) => {
    const s = new THREE.Shape();
    s.moveTo(-0.59 + inset, -0.02 + inset);
    s.lineTo(0.59 - inset, -0.02 + inset);
    s.lineTo(0.66 - inset, 0.14);
    s.lineTo(0.5 - inset, 0.5 - inset);
    s.lineTo(-0.5 + inset, 0.5 - inset);
    s.lineTo(-0.66 + inset, 0.14);
    s.lineTo(-0.59 + inset, -0.02 + inset);
    return s;
  };
  slab(coffin(0), 0.78, 0.1, lacquer);
  slab(coffin(-0.008), 0.877, 0.012, brass); // brass trim, a hair proud
  slab(coffin(0.05), 0.889, 0.004, velvet, false); // velvet inlay
  // The key well (a dark recess the keys sit in).
  add(flat(new THREE.BoxGeometry(0.84, 0.012, 0.17)), lacquer, at(0, 0.889, -0.065), false);

  // ── keys, C1 … C6 ──
  type Key = { midi: number; black: boolean; x: number; down: number; target: number; mesh: THREE.InstancedMesh; index: number };
  const keys: Key[] = [];
  const whites: { midi: number; x: number }[] = [];
  const blacks: { midi: number; x: number }[] = [];
  let w = 0;
  const left = -(36 * WHITE_W) / 2;
  for (let midi = LOW; midi <= HIGH; midi++) {
    if (BLACK.has(midi % 12)) blacks.push({ midi, x: left + w * WHITE_W });
    else {
      whites.push({ midi, x: left + (w + 0.5) * WHITE_W });
      w++;
    }
  }
  const whiteMesh = new THREE.InstancedMesh(flat(new THREE.BoxGeometry(WHITE_W - 0.0016, 0.018, 0.13)), ivory, whites.length);
  const blackMesh = new THREE.InstancedMesh(flat(new THREE.BoxGeometry(0.012, 0.02, 0.08)), lacquer, blacks.length);
  whiteMesh.frustumCulled = blackMesh.frustumCulled = false;
  const plain = new THREE.Color(1, 1, 1);
  whites.forEach((k, i) => {
    keys.push({ midi: k.midi, black: false, x: k.x, down: 0, target: 0, mesh: whiteMesh, index: i });
    whiteMesh.setColorAt(i, plain);
  });
  blacks.forEach((k, i) => {
    keys.push({ midi: k.midi, black: true, x: k.x, down: 0, target: 0, mesh: blackMesh, index: i });
    blackMesh.setColorAt(i, plain);
  });
  const byMidi = new Map(keys.map((k) => [k.midi, k]));
  const m4 = new THREE.Matrix4();
  const glowCol = new THREE.Color();
  function place(k: Key) {
    const len = k.black ? 0.08 : 0.13;
    const back = k.black ? -0.14 : -0.12;
    const yTop = k.black ? KEY_TOP + 0.018 : KEY_TOP;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), k.down * 0.075);
    const centre = new THREE.Vector3(0, -0.009, len / 2).applyQuaternion(q).add(new THREE.Vector3(k.x, yTop, back));
    m4.compose(centre, q, new THREE.Vector3(1, 1, 1));
    k.mesh.setMatrixAt(k.index, m4);
    // Played keys glow blood red.
    glowCol.setRGB(1 + 2.2 * k.down, 1 - 0.55 * k.down, 1 - 0.6 * k.down);
    k.mesh.setColorAt(k.index, glowCol);
  }
  for (const k of keys) place(k);
  group.add(whiteMesh, blackMesh);

  // ── pitch and mod wheels, left of the keys ──
  for (const x of [-0.515, -0.47]) {
    const wheel = new THREE.CylinderGeometry(0.032, 0.032, 0.014, 20).rotateZ(Math.PI / 2);
    add(flat(wheel), silver, at(x, 0.9, -0.06));
  }

  // ── the slanted control panel ──
  const tilt = 0.32; // the back edge higher: it slopes up away from the player
  const panelC = new THREE.Vector3(0, 0.935, -0.29);
  add(flat(new THREE.BoxGeometry(1.06, 0.03, 0.27)), lacquer, at(panelC.x, panelC.y, panelC.z, tilt));
  const onPanel = (x: number, u: number, lift: number) => {
    // u along the panel (−0.5 front … 0.5 back), lift above its surface.
    const local = new THREE.Vector3(x, 0.015 + lift, u * 0.27).applyEuler(new THREE.Euler(tilt, 0, 0));
    return local.add(panelC);
  };
  const knobGeo = flat(new THREE.CylinderGeometry(0.011, 0.013, 0.02, 12));
  const knobs: THREE.Matrix4[] = [];
  for (const [u, n] of [[-0.3, 10], [0.0, 10], [0.3, 8]] as const) {
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.072 + (u === 0.3 ? 0 : 0);
      if (Math.abs(x) < 0.12 && u > -0.1) continue; // the oscilloscope is there
      const p = onPanel(x, u, 0.01);
      knobs.push(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, (i * 0.7) % 3, 0)), new THREE.Vector3(1, 1, 1)));
    }
  }
  const knobMesh = new THREE.InstancedMesh(knobGeo, brass, knobs.length);
  knobs.forEach((m, i) => knobMesh.setMatrixAt(i, m));
  knobMesh.frustumCulled = false;
  group.add(knobMesh);
  // Sliders on the right.
  for (let i = 0; i < 6; i++) {
    const p = onPanel(0.4 + (i - 2.5) * 0.022 + 0.02, 0.3, 0.004);
    add(flat(new THREE.BoxGeometry(0.006, 0.004, 0.08)), lacquer, at(p.x, p.y, p.z, tilt), false);
    const cap = onPanel(0.4 + (i - 2.5) * 0.022 + 0.02, 0.3 + Math.sin(i * 1.7) * 0.1, 0.012);
    add(flat(new THREE.BoxGeometry(0.016, 0.01, 0.012)), silver, at(cap.x, cap.y, cap.z, tilt));
  }
  // The oscilloscope: a crimson trace that grows with the playing.
  const scopeU = { uLevel: { value: 0 }, uTime: { value: 0 }, uColour: { value: new THREE.Color('#ff2a3a') } };
  const scope = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.11),
    new THREE.ShaderMaterial({
      uniforms: scopeU,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform float uLevel; uniform float uTime; uniform vec3 uColour;
        varying vec2 vUv;
        void main() {
          vec2 p = vUv - 0.5;
          float wave = sin(p.x * 34.0 + uTime * 9.0) * 0.6 + sin(p.x * 71.0 - uTime * 5.0) * 0.25;
          float y = wave * (0.04 + 0.26 * uLevel);
          float d = abs(p.y - y);
          float trace = exp(-d * 260.0) * 2.2 + exp(-d * 40.0) * 0.35;
          float grid = (step(0.49, abs(fract(vUv.x * 8.0) - 0.5)) + step(0.48, abs(fract(vUv.y * 4.0) - 0.5))) * 0.06;
          vec3 col = vec3(0.02, 0.0, 0.01) + uColour * (trace * (0.35 + uLevel) + grid);
          float edge = smoothstep(0.5, 0.46, max(abs(p.x), abs(p.y)));
          gl_FragColor = vec4(col * edge, 1.0);
        }
      `,
    }),
  );
  scope.position.copy(onPanel(0, 0.12, 0.0075)); // just above its bezel
  scope.rotation.set(tilt - Math.PI / 2, 0, 0);
  scope.frustumCulled = false;
  group.add(scope);
  {
    const bezel = onPanel(0, 0.12, -0.002);
    add(flat(new THREE.BoxGeometry(0.23, 0.008, 0.14)), brass, at(bezel.x, bezel.y, bezel.z, tilt));
  }

  // ── the organ façade: pointed arches, vacuum tubes, bat wings ──
  const facade = new THREE.Shape();
  const fw = 0.54;
  facade.moveTo(-fw, 0);
  facade.lineTo(-fw, 0.22);
  // Three pointed gables, the middle one tallest.
  const gable = (x0: number, x1: number, h: number) => {
    const mid = (x0 + x1) / 2;
    facade.quadraticCurveTo(x0, h * 0.75, mid, h);
    facade.quadraticCurveTo(x1, h * 0.75, x1, 0.22);
  };
  gable(-fw, -0.18, 0.4);
  gable(-0.18, 0.18, 0.52);
  gable(0.18, fw, 0.4);
  facade.lineTo(fw, 0);
  facade.lineTo(-fw, 0);
  const facadeGeo = flat(new THREE.ExtrudeGeometry(facade, { depth: 0.03, bevelEnabled: false, curveSegments: 10 }));
  add(facadeGeo, lacquer, at(0, 0.88, -0.47));
  // Brass tracery: a rose window in the middle gable.
  add(flat(new THREE.TorusGeometry(0.06, 0.006, 8, 28)), brass, at(0, 1.25, -0.435));
  add(flat(new THREE.CircleGeometry(0.054, 28)), velvet, at(0, 1.25, -0.438), false);
  // A ledge the tubes stand on.
  add(flat(new THREE.BoxGeometry(1.0, 0.02, 0.07)), brass, at(0, 0.985, -0.42));
  // Seven vacuum tubes like organ pipes (tallest in the middle).
  const tubeCore = { value: new THREE.Color() };
  const tubeFringe = { value: new THREE.Color() };
  const tubeHalo = { value: new THREE.Color() };
  const tubeLight = makeLight(env, { ...P, uCore: tubeCore, uFringe: tubeFringe, uHalo: tubeHalo } as PillarUniforms, { threads: 4, coreHDR: 1.4, threadHDR: 0.6 });
  const glass = toon('#3a2a34', '#1a1018', '#0a0508', '#ff9a8a', 0.5, 0.9);
  const tubeHeights = [0.11, 0.15, 0.19, 0.23, 0.19, 0.15, 0.11];
  tubeHeights.forEach((h, i) => {
    const x = (i - 3) * 0.12;
    add(flat(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 12)), lacquer, at(x, 1.01, -0.42)); // socket
    // The glowing filament column (the glass is implied by its cap and socket).
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.017, h * 0.92, 12), tubeLight);
    core.position.set(x, 1.025 + h * 0.46, -0.42);
    core.frustumCulled = false;
    group.add(core);
    add(flat(new THREE.SphereGeometry(0.019, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), glass, at(x, 1.025 + h * 0.92, -0.42), false);
  });
  // Bat-wing cheeks: scalloped wings flaring from the façade's sides.
  for (const side of [-1, 1]) {
    const wing = new THREE.Shape();
    wing.moveTo(0, 0);
    wing.lineTo(0.02, 0.36);
    wing.quadraticCurveTo(0.12, 0.3, 0.22, 0.34);
    wing.quadraticCurveTo(0.2, 0.22, 0.26, 0.16);
    wing.quadraticCurveTo(0.16, 0.14, 0.17, 0.05);
    wing.quadraticCurveTo(0.09, 0.08, 0, 0);
    const geo = flat(new THREE.ExtrudeGeometry(wing, { depth: 0.012, bevelEnabled: false, curveSegments: 10 }));
    if (side < 0) geo.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
    if (side < 0) {
      // (mirroring flips the winding: put it back)
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < pos.count; i += 3) for (let c = 0; c < 3; c++) {
        const t = arr[(i + 1) * 3 + c];
        arr[(i + 1) * 3 + c] = arr[(i + 2) * 3 + c];
        arr[(i + 2) * 3 + c] = t;
      }
      geo.computeVertexNormals();
    }
    add(geo, lacquer, at(side * fw, 1.0, -0.46, 0, side * -0.35, 0));
  }
  // Two candles on the body's back corners.
  const flames: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    add(flat(new THREE.CylinderGeometry(0.035, 0.045, 0.02, 10)), brass, at(side * 0.56, 0.9, -0.36));
    add(flat(new THREE.CylinderGeometry(0.014, 0.016, 0.12, 10)), ivory, at(side * 0.56, 0.97, -0.36));
    const flame = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), tubeLight);
    flame.scale.set(0.012, 0.028, 0.012);
    flame.position.set(side * 0.56, 1.06, -0.36);
    flame.frustumCulled = false;
    group.add(flame);
    flames.push(flame);
  }

  // ── the stand: two pointed-arch legs and a crossbar ──
  for (const side of [-1, 1]) {
    const leg = new THREE.Shape();
    leg.moveTo(-0.2, 0);
    leg.lineTo(-0.2, 0.78);
    leg.lineTo(0.2, 0.78);
    leg.lineTo(0.2, 0);
    leg.lineTo(0.14, 0);
    leg.lineTo(0.14, 0.4);
    leg.quadraticCurveTo(0.14, 0.62, 0, 0.7);
    leg.quadraticCurveTo(-0.14, 0.62, -0.14, 0.4);
    leg.lineTo(-0.14, 0);
    leg.lineTo(-0.2, 0);
    const geo = flat(new THREE.ExtrudeGeometry(leg, { depth: 0.04, bevelEnabled: false, curveSegments: 10 }));
    add(geo, lacquer, at(side * 0.5 - 0.02, 0, -0.2, 0, Math.PI / 2, 0));
  }
  add(flat(new THREE.BoxGeometry(1.0, 0.04, 0.04)), brass, at(0, 0.2, -0.2));

  // ── colours of the glow (blood red), and the animation ──
  const red = new THREE.Color('#ff2a3a');
  let level = 0;
  let clock = 0;
  const moving = new Set<Key>();
  let held = 0;
  return {
    group,
    press(midi, down) {
      const k = byMidi.get(midi);
      if (!k) return;
      if (down && k.target === 0) held++;
      if (!down && k.target === 1) held = Math.max(0, held - 1);
      k.target = down ? 1 : 0;
      if (down) level = Math.min(1.4, level + 0.35);
      moving.add(k);
    },
    update(dt) {
      clock += dt;
      // Activity: rises with each note, falls back slowly; the tubes and the scope follow it.
      level += (Math.min(1, held * 0.35) - level) * Math.min(1, dt * 2.5);
      const pulse = 0.55 + level * 1.3 + Math.sin(clock * 7.3) * 0.04;
      tubeCore.value.copy(red).lerp(new THREE.Color('#fff0e6'), 0.6).multiplyScalar(pulse);
      tubeFringe.value.copy(red).multiplyScalar(pulse * 1.1);
      tubeHalo.value.copy(red).multiplyScalar(0.5 * pulse);
      scopeU.uLevel.value = level;
      scopeU.uTime.value = clock;
      for (const [i, f] of flames.entries()) f.scale.y = 0.028 * (0.85 + 0.25 * Math.sin(clock * (11 + i * 3.1) + i));
      if (moving.size === 0) return;
      for (const k of moving) {
        const rate = k.target > k.down ? 45 : 16;
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

import * as THREE from 'three';

/**
 * Blip's look: a round violet musician (headphones, bow tie, baton), built as
 * a Rig — the parts the motion system (blipScene) drives: eyes that look and
 * blink, a mouth with four shapes, arms on shoulder pivots, a baton,
 * headphones.
 *
 * Coordinates: y up, Blip faces +z (the camera), standing on y = 0.
 */

type RigEye = {
  /** Scaled for blinks and eye size. */
  group: THREE.Object3D;
  /** Offset to look around (from `lookBase`). */
  look: THREE.Object3D;
  lookBase: THREE.Vector3;
  /** The closed "^" shown for happy moods. */
  arc: THREE.Object3D;
};

type Rig = {
  root: THREE.Group;
  eyes: RigEye[];
  lookRange: { x: number; y: number };
  mouth: { smile: THREE.Mesh; grin: THREE.Mesh; o: THREE.Mesh; frown: THREE.Mesh };
  phones: THREE.Group;
  phonesY: number;
  /** [left, right] shoulder pivots; arms hang along −y. */
  arms: [THREE.Group, THREE.Group];
  /** Held along the arm; `handY` is where the hand is on the pivot. */
  baton: THREE.Group;
  handY: number;
  materials: THREE.Material[];
  textures: THREE.Texture[];
};

const VIOLET = 0x7b5cff;
const RIM = new THREE.Color(0xb444d8);
const INK = 0x1b1530;
const PINK = 0xff5f9e;
const AMBER = 0xf59e0b;
const MOUTH = 0x5a1030;

/** Shared materials: 3-step toon shading, a fresnel rim for silhouettes. */
function palette() {
  const gradient = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  const materials: THREE.Material[] = [];
  const keep = <T extends THREE.Material>(material: T): T => {
    materials.push(material);
    return material;
  };
  const toon = (color: number, rim = false) => {
    const material = keep(new THREE.MeshToonMaterial({ color, gradientMap: gradient }));
    // A rim glow keeps a silhouette readable on dark pages.
    if (rim)
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uRim = { value: RIM };
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
          .replace(
            '#include <opaque_fragment>',
            'outgoingLight += uRim * pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 2.5) * 0.8;\n#include <opaque_fragment>',
          );
      };
    return material;
  };
  const flat = (color: number, extra: THREE.MeshBasicMaterialParameters = {}) => keep(new THREE.MeshBasicMaterial({ color, ...extra }));
  return { gradient, materials, toon, flat };
}

type Palette = ReturnType<typeof palette>;

/** The four mouth shapes, centred on the group origin. */
function buildMouth(p: Palette) {
  const ink = p.flat(INK);
  const inside = p.flat(MOUTH, { side: THREE.DoubleSide });
  const group = new THREE.Group();
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.016, 8, 20, Math.PI), ink);
  smile.position.y = 0.02;
  smile.rotation.z = Math.PI;
  const grin = new THREE.Mesh(new THREE.CircleGeometry(0.085, 24, Math.PI, Math.PI), inside);
  grin.position.set(0, 0.02, 0.001);
  const tongue = new THREE.Mesh(new THREE.CircleGeometry(0.04, 16, 0, Math.PI), p.toon(PINK));
  tongue.position.set(0, -0.075, 0.002);
  grin.add(tongue);
  const o = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), inside);
  o.position.z = 0.001;
  const frown = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 8, 16, Math.PI), ink);
  frown.position.y = -0.02;
  group.add(smile, grin, o, frown);
  return { group, mouth: { smile, grin, o, frown } };
}

function buildBowTie(p: Palette, scale: number) {
  const pink = p.toon(PINK);
  const bow = new THREE.Group();
  const wingGeometry = new THREE.ConeGeometry(0.075, 0.14, 4);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeometry, pink);
    wing.rotation.z = (side * Math.PI) / 2;
    wing.position.x = side * 0.07;
    wing.scale.set(1, 1, 0.5);
    bow.add(wing);
  }
  bow.add(new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), pink));
  bow.scale.setScalar(scale);
  return bow;
}

function buildBaton(p: Palette) {
  const baton = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.016, 0.36, 8), p.flat(0xffffff));
  stick.position.y = -0.2;
  baton.add(stick, new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), p.toon(AMBER)));
  return baton;
}

/** Headphones centred on the group: a band of `radius`, cups at ±`cupX`. */
function buildPhones(p: Palette, radius: number, cupX: number, cupRadius: number) {
  const amber = p.toon(AMBER);
  const dark = p.toon(0x2a2440);
  const phones = new THREE.Group();
  // Gold like the cups: a dark band vanished into dark pages as a halo.
  const band = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.05, 10, 40, Math.PI), amber);
  band.position.y = 0.02;
  phones.add(band);
  const cupGeometry = new THREE.CylinderGeometry(cupRadius, cupRadius, 0.13, 24);
  const padGeometry = new THREE.TorusGeometry(cupRadius * 0.74, 0.035, 8, 20);
  for (const side of [-1, 1]) {
    const cup = new THREE.Mesh(cupGeometry, amber);
    cup.rotation.z = Math.PI / 2;
    cup.position.x = side * cupX;
    const pad = new THREE.Mesh(padGeometry, dark);
    pad.rotation.y = Math.PI / 2;
    pad.position.x = side * (cupX - 0.08);
    phones.add(cup, pad);
  }
  // Tilted back a touch so the band never crosses the face.
  phones.rotation.x = -0.08;
  return phones;
}

function buildBean(): Rig {
  const p = palette();
  const body = p.toon(VIOLET, true);
  const ink = p.flat(INK);
  const white = p.flat(0xffffff);
  const cheek = p.flat(PINK, { transparent: true, opacity: 0.55 });

  const root = new THREE.Group();
  // [radius, height] — a round bean: flat-ish seat, full cheeks, dome top.
  const profile = [
    [0, 0],
    [0.34, 0.015],
    [0.54, 0.08],
    [0.66, 0.24],
    [0.7, 0.45],
    [0.68, 0.68],
    [0.6, 0.9],
    [0.46, 1.07],
    [0.26, 1.18],
    [0, 1.22],
  ];
  root.add(new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 36), body));
  /** How far the front surface sits at (x, y) — face parts sit ON it. */
  const surfaceZ = (x: number, y: number): number => {
    let radius = 0;
    for (let i = 1; i < profile.length; i++) {
      const [r0, y0] = profile[i - 1];
      const [r1, y1] = profile[i];
      if (y >= y0 && y <= y1) {
        radius = r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
        break;
      }
    }
    return Math.sqrt(Math.max(0, radius * radius - x * x));
  };
  const onSurface = (mesh: THREE.Object3D, x: number, y: number, lift: number) => {
    const z = surfaceZ(x, y);
    mesh.position.set(x, y, z + lift);
    mesh.rotation.y = Math.atan2(x, z);
  };

  // Eyes: big, glossy, wide-set and low.
  const eyeGeometry = new THREE.SphereGeometry(0.15, 24, 16);
  const pupilGeometry = new THREE.SphereGeometry(0.12, 20, 14);
  const shineGeometry = new THREE.SphereGeometry(1, 10, 8);
  const arcGeometry = new THREE.TorusGeometry(0.085, 0.022, 8, 20, Math.PI);
  const eyes = [-1, 1].map((side): RigEye => {
    const group = new THREE.Group();
    onSurface(group, side * 0.25, 0.6, -0.02);
    group.rotation.y = 0; // eyes look straight out, not along the curve
    const eyeWhite = new THREE.Mesh(eyeGeometry, white);
    eyeWhite.scale.set(0.95, 1.08, 0.5);
    // Flattened onto the front of the eye white (which is 0.075 deep).
    const pupil = new THREE.Mesh(pupilGeometry, ink);
    pupil.scale.set(0.9, 1, 0.35);
    pupil.position.z = 0.05;
    const shine = new THREE.Mesh(shineGeometry, white);
    shine.scale.set(0.045, 0.045, 0.02);
    shine.position.set(0.035, 0.045, 0.11);
    const glint = new THREE.Mesh(shineGeometry, white);
    glint.scale.set(0.02, 0.02, 0.01);
    glint.position.set(-0.035, -0.05, 0.11);
    pupil.add(shine, glint);
    group.add(eyeWhite, pupil);
    root.add(group);
    const arc = new THREE.Mesh(arcGeometry, ink);
    onSurface(arc, side * 0.25, 0.57, 0.01);
    root.add(arc);
    return { group, look: pupil, lookBase: pupil.position.clone(), arc };
  });

  const { group: mouthGroup, mouth } = buildMouth(p);
  onSurface(mouthGroup, 0, 0.4, 0.005);
  root.add(mouthGroup);

  const cheekGeometry = new THREE.CircleGeometry(0.08, 18);
  for (const side of [-1, 1]) {
    const blush = new THREE.Mesh(cheekGeometry, cheek);
    onSurface(blush, side * 0.43, 0.44, 0.01);
    blush.scale.set(1.25, 0.8, 1);
    root.add(blush);
  }

  const bow = buildBowTie(p, 1);
  onSurface(bow, 0, 0.22, 0.03);
  root.add(bow);

  const phonesY = 0.6;
  const phones = buildPhones(p, 0.685, 0.74, 0.19);
  phones.position.y = phonesY;
  root.add(phones);

  // Stubby arms, a shade darker than the body so a raised one reads.
  const armMaterial = p.toon(0x6a4ff0);
  const armGeometry = new THREE.CapsuleGeometry(0.075, 0.14, 4, 10);
  armGeometry.translate(0, -0.13, 0);
  const arms = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.64, 0.42, 0.2);
    pivot.add(new THREE.Mesh(armGeometry, armMaterial));
    root.add(pivot);
    return pivot;
  }) as [THREE.Group, THREE.Group];

  return {
    root,
    eyes,
    lookRange: { x: 0.035, y: 0.03 },
    mouth,
    phones,
    phonesY,
    arms,
    baton: buildBaton(p),
    handY: -0.24,
    materials: p.materials,
    textures: [p.gradient],
  };
}

export { buildBean };
export type { Rig };

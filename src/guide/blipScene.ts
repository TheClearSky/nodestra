import * as THREE from 'three';
import { buildBean } from './blipRigs';
import { Spring } from './spring';
import { createRenderGate } from '../landing/renderGate';

/**
 * Blip — the tutorial guide, a little musician who points with a
 * conductor's baton. The model comes from blipRigs; every motion here is
 * procedural (springs, a blink scheduler). Budget: one tiny canvas, 30 fps
 * cap, nothing rendered while the tab is hidden or the canvas is out of the
 * screen's view (renderGate.ts). Reduced motion never gets here — the
 * SVG twin (BlipCharacter) stands in.
 */

type BlipMood = 'neutral' | 'happy' | 'excited' | 'thinking' | 'pointing' | 'surprised' | 'concerned' | 'celebrate';

type BlipScene = {
  setMood(mood: BlipMood): void;
  /** A letter appeared in the speech bubble — flap the mouth. */
  talkPulse(): void;
  /** Where Blip looks / points, as a viewport point (or null: the user). */
  setFocus(point: { x: number; y: number } | null, pointAt: boolean): void;
  /** Blip's own place on the page, for the focus direction. */
  setOrigin(rect: DOMRect): void;
  resize(width: number, height: number): void;
  dispose(): void;
};

type Mouth = 'smile' | 'grin' | 'o' | 'frown';

/**
 * Expression presets (cute on purpose: no brows — moods show through the
 * eyes, round or closed happy arcs, and the mouth). Numeric channels are
 * blended by springs.
 */
const MOODS: Record<BlipMood, { eyes: number; happyEyes: boolean; mouth: Mouth; grin: number; hop: number; arms: number }> = {
  neutral: { eyes: 1, happyEyes: false, mouth: 'smile', grin: 0, hop: 0, arms: 0 },
  happy: { eyes: 1, happyEyes: true, mouth: 'grin', grin: 0.8, hop: 0, arms: 0.15 },
  excited: { eyes: 1.12, happyEyes: false, mouth: 'grin', grin: 1, hop: 1, arms: 0.5 },
  thinking: { eyes: 0.94, happyEyes: false, mouth: 'o', grin: 0, hop: 0, arms: 0 },
  pointing: { eyes: 1, happyEyes: false, mouth: 'grin', grin: 0.6, hop: 0, arms: 0 },
  surprised: { eyes: 1.2, happyEyes: false, mouth: 'o', grin: 0, hop: 0.3, arms: 0.3 },
  concerned: { eyes: 0.9, happyEyes: false, mouth: 'frown', grin: 0, hop: 0, arms: -0.1 },
  celebrate: { eyes: 1.1, happyEyes: true, mouth: 'grin', grin: 1, hop: 1.6, arms: 1 },
};

function createBlip(canvas: HTMLCanvasElement): BlipScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  // Frames about −0.25…2.15 up and ±1.2 across: room for the headphones, a
  // hop, and the baton held out at arm's length.
  const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 20);
  camera.position.set(0, 0.95, 5);
  camera.lookAt(0, 0.95, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a2a55, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(1.5, 2.5, 3);
  scene.add(sun);

  const rig = buildBean();
  const { root, eyes, mouth, phones, arms, baton } = rig;
  scene.add(root);
  baton.position.set(0, rig.handY, 0.04);

  // ── motion state ──────────────────────────────────────────────────────
  let mood: BlipMood = 'neutral';
  let focus: { x: number; y: number } | null = null;
  let pointing = false;
  let origin = { x: 0, y: 0 };
  let mouthTarget = 0;
  const springs = {
    eyes: new Spring(5, 0.5, 1, 1),
    grin: new Spring(5, 0.6, 1),
    open: new Spring(9, 0.45, 1),
    lookX: new Spring(3, 0.8, 0.5),
    lookY: new Spring(3, 0.8, 0.5),
    lean: new Spring(1.6, 0.55, 0),
    armL: new Spring(2.2, 0.45, -0.4),
    armR: new Spring(2.2, 0.45, -0.4),
    squash: new Spring(3, 0.35, 1, 1),
    baton: new Spring(3, 0.5, 1, 2),
  };
  let blinkAt = 1.5;
  let blinkUntil = 0;
  let hopPhase = 0;

  const pose = (t: number, dt: number) => {
    const preset = MOODS[mood];
    // Where the focus is, relative to Blip (−1…1, screen y down).
    let dx = 0;
    let dy = 0;
    if (focus) {
      const vx = focus.x - origin.x;
      const vy = focus.y - origin.y;
      const length = Math.hypot(vx, vy) || 1;
      dx = vx / length;
      dy = vy / length;
    }
    const thinking = mood === 'thinking';
    const lookX = springs.lookX.update(dt, dx + (thinking ? 0.7 : 0));
    const lookY = springs.lookY.update(dt, -dy + (thinking ? 1.1 : 0));
    for (const eye of eyes) {
      eye.look.position.set(eye.lookBase.x + lookX * rig.lookRange.x, eye.lookBase.y + lookY * rig.lookRange.y, eye.lookBase.z);
    }
    const lean = springs.lean.update(dt, -dx * 0.1 + Math.sin(t * 0.9) * 0.02 + (thinking ? 0.06 : 0));
    root.rotation.z = lean;

    // Blinks, now and then a double blink. Timed by the clock, not by
    // frames: counted in frames, a throttled tab held a blink for seconds.
    if (t >= blinkAt) {
      blinkUntil = t + 0.14;
      blinkAt = t + 2 + Math.random() * 4 + (Math.random() < 0.15 ? -1.8 : 0);
      if (blinkAt < t + 0.25) blinkAt = t + 0.25;
    }
    const lid = t < blinkUntil ? 0.08 : 1;
    const eyeScale = springs.eyes.update(dt, preset.eyes);
    for (const eye of eyes) {
      eye.group.visible = !preset.happyEyes;
      eye.arc.visible = preset.happyEyes;
      eye.group.scale.set(eyeScale, eyeScale * lid, 1);
    }

    // Mouth: talking opens the grin; otherwise the mood's shape.
    const talk = springs.open.update(dt, mouthTarget);
    mouthTarget = Math.max(0, mouthTarget - dt * 6);
    const grinAmount = springs.grin.update(dt, preset.grin);
    const shape: Mouth = talk > 0.15 ? 'grin' : preset.mouth;
    mouth.smile.visible = shape === 'smile';
    mouth.grin.visible = shape === 'grin';
    mouth.o.visible = shape === 'o';
    mouth.frown.visible = shape === 'frown';
    mouth.grin.scale.set(0.8 + grinAmount * 0.25, Math.max(0.35, 0.45 + grinAmount * 0.35, talk * 1.1), 1);
    mouth.o.scale.set(0.8, 1 + talk * 0.4, 1);

    // Body: breathing, hops for excitement.
    hopPhase += dt * (preset.hop > 0 ? 6 : 0);
    const hop = preset.hop > 0 ? Math.max(0, Math.sin(hopPhase)) * 0.12 * preset.hop : 0;
    const squash = springs.squash.update(dt, 1 + Math.sin(t * 2.2) * 0.02 + (hop > 0.02 ? 0.05 : 0));
    root.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    root.position.y = hop + Math.sin(t * 1.7) * 0.02;
    // The headphones ride the squash a little.
    phones.position.y = rig.phonesY - (squash - 1) * 0.3;

    // Arms: point with the baton hand on the focus's side; the other rests
    // (or both go up to celebrate). Capped below vertical: an arm straight
    // up hides against the head.
    const pointAngle = Math.min(1.1, Math.atan2(-dy, Math.abs(dx) || 0.001));
    const pointLeft = pointing && focus !== null && dx < 0;
    const pointRight = pointing && focus !== null && dx >= 0;
    const holder = pointLeft ? arms[0] : arms[1];
    if (baton.parent !== holder) holder.add(baton);
    const rest = -0.35 - preset.arms * 1.2 + Math.sin(t * 1.3) * 0.05;
    const celebrate = mood === 'celebrate' ? Math.sin(t * 9) * 0.4 : 0;
    arms[0].rotation.z = springs.armL.update(dt, pointLeft ? -(pointAngle + Math.PI / 2) : rest - celebrate);
    arms[1].rotation.z = springs.armR.update(dt, pointRight ? pointAngle + Math.PI / 2 : -(rest - celebrate));
    // Resting, the baton is held up and out, ready; pointing, it extends the
    // arm. A little conducting flick while talking.
    const hold = springs.baton.update(dt, pointing && focus !== null ? 0.1 : 2);
    baton.rotation.z = (pointLeft ? -1 : 1) * (hold + talk * 0.25 * Math.sin(t * 14));
  };

  // ── loop: 30 fps, only while the render gate is open ────────────────
  let frameHandle: number | null = null;
  let last = performance.now();
  /** Blip's own clock (s): it stands still while Blip is not drawn, so he
   *  carries on where he stopped — no jump. */
  let elapsed = 0;
  const frame = () => {
    frameHandle = requestAnimationFrame(frame);
    const now = performance.now();
    if (now - last < 1000 / 31) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    elapsed += dt;
    pose(elapsed, dt);
    renderer.render(scene, camera);
  };
  const run = () => {
    if (frameHandle === null) {
      // The first frame back draws at once, with a normal step.
      last = performance.now() - 1000 / 30;
      frameHandle = requestAnimationFrame(frame);
    }
  };
  const halt = () => {
    if (frameHandle !== null) cancelAnimationFrame(frameHandle);
    frameHandle = null;
  };
  const gate = createRenderGate(canvas, (open) => (open ? run() : halt()));
  if (gate.isOpen()) run();

  return {
    setMood(next) {
      mood = next;
    },
    talkPulse() {
      mouthTarget = 0.6 + Math.random() * 0.4;
    },
    setFocus(point, pointAt) {
      focus = point;
      pointing = pointAt;
    },
    setOrigin(rect) {
      origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.5 };
    },
    resize(width, height) {
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (frameHandle === null) renderer.render(scene, camera);
    },
    dispose() {
      gate.dispose();
      halt();
      scene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
      });
      for (const material of rig.materials) material.dispose();
      for (const texture of rig.textures) texture.dispose();
      renderer.dispose();
      // Give the context back now — the editor may want it (plan: one WebGL
      // context at a time outside the landing).
      renderer.forceContextLoss();
    },
  };
}

export { createBlip };
export type { BlipMood, BlipScene };

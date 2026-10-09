// COPIED from .claude/pages/ad/experiments/env-src/scene-sakura-stage.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * SCENE 2 — under the sakura (the user's picks, 2026-10-04): the same
 * meadow as scene 1 ("everything else same": bright afternoon, gusty
 * breeze, S3 pool + sparse spots, W1 cel river with star sparkles, the
 * hills, the painted grade) with the T2 sakura and its falling petals in
 * place of the oak and its leaves. No bridge.
 *
 * The instrument (2026-10-04, Deepak: "organ demo suits sakura scene the
 * best, add a procedural organ and add animations to it, multiple
 * animations chosen at random"): a chamber pipe organ (scene-organ.ts)
 * under the blossoms, in the approved end frame. It is NOT there before
 * Play: it ARRIVES during the flyby with a move picked at random on every
 * Play (bloom / rise / assemble / descend; `?v=move:<id>` fixes one) and is
 * settled before the camera lands; on Leave it dissolves into petals while
 * the camera backs off. Keys press the manual's keys, the answering pipe
 * glows and breathes petals, and the crown still lets a few petals go.
 *
 * Same API shape as the app's piano stage (src/landing/stageScene.ts).
 */

import * as THREE from 'three';
import { createWorld } from './scene-world';
import { createRig, type FlyPose, type View } from './scene-rig';
import { heightAt } from './scene-terrain';
import { createBurst } from './scene-burst';
import type { InstrumentScene, SceneOptions } from './scene-guitar-stage';
import { createAdaptive, sceneQuality } from './scene-quality';
import { grassQuality } from './scene-grass';
import { createOrgan, ORGAN_MOVES, type OrganMoveId } from './scene-organ';
import { createRenderGate } from '../../renderGate';

const vec2Param = (name: string, fallback: THREE.Vector2) => {
  const v = new URLSearchParams(location.search).get(name)?.split(',').map(Number);
  return v && v.length === 2 && v.every(Number.isFinite) ? new THREE.Vector2(v[0], v[1]) : fallback;
};
const vecParam = (name: string, fallback: THREE.Vector3) => {
  const v = new URLSearchParams(location.search).get(name)?.split(',').map(Number);
  return v && v.length === 3 && v.every(Number.isFinite) ? new THREE.Vector3(v[0], v[1], v[2]) : fallback;
};

export function createSakuraScene(canvas: HTMLCanvasElement, options: SceneOptions): InstrumentScene {
  const params = new URLSearchParams(location.search);
  // The sakura is lower and wider than the oak: the wide shot stands closer.
  const wide: View = {
    eye: vecParam('eye', new THREE.Vector3(3.6, heightAt(3.6, 17) + 3.0, 17)),
    look: vecParam('look', new THREE.Vector3(-1.9, 2.8, 0)),
    fov: Number(params.get('fov') ?? 50),
  };
  // Close: under the blossoms at the crown's edge, looking out past the
  // trunk over the river to the hills, the sun behind the petals.
  const close: View = {
    eye: vecParam('ceye', new THREE.Vector3(4.6, heightAt(4.6, 3.2) + 1.3, 3.2)),
    look: vecParam('clook', new THREE.Vector3(-8, 3.0, 0.6)),
    fov: Number(params.get('cfov') ?? 56),
  };

  const quality = sceneQuality();
  const tier = quality.params;
  const world = createWorld({
    canvas,
    tree: 'sakura',
    flowers: ['petals', 'tiny'],
    wideEye: wide.eye,
    wideLook: wide.look,
    quality: tier,
    patches: { count: 40, seed: 29, flowers: ['tiny', 'daisy'] },
    flowerBed: {
      centre: vec2Param('bed', new THREE.Vector2(-2.2, 4.6)),
      axis: new THREE.Vector2(0.35, 1).normalize(),
      radii: [2.6, 1.7],
      eye: [close.eye.x, close.eye.z],
      flowers: ['tiny', 'daisy'],
    },
  });
  const { renderer, scene, camera } = world;

  const burst = createBurst(world.u, world.tree.clumps, world.pixelRatio, tier.particles);
  scene.add(burst.group);
  world.mirror.hide.push(burst.group);

  // ── the organ: under the blossoms, in the approved end frame, its front
  //    turned to the camera's seat ──
  const spot = vec2Param('organ', new THREE.Vector2(-0.55, 2.45));
  const oScale = Number(params.get('oscale') ?? 1);
  const oYaw = Math.atan2(close.eye.x - spot.x, close.eye.z - spot.y) + Number(params.get('oyaw') ?? 0.55);
  let ground = Infinity;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ground = Math.min(ground, heightAt(spot.x + Math.cos(a) * 0.7 * oScale, spot.y + Math.sin(a) * 0.7 * oScale));
  }
  const organ = createOrgan({
    u: world.u,
    field: world.field,
    position: new THREE.Vector3(spot.x, ground, spot.y),
    yaw: oYaw,
    scale: oScale,
    particles: tier.particles,
    heightAt,
  });
  scene.add(organ.group, organ.fx);
  world.mirror.hide.push(organ.group, organ.fx);
  // Its contact shadow (the stamp covers the organ's spot + the descent).
  world.setStamps([], { min: new THREE.Vector2(spot.x - 3, spot.y - 3), max: new THREE.Vector2(spot.x + 3, spot.y + 3) });

  // ── arrival / departure ──
  const RANDOM = ORGAN_MOVES.map((m) => m.id);
  let forcedMove: OrganMoveId | null = (() => {
    const v = (params.get('v') ?? '').split(',').find((p) => p.startsWith('move:'))?.slice(5);
    return RANDOM.includes(v as OrganMoveId) ? (v as OrganMoveId) : null;
  })();
  const pickMove = (): OrganMoveId => forcedMove ?? RANDOM[Math.floor(Math.random() * RANDOM.length)];
  let move: OrganMoveId = pickMove();
  /** Arrival runs over this span of the flyby (settled before it lands). */
  const ARRIVE = [0.42, 0.88] as const;
  const DEPART_S = 1.9;
  let live = false;
  let armed = false;
  let departing: { t0: number; a: number; move: OrganMoveId } | null = null;
  let override: { a: number; d: number } | null = null;
  const arrival = () => {
    if (override) return override.a;
    if (!armed) return 0;
    if (options.reducedMotion) return live ? 1 : 0;
    return THREE.MathUtils.clamp((rig.progress() - ARRIVE[0]) / (ARRIVE[1] - ARRIVE[0]), 0, 1);
  };
  const press: { a: THREE.Vector2; b: THREE.Vector2; r: number; strength: number }[] = [];
  const stepOrgan = (t: number, dt: number) => {
    if (override && override.d > 0) organ.setState(move, override.a, override.d, t);
    else if (departing) {
      const d = options.reducedMotion ? 1 : (t - departing.t0) / DEPART_S;
      organ.setState(departing.move, departing.a, Math.min(1, d), t);
      if (d >= 1) departing = null;
    } else organ.setState(move, arrival(), 0, t);
    organ.update(t, dt);
    // The grass parts under it; its contact shadow follows its presence.
    const k = organ.presence();
    const caps = organ.footprint();
    press.length = 0;
    for (const c of caps) press.push({ a: c.a, b: c.b, r: c.r + 0.12, strength: k });
    world.grass.press(press);
    world.patches?.press(press);
    world.bed?.press(press);
    world.setStamps(k > 0.01 ? caps.map((c, i) => ({ a: c.a, b: c.b, r: c.r * 0.9, ha: (i === 0 ? 1.9 : 0.4) * k, hb: (i === 0 ? 1.9 : 0.4) * k, contact: k })) : []);
  };

  // ── Play: a FLYBY round the tree (the user, 2026-10-04: "flyby around the
  // tree into position, … just back off straight line smoothly when going
  // back"). Polar coordinates round the trunk: from the wide eye the camera
  // swings out to an orbit outside the crown (radius ORBIT_R, ~3.5 m up),
  // sweeps the long way round (river side, behind, the far side — the tree
  // turns past, the gaze on the crown), then drops below the canopy rim
  // before it spirals in under the blossoms to the approved close view (the
  // exact same end pose). Leave = a straight-line back-off (scene-rig).
  const polar = (v: THREE.Vector3) => ({ r: Math.hypot(v.x, v.z), a: Math.atan2(v.x, v.z), h: v.y - heightAt(v.x, v.z) });
  const P0 = polar(wide.eye);
  const P1 = polar(close.eye);
  const ORBIT_R = Number(params.get('orbitR') ?? 12.5);
  const ORBIT_H = Number(params.get('orbitH') ?? 3.6);
  const LOW_H = P1.h;
  // The long way round (decreasing azimuth): ~317°.
  const SWEEP = P1.a - P0.a - Math.PI * 2;
  const crownC = world.tree.canopy.uCrownC.value;
  const focus = new THREE.Vector3(crownC.x, crownC.y - 1.2, crownC.z);
  const ss = THREE.MathUtils.smoothstep;
  const flyby = (u: number, out: FlyPose) => {
    // Radius: out to the orbit early, in under the crown at the very end.
    let r = THREE.MathUtils.lerp(P0.r, ORBIT_R, ss(u, 0, 0.22));
    r = THREE.MathUtils.lerp(r, P1.r, ss(u, 0.8, 1));
    // Height above the ground: orbit height, then low BEFORE moving in.
    let hh = THREE.MathUtils.lerp(P0.h, ORBIT_H, ss(u, 0, 0.25));
    hh = THREE.MathUtils.lerp(hh, LOW_H, ss(u, 0.55, 0.8));
    const a = P0.a + SWEEP * u;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    out.pos.set(x, heightAt(x, z) + hh, z);
    // Gaze: onto the crown during the orbit, then to the close view's target.
    out.look.lerpVectors(wide.look, focus, ss(u, 0, 0.2));
    out.look.lerp(close.look, ss(u, 0.72, 1));
    out.fov = THREE.MathUtils.lerp(wide.fov, close.fov, ss(u, 0.6, 1));
  };
  const rig = createRig(canvas, camera, {
    wide,
    close,
    bends: [],
    seconds: 7.5,
    reducedMotion: options.reducedMotion,
    groundAt: heightAt,
    flyby,
    backSeconds: 3.4,
  });

  const held = new Set<number>();
  const right = new THREE.Vector3();
  const clock = { t: 0 };
  const step = (t: number, dt: number) => {
    clock.t = t;
    rig.update(t);
    stepOrgan(t, dt);
    burst.update(t, dt);
    world.render(t, dt);
  };
  // Falling petals: sakura.ts's are 3 cm and spawn inside the crown, so
  // from the wide shot (17 m) they were sub-pixel specks hidden by the
  // blossoms. Here they are 6 cm and spawn across the crown's lower half and
  // just outside its rim, where they fall in open air. The count scales
  // with the tier.
  {
    const f = world.tree.falling;
    const g = f.geometry as THREE.InstancedBufferGeometry;
    g.instanceCount = Math.max(60, Math.round(g.instanceCount * tier.particles));
    const fu = (f.material as THREE.ShaderMaterial).uniforms;
    fu.uSize.value = 0.06;
    const c = world.tree.canopy.uCrownC.value;
    const r = world.tree.canopy.uCrownR.value;
    fu.uMin.value.set(c.x - r.x * 1.1, c.y - r.y * 0.6, c.z - r.z * 1.1);
    fu.uMax.value.set(c.x + r.x * 1.1, c.y + r.y * 0.1, c.z + r.z * 1.1);
  }
  const adaptive = createAdaptive(
    (r) => {
      grassQuality.uSceneKeep.value = r.grassKeep;
      grassQuality.uSceneFlowers.value = tier.flowers * r.flowerKeep;
      world.setPixelScale(r.prScale);
      world.setMaxSamples(r.maxSamples);
    },
    { enabled: !quality.guess.forced && !options.reducedMotion && !params.has('noadapt') },
  );
  let previous = performance.now();
  /** The scene's own clock (s): it advances only while frames are drawn, so
   *  a scene stopped by its render gate carries on where it stopped. */
  let elapsed = 0;
  const MIN_FRAME_MS = 1000 / 61;
  const frame = () => {
    const now = performance.now();
    if (now - previous < MIN_FRAME_MS) return;
    // Real elapsed time (capped at 0.25 s): a stalled GPU slows the frame
    // rate, not the petals and bursts (with a 50 ms cap a 2 fps stall froze
    // them inside the crown).
    const dt = Math.min(0.25, (now - previous) / 1000);
    previous = now;
    elapsed += dt;
    adaptive.frame(now);
    step(elapsed, dt);
  };
  const still = () => step(clock.t || 2.0, 0);
  rig.onStill(still);
  // The loop runs only while the render gate is open: tab visible and the
  // canvas in the screen's view (src/landing/renderGate.ts; the debug
  // `stop()` closes it as the owner). Reopening restarts the frame clock one
  // frame back, so the scene carries on where it stopped.
  let looping = false;
  const syncLoop = () => {
    const run = !options.reducedMotion && gate.isOpen();
    if (run === looping) return;
    looping = run;
    if (run) previous = performance.now() - 1000 / 60;
    renderer.setAnimationLoop(run ? frame : null);
  };
  const gate = createRenderGate(canvas, syncLoop);
  syncLoop();

  return {
    resize(width, height) {
      world.resize(width, height);
      if (options.reducedMotion) still();
    },
    /** Draw one frame now, outside the loop's frame cap. The landing calls
     *  it after `resize`, behind its black: a fresh or resized canvas is
     *  transparent, and on a 120/144 Hz screen the cap skips the loop's
     *  first frames, so "two frames later" could still be an empty canvas
     *  (the piano stage showed through it). This frame also compiles every
     *  shader, behind the black rather than after it lifts. */
    renderNow() {
      if (options.reducedMotion) {
        still();
        return;
      }
      step(elapsed, 0);
      previous = performance.now();
    },
    setLive(next) {
      if (next && !live) {
        armed = true;
        move = pickMove();
      } else if (!next && live) {
        // The organ dissolves into petals while the camera backs off.
        const a = arrival();
        if (a > 0 && !departing) departing = { t0: clock.t, a, move };
        armed = false;
      }
      live = next;
      rig.setLive(next);
      if (options.reducedMotion) still();
    },
    setMove(id) {
      forcedMove = RANDOM.includes(id as OrganMoveId) ? (id as OrganMoveId) : null;
      if (forcedMove && !live) move = forcedMove;
    },
    currentMove: () => `${ORGAN_MOVES.find((m) => m.id === move)?.label ?? move}${forcedMove ? '' : ' (random)'}`,
    setLiveKey(key, down) {
      if (key < 0 || key > 87) return;
      if (down) {
        if (held.has(key)) return;
        held.add(key);
        organ.noteOn(key + 21);
        // C2…C6 spread across the crown, left to right (a lighter burst now:
        // the pipes answer too).
        right.setFromMatrixColumn(camera.matrixWorld, 0);
        burst.emit(THREE.MathUtils.clamp((key - 15) / 48, 0, 1), right, 0.45, camera);
        if (options.reducedMotion) {
          // One still frame a moment into the burst.
          burst.update(clock.t, 0.6);
          still();
        }
      } else {
        held.delete(key);
        organ.noteOff(key + 21);
      }
    },
    quality: () => `${tier.tier}${adaptive.label()}`,
    dispose() {
      gate.dispose();
      renderer.setAnimationLoop(null);
      rig.dispose();
      burst.dispose();
      organ.dispose();
      world.dispose();
    },
    debug: {
      world,
      rig,
      stop: () => gate.setPaused(true),
      renderAt: (t, dt = 1 / 60) => step(t, dt),
      tour: (p) => {
        armed = p >= 0;
        departing = null;
        rig.debugSet(p);
      },
      back: (from, k) => rig.debugBack(from, k),
      organ: (a, d) => {
        override = a < 0 ? null : { a, d };
      },
    },
  };
}

// COPIED from .claude/pages/ad/experiments/env-src/scene-rig.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * Camera rig for the instrument scenes, modelled on the piano stage
 * (src/landing/stageScene.ts) and using the app's own `makeCameraTour`:
 *
 *  - WIDE view = the establishing shot; CLOSE view = where "Play" lands.
 *  - The tour is ONE Bézier over [turn, rise] angles (relative to the wide
 *    view), from the wide angles to the close view's, bending towards the
 *    `bends` without passing through them; re-timed by perceived motion.
 *    Radius moves geometrically (25 m → 0.3 m reads evenly), and the look
 *    point LEADS the body, so the camera settles on the subject first and
 *    then glides in.
 *  - Smootherstep over `seconds`; leaving replays it backwards 2× faster.
 *  - Drag to look (orbits the current look point, clamped); idle wander
 *    fades in 2.5 s after the last touch while the tour is not moving.
 *  - Never below the ground (+ a clearance that shrinks in the close-up).
 *
 * FLYBY mode (`flyby` given — the sakura scene): Play follows the scene's
 * own path function over smootherstep time instead (the camera sweeps round
 * the tree into the close view), and Leave does NOT retrace it: the camera
 * backs off in a STRAIGHT LINE from wherever it is to the wide pose
 * (smootherstep, the look point and fov blended along), so Leave mid-flyby
 * starts the line from the current pose; Play during a back-off starts the
 * flyby from the current pose (the offset fades over its first third).
 */

import * as THREE from 'three';
import { makeCameraTour } from '../../cameraTour';

export type View = { eye: THREE.Vector3; look: THREE.Vector3; fov: number };

export type RigOptions = {
  wide: View;
  close: View;
  /** Waypoints between the wide and close angles: [turn, rise] radians. */
  bends: [number, number][];
  seconds: number;
  dollyShare?: number;
  reducedMotion: boolean;
  groundAt: (x: number, z: number) => number;
  /** Idle wander strength (1 = the piano stage's). */
  idleMotion?: number;
  /** Camera height floor above the ground: [far, close] (default [0.9, 0.06]). */
  clearance?: [number, number];
  /** Flyby mode: the base pose at u (0 = wide … 1 = close, u already eased). */
  flyby?: (u: number, out: FlyPose) => void;
  /** Flyby mode: back-off duration for the full wide↔close distance (s). */
  backSeconds?: number;
};

export type FlyPose = { pos: THREE.Vector3; look: THREE.Vector3; fov: number };

export type Rig = {
  update(t: number): void;
  setLive(live: boolean): void;
  /** 0 = wide … 1 = close (tour progress). */
  progress(): number;
  /** Tests: jump the tour to a progress and hold the wander off. */
  debugSet(progress: number): void;
  /** Tests (flyby mode): hold a back-off that started at tour progress
   *  `from`, `s` (0…1) of the way back. */
  debugBack(from: number, s: number): void;
  /** Change where the tour lands (rebuilds the path). */
  setClose(view: View): void;
  /** Reduced motion: called to redraw one still frame after a drag. */
  onStill(fn: () => void): void;
  dispose(): void;
};

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function createRig(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera, o: RigOptions): Rig {
  const s0 = new THREE.Spherical().setFromVector3(o.wide.eye.clone().sub(o.wide.look));
  // The gaze settles on the subject in the first half of the dolly.
  const lookShare = (near: number) => 1 - Math.pow(1 - Math.min(1, near / 0.5), 2);
  let close = o.close;
  let ratio = 1;
  let tour = makeCameraTour([[0, 0], [0, 0]], () => {});
  const build = () => {
    const s1 = new THREE.Spherical().setFromVector3(close.eye.clone().sub(close.look));
    const end: [number, number] = [wrap(s1.theta - s0.theta), s1.phi - s0.phi];
    ratio = s1.radius / s0.radius;
    tour = makeCameraTour(
      [[0, 0], ...o.bends, end],
      (turn, rise, near, out) => {
        out.look.lerpVectors(o.wide.look, close.look, lookShare(near));
        out.position
          .setFromSpherical(new THREE.Spherical(s0.radius * Math.pow(ratio, near), s0.phi + rise, s0.theta + turn))
          .add(out.look);
      },
      o.dollyShare ?? 0.85,
    );
  };
  build();

  // ── drag to look + idle wander (as the stage) ──
  const YAW_LIMIT = 0.5;
  const PITCH_MIN = -0.14;
  const PITCH_MAX = 0.3;
  const IDLE_AFTER_SECONDS = 2.5;
  const orbit = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0 };
  const wanderPhase = Array.from({ length: 6 }, () => Math.random() * Math.PI * 2);
  const wander = { yaw: 0, pitch: 0, weight: 0 };
  let lastInteraction = -Infinity;
  let debugHold = false;
  const bakeWander = () => {
    lastInteraction = performance.now();
    orbit.yaw += wander.yaw;
    orbit.targetYaw += wander.yaw;
    orbit.pitch += wander.pitch;
    orbit.targetPitch += wander.pitch;
    wander.weight = 0;
    wander.yaw = 0;
    wander.pitch = 0;
  };
  /**
   * Narrow screens (phones in portrait): the views are framed for a wide
   * screen, and a fixed vertical fov would crop most of the width away. Below
   * `FIT_ASPECT` the vertical fov widens to keep that width in view, capped
   * at `FIT_MAX_FOV` — the piano stage's rule (`stageScene.ts` resize).
   */
  const FIT_ASPECT = 1.5;
  const FIT_MAX_FOV = 78;
  const fitFov = (fov: number) => {
    const aspect = camera.aspect;
    if (!(aspect > 0) || aspect >= FIT_ASPECT) return fov;
    const widened = THREE.MathUtils.radToDeg(2 * Math.atan((Math.tan(THREE.MathUtils.degToRad(fov / 2)) * FIT_ASPECT) / aspect));
    return Math.min(Math.max(fov, FIT_MAX_FOV), widened);
  };
  const pointers = new Map<number, { x: number; y: number }>();
  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';
  const redrawStill = () => {
    if (!o.reducedMotion) return;
    orbit.yaw = orbit.targetYaw;
    orbit.pitch = orbit.targetPitch;
    still?.();
  };
  let still: (() => void) | null = null;
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    bakeWander();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  };
  const onMove = (e: PointerEvent) => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    lastInteraction = performance.now();
    const k = 2.0 / Math.max(canvas.clientWidth, 1);
    orbit.targetYaw = THREE.MathUtils.clamp(orbit.targetYaw - (e.clientX - last.x) * k, -YAW_LIMIT, YAW_LIMIT);
    orbit.targetPitch = THREE.MathUtils.clamp(orbit.targetPitch + (e.clientY - last.y) * k, PITCH_MIN, PITCH_MAX);
    last.x = e.clientX;
    last.y = e.clientY;
    redrawStill();
  };
  const onUp = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size === 0) canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  let tourClock = 0;
  let forward = false;
  let lastT: number | null = null;
  let closeness = 0;
  const spherical = new THREE.Spherical();
  const look = new THREE.Vector3();

  // ── flyby mode state ──
  const smoother = (x: number) => {
    const k = THREE.MathUtils.clamp(x, 0, 1);
    return k * k * k * (k * (k * 6 - 15) + 10);
  };
  const fly: FlyPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: o.wide.fov };
  const base: FlyPose = { pos: o.wide.eye.clone(), look: o.wide.look.clone(), fov: o.wide.fov };
  let back: { from: FlyPose; progress: number; s: number; seconds: number } | null = null;
  let startOffset: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  const fullDistance = o.wide.eye.distanceTo(o.close.eye);
  const flybyBase = (dt: number) => {
    if (back) {
      if (!debugHold) back.s = o.reducedMotion ? 1 : Math.min(1, back.s + dt / back.seconds);
      const e = smoother(back.s);
      base.pos.lerpVectors(back.from.pos, o.wide.eye, e);
      base.look.lerpVectors(back.from.look, o.wide.look, e);
      base.fov = THREE.MathUtils.lerp(back.from.fov, o.wide.fov, e);
      closeness = back.progress * (1 - e);
      if (back.s >= 1 && !debugHold) {
        back = null;
        tourClock = 0;
      }
      return;
    }
    if (!debugHold) tourClock = o.reducedMotion ? (forward ? o.seconds : 0) : THREE.MathUtils.clamp(tourClock + (forward ? dt : 0), 0, o.seconds);
    closeness = tourClock / o.seconds;
    const u = smoother(closeness);
    o.flyby!(u, fly);
    base.pos.copy(fly.pos);
    base.look.copy(fly.look);
    base.fov = fly.fov;
    if (startOffset) {
      const k = 1 - smoother(u / 0.35);
      base.pos.addScaledVector(startOffset.pos, k);
      base.look.addScaledVector(startOffset.look, k);
      if (k <= 0) startOffset = null;
    }
  };
  /** Fold the drag / wander offsets into the base pose (the camera is
   *  exactly where it was) so a move starts from the real view, no jump. */
  const bakeOffsets = () => {
    if (lastT !== null) base.pos.copy(camera.position);
    orbit.yaw = orbit.pitch = orbit.targetYaw = orbit.targetPitch = 0;
    wander.weight = wander.yaw = wander.pitch = 0;
    lastInteraction = performance.now();
  };
  const startBack = () => {
    bakeOffsets();
    const from: FlyPose = { pos: base.pos.clone(), look: base.look.clone(), fov: base.fov };
    const d = from.pos.distanceTo(o.wide.eye);
    if (d < 1e-3 && tourClock <= 0) return;
    back = { from, progress: closeness, s: 0, seconds: Math.max(0.8, (o.backSeconds ?? 3.4) * Math.sqrt(d / Math.max(fullDistance, 1e-3))) };
    startOffset = null;
  };

  const update = (t: number) => {
    orbit.yaw += (orbit.targetYaw - orbit.yaw) * 0.1;
    orbit.pitch += (orbit.targetPitch - orbit.pitch) * 0.1;
    // Real time (capped at 1 s, a tab coming back): a slow frame rate must
    // not stretch the tour (at 2 fps a 0.25 s cap made it 2× slower).
    const dt = lastT === null ? 0 : Math.min(1, Math.max(0, t - lastT));
    lastT = t;
    if (o.flyby) {
      flybyBase(dt);
      const moving = !!back || (forward && tourClock < o.seconds);
      const idle = !o.reducedMotion && !debugHold && !moving && pointers.size === 0 && (performance.now() - lastInteraction) / 1000 > IDLE_AFTER_SECONDS;
      wander.weight += ((idle ? 1 : 0) - wander.weight) * (1 - Math.exp(-dt / 1.5));
      if (wander.weight < 1e-4 && !idle) wander.weight = 0;
      const [a, b] = wanderPhase;
      const amp = (o.idleMotion ?? 1) * THREE.MathUtils.lerp(1, 0.45, closeness);
      wander.yaw = wander.weight * amp * (0.12 * Math.sin(t * 0.16 + a) + 0.06 * Math.sin(t * 0.083 + b));
      wander.pitch = wander.weight * amp * (0.028 * Math.sin(t * 0.11 + wanderPhase[2]) + 0.015 * Math.sin(t * 0.061 + wanderPhase[3]));
      // Drag / wander orbit the look point (as in the tour mode).
      spherical.setFromVector3(base.pos.clone().sub(base.look));
      spherical.phi = THREE.MathUtils.clamp(spherical.phi - orbit.pitch - wander.pitch, 0.05, Math.PI - 0.05);
      spherical.theta += orbit.yaw + wander.yaw;
      camera.position.setFromSpherical(spherical).add(base.look);
      const [cFar, cNear] = o.clearance ?? [0.9, 0.06];
      const floor = o.groundAt(camera.position.x, camera.position.z) + THREE.MathUtils.lerp(cFar, cNear, closeness);
      if (camera.position.y < floor) camera.position.y = floor;
      camera.fov = fitFov(base.fov);
      camera.near = 0.08;
      camera.updateProjectionMatrix();
      camera.lookAt(base.look);
      return;
    }
    if (!debugHold) {
      tourClock = o.reducedMotion
        ? forward
          ? o.seconds
          : 0
        : THREE.MathUtils.clamp(tourClock + (forward ? dt : -dt * 2), 0, o.seconds);
    }
    closeness = tourClock / o.seconds;
    const moving = tourClock > 0 && tourClock < o.seconds;
    const idle = !o.reducedMotion && !debugHold && !moving && pointers.size === 0 && (performance.now() - lastInteraction) / 1000 > IDLE_AFTER_SECONDS;
    wander.weight += ((idle ? 1 : 0) - wander.weight) * (1 - Math.exp(-dt / 1.5));
    if (wander.weight < 1e-4 && !idle) wander.weight = 0;
    const [a, b, c, d] = wanderPhase;
    // Smaller swings up close (the subject is centimetres away).
    const amp = (o.idleMotion ?? 1) * THREE.MathUtils.lerp(1, 0.45, closeness);
    wander.yaw = wander.weight * amp * (0.12 * Math.sin(t * 0.16 + a) + 0.06 * Math.sin(t * 0.083 + b));
    wander.pitch = wander.weight * amp * (0.028 * Math.sin(t * 0.11 + c) + 0.015 * Math.sin(t * 0.061 + d));

    const eased = closeness * closeness * closeness * (closeness * (closeness * 6 - 15) + 10);
    const { turn, rise, near } = tour.at(eased);
    look.lerpVectors(o.wide.look, close.look, lookShare(near));
    spherical.set(
      s0.radius * Math.pow(ratio, near),
      THREE.MathUtils.clamp(s0.phi + rise - orbit.pitch - wander.pitch, 0.05, Math.PI - 0.05),
      s0.theta + turn + orbit.yaw + wander.yaw,
    );
    camera.position.setFromSpherical(spherical).add(look);
    const [cFar, cNear] = o.clearance ?? [0.9, 0.06];
    const floor = o.groundAt(camera.position.x, camera.position.z) + THREE.MathUtils.lerp(cFar, cNear, near);
    if (camera.position.y < floor) camera.position.y = floor;
    camera.fov = fitFov(THREE.MathUtils.lerp(o.wide.fov, close.fov, near));
    // Near plane follows the subject distance (depth precision far away).
    camera.near = THREE.MathUtils.lerp(0.25, 0.012, near);
    camera.updateProjectionMatrix();
    camera.lookAt(look);
  };

  return {
    update,
    setLive(live) {
      if (o.flyby) {
        if (live && (back || tourClock <= 0)) {
          // Play (also during a back-off): the flyby starts from where we are.
          bakeOffsets();
          o.flyby(0, fly);
          startOffset = { pos: base.pos.clone().sub(fly.pos), look: base.look.clone().sub(fly.look) };
          back = null;
          tourClock = 0;
        } else if (!live && (forward || tourClock > 0)) startBack();
      }
      forward = live;
      if (o.flyby) return;
      orbit.targetYaw = 0;
      orbit.targetPitch = 0;
      if (o.reducedMotion) {
        orbit.yaw = 0;
        orbit.pitch = 0;
      }
    },
    progress: () => closeness,
    debugBack(from, s) {
      debugHold = true;
      wander.weight = 0;
      wander.yaw = 0;
      wander.pitch = 0;
      tourClock = from * o.seconds;
      back = null;
      startOffset = null;
      flybyBase(0);
      startBack();
      if (back) (back as { s: number }).s = s;
      flybyBase(0);
    },
    debugSet(p) {
      debugHold = p >= 0;
      back = null;
      startOffset = null;
      if (debugHold) {
        tourClock = p * o.seconds;
        wander.weight = 0;
        wander.yaw = 0;
        wander.pitch = 0;
      }
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    },
    setClose(view) {
      close = view;
      build();
    },
    onStill(fn) {
      still = fn;
    },
  };
}

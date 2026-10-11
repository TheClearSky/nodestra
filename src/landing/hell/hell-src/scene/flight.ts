// COPIED from .claude/pages/ad/experiments/hell-src/scene/flight.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * "The Ascent" — an FPV drone flight from the hero view, through the
 * ribcage, through the citadel, to the piano on its roof (hell-30;
 * research/hellscape/FLIGHT.md has the story, the shot list and the model).
 *
 * Motion model v3 — a simulated drone, not a camera on rails (owner,
 * 2026-10-11: "should feel like an fpv drone, it should accelerate to the top
 * speed within like first few seconds … swerve like an fpv drone, don't look
 * left or right … when doing the turns there should be drift too, velocity
 * doesn't change like that, camera should keep looking ahead as drift
 * happens … some overshoot too at very tight turns … camera shake when
 * passing into a tunnel, passing by a big object … a very little amount of
 * camera shake in general too, see what kind of shake wind causes"):
 *
 *   ROUTE    a natural cubic spline through the waypoints (C2: no kinks).
 *   PACE     a reference point runs along it by distance: per-waypoint cruise
 *            speeds, hard FPV acceleration and braking caps, jerk-limited
 *            start and stop.
 *   DRONE    a point mass chasing the reference point (a spring-damper with
 *            the waypoint's "grip": stiff and damped in tight places, loose
 *            and under-damped in open turns) under a thrust limit. It cannot
 *            turn on the spot: in turns it slides wide (drift) and at very
 *            tight turns it overshoots and comes back.
 *   CAMERA   fixed to the drone, looking AHEAD along the route (never left
 *            or right at a subject — only the very start and the landing
 *            aim): while the drone drifts, the view keeps looking where it is
 *            going. Banking from the drone's sideways acceleration, nose down
 *            when it accelerates and up when it brakes, a field of view that
 *            widens with speed. A light gimbal (cascaded slerps, lead
 *            compensated) takes the edge off.
 *   SHAKE    smooth noise, after the gimbal: WIND always (slow sway 0.3–1 Hz,
 *            gust envelope) and TURBULENCE from "trauma" (per-waypoint
 *            roughness near walls and big objects, a kick on entering a
 *            tunnel or opening, prop wash in hard turns and braking), scaled
 *            by trauma² so the small stays subtle.
 *
 * Everything is baked once at 120 Hz, so seeking is exact.
 */

import * as THREE from 'three';

type V3 = [number, number, number];
export type Waypoint = {
  pos: V3;
  /** Cruise speed here, m/s (0 = at rest). */
  speed: number;
  /** Aim: a point to look at (the start and the landing only), else ahead along the route. */
  aim?: V3;
  fov?: number;
  /** How hard the drone holds the route here (spring frequency, rad/s): low = drifts and overshoots. */
  grip: number;
  /** Turbulence here (0..1): near walls, through openings, by big objects. */
  rough?: number;
  /** A kick of turbulence when the drone reaches this point (entering a tunnel / opening). */
  bump?: number;
  /** Performance multiplier on acceleration, braking and thrust here (default 1). */
  power?: number;
  shot: string;
};

/**
 * The route, world metres. The ribcage (measured in the scene): centre
 * (−161.5, −260.7), long axis (−0.951, −0.308), arches meet at y ≈ 28–35,
 * open inside at y ≈ 14 for |offset| < ~20 m; its spine slopes to the ground
 * beyond both ends. The castle's foot is (0, 0, −420); terrace floor y 220.
 */
export const ASCENT: Waypoint[] = [
  { pos: [0, 9, 70], speed: 0, aim: [0, 95, -420], fov: 40, grip: 6, power: 4, shot: 'the view' },
  // Before the castle the drone is a racer at 4× power (owner: "at least 4
  // times faster, keep it realistic"): long straights at ~180–200 m/s, wide
  // turns, 8 g acceleration and braking. Laid out in the ribcage's own frame
  // (u along its axis, v across it; see the comment above):
  //   a swerve left onto a straight down the cage's north side (v −70),
  //   a wide teardrop turn round its west tail, the full nave flown east
  //   (toward the castle) at y ≈ 14, out of the east mouth on the castle
  //   side of the spine's tail (v +22), and a braking run to the gate.
  { pos: [-10, 22, -30], speed: 240, grip: 4, power: 4, shot: 'lift-off' },
  { pos: [-21.3, 30, -141.7], speed: 230, grip: 4, power: 4, rough: 0.1, shot: 'the swerve' },
  { pos: [-126.0, 28, -175.6], speed: 260, grip: 4, power: 4, rough: 0.3, shot: 'past the bones' },
  // Braking well before a wider teardrop, with a firmer grip and an earlier
  // turn-in (owner: "flying too far ahead when coming back to enter the
  // skeleton, steer harder and earlier").
  { pos: [-240.1, 28.0, -212.6], speed: 150, grip: 5, power: 4, rough: 0.3, shot: 'past the bones' },
  { pos: [-366.9, 32.0, -243.1], speed: 115, grip: 5.5, power: 4, rough: 0.1, shot: 'the teardrop' },
  { pos: [-446.5, 34.0, -305.7], speed: 82, grip: 6, power: 4, shot: 'the teardrop' },
  { pos: [-434.5, 30.0, -375.3], speed: 82, grip: 6, power: 4, shot: 'the teardrop' },
  { pos: [-360.8, 22.0, -375.7], speed: 115, grip: 6, power: 4, shot: 'the teardrop' },
  { pos: [-295.0, 18.0, -335.4], speed: 150, grip: 6, power: 4, rough: 0.15, shot: 'the run-in' },
  { pos: [-247.9, 15.0, -302.3], speed: 170, grip: 7, power: 4, rough: 0.35, shot: 'the run-in' },
  { pos: [-216.7, 14.0, -284.9], speed: 175, grip: 9, power: 4, rough: 0.55, bump: 0.75, shot: 'into the ribs' },
  { pos: [-180.5, 14.0, -266.9], speed: 170, grip: 9, power: 4, rough: 0.5, shot: 'the nave' },
  { pos: [-131.7, 14.0, -255.3], speed: 130, grip: 9, power: 4, rough: 0.5, shot: 'the nave' },
  // Out of the east mouth on the side away from the spine's tail, then ONE
  // constant-radius right turn (R 76 m, 108°) ending on the gate's centre line,
  // the speed only ever falling (owner: "the turning is so jagged and uneven
  // when coming out of the skeleton and entering the castle").
  { pos: [-99.4, 15.0, -251.1], speed: 100, grip: 7, power: 4, rough: 0.45, bump: 0.5, shot: 'out of the ribs' },
  { pos: [-71.2, 15.3, -247.6], speed: 70, grip: 7, power: 4, rough: 0.2, shot: 'the sweep' },
  { pos: [-43.6, 15.6, -254.7], speed: 64, grip: 7, power: 4, rough: 0.2, shot: 'the sweep' },
  { pos: [-20.6, 15.9, -271.4], speed: 58, grip: 7, power: 4, rough: 0.1, shot: 'the sweep' },
  { pos: [-5.3, 16.2, -295.4], speed: 52, grip: 7, power: 3, rough: 0.1, shot: 'the sweep' },
  { pos: [-0.0, 16.5, -323.4], speed: 47, grip: 9, power: 3, rough: 0.1, shot: 'line-up' },
  { pos: [0, 16.5, -332], speed: 45, fov: 46, grip: 9, power: 2, rough: 0.6, bump: 0.8, shot: 'the gate' },
  { pos: [0, 18, -352], speed: 42, grip: 8, power: 2, rough: 0.25, shot: 'the courtyard' },
  { pos: [0, 19.5, -368], speed: 40, grip: 9, power: 2, rough: 0.45, bump: 0.6, shot: 'the portal' },
  { pos: [0, 25, -401], speed: 30, fov: 54, grip: 8, power: 2, rough: 0.3, shot: 'the hall' },
  { pos: [1.5, 50, -419], speed: 38, grip: 8, power: 2, rough: 0.35, shot: 'the turn up' },
  { pos: [2, 115, -420], speed: 55, grip: 8, power: 2, rough: 0.35, shot: 'the shaft' },
  { pos: [2, 180, -420], speed: 45, grip: 8, power: 2, rough: 0.4, shot: 'the galleries' },
  { pos: [2, 210, -420], speed: 26, grip: 9, power: 1.5, rough: 0.55, bump: 0.6, shot: 'the belfry' },
  // Out of the oculus and up, slowing to a hover above the terrace (owner:
  // "the last slowdown sequence is jarring, speed and direction abruptly
  // changes"): no orbit any more. From the hover the landing is scripted.
  { pos: [2, 230, -420], speed: 11, fov: 50, grip: 8, rough: 0.45, bump: 0.7, shot: 'emergence' },
  { pos: [1.8, 246, -421], speed: 3, grip: 6, rough: 0.1, shot: 'the hover' },
  // The seat, on the piano's pedestal (8 m above the terrace): it looks at the
  // piano's centre — the orbit's target once landed.
  { pos: [0.2, 229.75, -427.6], speed: 0, aim: [0, 228.98, -428.95], fov: 54, grip: 9, shot: 'the seat' },
];

const ACCEL = 20; // m/s²: 0 → 60 m/s in about 3 s
const BRAKE = 16; // m/s²
const JERK = 45; // m/s³: the punch at the start and the touch-down are jerk-limited
const THRUST = 42; // m/s²: the most the drone can pull at power 1 (≈ 4.3 g) — beyond it, it drifts wide
const THRUST_POWER_MAX = 2.5; // thrust grows with power only so far (≈ 10.7 g): at 4× speed the racer drifts much wider
const DAMPING = 0.6; // spring damping ratio in open air (under-damped: overshoot); 0.9 when grip ≥ 6
const LOOK_AHEAD = 18; // metres of route ahead at rest
const LOOK_TIME = 0.7; // seconds of travel ahead
const TAU = 0.36; // light gimbal, s
const BANK = 0.85; // degrees of roll per m/s² sideways
const BANK_MAX = 32;
const PITCH = 0.45; // degrees of nose-down per m/s² of acceleration
const PITCH_MAX = 12;
const FOV_KICK = 0.26; // degrees of field of view per m/s above 12 m/s
const FOV_KICK_MAX = 22;
const HZ = 120;

const smoother = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * c * (c * (c * 6 - 15) + 10);
};

/** A natural cubic spline through points, per coordinate, over the knots ts. */
function naturalSpline(ts: number[], ys: number[]) {
  const n = ts.length;
  const h = ts.slice(0, -1).map((t, i) => ts[i + 1] - t);
  const alpha = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) alpha[i] = (3 / h[i]) * (ys[i + 1] - ys[i]) - (3 / h[i - 1]) * (ys[i] - ys[i - 1]);
  const l = new Array(n).fill(1);
  const mu = new Array(n).fill(0);
  const z = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    l[i] = 2 * (ts[i + 1] - ts[i - 1]) - h[i - 1] * mu[i - 1];
    mu[i] = h[i] / l[i];
    z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
  }
  const c = new Array(n).fill(0);
  const b = new Array(n - 1).fill(0);
  const d = new Array(n - 1).fill(0);
  for (let j = n - 2; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j + 1];
    b[j] = (ys[j + 1] - ys[j]) / h[j] - (h[j] * (c[j + 1] + 2 * c[j])) / 3;
    d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
  }
  return (t: number) => {
    let j = 0;
    while (j < n - 2 && t > ts[j + 1]) j++;
    const x = t - ts[j];
    return ys[j] + b[j] * x + c[j] * x * x + d[j] * x * x * x;
  };
}

/** Smooth 1D value noise in −1..1 (deterministic). */
function noise1(x: number, seed: number) {
  const h = (i: number) => {
    const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return h(i) + (h(i + 1) - h(i)) * u;
}
/** Two octaves of noise at a base frequency (Hz) and time t. */
const band = (t: number, hz: number, seed: number) => noise1(t * hz, seed) * 0.7 + noise1(t * hz * 2.13, seed + 9.1) * 0.3;

export type Pose = { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number; shot: string; vel: THREE.Vector3 };

export function createFlight(route: Waypoint[] = ASCENT) {
  const n = route.length;
  // ── the route: natural cubic spline, chord-length knots ──
  const knots = [0];
  for (let i = 1; i < n; i++) knots.push(knots[i - 1] + new THREE.Vector3(...route[i].pos).distanceTo(new THREE.Vector3(...route[i - 1].pos)));
  const sx = naturalSpline(knots, route.map((w) => w.pos[0]));
  const sy = naturalSpline(knots, route.map((w) => w.pos[1]));
  const sz = naturalSpline(knots, route.map((w) => w.pos[2]));

  // ── arc length ──
  const N = 8000;
  const S = new Float64Array(N + 1);
  const P = Array.from({ length: N + 1 }, () => new THREE.Vector3());
  for (let i = 0; i <= N; i++) {
    const u = (knots[n - 1] * i) / N;
    P[i].set(sx(u), sy(u), sz(u));
    S[i] = i === 0 ? 0 : S[i - 1] + P[i].distanceTo(P[i - 1]);
  }
  const length = S[N];
  const wS = knots.map((k) => S[Math.round((k / knots[n - 1]) * N)]);
  const idx = (s: number) => {
    let lo = 0;
    let hi = N;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (S[m] <= s) lo = m;
      else hi = m;
    }
    return lo;
  };
  const posAtS = (s: number, out: THREE.Vector3) => {
    const c = Math.min(length, Math.max(0, s));
    const i = Math.min(N - 1, idx(c));
    const f = (c - S[i]) / Math.max(1e-9, S[i + 1] - S[i]);
    return out.copy(P[i]).lerp(P[i + 1], Math.min(1, Math.max(0, f)));
  };
  const segAt = (s: number) => {
    let i = 0;
    while (i < n - 2 && s > wS[i + 1]) i++;
    return { i, f: Math.min(1, Math.max(0, (s - wS[i]) / Math.max(1e-6, wS[i + 1] - wS[i]))) };
  };
  /** A per-waypoint value, eased between waypoints by distance. */
  const along = (s: number, get: (w: Waypoint) => number) => {
    const { i, f } = segAt(s);
    return get(route[i]) + (get(route[i + 1]) - get(route[i])) * smoother(f);
  };

  // ── the pace: cruise targets, FPV acceleration / braking, jerk-limited ends ──
  const cruise = route.map((w, i) => (w.speed > 0 ? w.speed : route[i === 0 ? 1 : i - 1].speed));
  const v = new Float64Array(N + 1);
  for (let k = 0; k <= N; k++) {
    const { i, f } = segAt(S[k]);
    v[k] = cruise[i] + (cruise[i + 1] - cruise[i]) * smoother(f);
  }
  const powerAt = new Float64Array(N + 1);
  for (let k = 0; k <= N; k++) powerAt[k] = along(S[k], (w) => w.power ?? 1);
  // The racing-line limit: no turn faster than the drone's sideways grip allows,
  // v ≤ √(a_side / κ). In open air the pace asks ~2.8× what the drone can
  // pull (it carries speed and drifts wide); in tight places only 60% (it tracks).
  {
    const H = 8;
    const kappa = new Float64Array(N + 1);
    const a0 = new THREE.Vector3();
    const a1 = new THREE.Vector3();
    const a2 = new THREE.Vector3();
    for (let k = 0; k <= N; k++) {
      posAtS(S[k] - H, a0);
      posAtS(S[k], a1);
      posAtS(S[k] + H, a2);
      kappa[k] = a0.add(a2).addScaledVector(a1, -2).length() / (H * H);
    }
    // Spread each curve's limit over ±12 m (the drone sees a turn coming).
    const spread = Float64Array.from(kappa);
    let j0 = 0;
    for (let k = 0; k <= N; k++) {
      while (S[j0] < S[k] - 12) j0++;
      let m = 0;
      for (let q = j0; q <= N && S[q] <= S[k] + 12; q++) m = Math.max(m, kappa[q]);
      spread[k] = m;
    }
    for (let k = 0; k <= N; k++) {
      const grip = along(S[k], (w) => w.grip);
      const slip = THREE.MathUtils.lerp(2.8, 0.6, THREE.MathUtils.clamp((grip - 3) / 4, 0, 1));
      const side = THRUST * Math.min(THRUST_POWER_MAX, powerAt[k]) * slip;
      if (spread[k] > 1e-6) v[k] = Math.min(v[k], Math.sqrt(side / spread[k]));
    }
  }
  const limit = () => {
    v[0] = 0;
    v[N] = 0;
    for (let k = 1; k <= N; k++) v[k] = Math.min(v[k], Math.sqrt(v[k - 1] ** 2 + 2 * ACCEL * powerAt[k] * (S[k] - S[k - 1])));
    for (let k = N - 1; k >= 0; k--) v[k] = Math.min(v[k], Math.sqrt(v[k + 1] ** 2 + 2 * BRAKE * powerAt[k] * (S[k + 1] - S[k])));
  };
  const average = (half: number) => {
    const src = Float64Array.from(v);
    let j0 = 0;
    let j1 = 0;
    let sum = 0;
    for (let k = 0; k <= N; k++) {
      while (j1 <= N && S[j1] <= S[k] + half) sum += src[j1++];
      while (S[j0] < S[k] - half) sum -= src[j0++];
      v[k] = sum / Math.max(1, j1 - j0);
    }
  };
  limit();
  average(5);
  limit();
  average(3);
  // Jerk-limited ends (the start is in the racer's zone: its jerk scales too).
  const jStart = JERK * powerAt[0];
  const jEnd = JERK * powerAt[N];
  for (let k = 0; k <= N; k++) {
    const cap = (d: number, J: number) => (J / 2) * Math.cbrt((6 * d) / J) ** 2;
    v[k] = Math.min(v[k], cap(S[k], jStart), cap(length - S[k], jEnd));
  }
  const T = new Float64Array(N + 1);
  for (let k = 1; k <= N; k++) T[k] = T[k - 1] + (S[k] - S[k - 1]) / Math.max(0.02, (v[k] + v[k - 1]) / 2);
  const refDuration = T[N];
  const speedAtS = (s: number) => v[Math.min(N, idx(Math.min(length, Math.max(0, s))))];

  // ── the bake: simulate the drone, aim the camera, shake it ──
  // The drone flies the course itself (pure pursuit): it finds its own place
  // on the route, aims at a carrot a little ahead of it, wants the route's
  // speed there, and turns its velocity toward that only as fast as its
  // thrust (and a jerk limit) allow. So it drifts wide in turns and overshoots
  // tight ones — but never loses its place. The duration falls out of it.
  const DP: THREE.Vector3[] = [];
  const Q: THREE.Quaternion[] = [];
  const F: number[] = [];
  const SH: number[] = []; // the shot's waypoint index, for the UI
  const DV: THREE.Vector3[] = []; // the drone's velocity
  const PR: number[] = []; // its progress along the route (m)
  void refDuration;
  const dt = 1 / HZ;
  const p = new THREE.Vector3(...route[0].pos);
  const vel = new THREE.Vector3();
  const acc = new THREE.Vector3();
  const refAhead = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const aimDir = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const yProj = new THREE.Vector3();
  const side = new THREE.Vector3();
  const rolledUp = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const origin = new THREE.Vector3();
  const qWant = new THREE.Quaternion();
  const q1 = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const qShake = new THREE.Quaternion();
  const eShake = new THREE.Euler();
  const k = 1 - Math.exp(-dt / TAU);
  let fov1 = route[0].fov ?? 40;
  let fov2 = fov1;
  let bankS = 0;
  let pitchS = 0;
  let trauma = 0;
  let nextBump = 1;
  const aims = route.map((w) => w.aim);
  const fovs: number[] = [];
  route.forEach((w, i) => fovs.push(w.fov ?? (i > 0 ? fovs[i - 1] : 40)));

  let prog = 0;
  let restFor = 0;
  const accPrev = new THREE.Vector3();
  const carrot = new THREE.Vector3();
  const want = new THREE.Vector3();
  for (let j = 0; ; j++) {
    const t = j * dt;
    // Where am I on the route? The nearest sample just behind … well ahead of the last place.
    {
      let best = prog;
      let bestD = Infinity;
      const i0 = idx(Math.max(0, prog - 4));
      for (let q = i0; q <= N && S[q] <= prog + 45; q++) {
        const d = P[q].distanceToSquared(p);
        if (d < bestD) {
          bestD = d;
          best = S[q];
        }
      }
      prog = Math.max(prog, best);
    }
    const s = prog;
    const sp = speedAtS(Math.min(length, s + 1.2)); // (a little ahead, or it never leaves the start)
    const grip = along(s, (w) => w.grip);
    const gn = THREE.MathUtils.clamp((grip - 3) / 5, 0, 1);
    const power = along(s, (w) => w.power ?? 1);
    // The carrot: a little way ahead along the route (further at speed, less where it is tight).
    const lead = THREE.MathUtils.clamp(vel.length() * THREE.MathUtils.lerp(0.5, 0.2, gn), 4, 70);
    posAtS(Math.min(length, s + lead), carrot);
    want.copy(carrot).sub(p);
    if (want.lengthSq() > 1e-8) want.normalize().multiplyScalar(sp);
    else want.set(0, 0, 0);
    // Steer the velocity toward it: a responsiveness that rises with grip,
    // under the thrust limit and a jerk limit (no instant changes of force).
    const kv = THREE.MathUtils.lerp(DAMPING * 4, 6.5, gn);
    acc.copy(want).sub(vel).multiplyScalar(kv);
    const thrust = THRUST * Math.min(THRUST_POWER_MAX, power);
    if (acc.length() > thrust) acc.setLength(thrust);
    const dj = tmp.copy(acc).sub(accPrev);
    const jmax = JERK * 8 * power * dt;
    if (dj.length() > jmax) acc.copy(accPrev).addScaledVector(dj.normalize(), jmax);
    accPrev.copy(acc);
    vel.addScaledVector(acc, dt);
    p.addScaledVector(vel, dt);
    DP.push(p.clone());
    DV.push(vel.clone());
    PR.push(s);
    Q.push(new THREE.Quaternion());
    // Arrived: at the end of the route and (nearly) still — hold a moment, then stop.
    if (s >= length - 0.4 && vel.length() < 0.25) restFor += dt;
    // The landing begins at the last waypoint before the seat: the simulation hands over.
    const done = restFor > 0.6 || t > 180 || s >= wS[n - 2];

    // The camera looks ahead along the route — from where the drone actually is.
    const { i, f } = segAt(s);
    const ahead = Math.max(LOOK_AHEAD, LOOK_TIME * Math.max(sp, vel.length()));
    // Never look past the hover (where the landing takes over): beyond it the
    // route bends down to the seat, and looking there whipped the view round.
    // Past the hover, look along the route's direction INTO the hover instead.
    const sHover = wS[n - 2];
    if (s + ahead <= sHover) posAtS(s + ahead, refAhead);
    else {
      posAtS(sHover, refAhead);
      const into = posAtS(Math.max(0, sHover - 2), tmp).sub(refAhead).negate().normalize();
      refAhead.addScaledVector(into, s + ahead - sHover);
    }
    aimDir.copy(refAhead).sub(p);
    if (aimDir.lengthSq() < 1e-6) aimDir.copy(vel.lengthSq() > 1e-6 ? vel : dir);
    aimDir.normalize();
    // Only the start and the landing aim at something: blend in near them.
    const startAim = aims[0] ? smoother(1 - Math.min(1, s / Math.max(1, wS[1] * 0.6))) : 0;
    const endAim = aims[n - 1] ? smoother((s - wS[n - 2]) / Math.max(1e-6, wS[n - 1] - wS[n - 2])) : 0;
    const aimFirst = aims[0];
    const aimLast = aims[n - 1];
    if (startAim > 0 && aimFirst) aimDir.lerp(tmp.set(...aimFirst).sub(p).normalize(), startAim).normalize();
    if (endAim > 0 && aimLast) aimDir.lerp(tmp.set(...aimLast).sub(p).normalize(), endAim).normalize();
    dir.copy(aimDir);

    // Up: carried along; pulled to world up only as far as the view is not vertical.
    up.addScaledVector(dir, -up.dot(dir));
    const level = Math.max(0, 1 - Math.abs(dir.dot(Y))) ** 2;
    yProj.copy(Y).addScaledVector(dir, -Y.dot(dir));
    if (yProj.lengthSq() > 1e-6) up.lerp(yProj.normalize(), level * 0.08);
    up.normalize();
    side.crossVectors(dir, up).normalize();
    // Attitude from the drone's own acceleration: bank into turns, nose down to accelerate.
    const settle = 1 - endAim;
    // Bank by the turn of the flight path itself (not the view, which may be
    // drifting): sideways acceleration about the velocity, + = turning left.
    const turnLeft = vel.lengthSq() > 1 ? tmp.crossVectors(vel, acc).y / vel.length() : 0;
    const bankWant = THREE.MathUtils.clamp(turnLeft * BANK, -BANK_MAX, BANK_MAX) * level * settle;
    const pitchWant = THREE.MathUtils.clamp(acc.dot(dir) * PITCH, -PITCH_MAX, PITCH_MAX) * level * settle;
    bankS += (bankWant - bankS) * (1 - Math.exp(-dt / 0.18));
    pitchS += (pitchWant - pitchS) * (1 - Math.exp(-dt / 0.25));
    // (+bank leans "up" to the left: the drone rolls into a left turn.)
    rolledUp.copy(up).applyAxisAngle(dir, -THREE.MathUtils.degToRad(bankS));
    const pitched = tmp.copy(dir).applyAxisAngle(side, -THREE.MathUtils.degToRad(pitchS));
    m.lookAt(origin, pitched, rolledUp);
    qWant.setFromRotationMatrix(m);
    if (j === 0) {
      q1.copy(qWant);
      q2.copy(qWant);
    } else {
      q1.slerp(qWant, k);
      q2.slerp(q1, k);
    }

    // Shake: wind always; turbulence from trauma (roughness, bumps, prop wash).
    while (nextBump < n && s >= wS[nextBump]) {
      trauma = Math.max(trauma, route[nextBump].bump ?? 0);
      nextBump++;
    }
    trauma *= Math.exp(-dt / 0.7);
    const rough = along(s, (w) => w.rough ?? 0);
    const wash = Math.min(0.5, Math.max(0, acc.length() - 14) * 0.02); // hard turns and braking
    // Buffeting grows with airspeed (a racer at 150 m/s is never still).
    const buffet = Math.min(0.5, Math.max(0, vel.length() - 40) / 260);
    const T2 = Math.min(1, Math.max(trauma, rough, wash, buffet)) ** 2;
    const gust = (0.7 + 0.5 * (band(t, 0.08, 1) * 0.5 + 0.5)) * 2.2; // everyday wind sway (owner: "increase normal flying shake")
    const calm = 1 - endAim * 0.85;
    const yaw = (band(t, 0.45, 2) * 0.32 * gust + band(t, 9, 5) * 1.1 * T2 + band(t, 3.1, 8) * 0.6 * T2) * calm;
    const pit = (band(t, 0.38, 3) * 0.28 * gust + band(t, 11, 6) * 1.0 * T2 + band(t, 2.7, 9) * 0.55 * T2) * calm;
    const rol = (band(t, 0.3, 4) * 0.45 * gust + band(t, 7.5, 7) * 1.6 * T2 + band(t, 2.2, 10) * 0.8 * T2) * calm;
    eShake.set(THREE.MathUtils.degToRad(pit), THREE.MathUtils.degToRad(yaw), THREE.MathUtils.degToRad(rol), 'YXZ');
    qShake.setFromEuler(eShake);
    Q[j].copy(q2).multiply(qShake);
    // A little bodily jitter too (centimetres), mostly from turbulence.
    DP[j].x += (band(t, 0.6, 11) * 0.09 + band(t, 8, 12) * 0.12 * T2) * calm;
    DP[j].y += (band(t, 0.5, 13) * 0.11 + band(t, 10, 14) * 0.12 * T2) * calm;

    // Field of view: the shot's, plus a kick that grows with speed.
    const fovShot = fovs[i] + (fovs[Math.min(n - 1, i + 1)] - fovs[i]) * smoother(f);
    const kick = Math.min(FOV_KICK_MAX, Math.max(0, vel.length() - 12) * FOV_KICK) * settle;
    fov1 += (fovShot + kick - fov1) * k;
    fov2 += (fov1 - fov2) * k;
    F.push(fov2);
    SH.push(Math.min(n - 1, i + (f > 0.5 ? 1 : 0)));
    if (done) break;
  }
  // The landing (owner: "make it not wobble at the end … slow down and stop
  // completely in one go"; then: "the last slowdown sequence is jarring").
  // From the hover above the terrace: one cubic Bézier from the drone's
  // position and velocity to the seat (end control point on the seat, so it
  // arrives at rest), over LAND_SECONDS — a slow sink forward and down. The
  // view keeps going through the SAME two-stage gimbal filter as the flight
  // (its state carries on, so the turning never stops or starts in a frame):
  // it tips from where it looks to the horizon and the spells, then settles
  // onto the instrument. The wind shake fades out with it.
  const LAND_SECONDS = 6.5;
  const last = route[n - 1];
  const pEnd = new THREE.Vector3(...last.pos);
  const target = new THREE.Vector3(...(last.aim ?? [0, 0, -1]));
  m.lookAt(origin, tmp.copy(target).sub(pEnd).normalize(), Y);
  const qEnd = new THREE.Quaternion().setFromRotationMatrix(m);
  const p0 = DP[DP.length - 1].clone();
  const v0 = DV[DV.length - 1].clone();
  const f0 = F[F.length - 1];
  const c1 = p0.clone().addScaledVector(v0, LAND_SECONDS / 3);
  // A second control point just above the seat: it arrives sinking straight in, gently.
  const c2 = pEnd.clone().add(new THREE.Vector3(0, 1.2, 1.4));
  const bez = (u: number, out: THREE.Vector3) => {
    const a0 = (1 - u) ** 3;
    const a1 = 3 * u * (1 - u) ** 2;
    const a2 = 3 * u * u * (1 - u);
    const a3 = u ** 3;
    return out.set(0, 0, 0).addScaledVector(p0, a0).addScaledVector(c1, a1).addScaledVector(c2, a2).addScaledVector(pEnd, a3);
  };
  const landSteps = Math.round(LAND_SECONDS * HZ);
  const t0 = (DP.length - 1) / HZ;
  const prev = p0.clone();
  const horizon = new THREE.Vector3(0, -0.12, -1).normalize(); // the spells and the horizon, south
  // (from the gimbal's own state — not the shaken frame — so the hand-over is seamless)
  const startDir = new THREE.Vector3(0, 0, -1).applyQuaternion(q2);
  const toTarget = new THREE.Vector3();
  const wantDir = new THREE.Vector3();
  for (let q = 1; q <= landSteps; q++) {
    const x = q / landSteps;
    // u(x) = x + x² − x³: slope 1 at the start (the curve's speed is the
    // drone's own), slope 0 at the end (it arrives at rest), never backwards.
    const u = x + x * x - x * x * x;
    const pos = bez(u, new THREE.Vector3());
    // Where to look: from the flight's last view, to the horizon and the spells, to the instrument.
    toTarget.copy(target).sub(pos).normalize();
    const a = smoother(x / 0.5);
    const b2 = smoother((x - 0.35) / 0.65);
    wantDir.copy(startDir).lerp(horizon, a).normalize().lerp(toTarget, b2).normalize();
    // "Up" carried on from the flight (it starts looking straight up, where
    // world up is undefined), pulled to world up as the view levels.
    up.addScaledVector(wantDir, -up.dot(wantDir));
    const levelL = Math.max(0, 1 - Math.abs(wantDir.dot(Y))) ** 2;
    yProj.copy(Y).addScaledVector(wantDir, -Y.dot(wantDir));
    if (yProj.lengthSq() > 1e-6) up.lerp(yProj.normalize(), levelL * 0.08);
    up.normalize();
    m.lookAt(origin, wantDir, up);
    qWant.setFromRotationMatrix(m);
    q1.slerp(qWant, k);
    q2.slerp(q1, k);
    const quat = q2.clone();
    // The same shake as in flight (wind with its gusts, the turbulence still
    // decaying), fading to stillness — no step at the hand-over.
    const fade = 1 - smoother(x);
    const t = t0 + q / HZ;
    trauma *= Math.exp(-dt / 0.7);
    const T2l = Math.min(1, trauma) ** 2;
    const gustL = (0.7 + 0.5 * (band(t, 0.08, 1) * 0.5 + 0.5)) * 2.2;
    eShake.set(
      THREE.MathUtils.degToRad((band(t, 0.38, 3) * 0.28 * gustL + band(t, 11, 6) * 1.0 * T2l + band(t, 2.7, 9) * 0.55 * T2l) * fade),
      THREE.MathUtils.degToRad((band(t, 0.45, 2) * 0.32 * gustL + band(t, 9, 5) * 1.1 * T2l + band(t, 3.1, 8) * 0.6 * T2l) * fade),
      THREE.MathUtils.degToRad((band(t, 0.3, 4) * 0.45 * gustL + band(t, 7.5, 7) * 1.6 * T2l + band(t, 2.2, 10) * 0.8 * T2l) * fade),
      'YXZ',
    );
    quat.multiply(qShake.setFromEuler(eShake));
    DP.push(pos);
    DV.push(pos.clone().sub(prev).multiplyScalar(HZ));
    prev.copy(pos);
    Q.push(quat);
    F.push(f0 + ((last.fov ?? 40) - f0) * smoother(x));
    PR.push(length);
    SH.push(n - 1);
  }
  // The filter lags a hair behind its target: settle exactly onto the seat's framing.
  const settleN = Math.round(HZ * 0.8);
  const qLast = Q[Q.length - 1].clone();
  for (let q = 0; q < settleN; q++) {
    DP.push(pEnd.clone());
    DV.push(new THREE.Vector3());
    Q.push(qLast.clone().slerp(qEnd, smoother((q + 1) / settleN)));
    F.push(last.fov ?? 40);
    PR.push(length);
    SH.push(n - 1);
  }
  const steps = DP.length;
  const duration = (steps - 1) / HZ;

  const out: Pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 40, shot: '', vel: new THREE.Vector3() };
  return {
    duration,
    length,
    /** The camera pose at time t (seconds into the flight). */
    at(t: number): Pose {
      const x = Math.min(duration, Math.max(0, t)) * HZ;
      const j = Math.min(steps - 2, Math.floor(x));
      const fr = Math.min(1, x - j);
      out.pos.copy(DP[j]).lerp(DP[j + 1], fr);
      out.quat.copy(Q[j]).slerp(Q[j + 1], fr);
      out.fov = F[j] + (F[j + 1] - F[j]) * fr;
      out.shot = route[SH[j]].shot;
      out.vel.copy(DV[j]).lerp(DV[j + 1], fr);
      return out;
    },
    /** Tests: the pace's speed limit at distance s along the route, and the waypoint distances. */
    paceAt: (dist: number) => speedAtS(dist),
    waypointS: wS,
    /** The drone's speed (m/s) at time t, for tests. */
    speedAt(t: number) {
      const j = Math.min(steps - 2, Math.floor(t * HZ));
      return DP[j + 1].distanceTo(DP[j]) * HZ;
    },
    /** The reference route point at time t (for tests: how far the drone drifts). */
    routeAt(t: number) {
      const q = Math.min(PR.length - 1, Math.max(0, Math.round(t * HZ)));
      return posAtS(PR[q], new THREE.Vector3());
    },
  };
}

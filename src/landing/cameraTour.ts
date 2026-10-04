import * as THREE from 'three';

/**
 * A camera tour through hand-picked views, for the landing's "Play the
 * piano" glide.
 *
 * - The views are [turn, rise] angles. The path is ONE Bézier curve with the
 *   views as its control points: it starts exactly at the first and ends
 *   exactly at the last, and bends TOWARDS the ones between without passing
 *   through them. That is what keeps it a single sweep with no corners (an
 *   interpolating spline through every view turned sharply at each one, and
 *   a view past the end made the path double back across itself).
 * - `near` (0 = the audience seat, 1 = close in) eases from 0 to 1 over the
 *   first `dollyShare` of the curve, so the move in is done early and the
 *   rest is an orbit at the close distance.
 * - The tour is re-timed by PERCEIVED motion — how far the view moves
 *   relative to how far away the subject is — so the long move in from the
 *   seat and the short orbit up close read at the same pace. `at(progress)`
 *   maps an evenly advancing 0…1 onto that.
 */

type TourWaypoint = readonly [turn: number, rise: number];
type TourPose = { position: THREE.Vector3; look: THREE.Vector3 };
type TourState = { turn: number; rise: number; near: number };
/** Writes the camera position and look point for a state (the scene's own
 *  spherical placement), so the tour can measure perceived motion. */
type PlaceTour = (turn: number, rise: number, near: number, out: TourPose) => void;

const SAMPLES = 800;

/** de Casteljau: the Bézier curve over `points` at u (0…1). */
function bezierPoint(points: readonly TourWaypoint[], u: number): [number, number] {
  const work = points.map(([turn, rise]) => [turn, rise]);
  for (let level = work.length - 1; level > 0; level--) {
    for (let i = 0; i < level; i++) {
      work[i][0] += (work[i + 1][0] - work[i][0]) * u;
      work[i][1] += (work[i + 1][1] - work[i][1]) * u;
    }
  }
  return [work[0][0], work[0][1]];
}

function makeCameraTour(
  waypoints: readonly TourWaypoint[],
  place: PlaceTour,
  dollyShare = 0.4,
) {
  if (waypoints.length < 2) throw new Error('camera tour: needs at least two waypoints');

  /** u runs 0…1 along the curve. */
  const stateAt = (u: number): TourState => {
    const clamped = Math.min(1, Math.max(0, u));
    const [turn, rise] =
      clamped === 1 ? [...waypoints[waypoints.length - 1]] : bezierPoint(waypoints, clamped);
    const inward = Math.min(1, clamped / dollyShare);
    return { turn, rise, near: inward * inward * (3 - 2 * inward) };
  };

  // Perceived-distance table: u at evenly spaced samples, and the fraction
  // of the whole tour's perceived motion reached by each.
  const reached: number[] = [];
  const pose: TourPose = { position: new THREE.Vector3(), look: new THREE.Vector3() };
  const previous: TourPose = { position: new THREE.Vector3(), look: new THREE.Vector3() };
  let total = 0;
  for (let i = 0; i <= SAMPLES; i++) {
    const { turn, rise, near } = stateAt(i / SAMPLES);
    place(turn, rise, near, pose);
    if (i > 0) {
      const distance = Math.max(0.1, pose.position.distanceTo(pose.look));
      total +=
        (pose.position.distanceTo(previous.position) + pose.look.distanceTo(previous.look)) /
        distance;
    }
    reached.push(total);
    previous.position.copy(pose.position);
    previous.look.copy(pose.look);
  }
  const fractions = reached.map((value) => (total > 0 ? value / total : 0));

  /** The state `progress` (0…1) of the way through the tour's perceived motion. */
  const at = (progress: number): TourState => {
    const target = Math.min(1, Math.max(0, progress));
    let low = 0;
    let high = SAMPLES;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (fractions[mid] <= target) low = mid;
      else high = mid;
    }
    const span = fractions[high] - fractions[low];
    const along = span > 0 ? (target - fractions[low]) / span : 0;
    return stateAt((low + along) / SAMPLES);
  };

  return { at, stateAt };
}

export { makeCameraTour };
export type { PlaceTour, TourPose, TourState, TourWaypoint };

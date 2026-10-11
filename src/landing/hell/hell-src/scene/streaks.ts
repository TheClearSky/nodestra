// COPIED from .claude/pages/ad/experiments/hell-src/scene/streaks.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Very faint speed streaks for the FPV flight — a flat 2D layer on top of the
 * screen, not part of the 3D scene (owner, 2026-10-11: "make the streaks a 2d
 * layer on the screen not 3d, and streaks shouldn't be directional and only
 * appear at edges, it should only depend on camera speed").
 *
 *   - a 2D canvas over the WebGL canvas (no grading, no depth, no 3D);
 *   - the lines radiate from the screen's centre (not from where the drone
 *     is heading), and live only in the outer band of the frame;
 *   - how many, how long and how fast they slide depends on the camera's
 *     speed alone; at rest there are none.
 */

export type Streaks = {
  el: HTMLCanvasElement;
  update(speed: number, dt: number): void;
  /** Stop listening for resizes and take the layer off the page. */
  dispose(): void;
};

/** `contained`: absolutely positioned inside its parent (the app's landing),
 *  instead of fixed over the whole page (the experiment page). */
export type StreakOptions = { contained?: boolean };

type Line = { angle: number; r: number; len: number; width: number; alpha: number };

const MAX_LINES = 170;
/** The band the streaks live in, as a fraction of the half-diagonal from the centre. */
const INNER = 0.42;
const OUTER = 1.02;

export function createStreaks(options: StreakOptions = {}): Streaks {
  const el = document.createElement('canvas');
  el.className = 'speed-streaks';
  el.style.cssText = options.contained
    ? 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
    : 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1';
  const ctx = el.getContext('2d')!;
  const lines: Line[] = [];
  let intensity = 0;
  let w = 0;
  let h = 0;
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = Math.round(innerWidth * dpr);
    h = Math.round(innerHeight * dpr);
    el.width = w;
    el.height = h;
  };
  resize();
  addEventListener('resize', resize);
  const spawn = (r?: number): Line => ({
    angle: Math.random() * Math.PI * 2,
    r: r ?? INNER + Math.random() * 0.06,
    len: 0.07 + Math.random() * 0.14,
    width: 1.1 + Math.random() * 1.5,
    alpha: 0.35 + Math.random() * 0.65,
  });
  return {
    el,
    update(speed, dt) {
      // 0 below 20 m/s, full by ~160 m/s; eased so it never pops.
      const want = Math.min(1, Math.max(0, (speed - 20) / 140));
      intensity += (want - intensity) * Math.min(1, dt * 3);
      const count = Math.round(MAX_LINES * intensity);
      while (lines.length < count) lines.push(spawn(INNER + Math.random() * (OUTER - INNER)));
      while (lines.length > count) lines.pop();
      ctx.clearRect(0, 0, w, h);
      if (count === 0) return;
      const cx = w / 2;
      const cy = h / 2;
      const half = Math.hypot(cx, cy);
      const flow = (0.25 + speed / 160) * dt; // outward, in half-diagonals per second × dt
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        l.r += flow * (0.7 + l.len * 4);
        if (l.r - l.len > OUTER) lines[i] = spawn();
        const a0 = Math.max(INNER, l.r - l.len);
        const a1 = Math.min(OUTER, l.r);
        if (a1 <= a0) continue;
        // Fade in from the band's inner edge, so the centre stays clean.
        const fadeIn = Math.min(1, (a0 - INNER) / 0.14 + 0.1);
        const alpha = 0.62 * intensity * l.alpha * fadeIn;
        const c = Math.cos(l.angle);
        const s = Math.sin(l.angle);
        ctx.strokeStyle = `rgba(255, 232, 216, ${alpha.toFixed(3)})`;
        ctx.lineWidth = l.width * (w / 1280);
        ctx.beginPath();
        ctx.moveTo(cx + c * a0 * half, cy + s * a0 * half);
        ctx.lineTo(cx + c * a1 * half, cy + s * a1 * half);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    dispose() {
      removeEventListener('resize', resize);
      el.remove();
    },
  };
}

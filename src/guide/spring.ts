/**
 * Second-order dynamics (t3ssel8r, "Giving Personality to Procedural
 * Animations using Math"): a value that FOLLOWS a target with character.
 *   f — natural frequency (Hz): how fast it responds
 *   z — damping: < 1 overshoots and wobbles, 1 settles exactly, > 1 lags
 *   r — initial response: > 1 overshoots at the start, < 0 anticipates
 * One per animated channel gives follow-through and overlap for free.
 */
class Spring {
  private y: number;
  private yd = 0;
  private xp: number;
  private readonly k1: number;
  private readonly k2: number;
  private readonly k3: number;

  constructor(f: number, z: number, r: number, x0 = 0) {
    this.k1 = z / (Math.PI * f);
    this.k2 = 1 / (2 * Math.PI * f) ** 2;
    this.k3 = (r * z) / (2 * Math.PI * f);
    this.y = x0;
    this.xp = x0;
  }

  /** Advance by `dt` seconds toward target `x`; returns the new value. */
  update(dt: number, x: number): number {
    if (dt <= 0) return this.y;
    const xd = (x - this.xp) / dt;
    this.xp = x;
    // Clamped k2 keeps the integration stable at large steps (a dropped frame).
    const k2 = Math.max(this.k2, (dt * dt) / 2 + (dt * this.k1) / 2, dt * this.k1);
    this.y += dt * this.yd;
    this.yd += (dt * (x + this.k3 * xd - this.y - this.k1 * this.yd)) / k2;
    return this.y;
  }
}

export { Spring };

// COPIED from .claude/pages/ad/experiments/env-src/v2-glsl.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * GLSL shared by the v2 water / bridge / petal experiments (append after
 * ENV_GLSL). `mistFade` replaces lab's `airFade`: the same aerial
 * perspective on a clear day, and with `uMist` up a low, drifting mist that
 * hugs the water and glows toward the sun — the backlit haze of ref 3.
 */

export const MIST_GLSL = /* glsl */ `
uniform float uMist;
uniform float uMistY;
vec3 mistColor(vec3 dir) {
  float fwd = pow(max(dot(dir, uSunDir), 0.0), 4.0);
  vec3 base = mix(uHaze, uHorizon, 0.3);
  return base + uSunColor * fwd * (0.12 + 0.4 * uMist);
}
vec3 mistFade(vec3 col, vec3 worldPos) {
  vec3 d = worldPos - cameraPosition;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-4);
  float f = 1.0 - exp(-dist * mix(0.0016, 0.0062, uMist));
  if (uMist > 0.0) {
    float h = max(worldPos.y - uMistY, 0.0);
    float wisp = 0.35 + 1.2 * fbm3(worldPos.xz * 0.05 + vec2(uTime * 0.035, uTime * 0.012));
    float low = uMist * exp(-h * 0.55) * (1.0 - exp(-dist * 0.02)) * wisp * 0.42;
    f = clamp(f + low * (1.0 - f), 0.0, 0.97);
  }
  return mix(col, mistColor(dir), f);
}
`;

/** The river channel in GLSL — must match river.ts riverHeight(). */
export const CHANNEL_GLSL = /* glsl */ `
float channelHeight(vec2 p) {
  float d = abs(p.x - riverCentre(p.y));
  return mix(-1.0, 0.0, smoothstep(4.9, 8.1, d));
}
`;

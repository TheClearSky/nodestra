// COPIED from .claude/pages/ad/experiments/hell-src/hell-11-sky-events-world.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-11 stand-in world and sky layer.
 *
 *  - `fx`: the event uniforms every HELL-11 shader shares (flash, rings,
 *    cracks, deck ring, black sun). `uFlash = vec4(strikeDir, intensity)` is
 *    the convention the clouds and pillar experiments can read later.
 *  - pillar proxy: a tall flared shaft, dark body with a backlit rim; its top
 *    leaves the frame and its foot sinks into the haze;
 *  - ribcage proxy: half-buried rib arches right of centre, in front of the
 *    low grade sun, so light can pour through the gaps;
 *  - cloud ceiling: one big plane above the camera with fbm clouds, a ragged
 *    hole around the pillar (the "eye"), crimson cracks along cloud edges and
 *    the expanding deck shock ring;
 *  - sky layer: an inner dome on the far plane drawn after the shared dome:
 *    black sun + corona, analytic sunburst, concentric shock rings and the
 *    sky flash, all in ONE shader.
 *
 * Every occluder honours `uOcclusion` (black in the god-ray buffer) and is on
 * layer OCCLUDERS so the ray pass can render only them.
 */

import * as THREE from 'three';
import { ENV_GLSL, type EnvUniforms } from '../env-src/lab';

/** Camera layer the radial god-ray pass renders (occluders + light source). */
export const OCCLUDERS = 5;

/** The pillar stands here (x, z); the camera looks at it from z = 60. */
export const PILLAR = new THREE.Vector2(0, -640);
/** Height of the cloud ceiling. */
export const CLOUD_BASE = 240;
/** The black sun / ring centre: high, directly behind the pillar. */
export const BLACK_DIR = new THREE.Vector3(0, 0.44, -1).normalize();

export type Fx = ReturnType<typeof makeFx>;

export function makeFx() {
  return {
    uFlash: { value: new THREE.Vector4(0, 0.3, -1, 0) },
    uFlashColor: { value: new THREE.Color('#dfe8ff') },
    uSrcDir: { value: BLACK_DIR.clone() },
    uBlackSun: { value: 0 },
    uBlackR: { value: 0.055 },
    uCoronaCol: { value: new THREE.Color('#ff2a3a') },
    uBurst: { value: 0 },
    uSrcGlow: { value: 0 },
    uOccMode: { value: 0 },
    uRingAmp: { value: 0 },
    uRingR: { value: 0 },
    uRingAge: { value: 0 },
    /** x rings per radian, y line half-width (fract units), z lines/s outward, w wobble. */
    uRingStyle: { value: new THREE.Vector4(45, 0.03, 5, 1) },
    uRingLight: { value: new THREE.Color('#ffb0a0') },
    uRingDark: { value: 0.1 },
    /** Meteor impact glow on the horizon: xyz direction, w intensity. */
    uHorizonGlow: { value: new THREE.Vector4(0, 0, -1, 0) },
    uGlowColor: { value: new THREE.Color('#fb6e17') },
    /** Cloud-seam cracks: xy origin (world xz), z front radius (m), w intensity. */
    uCrack: { value: new THREE.Vector4(0, -500, 0, 0) },
    uCrackBlack: { value: 0 },
    uCrackCol: { value: new THREE.Color('#ff1a2a') },
    /** Deck shock ring: xy centre (world xz), z radius (m), w strength. */
    uDeck: { value: new THREE.Vector4(PILLAR.x, PILLAR.y, 0, 0) },
    uDeckCol: { value: new THREE.Color('#ff7048') },
    uHole: { value: 400 },
    uCloudBase: { value: CLOUD_BASE },
  };
}

export const FX_GLSL = /* glsl */ `
uniform vec4 uFlash;
uniform vec3 uFlashColor;
uniform vec3 uSrcDir;
uniform float uBlackSun;
uniform float uBlackR;
uniform vec3 uCoronaCol;
uniform float uBurst;
uniform float uSrcGlow;
uniform float uOccMode;
uniform float uRingAmp;
uniform float uRingR;
uniform float uRingAge;
uniform vec4 uRingStyle;
uniform vec3 uRingLight;
uniform float uRingDark;
uniform vec4 uHorizonGlow;
uniform vec3 uGlowColor;
uniform vec4 uCrack;
uniform float uCrackBlack;
uniform vec3 uCrackCol;
uniform vec4 uDeck;
uniform vec3 uDeckCol;
uniform float uHole;
uniform float uCloudBase;

// Light a surface by the current flash (bolt, impact, discharge).
vec3 flashLight(vec3 n, vec3 worldPos) {
  if (uFlash.w <= 0.0) return vec3(0.0);
  vec3 toFlash = normalize(uFlash.xyz);
  return uFlashColor * uFlash.w * (0.25 + 0.75 * max(dot(n, toFlash), 0.0));
}
`;

// ── sky layer (inner dome) ──────────────────────────────────────────────

export function createSkyLayer(env: EnvUniforms, fx: Fx): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env, ...fx },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // on the far plane: only sky pixels pass
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${FX_GLSL}
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 S = normalize(uSrcDir);
        float above = smoothstep(-0.01, 0.03, d.y);

        // Angle around S (for spokes, corona flicker, ring wobble).
        vec3 t1 = normalize(cross(S, vec3(0.0, 1.0, 0.0)));
        vec3 t2 = cross(t1, S);
        float ang = atan(dot(d, t2), dot(d, t1));
        float th = acos(clamp(dot(d, S), -1.0, 1.0));

        if (uOcclusion > 0.5) {
          // God-ray buffer: only the light source is bright.
          vec3 L = normalize(uSunDir);
          float mu = dot(d, L);
          vec3 c;
          if (uOccMode < 0.5) {
            c = uSunColor * (smoothstep(0.9975, 0.9992, mu) * 1.4 + pow(max(mu, 0.0), 160.0) * 0.7);
          } else {
            // Black sun: an annulus (corona) around a black core.
            float a = acos(clamp(mu, -1.0, 1.0));
            float fl = 0.012 * fbm3(vec2(cos(ang), sin(ang)) * 3.0 + uTime * 0.3);
            float ring = smoothstep(uBlackR * 0.98, uBlackR * 1.04, a) * (1.0 - smoothstep(uBlackR * 1.15, uBlackR * 2.2 + fl, a));
            c = uSunColor * ring * 2.0 + uSunColor * pow(max(mu, 0.0), 90.0) * 0.18 * step(uBlackR, a);
          }
          gl_FragColor = vec4(c * above, 1.0);
          return;
        }

        vec3 add = vec3(0.0);
        float dark = 0.0;

        // Black sun: an ink-black disc with a flickering crimson corona.
        if (uBlackSun > 0.0) {
          float core = 1.0 - smoothstep(uBlackR * 0.985, uBlackR, th);
          float fl = fbm3(vec2(cos(ang), sin(ang)) * 2.5 + vec2(uTime * 0.25, 0.0));
          float corona = exp(-max(th - uBlackR, 0.0) / (uBlackR * (0.22 + 0.5 * fl))) * (1.0 - core);
          float rim = exp(-abs(th - uBlackR) / (uBlackR * 0.025));
          add += (uCoronaCol * corona * 1.6 + mix(uCoronaCol, vec3(1.0, 0.85, 0.8), 0.5) * rim * 2.2) * uBlackSun;
          dark = max(dark, core * uBlackSun);
        }

        // Analytic sunburst: spokes around S (seamless noise on a circle).
        if (uBurst > 0.0) {
          float a2 = ang + uTime * 0.045;
          float n = vnoise(vec2(cos(a2), sin(a2)) * 15.0 + 3.0);
          float n2 = vnoise(vec2(cos(a2), sin(a2)) * 41.0 + 9.0);
          float spokes = pow(n, 5.0) * 2.4 + pow(n2, 8.0) * 1.2;
          float fall = exp(-th * 2.2) * smoothstep(uBlackR, uBlackR * 1.6, th);
          add += mix(uSunColor, uCoronaCol, 0.4) * spokes * fall * uBurst * above;
          // Dark spokes between the light ones (the painted "flash pose").
          dark = max(dark, (1.0 - smoothstep(0.25, 0.45, n)) * fall * 0.25 * uBurst * above);
        }

        // Soft glow of a hidden source (cone-card mode).
        add += uSunColor * pow(max(dot(d, S), 0.0), 30.0) * uSrcGlow * 0.5 * above;

        // Concentric shock rings: hairlines on the sky, light + dark pairs.
        if (uRingAmp > 0.0) {
          float t = th + uRingStyle.w * (0.003 * sin(ang * 7.0 + uTime) + 0.004 * (vnoise(vec2(ang * 4.0, th * 20.0)) - 0.5));
          float x = t * uRingStyle.x - uRingAge * uRingStyle.z;
          float w = fwidth(x);
          float lineL = 1.0 - smoothstep(uRingStyle.y, uRingStyle.y + w * 1.5, abs(fract(x) - 0.5));
          float lineD = 1.0 - smoothstep(uRingStyle.y, uRingStyle.y + w * 1.5, abs(fract(x + 0.2) - 0.5));
          float front = smoothstep(uRingR + 0.03, uRingR, t);
          float tail = smoothstep(uRingR - 1.1, uRingR - 0.2, t);
          float env = front * (0.3 + 0.7 * tail) * uRingAmp * above * smoothstep(0.0, 0.06, t);
          add += uRingLight * lineL * env;
          // A brighter leading edge on the front.
          add += uRingLight * exp(-abs(t - uRingR) * 60.0) * uRingAmp * above * 0.6;
          dark = max(dark, lineD * env * uRingDark);
        }

        // Sky flash: bright near the strike, a lift over the whole sky, and
        // stronger in the cloud bellies (a cloudy mask).
        if (uFlash.w > 0.0) {
          vec3 F = normalize(uFlash.xyz);
          float m = max(dot(d, F), 0.0);
          // Mostly local to the strike: the whole-sky lift stays small so the
          // bolt still reads against its own flash.
          float g = 0.05 + 0.75 * pow(m, 12.0) + 0.22 * pow(m, 3.0);
          g *= 0.6 + 0.4 * smoothstep(0.35, 0.65, fbm3(d.xz / (max(d.y, 0.0) + 0.15) * 3.0));
          add += uFlashColor * g * uFlash.w * above;
        }

        // Meteor impact: a glow bump on the horizon.
        if (uHorizonGlow.w > 0.0) {
          vec2 hz = normalize(uHorizonGlow.xz);
          float az = max(dot(normalize(d.xz + 1e-5), hz), 0.0);
          add += uGlowColor * exp(-max(d.y, 0.0) * 18.0) * pow(az, 60.0) * uHorizonGlow.w * above;
        }

        gl_FragColor = vec4(add, dark);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    // Premultiplied: rgb ADDS light, alpha DARKENS what is behind.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 64, 32), material);
  mesh.name = 'sky-layer';
  mesh.frustumCulled = false;
  mesh.renderOrder = -9;
  mesh.onBeforeRender = (_r, _s, camera) => mesh.position.copy(camera.position);
  mesh.layers.enable(OCCLUDERS);
  return mesh;
}

// ── silhouettes (pillar + ribs) ─────────────────────────────────────────

function silhouetteMaterial(env: EnvUniforms, fx: Fx, body: string, rimAmt: number) {
  return new THREE.ShaderMaterial({
    uniforms: { ...env, ...fx, uBody: { value: new THREE.Color(body) }, uRimAmt: { value: rimAmt } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${FX_GLSL}
      uniform vec3 uBody;
      uniform float uRimAmt;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = normalize(uSunDir);
        // Two flat tones: a dark body, a slightly lighter top-facing tone.
        float top = step(0.35, N.y);
        vec3 c = uBody * mix(0.75, 1.15, top) + uAmbient * 0.05;
        // Backlit rim: thin and hard where the form turns away from us.
        float facing = max(dot(N, V), 0.0);
        float back = max(dot(-V, L), 0.0);
        float rim = smoothstep(0.62, 0.8, 1.0 - facing) * (0.25 + 0.75 * pow(back, 2.0));
        c += uSunColor * rim * uRimAmt;
        c += flashLight(N, vWorld) * 0.35;
        // The foot sinks into a haze pool: hidden base.
        float foot = 1.0 - smoothstep(-5.0, 70.0, vWorld.y);
        c = mix(c, mix(uHaze, uHorizon, 0.4), foot * 0.85);
        c = airFade(c, vWorld, 0.00055);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

export function createPillar(env: EnvUniforms, fx: Fx): THREE.Mesh {
  // A lathe profile: wide flared foot, slim shaft, a faint taper upward.
  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= 40; i++) {
    const y = (i / 40) ** 1.8 * 1500 - 10;
    const r = 15 + 34 * Math.exp(-(y + 10) / 45) - 3 * (y / 1500);
    points.push(new THREE.Vector2(r, y));
  }
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(points, 40), silhouetteMaterial(env, fx, '#1e0709', 1.4));
  mesh.position.set(PILLAR.x, 0, PILLAR.y);
  mesh.name = 'pillar';
  mesh.layers.enable(OCCLUDERS);
  return mesh;
}

/** Ribs: arches across a spine that runs left-right, in front of the low sun. */
export function createRibs(env: EnvUniforms, fx: Fx, sunDir: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ribs';
  const material = silhouetteMaterial(env, fx, '#2a0c0c', 1.1);
  const dir = sunDir.clone().setY(0).normalize();
  const centre = new THREE.Vector3(0, 0, 60).addScaledVector(dir, 380);
  const count = 10;
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1) - 0.5;
    const height = 85 * (1 - u * u * 1.6);
    const half = 34 * (1 - u * u);
    const x = centre.x + u * 190;
    const lean = -0.25 + u * 0.3;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 16; k++) {
      const a = (k / 16) * Math.PI;
      // A pointed (gothic) arch: the nave look; tips buried below the sand.
      const s = Math.sin(a);
      pts.push(new THREE.Vector3(x + lean * s * 25, -14 + (height + 14) * Math.pow(s, 0.8), centre.z + Math.cos(a) * half));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 48, 2.6 * (1 - Math.abs(u) * 0.5), 6, false);
    const mesh = new THREE.Mesh(tube, material);
    mesh.layers.enable(OCCLUDERS);
    group.add(mesh);
  }
  // The spine along the top line, half sunk.
  const spine = new THREE.Mesh(
    new THREE.CylinderGeometry(3.4, 3.4, 230, 8).rotateZ(Math.PI / 2),
    material,
  );
  spine.position.set(centre.x, 2, centre.z - 30);
  spine.layers.enable(OCCLUDERS);
  group.add(spine);
  return group;
}

// ── cloud ceiling ───────────────────────────────────────────────────────

export function createCloudCeiling(env: EnvUniforms, fx: Fx): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(9000, 9000, 1, 1).rotateX(Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env, ...fx },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${FX_GLSL}
      varying vec3 vWorld;
      // Value noise with LINEAR interpolation: its ridges come out as
      // straight-ish segments with kinks, the jagged read of a crack.
      float lnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float ridge(vec2 p) { return 1.0 - abs(2.0 * lnoise(p) - 1.0); }
      void main() {
        vec2 xz = vWorld.xz;
        float dist = length(vWorld - cameraPosition);
        // Fade the far ceiling so the horizon band stays open sky.
        float far = 1.0 - smoothstep(1300.0, 2600.0, dist);
        if (far <= 0.0) discard;

        // Deck shock ring: push the cloud texture outward, clear inside the
        // front, pile up a wall at the front.
        vec2 fromC = xz - uDeck.xy;
        float rc = length(fromC);
        float dr = (rc - uDeck.z) / 90.0; // a square, not pow(): pow(<0) is NaN
        float bump = exp(-dr * dr) * uDeck.w;
        vec2 p = xz * 0.0021 + uTime * vec2(0.0045, 0.0016);
        p -= normalize(fromC + 1e-3) * bump * 0.12;

        vec2 warp = vec2(fbm3(p * 0.7 + 3.1), fbm3(p * 0.7 + 8.7)) - 0.5;
        float n = fbm(p + warp * 1.1);
        // The eye around the pillar: a ragged clear hole.
        vec2 fromP = xz - vec2(${PILLAR.x.toFixed(1)}, ${PILLAR.y.toFixed(1)});
        float rp = length(fromP);
        n -= (1.0 - smoothstep(uHole * 0.55, uHole * 1.15, rp + (n - 0.5) * 160.0)) * 0.45;
        // Deck ring: a clear trough just behind the front (the cloud sea
        // refills further back), and a piled-up wall at the front.
        float trough = (1.0 - smoothstep(uDeck.z - 200.0, uDeck.z - 40.0, rc)) * smoothstep(uDeck.z - 620.0, uDeck.z - 280.0, rc);
        n -= uDeck.w * trough * 0.42;
        n += bump * 0.3;

        float cover = 0.5;
        float dens = smoothstep(cover, cover + 0.11, n) * far;
        if (dens < 0.003) discard;
        if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, dens); return; }

        vec3 V = normalize(vWorld - cameraPosition);
        float thick = smoothstep(cover + 0.04, cover + 0.3, n);
        // Bellies: oxblood-charcoal; the black-cloud event pushes them to ink.
        vec3 belly = mix(srgb(vec3(0.075, 0.02, 0.03)), uHaze * 0.55, 0.45);
        belly = mix(belly, srgb(vec3(0.03, 0.006, 0.01)), uCrackBlack);
        vec3 c = mix(uHaze * 0.9, belly, thick);
        // Thin edges glow toward the light (silver lining in crimson).
        float toSun = pow(max(dot(V, normalize(uSunDir)), 0.0), 5.0);
        float toSrc = pow(max(dot(V, normalize(uSrcDir)), 0.0), 8.0);
        c += uSunColor * (1.0 - thick) * (toSun * 0.9 + toSrc * 0.6 * (uBlackSun + uSrcGlow)) * (1.0 - uCrackBlack * 0.7);
        // Flash lights the bellies from below.
        c += uFlashColor * uFlash.w * (0.05 + 0.5 * pow(max(dot(V, normalize(uFlash.xyz)), 0.0), 8.0)) * (0.5 + 0.5 * thick);

        // Deck wall: lit rim on the front.
        c += uDeckCol * bump * (0.5 + 0.9 * (1.0 - thick)) * 0.9;

        // Cloud-seam cracks: ridged lines in the edge band, crawling out.
        if (uCrack.w > 0.0) {
          float band = smoothstep(cover, cover + 0.03, n) * (1.0 - smoothstep(cover + 0.12, cover + 0.3, n));
          vec2 q = xz * 0.011 + warp * 1.5;
          // A finer kink: the cracks zig-zag instead of flowing like worms.
          q += (vec2(lnoise(q * 4.0), lnoise(q * 4.0 + 7.3)) - 0.5) * 0.22;
          float r1 = pow(ridge(q), 22.0);
          float r2 = pow(ridge(q * 2.3 + 5.0), 26.0);
          float crack = max(r1, r2 * 0.8);
          float dO = length(xz - uCrack.xy);
          float reveal = smoothstep(uCrack.z, uCrack.z - 70.0, dO);
          float cell = hash12(floor(q * 3.0));
          float pulse = 0.55 + 0.45 * step(0.45, fract(floor(uTime * 12.0) / 12.0 * 3.0 + cell));
          float k = crack * band * reveal * pulse * uCrack.w;
          c += mix(uCrackCol * 3.0, srgb(vec3(1.0, 0.85, 0.85)) * 4.0, smoothstep(0.6, 1.0, crack)) * k;
          // Faint glow in the belly around active seams.
          c += uCrackCol * band * reveal * uCrack.w * 0.12;
        }

        c = mix(c, mix(uHaze, uHorizon, 0.5), smoothstep(700.0, 2400.0, dist) * 0.75);
        gl_FragColor = vec4(c, dens * 0.97);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(PILLAR.x, CLOUD_BASE, PILLAR.y);
  mesh.name = 'cloud-ceiling';
  mesh.renderOrder = -5;
  mesh.frustumCulled = false;
  mesh.layers.enable(OCCLUDERS);
  return mesh;
}

/** The deck ring's billowing wall: an open cylinder, eroded by noise as it ages. */
export function createDeckWall(env: EnvUniforms, fx: Fx): { mesh: THREE.Mesh; uAge: { value: number } } {
  const uAge = { value: 0 };
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 160, 1, true);
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env, ...fx, uAge },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec3 p = position;
        // Lean outward at the top: a wave front, not a wall.
        p.xz *= 1.0 + uv.y * 0.06;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      ${FX_GLSL}
      uniform float uAge;
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        // Billows: lumpy around the ring, rolling upward over time.
        float n = fbm3(vec2(vUv.x * 140.0, vUv.y * 3.5 - uTime * 0.35) + fbm3(vec2(vUv.x * 60.0, uTime * 0.1)) * 0.8);
        // Billow profile: thick in the middle of the band, frayed top and bottom.
        float profile = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
        // Alpha erosion: the threshold climbs with age, the wall frays apart.
        float thr = mix(-0.1, 1.05, clamp(uAge, 0.0, 1.0));
        float a = smoothstep(thr - 0.08, thr + 0.08, n * profile + profile * 0.35) * profile;
        a *= uDeck.w;
        float dist = length(vWorld - cameraPosition);
        a *= 1.0 - smoothstep(1500.0, 2800.0, dist);
        if (a < 0.004) discard;
        // Dark oxblood body, a hot rim only along the crest.
        vec3 c = mix(srgb(vec3(0.16, 0.03, 0.04)), uDeckCol * 1.3, smoothstep(0.55, 0.95, vUv.y) * smoothstep(0.45, 0.8, n));
        c = mix(c, mix(uHaze, uHorizon, 0.5), smoothstep(700.0, 2600.0, dist) * 0.6);
        gl_FragColor = vec4(c, a * 0.85);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'deck-wall';
  mesh.renderOrder = -4;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return { mesh, uAge };
}

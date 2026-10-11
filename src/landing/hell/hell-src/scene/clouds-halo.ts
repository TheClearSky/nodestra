// COPIED from .claude/pages/ad/experiments/hell-src/scene/clouds-halo.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Clouds class: the Eva ribbon halo around the pillar (COPIED from
 * hell-05-clouds-fields createRibbons, rings + sky ripples), re-laid for the
 * shared scene: the rings hug the visible upper pillar, the whole halo is
 * placed at the pillar, and its opacity is a uniform so it never blots out
 * the magic circle behind it.
 *
 * Eva paints the halo as thin flat ribbons seen from below: a scalloped crisp
 * outer rim, a soft inner edge, streaks along the flow. Each ring is slightly
 * eccentric and tilted and turns at its own speed; faint concentric pressure
 * rings are painted on discs under them (Eva C0812B).
 */

import * as THREE from 'three';
import { ENV_GLSL, type EnvUniforms } from '../../env-src/lab';
import { CLOUD_GLSL, type CloudUniforms } from '../hell-05-clouds-glsl';

/**
 * The shared cloud GLSL lights lightning flashes in a fixed pink; this
 * scene's COPY of the text reads the flash colour from a uniform instead (the
 * palette's events light). clouds.ts applies the same patch to the puff layers.
 */
export const FLASH_PATCH: [string, string] = ['return vec3(1.0, 0.42, 0.5) * uFlash', 'return uFlashCol * uFlash'];
const CLOUD_PATCHED = CLOUD_GLSL.includes(FLASH_PATCH[0]) ? CLOUD_GLSL.replace(FLASH_PATCH[0], FLASH_PATCH[1]) : CLOUD_GLSL;
const HEAD = `${ENV_GLSL}\nuniform vec3 uFlashCol;\n${CLOUD_PATCHED}\n`;

export type HaloRing = { y: number; radius: number; ex: number; ez: number; tilt: number; speed: number };

/** hell-05's funnel (widest on top) scaled ~0.9 and lowered so the top ring stays in frame. */
export const HALO_RINGS: HaloRing[] = [
  { y: 232, radius: 110, ex: 7, ez: -4, tilt: 0.04, speed: 1.0 },
  { y: 213, radius: 90, ex: -5, ez: 4, tilt: -0.05, speed: 1.12 },
  { y: 195, radius: 72, ex: 4, ez: 5, tilt: 0.06, speed: 0.92 },
  { y: 179, radius: 56, ex: -3, ez: -4, tilt: -0.04, speed: 1.25 },
  { y: 143, radius: 40, ex: 2, ez: 2, tilt: 0.03, speed: 0.85 },
];

/** Ripple discs: [height, radius, rings]. */
const RIPPLES: [number, number, number][] = [
  [162, 300, 7],
  [134, 130, 5],
];

type RibbonPoint = { theta: number; radius: number; y: number; width: number };

/** A flat strip along a curve; aRib = (angle along, 0 inner → 1 outer). Front faces up. */
function ribbonGeometry(points: RibbonPoint[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const rib: number[] = [];
  const index: number[] = [];
  for (const p of points) {
    const c = Math.cos(p.theta);
    const s = Math.sin(p.theta);
    const ri = p.radius - p.width * 0.35;
    const ro = p.radius + p.width * 0.65;
    pos.push(c * ri, p.y, s * ri, c * ro, p.y, s * ro);
    rib.push(p.theta, 0, p.theta, 1);
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2;
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRib', new THREE.Float32BufferAttribute(rib, 2));
  g.setIndex(index);
  return g;
}

export function createHalo(env: EnvUniforms, cu: CloudUniforms, at: THREE.Vector3, flashCol: { value: THREE.Color }) {
  const group = new THREE.Group();
  group.name = 'clouds-halo';
  group.position.copy(at);
  const uAlpha = { value: 0.9 };

  const ribbonMaterial = (lobes: number, seed: number) =>
    new THREE.ShaderMaterial({
      uniforms: { ...env, ...cu, uCel: { value: 0 }, uLobes: { value: lobes }, uSeed: { value: seed }, uAlpha, uFlashCol: flashCol },
      vertexShader: /* glsl */ `
        attribute vec2 aRib;
        varying vec2 vRib;
        varying vec3 vWorld;
        void main() {
          vRib = aRib;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        ${HEAD}
        uniform float uLobes;
        uniform float uSeed;
        uniform float uAlpha;
        varying vec2 vRib;
        varying vec3 vWorld;
        void main() {
          float th = vRib.x;
          float s = vRib.y;
          vec2 cs = vec2(cos(th), sin(th));
          float wisp = fbm3(cs * 3.0 + vec2(s * 2.2 + uSeed, th * 0.15));
          float bumps = abs(sin(th * uLobes * 0.5 + uSeed));
          float outer = 0.66 + 0.28 * bumps + (wisp - 0.5) * 0.1;
          float fw = fwidth(s) * 1.5 + 0.01;
          float a = smoothstep(outer + fw, outer - fw, s) * smoothstep(0.0, 0.45, s);
          // Streaks along the flow.
          float streak = vnoise(cs * 26.0 + vec2(s * 9.0, uSeed));
          a *= mix(0.55, 1.0, wisp) * mix(0.75, 1.0, streak);
          if (a < 0.01) discard;
          vec3 n = gl_FrontFacing ? vec3(0.0, 1.0, 0.0) : vec3(0.0, -1.0, 0.0);
          float rimT = smoothstep(0.35, 1.0, s / outer);
          float lit = gl_FrontFacing ? 0.55 + 0.45 * rimT : 0.12 + 0.62 * rimT;
          vec3 c = cloudColour(vWorld, n, lit, 0.0, rimT * 0.8);
          c = cloudFog(c, vWorld);
          gl_FragColor = vec4(c, a * uAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

  // Rings, each in a holder that turns about the pillar axis.
  const holders: THREE.Group[] = [];
  HALO_RINGS.forEach((ring, k) => {
    const points: RibbonPoint[] = [];
    for (let i = 0; i <= 160; i++) {
      const theta = (i / 160) * Math.PI * 2;
      points.push({ theta, radius: ring.radius, y: 0, width: ring.radius * 0.36 });
    }
    const mesh = new THREE.Mesh(ribbonGeometry(points), ribbonMaterial(16 + k * 4, k * 1.7));
    mesh.position.set(ring.ex, 0, ring.ez);
    mesh.rotation.x = ring.tilt;
    mesh.renderOrder = 3;
    const holder = new THREE.Group();
    holder.position.y = ring.y;
    holder.userData.speed = ring.speed;
    holder.add(mesh);
    holders.push(holder);
    group.add(holder);
  });

  // Ripples: faint concentric rings painted on discs under the rings.
  const rippleMaterial = (radius: number, freq: number) =>
    new THREE.ShaderMaterial({
      uniforms: { ...env, ...cu, uCel: { value: 0 }, uFreq: { value: freq }, uRadius: { value: radius }, uAlpha, uFlashCol: flashCol },
      vertexShader: /* glsl */ `
        varying vec2 vQ;
        varying vec3 vWorld;
        void main() {
          vQ = position.xy;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        ${HEAD}
        uniform float uFreq;
        uniform float uRadius;
        uniform float uAlpha;
        varying vec2 vQ;
        varying vec3 vWorld;
        void main() {
          float r = length(vQ) / uRadius;
          float ring = pow(0.5 + 0.5 * cos(r * uFreq * 6.2832 - uCT * 0.35), 10.0);
          float a = ring * smoothstep(1.0, 0.6, r) * smoothstep(0.12, 0.3, r) * 0.32 * uAlpha;
          if (a < 0.004) discard;
          vec3 c = cloudColour(vWorld, vec3(0.0, -1.0, 0.0), 0.62, 0.0, 0.3);
          c = cloudFog(c, vWorld);
          gl_FragColor = vec4(c, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  for (const [y, radius, freq] of RIPPLES) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 96), rippleMaterial(radius, freq));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = y;
    disc.renderOrder = 2;
    group.add(disc);
  }

  return {
    group,
    uAlpha,
    /** ct = cloud time; one turn per `period` seconds, each ring at its own speed. */
    update(ct: number, period: number) {
      for (const h of holders) h.rotation.y = -(ct / period) * Math.PI * 2 * h.userData.speed;
    },
  };
}

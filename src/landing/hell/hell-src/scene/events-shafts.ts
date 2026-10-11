// COPIED from .claude/pages/ad/experiments/hell-src/scene/events-shafts.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * Events class, "shafts" option: steady light shafts pouring down from a
 * hidden source high behind the pillar, fanning toward the camera.
 *
 * The card technique (additive axial billboards: each quad turns about its
 * own long axis to face the camera, soft edges, panning-noise strands) is
 * COPIED from hell-11-sky-events-rays.ts `createShaftCards`; only the
 * placement is new, laid out for the shared LAYOUT. Cards are depth-tested,
 * so the pillar, bones and islands cut the shafts that pass behind them.
 */

import * as THREE from 'three';
import { ENV_GLSL, seededRandom, type EnvUniforms } from '../../env-src/lab';
import type { LAYOUT } from './contract';

type Card = { start: THREE.Vector3; axis: THREE.Vector3; len: number; width: number; flare: number };

/** `eventCol`: the palette's glow.events (the shafts' light), kept up to date by the caller. */
export function createShafts(env: EnvUniforms, layout: typeof LAYOUT, eventCol: { value: THREE.Color }) {
  const rnd = seededRandom(23);
  const cards: Card[] = [];
  const { pillar, groundY } = layout;

  // The hidden source: far behind and well above the frame top. Every shaft
  // points away from it, so on screen they radiate from above the pillar.
  const source = new THREE.Vector3(pillar.x, 1500, pillar.z - 1500);
  const xs = [-330, -230, -150, -78, 70, 140, 215, 300, 380];
  for (const x0 of xs) {
    const x = x0 + (rnd() - 0.5) * 30;
    const start = new THREE.Vector3(x, 400 + rnd() * 60, pillar.z - 180 - rnd() * 260);
    const axis = start.clone().sub(source).normalize();
    // Long enough to reach the ground (axis.y < 0), a little past it.
    const len = ((start.y - groundY) / -axis.y) * (0.9 + rnd() * 0.25);
    cards.push({ start, axis, len, width: 12 + rnd() * 14, flare: 2.2 + rnd() * 1.6 });
  }

  const geometry = new THREE.InstancedBufferGeometry();
  // Quad: x across −0.5…0.5, y along 0…1.
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const aStart = new Float32Array(cards.length * 4);
  const aAxis = new Float32Array(cards.length * 4);
  const aShape = new Float32Array(cards.length * 4);
  cards.forEach((c, i) => {
    aStart.set([c.start.x, c.start.y, c.start.z, 0], i * 4);
    aAxis.set([c.axis.x, c.axis.y, c.axis.z, c.len], i * 4);
    aShape.set([c.width, c.flare, rnd() * 10, 0], i * 4);
  });
  geometry.setAttribute('aStart', new THREE.InstancedBufferAttribute(aStart, 4));
  geometry.setAttribute('aAxis', new THREE.InstancedBufferAttribute(aAxis, 4));
  geometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(aShape, 4));
  geometry.instanceCount = cards.length;

  const uIntensity = { value: 1 };
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env, uEventCol: eventCol, uIntensity },
    vertexShader: /* glsl */ `
      attribute vec4 aStart;
      attribute vec4 aAxis;
      attribute vec4 aShape;
      varying vec2 vUv;
      varying float vDist;
      varying float vPhase;
      void main() {
        vec3 axis = normalize(aAxis.xyz);
        vec3 mid = aStart.xyz + axis * aAxis.w * 0.5;
        vec3 toCam = normalize(cameraPosition - mid);
        // Axial billboard: turn about the long axis to face the camera.
        vec3 side = normalize(cross(axis, toCam));
        float wid = aShape.x * mix(1.0, aShape.y, position.y);
        vec3 p = aStart.xyz + axis * position.y * aAxis.w + side * position.x * wid;
        vUv = vec2(position.x + 0.5, position.y);
        vDist = length(p - cameraPosition);
        vPhase = aShape.z;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      uniform vec3 uEventCol;
      uniform float uIntensity;
      varying vec2 vUv;
      varying float vDist;
      varying float vPhase;
      void main() {
        // Soft edges across, bright entry fading along the length.
        float across = 1.0 - pow(abs(vUv.x * 2.0 - 1.0), 1.5);
        // Clamped: MSAA can extrapolate varyings past 1, and pow(<0) is NaN.
        float along = smoothstep(0.0, 0.08, vUv.y) * pow(clamp(1.0 - vUv.y, 0.0, 1.0), 0.9);
        // Panning noise splits each shaft into strands.
        float strands = 0.5 + 0.5 * fbm3(vec2(vUv.x * 7.0 + vPhase, vUv.y * 1.4 - uTime * 0.03));
        // Each shaft breathes on its own slow cycle.
        float pulse = 0.65 + 0.35 * sin(uTime * 0.35 + vPhase * 6.0);
        float camFade = clamp((vDist - 40.0) / 140.0, 0.0, 1.0);
        // The palette's event light, a little of the sun in it: a pale light
        // that reads against the sky (hell-11's fixed gold-white was tuned for
        // the crimson grade).
        vec3 col = mix(uSunColor, uEventCol, 0.7);
        float k = across * along * strands * pulse * camFade * uIntensity * 0.7;
        gl_FragColor = vec4(col * k, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'events-shafts';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.visible = false;
  return { mesh, uIntensity, count: cards.length };
}

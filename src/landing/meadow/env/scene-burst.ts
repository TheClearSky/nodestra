// COPIED from .claude/pages/ad/experiments/env-src/scene-burst.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * Scene 2's key response: every key press releases a soft BURST from the
 * sakura crown — a handful of blossom petals that flutter down on the
 * breeze, and light motes that drift up and fade. CPU-simulated pools
 * (petals: instanced quads lit like foliage.ts's falling petals; motes:
 * scene-motes.ts quads). Pitch moves the burst across the crown: low keys
 * release from the left of the crown, high keys from the right.
 */

import * as THREE from 'three';
import { KIT_GLSL } from './v2kit';
import type { SceneEnv } from './scene-world';
import type { Clump } from './foliage';
import { createMoteCloud, type MoteCloud } from './scene-motes';

export type Burst = {
  group: THREE.Group;
  /** Release a burst; `pitch` 0…1 picks where in the crown along `right`
   *  (the camera's screen-right axis: low keys left, high keys right). */
  emit(pitch: number, right: THREE.Vector3, strength?: number, camera?: THREE.Camera): void;
  update(t: number, dt: number): void;
  dispose(): void;
};

export function createBurst(u: SceneEnv, clumps: Clump[], pixelRatio: number, scale = 1): Burst {
  const group = new THREE.Group();
  // Clumps sorted left → right along the camera's right axis (per burst).
  let sorted = clumps.slice();

  // ── petals ──
  const PETALS = 1200;
  const pPos = new Float32Array(PETALS * 3);
  const pRot = new Float32Array(PETALS * 4); // axis xyz, angle
  const pInfo = new Float32Array(PETALS * 2); // fade, tone
  const pVel = new Float32Array(PETALS * 3);
  const pSpin = new Float32Array(PETALS);
  const pLife = new Float32Array(PETALS);
  const pMax = new Float32Array(PETALS).fill(1);
  const pPhase = new Float32Array(PETALS);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const aPos = new THREE.InstancedBufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage);
  const aRot = new THREE.InstancedBufferAttribute(pRot, 4).setUsage(THREE.DynamicDrawUsage);
  const aInfo = new THREE.InstancedBufferAttribute(pInfo, 2).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPos', aPos);
  geo.setAttribute('aRot', aRot);
  geo.setAttribute('aInfo', aInfo);
  geo.instanceCount = PETALS;
  const petalMat = new THREE.ShaderMaterial({
    uniforms: { ...u, uColA: { value: new THREE.Color('#f6c6d6') }, uColB: { value: new THREE.Color('#fff2f5') }, uSize: { value: 0.05 } },
    vertexShader: /* glsl */ `
      ${KIT_GLSL}
      uniform float uSize;
      attribute vec3 aPos;
      attribute vec4 aRot;
      attribute vec2 aInfo;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec2 vInfo;
      mat3 rotAxis(vec3 a, float ang) {
        float c = cos(ang); float s = sin(ang); float t = 1.0 - c;
        return mat3(t*a.x*a.x + c, t*a.x*a.y + s*a.z, t*a.x*a.z - s*a.y,
                    t*a.x*a.y - s*a.z, t*a.y*a.y + c, t*a.y*a.z + s*a.x,
                    t*a.x*a.z + s*a.y, t*a.y*a.z - s*a.x, t*a.z*a.z + c);
      }
      void main() {
        vUv = position.xy;
        vInfo = aInfo;
        if (aInfo.x <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        mat3 R = rotAxis(normalize(aRot.xyz), aRot.w);
        vec3 corner = R * vec3(position.x, position.y * 0.72, 0.0) * uSize * mix(0.4, 1.0, aInfo.x);
        vN = R * vec3(0.0, 0.0, 1.0);
        vWorld = aPos + corner;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${KIT_GLSL}
      uniform vec3 uColA;
      uniform vec3 uColB;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec2 vInfo;
      void main() {
        vec2 q = vUv;
        float notch = smoothstep(0.25, 0.0, abs(q.y)) * smoothstep(0.55, 1.0, q.x) * 0.45;
        if (1.0 - length(q * vec2(0.85, 1.0)) - notch < 0.0 || vInfo.x < 0.01) discard;
        if (uOcclusion > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec3 base = mix(uColA, uColB, vInfo.y);
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        float ndl = abs(dot(n, uSunDir));
        vec3 V = normalize(vWorld - cameraPosition);
        float back = pow(max(dot(V, uSunDir), 0.0), 3.0);
        vec3 col = base * (uAmbient * 0.55 + uSunColor * (0.45 + 0.55 * ndl));
        col += base * uSunColor * back * 0.9;
        col = mistFade(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
  const petals = new THREE.Mesh(geo, petalMat);
  petals.frustumCulled = false;
  group.add(petals);

  // ── light motes (world-sized: readable from the wide shot and up close) ──
  const MOTES = 600;
  const motes: MoteCloud = createMoteCloud(MOTES, { color: new THREE.Color(4.0, 3.2, 2.4), pixelRatio, scale: 75, minPx: 3.0 });
  const mVel = new Float32Array(MOTES * 3);
  const mLife = new Float32Array(MOTES);
  const mMax = new Float32Array(MOTES).fill(1);
  const mBase = new Float32Array(MOTES);
  group.add(motes.mesh);

  let nextPetal = 0;
  let nextMote = 0;
  const p = new THREE.Vector3();
  const pick = (pitch: number) => {
    const n = sorted.length;
    const centre = THREE.MathUtils.clamp(Math.round(pitch * (n - 1) + (Math.random() - 0.5) * n * 0.25), 0, n - 1);
    return sorted[centre];
  };
  // A point on a clump's OUTER / LOWER surface (inside the crown it would
  // hide behind the blossom cards): out from the crown centre and down.
  const crownCentre = new THREE.Vector3();
  for (const c of clumps) crownCentre.add(c.centre);
  crownCentre.divideScalar(Math.max(1, clumps.length));
  const out = new THREE.Vector3();
  const surface = (c: Clump, into: THREE.Vector3, reach: number) => {
    out.copy(c.centre).sub(crownCentre).setY(0).normalize();
    into.randomDirection().addScaledVector(out, 0.9).add(new THREE.Vector3(0, -0.9, 0)).normalize();
    into.multiplyScalar(c.radius * reach).add(c.centre);
  };
  const ndc = new THREE.Vector3();
  const emit = (pitch: number, right: THREE.Vector3, strength = 1, camera?: THREE.Camera) => {
    // Only clumps the camera can see (in front, inside the frame with a
    // margin), so a burst always shows — from the wide shot and from under
    // the crown alike; then left → right for pitch.
    let pool = clumps;
    if (camera) {
      const seen = clumps.filter((c) => {
        ndc.copy(c.centre).project(camera);
        return ndc.z < 1 && Math.abs(ndc.x) < 0.85 && ndc.y > -0.9 && ndc.y < 0.95;
      });
      if (seen.length >= 4) pool = seen;
    }
    sorted = pool.slice().sort((a, b) => a.centre.dot(right) - b.centre.dot(right));
    const from = pick(pitch);
    for (let k = 0; k < Math.round(40 * strength * scale); k++) {
      const c = Math.random() < 0.7 ? from : pick(pitch);
      const i = nextPetal;
      nextPetal = (nextPetal + 1) % PETALS;
      // Shaken loose BELOW the clump (inside or above it the blossom cards
      // hide them, notably from under the crown).
      surface(c, p, 1.0 + Math.random() * 0.25);
      p.y -= 0.3 + Math.random() * 1.0;
      pPos.set([p.x, p.y, p.z], i * 3);
      // Flung out past the crown's edge (into open air, where they read).
      out.copy(p).sub(crownCentre).setY(0).normalize().multiplyScalar(0.6 + Math.random() * 0.9);
      pVel.set([out.x + (Math.random() - 0.5) * 0.5, -0.15 - Math.random() * 0.45, out.z + (Math.random() - 0.5) * 0.5], i * 3);
      pRot.set([Math.random() - 0.5, 0.6, Math.random() - 0.5, Math.random() * 6.28], i * 4);
      pSpin[i] = 2 + Math.random() * 3;
      pMax[i] = pLife[i] = 5 + Math.random() * 3;
      pPhase[i] = Math.random() * 6.28;
      pInfo[i * 2 + 1] = Math.random();
    }
    for (let k = 0; k < Math.round(36 * strength * scale); k++) {
      const c = Math.random() < 0.6 ? from : pick(pitch);
      const i = nextMote;
      nextMote = (nextMote + 1) % MOTES;
      // Released in the open air just under the crown, drifting up and out.
      surface(c, p, 1.05 + Math.random() * 0.5);
      p.y -= 0.6 + Math.random() * 1.6;
      motes.position.set([p.x, p.y, p.z], i * 3);
      out.copy(p).sub(crownCentre).setY(0).normalize().multiplyScalar(0.3 + Math.random() * 0.5);
      mVel.set([out.x + (Math.random() - 0.5) * 0.35, 0.15 + Math.random() * 0.35, out.z + (Math.random() - 0.5) * 0.35], i * 3);
      mMax[i] = mLife[i] = 2.2 + Math.random() * 2.2;
      mBase[i] = 0.8 + Math.random() * 1.1;
    }
  };

  const wind = new THREE.Vector2();
  return {
    group,
    emit,
    update(t, dt) {
      wind.copy(u.uWindDir.value).multiplyScalar(0.5 + 0.9 * u.uBreeze.value);
      for (let i = 0; i < PETALS; i++) {
        if (pLife[i] <= 0) {
          pInfo[i * 2] = 0;
          continue;
        }
        pLife[i] -= dt;
        const k = i * 3;
        // Falls at ~0.45 m/s, carried downwind, swinging like a pendulum.
        pVel[k + 1] += (-0.45 - pVel[k + 1]) * Math.min(1, dt * 1.2);
        pVel[k] += (wind.x - pVel[k]) * Math.min(1, dt * 0.5);
        pVel[k + 2] += (wind.y - pVel[k + 2]) * Math.min(1, dt * 0.5);
        const sway = Math.sin(t * 2.1 + pPhase[i]);
        pPos[k] += (pVel[k] + sway * 0.45) * dt;
        pPos[k + 1] += pVel[k + 1] * dt;
        pPos[k + 2] += (pVel[k + 2] + Math.cos(t * 1.7 + pPhase[i]) * 0.3) * dt;
        pRot[i * 4 + 3] += pSpin[i] * dt;
        const age = 1 - pLife[i] / pMax[i];
        pInfo[i * 2] = Math.min(1, age * 8) * Math.min(1, pLife[i] / 0.8);
      }
      aPos.needsUpdate = true;
      aRot.needsUpdate = true;
      aInfo.needsUpdate = true;
      for (let i = 0; i < MOTES; i++) {
        if (mLife[i] <= 0) {
          motes.alpha[i] = 0;
          continue;
        }
        mLife[i] -= dt;
        const k = i * 3;
        motes.position[k] += (mVel[k] + Math.sin(t * 1.3 + i) * 0.08) * dt;
        motes.position[k + 1] += mVel[k + 1] * dt;
        motes.position[k + 2] += (mVel[k + 2] + Math.cos(t * 1.1 + i) * 0.08) * dt;
        mVel[k + 1] *= 0.995;
        const age = 1 - mLife[i] / mMax[i];
        motes.alpha[i] = Math.sin(Math.PI * Math.min(1, age * 1.3)) * (0.65 + 0.35 * Math.sin(t * 7 + i));
        motes.size[i] = mBase[i];
      }
      motes.commit();
    },
    dispose() {
      geo.dispose();
      petalMat.dispose();
      motes.dispose();
    },
  };
}

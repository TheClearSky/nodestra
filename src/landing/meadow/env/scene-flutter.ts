// COPIED from .claude/pages/ad/experiments/env-src/scene-flutter.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/**
 * Fluttering leaves (or petals) as a CPU-simulated pool of instanced quads,
 * shaded like foliage.ts's falling leaves (pointed oval, lit + backlit).
 * Used for the guitar moves' swirl: emit() with a start point and velocity;
 * each leaf drags toward the breeze, falls slowly and tumbles.
 */

import * as THREE from 'three';
import { KIT_GLSL } from './v2kit';
import type { SceneEnv } from './scene-world';

export type Flutter = {
  mesh: THREE.Mesh;
  emit(at: THREE.Vector3, vel: THREE.Vector3, life?: number): void;
  update(t: number, dt: number): void;
  dispose(): void;
};

export function createFlutter(u: SceneEnv, o: { count: number; colorA: string; colorB: string; size: number; petal?: boolean; groundAt?: (x: number, z: number) => number }): Flutter {
  const N = o.count;
  const pos = new Float32Array(N * 3);
  const rot = new Float32Array(N * 4);
  const info = new Float32Array(N * 2);
  const vel = new Float32Array(N * 3);
  const spin = new Float32Array(N);
  const life = new Float32Array(N);
  const max = new Float32Array(N).fill(1);
  const phase = new Float32Array(N);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const aPos = new THREE.InstancedBufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aRot = new THREE.InstancedBufferAttribute(rot, 4).setUsage(THREE.DynamicDrawUsage);
  const aInfo = new THREE.InstancedBufferAttribute(info, 2).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPos', aPos);
  geo.setAttribute('aRot', aRot);
  geo.setAttribute('aInfo', aInfo);
  geo.instanceCount = N;
  const material = new THREE.ShaderMaterial({
    uniforms: { ...u, uColA: { value: new THREE.Color(o.colorA) }, uColB: { value: new THREE.Color(o.colorB) }, uSize: { value: o.size }, uPetal: { value: o.petal ? 1 : 0 } },
    vertexShader: /* glsl */ `
      ${KIT_GLSL}
      uniform float uSize;
      uniform float uPetal;
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
        vec3 corner = R * vec3(position.x, position.y * mix(0.55, 0.72, uPetal), 0.0) * uSize * mix(0.5, 1.0, aInfo.x);
        vN = R * vec3(0.0, 0.0, 1.0);
        vWorld = aPos + corner;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${KIT_GLSL}
      uniform vec3 uColA;
      uniform vec3 uColB;
      uniform float uPetal;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec2 vInfo;
      void main() {
        vec2 q = vUv;
        float inside;
        if (uPetal < 0.5) inside = (1.0 - q.x * q.x) * 0.95 - abs(q.y);
        else inside = 1.0 - length(q * vec2(0.85, 1.0)) - smoothstep(0.25, 0.0, abs(q.y)) * smoothstep(0.55, 1.0, q.x) * 0.45;
        if (inside < 0.0 || vInfo.x < 0.01) discard;
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
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  let next = 0;
  const wind = new THREE.Vector2();
  return {
    mesh,
    emit(at, v, lifeS = 2.5 + Math.random() * 1.5) {
      const i = next;
      next = (next + 1) % N;
      pos.set([at.x, at.y, at.z], i * 3);
      vel.set([v.x, v.y, v.z], i * 3);
      rot.set([Math.random() - 0.5, 0.6, Math.random() - 0.5, Math.random() * 6.28], i * 4);
      spin[i] = 2 + Math.random() * 4;
      max[i] = life[i] = lifeS;
      phase[i] = Math.random() * 6.28;
      info[i * 2 + 1] = Math.random();
    },
    update(t, dt) {
      wind.copy(u.uWindDir.value).multiplyScalar(0.4 + 0.6 * u.uBreeze.value);
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) {
          info[i * 2] = 0;
          continue;
        }
        life[i] -= dt;
        const k = i * 3;
        vel[k + 1] += (-0.5 - vel[k + 1]) * Math.min(1, dt * 0.9);
        vel[k] += (wind.x - vel[k]) * Math.min(1, dt * 0.6);
        vel[k + 2] += (wind.y - vel[k + 2]) * Math.min(1, dt * 0.6);
        pos[k] += (vel[k] + Math.sin(t * 2.3 + phase[i]) * 0.35) * dt;
        pos[k + 1] += vel[k + 1] * dt;
        pos[k + 2] += (vel[k + 2] + Math.cos(t * 1.9 + phase[i]) * 0.25) * dt;
        // Settle on the grass tops instead of sinking into the ground.
        const floor = o.groundAt ? o.groundAt(pos[k], pos[k + 2]) + 0.25 : -Infinity;
        if (pos[k + 1] < floor) {
          pos[k + 1] = floor;
          vel[k] *= 0.8;
          vel[k + 2] *= 0.8;
          spin[i] *= 0.9;
        }
        rot[i * 4 + 3] += spin[i] * dt;
        const age = 1 - life[i] / max[i];
        info[i * 2] = Math.min(1, age * 10) * Math.min(1, life[i] / 0.6);
      }
      aPos.needsUpdate = true;
      aRot.needsUpdate = true;
      aInfo.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}

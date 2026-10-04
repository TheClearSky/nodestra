// COPIED from .claude/pages/ad/experiments/gtr-common.ts by scripts/sync-meadow.mjs — edit the source, then sync.
/** EXPERIMENT helpers shared by the gtr-* pages: sky, env, fps, UI. */
import * as THREE from 'three';

export type SkyColors = {
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  sun: THREE.Color;
  clouds: number; // 0 = none
};

export const SHINKAI_SKY: SkyColors = {
  zenith: new THREE.Color(0x1d5fd0),
  horizon: new THREE.Color(0xbfe4f6),
  ground: new THREE.Color(0x6f9a4a),
  sun: new THREE.Color(1.0, 0.86, 0.62),
  clouds: 1,
};

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uClouds;
  uniform float uTime;
  uniform float uSunDisc;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.0; a *= 0.5; }
    return v;
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
    float sd = max(dot(d, uSunDir), 0.0);
    sky += uSunColor * (pow(sd, 6.0) * 0.22 + pow(sd, 48.0) * 0.5);
    if (uClouds > 0.0 && h > 0.0) {
      // flat cumulus layer: projected onto a plane, soft-edged, sunlit on top
      vec2 uv = d.xz / (h + 0.12) * 1.6 + vec2(uTime * 0.004, 0.0);
      float c = fbm(uv * 1.3);
      float shape = smoothstep(0.52, 0.72, c) * smoothstep(0.02, 0.2, h);
      float lit = smoothstep(0.45, 0.85, fbm(uv * 1.3 + uSunDir.xz * 0.12));
      vec3 cloud = mix(vec3(0.72, 0.78, 0.92), vec3(1.25, 1.18, 1.08), lit);
      cloud += uSunColor * pow(sd, 4.0) * 0.6;
      sky = mix(sky, cloud, shape * uClouds);
    }
    float disc = smoothstep(0.99984, 0.99993, sd) * uSunDisc;
    sky += uSunColor * (disc * 30.0 + pow(sd, 900.0) * 3.0 * uSunDisc);
    sky = mix(sky, uGround, smoothstep(0.0, -0.06, h));
    gl_FragColor = vec4(sky, 1.0);
  }
`;

export function makeSky(colors: SkyColors, sunDir: THREE.Vector3, sunDisc = 1) {
  const uniforms = {
    uZenith: { value: colors.zenith.clone() },
    uHorizon: { value: colors.horizon.clone() },
    uGround: { value: colors.ground.clone() },
    uSunColor: { value: colors.sun.clone() },
    uSunDir: { value: sunDir.clone().normalize() },
    uClouds: { value: colors.clouds },
    uTime: { value: 0 },
    uSunDisc: { value: sunDisc },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, uniforms };
}

/** PMREM environment from a throwaway scene (disposed here). */
export function envFromScene(renderer: THREE.WebGLRenderer, scene: THREE.Scene, sigma = 0.04): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(scene, sigma).texture;
  pmrem.dispose();
  return texture;
}

/** Soft grass-ish ground texture (no image files). */
export function grassTexture(size = 512): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5d8a3a';
  g.fillRect(0, 0, size, size);
  let seed = 7;
  const r = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 2600; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = 2 + r() * 14;
    const light = r() < 0.5;
    g.fillStyle = light ? `rgba(160,200,90,${0.05 + r() * 0.1})` : `rgba(30,70,30,${0.05 + r() * 0.12})`;
    for (const [dx, dy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      g.beginPath();
      g.ellipse(x + dx, y + dy, rad, rad * 0.6, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Frame-time meter: exposes window.__fps (mean over the last 2 s). */
export function fpsMeter(label?: HTMLElement) {
  const times: number[] = [];
  let lastShown = 0;
  return (now: number) => {
    times.push(now);
    while (times.length && now - times[0] > 2000) times.shift();
    if (times.length > 2) {
      const fps = ((times.length - 1) * 1000) / (times[times.length - 1] - times[0]);
      (window as unknown as { __fps: number }).__fps = fps;
      if (label && now - lastShown > 400) {
        label.textContent = `${fps.toFixed(0)} fps`;
        lastShown = now;
      }
    }
  };
}

/** A row of toggle buttons; returns a setter that marks the active one. */
export function buttonGroup<T extends string>(
  host: HTMLElement,
  title: string,
  options: { value: T; label: string }[],
  initial: T,
  onPick: (value: T) => void,
) {
  const row = document.createElement('div');
  row.className = 'row';
  const head = document.createElement('span');
  head.textContent = title;
  row.appendChild(head);
  const buttons = options.map((option) => {
    const b = document.createElement('button');
    b.textContent = option.label;
    b.dataset.value = option.value;
    b.addEventListener('click', () => {
      set(option.value);
      onPick(option.value);
    });
    row.appendChild(b);
    return b;
  });
  const set = (value: T) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.value === value));
  };
  set(initial);
  host.appendChild(row);
  return set;
}

export const PAGE_CSS = `
  :root { color-scheme: dark; --bg:#0d1014; --fg:#eef0f3; --dim:#a4adb8; --acc:#f1c40f; }
  html,body { margin:0; height:100%; background:var(--bg); color:var(--fg); overflow:hidden;
    font: 13px/1.45 "DejaVu Sans", system-ui, sans-serif; }
  canvas#c { display:block; width:100vw; height:100vh; touch-action:none; }
  .panel { position:fixed; left:12px; top:12px; display:grid; gap:6px; max-width:calc(100vw - 24px);
    background:rgba(10,14,20,.72); border:1px solid rgba(255,255,255,.12); border-radius:8px; padding:8px 10px;
    backdrop-filter: blur(6px); }
  .panel h1 { margin:0 0 2px; font-size:13px; letter-spacing:.06em; }
  .row { display:flex; flex-wrap:wrap; gap:5px; align-items:center; }
  .row span { color:var(--dim); min-width:64px; font-size:12px; }
  .row button { font:inherit; font-size:12px; background:rgba(255,255,255,.06); color:var(--fg);
    border:1px solid rgba(255,255,255,.16); border-radius:5px; padding:3px 8px; cursor:pointer; }
  .row button[aria-pressed="true"] { border-color:var(--acc); background:rgba(241,196,15,.16); }
  .note { position:fixed; left:12px; bottom:12px; max-width:min(720px, calc(100vw - 24px)); color:var(--dim);
    background:rgba(10,14,20,.72); border:1px solid rgba(255,255,255,.12); border-radius:8px; padding:6px 10px; font-size:12px; }
  .note b { color:var(--fg); }
  .fps { position:fixed; right:12px; top:12px; font: 12px ui-monospace, monospace; color:var(--dim);
    background:rgba(10,14,20,.72); border-radius:6px; padding:3px 7px; }
  @media (max-width:640px) { .panel { font-size:11px; } .note { font-size:10.5px; } }
`;

// COPIED from .claude/pages/ad/experiments/hell-src/hell-stage.ts by scripts/sync-hell.mjs — edit the source, then sync.
/**
 * The hellscape as one of the landing's scenes (2026-10-11, owner: "fit it
 * along with other scenes like the piano, guitar and organ scene as the 4th
 * scene, have same buttons, including the piano sheet. just have one extra
 * button to play/stop the auto demo").
 *
 * The same world as hell-30-final (the owner's selection, Anime finish), but
 * without the experiment harness: no HUD, no variant rows, no page-wide
 * listeners. It speaks the meadow scenes' language, so the landing drives it
 * the same way:
 *
 *   setLive(true)   the drone flight ("The Ascent") to the Vampire Synth on
 *                   the castle roof, then a free orbit round it (drag to
 *                   turn, scroll / pinch to zoom);
 *   setLive(false)  a smooth glide back to the opening view (the landing
 *                   waits its 3.5 s back-off);
 *   setLiveKey      the keyboard bus's keys press the synth's 3D keys;
 *
 * plus the auto demo — Nodestra's "Vampire Synth — Nosferatu", recorded from
 * the app's engine and transposed to C (home note C2), with its notes
 * pressing the synth's keys — which only ever starts from `playDemo()`.
 *
 * Like the meadows: a 61 fps cap, the shared render gate (off screen, a
 * hidden tab, the owner's pause), the scenes' quality tier and runtime
 * ladder, `renderNow()` to draw (and compile) behind the landing's black,
 * and a `dispose()` that gives the WebGL context up.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeEnvUniforms } from '../env-src/lab';
import type { Lab } from '../env-src/lab';
import { createAdaptive, sceneQuality } from '../env-src/scene-quality';
import { createRenderGate } from '../../renderGate';
import { createBackdrop, GRADES } from './hell-common';
import { LAYOUT } from './scene/contract';
import type { AssetClass, SceneContext } from './scene/contract';
import { createPaletteStore } from './scene/palette';
import { create as createColour } from './scene/colour';
import { create as createSky } from './scene/sky';
import { create as createCircles } from './scene/circles';
import { create as createClouds } from './scene/clouds';
import { create as createPillar } from './scene/pillar';
import { create as createBones } from './scene/bones';
import { create as createDunes } from './scene/dunes';
import { create as createIslands } from './scene/islands';
import { create as createParticles } from './scene/particles';
import { create as createEvents } from './scene/events';
import { create as createPost } from './scene/post';
import { ASCENT, createFlight } from './scene/flight';
import { pianoHandle } from './scene/piano-toon';
import { createStreaks } from './scene/streaks';

/** The owner's selection (hell-30-final), with the default finish. */
const SELECTION: Record<string, string> = {
  colour: 'dusk',
  sky: 'torn',
  circles: 'sketch',
  clouds: 'veils',
  pillar: 'citadelRoof',
  bones: 'nave',
  dunes: 'aot',
  islands: 'chained',
  particles: 'vortex',
  events: 'none',
  post: 'anime',
};

/** The one choice left to the viewer (hell-30-final): the rendering finish. */
export type HellFinish = 'anime' | 'painted';

export type HellSceneOptions = {
  reducedMotion: boolean;
  /** The finish to start with (default: the Anime finish). */
  finish?: HellFinish;
  /** Where the recorded demo and its notes are served from. */
  demo: { audio: string; notes: string };
  /** The demo started (true) or stopped (false) — by the button, by its
   *  end, by Back, or because it could not load. */
  onDemoChange?(playing: boolean): void;
};

export type HellScene = {
  resize(width: number, height: number): void;
  /**
   * Compile every shader in parallel, off the main thread
   * (KHR_parallel_shader_compile through three's `compileAsync`), then start
   * drawing. Measured: compiled the usual way, the first frame blocked the
   * page for ~12 s (the vortex embers alone 2.8 s, the bones 1.5 s). Until it
   * settles, the scene draws nothing (a resize does not draw either).
   */
  warm(): Promise<void>;
  /** Draw one frame now (behind the landing's black). */
  renderNow(): void;
  /** Live: fly to the synth; off: glide back to the opening view. */
  setLive(live: boolean): void;
  /** A key (0 = A0 … 87 = C8) pressed or released. */
  setLiveKey(key: number, down: boolean): void;
  /** Switch the finish (Anime finish / Painted cel). */
  setFinish(finish: HellFinish): void;
  /** Start the auto demo (from a click: it makes its audio context). */
  playDemo(): void;
  stopDemo(): void;
  demoPlaying(): boolean;
  quality(): string;
  dispose(): void;
  /** Test hooks (Playwright, `?hell-debug` → `window.__hellStage`). */
  debug: {
    stop(): void;
    /** Hold the flight at t seconds (≥ its duration: seated). */
    seek(t: number): void;
    duration: number;
    mode(): string;
    camera: THREE.PerspectiveCamera;
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    composer: EffectComposer;
    demo(): { t: number; next: number } | null;
  };
};

type Mode = 'view' | 'flying' | 'seated' | 'backing';

/** Back to the opening view: the landing waits 3.5 s for it. */
const BACK_SECONDS = 3.3;
/** The opening view's extra upward tilt (radians, ≈ 5°). */
const VIEW_TILT = THREE.MathUtils.degToRad(5);
const VIEW_FOV = 40;

const smoother = (x: number) => {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export function createHellScene(canvas: HTMLCanvasElement, options: HellSceneOptions): HellScene {
  const { guess, params: tier } = sceneQuality();

  // ── the renderer and its composer (the experiment harness's, minus the HUD) ──
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  const prCap = Math.min(window.devicePixelRatio || 1, tier.prCap);
  let pixelRatio = prCap;
  renderer.setPixelRatio(pixelRatio);
  const scene = new THREE.Scene();
  const env = makeEnvUniforms(GRADES.crimson);
  const camera = new THREE.PerspectiveCamera(VIEW_FOV, 1, 0.1, 6000);
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: tier.samples });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.55, 0.92);
  bloom.enabled = tier.bloom > 0;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /** The camera's fov for this aspect (set once the camera rules exist below). */
  let refitFov = () => {};
  const frameCallbacks: ((t: number, dt: number) => void)[] = [];
  const preRender: (() => void)[] = [];
  const resizeCallbacks: ((w: number, h: number) => void)[] = [];
  const size = { w: 0, h: 0 };
  const resize = (w: number, h: number) => {
    if (w <= 0 || h <= 0) return;
    size.w = w;
    size.h = h;
    camera.aspect = w / h;
    refitFov();
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    for (const cb of resizeCallbacks) cb(w * pixelRatio, h * pixelRatio);
  };
  const lab: Lab = {
    renderer,
    scene,
    camera,
    composer,
    env,
    pixelRatio,
    addPass: (pass) => composer.insertPass(pass, 1),
    onFrame: (cb) => frameCallbacks.push(cb),
    onPreRender: (cb) => preRender.push(cb),
    onResize: (cb) => resizeCallbacks.push(cb),
    addVariants: () => {},
    start: () => {},
  };
  const backdrop = createBackdrop(lab, 'crimson');

  // ── the world: the owner's selection ──
  const context: SceneContext = {
    lab,
    backdrop,
    scene,
    camera,
    layout: LAYOUT,
    palette: createPaletteStore(SELECTION.colour),
    lean: true,
  };
  const factories = [createColour, createSky, createCircles, createClouds, createPillar, createBones, createDunes, createIslands, createParticles, createEvents, createPost];
  const classes: AssetClass[] = [];
  for (const factory of factories) {
    try {
      classes.push(factory(context));
    } catch (error) {
      console.error('[hell] an asset class failed to build', error);
    }
  }
  const startFinish: HellFinish = options.finish ?? 'anime';
  for (const cls of classes) cls.setOption(cls.id === 'post' ? startFinish : SELECTION[cls.id]);
  const post = classes.find((cls) => cls.id === 'post');
  const synth = pianoHandle.current;

  // ── the camera ──
  const Y = new THREE.Vector3(0, 1, 0);
  const eyePos = new THREE.Vector3(...LAYOUT.camera.position);
  const lookAt = new THREE.Vector3(...LAYOUT.camera.look);
  const base = new THREE.Spherical().setFromVector3(lookAt.clone().sub(eyePos));
  // The opening view looks a little further up than the experiment page's
  // (owner, 2026-10-11: "by default have the camera looking a bit up, not
  // straight"): more of the sky and its spells over the castle.
  base.phi -= VIEW_TILT;
  const flight = createFlight();
  let mode: Mode = 'view';
  let flightT = 0;
  let held = false; // the flight held by a test
  const lastVel = new THREE.Vector3();

  // The opening view: drag to look around, and a slow handheld wander (the
  // harness's own, as on the experiment page).
  const look = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0 };
  const wanderPhase = [0.3, 1.9, 4.1, 2.6];
  let wanderWeight = 1;
  const spherical = new THREE.Spherical();
  const lookDir = new THREE.Vector3();
  const lookPoint = new THREE.Vector3();
  const placeView = (t: number) => {
    look.yaw += (look.targetYaw - look.yaw) * 0.08;
    look.pitch += (look.targetPitch - look.pitch) * 0.08;
    wanderWeight += (1 - wanderWeight) * 0.02;
    const [a, b, c, d] = wanderPhase;
    const wy = wanderWeight * (0.035 * Math.sin(t * 0.13 + a) + 0.018 * Math.sin(t * 0.071 + b));
    const wp = wanderWeight * (0.01 * Math.sin(t * 0.09 + c) + 0.006 * Math.sin(t * 0.053 + d));
    spherical.set(1, base.phi - look.pitch - wp, base.theta + look.yaw + wy);
    camera.position.copy(eyePos);
    camera.position.y += wanderWeight * 0.03 * Math.sin(t * 0.21 + b);
    camera.up.copy(Y);
    lookDir.setFromSpherical(spherical);
    camera.lookAt(lookPoint.copy(camera.position).add(lookDir));
  };
  // On a narrow screen (a phone upright) the view keeps its WIDTH: below a
  // 3:2 aspect the vertical field of view widens, up to 78° (the meadows'
  // and the piano stage's rule) — so the synth is not cropped to its middle.
  const FIT_ASPECT = 1.5;
  const FIT_MAX_FOV = 78;
  let baseFov = VIEW_FOV;
  const fitFov = (fov: number) => {
    const aspect = camera.aspect;
    if (!(aspect > 0) || aspect >= FIT_ASPECT) return fov;
    const widened = THREE.MathUtils.radToDeg(2 * Math.atan((Math.tan(THREE.MathUtils.degToRad(fov / 2)) * FIT_ASPECT) / aspect));
    return Math.min(Math.max(fov, FIT_MAX_FOV), widened);
  };
  refitFov = () => {
    camera.fov = fitFov(baseFov);
  };
  const setFov = (fov: number) => {
    baseFov = fov;
    const fitted = fitFov(fov);
    if (Math.abs(camera.fov - fitted) < 0.01) return;
    camera.fov = fitted;
    camera.updateProjectionMatrix();
  };

  // At the synth: a free orbit round it, damped (hell-30-final's).
  const orbitTarget = new THREE.Vector3(...(ASCENT[ASCENT.length - 1].aim ?? [0, 229, -429]));
  const ORBIT = { rMin: 1.2, rMax: 42, phiMin: 0.12, phiMax: 1.72, floorY: 221.2 };
  const orbit = { r: 4, theta: 0, phi: 1.2, rT: 4, thetaT: 0, phiT: 1.2 };
  let seatR = 4;
  const orbitOffset = new THREE.Vector3();
  const orbitLook = new THREE.Vector3();
  const orbitFromCamera = () => {
    orbitOffset.copy(camera.position).sub(orbitTarget);
    const sph = new THREE.Spherical().setFromVector3(orbitOffset);
    orbit.r = orbit.rT = sph.radius;
    orbit.theta = orbit.thetaT = sph.theta;
    orbit.phi = orbit.phiT = sph.phi;
    seatR = sph.radius;
  };
  const orbitClamp = () => {
    orbit.rT = THREE.MathUtils.clamp(orbit.rT, ORBIT.rMin, ORBIT.rMax);
    // Never below the terrace floor: the lowest angle depends on the distance.
    const lowest = Math.acos(THREE.MathUtils.clamp((ORBIT.floorY - orbitTarget.y) / orbit.rT, -1, 1));
    orbit.phiT = THREE.MathUtils.clamp(orbit.phiT, ORBIT.phiMin, Math.min(ORBIT.phiMax, lowest));
  };
  const orbitFrame = (dt: number) => {
    const k = 1 - Math.exp(-dt / 0.16);
    orbit.r += (orbit.rT - orbit.r) * k;
    orbit.theta += (orbit.thetaT - orbit.theta) * k;
    orbit.phi += (orbit.phiT - orbit.phi) * k;
    orbitOffset.setFromSphericalCoords(orbit.r, orbit.phi, orbit.theta);
    camera.position.copy(orbitTarget).add(orbitOffset);
    camera.up.copy(Y);
    // Pulled back, the aim lifts above the synth: the horizon, the dunes and
    // the spells fill the frame above it.
    orbitLook.copy(orbitTarget);
    orbitLook.y += THREE.MathUtils.clamp((orbit.r - seatR) * 0.32, 0, 9);
    camera.lookAt(orbitLook);
    setFov(THREE.MathUtils.lerp(54, 62, THREE.MathUtils.clamp((orbit.r - 4) / 30, 0, 1)));
  };
  const landAt = () => {
    const pose = flight.at(flight.duration);
    camera.position.copy(pose.pos);
    camera.up.copy(Y);
    camera.lookAt(orbitTarget);
    orbitFromCamera();
    setFov(pose.fov);
    mode = 'seated';
  };

  // Back: a glide from wherever the camera is to the opening view (a little
  // arc up, so it clears the castle's crown), the view itself turning
  // smoothly to the opening framing.
  const back = { t: 0, p0: new THREE.Vector3(), q0: new THREE.Quaternion(), f0: VIEW_FOV };
  const qView = new THREE.Quaternion();
  {
    // The opening framing, tilt included (the glide back ends exactly on it).
    const m = new THREE.Matrix4().lookAt(eyePos, eyePos.clone().add(new THREE.Vector3().setFromSpherical(base)), Y);
    qView.setFromRotationMatrix(m);
  }
  const backFrame = (dt: number) => {
    back.t += dt;
    const x = back.t / BACK_SECONDS;
    const k = smoother(x);
    camera.position.lerpVectors(back.p0, eyePos, k);
    camera.position.y += Math.sin(Math.PI * k) * 18;
    camera.quaternion.slerpQuaternions(back.q0, qView, smoother(x * 1.15));
    setFov(THREE.MathUtils.lerp(back.f0, VIEW_FOV, k));
    if (x >= 1) {
      mode = 'view';
      look.yaw = look.targetYaw = 0;
      look.pitch = look.targetPitch = 0;
      wanderWeight = 0; // the wander fades back in from here
      camera.up.copy(Y);
    }
  };

  // ── pointers: drag to look (the view), drag / pinch / wheel to orbit (seated) ──
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  const grabbable = () => mode === 'view' || mode === 'seated';
  const syncCursor = () => {
    canvas.style.cursor = !grabbable() ? '' : pointers.size > 0 ? 'grabbing' : 'grab';
  };
  canvas.style.touchAction = 'none';
  const onPointerDown = (e: PointerEvent) => {
    if (!grabbable() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
    syncCursor();
  };
  const onPointerMove = (e: PointerEvent) => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last.x = e.clientX;
    last.y = e.clientY;
    if (mode === 'view') {
      // The scene follows the hand on both axes, like an orbit camera (owner,
      // 2026-10-11: "reverse the drag controls on initial scene of synth to
      // make it feel like an orbit camera"). The harness turned the view
      // WITH a sideways drag but against a vertical one; only the sideways
      // sign is flipped (measured: drag right → the view turns left, drag
      // down → it tilts up, so the scene moves with the hand both ways).
      const k = 1.6 / Math.max(canvas.clientWidth, 1);
      look.targetYaw = THREE.MathUtils.clamp(look.targetYaw + dx * k, -0.6, 0.6);
      look.targetPitch = THREE.MathUtils.clamp(look.targetPitch + dy * k, -0.25, 0.3);
    } else if (mode === 'seated') {
      if (pointers.size === 1) {
        orbit.thetaT -= dx * 0.006;
        orbit.phiT -= dy * 0.005;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) orbit.rT *= pinch / d;
        pinch = d;
      }
      orbitClamp();
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinch = 0;
    syncCursor();
  };
  const onWheel = (e: WheelEvent) => {
    if (mode !== 'seated') return;
    e.preventDefault();
    orbit.rT *= Math.exp(e.deltaY * 0.0012);
    orbitClamp();
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  syncCursor();

  // ── streaks: a 2D layer at the screen's edges, from the camera's speed ──
  const streaks = createStreaks({ contained: true });
  canvas.after(streaks.el);

  // ── the keys: the visitor's (keyboard bus) and the demo's, counted apart
  // so one never lifts a key the other still holds ──
  const userHeld = new Set<number>();
  const demoHolds = (midi: number) => demo?.held.some((h) => h.midi === midi) ?? false;

  // ── the auto demo ──
  type DemoNote = [number, number, number, number]; // t, duration, midi, voice
  let demoCtx: AudioContext | null = null;
  let demoBytes: Promise<[ArrayBuffer, DemoNote[]]> | null = null;
  let demoBuffer: Promise<{ buffer: AudioBuffer; notes: DemoNote[] }> | null = null;
  let demo: { source: AudioBufferSourceNode; start: number; notes: DemoNote[]; next: number; held: { midi: number; off: number }[] } | null = null;
  /** Bumped by every start and stop: a slow load never starts a stopped demo. */
  let demoToken = 0;
  let demoWanted = false;
  let disposed = false;
  const fetchDemo = () => {
    demoBytes ??= Promise.all([
      fetch(options.demo.audio).then((r) => {
        if (!r.ok) throw new Error(`demo audio: HTTP ${r.status}`);
        return r.arrayBuffer();
      }),
      fetch(options.demo.notes).then((r) => {
        if (!r.ok) throw new Error(`demo notes: HTTP ${r.status}`);
        return r.json() as Promise<{ notes: DemoNote[] }>;
      }).then((json) => json.notes),
    ]);
    // A failed fetch may be retried by the next Play.
    demoBytes.catch(() => {
      demoBytes = null;
    });
    return demoBytes;
  };
  const setDemoWanted = (next: boolean) => {
    if (demoWanted === next) return;
    demoWanted = next;
    options.onDemoChange?.(next);
  };
  const releaseDemoKeys = (d: NonNullable<typeof demo>) => {
    for (const h of d.held) if (!userHeld.has(h.midi)) synth?.press(h.midi, false);
  };
  const stopDemo = () => {
    demoToken++;
    const d = demo;
    demo = null;
    if (d) {
      try {
        d.source.stop();
      } catch {
        // already stopped
      }
      d.source.disconnect();
      releaseDemoKeys(d);
    }
    setDemoWanted(false);
  };
  const playDemo = () => {
    if (disposed) return;
    stopDemo();
    const token = ++demoToken;
    setDemoWanted(true);
    // Made (or resumed) inside the click: the browser allows audio now.
    demoCtx ??= new AudioContext();
    const ctx = demoCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    demoBuffer ??= fetchDemo().then(([bytes, notes]) =>
      // decodeAudioData detaches the bytes: decode a copy, so a later
      // context could decode them again.
      ctx.decodeAudioData(bytes.slice(0)).then((buffer) => ({ buffer, notes })),
    );
    demoBuffer
      .then(({ buffer, notes }) => {
        if (token !== demoToken || disposed) return;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.value = 0.9;
        source.connect(gain).connect(ctx.destination);
        const start = ctx.currentTime + 0.05;
        source.start(start);
        demo = { source, start, notes, next: 0, held: [] };
        source.onended = () => {
          if (demo?.source === source) stopDemo();
        };
      })
      .catch((error: unknown) => {
        demoBuffer = null;
        console.error('[hell] the demo could not be played', error);
        if (token === demoToken) setDemoWanted(false);
      });
  };
  const demoFrame = () => {
    if (!demo || !demoCtx) return;
    const now = demoCtx.currentTime - demo.start;
    while (demo.next < demo.notes.length && demo.notes[demo.next][0] <= now) {
      const [t, d, midi] = demo.notes[demo.next++];
      synth?.press(midi, true);
      demo.held.push({ midi, off: t + Math.max(0.09, d) });
    }
    const d = demo;
    d.held = d.held.filter((h) => {
      if (h.off > now) return true;
      // (another voice — or the visitor — may still hold the same key)
      if (!userHeld.has(h.midi) && !d.held.some((o) => o !== h && o.midi === h.midi && o.off > now)) synth?.press(h.midi, false);
      return false;
    });
  };

  // ── the frame ──
  /** The scene's own clock (s): it advances only while frames are drawn. */
  let elapsed = 0;
  const step = (t: number, dt: number) => {
    env.uTime.value = t;
    env.uFrame.value = (env.uFrame.value + 1) % 100000;
    // The camera first, so every class sees this frame's camera.
    if (mode === 'view') placeView(t);
    else if (mode === 'backing') backFrame(dt);
    else if (mode === 'seated') orbitFrame(dt);
    if (mode === 'flying') {
      if (!held) flightT += dt;
      if (flightT >= flight.duration) {
        flightT = flight.duration;
        landAt();
      } else {
        const pose = flight.at(flightT);
        lastVel.copy(pose.vel);
        camera.position.copy(pose.pos);
        camera.quaternion.copy(pose.quat);
        setFov(pose.fov);
      }
    }
    syncCursor();
    const classDt = Math.min(0.05, dt);
    for (const cb of frameCallbacks) cb(t, classDt);
    for (const cls of classes) cls.update?.(t, classDt);
    demoFrame();
    streaks.update(mode === 'flying' ? lastVel.length() : 0, dt);
    for (const cb of preRender) cb();
    composer.render(classDt);
  };

  // ── runtime quality (the meadows' ladder: pixel ratio, then MSAA) ──
  const setPixelScale = (scale: number) => {
    const next = Math.max(0.5, prCap * scale);
    if (Math.abs(next - pixelRatio) < 1e-3) return;
    pixelRatio = next;
    if (size.w) resize(size.w, size.h);
  };
  const setMaxSamples = (max: number) => {
    const n = Math.min(tier.samples, max);
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
      if (rt.samples === n) continue;
      rt.samples = n;
      rt.dispose(); // re-allocated with the new sample count on next use
    }
  };
  const adaptive = createAdaptive(
    (r) => {
      setPixelScale(r.prScale);
      setMaxSamples(r.maxSamples);
    },
    { enabled: !guess.forced && !options.reducedMotion },
  );

  // ── the loop: 61 fps cap, only while the render gate is open ──
  let previous = performance.now();
  const MIN_FRAME_MS = 1000 / 61;
  let capped = false;
  const frame = () => {
    const now = performance.now();
    if (now - previous < MIN_FRAME_MS) {
      capped = true;
      return;
    }
    // Real elapsed time: slow frames must not slow the flight (a long stall
    // is cut short).
    const dt = Math.min(0.25, (now - previous) / 1000);
    previous = now;
    elapsed += dt;
    adaptive.frame(now, capped);
    capped = false;
    step(elapsed, dt);
  };
  let looping = false;
  /** Shaders compiled (`warm`): the loop waits for it. */
  let warmed = false;
  const syncLoop = () => {
    const run = warmed && gate.isOpen();
    if (run === looping) return;
    looping = run;
    if (run) {
      previous = performance.now() - 1000 / 60;
      adaptive.reset();
      capped = false;
    }
    renderer.setAnimationLoop(run ? frame : null);
  };
  const gate = createRenderGate(canvas, syncLoop);
  syncLoop();
  const onContextLost = () => console.warn('[hell] the hellscape lost its WebGL context');
  const onContextRestored = () => console.warn('[hell] the hellscape got its WebGL context back');
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  const sceneApi: HellScene = {
    resize(width, height) {
      resize(width, height);
      // A resize clears the canvas: with the loop stopped, draw one frame now
      // (once warm — before, a frame would compile every shader on the spot).
      if (!looping && warmed) step(elapsed, 0);
    },
    async warm() {
      if (warmed || disposed) return;
      try {
        // Into the composer's own target: a material's program depends on
        // where it draws (to a half-float target: linear output, no tone
        // mapping), so compiled for the canvas they were compiled again —
        // and blocking — at the first frame.
        const previousTarget = renderer.getRenderTarget();
        renderer.setRenderTarget(composer.readBuffer);
        const compiling = renderer.compileAsync(scene, camera);
        renderer.setRenderTarget(previousTarget);
        await compiling;
      } catch (error) {
        // Not fatal: the first frame compiles whatever is left, the slow way.
        console.warn('[hell] the shaders could not be compiled ahead of time', error);
      }
      if (disposed) return;
      warmed = true;
      syncLoop();
    },
    renderNow() {
      if (disposed) return; // (a switch away while it was warming)
      step(elapsed, 0);
      previous = performance.now();
    },
    setLive(live) {
      if (live) {
        // The demo's files start on their way now (the decode waits for its click).
        void fetchDemo().catch(() => {});
        held = false;
        pointers.clear();
        if (options.reducedMotion) {
          landAt();
        } else {
          flightT = 0;
          mode = 'flying';
        }
      } else {
        stopDemo();
        pointers.clear();
        if (mode === 'view') return;
        if (options.reducedMotion) {
          mode = 'view';
          setFov(VIEW_FOV);
          return;
        }
        back.t = 0;
        back.p0.copy(camera.position);
        back.q0.copy(camera.quaternion);
        back.f0 = baseFov;
        mode = 'backing';
      }
      syncCursor();
    },
    setLiveKey(key, down) {
      if (key < 0 || key > 87) return;
      const midi = key + 21;
      if (down) {
        userHeld.add(midi);
        synth?.press(midi, true);
      } else {
        userHeld.delete(midi);
        if (!demoHolds(midi)) synth?.press(midi, false);
      }
    },
    setFinish(finish) {
      if (disposed) return;
      post?.setOption(finish);
      // With the loop stopped (off screen), show the change at once.
      if (!looping && warmed) step(elapsed, 0);
    },
    playDemo,
    stopDemo,
    demoPlaying: () => demoWanted,
    quality: () => `${tier.tier}${adaptive.label()}`,
    dispose() {
      disposed = true;
      stopDemo();
      void demoCtx?.close().catch(() => {});
      demoCtx = null;
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      gate.dispose();
      renderer.setAnimationLoop(null);
      streaks.dispose();
      if (pianoHandle.current === synth) pianoHandle.current = null;
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const material of materials) material.dispose();
      });
      composer.dispose();
      target.dispose();
      renderer.dispose();
      // Scene switching would otherwise pile up GL contexts (the meadows do the same).
      renderer.forceContextLoss();
    },
    debug: {
      stop: () => gate.setPaused(true),
      seek(t) {
        held = true;
        if (t >= flight.duration) landAt();
        else {
          flightT = t;
          mode = 'flying';
        }
      },
      duration: flight.duration,
      mode: () => mode,
      camera,
      scene,
      renderer,
      composer,
      demo: () => (demo && demoCtx ? { t: demoCtx.currentTime - demo.start, next: demo.next } : null),
    },
  };
  if (new URLSearchParams(location.search).has('hell-debug')) {
    (window as unknown as { __hellStage?: HellScene }).__hellStage = sceneApi;
  }
  return sceneApi;
}

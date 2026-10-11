/**
 * Records the landing tour (`public/landing/ad/tour.html`) as the videos the
 * landing page plays: `public/landing/ad/tour/tour-{1080,720,480,360}.mp4`
 * plus `poster.jpg`.
 *
 *   npm run record-tour                  the whole loop, 60 fps
 *   npm run record-tour -- --seconds 5   a quick look at the first 5 s
 *   npm run record-tour -- --fps 30
 *   npm run record-tour -- --poster-at 21   which moment is the poster
 *   npm run record-tour -- --from 22 --seconds 4   a trial stretch (trial-*.mp4 in the temp folder)
 *   npm run record-tour -- --from 22 --seconds 4 --dump 120   also its raw frame 120 (trial-frame.png)
 *
 * The tour plays the REAL app in its screens, and booting a screen takes the
 * browser seconds — played live, that is what made the tour lag. Recorded,
 * it costs nothing: every clock the tour and its screens animate by
 * (`requestAnimationFrame`, `performance.now`, CSS animations) is replaced by
 * ONE stepped clock shared by every window, advanced exactly 1/fps per
 * captured frame however long the capture takes. While a screen is still
 * booting the tour waits (its own buffering), and so does the recording:
 * those steps follow real time and are not captured.
 *
 * Needs Google Chrome (playwright-core drives the installed one) and ffmpeg
 * on the PATH. Starts its own Vite dev server.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? Number(args[at + 1]) : fallback;
};
const FPS = option('fps', 60);
const LIMIT_SECONDS = option('seconds', Infinity);
/** The tour time (s) whose frame becomes the poster (shown before the video plays). */
const POSTER_AT = option('poster-at', 21);
/** Start capturing at this tour time (s): for trying settings on one stretch. */
const FROM = option('from', 0);
/** Also save captured frame N (0-based) as trial-frame.png, to check the capture itself. */
const DUMP = option('dump', -1);
const TRIAL = FROM > 0 || LIMIT_SECONDS < Infinity;
const OUT_PREFIX = TRIAL ? 'trial-' : 'tour-';
/** Where the videos go: the site, or (a trial) a temp folder, never shipped. */
const outDir = TRIAL ? join(tmpdir(), 'nodestra-tour-trial') : join(root, 'public', 'landing', 'ad', 'tour');

/** The renditions: 16:10, like the tour. Captured once at 2x the largest
 *  (lossless PNG) and scaled down. The tour is always moving (slow push-ins,
 *  drifting dots, sparks), and x264 smeared the app's small text at CRF 24 /
 *  tune animation, and the capture was 1x — a zoomed screen's text was an
 *  enlarged bitmap (2026-10-11, "even on 1080p video is still blurry"). At a
 *  true 2x capture CRF 21 looked the same as 18. The small ones get a light sharpen — the text is only
 *  a few pixels tall there. */
const RENDITIONS = [
  { height: 1080, width: 1728, crf: 21, sharpen: false },
  { height: 720, width: 1152, crf: 21, sharpen: false },
  { height: 480, width: 768, crf: 20, sharpen: true },
  { height: 360, width: 576, crf: 21, sharpen: true },
];
const CAPTURE = { width: 1728, height: 1080, scale: 2 };

/**
 * Runs in every window (the tour and each screen frame) before its own
 * scripts: requestAnimationFrame, performance.now and CSS animations follow
 * the shared stepped clock on the top window (`__vstep(ms)` advances it).
 */
function installSteppedClock() {
  let top;
  try {
    top = window.top;
    if (window !== top && !top.__vclock) return;
  } catch {
    return; // a cross-origin frame: not ours
  }
  if (window === top) top.__vclock = { v: 0, windows: new Set() };
  const clock = top.__vclock;
  const realNow = performance.now.bind(performance);
  const start = realNow();
  const v0 = clock.v;
  // This window's own time origin, moved on by the shared clock only.
  const now = () => start + (clock.v - v0);
  performance.now = now;
  let queue = new Map();
  let nextId = 0;
  window.requestAnimationFrame = (callback) => {
    nextId += 1;
    queue.set(nextId, callback);
    return nextId;
  };
  window.cancelAnimationFrame = (id) => {
    queue.delete(id);
  };
  const seen = new WeakMap();
  const entry = {
    step() {
      const t = now();
      // CSS animations and transitions: endless ones (spinners, pulses) are
      // held and moved by the clock alone; finite ones keep running (their
      // end events must fire) but are set to the clock's time each step.
      for (const animation of document.getAnimations()) {
        let state = seen.get(animation);
        if (!state) {
          const current = animation.currentTime;
          const endless = animation.effect?.getComputedTiming?.().iterations === Infinity;
          state = { base: typeof current === 'number' ? current : 0, at: t, endless };
          seen.set(animation, state);
          if (endless) animation.pause();
        }
        try {
          animation.currentTime = state.base + (t - state.at);
        } catch {
          // an animation that just ended
        }
      }
      const due = queue;
      queue = new Map();
      for (const callback of due.values()) {
        try {
          callback(t);
        } catch (error) {
          console.error(error);
        }
      }
    },
  };
  clock.windows.add(entry);
  window.addEventListener('pagehide', () => clock.windows.delete(entry));
  if (window === top) {
    window.__vstep = (ms) => {
      clock.v += ms;
      for (const w of [...clock.windows]) {
        try {
          w.step();
        } catch {
          clock.windows.delete(w);
        }
      }
    };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Windows refuses to replace a file another program has open (a browser
 *  tab playing the video from the dev server): retry for a while. */
async function replaceFile(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      if (error.code !== 'EPERM' && error.code !== 'EBUSY') throw error;
      if (attempt === 0) console.warn(`${to} is open elsewhere (a browser tab playing it?); retrying…`);
      if (attempt >= 60) {
        console.warn(`${to} stayed open: the new video is left as ${from} — close the tab and rename it.`);
        return;
      }
      await sleep(1000);
    }
  }
}

/** One ffmpeg reads the captured JPEGs and writes every rendition. */
function startEncoder(tmpNames) {
  const split = RENDITIONS.map((_, i) => `[s${i}]`).join('');
  const scales = RENDITIONS.map((r, i) => `[s${i}]scale=${r.width}:${r.height}:flags=lanczos${r.sharpen ? ',unsharp=5:5:0.45:5:5:0' : ''},format=yuv420p[v${i}]`).join(';');
  const filter = `[0:v]split=${RENDITIONS.length}${split};${scales}`;
  const outputs = RENDITIONS.flatMap((r, i) => [
    '-map', `[v${i}]`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(r.crf), '-profile:v', 'high',
    '-g', String(FPS * 2), '-movflags', '+faststart', '-an', tmpNames[i],
  ]);
  const ffmpeg = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-', '-filter_complex', filter, ...outputs], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => {
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  });
  return { ffmpeg, done };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const server = await createServer({ root, server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const port = server.httpServer.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: CAPTURE.width, height: CAPTURE.height }, deviceScaleFactor: CAPTURE.scale });
    page.on('pageerror', (error) => console.warn('[page error]', error.message));
    page.on('console', (message) => {
      if (message.type() === 'warning' && message.text().startsWith('[tour]')) console.warn(message.text());
    });
    await page.addInitScript(installSteppedClock);
    await page.goto(`http://127.0.0.1:${port}/landing/ad/tour.html?embed&debug&capture`);
    const cdp = await page.context().newCDPSession(page);

    const tmpNames = RENDITIONS.map((r) => join(outDir, `${OUT_PREFIX}${r.height}.part.mp4`));
    const { ffmpeg, done } = startEncoder(tmpNames);
    const frameMs = 1000 / FPS;
    const state = () => page.evaluate(() => ({ t: window.__adNow(), total: window.__adTotal, started: document.getElementById('loader').classList.contains('gone') }));

    // Waiting (the "Tuning up" loader, or a screen still booting): time
    // follows the real clock, nothing is captured.
    let lastReal = Date.now();
    const realStep = async () => {
      const real = Date.now();
      await page.evaluate((ms) => window.__vstep(ms), Math.max(frameMs, Math.min(100, real - lastReal)));
      lastReal = real;
      await sleep(frameMs);
    };
    while (!(await state()).started) await realStep();
    // A trial from later on: play there without capturing (a screen still
    // booting holds the tour, as when recording).
    while ((await state()).t < FROM) {
      await page.evaluate((ms) => window.__vstep(ms), frameMs);
      if (await page.evaluate(() => window.__tour.isBuffering())) await realStep();
    }

    const first = await state();
    const maxFrames = Math.min(Math.round(first.total * FPS), Math.round(LIMIT_SECONDS * FPS));
    const startedAt = Date.now();
    let frames = 0;
    const capture = async () => {
      // The clip's scale is what makes it 2x: without it this call captures at 1x
      // whatever the page's device scale (and zoomed screens came out soft).
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, clip: { x: 0, y: 0, width: CAPTURE.width, height: CAPTURE.height, scale: CAPTURE.scale } });
      const png = Buffer.from(shot.data, 'base64');
      if (frames === DUMP) writeFileSync(join(outDir, 'trial-frame.png'), png);
      if (!ffmpeg.stdin.write(png)) await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
    };
    let posterTaken = false;
    const poster = async (at) => {
      if (posterTaken || at < POSTER_AT || OUT_PREFIX !== 'tour-') return;
      posterTaken = true;
      await page.screenshot({ path: join(outDir, 'poster.jpg'), type: 'jpeg', quality: 88, scale: 'css' });
    };
    await capture();
    await poster(first.t);
    frames = 1;
    let t = first.t;
    // Playing: each step is exactly one frame of the video.
    while (frames < maxFrames) {
      await page.evaluate((ms) => window.__vstep(ms), frameMs);
      const next = await state();
      if (next.t < t) break; // looped back to the start
      if (next.t === t) {
        // The tour waits for a screen: let it boot, in real time.
        lastReal = Date.now();
        while (await page.evaluate(() => window.__tour.isBuffering())) await realStep();
        continue;
      }
      t = next.t;
      await capture();
      await poster(t);
      frames += 1;
      if (frames % FPS === 0) {
        const rate = frames / ((Date.now() - startedAt) / 1000);
        process.stdout.write(`
${(frames / FPS).toFixed(0)} / ${(maxFrames / FPS).toFixed(0)} s recorded (${rate.toFixed(1)} frames/s)   `);
      }
    }
    ffmpeg.stdin.end();
    await done;
    process.stdout.write('\n');
    for (const [i, r] of RENDITIONS.entries()) {
      const name = join(outDir, `${OUT_PREFIX}${r.height}.mp4`);
      await replaceFile(tmpNames[i], name);
      console.log(`${OUT_PREFIX}${r.height}.mp4  ${(statSync(name).size / 1e6).toFixed(1)} MB`);
    }
    console.log(`${frames} frames (${(frames / FPS).toFixed(1)} s at ${FPS} fps) in ${((Date.now() - startedAt) / 60000).toFixed(1)} min`);
  } finally {
    await browser.close();
    await server.close();
  }
}

await main();

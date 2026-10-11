// Takes the landing page's card stills (2026-10-12, Deepak: "go with images,
// only switch when clicking try it"): every card in `src/site/screens.ts` is
// a scene of the real app; this boots each one in a showcase frame at the
// 1440x900 desktop layout, exactly as "Try it" runs it (look-only), waits
// for the frame's own "ready" and a moment for its previews to draw, crops
// to the card's framing (`shotRegion`) and writes WebP stills at every
// `SHOT_WIDTHS` to `public/landing/cards/<key>-<width>.webp`.
//
//   node scripts/capture-cards.mjs            all cards
//   node scripts/capture-cards.mjs welcome    only the named card(s)
//
// Re-run it whenever a scene, the app's look or a card's crop changes.
// Uses its own Vite dev server and the installed Chrome (as record-tour.mjs).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public');
/** After the frame says ready: its previews and Blip's offer settle in. */
const SETTLE_MS = 3000;
/** Rendered at twice the layout's pixels, so the largest still is sharp. */
const CAPTURE_SCALE = 2;
const WEBP_QUALITY = 0.82;

/** `src/site/screens.ts` (TypeScript, type-only imports), loaded as a module. */
async function loadScreens() {
  const result = await build({ entryPoints: [join(root, 'src/site/screens.ts')], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'error' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function main() {
  const { SCREENS, SHOT_VIRTUAL, SHOT_WIDTHS, shotImagePath, shotRegion } = await loadScreens();
  const only = process.argv.slice(2);
  const shots = only.length > 0 ? SCREENS.filter((shot) => only.includes(shot.key)) : SCREENS;
  if (shots.length === 0) throw new Error(`no card named ${only.join(', ')}`);

  const server = await createServer({ root, server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: SHOT_VIRTUAL, deviceScaleFactor: CAPTURE_SCALE });
    page.on('pageerror', (error) => console.warn('[page error]', error.message));
    // A same-origin host page: a frame's "ready" is posted to its parent,
    // checked against the frame's own origin.
    await page.route(`${base}__capture`, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0;background:#000"></body></html>' }),
    );
    await page.goto(`${base}__capture`);
    for (const shot of shots) {
      const started = Date.now();
      // The look-only frame, as the card's "Try it" query minus `live`
      // (`frameSearch` in src/showcase/frame/protocol.ts).
      const src = `/showcase.html?kind=app&scene=${encodeURIComponent(shot.showcase.scene)}`;
      await page.evaluate(
        ({ src, width, height }) =>
          new Promise((resolve, reject) => {
            document.body.innerHTML = '';
            const frame = document.createElement('iframe');
            frame.src = src;
            frame.style.cssText = `border:0;display:block;width:${width}px;height:${height}px`;
            const timer = setTimeout(() => reject(new Error('the scene was not ready within 120 s')), 120_000);
            const onMessage = (event) => {
              if (event.source !== frame.contentWindow) return;
              if (event.data?.type === 'showcase:ready') {
                clearTimeout(timer);
                removeEventListener('message', onMessage);
                resolve();
              } else if (event.data?.type === 'showcase:failed') {
                clearTimeout(timer);
                reject(new Error(event.data.message));
              }
            };
            addEventListener('message', onMessage);
            document.body.append(frame);
          }),
        { src, width: SHOT_VIRTUAL.width, height: SHOT_VIRTUAL.height },
      );
      await page.waitForTimeout(SETTLE_MS);
      const region = shotRegion(shot.crop);
      const png = await page.screenshot({ clip: { x: region.left, y: region.top, width: region.width, height: region.height } });
      for (const width of SHOT_WIDTHS) {
        const height = Math.round((width * region.height) / region.width);
        const webp = await page.evaluate(
          async ({ data, width, height, quality }) => {
            const image = new Image();
            image.src = `data:image/png;base64,${data}`;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            context.imageSmoothingQuality = 'high';
            context.drawImage(image, 0, 0, width, height);
            return canvas.toDataURL('image/webp', quality).split(',')[1];
          },
          { data: png.toString('base64'), width, height, quality: WEBP_QUALITY },
        );
        const file = join(outDir, shotImagePath(shot.key, width));
        mkdirSync(dirname(file), { recursive: true });
        const bytes = Buffer.from(webp, 'base64');
        writeFileSync(file, bytes);
        console.log(`${shot.key}: ${width}x${height} ${(bytes.length / 1024).toFixed(0)} kB`);
      }
      console.log(`${shot.key}: done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

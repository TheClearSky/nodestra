// Builds the landing tour's three.js stage: `public/landing/ad/piano-stage.js`,
// an IIFE exposing `window.NodestraStage.createStageScene`, bundled from the
// app's own `src/landing/stageScene.ts` — so the tour's stage is always the
// app's current stage. Runs as part of `npm run build` (like the worklets);
// the output is committed so the dev server serves it without a build.
//
// The tour itself (`public/landing/ad/tour.html`) is a source file in this
// repo, and its app screens are the live app (`showcase.html`), so nothing
// else needs copying in.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  stdin: {
    contents:
      "import { createStageScene } from './src/landing/stageScene';\n" +
      '(window as unknown as { NodestraStage: unknown }).NodestraStage = { createStageScene };\n',
    resolveDir: ROOT,
    sourcefile: 'piano-stage-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  outfile: join(ROOT, 'public', 'landing', 'ad', 'piano-stage.js'),
  logLevel: 'warning',
});

console.log('tour stage: public/landing/ad/piano-stage.js rebuilt from src/landing/stageScene.ts');

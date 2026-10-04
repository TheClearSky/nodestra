import { existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * A LINKED LIBRARY'S REBUILD RELOADS THE PAGE — it is never hot-swapped.
 *
 * Measured 2026-09-27: rebuilding the timeline plugin while the app was open
 * hot-swapped it. Vite re-ran every module between the plugin and the React
 * refresh boundary (timelineSystem.ts among them — invisible in the update
 * list), so the app ended up holding OLD and NEW copies of the plugin at once:
 * the timeline UI read a fresh, EMPTY document store while the old one still
 * held the curves. The page-hide journal then recorded "active file, empty
 * timeline", the next boot adopted it, and autosave wrote it — the open file's
 * curves were destroyed (reproduced: 6 → 0).
 *
 * A full reload instead journals the CORRECT state and boots one consistent
 * copy of everything. It waits until the build has finished writing: the
 * build empties dist/ first, and a reload into a half-written dist 404s.
 */
function reloadOnLinkedLibraryBuild(): Plugin {
  const linkedDists = [
    'react-blender-nodes/dist/',
    'react-blender-nodes-timeline/dist/',
    'easy-tutorial-builder/dist/',
  ];
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    name: 'reload-on-linked-library-build',
    apply: 'serve',
    handleHotUpdate({ file, server }) {
      const normalized = file.replaceAll('\\', '/');
      const dist = linkedDists.find((marker) => normalized.includes(marker));
      if (dist === undefined) return undefined;
      const root = normalized.slice(0, normalized.indexOf(dist) + dist.length);
      clearTimeout(timer);
      const reloadWhenBuilt = (attempt: number) => {
        // The ES entry is written last-ish; its presence (plus a quiet
        // period) means the build is done.
        const built = ['index.d.ts', 'style.css'].some((name) =>
          existsSync(root + name),
        );
        if (built || attempt > 40) {
          server.ws.send({ type: 'full-reload' });
          return;
        }
        timer = setTimeout(() => reloadWhenBuilt(attempt + 1), 250);
      };
      timer = setTimeout(() => reloadWhenBuilt(0), 800);
      // Swallow the hot update: no module is swapped.
      return [];
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/; the Pages workflow passes
  // that as BASE_PATH. Locally (dev, preview, tests) it is the root.
  base: process.env.BASE_PATH ?? '/',
  // Tailwind v4 through its Vite plugin — no config file, no PostCSS file;
  // the tokens live in `src/index.css` (the host's arrangement).
  plugins: [react(), tailwindcss(), reloadOnLinkedLibraryBuild()],
  resolve: {
    // LOAD-BEARING: the file:-linked host resolves its own node_modules/react
    // without this, mounting a second React → hooks crash. zod joins for the
    // same reason, at the type/schema-identity level.
    //
    // THE HOST ITSELF joined on 2026-09-18, and the reason is worth keeping.
    // The timeline plugin now imports the host at RUNTIME, and it carries its
    // own npm copy of it (it devDepends on the published `^0.0.14`, having been
    // de-linked from this checkout during the release train). Vite's dep
    // scanner resolved that bare import relative to the PLUGIN's directory,
    // optimized the plugin's stale 0.0.14 copy, and then served the whole app
    // from it — the editor silently ran a host months behind this repo (no
    // bottom drawers, so no Timeline drawer, measured via
    // `.vite/deps/_metadata.json` pointing at
    // `react-blender-nodes-timeline/node_modules/...`). The production build
    // happened to resolve the app's copy instead, so dev and build disagreed.
    // Deduping pins ONE host — this app's — for both, and also prevents the
    // subtler failure two copies would cause: duplicate React contexts, where
    // the runner panel's provider and its consumer are different objects.
    dedupe: [
      'react',
      'react-dom',
      'zod',
      '@theclearsky/react-blender-nodes',
      '@theclearsky/react-blender-nodes-timeline',
    ],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});

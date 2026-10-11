import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { basenameFrom, routes } from './routes';
import { reloadOnceForNewDeploy } from './staleDeploy';

// A preloaded code file of an older deploy is gone (Vite's preload helper
// reports it here before the import fails): reload once onto the new deploy.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnceForNewDeploy()) event.preventDefault();
});

// Under a sub-path on GitHub Pages (`vite.config.ts` base); '/' locally.
const router = createBrowserRouter(routes, { basename: basenameFrom(import.meta.env.BASE_URL) });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

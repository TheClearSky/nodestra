import { Navigate } from 'react-router';
import type { RouteObject } from 'react-router';

/**
 * The site's routes.
 *
 *   /      the landing page — the tour, real screens of the app, features
 *   /app   the app itself (it opens on the "Play the piano" stage)
 *   *      anything else goes home
 *
 * Both pages are lazy, so the landing page never downloads the editor (Tone,
 * the host, three.js…) and the app never downloads the landing page.
 *
 * The landing page's links into the app are FULL page loads
 * (`reloadDocument`): the app boots once per document — audio engine,
 * worklets, the keyboard bus, the autosave journal — and is never mounted or
 * unmounted inside a page that is already running. The browser's back button
 * then returns to the landing page as an ordinary page.
 */
function Blank() {
  return <div className='h-full bg-primary-black' />;
}

const routes: RouteObject[] = [
  {
    path: '/',
    HydrateFallback: Blank,
    children: [
      {
        index: true,
        lazy: async () => ({ Component: (await import('./site/LandingPage')).LandingPage }),
      },
      {
        path: 'app',
        lazy: async () => ({ Component: (await import('./App')).App }),
      },
      { path: '*', element: <Navigate to='/' replace /> },
    ],
  },
];

export { routes };

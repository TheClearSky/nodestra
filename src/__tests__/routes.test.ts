import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router';
import { routes } from '../routes';

/** The leaf route a URL resolves to (the root layout is always matched first). */
function leaf(url: string) {
  const matches = matchRoutes(routes, url);
  return matches?.[matches.length - 1]?.route;
}

describe('site routes', () => {
  it('serves the landing page at /', () => {
    const route = leaf('/');
    expect(route?.index).toBe(true);
    expect(typeof route?.lazy).toBe('function');
  });

  it('serves the app at /app, query flags and all', () => {
    expect(leaf('/app')?.path).toBe('app');
    expect(leaf('/app?blip=bean')?.path).toBe('app');
  });

  it('sends any other path home', () => {
    for (const url of ['/nope', '/app/extra', '/landing', '/lab', '/lab/5']) expect(leaf(url)?.path).toBe('*');
  });

  it('never loads a page eagerly (every page is code-split)', () => {
    const children = routes[0].children ?? [];
    expect(children.filter((route) => route.lazy).map((route) => route.path ?? 'index')).toEqual(['index', 'app']);
    expect(children.some((route) => route.Component)).toBe(false);
  });
});

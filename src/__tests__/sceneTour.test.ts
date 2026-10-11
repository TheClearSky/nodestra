import { describe, expect, it } from 'vitest';
import { nextUnvisited, parseVisited, unvisitedCount } from '../landing/sceneTour';

const ORDER = ['piano', 'guitar', 'sakura', 'hell'] as const;

describe('sceneTour', () => {
  it('suggests the next unvisited scene in arrow order, wrapping, never the current one', () => {
    expect(nextUnvisited(ORDER, 'piano', new Set())).toBe('guitar');
    expect(nextUnvisited(ORDER, 'sakura', new Set(['hell'] as const))).toBe('piano');
    expect(nextUnvisited(ORDER, 'hell', new Set(['piano', 'guitar'] as const))).toBe('sakura');
    expect(nextUnvisited(ORDER, 'guitar', new Set(['piano', 'sakura', 'hell'] as const))).toBeNull();
  });

  it('counts the other scenes still unvisited', () => {
    expect(unvisitedCount(ORDER, 'piano', new Set())).toBe(3);
    expect(unvisitedCount(ORDER, 'piano', new Set(['piano', 'hell'] as const))).toBe(2);
    expect(unvisitedCount(ORDER, 'hell', new Set(['piano', 'guitar', 'sakura'] as const))).toBe(0);
  });

  it('keeps only known ids from storage and forgets rubbish', () => {
    expect([...parseVisited('["guitar","nope","hell"]', ORDER)]).toEqual(['guitar', 'hell']);
    expect(parseVisited('{"guitar":1}', ORDER).size).toBe(0);
    expect(parseVisited('not json', ORDER).size).toBe(0);
    expect(parseVisited(null, ORDER).size).toBe(0);
  });
});

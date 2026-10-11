/**
 * The start stage's play buttons each install a demo by id. An id that no
 * longer resolves would throw inside the button's loan and leave the visitor
 * with a silent instrument — so every one is built here.
 */

import { describe, expect, it } from 'vitest';
import { LANDING_GRAPHS, landingGraphState } from '../soundDefinitions/landingGraphs';

describe('landing instruments', () => {
  for (const instrument of Object.keys(LANDING_GRAPHS) as Array<keyof typeof LANDING_GRAPHS>) {
    it(`${instrument} (${LANDING_GRAPHS[instrument]}) builds a graph`, () => {
      expect(landingGraphState(instrument).nodes.length).toBeGreaterThan(0);
    });
  }
});

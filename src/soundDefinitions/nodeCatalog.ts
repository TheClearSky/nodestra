/**
 * The COMPLETE node registry: base catalog + the generated instrument
 * library. State assembly and the registry-wins persistence merge consume
 * THIS map; the base `nodeTypes.ts` map stays instrument-free so
 * `groupBuilder` can construct instrument subtrees against it without a
 * cycle.
 */

import { instrumentNodeTypes } from './instruments';
import { physicalInstrumentNodeTypes } from './instruments/physical';
import { soundNodeTypes as baseSoundNodeTypes } from './nodeTypes';
import { effectNodeTypes } from './effects';

const soundNodeTypes = {
  ...baseSoundNodeTypes,
  ...instrumentNodeTypes,
  // Hand-written Phase D string models. They live in their own barrel
  // because `tools/recipes-to-nodegroups.ts` deletes any `inst_*.ts` in
  // `instruments/` that is not in ITS ship set, and rewrites that barrel.
  ...physicalInstrumentNodeTypes,
  // Easy Effects: hand-written effect node groups with layman knobs.
  ...effectNodeTypes,
};

type SoundCatalogNodeTypeId = keyof typeof soundNodeTypes;

export { soundNodeTypes };
export type { SoundCatalogNodeTypeId };

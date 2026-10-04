/**
 * The starter demo graph, composed statically with `constructNodeOfType` so
 * the app opens on an audible-on-Run chain: Drawn Osc → Gain → Render.
 */

import {
  constructNodeOfType,
  makeStateWithAutoInfer,
  standardHiddenNodeTypesInContextMenu,
  standardNodeCountConstraints,
} from '@theclearsky/react-blender-nodes';
import {
  allowedConversionsBetweenDataTypes,
  soundDataTypes,
} from './dataTypes';
import { soundNodeTypes } from './nodeCatalog';

function findInputHandleId(
  node: ReturnType<typeof constructNodeOfType>,
  name: string,
): string {
  const input = (node.data.inputs ?? []).find(
    (candidate) => candidate.name === name,
  );
  if (!input) throw new Error(`demo graph: missing input handle "${name}"`);
  return input.id;
}

function findOutputHandleId(
  node: ReturnType<typeof constructNodeOfType>,
  name: string,
): string {
  const output = (node.data.outputs ?? []).find(
    (candidate) => candidate.name === name,
  );
  if (!output) throw new Error(`demo graph: missing output handle "${name}"`);
  return output.id;
}

const drawnOscNode = constructNodeOfType(
  soundDataTypes,
  'drawnOsc',
  soundNodeTypes,
  'demo-drawn-osc',
  { x: 60, y: 140 },
);
const gainNode = constructNodeOfType(
  soundDataTypes,
  'gain',
  soundNodeTypes,
  'demo-gain',
  { x: 620, y: 200 },
);
const renderNode = constructNodeOfType(
  soundDataTypes,
  'render',
  soundNodeTypes,
  'demo-render',
  { x: 1100, y: 220 },
);

const initialSoundState = makeStateWithAutoInfer({
  dataTypes: soundDataTypes,
  typeOfNodes: soundNodeTypes,
  nodes: [drawnOscNode, gainNode, renderNode],
  edges: [
    // `type: 'configurableEdge'` is REQUIRED on statically-built edges (host
    // stories convention): without it ReactFlow falls back to its default
    // thin dark bezier instead of the host's handle-colored edge.
    {
      id: 'demo-edge-osc-gain',
      source: 'demo-drawn-osc',
      sourceHandle: findOutputHandleId(drawnOscNode, 'Out'),
      target: 'demo-gain',
      targetHandle: findInputHandleId(gainNode, 'In'),
      type: 'configurableEdge',
    },
    {
      id: 'demo-edge-gain-render',
      source: 'demo-gain',
      sourceHandle: findOutputHandleId(gainNode, 'Out'),
      target: 'demo-render',
      targetHandle: findInputHandleId(renderNode, 'In'),
      type: 'configurableEdge',
    },
  ],
  // Edge discipline — without these flags the host allows ANY edge.
  enableComplexTypeChecking: true,
  enableCycleChecking: true,
  allowedConversionsBetweenDataTypes,
  // Boundary nodes pinned to exactly one per subtree, none at root (host
  // standard constraints); inference REQUIRED for group boundary handles
  // to grow (edges to groupInfer templates are silently rejected
  // without it).
  nodeCountConstraints: standardNodeCountConstraints,
  enableRecursionChecking: true,
  enableTypeInference: true,
  // Boundary/loop/switch internals stay OUT of the Add menu.
  hiddenNodeTypesInContextMenu: standardHiddenNodeTypesInContextMenu,
});

export { initialSoundState };

/**
 * Instrument node-group builder: turns a generated InstrumentSpec (pure
 * data) into a registry group TypeOfNode at module scope — synchronous,
 * because the autosave boot path requires it.
 *
 * The emitted shape mirrors a live capture of an interactively built
 * group byte-for-byte in structure:
 * - outer `inputs`/`outputs` are plain TypeOfInput literals;
 * - the groupInput boundary node carries one OUTPUT handle per outer
 *   input (same order, same name, `type: 'unsupportedDirectly'`,
 *   colored by the data type) plus one trailing `groupInfer` spare;
 * - groupOutput mirrors the outer outputs as INPUT handles + spare;
 * - subtree edges are plain configurableEdge records on handle ids.
 *
 * Inner nodes are constructed through the host's own
 * `constructNodeOfType` (the proven probeGraphs pattern) so inner
 * handle shapes can never drift from the registry; ids here are STABLE
 * (derived from the instrument id, so regeneration never re-ids).
 *
 * Boundary inputs are edges-only by default (`allowInput: false` — the
 * host renders no dead knob) and take ONE connection. A spec may make one a
 * KNOB (`allowInput: true` + `defaultValue`, optional `min`/`max`/`step`):
 * the value typed on the group node then flows inside (host group runner),
 * which is what the Easy Effects' layman controls are.
 */

import { constructNodeOfType } from '@theclearsky/react-blender-nodes';
import { soundDataTypes } from '../dataTypes';
import type { SoundDataTypeId } from '../dataTypes';
import type { SoundNodeTypeId } from '../nodeTypes';
import { soundNodeTypes } from '../nodeTypes';

// The catalog's node types are HETEROGENEOUS (each auto-infer call
// narrowed its own data-type union), so no single explicit generic
// instantiation types the construction. The proven idiom is
// probeGraphs': let arguments drive inference and hold results behind
// a minimal structural type, with ONE documented cast at the registry
// boundary (`as unknown as InstrumentTypeOfNode` below).
type ConstructedNode = {
  id: string;
  position: { x: number; y: number };
  data: {
    inputs?: unknown[];
    outputs?: unknown[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};
type ConstructedHandle = { id: string; name: string; value?: unknown };

/** The registry value shape consumers accept (the base catalog's own
 *  union — group types ride the optional `subtree` field). */
type InstrumentTypeOfNode = (typeof soundNodeTypes)[SoundNodeTypeId];

type InstrumentNodeSpec = {
  id: string;
  type: SoundNodeTypeId;
  x: number;
  y: number;
  /** Input values to seed post-construction (knobs, enums, waveforms). */
  values?: Record<string, unknown>;
};

/** `from`/`to` may be an inner node id, or the pseudo-ids `$in`/`$out`
 *  (the boundary nodes); `output`/`input` are HANDLE NAMES — for
 *  boundaries, the contract name of the outer input/output. */
type InstrumentEdgeSpec = {
  from: string;
  output: string;
  to: string;
  input: string;
};

type InstrumentBoundaryInput = {
  name: string;
  dataType: SoundDataTypeId;
  /** Mirrors the connected inner handle's cap (the live capture shows
   *  boundary handles inherit it — e.g. Gate carries 1). */
  maxConnections?: number;
  /** A knob on the group node: its typed value flows inside. */
  allowInput?: boolean;
  defaultValue?: string | number;
  min?: number;
  max?: number;
  step?: number;
  /** In-app docs behind the socket's ⓘ. */
  description?: string;
};

type InstrumentSpec = {
  id: string;
  name: string;
  family: string;
  headerColor: string;
  /** In-app docs behind the group's ⓘ. */
  description?: string;
  /** Add-menu placement; defaults to Instruments › `family`. */
  menuPath?: string[];
  priorityInContextMenu?: number;
  inputs: InstrumentBoundaryInput[];
  outputs: InstrumentBoundaryInput[];
  nodes: InstrumentNodeSpec[];
  edges: InstrumentEdgeSpec[];
};

function handleSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** A typed boundary handle exactly as the live capture shows it. */
function boundaryHandle(
  instrumentId: string,
  side: 'bi' | 'bo',
  spec: InstrumentBoundaryInput,
): Record<string, unknown> {
  const dataTypeObject = soundDataTypes[spec.dataType];
  return {
    id: `${instrumentId}-${side}-${handleSlug(spec.name)}`,
    name: spec.name,
    handleColor: dataTypeObject.color,
    allowInput: dataTypeObject.allowInput,
    ...(spec.maxConnections !== undefined
      ? { maxConnections: spec.maxConnections }
      : {}),
    type: 'unsupportedDirectly' as const,
    dataType: {
      dataTypeObject,
      dataTypeUniqueId: spec.dataType,
    },
    inferredDataType: {
      dataTypeObject,
      dataTypeUniqueId: spec.dataType,
    },
  };
}

/** The trailing `groupInfer` spare handle every boundary node carries. */
function spareHandle(instrumentId: string, side: 'bi' | 'bo') {
  const groupInfer = soundDataTypes.groupInfer;
  return {
    id: `${instrumentId}-${side}-spare`,
    name: '',
    handleColor: groupInfer.color,
    type: 'unsupportedDirectly' as const,
    dataType: {
      dataTypeObject: groupInfer,
      dataTypeUniqueId: 'groupInfer',
    },
  };
}

function boundaryNode(
  instrumentId: string,
  which: 'input' | 'output',
  handles: InstrumentBoundaryInput[],
  x: number,
): ConstructedNode {
  const isInput = which === 'input';
  const side = isInput ? 'bi' : 'bo';
  const typed = handles.map((handle) =>
    boundaryHandle(instrumentId, side, handle),
  );
  const all = [...typed, spareHandle(instrumentId, side)];
  return {
    id: `${instrumentId}-g${isInput ? 'in' : 'out'}`,
    position: { x, y: 0 },
    sourcePosition: 'right',
    targetPosition: 'left',
    type: 'configurableNode',
    width: 400,
    data: {
      name: isInput ? 'Group Input' : 'Group Output',
      headerColor: '#1d1d1d',
      inputs: isInput ? [] : all,
      outputs: isInput ? all : [],
      nodeTypeUniqueId: isInput ? 'groupInput' : 'groupOutput',
    },
  } as unknown as ConstructedNode;
}

function seedValues(
  node: ConstructedNode,
  values: Record<string, unknown>,
): void {
  for (const [inputName, value] of Object.entries(values)) {
    const input = (
      (node.data.inputs ?? []) as unknown as ConstructedHandle[]
    ).find((candidate) => candidate.name === inputName);
    if (!input) {
      throw new Error(
        `instrument builder: no input "${inputName}" on ${node.id}`,
      );
    }
    input.value = value;
  }
}

function findHandleId(
  node: ConstructedNode,
  handleName: string,
  direction: 'outputs' | 'inputs',
): string {
  const handle = (
    (node.data[direction] ?? []) as unknown as ConstructedHandle[]
  ).find((candidate) => candidate.name === handleName);
  if (!handle) {
    throw new Error(
      `instrument builder: no ${direction} handle "${handleName}" on ${node.id}`,
    );
  }
  return handle.id;
}

function buildInstrumentType(spec: InstrumentSpec) {
  // The boundaries sit just outside the inner nodes (fixed at ±500 they
  // landed in the middle of any wider group, on top of its nodes).
  const xs = spec.nodes.map((node) => node.x);
  const groupInput = boundaryNode(
    spec.id,
    'input',
    spec.inputs,
    Math.min(-500, ...xs.map((x) => x - 500)),
  );
  const groupOutput = boundaryNode(
    spec.id,
    'output',
    spec.outputs,
    Math.max(500, ...xs.map((x) => x + 500)),
  );
  const constructed = new Map<string, ConstructedNode>();
  constructed.set('$in', groupInput);
  constructed.set('$out', groupOutput);
  for (const nodeSpec of spec.nodes) {
    const node = constructNodeOfType(
      soundDataTypes,
      nodeSpec.type,
      soundNodeTypes,
      `${spec.id}-${nodeSpec.id}`,
      { x: nodeSpec.x, y: nodeSpec.y },
    ) as unknown as ConstructedNode;
    if (nodeSpec.values) seedValues(node, nodeSpec.values);
    constructed.set(nodeSpec.id, node);
  }

  const edges = spec.edges.map((edgeSpec, index) => {
    const source = constructed.get(edgeSpec.from);
    const target = constructed.get(edgeSpec.to);
    if (!source || !target) {
      throw new Error(
        `instrument builder: unknown edge endpoint ${edgeSpec.from} → ${edgeSpec.to}`,
      );
    }
    return {
      id: `${spec.id}-e${index}`,
      source: source.id,
      sourceHandle: findHandleId(source, edgeSpec.output, 'outputs'),
      target: target.id,
      targetHandle: findHandleId(target, edgeSpec.input, 'inputs'),
      type: 'configurableEdge' as const,
    };
  });

  const groupType = {
    name: spec.name,
    headerColor: spec.headerColor,
    ...(spec.description !== undefined && { description: spec.description }),
    locationInContextMenu: spec.menuPath ?? ['Instruments', spec.family],
    priorityInContextMenu: spec.priorityInContextMenu ?? 30,
    // Boundary inputs are single-connection; edges-only unless a knob.
    inputs: spec.inputs.map((input) => ({
      name: input.name,
      dataType: input.dataType,
      allowInput: input.allowInput ?? false,
      maxConnections: 1,
      ...(input.defaultValue !== undefined && {
        defaultValue: input.defaultValue,
      }),
      ...(input.min !== undefined && { min: input.min }),
      ...(input.max !== undefined && { max: input.max }),
      ...(input.step !== undefined && { step: input.step }),
      ...(input.description !== undefined && {
        description: input.description,
      }),
    })),
    outputs: spec.outputs.map((output) => ({
      name: output.name,
      dataType: output.dataType,
      ...(output.description !== undefined && {
        description: output.description,
      }),
    })),
    subtree: {
      nodes: [
        groupInput,
        groupOutput,
        ...spec.nodes.map(
          (nodeSpec) => constructed.get(nodeSpec.id) as ConstructedNode,
        ),
      ],
      edges,
      numberOfReferences: 0,
      inputNodeId: groupInput.id,
      outputNodeId: groupOutput.id,
    },
  };
  // The one registry-boundary cast (see the type note above): the
  // structure mirrors the live capture byte-for-byte and is verified
  // in-app; the heterogeneous catalog union cannot express it.
  return groupType as unknown as InstrumentTypeOfNode;
}

export type { InstrumentSpec };
export { buildInstrumentType };

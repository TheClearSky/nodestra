/**
 * A signature over everything that would change the SOUND of a re-run.
 *
 * Auto-run needs one question answered: "is the last run still the truth?".
 * Comparing whole states is wrong — dragging a node, opening a group, moving
 * the viewport or toggling a runner preference all change `State` without
 * changing a single sample of audio, and treating those as stale would re-run
 * the graph (and make sound) every time someone tidied the canvas.
 *
 * So the signature covers exactly what the compiler reads: each node's id and
 * type, its input VALUES, each edge's endpoints and its fan-in `order`, in
 * EVERY scope. Positions, selection, zones, history, `viewport` and
 * `runnerViewPreferences` are excluded.
 *
 * FIVE measured decisions:
 *
 * - **Every REACHABLE scope is walked, not just the root.** `state.nodes` is
 *   ALWAYS the root scope — the host returns a group's nodes only for the
 *   group that is currently OPEN (`constructAndModifyNodes.ts` ›
 *   `getCurrentNodesAndEdgesFromState`). A node group's contents live in
 *   `state.typeOfNodes[type].subtree`, and the compiler compiles those scopes
 *   too, so a root-only signature was blind to them: editing any knob inside
 *   an instantiated group left the signature identical and auto-run never
 *   fired. Measured across the 56 shipped demos, 18 instantiate group nodes.
 * - **…but only the reachable ones.** Every state also ships a 32-entry
 *   INSTRUMENT LIBRARY of group definitions (271 nodes) that most graphs never
 *   instantiate — the other 38 demos instantiate none of them. Hashing the
 *   library would make an edit to an unused definition mark the graph stale
 *   and fire a run that cannot sound different. So the walk starts from the
 *   node types used in the root scope and follows the types used inside each
 *   subtree it reaches: exactly the set the compiler compiles. A `visited` set
 *   makes it cycle-proof, and the reached ids are hashed in sorted order so
 *   traversal order can never leak into the result.
 * - **Fan-in `order` is part of the edge.** When several edges land on one
 *   input handle the compiler resolves them by `edge.data.order`
 *   (`nodeRunner/compiler.ts`), so re-ordering connections changes the result
 *   while leaving every endpoint identical.
 *
 * - **Panels are walked, not skipped.** A node's `inputs` array holds either an
 *   input (which has `value`) or a PANEL, which has no value of its own and
 *   carries nested `inputs` — the Reverb's settings, the Saturator's trim. A
 *   signature that only read `value` would be blind to every knob inside a
 *   panel, so a change there would never trigger an auto-run.
 * - **Inputs are keyed by INDEX, not by handle id.** Handle ids are minted
 *   randomly per construction, so an id-keyed signature described the identity
 *   of a particular build rather than the shape of the graph.
 * - **The result is a HASH, not the text.** A drawn-waveform input carries 256
 *   floats; the flagship demo serialized to tens of kilobytes, and that string
 *   would have been rebuilt on every keystroke. Hashing as we go keeps the work
 *   proportional and the memory constant. Two different graphs can in principle
 *   collide (32-bit FNV-1a) and a re-run would then be skipped; at roughly 1 in
 *   4e9 per comparison that is the better trade.
 * - **The timeline document is deliberately NOT included.** A run only reads a
 *   curve's IDENTITY (`implementations.ts` › `timelineCurve` hands
 *   `registry.acquireDriver(curveId)` an id); the curve's keyframes are read
 *   live by the transport at schedule time, so editing a curve is heard
 *   without re-running. Folding the document in would mark the graph stale
 *   every time the timeline drawer wrote to the store — which is the
 *   false-stale symptom this signature exists to avoid.
 */

type SignatureInput = {
  value?: unknown;
  /** Present on a PANEL, which groups inputs and has no value itself. */
  inputs?: readonly SignatureInput[];
};

type SignatureNode = {
  id: string;
  data?: {
    nodeTypeUniqueId?: string;
    inputs?: readonly SignatureInput[];
  };
};

type SignatureEdge = {
  source?: string;
  target?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  /** Fan-in rank when several edges share one input handle. */
  data?: { order?: unknown };
};

/** One compiled scope: the root graph, or one node group's definition. */
type SignatureScope = {
  nodes?: readonly SignatureNode[];
  edges?: readonly SignatureEdge[];
};

type SignatureState = SignatureScope & {
  /** The FLAT node-type registry; group types carry a `subtree` scope. */
  typeOfNodes?: Readonly<
    Record<string, { subtree?: SignatureScope } | undefined>
  >;
};

/** FNV-1a, 32-bit. Folded per chunk so no whole-graph string is ever built. */
function hashChunk(hash: number, chunk: string): number {
  let next = hash;
  for (let index = 0; index < chunk.length; index += 1) {
    next ^= chunk.charCodeAt(index);
    next = Math.imul(next, 0x01000193);
  }
  return next >>> 0;
}

/** `JSON.stringify` on an input value, with `undefined` and cycles made safe. */
function stringifyValue(value: unknown): string {
  if (value === undefined) return '~';
  try {
    return JSON.stringify(value) ?? '~';
  } catch {
    // A cyclic value (or a BigInt) cannot be serialized. Fall back to its type:
    // a run-affecting change inside such a value is then invisible, which is
    // safer than throwing on every keystroke.
    return `[${typeof value}]`;
  }
}

/** Fold one input, or every input of a panel, into the running hash. */
function hashInputs(
  hash: number,
  inputs: readonly SignatureInput[],
  path: string,
): number {
  let next = hash;
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const here = `${path}${index}`;
    if (input.inputs !== undefined) {
      next = hashInputs(next, input.inputs, `${here}.`);
    } else {
      next = hashChunk(next, `i${here}=${stringifyValue(input.value)}`);
    }
  }
  return next;
}

/** Fold one compiled scope — its nodes, their inputs, and its edges. */
function hashScope(hash: number, scope: SignatureScope, label: string): number {
  const nodes = scope.nodes ?? [];
  const edges = scope.edges ?? [];
  // The label brackets the scope, so moving a node between scopes registers
  // even when the node itself is byte-identical.
  let next = hashChunk(hash, `[${label}`);
  for (const node of nodes) {
    next = hashChunk(next, `n:${node.id}:${node.data?.nodeTypeUniqueId ?? ''}`);
    next = hashInputs(next, node.data?.inputs ?? [], '');
  }
  for (const edge of edges) {
    const order = edge.data?.order;
    next = hashChunk(
      next,
      `e:${edge.source ?? ''}.${edge.sourceHandle ?? ''}>${edge.target ?? ''}.${edge.targetHandle ?? ''}@${typeof order === 'number' ? order : '~'}`,
    );
  }
  // The counts go in too, so a scope cannot collide with a prefix of itself.
  return hashChunk(next, `#${nodes.length}/${edges.length}]`);
}

/** Every node type INSTANTIATED in one scope. */
function typesUsedIn(scope: SignatureScope): string[] {
  const used: string[] = [];
  for (const node of scope.nodes ?? []) {
    const typeId = node.data?.nodeTypeUniqueId;
    if (typeId !== undefined) used.push(typeId);
  }
  return used;
}

function graphSignature(state: SignatureState): string {
  let hash = hashScope(0x811c9dc5, state, 'root');
  const typeOfNodes = state.typeOfNodes;
  if (typeOfNodes === undefined) return hash.toString(16);

  // Reachability closure from the root scope: a group's definition counts only
  // if something instantiates it, and a group instantiated INSIDE a reached
  // subtree counts too.
  const reachedGroupIds: string[] = [];
  const visited = new Set<string>();
  const frontier = typesUsedIn(state);
  while (frontier.length > 0) {
    const typeId = frontier.pop() as string;
    if (visited.has(typeId)) continue; // also what makes this cycle-proof
    visited.add(typeId);
    const subtree = typeOfNodes[typeId]?.subtree;
    if (subtree === undefined) continue; // a plain node type, nothing to walk
    reachedGroupIds.push(typeId);
    frontier.push(...typesUsedIn(subtree));
  }

  // Sorted: the signature describes WHICH definitions were reached, never the
  // order the traversal happened to reach them in.
  for (const typeId of reachedGroupIds.sort()) {
    const subtree = typeOfNodes[typeId]?.subtree;
    if (subtree !== undefined) hash = hashScope(hash, subtree, `g:${typeId}`);
  }
  return hash.toString(16);
}

export { graphSignature };
export type { SignatureScope, SignatureState };

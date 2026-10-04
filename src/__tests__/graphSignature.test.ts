import { describe, expect, it } from 'vitest';
import { graphSignature } from '../soundDefinitions/graphSignature';
import type {
  SignatureScope,
  SignatureState,
} from '../soundDefinitions/graphSignature';
import { buildProbeGraphState } from '../soundDefinitions/probeGraphs';

// Auto-run asks one question of this function: "would re-running produce
// something different?". These tests pin both halves of that — what must
// change the signature, and what must NOT.

describe('graphSignature', () => {
  it('is stable for the same state and differs between different demos', () => {
    const state = buildProbeGraphState('curveOrchestra');
    const other = buildProbeGraphState('sfxAlarm');
    // Called twice on the SAME object — the invariant auto-run relies on.
    expect(graphSignature(state)).toBe(graphSignature(state));
    expect(graphSignature(state)).not.toBe(graphSignature(other));
  });

  it('is a short hash, not the serialized graph (a drawn wave alone is 256 floats)', () => {
    const state = buildProbeGraphState('curveOrchestra');
    expect(graphSignature(state)).toMatch(/^[0-9a-f]{1,8}$/);
  });

  it('two builds of the same demo differ — handle ids are minted per build, so a fresh load is correctly stale', () => {
    // Not a defect: re-loading a demo replaces every id, and the run that
    // preceded it genuinely no longer describes what is on the canvas.
    expect(graphSignature(buildProbeGraphState('curveOrchestra'))).not.toBe(
      graphSignature(buildProbeGraphState('curveOrchestra')),
    );
  });

  it('IGNORES node positions — tidying the canvas must not mark a run stale', () => {
    const state = buildProbeGraphState('curveOrchestra');
    const before = graphSignature(state);
    const moved = {
      ...state,
      nodes: state.nodes.map((node, index) =>
        index === 0
          ? { ...node, position: { x: node.position.x + 400, y: 77 } }
          : node,
      ),
    };
    expect(graphSignature(moved)).toBe(before);
  });

  it('IGNORES view-only state (viewport, runner preferences, selection)', () => {
    const state = buildProbeGraphState('curveOrchestra');
    const before = graphSignature(state);
    expect(
      graphSignature({
        ...state,
        viewport: { x: 10, y: 20, zoom: 2 },
        runnerViewPreferences: { autoScroll: true, followIntoGroups: true },
        nodes: state.nodes.map((node, index) =>
          index === 0 ? { ...node, selected: true } : node,
        ),
      } as typeof state),
    ).toBe(before);
  });

  it('CHANGES when an input value changes', () => {
    const state = buildProbeGraphState('curveOrchestra');
    const before = graphSignature(state);
    const nodeIndex = state.nodes.findIndex(
      (node) => (node.data?.inputs?.length ?? 0) > 0,
    );
    expect(nodeIndex).toBeGreaterThanOrEqual(0);
    const edited = {
      ...state,
      nodes: state.nodes.map((node, index) =>
        index === nodeIndex
          ? {
              ...node,
              data: {
                ...node.data,
                inputs: (node.data.inputs ?? []).map((input, i) =>
                  i === 0 ? { ...input, value: 'signature-probe' } : input,
                ),
              },
            }
          : node,
      ),
    };
    expect(graphSignature(edited as typeof state)).not.toBe(before);
  });

  it('CHANGES when an edge is removed', () => {
    const state = buildProbeGraphState('curveOrchestra');
    const before = graphSignature(state);
    expect(
      graphSignature({ ...state, edges: state.edges.slice(1) }),
    ).not.toBe(before);
  });

  it('survives a value that cannot be serialized (a cycle) instead of throwing', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      graphSignature({
        nodes: [{ id: 'n1', data: { inputs: [{ value: cyclic }] } }],
        edges: [],
      }),
    ).not.toThrow();
  });
});

describe('node group subtrees', () => {
  // `state.nodes` is ALWAYS the ROOT scope (host:
  // `constructAndModifyNodes.ts` › `getCurrentNodesAndEdgesFromState` returns
  // `subtree.nodes` only for the OPEN group). A group definition's nodes live
  // in `state.typeOfNodes[type].subtree`, and the compiler compiles the scopes
  // the graph instantiates — so the signature must reach them, and must reach
  // ONLY them: every state also ships a 32-entry instrument LIBRARY of group
  // definitions that most graphs never instantiate.
  //
  // `padSolo` is one of the 18 shipped demos that DO instantiate groups (12
  // group nodes at the root); `bellClub` is one of the 38 that instantiate
  // none, carrying the library untouched.
  const withGroups = () => buildProbeGraphState('padSolo');
  const withoutGroups = () => buildProbeGraphState('bellClub');

  /** Group definitions the graph actually instantiates at the root. */
  function instantiatedGroupTypeIds(
    state: ReturnType<typeof buildProbeGraphState>,
  ): string[] {
    return [
      ...new Set(
        state.nodes
          .map((node) => node.data?.nodeTypeUniqueId as string)
          .filter((typeId) => state.typeOfNodes[typeId]?.subtree !== undefined),
      ),
    ];
  }

  it('the fixtures are what these tests assume: one instantiates groups, one does not', () => {
    expect(instantiatedGroupTypeIds(withGroups()).length).toBeGreaterThan(0);
    expect(instantiatedGroupTypeIds(withoutGroups())).toEqual([]);
    // Both nonetheless carry the whole library.
    for (const state of [withGroups(), withoutGroups()]) {
      const libraryNodes = Object.values(state.typeOfNodes).reduce(
        (total, typeOfNode) => total + (typeOfNode?.subtree?.nodes?.length ?? 0),
        0,
      );
      expect(libraryNodes).toBeGreaterThan(100);
    }
  });

  /** The state, with ONE group definition's subtree scope replaced. */
  function withEditedSubtree(
    state: ReturnType<typeof buildProbeGraphState>,
    typeKey: string,
    edit: (subtree: SignatureScope) => SignatureScope,
  ) {
    const typeOfNode = state.typeOfNodes[typeKey];
    return {
      ...state,
      typeOfNodes: {
        ...state.typeOfNodes,
        [typeKey]: { ...typeOfNode, subtree: edit(typeOfNode.subtree ?? {}) },
      },
    } as unknown as SignatureState;
  }

  /** Retype the first input of the first node in a subtree that has one. */
  const editFirstInput = (subtree: SignatureScope): SignatureScope => {
    const nodes = subtree.nodes ?? [];
    const target = nodes.findIndex(
      (node) => (node.data?.inputs?.length ?? 0) > 0,
    );
    expect(target).toBeGreaterThanOrEqual(0);
    return {
      ...subtree,
      nodes: nodes.map((node, index) =>
        index === target
          ? {
              ...node,
              data: {
                ...node.data,
                inputs: (node.data?.inputs ?? []).map((input, i) =>
                  i === 0
                    ? { ...input, value: 'subtree-signature-probe' }
                    : input,
                ),
              },
            }
          : node,
      ),
    };
  };

  it('CHANGES when an input inside an INSTANTIATED group definition changes', () => {
    const state = withGroups();
    const typeKey = instantiatedGroupTypeIds(state).find((id) =>
      state.typeOfNodes[id]?.subtree?.nodes?.some(
        (node) => (node.data?.inputs?.length ?? 0) > 0,
      ),
    );
    expect(typeKey).toBeDefined();
    expect(
      graphSignature(
        withEditedSubtree(state, typeKey as string, editFirstInput),
      ),
    ).not.toBe(graphSignature(state));
  });

  it('CHANGES when an edge inside an INSTANTIATED group definition is removed', () => {
    const state = withGroups();
    const typeKey = instantiatedGroupTypeIds(state).find(
      (id) => (state.typeOfNodes[id]?.subtree?.edges?.length ?? 0) > 0,
    );
    expect(typeKey).toBeDefined();
    expect(
      graphSignature(
        withEditedSubtree(state, typeKey as string, (subtree) => ({
          ...subtree,
          edges: (subtree.edges ?? []).slice(1),
        })),
      ),
    ).not.toBe(graphSignature(state));
  });

  it('IGNORES an UNINSTANTIATED library definition — editing it cannot change a sample', () => {
    const state = withoutGroups();
    const typeKey = Object.keys(state.typeOfNodes).find((key) =>
      state.typeOfNodes[key]?.subtree?.nodes?.some(
        (node) => (node.data?.inputs?.length ?? 0) > 0,
      ),
    );
    expect(typeKey).toBeDefined();
    expect(
      graphSignature(
        withEditedSubtree(state, typeKey as string, editFirstInput),
      ),
    ).toBe(graphSignature(state));
  });
});

describe('fan-in connection order', () => {
  // Several edges into ONE input handle are resolved by `edge.data.order`
  // (host: `nodeRunner/compiler.ts`). Re-ordering them changes the result
  // while every endpoint stays identical.
  const fanIn = (firstOrder: number, secondOrder: number) => ({
    nodes: [
      { id: 'a', data: { nodeTypeUniqueId: 'osc' } },
      { id: 'b', data: { nodeTypeUniqueId: 'osc' } },
      { id: 'mix', data: { nodeTypeUniqueId: 'mixer' } },
    ],
    edges: [
      {
        source: 'a',
        sourceHandle: 'out',
        target: 'mix',
        targetHandle: 'in',
        data: { order: firstOrder },
      },
      {
        source: 'b',
        sourceHandle: 'out',
        target: 'mix',
        targetHandle: 'in',
        data: { order: secondOrder },
      },
    ],
  });

  it('CHANGES when two edges into the same handle swap order', () => {
    expect(graphSignature(fanIn(0, 1))).not.toBe(graphSignature(fanIn(1, 0)));
  });

  it('is stable when the order values are unchanged', () => {
    expect(graphSignature(fanIn(0, 1))).toBe(graphSignature(fanIn(0, 1)));
  });
});

describe('panels', () => {
  it('CHANGES when a value nested inside a PANEL changes — panels have no value of their own', () => {
    const state = {
      nodes: [
        {
          id: 'reverb',
          data: {
            nodeTypeUniqueId: 'reverb',
            inputs: [
              { value: 1 },
              { inputs: [{ value: 0.38 }, { value: 6 }] },
            ],
          },
        },
      ],
      edges: [],
    };
    const before = graphSignature(state);
    const edited = {
      ...state,
      nodes: [
        {
          ...state.nodes[0],
          data: {
            ...state.nodes[0].data,
            inputs: [
              { value: 1 },
              { inputs: [{ value: 0.38 }, { value: 9 }] },
            ],
          },
        },
      ],
    };
    expect(graphSignature(edited)).not.toBe(before);
  });

  it('a panel with the same nested values hashes the same', () => {
    const make = () => ({
      nodes: [
        { id: 'n', data: { inputs: [{ inputs: [{ value: 2 }] }] } },
      ],
      edges: [],
    });
    expect(graphSignature(make())).toBe(graphSignature(make()));
  });
});

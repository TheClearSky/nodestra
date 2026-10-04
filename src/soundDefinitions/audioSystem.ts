/**
 * Build lifecycle for the live audio graph, including the run envelope.
 *
 * One Run = one Build. Every implementation registers what it creates;
 * beginning the next build disposes the previous one in REVERSE registration
 * order. This module is deliberately Tone-free — it manages opaque
 * disposables so the unit tests exercise the REAL lifecycle with fake nodes.
 * Tone-specific bootstrapping (master bus, pitch signal, recorder) lives in
 * the app layer and is persistent — never registered here.
 */

type Disposable = {
  dispose: () => void;
};

type GateTarget = {
  triggerAttack: () => void;
  triggerRelease: () => void;
};

/** Thrown when an implementation of a KILLED run tries to build.
 *  Distinct from `BuildSupersededError`: that one means "a newer build won";
 *  this one means "this run was abandoned and must not build at all". */
class BuildKilledError extends Error {
  constructor() {
    super(
      'This run was stopped and its build torn down; a later implementation ' +
        'of the same run must not start a new one.',
    );
    this.name = 'BuildKilledError';
  }
}

/** Thrown by async implementations that resumed after their build died. */
class BuildSupersededError extends Error {
  constructor(supersededBuildId: number, currentBuildId: number) {
    super(
      `Build ${supersededBuildId} superseded by build ${currentBuildId}; ` +
        'the resuming implementation must not touch the live graph.',
    );
    this.name = 'BuildSupersededError';
  }
}

/** A dispose callback re-entered the lifecycle — a programming error that
 *  must surface loudly, NOT be swallowed by per-item dispose isolation. */
class LifecycleReentryError extends Error {
  constructor() {
    super('audioSystem lifecycle re-entered during dispose');
    this.name = 'LifecycleReentryError';
  }
}

let currentBuildId = 0;
let registry: Disposable[] = [];
let gateTargets: GateTarget[] = [];
let lastRunToken: unknown = undefined;
let inLifecycleCall = false;
/**
 * Every run token whose build was explicitly torn down (Esc, the header Stop,
 * a project replace). Any LATER implementation of such a run is refused.
 *
 * Without this, `disposeBuild` only cleared `lastRunToken`, so the very next
 * implementation of the still-draining run failed the "join" test, took the
 * `beginBuild()` branch, and finished the abandoned graph into a BRAND NEW
 * epoch — i.e. the corpse of the previous project became the current, audible
 * build. Silencing the graph has to mean the run cannot rebuild it.
 *
 * A SET, not a single slot: killing run A and then starting run B must not
 * un-kill A. A's stragglers keep arriving after B has begun, and a single slot
 * cleared by B would let them tear down B's build and replace it with A's
 * corpse. Weak, because the key is the run's `AbortSignal` and entries should
 * vanish with it — this never needs pruning.
 */
let killedRunTokens = new WeakSet<object>();

/** Only object tokens can be remembered; `ensureBuild` ignores `undefined`
 *  and a primitive token is not something the host ever hands us. */
function isRememberableToken(token: unknown): token is object {
  return typeof token === 'object' && token !== null;
}

/** Tear down every registered disposable (reverse order, error-isolated). */
function teardownRegistry(): void {
  if (inLifecycleCall) {
    throw new LifecycleReentryError();
  }
  inLifecycleCall = true;
  try {
    for (let i = registry.length - 1; i >= 0; i--) {
      try {
        registry[i].dispose();
      } catch (error) {
        // A dispose callback re-entering the lifecycle is a programming
        // error — rethrow it. Anything else (e.g. a double-disposed Tone
        // node throwing) must not leak the rest of the build.
        if (error instanceof LifecycleReentryError) throw error;
        console.warn('[audioSystem] dispose failed for a registered node', error);
      }
    }
    registry = [];
    gateTargets = [];
  } finally {
    inLifecycleCall = false;
  }
}

/**
 * Dispose the current build AND invalidate its epoch: bumping
 * `currentBuildId` makes every outstanding chain stale (previews
 * flatline instead of touching disposed nodes) and trips
 * `assertNotSuperseded` in any in-flight async implementation; clearing
 * `lastRunToken` stops a continued host run from silently re-joining the
 * disposed build.
 */
function disposeBuild(): void {
  // Record the kill BEFORE clearing `lastRunToken`. Adding to a set (rather
  // than assigning a slot) is what makes the SECOND dispose harmless: a
  // project replace disposes twice — once from the runner's abort event, once
  // as an unconditional floor — and the second call sees `lastRunToken`
  // already cleared.
  const killed = lastRunToken;
  teardownRegistry();
  currentBuildId += 1;
  lastRunToken = undefined;
  if (isRememberableToken(killed)) killedRunTokens.add(killed);
}

/** Start a fresh build (disposing the previous one first). */
function beginBuild(): number {
  teardownRegistry();
  currentBuildId += 1;
  return currentBuildId;
}

/**
 * The run envelope: the host exposes no run-start hook, but every run gets
 * a FRESH AbortSignal — its identity is the run token.
 * Every implementation calls `ensureBuild(context.abortSignal)` (via the
 * shared factory wrapper): the first impl of a new run begins the build,
 * the rest join it.
 */
function ensureBuild(runToken: unknown): number {
  if (runToken !== undefined && runToken === lastRunToken) {
    return currentBuildId;
  }
  // A run whose build was torn down is over. Refusing here is what makes
  // "silence it" and "replace the project" actually stick: the remaining
  // implementations of that run throw instead of resurrecting it into a new
  // epoch. The host marks their steps errored and the run ends.
  if (isRememberableToken(runToken) && killedRunTokens.has(runToken)) {
    throw new BuildKilledError();
  }
  lastRunToken = runToken;
  return beginBuild();
}

/** Register a per-build disposable. Call IMMEDIATELY after creating a node
 *  — created-but-unregistered nodes escape disposal forever. */
function registerDisposable(disposable: Disposable): void {
  if (inLifecycleCall) {
    // Registering from inside the dispose walk would be silently wiped —
    // dispose it right away instead.
    console.warn(
      '[audioSystem] registerDisposable during teardown — disposing immediately',
    );
    try {
      disposable.dispose();
    } catch {
      // best-effort
    }
    return;
  }
  registry.push(disposable);
}

function registrySize(): number {
  return registry.length;
}

function getCurrentBuildId(): number {
  return currentBuildId;
}

function isCurrentBuild(buildId: number): boolean {
  return buildId === currentBuildId;
}

/** Async-impl guard: call after EVERY await. */
function assertNotSuperseded(buildId: number): void {
  if (buildId !== currentBuildId) {
    throw new BuildSupersededError(buildId, currentBuildId);
  }
}

// ── Gate bus: keyboard down/up fans out to this build's ADSRs ──

function registerGateTarget(target: GateTarget): void {
  if (inLifecycleCall) {
    console.warn('[audioSystem] registerGateTarget during teardown — ignored');
    return;
  }
  gateTargets.push(target);
}

function gateOn(): void {
  for (const target of gateTargets) {
    try {
      target.triggerAttack();
    } catch (error) {
      // One broken envelope must not block the rest of the fan-out.
      console.warn('[audioSystem] gate attack failed', error);
    }
  }
}

function gateOff(): void {
  for (const target of gateTargets) {
    try {
      target.triggerRelease();
    } catch (error) {
      console.warn('[audioSystem] gate release failed', error);
    }
  }
}

function gateTargetCount(): number {
  return gateTargets.length;
}

/** Test-only: reset every module-level slot to the pristine state. */
function resetForTests(): void {
  currentBuildId = 0;
  registry = [];
  gateTargets = [];
  lastRunToken = undefined;
  killedRunTokens = new WeakSet();
  inLifecycleCall = false;
}

export {
  BuildKilledError,
  BuildSupersededError,
  LifecycleReentryError,
  assertNotSuperseded,
  beginBuild,
  disposeBuild,
  ensureBuild,
  gateOff,
  gateOn,
  gateTargetCount,
  getCurrentBuildId,
  isCurrentBuild,
  registerDisposable,
  registerGateTarget,
  registrySize,
  resetForTests,
};
export type { Disposable, GateTarget };

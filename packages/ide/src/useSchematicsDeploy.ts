import type {
  DeployConnectRequest,
  DeployConnection,
  DeployConnectionOptions,
  DeployPlan,
  DeployRun,
  SchematicsDeployService,
} from "@schematics/protocol";
import { Effect, Fiber, Stream } from "effect";
import { AtomRef } from "effect/unstable/reactivity";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { combineRefs } from "./reactive-ref";

export interface SchematicsDeployViewModel {
  readonly connection: DeployConnection | null;
  readonly connectionOptions: DeployConnectionOptions | null;
  readonly plan: DeployPlan | null;
  readonly runs: readonly DeployRun[];
  readonly sync: { readonly total: number; readonly hydrated: number } | null;
  /** Label of the in-flight action, or null when idle. */
  readonly busy: string | null;
  readonly error: string | null;
  /** Resource file paths whose live state diverged from the working tree (drift). */
  readonly driftPaths: ReadonlySet<string>;
  readonly connect: (request: DeployConnectRequest) => void;
  readonly pull: () => void;
  readonly plan_: () => void;
  readonly apply: (allowDelete: boolean) => void;
  readonly destroy: () => void;
  readonly dismissError: () => void;
}

interface DeployState {
  readonly connection: DeployConnection | null;
  readonly connectionOptions: DeployConnectionOptions | null;
  readonly plan: DeployPlan | null;
  readonly runs: readonly DeployRun[];
  readonly sync: { readonly total: number; readonly hydrated: number } | null;
  readonly busy: string | null;
  readonly error: string | null;
  readonly driftPaths: ReadonlySet<string>;
}

interface SchematicsDeployStore {
  readonly stateRef: AtomRef.ReadonlyRef<DeployState>;
  readonly start: () => void;
  readonly stop: () => void;
  readonly connect: (request: DeployConnectRequest) => void;
  readonly pull: () => void;
  readonly plan_: () => void;
  readonly apply: (allowDelete: boolean) => void;
  readonly destroy: () => void;
  readonly dismissError: () => void;
}

/**
 * Effect-reactive store for the deploy lifecycle. State lives in `AtomRef`s
 * (the same primitive as the artifact-project store), mutated by the watch
 * subscription and the lifecycle actions, and projected into one derived
 * `stateRef` that React binds to via `useSyncExternalStore`.
 */
function createSchematicsDeployStore(deploy: SchematicsDeployService): SchematicsDeployStore {
  const connectionRef = AtomRef.make<DeployConnection | null>(null);
  const connectionOptionsRef = AtomRef.make<DeployConnectionOptions | null>(null);
  const planRef = AtomRef.make<DeployPlan | null>(null);
  const runsRef = AtomRef.make<readonly DeployRun[]>([]);
  const syncRef = AtomRef.make<{ total: number; hydrated: number } | null>(null);
  const busyRef = AtomRef.make<string | null>(null);
  const errorRef = AtomRef.make<string | null>(null);

  const stateRef = combineRefs<DeployState>(
    [connectionRef, connectionOptionsRef, planRef, runsRef, syncRef, busyRef, errorRef],
    () => ({
      connection: connectionRef.value,
      connectionOptions: connectionOptionsRef.value,
      plan: planRef.value,
      runs: runsRef.value,
      sync: syncRef.value,
      busy: busyRef.value,
      error: errorRef.value,
      driftPaths: new Set(
        (planRef.value?.changes ?? [])
          .filter((change) => change.action !== "noop")
          .map((change) => change.path),
      ),
    }),
  );

  const upsertRun = (run: DeployRun) => {
    const current = runsRef.value;
    const index = current.findIndex((candidate) => candidate.id === run.id);
    runsRef.set(
      index < 0
        ? [...current, run]
        : current.map((candidate, i) => (i === index ? run : candidate)),
    );
  };

  let watchFiber: Fiber.Fiber<void, unknown> | null = null;

  const start = () => {
    if (watchFiber) return;
    Effect.runPromise(deploy.getConnection)
      .then((value) => connectionRef.set(value))
      .catch(() => {});
    Effect.runPromise(deploy.getConnectionOptions)
      .then((value) => connectionOptionsRef.set(value))
      .catch(() => {});
    Effect.runPromise(deploy.listRuns)
      .then((value) => runsRef.set(value.runs))
      .catch(() => {});
    watchFiber = Effect.runFork(
      deploy.watch.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            switch (event.type) {
              case "run-started":
              case "run-finished":
                upsertRun(event.run);
                break;
              case "plan-ready":
                planRef.set(event.plan);
                break;
              case "sync-listed":
                syncRef.set({ total: event.total, hydrated: 0 });
                break;
              case "sync-hydrated": {
                const current = syncRef.value;
                if (current) syncRef.set({ ...current, hydrated: current.hydrated + 1 });
                break;
              }
              default:
                break;
            }
          }),
        ),
        Effect.catch(() => Effect.void),
      ),
    );
  };

  const stop = () => {
    const fiber = watchFiber;
    watchFiber = null;
    if (fiber) Effect.runFork(Fiber.interrupt(fiber));
  };

  const runAction = <A>(
    label: string,
    effect: Effect.Effect<A, Error>,
    onOk?: (value: A) => void,
  ) => {
    if (busyRef.value) return;
    busyRef.set(label);
    errorRef.set(null);
    Effect.runPromise(effect)
      .then((value) => onOk?.(value))
      .catch((cause: unknown) =>
        errorRef.set(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => busyRef.set(null));
  };

  return {
    stateRef,
    start,
    stop,
    connect: (request) =>
      runAction("Connecting", deploy.connect(request), (value) => connectionRef.set(value)),
    pull: () => runAction("Pulling", deploy.pull),
    plan_: () => runAction("Planning", deploy.plan, (value) => planRef.set(value)),
    apply: (allowDelete) => {
      const plan = planRef.value;
      if (!plan) return;
      runAction("Applying", deploy.apply({ plan, allowDelete }), () => planRef.set(null));
    },
    destroy: () => runAction("Destroying", deploy.destroy, () => planRef.set(null)),
    dismissError: () => errorRef.set(null),
  };
}

/**
 * Drives a {@link SchematicsDeployService}: subscribes to the run/sync/plan event
 * stream, tracks the run history, and exposes the lifecycle verbs as fire-and-
 * forget actions with busy/error state for the Deploy panel.
 */
export function useSchematicsDeploy(deploy: SchematicsDeployService): SchematicsDeployViewModel {
  const store = useMemo(() => createSchematicsDeployStore(deploy), [deploy]);

  useEffect(() => {
    store.start();
    return store.stop;
  }, [store]);

  const state = useSyncExternalStore(
    (listener) => store.stateRef.subscribe(() => listener()),
    () => store.stateRef.value,
    () => store.stateRef.value,
  );

  return useMemo(
    () => ({
      ...state,
      connect: store.connect,
      pull: store.pull,
      plan_: store.plan_,
      apply: store.apply,
      destroy: store.destroy,
      dismissError: store.dismissError,
    }),
    [state, store],
  );
}

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
  readonly connections: readonly DeployConnection[];
  readonly connectionOptions: DeployConnectionOptions | null;
  readonly plan: DeployPlan | null;
  readonly runs: readonly DeployRun[];
  readonly sync: { readonly total: number; readonly hydrated: number } | null;
  /** Paths listed during a pull but not yet hydrated — render these as "loading". */
  readonly loadingPaths: ReadonlySet<string>;
  /** Label of the in-flight action, or null when idle. */
  readonly busy: string | null;
  readonly error: string | null;
  /** Resource file paths whose live state diverged from the working tree (drift). */
  readonly driftPaths: ReadonlySet<string>;
  readonly connect: (request: DeployConnectRequest) => void;
  readonly useConnection: (connectionId: string) => void;
  readonly deleteConnection: (connectionId: string) => void;
  readonly pull: () => void;
  readonly plan_: () => void;
  readonly apply: (allowDelete: boolean) => void;
  readonly destroy: () => void;
  readonly dismissError: () => void;
}

interface DeployState {
  readonly connection: DeployConnection | null;
  readonly connections: readonly DeployConnection[];
  readonly connectionOptions: DeployConnectionOptions | null;
  readonly plan: DeployPlan | null;
  readonly runs: readonly DeployRun[];
  readonly sync: { readonly total: number; readonly hydrated: number } | null;
  readonly loadingPaths: ReadonlySet<string>;
  readonly busy: string | null;
  readonly error: string | null;
  readonly driftPaths: ReadonlySet<string>;
}

interface SchematicsDeployStore {
  readonly stateRef: AtomRef.ReadonlyRef<DeployState>;
  readonly start: () => void;
  readonly stop: () => void;
  readonly connect: (request: DeployConnectRequest) => void;
  readonly useConnection: (connectionId: string) => void;
  readonly deleteConnection: (connectionId: string) => void;
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
  const connectionsRef = AtomRef.make<readonly DeployConnection[]>([]);
  const connectionOptionsRef = AtomRef.make<DeployConnectionOptions | null>(null);
  const planRef = AtomRef.make<DeployPlan | null>(null);
  const runsRef = AtomRef.make<readonly DeployRun[]>([]);
  const syncRef = AtomRef.make<{ total: number; hydrated: number } | null>(null);
  const loadingPathsRef = AtomRef.make<ReadonlySet<string>>(new Set());
  const busyRef = AtomRef.make<string | null>(null);
  const errorRef = AtomRef.make<string | null>(null);

  const stateRef = combineRefs<DeployState>(
    [
      connectionRef,
      connectionsRef,
      connectionOptionsRef,
      planRef,
      runsRef,
      syncRef,
      loadingPathsRef,
      busyRef,
      errorRef,
    ],
    () => ({
      connection: connectionRef.value,
      connections: connectionsRef.value,
      connectionOptions: connectionOptionsRef.value,
      plan: planRef.value,
      runs: runsRef.value,
      sync: syncRef.value,
      loadingPaths: loadingPathsRef.value,
      busy: busyRef.value,
      error: errorRef.value,
      driftPaths: new Set(
        (planRef.value?.changes ?? [])
          .filter((change) => change.action !== "noop")
          .map((change) => change.path),
      ),
    }),
  );

  const removeFrom = (set: ReadonlySet<string>, value: string): ReadonlySet<string> => {
    const next = new Set(set);
    next.delete(value);
    return next;
  };

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
    Effect.runPromise(deploy.getConnection())
      .then((value) => connectionRef.set(value))
      .catch(() => {});
    Effect.runPromise(deploy.listConnections)
      .then((value) => {
        connectionsRef.set(value.connections);
        if (!connectionRef.value && value.connections.length === 1) {
          connectionRef.set(value.connections[0] ?? null);
        }
      })
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
                loadingPathsRef.set(new Set());
                break;
              case "sync-seeded":
                loadingPathsRef.set(new Set(loadingPathsRef.value).add(event.path));
                break;
              case "sync-hydrated": {
                const current = syncRef.value;
                if (current) syncRef.set({ ...current, hydrated: current.hydrated + 1 });
                loadingPathsRef.set(removeFrom(loadingPathsRef.value, event.path));
                break;
              }
              case "sync-failed":
                loadingPathsRef.set(removeFrom(loadingPathsRef.value, event.path));
                break;
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

  const connectionRequest = () =>
    connectionRef.value ? { connectionId: connectionRef.value.id } : undefined;

  return {
    stateRef,
    start,
    stop,
    connect: (request) =>
      runAction("Connecting", deploy.connect(request), (value) => {
        connectionRef.set(value);
        connectionsRef.set([
          ...connectionsRef.value.filter((connection) => connection.id !== value.id),
          value,
        ]);
      }),
    useConnection: (connectionId) => {
      const connection =
        connectionsRef.value.find((candidate) => candidate.id === connectionId) ?? null;
      connectionRef.set(connection);
      planRef.set(null);
      syncRef.set(null);
    },
    deleteConnection: (connectionId) =>
      runAction("Deleting connection", deploy.deleteConnection({ connectionId }), () => {
        connectionsRef.set(
          connectionsRef.value.filter((connection) => connection.id !== connectionId),
        );
        if (connectionRef.value?.id === connectionId) connectionRef.set(null);
      }),
    pull: () => runAction("Pulling", deploy.pull(connectionRequest())),
    plan_: () =>
      runAction("Planning", deploy.plan(connectionRequest()), (value) => planRef.set(value)),
    apply: (allowDelete) => {
      const plan = planRef.value;
      if (!plan) return;
      runAction(
        "Applying",
        deploy.apply({ ...(connectionRequest() ?? {}), plan, allowDelete }),
        () => planRef.set(null),
      );
    },
    destroy: () =>
      runAction("Destroying", deploy.destroy(connectionRequest()), () => planRef.set(null)),
    dismissError: () => errorRef.set(null),
  };
}

const inertState: DeployState = {
  connection: null,
  connections: [],
  connectionOptions: null,
  plan: null,
  runs: [],
  sync: null,
  loadingPaths: new Set(),
  busy: null,
  error: null,
  driftPaths: new Set(),
};

const noop = () => {};

/**
 * Drives a {@link SchematicsDeployService}: subscribes to the run/sync/plan event
 * stream, tracks the run history, and exposes the lifecycle verbs as fire-and-
 * forget actions with busy/error state for the Deploy panel.
 *
 * `deploy` may be `undefined` (e.g. a view that only reads `loadingPaths` and may
 * not have a connected service); the model is inert and the verbs are no-ops.
 */
export function useSchematicsDeploy(
  deploy: SchematicsDeployService | undefined,
): SchematicsDeployViewModel {
  const store = useMemo(() => (deploy ? createSchematicsDeployStore(deploy) : null), [deploy]);

  useEffect(() => {
    if (!store) return;
    store.start();
    return store.stop;
  }, [store]);

  const state = useSyncExternalStore(
    (listener) => (store ? store.stateRef.subscribe(() => listener()) : noop),
    () => (store ? store.stateRef.value : inertState),
    () => (store ? store.stateRef.value : inertState),
  );

  return useMemo(
    () => ({
      ...state,
      connect: store?.connect ?? noop,
      useConnection: store?.useConnection ?? noop,
      deleteConnection: store?.deleteConnection ?? noop,
      pull: store?.pull ?? noop,
      plan_: store?.plan_ ?? noop,
      apply: store?.apply ?? noop,
      destroy: store?.destroy ?? noop,
      dismissError: store?.dismissError ?? noop,
    }),
    [state, store],
  );
}

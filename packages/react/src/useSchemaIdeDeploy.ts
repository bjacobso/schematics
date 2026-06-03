import type {
  DeployConnectRequest,
  DeployConnection,
  DeployConnectionOptions,
  DeployPlan,
  DeployRun,
  SchemaIdeDeployService,
} from "@schema-ide/protocol";
import { Effect, Fiber, Stream } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface SchemaIdeDeployViewModel {
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

/**
 * Drives a {@link SchemaIdeDeployService}: subscribes to the run/sync/plan event
 * stream, tracks the run history, and exposes the lifecycle verbs as fire-and-
 * forget actions with busy/error state for the Deploy panel.
 */
export function useSchemaIdeDeploy(deploy: SchemaIdeDeployService): SchemaIdeDeployViewModel {
  const [connection, setConnection] = useState<DeployConnection | null>(null);
  const [connectionOptions, setConnectionOptions] = useState<DeployConnectionOptions | null>(null);
  const [plan, setPlan] = useState<DeployPlan | null>(null);
  const [runs, setRuns] = useState<readonly DeployRun[]>([]);
  const [sync, setSync] = useState<{ total: number; hydrated: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const upsertRun = useCallback((run: DeployRun) => {
    setRuns((current) => {
      const index = current.findIndex((candidate) => candidate.id === run.id);
      if (index < 0) return [...current, run];
      const next = current.slice();
      next[index] = run;
      return next;
    });
  }, []);

  // Initial fetch: existing connection + run history.
  useEffect(() => {
    let cancelled = false;
    Effect.runPromise(deploy.getConnection)
      .then((value) => !cancelled && setConnection(value))
      .catch(() => {});
    Effect.runPromise(deploy.getConnectionOptions)
      .then((value) => !cancelled && setConnectionOptions(value))
      .catch(() => {});
    Effect.runPromise(deploy.listRuns)
      .then((value) => !cancelled && setRuns(value.runs))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [deploy]);

  // Live event subscription.
  useEffect(() => {
    const fiber = Effect.runFork(
      deploy.watch.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            switch (event.type) {
              case "run-started":
              case "run-finished":
                upsertRun(event.run);
                break;
              case "plan-ready":
                setPlan(event.plan);
                break;
              case "sync-listed":
                setSync({ total: event.total, hydrated: 0 });
                break;
              case "sync-hydrated":
                setSync((current) =>
                  current ? { ...current, hydrated: current.hydrated + 1 } : current,
                );
                break;
              default:
                break;
            }
          }),
        ),
        Effect.catch(() => Effect.void),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [deploy, upsertRun]);

  const runAction = useCallback(
    <A>(label: string, effect: Effect.Effect<A, Error>, onOk?: (value: A) => void) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(label);
      setError(null);
      Effect.runPromise(effect)
        .then((value) => onOk?.(value))
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => {
          busyRef.current = false;
          setBusy(null);
        });
    },
    [],
  );

  const connect = useCallback(
    (request: DeployConnectRequest) =>
      runAction("Connecting", deploy.connect(request), (value) => setConnection(value)),
    [deploy, runAction],
  );
  const pull = useCallback(() => runAction("Pulling", deploy.pull), [deploy, runAction]);
  const plan_ = useCallback(
    () => runAction("Planning", deploy.plan, (value) => setPlan(value)),
    [deploy, runAction],
  );
  const apply = useCallback(
    (allowDelete: boolean) => {
      if (!plan) return;
      runAction("Applying", deploy.apply({ plan, allowDelete }), () => setPlan(null));
    },
    [deploy, plan, runAction],
  );
  const destroy = useCallback(
    () => runAction("Destroying", deploy.destroy, () => setPlan(null)),
    [deploy, runAction],
  );
  const dismissError = useCallback(() => setError(null), []);

  const driftPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const change of plan?.changes ?? []) {
      if (change.action !== "noop") paths.add(change.path);
    }
    return paths;
  }, [plan]);

  return {
    connection,
    connectionOptions,
    plan,
    runs,
    sync,
    busy,
    error,
    driftPaths,
    connect,
    pull,
    plan_,
    apply,
    destroy,
    dismissError,
  };
}

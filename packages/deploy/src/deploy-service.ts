import type { ArtifactStore } from "@schematics/artifacts";
import type {
  ApplyEvent,
  ApplyResult,
  ConfigDeploy,
  ConfigPlan,
  PullEvent,
  ResourceChange,
} from "@schematics/alchemy";
import {
  SchematicsDeployError,
  type DeployApplyRequest,
  type DeployApplyResult,
  type DeployConnectionRequest,
  type DeployConnectRequest,
  type DeployConnection,
  type DeployConnectionOptions,
  type DeployEvent,
  type DeployPlan,
  type DeployPullResult,
  type DeployResourceChange,
  type DeployRun,
  type DeployRunKind,
  type ListDeployRunsResponse,
  type SchematicsDeployService,
} from "@schematics/protocol";
import { Effect, Queue, Stream } from "effect";
import { makeMemoryDeployConnectionStore, type DeployConnectionStore } from "./connection-store";
import { makeMemoryDeploySecretStore, type DeploySecretStore } from "./secret-store";

/**
 * The engine + account label an example resolves from a connect request. The
 * example owns building the {@link ConfigDeploy} (api adapter + provider wiring)
 * and probing for a human label; everything else about running the deploy
 * lifecycle is shared.
 */
export interface ConnectedDeploy {
  readonly deploy: ConfigDeploy;
  /** Human label for the connected account/tenant, shown in the UI. */
  readonly account: string | null;
}

export interface ConfigDeployServiceOptions {
  readonly store: ArtifactStore;
  /** Connection choices exposed to the UI Connect step. */
  readonly connectionOptions: DeployConnectionOptions;
  /** Resource kinds enabled by default on a fresh connection. */
  readonly defaultKinds: readonly string[];
  /** Consumer label captured on the connection (e.g. "catalog"). */
  readonly consumer: string;
  /**
   * Build the deploy engine for a connect request and resolve an account label.
   * The secret has already been resolved from the request and persisted; this is
   * where the example creates its API adapter (live or mock) and wires providers.
   */
  readonly connect: (
    request: DeployConnectRequest,
    store: ArtifactStore,
  ) => Effect.Effect<ConnectedDeploy, SchematicsDeployError>;
  /** Where secret-free connection records are persisted. Defaults to in-memory. */
  readonly connections?: DeployConnectionStore | undefined;
  /** Where connection tokens are persisted as secret-refs. Defaults to in-memory. */
  readonly secrets?: DeploySecretStore | undefined;
  /** Timestamp source for runs (ISO string). Defaults to wall-clock. */
  readonly now?: (() => string) | undefined;
}

/**
 * Bridges the headless {@link ConfigDeploy} engine to the protocol
 * {@link SchematicsDeployService}: holds the working-tree store + credentials,
 * tracks runs, and broadcasts plan/apply/sync progress on an event stream. None
 * of this is domain-specific — examples supply only `connect`.
 */
export function makeConfigDeployService(
  options: ConfigDeployServiceOptions,
): SchematicsDeployService {
  const now = options.now ?? (() => new Date().toISOString());
  const secrets = options.secrets ?? makeMemoryDeploySecretStore();
  const connectionStore = options.connections ?? makeMemoryDeployConnectionStore();
  const connectionOptions = options.connectionOptions;

  const deploys = new Map<string, ConfigDeploy>();
  const runs: DeployRun[] = [];
  const subscribers = new Set<(event: DeployEvent) => void>();
  let runCounter = 0;
  let connectionCounter = 0;

  const publish = (event: DeployEvent): void => {
    for (const subscriber of subscribers) subscriber(event);
  };

  const nextConnectionId = Effect.gen(function* () {
    const existing = yield* connectionStore.list.pipe(Effect.mapError(toDeployError));
    const ids = new Set(existing.map((connection) => connection.id));
    do {
      connectionCounter += 1;
    } while (ids.has(`conn-${connectionCounter}`));
    return `conn-${connectionCounter}`;
  });

  const resolveConnection = (
    request?: DeployConnectionRequest,
  ): Effect.Effect<DeployConnection, SchematicsDeployError> =>
    Effect.gen(function* () {
      if (request?.connectionId) {
        const connection = yield* connectionStore
          .get(request.connectionId)
          .pipe(Effect.mapError(toDeployError));
        if (connection) return connection;
        return yield* Effect.fail(
          new SchematicsDeployError(
            `Deploy connection ${request.connectionId} was not found.`,
            "not-connected",
          ),
        );
      }

      const connections = yield* connectionStore.list.pipe(Effect.mapError(toDeployError));
      if (connections.length === 1) return connections[0]!;
      if (connections.length === 0) return yield* Effect.fail(notConnected());
      return yield* Effect.fail(
        new SchematicsDeployError(
          "Multiple deploy connections are available. Pass a connectionId.",
          "not-connected",
        ),
      );
    });

  const requireDeploy = (
    request?: DeployConnectionRequest,
  ): Effect.Effect<
    { readonly connection: DeployConnection; readonly deploy: ConfigDeploy },
    SchematicsDeployError
  > =>
    Effect.gen(function* () {
      const connection = yield* resolveConnection(request);
      const cached = deploys.get(connection.id);
      if (cached) return { connection, deploy: cached };

      const token = yield* secrets.get(connection.id).pipe(Effect.mapError(toDeployError));
      if (token === null) {
        return yield* Effect.fail(
          new SchematicsDeployError(
            `No stored credentials for connection ${connection.id}. Reconnect before deploying.`,
            "not-connected",
          ),
        );
      }
      const connected = yield* options.connect(toConnectRequest(connection, token), options.store);
      deploys.set(connection.id, connected.deploy);
      return { connection, deploy: connected.deploy };
    });

  /** Wrap an engine effect in a tracked Run, publishing started/finished events. */
  const withRun = <A>(
    kind: DeployRunKind,
    summarize: (value: A) => unknown,
    body: (runId: string) => Effect.Effect<A, SchematicsDeployError>,
  ): Effect.Effect<A, SchematicsDeployError> =>
    Effect.gen(function* () {
      runCounter += 1;
      const id = `run-${runCounter}`;
      const started: DeployRun = { id, kind, status: "running", startedAt: now() };
      runs.push(started);
      publish({ type: "run-started", run: started });

      return yield* body(id).pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            const finished: DeployRun = {
              ...started,
              status: isAbortedResult(value) ? "aborted" : "succeeded",
              finishedAt: now(),
              summary: summarize(value),
            };
            replaceRun(runs, finished);
            publish({ type: "run-finished", run: finished });
          }),
        ),
        Effect.tapError((error) =>
          Effect.sync(() => {
            const finished: DeployRun = {
              ...started,
              status: "failed",
              finishedAt: now(),
              error: error.message,
            };
            replaceRun(runs, finished);
            publish({ type: "run-finished", run: finished });
          }),
        ),
      );
    });

  const connect: SchematicsDeployService["connect"] = (request) =>
    Effect.gen(function* () {
      const environment =
        connectionOptions.environments.find((candidate) => candidate.id === request.environment) ??
        connectionOptions.environments.find(
          (candidate) => candidate.id === connectionOptions.defaultEnvironment,
        ) ??
        null;
      const authMethodId = request.authMethod ?? connectionOptions.defaultAuthMethod ?? null;
      const secret = resolveSecret(request);

      const id = yield* nextConnectionId;
      const connected = yield* options.connect(request, options.store);
      yield* secrets.put(id, secret).pipe(Effect.mapError(toDeployError));
      const connection: DeployConnection = {
        id,
        consumer: options.consumer,
        account: connected.account,
        env: environment?.id ?? request.environment ?? request.env ?? "production",
        authMethod: authMethodId,
        baseUrl: environment?.baseUrl ?? request.baseUrl ?? null,
        enabledKinds: request.enabledKinds ?? [...options.defaultKinds],
        connected: true,
      };
      deploys.set(id, connected.deploy);
      yield* connectionStore.save(connection).pipe(Effect.mapError(toDeployError));
      return connection;
    });

  const getConnectionOptions: SchematicsDeployService["getConnectionOptions"] =
    Effect.succeed(connectionOptions);

  const getConnection: SchematicsDeployService["getConnection"] = (request) =>
    Effect.gen(function* () {
      if (request?.connectionId) {
        return yield* connectionStore
          .get(request.connectionId)
          .pipe(Effect.mapError(toDeployError));
      }
      const connections = yield* connectionStore.list.pipe(Effect.mapError(toDeployError));
      return connections.length === 1 ? connections[0]! : null;
    });

  const listConnections: SchematicsDeployService["listConnections"] = connectionStore.list.pipe(
    Effect.map((connections) => ({
      connections: connections.map((connection) => ({ ...connection })),
    })),
    Effect.mapError(toDeployError),
  );

  const deleteConnection: SchematicsDeployService["deleteConnection"] = (request) =>
    Effect.all([
      connectionStore.delete(request.connectionId).pipe(Effect.mapError(toDeployError)),
      secrets.delete(request.connectionId).pipe(Effect.mapError(toDeployError)),
      Effect.sync(() => void deploys.delete(request.connectionId)),
    ]).pipe(Effect.asVoid);

  const pull: SchematicsDeployService["pull"] = (request) =>
    withRun(
      "pull",
      (result: DeployPullResult) => ({ pulled: result.pulled.length }),
      (runId) =>
        Effect.gen(function* () {
          const { deploy: engine } = yield* requireDeploy(request);
          const result = yield* engine
            .pullWith({
              onEvent: (event) => Effect.sync(() => publish(pullEventToDeployEvent(runId, event))),
            })
            .pipe(Effect.mapError(toDeployError));
          return { pulled: result.pulled.map((file) => ({ ...file })) } satisfies DeployPullResult;
        }),
    );

  const plan: SchematicsDeployService["plan"] = (request) =>
    withRun(
      "plan",
      (result: DeployPlan) => result.summary,
      (runId) =>
        Effect.gen(function* () {
          const { deploy: engine } = yield* requireDeploy(request);
          const configPlan = yield* engine.plan.pipe(Effect.mapError(toDeployError));
          const deployPlan = toDeployPlan(configPlan);
          publish({ type: "plan-ready", runId, plan: deployPlan });
          return deployPlan;
        }),
    );

  const apply: SchematicsDeployService["apply"] = (request: DeployApplyRequest) =>
    withRun(
      "apply",
      (result: DeployApplyResult) => ({
        applied: result.applied.length,
        aborted: result.aborted.length,
        skipped: result.skipped.length,
      }),
      (runId) =>
        Effect.gen(function* () {
          const { deploy: engine } = yield* requireDeploy(request);
          const result = yield* engine
            .apply(fromDeployPlan(request.plan), {
              allowDelete: request.allowDelete ?? false,
              onEvent: (event) => Effect.sync(() => publish(applyEventToDeployEvent(runId, event))),
            })
            .pipe(Effect.mapError(toDeployError));
          return toDeployApplyResult(result);
        }),
    );

  const destroy: SchematicsDeployService["destroy"] = (request) =>
    withRun(
      "destroy",
      (result: DeployApplyResult) => ({
        applied: result.applied.length,
        aborted: result.aborted.length,
        skipped: result.skipped.length,
      }),
      (runId) =>
        Effect.gen(function* () {
          const { deploy: engine } = yield* requireDeploy(request);
          const result = yield* engine.destroy.pipe(Effect.mapError(toDeployError));
          for (const applied of result.applied) {
            publish({ type: "resource-applied", runId, change: toDeployChange(applied.change) });
          }
          return toDeployApplyResult(result);
        }),
    );

  const listRuns: SchematicsDeployService["listRuns"] = Effect.sync(
    (): ListDeployRunsResponse => ({ runs: runs.map((run) => ({ ...run })) }),
  );

  const watch: SchematicsDeployService["watch"] = Stream.callback<
    DeployEvent,
    SchematicsDeployError
  >((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const subscriber = (event: DeployEvent) => Queue.offerUnsafe(queue, event);
        subscribers.add(subscriber);
        return subscriber;
      }),
      (subscriber) => Effect.sync(() => void subscribers.delete(subscriber)),
    ),
  );

  return {
    connect,
    getConnection,
    listConnections,
    deleteConnection,
    getConnectionOptions,
    pull,
    plan,
    apply,
    destroy,
    listRuns,
    watch,
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Pick the secret to persist from the request's credentials (any auth method) or legacy token. */
function resolveSecret(request: DeployConnectRequest): string {
  if (request.credentials) {
    const value = request.credentials["token"] ?? Object.values(request.credentials)[0];
    if (value) return value;
  }
  return request.token ?? "";
}

function toConnectRequest(connection: DeployConnection, token: string): DeployConnectRequest {
  return {
    consumer: connection.consumer,
    environment: connection.env,
    credentials: { token },
    token,
    env: connection.env,
    enabledKinds: [...connection.enabledKinds],
    ...(connection.authMethod ? { authMethod: connection.authMethod } : {}),
    ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
  };
}

function notConnected(): SchematicsDeployError {
  return new SchematicsDeployError(
    "No active connection. Connect before deploying.",
    "not-connected",
  );
}

function replaceRun(runs: DeployRun[], run: DeployRun): void {
  const index = runs.findIndex((candidate) => candidate.id === run.id);
  if (index >= 0) runs[index] = run;
}

function isAbortedResult(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "aborted" in value &&
    Array.isArray((value as { aborted: unknown }).aborted) &&
    (value as { aborted: unknown[] }).aborted.length > 0 &&
    "applied" in value &&
    Array.isArray((value as { applied: unknown }).applied) &&
    (value as { applied: unknown[] }).applied.length === 0
  );
}

function toDeployChange(change: ResourceChange): DeployResourceChange {
  return {
    kind: change.kind,
    key: change.key,
    remoteId: change.remoteId,
    path: change.path,
    action: change.action,
    before: change.before ?? null,
    after: change.after ?? null,
    fields: change.fields.map((field) => ({
      path: field.path,
      before: field.before,
      after: field.after,
    })),
    liveHash: change.liveHash,
  };
}

function fromDeployChange(change: DeployResourceChange): ResourceChange {
  return {
    kind: change.kind,
    key: change.key,
    remoteId: change.remoteId,
    path: change.path,
    action: change.action,
    before: change.before,
    after: change.after,
    fields: change.fields.map((field) => ({
      path: field.path,
      before: field.before,
      after: field.after,
    })),
    liveHash: change.liveHash,
  };
}

function toDeployPlan(plan: ConfigPlan): DeployPlan {
  return { changes: plan.changes.map(toDeployChange), summary: { ...plan.summary } };
}

function fromDeployPlan(plan: DeployPlan): ConfigPlan {
  return { changes: plan.changes.map(fromDeployChange), summary: { ...plan.summary } };
}

function toDeployApplyResult(result: ApplyResult): DeployApplyResult {
  return {
    applied: result.applied.map((entry) => ({ change: toDeployChange(entry.change) })),
    aborted: result.aborted.map((entry) => ({
      change: toDeployChange(entry.change),
      reason: entry.reason,
    })),
    skipped: result.skipped.map(toDeployChange),
  };
}

function pullEventToDeployEvent(runId: string, event: PullEvent): DeployEvent {
  switch (event.type) {
    case "listed":
      return { type: "sync-listed", runId, total: event.total };
    case "seeded":
      return { type: "sync-seeded", runId, path: event.path };
    case "hydrated":
      return { type: "sync-hydrated", runId, path: event.path };
    case "failed":
      return { type: "sync-failed", runId, path: event.path, message: event.message };
  }
}

function applyEventToDeployEvent(runId: string, event: ApplyEvent): DeployEvent {
  switch (event.type) {
    case "applied":
      return { type: "resource-applied", runId, change: toDeployChange(event.change) };
    case "aborted":
      return {
        type: "resource-aborted",
        runId,
        change: toDeployChange(event.change),
        reason: event.reason,
      };
    case "skipped":
      return { type: "resource-skipped", runId, change: toDeployChange(event.change) };
  }
}

/** Normalize any engine/provider error into a protocol {@link SchematicsDeployError}. */
export function toDeployError(error: unknown): SchematicsDeployError {
  if (error instanceof SchematicsDeployError) return error;
  const tag =
    typeof error === "object" && error !== null && "_tag" in error
      ? String((error as { _tag: unknown })._tag)
      : undefined;
  switch (tag) {
    case "ConfigValidationError": {
      const issues =
        (error as { issues?: readonly { path: string; message: string }[] }).issues ?? [];
      const detail = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
      return new SchematicsDeployError(
        `Invalid config: ${detail || "validation failed"}`,
        "validation",
      );
    }
    case "ProviderError":
      return new SchematicsDeployError(messageOf(error), "provider");
    case "ConfigCodecError":
      return new SchematicsDeployError(messageOf(error), "codec");
  }
  if (typeof error === "object" && error !== null && "reason" in error) {
    return new SchematicsDeployError(messageOf(error), "storage");
  }
  return new SchematicsDeployError(messageOf(error), "storage");
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

import type { ArtifactStore } from "@schema-ide/artifacts";
import type {
  ApplyEvent,
  ApplyResult,
  ConfigDeploy,
  ConfigPlan,
  ResourceChange,
} from "@schema-ide/config-deploy";
import {
  SchemaIdeDeployError,
  type DeployApplyRequest,
  type DeployApplyResult,
  type DeployConnectRequest,
  type DeployConnection,
  type DeployEvent,
  type DeployPlan,
  type DeployPullResult,
  type DeployResourceChange,
  type DeployRun,
  type DeployRunKind,
  type ListDeployRunsResponse,
  type SchemaIdeDeployService,
} from "@schema-ide/protocol";
import { Effect, Queue, Stream } from "effect";
import { makeOnboardedConfigDeploy } from "./deploy";
import { makeMockOnboardedApi, type OnboardedApi } from "./mock";

const DEFAULT_KINDS = ["account", "custom-property", "form", "policy", "automation"] as const;

/**
 * Server-side store for connection secrets. The token is referenced by
 * connection id and never returned to the client or written to the file tree.
 */
export interface DeploySecretStore {
  readonly put: (connectionId: string, token: string) => Effect.Effect<void>;
  readonly get: (connectionId: string) => Effect.Effect<string | null>;
  readonly delete: (connectionId: string) => Effect.Effect<void>;
}

/** Trivial in-memory secret store. Replace with a worker Secret/KV binding in production. */
export function makeMemoryDeploySecretStore(): DeploySecretStore {
  const secrets = new Map<string, string>();
  return {
    put: (id, token) => Effect.sync(() => void secrets.set(id, token)),
    get: (id) => Effect.sync(() => secrets.get(id) ?? null),
    delete: (id) => Effect.sync(() => void secrets.delete(id)),
  };
}

export interface OnboardedDeployServiceOptions {
  readonly store: ArtifactStore;
  /**
   * Build the API adapter from the connection request (the live adapter holds
   * the token). Defaults to the in-memory mock OnboardedApi (token ignored).
   */
  readonly apiFactory?: ((request: DeployConnectRequest) => OnboardedApi) | undefined;
  /** Where connection tokens are persisted as secret-refs. Defaults to in-memory. */
  readonly secrets?: DeploySecretStore | undefined;
  readonly lockfilePath?: string | undefined;
  readonly projectId?: string | undefined;
  /** Timestamp source for runs (ISO string). Defaults to wall-clock. */
  readonly now?: (() => string) | undefined;
  /** Consumer label captured on the connection. Defaults to "onboarded". */
  readonly consumer?: string | undefined;
}

/**
 * Bridges the headless {@link ConfigDeploy} engine to the protocol
 * {@link SchemaIdeDeployService}: holds the working-tree store + credentials,
 * tracks runs, and broadcasts plan/apply/sync progress on an event stream.
 */
export function makeOnboardedDeployService(
  options: OnboardedDeployServiceOptions,
): SchemaIdeDeployService {
  const now = options.now ?? (() => new Date().toISOString());
  const consumer = options.consumer ?? "onboarded";
  const secrets = options.secrets ?? makeMemoryDeploySecretStore();
  const apiFactory = options.apiFactory ?? (() => makeMockOnboardedApi());

  let connection: DeployConnection | null = null;
  let deploy: ConfigDeploy | null = null;
  const runs: DeployRun[] = [];
  const subscribers = new Set<(event: DeployEvent) => void>();
  let runCounter = 0;
  let connectionCounter = 0;

  const publish = (event: DeployEvent): void => {
    for (const subscriber of subscribers) subscriber(event);
  };

  const requireDeploy = (): Effect.Effect<ConfigDeploy, SchemaIdeDeployError> =>
    deploy ? Effect.succeed(deploy) : Effect.fail(notConnected());

  /** Wrap an engine effect in a tracked Run, publishing started/finished events. */
  const withRun = <A>(
    kind: DeployRunKind,
    summarize: (value: A) => unknown,
    body: (runId: string) => Effect.Effect<A, SchemaIdeDeployError>,
  ): Effect.Effect<A, SchemaIdeDeployError> =>
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

  const connect: SchemaIdeDeployService["connect"] = (request) =>
    Effect.gen(function* () {
      const api = apiFactory(request);
      // Live probe: validate credentials + resolve the account label.
      const accounts = yield* api.accounts.list.pipe(Effect.mapError(toDeployError));
      const account = accounts[0]?.organization.name ?? accounts[0]?.id ?? null;

      connectionCounter += 1;
      const id = `conn-${connectionCounter}`;
      yield* secrets.put(id, request.token);

      deploy = makeOnboardedConfigDeploy({
        store: options.store,
        api,
        lockfilePath: options.lockfilePath,
        projectId: options.projectId,
      });
      connection = {
        id,
        consumer,
        account,
        env: request.env ?? "prod",
        baseUrl: request.baseUrl ?? null,
        enabledKinds: request.enabledKinds ?? [...DEFAULT_KINDS],
        connected: true,
      };
      return connection;
    });

  const getConnection: SchemaIdeDeployService["getConnection"] = Effect.sync(() => connection);

  const pull: SchemaIdeDeployService["pull"] = withRun(
    "pull",
    (result: DeployPullResult) => ({ pulled: result.pulled.length }),
    (runId) =>
      Effect.gen(function* () {
        const engine = yield* requireDeploy();
        const result = yield* engine.pull.pipe(Effect.mapError(toDeployError));
        // Approximate the sync stream: announce the listed total, then emit a
        // hydrated event per pulled file so the UI fills its progress bar.
        publish({ type: "sync-listed", runId, total: result.pulled.length });
        for (const file of result.pulled) {
          publish({ type: "sync-hydrated", runId, path: file.path });
        }
        return { pulled: result.pulled.map((file) => ({ ...file })) } satisfies DeployPullResult;
      }),
  );

  const plan: SchemaIdeDeployService["plan"] = withRun(
    "plan",
    (result: DeployPlan) => result.summary,
    (runId) =>
      Effect.gen(function* () {
        const engine = yield* requireDeploy();
        const configPlan = yield* engine.plan.pipe(Effect.mapError(toDeployError));
        const deployPlan = toDeployPlan(configPlan);
        publish({ type: "plan-ready", runId, plan: deployPlan });
        return deployPlan;
      }),
  );

  const apply: SchemaIdeDeployService["apply"] = (request: DeployApplyRequest) =>
    withRun(
      "apply",
      (result: DeployApplyResult) => ({
        applied: result.applied.length,
        aborted: result.aborted.length,
        skipped: result.skipped.length,
      }),
      (runId) =>
        Effect.gen(function* () {
          const engine = yield* requireDeploy();
          const result = yield* engine
            .apply(fromDeployPlan(request.plan), {
              allowDelete: request.allowDelete ?? false,
              onEvent: (event) => Effect.sync(() => publish(applyEventToDeployEvent(runId, event))),
            })
            .pipe(Effect.mapError(toDeployError));
          return toDeployApplyResult(result);
        }),
    );

  const destroy: SchemaIdeDeployService["destroy"] = withRun(
    "destroy",
    (result: DeployApplyResult) => ({
      applied: result.applied.length,
      aborted: result.aborted.length,
      skipped: result.skipped.length,
    }),
    (runId) =>
      Effect.gen(function* () {
        const engine = yield* requireDeploy();
        const result = yield* engine.destroy.pipe(Effect.mapError(toDeployError));
        for (const applied of result.applied) {
          publish({ type: "resource-applied", runId, change: toDeployChange(applied.change) });
        }
        return toDeployApplyResult(result);
      }),
  );

  const listRuns: SchemaIdeDeployService["listRuns"] = Effect.sync(
    (): ListDeployRunsResponse => ({ runs: runs.map((run) => ({ ...run })) }),
  );

  const watch: SchemaIdeDeployService["watch"] = Stream.callback<DeployEvent, SchemaIdeDeployError>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const subscriber = (event: DeployEvent) => Queue.offerUnsafe(queue, event);
          subscribers.add(subscriber);
          return subscriber;
        }),
        (subscriber) => Effect.sync(() => void subscribers.delete(subscriber)),
      ),
  );

  return { connect, getConnection, pull, plan, apply, destroy, listRuns, watch };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function notConnected(): SchemaIdeDeployError {
  return new SchemaIdeDeployError(
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

function toDeployError(error: unknown): SchemaIdeDeployError {
  if (error instanceof SchemaIdeDeployError) return error;
  const tag =
    typeof error === "object" && error !== null && "_tag" in error
      ? String((error as { _tag: unknown })._tag)
      : undefined;
  switch (tag) {
    case "ConfigValidationError": {
      const issues =
        (error as { issues?: readonly { path: string; message: string }[] }).issues ?? [];
      const detail = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
      return new SchemaIdeDeployError(
        `Invalid config: ${detail || "validation failed"}`,
        "validation",
      );
    }
    case "ProviderError":
      return new SchemaIdeDeployError(messageOf(error), "provider");
    case "ConfigCodecError":
      return new SchemaIdeDeployError(messageOf(error), "codec");
  }
  if (typeof error === "object" && error !== null && "reason" in error) {
    return new SchemaIdeDeployError(messageOf(error), "storage");
  }
  return new SchemaIdeDeployError(messageOf(error), "storage");
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

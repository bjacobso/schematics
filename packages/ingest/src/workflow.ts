import {
  ArtifactRef,
  artifactRefKey,
  type ArtifactContent,
  type ArtifactStore,
} from "@schematics/artifacts";
import type { SchematicsReflection, SourceFile } from "@schematics/core";
import { Effect, Schema, Stream } from "effect";
import { LanguageModel } from "effect/unstable/ai";

export type ArtifactActionMode = "deterministic" | "model" | "human-gated";
export type ArtifactWorkflowWriteMode = "apply" | "propose";

export interface ArtifactCapabilityDefinition<Input = unknown, Output = unknown> {
  readonly id: string;
  readonly input?: Schema.Schema<Input> | undefined;
  readonly output?: Schema.Schema<Output> | undefined;
}

export interface ArtifactCapabilityImplementation<Input = unknown, Output = unknown> {
  readonly capability: ArtifactCapabilityDefinition<Input, Output>;
  readonly run: (input: Input) => Effect.Effect<Output, unknown, any>;
}

export interface DefineArtifactActionOptions<Input, Output> {
  readonly id: string;
  readonly input: Schema.Schema<Input>;
  readonly output: Schema.Schema<Output>;
  readonly uses?: readonly string[] | undefined;
  readonly mode?: ArtifactActionMode | undefined;
  readonly validateAfterWrite?: boolean | undefined;
  readonly run: (context: ArtifactWorkflowContext<Input>) => Effect.Effect<Output, unknown, any>;
}

export interface ArtifactWorkflowAction<Input = unknown, Output = unknown> {
  readonly id: string;
  readonly input: Schema.Schema<Input>;
  readonly output: Schema.Schema<Output>;
  readonly uses: readonly string[];
  readonly mode: ArtifactActionMode;
  readonly validateAfterWrite: boolean;
  readonly run: (context: ArtifactWorkflowContext<Input>) => Effect.Effect<Output, unknown, any>;
}

export interface ArtifactWorkflowContext<Input> {
  readonly input: Input;
  readonly store: ArtifactStore;
  readonly capabilities: ReadonlyMap<string, ArtifactCapabilityImplementation>;
  readonly run: {
    readonly id: string;
    readonly workflowId: string;
    readonly stepId: string;
    readonly actionId: string;
    readonly scratchPath: string;
  };
  readonly readFile: (path: string) => Effect.Effect<string, ArtifactWorkflowError>;
  readonly writeFile: (
    path: string,
    content: string,
  ) => Effect.Effect<ArtifactWorkflowWriteResult, ArtifactWorkflowError>;
  readonly capability: <I, O>(
    id: string,
    input: I,
  ) => Effect.Effect<O, ArtifactWorkflowError | unknown>;
}

export interface ArtifactWorkflowWriteResult {
  readonly changedPaths: readonly string[];
  readonly validation?: SchematicsReflection["validationSummary"] | undefined;
}

export interface ArtifactWorkflowStepContext<WorkflowInput> {
  readonly workflowInput: WorkflowInput;
  readonly outputs: Readonly<Record<string, unknown>>;
}

export interface ArtifactWorkflowStep<WorkflowInput = unknown> {
  readonly action: ArtifactWorkflowAction<any, any>;
  readonly after: readonly string[];
  readonly input?: ((context: ArtifactWorkflowStepContext<WorkflowInput>) => unknown) | undefined;
}

export interface DefineArtifactWorkflowOptions<WorkflowInput, WorkflowOutput> {
  readonly id: string;
  readonly input: Schema.Schema<WorkflowInput>;
  readonly output: Schema.Schema<WorkflowOutput>;
  readonly steps: Readonly<Record<string, ArtifactWorkflowStep<WorkflowInput>>>;
  readonly outputFromSteps?:
    | ((outputs: Readonly<Record<string, unknown>>) => WorkflowOutput)
    | undefined;
}

export interface DefinedArtifactWorkflow<WorkflowInput = unknown, WorkflowOutput = unknown> {
  readonly id: string;
  readonly input: Schema.Schema<WorkflowInput>;
  readonly output: Schema.Schema<WorkflowOutput>;
  readonly steps: Readonly<Record<string, ArtifactWorkflowStep<WorkflowInput>>>;
  readonly order: readonly string[];
  readonly outputFromSteps: (outputs: Readonly<Record<string, unknown>>) => WorkflowOutput;
  readonly uses: readonly string[];
}

export interface ArtifactWorkflowFileEdit {
  readonly path: string;
  readonly content: string;
  readonly create?: boolean | undefined;
}

export interface ArtifactWorkflowPatchProposal {
  readonly id: string;
  readonly label: string;
  readonly edits: readonly ArtifactWorkflowFileEdit[];
  readonly files?: readonly SourceFile[] | undefined;
  readonly validation?: SchematicsReflection["validationSummary"] | undefined;
  readonly diagnostics?: SchematicsReflection["diagnostics"] | undefined;
}

export interface ArtifactWorkflowMutationHost {
  readonly applyEdits: (
    edits: readonly ArtifactWorkflowFileEdit[],
    options?: {
      readonly validate?: boolean | undefined;
      readonly provenance?: ArtifactWorkflowProvenance | undefined;
    },
  ) =>
    | ArtifactWorkflowWriteResult
    | Promise<ArtifactWorkflowWriteResult>
    | Effect.Effect<ArtifactWorkflowWriteResult, unknown>;
  readonly proposePatch?: (
    label: string,
    edits: readonly ArtifactWorkflowFileEdit[],
  ) =>
    | ArtifactWorkflowPatchProposal
    | Promise<ArtifactWorkflowPatchProposal>
    | Effect.Effect<ArtifactWorkflowPatchProposal, unknown>;
}

export interface ArtifactWorkflowProvenance {
  readonly actor?: "user" | "agent" | "system" | undefined;
  readonly turnId?: string | undefined;
  readonly toolCallId?: string | undefined;
}

export interface ArtifactWorkflowRunOptions<WorkflowInput, WorkflowOutput> {
  readonly workflow: DefinedArtifactWorkflow<WorkflowInput, WorkflowOutput>;
  readonly input: WorkflowInput;
  readonly store: ArtifactStore;
  readonly mutationHost?: ArtifactWorkflowMutationHost | undefined;
  readonly capabilities?: readonly ArtifactCapabilityImplementation[] | undefined;
  readonly runId?: string | undefined;
  readonly fromStep?: string | undefined;
  readonly writeMode?: ArtifactWorkflowWriteMode | undefined;
  readonly now?: (() => string) | undefined;
}

export interface ArtifactWorkflowStepRecord {
  readonly stepId: string;
  readonly actionId: string;
  readonly status: "pending" | "running" | "skipped" | "completed" | "failed";
  readonly inputHash?: string | undefined;
  readonly outputHash?: string | undefined;
  readonly startedAt?: string | undefined;
  readonly completedAt?: string | undefined;
  readonly diagnostics?: readonly string[] | undefined;
  readonly writes: readonly ArtifactWorkflowFileEdit[];
  readonly provenance: readonly ArtifactWorkflowStepProvenance[];
  readonly cost?: ArtifactWorkflowStepCost | undefined;
}

export interface ArtifactWorkflowStepProvenance {
  readonly path: string;
  readonly runId: string;
  readonly stepId: string;
  readonly actionId: string;
}

export interface ArtifactWorkflowStepCost {
  readonly tokens?: number | undefined;
  readonly inputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly usd?: number | undefined;
}

export interface ArtifactWorkflowLanguageModelCapabilityInput {
  readonly runId: string;
  readonly workflowId: string;
  readonly stepId: string;
  readonly actionId: string;
  readonly modelProfile?: string | undefined;
}

export interface ArtifactWorkflowLanguageModelCapabilityOutput {
  readonly service: LanguageModel.Service;
  readonly modelId?: string | undefined;
  readonly inputTokenCostUsdPerMillion?: number | undefined;
  readonly outputTokenCostUsdPerMillion?: number | undefined;
}

export interface WorkflowManifest {
  readonly version: 1;
  readonly runId: string;
  readonly workflowId: string;
  readonly status: "running" | "completed" | "failed" | "waiting";
  readonly writeMode: ArtifactWorkflowWriteMode;
  readonly inputHash: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly steps: Readonly<Record<string, ArtifactWorkflowStepRecord>>;
  readonly output?: unknown;
  readonly patch?: ArtifactWorkflowPatchProposal | undefined;
}

export interface ArtifactWorkflowRunReport<WorkflowOutput = unknown> {
  readonly runId: string;
  readonly status: WorkflowManifest["status"];
  readonly manifest: WorkflowManifest;
  readonly output?: WorkflowOutput | undefined;
  readonly patch?: ArtifactWorkflowPatchProposal | undefined;
}

export interface ArtifactWorkflowIngestorOptions<Input, Output> {
  readonly id: string;
  readonly label: string;
  readonly accepts?: readonly ArtifactWorkflowAccepts[] | undefined;
  readonly targetRoutes?: readonly string[] | undefined;
  readonly creates: readonly string[];
  readonly inputs: Schema.Schema<Input>;
  readonly write?: ArtifactWorkflowWriteMode | undefined;
  readonly workflow: DefinedArtifactWorkflow<Input, Output>;
}

export interface ArtifactWorkflowAccepts {
  readonly mimeType?: string | undefined;
  readonly mediaType?: string | undefined;
  readonly extension?: string | undefined;
}

export interface ArtifactWorkflowIngestor<Input = unknown, Output = unknown> {
  readonly id: string;
  readonly label: string;
  readonly accepts: readonly ArtifactWorkflowAccepts[];
  readonly targetRoutes: readonly string[];
  readonly creates: readonly string[];
  readonly inputs: Schema.Schema<Input>;
  readonly write: ArtifactWorkflowWriteMode;
  readonly workflow: DefinedArtifactWorkflow<Input, Output>;
  readonly uses: readonly string[];
}

export class ArtifactWorkflowError extends Error {
  readonly _tag = "ArtifactWorkflowError";
  constructor(
    message: string,
    readonly reason:
      | "definition"
      | "capability"
      | "decode"
      | "mutation"
      | "store"
      | "step"
      | "not-found",
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function defineCapability<Input = unknown, Output = unknown>(
  definition: ArtifactCapabilityDefinition<Input, Output>,
): ArtifactCapabilityDefinition<Input, Output> {
  if (!definition.id) {
    throw new Error("defineCapability: id is required");
  }
  return definition;
}

export function defineArtifactAction<Input, Output>(
  options: DefineArtifactActionOptions<Input, Output>,
): ArtifactWorkflowAction<Input, Output> {
  if (!options.id) {
    throw new Error("defineArtifactAction: id is required");
  }
  return {
    id: options.id,
    input: options.input,
    output: options.output,
    uses: [...new Set(options.uses ?? [])],
    mode: options.mode ?? "deterministic",
    validateAfterWrite: options.validateAfterWrite ?? true,
    run: options.run,
  };
}

export function step<WorkflowInput, Input, Output>(
  action: ArtifactWorkflowAction<Input, Output>,
  options: {
    readonly after?: readonly string[] | undefined;
    readonly input?: ((context: ArtifactWorkflowStepContext<WorkflowInput>) => Input) | undefined;
  } = {},
): ArtifactWorkflowStep<WorkflowInput> {
  return {
    action,
    after: options.after ?? [],
    ...(options.input ? { input: options.input } : {}),
  };
}

export function defineArtifactWorkflow<WorkflowInput, WorkflowOutput>(
  options: DefineArtifactWorkflowOptions<WorkflowInput, WorkflowOutput>,
): DefinedArtifactWorkflow<WorkflowInput, WorkflowOutput> {
  if (!options.id) {
    throw new Error("defineArtifactWorkflow: id is required");
  }
  const order = topoSort(options.id, options.steps);
  const uses = [
    ...new Set(order.flatMap((stepId) => options.steps[stepId]?.action.uses ?? [])),
  ].sort();
  return {
    id: options.id,
    input: options.input,
    output: options.output,
    steps: options.steps,
    order,
    outputFromSteps:
      options.outputFromSteps ??
      ((outputs) => {
        const last = order[order.length - 1];
        return (last ? outputs[last] : undefined) as WorkflowOutput;
      }),
    uses,
  };
}

export function defineArtifactIngestor<Input, Output>(
  options: ArtifactWorkflowIngestorOptions<Input, Output>,
): ArtifactWorkflowIngestor<Input, Output> {
  if (!options.id) throw new Error("defineArtifactIngestor: id is required");
  if (!options.label) throw new Error(`defineArtifactIngestor(${options.id}): label is required`);
  if (options.creates.length === 0) {
    throw new Error(`defineArtifactIngestor(${options.id}): creates must not be empty`);
  }
  return {
    id: options.id,
    label: options.label,
    accepts: options.accepts ?? [],
    targetRoutes: options.targetRoutes ?? [],
    creates: options.creates,
    inputs: options.inputs,
    write: options.write ?? "propose",
    workflow: options.workflow,
    uses: options.workflow.uses,
  };
}

export function getWorkflowStepOrder(workflow: DefinedArtifactWorkflow): readonly string[] {
  return workflow.order;
}

export function runArtifactWorkflow<WorkflowInput, WorkflowOutput>(
  options: ArtifactWorkflowRunOptions<WorkflowInput, WorkflowOutput>,
): Effect.Effect<ArtifactWorkflowRunReport<WorkflowOutput>, ArtifactWorkflowError, any> {
  return Effect.gen(function* () {
    const now = options.now ?? (() => new Date().toISOString());
    const runId = options.runId ?? `run-${Date.now().toString(36)}`;
    const writeMode = options.writeMode ?? "apply";
    const input = yield* decodeWithSchema(options.workflow.input, options.input, "workflow input");
    const inputHash = hashJson(input);
    const capabilityMap = new Map(
      (options.capabilities ?? []).map((impl) => [impl.capability.id, impl]),
    );
    yield* preflightCapabilities(options.workflow as DefinedArtifactWorkflow, capabilityMap);

    const manifestPath = runManifestPath(runId);
    const existing = yield* readManifest(options.store, manifestPath);
    let manifest: WorkflowManifest =
      existing ??
      ({
        version: 1,
        runId,
        workflowId: options.workflow.id,
        status: "running",
        writeMode,
        inputHash,
        startedAt: now(),
        updatedAt: now(),
        steps: {},
      } satisfies WorkflowManifest);

    if (manifest.workflowId !== options.workflow.id) {
      return yield* Effect.fail(
        new ArtifactWorkflowError(
          `Run ${runId} belongs to workflow ${manifest.workflowId}, not ${options.workflow.id}.`,
          "definition",
        ),
      );
    }

    const outputs: Record<string, unknown> = {};
    const proposedEdits: ArtifactWorkflowFileEdit[] = [];
    const fromIndex = options.fromStep ? options.workflow.order.indexOf(options.fromStep) : -1;
    if (options.fromStep && fromIndex < 0) {
      return yield* Effect.fail(
        new ArtifactWorkflowError(
          `Unknown resume step ${options.fromStep} for workflow ${options.workflow.id}.`,
          "definition",
        ),
      );
    }

    manifest = { ...manifest, status: "running", updatedAt: now() };
    yield* persistManifest(options.store, manifestPath, manifest);

    for (const stepId of options.workflow.order) {
      const workflowStep = options.workflow.steps[stepId]!;
      const stepIndex = options.workflow.order.indexOf(stepId);
      const actionInputRaw = workflowStep.input
        ? workflowStep.input({ workflowInput: input, outputs })
        : input;
      const actionInput = yield* decodeWithSchema(
        workflowStep.action.input,
        actionInputRaw,
        `${stepId} input`,
      );
      const stepInputHash = hashJson(actionInput);
      const existingStep = manifest.steps[stepId];
      const canSkip =
        fromIndex < 0 &&
        existingStep?.status === "completed" &&
        existingStep.inputHash === stepInputHash;

      if (canSkip) {
        const output = yield* readStepJson(options.store, runStepOutputPath(runId, stepId));
        outputs[stepId] = output;
        manifest = updateManifestStep(
          manifest,
          stepId,
          { ...existingStep, status: "skipped" },
          now,
        );
        yield* persistManifest(options.store, manifestPath, manifest);
        continue;
      }

      if (fromIndex >= 0 && stepIndex < fromIndex) {
        const output = yield* readStepJson(options.store, runStepOutputPath(runId, stepId));
        outputs[stepId] = output;
        continue;
      }

      const startedAt = now();
      let writes: ArtifactWorkflowFileEdit[] = [];
      let stepCost: ArtifactWorkflowStepCost | undefined;
      manifest = updateManifestStep(
        manifest,
        stepId,
        {
          stepId,
          actionId: workflowStep.action.id,
          status: "running",
          inputHash: stepInputHash,
          startedAt,
          writes: [],
          provenance: [],
        },
        now,
      );
      yield* persistStepJson(options.store, runStepInputPath(runId, stepId), actionInput);
      yield* persistManifest(options.store, manifestPath, manifest);

      const context: ArtifactWorkflowContext<typeof actionInput> = {
        input: actionInput,
        store: options.store,
        capabilities: capabilityMap,
        run: {
          id: runId,
          workflowId: options.workflow.id,
          stepId,
          actionId: workflowStep.action.id,
          scratchPath: `.schematics/runs/${runId}/`,
        },
        readFile: (path) => readProjectFile(options.store, path),
        writeFile: (path, content) =>
          writeProjectFile({
            store: options.store,
            mutationHost: options.mutationHost,
            writeMode,
            proposedEdits,
            path,
            content,
            validate: workflowStep.action.validateAfterWrite,
            provenance: {
              actor: "system",
              turnId: runId,
              toolCallId: `${stepId}:${workflowStep.action.id}`,
            },
          }).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                writes = [...writes, { path, content }];
              }),
            ),
          ),
        capability: <I, O>(id: string, capabilityInput: I) => {
          const implementation = capabilityMap.get(id);
          if (!implementation) {
            return Effect.fail(
              new ArtifactWorkflowError(`Missing required capability: ${id}`, "capability"),
            );
          }
          return implementation.run(capabilityInput) as Effect.Effect<O, unknown>;
        },
      };

      const languageModel = workflowStep.action.uses.includes("ai.language")
        ? yield* resolveLanguageModelCapability({
            capabilities: capabilityMap,
            runId,
            workflowId: options.workflow.id,
            stepId,
            actionId: workflowStep.action.id,
            recordCost: (cost) => {
              stepCost = mergeStepCost(stepCost, cost);
            },
          })
        : undefined;
      const actionEffect = workflowStep.action.run(context);
      const providedActionEffect = languageModel
        ? actionEffect.pipe(Effect.provideService(LanguageModel.LanguageModel, languageModel))
        : actionEffect;

      const result = yield* Effect.match(
        providedActionEffect.pipe(
          Effect.mapError(
            (error) =>
              new ArtifactWorkflowError(
                error instanceof Error ? error.message : String(error),
                "step",
                error,
              ),
          ),
        ),
        {
          onFailure: (left) => ({ _tag: "Left" as const, left }),
          onSuccess: (right) => ({ _tag: "Right" as const, right }),
        },
      );

      if (result._tag === "Left") {
        const diagnostics = [result.left.message];
        yield* persistStepJson(options.store, runStepDiagnosticsPath(runId, stepId), diagnostics);
        manifest = updateManifestStep(
          { ...manifest, status: "failed" },
          stepId,
          {
            stepId,
            actionId: workflowStep.action.id,
            status: "failed",
            inputHash: stepInputHash,
            startedAt,
            completedAt: now(),
            diagnostics,
            writes,
            provenance: writes.map((write) => ({
              path: write.path,
              runId,
              stepId,
              actionId: workflowStep.action.id,
            })),
            ...(stepCost ? { cost: stepCost } : {}),
          },
          now,
        );
        yield* persistManifest(options.store, manifestPath, manifest);
        return yield* Effect.fail(result.left);
      }

      const actionOutput = yield* decodeWithSchema(
        workflowStep.action.output,
        result.right,
        `${stepId} output`,
      );
      outputs[stepId] = actionOutput;
      yield* persistStepJson(options.store, runStepOutputPath(runId, stepId), actionOutput);
      manifest = updateManifestStep(
        manifest,
        stepId,
        {
          stepId,
          actionId: workflowStep.action.id,
          status: "completed",
          inputHash: stepInputHash,
          outputHash: hashJson(actionOutput),
          startedAt,
          completedAt: now(),
          writes,
          provenance: writes.map((write) => ({
            path: write.path,
            runId,
            stepId,
            actionId: workflowStep.action.id,
          })),
          ...(stepCost ? { cost: stepCost } : {}),
        },
        now,
      );
      yield* persistManifest(options.store, manifestPath, manifest);
    }

    const outputRaw = options.workflow.outputFromSteps(outputs);
    const output = yield* decodeWithSchema(options.workflow.output, outputRaw, "workflow output");
    let patch = manifest.patch;
    if (writeMode === "propose" && proposedEdits.length > 0) {
      patch = yield* proposePatch(
        options.mutationHost,
        `Workflow ${options.workflow.id}`,
        proposedEdits,
      );
    }
    manifest = {
      ...manifest,
      status: "completed",
      output,
      ...(patch ? { patch } : {}),
      updatedAt: now(),
    };
    yield* persistManifest(options.store, manifestPath, manifest);
    return { runId, status: manifest.status, manifest, output, ...(patch ? { patch } : {}) };
  });
}

function topoSort<WorkflowInput>(
  workflowId: string,
  steps: Readonly<Record<string, ArtifactWorkflowStep<WorkflowInput>>>,
): readonly string[] {
  const ids = Object.keys(steps);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id))
      throw new Error(`defineArtifactWorkflow(${workflowId}): duplicate step ${id}`);
    seen.add(id);
    for (const dependency of steps[id]?.after ?? []) {
      if (!steps[dependency]) {
        throw new Error(
          `defineArtifactWorkflow(${workflowId}): step ${id} depends on unknown step ${dependency}`,
        );
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const order: string[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`defineArtifactWorkflow(${workflowId}): cycle involving step ${id}`);
    }
    visiting.add(id);
    for (const dependency of steps[id]?.after ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  };
  for (const id of ids) visit(id);
  return order;
}

function preflightCapabilities(
  workflow: DefinedArtifactWorkflow,
  capabilities: ReadonlyMap<string, ArtifactCapabilityImplementation>,
): Effect.Effect<void, ArtifactWorkflowError> {
  const missing = workflow.uses.filter((id) => !capabilities.has(id));
  if (missing.length > 0) {
    return Effect.fail(
      new ArtifactWorkflowError(
        `Workflow ${workflow.id} requires missing host capabilities: ${missing.join(", ")}. ` +
          `Wire these capabilities into the ingestion host before starting the run.`,
        "capability",
        { missing },
      ),
    );
  }
  return Effect.void;
}

function resolveLanguageModelCapability({
  capabilities,
  runId,
  workflowId,
  stepId,
  actionId,
  recordCost,
}: {
  readonly capabilities: ReadonlyMap<string, ArtifactCapabilityImplementation>;
  readonly runId: string;
  readonly workflowId: string;
  readonly stepId: string;
  readonly actionId: string;
  readonly recordCost: (cost: ArtifactWorkflowStepCost) => void;
}): Effect.Effect<LanguageModel.Service, ArtifactWorkflowError, any> {
  const implementation = capabilities.get("ai.language");
  if (!implementation) {
    return Effect.fail(
      new ArtifactWorkflowError("Missing required capability: ai.language", "capability"),
    );
  }
  return implementation
    .run({
      runId,
      workflowId,
      stepId,
      actionId,
    } satisfies ArtifactWorkflowLanguageModelCapabilityInput)
    .pipe(
      Effect.map((output) => normalizeLanguageModelCapabilityOutput(output, recordCost)),
      Effect.mapError(
        (error) =>
          new ArtifactWorkflowError(
            error instanceof Error ? error.message : String(error),
            "capability",
            error,
          ),
      ),
    );
}

function normalizeLanguageModelCapabilityOutput(
  output: unknown,
  recordCost: (cost: ArtifactWorkflowStepCost) => void,
): LanguageModel.Service {
  const modelOutput = isLanguageModelCapabilityOutput(output)
    ? output
    : ({
        service: output as LanguageModel.Service,
      } satisfies ArtifactWorkflowLanguageModelCapabilityOutput);
  return meterLanguageModel(modelOutput, recordCost);
}

function isLanguageModelCapabilityOutput(
  output: unknown,
): output is ArtifactWorkflowLanguageModelCapabilityOutput {
  return (
    typeof output === "object" &&
    output !== null &&
    "service" in output &&
    typeof (output as { readonly service?: unknown }).service === "object"
  );
}

function meterLanguageModel(
  output: ArtifactWorkflowLanguageModelCapabilityOutput,
  recordCost: (cost: ArtifactWorkflowStepCost) => void,
): LanguageModel.Service {
  const service = output.service;
  return {
    ...service,
    generateText: ((options: unknown) =>
      (service.generateText as any)(options).pipe(
        Effect.tap((response: any) =>
          Effect.sync(() => {
            recordCost(costFromUsage(response?.usage, output));
          }),
        ),
      )) as LanguageModel.Service["generateText"],
    generateObject: ((options: unknown) =>
      (service.generateObject as any)(options).pipe(
        Effect.tap((response: any) =>
          Effect.sync(() => {
            recordCost(costFromUsage(response?.usage, output));
          }),
        ),
      )) as LanguageModel.Service["generateObject"],
    streamText: ((options: unknown) =>
      (service.streamText as any)(options).pipe(
        Stream.tap((part: any) =>
          part?.type === "finish"
            ? Effect.sync(() => {
                recordCost(costFromUsage(part.usage, output));
              })
            : Effect.void,
        ),
      )) as LanguageModel.Service["streamText"],
  };
}

function costFromUsage(
  usage: any,
  output: ArtifactWorkflowLanguageModelCapabilityOutput,
): ArtifactWorkflowStepCost {
  const inputTokens = usage?.inputTokens?.total ?? usage?.prompt_tokens;
  const outputTokens = usage?.outputTokens?.total ?? usage?.completion_tokens;
  const tokens = sumDefined(inputTokens, outputTokens);
  const inputCost = costUsd(inputTokens, output.inputTokenCostUsdPerMillion);
  const outputCost = costUsd(outputTokens, output.outputTokenCostUsdPerMillion);
  return {
    ...(tokens !== undefined ? { tokens } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(inputCost !== undefined || outputCost !== undefined
      ? { usd: (inputCost ?? 0) + (outputCost ?? 0) }
      : {}),
  };
}

function mergeStepCost(
  current: ArtifactWorkflowStepCost | undefined,
  next: ArtifactWorkflowStepCost,
): ArtifactWorkflowStepCost {
  return {
    tokens: sumDefined(current?.tokens, next.tokens),
    inputTokens: sumDefined(current?.inputTokens, next.inputTokens),
    outputTokens: sumDefined(current?.outputTokens, next.outputTokens),
    usd: sumDefined(current?.usd, next.usd),
  };
}

function sumDefined(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return left + right;
}

function costUsd(
  tokens: number | undefined,
  usdPerMillion: number | undefined,
): number | undefined {
  return tokens === undefined || usdPerMillion === undefined
    ? undefined
    : (tokens / 1_000_000) * usdPerMillion;
}

function decodeWithSchema<A>(
  schema: Schema.Schema<A>,
  value: unknown,
  label: string,
): Effect.Effect<A, ArtifactWorkflowError> {
  return Effect.try({
    try: () => Schema.decodeUnknownSync(schema as any)(value) as A,
    catch: (error) =>
      new ArtifactWorkflowError(
        `Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`,
        "decode",
        error,
      ),
  });
}

function readProjectFile(
  store: ArtifactStore,
  path: string,
): Effect.Effect<string, ArtifactWorkflowError> {
  return store.read(ArtifactRef.projectFile(path)).pipe(
    Effect.map((content) =>
      typeof content === "string" ? content : Buffer.from(content).toString("base64"),
    ),
    Effect.mapError(
      (error) => new ArtifactWorkflowError(`File not found: ${path}`, "not-found", error),
    ),
  );
}

function writeProjectFile({
  store,
  mutationHost,
  writeMode,
  proposedEdits,
  path,
  content,
  validate,
  provenance,
}: {
  readonly store: ArtifactStore;
  readonly mutationHost?: ArtifactWorkflowMutationHost | undefined;
  readonly writeMode: ArtifactWorkflowWriteMode;
  readonly proposedEdits: ArtifactWorkflowFileEdit[];
  readonly path: string;
  readonly content: string;
  readonly validate: boolean;
  readonly provenance: ArtifactWorkflowProvenance;
}): Effect.Effect<ArtifactWorkflowWriteResult, ArtifactWorkflowError> {
  const edit = { path, content } satisfies ArtifactWorkflowFileEdit;
  if (writeMode === "propose") {
    proposedEdits.push(edit);
    return Effect.succeed({ changedPaths: [path] });
  }
  if (mutationHost) {
    return effectFromMaybe(mutationHost.applyEdits([edit], { validate, provenance })).pipe(
      Effect.mapError(
        (error) =>
          new ArtifactWorkflowError(
            error instanceof Error ? error.message : String(error),
            "mutation",
            error,
          ),
      ),
    );
  }
  return upsertStoreFile(store, path, content).pipe(Effect.as({ changedPaths: [path] }));
}

function proposePatch(
  mutationHost: ArtifactWorkflowMutationHost | undefined,
  label: string,
  edits: readonly ArtifactWorkflowFileEdit[],
): Effect.Effect<ArtifactWorkflowPatchProposal, ArtifactWorkflowError> {
  if (mutationHost?.proposePatch) {
    return effectFromMaybe(mutationHost.proposePatch(label, edits)).pipe(
      Effect.mapError(
        (error) =>
          new ArtifactWorkflowError(
            error instanceof Error ? error.message : String(error),
            "mutation",
            error,
          ),
      ),
    );
  }
  return Effect.succeed({
    id: `patch-${hashJson(edits)}`,
    label,
    edits,
  });
}

function effectFromMaybe<A, E>(
  value: A | Promise<A> | Effect.Effect<A, E>,
): Effect.Effect<A, E | unknown> {
  if (Effect.isEffect(value)) return value;
  return Effect.tryPromise({
    try: () => Promise.resolve(value),
    catch: (error) => error,
  });
}

function upsertStoreFile(
  store: ArtifactStore,
  path: string,
  content: string,
): Effect.Effect<void, ArtifactWorkflowError> {
  const ref = ArtifactRef.projectFile(path);
  return store.write(ref, content).pipe(
    Effect.catch((error) =>
      error.reason === "not-found"
        ? store.create(ref, content).pipe(Effect.asVoid)
        : Effect.fail(error),
    ),
    Effect.mapError(
      (error) =>
        new ArtifactWorkflowError(`Could not write ${path}: ${error.reason}`, "store", error),
    ),
  );
}

function readManifest(
  store: ArtifactStore,
  path: string,
): Effect.Effect<WorkflowManifest | null, ArtifactWorkflowError> {
  return store.read(ArtifactRef.projectFile(path)).pipe(
    Effect.map((content) => JSON.parse(String(content)) as WorkflowManifest),
    Effect.catch((error) =>
      typeof error === "object" &&
      error !== null &&
      "reason" in error &&
      error.reason === "not-found"
        ? Effect.succeed(null)
        : Effect.fail(
            new ArtifactWorkflowError(`Could not read run manifest ${path}`, "store", error),
          ),
    ),
  );
}

function persistManifest(
  store: ArtifactStore,
  path: string,
  manifest: WorkflowManifest,
): Effect.Effect<void, ArtifactWorkflowError> {
  return upsertStoreFile(store, path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function persistStepJson(
  store: ArtifactStore,
  path: string,
  value: unknown,
): Effect.Effect<void, ArtifactWorkflowError> {
  return upsertStoreFile(store, path, `${JSON.stringify(value, null, 2)}\n`);
}

function readStepJson(
  store: ArtifactStore,
  path: string,
): Effect.Effect<unknown, ArtifactWorkflowError> {
  return store.read(ArtifactRef.projectFile(path)).pipe(
    Effect.map((content) => JSON.parse(String(content)) as unknown),
    Effect.mapError(
      (error) =>
        new ArtifactWorkflowError(`Could not read persisted step output ${path}`, "store", error),
    ),
  );
}

function updateManifestStep(
  manifest: WorkflowManifest,
  stepId: string,
  stepRecord: ArtifactWorkflowStepRecord,
  now: () => string,
): WorkflowManifest {
  return {
    ...manifest,
    updatedAt: now(),
    steps: {
      ...manifest.steps,
      [stepId]: stepRecord,
    },
  };
}

function runManifestPath(runId: string): string {
  return `.schematics/runs/${runId}/manifest.json`;
}

function runStepInputPath(runId: string, stepId: string): string {
  return `.schematics/runs/${runId}/steps/${stepId}/input.json`;
}

function runStepOutputPath(runId: string, stepId: string): string {
  return `.schematics/runs/${runId}/steps/${stepId}/output.json`;
}

function runStepDiagnosticsPath(runId: string, stepId: string): string {
  return `.schematics/runs/${runId}/steps/${stepId}/diagnostics.json`;
}

function hashJson(value: unknown): string {
  const text = stableStringify(value);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}

export function artifactContentKey(content: ArtifactContent): string {
  return typeof content === "string" ? content : Buffer.from(content).toString("base64");
}

export function artifactRefIdentity(ref: Parameters<typeof artifactRefKey>[0]): string {
  return artifactRefKey(ref);
}

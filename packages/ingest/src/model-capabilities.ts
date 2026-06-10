import { Effect, Schema } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import {
  defineArtifactAction,
  defineCapability,
  type ArtifactCapabilityImplementation,
  type ArtifactWorkflowContext,
  type ArtifactWorkflowLanguageModelCapabilityInput,
  type ArtifactWorkflowLanguageModelCapabilityOutput,
} from "./workflow";

export const AI_LANGUAGE_CAPABILITY_ID = "ai.language" as const;
export const AI_GENERATE_STRUCTURED_CAPABILITY_ID = "ai.generateStructured" as const;
export const AI_JUDGE_CAPABILITY_ID = "ai.judge" as const;

export const AiLanguageCapabilityInputSchema = Schema.Struct({
  runId: Schema.String,
  workflowId: Schema.String,
  stepId: Schema.String,
  actionId: Schema.String,
  modelProfile: Schema.optional(Schema.String),
});

export const AiLanguageCapability = defineCapability<
  ArtifactWorkflowLanguageModelCapabilityInput,
  ArtifactWorkflowLanguageModelCapabilityOutput
>({
  id: AI_LANGUAGE_CAPABILITY_ID,
  input: AiLanguageCapabilityInputSchema,
});

export interface CreateLanguageModelCapabilityOptions {
  readonly service: LanguageModel.Service;
  readonly modelId?: string | undefined;
  readonly inputTokenCostUsdPerMillion?: number | undefined;
  readonly outputTokenCostUsdPerMillion?: number | undefined;
}

export function createLanguageModelCapability(
  options: CreateLanguageModelCapabilityOptions,
): ArtifactCapabilityImplementation<
  ArtifactWorkflowLanguageModelCapabilityInput,
  ArtifactWorkflowLanguageModelCapabilityOutput
> {
  return {
    capability: AiLanguageCapability,
    run: () =>
      Effect.succeed({
        service: options.service,
        ...(options.modelId ? { modelId: options.modelId } : {}),
        ...(options.inputTokenCostUsdPerMillion !== undefined
          ? { inputTokenCostUsdPerMillion: options.inputTokenCostUsdPerMillion }
          : {}),
        ...(options.outputTokenCostUsdPerMillion !== undefined
          ? { outputTokenCostUsdPerMillion: options.outputTokenCostUsdPerMillion }
          : {}),
      }),
  };
}

export interface GenerateStructuredCapabilityInput<A> {
  readonly prompt: string;
  readonly schema: Schema.Schema<A>;
  readonly objectName?: string | undefined;
}

export const AiGenerateStructuredCapability = defineCapability<
  GenerateStructuredCapabilityInput<unknown>,
  unknown
>({
  id: AI_GENERATE_STRUCTURED_CAPABILITY_ID,
});

export function createGenerateStructuredCapability(
  languageModel: LanguageModel.Service,
): ArtifactCapabilityImplementation<GenerateStructuredCapabilityInput<unknown>, unknown> {
  return {
    capability: AiGenerateStructuredCapability,
    run: (input) =>
      languageModel
        .generateObject({
          prompt: input.prompt,
          schema: input.schema,
          objectName: input.objectName ?? "result",
        } as any)
        .pipe(Effect.map((response) => response.value)),
  };
}

export interface JudgeCapabilityInput {
  readonly prompt: string;
}

export interface JudgeCapabilityOutput {
  readonly verdict: string;
}

export const AiJudgeCapability = defineCapability<JudgeCapabilityInput, JudgeCapabilityOutput>({
  id: AI_JUDGE_CAPABILITY_ID,
  input: Schema.Struct({ prompt: Schema.String }),
  output: Schema.Struct({ verdict: Schema.String }),
});

export function createJudgeCapability(
  languageModel: LanguageModel.Service,
): ArtifactCapabilityImplementation<JudgeCapabilityInput, JudgeCapabilityOutput> {
  return {
    capability: AiJudgeCapability,
    run: (input) =>
      languageModel
        .generateText({ prompt: input.prompt })
        .pipe(Effect.map((response) => ({ verdict: response.text.trim() }))),
  };
}

export interface ModelActionOptions<Input, Output> {
  readonly id: string;
  readonly input: Schema.Schema<Input>;
  readonly output: Schema.Schema<Output>;
  readonly prompt: (context: ArtifactWorkflowContext<Input>) => string;
  readonly objectName?: string | undefined;
}

export function modelAction<Input, Output>(options: ModelActionOptions<Input, Output>) {
  return defineArtifactAction({
    id: options.id,
    input: options.input,
    output: options.output,
    uses: [AI_LANGUAGE_CAPABILITY_ID],
    mode: "model",
    run: (context) =>
      LanguageModel.generateObject({
        prompt: options.prompt(context),
        schema: options.output,
        objectName: options.objectName ?? "result",
      } as any).pipe(Effect.map((response) => response.value as Output)),
  });
}

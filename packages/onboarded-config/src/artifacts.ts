import {
  createArtifactProjectFromWorkspace,
  decodeYamlEither,
  createSchemaIdeArtifactRuntime,
  type SchemaIdeDocumentFormat,
  type SchemaIdeArtifactRuntime,
  type SourceFile,
} from "@schema-ide/core";
import { Result, Schema, SchemaIssue } from "effect";
import { OnboardedRelationWorkspaceSchema, createOnboardedRelationWorkspace } from "./relations";
import { OnboardedAccountWorkspaceSchema, type AccountWorkspaceValue } from "./workspace";

export const OnboardedArtifactProjectRouteSchema = Schema.Struct({
  id: Schema.String,
  pattern: Schema.String,
  artifact: Schema.String,
  format: Schema.Literals(["json", "yaml"] as const),
  optional: Schema.optional(Schema.Boolean),
  description: Schema.optional(Schema.String),
});

export const OnboardedArtifactProjectConfigSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  defaultFormat: Schema.Literals(["json", "yaml"] as const),
  include: Schema.Array(Schema.String),
  files: Schema.Array(OnboardedArtifactProjectRouteSchema),
  algebra: Schema.Struct({
    relationSchema: Schema.String,
    views: Schema.Array(Schema.String),
  }),
});

export type OnboardedArtifactProjectRoute = typeof OnboardedArtifactProjectRouteSchema.Type;
export type OnboardedArtifactProjectConfig = typeof OnboardedArtifactProjectConfigSchema.Type;
export const OnboardedArtifactProject = createArtifactProjectFromWorkspace(
  OnboardedAccountWorkspaceSchema,
  { name: "onboarded-account-yaml" },
);

export interface CreateOnboardedArtifactRuntimeOptions {
  readonly files: readonly SourceFile[];
  readonly activeFile?: string | null | undefined;
  readonly workspaceId?: string | undefined;
  readonly defaultFormat?: SchemaIdeDocumentFormat | undefined;
}

export type OnboardedArtifactRuntime = SchemaIdeArtifactRuntime<AccountWorkspaceValue>;

export function parseOnboardedArtifactProjectConfig(text: string): OnboardedArtifactProjectConfig {
  const result = decodeYamlEither(OnboardedArtifactProjectConfigSchema, text);
  if (Result.isSuccess(result)) return result.success;
  throw new Error(SchemaIssue.makeFormatterDefault()(result.failure));
}

export function createOnboardedArtifactRuntime({
  files,
  activeFile = files[0]?.path ?? null,
  workspaceId = "onboarded-account-yaml",
  defaultFormat = "yaml",
}: CreateOnboardedArtifactRuntimeOptions): OnboardedArtifactRuntime {
  return createSchemaIdeArtifactRuntime({
    schema: OnboardedAccountWorkspaceSchema,
    relationSchema: OnboardedRelationWorkspaceSchema,
    relationValue: createOnboardedRelationWorkspace,
    files,
    activeFile,
    activeFormat: defaultFormat,
    project: OnboardedArtifactProject,
    workspaceId,
  });
}

export function createOnboardedArtifactRuntimeFromProjectConfig({
  config,
  files,
  activeFile = files[0]?.path ?? null,
}: {
  readonly config: OnboardedArtifactProjectConfig;
  readonly files: readonly SourceFile[];
  readonly activeFile?: string | null | undefined;
}): OnboardedArtifactRuntime {
  return createOnboardedArtifactRuntime({
    files,
    activeFile,
    workspaceId: config.id,
    defaultFormat: config.defaultFormat,
  });
}

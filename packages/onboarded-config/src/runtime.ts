import {
  createSchemaIdeArtifactRuntime,
  type SchemaIdeArtifactRuntime,
  type SchemaIdeDocumentFormat,
  type SourceFile,
} from "@schema-ide/core";
import type { ArtifactProjectDeclaration } from "@schema-ide/artifacts";
import {
  OnboardedArtifactProject,
  createOnboardedArtifactProject,
  type OnboardedArtifactProjectConfig,
} from "./artifacts";
import { OnboardedRelationWorkspaceSchema, createOnboardedRelationWorkspace } from "./relations";
import {
  OnboardedAccountWorkspaceBaseSchema,
  validateOnboardedAccountWorkspaceValue,
  type AccountWorkspaceValue,
} from "./workspace";

export interface CreateOnboardedArtifactRuntimeOptions {
  readonly files: readonly SourceFile[];
  readonly activeFile?: string | null | undefined;
  readonly projectId?: string | undefined;
  readonly defaultFormat?: SchemaIdeDocumentFormat | undefined;
  readonly project?: ArtifactProjectDeclaration<string, any, any> | undefined;
}

export type OnboardedArtifactRuntime = SchemaIdeArtifactRuntime<AccountWorkspaceValue>;

export function createOnboardedArtifactRuntime({
  files,
  activeFile = files[0]?.path ?? null,
  projectId = "onboarded-account-yaml",
  defaultFormat = "yaml",
  project = OnboardedArtifactProject,
}: CreateOnboardedArtifactRuntimeOptions): OnboardedArtifactRuntime {
  return createSchemaIdeArtifactRuntime<AccountWorkspaceValue>({
    relationInputSchema: OnboardedAccountWorkspaceBaseSchema as any,
    relationSchema: OnboardedRelationWorkspaceSchema,
    relationValue: createOnboardedRelationWorkspace,
    projectDiagnostics: (value, context) =>
      validateOnboardedAccountWorkspaceValue(value, context.files),
    files,
    activeFile,
    activeFormat: defaultFormat,
    project,
    projectId,
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
    projectId: config.id,
    defaultFormat: config.defaultFormat,
    project: createOnboardedArtifactProject(config),
  });
}

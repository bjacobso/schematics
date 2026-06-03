import {
  createSchematicsArtifactRuntime,
  type SchematicsArtifactRuntime,
  type SchematicsDocumentFormat,
  type SourceFile,
} from "@schematics/core";
import type { ArtifactProjectDeclaration } from "@schematics/artifacts";
import {
  OnboardedArtifactProject,
  createOnboardedArtifactProject,
  type OnboardedArtifactProjectConfig,
} from "./artifacts";
import { OnboardedRelationProjectSchema, createOnboardedRelationWorkspace } from "./relations";
import {
  OnboardedAccountProjectBaseSchema,
  validateOnboardedAccountWorkspaceValue,
  type AccountWorkspaceValue,
} from "./workspace";

export interface CreateOnboardedArtifactRuntimeOptions {
  readonly files: readonly SourceFile[];
  readonly activeFile?: string | null | undefined;
  readonly projectId?: string | undefined;
  readonly defaultFormat?: SchematicsDocumentFormat | undefined;
  readonly project?: ArtifactProjectDeclaration<string, any, any> | undefined;
}

export type OnboardedArtifactRuntime = SchematicsArtifactRuntime<AccountWorkspaceValue>;

export function createOnboardedArtifactRuntime({
  files,
  activeFile = files[0]?.path ?? null,
  projectId = "onboarded-account-yaml",
  defaultFormat = "yaml",
  project = OnboardedArtifactProject,
}: CreateOnboardedArtifactRuntimeOptions): OnboardedArtifactRuntime {
  return createSchematicsArtifactRuntime<AccountWorkspaceValue>({
    relationInputSchema: OnboardedAccountProjectBaseSchema as any,
    relationSchema: OnboardedRelationProjectSchema,
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

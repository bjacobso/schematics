import { createEmbeddedSchematicsCli, defineSchematicsProject } from "@schematics/cli";
import { Project } from "@schematics/core";
import type { DefinedProvider } from "./provider";

export interface DefineProviderProjectOptions {
  readonly id?: string | undefined;
}

/**
 * The schematics project definition for a provider, consumed by the IDE CLI +
 * SEA binary build — derived from the provider's artifact project, relation
 * schema, and validation. Node-only (pulls `@schematics/cli`); import from
 * `@schematics/provider/cli`.
 */
export function defineProviderProject(
  provider: DefinedProvider,
  options: DefineProviderProjectOptions = {},
) {
  return defineSchematicsProject<any>({
    id: options.id ?? provider.project.name,
    project: provider.project,
    relationInputSchema: Project.fromArtifactProject(provider.project) as any,
    relationSchema: provider.workspaceSchema as any,
    projectDiagnostics: (value: any, context: any) => provider.projectDiagnostics(value, context),
    defaultFormat: provider.defaultFormat,
    include: provider.project.config.include,
    ingestors: provider.ingestors,
  });
}

export interface CreateProviderCliOptions {
  readonly name?: string | undefined;
  readonly projectId?: string | undefined;
}

/** An embedded `pull/plan/apply/validate/web` CLI for a provider. */
export function createProviderCli(
  provider: DefinedProvider,
  options: CreateProviderCliOptions = {},
) {
  return createEmbeddedSchematicsCli({
    name: options.name ?? provider.id,
    project: defineProviderProject(provider, { id: options.projectId }),
  });
}

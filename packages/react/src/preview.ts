import type { ComponentType } from "react";
import type {
  ArtifactProjectDeclaration,
  ArtifactProjectRouteId,
  ArtifactProjectRouteValue,
} from "@schema-ide/artifacts";
import type {
  SchemaIdeDiagnostic,
  SchemaIdeDocumentFormat,
  SchemaIdeReflection,
  SourceFile,
  WorkspaceRouteMap,
} from "@schema-ide/core";

export type SchemaIdeEditorMode = "code" | "preview";

export interface SchemaIdePreviewComponentProps<Value = unknown, SchemaId extends string = string> {
  readonly schemaId: SchemaId;
  readonly file: SourceFile;
  readonly files: readonly SourceFile[];
  readonly value: Value | null;
  readonly jsonSchema: unknown | null;
  readonly format: SchemaIdeDocumentFormat;
  readonly reflection: SchemaIdeReflection;
  readonly diagnostics: readonly SchemaIdeDiagnostic[];
  readonly readOnly: boolean;
  readonly onChange: (content: string) => void;
}

export interface SchemaIdePreviewRegistration<Value = unknown, SchemaId extends string = string> {
  readonly id: string;
  readonly schemaId: SchemaId;
  readonly label: string;
  readonly component: ComponentType<SchemaIdePreviewComponentProps<Value, SchemaId>>;
}

export type SchemaIdePreviewRegistrationForRoutes<Routes extends WorkspaceRouteMap> = {
  readonly [Id in Extract<keyof Routes, string>]: SchemaIdePreviewRegistration<Routes[Id], Id>;
}[Extract<keyof Routes, string>];

export type ArtifactProjectPreviewRegistration<
  Project extends ArtifactProjectDeclaration<string, any, any>,
> = {
  readonly [Id in ArtifactProjectRouteId<Project>]: SchemaIdePreviewRegistration<
    ArtifactProjectRouteValue<Project, Id>,
    Id
  >;
}[ArtifactProjectRouteId<Project>];

export const ArtifactProjectPreview = {
  make<
    Project extends ArtifactProjectDeclaration<string, any, any>,
    const Registrations extends readonly ArtifactProjectPreviewRegistration<Project>[],
  >(_project: Project, registrations: Registrations): Registrations {
    return registrations;
  },
};

export interface SchemaIdePreviewResolution {
  readonly schemaId: string;
  readonly previews: readonly SchemaIdePreviewRegistration<unknown, string>[];
  readonly selected: SchemaIdePreviewRegistration<unknown, string>;
  readonly jsonSchema: unknown | null;
}

export function resolveSchemaIdePreview({
  previews,
  reflection,
  file,
  jsonSchemaByPath,
  selectedPreviewId,
}: {
  readonly previews: readonly SchemaIdePreviewRegistration<unknown, string>[];
  readonly reflection: SchemaIdeReflection;
  readonly file: SourceFile | null;
  readonly jsonSchemaByPath?: Readonly<Record<string, unknown>> | undefined;
  readonly selectedPreviewId?: string | null | undefined;
}): SchemaIdePreviewResolution | null {
  if (!file) return null;

  const schemaId =
    reflection.routeMatches.find((route) => route.path === file.path)?.schemaId ?? null;
  if (!schemaId) return null;

  const matches = previews.filter((preview) => preview.schemaId === schemaId);
  if (!matches.length) return null;

  return {
    schemaId,
    previews: matches,
    selected: matches.find((preview) => preview.id === selectedPreviewId) ?? matches[0]!,
    jsonSchema: Object.prototype.hasOwnProperty.call(jsonSchemaByPath ?? {}, file.path)
      ? (jsonSchemaByPath ?? {})[file.path]
      : (reflection.schemas.find((schema) => schema.id === schemaId)?.jsonSchema ??
        reflection.activeJsonSchema),
  };
}

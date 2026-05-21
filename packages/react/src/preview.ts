import type { ComponentType } from "react";
import type {
  SchemaIdeDiagnostic,
  SchemaIdeDocumentFormat,
  SchemaIdeReflection,
  SourceFile,
  WorkspaceRouteId,
  WorkspaceRouteMap,
  WorkspaceRouteValue,
  WorkspaceSchema,
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

export type WorkspacePreviewRegistration<S extends WorkspaceSchema<unknown, WorkspaceRouteMap>> = {
  readonly [Id in WorkspaceRouteId<S>]: SchemaIdePreviewRegistration<
    WorkspaceRouteValue<S, Id>,
    Id
  >;
}[WorkspaceRouteId<S>];

export const WorkspacePreview = {
  make<
    S extends WorkspaceSchema<unknown, WorkspaceRouteMap>,
    const Registrations extends readonly WorkspacePreviewRegistration<S>[],
  >(_workspace: S, registrations: Registrations): Registrations {
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
  selectedPreviewId,
}: {
  readonly previews: readonly SchemaIdePreviewRegistration<unknown, string>[];
  readonly reflection: SchemaIdeReflection;
  readonly file: SourceFile | null;
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
    jsonSchema:
      reflection.schemas.find((schema) => schema.id === schemaId)?.jsonSchema ??
      reflection.activeJsonSchema,
  };
}

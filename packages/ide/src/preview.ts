import type { ComponentType } from "react";
import type {
  ArtifactProjectDeclaration,
  ArtifactProjectRouteId,
  ArtifactProjectRouteValue,
} from "@schematics/artifacts";
import type {
  SchematicsDiagnostic,
  SchematicsDocumentFormat,
  SchematicsReflection,
  SourceFile,
  ProjectRouteMap,
} from "@schematics/core";

export type SchematicsEditorMode = "code" | "preview";

export interface SchematicsPreviewComponentProps<
  Value = unknown,
  SchemaId extends string = string,
> {
  readonly schemaId: SchemaId;
  readonly file: SourceFile;
  readonly files: readonly SourceFile[];
  readonly value: Value | null;
  readonly jsonSchema: unknown | null;
  readonly format: SchematicsDocumentFormat;
  readonly reflection: SchematicsReflection;
  readonly diagnostics: readonly SchematicsDiagnostic[];
  readonly readOnly: boolean;
  readonly onChange: (content: string) => void;
}

export interface SchematicsPreviewRegistration<Value = unknown, SchemaId extends string = string> {
  readonly id: string;
  readonly schemaId: SchemaId;
  readonly label: string;
  readonly component: ComponentType<SchematicsPreviewComponentProps<Value, SchemaId>>;
}

export type SchematicsPreviewRegistrationForRoutes<Routes extends ProjectRouteMap> = {
  readonly [Id in Extract<keyof Routes, string>]: SchematicsPreviewRegistration<Routes[Id], Id>;
}[Extract<keyof Routes, string>];

export type ArtifactProjectPreviewRegistration<
  Project extends ArtifactProjectDeclaration<string, any, any>,
> = {
  readonly [Id in ArtifactProjectRouteId<Project>]: SchematicsPreviewRegistration<
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

export interface SchematicsPreviewResolution {
  readonly schemaId: string;
  readonly previews: readonly SchematicsPreviewRegistration<unknown, string>[];
  readonly selected: SchematicsPreviewRegistration<unknown, string>;
  readonly jsonSchema: unknown | null;
}

export function resolveSchematicsPreview({
  previews,
  reflection,
  file,
  jsonSchemaByPath,
  selectedPreviewId,
}: {
  readonly previews: readonly SchematicsPreviewRegistration<unknown, string>[];
  readonly reflection: SchematicsReflection;
  readonly file: SourceFile | null;
  readonly jsonSchemaByPath?: Readonly<Record<string, unknown>> | undefined;
  readonly selectedPreviewId?: string | null | undefined;
}): SchematicsPreviewResolution | null {
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

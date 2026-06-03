import { useEffect, useMemo, type ReactNode } from "react";
import { createLocalSchemaIdeChatAdapter } from "@schema-ide/agent";
import type { SchemaIdeChatAdapter } from "@schema-ide/agent";
import type { ArtifactProjectDeclaration } from "@schema-ide/artifacts";
import type {
  SchemaIdeArtifactRuntime,
  SchemaIdeDocumentFormat,
  SchemaIdeInputSchema,
  SourceFile,
  ProjectRouteMap,
} from "@schema-ide/core";
import type { SchemaIdeArtifactProjectService, SchemaIdeDeployService } from "@schema-ide/protocol";
import { Effect } from "effect";
import type { SchemaIdeEditorMode, SchemaIdePreviewRegistrationForRoutes } from "./preview";
import { SchemaIdeArtifactProjectView } from "./SchemaIdeArtifactProjectView";
import { createSchemaIdeArtifactClient } from "./artifact-project-client";

interface SchemaIdeSharedProps<Routes extends ProjectRouteMap = ProjectRouteMap> {
  readonly chat?: SchemaIdeChatAdapter | undefined;
  readonly readOnly?: boolean | undefined;
  readonly title?: ReactNode;
  readonly showDebug?: boolean | undefined;
  readonly previews?: readonly SchemaIdePreviewRegistrationForRoutes<Routes>[] | undefined;
  readonly defaultMode?: SchemaIdeEditorMode | undefined;
  /** Server-side deploy engine driver; enables the Deploy panel when provided. */
  readonly deploy?: SchemaIdeDeployService | undefined;
}

export interface SchemaIdeSchemaProps<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> extends SchemaIdeSharedProps<Routes> {
  readonly schema: SchemaIdeInputSchema<A, Routes>;
  readonly artifacts?: never;
  readonly project?: never;
  readonly defaultFormat?: SchemaIdeDocumentFormat | undefined;
  readonly allowedFormats?: never;
  readonly initialValue?: A | undefined;
  readonly value?: A | undefined;
  readonly onChange?: ((value: A) => void) | undefined;
  readonly initialFiles?: readonly SourceFile[] | undefined;
  readonly files?: readonly SourceFile[] | undefined;
  readonly onFilesChange?: ((files: readonly SourceFile[]) => void) | undefined;
  readonly onWorkspaceChange?: never;
}

export interface SchemaIdeArtifactProps<
  Routes extends ProjectRouteMap = ProjectRouteMap,
> extends SchemaIdeSharedProps<Routes> {
  readonly artifacts: SchemaIdeArtifactRuntime;
  readonly project?: never;
  readonly schema?: never;
  readonly defaultFormat?: never;
  readonly allowedFormats?: never;
  readonly initialValue?: never;
  readonly value?: never;
  readonly onChange?: never;
  readonly initialFiles?: never;
  readonly files?: never;
  readonly onFilesChange?: never;
  readonly onWorkspaceChange?: never;
}

export interface SchemaIdeRuntimeProjectProps<
  Routes extends ProjectRouteMap = ProjectRouteMap,
> extends SchemaIdeSharedProps<Routes> {
  readonly project: SchemaIdeArtifactRuntime;
  readonly artifacts?: never;
  readonly schema?: never;
  readonly defaultFormat?: never;
  readonly allowedFormats?: never;
  readonly initialValue?: never;
  readonly value?: never;
  readonly onChange?: never;
  readonly initialFiles?: never;
  readonly files?: never;
  readonly onFilesChange?: never;
  readonly onWorkspaceChange?: never;
}

export interface SchemaIdeArtifactProjectProps<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> extends SchemaIdeSharedProps<Routes> {
  readonly project: ArtifactProjectDeclaration<string, any, any>;
  readonly schema?: SchemaIdeInputSchema<A, Routes> | undefined;
  readonly artifacts?: never;
  readonly defaultFormat?: SchemaIdeDocumentFormat | undefined;
  readonly allowedFormats?: never;
  readonly initialValue?: A | undefined;
  readonly value?: A | undefined;
  readonly initialFiles?: readonly SourceFile[] | undefined;
  readonly files?: readonly SourceFile[] | undefined;
  readonly onChange?: never;
  readonly onFilesChange?: never;
  readonly onWorkspaceChange?: never;
}

export type SchemaIdeProjectProps<A = unknown, Routes extends ProjectRouteMap = ProjectRouteMap> =
  | SchemaIdeRuntimeProjectProps<Routes>
  | SchemaIdeArtifactProjectProps<A, Routes>;

export type SchemaIdeProps<A = unknown, Routes extends ProjectRouteMap = ProjectRouteMap> =
  | SchemaIdeSchemaProps<A, Routes>
  | SchemaIdeArtifactProps<Routes>
  | SchemaIdeProjectProps<A, Routes>;

export function SchemaIde<A, Routes extends ProjectRouteMap = ProjectRouteMap>(
  props: SchemaIdeProps<A, Routes>,
) {
  if (isArtifactRuntimeModeProps(props)) {
    return <SchemaIdeArtifactMode {...props} />;
  }
  if (isArtifactProjectModeProps(props)) {
    return <SchemaIdeProjectMode {...props} />;
  }
  return <SchemaIdeSchemaMode {...props} />;
}

function SchemaIdeArtifactMode<Routes extends ProjectRouteMap = ProjectRouteMap>({
  chat = createLocalSchemaIdeChatAdapter(),
  readOnly = false,
  title = "Schema IDE",
  showDebug = true,
  previews = [],
  defaultMode = "code",
  deploy,
  ...props
}: SchemaIdeArtifactProps<Routes> | SchemaIdeRuntimeProjectProps<Routes>) {
  const artifacts = "project" in props ? props.project : props.artifacts;
  const artifactProject = useMemo(
    () =>
      createSchemaIdeArtifactClient({
        artifacts,
        title: typeof title === "string" ? title : undefined,
        readOnly,
      }),
    [artifacts, readOnly, title],
  );

  return (
    <SchemaIdeArtifactProjectView
      artifactProject={artifactProject}
      chat={chat}
      title={title}
      showDebug={showDebug}
      previews={previews}
      defaultMode={defaultMode}
      deploy={deploy}
    />
  );
}

function SchemaIdeProjectMode<A, Routes extends ProjectRouteMap = ProjectRouteMap>({
  project,
  schema,
  defaultFormat = "json",
  initialValue,
  value,
  initialFiles,
  files,
  chat = createLocalSchemaIdeChatAdapter(),
  readOnly = false,
  title = "Schema IDE",
  showDebug = true,
  previews = [],
  defaultMode = "code",
  deploy,
}: SchemaIdeArtifactProjectProps<A, Routes>) {
  const artifactProject = useMemo(
    () =>
      createSchemaIdeArtifactClient({
        project,
        ...(schema ? { schema } : {}),
        defaultFormat,
        initialFiles: files ?? initialFiles,
        initialValue,
        value,
        title: typeof title === "string" ? title : undefined,
        readOnly,
      }),
    [defaultFormat, files, initialFiles, initialValue, project, readOnly, schema, title, value],
  );

  return (
    <SchemaIdeArtifactProjectView
      artifactProject={artifactProject}
      chat={chat}
      title={title}
      showDebug={showDebug}
      previews={previews}
      defaultMode={defaultMode}
      deploy={deploy}
    />
  );
}

function SchemaIdeSchemaMode<A, Routes extends ProjectRouteMap = ProjectRouteMap>({
  schema,
  defaultFormat = "json",
  initialValue,
  value,
  onChange,
  initialFiles,
  files,
  onFilesChange,
  chat = createLocalSchemaIdeChatAdapter(),
  readOnly = false,
  title = "Schema IDE",
  showDebug = true,
  previews = [],
  defaultMode = "code",
  deploy,
}: SchemaIdeSchemaProps<A, Routes>) {
  const artifactProject = useMemo(() => {
    const client = createSchemaIdeArtifactClient({
      schema,
      defaultFormat,
      initialFiles: files ?? initialFiles,
      initialValue,
      value,
      title: typeof title === "string" ? title : undefined,
      readOnly,
    });
    return withSchemaCallbacks(client, { onChange, onFilesChange });
  }, [
    defaultFormat,
    files,
    initialFiles,
    initialValue,
    onChange,
    onFilesChange,
    readOnly,
    schema,
    title,
    value,
  ]);

  useEffect(() => {
    if (!onChange && !onFilesChange) return;
    void Effect.runPromise(emitSchemaCallbacks(artifactProject, { onChange, onFilesChange })).catch(
      () => undefined,
    );
  }, [artifactProject, onChange, onFilesChange]);

  return (
    <SchemaIdeArtifactProjectView
      artifactProject={artifactProject}
      chat={chat}
      title={title}
      showDebug={showDebug}
      previews={previews}
      defaultMode={defaultMode}
      deploy={deploy}
    />
  );
}

function isArtifactRuntimeModeProps<A, Routes extends ProjectRouteMap>(
  props: SchemaIdeProps<A, Routes>,
): props is SchemaIdeArtifactProps<Routes> | SchemaIdeRuntimeProjectProps<Routes> {
  return Boolean(
    ("artifacts" in props && props.artifacts) ||
    ("project" in props && props.project && !isArtifactProjectDeclaration(props.project)),
  );
}

function isArtifactProjectModeProps<A, Routes extends ProjectRouteMap>(
  props: SchemaIdeProps<A, Routes>,
): props is SchemaIdeArtifactProjectProps<A, Routes> {
  return Boolean(
    "project" in props && props.project && isArtifactProjectDeclaration(props.project),
  );
}

function isArtifactProjectDeclaration(
  value: unknown,
): value is ArtifactProjectDeclaration<string, any, any> {
  return Boolean(
    value && typeof value === "object" && "_tag" in value && value._tag === "ArtifactProject",
  );
}

function withSchemaCallbacks<A>(
  artifactProject: SchemaIdeArtifactProjectService,
  callbacks: {
    readonly onChange?: ((value: A) => void) | undefined;
    readonly onFilesChange?: ((files: readonly SourceFile[]) => void) | undefined;
  },
): SchemaIdeArtifactProjectService {
  if (!callbacks.onChange && !callbacks.onFilesChange) return artifactProject;

  return {
    ...artifactProject,
    applyChange: (change) =>
      artifactProject
        .applyChange(change)
        .pipe(Effect.tap(() => emitSchemaCallbacks(artifactProject, callbacks))),
    applyArtifactChange: (change) =>
      artifactProject
        .applyArtifactChange(change)
        .pipe(Effect.tap(() => emitSchemaCallbacks(artifactProject, callbacks))),
  };
}

function emitSchemaCallbacks<A>(
  artifactProject: SchemaIdeArtifactProjectService,
  {
    onChange,
    onFilesChange,
  }: {
    readonly onChange?: ((value: A) => void) | undefined;
    readonly onFilesChange?: ((files: readonly SourceFile[]) => void) | undefined;
  },
) {
  return artifactProject.getSnapshot.pipe(
    Effect.tap((snapshot) =>
      Effect.sync(() => {
        onFilesChange?.(snapshot.files);
      }),
    ),
    Effect.flatMap(() =>
      onChange
        ? artifactProject
            .readArtifactView({ ref: { _tag: "Project" }, view: "decodedWorkspace" })
            .pipe(Effect.catch(() => Effect.succeed(null)))
        : Effect.succeed(null),
    ),
    Effect.tap((view) =>
      Effect.sync(() => {
        if (view && view.value !== null) {
          onChange?.(view.value as A);
        }
      }),
    ),
  );
}

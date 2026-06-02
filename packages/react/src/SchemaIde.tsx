import { useEffect, useMemo, type ReactNode } from "react";
import { createLocalSchemaIdeChatAdapter } from "@schema-ide/agent";
import type { SchemaIdeChatAdapter } from "@schema-ide/agent";
import type { ArtifactProjectDeclaration } from "@schema-ide/artifacts";
import type {
  SchemaIdeArtifactRuntime,
  SchemaIdeDocumentFormat,
  SchemaIdeInputSchema,
  SourceFile,
  WorkspaceRouteMap,
} from "@schema-ide/core";
import type { SchemaIdeArtifactProjectService } from "@schema-ide/protocol";
import { Effect } from "effect";
import type { SchemaIdeEditorMode, SchemaIdePreviewRegistrationForRoutes } from "./preview";
import { SchemaIdeArtifactProjectView } from "./SchemaIdeArtifactProjectView";
import { createSchemaIdeArtifactClient } from "./artifact-project-client";

interface SchemaIdeSharedProps<Routes extends WorkspaceRouteMap = WorkspaceRouteMap> {
  readonly chat?: SchemaIdeChatAdapter | undefined;
  readonly readOnly?: boolean | undefined;
  readonly title?: ReactNode;
  readonly showDebug?: boolean | undefined;
  readonly previews?: readonly SchemaIdePreviewRegistrationForRoutes<Routes>[] | undefined;
  readonly defaultMode?: SchemaIdeEditorMode | undefined;
}

export interface SchemaIdeSchemaProps<
  A = unknown,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
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
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
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
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
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
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
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

export type SchemaIdeProjectProps<
  A = unknown,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
> = SchemaIdeRuntimeProjectProps<Routes> | SchemaIdeArtifactProjectProps<A, Routes>;

export type SchemaIdeProps<A = unknown, Routes extends WorkspaceRouteMap = WorkspaceRouteMap> =
  | SchemaIdeSchemaProps<A, Routes>
  | SchemaIdeArtifactProps<Routes>
  | SchemaIdeProjectProps<A, Routes>;

export function SchemaIde<A, Routes extends WorkspaceRouteMap = WorkspaceRouteMap>(
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

function SchemaIdeArtifactMode<Routes extends WorkspaceRouteMap = WorkspaceRouteMap>({
  chat = createLocalSchemaIdeChatAdapter(),
  readOnly = false,
  title = "Schema IDE",
  showDebug = true,
  previews = [],
  defaultMode = "code",
  ...props
}: SchemaIdeArtifactProps<Routes> | SchemaIdeRuntimeProjectProps<Routes>) {
  const artifacts = "project" in props ? props.project : props.artifacts;
  const workspace = useMemo(
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
      workspace={workspace}
      chat={chat}
      title={title}
      showDebug={showDebug}
      previews={previews}
      defaultMode={defaultMode}
    />
  );
}

function SchemaIdeProjectMode<A, Routes extends WorkspaceRouteMap = WorkspaceRouteMap>({
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
}: SchemaIdeArtifactProjectProps<A, Routes>) {
  const workspace = useMemo(
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
      workspace={workspace}
      chat={chat}
      title={title}
      showDebug={showDebug}
      previews={previews}
      defaultMode={defaultMode}
    />
  );
}

function SchemaIdeSchemaMode<A, Routes extends WorkspaceRouteMap = WorkspaceRouteMap>({
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
}: SchemaIdeSchemaProps<A, Routes>) {
  const workspace = useMemo(() => {
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
    void Effect.runPromise(emitSchemaCallbacks(workspace, { onChange, onFilesChange })).catch(
      () => undefined,
    );
  }, [onChange, onFilesChange, workspace]);

  return (
    <SchemaIdeArtifactProjectView
      workspace={workspace}
      chat={chat}
      title={title}
      showDebug={showDebug}
      previews={previews}
      defaultMode={defaultMode}
    />
  );
}

function isArtifactRuntimeModeProps<A, Routes extends WorkspaceRouteMap>(
  props: SchemaIdeProps<A, Routes>,
): props is SchemaIdeArtifactProps<Routes> | SchemaIdeRuntimeProjectProps<Routes> {
  return Boolean(
    ("artifacts" in props && props.artifacts) ||
    ("project" in props && props.project && !isArtifactProjectDeclaration(props.project)),
  );
}

function isArtifactProjectModeProps<A, Routes extends WorkspaceRouteMap>(
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
  workspace: SchemaIdeArtifactProjectService,
  callbacks: {
    readonly onChange?: ((value: A) => void) | undefined;
    readonly onFilesChange?: ((files: readonly SourceFile[]) => void) | undefined;
  },
): SchemaIdeArtifactProjectService {
  if (!callbacks.onChange && !callbacks.onFilesChange) return workspace;

  return {
    ...workspace,
    applyChange: (change) =>
      workspace
        .applyChange(change)
        .pipe(Effect.tap(() => emitSchemaCallbacks(workspace, callbacks))),
    applyArtifactChange: (change) =>
      workspace
        .applyArtifactChange(change)
        .pipe(Effect.tap(() => emitSchemaCallbacks(workspace, callbacks))),
  };
}

function emitSchemaCallbacks<A>(
  workspace: SchemaIdeArtifactProjectService,
  {
    onChange,
    onFilesChange,
  }: {
    readonly onChange?: ((value: A) => void) | undefined;
    readonly onFilesChange?: ((files: readonly SourceFile[]) => void) | undefined;
  },
) {
  return workspace.getSnapshot.pipe(
    Effect.tap((snapshot) =>
      Effect.sync(() => {
        onFilesChange?.(snapshot.files);
        if (snapshot.reflection.decodedValue !== null) {
          onChange?.(snapshot.reflection.decodedValue as A);
        }
      }),
    ),
  );
}

import { useEffect, useMemo, type ReactNode } from "react";
import { createLocalSchematicsChatAdapter } from "@schematics/agent";
import type { SchematicsChatAdapter } from "@schematics/agent";
import type { ArtifactProjectDeclaration } from "@schematics/artifacts";
import type {
  SchematicsArtifactRuntime,
  SchematicsDocumentFormat,
  SchematicsInputSchema,
  SourceFile,
  ProjectRouteMap,
} from "@schematics/core";
import type {
  SchematicsArtifactProjectService,
  SchematicsArtifactWorkflowService,
  SchematicsDeployService,
} from "@schematics/protocol";
import { Effect } from "effect";
import type { SchematicsEditorMode, SchematicsPreviewRegistrationForRoutes } from "./preview";
import { SchematicsArtifactProjectView } from "./SchematicsArtifactProjectView";
import { createSchematicsArtifactClient } from "./artifact-project-client";

interface SchematicsSharedProps<Routes extends ProjectRouteMap = ProjectRouteMap> {
  readonly chat?: SchematicsChatAdapter | undefined;
  readonly readOnly?: boolean | undefined;
  readonly title?: ReactNode;
  readonly showDebug?: boolean | undefined;
  readonly previews?: readonly SchematicsPreviewRegistrationForRoutes<Routes>[] | undefined;
  readonly defaultMode?: SchematicsEditorMode | undefined;
  /** Server-side artifact workflow runner; enables Add from source workflows when provided. */
  readonly artifactWorkflow?: SchematicsArtifactWorkflowService | undefined;
  /** Server-side deploy engine driver; enables the Deploy panel when provided. */
  readonly deploy?: SchematicsDeployService | undefined;
}

export interface SchematicsSchemaProps<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> extends SchematicsSharedProps<Routes> {
  readonly schema: SchematicsInputSchema<A, Routes>;
  readonly artifacts?: never;
  readonly project?: never;
  readonly defaultFormat?: SchematicsDocumentFormat | undefined;
  readonly allowedFormats?: never;
  readonly initialValue?: A | undefined;
  readonly value?: A | undefined;
  readonly onChange?: ((value: A) => void) | undefined;
  readonly initialFiles?: readonly SourceFile[] | undefined;
  readonly files?: readonly SourceFile[] | undefined;
  readonly onFilesChange?: ((files: readonly SourceFile[]) => void) | undefined;
  readonly onWorkspaceChange?: never;
}

export interface SchematicsArtifactProps<
  Routes extends ProjectRouteMap = ProjectRouteMap,
> extends SchematicsSharedProps<Routes> {
  readonly artifacts: SchematicsArtifactRuntime;
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

export interface SchematicsRuntimeProjectProps<
  Routes extends ProjectRouteMap = ProjectRouteMap,
> extends SchematicsSharedProps<Routes> {
  readonly project: SchematicsArtifactRuntime;
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

export interface SchematicsArtifactProjectProps<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> extends SchematicsSharedProps<Routes> {
  readonly project: ArtifactProjectDeclaration<string, any, any>;
  readonly schema?: SchematicsInputSchema<A, Routes> | undefined;
  readonly artifacts?: never;
  readonly defaultFormat?: SchematicsDocumentFormat | undefined;
  readonly allowedFormats?: never;
  readonly initialValue?: A | undefined;
  readonly value?: A | undefined;
  readonly initialFiles?: readonly SourceFile[] | undefined;
  readonly files?: readonly SourceFile[] | undefined;
  readonly onChange?: never;
  readonly onFilesChange?: never;
  readonly onWorkspaceChange?: never;
}

export type SchematicsProjectProps<A = unknown, Routes extends ProjectRouteMap = ProjectRouteMap> =
  | SchematicsRuntimeProjectProps<Routes>
  | SchematicsArtifactProjectProps<A, Routes>;

export type SchematicsProps<A = unknown, Routes extends ProjectRouteMap = ProjectRouteMap> =
  | SchematicsSchemaProps<A, Routes>
  | SchematicsArtifactProps<Routes>
  | SchematicsProjectProps<A, Routes>;

export function Schematics<A, Routes extends ProjectRouteMap = ProjectRouteMap>(
  props: SchematicsProps<A, Routes>,
) {
  if (isArtifactRuntimeModeProps(props)) {
    return <SchematicsArtifactMode {...props} />;
  }
  if (isArtifactProjectModeProps(props)) {
    return <SchematicsProjectMode {...props} />;
  }
  return <SchematicsSchemaMode {...props} />;
}

function SchematicsArtifactMode<Routes extends ProjectRouteMap = ProjectRouteMap>({
  chat = createLocalSchematicsChatAdapter(),
  readOnly = false,
  title = "Schematics",
  showDebug = true,
  previews = [],
  defaultMode = "code",
  artifactWorkflow,
  deploy,
  ...props
}: SchematicsArtifactProps<Routes> | SchematicsRuntimeProjectProps<Routes>) {
  const artifacts = "project" in props ? props.project : props.artifacts;
  const artifactProject = useMemo(
    () =>
      createSchematicsArtifactClient({
        artifacts,
        title: typeof title === "string" ? title : undefined,
        readOnly,
      }),
    [artifacts, readOnly, title],
  );

  return (
    <SchematicsArtifactProjectView
      artifactProject={artifactProject}
      chat={chat}
      title={title}
      showDebug={showDebug}
      previews={previews}
      defaultMode={defaultMode}
      artifactWorkflow={artifactWorkflow}
      deploy={deploy}
    />
  );
}

function SchematicsProjectMode<A, Routes extends ProjectRouteMap = ProjectRouteMap>({
  project,
  schema,
  defaultFormat = "json",
  initialValue,
  value,
  initialFiles,
  files,
  chat = createLocalSchematicsChatAdapter(),
  readOnly = false,
  title = "Schematics",
  showDebug = true,
  previews = [],
  defaultMode = "code",
  artifactWorkflow,
  deploy,
}: SchematicsArtifactProjectProps<A, Routes>) {
  const artifactProject = useMemo(
    () =>
      createSchematicsArtifactClient({
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
    <SchematicsArtifactProjectView
      artifactProject={artifactProject}
      chat={chat}
      title={title}
      showDebug={showDebug}
      previews={previews}
      defaultMode={defaultMode}
      artifactWorkflow={artifactWorkflow}
      deploy={deploy}
    />
  );
}

function SchematicsSchemaMode<A, Routes extends ProjectRouteMap = ProjectRouteMap>({
  schema,
  defaultFormat = "json",
  initialValue,
  value,
  onChange,
  initialFiles,
  files,
  onFilesChange,
  chat = createLocalSchematicsChatAdapter(),
  readOnly = false,
  title = "Schematics",
  showDebug = true,
  previews = [],
  defaultMode = "code",
  artifactWorkflow,
  deploy,
}: SchematicsSchemaProps<A, Routes>) {
  const artifactProject = useMemo(() => {
    const client = createSchematicsArtifactClient({
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
    <SchematicsArtifactProjectView
      artifactProject={artifactProject}
      chat={chat}
      title={title}
      showDebug={showDebug}
      previews={previews}
      defaultMode={defaultMode}
      artifactWorkflow={artifactWorkflow}
      deploy={deploy}
    />
  );
}

function isArtifactRuntimeModeProps<A, Routes extends ProjectRouteMap>(
  props: SchematicsProps<A, Routes>,
): props is SchematicsArtifactProps<Routes> | SchematicsRuntimeProjectProps<Routes> {
  return Boolean(
    ("artifacts" in props && props.artifacts) ||
    ("project" in props && props.project && !isArtifactProjectDeclaration(props.project)),
  );
}

function isArtifactProjectModeProps<A, Routes extends ProjectRouteMap>(
  props: SchematicsProps<A, Routes>,
): props is SchematicsArtifactProjectProps<A, Routes> {
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
  artifactProject: SchematicsArtifactProjectService,
  callbacks: {
    readonly onChange?: ((value: A) => void) | undefined;
    readonly onFilesChange?: ((files: readonly SourceFile[]) => void) | undefined;
  },
): SchematicsArtifactProjectService {
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
  artifactProject: SchematicsArtifactProjectService,
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

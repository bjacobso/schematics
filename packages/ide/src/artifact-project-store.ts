import { useEffect, useMemo, useSyncExternalStore } from "react";
import { formatForPath, type SourceFile } from "@schematics/core";
import type {
  ArtifactRef,
  ArtifactChangeRequest,
  GetArtifactCapabilitiesRequest,
  GetArtifactCapabilitiesResponse,
  ListArtifactRefsResponse,
  ReadArtifactViewRequest,
  ReadArtifactViewResponse,
  SchematicsDiagnosticDto,
  SchematicsReflectionDto,
  SchematicsArtifactProjectError,
  SchematicsArtifactProjectService,
  ArtifactProjectCapabilities,
  ArtifactProjectChangeRequest,
  ArtifactProjectChangeResponse,
  GetArtifactProjectHistoryResponse,
  ArtifactProjectPreviewRequest,
  ArtifactProjectPreviewResponse,
  ArtifactProjectSnapshot,
  ReadArtifactViewsResponse,
} from "@schematics/protocol";
import { Effect, Equal, Fiber, Stream } from "effect";
import { AtomRef } from "effect/unstable/reactivity";
import { combineRefs, type RefEquality } from "./reactive-ref";

export interface SchematicsArtifactProjectState {
  readonly capabilities: ArtifactProjectCapabilities | null;
  readonly snapshot: ArtifactProjectSnapshot | null;
  readonly reflection: SchematicsReflectionDto | null;
  readonly diagnostics: readonly SchematicsDiagnosticDto[];
  readonly artifactRefs: readonly ArtifactRef[];
  readonly artifactJsonSchemas: Readonly<Record<string, unknown>>;
  readonly files: readonly SourceFile[];
  readonly activeFile: string | null;
  readonly drafts: Readonly<Record<string, string>>;
  readonly conflicts: Readonly<Record<string, number>>;
  readonly error: string | null;
}

export interface SchematicsArtifactProjectStore {
  readonly stateRef: AtomRef.ReadonlyRef<SchematicsArtifactProjectState>;
  readonly capabilitiesRef: AtomRef.ReadonlyRef<ArtifactProjectCapabilities | null>;
  readonly snapshotRef: AtomRef.ReadonlyRef<ArtifactProjectSnapshot | null>;
  readonly activeFileRef: AtomRef.ReadonlyRef<string | null>;
  readonly draftsRef: AtomRef.ReadonlyRef<Readonly<Record<string, string>>>;
  readonly conflictsRef: AtomRef.ReadonlyRef<Readonly<Record<string, number>>>;
  readonly errorRef: AtomRef.ReadonlyRef<string | null>;
  readonly committedFilesRef: AtomRef.ReadonlyRef<readonly SourceFile[]>;
  readonly artifactRefsRef: AtomRef.ReadonlyRef<readonly ArtifactRef[]>;
  readonly artifactFilesRef: AtomRef.ReadonlyRef<readonly SourceFile[] | null>;
  readonly artifactReflectionRef: AtomRef.ReadonlyRef<SchematicsReflectionDto | null>;
  readonly artifactDiagnosticsRef: AtomRef.ReadonlyRef<readonly SchematicsDiagnosticDto[] | null>;
  readonly artifactJsonSchemasRef: AtomRef.ReadonlyRef<Readonly<Record<string, unknown>>>;
  readonly filesRef: AtomRef.ReadonlyRef<readonly SourceFile[]>;
  readonly selectedFileRef: AtomRef.ReadonlyRef<SourceFile | null>;
  readonly selectedCommittedFileRef: AtomRef.ReadonlyRef<SourceFile | null>;
  readonly selectedIsDirtyRef: AtomRef.ReadonlyRef<boolean>;
  readonly selectedHasConflictRef: AtomRef.ReadonlyRef<boolean>;
  readonly reflectionRef: AtomRef.ReadonlyRef<SchematicsReflectionDto | null>;
  readonly diagnosticsRef: AtomRef.ReadonlyRef<readonly SchematicsDiagnosticDto[]>;
  readonly readOnlyRef: AtomRef.ReadonlyRef<boolean>;
  readonly start: () => void;
  readonly stop: () => void;
  readonly setActiveFile: (path: string | null) => void;
  readonly updateActiveFile: (content: string) => void;
  readonly refreshSnapshot: Effect.Effect<ArtifactProjectSnapshot | null>;
  readonly applyProjectChange: (
    change: ArtifactProjectChangeRequest,
  ) => Effect.Effect<ArtifactProjectChangeResponse, SchematicsArtifactProjectError>;
  readonly previewProjectFiles: (
    request: ArtifactProjectPreviewRequest,
  ) => Effect.Effect<ArtifactProjectPreviewResponse, SchematicsArtifactProjectError>;
  readonly listArtifactRefs: Effect.Effect<
    ListArtifactRefsResponse,
    SchematicsArtifactProjectError
  >;
  readonly getHistory: Effect.Effect<
    GetArtifactProjectHistoryResponse,
    SchematicsArtifactProjectError
  >;
  readonly getArtifactCapabilities: (
    request: GetArtifactCapabilitiesRequest,
  ) => Effect.Effect<GetArtifactCapabilitiesResponse, SchematicsArtifactProjectError>;
  readonly readArtifactView: (
    request: ReadArtifactViewRequest,
  ) => Effect.Effect<ReadArtifactViewResponse, SchematicsArtifactProjectError>;
  readonly applyArtifactChange: (
    change: ArtifactChangeRequest,
  ) => Effect.Effect<ArtifactProjectChangeResponse, SchematicsArtifactProjectError>;
  readonly saveActiveFile: Effect.Effect<void>;
  readonly discardActiveDraft: () => void;
  readonly addFile: Effect.Effect<void>;
  readonly deleteActiveFile: Effect.Effect<void>;
}

export interface SchematicsArtifactProjectViewModel {
  readonly store: SchematicsArtifactProjectStore;
  readonly state: SchematicsArtifactProjectState;
  readonly capabilities: ArtifactProjectCapabilities | null;
  readonly snapshot: ArtifactProjectSnapshot | null;
  readonly files: readonly SourceFile[];
  readonly committedFiles: readonly SourceFile[];
  readonly artifactRefs: readonly ArtifactRef[];
  readonly diagnostics: readonly SchematicsDiagnosticDto[];
  readonly artifactJsonSchemas: Readonly<Record<string, unknown>>;
  readonly selectedFile: SourceFile | null;
  readonly selectedCommittedFile: SourceFile | null;
  readonly selectedIsDirty: boolean;
  readonly selectedHasConflict: boolean;
  readonly reflection: SchematicsReflectionDto | null;
  readonly readOnly: boolean;
}

const initialState: SchematicsArtifactProjectState = {
  capabilities: null,
  snapshot: null,
  reflection: null,
  diagnostics: [],
  artifactRefs: [],
  artifactJsonSchemas: {},
  files: [],
  activeFile: null,
  drafts: {},
  conflicts: {},
  error: null,
};

export function createSchematicsArtifactProjectStore(
  workspace: SchematicsArtifactProjectService,
): SchematicsArtifactProjectStore {
  const capabilitiesRef = AtomRef.make<ArtifactProjectCapabilities | null>(
    initialState.capabilities,
  );
  const snapshotRef = AtomRef.make<ArtifactProjectSnapshot | null>(initialState.snapshot);
  const artifactRefsRef = AtomRef.make<readonly ArtifactRef[]>(initialState.artifactRefs);
  const artifactFilesRef = AtomRef.make<readonly SourceFile[] | null>(null);
  const artifactReflectionRef = AtomRef.make<SchematicsReflectionDto | null>(null);
  const artifactDiagnosticsRef = AtomRef.make<readonly SchematicsDiagnosticDto[] | null>(null);
  const artifactJsonSchemasRef = AtomRef.make<Readonly<Record<string, unknown>>>(
    initialState.artifactJsonSchemas,
  );
  const activeFileRef = AtomRef.make<string | null>(initialState.activeFile);
  const draftsRef = AtomRef.make<Readonly<Record<string, string>>>(initialState.drafts);
  const conflictsRef = AtomRef.make<Readonly<Record<string, number>>>(initialState.conflicts);
  const errorRef = AtomRef.make<string | null>(initialState.error);
  const committedFilesRef = combineRefs(
    [snapshotRef, artifactFilesRef],
    () => mergeHydratedFiles(snapshotRef.value?.files ?? [], artifactFilesRef.value ?? []),
    sourceFilesEqual,
  );
  const filesRef = combineRefs(
    [committedFilesRef, draftsRef],
    () => applyDraftsToFiles(committedFilesRef.value, draftsRef.value),
    sourceFilesEqual,
  );
  const selectedFileRef = combineRefs(
    [activeFileRef, filesRef],
    () => selectFile(activeFileRef.value, filesRef.value),
    nullableSourceFileEqual,
  );
  const selectedCommittedFileRef = combineRefs(
    [selectedFileRef, committedFilesRef],
    () =>
      selectedFileRef.value
        ? (committedFilesRef.value.find((file) => file.path === selectedFileRef.value?.path) ??
          null)
        : null,
    nullableSourceFileEqual,
  );
  const selectedIsDirtyRef = combineRefs([selectedFileRef, selectedCommittedFileRef], () =>
    Boolean(
      selectedFileRef.value &&
      selectedCommittedFileRef.value &&
      selectedFileRef.value.content !== selectedCommittedFileRef.value.content,
    ),
  );
  const selectedHasConflictRef = combineRefs([selectedFileRef, conflictsRef], () =>
    Boolean(selectedFileRef.value && conflictsRef.value[selectedFileRef.value.path]),
  );
  const reflectionRef = combineRefs([artifactReflectionRef], () => artifactReflectionRef.value);
  const diagnosticsRef = combineRefs(
    [reflectionRef, artifactDiagnosticsRef],
    () => artifactDiagnosticsRef.value ?? reflectionRef.value?.diagnostics ?? [],
  );
  const readOnlyRef = capabilitiesRef.map((capabilities) => isReadOnly(capabilities));
  const stateRef = combineRefs(
    [
      capabilitiesRef,
      snapshotRef,
      reflectionRef,
      diagnosticsRef,
      artifactRefsRef,
      artifactJsonSchemasRef,
      filesRef,
      activeFileRef,
      draftsRef,
      conflictsRef,
      errorRef,
    ],
    () => ({
      capabilities: capabilitiesRef.value,
      snapshot: snapshotRef.value,
      reflection: reflectionRef.value,
      diagnostics: diagnosticsRef.value,
      artifactRefs: artifactRefsRef.value,
      artifactJsonSchemas: artifactJsonSchemasRef.value,
      files: filesRef.value,
      activeFile: activeFileRef.value,
      drafts: draftsRef.value,
      conflicts: conflictsRef.value,
      error: errorRef.value,
    }),
    workspaceStateEqual,
  );
  let watchFiber: Fiber.Fiber<void, unknown> | null = null;
  let session = 0;

  const isCurrentSession = (currentSession: number) => session === currentSession;

  const setError = (error: unknown) => {
    errorRef.set(error instanceof Error ? error.message : String(error));
  };

  const applySnapshot = (
    snapshot: ArtifactProjectSnapshot,
    options: { readonly followChangedFile?: boolean | undefined } = {},
  ) => {
    if (snapshotRef.value && snapshot.revision < snapshotRef.value.revision) {
      return;
    }
    const previous = snapshotRef.value;
    const conflicts = detectDraftConflicts({
      previous,
      next: snapshot,
      drafts: draftsRef.value,
      currentConflicts: conflictsRef.value,
    });
    snapshotRef.set(snapshot);
    const followedFile =
      options.followChangedFile && previous
        ? selectChangedFile(previous.files, snapshot.files)
        : null;
    const nextActiveFile = followedFile ?? selectActiveFile(activeFileRef.value, snapshot.files);
    if (nextActiveFile !== activeFileRef.value) {
      activeFileRef.set(nextActiveFile);
    }
    conflictsRef.set(conflicts);
  };

  const setErrorEffect = (error: unknown) => Effect.sync(() => setError(error));

  const refreshIndexReflection = Effect.sync(() => {
    artifactReflectionRef.set(
      createIndexReflection({
        files: filesRef.value,
        activeFile: activeFileRef.value,
        jsonSchemas: artifactJsonSchemasRef.value,
        diagnostics: artifactDiagnosticsRef.value ?? [],
      }),
    );
  });

  const readArtifactViews = (
    views: readonly ReadArtifactViewRequest[],
  ): Effect.Effect<ReadArtifactViewsResponse, SchematicsArtifactProjectError> =>
    workspace.readArtifactViews
      ? workspace.readArtifactViews({ views })
      : Effect.forEach(views, (view) => workspace.readArtifactView(view)).pipe(
          Effect.map((responses) => ({ views: responses })),
        );

  const hydrateFile = (path: string): Effect.Effect<void, SchematicsArtifactProjectError> => {
    const ref =
      artifactRefsRef.value.find(
        (candidate) => candidate._tag === "ProjectFile" && candidate.path === path,
      ) ?? ({ _tag: "ProjectFile", path } as const);

    return readArtifactViews([
      { ref, view: "sourceText" },
      { ref, view: "jsonSchema" },
      { ref, view: "diagnostics" },
    ]).pipe(
      Effect.catch(() =>
        Effect.forEach(
          [
            { ref, view: "sourceText" },
            { ref, view: "jsonSchema" },
            { ref, view: "diagnostics" },
          ] satisfies readonly ReadArtifactViewRequest[],
          (view) =>
            workspace.readArtifactView(view).pipe(
              Effect.map(
                (response) => response as ReadArtifactViewsResponse["views"][number] | null,
              ),
              Effect.catch(() => Effect.succeed(null)),
            ),
        ).pipe(Effect.map((views) => ({ views: views.filter(isReadArtifactViewResponse) }))),
      ),
      Effect.tap((response) =>
        Effect.sync(() => {
          const sourceText = response.views.find((view) => view.view === "sourceText")?.value;
          const jsonSchema = response.views.find((view) => view.view === "jsonSchema")?.value;
          const diagnostics = response.views.find((view) => view.view === "diagnostics")?.value;

          if (typeof sourceText === "string") {
            artifactFilesRef.update((files) =>
              upsertSourceFile(files ?? [], { path, content: sourceText }),
            );
          }

          if (jsonSchema !== undefined) {
            artifactJsonSchemasRef.update((schemas) => ({ ...schemas, [path]: jsonSchema }));
          }

          if (isSchematicsDiagnostics(diagnostics)) {
            artifactDiagnosticsRef.update((current) =>
              mergeDiagnosticsForPath(current ?? [], path, diagnostics),
            );
          }
        }),
      ),
      Effect.tap(() => refreshIndexReflection),
      Effect.asVoid,
    );
  };

  const hydrateActiveFile = Effect.suspend(() => {
    const activeFile = activeFileRef.value;
    return activeFile ? hydrateFile(activeFile) : refreshIndexReflection;
  });

  const refreshArtifactState: Effect.Effect<{
    readonly refs: readonly ArtifactRef[];
    readonly reflection: SchematicsReflectionDto | null;
    readonly diagnostics: readonly SchematicsDiagnosticDto[] | null;
    readonly jsonSchemas: Readonly<Record<string, unknown>>;
  } | null> = Effect.gen(function* () {
    const response = yield* workspace.listArtifactRefs;
    const workspaceRef = response.artifacts.find(isProjectRef) ?? ({ _tag: "Project" } as const);
    const reflection = createIndexReflection({
      files: snapshotRef.value?.files ?? [],
      activeFile: activeFileRef.value,
      jsonSchemas: artifactJsonSchemasRef.value,
      diagnostics: artifactDiagnosticsRef.value ?? [],
    });
    return {
      refs: response.artifacts.length ? response.artifacts : [workspaceRef],
      reflection,
      diagnostics: artifactDiagnosticsRef.value,
      jsonSchemas: artifactJsonSchemasRef.value,
    };
  }).pipe(
    Effect.tap(({ refs, reflection, diagnostics, jsonSchemas }) =>
      Effect.sync(() => {
        artifactRefsRef.set(refs);
        artifactReflectionRef.set(reflection);
        artifactDiagnosticsRef.set(diagnostics);
        artifactJsonSchemasRef.set(jsonSchemas);
      }),
    ),
    Effect.catch((error) =>
      Effect.sync(() => {
        setError(error);
        artifactFilesRef.set(null);
        artifactReflectionRef.set(null);
        artifactDiagnosticsRef.set(null);
        artifactJsonSchemasRef.set({});
        return null;
      }),
    ),
  );

  const refreshSnapshotWithOptions = (
    options: { readonly followChangedFile?: boolean | undefined } = {},
  ) =>
    workspace.getSnapshot.pipe(
      Effect.tap((snapshot) => Effect.sync(() => applySnapshot(snapshot, options))),
      Effect.tap(() => refreshArtifactState),
      Effect.tap(() => hydrateActiveFile),
      Effect.catch((error) => setErrorEffect(error).pipe(Effect.as(null))),
    );

  const refreshSnapshot = refreshSnapshotWithOptions();

  const applyChange = (
    change: ArtifactProjectChangeRequest,
  ): Effect.Effect<ArtifactProjectChangeResponse, SchematicsArtifactProjectError> =>
    workspace.applyChange(change).pipe(
      Effect.tap(() => refreshSnapshot),
      Effect.tap((response) =>
        Effect.sync(() => {
          const followedFile = selectExistingPath(response.changedPaths, snapshotRef.value?.files);
          if (followedFile && followedFile !== activeFileRef.value) {
            activeFileRef.set(followedFile);
          }
        }),
      ),
      Effect.catch((error) => setErrorEffect(error).pipe(Effect.flatMap(() => Effect.fail(error)))),
    );

  const previewFiles = (
    request: ArtifactProjectPreviewRequest,
  ): Effect.Effect<ArtifactProjectPreviewResponse, SchematicsArtifactProjectError> =>
    workspace
      .previewFiles(request)
      .pipe(
        Effect.catch((error) =>
          setErrorEffect(error).pipe(Effect.flatMap(() => Effect.fail(error))),
        ),
      );
  const applyArtifactChange = (
    change: ArtifactChangeRequest,
  ): Effect.Effect<ArtifactProjectChangeResponse, SchematicsArtifactProjectError> =>
    workspace.applyArtifactChange(change).pipe(
      Effect.tap(() => refreshSnapshot),
      Effect.catch((error) => setErrorEffect(error).pipe(Effect.flatMap(() => Effect.fail(error)))),
    );

  const store: SchematicsArtifactProjectStore = {
    stateRef,
    capabilitiesRef,
    snapshotRef,
    artifactRefsRef,
    artifactFilesRef,
    artifactReflectionRef,
    artifactDiagnosticsRef,
    artifactJsonSchemasRef,
    activeFileRef,
    draftsRef,
    conflictsRef,
    errorRef,
    committedFilesRef,
    filesRef,
    selectedFileRef,
    selectedCommittedFileRef,
    selectedIsDirtyRef,
    selectedHasConflictRef,
    reflectionRef,
    diagnosticsRef,
    readOnlyRef,
    start: () => {
      if (watchFiber) return;
      const currentSession = ++session;

      Effect.runFork(
        workspace.getCapabilities.pipe(
          Effect.tap((capabilities) =>
            Effect.sync(() => {
              if (!isCurrentSession(currentSession)) return;
              capabilitiesRef.set(capabilities);
            }),
          ),
          Effect.catch(setErrorEffect),
        ),
      );

      Effect.runFork(refreshSnapshot);

      watchFiber = Effect.runFork(
        workspace.watchArtifactProject.pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              if (!isCurrentSession(currentSession)) return;
              if (event.type === "capabilities") {
                capabilitiesRef.set(event.capabilities);
                return;
              }
              if (event.type === "error") {
                errorRef.set(event.message);
                return;
              }
              Effect.runFork(refreshSnapshotWithOptions({ followChangedFile: true }));
            }),
          ),
          Effect.catch(setErrorEffect),
        ),
      );
    },
    stop: () => {
      session += 1;
      const fiber = watchFiber;
      watchFiber = null;
      if (fiber) {
        Effect.runFork(Fiber.interrupt(fiber));
      }
    },
    setActiveFile: (path) => {
      activeFileRef.set(path);
      Effect.runFork(refreshIndexReflection);
      if (path) {
        Effect.runFork(hydrateFile(path));
      }
    },
    updateActiveFile: (content) => {
      if (readOnlyRef.value) return;
      const selectedFile = selectedFileRef.value;
      if (!selectedFile) return;
      const selectedCommittedFile = selectedCommittedFileRef.value;
      if (selectedCommittedFile?.content === content) {
        draftsRef.update((drafts) => omitKey(drafts, selectedFile.path));
        return;
      }
      draftsRef.update((drafts) => ({ ...drafts, [selectedFile.path]: content }));
    },
    refreshSnapshot,
    applyProjectChange: applyChange,
    previewProjectFiles: previewFiles,
    listArtifactRefs: workspace.listArtifactRefs.pipe(
      Effect.catch((error) => setErrorEffect(error).pipe(Effect.flatMap(() => Effect.fail(error)))),
    ),
    getHistory: workspace.getHistory.pipe(
      Effect.catch((error) => setErrorEffect(error).pipe(Effect.flatMap(() => Effect.fail(error)))),
    ),
    getArtifactCapabilities: (request) =>
      workspace
        .getArtifactCapabilities(request)
        .pipe(
          Effect.catch((error) =>
            setErrorEffect(error).pipe(Effect.flatMap(() => Effect.fail(error))),
          ),
        ),
    readArtifactView: (request) =>
      workspace
        .readArtifactView(request)
        .pipe(
          Effect.catch((error) =>
            setErrorEffect(error).pipe(Effect.flatMap(() => Effect.fail(error))),
          ),
        ),
    applyArtifactChange,
    saveActiveFile: Effect.gen(function* () {
      if (readOnlyRef.value) return;
      const selectedFile = selectedFileRef.value;
      if (!selectedFile) return;

      yield* applyChange({
        type: "writeFile",
        path: selectedFile.path,
        content: selectedFile.content,
      });
      draftsRef.update((drafts) => omitKey(drafts, selectedFile.path));
      conflictsRef.update((conflicts) => omitKey(conflicts, selectedFile.path));
    }).pipe(Effect.catch(setErrorEffect)),
    discardActiveDraft: () => {
      const selectedFile = selectedFileRef.value;
      if (!selectedFile) return;
      draftsRef.update((drafts) => omitKey(drafts, selectedFile.path));
      conflictsRef.update((conflicts) => omitKey(conflicts, selectedFile.path));
    },
    addFile: Effect.gen(function* () {
      if (readOnlyRef.value) return;
      const files = filesRef.value;
      let index = files.length + 1;
      let path = `new-file-${index}.json`;
      while (files.some((file) => file.path === path)) {
        index += 1;
        path = `new-file-${index}.json`;
      }

      yield* applyChange({ type: "createFile", path, content: "{}\n" });
      activeFileRef.set(path);
    }).pipe(Effect.catch(setErrorEffect)),
    deleteActiveFile: Effect.gen(function* () {
      if (readOnlyRef.value) return;
      if (!capabilitiesRef.value?.features.delete) return;
      const selectedFile = selectedFileRef.value;
      if (!selectedFile) return;

      yield* applyChange({ type: "deleteFile", path: selectedFile.path });
      draftsRef.update((drafts) => omitKey(drafts, selectedFile.path));
      conflictsRef.update((conflicts) => omitKey(conflicts, selectedFile.path));
    }).pipe(Effect.catch(setErrorEffect)),
  };

  return store;
}

export function useSchematicsArtifactProjectStore(
  workspace: SchematicsArtifactProjectService,
): SchematicsArtifactProjectViewModel {
  const store = useMemo(() => createSchematicsArtifactProjectStore(workspace), [workspace]);

  useEffect(() => {
    store.start();
    return store.stop;
  }, [store]);

  const state = useSyncExternalStore(
    (listener) => store.stateRef.subscribe(() => listener()),
    () => store.stateRef.value,
    () => store.stateRef.value,
  );

  return useMemo(() => {
    return {
      store,
      state,
      capabilities: store.capabilitiesRef.value,
      snapshot: store.snapshotRef.value,
      files: store.filesRef.value,
      committedFiles: store.committedFilesRef.value,
      artifactRefs: store.artifactRefsRef.value,
      diagnostics: store.diagnosticsRef.value,
      artifactJsonSchemas: store.artifactJsonSchemasRef.value,
      selectedFile: store.selectedFileRef.value,
      selectedCommittedFile: store.selectedCommittedFileRef.value,
      selectedIsDirty: store.selectedIsDirtyRef.value,
      selectedHasConflict: store.selectedHasConflictRef.value,
      reflection: store.reflectionRef.value,
      readOnly: store.readOnlyRef.value,
    };
  }, [state, store]);
}

function createIndexReflection({
  files,
  activeFile,
  jsonSchemas,
  diagnostics,
}: {
  readonly files: readonly SourceFile[];
  readonly activeFile: string | null;
  readonly jsonSchemas: Readonly<Record<string, unknown>>;
  readonly diagnostics: readonly SchematicsDiagnosticDto[];
}): SchematicsReflectionDto {
  const selectedFile =
    activeFile && files.some((file) => file.path === activeFile)
      ? activeFile
      : (files[0]?.path ?? null);
  const activeFormat = selectedFile ? formatForPath(selectedFile) : "json";
  return {
    mode: "workspace",
    activeFile: selectedFile,
    activeFormat,
    files,
    schemas: [],
    activeJsonSchema: selectedFile ? (jsonSchemas[selectedFile] ?? null) : null,
    decodedValue: null,
    diagnostics,
    validationSummary: summarizeDiagnostics(diagnostics),
    routeMatches: files.map((file) => ({
      path: file.path,
      schemaId: null,
      format: formatForPath(file.path),
    })),
  };
}

function summarizeDiagnostics(diagnostics: readonly SchematicsDiagnosticDto[]) {
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") errorCount += 1;
    else if (diagnostic.severity === "warning") warningCount += 1;
    else infoCount += 1;
  }
  return {
    valid: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
  };
}

function mergeHydratedFiles(
  snapshotFiles: readonly SourceFile[],
  hydratedFiles: readonly SourceFile[],
): readonly SourceFile[] {
  if (!hydratedFiles.length) return snapshotFiles;
  const hydratedByPath = new Map(hydratedFiles.map((file) => [file.path, file.content]));
  return snapshotFiles.map((file) => {
    const hydrated = hydratedByPath.get(file.path);
    return hydrated === undefined ? file : { ...file, content: hydrated };
  });
}

function upsertSourceFile(files: readonly SourceFile[], file: SourceFile): readonly SourceFile[] {
  const index = files.findIndex((candidate) => candidate.path === file.path);
  if (index === -1)
    return [...files, file].sort((left, right) => left.path.localeCompare(right.path));
  return files.map((candidate, candidateIndex) => (candidateIndex === index ? file : candidate));
}

function mergeDiagnosticsForPath(
  current: readonly SchematicsDiagnosticDto[],
  path: string,
  diagnostics: readonly SchematicsDiagnosticDto[],
): readonly SchematicsDiagnosticDto[] {
  const retained = current.filter((diagnostic) => diagnostic.path !== path);
  return [...retained, ...diagnostics];
}

function isReadArtifactViewResponse(value: unknown): value is ReadArtifactViewResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return typeof response["view"] === "string" && "ref" in response && "value" in response;
}

function selectFile(activeFile: string | null, files: readonly SourceFile[]): SourceFile | null {
  return activeFile ? (files.find((file) => file.path === activeFile) ?? null) : (files[0] ?? null);
}

function workspaceStateEqual(
  left: SchematicsArtifactProjectState,
  right: SchematicsArtifactProjectState,
): boolean {
  return (
    Object.is(left.capabilities, right.capabilities) &&
    workspaceSnapshotEqual(left.snapshot, right.snapshot) &&
    Object.is(left.reflection, right.reflection) &&
    diagnosticsEqual(left.diagnostics, right.diagnostics) &&
    artifactRefsEqual(left.artifactRefs, right.artifactRefs) &&
    recordEqual(left.artifactJsonSchemas, right.artifactJsonSchemas, Equal.equals) &&
    sourceFilesEqual(left.files, right.files) &&
    left.activeFile === right.activeFile &&
    recordEqual(left.drafts, right.drafts, Object.is) &&
    recordEqual(left.conflicts, right.conflicts, Object.is) &&
    left.error === right.error
  );
}

function workspaceSnapshotEqual(
  left: ArtifactProjectSnapshot | null,
  right: ArtifactProjectSnapshot | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.revision === right.revision && sourceFilesEqual(left.files, right.files);
}

function nullableSourceFileEqual(left: SourceFile | null, right: SourceFile | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return sourceFileEqual(left, right);
}

function sourceFilesEqual(left: readonly SourceFile[], right: readonly SourceFile[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((file, index) => sourceFileEqual(file, right[index]!));
}

function sourceFileEqual(left: SourceFile, right: SourceFile): boolean {
  return left.path === right.path && left.content === right.content;
}

function diagnosticsEqual(
  left: readonly SchematicsDiagnosticDto[],
  right: readonly SchematicsDiagnosticDto[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((diagnostic, index) => diagnosticEqual(diagnostic, right[index]!));
}

function diagnosticEqual(left: SchematicsDiagnosticDto, right: SchematicsDiagnosticDto): boolean {
  return (
    left.path === right.path &&
    left.documentPath === right.documentPath &&
    left.line === right.line &&
    left.column === right.column &&
    left.severity === right.severity &&
    left.message === right.message &&
    left.source === right.source
  );
}

function artifactRefsEqual(left: readonly ArtifactRef[], right: readonly ArtifactRef[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((ref, index) => artifactRefEqual(ref, right[index]!));
}

function artifactRefEqual(left: ArtifactRef, right: ArtifactRef): boolean {
  if (left._tag !== right._tag) return false;
  switch (left._tag) {
    case "Project":
      return right._tag === "Project" && left.projectId === right.projectId;
    case "ProjectFile":
      return (
        right._tag === "ProjectFile" &&
        left.projectId === right.projectId &&
        left.path === right.path
      );
  }
}

function isProjectRef(ref: ArtifactRef): ref is Extract<ArtifactRef, { _tag: "Project" }> {
  return ref._tag === "Project";
}

function isSchematicsDiagnostics(value: unknown): value is readonly SchematicsDiagnosticDto[] {
  return Array.isArray(value) && value.every(isSchematicsDiagnosticDto);
}

function isSchematicsDiagnosticDto(value: unknown): value is SchematicsDiagnosticDto {
  if (!value || typeof value !== "object") return false;
  const diagnostic = value as Record<string, unknown>;
  return (
    (typeof diagnostic["path"] === "string" || diagnostic["path"] === null) &&
    (diagnostic["documentPath"] === undefined || typeof diagnostic["documentPath"] === "string") &&
    (diagnostic["line"] === undefined || typeof diagnostic["line"] === "number") &&
    (diagnostic["column"] === undefined || typeof diagnostic["column"] === "number") &&
    (diagnostic["severity"] === "error" ||
      diagnostic["severity"] === "warning" ||
      diagnostic["severity"] === "info") &&
    typeof diagnostic["message"] === "string" &&
    (diagnostic["source"] === "json-parse" ||
      diagnostic["source"] === "yaml-parse" ||
      diagnostic["source"] === "schema" ||
      diagnostic["source"] === "workspace" ||
      diagnostic["source"] === "cross-file")
  );
}

function recordEqual<T>(
  left: Readonly<Record<string, T>>,
  right: Readonly<Record<string, T>>,
  equals: RefEquality<T>,
): boolean {
  if (left === right) return true;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(right, key) && equals(left[key]!, right[key]!),
  );
}

function isReadOnly(capabilities: ArtifactProjectCapabilities | null): boolean {
  return Boolean(capabilities?.project.readOnly || !capabilities?.features.write);
}

function selectActiveFile(current: string | null, files: readonly SourceFile[]): string | null {
  if (current && files.some((file) => file.path === current)) {
    return current;
  }
  return files[0]?.path ?? null;
}

function selectChangedFile(
  previousFiles: readonly SourceFile[],
  nextFiles: readonly SourceFile[],
): string | null {
  const previousByPath = new Map(previousFiles.map((file) => [file.path, file.content]));
  const changedPaths: string[] = [];

  for (const file of nextFiles) {
    if (previousByPath.get(file.path) !== file.content) {
      changedPaths.push(file.path);
    }
  }

  if (changedPaths.length) {
    return selectExistingPath(changedPaths, nextFiles);
  }

  return null;
}

function selectExistingPath(
  paths: readonly string[],
  files: readonly SourceFile[] | null | undefined,
): string | null {
  if (!files?.length) return null;
  const existingPaths = new Set(files.map((file) => file.path));
  return paths.find((path) => existingPaths.has(path)) ?? null;
}

function detectDraftConflicts({
  previous,
  next,
  drafts,
  currentConflicts,
}: {
  readonly previous: ArtifactProjectSnapshot | null;
  readonly next: ArtifactProjectSnapshot;
  readonly drafts: Readonly<Record<string, string>>;
  readonly currentConflicts: Readonly<Record<string, number>>;
}): Readonly<Record<string, number>> {
  const draftEntries = Object.entries(drafts);
  if (!previous || !draftEntries.length) return currentConflicts;

  let conflicts = currentConflicts;
  const previousByPath = new Map(previous.files.map((file) => [file.path, file.content]));
  for (const file of next.files) {
    const draft = drafts[file.path];
    if (draft === undefined) continue;

    const previousContent = previousByPath.get(file.path);
    if (
      previousContent !== undefined &&
      previousContent !== file.content &&
      draft !== file.content
    ) {
      conflicts =
        conflicts === currentConflicts
          ? { ...currentConflicts, [file.path]: next.revision }
          : { ...conflicts, [file.path]: next.revision };
    }
  }

  return conflicts;
}

function applyDraftsToFiles(
  files: readonly SourceFile[],
  drafts: Readonly<Record<string, string>>,
): readonly SourceFile[] {
  const draftEntries = Object.entries(drafts);
  if (!draftEntries.length) return files;
  return files.map((file) =>
    Object.prototype.hasOwnProperty.call(drafts, file.path)
      ? { ...file, content: drafts[file.path] ?? file.content }
      : file,
  );
}

function omitKey<T>(record: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  const next = { ...record };
  delete next[key];
  return next;
}

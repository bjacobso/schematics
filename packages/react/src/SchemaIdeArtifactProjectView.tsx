import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { matchGlob } from "@schema-ide/artifacts";
import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import MuiSelect, { type SelectChangeEvent } from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import MuiToggleButton from "@mui/material/ToggleButton";
import MuiToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import {
  Bug,
  ChevronDown,
  ChevronUp,
  Eye,
  FileCode2,
  FilePlus2,
  Files,
  FolderTree,
  Layers,
  Play,
  Search,
  Save,
  Trash2,
} from "lucide-react";
import type { SchemaIdeChatAdapter } from "@schema-ide/agent";
import type {
  SchemaIdeDocumentFormat,
  SchemaIdeArtifactRuntime,
  SchemaIdeReflection,
  SourceFile,
  ProjectRouteMap,
} from "@schema-ide/core";
import { parseDocument } from "@schema-ide/core";
import type {
  ArtifactCapability,
  ArtifactRef,
  SchemaIdeArtifactProjectService,
} from "@schema-ide/protocol";
import { Effect } from "effect";
import { getSchemaIdeFileDiagnosticCounts } from "./diagnostics";
import {
  resolveSchemaIdePreview,
  type SchemaIdeEditorMode,
  type SchemaIdePreviewRegistration,
  type SchemaIdePreviewRegistrationForRoutes,
} from "./preview";
import { SchemaIdeChatPanel } from "./SchemaIdeChatPanel";
import { SchemaCodeMirrorEditor } from "./SchemaCodeMirrorEditor";
import { SchemaIdeFileTree } from "./SchemaIdeFileTree";
import { isPdfPath, SchemaIdePdfFileViewer } from "./SchemaIdePdfFileViewer";
import { SchemaIdePreviewView } from "./SchemaIdePreviewView";
import {
  useSchemaIdeArtifactProjectStore,
  type SchemaIdeArtifactProjectStore,
} from "./artifact-project-store";
import { createSchemaIdeArtifactProjectToolRuntime } from "./artifact-project-tool-runtime";
import { createSchemaIdeArtifactClient } from "./artifact-project-client";

export interface SchemaIdeArtifactProjectViewProps<
  Routes extends ProjectRouteMap = ProjectRouteMap,
> {
  readonly artifactProject?: SchemaIdeArtifactProjectService | undefined;
  readonly project?: SchemaIdeArtifactRuntime | undefined;
  readonly artifacts?: SchemaIdeArtifactRuntime | undefined;
  readonly chat?: SchemaIdeChatAdapter | undefined;
  readonly title?: ReactNode | undefined;
  readonly showDebug?: boolean | undefined;
  readonly previews?: readonly SchemaIdePreviewRegistrationForRoutes<Routes>[] | undefined;
  readonly previewNavigation?: readonly PreviewNavigationRegistration[] | undefined;
  readonly defaultMode?: SchemaIdeEditorMode | undefined;
}

export type ProjectLocation =
  | { readonly type: "directory"; readonly path: string }
  | { readonly type: "file"; readonly path: string };

export interface PreviewNavigationItemContext {
  readonly file: SourceFile;
  readonly value: unknown | null;
  readonly format: SchemaIdeDocumentFormat;
  readonly reflection: SchemaIdeReflection;
}

export interface PreviewDirectoryPreambleProps {
  readonly location: { readonly type: "directory"; readonly path: string };
  readonly registration: PreviewNavigationRegistration | null;
  readonly files: readonly SourceFile[];
  readonly matchingFiles: readonly SourceFile[];
  readonly reflection: SchemaIdeReflection;
  readonly openDirectory: (path: string) => void;
  readonly openFile: (path: string) => void;
}

export interface PreviewNavigationRegistration {
  readonly path: string;
  readonly label: string;
  readonly itemPattern?: string | readonly string[] | undefined;
  readonly preamble?: ComponentType<PreviewDirectoryPreambleProps> | undefined;
  readonly getItemLabel?: ((context: PreviewNavigationItemContext) => string) | undefined;
  readonly getItemDescription?:
    | ((context: PreviewNavigationItemContext) => string | null)
    | undefined;
}

type SchemaIdeArtifactProjectPanel = "preview" | "files" | "artifacts";

const chatSidebarWidth = 360;

export function SchemaIdeArtifactProjectView<Routes extends ProjectRouteMap = ProjectRouteMap>({
  artifactProject,
  project,
  artifacts,
  chat,
  title,
  showDebug = true,
  previews = [],
  previewNavigation = [],
  defaultMode = "code",
}: SchemaIdeArtifactProjectViewProps<Routes>) {
  const resolvedArtifactProject = useMemo(() => {
    if (artifactProject) return artifactProject;
    const artifactRuntime = project ?? artifacts;
    if (artifactRuntime) {
      return createSchemaIdeArtifactClient({
        artifacts: artifactRuntime,
        title: typeof title === "string" ? title : undefined,
      });
    }
    throw new Error(
      "SchemaIdeArtifactProjectView requires artifactProject, project, or artifacts.",
    );
  }, [artifactProject, artifacts, project, title]);
  const [projectPanel, setProjectPanel] = useState<SchemaIdeArtifactProjectPanel>(() =>
    previews.length || previewNavigation.length ? "preview" : "files",
  );
  const [editorMode, setEditorMode] = useState<SchemaIdeEditorMode>(defaultMode);
  const [location, setLocation] = useState<ProjectLocation | null>(null);
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null);
  const [debugExpanded, setDebugExpanded] = useState(false);
  const {
    store,
    state,
    capabilities,
    snapshot,
    files,
    artifactRefs,
    diagnostics,
    artifactJsonSchemas,
    selectedFile,
    selectedIsDirty,
    selectedHasConflict,
    reflection,
    readOnly,
  } = useSchemaIdeArtifactProjectStore(resolvedArtifactProject);
  const reflectionWithDiagnostics = useMemo(
    () =>
      reflection
        ? ({
            ...reflection,
            diagnostics,
          } as SchemaIdeReflection)
        : null,
    [reflection, diagnostics],
  );
  const fileDiagnosticCounts = useMemo(
    () => getSchemaIdeFileDiagnosticCounts(diagnostics),
    [diagnostics],
  );
  const dirtyPaths = useMemo(() => new Set(Object.keys(state.drafts)), [state.drafts]);
  const conflictPaths = useMemo(() => new Set(Object.keys(state.conflicts)), [state.conflicts]);
  const toolRuntime = useMemo(() => createSchemaIdeArtifactProjectToolRuntime(store), [store]);
  const showChat = Boolean(chat && capabilities?.agent.enabled);
  const activeLocation = useMemo(
    () => resolveProjectLocation({ location, files, selectedFile }),
    [files, location, selectedFile],
  );
  const locationFile =
    activeLocation?.type === "file"
      ? (files.find((file) => file.path === activeLocation.path) ?? null)
      : null;
  const selectedFormat = formatForPath(locationFile?.path ?? selectedFile?.path);
  const selectedIsPdf = isPdfPath((locationFile ?? selectedFile)?.path);
  // Reads a typed artifact view for a file (e.g. PDF `inspect` / `extractText`),
  // resolving the project-qualified ref so the request hits the right store.
  const readArtifactViewValue = useCallback(
    (path: string, view: string) => {
      const ref =
        artifactRefs.find(
          (candidate) => candidate._tag === "ProjectFile" && candidate.path === path,
        ) ?? ({ _tag: "ProjectFile", path } as ArtifactRef);
      return Effect.runPromise(store.readArtifactView({ ref, view })).then(
        (response) => response.value,
      );
    },
    [artifactRefs, store],
  );
  const activeDirectoryPath = activeLocation?.type === "directory" ? activeLocation.path : null;
  const previewResolution = useMemo(
    () =>
      reflectionWithDiagnostics
        ? resolveSchemaIdePreview({
            previews: previews as unknown as readonly SchemaIdePreviewRegistration<
              unknown,
              string
            >[],
            reflection: reflectionWithDiagnostics,
            file: locationFile,
            jsonSchemaByPath: artifactJsonSchemas,
            selectedPreviewId,
          })
        : null,
    [previews, reflectionWithDiagnostics, locationFile, artifactJsonSchemas, selectedPreviewId],
  );

  useEffect(() => {
    if (!activeLocation && selectedFile) {
      setLocation({ type: "file", path: selectedFile.path });
    }
  }, [activeLocation, selectedFile]);

  useEffect(() => {
    setEditorMode(defaultMode);
  }, [defaultMode]);

  const openFile = useCallback(
    (path: string) => {
      setLocation({ type: "file", path });
      store.setActiveFile(path);
    },
    [store],
  );

  const openDirectory = useCallback((path: string) => {
    setLocation({ type: "directory", path: normalizeDirectoryPath(path) });
  }, []);

  if (!snapshot || !reflectionWithDiagnostics) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading project...
      </div>
    );
  }

  const validationLabel = reflectionWithDiagnostics.validationSummary.valid
    ? "Valid"
    : `${reflectionWithDiagnostics.validationSummary.errorCount} errors`;
  const shellGridStyle = {
    gridTemplateColumns: showChat ? `${chatSidebarWidth}px minmax(0, 1fr)` : "minmax(0, 1fr)",
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div
        className="grid min-h-12 shrink-0 border-b max-[760px]:flex max-[760px]:flex-col"
        style={shellGridStyle}
      >
        {showChat ? (
          <div className="flex min-w-0 items-center gap-2 border-r bg-sidebar/60 px-4 font-semibold max-[760px]:h-12 max-[760px]:border-r-0">
            <FileCode2 className="size-4 shrink-0" />
            <span className="truncate">Schema IDE</span>
          </div>
        ) : null}
        <div className="flex min-h-12 min-w-0 items-center gap-3 px-4 max-[760px]:flex-wrap max-[760px]:py-2">
          {!showChat ? (
            <div className="flex min-w-0 items-center gap-2 font-semibold">
              <FileCode2 className="size-4 shrink-0" />
              <span className="truncate">Schema IDE</span>
            </div>
          ) : null}
          <MuiToggleButtonGroup
            aria-label="Workspace view"
            exclusive
            onChange={(_, value: SchemaIdeArtifactProjectPanel | null) => {
              if (value) setProjectPanel(value);
            }}
            size="small"
            value={projectPanel}
          >
            <MuiToggleButton className="gap-1.5 px-3" value="preview">
              <Eye className="size-3.5" />
              Preview
            </MuiToggleButton>
            <MuiToggleButton className="gap-1.5 px-3" value="files">
              <Files className="size-3.5" />
              Files
            </MuiToggleButton>
            <MuiToggleButton className="gap-1.5 px-3" value="artifacts">
              <Layers className="size-3.5" />
              Artifacts
            </MuiToggleButton>
          </MuiToggleButtonGroup>
          <Chip
            className="ml-auto"
            color={reflectionWithDiagnostics.validationSummary.valid ? "secondary" : "error"}
            label={validationLabel}
            size="small"
          />
          {capabilities && !capabilities.agent.enabled ? (
            <Chip label="Agent hidden" size="small" variant="outlined" />
          ) : null}
        </div>
      </div>

      {state.error ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {state.error}
        </div>
      ) : null}

      <div
        className="grid min-h-0 flex-1 overflow-hidden max-[760px]:flex max-[760px]:flex-col"
        style={shellGridStyle}
      >
        {showChat && chat ? (
          <div className="min-h-0 max-[760px]:h-72 max-[760px]:shrink-0">
            <SchemaIdeChatPanel
              chat={chat}
              reflection={reflectionWithDiagnostics}
              tools={toolRuntime}
              readOnly={readOnly}
            />
          </div>
        ) : null}

        <div className="flex min-w-0 flex-col overflow-hidden">
          {projectPanel === "preview" ? (
            <>
              <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4">
                <PreviewBreadcrumbs
                  files={files}
                  location={activeLocation}
                  navigation={previewNavigation}
                  onOpenDirectory={openDirectory}
                  onOpenFile={openFile}
                />
                {locationFile &&
                !isPdfPath(locationFile.path) &&
                previewResolution &&
                previewResolution.previews.length > 1 ? (
                  <FormControl className="ml-auto max-w-48" size="small">
                    <MuiSelect
                      value={previewResolution.selected.id}
                      onChange={(event: SelectChangeEvent<string>) =>
                        setSelectedPreviewId(event.target.value)
                      }
                      inputProps={{ "aria-label": "Preview" }}
                    >
                      {previewResolution.previews.map((preview) => (
                        <MenuItem key={preview.id} value={preview.id}>
                          {preview.label}
                        </MenuItem>
                      ))}
                    </MuiSelect>
                  </FormControl>
                ) : (
                  <span className="ml-auto" />
                )}
              </div>
              {activeLocation?.type === "directory" ? (
                <SchemaIdeDirectoryPreview
                  files={files}
                  location={activeLocation}
                  navigation={previewNavigation}
                  reflection={reflectionWithDiagnostics}
                  onOpenDirectory={openDirectory}
                  onOpenFile={openFile}
                />
              ) : locationFile && isPdfPath(locationFile.path) ? (
                <SchemaIdePdfFileViewer
                  file={locationFile}
                  readView={(view) => readArtifactViewValue(locationFile.path, view)}
                />
              ) : locationFile ? (
                <SchemaIdePreviewView
                  file={locationFile}
                  files={files}
                  format={formatForPath(locationFile.path)}
                  reflection={reflectionWithDiagnostics}
                  resolution={previewResolution}
                  previews={
                    previews as unknown as readonly SchemaIdePreviewRegistration<unknown, string>[]
                  }
                  readOnly={readOnly}
                  onChange={store.updateActiveFile}
                />
              ) : (
                <SchemaIdeEmptyState
                  title="No location selected"
                  description="Select a file or directory to render its preview."
                  actionLabel="Open files"
                  onAction={() => setProjectPanel("files")}
                />
              )}
            </>
          ) : projectPanel === "artifacts" ? (
            <SchemaIdeArtifactsPanel
              artifactRefs={artifactRefs}
              store={store}
              onOpenFile={(path) => {
                openFile(path);
                setProjectPanel("files");
              }}
            />
          ) : (
            <div className="flex min-h-0 flex-1 overflow-hidden max-[760px]:flex-col">
              <div
                className="flex min-h-0 shrink-0 flex-col border-r max-[760px]:max-h-56 max-[760px]:!w-full max-[760px]:border-b max-[760px]:border-r-0"
                style={{ width: 280 }}
              >
                <div className="flex h-10 items-center gap-2 border-b px-3 text-sm font-medium">
                  <FolderTree className="size-4" />
                  Files
                  <IconButton
                    size="small"
                    className="ml-auto"
                    onClick={() => Effect.runFork(store.addFile)}
                    disabled={readOnly}
                    title="Add file"
                  >
                    <FilePlus2 className="size-3.5" />
                  </IconButton>
                </div>
                <SchemaIdeFileTree
                  files={files}
                  activePath={activeLocation?.type === "file" ? activeLocation.path : null}
                  activeDirectoryPath={activeDirectoryPath}
                  diagnosticCounts={fileDiagnosticCounts}
                  dirtyPaths={dirtyPaths}
                  conflictPaths={conflictPaths}
                  onSelectFile={openFile}
                  onSelectDirectory={openDirectory}
                />
              </div>

              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
                  <div className="min-w-0 flex-1">
                    <PreviewBreadcrumbs
                      emptyLabel="No location"
                      files={files}
                      location={activeLocation}
                      navigation={previewNavigation}
                      onOpenDirectory={openDirectory}
                      onOpenFile={openFile}
                    />
                  </div>
                  {activeLocation?.type === "directory" ? (
                    <Chip label="Directory" size="small" variant="outlined" />
                  ) : selectedIsPdf ? (
                    <Chip label="PDF" size="small" variant="outlined" />
                  ) : null}
                  {activeLocation?.type === "directory" || selectedIsPdf ? null : (
                    <MuiToggleButtonGroup
                      aria-label="Editor mode"
                      exclusive
                      onChange={(_, value: SchemaIdeEditorMode | null) => {
                        if (value) setEditorMode(value);
                      }}
                      size="small"
                      value={editorMode}
                    >
                      <MuiToggleButton value="code">Code</MuiToggleButton>
                      <MuiToggleButton value="preview" disabled={!selectedFile}>
                        Preview
                      </MuiToggleButton>
                    </MuiToggleButtonGroup>
                  )}
                  {activeLocation?.type === "directory" ? null : selectedHasConflict ? (
                    <Chip
                      color="error"
                      className="text-[10px]"
                      label="External conflict"
                      size="small"
                    />
                  ) : selectedIsDirty ? (
                    <Chip color="secondary" className="text-[10px]" label="Unsaved" size="small" />
                  ) : null}
                  {activeLocation?.type === "directory" ? null : (
                    <>
                      <IconButton
                        size="small"
                        onClick={() => Effect.runFork(store.saveActiveFile)}
                        disabled={readOnly || !selectedFile || !selectedIsDirty}
                        title="Save file"
                      >
                        <Save className="size-3.5" />
                      </IconButton>
                      <Button
                        size="small"
                        variant="text"
                        color="inherit"
                        className="h-7 px-2 text-xs"
                        onClick={store.discardActiveDraft}
                        disabled={readOnly || !selectedFile || !selectedIsDirty}
                        title="Discard unsaved edits"
                      >
                        Discard
                      </Button>
                      <IconButton
                        size="small"
                        onClick={() => Effect.runFork(store.deleteActiveFile)}
                        disabled={readOnly || !selectedFile || !capabilities?.features.delete}
                        title="Delete file"
                      >
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </>
                  )}
                </div>

                {activeLocation?.type === "directory" ? (
                  <SchemaIdeDirectoryDetails
                    files={files}
                    location={activeLocation}
                    navigation={previewNavigation}
                    reflection={reflectionWithDiagnostics}
                    onOpenDirectory={openDirectory}
                    onOpenFile={openFile}
                  />
                ) : selectedFile && selectedIsPdf ? (
                  <SchemaIdePdfFileViewer
                    file={selectedFile}
                    readView={(view) => readArtifactViewValue(selectedFile.path, view)}
                  />
                ) : selectedFile && editorMode === "preview" ? (
                  <SchemaIdePreviewView
                    file={selectedFile}
                    files={files}
                    format={selectedFormat}
                    reflection={reflectionWithDiagnostics}
                    resolution={previewResolution}
                    previews={
                      previews as unknown as readonly SchemaIdePreviewRegistration<
                        unknown,
                        string
                      >[]
                    }
                    readOnly={readOnly}
                    onChange={store.updateActiveFile}
                  />
                ) : (
                  <SchemaCodeMirrorEditor
                    value={selectedFile?.content ?? ""}
                    path={selectedFile?.path ?? null}
                    format={selectedFormat}
                    reflection={reflectionWithDiagnostics}
                    readOnly={readOnly || !selectedFile}
                    onChange={store.updateActiveFile}
                    onSave={() => {
                      Effect.runFork(store.saveActiveFile);
                    }}
                  />
                )}
              </div>
            </div>
          )}
          {showDebug ? (
            <div className="shrink-0 border-t">
              <div className="flex h-9 items-center gap-2 px-2">
                <Button
                  size="small"
                  variant="text"
                  color="inherit"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => setDebugExpanded((expanded) => !expanded)}
                >
                  <Bug className="size-3.5" />
                  Debug
                  {debugExpanded ? (
                    <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronUp className="size-3.5" />
                  )}
                </Button>
              </div>
              {debugExpanded ? (
                <div className="h-56 border-t">
                  <Box className="h-full" sx={{ overflow: "auto" }}>
                    <pre className="whitespace-pre-wrap p-3 text-xs">
                      {JSON.stringify(
                        {
                          revision: snapshot.revision,
                          capabilities,
                          artifactRefs,
                          diagnostics,
                          routeMatches: reflectionWithDiagnostics.routeMatches,
                          schemas: reflectionWithDiagnostics.schemas,
                          conflicts: state.conflicts,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </Box>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SchemaIdeArtifactsPanel({
  artifactRefs,
  store,
  onOpenFile,
}: {
  readonly artifactRefs: readonly ArtifactRef[];
  readonly store: SchemaIdeArtifactProjectStore;
  readonly onOpenFile: (path: string) => void;
}) {
  const refs = useMemo(() => sortArtifactRefs(artifactRefs), [artifactRefs]);
  const [selectedRefKey, setSelectedRefKey] = useState<string | null>(null);
  const selectedRef = useMemo(
    () => refs.find((ref) => artifactRefKey(ref) === selectedRefKey) ?? refs[0] ?? null,
    [refs, selectedRefKey],
  );
  const [capabilitiesState, setCapabilitiesState] = useState<{
    readonly loading: boolean;
    readonly error: string | null;
    readonly capabilities: readonly ArtifactCapability[];
  }>({ loading: false, error: null, capabilities: [] });
  const [selectedView, setSelectedView] = useState<string | null>(null);
  const [viewState, setViewState] = useState<{
    readonly loading: boolean;
    readonly error: string | null;
    readonly value: unknown;
    readonly view: string | null;
  }>({ loading: false, error: null, value: null, view: null });

  useEffect(() => {
    if (!selectedRef) {
      setSelectedRefKey(null);
      return;
    }
    const key = artifactRefKey(selectedRef);
    if (selectedRefKey !== key && !refs.some((ref) => artifactRefKey(ref) === selectedRefKey)) {
      setSelectedRefKey(key);
    }
  }, [refs, selectedRef, selectedRefKey]);

  useEffect(() => {
    if (!selectedRef) {
      setCapabilitiesState({ loading: false, error: null, capabilities: [] });
      setSelectedView(null);
      setViewState({ loading: false, error: null, value: null, view: null });
      return;
    }

    let cancelled = false;
    setCapabilitiesState((current) => ({ ...current, loading: true, error: null }));
    setViewState({ loading: false, error: null, value: null, view: null });

    Effect.runPromise(store.getArtifactCapabilities({ ref: selectedRef })).then(
      (response) => {
        if (cancelled) return;
        setCapabilitiesState({
          loading: false,
          error: null,
          capabilities: response.capabilities,
        });
        setSelectedView((current) =>
          current && response.capabilities.some((capability) => capability.view === current)
            ? current
            : (response.capabilities[0]?.view ?? null),
        );
      },
      (error: unknown) => {
        if (cancelled) return;
        setCapabilitiesState({
          loading: false,
          error: errorMessage(error),
          capabilities: [],
        });
        setSelectedView(null);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [selectedRef, store]);

  const selectedCapability =
    selectedView !== null
      ? (capabilitiesState.capabilities.find((capability) => capability.view === selectedView) ??
        null)
      : null;

  const readSelectedView = () => {
    if (!selectedRef || !selectedView) return;
    setViewState({ loading: true, error: null, value: null, view: selectedView });
    Effect.runPromise(store.readArtifactView({ ref: selectedRef, view: selectedView })).then(
      (response) => {
        setViewState({
          loading: false,
          error: null,
          value: response.value,
          view: response.view,
        });
      },
      (error: unknown) => {
        setViewState({
          loading: false,
          error: errorMessage(error),
          value: null,
          view: selectedView,
        });
      },
    );
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden max-[760px]:flex-col">
      <div
        className="flex min-h-0 shrink-0 flex-col border-r max-[760px]:max-h-56 max-[760px]:!w-full max-[760px]:border-b max-[760px]:border-r-0"
        style={{ width: 320 }}
      >
        <div className="flex h-10 items-center gap-2 border-b px-3 text-sm font-medium">
          <Layers className="size-4" />
          Artifacts
          <Chip className="ml-auto" label={refs.length} size="small" variant="outlined" />
        </div>
        <Box className="min-h-0 flex-1" sx={{ overflow: "auto" }}>
          <div className="grid gap-1 p-2">
            {refs.map((ref) => {
              const key = artifactRefKey(ref);
              const active = selectedRef ? artifactRefKey(selectedRef) === key : false;
              return (
                <button
                  key={key}
                  className={`flex min-h-10 w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
                    active ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                  onClick={() => setSelectedRefKey(key)}
                  title={artifactRefTitle(ref)}
                  type="button"
                >
                  <ArtifactRefIcon refValue={ref} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{artifactRefLabel(ref)}</span>
                    <span
                      className={`block truncate font-mono text-[10px] ${
                        active ? "text-primary-foreground/80" : "text-muted-foreground"
                      }`}
                    >
                      {artifactRefSubtitle(ref)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </Box>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {selectedRef ? artifactRefLabel(selectedRef) : "No artifact selected"}
            </div>
            {selectedRef ? (
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {artifactRefTitle(selectedRef)}
              </div>
            ) : null}
          </div>
          {selectedRef?._tag === "ProjectFile" ? (
            <Button
              className="h-7 px-2 text-xs"
              color="inherit"
              onClick={() => onOpenFile(selectedRef.path)}
              size="small"
              variant="text"
            >
              Open
            </Button>
          ) : null}
        </div>

        {!selectedRef ? (
          <SchemaIdeEmptyState
            title="No artifacts"
            description="This project has not exposed any artifact refs yet."
          />
        ) : (
          <Box className="min-h-0 flex-1" sx={{ overflow: "auto" }}>
            <div className="grid gap-4 p-4">
              <div className="grid gap-2">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium">Capabilities</div>
                  {capabilitiesState.loading ? (
                    <Chip label="Loading" size="small" variant="outlined" />
                  ) : (
                    <Chip
                      label={capabilitiesState.capabilities.length}
                      size="small"
                      variant="outlined"
                    />
                  )}
                </div>
                {capabilitiesState.error ? (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                    {capabilitiesState.error}
                  </div>
                ) : capabilitiesState.capabilities.length ? (
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {capabilitiesState.capabilities.map((capability) => {
                      const active = selectedView === capability.view;
                      return (
                        <button
                          key={`${capability.type}:${capability.id}:${capability.view}`}
                          className={`min-h-24 rounded-md border p-3 text-left text-xs ${
                            active
                              ? "border-primary bg-primary/10"
                              : "bg-background hover:bg-muted/50"
                          }`}
                          onClick={() => {
                            setSelectedView(capability.view);
                            setViewState({ loading: false, error: null, value: null, view: null });
                          }}
                          type="button"
                        >
                          <span className="block truncate text-sm font-medium">
                            {capability.view}
                          </span>
                          <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                            {capability.type}
                            {capability.routeId ? ` / ${capability.routeId}` : ""}
                          </span>
                          <CapabilityPolicyChips capability={capability} />
                        </button>
                      );
                    })}
                  </div>
                ) : capabilitiesState.loading ? null : (
                  <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                    No declared views for this artifact.
                  </div>
                )}
              </div>

              <div className="grid gap-2">
                <div className="flex min-h-9 items-center gap-2">
                  <div className="text-sm font-medium">View</div>
                  {selectedCapability ? (
                    <>
                      <Chip label={selectedCapability.view} size="small" />
                      <CapabilityPolicyChips capability={selectedCapability} compact />
                    </>
                  ) : null}
                  <Button
                    className="ml-auto h-8 gap-1 px-2 text-xs"
                    disabled={!selectedRef || !selectedView || viewState.loading}
                    onClick={readSelectedView}
                    size="small"
                    variant="contained"
                  >
                    <Play className="size-3.5" />
                    Read View
                  </Button>
                </div>
                <div className="min-h-64 rounded-md border bg-background">
                  {viewState.loading ? (
                    <div className="p-4 text-sm text-muted-foreground">Reading view...</div>
                  ) : viewState.error ? (
                    <div className="p-4 text-sm text-destructive">{viewState.error}</div>
                  ) : viewState.view ? (
                    <ArtifactViewValue value={viewState.value} />
                  ) : (
                    <div className="p-4 text-sm text-muted-foreground">
                      Select a capability and read the view to materialize its value.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Box>
        )}
      </div>
    </div>
  );
}

function ArtifactRefIcon({ refValue }: { readonly refValue: ArtifactRef }) {
  return refValue._tag === "Project" ? (
    <Layers className="size-4 shrink-0" />
  ) : (
    <FileCode2 className="size-4 shrink-0" />
  );
}

function CapabilityPolicyChips({
  capability,
  compact = false,
}: {
  readonly capability: ArtifactCapability;
  readonly compact?: boolean | undefined;
}) {
  const annotations = annotationRecord(capability.annotations);
  const policy = [
    annotationText(annotations, "cost"),
    annotationText(annotations, "cache"),
    annotationText(annotations, "mediaType"),
  ].filter((value): value is string => Boolean(value));

  if (!policy.length) return null;

  return (
    <div className={`mt-2 flex flex-wrap gap-1 ${compact ? "mt-0" : ""}`}>
      {policy.slice(0, compact ? 2 : 3).map((value) => (
        <Chip key={value} className="max-w-full" label={value} size="small" variant="outlined" />
      ))}
    </div>
  );
}

function ArtifactViewValue({ value }: { readonly value: unknown }) {
  if (typeof value === "string") {
    return (
      <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs">
        {value}
      </pre>
    );
  }

  return (
    <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs">
      {stringifyArtifactValue(value)}
    </pre>
  );
}

function sortArtifactRefs(refs: readonly ArtifactRef[]): readonly ArtifactRef[] {
  return [...refs].sort((left, right) => {
    const leftRank = left._tag === "Project" ? 0 : 1;
    const rightRank = right._tag === "Project" ? 0 : 1;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return artifactRefTitle(left).localeCompare(artifactRefTitle(right));
  });
}

function artifactRefKey(ref: ArtifactRef): string {
  switch (ref._tag) {
    case "Project":
      return `Project:${ref.projectId ?? ""}`;
    case "ProjectFile":
      return `ProjectFile:${ref.projectId ?? ""}:${ref.path}`;
  }
}

function artifactRefLabel(ref: ArtifactRef): string {
  switch (ref._tag) {
    case "Project":
      return ref.projectId ? `Project ${ref.projectId}` : "Project";
    case "ProjectFile":
      return ref.path.split("/").pop() ?? ref.path;
  }
}

function artifactRefSubtitle(ref: ArtifactRef): string {
  switch (ref._tag) {
    case "Project":
      return ref.projectId ? `project:${ref.projectId}` : "project root";
    case "ProjectFile":
      return ref.path;
  }
}

function artifactRefTitle(ref: ArtifactRef): string {
  switch (ref._tag) {
    case "Project":
      return ref.projectId ? `Project ${ref.projectId}` : "Project";
    case "ProjectFile":
      return ref.projectId ? `${ref.projectId}:${ref.path}` : ref.path;
  }
}

function annotationRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function annotationText(
  annotations: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = annotations[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && value !== null && "_tag" in value) {
    const tag = (value as { readonly _tag?: unknown })._tag;
    return typeof tag === "string" ? tag : null;
  }
  return null;
}

function stringifyArtifactValue(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_key, nestedValue: unknown) => {
        if (nestedValue instanceof Map) {
          return Object.fromEntries(nestedValue.entries());
        }
        if (nestedValue instanceof Set) {
          return Array.from(nestedValue);
        }
        if (nestedValue instanceof Error) {
          return {
            name: nestedValue.name,
            message: nestedValue.message,
          };
        }
        return nestedValue;
      },
      2,
    );
  } catch {
    return String(value);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function PreviewBreadcrumbs({
  emptyLabel = "Preview",
  files,
  location,
  navigation,
  onOpenDirectory,
  onOpenFile,
}: {
  readonly emptyLabel?: string | undefined;
  readonly files: readonly SourceFile[];
  readonly location: ProjectLocation | null;
  readonly navigation: readonly PreviewNavigationRegistration[];
  readonly onOpenDirectory: (path: string) => void;
  readonly onOpenFile: (path: string) => void;
}) {
  if (!location) {
    return <div className="min-w-0 truncate text-sm font-medium">{emptyLabel}</div>;
  }

  const crumbs = getBreadcrumbs({ files, location, navigation });
  return (
    <Breadcrumbs
      aria-label="breadcrumb"
      className="min-w-0 text-sm"
      maxItems={4}
      sx={{
        minWidth: 0,
        "& ol": {
          flexWrap: "nowrap",
          minWidth: 0,
        },
        "& li": {
          minWidth: 0,
        },
      }}
    >
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <span key={`${crumb.type}:${crumb.path}`} className="min-w-0">
            {last ? (
              <span className="block min-w-0 truncate font-medium">{crumb.label}</span>
            ) : (
              <Button
                color="inherit"
                className="h-7 min-w-0 px-1.5 text-xs"
                size="small"
                variant="text"
                onClick={() =>
                  crumb.type === "directory" ? onOpenDirectory(crumb.path) : onOpenFile(crumb.path)
                }
              >
                <span className="truncate">{crumb.label}</span>
              </Button>
            )}
          </span>
        );
      })}
    </Breadcrumbs>
  );
}

function SchemaIdeDirectoryPreview({
  files,
  location,
  navigation,
  reflection,
  onOpenDirectory,
  onOpenFile,
}: {
  readonly files: readonly SourceFile[];
  readonly location: { readonly type: "directory"; readonly path: string };
  readonly navigation: readonly PreviewNavigationRegistration[];
  readonly reflection: SchemaIdeReflection;
  readonly onOpenDirectory: (path: string) => void;
  readonly onOpenFile: (path: string) => void;
}) {
  const registration = findDirectoryRegistration(navigation, location.path);
  const matchingFiles = getDirectoryFiles({ files, location, registration });
  const readme = findDirectoryReadme(files, location.path);
  const Preamble = registration?.preamble;

  return (
    <Box className="min-h-0 flex-1" sx={{ overflow: "auto" }}>
      <div className="mx-auto grid max-w-5xl gap-4 p-4">
        {Preamble ? (
          <Preamble
            files={files}
            location={location}
            matchingFiles={matchingFiles}
            openDirectory={onOpenDirectory}
            openFile={onOpenFile}
            reflection={reflection}
            registration={registration}
          />
        ) : null}
        {readme ? <DirectoryReadme file={readme} /> : null}
        <DirectoryItemList
          files={files}
          location={location}
          matchingFiles={matchingFiles}
          navigation={navigation}
          reflection={reflection}
          onOpenDirectory={onOpenDirectory}
          onOpenFile={onOpenFile}
        />
      </div>
    </Box>
  );
}

function SchemaIdeDirectoryDetails({
  files,
  location,
  navigation,
  reflection,
  onOpenDirectory,
  onOpenFile,
}: {
  readonly files: readonly SourceFile[];
  readonly location: { readonly type: "directory"; readonly path: string };
  readonly navigation: readonly PreviewNavigationRegistration[];
  readonly reflection: SchemaIdeReflection;
  readonly onOpenDirectory: (path: string) => void;
  readonly onOpenFile: (path: string) => void;
}) {
  const registration = findDirectoryRegistration(navigation, location.path);
  const matchingFiles = getDirectoryFiles({ files, location, registration });
  const readme = findDirectoryReadme(files, location.path);

  return (
    <Box className="min-h-0 flex-1" sx={{ overflow: "auto" }}>
      <div className="mx-auto grid max-w-5xl gap-4 p-4">
        <div>
          <div className="text-sm font-medium">
            {registration?.label ?? labelForPath(location.path)}
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">{location.path}/</div>
        </div>
        {readme ? <DirectoryReadme file={readme} /> : null}
        <DirectoryItemList
          files={files}
          location={location}
          matchingFiles={matchingFiles}
          navigation={navigation}
          reflection={reflection}
          onOpenDirectory={onOpenDirectory}
          onOpenFile={onOpenFile}
        />
      </div>
    </Box>
  );
}

function DirectoryReadme({ file }: { readonly file: SourceFile }) {
  return (
    <div className="rounded-md border bg-background p-4">
      <div className="mb-3 font-mono text-xs text-muted-foreground">{file.path}</div>
      <MarkdownContent content={file.content} />
    </div>
  );
}

function MarkdownContent({ content }: { readonly content: string }) {
  const blocks = parseMarkdownBlocks(content);
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <pre
              key={index}
              className="overflow-auto rounded border bg-muted/40 p-2 font-mono text-xs"
            >
              {block.content}
            </pre>
          );
        }
        const line = block.content;
        if (!line.trim()) return <div key={index} className="h-1" />;
        if (line.startsWith("### ")) {
          return (
            <div key={index} className="pt-2 text-sm font-semibold">
              {line.slice(4)}
            </div>
          );
        }
        if (line.startsWith("## ")) {
          return (
            <div key={index} className="pt-2 text-base font-semibold">
              {line.slice(3)}
            </div>
          );
        }
        if (line.startsWith("# ")) {
          return (
            <div key={index} className="text-lg font-semibold">
              {line.slice(2)}
            </div>
          );
        }
        if (line.startsWith("- ")) {
          return (
            <div key={index} className="pl-4 text-muted-foreground">
              - {line.slice(2)}
            </div>
          );
        }
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}

function DirectoryItemList({
  files,
  location,
  matchingFiles,
  navigation,
  reflection,
  onOpenDirectory,
  onOpenFile,
}: {
  readonly files: readonly SourceFile[];
  readonly location: { readonly type: "directory"; readonly path: string };
  readonly matchingFiles: readonly SourceFile[];
  readonly navigation: readonly PreviewNavigationRegistration[];
  readonly reflection: SchemaIdeReflection;
  readonly onOpenDirectory: (path: string) => void;
  readonly onOpenFile: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const childDirectories = getChildDirectories(files, location.path);
  const items = matchingFiles
    .filter((file) => !isDirectoryReadmePath(file.path, location.path))
    .map((file) => createDirectoryFileItem({ file, navigation, reflection }));
  const directoryLabel =
    findDirectoryRegistration(navigation, location.path)?.label ?? labelForPath(location.path);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredDirectories = childDirectories.filter((directory) =>
    getDirectoryLabel(navigation, directory).toLowerCase().includes(normalizedQuery),
  );
  const filteredItems = items.filter((item) =>
    [item.label, item.description ?? "", item.file.path].some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    ),
  );

  return (
    <div className="rounded-md border bg-background">
      <div className="flex items-center gap-2 border-b p-3">
        <Search className="size-4 text-muted-foreground" />
        <TextField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${directoryLabel.toLowerCase()}...`}
          size="small"
          fullWidth
        />
      </div>
      <div className="divide-y">
        {filteredDirectories.map((directory) => (
          <button
            key={directory}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/60"
            onClick={() => onOpenDirectory(directory)}
            type="button"
          >
            <FolderTree className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-medium">
              {getDirectoryLabel(navigation, directory)}
            </span>
            <span className="font-mono text-xs text-muted-foreground">{directory}/</span>
          </button>
        ))}
        {filteredItems.map((item) => (
          <button
            key={item.file.path}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/60"
            onClick={() => onOpenFile(item.file.path)}
            type="button"
          >
            <Files className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{item.label}</span>
              {item.description ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {item.description}
                </span>
              ) : null}
            </span>
            <span className="font-mono text-xs text-muted-foreground">{item.file.path}</span>
          </button>
        ))}
        {!filteredDirectories.length && !filteredItems.length ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {query.trim() ? "No matching items." : "No items in this directory."}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SchemaIdeEmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  readonly title: string;
  readonly description: string;
  readonly actionLabel?: string | undefined;
  readonly onAction?: (() => void) | undefined;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
        {actionLabel && onAction ? (
          <Button className="mt-4" size="small" variant="outlined" onClick={onAction}>
            <Files className="mr-1 size-3.5" />
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function resolveProjectLocation({
  location,
  files,
  selectedFile,
}: {
  readonly location: ProjectLocation | null;
  readonly files: readonly SourceFile[];
  readonly selectedFile: SourceFile | null;
}): ProjectLocation | null {
  if (location?.type === "file" && files.some((file) => file.path === location.path)) {
    return location;
  }
  if (location?.type === "directory") {
    const path = normalizeDirectoryPath(location.path);
    if (files.some((file) => isPathInsideDirectory(file.path, path))) {
      return { type: "directory", path };
    }
  }
  if (selectedFile && files.some((file) => file.path === selectedFile.path)) {
    return { type: "file", path: selectedFile.path };
  }
  return files[0] ? { type: "file", path: files[0].path } : null;
}

function getBreadcrumbs({
  files,
  location,
  navigation,
}: {
  readonly files: readonly SourceFile[];
  readonly location: ProjectLocation;
  readonly navigation: readonly PreviewNavigationRegistration[];
}): readonly WorkspaceBreadcrumb[] {
  const crumbs: WorkspaceBreadcrumb[] = [{ type: "directory", path: "", label: "Workspace" }];
  const directoryPath =
    location.type === "directory" ? location.path : directoryNameForPath(location.path);
  if (directoryPath) {
    const parts = directoryPath.split("/").filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
      const path = parts.slice(0, index + 1).join("/");
      crumbs.push({
        type: "directory",
        path,
        label: getDirectoryLabel(navigation, path),
      });
    }
  }
  if (location.type === "file") {
    const file = files.find((candidate) => candidate.path === location.path) ?? null;
    crumbs.push({
      type: "file",
      path: location.path,
      label: file
        ? labelForFile({ file, navigation, reflection: null })
        : labelForPath(location.path),
    });
  }
  return crumbs;
}

type WorkspaceBreadcrumb = {
  readonly type: "directory" | "file";
  readonly path: string;
  readonly label: string;
};

function getDirectoryFiles({
  files,
  location,
  registration,
}: {
  readonly files: readonly SourceFile[];
  readonly location: { readonly type: "directory"; readonly path: string };
  readonly registration: PreviewNavigationRegistration | null;
}): readonly SourceFile[] {
  if (registration?.itemPattern) {
    const patterns = Array.isArray(registration.itemPattern)
      ? registration.itemPattern
      : [registration.itemPattern];
    return files.filter((file) => patterns.some((pattern) => matchGlob(pattern, file.path)));
  }
  return files.filter((file) => isDirectFileInDirectory(file.path, location.path));
}

function getChildDirectories(files: readonly SourceFile[], path: string): readonly string[] {
  const directory = normalizeDirectoryPath(path);
  const prefix = directory ? `${directory}/` : "";
  const directories = new Set<string>();
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const remainder = file.path.slice(prefix.length);
    const [child] = remainder.split("/");
    if (child && remainder.includes("/")) {
      directories.add(prefix ? `${directory}/${child}` : child);
    }
  }
  return [...directories].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }),
  );
}

function findDirectoryReadme(files: readonly SourceFile[], path: string): SourceFile | null {
  const directory = normalizeDirectoryPath(path);
  const prefix = directory ? `${directory}/` : "";
  const candidates = [`${prefix}README.md`, `${prefix}index.md`, `${prefix}_overview.md`];
  return (
    candidates
      .map((candidate) => files.find((file) => file.path.toLowerCase() === candidate.toLowerCase()))
      .find(Boolean) ?? null
  );
}

function isDirectoryReadmePath(filePath: string, directoryPath: string): boolean {
  const readme = findDirectoryReadme([{ path: filePath, content: "" }], directoryPath);
  return Boolean(readme);
}

function createDirectoryFileItem({
  file,
  navigation,
  reflection,
}: {
  readonly file: SourceFile;
  readonly navigation: readonly PreviewNavigationRegistration[];
  readonly reflection: SchemaIdeReflection;
}): DirectoryFileItem {
  const format = formatForPath(file.path);
  const parsed = parseDocument(file.content, format, file.path);
  const context = {
    file,
    format,
    reflection,
    value: parsed.success ? parsed.value : null,
  };
  const registration = findFileRegistration(navigation, file.path);
  return {
    file,
    label: registration?.getItemLabel?.(context) ?? labelForFile({ file, navigation, reflection }),
    description: registration?.getItemDescription?.(context) ?? null,
  };
}

type DirectoryFileItem = {
  readonly file: SourceFile;
  readonly label: string;
  readonly description: string | null;
};

function labelForFile({
  file,
  navigation,
  reflection,
}: {
  readonly file: SourceFile;
  readonly navigation: readonly PreviewNavigationRegistration[];
  readonly reflection: SchemaIdeReflection | null;
}): string {
  const registration = findFileRegistration(navigation, file.path);
  if (registration?.getItemLabel && reflection) {
    const format = formatForPath(file.path);
    const parsed = parseDocument(file.content, format, file.path);
    return registration.getItemLabel({
      file,
      format,
      reflection,
      value: parsed.success ? parsed.value : null,
    });
  }
  return labelForPath(file.path.replace(/\.[^.]+$/, ""));
}

function findDirectoryRegistration(
  navigation: readonly PreviewNavigationRegistration[],
  path: string,
): PreviewNavigationRegistration | null {
  const directory = normalizeDirectoryPath(path);
  return (
    navigation.find((registration) => normalizeDirectoryPath(registration.path) === directory) ??
    null
  );
}

function getDirectoryLabel(
  navigation: readonly PreviewNavigationRegistration[],
  path: string,
): string {
  return findDirectoryRegistration(navigation, path)?.label ?? labelForPath(path);
}

function findFileRegistration(
  navigation: readonly PreviewNavigationRegistration[],
  path: string,
): PreviewNavigationRegistration | null {
  return (
    [...navigation]
      .sort(
        (left, right) =>
          normalizeDirectoryPath(right.path).length - normalizeDirectoryPath(left.path).length,
      )
      .find((registration) =>
        isPathInsideDirectory(path, normalizeDirectoryPath(registration.path)),
      ) ?? null
  );
}

function parseMarkdownBlocks(content: string): readonly MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let codeBuffer: string[] | null = null;
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith("```")) {
      if (codeBuffer) {
        blocks.push({ type: "code", content: codeBuffer.join("\n") });
        codeBuffer = null;
      } else {
        codeBuffer = [];
      }
      continue;
    }
    if (codeBuffer) {
      codeBuffer.push(line);
    } else {
      blocks.push({ type: "text", content: line });
    }
  }
  if (codeBuffer) {
    blocks.push({ type: "code", content: codeBuffer.join("\n") });
  }
  return blocks;
}

type MarkdownBlock =
  | { readonly type: "text"; readonly content: string }
  | { readonly type: "code"; readonly content: string };

function formatForPath(path: string | null | undefined): SchemaIdeDocumentFormat {
  return path?.endsWith(".yaml") || path?.endsWith(".yml") ? "yaml" : "json";
}

function normalizeDirectoryPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

function directoryNameForPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function isPathInsideDirectory(path: string, directory: string): boolean {
  if (!directory) return true;
  return path === directory || path.startsWith(`${directory}/`);
}

function isDirectFileInDirectory(path: string, directory: string): boolean {
  const normalized = normalizeDirectoryPath(directory);
  const prefix = normalized ? `${normalized}/` : "";
  if (!path.startsWith(prefix)) return false;
  return !path.slice(prefix.length).includes("/");
}

function labelForPath(path: string): string {
  const leaf = path.split("/").filter(Boolean).at(-1) ?? path;
  const withoutExtension = leaf.replace(/\.[^.]+$/, "");
  return (
    withoutExtension
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Workspace"
  );
}

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { diffValues, type FieldChange } from "@schematics/alchemy";
import { matchGlob } from "@schematics/artifacts";
import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
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
  Play,
  RefreshCw,
  Rocket,
  Search,
  Save,
  Trash2,
  Wrench,
  X,
  History as HistoryIcon,
} from "lucide-react";
import type { SchematicsChatAdapter } from "@schematics/agent";
import type {
  SchematicsDocumentFormat,
  SchematicsArtifactRuntime,
  SchematicsReflection,
  SourceFile,
  ProjectRouteMap,
} from "@schematics/core";
import { parseDocument } from "@schematics/core";
import type {
  ArtifactCapability,
  ArtifactProjectHistoryEntry,
  ArtifactRef,
  SchematicsArtifactProjectService,
  SchematicsDeployService,
} from "@schematics/protocol";
import { Effect } from "effect";
import { getSchematicsFileDiagnosticCounts } from "./diagnostics";
import {
  resolveSchematicsPreview,
  type SchematicsEditorMode,
  type SchematicsPreviewRegistration,
  type SchematicsPreviewRegistrationForRoutes,
} from "./preview";
import { SchematicsChatPanel } from "./SchematicsChatPanel";
import { SchematicsDeployPanel } from "./SchematicsDeployPanel";
import { SchematicsDeployChangesPanel } from "./SchematicsDeployChangesPanel";
import { SchemaCodeMirrorEditor } from "./SchemaCodeMirrorEditor";
import { SchematicsFileTree } from "./SchematicsFileTree";
import { isPdfPath, SchematicsPdfFileViewer } from "./SchematicsPdfFileViewer";
import { SchematicsPreviewView } from "./SchematicsPreviewView";
import {
  useSchematicsArtifactProjectStore,
  type SchematicsArtifactProjectStore,
} from "./artifact-project-store";
import { createSchematicsArtifactProjectToolRuntime } from "./artifact-project-tool-runtime";
import { createSchematicsArtifactClient } from "./artifact-project-client";

export interface SchematicsArtifactProjectViewProps<
  Routes extends ProjectRouteMap = ProjectRouteMap,
> {
  readonly artifactProject?: SchematicsArtifactProjectService | undefined;
  readonly project?: SchematicsArtifactRuntime | undefined;
  readonly artifacts?: SchematicsArtifactRuntime | undefined;
  readonly chat?: SchematicsChatAdapter | undefined;
  readonly title?: ReactNode | undefined;
  readonly showDebug?: boolean | undefined;
  readonly previews?: readonly SchematicsPreviewRegistrationForRoutes<Routes>[] | undefined;
  readonly previewNavigation?: readonly PreviewNavigationRegistration[] | undefined;
  readonly defaultMode?: SchematicsEditorMode | undefined;
  /** When provided, a Deploy panel (connect, plan, gated apply, runs) is offered. */
  readonly deploy?: SchematicsDeployService | undefined;
}

export type ProjectLocation =
  | { readonly type: "directory"; readonly path: string }
  | { readonly type: "file"; readonly path: string };

export interface PreviewNavigationItemContext {
  readonly file: SourceFile;
  readonly value: unknown | null;
  readonly format: SchematicsDocumentFormat;
  readonly reflection: SchematicsReflection;
}

export interface PreviewDirectoryPreambleProps {
  readonly location: { readonly type: "directory"; readonly path: string };
  readonly registration: PreviewNavigationRegistration | null;
  readonly files: readonly SourceFile[];
  readonly matchingFiles: readonly SourceFile[];
  readonly reflection: SchematicsReflection;
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

type SchematicsArtifactProjectPanel = "preview" | "files" | "history";

const chatSidebarWidth = 360;
const deploySidebarWidth = 320;

export function SchematicsArtifactProjectView<Routes extends ProjectRouteMap = ProjectRouteMap>({
  artifactProject,
  project,
  artifacts,
  chat,
  title,
  showDebug = true,
  previews = [],
  previewNavigation = [],
  defaultMode = "code",
  deploy,
}: SchematicsArtifactProjectViewProps<Routes>) {
  const resolvedArtifactProject = useMemo(() => {
    if (artifactProject) return artifactProject;
    const artifactRuntime = project ?? artifacts;
    if (artifactRuntime) {
      return createSchematicsArtifactClient({
        artifacts: artifactRuntime,
        title: typeof title === "string" ? title : undefined,
      });
    }
    throw new Error(
      "SchematicsArtifactProjectView requires artifactProject, project, or artifacts.",
    );
  }, [artifactProject, artifacts, project, title]);
  const [projectPanel, setProjectPanel] = useState<SchematicsArtifactProjectPanel>(() =>
    previews.length || previewNavigation.length ? "preview" : "files",
  );
  const [editorMode, setEditorMode] = useState<SchematicsEditorMode>(defaultMode);
  const [location, setLocation] = useState<ProjectLocation | null>(null);
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null);
  const [debugExpanded, setDebugExpanded] = useState(false);
  const [showDeploy, setShowDeploy] = useState(false);
  const {
    store,
    state,
    capabilities,
    snapshot,
    files,
    committedFiles,
    artifactRefs,
    diagnostics,
    artifactJsonSchemas,
    selectedFile,
    selectedIsDirty,
    selectedHasConflict,
    reflection,
    readOnly,
  } = useSchematicsArtifactProjectStore(resolvedArtifactProject);
  const reflectionWithDiagnostics = useMemo(
    () =>
      reflection
        ? ({
            ...reflection,
            diagnostics,
          } as SchematicsReflection)
        : null,
    [reflection, diagnostics],
  );
  const fileDiagnosticCounts = useMemo(
    () => getSchematicsFileDiagnosticCounts(diagnostics),
    [diagnostics],
  );
  const dirtyPaths = useMemo(() => new Set(Object.keys(state.drafts)), [state.drafts]);
  const conflictPaths = useMemo(() => new Set(Object.keys(state.conflicts)), [state.conflicts]);
  const toolRuntime = useMemo(() => createSchematicsArtifactProjectToolRuntime(store), [store]);
  const showChat = Boolean(chat && capabilities?.agent.enabled);
  const showHistoryPanel = Boolean(capabilities?.features.history);
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
        ? resolveSchematicsPreview({
            previews: previews as unknown as readonly SchematicsPreviewRegistration<
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
  const firstErrorPath = reflectionWithDiagnostics.validationSummary.valid
    ? null
    : (() => {
        const firstError = diagnostics.find((diagnostic) => diagnostic.severity === "error");
        return firstError?.path ?? firstError?.documentPath ?? null;
      })();
  const jumpToFirstError = firstErrorPath
    ? () => {
        setProjectPanel("files");
        setEditorMode("code");
        openFile(firstErrorPath);
      }
    : undefined;
  const shellGridStyle = {
    gridTemplateColumns: [
      showChat ? `${chatSidebarWidth}px` : null,
      "minmax(0, 1fr)",
      showDeploy ? `${deploySidebarWidth}px` : null,
    ]
      .filter(Boolean)
      .join(" "),
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
            <span className="truncate">Schematics</span>
          </div>
        ) : null}
        <div className="flex min-h-12 min-w-0 items-center gap-3 px-4 max-[760px]:flex-wrap max-[760px]:py-2">
          {!showChat ? (
            <div className="flex min-w-0 items-center gap-2 font-semibold">
              <FileCode2 className="size-4 shrink-0" />
              <span className="truncate">Schematics</span>
            </div>
          ) : null}
          <MuiToggleButtonGroup
            aria-label="Workspace view"
            exclusive
            onChange={(_, value: SchematicsArtifactProjectPanel | null) => {
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
            {showHistoryPanel ? (
              <MuiToggleButton className="gap-1.5 px-3" value="history">
                <HistoryIcon className="size-3.5" />
                History
              </MuiToggleButton>
            ) : null}
          </MuiToggleButtonGroup>
          <Chip
            className="ml-auto"
            color={reflectionWithDiagnostics.validationSummary.valid ? "secondary" : "error"}
            label={validationLabel}
            size="small"
            clickable={Boolean(jumpToFirstError)}
            onClick={jumpToFirstError}
            title={jumpToFirstError ? "Jump to first error" : undefined}
          />
          {capabilities && !capabilities.agent.enabled ? (
            <Chip label="Agent hidden" size="small" variant="outlined" />
          ) : null}
          <Button
            className="h-7 gap-1.5 px-2 text-xs"
            color={showDeploy ? "primary" : "inherit"}
            onClick={() => setShowDeploy((shown) => !shown)}
            size="small"
            variant={showDeploy ? "contained" : "outlined"}
            title="Toggle the Deploy / Sync panel"
          >
            <Rocket className="size-3.5" />
            Deploy
          </Button>
        </div>
        {showDeploy ? (
          <div className="flex min-w-0 items-center gap-2 border-l bg-sidebar/60 px-4 font-semibold max-[760px]:h-12 max-[760px]:border-l-0 max-[760px]:border-t">
            <Rocket className="size-4 shrink-0" />
            <span className="truncate">Deploy</span>
          </div>
        ) : null}
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
            <SchematicsChatPanel
              chat={chat}
              reflection={reflectionWithDiagnostics}
              tools={toolRuntime}
              readOnly={readOnly}
            />
          </div>
        ) : null}

        <div className="flex min-w-0 flex-col overflow-hidden">
          {projectPanel === "history" ? (
            <SchematicsHistoryPanel store={store} />
          ) : projectPanel === "preview" ? (
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
                <SchematicsDirectoryPreview
                  files={files}
                  location={activeLocation}
                  navigation={previewNavigation}
                  reflection={reflectionWithDiagnostics}
                  onOpenDirectory={openDirectory}
                  onOpenFile={openFile}
                />
              ) : locationFile && isPdfPath(locationFile.path) ? (
                <SchematicsPdfFileViewer
                  file={locationFile}
                  readView={(view) => readArtifactViewValue(locationFile.path, view)}
                />
              ) : locationFile ? (
                <SchematicsPreviewView
                  file={locationFile}
                  files={files}
                  format={formatForPath(locationFile.path)}
                  reflection={reflectionWithDiagnostics}
                  resolution={previewResolution}
                  previews={
                    previews as unknown as readonly SchematicsPreviewRegistration<unknown, string>[]
                  }
                  readOnly={readOnly}
                  onChange={store.updateActiveFile}
                />
              ) : (
                <SchematicsEmptyState
                  title="No location selected"
                  description="Select a file or directory to render its preview."
                  actionLabel="Open files"
                  onAction={() => setProjectPanel("files")}
                />
              )}
            </>
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
                <SchematicsFileTree
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
                  {activeLocation?.type === "directory" || !selectedFile ? null : (
                    <FileArtifactTools path={selectedFile.path} store={store} />
                  )}
                  {activeLocation?.type === "directory" || selectedIsPdf ? null : (
                    <MuiToggleButtonGroup
                      aria-label="Editor mode"
                      exclusive
                      onChange={(_, value: SchematicsEditorMode | null) => {
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
                  <SchematicsDirectoryDetails
                    files={files}
                    location={activeLocation}
                    navigation={previewNavigation}
                    reflection={reflectionWithDiagnostics}
                    onOpenDirectory={openDirectory}
                    onOpenFile={openFile}
                  />
                ) : selectedFile && selectedIsPdf ? (
                  <SchematicsPdfFileViewer
                    file={selectedFile}
                    readView={(view) => readArtifactViewValue(selectedFile.path, view)}
                  />
                ) : selectedFile && editorMode === "preview" ? (
                  <SchematicsPreviewView
                    file={selectedFile}
                    files={files}
                    format={selectedFormat}
                    reflection={reflectionWithDiagnostics}
                    resolution={previewResolution}
                    previews={
                      previews as unknown as readonly SchematicsPreviewRegistration<
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

        {showDeploy ? (
          <div className="min-h-0 max-[760px]:h-80 max-[760px]:shrink-0">
            {deploy ? (
              <SchematicsDeployPanel deploy={deploy} readOnly={readOnly} />
            ) : (
              <SchematicsDeployChangesPanel
                files={files}
                committedFiles={committedFiles}
                dirtyPaths={dirtyPaths}
                conflictPaths={conflictPaths}
                readOnly={readOnly}
                onOpenFile={(path) => {
                  openFile(path);
                  setProjectPanel("files");
                  setEditorMode("code");
                }}
              />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SchematicsHistoryPanel({ store }: { readonly store: SchematicsArtifactProjectStore }) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<readonly ArtifactProjectHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedOid, setSelectedOid] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Effect.runPromise(store.getHistory).then(
      (history) => {
        setEntries(history.entries);
        setSelectedOid((current) =>
          current && history.entries.some((entry) => entry.oid === current)
            ? current
            : (history.entries[0]?.oid ?? null),
        );
        setLoading(false);
      },
      (cause: unknown) => {
        setEntries([]);
        setSelectedOid(null);
        setError(errorMessage(cause));
        setLoading(false);
      },
    );
  }, [store]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = entries.find((entry) => entry.oid === selectedOid) ?? null;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden max-[760px]:flex-col">
      <div
        className="flex min-h-0 shrink-0 flex-col border-r max-[760px]:max-h-72 max-[760px]:!w-full max-[760px]:border-b max-[760px]:border-r-0"
        style={{ width: 360 }}
      >
        <div className="flex h-10 items-center gap-2 border-b px-3 text-sm font-medium">
          <HistoryIcon className="size-4" />
          History
          <IconButton
            size="small"
            className="ml-auto"
            onClick={load}
            disabled={loading}
            title="Refresh history"
          >
            <RefreshCw className="size-3.5" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="p-3 text-sm text-muted-foreground">Loading history...</div>
          ) : error ? (
            <div className="p-3 text-sm text-muted-foreground">{error}</div>
          ) : entries.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">No git commits yet.</div>
          ) : (
            <div className="divide-y">
              {entries.map((entry) => (
                <button
                  key={entry.oid}
                  type="button"
                  className={`flex w-full flex-col gap-1 px-3 py-2 text-left text-sm hover:bg-muted/70 ${
                    entry.oid === selectedOid ? "bg-muted" : ""
                  }`}
                  onClick={() => setSelectedOid(entry.oid)}
                >
                  <span className="truncate font-medium">{entry.subject}</span>
                  <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <code>{entry.oid.slice(0, 7)}</code>
                    <span className="truncate">{entry.author.name}</span>
                  </span>
                  <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatCommitTimestamp(entry.author.timestamp)}</span>
                    {entry.trailers.actor ? (
                      <Chip className="h-5 text-[10px]" label={entry.trailers.actor} size="small" />
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
          <div className="min-w-0 flex-1 truncate text-sm font-medium">
            {selected?.subject ?? "Commit details"}
          </div>
          {selected ? (
            <Chip label={selected.oid.slice(0, 7)} size="small" variant="outlined" />
          ) : null}
        </div>
        {selected ? (
          <Box className="min-h-0 flex-1 overflow-auto">
            <div className="space-y-4 p-4 text-sm">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Author</div>
                <div>{selected.author.name}</div>
                <div className="text-muted-foreground">{selected.author.email}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Committed</div>
                <div>{formatCommitTimestamp(selected.author.timestamp)}</div>
              </div>
              {selected.trailers.actor ||
              selected.trailers.turnId ||
              selected.trailers.toolCallId ? (
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Provenance</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {selected.trailers.actor ? (
                      <Chip label={`Actor: ${selected.trailers.actor}`} size="small" />
                    ) : null}
                    {selected.trailers.turnId ? (
                      <Chip label={`Turn: ${selected.trailers.turnId}`} size="small" />
                    ) : null}
                    {selected.trailers.toolCallId ? (
                      <Chip label={`Tool: ${selected.trailers.toolCallId}`} size="small" />
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div>
                <div className="text-xs uppercase text-muted-foreground">Message</div>
                <pre className="mt-2 whitespace-pre-wrap rounded border bg-muted/30 p-3 text-xs">
                  {selected.message}
                </pre>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Diff</div>
                {selected.changes.length === 0 ? (
                  <div className="mt-2 rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
                    No workspace file changes in this commit.
                  </div>
                ) : (
                  <div className="mt-2 space-y-3">
                    {selected.changes.map((change) => (
                      <HistoryFileChange key={`${change.status}:${change.path}`} change={change} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Box>
        ) : (
          <SchematicsEmptyState
            title="No commit selected"
            description="Select a commit to inspect its metadata."
          />
        )}
      </div>
    </div>
  );
}

function HistoryFileChange({
  change,
}: {
  readonly change: ArtifactProjectHistoryEntry["changes"][number];
}) {
  const fieldChanges = historyFieldChanges(change);

  return (
    <div className="rounded border">
      <div className="flex min-w-0 items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs">
        <Chip
          className="h-5 text-[10px]"
          color={historyStatusColor(change.status)}
          label={historyStatusLabel(change.status)}
          size="small"
        />
        <code className="min-w-0 truncate">{change.path}</code>
      </div>
      {fieldChanges ? <HistoryFieldDiff changes={fieldChanges} /> : null}
      {change.status === "modified" ? (
        <div className="grid gap-0 md:grid-cols-2">
          <HistoryFileContent content={change.beforeContent} label="Before" muted />
          <HistoryFileContent content={change.afterContent} label="After" />
        </div>
      ) : (
        <HistoryFileContent
          content={change.status === "deleted" ? change.beforeContent : change.afterContent}
          label={change.status === "deleted" ? "Deleted" : "Added"}
          muted={change.status === "deleted"}
        />
      )}
    </div>
  );
}

function HistoryFieldDiff({ changes }: { readonly changes: readonly FieldChange[] }) {
  return (
    <div className="border-b bg-background">
      <div className="border-b px-3 py-1.5 text-xs uppercase text-muted-foreground">Field diff</div>
      <div className="divide-y">
        <div className="hidden gap-0 bg-muted/20 text-[10px] uppercase text-muted-foreground md:grid md:grid-cols-[220px_1fr_1fr]">
          <div className="border-r px-3 py-1.5">Field</div>
          <div className="border-r px-3 py-1.5">Before</div>
          <div className="px-3 py-1.5">After</div>
        </div>
        {changes.map((change) => (
          <div key={change.path} className="grid gap-0 text-xs md:grid-cols-[220px_1fr_1fr]">
            <code className="border-b px-3 py-2 md:border-b-0 md:border-r">{change.path}</code>
            <pre className="min-w-0 overflow-auto whitespace-pre-wrap border-b bg-muted/20 px-3 py-2 text-muted-foreground md:border-b-0 md:border-r">
              {formatHistoryFieldValue(change.before)}
            </pre>
            <pre className="min-w-0 overflow-auto whitespace-pre-wrap px-3 py-2">
              {formatHistoryFieldValue(change.after)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryFileContent({
  label,
  content,
  muted = false,
}: {
  readonly label: string;
  readonly content: string | null;
  readonly muted?: boolean | undefined;
}) {
  return (
    <div className="min-w-0 border-t first:border-t-0 md:border-t-0 md:border-l md:first:border-l-0">
      <div className="border-b px-3 py-1.5 text-xs uppercase text-muted-foreground">{label}</div>
      <pre
        className={`max-h-80 overflow-auto whitespace-pre-wrap p-3 text-xs ${
          muted ? "bg-muted/20 text-muted-foreground" : "bg-background"
        }`}
      >
        {content ?? ""}
      </pre>
    </div>
  );
}

function historyFieldChanges(
  change: ArtifactProjectHistoryEntry["changes"][number],
): readonly FieldChange[] | null {
  const before = parseHistoryFileValue(change.path, change.beforeContent);
  const after = parseHistoryFileValue(change.path, change.afterContent);

  if (
    (change.beforeContent !== null && !before.success) ||
    (change.afterContent !== null && !after.success)
  ) {
    return null;
  }

  if (!before.success || !after.success) return null;

  const beforeValue =
    change.beforeContent === null ? comparableEmptyValue(after.value) : before.value;
  const afterValue =
    change.afterContent === null ? comparableEmptyValue(before.value) : after.value;
  const changes = diffValues(beforeValue, afterValue);
  return changes.length ? changes : null;
}

function parseHistoryFileValue(
  path: string,
  content: string | null,
): { readonly success: true; readonly value: unknown } | { readonly success: false } {
  if (content === null) return { success: true, value: undefined };

  const parsed = parseDocument(content, formatForPath(path), path);
  return parsed.success ? { success: true, value: parsed.value } : { success: false };
}

function comparableEmptyValue(value: unknown): unknown {
  return isPlainObjectValue(value) ? {} : undefined;
}

function isPlainObjectValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatHistoryFieldValue(value: unknown): string {
  if (value === undefined) return "(missing)";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function historyStatusLabel(status: ArtifactProjectHistoryEntry["changes"][number]["status"]) {
  if (status === "added") return "Added";
  if (status === "deleted") return "Deleted";
  return "Modified";
}

function historyStatusColor(
  status: ArtifactProjectHistoryEntry["changes"][number]["status"],
): "default" | "error" | "success" {
  if (status === "added") return "success";
  if (status === "deleted") return "error";
  return "default";
}

function FileArtifactTools({
  path,
  store,
}: {
  readonly path: string;
  readonly store: SchematicsArtifactProjectStore;
}) {
  const refValue = useMemo<ArtifactRef>(
    () => ({ _tag: "ProjectFile", path }) as ArtifactRef,
    [path],
  );
  const [open, setOpen] = useState(false);
  const [capabilitiesState, setCapabilitiesState] = useState<{
    readonly loading: boolean;
    readonly error: string | null;
    readonly capabilities: readonly ArtifactCapability[];
  }>({ loading: true, error: null, capabilities: [] });

  useEffect(() => {
    let cancelled = false;
    setCapabilitiesState({ loading: true, error: null, capabilities: [] });
    Effect.runPromise(store.getArtifactCapabilities({ ref: refValue })).then(
      (response) => {
        if (cancelled) return;
        setCapabilitiesState({
          loading: false,
          error: null,
          capabilities: response.capabilities,
        });
      },
      (error: unknown) => {
        if (cancelled) return;
        setCapabilitiesState({ loading: false, error: errorMessage(error), capabilities: [] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [refValue, store]);

  const count = capabilitiesState.capabilities.length;
  const fileName = path.split("/").pop() ?? path;

  return (
    <>
      <Button
        className="h-7 gap-1 px-2 text-xs"
        color="inherit"
        disabled={capabilitiesState.loading && count === 0}
        onClick={() => setOpen(true)}
        size="small"
        title={`${count} artifact tool${count === 1 ? "" : "s"} exposed for ${fileName}`}
        variant="outlined"
      >
        <Wrench className="size-3.5" />
        Tools
        <Chip
          className="ml-0.5 h-4 min-w-5 text-[10px]"
          label={capabilitiesState.loading ? "…" : count}
          size="small"
        />
      </Button>
      <Dialog fullWidth maxWidth="md" onClose={() => setOpen(false)} open={open}>
        <DialogTitle className="flex items-center gap-2 pr-2">
          <Wrench className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-base">Artifact tools — {fileName}</span>
          <IconButton onClick={() => setOpen(false)} size="small" title="Close">
            <X className="size-4" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <ArtifactCapabilityInspector
            capabilities={capabilitiesState.capabilities}
            error={capabilitiesState.error}
            loading={capabilitiesState.loading}
            refValue={refValue}
            store={store}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatCommitTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

function ArtifactCapabilityInspector({
  refValue,
  store,
  capabilities,
  loading,
  error,
}: {
  readonly refValue: ArtifactRef;
  readonly store: SchematicsArtifactProjectStore;
  readonly capabilities: readonly ArtifactCapability[];
  readonly loading: boolean;
  readonly error: string | null;
}) {
  const [selectedView, setSelectedView] = useState<string | null>(null);
  const [viewState, setViewState] = useState<{
    readonly loading: boolean;
    readonly error: string | null;
    readonly value: unknown;
    readonly view: string | null;
  }>({ loading: false, error: null, value: null, view: null });

  useEffect(() => {
    setSelectedView((current) =>
      current && capabilities.some((capability) => capability.view === current)
        ? current
        : (capabilities[0]?.view ?? null),
    );
    setViewState({ loading: false, error: null, value: null, view: null });
  }, [capabilities]);

  const selectedCapability =
    selectedView !== null
      ? (capabilities.find((capability) => capability.view === selectedView) ?? null)
      : null;

  const readSelectedView = () => {
    if (!selectedView) return;
    setViewState({ loading: true, error: null, value: null, view: selectedView });
    Effect.runPromise(store.readArtifactView({ ref: refValue, view: selectedView })).then(
      (response) => {
        setViewState({
          loading: false,
          error: null,
          value: response.value,
          view: response.view,
        });
      },
      (err: unknown) => {
        setViewState({
          loading: false,
          error: errorMessage(err),
          value: null,
          view: selectedView,
        });
      },
    );
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium">Tools</div>
          {loading ? (
            <Chip label="Loading" size="small" variant="outlined" />
          ) : (
            <Chip label={capabilities.length} size="small" variant="outlined" />
          )}
        </div>
        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        ) : capabilities.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {capabilities.map((capability) => {
              const active = selectedView === capability.view;
              return (
                <button
                  key={`${capability.type}:${capability.id}:${capability.view}`}
                  className={`min-h-24 rounded-md border p-3 text-left text-xs ${
                    active ? "border-primary bg-primary/10" : "bg-background hover:bg-muted/50"
                  }`}
                  onClick={() => {
                    setSelectedView(capability.view);
                    setViewState({ loading: false, error: null, value: null, view: null });
                  }}
                  type="button"
                >
                  <span className="block truncate text-sm font-medium">{capability.view}</span>
                  <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                    {capability.type}
                    {capability.routeId ? ` / ${capability.routeId}` : ""}
                  </span>
                  <CapabilityPolicyChips capability={capability} />
                </button>
              );
            })}
          </div>
        ) : loading ? null : (
          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            No artifact tools are exposed for this file.
          </div>
        )}
      </div>

      <div className="grid gap-2">
        <div className="flex min-h-9 items-center gap-2">
          <div className="text-sm font-medium">Result</div>
          {selectedCapability ? (
            <>
              <Chip label={selectedCapability.view} size="small" />
              <CapabilityPolicyChips capability={selectedCapability} compact />
            </>
          ) : null}
          <Button
            className="ml-auto h-8 gap-1 px-2 text-xs"
            disabled={!selectedView || viewState.loading}
            onClick={readSelectedView}
            size="small"
            variant="contained"
          >
            <Play className="size-3.5" />
            Run tool
          </Button>
        </div>
        <div className="min-h-64 rounded-md border bg-background">
          {viewState.loading ? (
            <div className="p-4 text-sm text-muted-foreground">Running tool...</div>
          ) : viewState.error ? (
            <div className="p-4 text-sm text-destructive">{viewState.error}</div>
          ) : viewState.view ? (
            <ArtifactViewValue value={viewState.value} />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              Select a tool and run it to materialize its value.
            </div>
          )}
        </div>
      </div>
    </div>
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

function SchematicsDirectoryPreview({
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
  readonly reflection: SchematicsReflection;
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

function SchematicsDirectoryDetails({
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
  readonly reflection: SchematicsReflection;
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
  readonly reflection: SchematicsReflection;
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

function SchematicsEmptyState({
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
  readonly reflection: SchematicsReflection;
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
  readonly reflection: SchematicsReflection | null;
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

function formatForPath(path: string | null | undefined): SchematicsDocumentFormat {
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

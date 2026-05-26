import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import Box from "@mui/material/Box";
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
  Search,
  Save,
  Trash2,
} from "lucide-react";
import type { SchemaIdeChatAdapter } from "@schema-ide/agent";
import type {
  SchemaIdeDocumentFormat,
  SchemaIdeReflection,
  SourceFile,
  WorkspaceRouteMap,
} from "@schema-ide/core";
import { parseDocument } from "@schema-ide/core";
import type { SchemaIdeWorkspaceService } from "@schema-ide/protocol";
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
import { useSchemaIdeWorkspaceStore } from "./workspace-store";
import { createSchemaIdeWorkspaceToolRuntime } from "./workspace-tool-runtime";

export interface SchemaIdeWorkspaceViewProps<Routes extends WorkspaceRouteMap = WorkspaceRouteMap> {
  readonly workspace: SchemaIdeWorkspaceService;
  readonly chat?: SchemaIdeChatAdapter | undefined;
  readonly title?: ReactNode | undefined;
  readonly showDebug?: boolean | undefined;
  readonly previews?: readonly SchemaIdePreviewRegistrationForRoutes<Routes>[] | undefined;
  readonly previewNavigation?: readonly PreviewNavigationRegistration[] | undefined;
  readonly defaultMode?: SchemaIdeEditorMode | undefined;
}

export type WorkspaceLocation =
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

type SchemaIdeWorkspacePanel = "preview" | "files";

const chatSidebarWidth = 360;

export function SchemaIdeWorkspaceView<Routes extends WorkspaceRouteMap = WorkspaceRouteMap>({
  workspace,
  chat,
  showDebug = true,
  previews = [],
  previewNavigation = [],
  defaultMode = "code",
}: SchemaIdeWorkspaceViewProps<Routes>) {
  const [editorMode, setEditorMode] = useState<SchemaIdeEditorMode>(defaultMode);
  const [workspacePanel, setWorkspacePanel] = useState<SchemaIdeWorkspacePanel>(() =>
    previews.length || previewNavigation.length ? "preview" : "files",
  );
  const [location, setLocation] = useState<WorkspaceLocation | null>(null);
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null);
  const [debugExpanded, setDebugExpanded] = useState(false);
  const {
    store,
    state,
    capabilities,
    snapshot,
    files,
    selectedFile,
    selectedIsDirty,
    selectedHasConflict,
    reflection,
    readOnly,
  } = useSchemaIdeWorkspaceStore(workspace);
  const fileDiagnosticCounts = useMemo(
    () => getSchemaIdeFileDiagnosticCounts(reflection?.diagnostics ?? []),
    [reflection?.diagnostics],
  );
  const dirtyPaths = useMemo(() => new Set(Object.keys(state.drafts)), [state.drafts]);
  const conflictPaths = useMemo(() => new Set(Object.keys(state.conflicts)), [state.conflicts]);
  const toolRuntime = useMemo(() => createSchemaIdeWorkspaceToolRuntime(store), [store]);
  const showChat = Boolean(chat && capabilities?.agent.enabled);
  const activeLocation = useMemo(
    () => resolveWorkspaceLocation({ location, files, selectedFile }),
    [files, location, selectedFile],
  );
  const locationFile =
    activeLocation?.type === "file"
      ? (files.find((file) => file.path === activeLocation.path) ?? null)
      : null;
  const selectedFormat = formatForPath(locationFile?.path ?? selectedFile?.path);
  const selectedIsPdf = isPdfPath((locationFile ?? selectedFile)?.path);
  const activeDirectoryPath = activeLocation?.type === "directory" ? activeLocation.path : null;
  const previewResolution = useMemo(
    () =>
      reflection
        ? resolveSchemaIdePreview({
            previews: previews as unknown as readonly SchemaIdePreviewRegistration<
              unknown,
              string
            >[],
            reflection: reflection as SchemaIdeReflection,
            file: locationFile,
            selectedPreviewId,
          })
        : null,
    [previews, reflection, locationFile, selectedPreviewId],
  );

  useEffect(() => {
    if (!activeLocation && selectedFile) {
      setLocation({ type: "file", path: selectedFile.path });
    }
  }, [activeLocation, selectedFile]);

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

  if (!snapshot || !reflection) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading workspace...
      </div>
    );
  }

  const validationLabel = reflection.validationSummary.valid
    ? "Valid"
    : `${reflection.validationSummary.errorCount} errors`;
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
            onChange={(_, value: SchemaIdeWorkspacePanel | null) => {
              if (value) setWorkspacePanel(value);
            }}
            size="small"
            value={workspacePanel}
          >
            <MuiToggleButton className="gap-1.5 px-3" value="preview">
              <Eye className="size-3.5" />
              Preview
            </MuiToggleButton>
            <MuiToggleButton className="gap-1.5 px-3" value="files">
              <Files className="size-3.5" />
              Files
            </MuiToggleButton>
          </MuiToggleButtonGroup>
          <Chip
            className="ml-auto"
            color={reflection.validationSummary.valid ? "secondary" : "error"}
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
              reflection={reflection as SchemaIdeReflection}
              tools={toolRuntime}
              readOnly={readOnly}
            />
          </div>
        ) : null}

        <div className="flex min-w-0 flex-col overflow-hidden">
          {workspacePanel === "preview" ? (
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
                  reflection={reflection as SchemaIdeReflection}
                  onOpenDirectory={openDirectory}
                  onOpenFile={openFile}
                />
              ) : locationFile && isPdfPath(locationFile.path) ? (
                <SchemaIdePdfFileViewer file={locationFile} />
              ) : locationFile ? (
                <SchemaIdePreviewView
                  file={locationFile}
                  files={files}
                  format={formatForPath(locationFile.path)}
                  reflection={reflection as SchemaIdeReflection}
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
                  onAction={() => setWorkspacePanel("files")}
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
                  <div className="min-w-0 truncate font-mono text-xs">
                    {activeLocation
                      ? activeLocation.type === "directory"
                        ? `${activeLocation.path}/`
                        : activeLocation.path
                      : "No location"}
                  </div>
                  <span className="ml-auto" />
                  {activeLocation?.type === "directory" ? (
                    <Chip label="Directory" size="small" variant="outlined" />
                  ) : selectedIsPdf ? (
                    <Chip label="PDF" size="small" variant="outlined" />
                  ) : (
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
                  {!selectedIsPdf && previewResolution && previewResolution.previews.length > 1 ? (
                    <FormControl className="max-w-40" size="small">
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
                  ) : null}
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
                    reflection={reflection as SchemaIdeReflection}
                    onOpenDirectory={openDirectory}
                    onOpenFile={openFile}
                  />
                ) : selectedFile && selectedIsPdf ? (
                  <SchemaIdePdfFileViewer file={selectedFile} />
                ) : editorMode === "preview" && selectedFile ? (
                  <SchemaIdePreviewView
                    file={selectedFile}
                    files={files}
                    format={selectedFormat}
                    reflection={reflection as SchemaIdeReflection}
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
                    reflection={reflection}
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
                          diagnostics: reflection.diagnostics,
                          routeMatches: reflection.routeMatches,
                          schemas: reflection.schemas,
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

function PreviewBreadcrumbs({
  files,
  location,
  navigation,
  onOpenDirectory,
  onOpenFile,
}: {
  readonly files: readonly SourceFile[];
  readonly location: WorkspaceLocation | null;
  readonly navigation: readonly PreviewNavigationRegistration[];
  readonly onOpenDirectory: (path: string) => void;
  readonly onOpenFile: (path: string) => void;
}) {
  if (!location) {
    return <div className="min-w-0 truncate text-sm font-medium">Preview</div>;
  }

  const crumbs = getBreadcrumbs({ files, location, navigation });
  return (
    <div className="flex min-w-0 items-center gap-1 text-sm">
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <div key={`${crumb.type}:${crumb.path}`} className="flex min-w-0 items-center gap-1">
            {index > 0 ? <span className="text-muted-foreground">/</span> : null}
            {last ? (
              <span className="min-w-0 truncate font-medium">{crumb.label}</span>
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
          </div>
        );
      })}
    </div>
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
      <div className="grid max-w-4xl gap-4 p-4">
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
  const normalizedQuery = query.trim().toLowerCase();
  const filteredDirectories = childDirectories.filter((directory) =>
    labelForPath(directory).toLowerCase().includes(normalizedQuery),
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
          placeholder={`Search ${labelForPath(location.path).toLowerCase()}...`}
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
            <span className="min-w-0 flex-1 truncate font-medium">{labelForPath(directory)}</span>
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
  readonly actionLabel: string;
  readonly onAction: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
        <Button className="mt-4" size="small" variant="outlined" onClick={onAction}>
          <Files className="mr-1 size-3.5" />
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

function resolveWorkspaceLocation({
  location,
  files,
  selectedFile,
}: {
  readonly location: WorkspaceLocation | null;
  readonly files: readonly SourceFile[];
  readonly selectedFile: SourceFile | null;
}): WorkspaceLocation | null {
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
  readonly location: WorkspaceLocation;
  readonly navigation: readonly PreviewNavigationRegistration[];
}): readonly WorkspaceBreadcrumb[] {
  const crumbs: WorkspaceBreadcrumb[] = [];
  const directoryPath =
    location.type === "directory" ? location.path : directoryNameForPath(location.path);
  if (directoryPath) {
    const parts = directoryPath.split("/").filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
      const path = parts.slice(0, index + 1).join("/");
      crumbs.push({
        type: "directory",
        path,
        label: findDirectoryRegistration(navigation, path)?.label ?? labelForPath(path),
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
  if (!crumbs.length && location.type === "directory") {
    crumbs.push({ type: "directory", path: location.path, label: labelForPath(location.path) });
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
    return files.filter((file) => patterns.some((pattern) => matchesGlob(file.path, pattern)));
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

function matchesGlob(path: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\0")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0/g, ".*");
  return new RegExp(`^${escaped}$`).test(path);
}

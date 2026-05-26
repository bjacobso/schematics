import { useMemo, useState, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import MuiSelect, { type SelectChangeEvent } from "@mui/material/Select";
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
  Save,
  Trash2,
} from "lucide-react";
import type { SchemaIdeChatAdapter } from "@schema-ide/agent";
import type {
  SchemaIdeDocumentFormat,
  SchemaIdeReflection,
  WorkspaceRouteMap,
} from "@schema-ide/core";
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
  readonly defaultMode?: SchemaIdeEditorMode | undefined;
}

type SchemaIdeWorkspacePanel = "preview" | "files";

const chatSidebarWidth = 360;

export function SchemaIdeWorkspaceView<Routes extends WorkspaceRouteMap = WorkspaceRouteMap>({
  workspace,
  chat,
  showDebug = true,
  previews = [],
  defaultMode = "code",
}: SchemaIdeWorkspaceViewProps<Routes>) {
  const [editorMode, setEditorMode] = useState<SchemaIdeEditorMode>(defaultMode);
  const [workspacePanel, setWorkspacePanel] = useState<SchemaIdeWorkspacePanel>(() =>
    previews.length ? "preview" : "files",
  );
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
  const selectedFormat = formatForPath(selectedFile?.path);
  const selectedIsPdf = isPdfPath(selectedFile?.path);
  const previewResolution = useMemo(
    () =>
      reflection
        ? resolveSchemaIdePreview({
            previews: previews as unknown as readonly SchemaIdePreviewRegistration<
              unknown,
              string
            >[],
            reflection: reflection as SchemaIdeReflection,
            file: selectedFile,
            selectedPreviewId,
          })
        : null,
    [previews, reflection, selectedFile, selectedPreviewId],
  );

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
            <MuiToggleButton className="gap-1.5 px-3" value="preview" disabled={!previews.length}>
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
                <div className="min-w-0 truncate text-sm font-medium">
                  {previewResolution?.selected.label ?? "Preview"}
                </div>
                <div className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                  {selectedFile?.path ?? "No file"}
                </div>
                {!selectedIsPdf && previewResolution && previewResolution.previews.length > 1 ? (
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
              {selectedFile && selectedIsPdf ? (
                <SchemaIdePdfFileViewer file={selectedFile} />
              ) : selectedFile ? (
                <SchemaIdePreviewView
                  file={selectedFile}
                  files={files}
                  format={selectedFormat}
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
                  title="No file selected"
                  description="Select a file to render its preview."
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
                  activePath={selectedFile?.path}
                  diagnosticCounts={fileDiagnosticCounts}
                  dirtyPaths={dirtyPaths}
                  conflictPaths={conflictPaths}
                  onSelectFile={store.setActiveFile}
                />
              </div>

              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
                  <div className="min-w-0 truncate font-mono text-xs">
                    {selectedFile?.path ?? "No file"}
                  </div>
                  <span className="ml-auto" />
                  {selectedIsPdf ? (
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
                  {selectedHasConflict ? (
                    <Chip
                      color="error"
                      className="text-[10px]"
                      label="External conflict"
                      size="small"
                    />
                  ) : selectedIsDirty ? (
                    <Chip color="secondary" className="text-[10px]" label="Unsaved" size="small" />
                  ) : null}
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
                </div>

                {selectedFile && selectedIsPdf ? (
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

function formatForPath(path: string | null | undefined): SchemaIdeDocumentFormat {
  return path?.endsWith(".yaml") || path?.endsWith(".yml") ? "yaml" : "json";
}

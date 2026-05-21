import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, FileCode2, FilePlus2, FolderTree, Save, Trash2 } from "lucide-react";
import type { SchemaIdeChatAdapter } from "@schema-ide/agent";
import type {
  SchemaIdeDocumentFormat,
  SchemaIdeReflection,
  WorkspaceRouteMap,
} from "@schema-ide/core";
import type { SchemaIdeWorkspaceService } from "@schema-ide/protocol";
import { Badge, Button, ScrollArea } from "@schema-ide/ui";
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

export function SchemaIdeWorkspaceView<Routes extends WorkspaceRouteMap = WorkspaceRouteMap>({
  workspace,
  chat,
  title,
  showDebug = true,
  previews = [],
  defaultMode = "code",
}: SchemaIdeWorkspaceViewProps<Routes>) {
  const [editorMode, setEditorMode] = useState<SchemaIdeEditorMode>(defaultMode);
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null);
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
  const toolRuntime = useMemo(() => createSchemaIdeWorkspaceToolRuntime(store), [store]);
  const showChat = Boolean(chat && capabilities?.agent.enabled);
  const selectedFormat = formatForPath(selectedFile?.path);
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <div className="flex items-center gap-2 font-medium">
          <FileCode2 className="size-4" />
          {title ?? capabilities?.workspace.title ?? "Schema IDE"}
        </div>
        <Badge variant={reflection.validationSummary.valid ? "secondary" : "destructive"}>
          {reflection.validationSummary.valid
            ? "Valid"
            : `${reflection.validationSummary.errorCount} errors`}
        </Badge>
        {capabilities && !capabilities.agent.enabled ? (
          <Badge variant="outline" className="ml-auto">
            Agent hidden
          </Badge>
        ) : null}
      </div>

      {state.error ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {state.error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {showChat && chat ? (
          <div className="min-h-0 shrink-0" style={{ width: 360 }}>
            <SchemaIdeChatPanel
              chat={chat}
              reflection={reflection as SchemaIdeReflection}
              tools={toolRuntime}
              readOnly={readOnly}
            />
          </div>
        ) : null}

        <div className="flex min-h-0 shrink-0 flex-col border-r" style={{ width: 280 }}>
          <div className="flex h-10 items-center gap-2 border-b px-3 text-sm font-medium">
            <FolderTree className="size-4" />
            Files
            <Button
              size="icon-xs"
              variant="ghost"
              className="ml-auto"
              onClick={() => Effect.runFork(store.addFile)}
              disabled={readOnly}
              title="Add file"
            >
              <FilePlus2 className="size-3.5" />
            </Button>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-2">
              {files.map((file) => {
                const counts = fileDiagnosticCounts.get(file.path);
                const issueCount = counts ? counts.errors || counts.warnings || counts.infos : 0;
                const dirty = state.drafts[file.path] !== undefined;
                const conflict = state.conflicts[file.path] !== undefined;
                return (
                  <button
                    key={file.path}
                    className={`mb-1 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
                      selectedFile?.path === file.path
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    }`}
                    onClick={() => store.setActiveFile(file.path)}
                  >
                    <span className="min-w-0 flex-1 truncate">{file.path}</span>
                    {conflict ? <AlertTriangle className="size-3.5 text-destructive" /> : null}
                    {dirty ? <Badge className="h-4 px-1.5 text-[10px]">Dirty</Badge> : null}
                    {issueCount ? (
                      <Badge
                        variant={counts?.errors ? "destructive" : "secondary"}
                        className="h-4 min-w-4 px-1.5 text-[10px]"
                      >
                        {issueCount}
                      </Badge>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
            <div className="min-w-0 truncate font-mono text-xs">
              {selectedFile?.path ?? "No file"}
            </div>
            <div className="flex rounded-md border p-0.5">
              <Button
                size="sm"
                variant={editorMode === "code" ? "secondary" : "ghost"}
                className="h-6 px-2 text-[11px]"
                onClick={() => setEditorMode("code")}
              >
                Code
              </Button>
              <Button
                size="sm"
                variant={editorMode === "preview" ? "secondary" : "ghost"}
                className="h-6 px-2 text-[11px]"
                onClick={() => setEditorMode("preview")}
                disabled={!selectedFile}
              >
                Preview
              </Button>
            </div>
            {previewResolution && previewResolution.previews.length > 1 ? (
              <select
                value={previewResolution.selected.id}
                onChange={(event) => setSelectedPreviewId(event.target.value)}
                className="h-7 max-w-40 rounded-md border bg-background px-2 text-xs"
                aria-label="Preview"
              >
                {previewResolution.previews.map((preview) => (
                  <option key={preview.id} value={preview.id}>
                    {preview.label}
                  </option>
                ))}
              </select>
            ) : null}
            {selectedHasConflict ? (
              <Badge variant="destructive" className="ml-auto text-[10px]">
                External conflict
              </Badge>
            ) : selectedIsDirty ? (
              <Badge variant="secondary" className="ml-auto text-[10px]">
                Unsaved
              </Badge>
            ) : (
              <span className="ml-auto" />
            )}
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => Effect.runFork(store.saveActiveFile)}
              disabled={readOnly || !selectedFile || !selectedIsDirty}
              title="Save file"
            >
              <Save className="size-3.5" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => Effect.runFork(store.deleteActiveFile)}
              disabled={readOnly || !selectedFile || !capabilities?.features.delete}
              title="Delete file"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>

          {editorMode === "preview" && selectedFile ? (
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

          {showDebug ? (
            <div className="h-56 shrink-0 border-t">
              <ScrollArea className="h-full">
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
              </ScrollArea>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function formatForPath(path: string | null | undefined): SchemaIdeDocumentFormat {
  return path?.endsWith(".yaml") || path?.endsWith(".yml") ? "yaml" : "json";
}

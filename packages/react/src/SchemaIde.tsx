import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  Bug,
  Check,
  CheckCircle2,
  ChevronDown,
  FileCode2,
  FilePlus2,
  FolderTree,
  RefreshCw,
  Redo2,
  Save,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import { createLocalSchemaIdeChatAdapter } from "@schema-ide/agent";
import type {
  SchemaIdeChatAdapter,
  SchemaIdeChatMessage,
  SchemaIdeFileEdit,
  SchemaIdePatchProposal,
  SchemaIdeToolCall,
  SchemaIdeHostRuntime,
} from "@schema-ide/agent";
import { codecForPath, stringifyDocument } from "@schema-ide/core";
import { isWorkspaceSchema } from "@schema-ide/core";
import {
  applyWorkspaceChange,
  canRedoWorkspaceChange,
  canUndoWorkspaceChange,
  createReflection,
  createVersionedWorkspace,
  getWorkspacePatchPaths,
  redoWorkspaceChange,
  type SchemaIdeInputSchema,
  undoWorkspaceChange,
  validateSchemaIdeValue,
  type VersionedWorkspaceState,
  type WorkspaceRouteMap,
  type WorkspaceRevisionMetadata,
} from "@schema-ide/core";
import type { SchemaIdeDocumentFormat, SourceFile } from "@schema-ide/core";
import { Badge, Button, ScrollArea, Textarea } from "@schema-ide/ui";
import { getSchemaIdeFileDiagnosticCounts } from "./diagnostics";
import {
  resolveSchemaIdePreview,
  type SchemaIdeEditorMode,
  type SchemaIdePreviewRegistration,
  type SchemaIdePreviewRegistrationForRoutes,
} from "./preview";
import { SchemaCodeMirrorEditor } from "./SchemaCodeMirrorEditor";
import { SchemaIdePreviewView } from "./SchemaIdePreviewView";

export interface SchemaIdeProps<A = unknown, Routes extends WorkspaceRouteMap = WorkspaceRouteMap> {
  readonly schema: SchemaIdeInputSchema<A, Routes>;
  readonly defaultFormat?: SchemaIdeDocumentFormat | undefined;
  readonly allowedFormats?: readonly SchemaIdeDocumentFormat[] | undefined;
  readonly initialValue?: A | undefined;
  readonly value?: A | undefined;
  readonly onChange?: ((value: A) => void) | undefined;
  readonly initialFiles?: readonly SourceFile[] | undefined;
  readonly files?: readonly SourceFile[] | undefined;
  readonly onFilesChange?: ((files: readonly SourceFile[]) => void) | undefined;
  readonly onWorkspaceChange?: ((workspace: VersionedWorkspaceState) => void) | undefined;
  readonly chat?: SchemaIdeChatAdapter | undefined;
  readonly readOnly?: boolean | undefined;
  readonly title?: ReactNode;
  readonly showDebug?: boolean | undefined;
  readonly previews?: readonly SchemaIdePreviewRegistrationForRoutes<Routes>[] | undefined;
  readonly defaultMode?: SchemaIdeEditorMode | undefined;
}

export function SchemaIde<A, Routes extends WorkspaceRouteMap = WorkspaceRouteMap>({
  schema,
  defaultFormat = "json",
  allowedFormats = ["json", "yaml"],
  initialValue,
  value,
  onChange,
  initialFiles,
  files,
  onFilesChange,
  onWorkspaceChange,
  chat = createLocalSchemaIdeChatAdapter(),
  readOnly = false,
  title = "Schema IDE",
  showDebug = true,
  previews = [],
  defaultMode = "code",
}: SchemaIdeProps<A, Routes>) {
  const workspaceMode = isWorkspaceSchema(schema);
  const [activeFormat, setActiveFormat] = useState<SchemaIdeDocumentFormat>(defaultFormat);
  const [internalWorkspace, setInternalWorkspace] = useState<VersionedWorkspaceState>(() =>
    createVersionedWorkspace(
      filesFromInitialState({ workspaceMode, initialFiles, initialValue, value, defaultFormat }),
    ),
  );
  const initialWorkspaceFiles = files ?? internalWorkspace.files;
  const [activeFile, setActiveFile] = useState<string | null>(
    () => initialWorkspaceFiles[0]?.path ?? null,
  );
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [debugTab, setDebugTab] = useState<
    "diagnostics" | "schema" | "value" | "routes" | "history" | "context"
  >("diagnostics");
  const [editorMode, setEditorMode] = useState<SchemaIdeEditorMode>(defaultMode);
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null);
  const [pendingProposal, setPendingProposal] = useState<SchemaIdePatchProposal | null>(null);
  const proposalSequenceRef = useRef(0);

  const controlledWorkspace = useMemo(
    () => (files ? createVersionedWorkspace(files) : null),
    [files],
  );
  const workspace = controlledWorkspace ?? internalWorkspace;
  const committedFiles = workspace.files;
  const resolvedFiles = useMemo(
    () => applyDraftsToFiles(committedFiles, drafts),
    [committedFiles, drafts],
  );
  const filesRef = useRef<readonly SourceFile[]>(resolvedFiles);
  const committedFilesRef = useRef<readonly SourceFile[]>(committedFiles);
  const draftsRef = useRef<Readonly<Record<string, string>>>(drafts);
  const workspaceRef = useRef<VersionedWorkspaceState>(workspace);
  const activeFileRef = useRef<string | null>(activeFile);
  const activeToolContextRef = useRef<{
    readonly turnId: string;
    readonly toolCallId: string;
  } | null>(null);
  const lastEmittedValueRef = useRef<string | null>(null);
  useEffect(() => {
    filesRef.current = resolvedFiles;
  }, [resolvedFiles]);
  useEffect(() => {
    committedFilesRef.current = committedFiles;
  }, [committedFiles]);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);
  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);
  useEffect(() => {
    activeFileRef.current = activeFile;
  }, [activeFile]);

  const selectedFile = activeFile
    ? (resolvedFiles.find((file) => file.path === activeFile) ?? null)
    : (resolvedFiles[0] ?? null);
  const selectedFormat = selectedFile
    ? workspaceMode
      ? codecForPath(selectedFile.path, activeFormat).format
      : activeFormat
    : activeFormat;
  const selectedIsPdf = isPdfPath(selectedFile?.path);
  const selectedFileKindLabel = selectedIsPdf ? "PDF" : selectedFormat.toUpperCase();

  const validation = useMemo(
    () =>
      validateSchemaIdeValue({
        schema,
        files: resolvedFiles,
        activeFile: selectedFile?.path ?? null,
        activeFormat: selectedFormat,
      }),
    [activeFile, resolvedFiles, schema, selectedFile?.path, selectedFormat],
  );

  const reflection = useMemo(
    () =>
      createReflection({
        schema,
        files: resolvedFiles,
        activeFile: selectedFile?.path ?? null,
        activeFormat: selectedFormat,
        validation,
      }),
    [schema, resolvedFiles, selectedFile?.path, selectedFormat, validation],
  );
  const fileDiagnosticCounts = useMemo(
    () => getSchemaIdeFileDiagnosticCounts(reflection.diagnostics),
    [reflection.diagnostics],
  );

  const previewResolution = useMemo(
    () =>
      resolveSchemaIdePreview({
        previews: previews as unknown as readonly SchemaIdePreviewRegistration<unknown, string>[],
        reflection,
        file: selectedFile,
        selectedPreviewId,
      }),
    [previews, reflection, selectedFile, selectedPreviewId],
  );

  useEffect(() => {
    if (validation.value !== null) {
      if (!workspaceMode) {
        lastEmittedValueRef.current = stringifyDocument(validation.value, selectedFormat);
      }
      onChange?.(validation.value);
    }
  }, [onChange, selectedFormat, validation.value, workspaceMode]);

  const updateFiles = useCallback(
    (nextFiles: readonly SourceFile[], nextActiveFile?: string | null) => {
      filesRef.current = nextFiles;
      onFilesChange?.(nextFiles);
      let resolvedActiveFile = nextActiveFile ?? activeFileRef.current;
      if (!nextFiles.some((file) => file.path === resolvedActiveFile)) {
        resolvedActiveFile = nextFiles[0]?.path ?? null;
      }
      if (resolvedActiveFile !== activeFileRef.current) {
        activeFileRef.current = resolvedActiveFile;
        setActiveFile(resolvedActiveFile);
      }
    },
    [onFilesChange],
  );

  const commitWorkspaceChange = useCallback(
    (
      change: Parameters<typeof applyWorkspaceChange>[1],
      metadata: WorkspaceRevisionMetadata,
      nextActiveFile?: string | null,
    ) => {
      const nextWorkspace = applyWorkspaceChange(workspaceRef.current, change, metadata);
      workspaceRef.current = nextWorkspace;
      if (!files) setInternalWorkspace(nextWorkspace);
      onWorkspaceChange?.(nextWorkspace);
      updateFiles(nextWorkspace.files, nextActiveFile);
      return nextWorkspace;
    },
    [files, onWorkspaceChange, updateFiles],
  );

  useEffect(() => {
    if (workspaceMode || files || value === undefined) return;

    const nextContent = stringifyDocument(value, activeFormat);
    if (lastEmittedValueRef.current === nextContent) return;

    const extension = activeFormat === "yaml" ? "yaml" : "json";
    const path =
      resolvedFiles[0]?.path.replace(/\.(json|ya?ml)$/i, `.${extension}`) ??
      `document.${extension}`;
    commitWorkspaceChange(
      { type: "replaceFiles", files: [{ path, content: nextContent }] },
      { actor: "system", label: "Sync controlled value" },
      path,
    );
  }, [activeFormat, commitWorkspaceChange, files, resolvedFiles, value, workspaceMode]);

  const selectedCommittedFile = selectedFile
    ? (committedFiles.find((file) => file.path === selectedFile.path) ?? null)
    : null;
  const selectedIsDirty = Boolean(
    selectedFile && selectedCommittedFile && selectedFile.content !== selectedCommittedFile.content,
  );

  const commitDrafts = useCallback(
    (
      metadata: WorkspaceRevisionMetadata,
      onlyPath?: string | null,
      nextActiveFile = activeFileRef.current,
    ) => {
      const draftEntries = Object.entries(draftsRef.current).filter(
        ([path, content]) =>
          (!onlyPath || path === onlyPath) &&
          committedFilesRef.current.some((file) => file.path === path && file.content !== content),
      );
      if (!draftEntries.length) return workspaceRef.current;

      let nextWorkspace = workspaceRef.current;
      for (const [path, content] of draftEntries) {
        nextWorkspace = applyWorkspaceChange(
          nextWorkspace,
          { type: "writeFile", path, content },
          draftEntries.length === 1
            ? metadata
            : {
                ...metadata,
                label: `${metadata.label}: ${path}`,
              },
        );
      }
      workspaceRef.current = nextWorkspace;
      if (!files) setInternalWorkspace(nextWorkspace);
      onWorkspaceChange?.(nextWorkspace);
      setDrafts((current) => {
        const next = { ...current };
        for (const [path] of draftEntries) delete next[path];
        draftsRef.current = next;
        return next;
      });
      updateFiles(nextWorkspace.files, nextActiveFile);
      return nextWorkspace;
    },
    [files, onWorkspaceChange, updateFiles],
  );

  const updateActiveFile = useCallback(
    (content: string) => {
      if (!selectedFile || readOnly) return;
      const path = selectedFile.path;
      setDrafts((current) => {
        const next = { ...current, [path]: content };
        draftsRef.current = next;
        return next;
      });
    },
    [readOnly, selectedFile],
  );

  const saveActiveFile = useCallback(() => {
    if (!selectedFile || readOnly) return;
    commitDrafts({ actor: "user", label: `Save ${selectedFile.path}` }, selectedFile.path);
  }, [commitDrafts, readOnly, selectedFile]);

  const discardActiveDraft = useCallback(() => {
    if (!selectedFile || readOnly) return;
    const path = selectedFile.path;
    setDrafts((current) => {
      const next = { ...current };
      delete next[path];
      draftsRef.current = next;
      return next;
    });
  }, [readOnly, selectedFile]);

  const addFile = useCallback(() => {
    if (readOnly) return;
    const extension = activeFormat === "yaml" ? "yaml" : "json";
    let index = resolvedFiles.length + 1;
    let path = `new-file-${index}.${extension}`;
    while (resolvedFiles.some((file) => file.path === path)) {
      index += 1;
      path = `new-file-${index}.${extension}`;
    }
    commitWorkspaceChange(
      {
        type: "createFile",
        path,
        content: activeFormat === "yaml" ? "{}\n" : "{}\n",
      },
      { actor: "user", label: `Create ${path}` },
      path,
    );
  }, [activeFormat, commitWorkspaceChange, readOnly, resolvedFiles]);

  const deleteActiveFile = useCallback(() => {
    if (!selectedFile || readOnly) return;
    commitWorkspaceChange(
      { type: "deleteFile", path: selectedFile.path },
      { actor: "user", label: `Delete ${selectedFile.path}` },
      null,
    );
    setDrafts((current) => {
      const next = { ...current };
      delete next[selectedFile.path];
      draftsRef.current = next;
      return next;
    });
  }, [commitWorkspaceChange, readOnly, selectedFile]);

  const undoWorkspace = useCallback(() => {
    if (readOnly) return;
    const nextWorkspace = undoWorkspaceChange(workspaceRef.current);
    workspaceRef.current = nextWorkspace;
    if (!files) setInternalWorkspace(nextWorkspace);
    onWorkspaceChange?.(nextWorkspace);
    setDrafts({});
    draftsRef.current = {};
    updateFiles(nextWorkspace.files);
  }, [files, onWorkspaceChange, readOnly, updateFiles]);

  const redoWorkspace = useCallback(() => {
    if (readOnly) return;
    const nextWorkspace = redoWorkspaceChange(workspaceRef.current);
    workspaceRef.current = nextWorkspace;
    if (!files) setInternalWorkspace(nextWorkspace);
    onWorkspaceChange?.(nextWorkspace);
    setDrafts({});
    draftsRef.current = {};
    updateFiles(nextWorkspace.files);
  }, [files, onWorkspaceChange, readOnly, updateFiles]);

  const reflectFiles = useCallback(
    (nextFiles: readonly SourceFile[], nextActiveFile = activeFileRef.current) => {
      const nextSelectedFile = nextActiveFile
        ? (nextFiles.find((file) => file.path === nextActiveFile) ?? null)
        : (nextFiles[0] ?? null);
      const nextFormat = nextSelectedFile
        ? workspaceMode
          ? codecForPath(nextSelectedFile.path, activeFormat).format
          : activeFormat
        : activeFormat;
      const nextValidation = validateSchemaIdeValue({
        schema,
        files: nextFiles,
        activeFile: nextSelectedFile?.path ?? null,
        activeFormat: nextFormat,
      });

      return createReflection({
        schema,
        files: nextFiles,
        activeFile: nextSelectedFile?.path ?? null,
        activeFormat: nextFormat,
        validation: nextValidation,
      });
    },
    [activeFormat, schema, workspaceMode],
  );

  const checkpointDraftsForAgentTurn = useCallback(
    (turnId: string) => {
      const nextWorkspace = commitDrafts(
        {
          actor: "user",
          label: "Save pending edits before agent turn",
          turnId,
        },
        null,
      );
      return reflectFiles(nextWorkspace.files);
    },
    [commitDrafts, reflectFiles],
  );

  const getToolRevisionMetadata = useCallback(
    (toolName: string, target: string): WorkspaceRevisionMetadata => {
      const toolContext = activeToolContextRef.current;
      return {
        actor: "agent",
        label: `${toolName} ${target}`,
        ...(toolContext ? { turnId: toolContext.turnId, toolCallId: toolContext.toolCallId } : {}),
      };
    },
    [],
  );

  const previewFileEdits = useCallback(
    (edits: readonly SchemaIdeFileEdit[]): readonly SourceFile[] => {
      const byPath = new Map(filesRef.current.map((file) => [file.path, file.content]));
      for (const edit of edits) {
        if (edit.create && byPath.has(edit.path)) {
          throw new Error(`File already exists: ${edit.path}`);
        }
        byPath.set(edit.path, edit.content);
      }
      return [...byPath.entries()]
        .map(([path, content]) => ({ path, content }))
        .sort((left, right) => left.path.localeCompare(right.path));
    },
    [],
  );

  const applyFileEdits = useCallback(
    (
      edits: readonly SchemaIdeFileEdit[],
      options: { readonly validate?: boolean | undefined } = {},
    ) => {
      if (readOnly) throw new Error("Workspace is read-only.");
      if (!edits.length) {
        return {
          changedPaths: [],
          validation: reflectFiles(filesRef.current).validationSummary,
        };
      }

      const nextFiles = previewFileEdits(edits);
      const nextReflection = reflectFiles(nextFiles, edits[0]?.path ?? activeFileRef.current);
      if (options.validate !== false && !nextReflection.validationSummary.valid) {
        const firstError = nextReflection.diagnostics.find(
          (diagnostic) => diagnostic.severity === "error",
        );
        throw new Error(firstError?.message ?? "Proposed edits did not validate.");
      }

      const changedPaths = edits.map((edit) => edit.path);
      commitWorkspaceChange(
        { type: "replaceFiles", files: nextFiles },
        getToolRevisionMetadata("apply_edits", changedPaths.join(", ")),
        edits[0]?.path ?? activeFileRef.current,
      );

      return {
        changedPaths,
        validation: nextReflection.validationSummary,
      };
    },
    [commitWorkspaceChange, getToolRevisionMetadata, previewFileEdits, readOnly, reflectFiles],
  );

  const proposeFilePatch = useCallback(
    (label: string, edits: readonly SchemaIdeFileEdit[]): SchemaIdePatchProposal => {
      const nextFiles = previewFileEdits(edits);
      const nextReflection = reflectFiles(nextFiles, edits[0]?.path ?? activeFileRef.current);
      const proposal: SchemaIdePatchProposal = {
        id: `proposal-${++proposalSequenceRef.current}`,
        label,
        edits,
        files: nextFiles,
        validation: nextReflection.validationSummary,
        diagnostics: nextReflection.diagnostics,
      };
      setPendingProposal(proposal);
      return proposal;
    },
    [previewFileEdits, reflectFiles],
  );

  const applyProposal = useCallback(
    (proposal: SchemaIdePatchProposal) => {
      if (readOnly) return;
      commitWorkspaceChange(
        { type: "replaceFiles", files: proposal.files },
        { actor: "user", label: `Apply proposal: ${proposal.label}` },
        proposal.edits[0]?.path ?? activeFileRef.current,
      );
      setPendingProposal(null);
    },
    [commitWorkspaceChange, readOnly],
  );

  const toolRuntime = useMemo<SchemaIdeHostRuntime>(
    () => ({
      readFile: (path) => filesRef.current.find((file) => file.path === path) ?? null,
      listFiles: () => filesRef.current.map((file) => file.path),
      searchFiles: (query) =>
        filesRef.current.flatMap((file) =>
          file.content
            .split(/\r?\n/)
            .map((line, index) => ({ path: file.path, line: index + 1, content: line }))
            .filter((line) => line.content.includes(query)),
        ),
      writeFile: (file) => {
        if (readOnly) throw new Error("Workspace is read-only.");
        const metadata = getToolRevisionMetadata("write_file", file.path);
        commitWorkspaceChange({ type: "writeFile", ...file }, metadata, file.path);
      },
      createFile: (file) => {
        if (readOnly) throw new Error("Workspace is read-only.");
        const metadata = getToolRevisionMetadata("create_file", file.path);
        commitWorkspaceChange({ type: "createFile", ...file }, metadata, file.path);
      },
      deleteFile: (path) => {
        if (readOnly) throw new Error("Workspace is read-only.");
        commitWorkspaceChange(
          { type: "deleteFile", path },
          getToolRevisionMetadata("delete_file", path),
          activeFileRef.current === path ? null : activeFileRef.current,
        );
      },
      renameFile: (fromPath, toPath) => {
        if (readOnly) throw new Error("Workspace is read-only.");
        commitWorkspaceChange(
          { type: "renameFile", fromPath, toPath },
          getToolRevisionMetadata("rename_file", `${fromPath} -> ${toPath}`),
          activeFileRef.current === fromPath ? toPath : activeFileRef.current,
        );
      },
      applyEdits: applyFileEdits,
      proposePatch: proposeFilePatch,
      validateWorkspace: () => reflectFiles(filesRef.current),
      getSchema: () => reflectFiles(filesRef.current).schemas,
      getJsonSchema: (schemaId = null) =>
        schemaId
          ? (reflectFiles(filesRef.current).schemas.find((schema) => schema.id === schemaId)
              ?.jsonSchema ?? null)
          : reflectFiles(filesRef.current).activeJsonSchema,
      getDiagnostics: () => reflectFiles(filesRef.current).diagnostics,
    }),
    [applyFileEdits, commitWorkspaceChange, proposeFilePatch, readOnly, reflectFiles],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <div className="flex items-center gap-2 font-medium">
          <FileCode2 className="size-4" />
          {title}
        </div>
        <Badge variant={reflection.validationSummary.valid ? "secondary" : "destructive"}>
          {reflection.validationSummary.valid
            ? "Valid"
            : `${reflection.validationSummary.errorCount} errors`}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          {!workspaceMode ? (
            <FormatSelect
              value={activeFormat}
              allowedFormats={allowedFormats}
              onChange={setActiveFormat}
              disabled={readOnly}
            />
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 shrink-0" style={{ width: 360 }}>
          <SchemaChatPanel
            chat={chat}
            reflection={reflection}
            tools={toolRuntime}
            readOnly={readOnly}
            onTurnStart={checkpointDraftsForAgentTurn}
            onToolCallTrace={(turnId, toolCall) => {
              if (toolCall.status === "pending") {
                activeToolContextRef.current = {
                  turnId,
                  toolCallId: toolCall.id,
                };
              } else if (activeToolContextRef.current?.toolCallId === toolCall.id) {
                activeToolContextRef.current = null;
              }
            }}
          />
        </div>

        <div className="flex min-w-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 shrink-0 flex-col border-r" style={{ width: 240 }}>
            <div className="flex h-10 items-center gap-2 border-b px-3 text-sm font-medium">
              <FolderTree className="size-4" />
              Files
              <Button
                size="icon-xs"
                variant="ghost"
                className="ml-auto"
                onClick={addFile}
                disabled={readOnly}
                title="Add file"
              >
                <FilePlus2 className="size-3.5" />
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-2">
                {resolvedFiles.map((file) => {
                  const counts = fileDiagnosticCounts.get(file.path);
                  const issueCount = counts ? counts.errors || counts.warnings || counts.infos : 0;
                  const issueLabel = counts?.errors
                    ? `${counts.errors} error${counts.errors === 1 ? "" : "s"}`
                    : counts?.warnings
                      ? `${counts.warnings} warning${counts.warnings === 1 ? "" : "s"}`
                      : counts?.infos
                        ? `${counts.infos} info`
                        : null;

                  return (
                    <button
                      key={file.path}
                      className={`mb-1 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
                        selectedFile?.path === file.path
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted"
                      }`}
                      onClick={() => setActiveFile(file.path)}
                    >
                      <span className="min-w-0 flex-1 truncate">{file.path}</span>
                      {issueCount ? (
                        <Badge
                          variant={counts?.errors ? "destructive" : "secondary"}
                          className="h-4 min-w-4 px-1.5 text-[10px]"
                          title={issueLabel ?? undefined}
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
              <Badge variant="outline" className="ml-auto">
                {selectedFileKindLabel}
              </Badge>
              {!selectedIsPdf ? (
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
              ) : null}
              {!selectedIsPdf && previewResolution && previewResolution.previews.length > 1 ? (
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
              {selectedIsDirty ? (
                <Badge variant="secondary" className="text-[10px]">
                  Unsaved
                </Badge>
              ) : null}
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={saveActiveFile}
                disabled={readOnly || !selectedFile || !selectedIsDirty}
                title="Save file"
              >
                <Save className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={discardActiveDraft}
                disabled={readOnly || !selectedFile || !selectedIsDirty}
                title="Discard unsaved edits"
              >
                Discard
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={undoWorkspace}
                disabled={readOnly || !canUndoWorkspaceChange(workspace)}
                title="Undo workspace change"
              >
                <Undo2 className="size-3.5" />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={redoWorkspace}
                disabled={readOnly || !canRedoWorkspaceChange(workspace)}
                title="Redo workspace change"
              >
                <Redo2 className="size-3.5" />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={deleteActiveFile}
                disabled={readOnly || !selectedFile}
                title="Delete file"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>

            {selectedFile && selectedIsPdf ? (
              <PdfFileViewer file={selectedFile} />
            ) : editorMode === "preview" && selectedFile ? (
              <SchemaIdePreviewView
                file={selectedFile}
                files={resolvedFiles}
                format={selectedFormat}
                reflection={reflection}
                resolution={previewResolution}
                previews={
                  previews as unknown as readonly SchemaIdePreviewRegistration<unknown, string>[]
                }
                readOnly={readOnly}
                onChange={updateActiveFile}
              />
            ) : (
              <SchemaCodeMirrorEditor
                value={selectedFile?.content ?? ""}
                path={selectedFile?.path ?? null}
                format={selectedFormat}
                reflection={reflection}
                readOnly={readOnly || !selectedFile}
                onChange={updateActiveFile}
                onSave={saveActiveFile}
              />
            )}

            {pendingProposal ? (
              <PatchProposalPanel
                proposal={pendingProposal}
                currentFiles={committedFiles}
                onApply={() => applyProposal(pendingProposal)}
                onReject={() => setPendingProposal(null)}
                disabled={readOnly}
              />
            ) : null}

            {showDebug ? (
              <SchemaDebugPanel
                tab={debugTab}
                onTabChange={setDebugTab}
                reflection={reflection}
                workspace={workspace}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function PdfFileViewer({ file }: { readonly file: SourceFile }) {
  const dataUrl = useMemo(() => pdfContentToDataUrl(file.content), [file.content]);

  if (!dataUrl) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/20 p-6">
        <div className="max-w-sm rounded-md border bg-background p-4 text-sm text-muted-foreground">
          Unable to display PDF content.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 bg-muted/20">
      <iframe title={file.path} src={dataUrl} className="h-full w-full border-0 bg-background" />
    </div>
  );
}

function isPdfPath(path: string | null | undefined): boolean {
  return path?.toLowerCase().endsWith(".pdf") ?? false;
}

function pdfContentToDataUrl(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  if (/^data:application\/pdf[^,]*;base64,/i.test(trimmed)) return trimmed;

  if (trimmed.startsWith("%PDF")) {
    if (typeof globalThis.btoa !== "function") return null;
    return `data:application/pdf;base64,${globalThis.btoa(trimmed)}`;
  }

  return `data:application/pdf;base64,${trimmed.replace(/\s+/g, "")}`;
}

function FormatSelect({
  value,
  allowedFormats,
  onChange,
  disabled,
}: {
  readonly value: SchemaIdeDocumentFormat;
  readonly allowedFormats: readonly SchemaIdeDocumentFormat[];
  readonly onChange: (format: SchemaIdeDocumentFormat) => void;
  readonly disabled: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as SchemaIdeDocumentFormat)}
      className="h-8 rounded-md border bg-background px-2 text-xs"
      aria-label="Document format"
    >
      {allowedFormats.map((format) => (
        <option key={format} value={format}>
          {format.toUpperCase()}
        </option>
      ))}
    </select>
  );
}

function PatchProposalPanel({
  proposal,
  currentFiles,
  onApply,
  onReject,
  disabled,
}: {
  readonly proposal: SchemaIdePatchProposal;
  readonly currentFiles: readonly SourceFile[];
  readonly onApply: () => void;
  readonly onReject: () => void;
  readonly disabled: boolean;
}) {
  return (
    <div className="shrink-0 border-t bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant={proposal.validation.valid ? "secondary" : "destructive"}>
          {proposal.validation.valid ? "Valid proposal" : "Invalid proposal"}
        </Badge>
        <span className="truncate text-sm font-medium">{proposal.label}</span>
        <Button
          size="sm"
          className="ml-auto h-7 px-2 text-xs"
          disabled={disabled}
          onClick={onApply}
        >
          Apply
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onReject}>
          Reject
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {proposal.edits.map((edit) => (
          <Badge key={edit.path} variant="outline" className="text-[10px]">
            {edit.path}
          </Badge>
        ))}
      </div>
      <ScrollArea className="mt-2 max-h-40 rounded border bg-background">
        <pre className="whitespace-pre-wrap p-2 text-[11px] leading-relaxed">
          {proposal.edits
            .map((edit) =>
              formatFileDiff(
                edit.path,
                currentFiles.find((file) => file.path === edit.path)?.content ?? "",
                edit.content,
              ),
            )
            .join("\n")}
        </pre>
      </ScrollArea>
    </div>
  );
}

function SchemaDebugPanel({
  tab,
  onTabChange,
  reflection,
  workspace,
}: {
  readonly tab: "diagnostics" | "schema" | "value" | "routes" | "history" | "context";
  readonly onTabChange: (
    tab: "diagnostics" | "schema" | "value" | "routes" | "history" | "context",
  ) => void;
  readonly reflection: ReturnType<typeof createReflection>;
  readonly workspace: VersionedWorkspaceState;
}) {
  const tabs = [
    ["diagnostics", "Diagnostics"],
    ["schema", "JSON Schema"],
    ["value", "Decoded"],
    ["routes", "Routes"],
    ["history", "History"],
    ["context", "Agent Context"],
  ] as const;

  const content =
    tab === "diagnostics"
      ? reflection.diagnostics
      : tab === "schema"
        ? reflection.activeJsonSchema
        : tab === "value"
          ? reflection.decodedValue
          : tab === "routes"
            ? reflection.routeMatches
            : tab === "history"
              ? {
                  cursor: workspace.cursor,
                  canUndo: canUndoWorkspaceChange(workspace),
                  canRedo: canRedoWorkspaceChange(workspace),
                  revisions: workspace.revisions.map((revision, index) => ({
                    id: revision.id,
                    current: index === workspace.cursor,
                    actor: revision.actor,
                    label: revision.label,
                    turnId: revision.turnId,
                    toolCallId: revision.toolCallId,
                    paths: getWorkspacePatchPaths(revision.patch),
                  })),
                }
              : reflection;

  return (
    <div className="h-56 shrink-0 border-t">
      <div className="flex h-9 items-center gap-1 border-b px-2">
        <Bug className="mr-1 size-4 text-muted-foreground" />
        {tabs.map(([id, label]) => (
          <Button
            key={id}
            size="sm"
            variant={tab === id ? "secondary" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => onTabChange(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      <ScrollArea className="h-[calc(100%-2.25rem)]">
        <pre className="whitespace-pre-wrap p-3 text-xs">{JSON.stringify(content, null, 2)}</pre>
      </ScrollArea>
    </div>
  );
}

function SchemaChatPanel({
  chat,
  reflection,
  tools,
  readOnly,
  onTurnStart,
  onToolCallTrace,
}: {
  readonly chat: SchemaIdeChatAdapter;
  readonly reflection: ReturnType<typeof createReflection>;
  readonly tools: SchemaIdeHostRuntime;
  readonly readOnly: boolean;
  readonly onTurnStart?: ((turnId: string) => ReturnType<typeof createReflection>) | undefined;
  readonly onToolCallTrace?: ((turnId: string, toolCall: SchemaIdeToolCall) => void) | undefined;
}) {
  type ChatTimelineItem =
    | { readonly id: string; readonly type: "message"; readonly message: SchemaIdeChatMessage }
    | { readonly id: string; readonly type: "tool"; readonly toolCall: SchemaIdeToolCall };

  const [history, setHistory] = useState<readonly SchemaIdeChatMessage[]>([]);
  const [timeline, setTimeline] = useState<readonly ChatTimelineItem[]>([]);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(chat.defaultModel ?? chat.models?.[0]?.id ?? "");
  const [planMode, setPlanMode] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<{ cancel: () => void } | null>(null);

  const send = useCallback(() => {
    const message = draft.trim();
    if (!message || pending) return;

    setDraft("");
    setError(null);
    setPending(true);
    const turnId = `turn-${Date.now()}`;
    const turnReflection = onTurnStart?.(turnId) ?? reflection;
    const userMessage: SchemaIdeChatMessage = { role: "user", content: message };
    const nextHistory = [...history, userMessage];
    setHistory(nextHistory);
    setTimeline((current) => [
      ...current,
      { id: `${turnId}-user`, type: "message", message: userMessage },
    ]);

    const handle = chat.send({
      message,
      history,
      reflection: turnReflection,
      tools,
      model,
      planMode,
      onToolCall: (toolCall) => {
        onToolCallTrace?.(turnId, toolCall);
        const itemId = `${turnId}-tool-${toolCall.id}`;
        setTimeline((current) => {
          const existingIndex = current.findIndex((item) => item.id === itemId);
          if (existingIndex === -1) {
            return [...current, { id: itemId, type: "tool", toolCall }];
          }
          return current.map((item, index) =>
            index === existingIndex ? { ...item, toolCall } : item,
          );
        });
      },
    });
    handleRef.current = handle;
    handle.promise
      .then((result) => {
        setHistory([...nextHistory, result.message]);
        setTimeline((current) => [
          ...current,
          { id: `${turnId}-assistant`, type: "message", message: result.message },
        ]);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setPending(false);
        handleRef.current = null;
      });
  }, [
    chat,
    draft,
    history,
    model,
    onToolCallTrace,
    onTurnStart,
    pending,
    planMode,
    reflection,
    tools,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col border-r bg-muted/20">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <Bot className="size-4" />
        <span className="text-sm font-medium">Chat</span>
        {chat.models ? (
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={pending}
            className="ml-auto h-7 max-w-36 rounded border bg-background px-2 text-xs"
            aria-label="Chat model"
          >
            {chat.models.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
            <div className="mb-1 flex items-center gap-1 font-medium text-foreground">
              {reflection.validationSummary.valid ? (
                <CheckCircle2 className="size-3.5 text-green-600" />
              ) : (
                <AlertTriangle className="size-3.5 text-destructive" />
              )}
              Workspace
            </div>
            {reflection.validationSummary.valid
              ? "Current files decode successfully."
              : `${reflection.validationSummary.errorCount} validation error(s).`}
          </div>
          {timeline.map((item) =>
            item.type === "message" ? (
              <ChatMessageCard key={item.id} message={item.message} />
            ) : (
              <ToolCallCard key={item.id} toolCall={item.toolCall} />
            ),
          )}
          {pending ? (
            <div className="flex items-center gap-2 rounded-md border bg-background p-3 text-xs text-muted-foreground">
              <RefreshCw className="size-3.5 animate-spin" />
              Waiting for assistant...
            </div>
          ) : null}
          {error ? (
            <div className="rounded-md border border-destructive/40 p-3 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </div>
      </ScrollArea>
      <div className="shrink-0 border-t bg-background p-3">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") send();
          }}
          disabled={pending || readOnly}
          placeholder="Ask about the schema, validation errors, or desired edits..."
          className="mb-2 min-h-20 resize-none text-sm"
        />
        <div className="flex justify-end gap-2">
          <label className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={planMode}
              disabled={pending}
              onChange={(event) => setPlanMode(event.target.checked)}
            />
            Plan
          </label>
          {pending ? (
            <Button variant="outline" size="sm" onClick={() => handleRef.current?.cancel()}>
              Cancel
            </Button>
          ) : null}
          <Button size="sm" onClick={send} disabled={pending || !draft.trim() || readOnly}>
            <Send className="mr-1 size-3.5" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function ChatMessageCard({ message }: { readonly message: SchemaIdeChatMessage }) {
  return (
    <div
      className={`rounded-md border p-3 text-sm ${
        message.role === "user" ? "bg-primary text-primary-foreground" : "bg-background"
      }`}
    >
      <div className="mb-1 text-[10px] uppercase opacity-70">{message.role}</div>
      <div className="whitespace-pre-wrap">{message.content}</div>
    </div>
  );
}

function ToolCallCard({ toolCall }: { readonly toolCall: SchemaIdeToolCall }) {
  const status = getToolStatus(toolCall.status);
  const hasResult = "result" in toolCall;

  return (
    <details
      open={toolCall.status !== "success"}
      className="group overflow-hidden rounded-md border bg-background text-xs shadow-sm"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span
          className={`flex size-5 shrink-0 items-center justify-center rounded-full ${status.iconClass}`}
        >
          <status.Icon className={`size-3.5 ${status.spin ? "animate-spin" : ""}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-[11px] font-medium">{toolCall.name}</span>
            <Badge variant={status.variant} className="text-[10px]">
              {status.label}
            </Badge>
          </div>
          <div className="truncate text-[10px] text-muted-foreground">Tool call {toolCall.id}</div>
        </div>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t bg-muted/20 p-3">
        <ToolJsonBlock label="Parameters" value={toolCall.args} />
        {hasResult ? (
          <ToolJsonBlock
            label={toolCall.status === "error" ? "Error" : "Result"}
            value={toolCall.result}
            tone={toolCall.status === "error" ? "error" : "default"}
          />
        ) : (
          <div className="rounded-md border border-dashed bg-background/70 p-3 text-muted-foreground">
            Waiting for tool output...
          </div>
        )}
      </div>
    </details>
  );
}

function ToolJsonBlock({
  label,
  value,
  tone = "default",
}: {
  readonly label: string;
  readonly value: unknown;
  readonly tone?: "default" | "error";
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
      <pre
        className={`max-h-48 overflow-auto rounded-md border p-2 font-mono text-[11px] leading-relaxed ${
          tone === "error"
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : "bg-background"
        }`}
      >
        {formatToolValue(value)}
      </pre>
    </div>
  );
}

function getToolStatus(status: SchemaIdeToolCall["status"]) {
  if (status === "pending") {
    return {
      label: "Running",
      variant: "secondary" as const,
      Icon: RefreshCw,
      iconClass: "bg-muted text-muted-foreground",
      spin: true,
    };
  }
  if (status === "error") {
    return {
      label: "Error",
      variant: "destructive" as const,
      Icon: AlertTriangle,
      iconClass: "bg-destructive/10 text-destructive",
      spin: false,
    };
  }
  return {
    label: "Completed",
    variant: "secondary" as const,
    Icon: Check,
    iconClass: "bg-primary/10 text-primary",
    spin: false,
  };
}

function formatToolValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function filesFromInitialState<A>({
  workspaceMode,
  initialFiles,
  initialValue,
  value,
  defaultFormat,
}: {
  readonly workspaceMode: boolean;
  readonly initialFiles?: readonly SourceFile[] | undefined;
  readonly initialValue?: A | undefined;
  readonly value?: A | undefined;
  readonly defaultFormat: SchemaIdeDocumentFormat;
}): readonly SourceFile[] {
  if (initialFiles?.length) return initialFiles;
  if (workspaceMode) return [];
  return [
    {
      path: `document.${defaultFormat === "yaml" ? "yaml" : "json"}`,
      content: stringifyDocument(value ?? initialValue ?? {}, defaultFormat),
    },
  ];
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

function formatFileDiff(path: string, before: string, after: string): string {
  if (before === after) return `${path}\n  unchanged`;
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const max = Math.max(beforeLines.length, afterLines.length);
  const lines = [`${path}`];

  for (let index = 0; index < max; index += 1) {
    const left = beforeLines[index];
    const right = afterLines[index];
    if (left === right) {
      if (left !== undefined && left !== "") lines.push(`  ${left}`);
      continue;
    }
    if (left !== undefined) lines.push(`- ${left}`);
    if (right !== undefined) lines.push(`+ ${right}`);
  }

  return lines.join("\n");
}

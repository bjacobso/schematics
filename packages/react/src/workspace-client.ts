import {
  applyWorkspaceChange,
  createReflection,
  createVersionedWorkspace,
  type SchemaIdeDocumentFormat,
  type SchemaIdeInputSchema,
  type SourceFile,
  type VersionedWorkspaceState,
  type WorkspaceRouteMap,
} from "@schema-ide/core";
import {
  type SchemaIdeWorkspaceClient,
  type WorkspaceCapabilities,
  type WorkspaceChangeRequest,
  type WorkspaceChangeResponse,
  type WorkspaceEvent,
  type WorkspacePreviewRequest,
  type WorkspacePreviewResponse,
  type WorkspaceSnapshot,
} from "@schema-ide/protocol";
import { codecForPath, stringifyDocument, validateSchemaIdeValue } from "@schema-ide/core";

export interface CreateMemoryWorkspaceClientOptions<
  A = unknown,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
> {
  readonly schema: SchemaIdeInputSchema<A, Routes>;
  readonly defaultFormat?: SchemaIdeDocumentFormat | undefined;
  readonly initialFiles?: readonly SourceFile[] | undefined;
  readonly initialValue?: A | undefined;
  readonly value?: A | undefined;
  readonly readOnly?: boolean | undefined;
  readonly title?: string | undefined;
  readonly agentEnabled?: boolean | undefined;
}

export function createMemoryWorkspaceClient<
  A,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
>({
  schema,
  defaultFormat = "json",
  initialFiles,
  initialValue,
  value,
  readOnly = false,
  title,
  agentEnabled = true,
}: CreateMemoryWorkspaceClientOptions<A, Routes>): SchemaIdeWorkspaceClient {
  let workspace = createVersionedWorkspace(
    initialFiles?.length
      ? initialFiles
      : [
          {
            path: `document.${defaultFormat === "yaml" ? "yaml" : "json"}`,
            content: stringifyDocument(value ?? initialValue ?? {}, defaultFormat),
          },
        ],
  );
  let revision = 0;
  const subscribers = new Set<(event: WorkspaceEvent) => void>();
  const capabilities: WorkspaceCapabilities = {
    mode: "memory",
    workspace: { title, readOnly },
    agent: {
      enabled: agentEnabled,
      ...(agentEnabled ? {} : { reason: "Agent is disabled for this workspace." }),
    },
    features: {
      watch: true,
      write: !readOnly,
      rename: !readOnly,
      delete: !readOnly,
      history: true,
      previews: true,
    },
  };

  const snapshot = (): WorkspaceSnapshot => makeMemorySnapshot({
    schema,
    workspace,
    revision,
    defaultFormat,
  });
  const previewFiles = (request: WorkspacePreviewRequest): WorkspacePreviewResponse => ({
    reflection: makeMemorySnapshot({
      schema,
      workspace: createVersionedWorkspace(request.files),
      revision,
      defaultFormat,
      activeFile: request.activeFile,
    }).reflection,
  });
  const publish = () => {
    const event: WorkspaceEvent = { type: "snapshot", snapshot: snapshot() };
    for (const subscriber of subscribers) subscriber(event);
  };

  return {
    getCapabilities: async () => capabilities,
    getSnapshot: async () => snapshot(),
    watchWorkspace: (onEvent) => {
      subscribers.add(onEvent);
      onEvent({ type: "capabilities", capabilities });
      onEvent({ type: "snapshot", snapshot: snapshot() });
      return {
        unsubscribe: () => {
          subscribers.delete(onEvent);
        },
      };
    },
    applyChange: async (change) => {
      if (readOnly) throw new Error("Workspace is read-only.");
      const before = workspace.files;
      workspace = applyWorkspaceChange(workspace, change, {
        actor: "user",
        label: workspaceChangeLabel(change),
      });
      revision += 1;
      publish();
      return {
        revision,
        changedPaths: changedPathsForChange(change, before),
        validationSummary: snapshot().reflection.validationSummary,
      };
    },
    previewFiles: async (request) => previewFiles(request),
  };
}

export function createHttpWorkspaceClient(baseUrl = ""): SchemaIdeWorkspaceClient {
  const workspaceBaseUrl = `${baseUrl.replace(/\/$/, "")}/v1/workspace`;

  return {
    getCapabilities: () => fetchJson<WorkspaceCapabilities>(`${workspaceBaseUrl}/capabilities`),
    getSnapshot: () => fetchJson<WorkspaceSnapshot>(`${workspaceBaseUrl}/snapshot`),
    watchWorkspace: (onEvent, onError) => {
      const eventSource = new EventSource(`${workspaceBaseUrl}/watch`);
      eventSource.addEventListener("message", (event) => {
        try {
          onEvent(JSON.parse(event.data) as WorkspaceEvent);
        } catch (error) {
          onError?.(error);
        }
      });
      eventSource.addEventListener("error", () => {
        onError?.(new Error("Workspace watch connection failed."));
      });
      return {
        unsubscribe: () => eventSource.close(),
      };
    },
    applyChange: (change) =>
      fetchJson<WorkspaceChangeResponse>(`${workspaceBaseUrl}/change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      }),
    previewFiles: (request) =>
      fetchJson<WorkspacePreviewResponse>(`${workspaceBaseUrl}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
  };
}

function makeMemorySnapshot<A, Routes extends WorkspaceRouteMap>({
  schema,
  workspace,
  revision,
  defaultFormat,
  activeFile: requestedActiveFile,
}: {
  readonly schema: SchemaIdeInputSchema<A, Routes>;
  readonly workspace: VersionedWorkspaceState;
  readonly revision: number;
  readonly defaultFormat: SchemaIdeDocumentFormat;
  readonly activeFile?: string | null | undefined;
}): WorkspaceSnapshot {
  const activeFile: string | null =
    requestedActiveFile && workspace.files.some((file) => file.path === requestedActiveFile)
      ? requestedActiveFile
      : (workspace.files[0]?.path ?? null);
  const activeFormat = activeFile ? codecForPath(activeFile, defaultFormat).format : defaultFormat;
  const validation = validateSchemaIdeValue({
    schema,
    files: workspace.files,
    activeFile,
    activeFormat,
  });
  return {
    revision,
    files: workspace.files,
    reflection: createReflection({
      schema,
      files: workspace.files,
      activeFile,
      activeFormat,
      validation,
    }),
  };
}

function workspaceChangeLabel(change: WorkspaceChangeRequest): string {
  switch (change.type) {
    case "writeFile":
      return `Write ${change.path}`;
    case "createFile":
      return `Create ${change.path}`;
    case "deleteFile":
      return `Delete ${change.path}`;
    case "renameFile":
      return `Rename ${change.fromPath}`;
    case "replaceFiles":
      return "Replace files";
  }
}

function changedPathsForChange(
  change: WorkspaceChangeRequest,
  before: readonly SourceFile[],
): readonly string[] {
  switch (change.type) {
    case "writeFile":
    case "createFile":
    case "deleteFile":
      return [change.path];
    case "renameFile":
      return [change.fromPath, change.toPath];
    case "replaceFiles": {
      const beforeByPath = new Map(before.map((file) => [file.path, file.content]));
      return change.files
        .filter((file) => beforeByPath.get(file.path) !== file.content)
        .map((file) => file.path);
    }
  }
}

async function fetchJson<A>(url: string, init?: RequestInit): Promise<A> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as A;
}

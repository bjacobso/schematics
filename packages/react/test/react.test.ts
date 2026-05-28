import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Fiber, Schema, Stream } from "effect";
import {
  createSchemaIdeWorkspaceStore,
  createSchemaIdeWorkspaceToolRuntime,
  diagnosticsForSchemaIdeFile,
  createMemoryWorkspaceBranchRepository,
  createMemoryWorkspaceBranchService,
  createMemoryWorkspaceClient,
  getSchemaIdeFileDiagnosticCounts,
  resolveSchemaIdePreview,
  SchemaIde,
  WorkspacePreview,
  type SchemaIdePreviewComponentProps,
  type SchemaIdePreviewRegistration,
  type SchemaIdePreviewRegistrationForRoutes,
} from "../src";
import { pdfContentToDataUrl } from "../src/SchemaIdePdfFileViewer";
import {
  Workspace,
  type SchemaIdeInputSchema,
  type SchemaIdeReflection,
  type WorkspaceRoutes,
} from "@schema-ide/core";
import { defineWorkspaceClientContract } from "../../protocol/test/workspace-client-contract";

describe("schema-ide-react", () => {
  it("exports the SchemaIde component", () => {
    expect(SchemaIde).toBeTypeOf("function");
  });

  it("resolves previews by active file schema id", () => {
    const previews = [
      makePreview("workflow-graph", "Workflows", "Workflow"),
      makePreview("action-card", "Actions", "Action"),
    ];

    const resolution = resolveSchemaIdePreview({
      previews,
      reflection: makeReflection(),
      file: { path: "workflows/onboarding.json", content: "{}" },
    });

    expect(resolution?.schemaId).toBe("Workflows");
    expect(resolution?.selected.id).toBe("workflow-graph");
    expect(resolution?.jsonSchema).toEqual({ type: "object", title: "Workflow" });
  });

  it("honors a selected preview when multiple previews match", () => {
    const previews = [
      makePreview("workflow-graph", "Workflows", "Workflow Graph"),
      makePreview("workflow-summary", "Workflows", "Workflow Summary"),
    ];

    const resolution = resolveSchemaIdePreview({
      previews,
      reflection: makeReflection(),
      file: { path: "workflows/onboarding.json", content: "{}" },
      selectedPreviewId: "workflow-summary",
    });

    expect(resolution?.previews.map((preview) => preview.id)).toEqual([
      "workflow-graph",
      "workflow-summary",
    ]);
    expect(resolution?.selected.id).toBe("workflow-summary");
  });

  it("does not resolve previews for unmatched files", () => {
    const resolution = resolveSchemaIdePreview({
      previews: [makePreview("workflow-graph", "Workflows", "Workflow")],
      reflection: makeReflection(),
      file: { path: "notes/readme.md", content: "# Notes" },
    });

    expect(resolution).toBeNull();
  });

  it("scopes diagnostics and counts to concrete files", () => {
    const diagnostics = [
      {
        path: "workflows/onboarding.json",
        severity: "error" as const,
        source: "cross-file" as const,
        message: "Unknown action",
      },
      {
        path: "actions/email.json",
        severity: "warning" as const,
        source: "workspace" as const,
        message: "Unused action",
      },
      {
        path: null,
        severity: "error" as const,
        source: "workspace" as const,
        message: "Global workspace error",
      },
    ];

    expect(diagnosticsForSchemaIdeFile(diagnostics, "workflows/onboarding.json")).toEqual([
      diagnostics[0],
    ]);
    expect(diagnosticsForSchemaIdeFile(diagnostics, "actions/email.json")).toEqual([
      diagnostics[1],
    ]);

    const counts = getSchemaIdeFileDiagnosticCounts(diagnostics);
    expect(counts.get("workflows/onboarding.json")).toEqual({
      errors: 1,
      warnings: 0,
      infos: 0,
    });
    expect(counts.get("actions/email.json")).toEqual({
      errors: 0,
      warnings: 1,
      infos: 0,
    });
    expect(counts.has("")).toBe(false);
  });

  it("normalizes PDF content to a browser data URL", () => {
    expect(pdfContentToDataUrl("JVBERi0xLjcKJSVFT0YK")).toBe(
      "data:application/pdf;base64,JVBERi0xLjcKJSVFT0YK",
    );
    expect(pdfContentToDataUrl("data:application/pdf;base64,JVBERi0xLjcK")).toBe(
      "data:application/pdf;base64,JVBERi0xLjcK",
    );
    expect(pdfContentToDataUrl("%PDF-1.7\n%%EOF\n")).toBe(
      "data:application/pdf;base64,JVBERi0xLjcKJSVFT0Y=",
    );
    expect(pdfContentToDataUrl("")).toBeNull();
  });

  it("types preview registrations from workspace route ids", () => {
    const WorkflowSchema = Schema.Struct({
      id: Schema.String,
      actionIds: Schema.Array(Schema.String),
    });
    type Workflow = typeof WorkflowSchema.Type;

    const WorkspaceSchema = Workspace.Struct({
      workflows: Workspace.files("workflows/*.json", WorkflowSchema).pipe(
        Workspace.values(),
        Workspace.annotations({ identifier: "Workflows" }),
      ),
    });
    type Routes = WorkspaceRoutes<typeof WorkspaceSchema>;

    const WorkflowPreview = (_props: SchemaIdePreviewComponentProps<Workflow, "Workflows">) => null;
    const previews = [
      {
        id: "workflow-preview",
        schemaId: "Workflows",
        label: "Workflow",
        component: WorkflowPreview,
      },
    ] satisfies readonly SchemaIdePreviewRegistrationForRoutes<Routes>[];
    const workspacePreviews = WorkspacePreview.make(WorkspaceSchema, [
      {
        id: "workspace-workflow-preview",
        schemaId: "Workflows",
        label: "Workspace Workflow",
        component: WorkflowPreview,
      },
    ]);

    expectTypeOf<Routes>().toEqualTypeOf<{ Workflows: Workflow }>();
    expectTypeOf(previews[0]!.component).parameter(0).toMatchTypeOf<{
      readonly value: Workflow | null;
      readonly schemaId: "Workflows";
      readonly onChange: (content: string) => void;
    }>();
    expectTypeOf(workspacePreviews[0]!.component).parameter(0).toMatchTypeOf<{
      readonly value: Workflow | null;
      readonly schemaId: "Workflows";
      readonly onChange: (content: string) => void;
    }>();
    expectTypeOf(WorkspaceSchema).toMatchTypeOf<SchemaIdeInputSchema<unknown, Routes>>();
  });

  it("memory workspace client exposes snapshots, writes, and watch events", async () => {
    const DocumentSchema = Schema.Struct({ id: Schema.String });
    const client = createMemoryWorkspaceClient({
      schema: DocumentSchema,
      initialFiles: [{ path: "document.json", content: '{"id":"initial"}\n' }],
    });
    const watchEvents: string[] = [];
    const fiber = Effect.runFork(
      client.watchWorkspace.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (event.type === "snapshot") {
              watchEvents.push(event.snapshot.files[0]?.content ?? "");
            }
          }),
        ),
      ),
    );

    try {
      const capabilities = await Effect.runPromise(client.getCapabilities);
      const initial = await Effect.runPromise(client.getSnapshot);
      const result = await Effect.runPromise(
        client.applyChange({
          type: "writeFile",
          path: "document.json",
          content: '{"id":"updated"}\n',
        }),
      );
      await Effect.runPromise(Effect.sleep("10 millis"));
      const updated = await Effect.runPromise(client.getSnapshot);

      expect(capabilities).toMatchObject({ mode: "memory", features: { write: true } });
      expect(initial.files[0]?.content).toContain("initial");
      expect(result.changedPaths).toEqual(["document.json"]);
      expect(updated.files[0]?.content).toContain("updated");
      expect(watchEvents.some((content) => content.includes("updated"))).toBe(true);
    } finally {
      await Effect.runPromise(Fiber.interrupt(fiber));
    }
  });

  it("memory branch repository edits draft branches independently and merges back to main", async () => {
    const DocumentSchema = Schema.Struct({ id: Schema.String });
    const repository = createMemoryWorkspaceBranchRepository({
      schema: DocumentSchema,
      initialFiles: [{ path: "document.json", content: '{"id":"main"}\n' }],
    });

    const createResponse = await Effect.runPromise(
      repository.createBranch({ name: "agent-draft", createdBy: "agent" }),
    );
    const draftId = createResponse.branch.id;
    const draftClient = repository.getWorkspaceClient(draftId);

    await Effect.runPromise(
      draftClient.applyChange({
        type: "writeFile",
        path: "document.json",
        content: '{"id":"draft"}\n',
      }),
    );

    const mainSnapshot = await Effect.runPromise(repository.getWorkspaceClient().getSnapshot);
    const draftSnapshot = await Effect.runPromise(draftClient.getSnapshot);
    const comparison = await Effect.runPromise(
      repository.compareBranch({ sourceBranchId: draftId }),
    );
    const merge = await Effect.runPromise(repository.mergeBranch({ sourceBranchId: draftId }));
    const mergedMain = await Effect.runPromise(repository.getWorkspaceClient().getSnapshot);

    expect(mainSnapshot.files).toEqual([{ path: "document.json", content: '{"id":"main"}\n' }]);
    expect(draftSnapshot.files).toEqual([{ path: "document.json", content: '{"id":"draft"}\n' }]);
    expect(comparison).toMatchObject({
      sourceBranchId: draftId,
      targetBranchId: "main",
      mergeable: true,
      files: [
        {
          type: "modified",
          path: "document.json",
        },
      ],
    });
    expect(merge.status).toBe("merged");
    expect(mergedMain.files).toEqual([{ path: "document.json", content: '{"id":"draft"}\n' }]);
  });

  it("memory branch repository reports conflicts without overwriting main", async () => {
    const DocumentSchema = Schema.Struct({ id: Schema.String });
    const repository = createMemoryWorkspaceBranchRepository({
      schema: DocumentSchema,
      initialFiles: [{ path: "document.json", content: '{"id":"base"}\n' }],
    });
    const draft = await Effect.runPromise(repository.createBranch({ name: "draft" }));

    await Effect.runPromise(
      repository.getWorkspaceClient().applyChange({
        type: "writeFile",
        path: "document.json",
        content: '{"id":"main"}\n',
      }),
    );
    await Effect.runPromise(
      repository.getWorkspaceClient(draft.branch.id).applyChange({
        type: "writeFile",
        path: "document.json",
        content: '{"id":"draft"}\n',
      }),
    );

    const merge = await Effect.runPromise(
      repository.mergeBranch({ sourceBranchId: draft.branch.id }),
    );
    const mainSnapshot = await Effect.runPromise(repository.getWorkspaceClient().getSnapshot);

    expect(merge.status).toBe("conflicts");
    if (merge.status === "conflicts") {
      expect(merge.conflicts).toEqual([
        {
          type: "content",
          path: "document.json",
          base: { path: "document.json", content: '{"id":"base"}\n' },
          source: { path: "document.json", content: '{"id":"draft"}\n' },
          target: { path: "document.json", content: '{"id":"main"}\n' },
        },
      ]);
    }
    expect(mainSnapshot.files).toEqual([{ path: "document.json", content: '{"id":"main"}\n' }]);

    const forcedMerge = await Effect.runPromise(
      repository.mergeBranch({ sourceBranchId: draft.branch.id, strategy: "source-wins" }),
    );
    const forcedMainSnapshot = await Effect.runPromise(repository.getWorkspaceClient().getSnapshot);

    expect(forcedMerge.status).toBe("merged");
    expect(forcedMainSnapshot.files).toEqual([
      { path: "document.json", content: '{"id":"draft"}\n' },
    ]);
  });

  it("memory branch service exposes the protocol branch operations", async () => {
    const DocumentSchema = Schema.Struct({ id: Schema.String });
    const repository = createMemoryWorkspaceBranchRepository({
      schema: DocumentSchema,
      initialFiles: [{ path: "document.json", content: '{"id":"base"}\n' }],
    });
    const service = createMemoryWorkspaceBranchService(repository);

    const created = await Effect.runPromise(
      service.createBranch({ name: "review", createdBy: "user" }),
    );
    const branch = await Effect.runPromise(service.getBranch({ branchId: created.branch.id }));
    const archived = await Effect.runPromise(
      service.archiveBranch({ branchId: created.branch.id }),
    );
    const branchesBeforeDelete = await Effect.runPromise(service.listBranches);
    const deleted = await Effect.runPromise(service.deleteBranch({ branchId: created.branch.id }));
    const branchesAfterDelete = await Effect.runPromise(service.listBranches);

    expect(branch).toMatchObject({
      id: created.branch.id,
      name: "review",
      kind: "draft",
      baseBranchId: "main",
    });
    expect(archived.branch).toMatchObject({
      id: created.branch.id,
      kind: "archived",
    });
    expect(branchesBeforeDelete.map((candidate) => candidate.id)).toContain(created.branch.id);
    expect(deleted).toEqual({ branchId: created.branch.id });
    expect(branchesAfterDelete.map((candidate) => candidate.id)).not.toContain(created.branch.id);
  });

  it("workspace store syncs client snapshots and drafts through the AtomRef graph", async () => {
    const DocumentSchema = Schema.Struct({ id: Schema.String });
    const client = createMemoryWorkspaceClient({
      schema: DocumentSchema,
      initialFiles: [{ path: "document.json", content: '{"id":"initial"}\n' }],
    });
    const store = createSchemaIdeWorkspaceStore(client);
    const observed: string[] = [];
    const observedDirty: boolean[] = [];
    const unsubscribe = store.stateRef.subscribe((state) => {
      const content = state.snapshot?.files[0]?.content;
      if (content) observed.push(content);
    });
    const unsubscribeDirty = store.selectedIsDirtyRef.subscribe((isDirty) => {
      observedDirty.push(isDirty);
    });

    try {
      store.start();
      expect(store.stateRef.value.snapshot?.files[0]?.path).toBe("document.json");
      expect(store.selectedFileRef.value?.path).toBe("document.json");

      const snapshotBeforeSubscribe = store.stateRef.value;
      const unsubscribeNoop = store.stateRef.subscribe(() => undefined);
      expect(store.stateRef.value).toBe(snapshotBeforeSubscribe);
      unsubscribeNoop();

      store.updateActiveFile('{"id":"draft"}\n');
      expect(store.stateRef.value.drafts["document.json"]).toBe('{"id":"draft"}\n');
      expect(store.filesRef.value[0]?.content).toBe('{"id":"draft"}\n');
      expect(store.selectedIsDirtyRef.value).toBe(true);

      await Effect.runPromise(store.saveActiveFile);
      expect(store.stateRef.value.drafts["document.json"]).toBeUndefined();
      expect(store.stateRef.value.snapshot?.files[0]?.content).toBe('{"id":"draft"}\n');
      expect(store.selectedIsDirtyRef.value).toBe(false);
      expect(observed.some((content) => content.includes("draft"))).toBe(true);
      expect(observedDirty).toContain(true);
    } finally {
      unsubscribe();
      unsubscribeDirty();
      store.stop();
    }
  });

  it("workspace store does not mark committed content dirty", async () => {
    const DocumentSchema = Schema.Struct({ id: Schema.String });
    const client = createMemoryWorkspaceClient({
      schema: DocumentSchema,
      initialFiles: [
        { path: "first.json", content: '{"id":"first"}\n' },
        { path: "second.json", content: '{"id":"second"}\n' },
      ],
    });
    const store = createSchemaIdeWorkspaceStore(client);

    try {
      store.start();
      await Effect.runPromise(store.refreshSnapshot);

      store.setActiveFile("second.json");
      store.updateActiveFile('{"id":"second"}\n');

      expect(store.stateRef.value.drafts["second.json"]).toBeUndefined();
      expect(store.selectedIsDirtyRef.value).toBe(false);

      store.updateActiveFile('{"id":"changed"}\n');
      expect(store.stateRef.value.drafts["second.json"]).toBe('{"id":"changed"}\n');
      expect(store.selectedIsDirtyRef.value).toBe(true);

      store.updateActiveFile('{"id":"second"}\n');
      expect(store.stateRef.value.drafts["second.json"]).toBeUndefined();
      expect(store.selectedIsDirtyRef.value).toBe(false);
    } finally {
      store.stop();
    }
  });

  it("workspace store applies external updates and marks dirty draft conflicts", async () => {
    const DocumentSchema = Schema.Struct({ id: Schema.String });
    const client = createMemoryWorkspaceClient({
      schema: DocumentSchema,
      initialFiles: [{ path: "document.json", content: '{"id":"initial"}\n' }],
    });
    const store = createSchemaIdeWorkspaceStore(client);
    const observedConflict: boolean[] = [];
    const unsubscribeConflict = store.selectedHasConflictRef.subscribe((hasConflict) => {
      observedConflict.push(hasConflict);
    });

    try {
      store.start();
      await Effect.runPromise(store.refreshSnapshot);

      await Effect.runPromise(
        client.applyChange({
          type: "writeFile",
          path: "document.json",
          content: '{"id":"external"}\n',
        }),
      );
      await waitUntil(
        () => store.stateRef.value.snapshot?.files[0]?.content === '{"id":"external"}\n',
      );
      expect(store.stateRef.value.snapshot?.files[0]?.content).toBe('{"id":"external"}\n');

      store.updateActiveFile('{"id":"draft"}\n');
      await Effect.runPromise(
        client.applyChange({
          type: "writeFile",
          path: "document.json",
          content: '{"id":"second-external"}\n',
        }),
      );
      await waitUntil(
        () => store.stateRef.value.snapshot?.files[0]?.content === '{"id":"second-external"}\n',
      );

      expect(store.stateRef.value.drafts["document.json"]).toBe('{"id":"draft"}\n');
      expect(store.stateRef.value.conflicts["document.json"]).toBe(
        store.stateRef.value.snapshot?.revision,
      );
      expect(store.selectedHasConflictRef.value).toBe(true);
      expect(observedConflict).toContain(true);
    } finally {
      unsubscribeConflict();
      store.stop();
    }
  });

  it("workspace store follows externally changed files", async () => {
    const DocumentSchema = Schema.Struct({ id: Schema.String });
    const client = createMemoryWorkspaceClient({
      schema: DocumentSchema,
      initialFiles: [
        { path: "first.json", content: '{"id":"first"}\n' },
        { path: "second.json", content: '{"id":"second"}\n' },
      ],
    });
    const store = createSchemaIdeWorkspaceStore(client);

    try {
      store.start();
      await Effect.runPromise(store.refreshSnapshot);
      store.setActiveFile("first.json");

      await Effect.runPromise(
        client.applyChange({
          type: "writeFile",
          path: "second.json",
          content: '{"id":"second-updated"}\n',
        }),
      );
      await waitUntil(() => store.activeFileRef.value === "second.json");

      expect(store.selectedFileRef.value?.content).toBe('{"id":"second-updated"}\n');
    } finally {
      store.stop();
    }
  });

  it("workspace tool runtime applies agent writes through the shared store/client path", async () => {
    const DocumentSchema = Schema.Struct({
      id: Schema.String,
      title: Schema.optional(Schema.String),
    });
    const client = createMemoryWorkspaceClient({
      schema: DocumentSchema,
      initialFiles: [{ path: "document.json", content: '{"id":"initial"}\n' }],
    });
    const store = createSchemaIdeWorkspaceStore(client);

    try {
      store.start();
      await Effect.runPromise(store.refreshSnapshot);

      const runtime = createSchemaIdeWorkspaceToolRuntime(store);
      await runtime.writeFile({ path: "document.json", content: '{"id":"agent"}\n' });
      expect(store.stateRef.value.snapshot?.files[0]?.content).toBe('{"id":"agent"}\n');

      const result = await runtime.applyEdits([
        {
          path: "document.json",
          content: '{"id":"agent","title":"From agent"}\n',
        },
        {
          path: "extra.json",
          content: '{"id":"extra"}\n',
          create: true,
        },
      ]);

      expect(result.changedPaths).toEqual(["document.json", "extra.json"]);
      expect(result.validation.valid).toBe(true);
      expect(store.activeFileRef.value).toBe("document.json");
      expect(runtime.listFiles()).toEqual(["document.json", "extra.json"]);
      expect(runtime.readFile("document.json")?.content).toBe(
        '{"id":"agent","title":"From agent"}\n',
      );

      await runtime.createFile({ path: "created.json", content: '{"id":"created"}\n' });
      expect(store.activeFileRef.value).toBe("created.json");
    } finally {
      store.stop();
    }
  });

  it("workspace tool runtime rejects invalid validated edits before committing", async () => {
    const DocumentSchema = Schema.Struct({ id: Schema.String });
    const client = createMemoryWorkspaceClient({
      schema: DocumentSchema,
      initialFiles: [{ path: "document.json", content: '{"id":"initial"}\n' }],
    });
    const store = createSchemaIdeWorkspaceStore(client);

    try {
      store.start();
      await Effect.runPromise(store.refreshSnapshot);

      const runtime = createSchemaIdeWorkspaceToolRuntime(store);
      await expect(
        runtime.applyEdits([{ path: "document.json", content: '{"id":1}\n' }]),
      ).rejects.toThrow();

      expect(store.stateRef.value.snapshot?.files[0]?.content).toBe('{"id":"initial"}\n');
      expect(store.stateRef.value.snapshot?.reflection.validationSummary.valid).toBe(true);
    } finally {
      store.stop();
    }
  });

  it("workspace tool runtime validates proposed patch contents", async () => {
    const DocumentSchema = Schema.Struct({ id: Schema.String });
    const client = createMemoryWorkspaceClient({
      schema: DocumentSchema,
      initialFiles: [{ path: "document.json", content: '{"id":"initial"}\n' }],
    });
    const store = createSchemaIdeWorkspaceStore(client);

    try {
      store.start();
      await Effect.runPromise(store.refreshSnapshot);

      const runtime = createSchemaIdeWorkspaceToolRuntime(store);
      const proposal = await runtime.proposePatch("Invalid id", [
        { path: "document.json", content: '{"id":1}\n' },
      ]);

      expect(proposal.validation.valid).toBe(false);
      expect(proposal.diagnostics.some((diagnostic) => diagnostic.path === "document.json")).toBe(
        true,
      );
      expect(store.stateRef.value.snapshot?.files[0]?.content).toBe('{"id":"initial"}\n');
    } finally {
      store.stop();
    }
  });
});

defineWorkspaceClientContract({
  name: "memory workspace client",
  createSubject: Effect.succeed({
    workspace: createMemoryWorkspaceClient({
      schema: Schema.Struct({ id: Schema.String }),
      initialFiles: [{ path: "document.json", content: '{"id":"initial"}\n' }],
    }),
  }),
  existingPath: "document.json",
  updatedContent: '{"id":"updated"}\n',
});

function makePreview(id: string, schemaId: string, label: string): SchemaIdePreviewRegistration {
  return {
    id,
    schemaId,
    label,
    component: () => null,
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Effect.runPromise(Effect.sleep("10 millis"));
  }
  expect(predicate()).toBe(true);
}

function makeReflection(): SchemaIdeReflection {
  return {
    mode: "workspace",
    activeFile: "workflows/onboarding.json",
    activeFormat: "json",
    files: [
      { path: "actions/email.json", content: "{}" },
      { path: "workflows/onboarding.json", content: "{}" },
      { path: "notes/readme.md", content: "# Notes" },
    ],
    schemas: [
      {
        id: "Actions",
        jsonSchema: { type: "object", title: "Action" },
      },
      {
        id: "Workflows",
        jsonSchema: { type: "object", title: "Workflow" },
      },
    ],
    activeJsonSchema: { type: "object", title: "Workflow" },
    decodedValue: null,
    diagnostics: [],
    validationSummary: {
      valid: true,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
    },
    routeMatches: [
      {
        path: "actions/email.json",
        schemaId: "Actions",
        format: "json",
      },
      {
        path: "workflows/onboarding.json",
        schemaId: "Workflows",
        format: "json",
      },
      {
        path: "notes/readme.md",
        schemaId: null,
        format: "json",
      },
    ],
  };
}

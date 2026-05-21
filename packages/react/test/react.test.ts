import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  createSchemaIdeWorkspaceStore,
  createSchemaIdeWorkspaceToolRuntime,
  diagnosticsForSchemaIdeFile,
  createMemoryWorkspaceClient,
  getSchemaIdeFileDiagnosticCounts,
  resolveSchemaIdePreview,
  SchemaIde,
  type SchemaIdePreviewComponentProps,
  type SchemaIdePreviewRegistration,
  type SchemaIdePreviewRegistrationForRoutes,
} from "../src";
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

    expectTypeOf<Routes>().toEqualTypeOf<{ Workflows: Workflow }>();
    expectTypeOf(previews[0]!.component).parameter(0).toMatchTypeOf<{
      readonly value: Workflow | null;
      readonly schemaId: "Workflows";
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
    const subscription = client.watchWorkspace((event) => {
      if (event.type === "snapshot") {
        watchEvents.push(event.snapshot.files[0]?.content ?? "");
      }
    });

    try {
      const capabilities = await client.getCapabilities();
      const initial = await client.getSnapshot();
      const result = await client.applyChange({
        type: "writeFile",
        path: "document.json",
        content: '{"id":"updated"}\n',
      });
      const updated = await client.getSnapshot();

      expect(capabilities).toMatchObject({ mode: "memory", features: { write: true } });
      expect(initial.files[0]?.content).toContain("initial");
      expect(result.changedPaths).toEqual(["document.json"]);
      expect(updated.files[0]?.content).toContain("updated");
      expect(watchEvents.some((content) => content.includes("updated"))).toBe(true);
    } finally {
      subscription.unsubscribe();
    }
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

      await store.saveActiveFile();
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

      await client.applyChange({
        type: "writeFile",
        path: "document.json",
        content: '{"id":"external"}\n',
      });
      expect(store.stateRef.value.snapshot?.files[0]?.content).toBe('{"id":"external"}\n');

      store.updateActiveFile('{"id":"draft"}\n');
      await client.applyChange({
        type: "writeFile",
        path: "document.json",
        content: '{"id":"second-external"}\n',
      });

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

  it("workspace tool runtime applies agent writes through the shared store/client path", async () => {
    const DocumentSchema = Schema.Struct({ id: Schema.String, title: Schema.optional(Schema.String) });
    const client = createMemoryWorkspaceClient({
      schema: DocumentSchema,
      initialFiles: [{ path: "document.json", content: '{"id":"initial"}\n' }],
    });
    const store = createSchemaIdeWorkspaceStore(client);

    try {
      store.start();
      await store.refreshSnapshot();

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
      expect(runtime.listFiles()).toEqual(["document.json", "extra.json"]);
      expect(runtime.readFile("document.json")?.content).toBe(
        '{"id":"agent","title":"From agent"}\n',
      );
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
      await store.refreshSnapshot();

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
      await store.refreshSnapshot();

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
  createSubject: () => ({
    client: createMemoryWorkspaceClient({
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

import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Fiber, Schema, Stream } from "effect";
import {
  createSchemaIdeWorkspaceStore,
  createSchemaIdeWorkspaceToolRuntime,
  diagnosticsForSchemaIdeFile,
  createArtifactWorkspaceClient,
  createMemoryWorkspaceClient,
  createProjectWorkspaceClient,
  getSchemaIdeFileDiagnosticCounts,
  resolveSchemaIdePreview,
  SchemaIde,
  ArtifactProjectPreview,
  WorkspacePreview,
  type SchemaIdeProps,
  type SchemaIdePreviewComponentProps,
  type SchemaIdePreviewRegistration,
  type SchemaIdePreviewRegistrationForRoutes,
  type SchemaIdeWorkspaceViewProps,
} from "../src";
import { pdfContentToDataUrl } from "../src/SchemaIdePdfFileViewer";
import {
  SchemaIdeWorkspaceFileArtifact,
  Workspace,
  createSchemaIdeArtifactRuntime,
  type SchemaIdeInputSchema,
  type SchemaIdeReflection,
  type WorkspaceRoutes,
} from "@schema-ide/core";
import { ArtifactProject, type AnyArtifactType } from "@schema-ide/artifacts";
import type { SchemaIdeWorkspaceService } from "@schema-ide/protocol";
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

  it("resolves previews with artifact JSON Schema overrides", () => {
    const resolution = resolveSchemaIdePreview({
      previews: [makePreview("workflow-graph", "Workflows", "Workflow")],
      reflection: makeReflection(),
      file: { path: "workflows/onboarding.json", content: "{}" },
      jsonSchemaByPath: {
        "workflows/onboarding.json": { type: "object", title: "Artifact Workflow" },
      },
    });

    expect(resolution?.jsonSchema).toEqual({ type: "object", title: "Artifact Workflow" });
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

  it("types preview registrations from artifact project route ids", () => {
    const WorkflowSchema = Schema.Struct({
      id: Schema.String,
      actionIds: Schema.Array(Schema.String),
    });
    type Workflow = typeof WorkflowSchema.Type;

    const project = ArtifactProject.make("workflow").files("workflows/*.json", {
      id: "Workflows",
      type: SchemaIdeWorkspaceFileArtifact as unknown as AnyArtifactType,
      schema: WorkflowSchema,
    });
    const WorkflowPreview = (_props: SchemaIdePreviewComponentProps<Workflow, "Workflows">) => null;

    const previews = ArtifactProjectPreview.make(project, [
      {
        id: "artifact-workflow-preview",
        schemaId: "Workflows",
        label: "Workflow",
        component: WorkflowPreview,
      },
    ]);

    expectTypeOf(previews[0]!.component).parameter(0).toMatchTypeOf<{
      readonly value: Workflow | null;
      readonly schemaId: "Workflows";
      readonly onChange: (content: string) => void;
    }>();
  });

  it("types the top-level SchemaIde component with schema or artifact input", () => {
    const DocumentSchema = Schema.Struct({ id: Schema.String });
    const artifacts = createSchemaIdeArtifactRuntime({
      schema: DocumentSchema,
      files: [{ path: "document.json", content: '{"id":"initial"}\n' }],
      activeFile: "document.json",
      activeFormat: "json",
    });
    const project = ArtifactProject.make("documents").files("documents/*.json", {
      id: "documents",
      type: SchemaIdeWorkspaceFileArtifact as unknown as AnyArtifactType,
      schema: DocumentSchema,
    });

    expectTypeOf({ schema: DocumentSchema }).toMatchTypeOf<SchemaIdeProps>();
    expectTypeOf({ project: artifacts }).toMatchTypeOf<SchemaIdeProps>();
    expectTypeOf({
      project,
      schema: DocumentSchema,
      initialFiles: [{ path: "documents/initial.json", content: '{"id":"initial"}\n' }],
    }).toMatchTypeOf<SchemaIdeProps>();
    expectTypeOf({
      project,
      initialFiles: [{ path: "documents/initial.json", content: '{"id":"initial"}\n' }],
    }).toMatchTypeOf<SchemaIdeProps>();
    expectTypeOf({ artifacts }).toMatchTypeOf<SchemaIdeProps>();
    expectTypeOf({ project: artifacts }).toMatchTypeOf<SchemaIdeWorkspaceViewProps>();
  });

  it("project workspace client runs from an artifact project declaration", async () => {
    const DocumentSchema = Schema.Struct({ id: Schema.String });
    const project = ArtifactProject.make("documents").files("documents/*.json", {
      id: "documents",
      type: SchemaIdeWorkspaceFileArtifact as unknown as AnyArtifactType,
      schema: DocumentSchema,
    });
    const client = createProjectWorkspaceClient({
      project,
      schema: DocumentSchema,
      initialFiles: [{ path: "documents/initial.json", content: '{"id":"initial"}\n' }],
    });
    const ref = { _tag: "WorkspaceFile" as const, path: "documents/initial.json" };

    const snapshot = await Effect.runPromise(client.getSnapshot);
    const capabilities = await Effect.runPromise(client.getArtifactCapabilities({ ref }));

    expect(snapshot.reflection.validationSummary.valid).toBe(true);
    expect(capabilities.capabilities.map((capability) => capability.view)).toEqual(
      expect.arrayContaining([
        "sourceText",
        "parsedValue",
        "jsonSchema",
        "diagnostics",
        "decodedValue",
      ]),
    );
    await expect(
      Effect.runPromise(client.readArtifactView({ ref, view: "decodedValue" })),
    ).resolves.toMatchObject({
      value: { id: "initial" },
    });
  });

  it("project workspace client runs from an artifact project declaration alone", async () => {
    const DocumentSchema = Schema.Struct({ id: Schema.String });
    const project = ArtifactProject.make("documents").files("documents/*.json", {
      id: "documents",
      type: SchemaIdeWorkspaceFileArtifact as unknown as AnyArtifactType,
      schema: DocumentSchema,
      metadata: {
        attributes: {
          schemaId: "Documents",
          workspaceField: "documents",
          indexBy: "id",
        },
      },
    });
    const client = createProjectWorkspaceClient({
      project,
      initialFiles: [{ path: "documents/initial.json", content: '{"id":"initial"}\n' }],
    });

    const snapshot = await Effect.runPromise(client.getSnapshot);
    const emptyProject = createProjectWorkspaceClient({ project });
    const emptySnapshot = await Effect.runPromise(emptyProject.getSnapshot);

    expect(snapshot.files.map((file) => file.path)).toEqual(["documents/initial.json"]);
    expect(snapshot.reflection.validationSummary.valid).toBe(true);
    expect(snapshot.reflection.schemas.map((schema) => schema.id)).toEqual(["Documents"]);
    expect(snapshot.reflection.decodedValue).toEqual({
      documents: new Map([["initial", { id: "initial" }]]),
    });
    expect(emptySnapshot.files).toEqual([]);
  });

  it("memory workspace client exposes snapshots, writes, and watch events", async () => {
    const DocumentSchema = Schema.Struct({ id: Schema.String });
    const client = createMemoryWorkspaceClient({
      schema: DocumentSchema,
      initialFiles: [{ path: "document.json", content: '{"id":"initial"}\n' }],
    });
    const watchEvents: string[] = [];
    const fiber = Effect.runFork(
      client.watchArtifactProject.pipe(
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

  it("memory workspace client serves artifact runtime views", async () => {
    const ActionSchema = Schema.Struct({
      id: Schema.String,
      label: Schema.String,
    });
    const WorkspaceSchema = Workspace.Struct({
      actions: Workspace.files("actions/*.json", ActionSchema),
    });
    const client = createMemoryWorkspaceClient({
      schema: WorkspaceSchema,
      initialFiles: [{ path: "actions/email.json", content: '{"id":"email","label":"Email"}\n' }],
    });
    const ref = { _tag: "WorkspaceFile" as const, path: "actions/email.json" };

    const capabilities = await Effect.runPromise(client.getArtifactCapabilities({ ref }));
    expect(capabilities.capabilities.map((capability) => capability.view)).toEqual(
      expect.arrayContaining([
        "sourceText",
        "parsedValue",
        "jsonSchema",
        "diagnostics",
        "decodedValue",
      ]),
    );

    await expect(
      Effect.runPromise(client.readArtifactView({ ref, view: "decodedValue" })),
    ).resolves.toMatchObject({
      value: {
        id: "email",
        label: "Email",
      },
    });
  });

  it("memory workspace client snapshots mirror the artifact reflection view", async () => {
    const DocumentSchema = Schema.Struct({ id: Schema.String });
    const client = createMemoryWorkspaceClient({
      schema: DocumentSchema,
      initialFiles: [{ path: "document.json", content: '{"id":"artifact"}\n' }],
    });

    const snapshot = await Effect.runPromise(client.getSnapshot);
    const artifactReflection = await Effect.runPromise(
      client.readArtifactView({ ref: { _tag: "Workspace" }, view: "reflection" }),
    );
    const preview = await Effect.runPromise(
      client.previewFiles({
        files: [{ path: "document.json", content: '{"id":1}\n' }],
        activeFile: "document.json",
      }),
    );

    expect(artifactReflection.value).toEqual(snapshot.reflection);
    expect(preview.reflection.validationSummary.valid).toBe(false);
    expect(preview.reflection.diagnostics[0]?.path).toBe("document.json");
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

  it("workspace store hydrates committed files from artifact source views", async () => {
    const DocumentSchema = Schema.Struct({ id: Schema.String });
    const client = createMemoryWorkspaceClient({
      schema: DocumentSchema,
      initialFiles: [{ path: "document.json", content: '{"id":"artifact"}\n' }],
    });
    const artifactFirstClient: SchemaIdeWorkspaceService = {
      ...client,
      getSnapshot: client.getSnapshot.pipe(
        Effect.map((snapshot) => ({
          ...snapshot,
          files: snapshot.files.map((file) => ({ ...file, content: '{"id":"snapshot"}\n' })),
          reflection: {
            ...snapshot.reflection,
            files: snapshot.reflection.files.map((file) => ({
              ...file,
              content: '{"id":"snapshot"}\n',
            })),
            schemas: snapshot.reflection.schemas.map((schema) => ({
              ...schema,
              jsonSchema: { type: "object", title: "Snapshot Document" },
            })),
            diagnostics: [
              {
                path: "document.json",
                severity: "error" as const,
                source: "workspace" as const,
                message: "stale snapshot reflection",
              },
            ],
            validationSummary: {
              valid: false,
              errorCount: 1,
              warningCount: 0,
              infoCount: 0,
            },
          },
        })),
      ),
    };
    const store = createSchemaIdeWorkspaceStore(artifactFirstClient);

    try {
      await Effect.runPromise(store.refreshSnapshot);

      expect(store.stateRef.value.snapshot?.files[0]?.content).toBe('{"id":"snapshot"}\n');
      expect(store.stateRef.value.snapshot?.reflection.validationSummary.valid).toBe(false);
      expect(store.artifactRefsRef.value).toEqual([
        { _tag: "Workspace" },
        { _tag: "WorkspaceFile", path: "document.json" },
      ]);
      expect(store.committedFilesRef.value[0]?.content).toBe('{"id":"artifact"}\n');
      expect(store.filesRef.value[0]?.content).toBe('{"id":"artifact"}\n');
      expect(store.artifactReflectionRef.value?.validationSummary.valid).toBe(true);
      expect(store.reflectionRef.value?.validationSummary.valid).toBe(true);
      expect(store.stateRef.value.reflection?.files[0]?.content).toBe('{"id":"artifact"}\n');
      expect(
        Object.prototype.hasOwnProperty.call(store.artifactJsonSchemasRef.value, "document.json"),
      ).toBe(true);
      expect(store.artifactJsonSchemasRef.value["document.json"]).not.toEqual({
        type: "object",
        title: "Snapshot Document",
      });
    } finally {
      store.stop();
    }
  });

  it("workspace store hydrates diagnostics from artifact diagnostics views", async () => {
    const DocumentSchema = Schema.Struct({ id: Schema.String });
    const client = createMemoryWorkspaceClient({
      schema: DocumentSchema,
      initialFiles: [{ path: "document.json", content: '{"id":"artifact"}\n' }],
    });
    const staleDiagnostic = {
      path: "document.json",
      severity: "error" as const,
      source: "workspace" as const,
      message: "stale reflection diagnostic",
    };
    const staleReflectionClient: SchemaIdeWorkspaceService = {
      ...client,
      getSnapshot: client.getSnapshot.pipe(
        Effect.map((snapshot) => ({
          ...snapshot,
          reflection: {
            ...snapshot.reflection,
            diagnostics: [staleDiagnostic],
            validationSummary: {
              valid: false,
              errorCount: 1,
              warningCount: 0,
              infoCount: 0,
            },
          },
        })),
      ),
      readArtifactView: (request) => {
        if (request.ref._tag === "Workspace" && request.view === "reflection") {
          return staleReflectionClient.getSnapshot.pipe(
            Effect.map((snapshot) => ({
              ref: request.ref,
              view: request.view,
              value: snapshot.reflection,
            })),
          );
        }
        return client.readArtifactView(request);
      },
    };
    const store = createSchemaIdeWorkspaceStore(staleReflectionClient);

    try {
      await Effect.runPromise(store.refreshSnapshot);

      expect(store.reflectionRef.value?.diagnostics).toEqual([staleDiagnostic]);
      expect(store.artifactDiagnosticsRef.value).toEqual([]);
      expect(store.diagnosticsRef.value).toEqual([]);
      expect(store.stateRef.value.diagnostics).toEqual([]);
    } finally {
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

defineWorkspaceClientContract({
  name: "artifact workspace client",
  createSubject: Effect.succeed({
    workspace: createArtifactWorkspaceClient(
      createSchemaIdeArtifactRuntime({
        schema: Schema.Struct({ id: Schema.String }),
        files: [{ path: "document.json", content: '{"id":"initial"}\n' }],
        activeFile: "document.json",
        activeFormat: "json",
      }),
    ),
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

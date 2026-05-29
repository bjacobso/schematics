import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { ArtifactRef } from "@schema-ide/artifacts";
import { Relation } from "@schema-ide/schema-algebra";
import {
  ArtifactProject,
  SchemaIdeWorkspaceFileArtifact,
  Workspace,
  applyWorkspaceChange,
  createReflection,
  createArtifactProjectFromWorkspace,
  createSchemaIdeArtifactRuntime,
  createWorkspaceFromArtifactProject,
  createVersionedWorkspace,
  getSchemaIdeCompletions,
  getSchemaIdeDefinitions,
  getSchemaIdeHover,
  getSchemaIdeQuickFixes,
  parseYaml,
  redoWorkspaceChange,
  undoWorkspaceChange,
  validateSchemaIdeValue,
  validateSingleDocument,
  type WorkspaceRoutes,
} from "../src";

const ConfigSchema = Schema.Struct({
  name: Schema.String,
  enabled: Schema.Boolean,
});

describe("schema-ide-core", () => {
  it("validates JSON and YAML documents with Effect Schema", () => {
    expect(
      validateSingleDocument({
        schema: ConfigSchema,
        content: '{"name":"Demo","enabled":true}',
        format: "json",
        path: "config.json",
      }).value,
    ).toEqual({ name: "Demo", enabled: true });

    expect(
      Schema.decodeUnknownSync(parseYaml(ConfigSchema))("name: Demo\nenabled: true\n"),
    ).toEqual({ name: "Demo", enabled: true });
  });

  it("validates cross-file workspace references", () => {
    const FormSchema = Schema.Struct({
      id: Schema.String,
      fields: Schema.Array(Schema.Struct({ id: Schema.String })),
    });
    const PolicySchema = Schema.Struct({
      id: Schema.String,
      formId: Schema.String,
      requiredFieldIds: Schema.Array(Schema.String),
    });
    const WorkspaceSchema = Workspace.Struct({
      forms: Workspace.files("forms/*.json", FormSchema).pipe(Workspace.indexBy("id")),
      policies: Workspace.files("policies/*.json", PolicySchema).pipe(Workspace.indexBy("id")),
    }).pipe(
      Workspace.validate<any>("refs", ({ forms, policies }, issue) => {
        for (const policy of policies.values()) {
          const form = forms.get(policy.formId);
          if (!form) continue;
          for (const fieldId of policy.requiredFieldIds) {
            if (!form.fields.some((field: { readonly id: string }) => field.id === fieldId)) {
              issue.at(`policies.${policy.id}.requiredFieldIds`, `Unknown field: ${fieldId}`);
            }
          }
        }
      }),
    );

    const result = validateSchemaIdeValue({
      schema: WorkspaceSchema,
      activeFile: "policies/check.json",
      activeFormat: "json",
      files: [
        { path: "forms/consent.json", content: '{"id":"consent","fields":[{"id":"name"}]}' },
        {
          path: "policies/check.json",
          content: '{"id":"check","formId":"consent","requiredFieldIds":["name","signature"]}',
        },
      ],
    });

    expect(result.summary.valid).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toContain(
      "Unknown field: signature",
    );
    expect(
      result.diagnostics.find((diagnostic) => diagnostic.message === "Unknown field: signature"),
    ).toMatchObject({
      path: "policies/check.json",
      documentPath: "policies.check.requiredFieldIds",
      line: 1,
    });
  });

  it("allows PDF sidecar files without unmatched-route warnings", () => {
    const WorkspaceSchema = Workspace.Struct({
      configs: Workspace.files("config/*.json", ConfigSchema).pipe(Workspace.indexBy("name")),
    });

    const result = validateSchemaIdeValue({
      schema: WorkspaceSchema,
      activeFile: "forms/intake.pdf",
      activeFormat: "json",
      files: [
        { path: "config/demo.json", content: '{"name":"Demo","enabled":true}' },
        { path: "forms/intake.pdf", content: "JVBERi0xLjcK" },
      ],
    });

    expect(result.summary).toMatchObject({ valid: true, warningCount: 0 });
    expect(result.routeMatches).toContainEqual({
      path: "forms/intake.pdf",
      schemaId: null,
      format: "json",
    });
  });

  it("preserves workspace route ids and decoded file types at the type level", () => {
    const ActionSchema = Schema.Struct({
      id: Schema.String,
      label: Schema.String,
    });
    const WorkflowSchema = Schema.Struct({
      id: Schema.String,
      actionIds: Schema.Array(Schema.String),
    });
    type Action = typeof ActionSchema.Type;
    type Workflow = typeof WorkflowSchema.Type;

    const WorkspaceSchema = Workspace.Struct({
      actions: Workspace.files("actions/*.json", ActionSchema).pipe(
        Workspace.annotations({ identifier: "Actions" }),
        Workspace.indexBy("id"),
      ),
      workflows: Workspace.files("workflows/*.json", WorkflowSchema).pipe(
        Workspace.values(),
        Workspace.annotations({ identifier: "Workflows" }),
      ),
    });

    expectTypeOf<WorkspaceRoutes<typeof WorkspaceSchema>>().toEqualTypeOf<{
      Actions: Action;
      Workflows: Workflow;
    }>();
    expect(WorkspaceSchema.reflect().map((schema) => schema.id)).toEqual(["Actions", "Workflows"]);
  });

  it("derives artifact project routes from Workspace.Struct reflection", () => {
    const ActionSchema = Schema.Struct({
      id: Schema.String,
      label: Schema.String,
    }).annotate({ title: "Action" });
    const WorkflowSchema = Schema.Struct({
      id: Schema.String,
      actionIds: Schema.Array(Schema.String),
    });
    const WorkspaceSchema = Workspace.Struct({
      actions: Workspace.files("actions/*.json", ActionSchema).pipe(
        Workspace.annotations({
          identifier: "Actions",
          description: "Workflow action definitions",
        }),
        Workspace.indexBy("id"),
      ),
      workflows: Workspace.files("workflows/*.json", WorkflowSchema).pipe(
        Workspace.annotations({ identifier: "Workflows" }),
        Workspace.values(),
      ),
    });

    const project = createArtifactProjectFromWorkspace(WorkspaceSchema, { name: "workflow" });

    expect(
      project.capabilities(ArtifactRef.workspace()).map((capability) => capability.id),
    ).toEqual([
      "workflow.workspace.decodedWorkspace",
      "workflow.workspace.diagnostics",
      "workflow.workspace.validationSummary",
      "workflow.workspace.routeMatches",
      "workflow.workspace.reflection",
      "workflow.workspace.relationGraph",
      "workflow.workspace.entityIndex",
      "workflow.workspace.definitionLocations",
      "workflow.workspace.references",
      "workflow.workspace.relationDiagnostics",
      "workflow.workspace.referenceDiagnostics",
      "workflow.workspace.patchSuggestions",
    ]);
    expect(
      project.capabilities(ArtifactRef.workspaceFile("actions/email.json")).map((capability) => ({
        id: capability.id,
        routeId: capability.routeId,
        routePattern: capability.routePattern,
      })),
    ).toEqual([
      {
        id: "Actions.sourceText",
        routeId: "Actions",
        routePattern: "actions/*.json",
      },
      {
        id: "Actions.parsedValue",
        routeId: "Actions",
        routePattern: "actions/*.json",
      },
      {
        id: "Actions.jsonSchema",
        routeId: "Actions",
        routePattern: "actions/*.json",
      },
      {
        id: "Actions.diagnostics",
        routeId: "Actions",
        routePattern: "actions/*.json",
      },
      {
        id: "Actions.relationGraph",
        routeId: "Actions",
        routePattern: "actions/*.json",
      },
      {
        id: "Actions.entityIndex",
        routeId: "Actions",
        routePattern: "actions/*.json",
      },
      {
        id: "Actions.definitionLocations",
        routeId: "Actions",
        routePattern: "actions/*.json",
      },
      {
        id: "Actions.references",
        routeId: "Actions",
        routePattern: "actions/*.json",
      },
      {
        id: "Actions.relationDiagnostics",
        routeId: "Actions",
        routePattern: "actions/*.json",
      },
      {
        id: "Actions.referenceDiagnostics",
        routeId: "Actions",
        routePattern: "actions/*.json",
      },
      {
        id: "Actions.patchSuggestions",
        routeId: "Actions",
        routePattern: "actions/*.json",
      },
      {
        id: "Actions.decodedValue",
        routeId: "Actions",
        routePattern: "actions/*.json",
      },
    ]);
    expect(project.route(ArtifactRef.workspaceFile("notes/readme.md"))).toEqual([]);
    expect(project.routes[0]?.schema).toBe(ActionSchema);
    expect(project.routes[0]?.metadata?.attributes).toMatchObject({
      workspaceField: "actions",
      schemaId: "Actions",
      indexBy: "id",
      title: "Action",
      description: "Workflow action definitions",
    });
    expect(project.routes[1]?.metadata?.attributes).toMatchObject({
      workspaceField: "workflows",
      schemaId: "Workflows",
      values: true,
    });
  });

  it("derives Workspace.Struct compatibility from artifact project routes", () => {
    const ActionSchema = Schema.Struct({
      id: Schema.String,
      label: Schema.String,
    });
    const WorkflowSchema = Schema.Struct({
      id: Schema.String,
      actionIds: Schema.Array(Schema.String),
    });
    const project = ArtifactProject.make("workflow")
      .files("actions/*.json", {
        id: "Actions",
        type: SchemaIdeWorkspaceFileArtifact,
        schema: ActionSchema,
        metadata: {
          attributes: {
            workspaceField: "actions",
            description: "Workflow action definitions",
            indexBy: "id",
          },
        },
      })
      .files("workflows/*.json", {
        id: "Workflows",
        type: SchemaIdeWorkspaceFileArtifact,
        schema: WorkflowSchema,
        metadata: {
          attributes: {
            workspaceField: "workflows",
            values: true,
          },
        },
      });

    const WorkspaceSchema = createWorkspaceFromArtifactProject(project);
    const decoded = WorkspaceSchema.decode({
      files: [
        { path: "actions/email.json", content: '{"id":"email","label":"Email"}' },
        { path: "workflows/onboarding.json", content: '{"id":"onboarding","actionIds":["email"]}' },
      ],
    });

    expect(decoded.summary.valid).toBe(true);
    expect((decoded.value as any)?.actions.get("email")).toEqual({
      id: "email",
      label: "Email",
    });
    expect((decoded.value as any)?.workflows).toEqual([{ id: "onboarding", actionIds: ["email"] }]);
    expect(WorkspaceSchema.reflect().map((schema) => schema.id)).toEqual(["Actions", "Workflows"]);
    expect(WorkspaceSchema.reflect()[0]?.description).toBe("Workflow action definitions");
  });

  it("exposes artifact/workspace compatibility helpers from the core facade", () => {
    const ActionSchema = Schema.Struct({
      id: Schema.String,
      label: Schema.String,
    });
    const WorkspaceSchema = Workspace.Struct({
      actions: Workspace.files("actions/*.json", ActionSchema).pipe(
        Workspace.annotations({ identifier: "Actions" }),
        Workspace.indexBy("id"),
      ),
    });

    const project = ArtifactProject.fromWorkspace(WorkspaceSchema, { name: "workflow" });
    const ProjectedWorkspace = Workspace.fromArtifactProject(project);
    const decoded = ProjectedWorkspace.decode({
      files: [{ path: "actions/email.json", content: '{"id":"email","label":"Email"}' }],
    });

    expect(project.name).toBe("workflow");
    expect(project.routes.map((route) => route.id)).toEqual(["Actions"]);
    expect(project.routes[0]?.metadata?.attributes).toMatchObject({
      workspaceField: "actions",
      indexBy: "id",
    });
    expect(decoded.summary.valid).toBe(true);
    expect((decoded.value as any)?.actions.get("email")).toEqual({
      id: "email",
      label: "Email",
    });
  });

  it("round-trips every workspace route shape through artifact project routes", () => {
    const ProjectSchema = Schema.Struct({ id: Schema.String, title: Schema.String });
    const ActionSchema = Schema.Struct({ id: Schema.String, label: Schema.String });
    const WorkflowSchema = Schema.Struct({
      id: Schema.String,
      actionIds: Schema.Array(Schema.String),
    });
    const NoteSchema = Schema.Struct({ id: Schema.String, body: Schema.String });
    const OptionalSchema = Schema.Struct({ enabled: Schema.Boolean });
    const WorkspaceSchema = Workspace.Struct({
      project: Workspace.file("project.json", ProjectSchema).pipe(
        Workspace.annotations({ identifier: "Project", description: "Project metadata" }),
      ),
      optionalSettings: Workspace.file("settings.json", OptionalSchema, { optional: true }).pipe(
        Workspace.annotations({ identifier: "Settings", description: "Optional settings" }),
      ),
      actions: Workspace.files("actions/*.json", ActionSchema).pipe(
        Workspace.annotations({ identifier: "Actions", description: "Action definitions" }),
        Workspace.indexBy("id"),
      ),
      workflows: Workspace.files("workflows/*.json", WorkflowSchema).pipe(
        Workspace.annotations({ identifier: "Workflows", description: "Workflow definitions" }),
        Workspace.values(),
      ),
      notes: Workspace.files("notes/*.json", NoteSchema).pipe(
        Workspace.annotations({ identifier: "Notes", description: "Raw note file entries" }),
      ),
    });

    const project = ArtifactProject.fromWorkspace(WorkspaceSchema, { name: "route-parity" });
    const ProjectedWorkspace = Workspace.fromArtifactProject(project);
    const decoded = ProjectedWorkspace.decode({
      files: [
        { path: "project.json", content: '{"id":"demo","title":"Demo"}\n' },
        { path: "actions/email.json", content: '{"id":"email","label":"Email"}\n' },
        {
          path: "workflows/onboarding.json",
          content: '{"id":"onboarding","actionIds":["email"]}\n',
        },
        { path: "notes/readme.json", content: '{"id":"readme","body":"Hello"}\n' },
      ],
    });
    const config = ArtifactProject.toConfig(project);

    expect(decoded.summary.valid).toBe(true);
    expect((decoded.value as any).project).toEqual({ id: "demo", title: "Demo" });
    expect((decoded.value as any).optionalSettings).toBeNull();
    expect((decoded.value as any).actions).toEqual(
      new Map([["email", { id: "email", label: "Email" }]]),
    );
    expect((decoded.value as any).workflows).toEqual([{ id: "onboarding", actionIds: ["email"] }]);
    expect((decoded.value as any).notes).toEqual([
      { path: "notes/readme.json", value: { id: "readme", body: "Hello" } },
    ]);
    expect(project.routes.map((route) => route.metadata?.attributes)).toEqual([
      expect.objectContaining({
        workspaceField: "project",
        single: true,
        schemaId: "Project",
        description: "Project metadata",
      }),
      expect.objectContaining({
        workspaceField: "optionalSettings",
        single: true,
        optional: true,
        schemaId: "Settings",
        description: "Optional settings",
      }),
      expect.objectContaining({
        workspaceField: "actions",
        indexBy: "id",
        schemaId: "Actions",
        description: "Action definitions",
      }),
      expect.objectContaining({
        workspaceField: "workflows",
        values: true,
        schemaId: "Workflows",
        description: "Workflow definitions",
      }),
      expect.objectContaining({
        workspaceField: "notes",
        schemaId: "Notes",
        description: "Raw note file entries",
      }),
    ]);
    expect(
      config.files.map(({ id, pattern, mode, indexBy, optional, description }) => ({
        id,
        pattern,
        mode,
        indexBy,
        optional,
        description,
      })),
    ).toEqual([
      {
        id: "Project",
        pattern: "project.json",
        mode: "file",
        indexBy: undefined,
        optional: undefined,
        description: "Project metadata",
      },
      {
        id: "Settings",
        pattern: "settings.json",
        mode: "file",
        indexBy: undefined,
        optional: true,
        description: "Optional settings",
      },
      {
        id: "Actions",
        pattern: "actions/*.json",
        mode: undefined,
        indexBy: "id",
        optional: undefined,
        description: "Action definitions",
      },
      {
        id: "Workflows",
        pattern: "workflows/*.json",
        mode: "values",
        indexBy: undefined,
        optional: undefined,
        description: "Workflow definitions",
      },
      {
        id: "Notes",
        pattern: "notes/*.json",
        mode: undefined,
        indexBy: undefined,
        optional: undefined,
        description: "Raw note file entries",
      },
    ]);
  });

  it("tracks workspace revisions and supports undo and redo", () => {
    const initialFiles = [{ path: "config.json", content: '{"name":"Demo","enabled":true}' }];
    const workspace = createVersionedWorkspace(initialFiles);

    const edited = applyWorkspaceChange(
      workspace,
      { type: "writeFile", path: "config.json", content: '{"name":"Edited","enabled":true}' },
      { actor: "user", label: "Save config.json", timestamp: 1 },
    );

    expect(edited.files).toEqual([
      { path: "config.json", content: '{"name":"Edited","enabled":true}' },
    ]);
    expect(edited.revisions).toHaveLength(1);
    expect(edited.revisions[0]).toMatchObject({
      id: "rev-1",
      actor: "user",
      label: "Save config.json",
      patch: {
        type: "writeFile",
        path: "config.json",
        before: initialFiles[0],
        after: { path: "config.json", content: '{"name":"Edited","enabled":true}' },
      },
    });

    const undone = undoWorkspaceChange(edited);
    expect(undone.files).toEqual(initialFiles);
    expect(undone.cursor).toBe(-1);

    const redone = redoWorkspaceChange(undone);
    expect(redone.files).toEqual(edited.files);
    expect(redone.cursor).toBe(0);
  });

  it("truncates redo revisions after a new edit", () => {
    const workspace = createVersionedWorkspace([{ path: "a.json", content: "{}\n" }]);
    const first = applyWorkspaceChange(
      workspace,
      { type: "writeFile", path: "a.json", content: '{"step":1}\n' },
      { actor: "user", label: "Save a.json", timestamp: 1 },
    );
    const second = applyWorkspaceChange(
      first,
      { type: "writeFile", path: "a.json", content: '{"step":2}\n' },
      { actor: "agent", label: "write_file a.json", turnId: "turn-1", toolCallId: "call-1" },
    );

    const afterUndo = undoWorkspaceChange(second);
    const branched = applyWorkspaceChange(
      afterUndo,
      { type: "createFile", path: "b.json", content: "{}\n" },
      { actor: "user", label: "Create b.json", timestamp: 3 },
    );

    expect(branched.revisions.map((revision) => revision.label)).toEqual([
      "Save a.json",
      "Create b.json",
    ]);
    expect(redoWorkspaceChange(branched)).toBe(branched);
  });

  it("records agent turn and tool call metadata on revisions", () => {
    const workspace = createVersionedWorkspace([]);
    const next = applyWorkspaceChange(
      workspace,
      { type: "createFile", path: "forms/intake.yaml", content: "id: intake\n" },
      {
        actor: "agent",
        label: "create_file forms/intake.yaml",
        turnId: "turn-123",
        toolCallId: "tool-456",
      },
    );

    expect(next.revisions[0]).toMatchObject({
      actor: "agent",
      label: "create_file forms/intake.yaml",
      turnId: "turn-123",
      toolCallId: "tool-456",
    });
  });

  it("exposes workspace validation and reflection as artifact views", async () => {
    const WorkspaceSchema = Workspace.Struct({
      configs: Workspace.files("config/*.json", ConfigSchema).pipe(Workspace.indexBy("name")),
    });
    const runtime = createSchemaIdeArtifactRuntime({
      schema: WorkspaceSchema,
      activeFile: "config/demo.json",
      activeFormat: "json",
      files: [{ path: "config/demo.json", content: '{"name":"Demo","enabled":true}' }],
    });
    const workspaceRef = ArtifactRef.workspace();
    const fileRef = ArtifactRef.workspaceFile("config/demo.json");

    expect(runtime.capabilities(workspaceRef).map((capability) => capability.view)).toEqual([
      "decodedWorkspace",
      "diagnostics",
      "validationSummary",
      "routeMatches",
      "reflection",
      "relationGraph",
      "entityIndex",
      "definitionLocations",
      "references",
      "relationDiagnostics",
      "referenceDiagnostics",
      "patchSuggestions",
    ]);
    expect(runtime.capabilities(fileRef).map((capability) => capability.view)).toEqual([
      "sourceText",
      "parsedValue",
      "jsonSchema",
      "diagnostics",
      "relationGraph",
      "entityIndex",
      "definitionLocations",
      "references",
      "relationDiagnostics",
      "referenceDiagnostics",
      "patchSuggestions",
      "decodedValue",
    ]);
    expect(runtime.project.name).toBe("schema-ide");
    expect(
      runtime.capabilities(fileRef).map((capability) => ({
        id: capability.id,
        routeId: capability.routeId,
        routePattern: capability.routePattern,
      })),
    ).toEqual([
      {
        id: "config/*.json.sourceText",
        routeId: "config/*.json",
        routePattern: "config/*.json",
      },
      {
        id: "config/*.json.parsedValue",
        routeId: "config/*.json",
        routePattern: "config/*.json",
      },
      {
        id: "config/*.json.jsonSchema",
        routeId: "config/*.json",
        routePattern: "config/*.json",
      },
      {
        id: "config/*.json.diagnostics",
        routeId: "config/*.json",
        routePattern: "config/*.json",
      },
      {
        id: "config/*.json.relationGraph",
        routeId: "config/*.json",
        routePattern: "config/*.json",
      },
      {
        id: "config/*.json.entityIndex",
        routeId: "config/*.json",
        routePattern: "config/*.json",
      },
      {
        id: "config/*.json.definitionLocations",
        routeId: "config/*.json",
        routePattern: "config/*.json",
      },
      {
        id: "config/*.json.references",
        routeId: "config/*.json",
        routePattern: "config/*.json",
      },
      {
        id: "config/*.json.relationDiagnostics",
        routeId: "config/*.json",
        routePattern: "config/*.json",
      },
      {
        id: "config/*.json.referenceDiagnostics",
        routeId: "config/*.json",
        routePattern: "config/*.json",
      },
      {
        id: "config/*.json.patchSuggestions",
        routeId: "config/*.json",
        routePattern: "config/*.json",
      },
      {
        id: "config/*.json.decodedValue",
        routeId: "config/*.json",
        routePattern: "config/*.json",
      },
    ]);

    await expect(Effect.runPromise(runtime.view(fileRef, "sourceText"))).resolves.toBe(
      '{"name":"Demo","enabled":true}',
    );
    await expect(Effect.runPromise(runtime.view(fileRef, "parsedValue"))).resolves.toEqual({
      name: "Demo",
      enabled: true,
    });
    await expect(Effect.runPromise(runtime.view(fileRef, "decodedValue"))).resolves.toEqual({
      name: "Demo",
      enabled: true,
    });
    await expect(
      Effect.runPromise(runtime.view(workspaceRef, "validationSummary")),
    ).resolves.toMatchObject({ valid: true, errorCount: 0 });
    await expect(Effect.runPromise(runtime.view(workspaceRef, "routeMatches"))).resolves.toEqual([
      { path: "config/demo.json", schemaId: "config/*.json", format: "json" },
    ]);
    await expect(Effect.runPromise(runtime.view(fileRef, "jsonSchema"))).resolves.toMatchObject({
      type: "object",
      required: ["name", "enabled"],
    });
    await expect(
      Effect.runPromise(runtime.view(workspaceRef, "reflection")),
    ).resolves.toMatchObject({
      mode: "workspace",
      activeFile: "config/demo.json",
      validationSummary: { valid: true, errorCount: 0 },
    });
    await expect(
      Effect.runPromise(
        runtime.preview([{ path: "config/demo.json", content: '{"name":"Preview"}' }]),
      ),
    ).resolves.toMatchObject({
      decodedValue: null,
      validationSummary: { valid: false, errorCount: 1 },
    });
  });

  it("runs workspace validation and reflection from an artifact project without Workspace.Struct", async () => {
    const Project = ArtifactProject.make("project-only").files("config/*.json", {
      id: "Configs",
      type: SchemaIdeWorkspaceFileArtifact,
      schema: ConfigSchema,
      metadata: {
        attributes: {
          schemaId: "Configs",
          workspaceField: "configs",
          indexBy: "name",
          description: "Project config files",
        },
      },
    });
    const runtime = createSchemaIdeArtifactRuntime({
      project: Project,
      activeFile: "config/demo.json",
      activeFormat: "json",
      workspaceId: "project-only",
      files: [
        { path: "config/demo.json", content: '{"name":"Demo","enabled":true}' },
        { path: "notes/readme.md", content: "# Notes\n" },
      ],
    });
    const workspaceRef = ArtifactRef.workspace("project-only");
    const fileRef = ArtifactRef.workspaceFile("config/demo.json", "project-only");

    const decodedWorkspace = await Effect.runPromise(
      runtime.view(workspaceRef, "decodedWorkspace"),
    );
    expect(decodedWorkspace).toEqual({
      configs: new Map([["Demo", { name: "Demo", enabled: true }]]),
    });
    await expect(Effect.runPromise(runtime.view(workspaceRef, "routeMatches"))).resolves.toEqual([
      { path: "config/demo.json", schemaId: "Configs", format: "json" },
      { path: "notes/readme.md", schemaId: null, format: "json" },
    ]);
    await expect(
      Effect.runPromise(runtime.view(workspaceRef, "reflection")),
    ).resolves.toMatchObject({
      mode: "workspace",
      activeFile: "config/demo.json",
      schemas: [{ id: "Configs", match: "config/*.json" }],
      validationSummary: { valid: true, errorCount: 0, warningCount: 1 },
      diagnostics: [
        {
          path: "notes/readme.md",
          severity: "warning",
          source: "workspace",
          message: "File did not match any workspace schema route",
        },
      ],
    });
    await expect(Effect.runPromise(runtime.view(fileRef, "decodedValue"))).resolves.toEqual({
      name: "Demo",
      enabled: true,
    });
  });

  it("exposes schema-algebra graph and diagnostics as artifact views", async () => {
    const FormSchema = Schema.Struct({
      id: Relation.id("Form"),
    });
    const PolicySchema = Schema.Struct({
      id: Relation.id("Policy"),
      formId: Relation.ref("Form"),
    });
    const WorkspaceSchema = Workspace.Struct({
      forms: Workspace.files("forms/*.json", FormSchema).pipe(Workspace.values()),
      policies: Workspace.files("policies/*.json", PolicySchema).pipe(Workspace.values()),
    });
    const RelationWorkspaceSchema = Schema.Struct({
      forms: Schema.Array(FormSchema),
      policies: Schema.Array(PolicySchema),
    });
    const runtime = createSchemaIdeArtifactRuntime({
      schema: WorkspaceSchema,
      relationSchema: RelationWorkspaceSchema,
      activeFile: "policies/check.json",
      activeFormat: "json",
      files: [
        { path: "forms/intake.json", content: '{"id":"intake"}\n' },
        { path: "policies/check.json", content: '{"id":"check","formId":"missing"}\n' },
      ],
    });
    const workspaceRef = ArtifactRef.workspace();
    const formRef = ArtifactRef.workspaceFile("forms/intake.json");
    const policyRef = ArtifactRef.workspaceFile("policies/check.json");

    await expect(Effect.runPromise(runtime.view(workspaceRef, "relationGraph"))).resolves.toEqual({
      definitions: [
        {
          type: "Form",
          id: "intake",
          path: ["forms", "0", "id"],
          scope: undefined,
          display: undefined,
        },
        {
          type: "Policy",
          id: "check",
          path: ["policies", "0", "id"],
          scope: undefined,
          display: undefined,
        },
      ],
      references: [
        {
          target: "Form",
          id: "missing",
          path: ["policies", "0", "formId"],
          scope: undefined,
          scopedBy: undefined,
          edge: undefined,
          valueKind: "id",
        },
      ],
    });
    await expect(Effect.runPromise(runtime.view(workspaceRef, "entityIndex"))).resolves.toEqual([
      {
        type: "Form",
        id: "intake",
        scope: undefined,
        definitions: [
          {
            type: "Form",
            id: "intake",
            path: ["forms", "0", "id"],
            scope: undefined,
            display: undefined,
          },
        ],
      },
      {
        type: "Policy",
        id: "check",
        scope: undefined,
        definitions: [
          {
            type: "Policy",
            id: "check",
            path: ["policies", "0", "id"],
            scope: undefined,
            display: undefined,
          },
        ],
      },
    ]);
    await expect(
      Effect.runPromise(runtime.view(workspaceRef, "definitionLocations")),
    ).resolves.toEqual([
      {
        type: "Form",
        id: "intake",
        path: ["forms", "0", "id"],
        scope: undefined,
        display: undefined,
      },
      {
        type: "Policy",
        id: "check",
        path: ["policies", "0", "id"],
        scope: undefined,
        display: undefined,
      },
    ]);
    await expect(Effect.runPromise(runtime.view(workspaceRef, "references"))).resolves.toEqual([
      {
        target: "Form",
        id: "missing",
        path: ["policies", "0", "formId"],
        scope: undefined,
        scopedBy: undefined,
        edge: undefined,
        valueKind: "id",
      },
    ]);
    await expect(
      Effect.runPromise(runtime.view(workspaceRef, "relationDiagnostics")),
    ).resolves.toEqual([
      expect.objectContaining({
        code: "unresolved-ref",
        path: ["policies", "0", "formId"],
        message: 'Unresolved Form reference "missing"',
      }),
    ]);
    await expect(
      Effect.runPromise(runtime.view(workspaceRef, "referenceDiagnostics")),
    ).resolves.toEqual([
      expect.objectContaining({
        code: "unresolved-ref",
        path: ["policies", "0", "formId"],
        message: 'Unresolved Form reference "missing"',
      }),
    ]);
    await expect(
      Effect.runPromise(runtime.view(workspaceRef, "patchSuggestions")),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: "create-definition",
        target: "Form",
        id: "missing",
        path: ["policies", "0", "formId"],
      }),
    ]);
    await expect(Effect.runPromise(runtime.view(formRef, "relationGraph"))).resolves.toEqual({
      definitions: [
        {
          type: "Form",
          id: "intake",
          path: ["id"],
          scope: undefined,
          display: undefined,
        },
      ],
      references: [],
    });
    await expect(Effect.runPromise(runtime.view(formRef, "entityIndex"))).resolves.toEqual([
      {
        type: "Form",
        id: "intake",
        scope: undefined,
        definitions: [
          {
            type: "Form",
            id: "intake",
            path: ["id"],
            scope: undefined,
            display: undefined,
          },
        ],
      },
    ]);
    await expect(Effect.runPromise(runtime.view(policyRef, "references"))).resolves.toEqual([
      {
        target: "Form",
        id: "missing",
        path: ["formId"],
        scope: undefined,
        scopedBy: undefined,
        edge: undefined,
        valueKind: "id",
      },
    ]);
    await expect(Effect.runPromise(runtime.view(formRef, "relationDiagnostics"))).resolves.toEqual(
      [],
    );
    await expect(
      Effect.runPromise(runtime.view(policyRef, "relationDiagnostics")),
    ).resolves.toEqual([
      expect.objectContaining({
        code: "unresolved-ref",
        path: ["formId"],
        message: 'Unresolved Form reference "missing"',
      }),
    ]);
    await expect(
      Effect.runPromise(runtime.view(policyRef, "referenceDiagnostics")),
    ).resolves.toEqual([
      expect.objectContaining({
        code: "unresolved-ref",
        path: ["formId"],
        message: 'Unresolved Form reference "missing"',
      }),
    ]);
    await expect(Effect.runPromise(runtime.view(policyRef, "patchSuggestions"))).resolves.toEqual([
      expect.objectContaining({
        kind: "create-definition",
        target: "Form",
        id: "missing",
        path: ["formId"],
      }),
    ]);
    await expect(Effect.runPromise(runtime.relationDiagnostics)).resolves.toHaveLength(1);
    await expect(Effect.runPromise(runtime.referenceDiagnostics)).resolves.toHaveLength(1);
    await expect(Effect.runPromise(runtime.patchSuggestions)).resolves.toHaveLength(1);
  });

  it("exposes schema-algebra views from an artifact project without Workspace.Struct", async () => {
    const FormSchema = Schema.Struct({
      id: Relation.id("Form"),
    });
    const PolicySchema = Schema.Struct({
      id: Relation.id("Policy"),
      formId: Relation.ref("Form"),
    });
    const RelationWorkspaceSchema = Schema.Struct({
      forms: Schema.Array(FormSchema),
      policies: Schema.Array(PolicySchema),
    });
    const Project = ArtifactProject.make("relation-project")
      .files("forms/*.json", {
        id: "Forms",
        type: SchemaIdeWorkspaceFileArtifact,
        schema: FormSchema,
        metadata: {
          attributes: {
            schemaId: "Forms",
            workspaceField: "forms",
            values: true,
          },
        },
      })
      .files("policies/*.json", {
        id: "Policies",
        type: SchemaIdeWorkspaceFileArtifact,
        schema: PolicySchema,
        metadata: {
          attributes: {
            schemaId: "Policies",
            workspaceField: "policies",
            values: true,
          },
        },
      });
    const runtime = createSchemaIdeArtifactRuntime({
      project: Project,
      relationSchema: RelationWorkspaceSchema,
      workspaceId: "relation-project",
      activeFile: "policies/check.json",
      activeFormat: "json",
      files: [
        { path: "forms/intake.json", content: '{"id":"intake"}\n' },
        { path: "policies/check.json", content: '{"id":"check","formId":"missing"}\n' },
      ],
    });
    const workspaceRef = ArtifactRef.workspace("relation-project");
    const policyRef = ArtifactRef.workspaceFile("policies/check.json", "relation-project");

    await expect(
      Effect.runPromise(runtime.view(workspaceRef, "decodedWorkspace")),
    ).resolves.toEqual({
      forms: [{ id: "intake" }],
      policies: [{ id: "check", formId: "missing" }],
    });
    await expect(Effect.runPromise(runtime.view(workspaceRef, "relationGraph"))).resolves.toEqual({
      definitions: [
        expect.objectContaining({ type: "Form", id: "intake", path: ["forms", "0", "id"] }),
        expect.objectContaining({ type: "Policy", id: "check", path: ["policies", "0", "id"] }),
      ],
      references: [
        expect.objectContaining({
          target: "Form",
          id: "missing",
          path: ["policies", "0", "formId"],
        }),
      ],
    });
    await expect(
      Effect.runPromise(runtime.view(workspaceRef, "referenceDiagnostics")),
    ).resolves.toEqual([
      expect.objectContaining({
        code: "unresolved-ref",
        path: ["policies", "0", "formId"],
      }),
    ]);
    await expect(Effect.runPromise(runtime.view(policyRef, "references"))).resolves.toEqual([
      expect.objectContaining({ target: "Form", id: "missing", path: ["formId"] }),
    ]);
    await expect(Effect.runPromise(runtime.view(policyRef, "patchSuggestions"))).resolves.toEqual([
      expect.objectContaining({
        kind: "create-definition",
        target: "Form",
        id: "missing",
        path: ["formId"],
      }),
    ]);
  });

  it("derives completions, hover, and quick fixes from generated JSON Schema", () => {
    const schema = Schema.Struct({
      id: Schema.String.annotate({ description: "Stable identifier" }),
      kind: Schema.Literal("survey", "workflow"),
      enabled: Schema.Boolean,
    }).annotate({ title: "Config" });
    const files = [{ path: "config.json", content: '{"id":"demo"}\n' }];
    const validation = validateSchemaIdeValue({
      schema,
      files,
      activeFile: "config.json",
      activeFormat: "json",
    });
    const reflection = createReflection({
      schema,
      files,
      activeFile: "config.json",
      activeFormat: "json",
      validation,
    });

    expect(reflection.activeJsonSchema).toMatchObject({
      type: "object",
      required: ["id", "kind", "enabled"],
    });

    expect(
      getSchemaIdeCompletions({
        reflection,
        path: "config.json",
        content: files[0]!.content,
      })?.options.map((option) => option.label),
    ).toEqual(["kind", "enabled"]);

    expect(
      getSchemaIdeHover({
        reflection,
        path: "config.json",
        content: files[0]!.content,
        offset: files[0]!.content.indexOf("id") + 1,
      })?.content,
    ).toContain("Stable identifier");

    expect(
      getSchemaIdeQuickFixes({
        reflection,
        path: "config.json",
        content: files[0]!.content,
      }).map((fix) => fix.title),
    ).toEqual(['Add required field "kind"', 'Add required field "enabled"']);
  });

  it("builds schema-driven cross-file definition and reference locations", () => {
    const FormSchema = Schema.Struct({ id: Schema.String });
    const PolicySchema = Schema.Struct({ id: Schema.String, formId: Schema.String });
    const WorkspaceSchema = Workspace.Struct({
      forms: Workspace.files("forms/*.json", FormSchema),
      policies: Workspace.files("policies/*.json", PolicySchema),
    });
    const files = [
      { path: "forms/intake.json", content: '{"id":"intake"}\n' },
      { path: "policies/check.json", content: '{"id":"check","formId":"intake"}\n' },
    ];
    const validation = validateSchemaIdeValue({
      schema: WorkspaceSchema,
      files,
      activeFile: "policies/check.json",
      activeFormat: "json",
    });
    const reflection = createReflection({
      schema: WorkspaceSchema,
      files,
      activeFile: "policies/check.json",
      activeFormat: "json",
      validation,
    });

    const offset = files[1]!.content.lastIndexOf("intake") + 1;
    expect(
      getSchemaIdeDefinitions({
        reflection,
        path: "policies/check.json",
        content: files[1]!.content,
        offset,
      }).map((definition) => definition.path),
    ).toEqual(["forms/intake.json"]);
  });
});

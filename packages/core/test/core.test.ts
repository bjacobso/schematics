import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { PDFDocument } from "pdf-lib";
import { ArtifactRef, createMemoryArtifactCache, type ArtifactCache } from "@schematics/artifacts";
import { Relation } from "@schematics/algebra";
import {
  Artifacts,
  ArtifactProject,
  SchematicsImageArtifact,
  SchematicsPdfArtifact,
  SchematicsProjectFileArtifact,
  Project,
  createReflection,
  createArtifactProjectFromProjectSchema,
  createSchematicsArtifactRuntime,
  createProjectSchemaFromArtifactProject,
  getSchematicsCompletions,
  getSchematicsDefinitions,
  getSchematicsHover,
  getSchematicsQuickFixes,
  parseYaml,
  validateSchematicsValue,
  validateSingleDocument,
  type ProjectRoutes,
} from "../src";

const ConfigSchema = Schema.Struct({
  name: Schema.String,
  enabled: Schema.Boolean,
});

describe("schematics-core", () => {
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
    const ProjectSchema = Project.Struct({
      forms: Project.files("forms/*.json", FormSchema).pipe(Project.indexBy("id")),
      policies: Project.files("policies/*.json", PolicySchema).pipe(Project.indexBy("id")),
    }).pipe(
      Project.validate<any>("refs", ({ forms, policies }, issue) => {
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

    const result = validateSchematicsValue({
      schema: ProjectSchema,
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
    const ProjectSchema = Project.Struct({
      configs: Project.files("config/*.json", ConfigSchema).pipe(Project.indexBy("name")),
    });

    const result = validateSchematicsValue({
      schema: ProjectSchema,
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

  it("keeps Project.Struct validation aligned with artifact validation", async () => {
    const ActionSchema = Schema.Struct({
      id: Schema.String,
      label: Schema.String,
    });
    const ProjectSchema = Project.Struct({
      actions: Project.files("actions/*.json", ActionSchema).pipe(Project.indexBy("id")),
    });
    const files = [
      {
        path: "actions/email.json",
        content: '{"id":"email","label":"Send email"}\n',
      },
    ];
    const validation = validateSchematicsValue({
      schema: ProjectSchema,
      files,
      activeFile: "actions/email.json",
      activeFormat: "json",
    });
    const reflection = await Effect.runPromise(
      Artifacts.validate({
        schema: ProjectSchema,
        files,
        activeFile: "actions/email.json",
        activeFormat: "json",
      }),
    );

    expect(reflection.decodedValue).toEqual(validation.value);
    expect(reflection.diagnostics).toEqual(validation.diagnostics);
    expect(reflection.routeMatches).toEqual(validation.routeMatches);
    expect(reflection.validationSummary).toEqual(validation.summary);
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

    const ProjectSchema = Project.Struct({
      actions: Project.files("actions/*.json", ActionSchema).pipe(
        Project.annotations({ identifier: "Actions" }),
        Project.indexBy("id"),
      ),
      workflows: Project.files("workflows/*.json", WorkflowSchema).pipe(
        Project.values(),
        Project.annotations({ identifier: "Workflows" }),
      ),
    });

    expectTypeOf<ProjectRoutes<typeof ProjectSchema>>().toEqualTypeOf<{
      Actions: Action;
      Workflows: Workflow;
    }>();
    expect(ProjectSchema.reflect().map((schema) => schema.id)).toEqual(["Actions", "Workflows"]);
  });

  it("derives artifact project routes from Project.Struct reflection", () => {
    const ActionSchema = Schema.Struct({
      id: Schema.String,
      label: Schema.String,
    }).annotate({ title: "Action" });
    const WorkflowSchema = Schema.Struct({
      id: Schema.String,
      actionIds: Schema.Array(Schema.String),
    });
    const ProjectSchema = Project.Struct({
      actions: Project.files("actions/*.json", ActionSchema).pipe(
        Project.annotations({
          identifier: "Actions",
          description: "Workflow action definitions",
        }),
        Project.indexBy("id"),
      ),
      workflows: Project.files("workflows/*.json", WorkflowSchema).pipe(
        Project.annotations({ identifier: "Workflows" }),
        Project.values(),
      ),
    });

    const project = createArtifactProjectFromProjectSchema(ProjectSchema, { name: "workflow" });

    expect(project.capabilities(ArtifactRef.project()).map((capability) => capability.id)).toEqual([
      "workflow.project.decodedWorkspace",
      "workflow.project.diagnostics",
      "workflow.project.validationSummary",
      "workflow.project.routeMatches",
      "workflow.project.reflection",
      "workflow.project.relationGraph",
      "workflow.project.entityIndex",
      "workflow.project.definitionLocations",
      "workflow.project.references",
      "workflow.project.relationDiagnostics",
      "workflow.project.referenceDiagnostics",
      "workflow.project.patchSuggestions",
    ]);
    expect(
      project.capabilities(ArtifactRef.projectFile("actions/email.json")).map((capability) => ({
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
    expect(project.route(ArtifactRef.projectFile("notes/readme.md"))).toEqual([]);
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

  it("derives Project.Struct compatibility from artifact project routes", () => {
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
        type: SchematicsProjectFileArtifact,
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
        type: SchematicsProjectFileArtifact,
        schema: WorkflowSchema,
        metadata: {
          attributes: {
            workspaceField: "workflows",
            values: true,
          },
        },
      });

    const ProjectSchema = createProjectSchemaFromArtifactProject(project);
    const decoded = ProjectSchema.decode({
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
    expect(ProjectSchema.reflect().map((schema) => schema.id)).toEqual(["Actions", "Workflows"]);
    expect(ProjectSchema.reflect()[0]?.description).toBe("Workflow action definitions");
  });

  it("projects route mode from route config when attributes are absent", () => {
    // Mode lives only in route.config (no mirrored `single`/`values` attribute
    // flags), the shape produced by serializable project configs. The projection
    // must honor route.config rather than defaulting every route to "files".
    const project = ArtifactProject.make("config-mode")
      .files("items/*.json", {
        id: "items",
        type: SchematicsProjectFileArtifact,
        schema: ConfigSchema,
        config: {
          id: "items",
          pattern: "items/*.json",
          artifact: "config",
          mode: "values",
          workspaceField: "items",
        },
      })
      .files("active/*.json", {
        id: "active",
        type: SchematicsProjectFileArtifact,
        schema: ConfigSchema,
        config: {
          id: "active",
          pattern: "active/*.json",
          artifact: "config",
          mode: "file",
          workspaceField: "active",
        },
      });

    const ProjectSchema = createProjectSchemaFromArtifactProject(project);
    const decoded = ProjectSchema.decode({
      files: [
        { path: "items/a.json", content: '{"name":"A","enabled":true}' },
        { path: "items/b.json", content: '{"name":"B","enabled":false}' },
        { path: "active/current.json", content: '{"name":"Current","enabled":true}' },
      ],
    });

    expect(decoded.summary.valid).toBe(true);
    // mode "values" -> a flat array of decoded values
    expect((decoded.value as any)?.items).toEqual([
      { name: "A", enabled: true },
      { name: "B", enabled: false },
    ]);
    // mode "file" -> a single decoded value, not an array
    expect((decoded.value as any)?.active).toEqual({ name: "Current", enabled: true });
  });

  it("suppresses project diagnostics when schema validation already errored", async () => {
    const ProjectSchema = Project.Struct({
      configs: Project.files("config/*.json", ConfigSchema),
    });
    const projectDiagnostics = () => [
      {
        path: null,
        severity: "warning" as const,
        message: "PROJECT_CHECK",
        source: "cross-file" as const,
      },
    ];
    const workspaceRef = ArtifactRef.project();

    // Valid files: the decoded value is clean, so project-level validators run.
    const valid = createSchematicsArtifactRuntime({
      schema: ProjectSchema,
      activeFile: "config/demo.json",
      activeFormat: "json",
      files: [{ path: "config/demo.json", content: '{"name":"Demo","enabled":true}' }],
      projectDiagnostics,
    });
    const validDiagnostics = (await Effect.runPromise(
      valid.view(workspaceRef, "diagnostics"),
    )) as readonly { readonly message: string }[];
    expect(validDiagnostics.map((diagnostic) => diagnostic.message)).toContain("PROJECT_CHECK");

    // A schema error yields only a partial value, so project-level validators are
    // skipped to avoid cascading false positives — only the schema error surfaces.
    const errored = createSchematicsArtifactRuntime({
      schema: ProjectSchema,
      activeFile: "config/demo.json",
      activeFormat: "json",
      files: [{ path: "config/demo.json", content: '{"name":"Demo","enabled":"nope"}' }],
      projectDiagnostics,
    });
    const erroredDiagnostics = (await Effect.runPromise(
      errored.view(workspaceRef, "diagnostics"),
    )) as readonly { readonly message: string; readonly severity: string }[];
    expect(erroredDiagnostics.map((diagnostic) => diagnostic.message)).not.toContain(
      "PROJECT_CHECK",
    );
    expect(erroredDiagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
  });

  it("exposes artifact/workspace compatibility helpers from the core facade", () => {
    const ActionSchema = Schema.Struct({
      id: Schema.String,
      label: Schema.String,
    });
    const ProjectSchema = Project.Struct({
      actions: Project.files("actions/*.json", ActionSchema).pipe(
        Project.annotations({ identifier: "Actions" }),
        Project.indexBy("id"),
      ),
    });

    const project = ArtifactProject.fromProjectSchema(ProjectSchema, { name: "workflow" });
    const ProjectedWorkspace = Project.fromArtifactProject(project);
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
    const ProjectFileSchema = Schema.Struct({ id: Schema.String, title: Schema.String });
    const ActionSchema = Schema.Struct({ id: Schema.String, label: Schema.String });
    const WorkflowSchema = Schema.Struct({
      id: Schema.String,
      actionIds: Schema.Array(Schema.String),
    });
    const NoteSchema = Schema.Struct({ id: Schema.String, body: Schema.String });
    const OptionalSchema = Schema.Struct({ enabled: Schema.Boolean });
    const ProjectSchema = Project.Struct({
      project: Project.file("project.json", ProjectFileSchema).pipe(
        Project.annotations({ identifier: "Project", description: "Project metadata" }),
      ),
      optionalSettings: Project.file("settings.json", OptionalSchema, { optional: true }).pipe(
        Project.annotations({ identifier: "Settings", description: "Optional settings" }),
      ),
      actions: Project.files("actions/*.json", ActionSchema).pipe(
        Project.annotations({ identifier: "Actions", description: "Action definitions" }),
        Project.indexBy("id"),
      ),
      workflows: Project.files("workflows/*.json", WorkflowSchema).pipe(
        Project.annotations({ identifier: "Workflows", description: "Workflow definitions" }),
        Project.values(),
      ),
      notes: Project.files("notes/*.json", NoteSchema).pipe(
        Project.annotations({ identifier: "Notes", description: "Raw note file entries" }),
      ),
    });

    const project = ArtifactProject.fromProjectSchema(ProjectSchema, { name: "route-parity" });
    const ProjectedWorkspace = Project.fromArtifactProject(project);
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

  it("exposes workspace validation and reflection as artifact views", async () => {
    const ProjectSchema = Project.Struct({
      configs: Project.files("config/*.json", ConfigSchema).pipe(Project.indexBy("name")),
    });
    const runtime = createSchematicsArtifactRuntime({
      schema: ProjectSchema,
      activeFile: "config/demo.json",
      activeFormat: "json",
      files: [{ path: "config/demo.json", content: '{"name":"Demo","enabled":true}' }],
    });
    const workspaceRef = ArtifactRef.project();
    const fileRef = ArtifactRef.projectFile("config/demo.json");

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
    expect(runtime.project.name).toBe("schematics");
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

  it("exposes real PDF inspection and text extraction as non-schema artifact views", async () => {
    // A real FlateDecode-compressed PDF shipped with the survey example.
    const pdfPath = fileURLToPath(
      new URL("../../../examples/survey/files/forms/intake.pdf", import.meta.url),
    );
    const content = readFileSync(pdfPath, "latin1");

    const project = ArtifactProject.make("documents").files(
      "documents/*.pdf",
      SchematicsPdfArtifact,
      { id: "pdfDocuments" },
    );
    const runtime = createSchematicsArtifactRuntime({
      project,
      activeFile: "documents/intake.pdf",
      activeFormat: "json",
      files: [{ path: "documents/intake.pdf", content }],
    });
    const ref = ArtifactRef.projectFile("documents/intake.pdf");

    const views = runtime.capabilities(ref).map((capability) => capability.view);
    expect(views).toContain("inspect");
    expect(views).toContain("extractText");

    const inspection = (await Effect.runPromise(runtime.view(ref, "inspect"))) as {
      kind: string;
      pageCount: number;
      headerVersion: string | null;
      pages: readonly { page: number; width: number; height: number }[];
    };
    expect(inspection.kind).toBe("pdf");
    expect(inspection.headerVersion).toBe("1.7");
    expect(inspection.pageCount).toBeGreaterThanOrEqual(1);
    expect(inspection.pages[0]?.width).toBeGreaterThan(0);

    const extraction = (await Effect.runPromise(runtime.view(ref, "extractText"))) as {
      kind: string;
      extractable: boolean;
      text: string;
      pages: readonly { page: number; text: string }[];
    };
    expect(extraction.kind).toBe("pdf-text");
    expect(extraction.extractable).toBe(true);
    // Real text recovered from the FlateDecode-compressed content stream.
    expect(extraction.text.toLowerCase()).toContain("inspection");
    expect(extraction.pages).toHaveLength(inspection.pageCount);
  });

  it("exposes image inspection as a second non-schema artifact type", async () => {
    // A real 1×1 PNG (data-URL) and an SVG with explicit dimensions.
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"></svg>';

    const project = ArtifactProject.make("media")
      .files("media/*.png", SchematicsImageArtifact, { id: "pngs" })
      .files("media/*.svg", SchematicsImageArtifact, { id: "svgs" });
    const runtime = createSchematicsArtifactRuntime({
      project,
      activeFile: "media/dot.png",
      activeFormat: "json",
      files: [
        { path: "media/dot.png", content: png },
        { path: "media/box.svg", content: svg },
      ],
    });

    const pngRef = ArtifactRef.projectFile("media/dot.png");
    expect(runtime.capabilities(pngRef).map((capability) => capability.view)).toContain("inspect");
    await expect(Effect.runPromise(runtime.view(pngRef, "inspect"))).resolves.toMatchObject({
      kind: "image",
      format: "png",
      width: 1,
      height: 1,
    });

    const svgRef = ArtifactRef.projectFile("media/box.svg");
    await expect(Effect.runPromise(runtime.view(svgRef, "inspect"))).resolves.toMatchObject({
      kind: "image",
      format: "svg",
      width: 120,
      height: 80,
    });
  });

  it("serves a content-hash view from a shared cache across runtime instances", async () => {
    // Instrument a cache so we can observe writes (= handler ran + decoded).
    const base = createMemoryArtifactCache();
    let stores = 0;
    const cache: ArtifactCache = {
      lookup: base.lookup,
      store: (key, value) => {
        stores += 1;
        return base.store(key, value);
      },
    };

    const intakePdf = readFileSync(
      fileURLToPath(new URL("../../../examples/survey/files/forms/intake.pdf", import.meta.url)),
      "latin1",
    );
    // A second, distinct valid PDF so the content-hash key changes on "edit".
    const otherDoc = await PDFDocument.create();
    otherDoc.addPage();
    const otherPdf = Buffer.from(await otherDoc.save()).toString("latin1");

    const project = ArtifactProject.make("documents").files(
      "documents/*.pdf",
      SchematicsPdfArtifact,
      { id: "pdfDocuments" },
    );
    const files = [{ path: "documents/sample.pdf", content: intakePdf }];
    const ref = ArtifactRef.projectFile("documents/sample.pdf");

    // A fresh runtime per call mirrors the Durable Object, which rebuilds the
    // runtime each request but shares one cache instance.
    const runOnce = () =>
      Effect.runPromise(
        createSchematicsArtifactRuntime({
          project,
          activeFile: "documents/sample.pdf",
          activeFormat: "json",
          files,
          cache,
        }).view(ref, "inspect"),
      );

    const first = await runOnce();
    const second = await runOnce();

    expect(second).toEqual(first);
    expect(stores).toBe(1); // second runtime hit the shared cache; handler ran once

    // Editing the file changes its content hash, so the cache key misses again.
    files[0] = { path: "documents/sample.pdf", content: otherPdf };
    await runOnce();
    expect(stores).toBe(2);
  });

  it("runs workspace validation and reflection from an artifact project without Project.Struct", async () => {
    const artifactProject = ArtifactProject.make("project-only").files("config/*.json", {
      id: "Configs",
      type: SchematicsProjectFileArtifact,
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
    const runtime = createSchematicsArtifactRuntime({
      project: artifactProject,
      activeFile: "config/demo.json",
      activeFormat: "json",
      projectId: "project-only",
      files: [
        { path: "config/demo.json", content: '{"name":"Demo","enabled":true}' },
        { path: "notes/readme.md", content: "# Notes\n" },
      ],
    });
    const workspaceRef = ArtifactRef.project("project-only");
    const fileRef = ArtifactRef.projectFile("config/demo.json", "project-only");

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

  it("exposes algebra graph and diagnostics as artifact views", async () => {
    const FormSchema = Schema.Struct({
      id: Relation.id("Form"),
    });
    const PolicySchema = Schema.Struct({
      id: Relation.id("Policy"),
      formId: Relation.ref("Form"),
    });
    const ProjectSchema = Project.Struct({
      forms: Project.files("forms/*.json", FormSchema).pipe(Project.values()),
      policies: Project.files("policies/*.json", PolicySchema).pipe(Project.values()),
    });
    const RelationProjectSchema = Schema.Struct({
      forms: Schema.Array(FormSchema),
      policies: Schema.Array(PolicySchema),
    });
    const runtime = createSchematicsArtifactRuntime({
      schema: ProjectSchema,
      relationSchema: RelationProjectSchema,
      activeFile: "policies/check.json",
      activeFormat: "json",
      files: [
        { path: "forms/intake.json", content: '{"id":"intake"}\n' },
        { path: "policies/check.json", content: '{"id":"check","formId":"missing"}\n' },
      ],
    });
    const workspaceRef = ArtifactRef.project();
    const formRef = ArtifactRef.projectFile("forms/intake.json");
    const policyRef = ArtifactRef.projectFile("policies/check.json");

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

  it("exposes algebra views from an artifact project without Project.Struct", async () => {
    const FormSchema = Schema.Struct({
      id: Relation.id("Form"),
    });
    const PolicySchema = Schema.Struct({
      id: Relation.id("Policy"),
      formId: Relation.ref("Form"),
    });
    const RelationProjectSchema = Schema.Struct({
      forms: Schema.Array(FormSchema),
      policies: Schema.Array(PolicySchema),
    });
    const artifactProject = ArtifactProject.make("relation-project")
      .files("forms/*.json", {
        id: "Forms",
        type: SchematicsProjectFileArtifact,
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
        type: SchematicsProjectFileArtifact,
        schema: PolicySchema,
        metadata: {
          attributes: {
            schemaId: "Policies",
            workspaceField: "policies",
            values: true,
          },
        },
      });
    const runtime = createSchematicsArtifactRuntime({
      project: artifactProject,
      relationSchema: RelationProjectSchema,
      projectId: "relation-project",
      activeFile: "policies/check.json",
      activeFormat: "json",
      files: [
        { path: "forms/intake.json", content: '{"id":"intake"}\n' },
        { path: "policies/check.json", content: '{"id":"check","formId":"missing"}\n' },
      ],
    });
    const workspaceRef = ArtifactRef.project("relation-project");
    const policyRef = ArtifactRef.projectFile("policies/check.json", "relation-project");

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
    const validation = validateSchematicsValue({
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
      getSchematicsCompletions({
        reflection,
        path: "config.json",
        content: files[0]!.content,
      })?.options.map((option) => option.label),
    ).toEqual(["kind", "enabled"]);

    expect(
      getSchematicsHover({
        reflection,
        path: "config.json",
        content: files[0]!.content,
        offset: files[0]!.content.indexOf("id") + 1,
      })?.content,
    ).toContain("Stable identifier");

    expect(
      getSchematicsQuickFixes({
        reflection,
        path: "config.json",
        content: files[0]!.content,
      }).map((fix) => fix.title),
    ).toEqual(['Add required field "kind"', 'Add required field "enabled"']);
  });

  it("builds schema-driven cross-file definition and reference locations", () => {
    const FormSchema = Schema.Struct({ id: Schema.String });
    const PolicySchema = Schema.Struct({ id: Schema.String, formId: Schema.String });
    const ProjectSchema = Project.Struct({
      forms: Project.files("forms/*.json", FormSchema),
      policies: Project.files("policies/*.json", PolicySchema),
    });
    const files = [
      { path: "forms/intake.json", content: '{"id":"intake"}\n' },
      { path: "policies/check.json", content: '{"id":"check","formId":"intake"}\n' },
    ];
    const validation = validateSchematicsValue({
      schema: ProjectSchema,
      files,
      activeFile: "policies/check.json",
      activeFormat: "json",
    });
    const reflection = createReflection({
      schema: ProjectSchema,
      files,
      activeFile: "policies/check.json",
      activeFormat: "json",
      validation,
    });

    const offset = files[1]!.content.lastIndexOf("intake") + 1;
    expect(
      getSchematicsDefinitions({
        reflection,
        path: "policies/check.json",
        content: files[1]!.content,
        offset,
      }).map((definition) => definition.path),
    ).toEqual(["forms/intake.json"]);
  });
});

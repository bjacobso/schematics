import { describe, expect, expectTypeOf, it } from "vitest";
import { Schema } from "effect";
import {
  Workspace,
  applyWorkspaceChange,
  createReflection,
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

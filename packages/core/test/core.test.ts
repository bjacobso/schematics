import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  Workspace,
  applyWorkspaceChange,
  compareWorkspaceBranches,
  compareWorkspaceFiles,
  createReflection,
  createVersionedWorkspace,
  createWorkspaceBranch,
  getSchemaIdeCompletions,
  getSchemaIdeDefinitions,
  getSchemaIdeHover,
  getSchemaIdeQuickFixes,
  mergeWorkspaceBranch,
  mergeWorkspaceFiles,
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

  it("creates draft workspace branches from an explicit main branch", () => {
    const main = createWorkspaceBranch({
      id: "main",
      files: [{ path: "config.json", content: '{"name":"Demo","enabled":true}' }],
      createdAt: 1,
    });
    const editedMain = {
      ...main,
      metadata: { ...main.metadata, headRevisionId: "rev-1" },
    };

    const draft = createWorkspaceBranch({
      id: "draft-1",
      sourceBranch: editedMain,
      createdAt: 2,
      createdBy: "agent",
      title: "Agent draft",
    });

    expect(draft.metadata).toMatchObject({
      id: "draft-1",
      name: "draft-1",
      kind: "draft",
      baseBranchId: "main",
      baseRevisionId: "rev-1",
      headRevisionId: null,
      createdAt: 2,
      updatedAt: 2,
      createdBy: "agent",
      title: "Agent draft",
    });
    expect(draft.workspace.files).toEqual(main.workspace.files);
    expect(draft.workspace.revisions).toEqual([]);
  });

  it("compares workspace files and detects simple renames", () => {
    expect(
      compareWorkspaceFiles(
        [
          { path: "a.json", content: "{}\n" },
          { path: "b.json", content: '{"old":true}\n' },
        ],
        [
          { path: "renamed.json", content: "{}\n" },
          { path: "b.json", content: '{"old":false}\n' },
          { path: "c.json", content: "[]\n" },
        ],
      ),
    ).toEqual([
      {
        type: "renamed",
        fromPath: "a.json",
        toPath: "renamed.json",
        before: { path: "a.json", content: "{}\n" },
        after: { path: "renamed.json", content: "{}\n" },
      },
      {
        type: "modified",
        path: "b.json",
        before: { path: "b.json", content: '{"old":true}\n' },
        after: { path: "b.json", content: '{"old":false}\n' },
      },
      { type: "added", path: "c.json", after: { path: "c.json", content: "[]\n" } },
    ]);
  });

  it("merges workspace file changes with path-level three-way semantics", () => {
    const baseFiles = [
      { path: "same.json", content: "{}\n" },
      { path: "target.json", content: '{"value":"base"}\n' },
      { path: "source.json", content: '{"value":"base"}\n' },
      { path: "deleted.json", content: '{"delete":true}\n' },
    ];
    const result = mergeWorkspaceFiles({
      baseFiles,
      targetFiles: [
        { path: "same.json", content: "{}\n" },
        { path: "target.json", content: '{"value":"target"}\n' },
        { path: "source.json", content: '{"value":"base"}\n' },
      ],
      sourceFiles: [
        { path: "same.json", content: "{}\n" },
        { path: "target.json", content: '{"value":"base"}\n' },
        { path: "source.json", content: '{"value":"source"}\n' },
        { path: "created.json", content: '{"created":true}\n' },
      ],
    });

    expect(result).toEqual({
      status: "merged",
      files: [
        { path: "created.json", content: '{"created":true}\n' },
        { path: "same.json", content: "{}\n" },
        { path: "source.json", content: '{"value":"source"}\n' },
        { path: "target.json", content: '{"value":"target"}\n' },
      ],
    });
  });

  it("reports merge conflicts without changing either branch", () => {
    const main = createWorkspaceBranch({
      id: "main",
      files: [{ path: "config.json", content: '{"name":"Base"}\n' }],
      createdAt: 1,
    });
    const draftBase = createWorkspaceBranch({ id: "draft", sourceBranch: main, createdAt: 2 });
    const targetWorkspace = applyWorkspaceChange(
      main.workspace,
      { type: "writeFile", path: "config.json", content: '{"name":"Main"}\n' },
      { actor: "user", label: "Edit main", timestamp: 3 },
    );
    const sourceWorkspace = applyWorkspaceChange(
      draftBase.workspace,
      { type: "writeFile", path: "config.json", content: '{"name":"Draft"}\n' },
      { actor: "agent", label: "Edit draft", timestamp: 4 },
    );
    const targetBranch = {
      ...main,
      metadata: { ...main.metadata, headRevisionId: "rev-1" },
      workspace: targetWorkspace,
    };
    const sourceBranch = {
      ...draftBase,
      metadata: { ...draftBase.metadata, headRevisionId: "rev-1" },
      workspace: sourceWorkspace,
    };

    const result = mergeWorkspaceBranch({
      sourceBranch,
      targetBranch,
      baseFiles: main.workspace.files,
    });

    expect(result.status).toBe("conflicts");
    if (result.status === "conflicts") {
      expect(result.conflicts).toEqual([
        {
          type: "content",
          path: "config.json",
          base: { path: "config.json", content: '{"name":"Base"}\n' },
          source: { path: "config.json", content: '{"name":"Draft"}\n' },
          target: { path: "config.json", content: '{"name":"Main"}\n' },
        },
      ]);
      expect(result.comparison.mergeable).toBe(false);
    }
    expect(targetBranch.workspace.files).toEqual([
      { path: "config.json", content: '{"name":"Main"}\n' },
    ]);
    expect(sourceBranch.workspace.files).toEqual([
      { path: "config.json", content: '{"name":"Draft"}\n' },
    ]);
  });

  it("can resolve merge conflicts with source-wins or target-wins strategies", () => {
    const baseFiles = [{ path: "config.json", content: '{"name":"Base"}\n' }];
    const sourceWins = mergeWorkspaceFiles({
      baseFiles,
      targetFiles: [{ path: "config.json", content: '{"name":"Main"}\n' }],
      sourceFiles: [{ path: "config.json", content: '{"name":"Draft"}\n' }],
      strategy: "source-wins",
    });
    const targetWins = mergeWorkspaceFiles({
      baseFiles,
      targetFiles: [{ path: "config.json", content: '{"name":"Main"}\n' }],
      sourceFiles: [{ path: "config.json", content: '{"name":"Draft"}\n' }],
      strategy: "target-wins",
    });

    expect(sourceWins).toEqual({
      status: "merged",
      files: [{ path: "config.json", content: '{"name":"Draft"}\n' }],
    });
    expect(targetWins).toEqual({
      status: "merged",
      files: [{ path: "config.json", content: '{"name":"Main"}\n' }],
    });
  });

  it("compares and merges draft branches into main", () => {
    const main = createWorkspaceBranch({
      id: "main",
      files: [{ path: "config.json", content: '{"name":"Base"}\n' }],
      createdAt: 1,
    });
    const draftBase = createWorkspaceBranch({ id: "draft", sourceBranch: main, createdAt: 2 });
    const sourceWorkspace = applyWorkspaceChange(
      draftBase.workspace,
      { type: "writeFile", path: "config.json", content: '{"name":"Draft"}\n' },
      { actor: "agent", label: "Edit draft", timestamp: 3 },
    );
    const sourceBranch = {
      ...draftBase,
      metadata: { ...draftBase.metadata, headRevisionId: "rev-1" },
      workspace: sourceWorkspace,
    };

    expect(
      compareWorkspaceBranches({
        sourceBranch,
        targetBranch: main,
        baseFiles: main.workspace.files,
        validationSummary: { valid: true, errorCount: 0, warningCount: 0, infoCount: 0 },
      }),
    ).toMatchObject({
      baseRevisionId: null,
      sourceBranchId: "draft",
      targetBranchId: "main",
      mergeable: true,
      files: [
        {
          type: "modified",
          path: "config.json",
          before: { path: "config.json", content: '{"name":"Base"}\n' },
          after: { path: "config.json", content: '{"name":"Draft"}\n' },
        },
      ],
    });

    const result = mergeWorkspaceBranch({
      sourceBranch,
      targetBranch: main,
      baseFiles: main.workspace.files,
      metadata: { actor: "user", label: "Merge draft", timestamp: 4 },
    });

    expect(result.status).toBe("merged");
    if (result.status === "merged") {
      expect(result.targetBranch.workspace.files).toEqual([
        { path: "config.json", content: '{"name":"Draft"}\n' },
      ]);
      expect(result.targetBranch.metadata).toMatchObject({
        id: "main",
        headRevisionId: "rev-1",
        updatedAt: 4,
      });
      expect(result.targetBranch.workspace.revisions[0]).toMatchObject({
        actor: "user",
        label: "Merge draft",
      });
    }
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

import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { PDFDocument } from "pdf-lib";
import { Effect, Layer, Stream } from "effect";
import {
  createOpenRouterProxyChatAdapter,
  createSchemaIdeChatAdapter,
  executeSchemaIdeToolCall,
  openRouterSchemaIdeTools,
  runSchemaIdeChatEval,
  SchemaIdeToolkit,
  SchemaIdeToolkitLayer,
  SchemaIdeWorkspace,
  SchemaIdeWorkspaceLayer,
  type SchemaIdeReflection,
  type SchemaIdeFileEdit,
  type SchemaIdePatchProposal,
  type SchemaIdeToolCall,
  type SchemaIdeHostRuntime,
} from "../src";
import type { SourceFile } from "@schema-ide/core";

describe("schema-ide-agent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies tool calls to an in-memory workspace", async () => {
    const files: SourceFile[] = [];
    const traces: SchemaIdeToolCall[] = [];
    const requests: unknown[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        const body =
          requests.length === 1
            ? {
                choices: [
                  {
                    message: {
                      content: null,
                      tool_calls: [
                        toolCall("1", "create_file", {
                          path: "forms/intake.json",
                          content: '{"id":"intake","title":"Intake"}\n',
                        }),
                        toolCall("2", "replace_file_content", {
                          path: "forms/intake.json",
                          search: '"Intake"',
                          replace: '"Intake Form"',
                        }),
                        toolCall("3", "validate_workspace", {}),
                      ],
                    },
                  },
                ],
              }
            : { choices: [{ message: { content: "Updated forms/intake.json." } }] };

        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const chat = createOpenRouterProxyChatAdapter({
      proxyUrl: "/proxy",
      defaultModel: "test/model",
      models: [{ id: "test/model", label: "Test Model" }],
    });
    const result = await chat.send({
      message: "Create an intake form file.",
      history: [],
      reflection: reflectionFor(files),
      tools: toolsFor(files),
      model: "test/model",
      onToolCall: (tool) => traces.push(tool),
    }).promise;

    expect(result.message.content).toBe("Updated forms/intake.json.");
    expect(files).toEqual([
      { path: "forms/intake.json", content: '{"id":"intake","title":"Intake Form"}\n' },
    ]);
    expect(traces.filter((trace) => trace.status === "success").map((trace) => trace.name)).toEqual(
      ["create_file", "replace_file_content", "validate_workspace"],
    );
  });

  it("uses the protocol HttpApi client for standalone chat", async () => {
    let requestUrl = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requestUrl = request.url;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Handled by standalone server." } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const chat = createSchemaIdeChatAdapter({
      baseUrl: "http://schema.test",
      defaultModel: "test/model",
      models: [{ id: "test/model", label: "Test Model" }],
    });
    const result = await chat.send({
      message: "Hello",
      history: [],
      reflection: reflectionFor([]),
      tools: toolsFor([]),
      model: "test/model",
    }).promise;

    expect(result.message.content).toBe("Handled by standalone server.");
    expect(requestUrl).toBe("http://schema.test/v1/chat");
  });

  it("defaults the raw proxy adapter to the standalone chat endpoint", async () => {
    let requestUrl = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requestUrl = input instanceof Request ? input.url : String(input);
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const chat = createOpenRouterProxyChatAdapter({
      defaultModel: "test/model",
      models: [{ id: "test/model", label: "Test Model" }],
    });
    await chat.send({
      message: "Hello",
      history: [],
      reflection: reflectionFor([]),
      tools: toolsFor([]),
      model: "test/model",
    }).promise;

    expect(requestUrl).toBe("/v1/chat");
  });

  it("supports atomic apply_edits and non-mutating propose_patch tool calls", async () => {
    const files: SourceFile[] = [{ path: "forms/intake.json", content: '{"id":"intake"}\n' }];
    const traces: SchemaIdeToolCall[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as { tools: readonly any[] };
        expect(request.tools.map((tool) => tool.function.name)).toContain("apply_edits");
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    toolCall("1", "propose_patch", {
                      label: "Add title",
                      edits: [
                        {
                          path: "forms/intake.json",
                          content: '{"id":"intake","title":"Intake"}\n',
                        },
                      ],
                    }),
                    toolCall("2", "apply_edits", {
                      edits: [
                        {
                          path: "forms/intake.json",
                          content: '{"id":"intake","title":"Intake"}\n',
                        },
                      ],
                    }),
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const chat = createOpenRouterProxyChatAdapter({ defaultModel: "test/model" });
    await chat.send({
      message: "Add a title.",
      history: [],
      reflection: reflectionFor(files),
      tools: toolsFor(files),
      model: "test/model",
      onToolCall: (tool) => traces.push(tool),
    }).promise;

    expect(files).toEqual([
      { path: "forms/intake.json", content: '{"id":"intake","title":"Intake"}\n' },
    ]);
    expect(traces.findLast((trace) => trace.name === "propose_patch")?.status).toBe("success");
  });

  it("limits plan mode to read-only tools plus propose_patch", async () => {
    const files: SourceFile[] = [{ path: "forms/intake.json", content: '{"id":"intake"}\n' }];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as { tools: readonly any[] };
        const names = request.tools.map((tool) => tool.function.name);
        expect(names).toContain("propose_patch");
        expect(names).toContain("read_artifact_view");
        expect(names).not.toContain("apply_edits");
        expect(names).not.toContain("write_artifact_source");
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Plan ready." } }] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }),
    );

    const chat = createOpenRouterProxyChatAdapter({ defaultModel: "test/model" });
    await chat.send({
      message: "Plan an edit.",
      history: [],
      reflection: reflectionFor(files),
      tools: toolsFor(files),
      model: "test/model",
      planMode: true,
    }).promise;
  });

  it("runs prompt-to-artifact eval fixtures against a chat adapter", async () => {
    const files: SourceFile[] = [];
    const chat = createOpenRouterProxyChatAdapter({ defaultModel: "test/model" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      toolCall("1", "apply_edits", {
                        edits: [{ path: "forms/intake.json", content: '{"id":"intake"}\n' }],
                      }),
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const result = await runSchemaIdeChatEval({
      fixture: {
        name: "create-intake",
        prompt: "Create intake.",
        reflection: reflectionFor(files),
        files,
        expectedFiles: [{ path: "forms/intake.json", content: '{"id":"intake"}\n' }],
      },
      chat,
      tools: toolsFor(files),
      getFiles: () => files,
    });

    expect(result.passed).toBe(true);
  });

  it("exposes concrete JSON and PDF tools to OpenRouter", () => {
    expect(openRouterSchemaIdeTools.map((tool) => tool.function.name)).toEqual(
      expect.arrayContaining([
        "list_artifacts",
        "get_artifact_capabilities",
        "read_artifact_view",
        "write_artifact_source",
        "validate_artifact_project",
        "json_patch",
        "pdf_inspect",
        "pdf_update_form_annotations",
        "pdf_render_page_screenshot",
      ]),
    );
  });

  it("exposes artifact-native tools over the workspace service", async () => {
    const files: SourceFile[] = [{ path: "config.json", content: '{"name":"Demo"}\n' }];
    const runtime = toolsFor(files);

    const listed = await runToolkitTool(runtime, "list_artifacts", {});
    expect(listed).toMatchObject({
      isFailure: false,
      result: {
        count: 2,
        artifacts: [{ _tag: "Workspace" }, { _tag: "WorkspaceFile", path: "config.json" }],
      },
    });

    const capabilities = await runToolkitTool(runtime, "get_artifact_capabilities", {
      ref: { _tag: "WorkspaceFile", path: "config.json" },
    });
    expect(capabilities.result).toMatchObject({
      capabilities: expect.arrayContaining([
        expect.objectContaining({ view: "sourceText" }),
        expect.objectContaining({ view: "parsedValue" }),
        expect.objectContaining({ view: "jsonSchema" }),
        expect.objectContaining({ view: "diagnostics" }),
      ]),
    });

    const parsed = await runToolkitTool(runtime, "read_artifact_view", {
      ref: { _tag: "WorkspaceFile", path: "config.json" },
      view: "parsedValue",
    });
    expect(parsed).toMatchObject({
      isFailure: false,
      result: {
        ref: { _tag: "WorkspaceFile", path: "config.json" },
        view: "parsedValue",
        value: { name: "Demo" },
      },
    });

    const written = await runToolkitTool(runtime, "write_artifact_source", {
      ref: { _tag: "WorkspaceFile", path: "config.json" },
      content: '{"name":"Updated"}\n',
    });
    expect(written).toMatchObject({
      isFailure: false,
      result: { success: true, path: "config.json" },
    });
    expect(files[0]?.content).toBe('{"name":"Updated"}\n');

    const validation = await runToolkitTool(runtime, "validate_artifact_project", {});
    expect(validation).toMatchObject({
      isFailure: false,
      result: {
        summary: { valid: true, errorCount: 0, warningCount: 0, infoCount: 0 },
      },
    });
  });

  it("delegates artifact tools to host artifact operations when available", async () => {
    const files: SourceFile[] = [{ path: "config.json", content: '{"name":"Demo"}\n' }];
    const runtime = {
      ...toolsFor(files),
      listArtifacts: () => ({
        count: 2,
        artifacts: [
          { _tag: "Workspace" as const },
          { _tag: "WorkspaceFile" as const, path: "config.json" },
        ],
      }),
      getArtifactCapabilities: () => ({
        capabilities: [
          {
            id: "config.decodedValue",
            type: "schema-ide.workspace-file",
            view: "decodedValue",
            annotations: {},
          },
        ],
      }),
      readArtifactView: ({ ref, view }) => ({
        ref,
        view,
        value:
          view === "decodedValue"
            ? { decoded: true }
            : view === "validationSummary"
              ? reflectionFor(files).validationSummary
              : [],
      }),
      writeArtifactSource: (ref, content) => {
        files[0] = { path: ref.path, content };
        return {
          changedPaths: [ref.path],
          validation: reflectionFor(files).validationSummary,
        };
      },
    } satisfies SchemaIdeHostRuntime;

    const capabilities = await runToolkitTool(runtime, "get_artifact_capabilities", {
      ref: { _tag: "WorkspaceFile", path: "config.json" },
    });
    expect(capabilities.result).toMatchObject({
      capabilities: [expect.objectContaining({ view: "decodedValue" })],
    });

    const decoded = await runToolkitTool(runtime, "read_artifact_view", {
      ref: { _tag: "WorkspaceFile", path: "config.json" },
      view: "decodedValue",
    });
    expect(decoded).toMatchObject({
      isFailure: false,
      result: { value: { decoded: true } },
    });

    const written = await runToolkitTool(runtime, "write_artifact_source", {
      ref: { _tag: "WorkspaceFile", path: "config.json" },
      content: '{"name":"Runtime"}\n',
    });
    expect(written).toMatchObject({
      isFailure: false,
      result: { success: true, path: "config.json" },
    });
    expect(files[0]?.content).toBe('{"name":"Runtime"}\n');
  });

  it("routes legacy workspace tools through artifact operations when available", async () => {
    const files: SourceFile[] = [{ path: "config.json", content: '{"name":"Demo"}\n' }];
    const failLegacy = (name: string) =>
      vi.fn(() => {
        throw new Error(`legacy ${name} called`);
      });
    const reflect = (): SchemaIdeReflection => ({
      ...reflectionFor(files),
      schemas: [
        {
          id: "config",
          match: "*.json",
          jsonSchema: { type: "object", title: "Config Schema" },
        },
      ],
      activeJsonSchema: { type: "object", title: "Active Schema" },
      diagnostics: [
        {
          path: "config.json",
          severity: "info",
          message: "artifact diagnostic",
          source: "schema",
        },
      ],
      routeMatches: [{ path: "config.json", schemaId: "config", format: "json" }],
    });
    const artifactReads: string[] = [];
    const artifactWrites: string[] = [];
    const runtime = {
      readFile: failLegacy("readFile"),
      listFiles: failLegacy("listFiles"),
      searchFiles: failLegacy("searchFiles"),
      writeFile: failLegacy("writeFile"),
      createFile: failLegacy("createFile"),
      deleteFile: failLegacy("deleteFile"),
      renameFile: failLegacy("renameFile"),
      applyEdits: toolsFor(files).applyEdits,
      proposePatch: toolsFor(files).proposePatch,
      validateWorkspace: failLegacy("validateWorkspace"),
      getSchema: failLegacy("getSchema"),
      getJsonSchema: failLegacy("getJsonSchema"),
      getDiagnostics: failLegacy("getDiagnostics"),
      listArtifacts: () => ({
        artifacts: [
          { _tag: "Workspace" as const },
          ...files.map((file) => ({ _tag: "WorkspaceFile" as const, path: file.path })),
        ],
        count: files.length + 1,
      }),
      readArtifactView: ({ ref, view }) => {
        artifactReads.push(
          ref._tag === "WorkspaceFile" ? `${ref.path}:${view}` : `workspace:${view}`,
        );
        if (ref._tag === "WorkspaceFile" && view === "sourceText") {
          const file = files.find((candidate) => candidate.path === ref.path);
          if (!file) throw new Error(`File not found: ${ref.path}`);
          return { ref, view, value: file.content };
        }

        const reflection = reflect();
        if (ref._tag === "Workspace" && view === "reflection") {
          return { ref, view, value: reflection };
        }
        if (ref._tag === "Workspace" && view === "validationSummary") {
          return { ref, view, value: reflection.validationSummary };
        }
        if (ref._tag === "Workspace" && view === "diagnostics") {
          return { ref, view, value: reflection.diagnostics };
        }
        if (ref._tag === "Workspace" && view === "routeMatches") {
          return { ref, view, value: reflection.routeMatches };
        }
        throw new Error(`Unknown artifact view: ${view}`);
      },
      writeArtifactSource: (ref, content) => {
        artifactWrites.push(`${ref.path}:sourceText`);
        const index = files.findIndex((candidate) => candidate.path === ref.path);
        if (index === -1) files.push({ path: ref.path, content });
        else files[index] = { path: ref.path, content };
        return {
          changedPaths: [ref.path],
          validation: reflect().validationSummary,
        };
      },
    } satisfies SchemaIdeHostRuntime;

    await expect(runToolkitTool(runtime, "list_files", {})).resolves.toMatchObject({
      result: { files: ["config.json"], count: 1 },
    });
    await expect(
      runToolkitTool(runtime, "read_file", { path: "config.json" }),
    ).resolves.toMatchObject({
      result: { path: "config.json", content: '{"name":"Demo"}\n' },
    });
    await expect(runToolkitTool(runtime, "grep_files", { query: "Demo" })).resolves.toMatchObject({
      result: { count: 1, matches: [{ path: "config.json", line: 1 }] },
    });
    await expect(runToolkitTool(runtime, "validate_workspace", {})).resolves.toMatchObject({
      result: {
        summary: { valid: true },
        diagnostics: [{ message: "artifact diagnostic" }],
        routeMatches: [{ schemaId: "config" }],
      },
    });
    await expect(runToolkitTool(runtime, "get_json_schema", {})).resolves.toMatchObject({
      result: { schema: { title: "Active Schema" } },
    });
    await expect(
      runToolkitTool(runtime, "get_json_schema", { schemaId: "config" }),
    ).resolves.toMatchObject({
      result: { schema: { title: "Config Schema" } },
    });
    await expect(runToolkitTool(runtime, "get_diagnostics", {})).resolves.toMatchObject({
      result: {
        diagnostics: [{ message: "artifact diagnostic" }],
        validation: { valid: true },
      },
    });
    await expect(
      runToolkitTool(runtime, "write_file", {
        path: "config.json",
        content: '{"name":"Artifact"}\n',
      }),
    ).resolves.toMatchObject({
      result: { success: true, path: "config.json" },
    });
    await expect(
      runToolkitTool(runtime, "replace_file_content", {
        path: "config.json",
        search: "Artifact",
        replace: "Alias",
      }),
    ).resolves.toMatchObject({
      result: { success: true, path: "config.json" },
    });
    await expect(
      runToolkitTool(runtime, "create_file", {
        path: "other.json",
        content: '{"ok":true}\n',
      }),
    ).resolves.toMatchObject({
      result: { success: true, path: "other.json" },
    });

    expect(files).toEqual([
      { path: "config.json", content: '{"name":"Alias"}\n' },
      { path: "other.json", content: '{"ok":true}\n' },
    ]);
    expect(artifactReads).toEqual(
      expect.arrayContaining([
        "config.json:sourceText",
        "workspace:validationSummary",
        "workspace:diagnostics",
        "workspace:routeMatches",
        "workspace:reflection",
      ]),
    );
    expect(artifactWrites).toEqual([
      "config.json:sourceText",
      "config.json:sourceText",
      "other.json:sourceText",
    ]);
    expect(runtime.readFile).not.toHaveBeenCalled();
    expect(runtime.listFiles).not.toHaveBeenCalled();
    expect(runtime.searchFiles).not.toHaveBeenCalled();
    expect(runtime.writeFile).not.toHaveBeenCalled();
    expect(runtime.createFile).not.toHaveBeenCalled();
    expect(runtime.validateWorkspace).not.toHaveBeenCalled();
    expect(runtime.getJsonSchema).not.toHaveBeenCalled();
    expect(runtime.getDiagnostics).not.toHaveBeenCalled();
  });

  it("SchemaIdeWorkspaceLayer adapts the imperative runtime into Effect failures", async () => {
    const files: SourceFile[] = [{ path: "config.json", content: "{}\n" }];
    const runtime = {
      ...toolsFor(files),
      applyEdits: () => {
        throw new Error("Validation failed.");
      },
    } satisfies SchemaIdeHostRuntime;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const workspace = yield* SchemaIdeWorkspace;
        const existing = yield* workspace.readFile("config.json");
        const missing = yield* Effect.match(workspace.readFile("missing.json"), {
          onFailure: (error) => error,
          onSuccess: () => ({ error: "unexpected success" }),
        });
        const applyFailure = yield* Effect.match(
          workspace.applyEdits([{ path: "config.json", content: '{"ok":true}\n' }]),
          {
            onFailure: (error) => error,
            onSuccess: () => ({ error: "unexpected success" }),
          },
        );

        return { existing, missing, applyFailure };
      }).pipe(Effect.provide(SchemaIdeWorkspaceLayer(runtime))),
    );

    expect(result.existing).toEqual({ path: "config.json", content: "{}\n" });
    expect(result.missing).toEqual({ error: "File not found: missing.json" });
    expect(result.applyFailure).toEqual({ error: "Validation failed." });
  });

  it("SchemaIdeToolkit handles workspace and JSON tools through toolkit layers", async () => {
    const files: SourceFile[] = [{ path: "config.json", content: '{"name":"Demo"}\n' }];
    const runtime = toolsFor(files);

    const read = await runToolkitTool(runtime, "read_file", { path: "config.json" });
    expect(read).toMatchObject({
      isFailure: false,
      result: { path: "config.json", content: '{"name":"Demo"}\n' },
    });

    const patch = await runToolkitTool(runtime, "json_patch", {
      path: "config.json",
      patch: [{ op: "add", path: "/enabled", value: true }],
    });
    expect(patch).toMatchObject({
      isFailure: false,
      result: { success: true, path: "config.json" },
    });
    expect(files[0]?.content).toBe('{\n  "name": "Demo",\n  "enabled": true\n}\n');
  });

  it("SchemaIdeToolkit returns structured tool failures from toolkit layers", async () => {
    const runtime = toolsFor([{ path: "form.pdf", content: "" }]);

    const result = await runToolkitTool(runtime, "pdf_render_page_screenshot", {
      path: "form.pdf",
      page: 1,
    });

    expect(result.isFailure).toBe(true);
    expect(result.result).toMatchObject({
      error: expect.stringContaining("PDF page rendering is not configured"),
    });
  });

  it("json_patch updates JSON files through workspace edits", async () => {
    const files: SourceFile[] = [{ path: "config.json", content: '{"name":"Demo"}\n' }];

    const execution = await executeSchemaIdeToolCall(
      toolsFor(files),
      "json_patch",
      JSON.stringify({
        path: "config.json",
        patch: [
          { op: "add", path: "/enabled", value: true },
          { op: "replace", path: "/name", value: "Updated" },
        ],
      }),
    );

    expect(execution.isError).toBe(false);
    expect(files[0]?.content).toBe('{\n  "name": "Updated",\n  "enabled": true\n}\n');
  });

  it("json_patch updates YAML files through workspace edits", async () => {
    const files: SourceFile[] = [{ path: "config.yaml", content: "name: Demo\n" }];

    const execution = await executeSchemaIdeToolCall(
      toolsFor(files),
      "json_patch",
      JSON.stringify({
        path: "config.yaml",
        patch: [{ op: "add", path: "/enabled", value: true }],
      }),
    );

    expect(execution.isError).toBe(false);
    expect(files[0]?.content).toContain("name: Demo");
    expect(files[0]?.content).toContain("enabled: true");
  });

  it("json_patch rejects invalid syntax and invalid patch arguments", async () => {
    const files: SourceFile[] = [{ path: "broken.json", content: '{"name":' }];

    const invalidSyntax = await executeSchemaIdeToolCall(
      toolsFor(files),
      "json_patch",
      JSON.stringify({
        path: "broken.json",
        patch: [{ op: "add", path: "/enabled", value: true }],
      }),
    );
    expect(invalidSyntax.isError).toBe(true);
    expect(invalidSyntax.result).toMatchObject({ error: expect.stringContaining("JSON") });

    const invalidPatch = await executeSchemaIdeToolCall(
      toolsFor(files),
      "json_patch",
      JSON.stringify({
        path: "broken.json",
        patch: [{ op: "move", path: "/name" }],
      }),
    );
    expect(invalidPatch.isError).toBe(true);
    expect(invalidPatch.result).toMatchObject({
      error: expect.stringContaining("Invalid arguments"),
    });
  });

  it("pdf_inspect returns page metadata for a generated PDF", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([320, 240]);
    const files: SourceFile[] = [{ path: "form.pdf", content: bytesToBase64(await pdf.save()) }];

    const execution = await executeSchemaIdeToolCall(
      toolsFor(files),
      "pdf_inspect",
      JSON.stringify({ path: "form.pdf" }),
    );

    expect(execution.isError).toBe(false);
    expect(execution.result).toMatchObject({
      kind: "pdf",
      encoding: "base64",
      pageCount: 1,
      pages: [{ page: 1, width: 320, height: 240, rotation: 0 }],
      fields: [],
    });
  });

  it("pdf_inspect can persist generated metadata next to a PDF", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([320, 240]);
    const files: SourceFile[] = [
      { path: "documents/form/form.pdf", content: bytesToBase64(await pdf.save()) },
    ];

    const execution = await executeSchemaIdeToolCall(
      toolsFor(files),
      "pdf_inspect",
      JSON.stringify({
        path: "documents/form/form.pdf",
        outputPath: "documents/form/_generated/form.pdf.inspect.yaml",
      }),
    );

    expect(execution.isError).toBe(false);
    expect(execution.result).toMatchObject({
      kind: "pdf",
      writtenPath: "documents/form/_generated/form.pdf.inspect.yaml",
    });
    expect(files.find((file) => file.path.endsWith(".inspect.yaml"))?.content).toContain(
      "kind: pdf",
    );
  });

  it("pdf_update_form_annotations creates a text widget with screenshot coordinate conversion", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([320, 240]);
    const files: SourceFile[] = [{ path: "form.pdf", content: bytesToBase64(await pdf.save()) }];

    const execution = await executeSchemaIdeToolCall(
      toolsFor(files),
      "pdf_update_form_annotations",
      JSON.stringify({
        path: "form.pdf",
        annotationDoc: {
          pages: [
            {
              page: 1,
              annotations: [
                {
                  id: "full_name",
                  type: "text",
                  label: "Full name",
                  bbox: { x: 20, y: 30, width: 120, height: 24 },
                },
              ],
            },
          ],
        },
      }),
    );

    expect(execution.isError).toBe(false);
    expect(execution.result).toMatchObject({
      operation: "pdf_update_form_annotations",
      fieldsCreated: ["annotation.page_1.full_name"],
      pages: [1],
      annotationCount: 1,
    });

    const updated = await PDFDocument.load(base64ToBytes(files[0]!.content), {
      ignoreEncryption: true,
    });
    const field = updated.getForm().getTextField("annotation.page_1.full_name");
    const rect = (field.acroField as any).getWidgets()[0].getRectangle();
    expect(rect).toEqual({ x: 20, y: 186, width: 120, height: 24 });
  });

  it("pdf_render_page_screenshot returns a renderer-not-configured error", async () => {
    const execution = await executeSchemaIdeToolCall(
      toolsFor([{ path: "form.pdf", content: "" }]),
      "pdf_render_page_screenshot",
      JSON.stringify({ path: "form.pdf", page: 1 }),
    );

    expect(execution.isError).toBe(true);
    expect(execution.result).toMatchObject({
      error: expect.stringContaining("PDF page rendering is not configured"),
    });
  });

  it("json_patch preserves workspace mutation validation behavior", async () => {
    const files: SourceFile[] = [{ path: "config.json", content: '{"required":true}\n' }];
    const runtime = {
      ...toolsFor(files),
      applyEdits: (edits: readonly SchemaIdeFileEdit[], options = {}) => {
        const next = applyEditsPreview(files, edits);
        if (options.validate !== false && !next[0]?.content.includes("required")) {
          throw new Error("Missing required field.");
        }
        for (const edit of edits) {
          files[0] = { path: edit.path, content: edit.content };
        }
        return {
          changedPaths: edits.map((edit) => edit.path),
          validation: reflectionFor(files).validationSummary,
        };
      },
    } satisfies SchemaIdeHostRuntime;

    const execution = await executeSchemaIdeToolCall(
      runtime,
      "json_patch",
      JSON.stringify({
        path: "config.json",
        patch: [{ op: "remove", path: "/required" }],
      }),
    );

    expect(execution.isError).toBe(true);
    expect(execution.result).toMatchObject({ error: "Missing required field." });
    expect(files[0]?.content).toBe('{"required":true}\n');
  });
});

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

function toolsFor(files: SourceFile[]): SchemaIdeHostRuntime {
  let proposalSequence = 0;
  return {
    readFile: (path) => files.find((file) => file.path === path) ?? null,
    listFiles: () => files.map((file) => file.path),
    searchFiles: (query) =>
      files.flatMap((file) =>
        file.content
          .split(/\r?\n/)
          .map((line, index) => ({ path: file.path, line: index + 1, content: line }))
          .filter((line) => line.content.includes(query)),
      ),
    writeFile: (file) => {
      const index = files.findIndex((candidate) => candidate.path === file.path);
      if (index === -1) files.push(file);
      else files[index] = file;
    },
    createFile: (file) => {
      files.push(file);
    },
    deleteFile: (path) => {
      const index = files.findIndex((file) => file.path === path);
      if (index !== -1) files.splice(index, 1);
    },
    renameFile: (fromPath, toPath) => {
      const file = files.find((candidate) => candidate.path === fromPath);
      if (file) files.splice(files.indexOf(file), 1, { ...file, path: toPath });
    },
    applyEdits: (edits) => {
      for (const edit of edits) {
        const index = files.findIndex((candidate) => candidate.path === edit.path);
        if (edit.create && index !== -1) throw new Error(`File already exists: ${edit.path}`);
        if (index === -1) files.push({ path: edit.path, content: edit.content });
        else files[index] = { path: edit.path, content: edit.content };
      }
      return {
        changedPaths: edits.map((edit) => edit.path),
        validation: reflectionFor(files).validationSummary,
      };
    },
    proposePatch: (label, edits) => {
      const nextFiles = applyEditsPreview(files, edits);
      const reflection = reflectionFor(nextFiles);
      const proposal: SchemaIdePatchProposal = {
        id: `proposal-${++proposalSequence}`,
        label,
        edits,
        files: nextFiles,
        validation: reflection.validationSummary,
        diagnostics: reflection.diagnostics,
      };
      return proposal;
    },
    validateWorkspace: () => reflectionFor(files),
    getSchema: () => reflectionFor(files).schemas,
    getJsonSchema: () => reflectionFor(files).activeJsonSchema,
    getDiagnostics: () => reflectionFor(files).diagnostics,
  };
}

function applyEditsPreview(
  files: readonly SourceFile[],
  edits: readonly SchemaIdeFileEdit[],
): readonly SourceFile[] {
  const next = [...files];
  for (const edit of edits) {
    const index = next.findIndex((candidate) => candidate.path === edit.path);
    if (index === -1) next.push({ path: edit.path, content: edit.content });
    else next[index] = { path: edit.path, content: edit.content };
  }
  return next;
}

async function runToolkitTool(
  runtime: SchemaIdeHostRuntime,
  name: string,
  args: Record<string, unknown>,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const toolkit = yield* SchemaIdeToolkit;
      const stream = yield* toolkit.handle(name as keyof typeof SchemaIdeToolkit.tools, args);
      const results = Array.from(yield* Stream.runCollect(stream));
      const final = results.findLast((result) => !result.preliminary) ?? results.at(-1);
      if (!final) throw new Error(`No toolkit result for ${name}`);
      return final;
    }).pipe(
      Effect.provide(SchemaIdeToolkitLayer.pipe(Layer.provide(SchemaIdeWorkspaceLayer(runtime)))),
    ),
  );
}

function reflectionFor(files: readonly SourceFile[]): SchemaIdeReflection {
  return {
    mode: "workspace",
    activeFile: files[0]?.path ?? null,
    activeFormat: "json",
    files,
    schemas: [],
    activeJsonSchema: null,
    decodedValue: null,
    diagnostics: [],
    validationSummary: { valid: true, errorCount: 0, warningCount: 0, infoCount: 0 },
    routeMatches: [],
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

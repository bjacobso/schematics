import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  OpenRouterChatCompletionResponseSchema,
  OpenRouterChatRequestSchema,
  SchemaIdeHttpApi,
  isSchemaIdeWorkspaceError,
  SchemaIdeWorkspaceError,
  SchemaIdeWorkspaceRpcGroup,
  WorkspaceChangeRequestSchema,
  WorkspaceEventSchema,
  WorkspaceRpcErrorSchema,
  WorkspaceSnapshotSchema,
} from "../src";

describe("schema-ide-protocol", () => {
  it("decodes OpenRouter-compatible chat requests and responses", () => {
    const request = Schema.decodeUnknownSync(OpenRouterChatRequestSchema)({
      model: "test/model",
      messages: [{ role: "user", content: "Read a file." }],
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read a file",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        },
      ],
    });

    const response = Schema.decodeUnknownSync(OpenRouterChatCompletionResponseSchema)({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "read_file", arguments: '{"path":"forms/intake.json"}' },
              },
            ],
          },
        },
      ],
    });

    expect(request.messages[0]?.role).toBe("user");
    expect(response.choices[0]?.message.tool_calls?.[0]?.function.name).toBe("read_file");
    expect(SchemaIdeHttpApi).toBeDefined();
  });

  it("decodes serializable workspace snapshots, events, and changes", () => {
    const snapshot = Schema.decodeUnknownSync(WorkspaceSnapshotSchema)({
      revision: 1,
      files: [{ path: "workflows/onboarding.json", content: "{}\n" }],
      reflection: {
        mode: "workspace",
        activeFile: "workflows/onboarding.json",
        activeFormat: "json",
        files: [{ path: "workflows/onboarding.json", content: "{}\n" }],
        schemas: [{ id: "Workflows", jsonSchema: { type: "object" } }],
        activeJsonSchema: { type: "object" },
        decodedValue: null,
        diagnostics: [],
        validationSummary: { valid: true, errorCount: 0, warningCount: 0, infoCount: 0 },
        routeMatches: [
          { path: "workflows/onboarding.json", schemaId: "Workflows", format: "json" },
        ],
      },
    });
    const event = Schema.decodeUnknownSync(WorkspaceEventSchema)({
      type: "snapshot",
      snapshot,
    });
    const change = Schema.decodeUnknownSync(WorkspaceChangeRequestSchema)({
      type: "writeFile",
      path: "workflows/onboarding.json",
      content: '{"id":"onboarding"}\n',
    });

    expect(event.type).toBe("snapshot");
    expect(change.type).toBe("writeFile");
    expect(snapshot.reflection.validationSummary.valid).toBe(true);
  });

  it("defines the workspace Effect RPC group", () => {
    const error = Schema.decodeUnknownSync(WorkspaceRpcErrorSchema)({
      message: "Unsafe path",
      code: "unsafe-path",
    });

    expect([...SchemaIdeWorkspaceRpcGroup.requests.keys()]).toEqual([
      "GetCapabilities",
      "GetSnapshot",
      "WatchWorkspace",
      "ApplyWorkspaceChange",
      "PreviewWorkspaceFiles",
      "RunWorkspaceTool",
    ]);
    expect(error.code).toBe("unsafe-path");
  });

  it("tags workspace errors for Effect error matching", () => {
    const error = new SchemaIdeWorkspaceError("Unsafe path", "unsafe-path");

    expect(error).toMatchObject({
      _tag: "SchemaIdeWorkspaceError",
      code: "unsafe-path",
      message: "Unsafe path",
    });
    expect(isSchemaIdeWorkspaceError(error)).toBe(true);
  });
});

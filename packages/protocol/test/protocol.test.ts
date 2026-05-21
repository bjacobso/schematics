import { describe, expect, it, layer } from "@effect/vitest";
import { Effect, Schema, Stream } from "effect";
import { RpcTest } from "effect/unstable/rpc";
import {
  makeSchemaIdeWorkspaceRpcLayer,
  OpenRouterChatCompletionResponseSchema,
  OpenRouterChatRequestSchema,
  SchemaIdeHttpApi,
  isSchemaIdeWorkspaceError,
  type SchemaIdeWorkspaceClient,
  SchemaIdeWorkspaceError,
  SchemaIdeWorkspaceRpcGroup,
  type WorkspaceCapabilities,
  WorkspaceChangeRequestSchema,
  WorkspaceEventSchema,
  WorkspaceRpcErrorSchema,
  WorkspaceSnapshotSchema,
  type WorkspaceSnapshot,
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
        routeMatches: [{ path: "workflows/onboarding.json", schemaId: "Workflows", format: "json" }],
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

  layer(makeSchemaIdeWorkspaceRpcLayer(makeWorkspaceClient()))("workspace RPC handlers", (it) => {
    it.effect("runs workspace operations through Effect RPC handlers", () =>
      Effect.gen(function* () {
        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const rpcClient = yield* RpcTest.makeClient(SchemaIdeWorkspaceRpcGroup);
            const rpcCapabilities = yield* rpcClient.GetCapabilities(undefined);
            const events = yield* rpcClient
              .WatchWorkspace(undefined)
              .pipe(Stream.take(1), Stream.runCollect);
            const change = yield* rpcClient.ApplyWorkspaceChange({
              type: "writeFile",
              path: "workflows/onboarding.json",
              content: '{"id":"onboarding"}\n',
            });
            const preview = yield* rpcClient.PreviewWorkspaceFiles({
              files: [{ path: "workflows/onboarding.json", content: '{"id":1}\n' }],
              activeFile: "workflows/onboarding.json",
            });

            return {
              capabilities: rpcCapabilities,
              events: Array.from(events),
              change,
              preview,
            };
          }),
        );

        expect(result.capabilities.mode).toBe("memory");
        expect(result.events[0]?.type).toBe("snapshot");
        expect(result.change.changedPaths).toEqual(["workflows/onboarding.json"]);
        expect(result.preview.reflection.files[0]?.content).toBe('{"id":1}\n');
      }),
    );
  });
});

function makeWorkspaceClient(): SchemaIdeWorkspaceClient {
  const snapshot = makeWorkspaceSnapshot();
  const capabilities: WorkspaceCapabilities = {
    mode: "memory",
    workspace: { readOnly: false },
    agent: { enabled: true },
    features: {
      watch: true,
      write: true,
      rename: true,
      delete: true,
      history: true,
      previews: true,
    },
  };

  return {
    getCapabilities: async () => capabilities,
    getSnapshot: async () => snapshot,
    watchWorkspace: (onEvent) => {
      onEvent({ type: "snapshot", snapshot });
      return { unsubscribe: () => undefined };
    },
    applyChange: async () => ({
      revision: 2,
      changedPaths: ["workflows/onboarding.json"],
      validationSummary: snapshot.reflection.validationSummary,
    }),
    previewFiles: async ({ files }) => ({
      reflection: { ...snapshot.reflection, files },
    }),
  };
}

function makeWorkspaceSnapshot(): WorkspaceSnapshot {
  return {
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
      routeMatches: [{ path: "workflows/onboarding.json", schemaId: "Workflows", format: "json" }],
    },
  };
}

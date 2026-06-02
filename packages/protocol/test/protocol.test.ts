import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  ArtifactProjectEventSchema,
  OpenRouterChatCompletionResponseSchema,
  OpenRouterChatRequestSchema,
  ArtifactRefSchema,
  GetArtifactCapabilitiesResponseSchema,
  ListArtifactRefsResponseSchema,
  ReadArtifactViewResponseSchema,
  SchemaIdeHttpApi,
  isSchemaIdeArtifactProjectError,
  SchemaIdeArtifactProjectError,
  SchemaIdeArtifactProjectRpcGroup,
  ArtifactProjectChangeRequestSchema,
  ArtifactProjectStateEventSchema,
  ArtifactProjectRpcErrorSchema,
  ArtifactProjectStateSnapshotSchema,
  getArtifactCapabilitiesFromSnapshot,
  listArtifactRefsFromSnapshot,
  readArtifactViewFromSnapshot,
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
    const snapshot = Schema.decodeUnknownSync(ArtifactProjectStateSnapshotSchema)({
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
    const event = Schema.decodeUnknownSync(ArtifactProjectStateEventSchema)({
      type: "snapshot",
      snapshot,
    });
    const change = Schema.decodeUnknownSync(ArtifactProjectChangeRequestSchema)({
      type: "writeFile",
      path: "workflows/onboarding.json",
      content: '{"id":"onboarding"}\n',
    });

    expect(event.type).toBe("snapshot");
    expect(change.type).toBe("writeFile");
    expect(snapshot.reflection.validationSummary.valid).toBe(true);
  });

  it("defines the artifact project Effect RPC group", () => {
    const error = Schema.decodeUnknownSync(ArtifactProjectRpcErrorSchema)({
      message: "Unsafe path",
      code: "unsafe-path",
    });

    expect([...SchemaIdeArtifactProjectRpcGroup.requests.keys()]).toEqual([
      "GetCapabilities",
      "GetSnapshot",
      "WatchArtifactProjectState",
      "WatchArtifactProject",
      "ApplyArtifactProjectChange",
      "PreviewArtifactProjectFiles",
      "ListArtifactRefs",
      "GetArtifactCapabilities",
      "ReadArtifactView",
      "ApplyArtifactChange",
    ]);
    expect(error.code).toBe("unsafe-path");

    const artifactEvent = Schema.decodeUnknownSync(ArtifactProjectEventSchema)({
      type: "error",
      message: "Project watch failed",
    });
    expect(artifactEvent.type).toBe("error");
  });

  it("decodes and derives artifact protocol payloads from snapshots", () => {
    const ref = Schema.decodeUnknownSync(ArtifactRefSchema)({
      _tag: "ProjectFile",
      path: "workflows/onboarding.json",
    });
    const snapshot = Schema.decodeUnknownSync(ArtifactProjectStateSnapshotSchema)({
      revision: 1,
      files: [{ path: "workflows/onboarding.json", content: '{"id":"onboarding"}\n' }],
      reflection: {
        mode: "workspace",
        activeFile: "workflows/onboarding.json",
        activeFormat: "json",
        files: [{ path: "workflows/onboarding.json", content: '{"id":"onboarding"}\n' }],
        schemas: [{ id: "Workflows", match: "workflows/*.json", jsonSchema: { type: "object" } }],
        activeJsonSchema: { type: "object" },
        decodedValue: null,
        diagnostics: [],
        validationSummary: { valid: true, errorCount: 0, warningCount: 0, infoCount: 0 },
        routeMatches: [
          { path: "workflows/onboarding.json", schemaId: "Workflows", format: "json" },
        ],
      },
    });

    const refs = Schema.decodeUnknownSync(ListArtifactRefsResponseSchema)(
      listArtifactRefsFromSnapshot(snapshot),
    );
    const capabilities = Schema.decodeUnknownSync(GetArtifactCapabilitiesResponseSchema)(
      getArtifactCapabilitiesFromSnapshot({ snapshot, ref }),
    );
    const view = Schema.decodeUnknownSync(ReadArtifactViewResponseSchema)(
      readArtifactViewFromSnapshot({ snapshot, ref, view: "sourceText" }),
    );

    expect(refs.artifacts).toEqual([
      { _tag: "Project" },
      { _tag: "ProjectFile", path: "workflows/onboarding.json" },
    ]);
    expect(capabilities.capabilities.map((capability) => capability.view)).toEqual([
      "sourceText",
      "jsonSchema",
      "diagnostics",
    ]);
    expect(view.value).toBe('{"id":"onboarding"}\n');
  });

  it("tags workspace errors for Effect error matching", () => {
    const error = new SchemaIdeArtifactProjectError("Unsafe path", "unsafe-path");

    expect(error).toMatchObject({
      _tag: "SchemaIdeArtifactProjectError",
      code: "unsafe-path",
      message: "Unsafe path",
    });
    expect(isSchemaIdeArtifactProjectError(error)).toBe(true);
  });
});

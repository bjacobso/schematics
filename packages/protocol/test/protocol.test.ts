import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  ArtifactProjectEventSchema,
  OpenRouterChatCompletionResponseSchema,
  OpenRouterChatRequestSchema,
  ArtifactRefSchema,
  ListArtifactRefsResponseSchema,
  SchematicsHttpApi,
  isSchematicsArtifactProjectError,
  SchematicsArtifactProjectError,
  SchematicsArtifactProjectRpcGroup,
  ArtifactProjectChangeRequestSchema,
  ArtifactProjectRpcErrorSchema,
  ArtifactProjectSnapshotSchema,
  ArtifactWorkflowRunManifestSchema,
  StartArtifactWorkflowRunRequestSchema,
  listArtifactRefsFromSnapshot,
  SchematicsArtifactWorkflowRpcGroup,
} from "../src";

describe("schematics-protocol", () => {
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
    expect(SchematicsHttpApi).toBeDefined();
  });

  it("decodes serializable workspace snapshots, events, and changes", () => {
    const snapshot = Schema.decodeUnknownSync(ArtifactProjectSnapshotSchema)({
      revision: 1,
      files: [{ path: "workflows/onboarding.json", content: "{}\n" }],
    });
    const event = Schema.decodeUnknownSync(ArtifactProjectEventSchema)({
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
    expect(snapshot.files[0]?.path).toBe("workflows/onboarding.json");
  });

  it("defines the artifact project Effect RPC group", () => {
    const error = Schema.decodeUnknownSync(ArtifactProjectRpcErrorSchema)({
      message: "Unsafe path",
      code: "unsafe-path",
    });

    expect([...SchematicsArtifactProjectRpcGroup.requests.keys()]).toEqual([
      "GetCapabilities",
      "GetSnapshot",
      "WatchArtifactProject",
      "ApplyArtifactProjectChange",
      "GetHistory",
      "PreviewArtifactProjectFiles",
      "ListArtifactRefs",
      "GetArtifactCapabilities",
      "ReadArtifactView",
      "ReadArtifactViews",
      "ApplyArtifactChange",
    ]);
    expect(error.code).toBe("unsafe-path");

    const artifactEvent = Schema.decodeUnknownSync(ArtifactProjectEventSchema)({
      type: "error",
      message: "Project watch failed",
    });
    expect(artifactEvent.type).toBe("error");
  });

  it("defines the artifact workflow Effect RPC group", () => {
    const manifest = Schema.decodeUnknownSync(ArtifactWorkflowRunManifestSchema)({
      version: 1,
      runId: "run-1",
      workflowId: "toy.workflow",
      status: "completed",
      writeMode: "propose",
      inputHash: "abc",
      startedAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:01.000Z",
      steps: {
        model: {
          stepId: "model",
          actionId: "toy.model",
          status: "completed",
          writes: [],
          provenance: [],
          cost: { tokens: 2, inputTokens: 1, outputTokens: 1 },
        },
      },
      output: { ok: true },
    });

    expect([...SchematicsArtifactWorkflowRpcGroup.requests.keys()]).toEqual([
      "ListArtifactWorkflowIngestors",
      "StartArtifactWorkflowRun",
      "WatchArtifactWorkflowRun",
      "ResumeArtifactWorkflowRun",
      "GetArtifactWorkflowRunReport",
    ]);
    expect(manifest.steps["model"]?.cost?.tokens).toBe(2);

    const startRequest = Schema.decodeUnknownSync(StartArtifactWorkflowRunRequestSchema)({
      ingestorId: "toy.card.fromText",
      sourcePath: "sources/input.txt",
      sourceContent: "Uploaded source",
      inputs: { slug: "uploaded" },
    });
    expect(startRequest.sourceContent).toBe("Uploaded source");
  });

  it("decodes and derives artifact refs from snapshots", () => {
    const ref = Schema.decodeUnknownSync(ArtifactRefSchema)({
      _tag: "ProjectFile",
      path: "workflows/onboarding.json",
    });
    const snapshot = Schema.decodeUnknownSync(ArtifactProjectSnapshotSchema)({
      revision: 1,
      files: [{ path: "workflows/onboarding.json", content: '{"id":"onboarding"}\n' }],
    });

    const refs = Schema.decodeUnknownSync(ListArtifactRefsResponseSchema)(
      listArtifactRefsFromSnapshot(snapshot),
    );

    expect(refs.artifacts).toEqual([
      { _tag: "Project" },
      { _tag: "ProjectFile", path: "workflows/onboarding.json" },
    ]);
    expect(ref.path).toBe("workflows/onboarding.json");
  });

  it("tags workspace errors for Effect error matching", () => {
    const error = new SchematicsArtifactProjectError("Unsafe path", "unsafe-path");

    expect(error).toMatchObject({
      _tag: "SchematicsArtifactProjectError",
      code: "unsafe-path",
      message: "Unsafe path",
    });
    expect(isSchematicsArtifactProjectError(error)).toBe(true);
  });
});

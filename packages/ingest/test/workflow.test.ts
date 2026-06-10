import { describe, expect, it } from "@effect/vitest";
import { ArtifactRef, createMemoryArtifactStore } from "@schematics/artifacts";
import { Effect, Schema } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import {
  createLanguageModelCapability,
  defineArtifactAction,
  defineArtifactWorkflow,
  defineCapability,
  modelAction,
  OpenRouterLanguageModel,
  runArtifactWorkflow,
  step,
  type ArtifactWorkflowFileEdit,
  type ArtifactWorkflowMutationHost,
} from "../src";

const Input = Schema.Struct({
  sourcePath: Schema.String,
  slug: Schema.String,
});

const Text = Schema.Struct({
  text: Schema.String,
});

const Outline = Schema.Struct({
  slug: Schema.String,
  title: Schema.String,
});

const Output = Schema.Struct({
  path: Schema.String,
});

const UppercaseCapability = defineCapability<{ readonly text: string }, { readonly text: string }>({
  id: "text.uppercase",
});

const readSource = defineArtifactAction({
  id: "toy.readSource",
  input: Input,
  output: Text,
  run: ({ input, readFile }) =>
    readFile(input.sourcePath).pipe(Effect.map((content) => ({ text: content.trim() }))),
});

const outline = defineArtifactAction({
  id: "toy.outline",
  input: Schema.Struct({
    slug: Schema.String,
    text: Schema.String,
  }),
  output: Outline,
  uses: ["text.uppercase"],
  run: ({ input, capability }) =>
    capability<{ readonly text: string }, { readonly text: string }>("text.uppercase", {
      text: input.text,
    }).pipe(Effect.map((result) => ({ slug: input.slug, title: result.text }))),
});

const emit = defineArtifactAction({
  id: "toy.emit",
  input: Outline,
  output: Output,
  run: ({ input, writeFile }) =>
    writeFile("cards/generated.yaml", `id: ${input.slug}\ntitle: ${input.title}\n`).pipe(
      Effect.as({ path: "cards/generated.yaml" }),
    ),
});

const workflow = defineArtifactWorkflow({
  id: "toy.textToCard",
  input: Input,
  output: Output,
  steps: {
    read: step(readSource),
    outline: step(outline, {
      after: ["read"],
      input: ({ workflowInput, outputs }) => ({
        slug: workflowInput.slug,
        text: (outputs["read"] as typeof Text.Type).text,
      }),
    }),
    emit: step(emit, {
      after: ["outline"],
      input: ({ outputs }) => outputs["outline"] as typeof Outline.Type,
    }),
  },
});

describe("artifact ingestion workflows", () => {
  it("runs a typed workflow, records manifest state, and writes through the mutation host", async () => {
    const store = createMemoryArtifactStore({
      files: [{ path: "sources/card.txt", content: "welcome" }],
    });
    const applied: ArtifactWorkflowFileEdit[] = [];
    const host: ArtifactWorkflowMutationHost = {
      applyEdits: (edits) => {
        applied.push(...edits);
        return { changedPaths: edits.map((edit) => edit.path) };
      },
    };

    const report = await Effect.runPromise(
      runArtifactWorkflow({
        workflow,
        input: { sourcePath: "sources/card.txt", slug: "welcome" },
        store,
        mutationHost: host,
        capabilities: [
          {
            capability: UppercaseCapability,
            run: (input) => Effect.succeed({ text: input.text.toUpperCase() }),
          },
        ],
        runId: "run-1",
        now: () => "2026-06-09T00:00:00.000Z",
      }),
    );

    expect(report.status).toBe("completed");
    expect(report.output).toEqual({ path: "cards/generated.yaml" });
    expect(applied).toEqual([
      { path: "cards/generated.yaml", content: "id: welcome\ntitle: WELCOME\n" },
    ]);
    expect(report.manifest.steps["emit"]).toMatchObject({
      status: "completed",
      writes: [{ path: "cards/generated.yaml" }],
      provenance: [{ runId: "run-1", stepId: "emit", actionId: "toy.emit" }],
    });
  });

  it("fails early when a required capability is missing", async () => {
    const store = createMemoryArtifactStore({
      files: [{ path: "sources/card.txt", content: "welcome" }],
    });

    await expect(
      Effect.runPromise(
        runArtifactWorkflow({
          workflow,
          input: { sourcePath: "sources/card.txt", slug: "welcome" },
          store,
          runId: "run-missing",
        }),
      ),
    ).rejects.toThrow(/missing host capabilities: text\.uppercase/);
  });

  it("persists failed step diagnostics and resumes from a chosen step", async () => {
    const store = createMemoryArtifactStore({
      files: [{ path: "sources/card.txt", content: "welcome" }],
    });
    let fail = true;
    const capability = {
      capability: UppercaseCapability,
      run: (input: { readonly text: string }) =>
        fail
          ? Effect.fail(new Error("forced outline failure"))
          : Effect.succeed({ text: input.text }),
    };

    await expect(
      Effect.runPromise(
        runArtifactWorkflow({
          workflow,
          input: { sourcePath: "sources/card.txt", slug: "welcome" },
          store,
          capabilities: [capability],
          runId: "run-resume",
        }),
      ),
    ).rejects.toThrow(/forced outline failure/);

    const failedManifest = JSON.parse(
      String(
        await Effect.runPromise(
          store.read(ArtifactRef.projectFile(".schematics/runs/run-resume/manifest.json")),
        ),
      ),
    ) as { readonly status: string; readonly steps: Record<string, { readonly status: string }> };
    expect(failedManifest.status).toBe("failed");
    expect(failedManifest.steps["outline"]?.status).toBe("failed");

    fail = false;
    const resumed = await Effect.runPromise(
      runArtifactWorkflow({
        workflow,
        input: { sourcePath: "sources/card.txt", slug: "welcome" },
        store,
        capabilities: [capability],
        runId: "run-resume",
        fromStep: "outline",
      }),
    );

    expect(resumed.status).toBe("completed");
    expect(resumed.manifest.steps["read"]?.status).toBe("completed");
    expect(resumed.manifest.steps["outline"]?.status).toBe("completed");
  });

  it("returns a patch without mutating target files in propose mode", async () => {
    const store = createMemoryArtifactStore({
      files: [{ path: "sources/card.txt", content: "welcome" }],
    });

    const report = await Effect.runPromise(
      runArtifactWorkflow({
        workflow,
        input: { sourcePath: "sources/card.txt", slug: "welcome" },
        store,
        capabilities: [
          {
            capability: UppercaseCapability,
            run: (input) => Effect.succeed({ text: input.text.toUpperCase() }),
          },
        ],
        runId: "run-propose",
        writeMode: "propose",
      }),
    );

    expect(report.patch?.edits).toEqual([
      { path: "cards/generated.yaml", content: "id: welcome\ntitle: WELCOME\n" },
    ]);
    await expect(
      Effect.runPromise(store.read(ArtifactRef.projectFile("cards/generated.yaml"))),
    ).rejects.toMatchObject({ reason: "not-found" });
  });

  it("provides a metered LanguageModel service to model actions", async () => {
    const store = createMemoryArtifactStore();
    const ModelResult = Schema.Struct({ ok: Schema.Boolean });
    const action = modelAction({
      id: "toy.model",
      input: Schema.Struct({ prompt: Schema.String }),
      output: ModelResult,
      prompt: ({ input }) => input.prompt,
    });
    const modelWorkflow = defineArtifactWorkflow({
      id: "toy.modelWorkflow",
      input: Schema.Struct({ prompt: Schema.String }),
      output: ModelResult,
      steps: {
        model: step(action),
      },
    });
    const service = await Effect.runPromise(
      LanguageModel.LanguageModel.pipe(
        Effect.provide(OpenRouterLanguageModel.layerMock({ object: { ok: true } })),
      ),
    );

    const report = await Effect.runPromise(
      runArtifactWorkflow({
        workflow: modelWorkflow,
        input: { prompt: "Return JSON." },
        store,
        capabilities: [
          createLanguageModelCapability({
            service,
            modelId: "test/model",
            inputTokenCostUsdPerMillion: 1,
            outputTokenCostUsdPerMillion: 2,
          }),
        ],
        runId: "run-model",
      }),
    );

    expect(report.output).toEqual({ ok: true });
    expect(report.manifest.steps["model"]?.cost).toMatchObject({
      tokens: 2,
      inputTokens: 1,
      outputTokens: 1,
      usd: 0.000003,
    });
  });
});

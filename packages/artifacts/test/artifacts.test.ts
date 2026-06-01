import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  ArtifactApi,
  ArtifactHandler,
  ArtifactMatcher,
  ArtifactProject,
  ArtifactProjectConfigSchema,
  ArtifactRef,
  ArtifactRegistry,
  ArtifactType,
  CachePolicy,
  Cost,
  createMemoryArtifactStore,
  matchGlob,
} from "../src";

const ParsedConfig = Schema.Struct({
  name: Schema.String,
  enabled: Schema.Boolean,
});

const Json = ArtifactType.make("json")
  .match(ArtifactMatcher.extension("json"))
  .match(ArtifactMatcher.mime("application/json"))
  .view("parsedValue", {
    input: Schema.Struct({ content: Schema.String }),
    output: ParsedConfig,
    error: Schema.Struct({ code: Schema.String }),
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  });

const Artifacts = ArtifactApi.make("workspace").add(Json);

describe("schema-ide-artifacts", () => {
  it("inspects capabilities for matching artifact refs", () => {
    const capabilities = ArtifactApi.capabilities(Artifacts, ArtifactRef.path("config/demo.json"));

    expect(capabilities).toHaveLength(1);
    expect(capabilities[0]).toMatchObject({
      type: "json",
      view: "parsedValue",
      id: "json.parsedValue",
      annotations: {
        cost: "low",
        cache: "contentHash",
        mediaType: "application/json",
      },
    });
  });

  it("materializes a view through an exact handler binding", async () => {
    const registry = ArtifactRegistry.make(Artifacts).addHandler(
      ArtifactHandler.make(Json.view("parsedValue"), ({ input }) =>
        Effect.try({
          try: () => JSON.parse(input.content) as unknown,
          catch: (error) => error,
        }),
      ),
    );

    const value = await Effect.runPromise(
      registry.view(ArtifactRef.path("config/demo.json"), "parsedValue", {
        content: '{"name":"Demo","enabled":true}',
      }),
    );

    expect(value).toEqual({ name: "Demo", enabled: true });
  });

  it("uses metadata matchers when the ref has no useful path", () => {
    const capabilities = ArtifactApi.capabilities(Artifacts, ArtifactRef.blob("blob-1"), {
      mimeType: "application/json",
    });

    expect(capabilities.map((capability) => capability.id)).toEqual(["json.parsedValue"]);
  });

  it("validates handler input before execution", async () => {
    const registry = ArtifactRegistry.make(Artifacts).addHandler(
      ArtifactHandler.make(Json.view("parsedValue"), () =>
        Effect.succeed({ name: "Demo", enabled: true }),
      ),
    );

    const result = await Effect.runPromise(
      Effect.match(registry.view(ArtifactRef.path("config/demo.json"), "parsedValue", {}), {
        onFailure: (error) => error,
        onSuccess: () => ({ _tag: "UnexpectedSuccess" }),
      }),
    );

    expect(result).toMatchObject({
      _tag: "ArtifactSchemaValidationError",
      phase: "input",
      view: "json.parsedValue",
    });
  });

  it("validates handler output after execution", async () => {
    const registry = ArtifactRegistry.make(Artifacts).addHandler(
      ArtifactHandler.make(Json.view("parsedValue"), () =>
        Effect.succeed({ name: "Demo", enabled: "yes" } as never),
      ),
    );

    const result = await Effect.runPromise(
      Effect.match(
        registry.view(ArtifactRef.path("config/demo.json"), "parsedValue", {
          content: '{"name":"Demo","enabled":true}',
        }),
        {
          onFailure: (error) => error,
          onSuccess: () => ({ _tag: "UnexpectedSuccess" }),
        },
      ),
    );

    expect(result).toMatchObject({
      _tag: "ArtifactSchemaValidationError",
      phase: "output",
      view: "json.parsedValue",
    });
  });

  it("validates and wraps handler failures", async () => {
    const registry = ArtifactRegistry.make(Artifacts).addHandler(
      ArtifactHandler.make(Json.view("parsedValue"), () => Effect.fail({ code: "parse-failed" })),
    );

    const result = await Effect.runPromise(
      Effect.match(
        registry.view(ArtifactRef.path("config/demo.json"), "parsedValue", {
          content: '{"name":"Demo","enabled":true}',
        }),
        {
          onFailure: (error) => error,
          onSuccess: () => ({ _tag: "UnexpectedSuccess" }),
        },
      ),
    );

    expect(result).toEqual({
      _tag: "ArtifactHandlerFailed",
      view: "json.parsedValue",
      error: { code: "parse-failed" },
    });
  });

  it("declares artifact projects with workspace views and file routes", () => {
    const Project = ArtifactProject.make("demo")
      .files("config/*.json", Json, { id: "configs" })
      .view("diagnostics", {
        output: Schema.Array(Schema.String),
        annotations: {
          cost: Cost.low,
          cache: CachePolicy.contentHash,
        },
      });

    expect(
      Project.route(ArtifactRef.workspaceFile("config/demo.json")).map((route) => route.id),
    ).toEqual(["configs"]);
    expect(Project.route(ArtifactRef.workspaceFile("notes/readme.md"))).toEqual([]);

    expect(
      Project.capabilities(ArtifactRef.workspace()).map((capability) => capability.id),
    ).toEqual(["demo.workspace.diagnostics"]);
    expect(
      Project.capabilities(ArtifactRef.workspaceFile("config/demo.json")).map((capability) => ({
        id: capability.id,
        routeId: capability.routeId,
        routePattern: capability.routePattern,
      })),
    ).toEqual([
      {
        id: "configs.parsedValue",
        routeId: "configs",
        routePattern: "config/*.json",
      },
    ]);
  });

  it("matches globs consistently across leading dirs and segments", () => {
    // `**/` matches zero or more leading directories, so top-level files match too.
    expect(matchGlob("**/*.json", "example.json")).toBe(true);
    expect(matchGlob("**/*.json", "nested/example.json")).toBe(true);
    expect(matchGlob("**/*.yaml", "a/b/c.yaml")).toBe(true);
    expect(matchGlob("**/*.json", "example.yaml")).toBe(false);

    // A single `*` stays within one path segment.
    expect(matchGlob("forms/*.yaml", "forms/signup.yaml")).toBe(true);
    expect(matchGlob("forms/*.yaml", "forms/library/base.yaml")).toBe(false);

    // Multi-segment patterns with interior single stars.
    expect(matchGlob("documents/*/document.yaml", "documents/x/document.yaml")).toBe(true);
    expect(matchGlob("documents/*/document.yaml", "documents/x/y/document.yaml")).toBe(false);
  });

  it("routes top-level and nested files through ** project patterns", () => {
    const Project = ArtifactProject.make("demo").files("**/*.json", ArtifactType.make("json"), {
      id: "configs",
    });

    expect(
      Project.route(ArtifactRef.workspaceFile("example.json")).map((route) => route.id),
    ).toEqual(["configs"]);
    expect(
      Project.route(ArtifactRef.workspaceFile("nested/example.json")).map((route) => route.id),
    ).toEqual(["configs"]);
    expect(Project.route(ArtifactRef.workspaceFile("example.yaml"))).toEqual([]);
  });

  it("declares schema-backed file routes with decoded value capabilities", () => {
    const Project = ArtifactProject.make("demo").files("config/*.json", {
      id: "configs",
      type: ArtifactType.make("config"),
      schema: ParsedConfig,
      metadata: { mimeType: "application/json" },
    });
    const ref = ArtifactRef.workspaceFile("config/demo.json");

    expect(Project.route(ref)).toHaveLength(1);
    expect(Project.route(ref)[0]?.schema).toBe(ParsedConfig);
    expect(Project.route(ref)[0]?.metadata).toEqual({ mimeType: "application/json" });
    expect(
      Project.capabilities(ref).map((capability) => ({
        id: capability.id,
        routeId: capability.routeId,
        view: capability.view,
        annotations: capability.annotations,
      })),
    ).toEqual([
      {
        id: "configs.decodedValue",
        routeId: "configs",
        view: "decodedValue",
        annotations: {
          cost: "low",
          cache: "contentHash",
          mediaType: "application/json",
        },
      },
    ]);
  });

  it("round-trips serializable artifact project configs through a runtime environment", () => {
    const config = {
      id: "demo",
      name: "Demo Project",
      defaultFormat: "json",
      include: ["**/*.json"],
      files: [
        {
          id: "configs",
          pattern: "config/*.json",
          artifact: "Config",
          format: "json",
          workspaceField: "configs",
          mode: "values",
          indexBy: "name",
          description: "Config files.",
        },
      ],
      algebra: {
        views: ["relationGraph"],
      },
    };
    const decodedConfig = Schema.decodeUnknownSync(ArtifactProjectConfigSchema)(config);

    const Project = ArtifactProject.fromConfig(decodedConfig, {
      artifacts: {
        Config: {
          type: ArtifactType.make("config"),
          schema: ParsedConfig,
          metadata: { mimeType: "application/json" },
        },
      },
    });

    const ref = ArtifactRef.workspaceFile("config/demo.json");
    expect(Project.name).toBe("demo");
    expect(Project.route(ref)[0]?.schema).toBe(ParsedConfig);
    expect(Project.route(ref)[0]?.metadata?.attributes).toMatchObject({
      workspaceField: "configs",
      values: true,
      indexBy: "name",
    });
    expect(Project.capabilities(ref).map((capability) => capability.routeId)).toEqual(["configs"]);
    expect(ArtifactProject.toConfig(Project)).toEqual(config);
  });

  it("stores workspace file artifacts in memory", async () => {
    const store = createMemoryArtifactStore({
      files: [{ path: "config/demo.json", content: '{"name":"Demo","enabled":true}' }],
    });
    const ref = ArtifactRef.workspaceFile("config/demo.json");
    const createdRef = ArtifactRef.workspaceFile("config/next.json");

    expect(await Effect.runPromise(store.list)).toEqual([ref]);
    expect(await Effect.runPromise(store.read(ref))).toBe('{"name":"Demo","enabled":true}');

    await Effect.runPromise(store.write(ref, '{"name":"Edited","enabled":true}'));
    expect(await Effect.runPromise(store.read(ref))).toBe('{"name":"Edited","enabled":true}');

    expect(
      await Effect.runPromise(store.create(createdRef, '{"name":"Next","enabled":false}')),
    ).toEqual(createdRef);
    expect(await Effect.runPromise(store.list)).toEqual([ref, createdRef]);

    await Effect.runPromise(store.delete(ref));
    expect(await Effect.runPromise(store.list)).toEqual([createdRef]);
  });
});

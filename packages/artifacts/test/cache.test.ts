import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  artifactCacheKey,
  ArtifactApi,
  ArtifactHandler,
  ArtifactMatcher,
  ArtifactRef,
  ArtifactRegistry,
  ArtifactType,
  CachePolicy,
  Cost,
  createMemoryArtifactCache,
  hashArtifactContent,
  type ArtifactContentHashResolver,
} from "../src";

// A small artifact type with one expensive content-hash view and one uncached view.
const Text = ArtifactType.make("text")
  .match(ArtifactMatcher.extension("txt"))
  .view("upper", {
    output: Schema.String,
    annotations: { cost: Cost.high, cache: CachePolicy.contentHash },
  })
  .view("raw", {
    output: Schema.String,
    annotations: { cost: Cost.low, cache: CachePolicy.none },
  });

const api = ArtifactApi.make("workspace").add(Text);

/** Returns a registry whose `upper` handler counts how often it actually runs. */
function makeCountingRegistry(contentByRef: Map<string, string>) {
  const runs = { upper: 0, raw: 0 };
  const cache = createMemoryArtifactCache();
  const resolveContentHash: ArtifactContentHashResolver = (ref) =>
    Effect.sync(() => {
      const content = ref._tag === "Path" ? contentByRef.get(ref.path) : undefined;
      return content === undefined ? null : hashArtifactContent(content);
    });

  const registry = ArtifactRegistry.make(api)
    .addHandler(
      ArtifactHandler.make(Text.view("upper"), ({ ref }) =>
        Effect.sync(() => {
          runs.upper += 1;
          const content = ref._tag === "Path" ? (contentByRef.get(ref.path) ?? "") : "";
          return content.toUpperCase();
        }),
      ),
    )
    .addHandler(
      ArtifactHandler.make(Text.view("raw"), ({ ref }) =>
        Effect.sync(() => {
          runs.raw += 1;
          return ref._tag === "Path" ? (contentByRef.get(ref.path) ?? "") : "";
        }),
      ),
    )
    .withCache({ cache, resolveContentHash });

  return { registry, runs };
}

describe("artifact cache", () => {
  it("serves a content-hash view from cache on the second call", async () => {
    const content = new Map([["a.txt", "hello"]]);
    const { registry, runs } = makeCountingRegistry(content);

    const first = await Effect.runPromise(registry.view(ArtifactRef.path("a.txt"), "upper"));
    const second = await Effect.runPromise(registry.view(ArtifactRef.path("a.txt"), "upper"));

    expect(first).toBe("HELLO");
    expect(second).toBe("HELLO");
    expect(runs.upper).toBe(1); // handler ran once; second call was a cache hit
  });

  it("busts the cache when content changes", async () => {
    const content = new Map([["a.txt", "hello"]]);
    const { registry, runs } = makeCountingRegistry(content);

    const first = await Effect.runPromise(registry.view(ArtifactRef.path("a.txt"), "upper"));
    content.set("a.txt", "world");
    const second = await Effect.runPromise(registry.view(ArtifactRef.path("a.txt"), "upper"));

    expect(first).toBe("HELLO");
    expect(second).toBe("WORLD");
    expect(runs.upper).toBe(2); // new content hash -> handler re-ran
  });

  it("never caches a view with CachePolicy.none", async () => {
    const content = new Map([["a.txt", "hello"]]);
    const { registry, runs } = makeCountingRegistry(content);

    await Effect.runPromise(registry.view(ArtifactRef.path("a.txt"), "raw"));
    await Effect.runPromise(registry.view(ArtifactRef.path("a.txt"), "raw"));

    expect(runs.raw).toBe(2); // recomputed every time
  });

  it("does not cache when no cache is configured", async () => {
    const content = new Map([["a.txt", "hello"]]);
    const { runs } = makeCountingRegistry(content);
    // A registry without withCache() behaves exactly as before.
    const registry = ArtifactRegistry.make(api).addHandler(
      ArtifactHandler.make(Text.view("upper"), ({ ref }) =>
        Effect.sync(() => {
          runs.upper += 1;
          return ref._tag === "Path" ? (content.get(ref.path) ?? "").toUpperCase() : "";
        }),
      ),
    );

    await Effect.runPromise(registry.view(ArtifactRef.path("a.txt"), "upper"));
    await Effect.runPromise(registry.view(ArtifactRef.path("a.txt"), "upper"));

    expect(runs.upper).toBe(2);
  });
});

describe("artifactCacheKey", () => {
  it("returns null for uncacheable policies and refs", () => {
    const ref = ArtifactRef.path("a.txt");
    expect(artifactCacheKey({ policy: "none", viewId: "v", ref, input: undefined })).toBeNull();
    // contentHash with no hash available -> uncacheable
    expect(
      artifactCacheKey({
        policy: "contentHash",
        viewId: "v",
        ref,
        input: undefined,
        contentHash: null,
      }),
    ).toBeNull();
    // ref policy on a mutable Path ref -> declined (would go stale)
    expect(artifactCacheKey({ policy: "ref", viewId: "v", ref, input: undefined })).toBeNull();
    // explicitKey policy with no key -> uncacheable
    expect(
      artifactCacheKey({ policy: "explicitKey", viewId: "v", ref, input: undefined }),
    ).toBeNull();
  });

  it("keys ref policy on immutable refs", () => {
    const ref = ArtifactRef.gitBlob("repo", "oid123");
    const key = artifactCacheKey({ policy: "ref", viewId: "v", ref, input: undefined });
    expect(key).toContain("GitBlob:repo:oid123");
  });

  it("folds input into the key deterministically regardless of property order", () => {
    const ref = ArtifactRef.path("a.txt");
    const left = artifactCacheKey({
      policy: "contentHash",
      viewId: "v",
      ref,
      input: { b: 2, a: 1 },
      contentHash: "deadbeef",
    });
    const right = artifactCacheKey({
      policy: "contentHash",
      viewId: "v",
      ref,
      input: { a: 1, b: 2 },
      contentHash: "deadbeef",
    });
    expect(left).toBe(right);
  });
});

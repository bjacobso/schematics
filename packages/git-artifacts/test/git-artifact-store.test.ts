import { describe, expect, it } from "@effect/vitest";
import { ArtifactRef, isLoadedEntry, isPendingEntry } from "@schematics/artifacts";
import { Effect } from "effect";
import { createMemFs } from "../src/mem-fs";
import { makeGitArtifactStoreFromProvider } from "../src/cloudflare";
import { makeGitArtifactStore } from "../src/git-artifact-store";
import { makeGitRepoBackend } from "../src/git-repo-backend";
import { memoryRepoProvider } from "../src/repo-provider";

const run = Effect.runPromise;

const author = { name: "Test", email: "test@example.com", timestamp: 1_700_000_000 };

const makeStore = (fs: unknown, projectId: string) => {
  const backend = makeGitRepoBackend({ fs, dir: "/repo", branch: "main" });
  return { backend, store: makeGitArtifactStore({ backend, projectId, defaultAuthor: author }) };
};

describe("GitArtifactStore (local, no remote)", () => {
  it("commits created files as real git history and reads them back", async () => {
    const fs = createMemFs();
    const { backend, store } = makeStore(fs, "demo");
    await run(backend.init);
    await run(store.seed);

    await run(store.create(ArtifactRef.projectFile("config/a.json", "demo"), '{"a":1}'));
    await run(store.create(ArtifactRef.projectFile("config/b.json", "demo"), '{"b":2}'));
    const oid = await run(store.commit({ message: "Add config", actor: "user" }));

    expect(oid).toMatch(/^[0-9a-f]{40}$/);

    const content = await run(store.read(ArtifactRef.projectFile("config/a.json", "demo")));
    expect(content).toBe('{"a":1}');

    const log = await run(store.log());
    expect(log).toHaveLength(1);
    expect(log[0]?.message).toContain("Add config");
    expect(log[0]?.message).toContain("Actor: user");
  });

  it("a fresh store over the same repo seeds pending entries and hydrates lazily", async () => {
    const fs = createMemFs();
    const first = makeStore(fs, "demo");
    await run(first.backend.init);
    await run(first.store.seed);
    await run(first.store.create(ArtifactRef.projectFile("forms/x.json", "demo"), '{"x":true}'));
    await run(first.store.commit({ message: "seed", actor: "system" }));

    // A brand-new store sharing only the on-disk repo — must rebuild from git.
    const second = makeStore(fs, "demo");
    const refs = await run(second.store.seed);
    expect(refs.map((ref) => (ref._tag === "ProjectFile" ? ref.path : ""))).toEqual([
      "forms/x.json",
    ]);

    const entries = await run(second.store.entries!);
    expect(entries.every(isPendingEntry)).toBe(true);

    const content = await run(second.store.read(ArtifactRef.projectFile("forms/x.json", "demo")));
    expect(content).toBe('{"x":true}');

    const after = await run(second.store.entries!);
    expect(after.filter(isLoadedEntry)).toHaveLength(1);
  });

  it("write and delete stage into the next commit", async () => {
    const fs = createMemFs();
    const { backend, store } = makeStore(fs, "demo");
    await run(backend.init);
    await run(store.seed);
    await run(store.create(ArtifactRef.projectFile("a.json", "demo"), "1"));
    await run(store.create(ArtifactRef.projectFile("b.json", "demo"), "2"));
    await run(store.commit({ message: "init", actor: "user" }));

    await run(store.write(ArtifactRef.projectFile("a.json", "demo"), "10"));
    await run(store.delete(ArtifactRef.projectFile("b.json", "demo")));
    await run(store.commit({ message: "edit", actor: "user" }));

    const reopened = makeStore(fs, "demo");
    await run(reopened.store.seed);
    const refs = await run(reopened.store.list);
    expect(refs.map((ref) => (ref._tag === "ProjectFile" ? ref.path : ""))).toEqual(["a.json"]);
    expect(await run(reopened.store.read(ArtifactRef.projectFile("a.json", "demo")))).toBe("10");

    const log = await run(reopened.store.log());
    expect(log).toHaveLength(2);
  });

  it("preserves binary content as bytes through a commit round-trip", async () => {
    const fs = createMemFs();
    const { backend, store } = makeStore(fs, "demo");
    await run(backend.init);
    await run(store.seed);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
    await run(store.create(ArtifactRef.projectFile("assets/logo.png", "demo"), png));
    await run(store.commit({ message: "logo", actor: "user" }));

    const reopened = makeStore(fs, "demo");
    await run(reopened.store.seed);
    const content = await run(
      reopened.store.read(ArtifactRef.projectFile("assets/logo.png", "demo")),
    );
    expect(content).toBeInstanceOf(Uint8Array);
    expect([...(content as Uint8Array)]).toEqual([...png]);
  });

  it("composes provider + backend + store and seeds (local provider)", async () => {
    const provider = memoryRepoProvider();
    const store = await run(
      makeGitArtifactStoreFromProvider({
        provider,
        repo: "ws-abc",
        fs: createMemFs(),
        projectId: "ws-abc",
        defaultAuthor: author,
      }),
    );
    await run(store.create(ArtifactRef.projectFile("config/main.json", "ws-abc"), '{"ok":true}'));
    const oid = await run(store.commit({ message: "Initial config", actor: "agent" }));
    expect(oid).toMatch(/^[0-9a-f]{40}$/);
    expect(await run(store.read(ArtifactRef.projectFile("config/main.json", "ws-abc")))).toBe(
      '{"ok":true}',
    );
    const log = await run(store.log());
    expect(log[0]?.message).toContain("Actor: agent");
  });

  it("memoryRepoProvider yields a local-only handle", async () => {
    const provider = memoryRepoProvider();
    const handle = await run(provider.ensure("ws-123"));
    expect(handle).toMatchObject({ name: "ws-123", remote: null, defaultBranch: "main" });
    expect(await run(provider.token("ws-123", "write"))).toBeNull();
  });
});

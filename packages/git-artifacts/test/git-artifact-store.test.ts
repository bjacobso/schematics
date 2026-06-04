import { describe, expect, it } from "@effect/vitest";
import { ArtifactRef, isLoadedEntry, isPendingEntry } from "@schematics/artifacts";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { createMemFs } from "../src/mem-fs";
import { makeGitArtifactStoreFromProvider } from "../src/cloudflare";
import { makeGitArtifactStore } from "../src/git-artifact-store";
import { makeGitRepoBackend } from "../src/git-repo-backend";
import { memoryRepoProvider } from "../src/repo-provider";

const author = { name: "Test", email: "test@example.com", timestamp: 1_700_000_000 };

const makeStore = (fs: unknown, projectId: string) => {
  const backend = makeGitRepoBackend({ fs, dir: "/repo", branch: "main" });
  return { backend, store: makeGitArtifactStore({ backend, projectId, defaultAuthor: author }) };
};

describe("GitArtifactStore (local, no remote)", () => {
  it.effect("commits created files as real git history and reads them back", () =>
    Effect.gen(function* () {
      const fs = createMemFs();
      const { backend, store } = makeStore(fs, "demo");
      yield* backend.init;
      yield* store.seed;

      yield* store.create(ArtifactRef.projectFile("config/a.json", "demo"), '{"a":1}');
      yield* store.create(ArtifactRef.projectFile("config/b.json", "demo"), '{"b":2}');
      const oid = yield* store.commit({ message: "Add config", actor: "user" });

      expect(oid).toMatch(/^[0-9a-f]{40}$/);

      const content = yield* store.read(ArtifactRef.projectFile("config/a.json", "demo"));
      expect(content).toBe('{"a":1}');

      const log = yield* store.log();
      expect(log).toHaveLength(1);
      expect(log[0]?.message).toContain("Add config");
      expect(log[0]?.message).toContain("Actor: user");
    }),
  );

  it.effect("a fresh store over the same repo seeds pending entries and hydrates lazily", () =>
    Effect.gen(function* () {
      const fs = createMemFs();
      const first = makeStore(fs, "demo");
      yield* first.backend.init;
      yield* first.store.seed;
      yield* first.store.create(ArtifactRef.projectFile("forms/x.json", "demo"), '{"x":true}');
      yield* first.store.commit({ message: "seed", actor: "system" });

      // A brand-new store sharing only the on-disk repo — must rebuild from git.
      const second = makeStore(fs, "demo");
      const refs = yield* second.store.seed;
      expect(refs.map((ref) => (ref._tag === "ProjectFile" ? ref.path : ""))).toEqual([
        "forms/x.json",
      ]);

      const entries = yield* second.store.entries!;
      expect(entries.every(isPendingEntry)).toBe(true);

      const content = yield* second.store.read(ArtifactRef.projectFile("forms/x.json", "demo"));
      expect(content).toBe('{"x":true}');

      const after = yield* second.store.entries!;
      expect(after.filter(isLoadedEntry)).toHaveLength(1);
    }),
  );

  it.effect("write and delete stage into the next commit", () =>
    Effect.gen(function* () {
      const fs = createMemFs();
      const { backend, store } = makeStore(fs, "demo");
      yield* backend.init;
      yield* store.seed;
      yield* store.create(ArtifactRef.projectFile("a.json", "demo"), "1");
      yield* store.create(ArtifactRef.projectFile("b.json", "demo"), "2");
      yield* store.commit({ message: "init", actor: "user" });

      yield* store.write(ArtifactRef.projectFile("a.json", "demo"), "10");
      yield* store.delete(ArtifactRef.projectFile("b.json", "demo"));
      yield* store.commit({ message: "edit", actor: "user" });

      const reopened = makeStore(fs, "demo");
      yield* reopened.store.seed;
      const refs = yield* reopened.store.list;
      expect(refs.map((ref) => (ref._tag === "ProjectFile" ? ref.path : ""))).toEqual(["a.json"]);
      expect(yield* reopened.store.read(ArtifactRef.projectFile("a.json", "demo"))).toBe("10");

      const log = yield* reopened.store.log();
      expect(log).toHaveLength(2);
      expect(log[0]?.parents).toEqual([log[1]?.oid]);
    }),
  );

  it.effect("uses the Effect Clock for default commit timestamps", () =>
    Effect.gen(function* () {
      const fs = createMemFs();
      const backend = makeGitRepoBackend({ fs, dir: "/repo", branch: "main" });
      const store = makeGitArtifactStore({ backend, projectId: "demo" });
      yield* TestClock.setTime(1_725_811_200_000);
      yield* backend.init;
      yield* store.seed;
      yield* store.create(ArtifactRef.projectFile("clock.json", "demo"), '{"ok":true}');

      yield* store.commit({ message: "clocked", actor: "system" });

      const log = yield* store.log();
      expect(log[0]?.author.timestamp).toBe(1_725_811_200);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("preserves binary content as bytes through a commit round-trip", () =>
    Effect.gen(function* () {
      const fs = createMemFs();
      const { backend, store } = makeStore(fs, "demo");
      yield* backend.init;
      yield* store.seed;
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
      yield* store.create(ArtifactRef.projectFile("assets/logo.png", "demo"), png);
      yield* store.commit({ message: "logo", actor: "user" });

      const reopened = makeStore(fs, "demo");
      yield* reopened.store.seed;
      const content = yield* reopened.store.read(
        ArtifactRef.projectFile("assets/logo.png", "demo"),
      );
      expect(content).toBeInstanceOf(Uint8Array);
      expect([...(content as Uint8Array)]).toEqual([...png]);
    }),
  );

  it.effect("composes provider + backend + store and seeds (local provider)", () =>
    Effect.gen(function* () {
      const provider = memoryRepoProvider();
      const store = yield* makeGitArtifactStoreFromProvider({
        provider,
        repo: "ws-abc",
        fs: createMemFs(),
        projectId: "ws-abc",
        defaultAuthor: author,
      });
      yield* store.create(ArtifactRef.projectFile("config/main.json", "ws-abc"), '{"ok":true}');
      const oid = yield* store.commit({ message: "Initial config", actor: "agent" });
      expect(oid).toMatch(/^[0-9a-f]{40}$/);
      expect(yield* store.read(ArtifactRef.projectFile("config/main.json", "ws-abc"))).toBe(
        '{"ok":true}',
      );
      const log = yield* store.log();
      expect(log[0]?.message).toContain("Actor: agent");
    }),
  );

  it.effect("memoryRepoProvider yields a local-only handle", () =>
    Effect.gen(function* () {
      const provider = memoryRepoProvider();
      const handle = yield* provider.ensure("ws-123");
      expect(handle).toMatchObject({ name: "ws-123", remote: null, defaultBranch: "main" });
      expect(yield* provider.token("ws-123", "write")).toBeNull();
    }),
  );

  it.effect("forks and fast-forward merges branches through the shared browser-safe backend", () =>
    Effect.gen(function* () {
      const fs = createMemFs();
      const mainBackend = makeGitRepoBackend({ fs, dir: "/repo", branch: "main" });
      const mainStore = makeGitArtifactStore({
        backend: mainBackend,
        projectId: "demo",
        defaultAuthor: author,
      });
      yield* mainBackend.init;
      yield* mainStore.seed;
      yield* mainStore.create(ArtifactRef.projectFile("account.yaml", "demo"), "name: Mina\n");
      const mainSeed = yield* mainStore.commit({ message: "Pull Mina", actor: "system" });

      const fork = yield* mainBackend.forkBranch({ branch: "draft/mina-q3", checkout: false });
      expect(fork).toEqual({ branch: "draft/mina-q3", oid: mainSeed });

      const draftBackend = makeGitRepoBackend({ fs, dir: "/repo", branch: "draft/mina-q3" });
      yield* draftBackend.checkout();
      const draftStore = makeGitArtifactStore({
        backend: draftBackend,
        projectId: "demo",
        defaultAuthor: author,
      });
      yield* draftStore.seed;
      yield* draftStore.write(ArtifactRef.projectFile("account.yaml", "demo"), "name: Mina Q3\n");
      const draftHead = yield* draftStore.commit({ message: "Agent edits draft", actor: "agent" });

      yield* mainBackend.checkout();
      expect(yield* mainBackend.head).toBe(mainSeed);
      expect(yield* draftBackend.head).toBe(draftHead);

      const merge = yield* mainBackend.mergeBranch({ branch: "draft/mina-q3" });
      expect(merge).toMatchObject({
        branch: "draft/mina-q3",
        into: "main",
        oid: draftHead,
        fastForward: true,
        alreadyMerged: false,
      });
      expect(yield* mainBackend.head).toBe(draftHead);

      const reopenedMain = makeGitArtifactStore({
        backend: mainBackend,
        projectId: "demo",
        defaultAuthor: author,
      });
      yield* reopenedMain.seed;
      expect(yield* reopenedMain.read(ArtifactRef.projectFile("account.yaml", "demo"))).toBe(
        "name: Mina Q3\n",
      );
    }),
  );

  it.effect(
    "rejects divergent shared-backend branch merges with the product conflict message",
    () =>
      Effect.gen(function* () {
        const fs = createMemFs();
        const mainBackend = makeGitRepoBackend({ fs, dir: "/repo", branch: "main" });
        const mainStore = makeGitArtifactStore({
          backend: mainBackend,
          projectId: "demo",
          defaultAuthor: author,
        });
        yield* mainBackend.init;
        yield* mainStore.seed;
        yield* mainStore.create(ArtifactRef.projectFile("account.yaml", "demo"), "name: Mina\n");
        yield* mainStore.commit({ message: "Pull Mina", actor: "system" });
        yield* mainBackend.forkBranch({ branch: "draft/mina-q3", checkout: false });

        const draftBackend = makeGitRepoBackend({ fs, dir: "/repo", branch: "draft/mina-q3" });
        yield* draftBackend.checkout();
        const draftStore = makeGitArtifactStore({
          backend: draftBackend,
          projectId: "demo",
          defaultAuthor: author,
        });
        yield* draftStore.seed;
        yield* draftStore.write(ArtifactRef.projectFile("account.yaml", "demo"), "name: Draft\n");
        yield* draftStore.commit({ message: "Edit draft", actor: "agent" });

        yield* mainBackend.checkout();
        yield* mainStore.seed;
        yield* mainStore.write(ArtifactRef.projectFile("account.yaml", "demo"), "name: Main\n");
        yield* mainStore.commit({ message: "Edit main", actor: "user" });

        const error = yield* Effect.flip(mainBackend.mergeBranch({ branch: "draft/mina-q3" }));
        expect(error.message).toContain("Cannot fast-forward merge draft/mina-q3 into main");
        expect(error.message).toContain("main and draft/mina-q3 have diverged");
      }),
  );
});

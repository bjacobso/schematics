import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { ArtifactRef } from "@schema-ide/artifacts";
import { Effect } from "effect";
import {
  findGitRoot,
  makeLocalGitArtifactStore,
  makeLocalGitCommitter,
  makeNodeGitRepoBackend,
} from "../src/node";

const run = Effect.runPromise;
const dirs: string[] = [];

const tempRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), "git-artifacts-"));
  dirs.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("local git artifact store (node:fs)", () => {
  it("findGitRoot returns null outside a repo and the root inside one", async () => {
    const dir = tempRepo();
    expect(findGitRoot(dir)).toBeNull();
    const backend = makeNodeGitRepoBackend({ dir });
    await run(backend.init);
    expect(findGitRoot(dir)).toBe(dir);
    expect(findGitRoot(join(dir, "sub", "deeper"))).toBe(dir);
  });

  it("commits real files to the on-disk repo and reads them back via the store", async () => {
    const dir = tempRepo();
    await run(makeNodeGitRepoBackend({ dir }).init);

    const store = makeLocalGitArtifactStore({
      dir,
      projectId: "local",
      defaultAuthor: { name: "Dev", email: "dev@example.com", timestamp: 1_700_000_000 },
    });
    expect(store).not.toBeNull();

    await run(store!.seed);
    await run(store!.create(ArtifactRef.projectFile("schema/user.json", "local"), '{"name":"x"}'));
    const oid = await run(store!.commit({ message: "Add user schema", actor: "user" }));
    expect(oid).toMatch(/^[0-9a-f]{40}$/);

    const log = await run(store!.log());
    expect(log[0]?.message).toContain("Add user schema");
    expect(await run(store!.read(ArtifactRef.projectFile("schema/user.json", "local")))).toBe(
      '{"name":"x"}',
    );
  });

  it("makeLocalGitCommitter is null outside a repo, commits working-tree files inside one", async () => {
    const dir = tempRepo();
    expect(makeLocalGitCommitter({ directory: dir })).toBeNull();

    await run(makeNodeGitRepoBackend({ dir }).init);
    const committer = makeLocalGitCommitter({ directory: dir });
    expect(committer).not.toBeNull();

    // Simulate what the CLI does: write to disk, then commit those paths.
    mkdirSync(join(dir, "forms"), { recursive: true });
    writeFileSync(join(dir, "forms", "a.json"), '{"a":1}');
    const author = { name: "Dev", email: "dev@x.com", timestamp: 1_700_000_000 };
    const oid = await run(
      committer!.commit({ changed: ["forms/a.json"], message: "Add form", author }),
    );
    expect(oid).toMatch(/^[0-9a-f]{40}$/);

    // Reading it back through a store confirms the commit landed in the tree.
    const store = makeLocalGitArtifactStore({ dir, projectId: "p", defaultAuthor: author })!;
    await run(store.seed);
    expect(await run(store.read(ArtifactRef.projectFile("forms/a.json", "p")))).toBe('{"a":1}');
  });
});

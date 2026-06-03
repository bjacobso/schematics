import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { ArtifactRef } from "@schematics/artifacts";
import { Effect } from "effect";
import {
  findGitRoot,
  forkLocalGitBranch,
  makeLocalGitArtifactStore,
  makeLocalGitCommitter,
  makeNodeGitRepoBackend,
  mergeLocalGitBranch,
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

  it("local committer follows the checked-out branch for draft commits", async () => {
    const dir = tempRepo();
    await run(makeNodeGitRepoBackend({ dir }).init);
    const committer = makeLocalGitCommitter({ directory: dir });
    expect(committer).not.toBeNull();

    const author = { name: "Dev", email: "dev@x.com", timestamp: 1_700_000_000 };
    mkdirSync(join(dir, "forms"), { recursive: true });
    writeFileSync(join(dir, "forms", "a.json"), '{"a":1}');
    await run(committer!.commit({ changed: ["forms/a.json"], message: "Add form", author }));

    await run(forkLocalGitBranch({ directory: dir, branch: "draft/mina-q3" }));
    writeFileSync(join(dir, "forms", "draft.json"), '{"draft":true}');
    const draftOid = await run(
      committer!.commit({ changed: ["forms/draft.json"], message: "Draft edit", author }),
    );
    expect(draftOid).toMatch(/^[0-9a-f]{40}$/);

    const draftLog = execFileSync("git", ["-C", dir, "log", "--format=%s", "-1", "draft/mina-q3"], {
      encoding: "utf8",
    });
    const mainLog = execFileSync("git", ["-C", dir, "log", "--format=%s", "-1", "main"], {
      encoding: "utf8",
    });
    expect(draftLog.trim()).toBe("Draft edit");
    expect(mainLog.trim()).toBe("Add form");

    const merge = await run(mergeLocalGitBranch({ directory: dir, branch: "draft/mina-q3" }));
    expect(merge).toMatchObject({
      branch: "draft/mina-q3",
      into: "main",
      fastForward: true,
      alreadyMerged: false,
    });
    expect(execFileSync("git", ["-C", dir, "rev-parse", "main"], { encoding: "utf8" }).trim()).toBe(
      draftOid,
    );
  });

  it("mergeLocalGitBranch rejects divergent branches with an explicit conflict message", async () => {
    const dir = tempRepo();
    await run(makeNodeGitRepoBackend({ dir }).init);
    const committer = makeLocalGitCommitter({ directory: dir });
    expect(committer).not.toBeNull();

    const author = { name: "Dev", email: "dev@x.com", timestamp: 1_700_000_000 };
    mkdirSync(join(dir, "forms"), { recursive: true });
    writeFileSync(join(dir, "forms", "base.json"), '{"base":true}');
    await run(committer!.commit({ changed: ["forms/base.json"], message: "Base", author }));

    await run(forkLocalGitBranch({ directory: dir, branch: "draft/mina-q3" }));
    writeFileSync(join(dir, "forms", "draft.json"), '{"draft":true}');
    await run(committer!.commit({ changed: ["forms/draft.json"], message: "Draft edit", author }));

    execFileSync("git", ["-C", dir, "checkout", "-q", "main"]);
    writeFileSync(join(dir, "forms", "main.json"), '{"main":true}');
    await run(committer!.commit({ changed: ["forms/main.json"], message: "Main edit", author }));

    const error = await run(
      Effect.flip(mergeLocalGitBranch({ directory: dir, branch: "draft/mina-q3" })),
    );
    expect(error.message).toContain("Cannot fast-forward merge draft/mina-q3 into main");
    expect(error.message).toContain("have diverged");
    expect(error.message).toContain("resolve the git conflict");
    expect(
      execFileSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], {
        encoding: "utf8",
      }).trim(),
    ).toBe("main");
  });
});

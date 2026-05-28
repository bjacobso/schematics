import { beforeAll, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import type { DurableObjectStorage, DurableObjectTransaction } from "cloudflare:workers";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    protected readonly ctx: unknown;
    protected readonly env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

let makeDurableObjectBranchService: typeof import("../src/workspace-object").makeDurableObjectBranchService;
let makeDurableObjectWorkspaceService: typeof import("../src/workspace-object").makeDurableObjectWorkspaceService;

beforeAll(async () => {
  const module = await import("../src/workspace-object");
  makeDurableObjectBranchService = module.makeDurableObjectBranchService;
  makeDurableObjectWorkspaceService = module.makeDurableObjectWorkspaceService;
});

describe("workspace-object branch services", () => {
  it("creates, edits, compares, and merges hosted workspace branches", async () => {
    const storage = new MemoryDurableObjectStorage();
    await seedHostedWorkspace(storage, [
      { path: "actions/email.json", content: '{"id":"email","label":"Email"}\n' },
      {
        path: "workflows/onboarding.json",
        content: '{"id":"onboarding","actionIds":["email"]}\n',
      },
    ]);
    const branches = makeDurableObjectBranchService(storage);
    const created = await Effect.runPromise(
      branches.createBranch({ name: "Hosted draft", createdBy: "agent" }),
    );
    const draftWorkspace = makeDurableObjectWorkspaceService(storage, created.branch.id);

    await Effect.runPromise(
      draftWorkspace.applyChange({
        type: "writeFile",
        path: "actions/email.json",
        content: '{"id":"email","label":"Hosted draft"}\n',
      }),
    );

    const mainBeforeMerge = await Effect.runPromise(
      makeDurableObjectWorkspaceService(storage).getSnapshot,
    );
    const comparison = await Effect.runPromise(
      branches.compareBranch({ sourceBranchId: created.branch.id }),
    );
    const merge = await Effect.runPromise(
      branches.mergeBranch({ sourceBranchId: created.branch.id }),
    );
    const mainAfterMerge = await Effect.runPromise(
      makeDurableObjectWorkspaceService(storage).getSnapshot,
    );

    expect(mainBeforeMerge.files.find((file) => file.path === "actions/email.json")?.content).toBe(
      '{"id":"email","label":"Email"}\n',
    );
    expect(comparison).toMatchObject({
      sourceBranchId: created.branch.id,
      targetBranchId: "main",
      mergeable: true,
      files: [expect.objectContaining({ type: "modified", path: "actions/email.json" })],
    });
    expect(merge).toMatchObject({ status: "merged" });
    expect(mainAfterMerge.files.find((file) => file.path === "actions/email.json")?.content).toBe(
      '{"id":"email","label":"Hosted draft"}\n',
    );
  });

  it("reports hosted branch conflicts without overwriting main", async () => {
    const storage = new MemoryDurableObjectStorage();
    await seedHostedWorkspace(storage, [
      { path: "actions/email.json", content: '{"id":"email","label":"Base"}\n' },
      {
        path: "workflows/onboarding.json",
        content: '{"id":"onboarding","actionIds":["email"]}\n',
      },
    ]);
    const branches = makeDurableObjectBranchService(storage);
    const created = await Effect.runPromise(branches.createBranch({ name: "Conflict draft" }));
    const mainWorkspace = makeDurableObjectWorkspaceService(storage);
    const draftWorkspace = makeDurableObjectWorkspaceService(storage, created.branch.id);

    await Effect.runPromise(
      mainWorkspace.applyChange({
        type: "writeFile",
        path: "actions/email.json",
        content: '{"id":"email","label":"Main"}\n',
      }),
    );
    await Effect.runPromise(
      draftWorkspace.applyChange({
        type: "writeFile",
        path: "actions/email.json",
        content: '{"id":"email","label":"Draft"}\n',
      }),
    );

    const merge = await Effect.runPromise(
      branches.mergeBranch({ sourceBranchId: created.branch.id }),
    );
    const mainAfterMerge = await Effect.runPromise(mainWorkspace.getSnapshot);

    expect(merge.status).toBe("conflicts");
    if (merge.status === "conflicts") {
      expect(merge.conflicts).toEqual([
        expect.objectContaining({
          type: "content",
          path: "actions/email.json",
        }),
      ]);
    }
    expect(mainAfterMerge.files.find((file) => file.path === "actions/email.json")?.content).toBe(
      '{"id":"email","label":"Main"}\n',
    );

    const forcedMerge = await Effect.runPromise(
      branches.mergeBranch({ sourceBranchId: created.branch.id, strategy: "source-wins" }),
    );
    const mainAfterForcedMerge = await Effect.runPromise(mainWorkspace.getSnapshot);

    expect(forcedMerge).toMatchObject({ status: "merged" });
    expect(
      mainAfterForcedMerge.files.find((file) => file.path === "actions/email.json")?.content,
    ).toBe('{"id":"email","label":"Draft"}\n');
  });
});

async function seedHostedWorkspace(
  storage: DurableObjectStorage,
  files: readonly { readonly path: string; readonly content: string }[],
): Promise<void> {
  const now = new Date(0).toISOString();
  await storage.put("metadata", {
    workspaceId: "workspace-test",
    templateId: "workflow-json",
    title: "Workflow JSON",
    defaultFormat: "json",
    createdAt: now,
    updatedAt: now,
    revision: 0,
  });
  await storage.put("branch:main:metadata", {
    id: "main",
    name: "main",
    kind: "main",
    baseBranchId: null,
    baseRevisionId: null,
    headRevisionId: null,
    createdAt: 0,
    updatedAt: 0,
    title: "Workflow JSON",
    revision: 0,
  });
  for (const file of files) {
    await storage.put(`file:${encodeURIComponent(file.path)}`, file);
    await storage.put(`branch:main:file:${encodeURIComponent(file.path)}`, file);
  }
}

class MemoryDurableObjectStorage implements DurableObjectStorage, DurableObjectTransaction {
  private readonly values = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async list<T = unknown>(
    options: { readonly prefix?: string | undefined } = {},
  ): Promise<Map<string, T>> {
    const entries = [...this.values.entries()].filter(([key]) =>
      options.prefix ? key.startsWith(options.prefix) : true,
    );
    return new Map(entries) as Map<string, T>;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async transaction<T>(closure: (transaction: DurableObjectTransaction) => Promise<T>): Promise<T> {
    return closure(this);
  }

  async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
    if (Array.isArray(keyOrKeys)) {
      let deleted = 0;
      for (const key of keyOrKeys) {
        if (this.values.delete(key)) deleted += 1;
      }
      return deleted;
    }
    return this.values.delete(keyOrKeys);
  }
}

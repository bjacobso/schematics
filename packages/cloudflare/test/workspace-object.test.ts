import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { makeDurableObjectWorkspaceService } from "../src/workspace-object";

/**
 * A minimal in-memory stand-in for the Durable Object storage API the service
 * uses (`get` / `list` / `put` / `delete` / `transaction`). Transactions run
 * against the same map — enough to exercise the real persistence + view-read
 * paths that the namespace-mocked worker-runtime test can't reach.
 */
function makeStorage(seed: ReadonlyArray<readonly [string, unknown]>) {
  const map = new Map<string, unknown>(seed);
  const api = {
    get: async (key: string) => map.get(key),
    list: async (options?: { prefix?: string }) => {
      const prefix = options?.prefix;
      const out = new Map<string, unknown>();
      for (const [key, value] of map) {
        if (!prefix || key.startsWith(prefix)) out.set(key, value);
      }
      return out;
    },
    put: async (key: string, value: unknown) => {
      map.set(key, value);
    },
    delete: async (keys: string | readonly string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) map.delete(key);
      return true;
    },
    transaction: async <A>(fn: (txn: typeof api) => Promise<A>) => fn(api),
  };
  return { api, map };
}

const baseMetadata = {
  workspaceId: "ws-test",
  templateId: "workflow-json",
  title: "Workflow",
  defaultFormat: "json" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  revision: 0,
};

describe("durable object workspace service", () => {
  it("persists a change and reflects it in the next snapshot", async () => {
    const { api, map } = makeStorage([["metadata", baseMetadata]]);
    const service = makeDurableObjectWorkspaceService(api as never);

    const change = await Effect.runPromise(
      service.applyChange({
        type: "createFile",
        path: "actions/test.json",
        content: '{"id":"test","kind":"email","label":"Test"}',
      }),
    );

    expect(change.revision).toBe(1);
    expect(change.changedPaths).toContain("actions/test.json");
    // The write actually landed in storage under the file-prefixed key
    // (paths are URL-encoded in the key).
    expect(map.has(`file:${encodeURIComponent("actions/test.json")}`)).toBe(true);
    // Metadata revision advanced.
    expect((map.get("metadata") as { revision: number }).revision).toBe(1);
  });

  it("broadcasts only { revision, files } — reflection/views stay pull-only", async () => {
    const { api } = makeStorage([["metadata", baseMetadata]]);
    const service = makeDurableObjectWorkspaceService(api as never);

    await Effect.runPromise(
      service.applyChange({
        type: "createFile",
        path: "actions/test.json",
        content: '{"id":"test","kind":"email","label":"Test"}',
      }),
    );

    const snapshot = await Effect.runPromise(service.getSnapshot);
    expect(Object.keys(snapshot).sort()).toEqual(["files", "revision"]);
    expect(snapshot.revision).toBe(1);
    expect(snapshot.files.some((file) => file.path === "actions/test.json")).toBe(true);
  });

  it("reads a typed artifact view on demand through the rebuilt DO", async () => {
    const { api } = makeStorage([["metadata", baseMetadata]]);
    const service = makeDurableObjectWorkspaceService(api as never);

    await Effect.runPromise(
      service.applyChange({
        type: "createFile",
        path: "actions/test.json",
        content: '{"id":"test","kind":"email","label":"Test"}',
      }),
    );

    const ref = { _tag: "ProjectFile", path: "actions/test.json" } as const;
    // `decodedValue` is a typed per-file view (the file decoded against its
    // route schema). Two reads exercise the DO's shared cache path; the value
    // is identical whether served fresh or from cache.
    const first = await Effect.runPromise(service.readArtifactView({ ref, view: "decodedValue" }));
    const second = await Effect.runPromise(service.readArtifactView({ ref, view: "decodedValue" }));

    expect(first.value).toMatchObject({ id: "test", label: "Test" });
    expect(second.value).toEqual(first.value);
  });
});

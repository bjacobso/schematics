import type {
  CloudflareArtifactsBinding,
  CloudflareArtifactsRepo,
} from "@schematics/git-artifacts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleHostedWorkspaceRequest,
  isWorkspaceId,
  type DurableObjectIdBinding,
  type DurableObjectNamespaceBinding,
} from "../src/worker-runtime";

const validWorkspaceId = "92ce5ac5-b37c-4a68-9af6-2d4683ef8beb";

function makeWorkspaceNamespace(): DurableObjectNamespaceBinding {
  return {
    idFromName: (name) => ({ name }) as DurableObjectIdBinding,
    get: () => ({
      fetch: async (request) =>
        Response.json({
          pathname: new URL(request.url).pathname,
        }),
    }),
  };
}

interface MakeArtifactsBindingOptions {
  readonly throwNotFound?: boolean | undefined;
  readonly omitDefaultBranchOnGet?: boolean | undefined;
}

function makeArtifactsBinding(options: MakeArtifactsBindingOptions = {}): {
  readonly binding: CloudflareArtifactsBinding;
  readonly tokens: string[];
} {
  const tokens: string[] = [];
  const repo = (name: string, repoOptions: { readonly defaultBranch?: boolean } = {}) =>
    ({
      name,
      remote: `https://artifacts.example/git/workspaces/${name}.git`,
      ...(repoOptions.defaultBranch === false ? {} : { defaultBranch: "main" }),
      createToken: async (scope) => {
        tokens.push(scope);
        return { plaintext: `${scope}-secret?expires=999`, scope, expiresAt: 999 };
      },
    }) as CloudflareArtifactsRepo;
  const repos = new Map<string, CloudflareArtifactsRepo>([
    [validWorkspaceId, repo(validWorkspaceId)],
  ]);
  return {
    tokens,
    binding: {
      create: async (name) => {
        const created = repo(name);
        repos.set(name, created);
        return created;
      },
      get: async (name) => {
        const existing = repos.get(name);
        if (!existing && options.throwNotFound) {
          throw new Error(`ArtifactsError: Repository not found: ${name}.`);
        }
        if (existing && options.omitDefaultBranchOnGet) {
          return repo(name, { defaultBranch: false });
        }
        return existing ?? null;
      },
      delete: async (name) => repos.delete(name),
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("worker-runtime", () => {
  it("accepts RFC UUID workspace ids", () => {
    expect(isWorkspaceId(validWorkspaceId)).toBe(true);
    expect(isWorkspaceId("92ce5ac5-b37c-4a68-9af62d4683ef8beb")).toBe(false);
    expect(isWorkspaceId("not-a-workspace-id")).toBe(false);
  });

  it("routes valid workspace metadata requests to the durable object", async () => {
    const response = await handleHostedWorkspaceRequest(
      new Request(`https://schematics.test/v1/workspaces/${validWorkspaceId}`),
      {
        SCHEMATICS_WORKSPACES: makeWorkspaceNamespace(),
      },
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      pathname: "/internal/metadata",
    });
  });

  it("adds proxied git metadata to hosted workspace metadata responses", async () => {
    const { binding, tokens } = makeArtifactsBinding();
    const response = await handleHostedWorkspaceRequest(
      new Request(`https://schematics.test/v1/workspaces/${validWorkspaceId}`),
      {
        SCHEMATICS_WORKSPACES: makeWorkspaceNamespace(),
        SCHEMATICS_ARTIFACTS: binding,
      },
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      pathname: "/internal/metadata",
      git: {
        remote: `https://schematics.test/v1/workspaces/${validWorkspaceId}/git`,
        defaultBranch: "main",
      },
    });
    expect(tokens).toEqual([]);
  });

  it("uses main when an existing Artifacts repo omits defaultBranch", async () => {
    const { binding } = makeArtifactsBinding({ omitDefaultBranchOnGet: true });
    const response = await handleHostedWorkspaceRequest(
      new Request(`https://schematics.test/v1/workspaces/${validWorkspaceId}`),
      {
        SCHEMATICS_WORKSPACES: makeWorkspaceNamespace(),
        SCHEMATICS_ARTIFACTS: binding,
      },
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      git: {
        defaultBranch: "main",
      },
    });
  });

  it("creates hosted workspaces with a proxied git remote and no browser token", async () => {
    const { binding, tokens } = makeArtifactsBinding();
    const response = await handleHostedWorkspaceRequest(
      new Request("https://schematics.test/v1/workspaces", { method: "POST" }),
      {
        SCHEMATICS_WORKSPACES: makeWorkspaceNamespace(),
        SCHEMATICS_ARTIFACTS: binding,
      },
    );

    expect(response?.status).toBe(201);
    const body = (await response?.json()) as {
      readonly workspaceId: string;
      readonly git?: {
        readonly remote: string;
        readonly defaultBranch: string;
        readonly token?: string;
      };
    };
    expect(body.workspaceId).toMatch(/[0-9a-f-]{36}/);
    expect(body.git).toMatchObject({
      remote: `https://schematics.test/v1/workspaces/${body.workspaceId}/git`,
      defaultBranch: "main",
    });
    expect(body.git).not.toHaveProperty("token");
    expect(tokens).toEqual([]);
  });

  it("creates hosted git repos when Artifacts get throws not found", async () => {
    const { binding } = makeArtifactsBinding({ throwNotFound: true });
    const response = await handleHostedWorkspaceRequest(
      new Request("https://schematics.test/v1/workspaces", { method: "POST" }),
      {
        SCHEMATICS_WORKSPACES: makeWorkspaceNamespace(),
        SCHEMATICS_ARTIFACTS: binding,
      },
    );

    expect(response?.status).toBe(201);
    await expect(response?.json()).resolves.toMatchObject({
      git: {
        defaultBranch: "main",
      },
    });
  });

  it("proxies hosted git smart-http requests with server-side credentials", async () => {
    const { binding, tokens } = makeArtifactsBinding();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("refs", {
        status: 200,
        headers: { "Content-Type": "application/x-git-upload-pack-advertisement" },
      }),
    );

    const response = await handleHostedWorkspaceRequest(
      new Request(
        `https://schematics.test/v1/workspaces/${validWorkspaceId}/git/info/refs?service=git-upload-pack`,
      ),
      {
        SCHEMATICS_ARTIFACTS: binding,
      },
    );

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe("refs");
    expect(tokens).toEqual(["read"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [target, init] = fetchSpy.mock.calls[0]!;
    expect(target).toBe(
      `https://artifacts.example/git/workspaces/${validWorkspaceId}.git/info/refs?service=git-upload-pack`,
    );
    expect(init?.method).toBe("GET");
    expect((init?.headers as Headers).get("Authorization")).toBe(`Basic ${btoa("x:read-secret")}`);
  });

  it("mints write credentials for hosted git receive-pack requests", async () => {
    const { binding, tokens } = makeArtifactsBinding();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const response = await handleHostedWorkspaceRequest(
      new Request(
        `https://schematics.test/v1/workspaces/${validWorkspaceId}/git/git-receive-pack`,
        {
          method: "POST",
          body: "pack",
        },
      ),
      {
        SCHEMATICS_ARTIFACTS: binding,
      },
    );

    expect(response?.status).toBe(200);
    expect(tokens).toEqual(["write"]);
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect((init?.headers as Headers).get("Authorization")).toBe(`Basic ${btoa("x:write-secret")}`);
  });
});

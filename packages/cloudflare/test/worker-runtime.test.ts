import { describe, expect, it } from "vitest";
import {
  handleHostedWorkspaceRequest,
  isBranchId,
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

describe("worker-runtime", () => {
  it("accepts RFC UUID workspace ids", () => {
    expect(isWorkspaceId(validWorkspaceId)).toBe(true);
    expect(isWorkspaceId("92ce5ac5-b37c-4a68-9af62d4683ef8beb")).toBe(false);
    expect(isWorkspaceId("not-a-workspace-id")).toBe(false);
  });

  it("accepts branch ids for branch-scoped routes", () => {
    expect(isBranchId("main")).toBe(true);
    expect(isBranchId("branch-123_review")).toBe(true);
    expect(isBranchId("../escape")).toBe(false);
    expect(isBranchId("")).toBe(false);
  });

  it("routes valid workspace metadata requests to the durable object", async () => {
    const response = await handleHostedWorkspaceRequest(
      new Request(`https://schema-ide.test/v1/workspaces/${validWorkspaceId}`),
      {
        SCHEMA_IDE_WORKSPACES: makeWorkspaceNamespace(),
      },
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      pathname: "/internal/metadata",
    });
  });

  it("routes branch collection requests to the durable object", async () => {
    const response = await handleHostedWorkspaceRequest(
      new Request(`https://schema-ide.test/v1/workspaces/${validWorkspaceId}/branches`),
      {
        SCHEMA_IDE_WORKSPACES: makeWorkspaceNamespace(),
      },
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      pathname: "/internal/branches",
    });
  });

  it("routes branch-scoped workspace RPC requests to the durable object", async () => {
    const response = await handleHostedWorkspaceRequest(
      new Request(
        `https://schema-ide.test/v1/workspaces/${validWorkspaceId}/branches/draft-1/rpc`,
        {
          method: "POST",
        },
      ),
      {
        SCHEMA_IDE_WORKSPACES: makeWorkspaceNamespace(),
      },
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      pathname: "/branches/draft-1/rpc",
    });
  });

  it("routes branch management RPC requests to the durable object", async () => {
    const response = await handleHostedWorkspaceRequest(
      new Request(`https://schema-ide.test/v1/workspaces/${validWorkspaceId}/branch-rpc`, {
        method: "POST",
      }),
      {
        SCHEMA_IDE_WORKSPACES: makeWorkspaceNamespace(),
      },
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      pathname: "/v1/workspace/branch-rpc",
    });
  });
});

import { describe, expect, it } from "vitest";
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
});

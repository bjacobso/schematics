import { describe, expect, it } from "@effect/vitest";
import { NodeFileSystem, NodeHttpPlatform, NodePath } from "@effect/platform-node";
import { Layer } from "effect";
import { Etag, HttpRouter } from "effect/unstable/http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SchemaIdeWorkspaceError,
  type SchemaIdeWorkspaceClient,
  type WorkspaceCapabilities,
  type WorkspaceSnapshot,
} from "@schema-ide/protocol";
import { makeSchemaIdeAppLayer, runSchemaIdeHttpServer } from "../src";

describe("schema-ide-server", () => {
  it("serves the protocol through the standalone server layer", async () => {
    const AppLayer = makeSchemaIdeAppLayer({
      models: [{ id: "test/model", label: "Test Model" }],
    });
    const webHandler = HttpRouter.toWebHandler(
      AppLayer.pipe(
        Layer.provide([Etag.layer, NodeFileSystem.layer, NodeHttpPlatform.layer, NodePath.layer]),
      ),
    );

    try {
      const response = await webHandler.handler(
        new Request("http://localhost/v1/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "test/model",
            messages: [{ role: "user", content: "Hello" }],
          }),
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        choices: [
          {
            message: {
              role: "assistant",
              content:
                "Local Schema IDE debug server is running.\n\nReceived: Hello\n\nSet OPENROUTER_API_KEY to use a real model.",
            },
          },
        ],
      });
    } finally {
      await webHandler.dispose();
    }
  });

  it("boots the standalone Node HTTP server", async () => {
    const server = await runSchemaIdeHttpServer({
      openRouterApiKey: "test-key",
      port: 0,
      models: [{ id: "test/model", label: "Test Model" }],
    });

    try {
      const response = await fetch(`http://localhost:${server.port}/v1/healthz`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    } finally {
      await server.close();
    }
  });

  it("maps workspace compat route promise failures through tagged errors", async () => {
    const AppLayer = makeSchemaIdeAppLayer({
      workspaceClient: makeFailingWorkspaceClient(
        new SchemaIdeWorkspaceError("Unsafe workspace path", "unsafe-path"),
      ),
    });
    const webHandler = HttpRouter.toWebHandler(
      AppLayer.pipe(
        Layer.provide([Etag.layer, NodeFileSystem.layer, NodeHttpPlatform.layer, NodePath.layer]),
      ),
    );

    try {
      const response = await webHandler.handler(
        new Request("http://localhost/v1/workspace/snapshot"),
      );

      expect(response.status).toBe(400);
      await expect(response.text()).resolves.toBe("Unsafe workspace path");
    } finally {
      await webHandler.dispose();
    }
  });

  it("maps invalid workspace compat request bodies to 400", async () => {
    const AppLayer = makeSchemaIdeAppLayer({
      workspaceClient: makeFailingWorkspaceClient(new Error("should not be called")),
    });
    const webHandler = HttpRouter.toWebHandler(
      AppLayer.pipe(
        Layer.provide([Etag.layer, NodeFileSystem.layer, NodeHttpPlatform.layer, NodePath.layer]),
      ),
    );

    try {
      const response = await webHandler.handler(
        new Request("http://localhost/v1/workspace/change", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "missing" }),
        }),
      );

      expect(response.status).toBe(400);
    } finally {
      await webHandler.dispose();
    }
  });

  it("boots without an OpenRouter key for local isolated development", async () => {
    const server = await runSchemaIdeHttpServer({
      port: 0,
      models: [{ id: "local-debug", label: "Local Debug" }],
    });

    try {
      const modelsResponse = await fetch(`http://localhost:${server.port}/v1/models`);
      expect(modelsResponse.status).toBe(200);
      await expect(modelsResponse.json()).resolves.toEqual({
        models: [{ id: "local-debug", label: "Local Debug" }],
      });

      const response = await fetch(`http://localhost:${server.port}/v1/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "local-debug",
          messages: [{ role: "user", content: "Hello from the playground" }],
        }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        choices: [
          {
            message: {
              role: "assistant",
              content:
                "Local Schema IDE debug server is running.\n\nReceived: Hello from the playground\n\nSet OPENROUTER_API_KEY to use a real model.",
            },
          },
        ],
      });
    } finally {
      await server.close();
    }
  });

  it("serves a built playground next to the isolated HTTP API", async () => {
    const staticDir = await mkdtemp(join(tmpdir(), "schema-ide-static-"));
    await writeFile(join(staticDir, "index.html"), '<div id="root"></div>');
    await writeFile(join(staticDir, "app.js"), "globalThis.schemaIdeLoaded = true;");

    const server = await runSchemaIdeHttpServer({
      port: 0,
      staticDir,
    });

    try {
      const indexResponse = await fetch(`http://localhost:${server.port}/`);
      expect(indexResponse.status).toBe(200);
      expect(indexResponse.headers.get("content-type")).toBe("text/html; charset=utf-8");
      await expect(indexResponse.text()).resolves.toBe('<div id="root"></div>');

      const assetResponse = await fetch(`http://localhost:${server.port}/app.js`);
      expect(assetResponse.status).toBe(200);
      expect(assetResponse.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      await expect(assetResponse.text()).resolves.toBe("globalThis.schemaIdeLoaded = true;");

      const fallbackResponse = await fetch(`http://localhost:${server.port}/schema-ide`);
      expect(fallbackResponse.status).toBe(200);
      await expect(fallbackResponse.text()).resolves.toBe('<div id="root"></div>');

      const healthResponse = await fetch(`http://localhost:${server.port}/v1/healthz`);
      expect(healthResponse.status).toBe(200);
      await expect(healthResponse.json()).resolves.toEqual({ ok: true });
    } finally {
      await server.close();
      await rm(staticDir, { recursive: true, force: true });
    }
  });
});

function makeFailingWorkspaceClient(error: unknown): SchemaIdeWorkspaceClient {
  const capabilities: WorkspaceCapabilities = {
    mode: "local-filesystem",
    workspace: { readOnly: false },
    agent: { enabled: false },
    features: {
      watch: true,
      write: true,
      rename: true,
      delete: true,
      history: false,
      previews: true,
    },
  };
  const snapshot: WorkspaceSnapshot = {
    revision: 1,
    files: [],
    reflection: {
      mode: "workspace",
      activeFile: null,
      activeFormat: "json",
      files: [],
      schemas: [],
      activeJsonSchema: null,
      decodedValue: null,
      diagnostics: [],
      validationSummary: { valid: true, errorCount: 0, warningCount: 0, infoCount: 0 },
      routeMatches: [],
    },
  };

  return {
    getCapabilities: async () => capabilities,
    getSnapshot: async () => {
      throw error;
    },
    watchWorkspace: (onEvent) => {
      onEvent({ type: "snapshot", snapshot });
      return { unsubscribe: () => undefined };
    },
    applyChange: async () => {
      throw error;
    },
  };
}

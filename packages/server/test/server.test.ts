import { describe, expect, it } from "@effect/vitest";
import { NodeFileSystem, NodeHttpPlatform, NodePath } from "@effect/platform-node";
import { Layer } from "effect";
import { Etag, HttpRouter } from "effect/unstable/http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSchematicsAppLayer, runSchematicsHttpServer } from "../src";

describe("schematics-server", () => {
  it("serves the protocol through the standalone server layer", async () => {
    const AppLayer = makeSchematicsAppLayer({
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
                "Local Schematics server is running in debug chat mode.\n\nThis response is deterministic and did not call a model.\n\nReceived: Hello\n\nSet OPENROUTER_API_KEY to use a real model.",
            },
          },
        ],
      });
    } finally {
      await webHandler.dispose();
    }
  });

  it("boots the standalone Node HTTP server", async () => {
    const server = await runSchematicsHttpServer({
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

  it("boots without an OpenRouter key for local isolated development", async () => {
    const server = await runSchematicsHttpServer({
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
                "Local Schematics server is running in debug chat mode.\n\nThis response is deterministic and did not call a model.\n\nReceived: Hello from the playground\n\nSet OPENROUTER_API_KEY to use a real model.",
            },
          },
        ],
      });
    } finally {
      await server.close();
    }
  });

  it("labels hosted debug chat mode explicitly", async () => {
    const AppLayer = makeSchematicsAppLayer({
      debugChat: {
        runtimeName: "Schematics Cloudflare API worker",
        credentialHint:
          "Set OPENROUTER_API_KEY in the Cloudflare/Alchemy deployment environment and redeploy to use OpenRouter.",
        modelLabel: "Cloudflare Debug",
      },
    });
    const webHandler = HttpRouter.toWebHandler(
      AppLayer.pipe(
        Layer.provide([Etag.layer, NodeFileSystem.layer, NodeHttpPlatform.layer, NodePath.layer]),
      ),
    );

    try {
      const modelsResponse = await webHandler.handler(new Request("http://localhost/v1/models"));
      expect(modelsResponse.status).toBe(200);
      await expect(modelsResponse.json()).resolves.toEqual({
        models: [{ id: "local-debug", label: "Cloudflare Debug" }],
      });

      const response = await webHandler.handler(
        new Request("http://localhost/v1/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "local-debug",
            messages: [{ role: "user", content: "Add a reminder" }],
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
                "Schematics Cloudflare API worker is running in debug chat mode.\n\nThis response is deterministic and did not call a model.\n\nReceived: Add a reminder\n\nSet OPENROUTER_API_KEY in the Cloudflare/Alchemy deployment environment and redeploy to use OpenRouter.",
            },
          },
        ],
      });
    } finally {
      await webHandler.dispose();
    }
  });

  it("serves a built playground next to the isolated HTTP API", async () => {
    const staticDir = await mkdtemp(join(tmpdir(), "schematics-static-"));
    await writeFile(join(staticDir, "index.html"), '<div id="root"></div>');
    await writeFile(join(staticDir, "app.js"), "globalThis.schematicsLoaded = true;");

    const server = await runSchematicsHttpServer({
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
      await expect(assetResponse.text()).resolves.toBe("globalThis.schematicsLoaded = true;");

      const fallbackResponse = await fetch(`http://localhost:${server.port}/schematics`);
      expect(fallbackResponse.status).toBe(200);
      expect(fallbackResponse.headers.get("content-type")).toBe("text/html; charset=utf-8");
      await expect(fallbackResponse.text()).resolves.toBe('<div id="root"></div>');

      const healthResponse = await fetch(`http://localhost:${server.port}/v1/healthz`);
      expect(healthResponse.status).toBe(200);
      await expect(healthResponse.json()).resolves.toEqual({ ok: true });
    } finally {
      await server.close();
      await rm(staticDir, { recursive: true, force: true });
    }
  });

  it("serves embedded static assets without a filesystem directory", async () => {
    const server = await runSchematicsHttpServer({
      port: 0,
      staticAssets: {
        "index.html": btoa('<div id="root"></div>'),
        "assets/app.js": btoa("globalThis.schematicsLoaded = true;"),
      },
    });

    try {
      const indexResponse = await fetch(`http://localhost:${server.port}/`);
      expect(indexResponse.status).toBe(200);
      expect(indexResponse.headers.get("content-type")).toBe("text/html; charset=utf-8");
      await expect(indexResponse.text()).resolves.toBe('<div id="root"></div>');

      const assetResponse = await fetch(`http://localhost:${server.port}/assets/app.js`);
      expect(assetResponse.status).toBe(200);
      expect(assetResponse.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      await expect(assetResponse.text()).resolves.toBe("globalThis.schematicsLoaded = true;");

      const fallbackResponse = await fetch(`http://localhost:${server.port}/schematics`);
      expect(fallbackResponse.status).toBe(200);
      await expect(fallbackResponse.text()).resolves.toBe('<div id="root"></div>');

      const healthResponse = await fetch(`http://localhost:${server.port}/v1/healthz`);
      expect(healthResponse.status).toBe(200);
      await expect(healthResponse.json()).resolves.toEqual({ ok: true });
    } finally {
      await server.close();
    }
  });
});

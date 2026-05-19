import { describe, expect, it } from "vitest";
import { NodeFileSystem, NodeHttpPlatform, NodePath } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { Etag, HttpRouter } from "effect/unstable/http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSchemaIdeHttpApiLive, OpenRouterClient, runSchemaIdeHttpServer } from "../src";

describe("schema-ide-server", () => {
  it("serves the protocol through the standalone server layer", async () => {
    const ApiLayer = makeSchemaIdeHttpApiLive({
      models: [{ id: "test/model", label: "Test Model" }],
    }).pipe(
      Layer.provide(
        Layer.succeed(OpenRouterClient, {
          complete: (request) =>
            Effect.succeed({
              choices: [{ message: { role: "assistant" as const, content: request.model } }],
            }),
        }),
      ),
    );
    const webHandler = HttpRouter.toWebHandler(
      ApiLayer.pipe(
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
        choices: [{ message: { role: "assistant", content: "test/model" } }],
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

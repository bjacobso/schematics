import { describe, expect, it } from "@effect/vitest";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { hashDirectory } from "alchemy/Command/Memo";
import { readAssets } from "alchemy/Cloudflare";
import { Effect } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { playgroundMemo } from "../../../alchemy/playground-memo";

describe("playground deployment", () => {
  it("invalidates Alchemy's memo when public assets or workspace inputs change", async () => {
    const root = await mkdtemp(join(tmpdir(), "schematics-playground-memo-"));
    const playground = join(root, "apps/playground");
    const inputs = [
      "apps/playground/public/llms.txt",
      "apps/playground/public/_headers",
      "apps/playground/src/main.tsx",
      "alchemy/playground-memo.ts",
      "packages/core/src/index.ts",
      "packages/core/package.json",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.base.json",
      "vitest.aliases.ts",
    ];
    const hash = () =>
      Effect.runPromise(
        hashDirectory({ cwd: playground, memo: playgroundMemo }).pipe(
          Effect.provide([NodeFileSystem.layer, NodePath.layer]),
        ),
      );

    try {
      await mkdir(join(root, ".git"));
      await writeFile(join(root, ".gitignore"), "dist/\nnode_modules/\n");
      for (const input of inputs) {
        await mkdir(dirname(join(root, input)), { recursive: true });
        await writeFile(join(root, input), "original");
      }
      let previous = await hash();
      for (const input of inputs) {
        await writeFile(join(root, input), "changed");
        const current = await hash();
        expect(current, input).not.toBe(previous);
        previous = current;
      }
      await rm(join(playground, "public/llms.txt"));
      expect(await hash(), "removing llms.txt must also invalidate the memo").not.toBe(previous);
      previous = await hash();
      await writeFile(join(playground, "public/llms.txt"), "new asset");
      expect(await hash(), "adding llms.txt must invalidate the memo").not.toBe(previous);
      previous = await hash();
      await mkdir(join(playground, "dist"));
      await writeFile(join(playground, "dist/llms.txt"), "build output");
      expect(await hash(), "ignored build output must not trigger a rebuild").toBe(previous);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("includes llms.txt and text headers in Alchemy's assets with SPA fallback enabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "schematics-playground-assets-"));
    const publicDir = new URL("../../../apps/playground/public/", import.meta.url);
    const source = await readFile(new URL("llms.txt", publicDir), "utf8");
    const headers = await readFile(new URL("_headers", publicDir), "utf8");

    try {
      await writeFile(join(directory, "llms.txt"), source);
      await writeFile(join(directory, "_headers"), headers);
      await writeFile(join(directory, "index.html"), "<!doctype html><html></html>");
      const assets = await Effect.runPromise(
        readAssets({ directory, notFoundHandling: "single-page-application" }).pipe(
          Effect.provide([NodeFileSystem.layer, NodePath.layer]),
        ),
      );
      expect(assets.manifest["/llms.txt"]?.size).toBe(Buffer.byteLength(source));
      expect(assets.manifest["/index.html"]).toBeDefined();
      expect(assets.manifest["/_headers"]).toBeUndefined();
      expect(assets.config?.headers).toBe(headers);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

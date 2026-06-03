import { describe, expect, it } from "@effect/vitest";
import { createMemFs } from "../src/mem-fs";

const utf8 = (value: Uint8Array | string) =>
  typeof value === "string" ? value : new TextDecoder().decode(value);

describe("createMemFs", () => {
  it("writes and reads files, honoring the encoding option", async () => {
    const { promises: fs } = createMemFs();
    await fs.mkdir("/repo", { recursive: true });
    await fs.writeFile("/repo/a.txt", "hello");

    expect(utf8(await fs.readFile("/repo/a.txt", "utf8"))).toBe("hello");
    const bytes = await fs.readFile("/repo/a.txt");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(utf8(bytes)).toBe("hello");
  });

  it("creates nested directories recursively and lists them", async () => {
    const { promises: fs } = createMemFs();
    await fs.mkdir("/repo/nested/deep", { recursive: true });
    await fs.writeFile("/repo/nested/deep/x.json", "{}");

    expect((await fs.readdir("/repo")).includes("nested")).toBe(true);
    expect(await fs.readdir("/repo/nested/deep")).toEqual(["x.json"]);
  });

  it("reports ENOENT for missing paths and EEXIST for mkdir collisions", async () => {
    const { promises: fs } = createMemFs();
    await expect(fs.readFile("/missing")).rejects.toMatchObject({ code: "ENOENT" });
    await fs.mkdir("/dir");
    await expect(fs.mkdir("/dir")).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("stats distinguish files from directories", async () => {
    const { promises: fs } = createMemFs();
    await fs.mkdir("/repo", { recursive: true });
    await fs.writeFile("/repo/a.txt", "hi");
    expect((await fs.stat("/repo")).isDirectory()).toBe(true);
    expect((await fs.stat("/repo/a.txt")).isFile()).toBe(true);
    expect((await fs.stat("/repo/a.txt")).size).toBe(2);
  });
});

import { mkdtemp, readFile, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { makeMockOnboardedApi } from "../src/mock";
import { runOnboardedDeployCli } from "../src/deploy-cli";

const listForms = (api: ReturnType<typeof makeMockOnboardedApi>) =>
  Effect.runPromise(api.forms.list);

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "onboarded-deploy-cli-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("onboarded-deploy CLI", () => {
  it("pull writes files + lockfile, then plan is empty", async () => {
    await withTempDir(async (dir) => {
      const api = makeMockOnboardedApi();
      const pull = await runOnboardedDeployCli(["pull", "--dir", dir], { api });
      expect(pull.exitCode).toBe(0);
      expect(pull.stdout).toContain("Pulled 7 resource(s)");

      const lock = JSON.parse(await readFile(join(dir, "config.lock.json"), "utf8"));
      expect(lock.entries.length).toBe(7);
      const formFiles = await readdir(join(dir, "forms"));
      expect(formFiles.sort()).toEqual(["client-safety-packet.yaml", "employee-handbook.yaml"]);

      const plan = await runOnboardedDeployCli(["plan", "--dir", dir], { api });
      expect(plan.stdout).toContain("Plan: 0 to create, 0 to update, 0 to destroy");
    });
  });

  it("plan shows an edit; apply is gated until --auto-approve, then applies", async () => {
    await withTempDir(async (dir) => {
      const api = makeMockOnboardedApi();
      await runOnboardedDeployCli(["pull", "--dir", dir], { api });

      const formPath = join(dir, "forms/employee-handbook.yaml");
      const yaml = await readFile(formPath, "utf8");
      await writeFile(
        formPath,
        yaml.replace("name: Employee Handbook", "name: Employee Handbook v2"),
      );

      const plan = await runOnboardedDeployCli(["plan", "--dir", dir], { api });
      expect(plan.stdout).toContain("1 to update");
      expect(plan.stdout).toContain("~ name:");

      const gated = await runOnboardedDeployCli(["apply", "--dir", dir], { api });
      expect(gated.stdout).toContain("Re-run with --auto-approve");
      expect((await listForms(api)).find((f) => f.name === "Employee Handbook v2")).toBeUndefined();

      const applied = await runOnboardedDeployCli(["apply", "--dir", dir, "--auto-approve"], {
        api,
      });
      expect(applied.exitCode).toBe(0);
      expect(applied.stdout).toContain("Applied 1");
      expect((await listForms(api)).find((f) => f.name === "Employee Handbook v2")).toBeTruthy();
    });
  });

  it("destroy is gated, then removes every managed resource", async () => {
    await withTempDir(async (dir) => {
      const api = makeMockOnboardedApi();
      await runOnboardedDeployCli(["pull", "--dir", dir], { api });
      expect((await listForms(api)).length).toBe(2);

      const gated = await runOnboardedDeployCli(["destroy", "--dir", dir], { api });
      expect(gated.stdout).toContain("Re-run with --auto-approve");
      expect((await listForms(api)).length).toBe(2);

      const destroyed = await runOnboardedDeployCli(["destroy", "--dir", dir, "--auto-approve"], {
        api,
      });
      expect(destroyed.exitCode).toBe(0);
      expect(destroyed.stdout).toContain("Destroyed");
      expect((await listForms(api)).length).toBe(0);
    });
  });

  it("emits structured JSON with --json", async () => {
    await withTempDir(async (dir) => {
      const api = makeMockOnboardedApi();
      const pull = await runOnboardedDeployCli(["pull", "--dir", dir, "--json"], { api });
      expect(JSON.parse(pull.stdout).pulled.length).toBe(7);

      const plan = await runOnboardedDeployCli(["plan", "--dir", dir, "--json"], { api });
      expect(JSON.parse(plan.stdout).summary).toMatchObject({ create: 0, update: 0, delete: 0 });
    });
  });

  it("reports usage without a command and errors on a missing --dir", async () => {
    const usage = await runOnboardedDeployCli([]);
    expect(usage.exitCode).toBe(0);
    expect(usage.stdout).toContain("Usage:");

    const missing = await runOnboardedDeployCli(["plan"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("Missing --dir");
  });
});

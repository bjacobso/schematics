import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { fixedClock } from "@schematics/git-artifacts/node";
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
  it("pull can target a live base URL using a cookie file", async () => {
    await withTempDir(async (dir) => {
      const cookiePath = join(dir, "session.cookie");
      const seed = await import("../src/mock/seed").then((module) => module.seedOnboardedData());
      const calls: Array<{ readonly url: string; readonly cookie: string | undefined }> = [];
      const previousFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        calls.push({ url: String(input), cookie: headers["cookie"] });
        const url = String(input);
        const path = new URL(url).pathname;
        const body = (() => {
          if (path === "/api/internal/sessions/current") {
            return { selected_account: seed.accounts[0] };
          }
          if (path === "/api/internal/custom_properties") return { data: seed.customProperties };
          if (path === "/api/internal/forms") return { data: seed.forms };
          if (path.startsWith("/api/internal/forms/")) {
            const uid = decodeURIComponent(path.slice("/api/internal/forms/".length));
            return seed.forms.find((form) => form.uid === uid) ?? null;
          }
          if (path === "/api/internal/policies") return { data: seed.policies };
          if (path.startsWith("/api/internal/policies/")) {
            const id = decodeURIComponent(path.slice("/api/internal/policies/".length));
            return seed.policies.find((policy) => policy.id === id) ?? null;
          }
          if (path === "/api/internal/automations") {
            return { data: seed.automations.map((automation) => automation.summary) };
          }
          if (path.startsWith("/api/internal/automations/")) {
            const id = decodeURIComponent(path.slice("/api/internal/automations/".length));
            return (
              seed.automations.find((automation) => automation.summary.id === id)?.detail ?? null
            );
          }
          return null;
        })();
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof globalThis.fetch;

      try {
        await writeFile(cookiePath, "staging-session\n");
        const pull = await runOnboardedDeployCli([
          "pull",
          "--dir",
          dir,
          "--base-url",
          "https://staging-app.onboarded.com",
          "--cookie-file",
          cookiePath,
        ]);

        if (pull.exitCode !== 0) throw new Error(pull.stderr || pull.stdout);
        expect(pull.exitCode).toBe(0);
        expect(pull.stdout).toContain("Pulled 7 resource(s)");
        expect(calls[0]?.url).toBe(
          "https://staging-app.onboarded.com/api/internal/sessions/current",
        );
        expect(calls.every((call) => call.cookie === "__session=staging-session")).toBe(true);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

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

  it("pull can select the named mina mock account", async () => {
    await withTempDir(async (dir) => {
      const pull = await runOnboardedDeployCli(["pull", "--dir", dir, "--account", "mina"]);
      expect(pull.exitCode).toBe(0);
      expect(pull.stdout).toContain("Pulled 9 resource(s)");

      const account = await readFile(join(dir, "account.yaml"), "utf8");
      const formFiles = await readdir(join(dir, "forms"));
      expect(account).toContain("name: Mina Care");
      expect(formFiles.sort()).toEqual([
        "clinician-profile.yaml",
        "equipment-acknowledgement.yaml",
        "site-orientation.yaml",
      ]);
    });
  });

  it("pull --commit records the pulled snapshot in git", async () => {
    await withTempDir(async (dir) => {
      execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir });

      const pull = await runOnboardedDeployCli(
        ["pull", "--dir", dir, "--account", "mina", "--commit"],
        { clock: fixedClock(Date.parse("2026-02-25T12:00:00.000Z")) },
      );
      expect(pull.exitCode).toBe(0);
      expect(pull.stdout).toContain("Pulled 9 resource(s)");
      expect(pull.stdout).toContain("Committed pull snapshot");

      const log = execFileSync("git", ["-C", dir, "log", "--format=%s%n%b", "-1"], {
        encoding: "utf8",
      });
      const authorTimestamp = execFileSync("git", ["-C", dir, "log", "--format=%at", "-1"], {
        encoding: "utf8",
      }).trim();
      const account = execFileSync("git", ["-C", dir, "show", "HEAD:account.yaml"], {
        encoding: "utf8",
      });
      const lock = execFileSync("git", ["-C", dir, "show", "HEAD:config.lock.json"], {
        encoding: "utf8",
      });
      const plan = await runOnboardedDeployCli(["plan", "--dir", dir, "--account", "mina"]);

      expect(log).toContain("Pull mina snapshot");
      expect(log).toContain("Actor: system");
      expect(authorTimestamp).toBe("1772020800");
      expect(account).toContain("name: Mina Care");
      expect(JSON.parse(lock).entries.length).toBe(9);
      expect(plan.stdout).toContain("Plan: 0 to create, 0 to update, 0 to destroy");
    });
  });

  it("fork creates a draft branch and merge fast-forwards it into main", async () => {
    await withTempDir(async (dir) => {
      execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "Schematics Test"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "schematics-test@localhost"], { cwd: dir });
      await runOnboardedDeployCli(["pull", "--dir", dir, "--account", "mina", "--commit"]);

      const fork = await runOnboardedDeployCli(["fork", "--dir", dir, "--branch", "draft/mina-q3"]);
      expect(fork.exitCode).toBe(0);
      expect(fork.stdout).toContain("Forked draft branch draft/mina-q3");
      expect(
        execFileSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], {
          encoding: "utf8",
        }).trim(),
      ).toBe("draft/mina-q3");

      const formPath = join(dir, "forms/clinician-profile.yaml");
      const yaml = await readFile(formPath, "utf8");
      await writeFile(
        formPath,
        yaml.replace("name: Clinician Profile", "name: Clinician Profile Q3"),
      );
      execFileSync("git", ["-C", dir, "add", "forms/clinician-profile.yaml"]);
      execFileSync("git", ["-C", dir, "commit", "-m", "Draft clinician profile update"]);
      const draftHead = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();

      const merge = await runOnboardedDeployCli([
        "merge",
        "--dir",
        dir,
        "--branch",
        "draft/mina-q3",
      ]);
      expect(merge.exitCode).toBe(0);
      expect(merge.stdout).toContain("Merged draft/mina-q3 into main");
      expect(
        execFileSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], {
          encoding: "utf8",
        }).trim(),
      ).toBe("main");
      expect(
        execFileSync("git", ["-C", dir, "rev-parse", "main"], { encoding: "utf8" }).trim(),
      ).toBe(draftHead);
      expect(await readFile(formPath, "utf8")).toContain("name: Clinician Profile Q3");
    });
  });

  it("merge reports divergent draft branches before mutating main", async () => {
    await withTempDir(async (dir) => {
      execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "Schematics Test"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "schematics-test@localhost"], { cwd: dir });
      await runOnboardedDeployCli(["pull", "--dir", dir, "--account", "mina", "--commit"]);

      const mainBeforeFork = execFileSync("git", ["-C", dir, "rev-parse", "main"], {
        encoding: "utf8",
      }).trim();
      await runOnboardedDeployCli(["fork", "--dir", dir, "--branch", "draft/mina-q3"]);

      const draftFormPath = join(dir, "forms/clinician-profile.yaml");
      const draftYaml = await readFile(draftFormPath, "utf8");
      await writeFile(
        draftFormPath,
        draftYaml.replace("name: Clinician Profile", "name: Clinician Profile Q3"),
      );
      execFileSync("git", ["-C", dir, "add", "forms/clinician-profile.yaml"]);
      execFileSync("git", ["-C", dir, "commit", "-m", "Draft clinician profile update"]);

      execFileSync("git", ["-C", dir, "checkout", "-q", "main"]);
      const mainFormPath = join(dir, "forms/site-orientation.yaml");
      const mainYaml = await readFile(mainFormPath, "utf8");
      await writeFile(
        mainFormPath,
        mainYaml.replace("name: Site Orientation", "name: Site Orientation Q3"),
      );
      execFileSync("git", ["-C", dir, "add", "forms/site-orientation.yaml"]);
      execFileSync("git", ["-C", dir, "commit", "-m", "Main site orientation update"]);
      const mainAfterEdit = execFileSync("git", ["-C", dir, "rev-parse", "main"], {
        encoding: "utf8",
      }).trim();
      expect(mainAfterEdit).not.toBe(mainBeforeFork);

      const merge = await runOnboardedDeployCli([
        "merge",
        "--dir",
        dir,
        "--branch",
        "draft/mina-q3",
      ]);
      expect(merge.exitCode).toBe(1);
      expect(merge.stderr).toContain("Cannot fast-forward merge draft/mina-q3 into main");
      expect(merge.stderr).toContain("resolve the git conflict");
      expect(
        execFileSync("git", ["-C", dir, "rev-parse", "main"], { encoding: "utf8" }).trim(),
      ).toBe(mainAfterEdit);
      expect(
        execFileSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], {
          encoding: "utf8",
        }).trim(),
      ).toBe("main");
    });
  });

  it("persists mock remote state across apply and plan invocations", async () => {
    await withTempDir(async (dir) => {
      const statePath = join(dir, "mock-state.json");
      await runOnboardedDeployCli([
        "pull",
        "--dir",
        dir,
        "--account",
        "mina",
        "--mock-state",
        statePath,
      ]);
      const seedApply = await runOnboardedDeployCli([
        "apply",
        "--dir",
        dir,
        "--account",
        "mina",
        "--mock-state",
        statePath,
        "--auto-approve",
      ]);
      expect(seedApply.stdout).toContain("Nothing to apply.");
      expect(
        (
          JSON.parse(await readFile(statePath, "utf8")) as {
            readonly forms: readonly { readonly uid: string }[];
          }
        ).forms.map((form) => form.uid),
      ).toContain("tlin_mina_clinician_profile");

      const formPath = join(dir, "forms/clinician-profile.yaml");
      const yaml = await readFile(formPath, "utf8");
      await writeFile(
        formPath,
        yaml.replace(
          "  - employee.custom.clinician_license\n",
          "  - employee.custom.clinician_license\n  - placement.custom.care_region\n",
        ),
      );

      const apply = await runOnboardedDeployCli([
        "apply",
        "--dir",
        dir,
        "--account",
        "mina",
        "--mock-state",
        statePath,
        "--auto-approve",
      ]);
      expect(apply.exitCode).toBe(0);
      expect(apply.stdout).toContain("Applied 1");

      const plan = await runOnboardedDeployCli([
        "plan",
        "--dir",
        dir,
        "--account",
        "mina",
        "--mock-state",
        statePath,
      ]);
      expect(plan.stdout).toContain("Plan: 0 to create, 0 to update, 0 to destroy");

      const saved = JSON.parse(await readFile(statePath, "utf8")) as {
        readonly forms: readonly {
          readonly uid: string;
          readonly attribute_scopes: readonly { readonly field_path: string }[];
        }[];
      };
      expect(
        saved.forms
          .find((form) => form.uid === "tlin_mina_clinician_profile")
          ?.attribute_scopes.map((scope) => scope.field_path),
      ).toContain("placement.custom.care_region");
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

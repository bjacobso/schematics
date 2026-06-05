import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createWalkthrough } from "../support/walkthrough";

const catalogGitUrl = "http://127.0.0.1:4320";
const draftBranch = "draft/q3-refresh";
const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const deployCliPath = fileURLToPath(
  new URL("../../../../examples/catalog/dist/deploy-cli-bin.js", import.meta.url),
);
const manifestPath = fileURLToPath(
  new URL("../../../../tmp/catalog-git-workspace.json", import.meta.url),
);
const mockStatePath = fileURLToPath(
  new URL("../../../../tmp/catalog-git-remote-state.json", import.meta.url),
);
const defaultWorkspaceDir = fileURLToPath(
  new URL("../../../../tmp/catalog-git-workspace", import.meta.url),
);

test.describe("Catalog fork and merge walkthrough", () => {
  test.use({ baseURL: catalogGitUrl });

  test("lands a scripted agent draft branch through a fast-forward merge", async ({
    page,
  }, testInfo) => {
    const walkthrough = createWalkthrough(testInfo);
    const workspaceDir = await readWorkspaceDir();

    await resetWorkspaceToPullCommit(workspaceDir);
    await rm(mockStatePath, { force: true });

    try {
      const seedRemoteOutput = execFileSync(
        "node",
        [
          deployCliPath,
          "apply",
          "--dir",
          workspaceDir,
          "--account",
          "nypl",
          "--mock-state",
          mockStatePath,
          "--auto-approve",
        ],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expect(seedRemoteOutput).toContain("Nothing to apply.");

      const forkOutput = execFileSync(
        "node",
        [deployCliPath, "fork", "--dir", workspaceDir, "--branch", draftBranch],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expect(forkOutput).toContain(`Forked draft branch ${draftBranch}`);
      expect(currentBranch(workspaceDir)).toBe(draftBranch);
      expect(revParse(workspaceDir, draftBranch)).toBe(revParse(workspaceDir, "main"));

      await page.goto("/playground");
      await expect(page.getByText("Local filesystem workspace")).toBeVisible();
      await page.getByRole("button", { name: "History", exact: true }).click();
      await expect(page.getByRole("button", { name: /Pull nypl snapshot/ })).toBeVisible();
      await walkthrough.capture(page, "01-fork-created", {
        caption: {
          title: "Fork a draft branch",
          body: `The NYPL workspace is checked out on ${draftBranch} from the pull commit; the UI still reads the same git-backed workspace.`,
        },
      });

      await page
        .getByPlaceholder("Ask about the schema, validation errors, or desired edits...")
        .fill("Add a second copy to the Beloved item and validate it.");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.getByText("Updated items/beloved.yaml")).toBeVisible();
      await expect(page.getByText("write_artifact_source")).toBeVisible();

      const draftHead = revParse(workspaceDir, draftBranch);
      expect(draftHead).not.toBe(revParse(workspaceDir, "main"));
      expect(
        execFileSync("git", ["-C", workspaceDir, "show", `${draftBranch}:items/beloved.yaml`], {
          encoding: "utf8",
        }),
      ).toContain("33333009");
      expect(
        execFileSync("git", ["-C", workspaceDir, "show", "main:items/beloved.yaml"], {
          encoding: "utf8",
        }),
      ).not.toContain("33333009");
      await walkthrough.capture(page, "02-draft-edits", {
        caption: {
          title: "Agent edits the draft",
          body: "The scripted agent adds a copy to the Beloved item while the server is on the draft branch, so main remains unchanged.",
        },
      });

      await page.getByRole("button", { name: "History", exact: true }).click();
      await page.getByRole("button", { name: "Refresh history" }).click();
      const draftCommitRow = page.getByRole("button", { name: /Write items\/beloved.yaml/ });
      await expect(draftCommitRow).toBeVisible();
      await draftCommitRow.click();
      await expect(page.getByText("Actor: agent", { exact: true })).toBeVisible();
      await expect(page.locator("pre").filter({ hasText: "33333009" }).last()).toBeVisible();
      await walkthrough.capture(page, "03-review-diff", {
        caption: {
          title: "Review the draft diff",
          body: "The History panel shows the branch-local agent commit and raw file diff before merge.",
        },
      });

      await writeDriftedMockRemote();
      const driftPlanOutput = execFileSync(
        "node",
        [deployCliPath, "plan", "--dir", workspaceDir, "--account", "nypl", "--mock-state", mockStatePath],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expect(driftPlanOutput).toContain("Plan: 0 to create, 1 to update, 0 to destroy");
      expect(driftPlanOutput).toContain("beloved");
      await mkdir(`${workspaceDir}/proof`, { recursive: true });
      await writeFile(
        `${workspaceDir}/proof/drift-before-merge.yaml`,
        [
          "id: drift-before-merge",
          "status: detected",
          `branch: ${draftBranch}`,
          "remote_drift:",
          "  item: beloved",
          "  field: editions[0].label",
          "plan: |",
          ...driftPlanOutput
            .trim()
            .split(/\r?\n/)
            .map((line) => `  ${line}`),
          "",
        ].join("\n"),
      );
      await page.reload();
      await page.getByRole("button", { name: "Files", exact: true }).click();
      await expect(page.locator(`button[title="proof/drift-before-merge.yaml"]`)).toBeVisible();
      await page.locator(`button[title="proof/drift-before-merge.yaml"]`).click();
      await expect(page.getByText("Plan: 0 to create, 1 to update, 0 to destroy")).toBeVisible();
      await walkthrough.capture(page, "03b-drift-detected", {
        caption: {
          title: "Detect remote drift",
          body: "Before merge, the persisted mock remote has an out-of-band edition change while the draft adds a copy, and plan surfaces the update.",
        },
      });

      const mergeOutput = execFileSync(
        "node",
        [deployCliPath, "merge", "--dir", workspaceDir, "--branch", draftBranch],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expect(mergeOutput).toContain(`Merged ${draftBranch} into main`);
      expect(currentBranch(workspaceDir)).toBe("main");
      expect(revParse(workspaceDir, "main")).toBe(draftHead);

      await page.reload();
      await expect(page.getByText("Local filesystem workspace")).toBeVisible();
      await page.getByRole("button", { name: "History", exact: true }).click();
      await page.getByRole("button", { name: "Refresh history" }).click();
      const mergedCommitRow = page.getByRole("button", { name: /Write items\/beloved.yaml/ });
      await expect(mergedCommitRow).toBeVisible();
      await mergedCommitRow.click();
      expect(await readFile(`${workspaceDir}/items/beloved.yaml`, "utf8")).toContain("33333009");
      await walkthrough.capture(page, "04-merged-main", {
        caption: {
          title: "Merge back to main",
          body: "The fast-forward merge moves main to the agent-authored draft commit, so main history now contains the same provenance.",
        },
      });

      const applyOutput = execFileSync(
        "node",
        [
          deployCliPath,
          "apply",
          "--dir",
          workspaceDir,
          "--account",
          "nypl",
          "--mock-state",
          mockStatePath,
          "--auto-approve",
        ],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expect(applyOutput).toContain("Applied 1");
      const planOutput = execFileSync(
        "node",
        [deployCliPath, "plan", "--dir", workspaceDir, "--account", "nypl", "--mock-state", mockStatePath],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expect(planOutput).toContain("Plan: 0 to create, 0 to update, 0 to destroy");

      await mkdir(`${workspaceDir}/proof`, { recursive: true });
      await writeFile(
        `${workspaceDir}/proof/empty-plan-after-merge.yaml`,
        [
          "id: empty-plan-after-merge",
          "status: passed",
          `main: ${revParse(workspaceDir, "main")}`,
          `draft: ${draftHead}`,
          "plan: |",
          ...planOutput
            .trim()
            .split(/\r?\n/)
            .map((line) => `  ${line}`),
          "",
        ].join("\n"),
      );
      await page.reload();
      await page.getByRole("button", { name: "Files", exact: true }).click();
      await expect(page.locator(`button[title="proof/empty-plan-after-merge.yaml"]`)).toBeVisible();
      await page.locator(`button[title="proof/empty-plan-after-merge.yaml"]`).click();
      await expect(page.getByText("Plan: 0 to create, 0 to update, 0 to destroy")).toBeVisible();
      await walkthrough.capture(page, "05-empty-plan-after-merge", {
        caption: {
          title: "Prove convergence",
          body: "After merging the draft, applying main into a persisted NYPL mock remote and planning again produces an empty plan.",
        },
      });
    } finally {
      await resetWorkspaceToPullCommit(workspaceDir);
      await rm(mockStatePath, { force: true });
    }
  });
});

async function resetWorkspaceToPullCommit(workspaceDir: string) {
  execGit(workspaceDir, ["reset", "--hard"]);
  execGit(workspaceDir, ["clean", "-fd"]);
  execGit(workspaceDir, ["checkout", "-q", "main"]);
  const pullCommit = execGit(workspaceDir, [
    "log",
    "--format=%H",
    "--fixed-strings",
    "--grep=Pull nypl snapshot",
  ])
    .trim()
    .split(/\r?\n/)[0];
  if (!pullCommit) throw new Error("Could not find the NYPL pull commit.");
  execGit(workspaceDir, ["reset", "--hard", pullCommit]);
  execGit(workspaceDir, ["clean", "-fd"]);
  execGit(workspaceDir, ["branch", "-D", draftBranch], { allowFailure: true });
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function writeDriftedMockRemote() {
  const state = JSON.parse(await readFile(mockStatePath, "utf8")) as {
    readonly items: { readonly id: string; editions: { label: string }[] }[];
  };
  const beloved = state.items.find((item) => item.id === "beloved");
  if (!beloved) throw new Error("Could not find the beloved item in mock state.");
  beloved.editions[0]!.label = "Vintage 2004 (revised remotely)";
  await writeFile(mockStatePath, `${JSON.stringify(state, null, 2)}\n`);
}

function currentBranch(workspaceDir: string): string {
  return execGit(workspaceDir, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
}

function revParse(workspaceDir: string, ref: string): string {
  return execGit(workspaceDir, ["rev-parse", ref]).trim();
}

function execGit(
  workspaceDir: string,
  args: readonly string[],
  options: { readonly allowFailure?: boolean } = {},
): string {
  try {
    return execFileSync("git", ["-C", workspaceDir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (options.allowFailure) return "";
    throw error;
  }
}

async function readWorkspaceDir() {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      readonly workspaceDir?: string;
    };
    return manifest.workspaceDir ?? defaultWorkspaceDir;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return defaultWorkspaceDir;
    }
    throw error;
  }
}

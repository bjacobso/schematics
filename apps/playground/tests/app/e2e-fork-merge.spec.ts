import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createWalkthrough } from "../support/walkthrough";

const onboardedGitUrl = "http://127.0.0.1:4320";
const draftBranch = "draft/mina-q3";
const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const deployCliPath = fileURLToPath(
  new URL("../../../../examples/onboarded/dist/deploy-cli-bin.js", import.meta.url),
);
const manifestPath = fileURLToPath(
  new URL("../../../../tmp/onboarded-git-workspace.json", import.meta.url),
);
const defaultWorkspaceDir = fileURLToPath(
  new URL("../../../../tmp/onboarded-git-workspace", import.meta.url),
);

test.describe("Onboarded fork and merge walkthrough", () => {
  test.use({ baseURL: onboardedGitUrl });

  test("lands a scripted agent draft branch through a fast-forward merge", async ({
    page,
  }, testInfo) => {
    const walkthrough = createWalkthrough(testInfo);
    const workspaceDir = await readWorkspaceDir();

    await resetWorkspaceToPullCommit(workspaceDir);

    try {
      const forkOutput = execFileSync(
        "node",
        [deployCliPath, "fork", "--dir", workspaceDir, "--branch", draftBranch],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expect(forkOutput).toContain(`Forked draft branch ${draftBranch}`);
      expect(currentBranch(workspaceDir)).toBe(draftBranch);
      expect(revParse(workspaceDir, draftBranch)).toBe(revParse(workspaceDir, "main"));

      await page.goto("/");
      await expect(page.getByText("Local filesystem workspace")).toBeVisible();
      await page.getByRole("button", { name: "History", exact: true }).click();
      await expect(page.getByRole("button", { name: /Pull mina snapshot/ })).toBeVisible();
      await walkthrough.capture(page, "01-fork-created", {
        caption: {
          title: "Fork a draft branch",
          body: "The Mina workspace is checked out on draft/mina-q3 from the pull commit; the UI still reads the same git-backed workspace.",
        },
      });

      await page
        .getByPlaceholder("Ask about the schema, validation errors, or desired edits...")
        .fill("Add care region to the clinician profile form and validate it.");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.getByText("Updated forms/clinician-profile.yaml")).toBeVisible();
      await expect(page.getByText("write_artifact_source")).toBeVisible();

      const draftHead = revParse(workspaceDir, draftBranch);
      expect(draftHead).not.toBe(revParse(workspaceDir, "main"));
      expect(
        execFileSync(
          "git",
          ["-C", workspaceDir, "show", `${draftBranch}:forms/clinician-profile.yaml`],
          {
            encoding: "utf8",
          },
        ),
      ).toContain("placement.custom.care_region");
      expect(
        execFileSync("git", ["-C", workspaceDir, "show", "main:forms/clinician-profile.yaml"], {
          encoding: "utf8",
        }),
      ).not.toContain("placement.custom.care_region");
      await walkthrough.capture(page, "02-draft-edits", {
        caption: {
          title: "Agent edits the draft",
          body: "The scripted agent writes the clinician profile change while the server is on the draft branch, so main remains unchanged.",
        },
      });

      await page.getByRole("button", { name: "History", exact: true }).click();
      await page.getByRole("button", { name: "Refresh history" }).click();
      const draftCommitRow = page.getByRole("button", {
        name: /Write forms\/clinician-profile.yaml/,
      });
      await expect(draftCommitRow).toBeVisible();
      await draftCommitRow.click();
      await expect(page.getByText("Actor: agent", { exact: true })).toBeVisible();
      await expect(
        page.locator("pre").filter({ hasText: "placement.custom.care_region" }).last(),
      ).toBeVisible();
      await walkthrough.capture(page, "03-review-diff", {
        caption: {
          title: "Review the draft diff",
          body: "The History panel shows the branch-local agent commit and raw file diff before merge.",
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
      const mergedCommitRow = page.getByRole("button", {
        name: /Write forms\/clinician-profile.yaml/,
      });
      await expect(mergedCommitRow).toBeVisible();
      await mergedCommitRow.click();
      expect(await readFile(`${workspaceDir}/forms/clinician-profile.yaml`, "utf8")).toContain(
        "placement.custom.care_region",
      );
      await walkthrough.capture(page, "04-merged-main", {
        caption: {
          title: "Merge back to main",
          body: "The fast-forward merge moves main to the agent-authored draft commit, so main history now contains the same provenance.",
        },
      });
    } finally {
      await resetWorkspaceToPullCommit(workspaceDir);
    }
  });
});

async function resetWorkspaceToPullCommit(workspaceDir: string) {
  execGit(workspaceDir, ["reset", "--hard"]);
  execGit(workspaceDir, ["checkout", "-q", "main"]);
  const pullCommit = execGit(workspaceDir, [
    "log",
    "--format=%H",
    "--fixed-strings",
    "--grep=Pull mina snapshot",
  ])
    .trim()
    .split(/\r?\n/)[0];
  if (!pullCommit) throw new Error("Could not find the Mina pull commit.");
  execGit(workspaceDir, ["reset", "--hard", pullCommit]);
  execGit(workspaceDir, ["branch", "-D", draftBranch], { allowFailure: true });
  await new Promise((resolve) => setTimeout(resolve, 250));
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

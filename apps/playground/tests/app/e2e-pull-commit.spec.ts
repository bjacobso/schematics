import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createWalkthrough } from "../support/walkthrough";

const catalogGitUrl = "http://127.0.0.1:4320";
const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const deployCliPath = fileURLToPath(
  new URL("../../../../examples/catalog/dist/deploy-cli-bin.js", import.meta.url),
);
const manifestPath = fileURLToPath(
  new URL("../../../../tmp/catalog-git-workspace.json", import.meta.url),
);
const defaultWorkspaceDir = fileURLToPath(
  new URL("../../../../tmp/catalog-git-workspace", import.meta.url),
);

test.describe("Catalog pull and commit walkthrough", () => {
  test.use({ baseURL: catalogGitUrl });

  test("proves the NYPL pull snapshot is committed to git", async ({ page }, testInfo) => {
    const walkthrough = createWalkthrough(testInfo);
    const workspaceDir = await readWorkspaceDir();

    const catalogYaml = await readFile(`${workspaceDir}/catalog.yaml`, "utf8");
    const gitLog = execFileSync("git", ["-C", workspaceDir, "log", "--oneline", "-1"], {
      encoding: "utf8",
    }).trim();
    const gitShowCatalog = execFileSync("git", ["-C", workspaceDir, "show", "HEAD:catalog.yaml"], {
      encoding: "utf8",
    });
    const gitTree = execFileSync("git", ["-C", workspaceDir, "cat-file", "-p", "HEAD^{tree}"], {
      encoding: "utf8",
    });
    const plan = execFileSync(
      "node",
      [deployCliPath, "plan", "--dir", workspaceDir, "--account", "nypl"],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    expect(catalogYaml).toContain("New York Public Library");
    expect(gitLog).toContain("Pull nypl snapshot");
    expect(gitShowCatalog).toContain("New York Public Library");
    expect(gitTree).toContain("catalog.yaml");
    expect(plan).toContain("Plan: 0 to create, 0 to update, 0 to destroy");

    await page.goto("/playground");
    await expect(page.getByText("Local filesystem workspace")).toBeVisible();
    await page.getByRole("button", { name: "Files" }).click();
    await expect(page.locator(`button[title="catalog.yaml"]`)).toBeVisible();
    await expect(page.locator(`button[title="items/beloved.yaml"]`)).toBeVisible();
    await expect(page.locator(`button[title="policies/standard.yaml"]`)).toBeVisible();

    await walkthrough.capture(page, "03-pulled-tree", {
      caption: {
        title: "Inspect pulled workspace",
        body: "The NYPL mock catalog has been pulled into a local filesystem workspace with catalog, branch, author, shelf, item, collection, and loan-policy YAML files.",
      },
    });

    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByRole("button", { name: /Pull nypl snapshot/ })).toBeVisible();
    await walkthrough.capture(page, "04-git-log-proof", {
      caption: {
        title: "Prove git has the snapshot",
        body: "The UI history row agrees with git log, git show, and git cat-file assertions from the same deterministic repository.",
      },
    });
  });
});

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

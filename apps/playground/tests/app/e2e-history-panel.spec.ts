import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createWalkthrough } from "../support/walkthrough";

const catalogGitUrl = "http://127.0.0.1:4320";
const manifestPath = fileURLToPath(
  new URL("../../../../tmp/catalog-git-workspace.json", import.meta.url),
);
const defaultWorkspaceDir = fileURLToPath(
  new URL("../../../../tmp/catalog-git-workspace", import.meta.url),
);

test.describe("Catalog git history walkthrough", () => {
  test.use({ baseURL: catalogGitUrl });

  test("renders the local git pull commit in the History panel", async ({ page }, testInfo) => {
    const walkthrough = createWalkthrough(testInfo);
    const workspaceDir = await readWorkspaceDir();
    const catalogYaml = await readFile(`${workspaceDir}/catalog.yaml`, "utf8");
    const gitLog = execFileSync("git", ["-C", workspaceDir, "log", "--format=%B"], {
      encoding: "utf8",
    }).trim();

    expect(catalogYaml).toContain("New York Public Library");
    expect(gitLog).toContain("Pull nypl snapshot");
    expect(gitLog).toContain("system");

    await page.goto("/playground");
    await expect(page.getByText("Local filesystem workspace")).toBeVisible();
    await expect(page.getByRole("button", { name: "History" })).toBeVisible();

    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByRole("button", { name: /Pull nypl snapshot/ })).toBeVisible();
    await expect(page.locator("pre").filter({ hasText: "Actor: system" })).toBeVisible();
    await expect(page.getByText("Diff", { exact: true })).toBeVisible();
    await expect(page.locator("code").filter({ hasText: "catalog.yaml" })).toBeVisible();

    await walkthrough.capture(page, "01-history-timeline", {
      caption: {
        title: "Inspect git history",
        body: "The git-backed NYPL workspace exposes the import commit through the local artifact-project history RPC.",
      },
    });

    await walkthrough.capture(page, "02-revision-selected", {
      caption: {
        title: "Review revision provenance",
        body: "Selecting a commit shows the author, deterministic timestamp, and Actor trailer that came from the git commit.",
      },
    });

    await page.getByText("Diff", { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByText("Field diff", { exact: true }).first()).toBeVisible();
    await expect(
      page
        .locator("code")
        .filter({ hasText: /^name$/ })
        .first(),
    ).toBeVisible();
    await expect(
      page
        .locator("pre")
        .filter({ hasText: /New York Public Library/ })
        .first(),
    ).toBeVisible();
    await walkthrough.capture(page, "03-revision-diff", {
      caption: {
        title: "Inspect revision diff",
        body: "The same history entry carries file changes from git and renders a schema-aware field diff for parsed YAML resources.",
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

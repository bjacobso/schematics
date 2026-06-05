import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { createWalkthrough } from "../support/walkthrough";

const catalogGitUrl = "http://127.0.0.1:4320";
const manifestPath = fileURLToPath(
  new URL("../../../../tmp/catalog-git-workspace.json", import.meta.url),
);
const defaultWorkspaceDir = fileURLToPath(
  new URL("../../../../tmp/catalog-git-workspace", import.meta.url),
);

test.describe("NYC Public Library fixture walkthrough", () => {
  test.use({ baseURL: catalogGitUrl });

  test("renders the named NYPL catalog, items, and collection fixture", async ({
    page,
  }, testInfo) => {
    const walkthrough = createWalkthrough(testInfo);
    const workspaceDir = await readWorkspaceDir();

    await resetWorkspaceToPullCommit(workspaceDir);
    expect(await readFile(`${workspaceDir}/catalog.yaml`, "utf8")).toContain(
      "New York Public Library",
    );
    expect(await readFile(`${workspaceDir}/items/beloved.yaml`, "utf8")).toContain("morrison");
    expect(await readFile(`${workspaceDir}/collections/staff-picks.yaml`, "utf8")).toContain(
      "beloved",
    );

    await page.goto("/playground");
    await expect(page.getByText("Local filesystem workspace")).toBeVisible();
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByRole("button", { name: "Preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await openPreviewNavigationItem(page, {
      directory: /Items.*items\//,
      file: /Beloved.*items\/beloved\.yaml/,
    });
    await showRawIfNeeded(page, "morrison");
    await expect(page.getByText("Beloved").first()).toBeVisible();
    await expect(page.getByText("morrison").first()).toBeVisible();
    await walkthrough.capture(page, "01-nyc-item", {
      caption: {
        title: "Inspect an NYPL item",
        body: "The named NYPL catalog fixture renders an item with its authors, editions, copies, and holds from the same pulled YAML tree used by the git-backed walkthroughs.",
      },
    });

    await openPreviewNavigationItem(page, {
      directory: /Collections.*collections\//,
      file: /Staff Picks.*collections\/staff-picks\.yaml/,
    });
    await showRawIfNeeded(page, "beloved");
    await expect(page.getByText("Staff Picks").first()).toBeVisible();
    await expect(page.getByText("beloved").first()).toBeVisible();
    await walkthrough.capture(page, "02-nyc-collection", {
      caption: {
        title: "Inspect an NYPL collection",
        body: "The Staff Picks collection ties items and shelves together by id reference, proving the fixture is rich enough for validation and diffs.",
      },
    });
  });
});

async function openPreviewNavigationItem(
  page: Page,
  { directory, file }: { readonly directory: RegExp; readonly file: RegExp },
) {
  await page.getByRole("button", { name: "Workspace" }).click();
  await page.getByRole("button", { name: directory }).click();
  await page.getByRole("button", { name: file }).click();
}

async function showRawIfNeeded(page: Page, expectedText: string) {
  if (await page.getByText(expectedText).first().isVisible()) return;
  await page.getByRole("button", { name: "View raw" }).click();
  await expect(page.getByText(expectedText).first()).toBeVisible();
}

async function resetWorkspaceToPullCommit(workspaceDir: string) {
  const pullCommit = execFileSync(
    "git",
    ["-C", workspaceDir, "log", "--format=%H", "--fixed-strings", "--grep=Pull nypl snapshot"],
    { encoding: "utf8" },
  )
    .trim()
    .split(/\r?\n/)[0];
  if (!pullCommit) throw new Error("Could not find the NYPL pull commit.");
  execFileSync("git", ["-C", workspaceDir, "reset", "--hard", pullCommit], { encoding: "utf8" });
  await new Promise((resolve) => setTimeout(resolve, 250));
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

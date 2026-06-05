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

test.describe("Catalog agent provenance walkthrough", () => {
  test.use({ baseURL: catalogGitUrl });

  test("commits scripted agent edits with provenance and blame attribution", async ({
    page,
  }, testInfo) => {
    const walkthrough = createWalkthrough(testInfo);
    const workspaceDir = await readWorkspaceDir();

    await resetWorkspaceToPullCommit(workspaceDir);

    try {
      await page.goto("/playground");
      await expect(page.getByText("Local filesystem workspace")).toBeVisible();
      await expect(page.getByText("Chat", { exact: true })).toBeVisible();

      await page
        .getByPlaceholder("Ask about the schema, validation errors, or desired edits...")
        .fill("Add a second copy to the Beloved item and validate it.");
      await walkthrough.capture(page, "01-agent-prompt", {
        caption: {
          title: "Prompt the agent",
          body: "The local git-backed NYPL workspace exposes chat in e2e mode with a deterministic scripted model.",
        },
      });

      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.getByText("write_artifact_source")).toBeVisible();
      await expect(page.getByText("validate_artifact_project")).toBeVisible();
      await expect(page.getByText("Updated items/beloved.yaml")).toBeVisible();

      const itemYaml = await readFile(`${workspaceDir}/items/beloved.yaml`, "utf8");
      expect(itemYaml).toContain("33333009");
      await walkthrough.capture(page, "02-agent-edit-applied", {
        caption: {
          title: "Agent edit applied",
          body: "The scripted assistant used write_artifact_source, then validated the artifact project through the same tool runtime as a real model.",
        },
      });

      const gitLog = execFileSync("git", ["-C", workspaceDir, "log", "--format=%s%n%b", "-1"], {
        encoding: "utf8",
      });
      expect(gitLog).toContain("Write items/beloved.yaml");
      expect(gitLog).toContain("Actor: agent");
      expect(gitLog).toContain("Turn-Id: turn-1");
      expect(gitLog).toContain("Tool-Call-Id: tool-e2e-write");

      await page.getByRole("button", { name: "History" }).click();
      await expect(page.getByRole("button", { name: /Write items\/beloved.yaml/ })).toBeVisible();
      await expect(page.getByText("Actor: agent", { exact: true })).toBeVisible();
      await expect(page.getByText("Turn: turn-1")).toBeVisible();
      await expect(page.getByText("Tool: tool-e2e-write")).toBeVisible();
      await walkthrough.capture(page, "03-commit-actor-agent", {
        caption: {
          title: "Agent commit provenance",
          body: "History shows the agent-authored commit with Actor, Turn-Id, and Tool-Call-Id trailers parsed from git.",
        },
      });

      const blame = execFileSync(
        "git",
        ["-C", workspaceDir, "blame", "--line-porcelain", "items/beloved.yaml"],
        { encoding: "utf8" },
      );
      expect(blame).toContain("author Schematics Agent");
      expect(blame).toContain("author-mail <agent@schematics.local>");
      expect(blame).toContain("summary Write items/beloved.yaml");
      await expect(page.locator("pre").filter({ hasText: "33333009" }).last()).toBeVisible();
      await walkthrough.capture(page, "04-blame-attribution", {
        caption: {
          title: "Blame attributes the line",
          body: "Git blame attributes the newly added copy line to the agent commit, closing the provenance loop.",
        },
      });
    } finally {
      await resetWorkspaceToPullCommit(workspaceDir);
    }
  });
});

async function resetWorkspaceToPullCommit(workspaceDir: string) {
  const pullCommit = execFileSync(
    "git",
    ["-C", workspaceDir, "log", "--format=%H", "--fixed-strings", "--grep=Pull nypl snapshot"],
    { encoding: "utf8" },
  )
    .trim()
    .split(/\r?\n/)[0];
  if (!pullCommit) throw new Error("Could not find the NYPL pull commit.");
  execFileSync("git", ["-C", workspaceDir, "reset", "--hard", pullCommit], {
    encoding: "utf8",
  });
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

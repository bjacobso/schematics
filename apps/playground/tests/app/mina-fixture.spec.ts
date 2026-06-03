import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { createWalkthrough } from "../support/walkthrough";

const onboardedGitUrl = "http://127.0.0.1:4320";
const manifestPath = fileURLToPath(
  new URL("../../../../tmp/onboarded-git-workspace.json", import.meta.url),
);
const defaultWorkspaceDir = fileURLToPath(
  new URL("../../../../tmp/onboarded-git-workspace", import.meta.url),
);

test.describe("Mina fixture walkthrough", () => {
  test.use({ baseURL: onboardedGitUrl });

  test("renders the named Mina account, forms, and policy fixture", async ({ page }, testInfo) => {
    const walkthrough = createWalkthrough(testInfo);
    const workspaceDir = await readWorkspaceDir();

    await resetWorkspaceToPullCommit(workspaceDir);
    expect(await readFile(`${workspaceDir}/account.yaml`, "utf8")).toContain("name: Mina Care");
    expect(await readFile(`${workspaceDir}/forms/clinician-profile.yaml`, "utf8")).toContain(
      "employee.custom.clinician_license",
    );
    expect(await readFile(`${workspaceDir}/policies/clinical-readiness.yaml`, "utf8")).toContain(
      "job.custom.patient_acuity",
    );

    await page.goto("/");
    await expect(page.getByText("Local filesystem workspace")).toBeVisible();
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByRole("button", { name: "Preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await expect(page.getByText("Account", { exact: true })).toBeVisible();
    await showRawIfNeeded(page, "Mina Care");
    await walkthrough.capture(page, "01-mina-account", {
      caption: {
        title: "Load Mina account",
        body: "The named Mina account fixture renders account identity from the same pulled YAML tree used by the git-backed walkthroughs.",
      },
    });

    await openPreviewNavigationItem(page, {
      directory: /Forms.*forms\//,
      file: /Clinician Profile.*forms\/clinician-profile\.yaml/,
    });
    await showRawIfNeeded(page, "employee.custom.clinician_license");
    await expect(page.getByText("Clinician Profile").first()).toBeVisible();
    await expect(page.getByText("employee.custom.clinician_license").first()).toBeVisible();
    await walkthrough.capture(page, "02-mina-forms", {
      caption: {
        title: "Inspect Mina forms",
        body: "The fixture includes cross-referenced form fields, including the clinician license attribute used by the policy and drift tests.",
      },
    });

    await openPreviewNavigationItem(page, {
      directory: /Policies.*policies\//,
      file: /Clinical Readiness.*policies\/clinical-readiness\.yaml/,
    });
    await showRawIfNeeded(page, "job.custom.patient_acuity");
    await expect(page.getByText("Clinical Readiness").first()).toBeVisible();
    await expect(page.getByText("job.custom.patient_acuity").first()).toBeVisible();
    await walkthrough.capture(page, "03-mina-policy", {
      caption: {
        title: "Inspect Mina policy",
        body: "The clinical readiness policy ties Mina forms and custom properties together, proving the fixture is rich enough for validation and diffs.",
      },
    });
  });
});

async function openPreviewNavigationItem(
  page: Page,
  {
    directory,
    file,
  }: {
    readonly directory: RegExp;
    readonly file: RegExp;
  },
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
    ["-C", workspaceDir, "log", "--format=%H", "--fixed-strings", "--grep=Pull mina snapshot"],
    { encoding: "utf8" },
  )
    .trim()
    .split(/\r?\n/)[0];
  if (!pullCommit) throw new Error("Could not find the Mina pull commit.");
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

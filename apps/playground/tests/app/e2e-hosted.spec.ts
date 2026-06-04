import { expect, test } from "@playwright/test";
import { createWalkthrough } from "../support/walkthrough";

test.describe("Hosted workspace git walkthrough", () => {
  test("commits hosted workspace edits and renders hosted git history", async ({
    page,
  }, testInfo) => {
    const walkthrough = createWalkthrough(testInfo);

    await page.goto("/");
    await expect(page.getByText("Browser memory workspace")).toBeVisible();
    await page.getByRole("button", { name: "New hosted workspace" }).click();
    await page.waitForURL(/\/w\/[0-9a-f-]+$/);

    await expect(page.getByText("Cloudflare hosted workspace")).toBeVisible();
    await page.getByRole("button", { name: "Files" }).click();
    await expect(page.locator(`button[title="account.yaml"]`)).toBeVisible();
    await expect(page.getByRole("button", { name: "History" })).toBeVisible();

    await walkthrough.capture(page, "01-create-workspace", {
      caption: {
        title: "Create hosted workspace",
        body: "The playground creates a hosted Onboarded workspace and receives a proxied git remote without exposing browser credentials.",
      },
    });

    await page.locator(`button[title="account.yaml"]`).click();
    await page.getByRole("button", { name: "Code", exact: true }).click();
    const editor = page.getByLabel("Schema source editor");
    await expect(editor).toContainText("Demo Staffing");
    await editor.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.insertText(
      [
        "id: acc_demo",
        "isTest: true",
        "organization:",
        "  name: Demo Staffing Hosted",
        "  connectType: direct",
        "branding:",
        "  brandName: Demo",
        "  brandIcon: null",
        "",
      ].join("\n"),
    );
    const saveButton = page.getByRole("button", { name: "Save file" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(saveButton).toBeDisabled();
    await expect(page.locator(`button[title="account.yaml"]`)).toContainText("account.yaml");
    await expect(editor).toContainText("Demo Staffing Hosted");

    await walkthrough.capture(page, "02-edit-committed", {
      caption: {
        title: "Edit hosted config",
        body: "Saving a hosted workspace edit routes through the hosted RPC service, then the browser-side git helper commits and pushes the updated snapshot.",
      },
    });

    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByRole("button", { name: /Write account\.yaml/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Initialize hosted workspace/ })).toBeVisible();
    await page.getByRole("button", { name: /Write account\.yaml/ }).click();
    await expect(page.locator("pre").filter({ hasText: "Actor: user" })).toBeVisible();
    await expect(page.locator("code").filter({ hasText: "account.yaml" })).toBeVisible();
    await expect(page.getByText("Field diff", { exact: true })).toBeVisible();
    await expect(page.locator("code").filter({ hasText: /^organization\.name$/ })).toBeVisible();
    await expect(page.locator("pre").filter({ hasText: /^Demo Staffing Hosted$/ })).toBeVisible();

    await walkthrough.capture(page, "03-hosted-history", {
      caption: {
        title: "Inspect hosted history",
        body: "The History panel reads the browser-side git clone and shows the hosted edit commit with provenance, a schema-aware field diff, and the raw file diff.",
      },
    });
  });

  test("commits hosted deploy pulls through the browser git store", async ({ page }, testInfo) => {
    const walkthrough = createWalkthrough(testInfo);

    await page.goto("/");
    await page.getByRole("button", { name: "New hosted workspace" }).click();
    await page.waitForURL(/\/w\/[0-9a-f-]+$/);
    await expect(page.getByText("Cloudflare hosted workspace")).toBeVisible();

    await page.getByRole("button", { name: "Deploy" }).click();
    await expect(page.getByText("Not connected")).toBeVisible();
    await page.getByLabel("API token").fill("ob_live_e2e");
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByText(/Connected as Demo Staffing/)).toBeVisible();

    await page.getByRole("button", { name: "Pull" }).click();
    await expect(page.getByText("pulled 7")).toBeVisible();
    await page.getByRole("button", { name: "Plan" }).click();
    await expect(page.getByText("No changes. Working tree matches remote.")).toBeVisible();

    await walkthrough.capture(page, "04-deploy-pull", {
      caption: {
        title: "Pull through hosted deploy",
        body: "The hosted Deploy panel connects to the mock Onboarded API, pulls the account snapshot into the browser git store, and reaches an empty plan.",
      },
    });

    await page.getByRole("button", { name: "Files" }).click();
    await page.locator(`button[title="forms/employee-handbook.yaml"]`).click();
    await page.getByRole("button", { name: "Code", exact: true }).click();
    const editor = page.getByLabel("Schema source editor");
    await expect(editor).toContainText("Employee Handbook");
    await editor.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.insertText(
      [
        "id: employee-handbook",
        "name: Employee Handbook Hosted",
        "description: Employee handbook acknowledgement.",
        "accessType: account",
        "scope:",
        "  employer: false",
        "  client: false",
        "  job: true",
        "tags: []",
        "trackConversion: false",
        "attributePaths: []",
        "",
      ].join("\n"),
    );
    const saveButton = page.getByRole("button", { name: "Save file" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(saveButton).toBeDisabled();
    await expect(editor).toContainText("Employee Handbook Hosted");

    await page.getByRole("button", { name: "Re-plan" }).click();
    await expect(page.getByText("~1 update")).toBeVisible();
    await expect(page.getByRole("button", { name: /~ employee-handbook forms\// })).toBeVisible();
    await page.getByRole("button", { name: "Apply (1)" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("applied 1, aborted 0, skipped 6")).toBeVisible();
    await page.getByRole("button", { name: "Plan" }).click();
    await expect(page.getByText("No changes. Working tree matches remote.")).toBeVisible();

    await walkthrough.capture(page, "05-deploy-apply", {
      caption: {
        title: "Apply hosted draft",
        body: "After a hosted form edit, the Deploy panel plans one update, applies it to the mock remote, and re-plans to a fixed point.",
      },
    });

    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByRole("button", { name: /Apply Onboarded account/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Pull Onboarded account/ })).toBeVisible();
    await page.getByRole("button", { name: /Apply Onboarded account/ }).click();
    await expect(page.locator("pre").filter({ hasText: "Actor: system" })).toBeVisible();
    await expect(page.locator("code").filter({ hasText: "config.lock.json" })).toBeVisible();

    await walkthrough.capture(page, "06-deploy-history", {
      caption: {
        title: "Inspect deploy commit",
        body: "The hosted apply lands as a system-authored git commit, including the updated lockfile, and is visible in hosted History.",
      },
    });
  });

  test("commits hosted agent edits with provenance trailers", async ({ page }, testInfo) => {
    const walkthrough = createWalkthrough(testInfo);

    await page.goto("/");
    await page.getByRole("button", { name: "New hosted workspace" }).click();
    await page.waitForURL(/\/w\/[0-9a-f-]+$/);
    await expect(page.getByText("Cloudflare hosted workspace")).toBeVisible();
    await expect(page.getByText("Chat", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByRole("button", { name: /Initialize hosted workspace/ })).toBeVisible();

    await page
      .getByPlaceholder("Ask about the schema, validation errors, or desired edits...")
      .fill("Update the employee handbook form and validate the hosted workspace.");
    await walkthrough.capture(page, "07-hosted-agent-prompt", {
      caption: {
        title: "Prompt hosted agent",
        body: "Hosted e2e workspaces now expose chat, backed by the same artifact tool runtime and browser git committer as hosted edits.",
      },
    });

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("write_artifact_source")).toBeVisible();
    await expect(page.getByText("validate_artifact_project")).toBeVisible();
    await expect(page.getByText("Updated forms/employee-handbook.yaml")).toBeVisible();

    await page.getByRole("button", { name: "Files" }).click();
    await page.locator(`button[title="forms/employee-handbook.yaml"]`).click();
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await expect(page.getByLabel("Schema source editor")).toContainText("Employee Handbook Agent");
    await walkthrough.capture(page, "08-hosted-agent-edit", {
      caption: {
        title: "Hosted agent edit",
        body: "The assistant tool call updates an existing hosted file and validates the workspace through the live hosted RPC client.",
      },
    });

    await page.getByRole("button", { name: "History" }).click();
    await expect(
      page.getByRole("button", { name: /Write forms\/employee-handbook.yaml/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Write forms\/employee-handbook.yaml/ }).click();
    await expect(page.getByText("Actor: agent", { exact: true })).toBeVisible();
    await expect(page.getByText("Turn: turn-1")).toBeVisible();
    await expect(page.getByText("Tool: tool-e2e-hosted-write")).toBeVisible();
    await expect(page.getByText("Field diff", { exact: true })).toBeVisible();
    await expect(page.locator("code").filter({ hasText: /^attributePaths$/ })).toBeVisible();
    await expect(
      page.locator("pre").filter({ hasText: "Employee Handbook Agent" }).last(),
    ).toBeVisible();
    await walkthrough.capture(page, "09-hosted-agent-history", {
      caption: {
        title: "Hosted agent provenance",
        body: "Hosted History parses the browser git commit trailers for the agent-authored change, including Actor, Turn-Id, and Tool-Call-Id.",
      },
    });
  });

  test("forks and merges a hosted draft branch", async ({ page }, testInfo) => {
    const walkthrough = createWalkthrough(testInfo);

    await page.goto("/");
    await page.getByRole("button", { name: "New hosted workspace" }).click();
    await page.waitForURL(/\/w\/[0-9a-f-]+$/);
    await expect(page.getByText("Cloudflare hosted workspace")).toBeVisible();
    await expect(page.getByRole("button", { name: "Fork draft" })).toBeVisible();

    await page.getByRole("button", { name: "Fork draft" }).click();
    await expect(page.getByText("Forked draft/mina-q3")).toBeVisible();
    await expect(page.getByText("draft/mina-q3", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Merge draft" })).toBeVisible();

    await walkthrough.capture(page, "10-hosted-fork-created", {
      caption: {
        title: "Fork hosted draft",
        body: "Hosted browser git creates and pushes a draft branch through the same proxied Artifacts remote while the workspace switches to that active branch.",
      },
    });

    await page.getByRole("button", { name: "Files" }).click();
    await page.locator(`button[title="account.yaml"]`).click();
    await page.getByRole("button", { name: "Code", exact: true }).click();
    const editor = page.getByLabel("Schema source editor");
    await expect(editor).toContainText("Demo Staffing");
    await editor.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.insertText(
      [
        "id: acc_demo",
        "isTest: true",
        "organization:",
        "  name: Demo Staffing Draft",
        "  connectType: direct",
        "branding:",
        "  brandName: Demo",
        "  brandIcon: null",
        "",
      ].join("\n"),
    );
    const saveButton = page.getByRole("button", { name: "Save file" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(saveButton).toBeDisabled();
    await expect(editor).toContainText("Demo Staffing Draft");

    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByRole("button", { name: /Write account\.yaml/ })).toBeVisible();
    await page.getByRole("button", { name: /Write account\.yaml/ }).click();
    await expect(page.getByText("Actor: user", { exact: true })).toBeVisible();
    await expect(page.getByText("Field diff", { exact: true })).toBeVisible();

    await walkthrough.capture(page, "11-hosted-draft-edit", {
      caption: {
        title: "Commit hosted draft edit",
        body: "Edits made while the draft is active commit to the draft branch and render in History with the same schema-aware diff view.",
      },
    });

    await page.getByRole("button", { name: "Merge draft" }).click();
    await expect(page.getByText("Merged draft/mina-q3 into main")).toBeVisible();
    await expect(page.getByText("main", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Fork draft" })).toBeVisible();

    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByRole("button", { name: /Write account\.yaml/ })).toBeVisible();
    await page.getByRole("button", { name: /Write account\.yaml/ }).click();
    await expect(page.locator("pre").filter({ hasText: /^Demo Staffing Draft$/ })).toBeVisible();

    await walkthrough.capture(page, "12-hosted-draft-merged", {
      caption: {
        title: "Merge hosted draft",
        body: "Fast-forward merge moves hosted main to the draft commit, and the merged commit remains visible from main History.",
      },
    });
  });
});

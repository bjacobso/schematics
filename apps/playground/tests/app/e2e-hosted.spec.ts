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
    await expect(page.getByText("Demo Staffing Hosted")).toBeVisible();

    await walkthrough.capture(page, "03-hosted-history", {
      caption: {
        title: "Inspect hosted history",
        body: "The History panel reads the browser-side git clone and shows the hosted edit commit with provenance and a raw file diff.",
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
});

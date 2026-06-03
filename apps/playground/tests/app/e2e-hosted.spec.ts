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
    await page.keyboard.type(
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
    await page.getByRole("button", { name: "Save" }).click();
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
});

import { expect, test } from "@playwright/test";
import { installDeterministicBrowserEnvironment } from "../support/deterministic";
import { createWalkthrough } from "../support/walkthrough";

test.describe("Schema IDE playground walkthrough", () => {
  test.describe.configure({ mode: "serial" });

  test("captures the example exploration flow", async ({ page }, testInfo) => {
    await installDeterministicBrowserEnvironment(page);
    const walkthrough = createWalkthrough(testInfo);

    await page.goto("/");
    await expect(page.getByText("Schema IDE Playground")).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("navigation", { name: "breadcrumb" })).toBeVisible();
    await walkthrough.capture(page, "01-playground-loaded", {
      caption: {
        title: "Open the playground",
        body: "The playground starts with a concrete schema example loaded into the preview-first IDE.",
      },
    });

    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByRole("button", { name: "Preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await walkthrough.capture(page, "02-preview-mode", {
      caption: {
        title: "Inspect the preview",
        body: "The preview tab renders the selected workspace location with breadcrumbs for moving back up the project.",
      },
    });

    await page.getByRole("combobox", { name: "Schema IDE example" }).click();
    await page.getByRole("option", { name: "Prompt Evals (JSON)" }).click();
    await expect(page.getByRole("combobox", { name: "Schema IDE example" })).toContainText(
      "Prompt Evals (JSON)",
    );
    await expect(page.getByRole("navigation", { name: "breadcrumb" })).toBeVisible();
    await walkthrough.capture(page, "03-prompt-evals-json", {
      caption: {
        title: "Switch examples",
        body: "Selecting a different example resets the workspace and shows the same IDE shell around a new schema domain.",
      },
    });
  });
});

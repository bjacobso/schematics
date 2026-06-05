import { expect, test } from "@playwright/test";
import { installDeterministicBrowserEnvironment } from "../support/deterministic";
import { createWalkthrough } from "../support/walkthrough";

test.describe("Schematics playground walkthrough", () => {
  test.describe.configure({ mode: "serial" });

  test("captures the example exploration flow", async ({ page }, testInfo) => {
    await installDeterministicBrowserEnvironment(page);
    const walkthrough = createWalkthrough(testInfo);

    await page.goto("/playground");
    await expect(page.getByText("Schematics Playground")).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByText("No location selected")).toBeVisible();
    await walkthrough.capture(page, "01-playground-loaded", {
      caption: {
        title: "Open the playground",
        body: "The playground starts with the NYC Public Library catalog example loaded and waits for a file or directory selection before rendering a preview.",
      },
    });

    await page.getByRole("button", { name: "Open files" }).click();
    await expect(page.getByRole("button", { name: "Files" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await walkthrough.capture(page, "02-preview-mode", {
      caption: {
        title: "Open the file tree",
        body: "The file tree panel is the workspace selection surface for editing, preview, and history.",
      },
    });
  });
});

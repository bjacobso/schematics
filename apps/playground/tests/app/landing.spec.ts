import { expect, test } from "@playwright/test";

test.describe("Marketing landing page", () => {
  test("renders the explainer at the root and links to the playground", async ({ page }) => {
    await page.goto("/");

    // Hero copy from the landing content.
    await expect(
      page.getByRole("heading", {
        name: /Every system collapses to the same shape/i,
      }),
    ).toBeVisible();

    // The IDE chrome must NOT render on the marketing route.
    await expect(page.getByText("Schematics Playground")).toHaveCount(0);

    // CTA points at the playground route.
    const cta = page.getByRole("link", { name: "Open the playground" }).first();
    await expect(cta).toHaveAttribute("href", "/playground");
  });

  test("navigating to the CTA boots the playground IDE", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Open the playground" }).first().click();
    await page.waitForURL(/\/playground\/?$/);
    await expect(page.getByText("Schematics Playground")).toBeVisible();
  });
});

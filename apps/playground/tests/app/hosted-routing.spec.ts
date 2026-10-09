import { expect, test } from "@playwright/test";

test("reloads a hosted workspace through the Astro fallback without changing its URL", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/playground");
  await expect(page.getByText("Browser memory workspace")).toBeVisible();
  await page.getByRole("button", { name: "New hosted workspace" }).click();
  await page.waitForURL(/\/w\/[0-9a-f-]+$/);
  const workspaceUrl = page.url();
  await expect(page.getByText("Cloudflare hosted workspace")).toBeVisible();

  const response = await page.reload();
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(workspaceUrl);
  await expect(page).toHaveTitle("Schematics Playground");
  await expect(page.getByText("Cloudflare hosted workspace")).toBeVisible();
  await page.getByRole("button", { name: "Files" }).click();
  await expect(page.locator('button[title="catalog.yaml"]')).toBeVisible();
  await expect(page.locator(".suite-page")).toHaveCount(0);
  expect(errors).toEqual([]);
});

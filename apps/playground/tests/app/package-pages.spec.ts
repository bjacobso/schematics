import { expect, test } from "@playwright/test";

const names = ["algebra", "predicates", "logic", "workflow", "core", "filesystem"] as const;
const published = ["algebra", "predicates", "logic"];

for (const name of names) {
  test(`${name} has a complete static pitch with adoption and composition guidance`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    try {
      const page = await context.newPage();
      const response = await page.goto(`/packages/${name}/`);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(new RegExp(`@schema-reflection/${name}`));
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        `https://schematics.run/packages/${name}/`,
      );
      await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.+/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      for (const heading of [
        "Why it matters",
        "What it unlocks",
        "How to use it",
        "In practice",
        "How it composes",
        "Where it stops",
      ]) {
        await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      }
      const composition = page.locator("#composition .package-peer");
      await expect(composition).toHaveCount(5);
      for (const peer of names.filter((peer) => peer !== name)) {
        await expect(composition.filter({ hasText: `${name} + ${peer}` })).toHaveAttribute(
          "href",
          `/packages/${peer}/`,
        );
      }
      await expect(page.locator('a[href*="github.com/bjacobso/schema-reflection"]')).toHaveCount(0);
      if (published.includes(name)) {
        await expect(page.locator(".package-release .install-command")).toHaveText(
          `pnpm add @schema-reflection/${name}@0.1.0`,
        );
      } else {
        await expect(page.locator(".package-release .install-command")).toHaveCount(0);
        await expect(page.locator(".package-release")).toContainText(
          name === "filesystem" ? "proposed API" : "experimental source API",
        );
      }
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await expect(page.getByRole("link", { name: "All packages", exact: true })).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });
}

test("the homepage leads to a package pitch and its lazy Foldkit demo", async ({ page }) => {
  const errors: string[] = [];
  const scripts: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });
  await page.goto("/");
  await page.locator("article#algebra .pkg-name a").click();
  await expect(page).toHaveURL(/\/packages\/algebra\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Know what points at what.");
  await page.getByRole("link", { name: "Start with an example" }).click();
  await page.locator("[data-foldkit-demo=algebra]").scrollIntoViewIfNeeded();
  const demo = page.locator('[data-demo="algebra"]');
  await demo.getByRole("button", { name: "Delete notify-manager" }).click();
  await expect(demo.getByText("2 diagnostics")).toBeVisible();
  await demo.getByRole("button", { name: "Restore notify-manager" }).click();
  await expect(demo.getByText("every reference resolves")).toBeVisible();
  expect(errors).toEqual([]);
  expect(
    scripts.filter((url) =>
      /PlaygroundApp|\/main[.-]|\/react[._-]|react-dom|codemirror|mui/.test(url),
    ),
  ).toEqual([]);
});

test("a prototype page explains the host boundary while its simulation resumes", async ({
  page,
}) => {
  await page.goto("/packages/workflow/");
  await expect(page.locator(".package-hero .pkg-status")).toContainText("source only");
  await expect(page.locator("#boundaries")).toContainText("Dispatch is at least once");
  await page.locator("[data-foldkit-demo=workflow]").scrollIntoViewIfNeeded();
  const demo = page.locator('[data-demo="workflow"]');
  await demo.getByRole("button", { name: "start review" }).click();
  await demo.getByRole("button", { name: "deploy mid-review" }).click();
  await expect(demo.getByText("empty — but the checkpoint survived")).toBeVisible();
  await demo.getByRole("button", { name: "resume" }).click();
  await demo.getByRole("button", { name: "reviewer approves" }).click();
  await expect(demo.getByText('completed "approved"')).toBeVisible();
});

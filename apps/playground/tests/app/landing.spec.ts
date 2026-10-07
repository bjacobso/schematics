import { expect, test } from "@playwright/test";

const source = "https://github.com/bjacobso/schema-reflection";

test.describe("Library suite homepage", () => {
  test("introduces the suite without loading the IDE", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Describe the structure.Keep the behavior inspectable.",
    );
    await expect(page).toHaveTitle("Schematics — Composable libraries built on Effect");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /Composable libraries.*built on Effect/,
    );
    await expect(page.getByText("Schematics Playground")).toHaveCount(0);
    expect(
      requests.filter((url) =>
        /PlaygroundApp|codemirror|effect|mui|schematics-(ide|agent|examples)|\/packages\/ide\//i.test(
          url,
        ),
      ),
    ).toEqual([]);

    const cta = page.getByRole("link", { name: "Explore the packages" });
    await expect(cta).toHaveAttribute("href", "#packages");
    await cta.click();
    await expect(page.getByRole("heading", { name: "A suite, by composition." })).toBeInViewport();
    await expect(page.getByRole("link", { name: "Schema Reflection source" })).toHaveAttribute(
      "href",
      source,
    );
    await expect(page.getByRole("link", { name: "Meet WorldVM" })).toHaveAttribute(
      "href",
      "https://worldvm.com",
    );
  });

  test("shows package availability and routes to the right sources", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".package-card")).toHaveCount(6);
    for (const name of ["core", "algebra", "predicates", "logic", "workflow", "filesystem"]) {
      const card = page
        .getByRole("article")
        .filter({ has: page.getByText(`@schema-reflection/${name}`, { exact: true }) });
      await expect(card).toBeVisible();
      if (["algebra", "predicates", "logic"].includes(name)) {
        await expect(card.getByText("Published · 0.1.0", { exact: true })).toBeVisible();
        await expect(
          card.getByRole("link", { name: `@schema-reflection/${name} on npm` }),
        ).toHaveAttribute("href", `https://www.npmjs.com/package/@schema-reflection/${name}`);
      } else {
        await expect(card.getByRole("link", { name: /npm/ })).toHaveCount(0);
        await expect(
          card.getByText(
            name === "filesystem"
              ? "Planned"
              : name === "workflow"
                ? "Experimental prototype · 0.0.0"
                : "Experimental · 0.0.0",
            { exact: true },
          ),
        ).toBeVisible();
      }
      await expect(
        card.getByRole("link", { name: /Source & docs|Read the specification/ }),
      ).toHaveAttribute(
        "href",
        `${source}/tree/main/packages/${name}${name === "filesystem" ? "/SPEC.md" : ""}`,
      );
    }
    await expect(page.getByRole("link", { name: "Read the working example" })).toHaveAttribute(
      "href",
      `${source}/tree/main/packages/workflow/examples/approval`,
    );
    await expect(
      page.getByText(/Specification only; not yet implemented or installable/),
    ).toBeVisible();
  });

  for (const width of [390, 768, 1440]) {
    test(`fits the viewport at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      for (const element of await page.locator(".suite-page a").all()) {
        await expect(element).toHaveAttribute("href", /^(https:\/\/|\/|#)/);
      }
    });
  }

  test("opening the secondary demo boots the playground IDE", async ({ page }) => {
    await page.goto("/");
    const cta = page.getByRole("link", { name: "Open the playground" });
    await expect(cta).toHaveAttribute("href", "/playground");
    await cta.click();
    await page.waitForURL(/\/playground\/?$/);
    await expect(page.getByText("Schematics Playground")).toBeVisible();
    await expect(page).toHaveTitle("Schematics Playground");
  });
});

import { expect, test } from "@playwright/test";

const source = "https://github.com/bjacobso/schema-reflection";
const names = ["algebra", "predicates", "logic", "workflow", "core", "filesystem"] as const;
const published = ["algebra", "predicates", "logic"];

test.describe("Library family homepage", () => {
  test("opens with the claim without loading the IDE", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "script") requests.push(request.url());
    });
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Every app hides a second program.",
    );
    await expect(page).toHaveTitle("Schematics — Your app's hidden rules, as data");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /Every app hides a second program/,
    );
    await expect(page.getByText("Schematics Playground", { exact: true })).toHaveCount(0);
    expect(
      requests.filter((url) =>
        /PlaygroundApp|\/main[.-]|demos|foldkit[^?]*\/runtime|codemirror|\/(?:effect|@effect)[/.-]|mui|schematics-(ide|agent|examples)|\/packages\/ide\//i.test(
          url,
        ),
      ),
    ).toEqual([]);

    await page.getByRole("link", { name: "Find your package" }).click();
    await expect(
      page.getByRole("heading", { name: "It's already in your codebase. It just can't talk." }),
    ).toBeInViewport();
  });

  test("serves the complete homepage without JavaScript", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    try {
      const page = await context.newPage();
      const response = await page.goto("/");
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Every app hides a second program.",
      );
      await expect(page.locator("article.pkg")).toHaveCount(names.length);
      await expect(page.locator("article#algebra")).toHaveCSS("opacity", "1");
      await expect(page.locator("article#algebra .code-block")).toContainText("Relation.validate");
      await expect(page.getByRole("link", { name: "Open the playground" })).toBeVisible();
      await expect(page.locator(".repl-entry")).toHaveCount(5);
    } finally {
      await context.close();
    }
  });

  test("x-rays the hidden program into one link per package", async ({ page }) => {
    await page.goto("/");
    const xray = page.locator(".xray-row a");
    await expect(xray).toHaveCount(names.length);
    for (const [i, name] of names.entries()) {
      await expect(xray.nth(i)).toHaveAttribute("href", `#${name}`);
    }
    await xray.filter({ hasText: "workflow" }).click();
    await expect(page.locator("#workflow")).toBeInViewport();
  });

  test("names every package with its availability and the right links", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("article.pkg")).toHaveCount(names.length);
    for (const name of names) {
      const scoped = `@schema-reflection/${name}`;
      const card = page.locator(`article#${name}`);
      await expect(card.getByRole("heading", { level: 3 })).toHaveText(scoped);
      await expect(card.locator(".pkg-bug")).toBeVisible();
      await expect(card.locator(".pkg-uses li")).toHaveCount(4);
      if (published.includes(name)) {
        await expect(card.getByText("Published · 0.1.0", { exact: true })).toBeVisible();
        await expect(card.getByText(`pnpm add ${scoped}`)).toBeVisible();
        await expect(card.getByRole("link", { name: `${scoped} on npm` })).toHaveAttribute(
          "href",
          `https://www.npmjs.com/package/${scoped}`,
        );
      } else {
        await expect(card.getByRole("link", { name: /on npm/ })).toHaveCount(0);
      }
    }
    await expect(page.locator("#workflow").getByText(/source only/)).toBeVisible();
    await expect(page.locator("#core").getByText(/source only/)).toBeVisible();
    await expect(
      page.getByRole("link", { name: "@schema-reflection/filesystem specification" }),
    ).toHaveAttribute("href", `${source}/tree/main/packages/filesystem/SPEC.md`);
    await expect(page.getByRole("link", { name: "Read the working example" })).toHaveAttribute(
      "href",
      `${source}/tree/main/packages/workflow/examples/approval`,
    );
  });

  test("demos react to input", async ({ page }) => {
    await page.goto("/");

    const requests: string[] = [];
    const errors: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "script") requests.push(request.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    // Scroll towards each island so its Foldkit runtime can load.
    await page.locator("[data-foldkit-demo=algebra]").scrollIntoViewIfNeeded();
    const algebra = page.locator('[data-demo="algebra"]');
    await algebra.getByRole("button", { name: "Delete notify-manager" }).click();
    await expect(algebra.getByText("2 diagnostics")).toBeVisible();
    await expect(algebra.getByText('Unresolved Action reference "notify-manager"')).toHaveCount(2);
    await algebra.getByRole("button", { name: "Restore notify-manager" }).click();
    await expect(algebra.getByText("every reference resolves")).toBeVisible();

    await page.locator("[data-foldkit-demo=predicates]").scrollIntoViewIfNeeded();
    const predicates = page.locator('[data-demo="predicates"]');
    await expect(predicates.getByText(/ALLOW — lead asking for \$320/)).toBeVisible();
    await predicates.getByRole("slider", { name: "Refund amount in dollars" }).fill("700");
    await expect(predicates.getByText(/DENY — lead asking for \$700/)).toBeVisible();
    await predicates.getByRole("button", { name: "finance" }).click();
    await expect(predicates.getByText(/ALLOW — finance asking for \$700/)).toBeVisible();

    await page.locator("[data-foldkit-demo=logic]").scrollIntoViewIfNeeded();
    const logic = page.locator('[data-demo="logic"]');
    await logic.getByRole("button", { name: "reader" }).click();
    await expect(logic.getByText("RequireFailed: forbidden")).toBeVisible();

    await page.locator("[data-foldkit-demo=workflow]").scrollIntoViewIfNeeded();
    const workflow = page.locator('[data-demo="workflow"]');
    await workflow.getByRole("button", { name: "start review" }).click();
    await workflow.getByRole("button", { name: "deploy mid-review" }).click();
    await expect(workflow.getByText("empty — but the checkpoint survived")).toBeVisible();
    await expect(workflow.getByRole("button", { name: "reviewer approves" })).toBeDisabled();
    await workflow.getByRole("button", { name: "resume" }).click();
    await workflow.getByRole("button", { name: "reviewer approves" }).click();
    await expect(workflow.getByText('completed "approved"')).toBeVisible();

    await page.locator("[data-foldkit-demo=core]").scrollIntoViewIfNeeded();
    const core = page.locator('[data-demo="core"]');
    await core.getByRole("button", { name: "MetaSchema.validate" }).click();
    await core.getByRole("button", { name: "an extra key" }).click();
    await expect(core.getByText(/admin: unexpected key/)).toBeVisible();
    await core.getByRole("button", { name: "a valid candidate" }).click();
    await expect(core.getByText(/valid — returns a frozen JSON snapshot/)).toBeVisible();
    expect(errors).toEqual([]);
    expect(
      requests.filter((url) =>
        /\/main[.-]|PlaygroundApp|\/react[._-]|react-dom|codemirror|mui/.test(url),
      ),
    ).toEqual([]);

    // Hovering a package section must not pick up stray global hover styles.
    const article = page.locator("article#workflow");
    await article.hover();
    await expect(article).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });

  test("links back to the WorldVM family", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /WorldVM family/ })).toHaveAttribute(
      "href",
      "https://worldvm.com",
    );
    const family = page.locator("#family");
    for (const [name, href] of [
      ["Triplex", "https://triplex.build"],
      ["Forma", "https://github.com/bjacobso/forma"],
      ["Foldworks", "https://foldworks.dev"],
      ["Runfold", "https://github.com/bjacobso/runfold"],
      ["Open Ontology", "https://open-ontology.com"],
    ] as const) {
      await expect(family.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute(
        "href",
        href,
      );
    }
    await expect(
      family.getByRole("link", { name: /Meet the whole family at worldvm\.com/ }),
    ).toHaveAttribute("href", "https://worldvm.com");
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

  test("opening the playground boots the IDE", async ({ page }) => {
    await page.goto("/");
    const cta = page.getByRole("link", { name: "Open the playground" });
    await expect(cta).toHaveAttribute("href", "/playground");
    await cta.click();
    await page.waitForURL(/\/playground\/?$/);
    await expect(page.getByText("Schematics Playground")).toBeVisible();
    await expect(page).toHaveTitle("Schematics Playground");
  });
});

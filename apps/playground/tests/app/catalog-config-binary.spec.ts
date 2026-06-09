import { expect, test, type Page } from "@playwright/test";
import { installDeterministicBrowserEnvironment } from "../support/deterministic";
import { createWalkthrough } from "../support/walkthrough";

const localFilesystemPort = Number(process.env["SCHEMATICS_E2E_LOCAL_FS_PORT"] ?? 4419);
const catalogConfigUrl = `http://127.0.0.1:${localFilesystemPort}`;

test.describe("Catalog config binary walkthrough", () => {
  test.describe.configure({ mode: "serial" });

  test.use({ baseURL: catalogConfigUrl });

  test("captures filesystem source views from the embedded catalog-config CLI", async ({
    page,
  }, testInfo) => {
    await installDeterministicBrowserEnvironment(page);
    const walkthrough = createWalkthrough(testInfo);

    await page.goto("/playground");
    await expect(page.getByText("Local filesystem workspace")).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await openArtifactProjectSource(page, "items/beloved.yaml", ["Beloved", "morrison"]);
    await walkthrough.capture(page, "01-item-beloved", {
      caption: {
        title: "Review a catalogued item",
        body: "The embedded catalog-config CLI serves the library workspace from disk and renders the item with its authors, editions, copies, and holds.",
      },
    });

    await openArtifactProjectSource(page, "collections/staff-picks.yaml", [
      "Staff Picks",
      "beloved",
    ]);
    await walkthrough.capture(page, "02-collection-staff-picks", {
      caption: {
        title: "Review a collection",
        body: "The collection preview lists the items it groups and the shelves it occupies, resolved by id reference.",
      },
    });

    await openArtifactProjectSource(page, "policies/standard.yaml", ["Standard Loan", "fic-a-f"]);
    await walkthrough.capture(page, "03-policy-standard-loan", {
      caption: {
        title: "Review a loan policy",
        body: "Loan policies are scoped to the catalog and point at a primary shelf by path reference.",
      },
    });

    await openArtifactProjectSource(page, "catalog.yaml", ["New York Public Library"]);
    await walkthrough.capture(page, "04-catalog-source", {
      caption: {
        title: "Review the catalog container",
        body: "The catalog source remains visible from the embedded workspace served by the catalog-config CLI.",
      },
    });

    await openArtifactProjectSource(page, "branches/schwarzman.yaml", [
      "Stephen A. Schwarzman Building",
    ]);
    await walkthrough.capture(page, "05-branch-schwarzman", {
      caption: {
        title: "Review a branch",
        body: "Branch source files stay available alongside items, collections, and policies.",
      },
    });
  });
});

async function openArtifactProjectSource(
  page: Page,
  path: string,
  expectedText: readonly string[],
) {
  await page.getByRole("button", { name: "Files" }).click();
  await expect(page.getByRole("button", { name: "Files" })).toHaveAttribute("aria-pressed", "true");
  await page.locator(`button[title="${path}"]`).click();
  for (const text of expectedText) {
    await showText(page, text);
  }
}

/** Some entities have custom previews; others render via "View raw". Try both. */
async function showText(page: Page, text: string) {
  if (await page.getByText(text).first().isVisible()) return;
  const viewRaw = page.getByRole("button", { name: "View raw" });
  if (await viewRaw.isVisible()) await viewRaw.click();
  await expect(page.getByText(text).first()).toBeVisible();
}

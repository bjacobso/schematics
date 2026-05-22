import { expect, test, type Page } from "@playwright/test";
import { installDeterministicBrowserEnvironment } from "../support/deterministic";
import { createWalkthrough } from "../support/walkthrough";

const onboardedConfigUrl = "http://127.0.0.1:4319";

test.describe("Onboarded config binary walkthrough", () => {
  test.describe.configure({ mode: "serial" });

  test.use({ baseURL: onboardedConfigUrl });

  test("captures filesystem previews from the embedded onboarded-config CLI", async ({
    page,
  }, testInfo) => {
    await installDeterministicBrowserEnvironment(page);
    const walkthrough = createWalkthrough(testInfo);

    await page.goto("/");
    await expect(page.getByText("Demo Staffing Test Account")).toBeVisible();
    await expect(page.getByText("Local filesystem workspace")).toBeVisible();
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByRole("button", { name: "Preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await openWorkspacePreview(page, "policies/client-site-onboarding.yaml", [
      "Client Site Onboarding",
      "Required forms",
    ]);
    await walkthrough.capture(page, "01-policy-client-site-onboarding", {
      caption: {
        title: "Review a policy",
        body: "The embedded onboarded-config CLI serves the customer workspace from disk and renders the policy rule plus required forms.",
      },
    });

    await openWorkspacePreview(page, "forms/client-safety-packet.yaml", [
      "Client Safety Packet",
      "Cell Phone Policy",
    ]);
    await walkthrough.capture(page, "02-form-client-safety-packet", {
      caption: {
        title: "Review a local form",
        body: "The form preview shows the Onboarded form builder surface for the selected local form definition.",
      },
    });

    await openWorkspacePreview(page, "forms/site-safety-quiz.yaml", [
      "Site Safety Quiz",
      "I understand the safety policy.",
    ]);
    await walkthrough.capture(page, "03-form-site-safety-quiz", {
      caption: {
        title: "Review another local form",
        body: "Selecting another form keeps the browser in preview mode and renders the configured fields and controls.",
      },
    });

    await openWorkspacePreview(page, "forms/library/standard-tax-withholding.yaml", [
      "Standard Tax Withholding",
      "Library Form",
    ]);
    await walkthrough.capture(page, "04-form-library-subscription", {
      caption: {
        title: "Review a library form subscription",
        body: "Library subscriptions use the same filesystem-driven preview flow while surfacing registry and deploy intent.",
      },
    });

    await openWorkspacePreview(page, "account.yaml", ["Account", "Demo Staffing Test Account"]);
    await walkthrough.capture(page, "05-account-preview", {
      caption: {
        title: "Review account settings",
        body: "The account preview summarizes account identity, source provenance, and deploy defaults from the embedded workspace schema.",
      },
    });

    await openWorkspacePreview(page, "attributes.yaml", [
      "Attribute Catalog",
      "employee.custom_attributes.badge_number",
    ]);
    await walkthrough.capture(page, "06-attributes-preview", {
      caption: {
        title: "Review attributes",
        body: "The attribute catalog preview lists custom and system paths used by policies, forms, and automations.",
      },
    });

    await openWorkspacePreview(page, "documents/client-safety-packet/document.yaml", [
      "Client Safety Packet PDF",
      "Generated",
    ]);
    await walkthrough.capture(page, "07-document-preview", {
      caption: {
        title: "Review document metadata",
        body: "Document previews connect source PDFs with generated inspection, annotation, and screenshot sidecars.",
      },
    });

    await openWorkspacePreview(
      page,
      "documents/client-safety-packet/_generated/client-safety-packet.pdf.inspect.yaml",
      ["PDF Inspect", "AcroForm fields"],
    );
    await walkthrough.capture(page, "08-pdf-inspect-preview", {
      caption: {
        title: "Review PDF inspection output",
        body: "Generated PDF inspection files render the detected pages and AcroForm fields for quick review.",
      },
    });

    await openWorkspacePreview(
      page,
      "documents/client-safety-packet/_generated/client-safety-packet.pdf.annotations.yaml",
      ["Client Safety Packet PDF", "Annotations"],
    );
    await walkthrough.capture(page, "09-pdf-annotations-preview", {
      caption: {
        title: "Review PDF annotations",
        body: "Annotation previews show each generated PDF target, type, label, and bounding box.",
      },
    });

    await openWorkspacePreview(page, "pdf-mappings/client-safety-packet.yaml", [
      "client-safety-packet-pdf",
      "Form fields to PDF targets",
    ]);
    await walkthrough.capture(page, "10-pdf-mapping-preview", {
      caption: {
        title: "Review PDF mappings",
        body: "PDF mappings show the bridge between Onboarded form fields and generated PDF annotations.",
      },
    });

    await openWorkspacePreview(page, "automations/remind-expiring-task.yaml", [
      "Remind assignee before client-site task expires",
      "Workflow steps",
    ]);
    await walkthrough.capture(page, "11-automation-preview", {
      caption: {
        title: "Review automations",
        body: "Automation previews summarize triggers, conditions, and workflow steps in the same consumer-driven UI.",
      },
    });

    await openWorkspacePreview(page, "imports/upstream-source.yaml", [
      "upstream-source",
      "Generated form artifacts",
    ]);
    await walkthrough.capture(page, "12-import-preview", {
      caption: {
        title: "Review import provenance",
        body: "Import previews keep source and generated artifact paths visible for implementation review.",
      },
    });
  });
});

async function openWorkspacePreview(
  page: Page,
  path: string,
  expectedText: readonly [string, string],
) {
  await page.locator(`button[title="${path}"]`).click();
  await expect(page.getByText(path).first()).toBeVisible();
  for (const text of expectedText) {
    await expect(page.getByText(text).first()).toBeVisible();
  }
}

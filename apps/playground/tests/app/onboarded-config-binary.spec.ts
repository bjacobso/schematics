import { expect, test, type Page } from "@playwright/test";
import { installDeterministicBrowserEnvironment } from "../support/deterministic";
import { createWalkthrough } from "../support/walkthrough";

const onboardedConfigUrl = "http://127.0.0.1:4319";

test.describe("Onboarded config binary walkthrough", () => {
  test.describe.configure({ mode: "serial" });

  test.use({ baseURL: onboardedConfigUrl });

  test("captures filesystem source views from the embedded onboarded-config CLI", async ({
    page,
  }, testInfo) => {
    await installDeterministicBrowserEnvironment(page);
    const walkthrough = createWalkthrough(testInfo);

    await page.goto("/");
    await expect(page.getByText("Local filesystem workspace")).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await openArtifactProjectSource(page, "policies/safety-compliance.yaml", [
      "Safety Compliance",
      "client-safety-packet",
    ]);
    await walkthrough.capture(page, "01-policy-safety-compliance", {
      caption: {
        title: "Review a policy",
        body: "The embedded onboarded-config CLI serves the customer workspace from disk and renders the policy rule plus required forms.",
      },
    });

    await openArtifactProjectSource(page, "forms/client-safety-packet.yaml", [
      "Client Safety Packet",
      "placement.custom.branch_code",
    ]);
    await walkthrough.capture(page, "02-form-client-safety-packet", {
      caption: {
        title: "Review a local form",
        body: "The form preview shows the Onboarded form builder surface for the selected local form definition.",
      },
    });

    await openArtifactProjectSource(page, "forms/employee-handbook.yaml", [
      "Employee Handbook",
      "Employee handbook acknowledgement.",
    ]);
    await walkthrough.capture(page, "03-form-employee-handbook", {
      caption: {
        title: "Review another local form",
        body: "Selecting another form keeps the browser in preview mode and renders the configured fields and controls.",
      },
    });

    await openArtifactProjectSource(page, "account.yaml", ["acc_demo", "Demo Staffing"]);
    await walkthrough.capture(page, "04-account-source", {
      caption: {
        title: "Review account settings",
        body: "The account source remains visible from the embedded workspace served by the onboarded-config CLI.",
      },
    });

    await openArtifactProjectSource(page, "custom-properties/employee.custom.badge_number.yaml", [
      "badge_number",
      "Badge",
    ]);
    await walkthrough.capture(page, "05-custom-property-badge-number", {
      caption: {
        title: "Review custom properties",
        body: "Custom property source files stay available alongside forms, policies, and automations.",
      },
    });

    await openArtifactProjectSource(page, "automations/welcome-email.yaml", [
      "Welcome Email",
      "send_email",
    ]);
    await walkthrough.capture(page, "06-automation-welcome-email", {
      caption: {
        title: "Review automations",
        body: "Automation previews summarize triggers, conditions, and workflow steps in the same consumer-driven UI.",
      },
    });
  });
});

async function openArtifactProjectSource(
  page: Page,
  path: string,
  expectedText: readonly [string, string],
) {
  await page.getByRole("button", { name: "Files" }).click();
  await expect(page.getByRole("button", { name: "Files" })).toHaveAttribute("aria-pressed", "true");
  await page.locator(`button[title="${path}"]`).click();
  for (const text of expectedText) {
    await expect(page.getByText(text).first()).toBeVisible();
  }
}

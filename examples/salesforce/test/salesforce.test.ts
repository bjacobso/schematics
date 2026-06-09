import { ArtifactRef, createMemoryArtifactStore } from "@schematics/artifacts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  salesforceProvider,
  validateSalesforceWorkspaceValue,
  type SalesforceWorkspaceValue,
} from "../src/index";

const baseWorkspace: SalesforceWorkspaceValue = {
  org: { id: "acme", name: "Acme Corp", edition: "enterprise" },
  valueSets: [{ id: "industry", label: "Industry", values: ["Technology"] }],
  objects: [
    {
      id: "Account",
      label: "Account",
      fields: [
        { apiName: "Industry", label: "Industry", type: "picklist", valueSet: "industry" },
        { apiName: "AnnualRevenue", label: "Annual Revenue", type: "number" },
      ],
      validationRules: [
        { name: "RevenueNonNegative", field: "AnnualRevenue", errorMessage: "no negatives" },
      ],
    },
  ],
  roles: [
    { id: "ceo", name: "CEO" },
    { id: "vp-sales", name: "VP of Sales", parentRoleId: "ceo" },
  ],
  profiles: [{ id: "system-admin", name: "System Administrator", objectAccess: ["Account"] }],
  users: [{ id: "alice", email: "alice@acme.example", profileId: "system-admin", roleId: "ceo" }],
};

describe("salesforce diagnostics", () => {
  it("a valid org has no diagnostics", () => {
    expect(validateSalesforceWorkspaceValue(baseWorkspace)).toEqual([]);
  });

  it("flags an unknown value set on a field", () => {
    const workspace: SalesforceWorkspaceValue = {
      ...baseWorkspace,
      objects: [
        {
          id: "Account",
          label: "Account",
          fields: [
            { apiName: "Industry", label: "Industry", type: "picklist", valueSet: "missing-set" },
          ],
        },
      ],
    };
    const diagnostics = validateSalesforceWorkspaceValue(workspace);
    expect(diagnostics.some((d) => d.message === "Unknown valueSet: missing-set")).toBe(true);
  });

  it("flags an unknown profile on a user", () => {
    const workspace: SalesforceWorkspaceValue = {
      ...baseWorkspace,
      users: [{ id: "carol", email: "carol@acme.example", profileId: "ghost-profile" }],
    };
    const diagnostics = validateSalesforceWorkspaceValue(workspace);
    expect(diagnostics.some((d) => d.message === "Unknown profile: ghost-profile")).toBe(true);
  });

  it("flags a validation rule referencing a missing field on its object", () => {
    const workspace: SalesforceWorkspaceValue = {
      ...baseWorkspace,
      objects: [
        {
          id: "Account",
          label: "Account",
          fields: [{ apiName: "Industry", label: "Industry", type: "text" }],
          validationRules: [{ name: "Bad", field: "DoesNotExist", errorMessage: "x" }],
        },
      ],
    };
    const diagnostics = validateSalesforceWorkspaceValue(workspace);
    expect(diagnostics.some((d) => d.message === "Unknown field: DoesNotExist")).toBe(true);
  });
});

describe("salesforce provider DSL", () => {
  it("connects to the derived mock, pulls files, and re-plans clean", async () => {
    const store = createMemoryArtifactStore();
    const service = salesforceProvider.makeDeployService({ store, projectId: "salesforce-yaml" });

    await Effect.runPromise(
      service.connect({
        environment: "production",
        authMethod: "token",
        credentials: { token: "secret" },
      } as any),
    );

    const pulled = await Effect.runPromise(service.pull());
    const paths = pulled.pulled.map((file) => file.path).sort();
    expect(paths).toContain("org.yaml");
    expect(paths).toContain("value-sets/industry.yaml");
    expect(paths).toContain("objects/account.yaml");
    expect(paths).toContain("roles/ceo.yaml");
    expect(paths).toContain("profiles/system-admin.yaml");
    expect(paths).toContain("users/alice.yaml");

    const account = await Effect.runPromise(
      store.read(ArtifactRef.projectFile("objects/account.yaml", "salesforce-yaml")),
    );
    expect(account).toContain("id: Account");

    const opportunity = await Effect.runPromise(
      store.read(ArtifactRef.projectFile("objects/opportunity.yaml", "salesforce-yaml")),
    );
    expect(opportunity).toContain("id: Opportunity");
    expect(opportunity).toContain("lookupTo: Account");

    const plan = await Effect.runPromise(service.plan());
    expect(plan.summary).toMatchObject({ create: 0, update: 0, delete: 0 });
  });
});

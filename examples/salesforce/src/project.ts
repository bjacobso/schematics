import { Project } from "@schematics/core";
import { deriveArtifactProject, deriveProjectSchema } from "@schematics/provider";
import { salesforceResources } from "./resources";
import { SalesforceWorkspaceSchema } from "./schema";

export const SalesforceArtifactProject = deriveArtifactProject({
  id: "salesforce-yaml",
  resources: salesforceResources,
  include: ["**/*.yaml", "config.lock.json", ".env", ".env.*"],
  metadata: ["config.lock.json"],
  secret: [".env", ".env.*"],
});

export const SalesforceProjectBaseSchema = Project.fromArtifactProject(
  SalesforceArtifactProject,
) as any;

export const SalesforceProjectSchema = deriveProjectSchema(
  SalesforceArtifactProject,
  SalesforceWorkspaceSchema as any,
  salesforceResources,
  { label: "salesforce org references resolve", fallbackDocument: "org" },
);

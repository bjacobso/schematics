import { Project } from "@schematics/core";
import { deriveArtifactProject, deriveProjectSchema } from "@schematics/provider";
import { pagerDutyResources } from "./resources";
import { PagerDutyWorkspaceSchema } from "./schema";

export const PagerDutyArtifactProject = deriveArtifactProject({
  id: "pagerduty-yaml",
  resources: pagerDutyResources,
  include: ["**/*.yaml", "config.lock.json", ".env", ".env.*"],
  metadata: ["config.lock.json"],
  secret: [".env", ".env.*"],
});

export const PagerDutyProjectBaseSchema = Project.fromArtifactProject(
  PagerDutyArtifactProject,
) as any;

export const PagerDutyProjectSchema = deriveProjectSchema(
  PagerDutyArtifactProject,
  PagerDutyWorkspaceSchema as any,
  pagerDutyResources,
  { label: "pagerduty on-call references resolve", fallbackDocument: "services" },
);

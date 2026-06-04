import { defineSchematicsProject } from "@schematics/cli";
import { OnboardedArtifactProject } from "./artifacts";
import {
  OnboardedAccountProjectBaseSchema,
  OnboardedAccountRelationSchema,
  validateOnboardedAccountWorkspaceValue,
  type AccountWorkspaceValue,
} from "./workspace";

export const OnboardedConfigProject = defineSchematicsProject<AccountWorkspaceValue>({
  id: "onboarded-account-yaml",
  project: OnboardedArtifactProject,
  relationInputSchema: OnboardedAccountProjectBaseSchema as any,
  relationSchema: OnboardedAccountRelationSchema,
  projectDiagnostics: (value, context) =>
    validateOnboardedAccountWorkspaceValue(value, context.files),
  defaultFormat: "yaml",
  include: ["**/*.yaml", "**/*.pdf", "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.webp"],
});

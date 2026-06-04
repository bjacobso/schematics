import {
  decodeYamlEither,
  SchematicsProjectFileArtifact,
  stringifyDocument,
} from "@schematics/core";
import {
  ArtifactProject,
  ArtifactProjectConfigSchema,
  type AnyArtifactType,
  type ArtifactProjectConfig,
  type ArtifactProjectConfigArtifact,
  type ArtifactProjectDeclaration,
} from "@schematics/artifacts";
import { Result, Schema, SchemaIssue } from "effect";
import {
  OnboardedAccountConfigSchema,
  OnboardedAutomationConfigSchema,
  OnboardedCustomPropertyConfigSchema,
  OnboardedFormConfigSchema,
  OnboardedPolicyConfigSchema,
} from "./config";

export const OnboardedArtifactProjectRouteSchema = Schema.Struct({
  id: Schema.String,
  pattern: Schema.String,
  artifact: Schema.String,
  format: Schema.optional(Schema.String),
  workspaceField: Schema.optional(Schema.String),
  mode: Schema.optional(Schema.Literals(["file", "files", "values"] as const)),
  indexBy: Schema.optional(Schema.String),
  optional: Schema.optional(Schema.Boolean),
  description: Schema.optional(Schema.String),
});

export const OnboardedArtifactProjectConfigSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  defaultFormat: Schema.Literals(["json", "yaml"] as const),
  include: Schema.Array(Schema.String),
  files: Schema.Array(OnboardedArtifactProjectRouteSchema),
  algebra: Schema.Struct({
    relationSchema: Schema.String,
    views: Schema.Array(Schema.String),
  }),
});

export type OnboardedArtifactProjectRoute = typeof OnboardedArtifactProjectRouteSchema.Type;
export type OnboardedArtifactProjectConfig = typeof OnboardedArtifactProjectConfigSchema.Type;

/**
 * Routes for the five domain entities modeling the Onboarded account config:
 * account (single), custom properties, forms, policies, automations. Files use
 * the config-friendly (slug-keyed) shapes from `./config`.
 */
export const OnboardedArtifactProjectConfigDefinition = {
  id: "onboarded-account-yaml",
  name: "Onboarded Account Artifact Project",
  defaultFormat: "yaml",
  include: ["**/*.yaml"],
  files: [
    {
      id: "account",
      pattern: "account.yaml",
      artifact: "OnboardedAccountConfig",
      format: "yaml",
      mode: "file",
      description: "Account-level settings and organization metadata.",
    },
    {
      id: "customProperties",
      pattern: "custom-properties/*.yaml",
      artifact: "OnboardedCustomPropertyConfig",
      format: "yaml",
      mode: "values",
      optional: true,
      description: "Custom property (attribute) definitions, keyed by path.",
    },
    {
      id: "forms",
      pattern: "forms/*.yaml",
      artifact: "OnboardedFormConfig",
      format: "yaml",
      mode: "values",
      description: "Account forms.",
    },
    {
      id: "policies",
      pattern: "policies/*.yaml",
      artifact: "OnboardedPolicyConfig",
      format: "yaml",
      mode: "values",
      optional: true,
      description: "Policy rules and the forms they require.",
    },
    {
      id: "automations",
      pattern: "automations/*.yaml",
      artifact: "OnboardedAutomationConfig",
      format: "yaml",
      mode: "values",
      optional: true,
      description: "Account automation definitions (node/edge graph).",
    },
  ],
  algebra: {
    relationSchema: "OnboardedAccountRelationSchema",
    views: [
      "relationGraph",
      "entityIndex",
      "definitionLocations",
      "references",
      "relationDiagnostics",
      "referenceDiagnostics",
      "patchSuggestions",
    ],
  },
} as const satisfies ArtifactProjectConfig;

export const OnboardedArtifactProjectEnvironment = {
  OnboardedAccountConfig: schemaArtifact(OnboardedAccountConfigSchema),
  OnboardedCustomPropertyConfig: schemaArtifact(OnboardedCustomPropertyConfigSchema),
  OnboardedFormConfig: schemaArtifact(OnboardedFormConfigSchema),
  OnboardedPolicyConfig: schemaArtifact(OnboardedPolicyConfigSchema),
  OnboardedAutomationConfig: schemaArtifact(OnboardedAutomationConfigSchema),
} satisfies Readonly<Record<string, ArtifactProjectConfigArtifact>>;

export function createOnboardedArtifactProject(
  config: OnboardedArtifactProjectConfig = OnboardedArtifactProjectConfigDefinition,
): ArtifactProjectDeclaration<string, any, any> {
  Schema.decodeUnknownSync(ArtifactProjectConfigSchema)(config);
  return ArtifactProject.fromConfig(config, {
    artifacts: OnboardedArtifactProjectEnvironment,
  });
}

export const OnboardedArtifactProject = createOnboardedArtifactProject();

export function parseOnboardedArtifactProjectConfig(text: string): OnboardedArtifactProjectConfig {
  const result = decodeYamlEither(OnboardedArtifactProjectConfigSchema, text);
  if (Result.isSuccess(result)) return result.success;
  throw new Error(SchemaIssue.makeFormatterDefault()(result.failure));
}

export function serializeOnboardedArtifactProjectConfig(
  config: OnboardedArtifactProjectConfig = Schema.decodeUnknownSync(
    OnboardedArtifactProjectConfigSchema,
  )(ArtifactProject.toConfig(OnboardedArtifactProject)),
): string {
  return stringifyDocument(config, "yaml");
}

function schemaArtifact(schema: Schema.Schema<unknown>): ArtifactProjectConfigArtifact {
  return {
    type: SchematicsProjectFileArtifact as unknown as AnyArtifactType,
    schema,
  };
}

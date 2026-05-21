import { Schema } from "effect";
import { ScalarTypeSchema, type WorkspaceIssue } from "./common";

const AttributeDefinitionSchema = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  type: ScalarTypeSchema,
  required: Schema.optional(Schema.Boolean),
  status: Schema.optional(Schema.Literals(["active", "deprecated"])),
  sensitive: Schema.optional(Schema.Boolean),
});
export type OnboardedAttributeDefinition = typeof AttributeDefinitionSchema.Type;

const CustomAttributeGroupsSchema = Schema.Struct({
  employee: Schema.optional(Schema.Array(AttributeDefinitionSchema)),
  employer: Schema.optional(Schema.Array(AttributeDefinitionSchema)),
  placement: Schema.optional(Schema.Array(AttributeDefinitionSchema)),
  client: Schema.optional(Schema.Array(AttributeDefinitionSchema)),
  job: Schema.optional(Schema.Array(AttributeDefinitionSchema)),
  form: Schema.optional(Schema.Array(AttributeDefinitionSchema)),
});

const SystemAttributeGroupsSchema = Schema.Struct({
  employee: Schema.optional(Schema.Array(AttributeDefinitionSchema)),
  employer: Schema.optional(Schema.Array(AttributeDefinitionSchema)),
  placement: Schema.optional(Schema.Array(AttributeDefinitionSchema)),
  client: Schema.optional(Schema.Array(AttributeDefinitionSchema)),
  job: Schema.optional(Schema.Array(AttributeDefinitionSchema)),
});

export const OnboardedAttributeCatalogSchema = Schema.Struct({
  custom: Schema.optional(CustomAttributeGroupsSchema),
  system: Schema.optional(SystemAttributeGroupsSchema),
});
export type OnboardedAttributeCatalog = typeof OnboardedAttributeCatalogSchema.Type;

export type AttributeRegistry = {
  readonly paths: Map<string, OnboardedAttributeDefinition & { readonly path: string }>;
};

export const customAttributeEntities = [
  "employee",
  "employer",
  "placement",
  "client",
  "job",
  "form",
] as const;
export const systemAttributeEntities = [
  "employee",
  "employer",
  "placement",
  "client",
  "job",
] as const;

export function buildAttributeRegistry(
  catalog: OnboardedAttributeCatalog | null,
): AttributeRegistry {
  const paths = new Map<string, OnboardedAttributeDefinition & { readonly path: string }>();

  for (const entity of customAttributeEntities) {
    for (const attribute of catalog?.custom?.[entity] ?? []) {
      const path = `${entity}.custom_attributes.${attribute.key}`;
      paths.set(path, { ...attribute, path });
    }
  }

  for (const entity of systemAttributeEntities) {
    for (const attribute of catalog?.system?.[entity] ?? []) {
      const path = `${entity}.${attribute.key}`;
      paths.set(path, { ...attribute, path });
    }
  }

  return { paths };
}

export function validateAttributeCatalog(
  catalog: OnboardedAttributeCatalog | null,
  issue: WorkspaceIssue,
) {
  const seen = new Set<string>();

  for (const entity of customAttributeEntities) {
    const keys = new Set<string>();
    for (const attribute of catalog?.custom?.[entity] ?? []) {
      if (keys.has(attribute.key)) {
        issue.at(
          `attributes.custom.${entity}`,
          `Duplicate custom attribute key: ${attribute.key}`,
          "attributes.yaml",
        );
      }
      keys.add(attribute.key);
      const path = `${entity}.custom_attributes.${attribute.key}`;
      if (seen.has(path)) {
        issue.at("attributes.custom", `Duplicate attribute path: ${path}`, "attributes.yaml");
      }
      seen.add(path);
    }
  }

  for (const entity of systemAttributeEntities) {
    const keys = new Set<string>();
    for (const attribute of catalog?.system?.[entity] ?? []) {
      if (keys.has(attribute.key)) {
        issue.at(
          `attributes.system.${entity}`,
          `Duplicate system attribute key: ${attribute.key}`,
          "attributes.yaml",
        );
      }
      keys.add(attribute.key);
      const path = `${entity}.${attribute.key}`;
      if (seen.has(path)) {
        issue.at("attributes.system", `Duplicate attribute path: ${path}`, "attributes.yaml");
      }
      seen.add(path);
    }
  }
}

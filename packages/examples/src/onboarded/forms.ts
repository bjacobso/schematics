import { Schema } from "effect";
import { Relation } from "@schema-ide/schema-algebra";
import type { AttributeRegistry } from "./attributes";
import { findDuplicates, type WorkspaceIssue } from "./common";
import { OnboardedRuleSchema, collectRuleConditions } from "./rules";
import { allowedTaskPaths } from "./validation";

export const FieldRuleSchema = Schema.NullOr(
  Schema.Struct({
    effect: Schema.Literals(["SHOW", "HIDE"]),
    conditions: OnboardedRuleSchema,
  }),
);

export interface FormField {
  readonly path: string;
  readonly type: string;
  readonly required?: boolean | undefined;
  readonly rule?: typeof FieldRuleSchema.Type | undefined;
  readonly options?: unknown;
  readonly translations?: unknown;
  readonly subfields?: readonly FormField[] | undefined;
}

export const FormFieldSchema: Schema.Schema<FormField> = Relation.derivedId(
  Schema.Struct({
    path: Schema.String,
    type: Schema.String,
    required: Schema.optional(Schema.Boolean),
    rule: Schema.optional(FieldRuleSchema),
    options: Schema.optional(Schema.Unknown),
    translations: Schema.optional(Schema.Unknown),
    subfields: Schema.optional(Schema.Array(Schema.suspend(() => FormFieldSchema))),
  }),
  "FormField",
  { id: "path", scope: Relation.parent("Form") },
);

export const FormVersionExportSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  pages: Schema.Array(
    Schema.Struct({
      description: Schema.NullOr(Schema.String),
      assignee: Schema.Literals(["employee", "employer", "system"]),
      addOns: Schema.optional(Schema.Array(Schema.Unknown)),
      fields: Schema.Array(FormFieldSchema),
    }),
  ),
});

const SourceMetadataSchema = Schema.Struct({
  system: Schema.String,
  formId: Schema.optional(Schema.String),
  output: Schema.optional(Schema.String),
});

export const OnboardedFormConfigSchema = Schema.Struct({
  id: Relation.id("Form", { display: "name" }),
  name: Schema.String,
  status: Schema.Literals(["draft", "published", "deprecated"]),
  owner: Schema.optional(Schema.Literals(["account", "library"])),
  source: Schema.optional(SourceMetadataSchema),
  references: Schema.optional(
    Schema.Struct({
      attributes: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  version: FormVersionExportSchema,
});
export type OnboardedFormConfig = typeof OnboardedFormConfigSchema.Type;

export const OnboardedFormSubscriptionSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["active", "paused", "deprecated"]),
  source: Schema.Struct({
    registry: Schema.String,
    kind: Schema.Literals(["compliance-form", "system-form"]),
    slug: Schema.String,
    version: Schema.String,
  }),
  libraryForm: Schema.Struct({
    externalId: Schema.String,
    canonicalPath: Schema.optional(Schema.String),
  }),
  subscription: Schema.Struct({
    autoUpdate: Schema.Boolean,
    mode: Schema.Literals(["required", "available"]),
  }),
  deploy: Schema.optional(
    Schema.Struct({
      target: Schema.Literals(["test", "live"]),
    }),
  ),
  overrides: Schema.optional(
    Schema.Struct({
      displayName: Schema.optional(Schema.String),
      dueInDays: Schema.optional(Schema.Number),
      assignee: Schema.optional(Schema.Literals(["employee", "employer", "system"])),
    }),
  ),
});
export type OnboardedFormSubscription = typeof OnboardedFormSubscriptionSchema.Type;

export function validateFormNamespace(
  forms: ReadonlyMap<string, OnboardedFormConfig>,
  subscriptions: ReadonlyMap<string, OnboardedFormSubscription>,
  issue: WorkspaceIssue,
) {
  for (const id of forms.keys()) {
    if (subscriptions.has(id)) {
      issue.at("forms", `Form id is defined as both local form and subscription: ${id}`);
    }
  }
}

export function validateForm(
  form: OnboardedFormConfig,
  attributes: AttributeRegistry,
  issue: WorkspaceIssue,
) {
  const fieldPaths = collectFormFieldPaths(form);

  for (const path of fieldPaths) {
    if (!path.startsWith("form.")) {
      issue.at(
        `forms.${form.id}.version.pages`,
        `Form field path must start with "form.": ${path}`,
      );
    }
  }

  for (const path of findDuplicates(fieldPaths)) {
    issue.at(`forms.${form.id}.version.pages`, `Duplicate form field path: ${path}`);
  }

  for (const path of form.references?.attributes ?? []) {
    if (!attributes.paths.has(path)) {
      issue.at(`forms.${form.id}.references.attributes`, `Unknown attribute path: ${path}`);
    }
  }

  const knownPaths = new Set([...attributes.paths.keys(), ...fieldPaths, ...allowedTaskPaths]);
  for (const fact of collectFormRuleFacts(form)) {
    if (!knownPaths.has(fact)) {
      issue.at(`forms.${form.id}.version.pages`, `Unknown form rule fact path: ${fact}`);
    }
  }
}

export function collectFormFieldPaths(form: OnboardedFormConfig): readonly string[] {
  return form.version.pages.flatMap((page) => collectFieldPaths(page.fields));
}

function collectFieldPaths(fields: readonly FormField[]): readonly string[] {
  return fields.flatMap((field) => [
    field.path,
    ...(field.subfields ? collectFieldPaths(field.subfields) : []),
  ]);
}

function collectFormRuleFacts(form: OnboardedFormConfig): readonly string[] {
  return form.version.pages.flatMap((page) =>
    page.fields.flatMap((field) => collectFieldRuleFacts(field)),
  );
}

function collectFieldRuleFacts(field: FormField): readonly string[] {
  return [
    ...(field.rule
      ? collectRuleConditions(field.rule.conditions).map((condition) => condition.fact)
      : []),
    ...(field.subfields?.flatMap((subfield) => collectFieldRuleFacts(subfield)) ?? []),
  ];
}

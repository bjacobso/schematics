import { OnboardedAccountWorkspaceSchema } from "@schema-ide/examples";
import type {
  OnboardedAccountConfig,
  OnboardedAttributeCatalog,
  OnboardedAttributeDefinition,
  OnboardedAutomationConfig,
  OnboardedAutomationStep,
  OnboardedDocumentConfig,
  OnboardedFormConfig,
  OnboardedFormSubscription,
  OnboardedImportManifest,
  OnboardedPdfAnnotationDocument,
  OnboardedPdfInspect,
  OnboardedPdfMappingConfig,
  OnboardedPolicyConfig,
} from "@schema-ide/examples";
import type { ReactNode } from "react";
import { WorkspacePreview, type SchemaIdePreviewComponentProps } from "@schema-ide/react";
import {
  EmptyLine,
  ExampleIcon,
  ExamplePreviewShell,
  InfoGrid,
  PillList,
  Section,
} from "../preview-ui";

type RuleCondition = {
  readonly fact: string;
  readonly path?: string | undefined;
  readonly operator: string;
  readonly value: unknown;
};
type Rule = RuleCondition | { readonly all: readonly Rule[] } | { readonly any: readonly Rule[] };
type FieldRule = {
  readonly effect: "SHOW" | "HIDE";
  readonly conditions: Rule;
} | null;
type FormField = {
  readonly path: string;
  readonly type: string;
  readonly required?: boolean | undefined;
  readonly rule?: FieldRule | undefined;
  readonly options?: unknown;
  readonly subfields?: readonly FormField[] | undefined;
};

export const onboardedAccountYamlPreviews = WorkspacePreview.make(OnboardedAccountWorkspaceSchema, [
  {
    id: "onboarded-account",
    schemaId: "account.yaml",
    label: "Account",
    component: AccountPreview,
  },
  {
    id: "onboarded-attributes",
    schemaId: "attributes.yaml",
    label: "Attributes",
    component: AttributesPreview,
  },
  {
    id: "onboarded-form",
    schemaId: "OnboardedForms",
    label: "Form",
    component: FormPreview,
  },
  {
    id: "onboarded-form-subscription",
    schemaId: "OnboardedFormSubscriptions",
    label: "Form Subscription",
    component: FormSubscriptionPreview,
  },
  {
    id: "onboarded-document",
    schemaId: "OnboardedDocuments",
    label: "Document",
    component: DocumentPreview,
  },
  {
    id: "onboarded-pdf-inspect",
    schemaId: "OnboardedPdfInspections",
    label: "PDF Inspect",
    component: PdfInspectPreview,
  },
  {
    id: "onboarded-pdf-annotations",
    schemaId: "OnboardedPdfAnnotations",
    label: "PDF Annotations",
    component: PdfAnnotationsPreview,
  },
  {
    id: "onboarded-pdf-mapping",
    schemaId: "OnboardedPdfMappings",
    label: "PDF Mapping",
    component: PdfMappingPreview,
  },
  {
    id: "onboarded-policy",
    schemaId: "OnboardedPolicies",
    label: "Policy",
    component: PolicyPreview,
  },
  {
    id: "onboarded-automation",
    schemaId: "OnboardedAutomations",
    label: "Automation",
    component: AutomationPreview,
  },
  {
    id: "onboarded-import",
    schemaId: "OnboardedImports",
    label: "Import",
    component: ImportPreview,
  },
]);

function AccountPreview(props: SchemaIdePreviewComponentProps<OnboardedAccountConfig>) {
  const account = props.value;
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="account" />}
      title={account?.name ?? account?.id ?? "Untitled account"}
      subtitle={account?.id}
      diagnostics={props.diagnostics.length}
    >
      <AccountPrimitive account={account} />
      <SourcePrimitive source={account?.source} />
      <DeployPrimitive deploy={account?.deploy} />
    </ExamplePreviewShell>
  );
}

function AttributesPreview(props: SchemaIdePreviewComponentProps<OnboardedAttributeCatalog>) {
  const catalog = props.value;
  const customPaths = flattenAttributeGroups(catalog?.custom, true);
  const systemPaths = flattenAttributeGroups(catalog?.system, false);

  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="attributes" />}
      title="Attribute Catalog"
      subtitle={props.file.path}
      diagnostics={props.diagnostics.length}
    >
      <InfoGrid
        items={[
          ["Custom paths", String(customPaths.length)],
          ["System paths", String(systemPaths.length)],
          ["Total", String(customPaths.length + systemPaths.length)],
        ]}
      />
      <AttributeGroupPrimitive title="Custom attributes" groups={catalog?.custom} custom />
      <AttributeGroupPrimitive title="System attributes" groups={catalog?.system} />
    </ExamplePreviewShell>
  );
}

function FormPreview(props: SchemaIdePreviewComponentProps<OnboardedFormConfig>) {
  const form = props.value;
  const fieldSummaries = form ? collectFieldSummaries(form.version.pages) : [];
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="form" />}
      title={form?.name ?? form?.id ?? "Untitled form"}
      subtitle={form?.id}
      diagnostics={props.diagnostics.length}
    >
      <FormPrimitive form={form} fieldCount={fieldSummaries.length} />
      <SourcePrimitive source={form?.source} />
      <PillList
        title="Referenced attributes"
        values={form?.references?.attributes ?? []}
        empty="No attribute references declared"
      />
      <FormVersionPrimitive form={form} />
    </ExamplePreviewShell>
  );
}

function FormSubscriptionPreview(props: SchemaIdePreviewComponentProps<OnboardedFormSubscription>) {
  const subscription = props.value;
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="library" />}
      title={subscription?.name ?? subscription?.id ?? "Untitled subscription"}
      subtitle={subscription?.id}
      diagnostics={props.diagnostics.length}
    >
      <FormSubscriptionPrimitive subscription={subscription} />
      <SourcePrimitive source={subscription?.source} />
      <LibraryFormPrimitive subscription={subscription} />
      <DeployPrimitive deploy={subscription?.deploy} />
      <SubscriptionOverridesPrimitive subscription={subscription} />
    </ExamplePreviewShell>
  );
}

function DocumentPreview(props: SchemaIdePreviewComponentProps<OnboardedDocumentConfig>) {
  const document = props.value;
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="document" />}
      title={document?.name ?? document?.id ?? "Untitled document"}
      subtitle={props.file.path}
      diagnostics={props.diagnostics.length}
    >
      <DocumentPrimitive document={document} />
      <SourcePrimitive source={document?.source} />
      <GeneratedDocumentPrimitive document={document} />
    </ExamplePreviewShell>
  );
}

function PdfInspectPreview(props: SchemaIdePreviewComponentProps<OnboardedPdfInspect>) {
  const inspect = props.value;
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="pdf" />}
      title="PDF Inspect"
      subtitle={props.file.path}
      diagnostics={props.diagnostics.length}
    >
      <PdfInspectPrimitive inspect={inspect} />
      <PdfFieldsPrimitive fields={inspect?.fields ?? []} />
    </ExamplePreviewShell>
  );
}

function PdfAnnotationsPreview(
  props: SchemaIdePreviewComponentProps<OnboardedPdfAnnotationDocument>,
) {
  const annotations = props.value;
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="ann" />}
      title={annotations?.formName ?? "PDF Annotations"}
      subtitle={props.file.path}
      diagnostics={props.diagnostics.length}
    >
      <PdfAnnotationsPrimitive annotations={annotations} />
    </ExamplePreviewShell>
  );
}

function PdfMappingPreview(props: SchemaIdePreviewComponentProps<OnboardedPdfMappingConfig>) {
  const mapping = props.value;
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="map" />}
      title={mapping?.id ?? "PDF Mapping"}
      subtitle={mapping ? `${mapping.form} -> ${mapping.document}` : props.file.path}
      diagnostics={props.diagnostics.length}
    >
      <PdfMappingPrimitive mapping={mapping} />
      <PdfMappingEntriesPrimitive mappings={mapping?.mappings ?? []} />
    </ExamplePreviewShell>
  );
}

function PolicyPreview(props: SchemaIdePreviewComponentProps<OnboardedPolicyConfig>) {
  const policy = props.value;
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="policy" />}
      title={policy?.name ?? policy?.id ?? "Untitled policy"}
      subtitle={policy?.description ?? policy?.id}
      diagnostics={props.diagnostics.length}
    >
      <PolicyPrimitive policy={policy} />
      <RulePrimitive title="Policy rule" rule={policy?.when as Rule | undefined} />
      <PolicyRequirementsPrimitive policy={policy} />
    </ExamplePreviewShell>
  );
}

function AutomationPreview(props: SchemaIdePreviewComponentProps<OnboardedAutomationConfig>) {
  const automation = props.value;
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="automation" />}
      title={automation?.name ?? automation?.id ?? "Untitled automation"}
      subtitle={automation?.id}
      diagnostics={props.diagnostics.length}
    >
      <AutomationPrimitive automation={automation} />
      <AutomationTriggerPrimitive automation={automation} />
      <RulePrimitive title="Automation conditions" rule={automation?.when as Rule | undefined} />
      <AutomationStepsPrimitive steps={automation?.steps ?? []} />
    </ExamplePreviewShell>
  );
}

function ImportPreview(props: SchemaIdePreviewComponentProps<OnboardedImportManifest>) {
  const manifest = props.value;
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="import" />}
      title={manifest?.source ?? "Untitled import"}
      subtitle={manifest?.customer}
      diagnostics={props.diagnostics.length}
    >
      <ImportManifestPrimitive manifest={manifest} filePath={props.file.path} />
      <ImportArtifactsPrimitive forms={manifest?.forms ?? []} />
    </ExamplePreviewShell>
  );
}

function AccountPrimitive({ account }: { readonly account: OnboardedAccountConfig | undefined }) {
  return (
    <PrimitiveCard label="Account" title={account?.id ?? "No account id"}>
      <InfoGrid
        items={[
          ["Name", account?.name ?? "Not set"],
          ["Mode", account?.mode ?? "Not set"],
          ["Timezone", account?.timezone ?? "Not set"],
          ["Language", account?.language ?? "Not set"],
        ]}
      />
    </PrimitiveCard>
  );
}

function SourcePrimitive({
  source,
}: {
  readonly source: Readonly<Record<string, unknown>> | undefined;
}) {
  return (
    <PrimitiveCard label="Source" title={source ? "Provenance" : "No source block"}>
      {source ? (
        <KeyValueGrid value={source} />
      ) : (
        <EmptyLine>No source metadata configured</EmptyLine>
      )}
    </PrimitiveCard>
  );
}

function DeployPrimitive({
  deploy,
}: {
  readonly deploy: Readonly<Record<string, unknown>> | undefined;
}) {
  return (
    <PrimitiveCard label="Deploy" title={deploy ? "Deploy intent" : "No deploy block"}>
      {deploy ? (
        <KeyValueGrid value={deploy} />
      ) : (
        <EmptyLine>No deploy defaults configured</EmptyLine>
      )}
    </PrimitiveCard>
  );
}

function AttributeGroupPrimitive({
  title,
  groups,
  custom = false,
}: {
  readonly title: string;
  readonly groups: Partial<Record<string, readonly OnboardedAttributeDefinition[]>> | undefined;
  readonly custom?: boolean | undefined;
}) {
  const entries = Object.entries(groups ?? {});
  return (
    <PrimitiveCard label="Attributes" title={title}>
      {entries.length ? (
        <div className="grid gap-3">
          {entries.map(([entity, attributes]) => (
            <div key={entity} className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">{entity}</div>
              <div className="grid gap-2 md:grid-cols-2">
                {(attributes ?? []).map((attribute) => (
                  <AttributePrimitive
                    key={`${entity}:${attribute.key}`}
                    entity={entity}
                    attribute={attribute}
                    custom={custom}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyLine>No attributes configured</EmptyLine>
      )}
    </PrimitiveCard>
  );
}

function AttributePrimitive({
  entity,
  attribute,
  custom,
}: {
  readonly entity: string;
  readonly attribute: OnboardedAttributeDefinition;
  readonly custom: boolean;
}) {
  const path = custom
    ? `${entity}.custom_attributes.${attribute.key}`
    : `${entity}.${attribute.key}`;

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="font-mono text-xs font-medium">{path}</div>
      <div className="mt-1 text-sm">{attribute.label}</div>
      <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase text-muted-foreground">
        <span>{attribute.type}</span>
        <span>{attribute.status ?? "active"}</span>
        {attribute.required ? <span>required</span> : null}
        {attribute.sensitive ? <span>sensitive</span> : null}
      </div>
    </div>
  );
}

function FormPrimitive({
  form,
  fieldCount,
}: {
  readonly form: OnboardedFormConfig | undefined;
  readonly fieldCount: number;
}) {
  return (
    <PrimitiveCard label="Form" title={form?.id ?? "No form id"}>
      <InfoGrid
        items={[
          ["Name", form?.name ?? "Not set"],
          ["Status", form?.status ?? "Not set"],
          ["Owner", form?.owner ?? "account"],
          ["Pages", String(form?.version.pages.length ?? 0)],
          ["Fields", String(fieldCount)],
          ["Version name", form?.version.name ?? "Not set"],
        ]}
      />
    </PrimitiveCard>
  );
}

function FormVersionPrimitive({ form }: { readonly form: OnboardedFormConfig | undefined }) {
  return (
    <PrimitiveCard label="Form Version Export" title={form?.version.name ?? "No version"}>
      {form?.version.pages.length ? (
        <div className="grid gap-3">
          {form.version.pages.map((page, index) => (
            <FormPagePrimitive key={index} index={index} page={page} />
          ))}
        </div>
      ) : (
        <EmptyLine>No pages configured</EmptyLine>
      )}
    </PrimitiveCard>
  );
}

function FormPagePrimitive({
  index,
  page,
}: {
  readonly index: number;
  readonly page: OnboardedFormConfig["version"]["pages"][number];
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Page {index + 1}</div>
          <div className="text-sm font-medium">{page.description ?? "Untitled page"}</div>
        </div>
        <div className="text-xs text-muted-foreground">{page.assignee}</div>
      </div>
      <div className="mt-3 grid gap-2">
        {page.fields.map((field) => (
          <FormFieldPrimitive key={field.path} field={field as FormField} />
        ))}
      </div>
    </div>
  );
}

function FormFieldPrimitive({
  field,
  depth = 0,
}: {
  readonly field: FormField;
  readonly depth?: number | undefined;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-3" style={{ marginLeft: depth * 16 }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-medium">{field.path}</span>
        <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
          {field.type}
        </span>
        {field.required ? (
          <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
            required
          </span>
        ) : null}
      </div>
      {field.rule ? <FieldRulePrimitive rule={field.rule} /> : null}
      {field.subfields?.length ? (
        <div className="mt-2 grid gap-2">
          {field.subfields.map((subfield) => (
            <FormFieldPrimitive key={subfield.path} field={subfield} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FieldRulePrimitive({ rule }: { readonly rule: Exclude<FieldRule, null> }) {
  return (
    <div className="mt-2 rounded-md border bg-background p-2">
      <div className="mb-2 text-[10px] uppercase text-muted-foreground">
        Field rule effect: {rule.effect}
      </div>
      <RuleTree rule={rule.conditions} />
    </div>
  );
}

function FormSubscriptionPrimitive({
  subscription,
}: {
  readonly subscription: OnboardedFormSubscription | undefined;
}) {
  return (
    <PrimitiveCard label="Form Subscription" title={subscription?.id ?? "No subscription id"}>
      <InfoGrid
        items={[
          ["Name", subscription?.name ?? "Not set"],
          ["Status", subscription?.status ?? "Not set"],
          ["Mode", subscription?.subscription.mode ?? "Not set"],
          ["Auto update", subscription?.subscription.autoUpdate ? "Yes" : "No"],
        ]}
      />
    </PrimitiveCard>
  );
}

function LibraryFormPrimitive({
  subscription,
}: {
  readonly subscription: OnboardedFormSubscription | undefined;
}) {
  return (
    <PrimitiveCard
      label="Library Form"
      title={subscription?.libraryForm.externalId ?? "No external id"}
    >
      <InfoGrid
        items={[
          ["External ID", subscription?.libraryForm.externalId ?? "Not set"],
          ["Canonical path", subscription?.libraryForm.canonicalPath ?? "Not set"],
          ["Slug", subscription?.source.slug ?? "Not set"],
          ["Version", subscription?.source.version ?? "Not set"],
        ]}
      />
    </PrimitiveCard>
  );
}

function SubscriptionOverridesPrimitive({
  subscription,
}: {
  readonly subscription: OnboardedFormSubscription | undefined;
}) {
  return (
    <PrimitiveCard label="Overrides" title="Account-level overrides">
      {subscription?.overrides ? (
        <KeyValueGrid value={subscription.overrides} />
      ) : (
        <EmptyLine>No overrides configured</EmptyLine>
      )}
    </PrimitiveCard>
  );
}

function DocumentPrimitive({
  document,
}: {
  readonly document: OnboardedDocumentConfig | undefined;
}) {
  return (
    <PrimitiveCard label="Document" title={document?.id ?? "No document id"}>
      <InfoGrid
        items={[
          ["Name", document?.name ?? "Not set"],
          ["Kind", document?.kind ?? "Not set"],
          ["File", document?.file ?? "Not set"],
          ["Generated files", String(Object.keys(document?.generated ?? {}).length)],
        ]}
      />
    </PrimitiveCard>
  );
}

function GeneratedDocumentPrimitive({
  document,
}: {
  readonly document: OnboardedDocumentConfig | undefined;
}) {
  return (
    <PrimitiveCard label="Generated" title="Colocated tool output">
      <KeyValueGrid
        value={{
          inspect: document?.generated?.inspect,
          annotations: document?.generated?.annotations,
          screenshots: document?.generated?.screenshots?.length,
        }}
      />
    </PrimitiveCard>
  );
}

function PdfInspectPrimitive({ inspect }: { readonly inspect: OnboardedPdfInspect | undefined }) {
  return (
    <PrimitiveCard label="PDF Inspect" title="Generated metadata">
      <InfoGrid
        items={[
          ["Pages", String(inspect?.pageCount ?? 0)],
          ["Fields", String(inspect?.fields?.length ?? 0)],
          ["Encoding", inspect?.encoding ?? "Not set"],
          ["Header", inspect?.headerVersion ?? "Not set"],
          ["Byte length", String(inspect?.byteLength ?? "Not set")],
          ["Has XFA", inspect?.hasXFA ? "Yes" : "No"],
        ]}
      />
    </PrimitiveCard>
  );
}

function PdfFieldsPrimitive({
  fields,
}: {
  readonly fields: NonNullable<OnboardedPdfInspect["fields"]>;
}) {
  return (
    <PrimitiveCard label="PDF Fields" title="AcroForm fields">
      {fields.length ? (
        <div className="grid gap-2">
          {fields.map((field) => (
            <div key={field.name} className="rounded-lg border bg-background p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-medium">{field.name}</span>
                <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {field.type}
                </span>
              </div>
              <KeyValueGrid
                value={{
                  required: field.required,
                  readOnly: field.readOnly,
                  widgets: field.widgets?.length,
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        <EmptyLine>No PDF fields detected</EmptyLine>
      )}
    </PrimitiveCard>
  );
}

function PdfAnnotationsPrimitive({
  annotations,
}: {
  readonly annotations: OnboardedPdfAnnotationDocument | undefined;
}) {
  return (
    <PrimitiveCard label="Annotations" title={annotations?.formName ?? "Generated annotations"}>
      {annotations?.pages.length ? (
        <div className="grid gap-2">
          {annotations.pages.map((page) => (
            <div key={page.page} className="rounded-lg border bg-background p-3">
              <div className="text-sm font-medium">Page {page.page}</div>
              <div className="mt-3 grid gap-2">
                {page.annotations.map((annotation) => (
                  <div key={annotation.id} className="rounded-md border bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-medium">{annotation.id}</span>
                      <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                        {annotation.type}
                      </span>
                    </div>
                    <KeyValueGrid
                      value={{
                        label: annotation.label,
                        required: annotation.required,
                        bbox: annotation.bbox,
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyLine>No annotations configured</EmptyLine>
      )}
    </PrimitiveCard>
  );
}

function PdfMappingPrimitive({
  mapping,
}: {
  readonly mapping: OnboardedPdfMappingConfig | undefined;
}) {
  return (
    <PrimitiveCard label="PDF Mapping" title={mapping?.id ?? "No mapping id"}>
      <InfoGrid
        items={[
          ["Form", mapping?.form ?? "Not set"],
          ["Document", mapping?.document ?? "Not set"],
          ["Coordinate system", mapping?.coordinateSystem ?? "Not set"],
          ["Mappings", String(mapping?.mappings.length ?? 0)],
        ]}
      />
    </PrimitiveCard>
  );
}

function PdfMappingEntriesPrimitive({
  mappings,
}: {
  readonly mappings: readonly OnboardedPdfMappingConfig["mappings"][number][];
}) {
  return (
    <PrimitiveCard label="Mapping Entries" title="Form fields to PDF targets">
      {mappings.length ? (
        <div className="grid gap-2">
          {mappings.map((mapping, index) => (
            <div
              key={`${mapping.formField}:${index}`}
              className="rounded-lg border bg-background p-3"
            >
              <div className="font-mono text-xs font-medium">{mapping.formField}</div>
              <KeyValueGrid
                value={{
                  pdfField: mapping.pdfField,
                  annotationId: mapping.annotationId,
                  direction: mapping.direction,
                  transform: mapping.transform,
                  annotation: mapping.annotation,
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        <EmptyLine>No PDF mappings configured</EmptyLine>
      )}
    </PrimitiveCard>
  );
}

function PolicyPrimitive({ policy }: { readonly policy: OnboardedPolicyConfig | undefined }) {
  return (
    <PrimitiveCard label="Policy" title={policy?.id ?? "No policy id"}>
      <InfoGrid
        items={[
          ["Name", policy?.name ?? "Not set"],
          ["Status", policy?.status ?? "Not set"],
          ["Applies to", policy?.appliesTo ?? "Not set"],
          ["Required forms", String(policy?.requires.forms.length ?? 0)],
        ]}
      />
    </PrimitiveCard>
  );
}

function RulePrimitive({
  title,
  rule,
}: {
  readonly title: string;
  readonly rule: Rule | undefined;
}) {
  return (
    <PrimitiveCard label="Rule" title={title}>
      {rule ? <RuleTree rule={rule} /> : <EmptyLine>No rule configured</EmptyLine>}
    </PrimitiveCard>
  );
}

function RuleTree({ rule }: { readonly rule: Rule }) {
  if ("all" in rule) {
    return <RuleGroup operator="all" rules={rule.all} />;
  }
  if ("any" in rule) {
    return <RuleGroup operator="any" rules={rule.any} />;
  }
  return <RuleConditionPrimitive condition={rule} />;
}

function RuleGroup({
  operator,
  rules,
}: {
  readonly operator: string;
  readonly rules: readonly Rule[];
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="mb-2 text-[10px] uppercase text-muted-foreground">{operator}</div>
      <div className="grid gap-2">
        {rules.map((rule, index) => (
          <RuleTree key={index} rule={rule} />
        ))}
      </div>
    </div>
  );
}

function RuleConditionPrimitive({ condition }: { readonly condition: RuleCondition }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="font-mono text-xs font-medium">{condition.fact}</div>
      <div className="mt-2 grid gap-2 text-xs md:grid-cols-3">
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">Operator</div>
          <div>{condition.operator}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">Path</div>
          <div>{condition.path ?? "none"}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">Value</div>
          <div>{formatValue(condition.value)}</div>
        </div>
      </div>
    </div>
  );
}

function PolicyRequirementsPrimitive({
  policy,
}: {
  readonly policy: OnboardedPolicyConfig | undefined;
}) {
  return (
    <PrimitiveCard label="Policy Forms" title="Required forms">
      {policy?.requires.forms.length ? (
        <div className="grid gap-2">
          {policy.requires.forms.map((requirement) => (
            <div key={requirement.form} className="rounded-lg border bg-background p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-medium">{requirement.form}</span>
                <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {requirement.required === false ? "optional" : "required"}
                </span>
              </div>
              {requirement.when ? (
                <div className="mt-3">
                  <RuleTree rule={requirement.when as Rule} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <EmptyLine>No forms required</EmptyLine>
      )}
    </PrimitiveCard>
  );
}

function AutomationPrimitive({
  automation,
}: {
  readonly automation: OnboardedAutomationConfig | undefined;
}) {
  return (
    <PrimitiveCard label="Automation" title={automation?.id ?? "No automation id"}>
      <InfoGrid
        items={[
          ["Name", automation?.name ?? "Not set"],
          ["Status", automation?.status ?? "Not set"],
          ["Steps", String(automation?.steps.length ?? 0)],
        ]}
      />
    </PrimitiveCard>
  );
}

function AutomationTriggerPrimitive({
  automation,
}: {
  readonly automation: OnboardedAutomationConfig | undefined;
}) {
  return (
    <PrimitiveCard label="Trigger" title="Automation trigger">
      <InfoGrid
        items={[
          ["Entity", automation?.trigger.entity ?? "Not set"],
          ["Event", automation?.trigger.on ?? "Not set"],
          ["Properties", String(automation?.trigger.properties?.length ?? 0)],
        ]}
      />
      <PillList
        title="Trigger properties"
        values={automation?.trigger.properties ?? []}
        empty="No trigger properties"
      />
    </PrimitiveCard>
  );
}

function AutomationStepsPrimitive({
  steps,
}: {
  readonly steps: readonly OnboardedAutomationStep[];
}) {
  return (
    <PrimitiveCard label="Automation Steps" title="Workflow steps">
      {steps.length ? (
        <div className="grid gap-2">
          {steps.map((step) => (
            <AutomationStepPrimitive key={step.id} step={step} />
          ))}
        </div>
      ) : (
        <EmptyLine>No steps configured</EmptyLine>
      )}
    </PrimitiveCard>
  );
}

function AutomationStepPrimitive({ step }: { readonly step: OnboardedAutomationStep }) {
  const details: Record<string, unknown> = {
    type: step.type,
    to: step.to,
    template: step.template,
    form: step.form,
    policy: step.policy,
  };

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-medium">{step.id}</span>
        <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
          {step.type}
        </span>
      </div>
      <KeyValueGrid value={details} />
      {step.until ? (
        <div className="mt-3 rounded-md border bg-muted/20 p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Wait until</div>
          <div className="mt-1 font-mono text-xs">{step.until.fact}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {step.until.offset.amount} {step.until.offset.unit}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ImportManifestPrimitive({
  manifest,
  filePath,
}: {
  readonly manifest: OnboardedImportManifest | undefined;
  readonly filePath: string;
}) {
  return (
    <PrimitiveCard label="Import Manifest" title={manifest?.source ?? "No source"}>
      <InfoGrid
        items={[
          ["Source", manifest?.source ?? "Not set"],
          ["Customer", manifest?.customer ?? "Not set"],
          ["Forms", String(manifest?.forms?.length ?? 0)],
          ["File", filePath],
        ]}
      />
    </PrimitiveCard>
  );
}

function ImportArtifactsPrimitive({
  forms,
}: {
  readonly forms: NonNullable<OnboardedImportManifest["forms"]>;
}) {
  return (
    <PrimitiveCard label="Import Artifacts" title="Generated form artifacts">
      {forms.length ? (
        <div className="grid gap-2">
          {forms.map((form) => (
            <div key={form.workspaceForm} className="rounded-lg border bg-background p-3">
              <div className="flex items-center gap-2">
                <ExampleIcon label="source" />
                <span className="font-mono text-xs font-medium">{form.workspaceForm}</span>
              </div>
              <KeyValueGrid
                value={{
                  sourceFormId: form.sourceFormId,
                  sourceHtml: form.sourceHtml,
                  generatedFormYaml: form.generatedFormYaml,
                  generatedPdf: form.generatedPdf,
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        <EmptyLine>No imported forms</EmptyLine>
      )}
    </PrimitiveCard>
  );
}

function PrimitiveCard({
  label,
  title,
  children,
}: {
  readonly label: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <Section title={label}>
      <div className="grid gap-3 rounded-lg border bg-muted/20 p-3">
        <div className="text-sm font-medium">{title}</div>
        {children}
      </div>
    </Section>
  );
}

function KeyValueGrid({ value }: { readonly value: Readonly<Record<string, unknown>> }) {
  const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);

  return entries.length ? (
    <div className="mt-2 grid gap-2 md:grid-cols-2">
      {entries.map(([key, entryValue]) => (
        <div key={key} className="rounded-md border bg-background p-2">
          <div className="text-[10px] uppercase text-muted-foreground">{key}</div>
          <div className="mt-1 break-words text-xs">{formatValue(entryValue)}</div>
        </div>
      ))}
    </div>
  ) : (
    <EmptyLine>No values configured</EmptyLine>
  );
}

function collectFieldSummaries(
  pages: readonly OnboardedFormConfig["version"]["pages"][number][],
): readonly string[] {
  return pages.flatMap((page) => collectFieldPaths(page.fields as readonly FormField[]));
}

function collectFieldPaths(fields: readonly FormField[]): readonly string[] {
  return fields.flatMap((field) => [
    field.path,
    ...(field.subfields ? collectFieldPaths(field.subfields) : []),
  ]);
}

function flattenAttributeGroups(
  groups: Partial<Record<string, readonly { readonly key: string }[]>> | undefined,
  custom: boolean,
): readonly string[] {
  return Object.entries(groups ?? {}).flatMap(([entity, attributes]) =>
    (attributes ?? []).map((attribute) =>
      custom ? `${entity}.custom_attributes.${attribute.key}` : `${entity}.${attribute.key}`,
    ),
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (value === undefined) return "not set";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

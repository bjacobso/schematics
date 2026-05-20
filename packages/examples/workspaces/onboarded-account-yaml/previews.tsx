import type {
  OnboardedAccountConfig,
  OnboardedAttributeCatalog,
  OnboardedAutomationConfig,
  OnboardedFormConfig,
  OnboardedFormSubscription,
  OnboardedImportManifest,
  OnboardedPolicyConfig,
} from "@schema-ide/examples";
import type {
  SchemaIdePreviewComponentProps,
  SchemaIdePreviewRegistration,
} from "@schema-ide/react";
import {
  EmptyLine,
  ExampleIcon,
  ExamplePreviewShell,
  InfoGrid,
  PillList,
  Section,
} from "../preview-ui";

export const onboardedAccountYamlPreviews = [
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
] satisfies readonly SchemaIdePreviewRegistration[];

function AccountPreview(props: SchemaIdePreviewComponentProps<OnboardedAccountConfig>) {
  const account = props.value;
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="account" />}
      title={account?.name ?? account?.id ?? "Untitled account"}
      subtitle={account?.id}
      diagnostics={props.diagnostics.length}
    >
      <InfoGrid
        items={[
          ["Mode", account?.mode ?? "Not set"],
          ["Timezone", account?.timezone ?? "Not set"],
          ["Deploy target", account?.deploy?.defaultTarget ?? "Not set"],
        ]}
      />
      <InfoGrid
        items={[
          ["Language", account?.language ?? "Not set"],
          ["Source", account?.source?.system ?? "Not set"],
          ["Customer", account?.source?.customer ?? "Not set"],
        ]}
      />
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
      <PillList title="Custom attributes" values={customPaths} empty="No custom attributes" />
      <PillList title="System attributes" values={systemPaths} empty="No system attributes" />
    </ExamplePreviewShell>
  );
}

function FormPreview(props: SchemaIdePreviewComponentProps<OnboardedFormConfig>) {
  const form = props.value;
  const fields =
    form?.version.pages.flatMap((page) => page.fields.map((field) => field.path)) ?? [];
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="form" />}
      title={form?.name ?? form?.id ?? "Untitled form"}
      subtitle={form?.id}
      diagnostics={props.diagnostics.length}
    >
      <InfoGrid
        items={[
          ["Status", form?.status ?? "Not set"],
          ["Pages", String(form?.version.pages.length ?? 0)],
          ["Fields", String(fields.length)],
        ]}
      />
      <PillList
        title="Referenced attributes"
        values={form?.references?.attributes ?? []}
        empty="No attribute references declared"
      />
      <PillList title="Field paths" values={fields} empty="No fields configured" />
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
      <InfoGrid
        items={[
          ["Registry", subscription?.source.registry ?? "Not set"],
          ["Version", subscription?.source.version ?? "Not set"],
          ["Mode", subscription?.subscription.mode ?? "Not set"],
        ]}
      />
      <InfoGrid
        items={[
          ["Auto update", subscription?.subscription.autoUpdate ? "Yes" : "No"],
          ["External ID", subscription?.libraryForm.externalId ?? "Not set"],
          ["Deploy target", subscription?.deploy?.target ?? "Not set"],
        ]}
      />
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
      <InfoGrid
        items={[
          ["Status", policy?.status ?? "Not set"],
          ["Applies to", policy?.appliesTo ?? "Not set"],
          ["Required forms", String(policy?.requires.forms.length ?? 0)],
        ]}
      />
      <PillList
        title="Required forms"
        values={policy?.requires.forms.map((form) => form.form) ?? []}
        empty="No forms required"
      />
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
      <InfoGrid
        items={[
          ["Status", automation?.status ?? "Not set"],
          [
            "Trigger",
            automation ? `${automation.trigger.entity}.${automation.trigger.on}` : "Not set",
          ],
          ["Steps", String(automation?.steps.length ?? 0)],
        ]}
      />
      <PillList
        title="Trigger properties"
        values={automation?.trigger.properties ?? []}
        empty="No trigger properties"
      />
      <PillList
        title="Steps"
        values={automation?.steps.map((step) => `${step.id}: ${step.type}`) ?? []}
        empty="No steps configured"
      />
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
      <InfoGrid
        items={[
          ["Customer", manifest?.customer ?? "Not set"],
          ["Forms", String(manifest?.forms?.length ?? 0)],
          ["File", props.file.path],
        ]}
      />
      <Section title="Imported forms">
        <div className="grid gap-2">
          {manifest?.forms?.length ? (
            manifest.forms.map((form) => (
              <div key={form.workspaceForm} className="rounded-lg border bg-background p-3">
                <div className="flex items-center gap-2">
                  <ExampleIcon label="source" />
                  <span className="font-mono text-xs font-medium">{form.workspaceForm}</span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Source form: {form.sourceFormId ?? "not set"}
                </div>
              </div>
            ))
          ) : (
            <EmptyLine>No imported forms</EmptyLine>
          )}
        </div>
      </Section>
    </ExamplePreviewShell>
  );
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

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { validateSchemaIdeValue } from "@schema-ide/core";
import {
  loadSchemaIdeWorkspaceConfig,
  readSourceFilesFromDirectory,
  validateWorkspaceDirectory,
} from "@schema-ide/cli";
import { createOnboardedConfigCli } from "../src/cli";
import {
  OnboardedAccountWorkspaceSchema,
  OnboardedArtifactProject,
  OnboardedArtifactProjectConfigDefinition,
  createOnboardedArtifactRuntime,
  createOnboardedArtifactRuntimeFromProjectConfig,
  parseOnboardedArtifactProjectConfig,
} from "../src/index";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = resolve(packageDir, "workspaces/onboarded-account-yaml/files");
const fixtureConfigPath = resolve(
  packageDir,
  "workspaces/onboarded-account-yaml/schema-ide.config.ts",
);
const fixtureArtifactProjectPath = resolve(
  packageDir,
  "workspaces/onboarded-account-yaml/artifact-project.yaml",
);

describe("onboarded-config", () => {
  it("validates the packaged sample workspace through the generic CLI config", async () => {
    const artifactProjectConfig = parseOnboardedArtifactProjectConfig(
      await readFile(fixtureArtifactProjectPath, "utf8"),
    );
    const workspace = await loadSchemaIdeWorkspaceConfig(fixtureConfigPath);
    const reflection = await validateWorkspaceDirectory({
      workspace,
      directory: fixtureDir,
    });

    expect(reflection.validationSummary.valid).toBe(true);
    expect(reflection.routeMatches.length).toBeGreaterThan(0);
    expect(workspace.id).toBe(artifactProjectConfig.id);
    expect(workspace.include).toEqual(artifactProjectConfig.include);
    expect(workspace.defaultFormat).toBe(artifactProjectConfig.defaultFormat);
    expect(workspace.artifactProject?.name).toBe(OnboardedArtifactProject.name);
    expect(workspace.artifactProject?.routes.map((route) => route.pattern)).toEqual(
      artifactProjectConfig.files.map((route) => route.pattern),
    );
  }, 45_000);

  it("validates the packaged sample workspace through the embedded CLI", async () => {
    const result = await createOnboardedConfigCli().run([
      "validate",
      "--dir",
      fixtureDir,
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).summary.valid).toBe(true);
  });

  it("bundles the same files that live on disk", async () => {
    const files = await readSourceFilesFromDirectory({
      directory: fixtureDir,
      include: ["**/*.yaml", "**/*.pdf", "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.webp"],
    });

    const result = validateSchemaIdeValue({
      schema: OnboardedAccountWorkspaceSchema,
      files,
      activeFile: files[0]?.path ?? null,
      activeFormat: "yaml",
    });

    expect(result.summary.valid).toBe(true);
    expect(result.routeMatches.length).toBeGreaterThan(0);
  });

  it("exposes the packaged sample workspace through onboarded artifact views", async () => {
    const files = await readSourceFilesFromDirectory({
      directory: fixtureDir,
      include: ["**/*.yaml", "**/*.pdf", "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.webp"],
    });
    const runtime = createOnboardedArtifactRuntime({ files });
    const workspaceRef = { _tag: "Workspace", workspaceId: "onboarded-account-yaml" } as const;

    await expect(
      Effect.runPromise(runtime.view(workspaceRef, "validationSummary")),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      Effect.runPromise(runtime.view(workspaceRef, "relationDiagnostics")),
    ).resolves.toEqual([]);
    await expect(
      Effect.runPromise(runtime.view(workspaceRef, "patchSuggestions")),
    ).resolves.toEqual([]);

    const graph = await Effect.runPromise(runtime.view(workspaceRef, "relationGraph"));
    expect(
      (graph as { definitions: readonly { type: string }[] }).definitions.length,
    ).toBeGreaterThan(0);
  });

  it("loads the packaged artifact project yaml as the onboarded runtime configuration", async () => {
    const config = parseOnboardedArtifactProjectConfig(
      await readFile(fixtureArtifactProjectPath, "utf8"),
    );
    const files = await readSourceFilesFromDirectory({
      directory: fixtureDir,
      include: config.include,
    });
    const runtime = createOnboardedArtifactRuntimeFromProjectConfig({ config, files });

    expect(config).toEqual(OnboardedArtifactProjectConfigDefinition);
    expect(config.files.map((route) => route.id)).toEqual([
      "account",
      "attributes",
      "forms",
      "formSubscriptions",
      "documents",
      "pdfInspections",
      "pdfAnnotations",
      "pdfMappings",
      "policies",
      "automations",
      "imports",
    ]);
    expect(
      OnboardedArtifactProject.routes.map((route) => ({
        id: route.id,
        pattern: route.pattern,
      })),
    ).toEqual(config.files.map(({ id, pattern }) => ({ id, pattern })));
    expect(runtime.project.routes.map((route) => route.id)).toEqual(
      config.files.map((route) => route.id),
    );
    await expect(
      Effect.runPromise(runtime.view({ _tag: "Workspace", workspaceId: config.id }, "reflection")),
    ).resolves.toMatchObject({
      activeFormat: "yaml",
      validationSummary: { valid: true },
    });
  });

  it("validates onboarded account workspace references", () => {
    const result = validateSchemaIdeValue({
      schema: OnboardedAccountWorkspaceSchema,
      activeFile: "policies/broken.yaml",
      activeFormat: "yaml",
      files: [
        yamlFile("account.yaml", [
          "id: broken-account",
          "name: Broken Account",
          "mode: test",
          "timezone: America/Chicago",
          "language: en",
        ]),
        yamlFile("attributes.yaml", [
          "custom:",
          "  employee:",
          "    - key: badge_number",
          "      label: Badge Number",
          "      type: string",
        ]),
        yamlFile("forms/intake.yaml", [
          "id: intake",
          "name: Intake",
          "status: draft",
          "version:",
          "  name: Intake",
          "  description: null",
          "  pages:",
          "    - description: null",
          "      assignee: employee",
          "      fields:",
          "        - path: form.signature",
          "          type: signature",
          "          required: true",
        ]),
        yamlFile("policies/broken.yaml", [
          "id: broken-policy",
          "name: Broken Policy",
          "status: draft",
          "appliesTo: placement",
          "when:",
          "  all:",
          "    - fact: placement.branch_code",
          "      operator: equal",
          "      value: north-branch",
          "requires:",
          "  forms:",
          "    - form: missing-form",
        ]),
        yamlFile("automations/broken.yaml", [
          "id: broken-automation",
          "name: Broken Automation",
          "status: draft",
          "trigger:",
          "  entity: task",
          "  on: updated",
          "  properties:",
          "    - unsupported_property",
          "when:",
          "  all:",
          "    - fact: task.form",
          "      operator: equal",
          "      value: missing-form",
          "steps:",
          "  - id: wait",
          "    type: wait",
          "    until:",
          "      fact: employee.custom_attributes.missing",
          "      offset:",
          "        amount: 1",
          "        unit: day",
        ]),
      ],
    });

    expect(result.summary.valid).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        "Unknown rule fact path: placement.branch_code",
        "Unknown form: missing-form",
        "Unsupported trigger property for task: unsupported_property",
        "Unknown form in task.form rule: missing-form",
        "Unknown wait step fact path: employee.custom_attributes.missing",
      ]),
    );
  });

  it("validates onboarded PDF mappings against forms and generated PDF metadata", async () => {
    const files = [
      yamlFile("account.yaml", [
        "id: demo-account",
        "name: Demo Account",
        "mode: test",
        "timezone: America/Chicago",
        "language: en",
      ]),
      yamlFile("attributes.yaml", [
        "custom:",
        "  employee:",
        "    - key: badge_number",
        "      label: Badge Number",
        "      type: string",
      ]),
      yamlFile("forms/intake.yaml", [
        "id: intake",
        "name: Intake",
        "status: draft",
        "version:",
        "  name: Intake",
        "  description: null",
        "  pages:",
        "    - description: null",
        "      assignee: employee",
        "      fields:",
        "        - path: form.signature",
        "          type: signature",
        "          required: true",
      ]),
      yamlFile("policies/default.yaml", [
        "id: default-policy",
        "name: Default Policy",
        "status: draft",
        "appliesTo: employee",
        "when:",
        "  all:",
        "    - fact: employee.custom_attributes.badge_number",
        "      operator: exists",
        "      value: true",
        "requires:",
        "  forms:",
        "    - form: intake",
      ]),
      yamlFile("documents/client/document.yaml", [
        "id: client-pdf",
        "name: Client PDF",
        "kind: pdf",
        "file: client.pdf",
        "generated:",
        "  inspect: _generated/client.pdf.inspect.yaml",
        "  annotations: _generated/client.pdf.annotations.yaml",
      ]),
      {
        path: "documents/client/client.pdf",
        content: Buffer.from("%PDF-1.7\n%%EOF\n").toString("base64"),
      },
      yamlFile("documents/client/_generated/client.pdf.inspect.yaml", [
        "kind: pdf",
        "encoding: base64",
        "pageCount: 1",
        "pages:",
        "  - page: 1",
        "    width: 612",
        "    height: 792",
        "fields:",
        "  - name: signature",
        "    type: text",
      ]),
      yamlFile("documents/client/_generated/client.pdf.annotations.yaml", [
        "pages:",
        "  - page: 1",
        "    annotations:",
        "      - id: signature_box",
        "        type: signature",
        "        label: Signature",
        "        bbox:",
        "          x: 100",
        "          y: 100",
        "          width: 200",
        "          height: 24",
      ]),
      yamlFile("pdf-mappings/broken.yaml", [
        "id: broken-mapping",
        "form: intake",
        "document: client-pdf",
        "mappings:",
        "  - formField: form.missing",
        "    pdfField: missing_pdf",
        "    annotationId: missing_annotation",
      ]),
    ];
    const result = validateSchemaIdeValue({
      schema: OnboardedAccountWorkspaceSchema,
      activeFile: "pdf-mappings/broken.yaml",
      activeFormat: "yaml",
      files,
    });

    expect(result.summary.valid).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        "Unknown form field: form.missing",
        "Unknown PDF field: missing_pdf",
        "Unknown PDF annotation: missing_annotation",
      ]),
    );

    const runtime = createOnboardedArtifactRuntime({ files });
    const workspaceRef = { _tag: "Workspace", workspaceId: "onboarded-account-yaml" } as const;
    await expect(
      Effect.runPromise(runtime.view(workspaceRef, "relationDiagnostics")),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unresolved-ref",
          path: ["pdfMappings", "0", "mappings", "0", "formField"],
        }),
        expect.objectContaining({
          code: "unresolved-ref",
          path: ["pdfMappings", "0", "mappings", "0", "pdfField"],
        }),
        expect.objectContaining({
          code: "unresolved-ref",
          path: ["pdfMappings", "0", "mappings", "0", "annotationId"],
        }),
      ]),
    );
    await expect(
      Effect.runPromise(runtime.view(workspaceRef, "patchSuggestions")),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "create-definition",
          target: "FormField",
          id: "form.missing",
          scope: "intake",
        }),
        expect.objectContaining({
          kind: "create-definition",
          target: "PdfField",
          id: "missing_pdf",
          scope: "client-pdf",
        }),
        expect.objectContaining({
          kind: "create-definition",
          target: "PdfAnnotation",
          id: "missing_annotation",
          scope: "client-pdf",
        }),
      ]),
    );
  });
});

function yamlFile(path: string, lines: readonly string[]) {
  return {
    path,
    content: `${lines.join("\n")}\n`,
  };
}

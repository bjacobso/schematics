import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateSchemaIdeValue } from "@schema-ide/core";
import {
  loadSchemaIdeWorkspaceConfig,
  readSourceFilesFromDirectory,
  validateWorkspaceDirectory,
} from "@schema-ide/cli";
import {
  OnboardedAccountWorkspaceSchema,
  randomSchemaIdeExample,
  schemaIdeExampleDefinitions,
  schemaIdeExamples,
} from "../src";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("schema-ide-examples", () => {
  it("exports valid playground examples", () => {
    expect(schemaIdeExamples.length).toBeGreaterThan(0);
    expect(schemaIdeExampleDefinitions.map((definition) => definition.id)).toEqual(
      schemaIdeExamples.map((example) => example.id),
    );
    expect(randomSchemaIdeExample()).toBeDefined();

    for (const example of schemaIdeExamples) {
      const result = validateSchemaIdeValue({
        schema: example.schema,
        files: example.files,
        activeFile: example.files[0]?.path ?? null,
        activeFormat: example.defaultFormat ?? "json",
      });

      expect(result.routeMatches.length).toBeGreaterThan(0);
    }
  });

  it("bundles examples from the on-disk workspace files", async () => {
    for (const definition of schemaIdeExampleDefinitions) {
      const example = schemaIdeExamples.find((candidate) => candidate.id === definition.id);
      expect(example).toBeDefined();

      const files = await readSourceFilesFromDirectory({
        directory: resolve(packageDir, definition.filesPath),
      });

      expect(sortFiles(files)).toEqual(sortFiles(example?.files ?? []));
    }
  });

  it("keeps example CLI configs usable against the same source workspaces", async () => {
    for (const example of schemaIdeExamples) {
      const definition = schemaIdeExampleDefinitions.find(
        (candidate) => candidate.id === example.id,
      );
      expect(definition).toBeDefined();

      const workspace = await loadSchemaIdeWorkspaceConfig(
        resolve(packageDir, definition!.configPath),
      );
      const reflection = await validateWorkspaceDirectory({
        workspace,
        directory: resolve(packageDir, definition!.filesPath),
      });

      expect(sortFiles(reflection.files)).toEqual(sortFiles(example.files));
      expect(reflection.routeMatches.length).toBeGreaterThan(0);
    }
  });

  it("validates onboarded account workspace references", () => {
    const result = validateSchemaIdeValue({
      schema: OnboardedAccountWorkspaceSchema,
      activeFile: "policies/broken.yaml",
      activeFormat: "yaml",
      files: [
        {
          path: "account.yaml",
          content: [
            "id: broken-account",
            "name: Broken Account",
            "mode: test",
            "timezone: America/Chicago",
            "language: en",
            "",
          ].join("\n"),
        },
        {
          path: "attributes.yaml",
          content: [
            "custom:",
            "  employee:",
            "    - key: badge_number",
            "      label: Badge Number",
            "      type: string",
            "",
          ].join("\n"),
        },
        {
          path: "forms/intake.yaml",
          content: [
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
            "",
          ].join("\n"),
        },
        {
          path: "policies/broken.yaml",
          content: [
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
            "",
          ].join("\n"),
        },
        {
          path: "automations/broken.yaml",
          content: [
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
            "",
          ].join("\n"),
        },
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

  it("validates onboarded PDF mappings against forms and generated PDF metadata", () => {
    const result = validateSchemaIdeValue({
      schema: OnboardedAccountWorkspaceSchema,
      activeFile: "pdf-mappings/broken.yaml",
      activeFormat: "yaml",
      files: [
        {
          path: "account.yaml",
          content: [
            "id: demo-account",
            "name: Demo Account",
            "mode: test",
            "timezone: America/Chicago",
            "language: en",
            "",
          ].join("\n"),
        },
        {
          path: "attributes.yaml",
          content: [
            "custom:",
            "  employee:",
            "    - key: badge_number",
            "      label: Badge Number",
            "      type: string",
            "",
          ].join("\n"),
        },
        {
          path: "forms/intake.yaml",
          content: [
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
            "",
          ].join("\n"),
        },
        {
          path: "policies/default.yaml",
          content: [
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
            "",
          ].join("\n"),
        },
        {
          path: "documents/client/document.yaml",
          content: [
            "id: client-pdf",
            "name: Client PDF",
            "kind: pdf",
            "file: client.pdf",
            "generated:",
            "  inspect: _generated/client.pdf.inspect.yaml",
            "  annotations: _generated/client.pdf.annotations.yaml",
            "",
          ].join("\n"),
        },
        {
          path: "documents/client/client.pdf",
          content: Buffer.from("%PDF-1.7\n%%EOF\n").toString("base64"),
        },
        {
          path: "documents/client/_generated/client.pdf.inspect.yaml",
          content: [
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
            "",
          ].join("\n"),
        },
        {
          path: "documents/client/_generated/client.pdf.annotations.yaml",
          content: [
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
            "",
          ].join("\n"),
        },
        {
          path: "pdf-mappings/broken.yaml",
          content: [
            "id: broken-mapping",
            "form: intake",
            "document: client-pdf",
            "mappings:",
            "  - formField: form.missing",
            "    pdfField: missing_pdf",
            "    annotationId: missing_annotation",
            "",
          ].join("\n"),
        },
      ],
    });

    expect(result.summary.valid).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        "Unknown form field: form.missing",
        "Unknown PDF field: missing_pdf",
        "Unknown PDF annotation: missing_annotation",
      ]),
    );
  });
});

function sortFiles<T extends { readonly path: string }>(files: readonly T[]): readonly T[] {
  return [...files].sort((left, right) => left.path.localeCompare(right.path));
}

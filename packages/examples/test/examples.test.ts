import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@effect/vitest";
import { validateSchemaIdeValue } from "@schema-ide/core";
import {
  loadSchemaIdeWorkspaceConfig,
  readSourceFilesFromDirectory,
  runSchemaIdeCli,
  validateWorkspaceDirectory,
} from "@schema-ide/cli";
import { randomSchemaIdeExample, schemaIdeExampleDefinitions, schemaIdeExamples } from "../src";

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
      const workspace = await loadSchemaIdeWorkspaceConfig(
        resolve(packageDir, definition.configPath),
      );

      const files = await readSourceFilesFromDirectory({
        directory: resolve(packageDir, definition.filesPath),
        include: workspace.include,
        exclude: workspace.exclude,
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

  it("ships an artifact graph example for document conversion workflows", async () => {
    const definition = schemaIdeExampleDefinitions.find(
      (candidate) => candidate.id === "document-conversion",
    );
    expect(definition).toBeDefined();

    const schemaPath = resolve(packageDir, definition!.configPath);
    const directory = resolve(packageDir, definition!.filesPath);

    const statusResult = await runSchemaIdeCli([
      "status",
      "--schema",
      schemaPath,
      "--dir",
      directory,
      "--json",
    ]);
    const graphResult = await runSchemaIdeCli([
      "graph",
      "--schema",
      schemaPath,
      "--dir",
      directory,
      "--json",
    ]);

    expect(statusResult).toMatchObject({ exitCode: 0, stderr: "" });
    expect(graphResult).toMatchObject({ exitCode: 0, stderr: "" });

    const status = JSON.parse(statusResult.stdout) as {
      readonly artifacts: readonly {
        readonly id: string;
        readonly status: string;
        readonly matchCount: number;
      }[];
      readonly tools: readonly {
        readonly id: string;
        readonly availability: string;
        readonly missingInputs: readonly string[];
      }[];
    };
    const graph = JSON.parse(graphResult.stdout) as {
      readonly edges: readonly {
        readonly from: string;
        readonly to: string;
        readonly kind: string;
      }[];
    };

    expect(status.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "source-html", status: "present", matchCount: 1 }),
        expect.objectContaining({ id: "screenshots", status: "missing", matchCount: 0 }),
        expect.objectContaining({ id: "markdown", status: "present", matchCount: 1 }),
        expect.objectContaining({ id: "pdf", status: "present", matchCount: 1 }),
        expect.objectContaining({ id: "pdf-fields", status: "present", matchCount: 1 }),
      ]),
    );
    expect(status.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "render-html-screenshots", availability: "runnable" }),
        expect.objectContaining({
          id: "extract-markdown",
          availability: "blocked",
          missingInputs: ["screenshots"],
        }),
        expect.objectContaining({ id: "render-pdf", availability: "runnable" }),
        expect.objectContaining({ id: "inspect-pdf-fields", availability: "runnable" }),
      ]),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { from: "source-html", to: "render-html-screenshots", kind: "consumes" },
        { from: "render-html-screenshots", to: "screenshots", kind: "produces" },
        { from: "screenshots", to: "extract-markdown", kind: "consumes" },
        { from: "extract-markdown", to: "markdown", kind: "produces" },
        { from: "source-html", to: "render-pdf", kind: "consumes" },
        { from: "render-pdf", to: "pdf", kind: "produces" },
        { from: "pdf", to: "inspect-pdf-fields", kind: "consumes" },
        { from: "inspect-pdf-fields", to: "pdf-fields", kind: "produces" },
      ]),
    );
  });
});

function sortFiles<T extends { readonly path: string }>(files: readonly T[]): readonly T[] {
  return [...files].sort((left, right) => left.path.localeCompare(right.path));
}

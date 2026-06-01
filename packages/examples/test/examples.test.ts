import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { ArtifactRef } from "@schema-ide/artifacts";
import { Artifacts } from "@schema-ide/core";
import {
  loadSchemaIdeProjectConfig,
  readSourceFilesFromDirectory,
  validateProjectDirectory,
} from "@schema-ide/cli";
import {
  SurveyArtifactProject,
  WorkflowArtifactProject,
  randomSchemaIdeExample,
  schemaIdeExampleDefinitions,
  schemaIdeExamples,
} from "../src";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("schema-ide-examples", () => {
  it("exports valid playground examples", async () => {
    expect(schemaIdeExamples.length).toBeGreaterThan(0);
    expect(schemaIdeExampleDefinitions.map((definition) => definition.id)).toEqual(
      schemaIdeExamples.map((example) => example.id),
    );
    expect(randomSchemaIdeExample()).toBeDefined();

    for (const example of schemaIdeExamples) {
      const reflection = await Effect.runPromise(
        Artifacts.validate({
          schema: example.schema,
          project: example.project,
          files: example.files,
          activeFile: example.files[0]?.path ?? null,
          activeFormat: example.defaultFormat ?? "json",
          workspaceId: example.id,
        }),
      );

      expect(reflection.routeMatches.length).toBeGreaterThan(0);
    }
  });

  it("bundles examples from the on-disk project files", async () => {
    for (const definition of schemaIdeExampleDefinitions) {
      const example = schemaIdeExamples.find((candidate) => candidate.id === definition.id);
      expect(example).toBeDefined();

      const files = await readSourceFilesFromDirectory({
        directory: resolve(packageDir, definition.filesPath),
      });

      expect(sortFiles(files)).toEqual(sortFiles(example?.files ?? []));
    }
  });

  it("keeps example CLI configs usable against the same source projects", async () => {
    for (const example of schemaIdeExamples) {
      const definition = schemaIdeExampleDefinitions.find(
        (candidate) => candidate.id === example.id,
      );
      expect(definition).toBeDefined();

      const projectConfig = await loadSchemaIdeProjectConfig(
        resolve(packageDir, definition!.configPath),
      );
      const reflection = await validateProjectDirectory({
        project: projectConfig,
        directory: resolve(packageDir, definition!.filesPath),
      });

      expect(sortFiles(reflection.files)).toEqual(sortFiles(example.files));
      expect(reflection.routeMatches.length).toBeGreaterThan(0);
    }
  }, 45_000);

  it("authors first-party CLI configs as artifact projects", async () => {
    for (const definition of schemaIdeExampleDefinitions) {
      const configPath = resolve(packageDir, definition.configPath);
      const source = await readFile(configPath, "utf8");
      const projectConfig = await loadSchemaIdeProjectConfig(configPath);

      expect(source).toContain("defineSchemaIdeProject");
      expect(source).not.toContain("defineSchemaIdeWorkspace");
      expect(source).not.toMatch(/^\s*schema\s*:/m);
      expect(projectConfig.artifactProject?.name).toBe(definition.project.name);
      expect(projectConfig.schema.reflect().map((schema) => schema.id)).toEqual(
        definition.project.routes.map((route) => route.id),
      );
    }
  });

  it("ships an artifact-native project for the workflow example", async () => {
    const actionRef = ArtifactRef.workspaceFile("actions/email.json", "workflow-json");
    const workflowRef = ArtifactRef.workspaceFile("workflows/onboarding.json", "workflow-json");
    const config = await loadSchemaIdeProjectConfig(
      resolve(packageDir, "projects/workflow-json/schema-ide.config.ts"),
    );

    expect(WorkflowArtifactProject.routes.map((route) => route.id)).toEqual([
      "Actions",
      "Workflows",
    ]);
    expect(
      WorkflowArtifactProject.capabilities(actionRef).map((capability) => ({
        id: capability.id,
        routeId: capability.routeId,
        view: capability.view,
      })),
    ).toEqual([
      {
        id: "Actions.decodedValue",
        routeId: "Actions",
        view: "decodedValue",
      },
    ]);
    expect(
      WorkflowArtifactProject.capabilities(workflowRef).map((capability) => capability.routeId),
    ).toEqual(["Workflows"]);
    expect(config.artifactProject?.name).toBe("workflow-json");
    expect(
      config.artifactProject?.capabilities(actionRef).map((capability) => capability.id),
    ).toEqual(["Actions.decodedValue"]);
  });

  it("ships an artifact-native project for the survey example", async () => {
    const questionRef = ArtifactRef.workspaceFile("questions/email.yaml", "survey-yaml");
    const surveyRef = ArtifactRef.workspaceFile("surveys/intake.yaml", "survey-yaml");
    const config = await loadSchemaIdeProjectConfig(
      resolve(packageDir, "projects/survey-yaml/schema-ide.config.ts"),
    );

    expect(SurveyArtifactProject.routes.map((route) => route.id)).toEqual(["Questions", "Surveys"]);
    expect(
      SurveyArtifactProject.capabilities(questionRef).map((capability) => ({
        id: capability.id,
        routeId: capability.routeId,
        view: capability.view,
      })),
    ).toEqual([
      {
        id: "Questions.decodedValue",
        routeId: "Questions",
        view: "decodedValue",
      },
    ]);
    expect(
      SurveyArtifactProject.capabilities(surveyRef).map((capability) => capability.routeId),
    ).toEqual(["Surveys"]);
    expect(config.artifactProject?.name).toBe("survey-yaml");
    expect(
      config.artifactProject?.capabilities(questionRef).map((capability) => capability.id),
    ).toEqual(["Questions.decodedValue"]);
  });
});

function sortFiles<T extends { readonly path: string }>(files: readonly T[]): readonly T[] {
  return [...files].sort((left, right) => left.path.localeCompare(right.path));
}

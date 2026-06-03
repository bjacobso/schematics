import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { ArtifactRef } from "@schematics/artifacts";
import { Artifacts } from "@schematics/core";
import {
  loadSchematicsProjectConfig,
  readSourceFilesFromDirectory,
  validateProjectDirectory,
} from "@schematics/cli";
import {
  SurveyArtifactProject,
  WorkflowArtifactProject,
  randomSchematicsExample,
  schematicsExampleDefinitions,
  schematicsExamples,
} from "../src";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("schematics-examples", () => {
  it("exports valid playground examples", async () => {
    expect(schematicsExamples.length).toBeGreaterThan(0);
    expect(schematicsExampleDefinitions.map((definition) => definition.id)).toEqual(
      schematicsExamples.map((example) => example.id),
    );
    expect(randomSchematicsExample()).toBeDefined();

    for (const example of schematicsExamples) {
      const reflection = await Effect.runPromise(
        Artifacts.validate({
          schema: example.schema,
          project: example.project,
          files: example.files,
          activeFile: example.files[0]?.path ?? null,
          activeFormat: example.defaultFormat ?? "json",
          projectId: example.id,
        }),
      );

      expect(reflection.routeMatches.length).toBeGreaterThan(0);
    }
  });

  it("bundles examples from the on-disk project files", async () => {
    for (const definition of schematicsExampleDefinitions) {
      const example = schematicsExamples.find((candidate) => candidate.id === definition.id);
      expect(example).toBeDefined();

      const files = await readSourceFilesFromDirectory({
        directory: resolve(packageDir, definition.filesPath),
      });

      expect(sortFiles(files)).toEqual(sortFiles(example?.files ?? []));
    }
  });

  it("keeps example CLI configs usable against the same source projects", async () => {
    for (const example of schematicsExamples) {
      const definition = schematicsExampleDefinitions.find(
        (candidate) => candidate.id === example.id,
      );
      expect(definition).toBeDefined();

      const projectConfig = await loadSchematicsProjectConfig(
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
    for (const definition of schematicsExampleDefinitions) {
      const configPath = resolve(packageDir, definition.configPath);
      const source = await readFile(configPath, "utf8");
      const projectConfig = await loadSchematicsProjectConfig(configPath);

      expect(source).toContain("defineSchematicsProject");
      expect(source).not.toContain("defineSchematicsWorkspace");
      expect(source).not.toMatch(/^\s*schema\s*:/m);
      expect(projectConfig.artifactProject?.name).toBe(definition.project.name);
      expect(projectConfig.schema.reflect().map((schema) => schema.id)).toEqual(
        definition.project.routes.filter((route) => route.schema).map((route) => route.id),
      );
    }
  });

  it("ships an artifact-native project for the workflow example", async () => {
    const actionRef = ArtifactRef.projectFile("actions/email.json", "workflow-json");
    const workflowRef = ArtifactRef.projectFile("workflows/onboarding.json", "workflow-json");
    const definition = schematicsExampleDefinitions.find(
      (candidate) => candidate.id === "workflow-json",
    );
    expect(definition).toBeDefined();
    const config = await loadSchematicsProjectConfig(resolve(packageDir, definition!.configPath));

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
    const questionRef = ArtifactRef.projectFile("questions/email.yaml", "survey-yaml");
    const surveyRef = ArtifactRef.projectFile("surveys/intake.yaml", "survey-yaml");
    const definition = schematicsExampleDefinitions.find(
      (candidate) => candidate.id === "survey-yaml",
    );
    expect(definition).toBeDefined();
    const config = await loadSchematicsProjectConfig(resolve(packageDir, definition!.configPath));

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

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
  CatalogArtifactProject,
  ToyArtifactProject,
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

  it("ships an artifact-native project for the catalog example", async () => {
    const itemRef = ArtifactRef.projectFile("items/beloved.yaml", "nyc-library-yaml");
    const branchRef = ArtifactRef.projectFile("branches/schwarzman.yaml", "nyc-library-yaml");
    const definition = schematicsExampleDefinitions.find(
      (candidate) => candidate.id === "nyc-library-yaml",
    );
    expect(definition).toBeDefined();
    const config = await loadSchematicsProjectConfig(resolve(packageDir, definition!.configPath));

    expect(CatalogArtifactProject.routes.map((route) => route.id)).toEqual([
      "Catalog",
      "Branches",
      "Authors",
      "Shelves",
      "Items",
      "Collections",
      "LoanPolicies",
    ]);
    expect(
      CatalogArtifactProject.capabilities(itemRef).map((capability) => capability.routeId),
    ).toContain("Items");
    expect(
      CatalogArtifactProject.capabilities(branchRef).map((capability) => capability.routeId),
    ).toContain("Branches");
    expect(config.artifactProject?.name).toBe("nyc-library-yaml");
    expect(
      config.artifactProject?.capabilities(itemRef).map((capability) => capability.routeId),
    ).toContain("Items");
  });

  it("ships an artifact-native project for the toy example", async () => {
    const cardRef = ArtifactRef.projectFile("cards/welcome.yaml", "toy-yaml");
    const deckRef = ArtifactRef.projectFile("decks/onboarding.yaml", "toy-yaml");
    const definition = schematicsExampleDefinitions.find(
      (candidate) => candidate.id === "toy-valid",
    );
    expect(definition).toBeDefined();
    const config = await loadSchematicsProjectConfig(resolve(packageDir, definition!.configPath));

    expect(ToyArtifactProject.routes.map((route) => route.id)).toEqual(["Cards", "Decks"]);
    expect(
      ToyArtifactProject.capabilities(cardRef).map((capability) => capability.routeId),
    ).toContain("Cards");
    expect(
      ToyArtifactProject.capabilities(deckRef).map((capability) => capability.routeId),
    ).toContain("Decks");
    expect(config.artifactProject?.name).toBe("toy-yaml");
  });
});

function sortFiles<T extends { readonly path: string }>(files: readonly T[]): readonly T[] {
  return [...files].sort((left, right) => left.path.localeCompare(right.path));
}

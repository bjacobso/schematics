import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { ArtifactProjectConfigSchema } from "@schema-ide/artifacts";
import {
  createLocalFilesystemArtifactProjectClient,
  loadSchemaIdeProjectConfig,
  readSourceFilesFromDirectory,
  validateProjectDirectory,
} from "@schema-ide/cli";
import { createOnboardedConfigCli } from "../src/cli";
import {
  OnboardedArtifactProject,
  OnboardedArtifactProjectConfigDefinition,
  createOnboardedArtifactRuntime,
  createOnboardedArtifactRuntimeFromProjectConfig,
  parseOnboardedArtifactProjectConfig,
  serializeOnboardedArtifactProjectConfig,
} from "../src/index";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = resolve(packageDir, "projects/onboarded-account-yaml/files");
const fixtureConfigPath = resolve(packageDir, "projects/onboarded-account-yaml/schema-ide.config.ts");
const fixtureArtifactProjectPath = resolve(
  packageDir,
  "projects/onboarded-account-yaml/artifact-project.yaml",
);
const include = ["**/*.yaml"];

describe("onboarded-config", () => {
  it("validates the packaged sample artifact project through the generic CLI config", async () => {
    const artifactProjectConfig = parseOnboardedArtifactProjectConfig(
      await readFile(fixtureArtifactProjectPath, "utf8"),
    );
    const workspace = await loadSchemaIdeProjectConfig(fixtureConfigPath);
    const reflection = await validateProjectDirectory({ project: workspace, directory: fixtureDir });

    expect(reflection.validationSummary.valid).toBe(true);
    expect(workspace.id).toBe(artifactProjectConfig.id);
    expect(workspace.artifactProject?.routes.map((route) => route.pattern)).toEqual(
      artifactProjectConfig.files.map((route) => route.pattern),
    );

    const client = createLocalFilesystemArtifactProjectClient({ project: workspace, directory: fixtureDir });
    try {
      await expect(
        Effect.runPromise(
          client.readArtifactView({
            ref: { _tag: "Project", projectId: artifactProjectConfig.id },
            view: "relationDiagnostics",
          }),
        ),
      ).resolves.toMatchObject({ value: [] });

      const graphView = await Effect.runPromise(
        client.readArtifactView({
          ref: { _tag: "Project", projectId: artifactProjectConfig.id },
          view: "relationGraph",
        }),
      );
      expect(
        (graphView.value as { definitions: readonly { type: string }[] }).definitions.map(
          (definition) => definition.type,
        ),
      ).toEqual(expect.arrayContaining(["CustomProperty", "Form", "Policy"]));
    } finally {
      await Effect.runPromise(client.close);
    }
  }, 45_000);

  it("reports cross-entity diagnostics for broken domain config", async () => {
    const workspace = await loadSchemaIdeProjectConfig(fixtureConfigPath);
    const directory = await mkdtemp(join(tmpdir(), "schema-ide-onboarded-"));
    try {
      await writeProjectFiles(directory, brokenOnboardedFiles());
      const reflection = await validateProjectDirectory({
        project: workspace,
        directory,
        activeFile: "policies/broken.yaml",
      });
      const messages = reflection.diagnostics.map((diagnostic) => diagnostic.message);

      expect(reflection.validationSummary.valid).toBe(false);
      expect(messages).toEqual(
        expect.arrayContaining([
          "Unknown attribute path: placement.custom.unknown",
          "Unknown form: missing-form",
          "Unknown rule fact path: placement.unknown_fact",
        ]),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 45_000);

  it("validates the packaged sample artifact project through the embedded CLI", async () => {
    const result = await createOnboardedConfigCli().run(["validate", "--dir", fixtureDir, "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).summary.valid).toBe(true);
  });

  it("bundles the same files that live on disk", async () => {
    const files = await readSourceFilesFromDirectory({ directory: fixtureDir, include });
    const runtime = createOnboardedArtifactRuntime({ files });
    const workspaceRef = { _tag: "Project", projectId: "onboarded-account-yaml" } as const;
    const summary = await Effect.runPromise(runtime.view(workspaceRef, "validationSummary"));
    const routeMatches = await Effect.runPromise(runtime.view(workspaceRef, "routeMatches"));
    expect(summary).toMatchObject({ valid: true });
    expect((routeMatches as readonly unknown[]).length).toBeGreaterThan(0);
  });

  it("loads the packaged artifact project yaml as the onboarded runtime configuration", async () => {
    const config = parseOnboardedArtifactProjectConfig(
      await readFile(fixtureArtifactProjectPath, "utf8"),
    );
    const serializedConfig = parseOnboardedArtifactProjectConfig(
      serializeOnboardedArtifactProjectConfig(),
    );
    const genericConfig = Schema.decodeUnknownSync(ArtifactProjectConfigSchema)(config);
    const files = await readSourceFilesFromDirectory({ directory: fixtureDir, include: config.include });
    const runtime = createOnboardedArtifactRuntimeFromProjectConfig({ config, files });

    expect(config).toEqual(OnboardedArtifactProjectConfigDefinition);
    expect(genericConfig).toEqual(config);
    expect(serializedConfig).toEqual(config);
    expect(config.files.map((route) => route.id)).toEqual([
      "account",
      "customProperties",
      "forms",
      "policies",
      "automations",
    ]);
    expect(
      OnboardedArtifactProject.routes.map((route) => ({ id: route.id, pattern: route.pattern })),
    ).toEqual(config.files.map(({ id, pattern }) => ({ id, pattern })));
    await expect(
      Effect.runPromise(runtime.view({ _tag: "Project", projectId: config.id }, "reflection")),
    ).resolves.toMatchObject({ activeFormat: "yaml", validationSummary: { valid: true } });
  });

  it("validates onboarded account workspace references via the runtime", async () => {
    const runtime = createOnboardedArtifactRuntime({
      activeFile: "policies/broken.yaml",
      files: brokenOnboardedFiles(),
    });
    const workspaceRef = { _tag: "Project", projectId: "onboarded-account-yaml" } as const;
    const summary = await Effect.runPromise(runtime.view(workspaceRef, "validationSummary"));
    const diagnostics = await Effect.runPromise(runtime.view(workspaceRef, "diagnostics"));

    expect(summary).toMatchObject({ valid: false });
    expect(
      (diagnostics as readonly { readonly message: string }[]).map((d) => d.message),
    ).toEqual(
      expect.arrayContaining([
        "Unknown attribute path: placement.custom.unknown",
        "Unknown form: missing-form",
        "Unknown rule fact path: placement.unknown_fact",
      ]),
    );
  });
});

function yamlFile(path: string, lines: readonly string[]) {
  return { path, content: `${lines.join("\n")}\n` };
}

function brokenOnboardedFiles() {
  return [
    yamlFile("account.yaml", [
      "id: acc_broken",
      "isTest: true",
      "organization:",
      "  name: Broken",
      "  connectType: direct",
      "branding: null",
    ]),
    yamlFile("custom-properties/badge.yaml", [
      "path: employee.custom.badge_number",
      "label: Badge Number",
      "scalarType: string",
      "entityType: employee",
    ]),
    yamlFile("forms/intake.yaml", [
      "id: intake",
      "name: Intake",
      "accessType: account",
      "scope:",
      "  employer: false",
      "  client: true",
      "  job: false",
      "attributePaths:",
      "  - placement.custom.unknown",
    ]),
    yamlFile("policies/broken.yaml", [
      "id: broken-policy",
      "name: Broken Policy",
      "status: draft",
      "rules:",
      "  all:",
      "    - fact: placement.unknown_fact",
      "      operator: equal",
      "      value: north",
      "forms:",
      "  - missing-form",
    ]),
  ];
}

async function writeProjectFiles(
  directory: string,
  files: readonly { readonly path: string; readonly content: string }[],
) {
  for (const file of files) {
    const absolutePath = join(directory, file.path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.content);
  }
}

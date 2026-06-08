import { describe, expect, it } from "@effect/vitest";
import { Relation } from "@schematics/algebra";
import { Schema } from "effect";
import {
  defineResource,
  deriveArtifactProject,
  deriveWorkspaceDiagnostics,
  deriveWorkspaceSchema,
} from "../src";

// A minimal two-resource provider with cross-resource refs, used to prove the
// pure derivations without depending on a worked example flavor.
const RepoSchema = Schema.Struct({
  id: Relation.id("repo", { display: "name" }),
  name: Schema.String,
});
const TeamSchema = Schema.Struct({
  id: Relation.id("team", { display: "name" }),
  name: Schema.String,
  repos: Relation.refs("repo"),
});

const Repo = defineResource({ kind: "repo", schemaId: "Repos", schema: RepoSchema });
const Team = defineResource({ kind: "team", schemaId: "Teams", schema: TeamSchema });
const Org = defineResource({
  kind: "org",
  schemaId: "Org",
  single: true,
  schema: Schema.Struct({ id: Relation.id("org", { display: "name" }), name: Schema.String }),
});
const resources = [Repo, Team];

describe("defineResource defaults", () => {
  it("derives workspaceField (lowercased first char) and route", () => {
    expect(Team.workspaceField).toBe("teams");
    expect(Team.route).toBe("teams/*.yaml");
    expect(Repo.route).toBe("repos/*.yaml");
    expect(Team.key).toBe("id");
    expect(Team.writeOps).toBe("full");
  });

  it("uses a container route for single resources", () => {
    expect(Org.workspaceField).toBe("org");
    expect(Org.route).toBe("org.yaml");
  });
});

describe("deriveArtifactProject", () => {
  it("produces one route per resource, in order", () => {
    const project = deriveArtifactProject({
      id: "acme",
      resources,
      include: ["**/*.yaml"],
    });
    expect(project.routes.map((route) => route.id)).toEqual(["Repos", "Teams"]);
    expect(project.config.include).toEqual(["**/*.yaml"]);
  });
});

describe("deriveWorkspaceSchema + diagnostics", () => {
  const workspaceSchema = deriveWorkspaceSchema(resources);
  const diagnose = deriveWorkspaceDiagnostics(workspaceSchema, resources);

  it("reports unresolved references with friendly messages", () => {
    const diagnostics = diagnose({
      repos: [{ id: "api", name: "API" }],
      teams: [{ id: "backend", name: "Backend", repos: ["api", "ghost"] }],
    });
    expect(diagnostics.map((d) => d.message)).toContain("Unknown repo: ghost");
    expect(diagnostics.every((d) => d.source === "cross-file")).toBe(true);
  });

  it("reports duplicate ids", () => {
    const diagnostics = diagnose({
      repos: [
        { id: "api", name: "API" },
        { id: "api", name: "API again" },
      ],
      teams: [],
    });
    expect(diagnostics.map((d) => d.message)).toContain("Duplicate repo id: api");
  });

  it("is clean for a resolved workspace", () => {
    const diagnostics = diagnose({
      repos: [{ id: "api", name: "API" }],
      teams: [{ id: "backend", name: "Backend", repos: ["api"] }],
    });
    expect(diagnostics).toEqual([]);
  });
});

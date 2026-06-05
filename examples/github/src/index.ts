import { Relation, validateRelations, type RelationDiagnostic } from "@schematics/algebra";
import type { AnyArtifactType } from "@schematics/artifacts";
import {
  ArtifactProject,
  Project,
  SchematicsProjectFileArtifact,
  type SchematicsDiagnostic,
} from "@schematics/core";
import { Schema } from "effect";

/**
 * GitHub organization configuration, modeled as config-as-code with
 * `@schematics/algebra`.
 *
 * Org config is the classic "settings scattered across a hundred web pages"
 * problem — team hierarchy, repo access, branch protection, deploy environments.
 * This example showcases the path-addressed and scoped corners of the algebra:
 *
 * | Algebra ability         | Where it shows up                                     |
 * | ----------------------- | ----------------------------------------------------- |
 * | `id` + `display`        | every entity (`user`, `team`, `repo`, …)              |
 * | self-referential `ref`  | `team.parentTeamId → team` (the team hierarchy)       |
 * | `refs` (array) + `edge` | `team.members → user`, edge `member`                  |
 * | `pathRef` (single)      | `branchProtection.repo → repo`                        |
 * | `pathRefs` (array)      | `team.repos → repo`                                   |
 * | `parent` scope          | `environment.name` scoped to its enclosing `repo`     |
 */

export const USER_KIND = "user";
export const TEAM_KIND = "team";
export const REPO_KIND = "repo";
export const ENVIRONMENT_KIND = "environment";
export const BRANCH_PROTECTION_KIND = "branchProtection";

/** An org member. */
export const UserConfigSchema = Schema.Struct({
  id: Relation.id(USER_KIND, { display: "login" }),
  login: Schema.String,
  name: Schema.optional(Schema.String),
});
export type UserConfig = typeof UserConfigSchema.Type;

/**
 * A deployment environment. Its `name` id is *scoped to the enclosing repo* via
 * the `parent` scope builder, so `production` can exist on every repo.
 */
export const EnvironmentConfigSchema = Schema.Struct({
  name: Relation.id(ENVIRONMENT_KIND, { scope: Relation.parent(REPO_KIND), display: "name" }),
  requiredReviewers: Schema.optional(Schema.Number),
});
export type EnvironmentConfig = typeof EnvironmentConfigSchema.Type;

/** A repository, owning its deploy environments. */
export const RepoConfigSchema = Schema.Struct({
  id: Relation.id(REPO_KIND, { display: "name" }),
  name: Schema.String,
  visibility: Schema.Literals(["public", "private", "internal"]),
  defaultBranch: Schema.optional(Schema.String),
  environments: Schema.optional(Schema.Array(EnvironmentConfigSchema)),
});
export type RepoConfig = typeof RepoConfigSchema.Type;

/**
 * A team. `parentTeamId` is a *self-referential* ref (the team hierarchy),
 * `members` are id `refs` tagged with an edge, and `repos` are `pathRefs`.
 */
export const TeamConfigSchema = Schema.Struct({
  id: Relation.id(TEAM_KIND, { display: "name" }),
  name: Schema.String,
  parentTeamId: Schema.optional(Relation.ref(TEAM_KIND)),
  members: Relation.refs(USER_KIND, { edge: "member" }),
  repos: Schema.optional(Relation.pathRefs(REPO_KIND)),
});
export type TeamConfig = typeof TeamConfigSchema.Type;

/** A branch-protection rule pointing at its repo via a single `pathRef`. */
export const BranchProtectionConfigSchema = Schema.Struct({
  id: Relation.id(BRANCH_PROTECTION_KIND, { display: "pattern" }),
  repo: Relation.pathRef(REPO_KIND),
  pattern: Schema.String,
  requiredReviews: Schema.optional(Schema.Number),
});
export type BranchProtectionConfig = typeof BranchProtectionConfigSchema.Type;

/** The whole org value the relation graph is built from. */
export const GitHubWorkspaceSchema = Schema.Struct({
  users: Schema.Array(UserConfigSchema),
  teams: Schema.Array(TeamConfigSchema),
  repos: Schema.Array(RepoConfigSchema),
  branchProtections: Schema.Array(BranchProtectionConfigSchema),
});
export type GitHubWorkspaceValue = typeof GitHubWorkspaceSchema.Type;

// The framework's project-file artifact carries the view handlers the
// standalone `web`/RPC IDE requests; a bare ArtifactType leaves it on "Loading".
const projectFileArtifact = SchematicsProjectFileArtifact as unknown as AnyArtifactType;

export const GitHubArtifactProject = ArtifactProject.make("github-yaml")
  .files("users/*.yaml", {
    id: "Users",
    type: projectFileArtifact,
    schema: UserConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Users",
        workspaceField: "users",
        values: true,
        format: "yaml",
        description: "Organization members",
      },
    },
  })
  .files("teams/*.yaml", {
    id: "Teams",
    type: projectFileArtifact,
    schema: TeamConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Teams",
        workspaceField: "teams",
        values: true,
        format: "yaml",
        description: "Teams with a hierarchy, members, and repo access",
      },
    },
  })
  .files("repos/*.yaml", {
    id: "Repos",
    type: projectFileArtifact,
    schema: RepoConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Repos",
        workspaceField: "repos",
        values: true,
        format: "yaml",
        description: "Repositories with deploy environments",
      },
    },
  })
  .files("branch-protections/*.yaml", {
    id: "BranchProtections",
    type: projectFileArtifact,
    schema: BranchProtectionConfigSchema,
    metadata: {
      attributes: {
        schemaId: "BranchProtections",
        workspaceField: "branchProtections",
        values: true,
        format: "yaml",
        description: "Branch-protection rules scoped to a repo by path",
      },
    },
  });

const DOCUMENT_FIELDS: Record<string, string | undefined> = {
  [USER_KIND]: "users",
  [TEAM_KIND]: "teams",
  [REPO_KIND]: "repos",
  [BRANCH_PROTECTION_KIND]: "branchProtections",
};

function friendlyMessage(diagnostic: RelationDiagnostic): string {
  const relation = diagnostic.relation;
  if (diagnostic.code === "unresolved-ref" && "target" in relation) {
    return `Unknown ${relation.target}: ${relation.id}`;
  }
  if (diagnostic.code === "duplicate-id" && "type" in relation) {
    return `Duplicate ${relation.type} id: ${relation.id}`;
  }
  return diagnostic.message;
}

function documentPathFor(diagnostic: RelationDiagnostic): string {
  const relation = diagnostic.relation;
  const kind = "target" in relation ? relation.target : relation.type;
  const field = DOCUMENT_FIELDS[kind];
  if (field && "id" in relation) return `${field}.${relation.id}`;
  return diagnostic.path.length > 0 ? Relation.key(diagnostic.path).join(".") : "teams";
}

/** Cross-file workspace diagnostics: duplicate ids and unresolved references. */
export function validateGitHubWorkspaceValue(
  workspace: GitHubWorkspaceValue,
): readonly SchematicsDiagnostic[] {
  return validateRelations(GitHubWorkspaceSchema, workspace).map((diagnostic) => ({
    path: diagnostic.path.length > 0 ? Relation.key(diagnostic.path).join(".") : null,
    documentPath: documentPathFor(diagnostic),
    severity: diagnostic.severity === "warning" ? "warning" : "error",
    source: "cross-file",
    message: friendlyMessage(diagnostic),
  }));
}

export const GitHubProjectBaseSchema = Project.fromArtifactProject(GitHubArtifactProject);

export const GitHubProjectSchema = GitHubProjectBaseSchema.pipe(
  Project.validate<GitHubWorkspaceValue>("github org references resolve", (workspace, issue) => {
    for (const diagnostic of validateGitHubWorkspaceValue(workspace)) {
      issue.at(diagnostic.documentPath ?? "teams", diagnostic.message, diagnostic.path);
    }
  }),
);

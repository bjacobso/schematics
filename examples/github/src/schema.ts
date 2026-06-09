import { Relation } from "@schematics/algebra";
import { Schema } from "effect";

/**
 * GitHub organization configuration, modeled as config-as-code with
 * `@schematics/algebra`.
 *
 * Org config is the classic "settings scattered across a hundred web pages"
 * problem: team hierarchy, repo access, branch protection, deploy environments.
 * This example showcases the path-addressed and scoped corners of the algebra:
 *
 * | Algebra ability         | Where it shows up                                     |
 * | ----------------------- | ----------------------------------------------------- |
 * | `id` + `display`        | every entity (`user`, `team`, `repo`, ...)            |
 * | self-referential `ref`  | `team.parentTeamId -> team` (the team hierarchy)      |
 * | `refs` (array) + `edge` | `team.members -> user`, edge `member`                 |
 * | `pathRef` (single)      | `branchProtection.repo -> repo`                       |
 * | `pathRefs` (array)      | `team.repos -> repo`                                  |
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
 * A deployment environment. Its `name` id is scoped to the enclosing repo via
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
 * A team. `parentTeamId` is a self-referential ref (the team hierarchy),
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

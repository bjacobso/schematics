import { defineResource } from "@schematics/provider";
import {
  BranchProtectionConfigSchema,
  BRANCH_PROTECTION_KIND,
  RepoConfigSchema,
  REPO_KIND,
  TeamConfigSchema,
  TEAM_KIND,
  UserConfigSchema,
  USER_KIND,
} from "./schema";

/**
 * The GitHub org as provider resources. Environments stay nested inside repos:
 * they have relation ids for validation, but they are not top-level resources in
 * provider DSL v1.
 */
export const githubResources = [
  defineResource<typeof UserConfigSchema.Type>({
    kind: USER_KIND,
    schemaId: "Users",
    schema: UserConfigSchema,
    description: "Organization members",
  }),
  defineResource<typeof TeamConfigSchema.Type>({
    kind: TEAM_KIND,
    schemaId: "Teams",
    schema: TeamConfigSchema,
    description: "Teams with hierarchy, members, and repo access",
  }),
  defineResource<typeof RepoConfigSchema.Type>({
    kind: REPO_KIND,
    schemaId: "Repos",
    schema: RepoConfigSchema,
    description: "Repositories with deploy environments",
  }),
  defineResource<typeof BranchProtectionConfigSchema.Type>({
    kind: BRANCH_PROTECTION_KIND,
    schemaId: "BranchProtections",
    schema: BranchProtectionConfigSchema,
    route: "branch-protections/*.yaml",
    description: "Branch-protection rules scoped to a repo by path",
  }),
];

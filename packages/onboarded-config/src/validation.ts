import type { OnboardedCustomPropertyConfig } from "./config";
import type { WorkspaceIssue } from "./common";
import { collectRuleConditions, type Rule } from "./rules";

/** Task fact paths that are always valid (not custom properties). */
export const allowedTaskPaths = new Set([
  "task.status",
  "task.due_at",
  "task.expired_at",
  "task.next_action",
  "task.form",
]);

export function buildAttributePathSet(
  customProperties: readonly OnboardedCustomPropertyConfig[],
): ReadonlySet<string> {
  return new Set(customProperties.map((property) => property.path));
}

export function isKnownFactPath(
  path: string,
  attributePaths: ReadonlySet<string>,
  formSlugs: ReadonlySet<string>,
): boolean {
  return attributePaths.has(path) || allowedTaskPaths.has(path) || formSlugs.has(path);
}

/** Validate every condition's `fact` in a rule against known attribute / task / form paths. */
export function validateRuleFacts(
  rule: Rule,
  documentPath: string,
  attributePaths: ReadonlySet<string>,
  formSlugs: ReadonlySet<string>,
  issue: WorkspaceIssue,
): void {
  for (const condition of collectRuleConditions(rule)) {
    if (!isKnownFactPath(condition.fact, attributePaths, formSlugs)) {
      issue.at(documentPath, `Unknown rule fact path: ${condition.fact}`);
    }
    if (
      condition.fact === "task.form" &&
      typeof condition.value === "string" &&
      !formSlugs.has(condition.value)
    ) {
      issue.at(documentPath, `Unknown form in task.form rule: ${condition.value}`);
    }
  }
}

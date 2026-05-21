import type { AttributeRegistry, OnboardedAttributeDefinition } from "./attributes";
import type { WorkspaceIssue } from "./common";
import { collectRuleConditions, type Rule, type RuleCondition } from "./rules";

export const allowedTaskPaths = new Set([
  "task.status",
  "task.due_at",
  "task.expired_at",
  "task.next_action",
  "task.form",
]);

export function validateRuleFacts(
  rule: Rule,
  documentPath: string,
  attributes: AttributeRegistry,
  forms: ReadonlyMap<string, unknown>,
  issue: WorkspaceIssue,
) {
  for (const condition of collectRuleConditions(rule)) {
    if (!isKnownPath(condition.fact, attributes, forms)) {
      issue.at(documentPath, `Unknown rule fact path: ${condition.fact}`);
      continue;
    }

    if (
      condition.fact === "task.form" &&
      typeof condition.value === "string" &&
      !forms.has(condition.value)
    ) {
      issue.at(documentPath, `Unknown form in task.form rule: ${condition.value}`);
    }

    const attribute = attributes.paths.get(condition.fact);
    if (attribute) {
      validateOperatorCompatibility(condition, attribute, documentPath, issue);
    }
  }
}

export function isKnownPath(
  path: string,
  attributes: AttributeRegistry,
  forms: ReadonlyMap<string, unknown>,
): boolean {
  return attributes.paths.has(path) || allowedTaskPaths.has(path) || forms.has(path);
}

function validateOperatorCompatibility(
  condition: RuleCondition,
  attribute: OnboardedAttributeDefinition,
  documentPath: string,
  issue: WorkspaceIssue,
) {
  const numericOperators = new Set([
    "lessThan",
    "lessThanInclusive",
    "greaterThan",
    "greaterThanInclusive",
  ]);
  if (
    numericOperators.has(condition.operator) &&
    attribute.type !== "integer" &&
    attribute.type !== "decimal" &&
    attribute.type !== "date" &&
    attribute.type !== "datetime"
  ) {
    issue.at(
      documentPath,
      `Operator ${condition.operator} is not compatible with ${attribute.type} path ${condition.fact}`,
    );
  }
}

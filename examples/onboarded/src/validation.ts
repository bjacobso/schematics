import {
  validateRelationReferences,
  type RelationEntityIndex,
  type RelationReference,
} from "@schematics/algebra";
import type { WorkspaceIssue } from "./common";
import { CUSTOM_PROPERTY_KIND, FORM_KIND } from "./config";
import { collectRuleConditions, type Rule } from "./rules";

/** Task fact paths that are always valid (not custom properties). */
export const allowedTaskPaths = new Set([
  "task.status",
  "task.due_at",
  "task.expired_at",
  "task.next_action",
  "task.form",
]);

/** Validate every condition's `fact` in a rule against known attribute / task / form paths. */
export function validateRuleFacts(
  rule: Rule,
  documentPath: string,
  entityIndex: RelationEntityIndex,
  issue: WorkspaceIssue,
): void {
  for (const condition of collectRuleConditions(rule)) {
    if (!isKnownRuleFact(condition.fact, documentPath, entityIndex)) {
      issue.at(documentPath, `Unknown rule fact path: ${condition.fact}`);
    }
    if (
      condition.fact === "task.form" &&
      typeof condition.value === "string" &&
      validateRuleFactReference(formRef(condition.value, [documentPath, "value"]), entityIndex)
        .length > 0
    ) {
      issue.at(documentPath, `Unknown form in task.form rule: ${condition.value}`);
    }
  }
}

function isKnownRuleFact(
  fact: string,
  documentPath: string,
  entityIndex: RelationEntityIndex,
): boolean {
  if (allowedTaskPaths.has(fact)) return true;

  return (
    validateRuleFactReference(customPropertyRef(fact, [documentPath, "fact"]), entityIndex)
      .length === 0 ||
    validateRuleFactReference(formRef(fact, [documentPath, "fact"]), entityIndex).length === 0
  );
}

function validateRuleFactReference(reference: RelationReference, entityIndex: RelationEntityIndex) {
  return validateRelationReferences(entityIndex, [reference]);
}

function customPropertyRef(id: string, path: readonly string[]): RelationReference {
  return {
    target: CUSTOM_PROPERTY_KIND,
    id,
    path,
    valueKind: "path",
  };
}

function formRef(id: string, path: readonly string[]): RelationReference {
  return {
    target: FORM_KIND,
    id,
    path,
    valueKind: "id",
  };
}

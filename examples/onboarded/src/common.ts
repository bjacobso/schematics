import { Schema } from "effect";

export const EntitySchema = Schema.Literals([
  "employee",
  "employer",
  "placement",
  "client",
  "job",
  "form",
  "task",
]);

export const ScalarTypeSchema = Schema.Literals([
  "string",
  "boolean",
  "date",
  "datetime",
  "integer",
  "decimal",
  "address",
]);

export const StatusSchema = Schema.Literals([
  "draft",
  "active",
  "published",
  "paused",
  "deprecated",
]);

export type WorkspaceIssue = {
  readonly at: (documentPath: string, message: string, path?: string | null) => void;
};

export function buildIdMap<T extends { readonly id: string }>(
  values: readonly T[],
  collection: string,
  issue: WorkspaceIssue,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const value of values) {
    if (map.has(value.id)) {
      issue.at(`${collection}.${value.id}`, `Duplicate ${collection} id: ${value.id}`);
    }
    map.set(value.id, value);
  }
  return map;
}

export function findDuplicates(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

import type { FieldChange } from "./diff";

export type ChangeAction = "create" | "update" | "delete" | "noop";

/**
 * A single planned resource change, keyed by `kind` + natural `key`.
 *
 * `liveHash` captures the hash of the live (remote) wire value at plan time;
 * apply re-reads the resource and aborts if the hash moved (optimistic
 * concurrency). It is `null` for creates (nothing live yet).
 */
export interface ResourceChange<Props = unknown> {
  readonly kind: string;
  /** Human slug (file identity). */
  readonly key: string;
  /** Opaque remote id resolved via the lockfile; null for creates. */
  readonly remoteId: string | null;
  readonly path: string;
  readonly action: ChangeAction;
  /** Current live value (null for creates). */
  readonly before: Props | null;
  /** Desired value from the working tree (null for deletes). */
  readonly after: Props | null;
  readonly fields: readonly FieldChange[];
  readonly liveHash: string | null;
}

export interface PlanSummary {
  readonly create: number;
  readonly update: number;
  readonly delete: number;
  readonly noop: number;
}

export interface ConfigPlan {
  readonly changes: readonly ResourceChange[];
  readonly summary: PlanSummary;
}

export function summarize(changes: readonly ResourceChange[]): PlanSummary {
  const summary = { create: 0, update: 0, delete: 0, noop: 0 };
  for (const change of changes) summary[change.action] += 1;
  return summary;
}

/** True when the plan has at least one create/update/delete (i.e. not all no-op). */
export function hasChanges(plan: ConfigPlan): boolean {
  return plan.changes.some((change) => change.action !== "noop");
}

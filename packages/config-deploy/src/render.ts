import type { ConfigPlan, ResourceChange } from "./plan";

const SYMBOL: Record<ResourceChange["action"], string> = {
  create: "+",
  update: "~",
  delete: "-",
  noop: " ",
};

export interface RenderPlanOptions {
  /** Include unchanged (no-op) resources in the output. Default false. */
  readonly includeNoop?: boolean | undefined;
}

/**
 * Render a {@link ConfigPlan} as a Terraform-style text summary, suitable for a
 * CLI or the IDE plan panel. Updates list their field-level changes.
 */
export function renderPlan(plan: ConfigPlan, options: RenderPlanOptions = {}): string {
  const lines: string[] = [];
  const { create, update, delete: del, noop } = plan.summary;
  lines.push(
    `Plan: ${create} to create, ${update} to update, ${del} to destroy, ${noop} unchanged.`,
  );

  const visible = plan.changes.filter(
    (change) => change.action !== "noop" || options.includeNoop === true,
  );
  if (visible.length === 0) return lines.join("\n");

  lines.push("");
  const labelWidth = Math.max(...visible.map((change) => change.kind.length));
  for (const change of visible) {
    const kind = change.kind.padEnd(labelWidth);
    lines.push(`  ${SYMBOL[change.action]} ${kind}  ${change.key}  (${change.path})`);
    if (change.action === "update") {
      for (const field of change.fields) {
        lines.push(`      ~ ${field.path}: ${format(field.before)} -> ${format(field.after)}`);
      }
    }
  }
  return lines.join("\n");
}

function format(value: unknown): string {
  if (value === undefined) return "(unset)";
  return JSON.stringify(value);
}

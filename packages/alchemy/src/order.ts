import type { AnyConfigProvider } from "./provider";
import type { ResourceChange } from "./plan";

/**
 * Order changes for apply: creates/updates run in dependency order
 * (a resource after everything it `dependsOn`), and deletes run last in
 * reverse dependency order (a dependent removed before its dependency).
 */
export function orderForApply(
  changes: readonly ResourceChange[],
  providerByKind: ReadonlyMap<string, AnyConfigProvider>,
): readonly ResourceChange[] {
  const upserts = changes.filter((change) => change.action !== "delete");
  const deletes = changes.filter((change) => change.action === "delete");
  const orderedUpserts = topoSort(upserts, providerByKind, "after");
  const orderedDeletes = topoSort(deletes, providerByKind, "before").slice().reverse();
  return [...orderedUpserts, ...orderedDeletes];
}

const nodeId = (change: ResourceChange): string => `${change.kind}:${change.key}`;

function topoSort(
  changes: readonly ResourceChange[],
  providerByKind: ReadonlyMap<string, AnyConfigProvider>,
  side: "after" | "before",
): readonly ResourceChange[] {
  const present = new Map(changes.map((change) => [nodeId(change), change]));
  const indegree = new Map<string, number>([...present.keys()].map((id) => [id, 0]));
  const dependents = new Map<string, string[]>([...present.keys()].map((id) => [id, []]));

  for (const change of changes) {
    const props = side === "after" ? change.after : change.before;
    const provider = providerByKind.get(change.kind);
    if (!props || !provider?.dependsOn) continue;
    for (const dep of provider.dependsOn(props)) {
      const depId = `${dep.kind}:${dep.key}`;
      if (!present.has(depId)) continue; // dependency not part of this plan
      dependents.get(depId)?.push(nodeId(change));
      indegree.set(nodeId(change), (indegree.get(nodeId(change)) ?? 0) + 1);
    }
  }

  // Kahn's algorithm, preserving input order among ready nodes.
  const ready = changes.filter((change) => (indegree.get(nodeId(change)) ?? 0) === 0).map(nodeId);
  const ordered: ResourceChange[] = [];
  const seen = new Set<string>();

  while (ready.length > 0) {
    const id = ready.shift();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const change = present.get(id);
    if (change) ordered.push(change);
    for (const dependent of dependents.get(id) ?? []) {
      indegree.set(dependent, (indegree.get(dependent) ?? 0) - 1);
      if ((indegree.get(dependent) ?? 0) === 0) ready.push(dependent);
    }
  }

  // Any remaining nodes form a cycle; append them in input order.
  for (const change of changes) {
    if (!seen.has(nodeId(change))) ordered.push(change);
  }

  return ordered;
}

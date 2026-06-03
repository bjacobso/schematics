import { Equal, Hash } from "effect";
import { AtomRef } from "effect/unstable/reactivity";

export type RefEquality<A> = (left: A, right: A) => boolean;

let combinedRefId = 0;

/**
 * Derive a read-only {@link AtomRef.ReadonlyRef} from one or more source refs.
 * Re-evaluates `evaluate()` whenever any source changes and notifies listeners
 * only when the derived value actually changed (per `equals`). Source
 * subscriptions are lazy — held only while the combined ref has listeners.
 */
export function combineRefs<A>(
  sources: readonly AtomRef.ReadonlyRef<unknown>[],
  evaluate: () => A,
  equals: RefEquality<A> = Equal.equals,
): AtomRef.ReadonlyRef<A> {
  let value = evaluate();
  const listeners = new Set<(value: A) => void>();
  let unsubscribeSources: readonly (() => void)[] | null = null;

  const read = () => {
    const next = evaluate();
    if (!equals(next, value)) {
      value = next;
    }
    return value;
  };

  const notifyIfChanged = () => {
    const next = evaluate();
    if (equals(next, value)) return;
    value = next;
    for (const listener of listeners) {
      listener(value);
    }
  };

  const subscribeToSources = () => {
    if (unsubscribeSources) return;
    const next = evaluate();
    if (!equals(next, value)) {
      value = next;
    }
    unsubscribeSources = sources.map((source) => source.subscribe(notifyIfChanged));
  };

  const unsubscribeFromSources = () => {
    if (!unsubscribeSources) return;
    for (const unsubscribe of unsubscribeSources) {
      unsubscribe();
    }
    unsubscribeSources = null;
  };

  const ref: AtomRef.ReadonlyRef<A> = {
    [AtomRef.TypeId]: AtomRef.TypeId,
    key: `SchemaIdeReactiveRef-${combinedRefId++}`,
    get value() {
      return read();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      subscribeToSources();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribeFromSources();
        }
      };
    },
    map: (map) => combineRefs([ref], () => map(ref.value)),
    [Equal.symbol]: (that: Equal.Equal) => equals(read(), (that as AtomRef.ReadonlyRef<A>).value),
    [Hash.symbol]: () => Hash.hash(read()),
  };

  return ref;
}

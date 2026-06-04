import { type Duration, Effect, Semaphore } from "effect";
import type { AnyConfigProvider } from "./provider";

/**
 * A global, serial **min-spacing** throttle for provider API calls.
 *
 * `limit` wraps any effect so that calls run **one at a time** and consecutive
 * calls start at least `interval` apart — the simplest, most predictable shape
 * for "never more than 1 call per second". Share a single limiter across pull
 * and push so the whole deploy respects one rate.
 */
export interface RateLimiter {
  readonly limit: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

export interface RateLimiterOptions {
  /** Minimum spacing between the start of consecutive calls (e.g. `"1 second"`). */
  readonly interval: Duration.Input;
}

/**
 * Build a serial min-spacing {@link RateLimiter}. One permit serializes calls;
 * sleeping `interval` *after* each call (inside the permit) means the next call
 * cannot start until `interval` has elapsed — a minimum spacing without bursts.
 */
export function makeRateLimiter(options: RateLimiterOptions): RateLimiter {
  const semaphore = Semaphore.makeUnsafe(1);
  return {
    limit: (effect) =>
      semaphore.withPermits(1)(Effect.tap(effect, () => Effect.sleep(options.interval))),
  };
}

/**
 * Wrap a provider so every effectful member routes through `limiter`. The
 * decorator is transparent — the engine and hydrating store see an ordinary
 * {@link AnyConfigProvider} — so the same limiter throttles list/read on pull
 * and read/create/update/delete on push without touching their internals.
 */
export function throttleProvider(
  provider: AnyConfigProvider,
  limiter: RateLimiter,
): AnyConfigProvider {
  return {
    ...provider,
    listSummaries: limiter.limit(provider.listSummaries),
    list: limiter.limit(provider.list),
    read: (remoteId) => limiter.limit(provider.read(remoteId)),
    create: (props, context) => limiter.limit(provider.create(props, context)),
    update: (remoteId, props, context, before) =>
      limiter.limit(provider.update(remoteId, props, context, before)),
    delete: (remoteId) => limiter.limit(provider.delete(remoteId)),
  };
}

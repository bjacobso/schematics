import { Clock, Effect } from "effect";

export const currentGitTimestamp: Effect.Effect<number> = Clock.currentTimeMillis.pipe(
  Effect.map((millis) => Math.floor(millis / 1000)),
);

export const currentIsoTimestamp: Effect.Effect<string> = Clock.currentTimeMillis.pipe(
  Effect.map((millis) => new Date(millis).toISOString()),
);

export function fixedClock(millis: number): Clock.Clock {
  const nanos = BigInt(Math.floor(millis)) * 1_000_000n;
  return {
    currentTimeMillisUnsafe: () => millis,
    currentTimeMillis: Effect.succeed(millis),
    currentTimeNanosUnsafe: () => nanos,
    currentTimeNanos: Effect.succeed(nanos),
    sleep: () => Effect.never,
  };
}

export function fixedClockFromIso(iso: string | undefined): Clock.Clock | null {
  if (!iso) return null;
  const millis = Date.parse(iso);
  return Number.isFinite(millis) ? fixedClock(millis) : null;
}

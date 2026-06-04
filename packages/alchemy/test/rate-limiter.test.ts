import { describe, expect, it } from "@effect/vitest";
import { Clock, Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { makeFakeProvider, makeRateLimiter, throttleProvider } from "../src";

describe("makeRateLimiter (serial min-spacing throttle)", () => {
  it.effect("runs calls one at a time, spaced by the interval", () =>
    Effect.gen(function* () {
      const limiter = makeRateLimiter({ interval: "1 second" });
      const starts: number[] = [];
      let inFlight = 0;
      let maxInFlight = 0;
      const task = limiter.limit(
        Effect.gen(function* () {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          starts.push(yield* Clock.currentTimeMillis);
          yield* Effect.sleep("10 millis");
          inFlight -= 1;
        }),
      );

      const fiber = yield* Effect.forkChild(
        Effect.all([task, task, task], { concurrency: "unbounded" }),
        { startImmediately: true },
      );
      yield* TestClock.adjust("10 seconds");
      yield* Fiber.join(fiber);

      expect(maxInFlight).toBe(1); // never two at once
      expect(starts).toHaveLength(3);
      // Consecutive starts are ≥ one interval apart (1000ms + the 10ms body).
      expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1000);
      expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(1000);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("throttleProvider routes every effectful member through the limiter", () =>
    Effect.gen(function* () {
      const Form = Schema.Struct({ slug: Schema.String });
      const fake = makeFakeProvider<typeof Form.Type>({
        kind: "forms",
        schema: Form,
        keyOf: (props) => props.slug,
        seed: [
          { remoteId: "rid-a", props: { slug: "a" } },
          { remoteId: "rid-b", props: { slug: "b" } },
        ],
      });
      const limiter = makeRateLimiter({ interval: "1 second" });
      const throttled = throttleProvider(fake.provider, limiter);

      // Two reads through the throttled provider must serialize: only the first
      // resolves before the clock advances a full interval.
      const fiber = yield* Effect.forkChild(
        Effect.all([throttled.read("rid-a"), throttled.read("rid-b")], {
          concurrency: "unbounded",
        }),
        { startImmediately: true },
      );
      yield* TestClock.adjust("500 millis");
      expect(fake.calls.filter((call) => call.operation === "read")).toHaveLength(1);
      yield* TestClock.adjust("5 seconds");
      yield* Fiber.join(fiber);
      expect(fake.calls.filter((call) => call.operation === "read")).toHaveLength(2);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});

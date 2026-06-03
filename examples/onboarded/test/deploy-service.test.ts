import { ArtifactRef, createMemoryArtifactStore, type ArtifactStore } from "@schematics/artifacts";
import type { DeployEvent } from "@schematics/protocol";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";
import { makeOnboardedDeployService } from "../src/deploy-service";
import { onboardedYamlCodec } from "../src/deploy";

const run = Effect.runPromise;

function setup() {
  let clock = 0;
  const store = createMemoryArtifactStore();
  const service = makeOnboardedDeployService({
    store,
    now: () => `2026-06-03T00:00:0${clock++}.000Z`,
  });
  return { store, service };
}

const ref = (path: string) => ArtifactRef.projectFile(path);
const writeYaml = (store: ArtifactStore, path: string, value: unknown) =>
  store.write(ref(path), onboardedYamlCodec.stringify(value)).pipe(
    Effect.catchIf(
      (error) => error.reason === "not-found",
      () => Effect.asVoid(store.create(ref(path), onboardedYamlCodec.stringify(value))),
    ),
  );

/** Collect every event the watch stream emits while `body` runs. */
function withWatch<A>(
  service: ReturnType<typeof setup>["service"],
  body: Effect.Effect<A>,
): Effect.Effect<{ value: A; events: readonly DeployEvent[] }> {
  return Effect.scoped(
    Effect.gen(function* () {
      const events: DeployEvent[] = [];
      const fiber = yield* Effect.forkScoped(
        service.watch.pipe(
          Stream.runForEach((event) => Effect.sync(() => void events.push(event))),
        ),
      );
      yield* Effect.sleep("20 millis"); // let the subscription register
      const value = yield* body;
      yield* Effect.sleep("10 millis"); // let trailing events flush
      yield* Fiber.interrupt(fiber);
      return { value, events };
    }),
  );
}

describe("makeOnboardedDeployService", () => {
  it("requires a connection before deploying", async () => {
    const { service } = setup();
    await expect(run(service.plan)).rejects.toThrow(/connect/i);
  });

  it("connects via a live probe and resolves the account label", async () => {
    const { service } = setup();
    const connection = await run(service.connect({ consumer: "onboarded", token: "secret-token" }));
    expect(connection.connected).toBe(true);
    expect(connection.account).toBeTypeOf("string");
    expect(connection.id).toMatch(/^conn-/);
    const current = await run(service.getConnection);
    expect(current?.id).toBe(connection.id);
  });

  it("pull then plan is a fixed point and records succeeded runs", async () => {
    const { service } = setup();
    await run(service.connect({ consumer: "onboarded", token: "t" }));
    const pulled = await run(service.pull);
    expect(pulled.pulled.length).toBeGreaterThan(0);

    const plan = await run(service.plan);
    expect(plan.summary).toMatchObject({ create: 0, update: 0, delete: 0 });

    const { runs } = await run(service.listRuns);
    const kinds = runs.map((r) => `${r.kind}:${r.status}`);
    expect(kinds).toEqual(["pull:succeeded", "plan:succeeded"]);
  });

  it("streams run + sync + plan events on watch", async () => {
    const { service } = setup();
    await run(service.connect({ consumer: "onboarded", token: "t" }));
    const { events } = await run(
      withWatch(
        service,
        Effect.gen(function* () {
          yield* service.pull;
          yield* service.plan;
        }),
      ),
    );
    const types = events.map((e) => e.type);
    expect(types).toContain("run-started");
    expect(types).toContain("run-finished");
    expect(types).toContain("sync-listed");
    expect(types).toContain("sync-hydrated");
    expect(types).toContain("plan-ready");
  });

  it("applies an edit and emits a per-change resource-applied event", async () => {
    const { store, service } = setup();
    await run(service.connect({ consumer: "onboarded", token: "t" }));
    await run(service.pull);

    const formPath = "forms/employee-handbook.yaml";
    const content = await run(store.read(ref(formPath)));
    const form = onboardedYamlCodec.parse(typeof content === "string" ? content : "") as Record<
      string,
      unknown
    >;
    await run(writeYaml(store, formPath, { ...form, name: "Employee Handbook v2" }));

    const plan = await run(service.plan);
    expect(plan.summary).toMatchObject({ update: 1 });

    const { value, events } = await run(
      withWatch(service, service.apply({ plan, allowDelete: false })),
    );
    expect(value.applied.length).toBe(1);
    const applied = events.filter((e) => e.type === "resource-applied");
    expect(applied.length).toBe(1);

    // re-plan is now a fixed point
    const after = await run(service.plan);
    expect(after.summary).toMatchObject({ update: 0, create: 0, delete: 0 });
  });
});

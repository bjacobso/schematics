import { createMemoryArtifactStore } from "@schema-ide/artifacts";
import { describe, expect, it } from "@effect/vitest";
import {
  jsonCodec,
  makeConfigDeploy,
  renderPlan,
  type ConfigProvider,
  type RemoteEntity,
} from "../src";
import { Effect, Schema } from "effect";

const Widget = Schema.Struct({ name: Schema.String, color: Schema.String, size: Schema.Number });
type Widget = typeof Widget.Type;

function widgetProvider(): ConfigProvider<Widget> {
  const remote = new Map<string, Widget>([["wgt_seed", { name: "gizmo", color: "red", size: 1 }]]);
  let counter = 0;
  const entity = (remoteId: string, props: Widget): RemoteEntity<Widget> => ({ remoteId, props });
  return {
    kind: "Widget",
    schema: Widget,
    keyOf: (w) => w.name,
    suggestKey: (e) => e.props.name,
    applyKey: (w, key) => ({ ...w, name: key }),
    pathFor: (key) => `widgets/${key}.json`,
    route: "widgets/*.json",
    listSummaries: Effect.sync(() =>
      [...remote.entries()].map(([id, w]) => ({ remoteId: id, suggestedKey: w.name })),
    ),
    list: Effect.sync(() => [...remote.entries()].map(([id, w]) => entity(id, w))),
    read: (id) => Effect.sync(() => (remote.has(id) ? entity(id, remote.get(id)!) : null)),
    create: (w) =>
      Effect.sync(() => {
        counter += 1;
        const id = `wgt_${counter}`;
        remote.set(id, w);
        return entity(id, w);
      }),
    update: (id, w) =>
      Effect.sync(() => {
        remote.set(id, w);
        return entity(id, w);
      }),
    delete: (id) => Effect.sync(() => void remote.delete(id)),
  };
}

describe("README toy example", () => {
  it("runs the documented loop", async () => {
    const store = createMemoryArtifactStore();
    const deploy = makeConfigDeploy({ store, providers: [widgetProvider()], codec: jsonCodec });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* deploy.pull;
        yield* store.write(
          { _tag: "ProjectFile", path: "widgets/gizmo.json" },
          jsonCodec.stringify({ name: "gizmo", color: "blue", size: 1 }),
        );
        yield* store.create(
          { _tag: "ProjectFile", path: "widgets/sprocket.json" },
          jsonCodec.stringify({ name: "sprocket", color: "green", size: 3 }),
        );
        const plan = yield* deploy.plan;
        const text = renderPlan(plan);
        const applied = yield* deploy.apply(plan);
        return { plan, text, applied };
      }),
    );

    expect(result.plan.summary).toMatchObject({ create: 1, update: 1, delete: 0, noop: 0 });
    expect(result.text).toContain('~ color: "red" -> "blue"');
    expect(result.applied.applied).toHaveLength(2);
  });
});

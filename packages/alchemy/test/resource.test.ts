import { ArtifactRef, createMemoryArtifactStore } from "@schema-ide/artifacts";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  defineResource,
  jsonCodec,
  makeConfigDeploy,
  type RemoteEntity,
  type ResourceReconcile,
} from "../src";

const Widget = Schema.Struct({ name: Schema.String, color: Schema.String, size: Schema.Number });
type Widget = typeof Widget.Type;

function setup() {
  const remote = new Map<string, Widget>([["wgt_seed", { name: "gizmo", color: "red", size: 1 }]]);
  let counter = 0;
  const reconciles: ResourceReconcile<Widget>[] = [];
  const entity = (remoteId: string, props: Widget): RemoteEntity<Widget> => ({ remoteId, props });

  const provider = defineResource<Widget>({
    kind: "Widget",
    schema: Widget,
    route: "widgets/*.json",
    path: (key) => `widgets/${key}.json`,
    keyField: "name", // derives keyOf / withKey / suggestKey
    list: Effect.sync(() => [...remote.entries()].map(([id, w]) => entity(id, w))),
    read: (id) => Effect.sync(() => (remote.has(id) ? entity(id, remote.get(id)!) : null)),
    reconcile: (input) =>
      Effect.sync(() => {
        reconciles.push(input);
        const id = input.remoteId ?? `wgt_${(counter += 1)}`;
        remote.set(id, input.news);
        return entity(id, input.news);
      }),
    remove: (id) => Effect.sync(() => void remote.delete(id)),
  });

  const store = createMemoryArtifactStore();
  const deploy = makeConfigDeploy({ store, providers: [provider], codec: jsonCodec });
  return { deploy, store, remote, reconciles };
}

const ref = (slug: string) => ArtifactRef.projectFile(`widgets/${slug}.json`);

describe("defineResource", () => {
  it("derives a provider from a single reconcile + keyField, and runs the loop", async () => {
    const { deploy, store, remote, reconciles } = setup();
    await Effect.runPromise(deploy.pull);

    // edit the pulled widget + add a new one
    await Effect.runPromise(
      store.write(ref("gizmo"), jsonCodec.stringify({ name: "gizmo", color: "blue", size: 1 })),
    );
    await Effect.runPromise(
      store.create(
        ref("sprocket"),
        jsonCodec.stringify({ name: "sprocket", color: "green", size: 3 }),
      ),
    );

    const plan = await Effect.runPromise(deploy.plan);
    expect(plan.summary).toMatchObject({ create: 1, update: 1 });

    await Effect.runPromise(deploy.apply(plan));
    expect(remote.get("wgt_seed")?.color).toBe("blue");
    expect([...remote.values()].some((w) => w.name === "sprocket")).toBe(true);

    // reconcile saw create (no olds) and update (with olds = the pre-edit value)
    const create = reconciles.find((r) => r.remoteId === null);
    const update = reconciles.find((r) => r.remoteId !== null);
    expect(create?.news.name).toBe("sprocket");
    expect(create?.olds).toBeNull();
    expect(update?.news.color).toBe("blue");
    expect(update?.olds).toEqual({ name: "gizmo", color: "red", size: 1 });
  });
});

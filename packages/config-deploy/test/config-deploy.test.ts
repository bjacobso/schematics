import { ArtifactRef, createMemoryArtifactStore, type ArtifactStore } from "@schema-ide/artifacts";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  ConfigValidationError,
  jsonCodec,
  makeConfigDeploy,
  makeFakeProvider,
  renderPlan,
  type ConfigDeploy,
  type FakeProvider,
  type FakeSeed,
  type ResourceRef,
} from "../src";

const run = Effect.runPromise;

const Form = Schema.Struct({
  slug: Schema.String,
  title: Schema.String,
  enabled: Schema.Boolean,
});
type Form = typeof Form.Type;

const form = (slug: string, title: string, enabled = true): Form => ({ slug, title, enabled });
const seed = (slug: string, title: string): FakeSeed<Form> => ({
  remoteId: `rid-${slug}`,
  props: form(slug, title),
});

interface Harness {
  readonly deploy: ConfigDeploy;
  readonly store: ArtifactStore;
  readonly fake: FakeProvider<Form>;
}

function harness(options?: {
  readonly seed?: readonly FakeSeed<Form>[];
  readonly dependsOn?: (props: Form) => readonly ResourceRef[];
}): Harness {
  const fake = makeFakeProvider<Form>({
    kind: "forms",
    schema: Form,
    keyOf: (props) => props.slug,
    applyKey: (props, key) => ({ ...props, slug: key }),
    seed: options?.seed,
    dependsOn: options?.dependsOn,
  });
  const store = createMemoryArtifactStore();
  const deploy = makeConfigDeploy({ store, providers: [fake.provider], codec: jsonCodec });
  return { deploy, store, fake };
}

const ref = (slug: string) => ArtifactRef.projectFile(`forms/${slug}.json`);
const writeFile = (store: ArtifactStore, props: Form) =>
  Effect.gen(function* () {
    const text = jsonCodec.stringify(props);
    yield* store.write(ref(props.slug), text).pipe(
      Effect.catchIf(
        (error) => error.reason === "not-found",
        () => Effect.asVoid(store.create(ref(props.slug), text)),
      ),
    );
  });

describe("config-deploy engine (Layer 1, fake provider + lockfile)", () => {
  it("1. pull hydrates the working tree and seeds the lockfile (slug → remoteId)", async () => {
    const { deploy, store } = harness({ seed: [seed("a", "A"), seed("b", "B")] });
    const result = await run(deploy.pull);
    expect(result.pulled.map((entry) => entry.key).sort()).toEqual(["a", "b"]);

    const refs = await run(store.list);
    expect(refs).toHaveLength(2);
    const text = await run(store.read(ref("a")));
    expect(JSON.parse(typeof text === "string" ? text : "")).toEqual(form("a", "A"));
  });

  it("2. plan immediately after pull is all no-op (fixed point)", async () => {
    const { deploy } = harness({ seed: [seed("a", "A"), seed("b", "B")] });
    await run(deploy.pull);
    const plan = await run(deploy.plan);
    expect(plan.summary).toEqual({ create: 0, update: 0, delete: 0, noop: 2 });
  });

  it("3. an edit is detected as a single field-level update resolved to a remote id", async () => {
    const { deploy, store } = harness({ seed: [seed("a", "A"), seed("b", "B")] });
    await run(deploy.pull);
    await run(writeFile(store, form("a", "A — edited")));

    const plan = await run(deploy.plan);
    expect(plan.summary).toMatchObject({ update: 1, noop: 1, create: 0, delete: 0 });
    const update = plan.changes.find((change) => change.action === "update");
    expect(update?.key).toBe("a");
    expect(update?.remoteId).toBe("rid-a");
    expect(update?.fields).toEqual([{ path: "title", before: "A", after: "A — edited" }]);
  });

  it("4. a new file (slug absent from the lock) is a create", async () => {
    const { deploy, store } = harness({ seed: [seed("a", "A")] });
    await run(deploy.pull);
    await run(writeFile(store, form("c", "C")));

    const plan = await run(deploy.plan);
    expect(plan.summary).toMatchObject({ create: 1, noop: 1 });
    const create = plan.changes.find((change) => change.action === "create");
    expect(create?.key).toBe("c");
    expect(create?.remoteId).toBeNull();
  });

  it("5. a removed file is planned as a delete; apply gates it on allowDelete", async () => {
    const { deploy, store, fake } = harness({ seed: [seed("a", "A"), seed("b", "B")] });
    await run(deploy.pull);
    await run(store.delete(ref("b")));

    const plan = await run(deploy.plan);
    expect(plan.summary).toMatchObject({ delete: 1, noop: 1 });

    const guarded = await run(deploy.apply(plan));
    expect(guarded.applied).toHaveLength(0);
    expect(guarded.skipped.some((change) => change.action === "delete")).toBe(true);
    expect(fake.remote.has("rid-b")).toBe(true);

    const allowed = await run(deploy.apply(plan, { allowDelete: true }));
    expect(allowed.applied).toHaveLength(1);
    expect(fake.remote.has("rid-b")).toBe(false);
  });

  it("6. apply mutates the provider and the next plan converges to empty", async () => {
    const { deploy, store, fake } = harness({ seed: [seed("a", "A")] });
    await run(deploy.pull);
    await run(writeFile(store, form("a", "A2")));

    const plan = await run(deploy.plan);
    const result = await run(deploy.apply(plan));
    expect(result.applied).toHaveLength(1);
    expect(fake.remote.get("rid-a")?.title).toBe("A2");

    const after = await run(deploy.plan);
    expect(after.summary).toMatchObject({ create: 0, update: 0, delete: 0, noop: 1 });
  });

  it("7. apply creates in dependency order (a dependsOn b ⇒ b first)", async () => {
    const { deploy, store, fake } = harness({
      dependsOn: (props) => (props.slug === "a" ? [{ kind: "forms", key: "b" }] : []),
    });
    await run(writeFile(store, form("a", "A")));
    await run(writeFile(store, form("b", "B")));

    const plan = await run(deploy.plan);
    await run(deploy.apply(plan));

    const created = fake.calls
      .filter((call) => call.operation === "create")
      .map((call) => call.key);
    expect(created).toEqual(["b", "a"]);
  });

  it("8. optimistic concurrency aborts when the remote moves after plan", async () => {
    const { deploy, store, fake } = harness({ seed: [seed("a", "A")] });
    await run(deploy.pull);
    await run(writeFile(store, form("a", "desired")));

    const plan = await run(deploy.plan);
    // Someone else changes the remote between plan and apply.
    fake.remote.set("rid-a", form("a", "moved-by-someone-else"));

    const result = await run(deploy.apply(plan));
    expect(result.applied).toHaveLength(0);
    expect(result.aborted).toEqual([
      {
        change: expect.objectContaining({ key: "a", remoteId: "rid-a" }),
        reason: "remote-changed",
      },
    ]);
    expect(fake.remote.get("rid-a")?.title).toBe("moved-by-someone-else");
  });

  it("9. an invalid desired file fails plan before any provider call", async () => {
    const { deploy, store, fake } = harness({ seed: [seed("a", "A")] });
    await run(deploy.pull);
    await run(store.write(ref("a"), JSON.stringify({ slug: "a", title: "A", enabled: "nope" })));

    fake.calls.length = 0;
    const error = await run(Effect.flip(deploy.plan));
    expect(error).toBeInstanceOf(ConfigValidationError);
    expect((error as ConfigValidationError).issues[0]?.kind).toBe("forms");
    expect(fake.calls.some((call) => call.operation === "list")).toBe(false);
  });

  it("10. full round-trip pull → edit → plan → apply → plan ends empty", async () => {
    const { deploy, store, fake } = harness({ seed: [seed("a", "A"), seed("b", "B")] });
    await run(deploy.pull);
    await run(writeFile(store, form("a", "A — v2")));
    await run(writeFile(store, form("d", "D")));

    const plan = await run(deploy.plan);
    expect(plan.summary).toMatchObject({ create: 1, update: 1, noop: 1 });

    const applied = await run(deploy.apply(plan));
    expect(applied.applied).toHaveLength(2);
    expect(fake.remote.get("rid-a")?.title).toBe("A — v2");
    // the created form got a fresh opaque id and a lock entry
    const settled = await run(deploy.plan);
    expect(settled.summary).toMatchObject({ create: 0, update: 0, delete: 0 });
  });

  it("11. pull reuses an existing slug across a server-side rename (slug pinned to remoteId)", async () => {
    const { deploy, fake } = harness({ seed: [seed("a", "Original")] });
    await run(deploy.pull); // lock: a → rid-a

    // Server renames the form's title; suggestKey would now differ, but the slug is pinned to rid-a.
    fake.remote.set("rid-a", form("renamed-slug-would-differ", "Renamed"));
    const result = await run(deploy.pull);
    expect(result.pulled).toEqual([{ kind: "forms", key: "a", path: "forms/a.json" }]);
  });

  it("12. renders a plan as a Terraform-style summary with field changes", async () => {
    const { deploy, store } = harness({ seed: [seed("a", "A"), seed("keep", "Keep")] });
    await run(deploy.pull);
    await run(writeFile(store, form("a", "A2")));
    await run(writeFile(store, form("new", "New")));

    const plan = await run(deploy.plan);
    const text = renderPlan(plan);
    expect(text).toContain("Plan: 1 to create, 1 to update, 0 to destroy, 1 unchanged.");
    expect(text).toContain("+ forms  new  (forms/new.json)");
    expect(text).toContain("~ forms  a  (forms/a.json)");
    expect(text).toContain('~ title: "A" -> "A2"');
    expect(text).not.toContain("keep");
  });
});

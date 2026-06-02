import { ArtifactRef, isLoadedEntry, isPendingEntry, pathFromArtifactRef } from "@schema-ide/artifacts";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema, Stream } from "effect";
import {
  jsonCodec,
  makeFakeProvider,
  makeHydratingArtifactStore,
  memoryConfigStateStore,
  type FakeSeed,
} from "../src";

const run = Effect.runPromise;

const Form = Schema.Struct({ slug: Schema.String, title: Schema.String });
type Form = typeof Form.Type;
const seed = (slug: string, title: string): FakeSeed<Form> => ({
  remoteId: `rid-${slug}`,
  props: { slug, title },
});
const ref = (slug: string) => ArtifactRef.projectFile(`forms/${slug}.json`);
const asString = (content: string | Uint8Array): string =>
  typeof content === "string" ? content : new TextDecoder().decode(content);

function setup(seeds: readonly FakeSeed<Form>[]) {
  const fake = makeFakeProvider<Form>({
    kind: "forms",
    schema: Form,
    keyOf: (props) => props.slug,
    applyKey: (props, key) => ({ ...props, slug: key }),
    seed: seeds,
  });
  const state = memoryConfigStateStore();
  const store = makeHydratingArtifactStore({ providers: [fake.provider], codec: jsonCodec, state });
  return { fake, state, store };
}

const reads = (fake: ReturnType<typeof setup>["fake"]) =>
  fake.calls.filter((call) => call.operation === "read");

describe("HydratingArtifactStore (lazy + streaming sync)", () => {
  it("seed creates pending entries and seeds the lockfile without fetching content", async () => {
    const { fake, state, store } = setup([seed("a", "A"), seed("b", "B")]);

    const refs = await run(store.seed);
    expect(refs.map(pathFromArtifactRef).sort()).toEqual(["forms/a.json", "forms/b.json"]);

    const entries = await run(store.entries!);
    expect(entries).toHaveLength(2);
    expect(entries.every(isPendingEntry)).toBe(true);
    expect(reads(fake)).toHaveLength(0); // nothing hydrated yet

    const lock = await run(state.read);
    expect(lock.entries.map((e) => `${e.key}:${e.remoteId}`).sort()).toEqual(["a:rid-a", "b:rid-b"]);
  });

  it("read hydrates a single entry on first access (and only that one)", async () => {
    const { fake, store } = setup([seed("a", "A"), seed("b", "B")]);
    await run(store.seed);

    const content = await run(store.read(ref("a")));
    expect(JSON.parse(asString(content))).toEqual({ slug: "a", title: "A" });
    expect(reads(fake)).toHaveLength(1);

    const entries = await run(store.entries!);
    const a = entries.find((e) => pathFromArtifactRef(e.ref) === "forms/a.json");
    const b = entries.find((e) => pathFromArtifactRef(e.ref) === "forms/b.json");
    expect(a && isLoadedEntry(a)).toBe(true);
    expect(b && isPendingEntry(b)).toBe(true); // b untouched
  });

  it("de-dupes concurrent reads of the same ref into one fetch", async () => {
    const { fake, store } = setup([seed("a", "A")]);
    await run(store.seed);

    await run(
      Effect.all([store.read(ref("a")), store.read(ref("a")), store.read(ref("a"))], {
        concurrency: "unbounded",
      }),
    );
    expect(reads(fake)).toHaveLength(1);
  });

  it("sync streams `listed` then a `hydrated` per entry, ending fully loaded", async () => {
    const { store } = setup([seed("a", "A"), seed("b", "B"), seed("c", "C")]);

    const events = Array.from(await run(Stream.runCollect(store.sync)));
    expect(events[0]).toEqual({ _tag: "listed", total: 3 });
    expect(events.filter((event) => event._tag === "hydrated")).toHaveLength(3);

    const entries = await run(store.entries!);
    expect(entries).toHaveLength(3);
    expect(entries.every(isLoadedEntry)).toBe(true);
  });

  it("read after sync is served from cache (no extra fetch)", async () => {
    const { fake, store } = setup([seed("a", "A")]);
    await run(Stream.runDrain(store.sync));
    const before = reads(fake).length;

    const content = await run(store.read(ref("a")));
    expect(JSON.parse(asString(content)).title).toBe("A");
    expect(reads(fake).length).toBe(before); // memoized, no new read
  });
});

import { ArtifactRef, createMemoryArtifactStore, type ArtifactStore } from "@schema-ide/artifacts";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  makeOnboardedConfigDeploy,
  onboardedYamlCodec,
  slugifyFormName,
  type OnboardedFormRecord,
  type OnboardedFormsApi,
} from "../src/deploy";
import type { OnboardedFormConfig } from "../src/forms";

const run = Effect.runPromise;

const sampleForm = (name: string): OnboardedFormConfig => ({
  id: "placeholder", // overwritten by the engine via applyKey on pull
  name,
  status: "draft",
  owner: "account",
  version: {
    name,
    description: null,
    pages: [
      {
        description: null,
        assignee: "employee",
        fields: [
          {
            path: "form.acknowledgement",
            type: "signature",
            required: true,
            rule: null,
            options: null,
            translations: { en: { label: "Signature" } },
          },
        ],
      },
    ],
  },
});

interface MockApi {
  readonly api: OnboardedFormsApi;
  readonly remote: Map<string, OnboardedFormConfig>;
  readonly calls: { readonly op: string; readonly uid?: string }[];
}

function makeMockFormsApi(seed: readonly OnboardedFormRecord[]): MockApi {
  const remote = new Map(seed.map((record) => [record.uid, record.form]));
  const calls: { op: string; uid?: string }[] = [];
  let counter = 0;
  const api: OnboardedFormsApi = {
    listForms: Effect.sync(() => {
      calls.push({ op: "list" });
      return [...remote.entries()].map(([uid, form]) => ({ uid, form }));
    }),
    getForm: (uid) =>
      Effect.sync(() => {
        calls.push({ op: "read", uid });
        const form = remote.get(uid);
        return form === undefined ? null : { uid, form };
      }),
    createForm: (form) =>
      Effect.sync(() => {
        counter += 1;
        const uid = `form_uid_${counter}`;
        calls.push({ op: "create", uid });
        remote.set(uid, form);
        return { uid, form };
      }),
    updateForm: (uid, form) =>
      Effect.sync(() => {
        calls.push({ op: "update", uid });
        remote.set(uid, form);
        return { uid, form };
      }),
    deleteForm: (uid) =>
      Effect.sync(() => {
        calls.push({ op: "delete", uid });
        remote.delete(uid);
      }),
  };
  return { api, remote, calls };
}

const ref = (slug: string) => ArtifactRef.projectFile(`forms/${slug}.yaml`);
const writeYaml = (store: ArtifactStore, slug: string, form: OnboardedFormConfig) =>
  store.write(ref(slug), onboardedYamlCodec.stringify(form)).pipe(
    Effect.catchIf(
      (error) => error.reason === "not-found",
      () => Effect.asVoid(store.create(ref(slug), onboardedYamlCodec.stringify(form))),
    ),
  );

describe("onboarded config-deploy (Layer 2, mock Effect API + lockfile)", () => {
  it("pulls account forms to YAML, assigning a slug from the form name", async () => {
    const mock = makeMockFormsApi([{ uid: "form_uid_99", form: sampleForm("Client Safety Packet") }]);
    const store = createMemoryArtifactStore();
    const deploy = makeOnboardedConfigDeploy({ store, apis: { forms: mock.api } });

    const result = await run(deploy.pull);
    expect(result.pulled).toEqual([
      { kind: "OnboardedForm", key: "client-safety-packet", path: "forms/client-safety-packet.yaml" },
    ]);

    const text = await run(store.read(ref("client-safety-packet")));
    const parsed = onboardedYamlCodec.parse(typeof text === "string" ? text : "") as OnboardedFormConfig;
    expect(parsed.id).toBe("client-safety-packet"); // engine pinned the slug into the file
    expect(parsed.version.pages[0]?.fields[0]?.path).toBe("form.acknowledgement");
  });

  it("plan after a clean pull is empty (YAML + schema + lockfile round-trip is a fixed point)", async () => {
    const mock = makeMockFormsApi([
      { uid: "u1", form: sampleForm("Form One") },
      { uid: "u2", form: sampleForm("Form Two") },
    ]);
    const store = createMemoryArtifactStore();
    const deploy = makeOnboardedConfigDeploy({ store, apis: { forms: mock.api } });

    await run(deploy.pull);
    const plan = await run(deploy.plan);
    expect(plan.summary).toEqual({ create: 0, update: 0, delete: 0, noop: 2 });
  });

  it("detects an edited form as a field-level update resolved to its uid", async () => {
    const mock = makeMockFormsApi([{ uid: "form_uid_7", form: sampleForm("Safety Quiz") }]);
    const store = createMemoryArtifactStore();
    const deploy = makeOnboardedConfigDeploy({ store, apis: { forms: mock.api } });

    await run(deploy.pull);
    const slug = slugifyFormName("Safety Quiz");
    const pulled = onboardedYamlCodec.parse(
      (await run(store.read(ref(slug)))) as string,
    ) as OnboardedFormConfig;
    await run(writeYaml(store, slug, { ...pulled, status: "published" }));

    const plan = await run(deploy.plan);
    expect(plan.summary).toMatchObject({ update: 1 });
    const update = plan.changes.find((change) => change.action === "update");
    expect(update?.remoteId).toBe("form_uid_7");
    expect(update?.fields).toEqual([{ path: "status", before: "draft", after: "published" }]);
  });

  it("issues exactly the expected API calls for plan → apply of one edit", async () => {
    const mock = makeMockFormsApi([{ uid: "form_uid_7", form: sampleForm("Safety Quiz") }]);
    const store = createMemoryArtifactStore();
    const deploy = makeOnboardedConfigDeploy({ store, apis: { forms: mock.api } });

    await run(deploy.pull); // list
    const slug = slugifyFormName("Safety Quiz");
    const pulled = onboardedYamlCodec.parse((await run(store.read(ref(slug)))) as string) as OnboardedFormConfig;
    await run(writeYaml(store, slug, { ...pulled, name: "Safety Quiz v2" }));

    mock.calls.length = 0; // record only plan + apply traffic
    const plan = await run(deploy.plan); // list
    const result = await run(deploy.apply(plan)); // read uid (concurrency) + update uid

    expect(result.applied).toHaveLength(1);
    expect(mock.remote.get("form_uid_7")?.name).toBe("Safety Quiz v2");
    expect(mock.calls).toEqual([
      { op: "list" },
      { op: "read", uid: "form_uid_7" },
      { op: "update", uid: "form_uid_7" },
    ]);
  });
});

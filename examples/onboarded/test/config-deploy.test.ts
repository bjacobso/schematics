import { ConfigValidationError } from "@schematics/alchemy";
import {
  ArtifactRef,
  createMemoryArtifactStore,
  pathFromArtifactRef,
  type ArtifactStore,
} from "@schematics/artifacts";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { makeOnboardedConfigDeploy, onboardedYamlCodec } from "../src/deploy";
import { makeMockOnboardedApi, type OnboardedApi } from "../src/mock";
import type { OnboardedPolicyConfig } from "../src/config";

const run = Effect.runPromise;

function setup(api: OnboardedApi = makeMockOnboardedApi()) {
  const store = createMemoryArtifactStore();
  const deploy = makeOnboardedConfigDeploy({ store, api });
  return { api, store, deploy };
}

const ref = (path: string) => ArtifactRef.projectFile(path);
const read = (store: ArtifactStore, path: string) =>
  store
    .read(ref(path))
    .pipe(Effect.map((c) => onboardedYamlCodec.parse(typeof c === "string" ? c : "")));
const writeYaml = (store: ArtifactStore, path: string, value: unknown) =>
  store.write(ref(path), onboardedYamlCodec.stringify(value)).pipe(
    Effect.catchIf(
      (e) => e.reason === "not-found",
      () => Effect.asVoid(store.create(ref(path), onboardedYamlCodec.stringify(value))),
    ),
  );

describe("onboarded alchemy (5 entities, mock OnboardedApi)", () => {
  it("pulls every entity to slug-keyed files", async () => {
    const { store, deploy } = setup();
    const result = await run(deploy.pull);
    const paths = result.pulled.map((p) => p.path).sort();
    expect(paths).toEqual([
      "account.yaml",
      "automations/welcome-email.yaml",
      "custom-properties/employee.custom.badge_number.yaml",
      "custom-properties/placement.custom.branch_code.yaml",
      "forms/client-safety-packet.yaml",
      "forms/employee-handbook.yaml",
      "policies/safety-compliance.yaml",
    ]);

    // policy file references the form by SLUG (resolved from the uid via the lockfile)
    const policy = (await run(
      read(store, "policies/safety-compliance.yaml"),
    )) as OnboardedPolicyConfig;
    expect(policy.forms).toEqual(["client-safety-packet"]);
  });

  it("plan immediately after pull is a fixed point (all entities round-trip)", async () => {
    const { deploy } = setup();
    await run(deploy.pull);
    const plan = await run(deploy.plan);
    expect(plan.summary).toMatchObject({ create: 0, update: 0, delete: 0 });
  });

  it("detects a form edit and applies it to the mock", async () => {
    const { api, store, deploy } = setup();
    await run(deploy.pull);
    const form = (await run(read(store, "forms/employee-handbook.yaml"))) as Record<
      string,
      unknown
    >;
    await run(
      writeYaml(store, "forms/employee-handbook.yaml", { ...form, name: "Employee Handbook v2" }),
    );

    const plan = await run(deploy.plan);
    expect(plan.summary).toMatchObject({ update: 1 });

    await run(deploy.apply(plan));
    const live = await run(api.forms.list);
    expect(live.find((f) => f.name === "Employee Handbook v2")).toBeTruthy();
  });

  it("creates a new policy that references a form by slug, resolving to the form's uid on apply", async () => {
    const { api, store, deploy } = setup();
    await run(deploy.pull);

    const newPolicy: OnboardedPolicyConfig = {
      id: "handbook-required",
      name: "Handbook Required",
      status: "active",
      rules: { all: [{ fact: "employee.custom.badge_number", operator: "exists", value: true }] },
      forms: ["employee-handbook"],
    };
    await run(writeYaml(store, "policies/handbook-required.yaml", newPolicy));

    const plan = await run(deploy.plan);
    expect(plan.summary).toMatchObject({ create: 1 });

    await run(deploy.apply(plan));

    // the handbook form's uid (resolved via the lockfile/apply context)
    const handbook = (await run(api.forms.list)).find((f) => f.name === "Employee Handbook");
    const created = (await run(api.policies.list)).find((p) => p.name === "Handbook Required");
    expect(created?.forms.map((f) => f.id)).toEqual([handbook?.uid]);
  });

  it("fails plan loudly when a policy references a missing form slug", async () => {
    const { store, deploy } = setup();
    await run(deploy.pull);

    await run(
      writeYaml(store, "policies/broken.yaml", {
        id: "broken",
        name: "Broken",
        status: "active",
        rules: { all: [] },
        forms: ["missing-form"],
      } satisfies OnboardedPolicyConfig),
    );

    const error = await run(Effect.flip(deploy.plan));
    expect(error).toBeInstanceOf(ConfigValidationError);
    expect((error as ConfigValidationError).issues).toContainEqual(
      expect.objectContaining({
        kind: "OnboardedPolicy",
        path: "policies/broken.yaml",
        message: 'Unresolved OnboardedForm reference "missing-form" at forms.0',
      }),
    );
  });

  it("resolves a form slug referenced inside an automation action param to its uid", async () => {
    const { api, store, deploy } = setup();
    await run(deploy.pull);

    await run(
      writeYaml(store, "automations/provision.yaml", {
        id: "provision",
        name: "Provision",
        triggerEntity: "task",
        triggerRerunBehavior: "never",
        isDependentOnCreate: true,
        dependencies: [{ entity: "task", property: "status" }],
        nodes: [
          {
            type: "start",
            id: "n_start",
            position: { x: 0, y: 0 },
            name: "Start",
            description: null,
            trigger_rerun_behavior: "never",
            is_dependent_on_create: true,
            dependencies: [{ entity: "task", property: "status" }],
          },
          {
            type: "action",
            id: "n_task",
            position: { x: 0, y: 200 },
            name: "Create handbook task",
            action_type: "create_task",
            action_params: { params_type: "create_task", task_lineage_uid: "employee-handbook" },
          },
        ],
        edges: [{ id: "e1", source: "n_start", target: "n_task", edge_type: "default" }],
      }),
    );

    const plan = await run(deploy.plan);
    expect(plan.summary).toMatchObject({ create: 1 });
    await run(deploy.apply(plan));

    const handbookUid = (await run(api.forms.list)).find(
      (f) => f.name === "Employee Handbook",
    )?.uid;
    const created = (await run(api.automations.list)).find((a) => a.name === "Provision");
    const detail = created ? await run(api.automations.get(created.id)) : null;
    const actionNode = detail?.nodes.find((node) => node.type === "action");
    const taskRef =
      actionNode && actionNode.type === "action"
        ? (actionNode.action_params as { task_lineage_uid?: string } | null)?.task_lineage_uid
        : undefined;
    expect(taskRef).toBe(handbookUid); // slug → uid on the way in
  });

  it("forms apply before the policies that depend on them", async () => {
    const { api, store, deploy } = setup();
    await run(deploy.pull);

    // a brand-new form + a policy referencing it, in one plan
    await run(
      writeYaml(store, "forms/drug-screen.yaml", {
        id: "drug-screen",
        name: "Drug Screen",
        accessType: "account",
        scope: { employer: false, client: true, job: false },
      }),
    );
    await run(
      writeYaml(store, "policies/screening.yaml", {
        id: "screening",
        name: "Screening",
        status: "active",
        rules: { all: [] },
        forms: ["drug-screen"],
      }),
    );

    const plan = await run(deploy.plan);
    await run(deploy.apply(plan));

    const createOrder = api.calls
      .filter((c) => c.operation === "create" && (c.group === "forms" || c.group === "policies"))
      .map((c) => c.group);
    expect(createOrder.indexOf("forms")).toBeLessThan(createOrder.indexOf("policies"));

    const screening = (await run(api.policies.list)).find((p) => p.name === "Screening");
    const drugScreen = (await run(api.forms.list)).find((f) => f.name === "Drug Screen");
    expect(screening?.forms.map((f) => f.id)).toEqual([drugScreen?.uid]);
  });
});

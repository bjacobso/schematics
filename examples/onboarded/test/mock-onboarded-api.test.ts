import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { makeMockOnboardedApi, seedOnboardedData } from "../src/mock";

const run = Effect.runPromise;

describe("mock OnboardedApi", () => {
  it("lists seeded entities across all five groups", async () => {
    const api = makeMockOnboardedApi();
    expect((await run(api.accounts.list)).map((a) => a.id)).toEqual(["acc_demo"]);
    expect((await run(api.customProperties.list)).map((p) => p.path)).toEqual([
      "employee.custom.badge_number",
      "placement.custom.branch_code",
    ]);
    expect((await run(api.forms.list)).map((f) => f.uid)).toEqual(["tlin_safety", "tlin_handbook"]);
    expect((await run(api.policies.list)).map((p) => p.id)).toEqual(["pcy_safety"]);
    expect((await run(api.automations.list)).map((a) => a.id)).toEqual(["auto_welcome"]);
  });

  it("preserves the policy → form cross-reference from the seed", async () => {
    const api = makeMockOnboardedApi();
    const policy = await run(api.policies.get("pcy_safety"));
    expect(policy?.forms.map((f) => f.id)).toEqual(["tlin_safety"]);
    const form = await run(api.forms.get("tlin_safety"));
    expect(form?.policies.map((p) => p.uid)).toEqual(["pcy_safety"]);
  });

  it("can seed the named mina demo account", async () => {
    const api = makeMockOnboardedApi({ seed: seedOnboardedData({ account: "mina" }) });

    expect((await run(api.accounts.list)).map((a) => a.organization.name)).toEqual(["Mina Care"]);
    expect((await run(api.customProperties.list)).map((p) => p.path)).toEqual([
      "employee.custom.clinician_license",
      "placement.custom.care_region",
      "job.custom.patient_acuity",
    ]);
    expect((await run(api.forms.list)).map((f) => f.name)).toEqual([
      "Clinician Profile",
      "Site Orientation",
      "Equipment Acknowledgement",
    ]);
    expect((await run(api.policies.list)).map((p) => p.name)).toEqual(["Clinical Readiness"]);
  });

  it("returns the automation node/edge graph from get(detail)", async () => {
    const api = makeMockOnboardedApi();
    const detail = await run(api.automations.get("auto_welcome"));
    expect(detail?.nodes.map((n) => n.type)).toEqual(["start", "action"]);
    expect(detail?.edges).toHaveLength(1);
  });

  it("create assigns a fresh id and shows up in list; calls are recorded", async () => {
    const api = makeMockOnboardedApi();
    const created = await run(
      api.forms.create({
        name: "New Hire Checklist",
        description: null,
        scope: { employer: false, client: false, job: true },
        custom_attributes: null,
        tags: ["onboarding"],
        access_type: "account",
        track_conversion: false,
        attribute_scope_paths: [],
      }),
    );
    expect(created.uid).toMatch(/^tlin_/);
    const uids = (await run(api.forms.list)).map((f) => f.uid);
    expect(uids).toContain(created.uid);

    expect(api.calls.filter((c) => c.group === "forms" && c.operation === "create")).toHaveLength(
      1,
    );
  });

  it("update mutates and delete removes", async () => {
    const api = makeMockOnboardedApi();
    await run(api.forms.update("tlin_handbook", { name: "Employee Handbook v2" }));
    expect((await run(api.forms.get("tlin_handbook")))?.name).toBe("Employee Handbook v2");

    await run(api.forms.delete("tlin_handbook"));
    expect(await run(api.forms.get("tlin_handbook"))).toBeNull();
  });
});

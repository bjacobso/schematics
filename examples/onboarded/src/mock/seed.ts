import type { AccountDto } from "../domain/account";
import type { AutomationDetailDto, AutomationDto } from "../domain/automations";
import type { CustomPropertyDto } from "../domain/custom-properties";
import type { FormDto } from "../domain/forms";
import type { PolicyDto } from "../domain/policies";

export interface OnboardedSeed {
  readonly accounts: readonly AccountDto[];
  readonly customProperties: readonly CustomPropertyDto[];
  readonly forms: readonly FormDto[];
  readonly policies: readonly PolicyDto[];
  readonly automations: readonly {
    readonly summary: AutomationDto;
    readonly detail: AutomationDetailDto;
  }[];
}

export type OnboardedSeedAccount = "demo" | "mina";

export interface SeedOnboardedDataOptions {
  readonly account?: OnboardedSeedAccount | undefined;
}

const TS = "2026-01-01T00:00:00.000Z";

/** A small, cross-referential dataset: a policy references a form; an automation graph. */
export function seedOnboardedData(options: SeedOnboardedDataOptions = {}): OnboardedSeed {
  if (options.account === "mina") return seedMinaData();
  return seedDemoData();
}

function seedDemoData(): OnboardedSeed {
  const accounts: AccountDto[] = [
    {
      id: "acc_demo",
      is_test: true,
      organization: {
        uid: "org_demo",
        name: "Demo Staffing",
        connect_type: "direct",
        dashboard_brand_name: "Demo",
        dashboard_brand_icon: null,
      },
      effective_branding: { brand_name: "Demo", brand_icon: null },
    },
  ];

  const customProperties: CustomPropertyDto[] = [
    prop("cprop_badge", "Badge Number", "employee.custom.badge_number", "string", "employee"),
    prop("cprop_branch", "Branch Code", "placement.custom.branch_code", "string", "placement"),
  ];

  const forms: FormDto[] = [
    form(
      "tlin_safety",
      "Client Safety Packet",
      ["placement.custom.branch_code"],
      [{ uid: "pcy_safety", name: "Safety Compliance", status: "active" }],
    ),
    form("tlin_handbook", "Employee Handbook", [], []),
  ];

  const policies: PolicyDto[] = [
    {
      id: "pcy_safety",
      name: "Safety Compliance",
      status: "active",
      description: "Require the safety packet for placements in regulated branches.",
      rules: {
        all: [{ fact: "placement.custom.branch_code", operator: "exists", value: true }],
      },
      created_at: TS,
      updated_at: TS,
      tags: [{ name: "compliance", color: null, is_inherited: false }],
      forms: [
        {
          id: "tlin_safety",
          name: "Client Safety Packet",
          ai_summary: null,
          ai_summary_generation_status: null,
        },
      ],
      ai_summary: null,
      ai_summary_generation_status: null,
    },
  ];

  const automationDetail: AutomationDetailDto = {
    id: "auto_welcome",
    name: "Welcome Email",
    description: "Email the employee when a placement task is created.",
    trigger_rerun_behavior: "never",
    is_dependent_on_create: true,
    trigger_entity: "task",
    dependencies: [{ entity: "task", property: "status" }],
    status: "published",
    version_number: 1,
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
        id: "n_email",
        position: { x: 0, y: 200 },
        name: "Send welcome email",
        action_type: "send_email",
        action_params: {
          params_type: "send_email",
          sendgrid_template_id: "tmpl_welcome",
          recipient_type: "employee",
        },
      },
    ],
    edges: [{ id: "e1", source: "n_start", target: "n_email", edge_type: "default" }],
  };

  const automations = [
    {
      detail: automationDetail,
      summary: {
        id: automationDetail.id,
        name: automationDetail.name,
        description: automationDetail.description,
        trigger_rerun_behavior: "never",
        is_dependent_on_create: true,
        trigger_entity: "task",
        dependencies: automationDetail.dependencies,
        status: "published",
        created_at: TS,
        auto_version_id: 1,
      } satisfies AutomationDto,
    },
  ];

  return { accounts, customProperties, forms, policies, automations };
}

function seedMinaData(): OnboardedSeed {
  const accounts: AccountDto[] = [
    {
      id: "acc_mina",
      is_test: true,
      organization: {
        uid: "org_mina",
        name: "Mina Care",
        connect_type: "direct",
        dashboard_brand_name: "Mina",
        dashboard_brand_icon: null,
      },
      effective_branding: { brand_name: "Mina", brand_icon: null },
    },
  ];

  const customProperties: CustomPropertyDto[] = [
    prop(
      "cprop_mina_license",
      "Clinician License",
      "employee.custom.clinician_license",
      "string",
      "employee",
    ),
    prop("cprop_mina_region", "Care Region", "placement.custom.care_region", "string", "placement"),
    prop(
      "cprop_mina_patient_acuity",
      "Patient Acuity",
      "job.custom.patient_acuity",
      "string",
      "job",
    ),
  ];

  const forms: FormDto[] = [
    form(
      "tlin_mina_clinician_profile",
      "Clinician Profile",
      ["employee.custom.clinician_license"],
      [{ uid: "pcy_mina_clinical_readiness", name: "Clinical Readiness", status: "active" }],
    ),
    form(
      "tlin_mina_site_orientation",
      "Site Orientation",
      ["placement.custom.care_region", "job.custom.patient_acuity"],
      [{ uid: "pcy_mina_clinical_readiness", name: "Clinical Readiness", status: "active" }],
    ),
    form(
      "tlin_mina_equipment_ack",
      "Equipment Acknowledgement",
      ["placement.custom.care_region"],
      [],
    ),
  ];

  const policies: PolicyDto[] = [
    {
      id: "pcy_mina_clinical_readiness",
      name: "Clinical Readiness",
      status: "active",
      description: "Require clinician and site readiness packets before high-acuity placements.",
      rules: {
        all: [
          { fact: "employee.custom.clinician_license", operator: "exists", value: true },
          { fact: "job.custom.patient_acuity", operator: "equal", value: "high" },
        ],
      },
      created_at: TS,
      updated_at: TS,
      tags: [{ name: "clinical", color: null, is_inherited: false }],
      forms: [
        {
          id: "tlin_mina_clinician_profile",
          name: "Clinician Profile",
          ai_summary: null,
          ai_summary_generation_status: null,
        },
        {
          id: "tlin_mina_site_orientation",
          name: "Site Orientation",
          ai_summary: null,
          ai_summary_generation_status: null,
        },
      ],
      ai_summary: null,
      ai_summary_generation_status: null,
    },
  ];

  const automationDetail: AutomationDetailDto = {
    id: "auto_mina_ready",
    name: "Notify Care Team",
    description: "Notify the care team when a high-acuity placement task is created.",
    trigger_rerun_behavior: "never",
    is_dependent_on_create: true,
    trigger_entity: "task",
    dependencies: [{ entity: "task", property: "status" }],
    status: "published",
    version_number: 1,
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
        id: "n_notify",
        position: { x: 0, y: 200 },
        name: "Notify care team",
        action_type: "send_email",
        action_params: {
          params_type: "send_email",
          sendgrid_template_id: "tmpl_mina_care_team",
          recipient_type: "employee",
        },
      },
    ],
    edges: [{ id: "e1", source: "n_start", target: "n_notify", edge_type: "default" }],
  };

  const automations = [
    {
      detail: automationDetail,
      summary: {
        id: automationDetail.id,
        name: automationDetail.name,
        description: automationDetail.description,
        trigger_rerun_behavior: "never",
        is_dependent_on_create: true,
        trigger_entity: "task",
        dependencies: automationDetail.dependencies,
        status: "published",
        created_at: TS,
        auto_version_id: 1,
      } satisfies AutomationDto,
    },
  ];

  return { accounts, customProperties, forms, policies, automations };
}

function prop(
  id: string,
  label: string,
  path: string,
  scalarType: CustomPropertyDto["scalarType"],
  entityType: string,
): CustomPropertyDto {
  return {
    id,
    name: label,
    path,
    scalarType,
    entityType,
    is_system_property: false,
    is_core_entity_api_resource: false,
    is_searchable: true,
    is_sensitive_info: false,
    is_permission_scope: false,
    auto_distribute_to_connected: false,
    label,
    description: undefined,
    created_at: TS,
    deprecated_at: null,
  };
}

function form(
  uid: string,
  name: string,
  attributePaths: readonly string[],
  policies: readonly { uid: string; name: string; status: string }[],
): FormDto {
  return {
    uid,
    name,
    description: null,
    access_type: "account",
    scope: { employer: false, client: true, job: false },
    access_role: null,
    latest_blueprint_version: {
      task_template_uid: `${uid}_v1`,
      status: "published",
      full_version: "1.0.0",
      major_version: 1,
      minor_version: 0,
      patch_version: 0,
    },
    tags: [],
    track_conversion: false,
    custom_attributes: null,
    attribute_scopes: attributePaths.map((field_path) => ({ field_path })),
    org_form_subscription: null,
    policies: [...policies],
    created_at: TS,
    updated_at: TS,
  };
}

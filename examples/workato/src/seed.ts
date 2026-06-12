import type {
  ConnectionConfig,
  FolderConfig,
  LookupTableConfig,
  PropertiesConfig,
  RecipeConfig,
} from "./schema";

export interface WorkatoSeed extends Readonly<Record<string, readonly unknown[]>> {
  readonly folders: readonly FolderConfig[];
  readonly connections: readonly ConnectionConfig[];
  readonly lookupTables: readonly LookupTableConfig[];
  readonly properties: readonly PropertiesConfig[];
  readonly recipes: readonly RecipeConfig[];
}

export const acmeWorkatoSeed: WorkatoSeed = {
  folders: [
    { id: "revops", name: "RevOps" },
    { id: "order-to-cash", name: "Order to Cash", parentId: "revops" },
    { id: "shared-functions", name: "Shared Functions", parentId: "revops" },
  ],
  connections: [
    { id: "salesforce-prod", name: "Salesforce (Prod)", adapter: "salesforce", folderId: "revops" },
    { id: "netsuite-prod", name: "NetSuite (Prod)", adapter: "netsuite", folderId: "revops" },
    { id: "slack-revops", name: "Slack #revops", adapter: "slack", folderId: "revops" },
    { id: "jira-it", name: "Jira (IT)", adapter: "jira", folderId: "shared-functions" },
  ],
  lookupTables: [
    {
      id: "region-routing",
      name: "Region Routing",
      columns: ["region", "ownerEmail", "slackChannel"],
      rows: [
        { region: "AMER", ownerEmail: "amer-ae@acme.example", slackChannel: "#revops-amer" },
        { region: "EMEA", ownerEmail: "emea-ae@acme.example", slackChannel: "#revops-emea" },
        { region: "APAC", ownerEmail: "apac-ae@acme.example", slackChannel: "#revops-apac" },
      ],
    },
    {
      id: "sla-tiers",
      name: "SLA Tiers",
      columns: ["tier", "responseHours"],
      rows: [
        { tier: "enterprise", responseHours: "4" },
        { tier: "standard", responseHours: "24" },
      ],
    },
  ],
  properties: [
    {
      id: "acme-revops",
      name: "Acme RevOps",
      values: {
        default_currency: "USD",
        erp_subsidiary: "Acme US",
        triage_channel: "#revops-triage",
      },
    },
  ],
  recipes: [
    {
      id: "order-to-cash",
      name: "Order to Cash",
      description:
        "Provision a closed-won opportunity end to end: route by region, batch order lines into NetSuite with monitored error handling, then fan out notifications through recipe functions.",
      folderId: "order-to-cash",
      trigger: {
        adapter: "salesforce",
        event: "object_updated",
        connectionId: "salesforce-prod",
        input: {
          object: "Opportunity",
          condition: "StageName == 'Closed Won'",
        },
      },
      steps: [
        {
          keyword: "lookup",
          name: "Route region",
          tableId: "region-routing",
          match: { region: "=_('trigger.opportunity.Region__c')" },
        },
        {
          keyword: "if",
          condition: "=_('steps.route_region.found')",
          then: [
            {
              keyword: "foreach",
              source: "=_('trigger.opportunity.LineItems')",
              batchSize: 50,
              steps: [
                {
                  keyword: "handle_errors",
                  retries: 2,
                  monitor: [
                    {
                      keyword: "action",
                      name: "Create sales order line",
                      adapter: "netsuite",
                      operation: "create_sales_order_line",
                      connectionId: "netsuite-prod",
                      input: {
                        subsidiary: "=_('properties.erp_subsidiary')",
                        sku: "=_('foreach.item.ProductCode')",
                        quantity: "=_('foreach.item.Quantity')",
                        currency: "=_('properties.default_currency')",
                      },
                    },
                  ],
                  rescue: [
                    {
                      keyword: "action",
                      name: "Alert region channel",
                      adapter: "slack",
                      operation: "post_message",
                      connectionId: "slack-revops",
                      input: {
                        channel: "=_('steps.route_region.row.slackChannel')",
                        text: "Order line failed for =_('foreach.item.ProductCode')",
                      },
                    },
                    {
                      keyword: "call_recipe",
                      recipeId: "escalate-failed-order",
                      input: {
                        opportunityId: "=_('trigger.opportunity.Id')",
                        severity: "high",
                      },
                    },
                    { keyword: "stop", reason: "Order line could not be provisioned" },
                  ],
                },
              ],
            },
            {
              keyword: "call_recipe",
              recipeId: "notify-account-team",
              input: {
                ownerEmail: "=_('steps.route_region.row.ownerEmail')",
                opportunityId: "=_('trigger.opportunity.Id')",
              },
            },
          ],
          else: [
            {
              keyword: "action",
              name: "Flag unrouted region",
              adapter: "slack",
              operation: "post_message",
              connectionId: "slack-revops",
              input: {
                channel: "=_('properties.triage_channel')",
                text: "No routing row for =_('trigger.opportunity.Region__c')",
              },
            },
            { keyword: "stop", reason: "Unknown sales region" },
          ],
        },
      ],
    },
    {
      id: "notify-account-team",
      name: "Notify Account Team",
      description: "Recipe function: announce a provisioned order to its account team.",
      folderId: "shared-functions",
      trigger: {
        adapter: "workato",
        event: "recipe_function_call",
        input: { parameters: "ownerEmail, opportunityId" },
      },
      steps: [
        {
          keyword: "action",
          name: "Post win announcement",
          adapter: "slack",
          operation: "post_message",
          connectionId: "slack-revops",
          input: {
            channel: "@=_('input.ownerEmail')",
            text: "Opportunity =_('input.opportunityId') is fully provisioned.",
          },
        },
      ],
    },
    {
      id: "escalate-failed-order",
      name: "Escalate Failed Order",
      description: "Recipe function: open a Jira incident and page the triage channel.",
      folderId: "shared-functions",
      trigger: {
        adapter: "workato",
        event: "recipe_function_call",
        input: { parameters: "opportunityId, severity" },
      },
      steps: [
        {
          keyword: "action",
          name: "Open incident",
          adapter: "jira",
          operation: "create_issue",
          connectionId: "jira-it",
          input: {
            project: "REVOPS",
            summary: "Order provisioning failed for =_('input.opportunityId')",
            priority: "=_('input.severity')",
          },
        },
        {
          keyword: "if",
          condition: "=_('input.severity') == 'high'",
          then: [
            {
              keyword: "action",
              name: "Page triage channel",
              adapter: "slack",
              operation: "post_message",
              connectionId: "slack-revops",
              input: {
                channel: "=_('properties.triage_channel')",
                text: "High-severity order failure: =_('input.opportunityId')",
              },
            },
          ],
        },
      ],
    },
  ],
};

export const workatoSeeds = { acme: acmeWorkatoSeed } as const satisfies Record<
  string,
  WorkatoSeed
>;
export type WorkatoSeedName = keyof typeof workatoSeeds;

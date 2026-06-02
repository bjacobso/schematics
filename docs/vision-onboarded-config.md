# Vision: Schema IDE and Onboarded Config

## North Star

This repo is building a schema-governed workspace where humans, LLM agents, and
runtime systems collaborate on structured configuration without making the LLM
the source of truth.

For Onboarded, the goal is to turn implementation requirements into staged
account configuration that technical and non-technical teammates can inspect,
edit, validate, review, and eventually deploy through controlled Onboarded APIs.

## Repo Purpose

Schema IDE is the general-purpose foundation. It provides a schema-routed
virtual filesystem, continuous validation, structured diagnostics, relation
graphs, an IDE surface, and bounded agent tools for editing files under an
Effect Schema contract.

The repo should prove that a domain team can define a typed workspace once and
use it in three places:

1. locally, through a CLI;
2. interactively, through the Schema IDE web UI;
3. programmatically, through agents and future deploy adapters.

## Onboarded Config

`@schema-ide/onboarded-config` is the first Onboarded-specific domain package.
Its job is to make an account implementation reviewable and valid before it is
deployed.

The `onboarded-config` binary packages the Onboarded workspace schema with the
Schema IDE runtime. It should accelerate account configuration by giving the
team one portable command that can:

- validate an account workspace on disk;
- serve the same workspace in the browser;
- support LLM-assisted edits inside the workspace contract;
- report broken references across forms, attributes, policies, automations, and
  PDF mappings;
- generate a dry-run deploy plan for a test or staging account.

The binary should compile valid workspace state into product-level deployment
intent. It should not write directly to tables. The deployment boundary should
stay at Onboarded APIs or service adapters.

## Staged Account Flow

```text
implementation requirements
  -> account workspace files
  -> Schema IDE + LLM-assisted authoring
  -> validation and relation diagnostics
  -> reviewed deploy plan
  -> staged Onboarded account
  -> controlled live deployment
```

The workspace is intentionally more ergonomic than a mirror of production
tables. It uses domain files such as `account.yaml`, `attributes.yaml`,
`forms/*.yaml`, `policies/*.yaml`, `automations/*.yaml`, `documents/*`,
`pdf-mappings/*.yaml`, and `imports/*.yaml`, then compiles toward Onboarded
concepts such as accounts, task lineages, task versions, form exports, policy
forms, integrations, and distribution strategies.

## Implementation Workflow

The workspace should be able to absorb source material from any implementation
pipeline or discovery process:

```text
source requirements, documents, forms, and integration notes
  -> extracted facts and generated artifacts
  -> account workspace files
  -> schema validation and human review
```

`onboarded-config` should turn those inputs into a broader account workspace:

```text
implementation inputs and generated artifacts
  -> account.yaml
  -> attributes.yaml
  -> forms/*.yaml
  -> documents/* and pdf-mappings/*.yaml
  -> policies/*.yaml
  -> automations/*.yaml
  -> imports/*.yaml
  -> staged account deploy plan
```

That creates a practical loop: capture requirements, let an LLM draft or update
workspace files, validate the account graph, review the deploy plan with
implementation and operations teammates, create a staged/test account, and
promote only reviewed changes toward live deployment.

## Why It Matters

This makes implementation state explicit. Instead of requirements living across
calls, generated files, scripts, and production admin clicks, the staged account
becomes a typed workspace with history, diagnostics, and reviewable diffs.

Technical teammates get a deterministic contract between source pipelines,
Onboarded APIs, and deployment. Non-technical teammates get a shared artifact
they can review at the level of forms, policies, mappings, integrations, and
account behavior. Agents get a bounded environment where they can help convert
requirements into configuration while Schema IDE enforces the contract.

## Near-Term Success

- Generate an account workspace from implementation requirements and source
  artifacts.
- Validate broken form, attribute, policy, automation, and PDF mapping
  references with `onboarded-config validate`.
- Inspect and edit the same workspace in the browser with `onboarded-config web`.
- Let an LLM propose changes and receive validation feedback.
- Produce a dry-run deploy plan for a staged Onboarded account.

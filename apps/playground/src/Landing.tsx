// Marketing landing page for Schematics.
//
// It opens with the ambitious collapse thesis (every system reduces to files ×
// schemas × relations × tools × a DAG), then derives that claim from first
// principles: each "rung" adds exactly one idea and one ASCII diagram, climbing
// from the bare filesystem (the 40-year-old knowledge primitive that only
// stores blobs) to the full architecture — so a technical reader earns every
// box in the final diagram. After the ladder, three evaluator sections
// (the code, the guarantees, before-you-bet-on-it) speak to an engineer sizing
// this up as the agent harness for their own config-as-code.
// The aesthetic is a deliberate blueprint/terminal: monospace diagrams as
// first-class art, an engineering grid, scroll-revealed sections.
//
// Imports NO IDE/editor modules, so it stays out of the heavy playground bundle
// (the IDE is lazy-loaded at /playground). The only runtime JS is a tiny
// IntersectionObserver reveal and a hero typewriter — both degrade gracefully.

import type { ReactNode } from "react";
import { Ascii, Hi } from "./landing/Ascii";
import { Reveal } from "./landing/useReveal";
import { Terminal } from "./landing/Terminal";

const GITHUB_URL = "https://github.com/bjacobso/schematics";

const concepts = [
  {
    term: "Artifact",
    body: "Anything addressable by a ref — a file, blob, or remote object — routed to a schema that defines how it parses, validates, and renders.",
  },
  {
    term: "Algebra",
    body: "A schema-native relation layer. Schemas declare ids, refs, and scoped references; the algebra extracts a relation graph and validates rule facts against it, powering autocomplete, go-to-definition, rename, and impact analysis.",
  },
  {
    term: "Alchemy",
    body: "The provisioning engine. Providers define CRUD per entity kind; a lockfile keeps slug ↔ remote-ID identity stable across pull / plan / apply / destroy.",
  },
  {
    term: "Provider",
    body: "A named external system plus the resources it manages. defineResource describes each file-level resource; defineProvider derives the artifact project, workspace schema, relation diagnostics, mock transport, deploy service, and CLI wiring.",
  },
  {
    term: "Reflection & diagnostics",
    body: "Continuous, structured validation output — parsed values, route matches, and errors — that is first-class and consumed identically by the UI and the agent's tools.",
  },
  {
    term: "Direct vs Plan mode",
    body: "Agents either apply validated multi-file edits immediately (direct) or propose a patch for human approval before anything is written (plan).",
  },
];

const audiences = [
  [
    "Startups building a config plane",
    "plans, flags, policies, and workflows as typed files from day one — the agent surface comes derived, not bolted on",
  ],
  [
    "Config / IaC tooling teams",
    "agents editing Terraform, Helm, k8s, or Pulumi with schema-driven validation",
  ],
  [
    "Form & CMS builders",
    "schema as the source of truth, with AI authoring of forms, templates, and layouts",
  ],
  [
    "Prompt & eval shops",
    "prompts, datasets, and evals as files where the schema is the eval contract",
  ],
  ["DSL authors", "domain languages that need an authoring UI without writing the UI"],
  [
    "MCP server authors",
    "the agent tool surface maps cleanly to MCP; ship one contract to any client",
  ],
] as const;

const stack = [
  "Effect & Effect Schema",
  "TypeScript",
  "React 19",
  "CodeMirror",
  "isomorphic-git",
  "Cloudflare Workers & Durable Objects",
  "Alchemy v2",
];

function Cta({ size = "base" }: { size?: "base" | "sm" }) {
  const pad = size === "sm" ? "px-4 py-2 text-sm" : "px-5 py-2.5 text-sm";
  return (
    <div className="flex flex-wrap gap-3">
      <a
        href="/playground"
        className={`rounded-md bg-foreground font-semibold text-background transition-opacity hover:opacity-90 ${pad}`}
      >
        Open the playground
      </a>
      <a
        href={GITHUB_URL}
        className={`rounded-md border border-border font-semibold transition-colors hover:bg-secondary ${pad}`}
      >
        View on GitHub
      </a>
    </div>
  );
}

// One step of the first-principles climb: a numbered kicker, a claim, prose,
// and the diagram that makes the claim concrete.
function Rung({
  n,
  kicker,
  title,
  children,
  diagram,
}: {
  n: number;
  kicker: string;
  title: string;
  children: ReactNode;
  diagram: ReactNode;
}) {
  return (
    <Reveal>
      <section className="flex flex-col gap-5 border-t border-border pt-10">
        <div className="flex items-baseline gap-3 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          <span className="text-primary">{String(n).padStart(2, "0")}</span>
          <span>{kicker}</span>
        </div>
        <h2 className="text-2xl font-semibold leading-snug">{title}</h2>
        <div className="flex flex-col gap-3 text-muted-foreground">{children}</div>
        <div className="mt-1 rounded-lg border border-border bg-card p-4 sm:p-5">{diagram}</div>
      </section>
    </Reveal>
  );
}

export default function Landing() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <header className="relative overflow-hidden border-b border-border">
        <div className="blueprint-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto flex max-w-3xl flex-col gap-7 px-6 pb-16 pt-20 sm:pt-28">
          <div className="brandmark">Schematics</div>

          <Terminal />

          {/* Pinned, full, static heading — the landing e2e asserts on this. */}
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
            Every system collapses to the same shape: files, schemas, relations, and a DAG.
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            Infrastructure already collapsed to this shape; the rest of software config is
            following, because agents are the forcing function — a model can&apos;t safely drive a
            web console, but it can edit typed files behind schema-checked tools and show you a
            plan. Schematics is the harness for that endgame: define each resource as an Effect
            Schema once, and derive the IDE, the agent tool surface, and the Terraform-style
            deploy loop from the same contract.
          </p>
          <Cta />
          <p className="font-mono text-xs text-muted-foreground">
            ↓ scroll — a big claim, then nine steps that earn it from first principles
          </p>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-12 px-6 py-16">
        {/* ── 00 · the claim ─────────────────────────────────────────────── */}
        <Rung
          n={0}
          kicker="The claim"
          title="Five primitives, hiding under every vendor UI."
          diagram={
            <Ascii label="Five different products — terraform, contentful, prompt libraries, salesforce, zapier — collapse into one machine made of files, schemas, relations, tools, and a DAG.">
              {`   terraform   contentful   prompt libs   salesforce   zapier
       └───────────┴─────────────┴────────────┴──────────┘
                                 ▼
        `}
              <Hi>{`files  ·  schemas  ·  relations  ·  tools  ·  DAG`}</Hi>
              {`
       (state)   (meaning)     (graph)     (change)  (deploy)`}
            </Ascii>
          }
        >
          <p>
            Pick any system a team operates through a web console. Its state is a tree of named
            records — a <strong>filesystem</strong>. Every record has a shape — a{" "}
            <strong>schema</strong>. Records point at each other — <strong>relations</strong>,
            which make the tree a graph. Every change arrives through an API call — a{" "}
            <strong>tool</strong>. And making changes real means executing them in dependency
            order — a <strong>DAG</strong>.
          </p>
          <p>
            Each vendor rebuilds those five primitives behind its own UI, slightly differently,
            with the meaning locked inside. And the collapse is already underway, one domain at a
            time: infrastructure became Terraform, CI became YAML in the repo, Kubernetes made the
            API objects themselves files. Every serious platform now grows an as-code surface,
            because config wants what code already has — diff, review, revert, CI.
          </p>
          <p>
            Agents finish the argument. A model driving a web console is unauditable; a model
            editing typed files behind schema-checked tools produces patches you can review and
            plans you can approve. Every domain of config converges here — the only question is
            whether you build the harness yourself or adopt one. Schematics builds the five
            primitives once, in the open, and hands the same contract to the human, the agent, and
            the runtime. The steps below derive each primitive from scratch, starting with a
            single file.
          </p>
        </Rung>

        {/* ── 01 · the filesystem ────────────────────────────────────────── */}
        <Rung
          n={1}
          kicker="The substrate"
          title="The filesystem is the oldest agent interface — and it only gives you blobs."
          diagram={
            <Ascii label="The filesystem gives you blobs; Schematics layers on schema, context-aware functions, relations, a DAG, a reconciler, and version-control history — each mapped to the step that derives it.">
              {`the filesystem gives you   blobs — named bytes in a tree

schematics layers on
  + `}
              <Hi>{`schema`}</Hi>
              {`        what the bytes mean                       02–04
  + `}
              <Hi>{`functions`}</Hi>
              {`     context-aware tools, scoped per file      05
  + `}
              <Hi>{`relations`}</Hi>
              {`     the reference graph between files         06
  + `}
              <Hi>{`DAG`}</Hi>
              {`           dependency-ordered materialization        07
  + `}
              <Hi>{`reconciler`}</Hi>
              {`    live system ↔ files, drift detection      07
  + `}
              <Hi>{`history`}</Hi>
              {`       version-control semantics                 08`}
            </Ascii>
          }
        >
          <p>
            Forty years of knowledge work runs on one primitive: named files in a tree. It is also
            the one interface agents already speak natively — coding agents are effective precisely
            because their whole world is a filesystem they can list, read, grep, and write. Your
            config deserves the same substrate:
          </p>
          <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
            <Ascii label="An example config tree: plans, features, and policies directories holding YAML files, plus a config lockfile.">
              {`billing/
├── plans/
│   ├── free.yaml
│   └── enterprise.yaml
├── features/
│   ├── sso.yaml
│   └── audit-log.yaml
├── policies/
│   └── eu-data.yaml
└── config.lock.json

ls · cat · grep · mv — the same interface since 1984`}
            </Ascii>
          </div>
          <p>
            But the filesystem&apos;s contract is deliberately thin: it stores <strong>blobs</strong>
            . To the kernel, <code className="font-mono">plans/enterprise.yaml</code> and a JPEG are
            the same thing — named bytes. No schema. No knowledge that{" "}
            <code className="font-mono">enterprise.yaml</code> references{" "}
            <code className="font-mono">sso.yaml</code>. No operations beyond read and write. No
            relationship to the live system the files describe, and no history unless you bolt git
            on. Most AI config tools stop exactly here: the model edits bytes, and you find out at
            apply time — when it is most expensive to be wrong — whether the bytes meant anything.
          </p>
          <p>Schematics keeps the filesystem and layers on everything it never gave you:</p>
        </Rung>

        {/* ── 02 · schema ────────────────────────────────────────────────── */}
        <Rung
          n={2}
          kicker="Meaning"
          title="A file has a shape — and that shape is a schema."
          diagram={
            <Ascii label="Bytes are parsed through an Effect Schema into a typed value or an error.">
              {`bytes ──▶ parse ──▶ `}
              <Hi>{`┌──────────┐`}</Hi>
              {`
                    `}
              <Hi>{`│  Schema  │`}</Hi>
              {` ──▶ value  ✓
                    `}
              <Hi>{`└──────────┘`}</Hi>
              {` ──▶ error  ✗

Schema.Struct({ id: Schema.String, name: Schema.String })`}
            </Ascii>
          }
        >
          <p>
            In Schematics every file is routed to an <strong>Effect Schema</strong>. The schema is
            not a validator bolted on the side — it is the single value that knows how to decode the
            bytes, encode them back, and describe what counts as valid.
          </p>
          <details className="rounded-md border border-border bg-muted/50 p-4 font-sans">
            <summary className="cursor-pointer font-medium text-foreground">
              New to Effect Schema? (60-second recap)
            </summary>
            <div className="mt-3 flex flex-col gap-3 text-sm text-muted-foreground">
              <p>
                An <code className="font-mono">effect/Schema</code> is one value that bundles decode
                + encode + validation for a type. You define the shape once and get parsing, error
                reporting, and a derived JSON Schema for free.
              </p>
              <Ascii label="Example of decoding a value with Effect Schema, showing a success and a failure.">
                {`import { Schema } from "effect"

const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})

Schema.decodeUnknownSync(User)({ id: "alice", name: "Alice" })
`}
                <span className="diff-add">{`// ✓ { id: "alice", name: "Alice" }`}</span>
                {`

Schema.decodeUnknownSync(User)({ id: "alice" })
`}
                <span className="diff-del">{`// ✗ Missing required key "name"`}</span>
              </Ascii>
              <p>
                Schematics treats that one value as the contract. Everything below falls out of
                taking it seriously.
              </p>
            </div>
          </details>
        </Rung>

        {/* ── 03 · routing ───────────────────────────────────────────────── */}
        <Rung
          n={3}
          kicker="Addressing"
          title="Which schema applies? Glob routes decide."
          diagram={
            <Ascii label="File path globs route to schemas: users to UserSchema, forms to FormSchema, policies to PolicySchema.">
              {`           glob route          schema
`}
              <Hi>{`users/*.yaml`}</Hi>
              {`     ──▶  UserSchema
`}
              <Hi>{`forms/*.json`}</Hi>
              {`     ──▶  FormSchema
`}
              <Hi>{`policies/*.yml`}</Hi>
              {`   ──▶  PolicySchema

a project is a set of (route → schema) rules`}
            </Ascii>
          }
        >
          <p>
            Files are addressed by <strong>artifact refs</strong> and matched to schemas by glob. An{" "}
            <code className="font-mono">ArtifactProject</code> is just the set of those route rules
            — the same contract React, the CLI, protocol clients, and agent tools all read.
          </p>
        </Rung>

        {/* ── 04 · reflection ────────────────────────────────────────────── */}
        <Rung
          n={4}
          kicker="The stream"
          title="Validation isn't a final step. It's a continuous stream."
          diagram={
            <Ascii label="An artifact continuously produces a reflection: parsed value, route match, and diagnostics.">
              {`              ┌─ parsed value
   artifact ──▶ ┼─ route match     ──▶ `}
              <Hi>{`reflection`}</Hi>
              {`
              └─ diagnostics            (continuous)

every keystroke re-derives it. nothing is stale.`}
            </Ascii>
          }
        >
          <p>
            As files change, each artifact emits a structured{" "}
            <code className="font-mono">SchematicsReflection</code> — parsed values, route matches,
            and diagnostics. It is first-class data, not a lint pass. The same reflection feeds the
            editor&apos;s squiggles and the agent&apos;s next decision.
          </p>
        </Rung>

        {/* ── 05 · the trinity (payoff frame) ────────────────────────────── */}
        <Rung
          n={5}
          kicker="The thesis"
          title="One schema. Three readers. The same contract."
          diagram={
            <Ascii label="A single schema is read by three consumers: the human UI, the agent's tools, and the deploy runtime.">
              {`                 `}
              <Hi>{`┌────────┐`}</Hi>
              {`
                 `}
              <Hi>{`│ SCHEMA │`}</Hi>
              {`
                 `}
              <Hi>{`└───┬────┘`}</Hi>
              {`
        ┌────────────┼────────────┐
        ▼            ▼            ▼
     human        agent       runtime
    (the UI)    (its tools)   (deploy)

   one contract — not three implementations`}
            </Ascii>
          }
        >
          <p>
            This is the whole idea. The human editing in the UI, the agent calling tools, and the
            runtime planning a deploy all read the <em>same</em> schema. No drift between what the
            UI shows, what the agent believes, and what actually ships.
          </p>
          <p>
            This is also where the filesystem&apos;s read/write pair becomes{" "}
            <strong>context-aware functions</strong>. The agent&apos;s tools —{" "}
            <code className="font-mono">list_artifacts</code>,{" "}
            <code className="font-mono">read_artifact_view</code>,{" "}
            <code className="font-mono">write_artifact_source</code>,{" "}
            <code className="font-mono">propose_patch</code> — are scoped to what each file{" "}
            <em>is</em>: <code className="font-mono">get_artifact_capabilities</code> answers
            &quot;what can be done to this artifact?&quot; from its schema and declared views, and
            every call is checked against that contract before an edit ever lands.
          </p>
        </Rung>

        {/* ── 06 · algebra ───────────────────────────────────────────────── */}
        <Rung
          n={6}
          kicker="Relations"
          title="Files reference each other. The algebra knows the graph."
          diagram={
            <Ascii label="A Workflow's actionIds reference Action ids; the algebra derives rename, go-to-definition, find-references, and impact analysis.">
              {`  Workflow ─`}
              <Hi>{`actionIds`}</Hi>
              {`──▶ Action
     id        (refs)        id
  ───────────────────────────────────
  derived:  rename · go-to-def
            find-refs · impact analysis`}
            </Ascii>
          }
        >
          <p>
            Schemas declare <code className="font-mono">Relation.id</code> and{" "}
            <code className="font-mono">Relation.refs</code>. From those annotations,{" "}
            <code className="font-mono">@schematics/algebra</code> extracts a relation graph and
            validates duplicate ids, unresolved references, and scoped refs — then derives
            cross-file rename, go-to-definition, and impact analysis from the same declarations.
          </p>
        </Rung>

        {/* ── 07 · alchemy ───────────────────────────────────────────────── */}
        <Rung
          n={7}
          kicker="Materialization"
          title="Files become live systems. Pull, plan, apply, destroy."
          diagram={
            <Ascii label="The Alchemy loop runs pull, plan, apply, destroy. A sample plan shows one modify, one create, and one delete.">
              {`  pull ─▶ `}
              <Hi>{`plan`}</Hi>
              {` ─▶ apply ─▶ destroy
              │
              ▼  plan output
  `}
              <span className="diff-mod">{`~ form:onboarding    name  "Sign up" → "Get started"`}</span>
              {`
  `}
              <span className="diff-add">{`+ policy:gdpr        create`}</span>
              {`
  `}
              <span className="diff-del">{`- automation:stale   delete`}</span>
              {`

  3 changes · applied in dependency order`}
            </Ascii>
          }
        >
          <p>
            <code className="font-mono">@schematics/alchemy</code> mimics Terraform/Pulumi&apos;s
            lifecycle from first principles — but the &quot;cloud&quot; is any config API and the
            desired state is your artifact files. Providers speak{" "}
            <code className="font-mono">list / read / create / update / delete</code>; a lockfile
            keeps human slugs ↔ opaque remote IDs stable across the loop. It is a{" "}
            <strong>reconciler</strong> in both directions: <code className="font-mono">pull</code>{" "}
            hydrates files from the live system, <code className="font-mono">apply</code> pushes
            them back, and drift between the two is detected rather than discovered.
          </p>
          <p>
            The diff is a <strong>schema-value</strong> diff, not a text diff — so a plan means what
            the schema says it means. And the relation graph from step 06 gives the apply its
            order: the plan executes as a <strong>DAG</strong>, dependencies first. That is the
            last primitive from the claim, derived rather than asserted.
          </p>
        </Rung>

        {/* ── 08 · runtimes ──────────────────────────────────────────────── */}
        <Rung
          n={8}
          kicker="Portability"
          title="One contract, three places it can run."
          diagram={
            <Ascii label="Three runtimes — local serve with an FsStore and git, the in-browser playground memory store, and Cloudflare Durable Objects per workspace — all share one RPC contract.">
              {`  local serve      playground       cloudflare
  ┌───────────┐   ┌───────────┐   ┌───────────┐
  │ FsStore   │   │ MemStore  │   │ DO + git  │
  │ + git     │   │ in-browser│   │ per ws    │
  └───────────┘   └───────────┘   └───────────┘
        └───────────────┴───────────────┘
        same RPC contract · same agent loop
              only the store moves`}
            </Ascii>
          }
        >
          <p>
            The constant across every mode is the artifact-project RPC contract and the browser-side
            agent loop. Run it locally (every change is a git commit), entirely in your browser (the
            playground — including a deploy against a mock API), or hosted on Cloudflare where each
            workspace is a Durable Object mirrored to its own git repo. Only the store
            implementation changes.
          </p>
          <p>
            This is also the history layer from step 01 paying off: version-control semantics —
            commits, diffs, a timeline you can scrub — ride along with the store instead of being a
            separate product, because the substrate never stopped being files.
          </p>
        </Rung>

        {/* ── 09 · the whole machine ─────────────────────────────────────── */}
        <Rung
          n={9}
          kicker="The whole machine"
          title="Now the full diagram is legible."
          diagram={
            <Ascii label="Architecture: the playground depends on the ide, which sits on core, agent, and ui; agent talks to protocol, which the server serves; algebra and alchemy are the semantic and deploy layers.">
              {`              playground
                  │
                  ▼
            @schematics/`}
              <span className="pkg">ide</span>
              {`
            ┌──────┼──────┐
            ▼      ▼      ▼
          `}
              <span className="pkg">core</span>
              {`   `}
              <span className="pkg">agent</span>
              {`    `}
              <span className="pkg">ui</span>
              {`
                   │
                   ▼
               `}
              <span className="pkg">protocol</span>
              {` ◀──── `}
              <span className="pkg">server</span>
              {`

      `}
              <span className="pkg">algebra</span>
              {`  ·  `}
              <span className="pkg">alchemy</span>
              {`
      (semantic + deploy layers)`}
            </Ascii>
          }
        >
          <p>
            Every box is something you met on the way down: the schema contract (02–05), the
            relation algebra (06), the deploy engine (07), and the runtimes (08). The{" "}
            <code className="font-mono">&lt;Schematics /&gt;</code> React component renders the
            editor, form views, file tree, diagnostics, timeline, and agent chat for any
            schema-routed project out of the box.
          </p>
        </Rung>

        {/* ── The code you'd actually write ──────────────────────────────── */}
        <Reveal>
          <section className="flex flex-col gap-5 border-t border-border pt-10">
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              ▣ the code
            </div>
            <h2 className="text-2xl font-semibold leading-snug">
              What you actually write: schemas and a connection. Everything else is derived.
            </h2>
            <div className="flex flex-col gap-3 text-muted-foreground">
              <p>
                Suppose your startup&apos;s config plane is billing: plans that bundle features,
                live in some internal API today, edited through an admin console. Here is the
                entire authoring surface to bring it under Schematics — real API, not pseudocode:
              </p>
            </div>
            <div className="mt-1 rounded-lg border border-border bg-card p-4 sm:p-5">
              <Ascii label="A complete provider definition: two Effect Schemas with relation annotations, two defineResource calls, and one defineProvider call.">
                {`import { Schema } from "effect"
import { Relation } from "@schematics/algebra"
import { defineProvider, defineResource } from "@schematics/provider"

const FeatureSchema = Schema.Struct({
  id: `}
                <Hi>{`Relation.id("feature", { display: "name" })`}</Hi>
                {`,
  name: Schema.String,
})

const PlanSchema = Schema.Struct({
  id: Relation.id("plan", { display: "name" }),
  name: Schema.String,
  featureIds: `}
                <Hi>{`Relation.refs("feature", { edge: "includes" })`}</Hi>
                {`,
})

export const billing = defineProvider({
  id: "billing",
  projectId: "billing-config",
  resources: [
    defineResource<typeof FeatureSchema.Type>({
      kind: "feature", schemaId: "Features", schema: FeatureSchema,
    }),
    defineResource<typeof PlanSchema.Type>({
      kind: "plan", schemaId: "Plans", schema: PlanSchema,
    }),
  ],
  connection: BILLING_CONNECTION, // list/read/create/update/delete
})`}
              </Ascii>
            </div>
            <div className="flex flex-col gap-3 text-muted-foreground">
              <p>
                From those declarations, <code className="font-mono">defineProvider</code> derives
                the rest of the machine:
              </p>
            </div>
            <div className="mt-1 rounded-lg border border-border bg-card p-4 sm:p-5">
              <Ascii label="The fields derived from defineProvider: project routes, workspace schema, relation diagnostics, mock transport, deploy service, IDE flavor, and CLI wiring.">
                {`billing.`}
                <Hi>{`project`}</Hi>
                {`           glob routes: features/*.yaml, plans/*.yaml
billing.`}
                <Hi>{`workspaceSchema`}</Hi>
                {`   the whole tree as one typed value
billing.`}
                <Hi>{`diagnostics`}</Hi>
                {`       relation graph: dup ids, unresolved refs
billing.`}
                <Hi>{`mock`}</Hi>
                {`              in-memory transport for tests + playground
billing.`}
                <Hi>{`deploy`}</Hi>
                {`            pull / plan / apply / destroy service
billing.`}
                <Hi>{`flavor`}</Hi>
                {`            a drop-in <Schematics /> IDE instance
+ CLI wiring              validate / pull / plan / apply from a binary`}
              </Ascii>
            </div>
            <p className="text-sm text-muted-foreground">
              The schemas are the only domain knowledge you supply. Add a field, and the form view,
              the agent&apos;s completions, the diff, and the plan all know about it — there is no
              second place to update.
            </p>
          </section>
        </Reveal>

        {/* ── The harness contract ───────────────────────────────────────── */}
        <Reveal>
          <section className="flex flex-col gap-6 border-t border-border pt-10">
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              ▣ the guarantees
            </div>
            <h2 className="text-2xl font-semibold leading-snug">
              What an agent harness owes you — and how this one pays.
            </h2>
            <dl className="flex flex-col gap-5">
              <div className="flex flex-col gap-1">
                <dt className="font-semibold">No invalid write can land.</dt>
                <dd className="text-muted-foreground">
                  The agent&apos;s surface is{" "}
                  <code className="font-mono">
                    list_artifacts · get_artifact_capabilities · read_artifact_view ·
                    write_artifact_source · apply_edits · propose_patch
                  </code>
                  . Every write decodes through the schema at the tool boundary; failures return
                  structured diagnostics to the model instead of corrupting state.{" "}
                  <code className="font-mono">apply_edits</code> is atomic across files with
                  validation rollback.
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="font-semibold">Trust levels are enforced by the tool surface.</dt>
                <dd className="text-muted-foreground">
                  Direct mode exposes writes. Plan mode exposes read-only tools plus{" "}
                  <code className="font-mono">propose_patch</code> — the agent structurally cannot
                  write; a human reviews and applies the patch. Not a system-prompt convention, a
                  different tool list.
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="font-semibold">The agent sees exactly what you see.</dt>
                <dd className="text-muted-foreground">
                  One reflection stream — parsed values, route matches, diagnostics — feeds the
                  editor&apos;s squiggles and the model&apos;s next decision. There is no second
                  source of truth for the agent to drift from.
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="font-semibold">Blast radius is computable.</dt>
                <dd className="text-muted-foreground">
                  Relations are schema declarations, so &quot;what breaks if I rename this?&quot;
                  is a graph query over the algebra, not a grep. Impact analysis, find-references,
                  and safe rename all read the same annotations.
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="font-semibold">Nothing ships without a plan.</dt>
                <dd className="text-muted-foreground">
                  Deploy diffs are schema-value diffs, not text diffs. Apply executes the relation
                  DAG dependencies-first with optimistic-concurrency guards, and the lockfile maps
                  human slugs to opaque remote ids — so a rename is a rename, not a delete + create.
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="font-semibold">No model lock-in.</dt>
                <dd className="text-muted-foreground">
                  <code className="font-mono">SchematicsChatAdapter</code> is a small contract: an
                  OpenRouter proxy server ships in the box, plus a typed HTTP client and a local
                  debug adapter. The tool surface maps cleanly onto MCP, so the same contract can
                  serve any client.
                </dd>
              </div>
            </dl>
          </section>
        </Reveal>

        {/* ── Honest adoption notes ──────────────────────────────────────── */}
        <Reveal>
          <section className="flex flex-col gap-5 border-t border-border pt-10">
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              ▣ before you bet on it
            </div>
            <h2 className="text-2xl font-semibold leading-snug">
              What you should know before building on this.
            </h2>
            <ul className="flex flex-col gap-3 text-muted-foreground">
              <li>
                <strong className="text-foreground">It is pre-1.0.</strong> Consumption today is a
                git submodule, not npm; breaking changes are expected and versions should be
                pinned. The consumer path is documented and exercised by the in-repo examples.
              </li>
              <li>
                <strong className="text-foreground">It is TypeScript- and Effect-native.</strong>{" "}
                Schemas are <code className="font-mono">effect/Schema</code>, services are{" "}
                <code className="font-mono">Context.Tag</code> layers. If your stack speaks Effect
                this is home; if not, the schema layer is the learning curve.
              </li>
              <li>
                <strong className="text-foreground">Your provider is the integration work.</strong>{" "}
                You own the <code className="font-mono">list / read / create / update / delete</code>{" "}
                transport against your API. Everything above it — IDE, agent tools, diff, plan,
                drift — is derived.
              </li>
              <li>
                <strong className="text-foreground">It ships as your binary.</strong> A provider
                package builds to a CLI with the web UI embedded — one Node SEA binary that runs{" "}
                <code className="font-mono">validate / pull / plan / apply / web</code> — and the
                same contract runs locally on a git-backed store, fully in-browser, or hosted on
                Cloudflare Durable Objects.
              </li>
            </ul>
          </section>
        </Reveal>

        {/* ── The interface, rendered ────────────────────────────────────── */}
        <Reveal>
          <section className="flex flex-col gap-5 border-t border-border pt-10">
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              ▣ the interface
            </div>
            <h2 className="text-2xl font-semibold leading-snug">
              And here is the one window that renders all of it.
            </h2>
            <div className="flex flex-col gap-3 text-muted-foreground">
              <p>
                Steps 02–09 describe a contract; this is what reads it. The same{" "}
                <code className="font-mono">&lt;Schematics /&gt;</code> component lays the three
                readers from step 05 into a single window — the agent on the left, you in the
                center, the runtime on the right — each looking at the very same schema.
              </p>
            </div>
            <div className="mt-1 rounded-lg border border-border bg-card p-4 sm:p-5">
              <Ascii label="The Schematics IDE in one window: an agent chat panel on the left, a file tree beside a code-versus-preview editor in the center, and a deploy panel with a plan summary on the right.">
                {`┌───────────────────────────────────────────────────────────┐
│ schematics   `}
                <span className="diff-add">{`✓ valid`}</span>
                {`   [Preview|`}
                <Hi>{`Files`}</Hi>
                {`|History]   ⏏ Deploy │
├────────────┬──────────────────────────────┬───────────────┤
│ CHAT       │ Files            [Code|Prev] │ DEPLOY        │
│            │ ┌──────┬───────────────────┐ │`}
                <span className="diff-mod">{` ~2`}</span>
                {`  `}
                <span className="diff-add">{`+1`}</span>
                {`  `}
                <span className="diff-del">{`-0`}</span>
                {`    │
│ ▸ add a    │ │▾users│ name: Alice       │ │ [pull] [plan] │
│   pro tier │ │ alice│ tier: pro         │ │ [apply]       │
│ ✓ wrote    │ │▸forms│··· preview ·······│ │               │
│   alice    │ │      │  Alice · pro      │ │`}
                <span className="diff-mod">{` ~ form:setup`}</span>
                {`  │
│ > _        │ │      │                   │ │`}
                <span className="diff-add">{` + policy:eu`}</span>
                {`   │
│            │ └──────┴───────────────────┘ │`}
                <span className="diff-del">{` - autom:old`}</span>
                {`   │
└────────────┴──────────────────────────────┴───────────────┘`}
              </Ascii>
            </div>
            <p className="text-sm text-muted-foreground">
              Left, <code className="font-mono">SchematicsChatPanel</code> — the agent edits through
              schema-checked tools. Center, the file tree beside a{" "}
              <code className="font-mono">Code / Preview</code> toggle — the raw file and its live
              rendering, never out of sync. Right,{" "}
              <code className="font-mono">SchematicsDeployPanel</code> — pull · plan · apply, as a
              schema-value diff.
            </p>
          </section>
        </Reveal>

        {/* ── Reference: key concepts ────────────────────────────────────── */}
        <Reveal>
          <section className="flex flex-col gap-6 border-t border-border pt-10">
            <h2 className="text-2xl font-semibold">The vocabulary, in one place</h2>
            <dl className="grid gap-5 sm:grid-cols-2">
              {concepts.map((concept) => (
                <div key={concept.term} className="flex flex-col gap-1">
                  <dt className="font-mono text-sm font-semibold text-primary">{concept.term}</dt>
                  <dd className="text-sm text-muted-foreground">{concept.body}</dd>
                </div>
              ))}
            </dl>
          </section>
        </Reveal>

        {/* ── Audiences ──────────────────────────────────────────────────── */}
        <Reveal>
          <section className="flex flex-col gap-5 border-t border-border pt-10">
            <h2 className="text-2xl font-semibold">Who builds on it</h2>
            <ul className="flex flex-col divide-y divide-border">
              {audiences.map(([who, what]) => (
                <li key={who} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                  <span className="font-medium sm:w-56 sm:shrink-0">{who}</span>
                  <span className="text-muted-foreground">{what}</span>
                </li>
              ))}
            </ul>
          </section>
        </Reveal>

        {/* ── Stack ──────────────────────────────────────────────────────── */}
        <Reveal>
          <section className="flex flex-col gap-4 border-t border-border pt-10">
            <h2 className="text-2xl font-semibold">Built on</h2>
            <ul className="flex flex-wrap gap-2">
              {stack.map((item) => (
                <li
                  key={item}
                  className="rounded-full border border-border bg-secondary px-3 py-1 font-mono text-sm text-muted-foreground"
                >
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </Reveal>

        {/* ── Footer CTA ─────────────────────────────────────────────────── */}
        <Reveal>
          <footer className="flex flex-col gap-4 border-t border-border pt-10">
            <h2 className="text-2xl font-semibold">See it for yourself</h2>
            <p className="text-muted-foreground">
              The playground runs entirely in your browser — edit a schema-routed project, watch
              diagnostics update live, and drive a pull / plan / apply against a mock API. No
              install, no server, no credentials.
            </p>
            <Cta />
            <p className="pt-4 font-mono text-xs text-muted-foreground">
              Pre-1.0 · breaking changes expected · pin exact versions
            </p>
          </footer>
        </Reveal>
      </main>
    </div>
  );
}

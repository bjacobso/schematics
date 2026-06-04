// Marketing landing page for Schematics.
//
// It derives the product from first principles: each "rung" adds exactly one
// idea and one ASCII diagram, climbing from "a file is bytes" to the full
// architecture — so a technical reader earns every box in the final diagram.
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
          <div className="font-mono text-sm font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Schematics
          </div>

          <Terminal
            command="schematics reflect users/alice.yaml"
            output="the schema is the contract"
          />

          {/* Pinned, full, static heading — the landing e2e asserts on this. */}
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
            Turn schema-defined files into validated systems that humans, agents, and runtimes all
            understand.
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            An Effect-native workbench where the schema is the contract — shared by the human UI,
            the agent&apos;s editing tools, and the deployment runtime. This page builds that idea
            from first principles, one diagram at a time.
          </p>
          <Cta />
          <p className="font-mono text-xs text-muted-foreground">
            ↓ scroll — nine steps from a single file to a deployed system
          </p>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-12 px-6 py-16">
        {/* ── 01 · bytes ─────────────────────────────────────────────────── */}
        <Rung
          n={1}
          kicker="The atom"
          title="A file is just bytes."
          diagram={
            <Ascii label="A YAML file shown as plain, meaningless text.">
              {`users/alice.yaml
┌───────────────────────────────┐
│ id: alice                     │
│ name: Alice                   │
└───────────────────────────────┘
   bytes on disk. no meaning yet.`}
            </Ascii>
          }
        >
          <p>
            Most AI coding and config tools stop here. A file is text; the model edits the text; you
            find out whether the text was valid at apply time — when it is most expensive to be
            wrong.
          </p>
          <p>Schematics starts one layer down. What does this file actually mean?</p>
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
          kicker="The substrate"
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
            The agent&apos;s tools — <code className="font-mono">list_artifacts</code>,{" "}
            <code className="font-mono">read_artifact_view</code>,{" "}
            <code className="font-mono">write_artifact_source</code>,{" "}
            <code className="font-mono">propose_patch</code> — are checked against that contract
            before an edit ever lands.
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
            keeps human slugs ↔ opaque remote IDs stable across the loop.
          </p>
          <p>
            The diff is a <strong>schema-value</strong> diff, not a text diff — so a plan means what
            the schema says it means.
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

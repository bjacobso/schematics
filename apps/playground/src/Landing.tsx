// Marketing landing page for Schematics. Deliberately design-light — semantic
// sections + the playground's existing Tailwind tokens — so the content is the
// focus and the visual design can be reworked later without touching the copy.
// Intentionally imports NO IDE/editor modules so it stays out of the heavy
// playground bundle (the IDE is lazy-loaded at /playground).

const pillars = [
  {
    title: "Typed artifact runtime",
    body: "Files, blobs, generated outputs, and remote objects are addressed by ref and routed to an Effect Schema. The schema produces typed views, parsed values, and continuous diagnostics — the same reflection the UI, the agent, and the deploy engine all read.",
  },
  {
    title: "React IDE",
    body: "A single <Schematics /> component renders a CodeMirror editor, form views, file tree, diagnostics, a change timeline, and an agent chat panel for any schema-routed project — no bespoke UI to build per project.",
  },
  {
    title: "Config-as-code engine",
    body: "A Terraform/Pulumi-style engine pulls live state, plans schema-aware diffs, applies changes in dependency order, and tears them down. Files are the desired state; a lockfile maps human slugs to opaque remote IDs.",
  },
];

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

const modes = [
  {
    name: "Local serve",
    body: "An on-disk FsArtifactStore behind a Node server. If the directory is a git repo, every change is one commit. The deploy engine can run server-side, holding real credentials.",
  },
  {
    name: "Playground (memory)",
    body: "No server. The SPA builds an in-browser store and runs everything client-side — including the deploy engine against a mock API. This is the demo you can open right now.",
  },
  {
    name: "Cloudflare hosted",
    body: "Each workspace is a Durable Object that owns the files, mirrored to a per-workspace git repo through a worker proxy. The same RPC contract and browser agent loop; only the store moves.",
  },
];

const audiences = [
  "Config / IaC tooling teams — agents editing Terraform, Helm, k8s, or Pulumi with schema-driven validation",
  "Form & CMS builders — schema as the source of truth, with AI authoring of forms, templates, and layouts",
  "Prompt & eval shops — prompts, datasets, and evals as files where the schema is the eval contract",
  "DSL authors — domain languages that need an authoring UI without writing the UI",
  "MCP server authors — the agent tool surface maps cleanly to MCP; ship one contract to any client",
];

const stack = [
  "Effect & Effect Schema",
  "TypeScript",
  "React 19",
  "CodeMirror",
  "isomorphic-git",
  "Cloudflare Workers & Durable Objects",
  "Alchemy v2",
];

export default function Landing() {
  return (
    <div className="min-h-svh bg-muted text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-16 px-6 py-20">
        {/* Hero */}
        <header className="flex flex-col gap-6">
          <div className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Schematics
          </div>
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
            Turn schema-defined files into validated systems that humans, agents, and runtimes all
            understand.
          </h1>
          <p className="text-lg text-muted-foreground">
            Schematics is an Effect-native workbench where the schema is the contract — shared by
            the human UI, the agent's editing tools, and the deployment runtime.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="/playground"
              className="rounded-md bg-foreground px-5 py-2.5 text-sm font-semibold text-background"
            >
              Open the playground
            </a>
            <a
              href="https://github.com/bjacobso/schematics"
              className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold"
            >
              View on GitHub
            </a>
          </div>
        </header>

        {/* Problem */}
        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">The problem</h2>
          <p className="text-muted-foreground">
            Most AI coding and config tools treat files as text and bolt validation on after the
            model has already edited them. The model guesses at structure, you discover the mistakes
            at apply time.
          </p>
          <p className="text-muted-foreground">
            Schematics starts from the opposite assumption:{" "}
            <strong>the schema is the contract</strong>. Every file is an artifact routed to an
            Effect Schema, and that one schema is shared between the editing UI a human uses, the
            tools an agent calls, and the runtime that deploys the result. Validation isn't a step
            at the end — it's the substrate everything reads from.
          </p>
        </section>

        {/* Three pillars */}
        <section className="flex flex-col gap-6">
          <h2 className="text-2xl font-semibold">Three things in one system</h2>
          <div className="flex flex-col gap-6">
            {pillars.map((pillar) => (
              <div key={pillar.title} className="flex flex-col gap-2">
                <h3 className="text-lg font-semibold">{pillar.title}</h3>
                <p className="text-muted-foreground">{pillar.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Key concepts */}
        <section className="flex flex-col gap-6">
          <h2 className="text-2xl font-semibold">Key concepts</h2>
          <dl className="flex flex-col gap-5">
            {concepts.map((concept) => (
              <div key={concept.term} className="flex flex-col gap-1">
                <dt className="font-semibold">{concept.term}</dt>
                <dd className="text-muted-foreground">{concept.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Deploy modes */}
        <section className="flex flex-col gap-6">
          <h2 className="text-2xl font-semibold">One contract, three places it can run</h2>
          <p className="text-muted-foreground">
            The constant across every mode is the same artifact-project RPC contract and the same
            browser-side agent tool loop. Only the store implementation — and where it lives —
            changes.
          </p>
          <div className="flex flex-col gap-6">
            {modes.map((mode) => (
              <div key={mode.name} className="flex flex-col gap-2">
                <h3 className="text-lg font-semibold">{mode.name}</h3>
                <p className="text-muted-foreground">{mode.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Audiences */}
        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">Who it's for</h2>
          <ul className="flex flex-col gap-3">
            {audiences.map((audience) => (
              <li key={audience} className="text-muted-foreground">
                {audience}
              </li>
            ))}
          </ul>
        </section>

        {/* Tech stack */}
        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">Built on</h2>
          <ul className="flex flex-wrap gap-2">
            {stack.map((item) => (
              <li
                key={item}
                className="rounded-full border border-border bg-secondary px-3 py-1 text-sm text-muted-foreground"
              >
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* Footer CTA */}
        <footer className="flex flex-col gap-4 border-t border-border pt-10">
          <h2 className="text-2xl font-semibold">See it for yourself</h2>
          <p className="text-muted-foreground">
            The playground runs entirely in your browser — edit a schema-routed project, watch
            diagnostics update live, and drive a pull / plan / apply against a mock API.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="/playground"
              className="rounded-md bg-foreground px-5 py-2.5 text-sm font-semibold text-background"
            >
              Open the playground
            </a>
            <a
              href="https://github.com/bjacobso/schematics"
              className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold"
            >
              View on GitHub
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}

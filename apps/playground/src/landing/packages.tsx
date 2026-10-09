import type { ReactNode } from "react";
import { Ascii } from "./Ascii";

export type PackageName = "algebra" | "predicates" | "logic" | "workflow" | "core" | "filesystem";

export type Availability =
  | { kind: "published"; version: string }
  | { kind: "source"; label: string }
  | { kind: "planned" };

export type Package = {
  name: PackageName;
  kicker: string;
  title: string;
  storyLabel: string;
  story: ReactNode;
  does: ReactNode;
  uses: readonly string[];
  availability: Availability;
  file: string;
  code: string;
  demo?: string;
  diagram?: ReactNode;
};

export const packages: readonly Package[] = [
  {
    name: "algebra",
    kicker: "Relationships",
    title: "Know what points at what.",
    storyLabel: "The 2 a.m. page",
    story: (
      <>
        Someone deletes the <code>send-welcome-email</code> action. Two workflows still call it.
        Nobody notices until a new hire&apos;s first day passes without a single email.
      </>
    ),
    does: (
      <>
        Declare ids and references right on your Effect Schema fields. Algebra extracts the graph
        and reports duplicate ids and dangling references with exact paths — the same graph that
        powers rename, go-to-definition, and &ldquo;what breaks if I change this?&rdquo;
      </>
    ),
    uses: [
      "Pricing plans that bundle features",
      "CMS entries that link to each other",
      "Workflows that call reusable actions",
      "Autocomplete and rename for ids in an editor",
    ],
    availability: { kind: "published", version: "0.1.0" },
    file: "workspace.ts",
    code: `
import { Schema } from "effect"
import { Relation } from "@schema-reflection/algebra"

const Action = Schema.Struct({
  id: Relation.id("Action"),
  label: Schema.String,
})

const Workflow = Schema.Struct({
  id: Relation.id("Workflow"),
  actionIds: Relation.refs("Action"),
})

const Workspace = Schema.Struct({
  actions: Schema.Array(Action),
  workflows: Schema.Array(Workflow),
})

Relation.validate(Workspace, config)
// → [{ code: "unresolved-ref", path: [...], message: ... }]`,
    demo: "algebra",
  },
  {
    name: "predicates",
    kicker: "Conditions",
    title: "Rules you can read back.",
    storyLabel: "The Slack thread",
    story: (
      <>
        &ldquo;Can a team lead approve a $700 refund?&rdquo; The answer is an <code>if</code>{" "}
        statement in a file support will never open — so they ask an engineer. Every time.
      </>
    ),
    does: (
      <>
        Conditions become immutable JSON. You define the leaf language with Effect Schema; the
        library gives you validated <code>and</code> / <code>or</code> composition, normalization,
        evaluation, and a <code>fold</code> to turn the same rule into a sentence, a query, or
        anything else.
      </>
    ),
    uses: [
      "Refund and approval policies an admin UI can show",
      "Feature-flag targeting stored in a database",
      "Eligibility rules for plans and promotions",
      "Audience segments people can edit safely",
    ],
    availability: { kind: "published", version: "0.1.0" },
    file: "refund-policy.ts",
    code: `
import { Schema } from "effect"
import { Predicate } from "@schema-reflection/predicates"

const Role = Schema.Struct({
  _tag: Schema.Literal("Role"),
  is: Schema.Literals(["agent", "lead", "finance"]),
})
const MaxAmount = Schema.Struct({
  _tag: Schema.Literal("MaxAmount"),
  usd: Schema.Number,
})

const Policy = Predicate.nested({ leafSchemas: [Role, MaxAmount] })

const CanApproveRefund = Policy.or([
  { _tag: "Role", is: "finance" },
  Policy.and([{ _tag: "Role", is: "lead" }, { _tag: "MaxAmount", usd: 500 }]),
])

Policy.evaluate(CanApproveRefund, (leaf) =>
  leaf._tag === "Role" ? user.role === leaf.is : refund.usd <= leaf.usd)`,
    demo: "predicates",
  },
  {
    name: "logic",
    kicker: "Behavior",
    title: "See what an action does before it does it.",
    storyLabel: "The code review",
    story: (
      <>
        An agent wants to call <code>approveCandidate</code>. What will it write? Which events will
        it fire? Who is allowed to call it? Today the honest answer is &ldquo;read the code and
        hope.&rdquo;
      </>
    ),
    does: (
      <>
        Actions are syntax trees built from small primitives — <code>require</code>,{" "}
        <code>set</code>, <code>emit</code>, <code>match</code>, <code>retry</code> — and run by an
        Effect interpreter. Print one for review, serialize it to JSON, and run it in memory to
        assert on its result, state, and events.
      </>
    ),
    uses: [
      "Business actions an agent can call and a human can review",
      "Automation steps stored as JSON and versioned",
      "Testing rules by their observable effects",
      "Swapping storage and event sinks per environment",
    ],
    availability: { kind: "published", version: "0.1.0" },
    file: "approve-candidate.ts",
    code: `
import { Logic } from "@schema-reflection/logic"

const ApproveCandidate = Logic.Action("ApproveCandidate", ($) =>
  $.do(
    $.require($.eq($.ref.actor.role, "reviewer"), "forbidden"),
    $.set($.ref.candidate.status, "approved"),
    $.emit("candidate.approved", { id: $.ref.candidate.id }),
    $.get($.ref.candidate.status),
  ),
)

Logic.print(ApproveCandidate)     // review it
Logic.serialize(ApproveCandidate) // store it
await Logic.run(ApproveCandidate, { actor, candidate }) // test it`,
    demo: "logic",
  },
  {
    name: "workflow",
    kicker: "Processes",
    title: "Survive the deploy in the middle.",
    storyLabel: "The deploy",
    story: (
      <>
        A hiring approval waits three days for a reviewer. On day two you ship a release, the
        process restarts, and the approval quietly evaporates.
      </>
    ),
    does: (
      <>
        Workflows are data: run an action, await a correlated event, sleep, branch. Pure{" "}
        <code>start</code>, <code>advance</code>, and <code>resume</code> functions return the
        commands to dispatch and a JSON checkpoint — store it anywhere, reload it in a fresh
        process, and pick up exactly where you left off.
      </>
    ),
    uses: [
      "Hiring and purchase approvals",
      "Document signing that waits on people",
      "Onboarding sequences with timers",
      "Human-in-the-loop agent tasks",
    ],
    availability: { kind: "source", label: "Experimental prototype" },
    file: "review.ts",
    code: `
import { Workflow, Expr } from "@schema-reflection/workflow"

const Review = Workflow.define("Review", { version: 1, input, output },
  ({ input, steps }) => {
    const request = Workflow.run(steps.id("request"), RequestReview, {
      candidateId: input.at("candidateId"),
    })
    const review = Workflow.awaitEvent(steps.id("review"), ReviewSubmitted, {
      correlate: request.output.at("requestId"),
      timeoutMs: 259_200_000, // three days
    })
    return Workflow.sequence(request, review,
      Workflow.branch(steps.id("decision"),
        review.output.at("decision").pipe(Expr.equal("approved")),
        Workflow.complete("approved"),
        Workflow.complete("rejected")))
  })

const { checkpoint, commands } =
  Workflow.start(Review, "review-1", { candidateId: "c1" }, Date.now())`,
    demo: "workflow",
  },
  {
    name: "core",
    kicker: "Contracts",
    title: "Ship the schema, not just the type.",
    storyLabel: "The handoff",
    story: (
      <>
        Your <code>Candidate</code> type lives in TypeScript. Your database, your partner&apos;s
        service, and the agent on the other end of a tool call can&apos;t import TypeScript.
      </>
    ),
    does: (
      <>
        <code>MetaSchema</code> encodes a portable subset of Effect Schema as versioned JSON and
        rebuilds a working schema on the other side. Anything it can&apos;t carry faithfully —
        refinements, transformations — fails loudly with the path instead of being silently dropped.
        It is the foundation predicates, logic, and workflow share.
      </>
    ),
    uses: [
      "Contracts stored next to the data they describe",
      "Schemas sent across a service boundary",
      "Offline tools that inspect what a program accepts",
      "Portable expressions shared by every other package",
    ],
    availability: { kind: "source", label: "Experimental" },
    file: "candidate.ts",
    code: `
import { Schema } from "effect"
import { MetaSchema } from "@schema-reflection/core"

const Candidate = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["pending", "approved"]),
  note: Schema.optionalKey(Schema.String),
})

const json = MetaSchema.encode(Candidate)   // send it anywhere
const contract = MetaSchema.decode(json)    // checked on arrival
const schema = MetaSchema.toSchema(contract) // a working schema again

MetaSchema.validate(contract, { id: "c1", status: "pending" })`,
    demo: "core",
  },
  {
    name: "filesystem",
    kicker: "Files",
    title: "A folder is a database with no schema.",
    storyLabel: "The config repo",
    story: (
      <>
        Four hundred YAML files. Half of them reference the other half. The only thing checking them
        is a script someone wrote in 2021 — or nothing at all.
      </>
    ),
    does: (
      <>
        One <code>Layout</code> declares which files may exist, how each is parsed, the schema it
        must satisfy, and which values point at other files. From that: diagnostics with file, line,
        and column across the whole folder — and later, edits that keep it valid and preserve
        formatting.
      </>
    ),
    uses: [
      "Config-as-code repositories",
      "Content folders with cross-links",
      "Agent workspaces that must stay valid",
      "Monorepo metadata",
    ],
    availability: { kind: "planned" },
    file: "layout.ts · proposed API",
    code: `
const Project = Layout.make({
  files: {
    "project.yaml": Layout.file(Format.yaml, ProjectSchema, { required: true }),
    "actions/:action.json": Layout.file(Format.json, ActionSchema, {
      identity: { type: "Action", capture: "action" },
    }),
    "workflows/**/*.yaml": Layout.file(Format.yaml, WorkflowSchema),
  },
  unmatched: "error",
})`,
    diagram: (
      <Ascii label="A config folder where every file validates except one workflow, which has an unresolved Action reference at line 4, column 5.">
        {`hr-config/
├── project.yaml                  `}
        <span className="tone-ok">✓</span>
        {`
├── actions/
│   ├── send-welcome-email.json   `}
        <span className="tone-ok">✓</span>
        {`
│   └── order-laptop.json         `}
        <span className="tone-ok">✓</span>
        {`
├── workflows/
│   └── onboarding.yaml           `}
        <span className="tone-err">× 4:5 unresolved Action "notify-manger"</span>
        {`
└── notes.txt                     `}
        <span className="tone-warn">× unmatched-file</span>
      </Ascii>
    ),
  },
];

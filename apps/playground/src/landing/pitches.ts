import type { PackageName } from "./packages";

type Point = { title: string; body: string };
type Composition = { name: PackageName; body: string };
export type PackagePitch = {
  description: string;
  lede: string;
  input: string;
  output: string;
  diagram: string;
  why: readonly string[];
  unlocks: readonly Point[];
  steps: readonly Point[];
  scenario: { title: string; intro: string; steps: readonly Point[] };
  composition: readonly Composition[];
  boundaries: readonly Point[];
  adoption: string;
  effect: string;
};

export const pitches: Record<PackageName, PackagePitch> = {
  algebra: {
    description:
      "Turn identifiers and references in Effect Schema into a graph you can validate and inspect, from config checks to editor navigation.",
    lede: "A string can name a thing, or point at a thing. Your schema should know the difference. Teach it once, and every consumer can ask the same relationship questions.",
    input: "Effect Schema + decoded values",
    output: "Definitions, references, path diagnostics",
    diagram:
      "Action.id ───────┐\n                │ resolves\nWorkflow.refs ──┘\n\ndelete an Action\n       ↓\nfind its broken references",
    why: [
      "A schema can prove that actionIds is an array of strings while every string in it names an action that no longer exists. Shape validation and relationship validation answer different questions. Once records reference one another, a structurally valid document can still describe a broken system.",
      "The usual fix is another loop in a validator, another index in an editor, and another list of special cases in an agent tool. Those implementations drift. Algebra puts identity and reference meaning beside the fields that carry it, then extracts one graph from the schema and the data. A CLI, a browser, and a server can all inspect that graph without owning separate relationship rules.",
    ],
    unlocks: [
      {
        title: "Catch the broken link before the deploy",
        body: "Report duplicate definitions and unresolved references with structured paths. A config review can point to the exact workflow entry that still names a deleted action, instead of waiting for that workflow to run.",
      },
      {
        title: "Give your tools a shared map",
        body: "Use the graph's definitions and references to build navigation, candidate lists, and impact views. Algebra supplies the semantic facts; your editor or agent supplies the UI and edit operations.",
      },
      {
        title: "Keep identity local to the domain",
        body: "Scoped identities let a name mean something inside its parent rather than forcing every form field or nested resource into one global namespace. References can resolve in the appropriate scope.",
      },
    ],
    steps: [
      {
        title: "Annotate the fields that carry meaning",
        body: "Use Relation.id for definitions, Relation.ref for one reference, and Relation.refs for a list. Give each entity type a stable name. Keep ordinary shape constraints in Effect Schema.",
      },
      {
        title: "Decode first, then check the relationships",
        body: "Validate the incoming value with your schema, then pass the decoded root to Relation.validate. Pass it to Relation.graph when a consumer needs the underlying definitions and references.",
      },
      {
        title: "Put the same check at each boundary",
        body: "Run it in CI, before accepting an edit, or before planning a deployment. Map diagnostic paths to your own file positions or UI fields; the library does not own your files or rendering.",
      },
    ],
    scenario: {
      title: "Deleting an action becomes a reviewable change.",
      intro:
        "An onboarding configuration has reusable actions and several workflows. A cleanup removes notify-manager, but two workflows still reference it.",
      steps: [
        {
          title: "Describe",
          body: "Mark each action's id as an Action definition and each workflow's actionIds as Action references.",
        },
        {
          title: "Inspect",
          body: "Extract the graph for the proposed configuration. The two remaining references are still visible even though their target disappeared.",
        },
        {
          title: "Decide",
          body: "Show both diagnostics before accepting the change. The author can restore the action or update the workflows deliberately.",
        },
      ],
    },
    composition: [
      {
        name: "predicates",
        body: "Relationships say which records are connected; predicates decide whether a domain condition holds. A host can expose graph facts to its leaf interpreter, such as whether an action is referenced. That integration is application code.",
      },
      {
        name: "logic",
        body: "Check a candidate configuration around an action that changes it. Logic describes the behavior, while algebra detects broken relationships in the resulting values. Graph validation does not automatically wrap action execution.",
      },
      {
        name: "workflow",
        body: "A host can annotate named process definitions and action references to review their connections before dispatch. Workflow still owns progress through time; algebra does not schedule or resume work.",
      },
      {
        name: "core",
        body: "Share domain shapes where the portable subset allows it, but keep relation declarations explicit: MetaSchema does not promise to preserve algebra annotations. A portable shape alone is not a relationship graph.",
      },
      {
        name: "filesystem",
        body: "The proposed filesystem layer would route and decode documents, then combine their identities and references into a cross-file graph. That integration is planned; algebra already works over values supplied by your own loader.",
      },
    ],
    boundaries: [
      {
        title: "A graph is not a refactoring engine",
        body: "Relation metadata, extraction, and validation are implemented. Automatic rename, schema-aware patches, migrations, and broader algebra operations remain separate tooling or roadmap work.",
      },
      {
        title: "The host decides what to accept",
        body: "Algebra reports facts about a value. It does not commit files, change database rows, or choose whether a diagnostic blocks a deployment. Keep those decisions in your application's boundary.",
      },
    ],
    adoption:
      "Start with one document type that contains ids and references. Add relation checks to its existing validator, then reuse the graph in the next tool that needs it. Algebra stands alone; the other family packages are optional.",
    effect:
      "The published 0.1.0 release declares Effect 4.0.0-beta.68. Schematics tests that release with its RC.112 pin and an explicit peer override; check compatibility for your own application.",
  },
  predicates: {
    description:
      "Define conditions as validated data so the same rule can be evaluated, displayed, edited, and stored without hiding its meaning in callbacks.",
    lede: "A policy should be something you can show a person, save in a database, and ask a question of. Give the rule a language instead of burying it in an if-statement.",
    input: "A schema-defined condition language",
    output: "Validated Boolean trees + interpreters",
    diagram:
      "finance\n   OR\nlead AND refund ≤ $500\n       │\n       ├── evaluate\n       ├── explain\n       └── store as JSON",
    why: [
      "The rule starts as a small conditional. Then support needs to explain it, an administrator needs to change it, and a second service needs to make the same decision. A callback can compute an answer, but it does not give those consumers a representation they can inspect or edit.",
      "Predicates makes the condition an explicit tree. You define the allowed leaves with Effect Schema and provide their domain meaning. The library handles Boolean composition, validation, normalization, and folding. A rule can keep the same structure while different interpreters evaluate it or turn it into an explanation.",
    ],
    unlocks: [
      {
        title: "Explain the answer in the vocabulary of the product",
        body: "A refund policy can say finance, team lead, and maximum amount rather than exposing implementation details. Write a fold that renders those leaves and their Boolean structure into a readable explanation.",
      },
      {
        title: "Build an editor with a finite language",
        body: "A schema describes which conditions are allowed and what inputs they require. An admin UI can offer supported fields and operators instead of accepting arbitrary code.",
      },
      {
        title: "Store the rule beside its history",
        body: "JSON-shaped conditions can be versioned and reviewed with the rest of your configuration. Keep the interpreter's meaning and the condition format versioned together so an old rule remains understandable.",
      },
    ],
    steps: [
      {
        title: "Choose a small domain vocabulary",
        body: "Define tagged leaf schemas such as Role and MaxAmount. Prefer concepts that a product user can recognize. Decide explicitly what each leaf means in your evaluation context.",
      },
      {
        title: "Build and decode the condition tree",
        body: "Create a language with Predicate.nested, then compose it with and/or constructors. Decode stored or externally supplied conditions through that language before using them.",
      },
      {
        title: "Supply an interpreter for each consumer",
        body: "Use evaluate with a pure leaf callback for decisions and fold for another representation. A query compiler or explanation renderer is your interpreter, not an automatically generated integration.",
      },
    ],
    scenario: {
      title: "One refund policy answers three audiences.",
      intro:
        "Finance may approve any refund. A team lead may approve up to $500. Everyone else must escalate. Keep that rule as one tree rather than three disconnected implementations.",
      steps: [
        {
          title: "Decide",
          body: "The application evaluates role and amount against the stored condition when a refund is requested.",
        },
        {
          title: "Explain",
          body: "A support screen renders the same condition in domain language, so a denied $700 refund has an understandable rule behind it.",
        },
        {
          title: "Review",
          body: "A change to the threshold is a change to the rule data. Test representative roles and amounts before accepting the new policy.",
        },
      ],
    },
    composition: [
      {
        name: "algebra",
        body: "If a condition names an entity in configuration, annotate the relevant schema field with a relation and validate its target separately. A well-formed condition can still contain a dangling domain reference.",
      },
      {
        name: "logic",
        body: "Use the condition's result at an action boundary or translate supported leaves into action expressions. A rule decides whether something is allowed; an action defines the writes and events that follow. The generic leaf tree needs an interpreter or adapter.",
      },
      {
        name: "workflow",
        body: "Conditions can inform a process branch after the host records its inputs. The workflow prototype's portable expression API is a separate contract: arbitrary leaf callbacks cannot be serialized into a checkpoint.",
      },
      {
        name: "core",
        body: "The experimental portable-definition API uses core to carry an input contract and expression body together. The published nested-leaf API shown here instead takes a host interpreter. Choose the API and artifact format for your pinned version.",
      },
      {
        name: "filesystem",
        body: "The filesystem design could store policy documents and validate their schema and links with the rest of a project. Cross-document policy constraints are proposed work, not a shipped validator.",
      },
    ],
    boundaries: [
      {
        title: "The interpreter supplies the meaning",
        body: "A Role leaf does not fetch a user or authorize an HTTP request by itself. Evaluate it using the correct context at the actual application boundary; keep leaf callbacks pure.",
      },
      {
        title: "Normalization does not replace domain tests",
        body: "The library validates and simplifies Boolean structure. You still define what leaves mean and test the business cases that matter, including changes to those meanings over time.",
      },
    ],
    adoption:
      "Start with one policy that people repeatedly ask engineers to explain. Define its leaves, test a few representative inputs, and add a readable view of the same stored rule before building a full policy editor.",
    effect:
      "The published 0.1.0 release declares Effect 4.0.0-rc.113. Check the exact peer and API version before combining it with another family package.",
  },
  logic: {
    description:
      "Represent business actions as inspectable syntax trees: review their requirements, writes, and events, then execute them with an Effect interpreter.",
    lede: "Before a person or agent runs an action, they should be able to see what it means. Make the action's requirements, writes, and events part of its definition.",
    input: "A named action built from primitives",
    output: "Inspectable behavior + observable execution",
    diagram:
      "require reviewer\n       ↓\nset status = approved\n       ↓\nemit candidate.approved\n       ↓\nreturn approved",
    why: [
      "A function can approve a candidate, but its name is not a description of its behavior. A reviewer has to trace calls to discover the permission check, the fields it writes, and the event it emits. An agent calling the function has the same gap between the tool's label and its actual effects.",
      "Logic expresses the action as a syntax tree built from explicit primitives. The builder constructs that tree; the interpreter executes it. That separation gives tools something to print, serialize, and test before an action runs, and gives your application a place to provide storage and event handling.",
    ],
    unlocks: [
      {
        title: "Review behavior before execution",
        body: "Print the action or inspect its tree to see requirements, state operations, and events. Human review and tool descriptions can be based on the action's definition rather than a separately maintained summary.",
      },
      {
        title: "Test the effects that users care about",
        body: "Run an action against in-memory state and assert on its result, resulting state, and recorded events. A test can distinguish a successful return from the correct business transition.",
      },
      {
        title: "Keep execution services at the application edge",
        body: "Use the same action definition with host-provided Store and EventSink services. The host owns how state is persisted and how events are delivered.",
      },
    ],
    steps: [
      {
        title: "Name a domain action and its boundary",
        body: "Start with a single operation such as ApproveCandidate. Attach input/output schemas where needed, and express its requirements, writes, events, and result using the builder primitives.",
      },
      {
        title: "Inspect and test the tree",
        body: "Use Logic.print to review it, Logic.serialize to carry executable structure, and Logic.run for in-memory tests. In the published API, serialized structure does not carry the attached input/output schemas.",
      },
      {
        title: "Provide real services deliberately",
        body: "Integrate Logic.evaluate into an Effect application with your own Store and EventSink. Decide how persistence, failure, and retries should work before exposing the action through an API or agent tool.",
      },
    ],
    scenario: {
      title: "ApproveCandidate becomes more than a tool name.",
      intro:
        "A reviewer approves a pending candidate. The action needs to check the caller, change the status, emit an event, and return a result that the caller can confirm.",
      steps: [
        {
          title: "Review",
          body: "The printed definition shows require, set, emit, and get in sequence. The behavior is visible before the host binds it to live services.",
        },
        {
          title: "Exercise",
          body: "Run it with a reviewer and with a reader. Assert on the result, state, events, and the failure from the rejected invocation.",
        },
        {
          title: "Execute",
          body: "The application supplies the storage and event services and invokes the approved definition at its authorization boundary.",
        },
      ],
    },
    composition: [
      {
        name: "predicates",
        body: "A policy provides the decision; logic describes the behavior permitted by it. Evaluate the policy at the action boundary or adapt its supported condition language into action expressions.",
      },
      {
        name: "algebra",
        body: "Use relationship validation on configuration read or produced by an action. It answers whether identifiers resolve, while logic answers what the action does. The host decides when to check and whether to commit.",
      },
      {
        name: "workflow",
        body: "A process can request an action and wait for its result. The host binds workflow commands to permitted action handlers; it does not execute arbitrary uploaded definitions by name. Match the portable prototype's contract to the executor you use.",
      },
      {
        name: "core",
        body: "Core supports the experimental portable API that bundles shapes with behavior. The published Action/serialize API shown here carries the tree but not attached boundary schemas; treat those formats as distinct.",
      },
      {
        name: "filesystem",
        body: "The proposed file layer could validate stored action documents and their links before a host loads them. Validating a file and permitting its execution remain separate host decisions.",
      },
    ],
    boundaries: [
      {
        title: "The published interpreter is not a transaction manager",
        body: "Writes and events that occur before a failure can remain applied. A retry can repeat them. Provide the persistence semantics and idempotency your real services require.",
      },
      {
        title: "A syntax tree has a supported language",
        body: "Use the defined primitives and expression forms. Arbitrary closures are not portable action data. The newer experimental typed portable API differs from the published legacy API shown in the example.",
      },
    ],
    adoption:
      "Choose one action with a clear input, a small state change, and an event. Make its tree reviewable, prove its observable behavior in memory, and then integrate the host services you need.",
    effect:
      "The published 0.1.0 release declares Effect 4.0.0-rc.113. Pin the release and use its API rather than assuming the experimental portable API is in that npm version.",
  },
  workflow: {
    description:
      "Model long-running processes as data and checkpointed transitions, with a host responsible for persistence, event delivery, and action dispatch.",
    lede: "An approval can wait longer than your server stays alive. Describe the process separately from the process that happens to be running it.",
    input: "A process definition + recorded stimuli",
    output: "A JSON checkpoint + commands for a host",
    diagram:
      "request review\n       ↓\nawait reviewer ─── checkpoint\n       │             ↓\n       │         new process\n       └────────── resume\n                     ↓\n              approve / reject",
    why: [
      "A human approval, a signing flow, or an onboarding sequence spends most of its life waiting. A Promise or timer in memory is tied to one running process. A deploy or restart can discard that waiting state unless the application has a durable representation of what already happened and what should happen next.",
      "The workflow prototype represents steps and decisions as data. Pure start, advance, and resume functions derive the next checkpoint and commands from the definition and recorded history. The host executes commands and persists transitions. Recovery can reconstruct progress without rerunning completed action handlers.",
    ],
    unlocks: [
      {
        title: "Keep a waiting process outside memory",
        body: "Persist a checkpoint and load it in a fresh process. The journal records the stimuli needed to reconstruct the workflow's decisions; durability depends on the host actually storing it.",
      },
      {
        title: "Separate coordination from execution",
        body: "A definition can run an action, wait for a correlated event, branch, or complete. The host receives commands rather than having the workflow library directly call a database, queue, or handler.",
      },
      {
        title: "Make progress explainable",
        body: "Inspect the definition, history, pending commands, and status to understand why an instance is waiting and which recorded result or event advances it.",
      },
    ],
    steps: [
      {
        title: "Define contracts and stable steps",
        body: "Describe inputs, outputs, action contracts, event correlation, and meaningful step ids. Treat definition versions as part of the process identity, especially when a process may outlive a release.",
      },
      {
        title: "Build the host loop",
        body: "Call start for a new instance. Persist the proposed checkpoint with outgoing commands, dispatch permitted handlers, and feed their results or ingested events back through advance with host timestamps.",
      },
      {
        title: "Resume from recorded history",
        body: "Load the checkpoint and its matching definition in a fresh process, then call resume. Honor stable invocation identities when dispatching pending commands, because a resume can propose the same command again.",
      },
    ],
    scenario: {
      title: "A three-day review survives a day-two release.",
      intro:
        "The process requests a review and waits for a correlated response. A deployment occurs before the reviewer answers. The process should retain the request and the reason it is waiting.",
      steps: [
        {
          title: "Start",
          body: "The host runs RequestReview, records its result, and stores the checkpoint that waits on the returned request id.",
        },
        {
          title: "Recover",
          body: "A fresh host reloads that checkpoint. Resume reconstructs the wait from recorded data instead of requesting another completed review.",
        },
        {
          title: "Continue",
          body: "The host delivers ReviewSubmitted with its ingestion time. Advance records the event and produces the next branch or completion.",
        },
      ],
    },
    composition: [
      {
        name: "logic",
        body: "Logic supplies action behavior; workflow coordinates when an action is requested and how its result affects the process. The host binds exact permitted contracts and controls dispatch.",
      },
      {
        name: "predicates",
        body: "A portable condition can describe a branch over recorded inputs or results. Generic leaf callbacks need a host adapter; the portable workflow expression language cannot carry arbitrary functions.",
      },
      {
        name: "core",
        body: "Core supplies portable contracts and symbolic expressions for the experimental definition and checkpoint protocol. It helps the loader check shapes and references before accepting a transition.",
      },
      {
        name: "algebra",
        body: "Use host-defined relation annotations to audit named process and action references in configuration. That graph complements process validation; it does not supply checkpoint storage or event delivery.",
      },
      {
        name: "filesystem",
        body: "A future layout could validate workflow definitions stored as files. Checkpoints are instance history, not merely definitions: their persistence and delivery protocol remain the host's responsibility.",
      },
    ],
    boundaries: [
      {
        title: "An experimental sequential prototype",
        body: "This package is source-only. It has one active invocation and no automatic retries. Journals are limited to 10,000 stimuli, and replay cost grows with history. It is not a hosted workflow service.",
      },
      {
        title: "Persistence and delivery belong to the host",
        body: "There is no shipped database adapter, outbox, fencing, or compaction. Dispatch is at least once; handlers must honor invocation identities. The host must persist checkpoints, route events, and make delivery recoverable.",
      },
    ],
    adoption:
      "Evaluate the prototype with a small approval flow and a host you control. Test restart recovery and duplicate command delivery before extending the process. There is no npm installation command for this package yet.",
    effect:
      "The experimental source prototype currently uses Effect 4.0.0-rc.115. Its portable contracts and host protocol may change before a public release.",
  },
  core: {
    description:
      "Carry a supported subset of Effect Schema as versioned JSON, reconstruct contracts, and validate values across application boundaries.",
    lede: "A TypeScript type disappears when the program is built. A portable contract can travel with the data and still tell the next consumer what is valid.",
    input: "Supported Effect Schema + expressions",
    output: "Versioned JSON contracts + validation",
    diagram:
      "Effect Schema\n       ↓ encode\nversioned JSON contract\n       ↓ decode\ninspect / reconstruct / validate",
    why: [
      "Your application has a Candidate schema, but a stored artifact, an offline inspector, or a different runtime cannot import the application module that defines it. A generated type only helps code compiled against that module. It does not give a loaded document a contract the consumer can inspect and validate at runtime.",
      "Core describes a deliberate portable subset of Effect Schema in versioned JSON. MetaSchema can encode that subset, check a loaded description, reconstruct a working schema, and validate values against it. Unsupported semantics fail with a diagnostic rather than quietly turning into a weaker contract.",
    ],
    unlocks: [
      {
        title: "Let an artifact describe its own boundary",
        body: "Bundle a supported input or output contract with the program data that uses it. An offline consumer can inspect the declared shapes without a lookup into your running application.",
      },
      {
        title: "Check loaded values at runtime",
        body: "MetaSchema.validate enforces the portable contract, including exact object keys, and returns a frozen JSON snapshot. A payload with an unexpected admin field need not be accepted just because its known fields look valid.",
      },
      {
        title: "Share a small expression vocabulary",
        body: "Pure expression data can refer to declared inputs and local bindings and express supported Boolean operations. Definition loaders can check those references instead of trusting a string that merely resembles a path.",
      },
    ],
    steps: [
      {
        title: "Choose a genuinely portable boundary",
        body: "Start with plain JSON-shaped domain data: supported primitives, arrays, structs, optional keys, literals, and unions. Keep runtime-specific transforms and callbacks outside that contract.",
      },
      {
        title: "Encode and check the description",
        body: "Use MetaSchema.encode on the supported Effect Schema. On the receiving side, MetaSchema.decode checks the envelope, version, and semantic constraints before you reconstruct or use it.",
      },
      {
        title: "Validate values with the intended semantics",
        body: "Use MetaSchema.validate for the portable contract's strict value boundary. If you use MetaSchema.toSchema and native Effect decoding instead, select the native decoding options you need explicitly.",
      },
    ],
    scenario: {
      title: "A saved candidate contract still has meaning tomorrow.",
      intro:
        "An artifact carries a Candidate contract with an id, an optional note, and a pending/approved status. Another consumer needs to inspect and validate it without importing the original application.",
      steps: [
        {
          title: "Carry",
          body: "Encode the supported schema into a versioned contract and store it with the artifact.",
        },
        {
          title: "Load",
          body: "Decode the description and reject an unsupported format or semantic node before trusting it.",
        },
        {
          title: "Check",
          body: "Validate a candidate against the loaded contract. An archived status or an unexpected key produces a diagnostic rather than a silent downgrade.",
        },
      ],
    },
    composition: [
      {
        name: "predicates",
        body: "The experimental portable predicate API can carry an input shape and expression together using core. A generic nested-leaf rule still requires its host's leaf interpreter.",
      },
      {
        name: "logic",
        body: "The experimental portable action API uses contracts for input, state, events, and results. The published legacy serialize API does not bundle attached schemas, so choose a compatible artifact format.",
      },
      {
        name: "workflow",
        body: "Workflow definitions use portable shapes and expressions to check recorded inputs, step outputs, and branch decisions. Core supplies those contracts; the workflow host supplies persistence and execution.",
      },
      {
        name: "algebra",
        body: "Both begin with domain schemas, but portable shape and relation meaning are distinct. MetaSchema rejects unsupported annotations rather than preserving algebra's relationship metadata. Keep a relation declaration or adapter alongside the portable contract.",
      },
      {
        name: "filesystem",
        body: "A future filesystem layout could use portable contracts for inspecting stored definitions. The proposed filesystem package currently routes native Effect schemas; serializable layouts and constraints are design work.",
      },
    ],
    boundaries: [
      {
        title: "A supported subset, with explicit failures",
        body: "Refinements, transformations, defaults, annotations, recursion, tuples, and non-JSON values are outside the current subset. Core identifies unsupported schema paths; it does not silently drop those semantics.",
      },
      {
        title: "Descriptions and versions need to stay together",
        body: "The artifact formats are experimental. A JSON contract is not a live database schema migration or an arbitrary Effect program. Keep the producer, consumer, and format versions aligned.",
      },
    ],
    adoption:
      "Start with one contract that needs to cross a boundary or live longer than a process. Confirm every schema node is supported, exercise an encode/decode/validate round trip, and keep richer application behavior outside the artifact.",
    effect:
      "Core is experimental and source-only, currently using Effect 4.0.0-rc.115. It is separate from the Schematics workspace's @schematics/core runtime package.",
  },
  filesystem: {
    description:
      "A proposed schema-native layout for routing, decoding, and validating configuration files and their relationships across a project directory.",
    lede: "When a folder becomes your database, filenames and cross-links become part of the schema. Declare that structure once instead of teaching every script what the repository means.",
    input: "Proposed Layout + path-to-text documents",
    output: "Planned source-mapped project diagnostics",
    diagram:
      "file paths + text\n       ↓ planned layout\nroute → parse → decode\n       ↓\nresolve cross-file references\n       ↓\nfile : line : column",
    why: [
      "A configuration repository may contain hundreds of individually valid YAML files and still be broken as a project. A workflow can refer to an action in another file that was deleted, a required document can be missing, or a file can sit somewhere no consumer expects it. The folder has rules even if nobody has written them down together.",
      "The filesystem design proposes one Layout that declares allowed paths, formats, per-file schemas, and identities. A pure core would validate supplied path-to-text documents, while a thin host adapter would read and write actual files. The aim is one interpretation of a project for CI, editors, and agents.",
    ],
    unlocks: [
      {
        title: "A project-level check, not a pile of file checks",
        body: "The proposed validator would check routing, required files, parsed shapes, and relationships across the whole folder. A document that parses successfully could still report a broken project reference.",
      },
      {
        title: "Diagnostics where the author can act",
        body: "Source mapping is intended to connect a decoded field or relation failure back to file, line, and column. That would let a CLI or editor point at the same offending text.",
      },
      {
        title: "A foundation for reviewed edits",
        body: "A later phase proposes planning and revalidating minimal, format-preserving edits. This is a design goal, not an edit engine or rename capability available today.",
      },
    ],
    steps: [
      {
        title: "Today: describe the repository's rules",
        body: "List the documents that may exist, which are required, their parsing formats, and their Effect schemas. Use the proposed Layout example as a design sketch; it is not an installable API.",
      },
      {
        title: "Today: identify cross-file meaning",
        body: "Name entity types and the fields that define or reference them. Algebra can already validate decoded values provided by your own loader; the planned filesystem layer would add routing and source positions.",
      },
      {
        title: "Planned: make checking the shared boundary",
        body: "A future implementation would load a text snapshot and produce project diagnostics before changes reach a deployment or agent workspace. Parsing, validation, planning, and writing would remain distinct stages.",
      },
    ],
    scenario: {
      title: "A config review can eventually explain what a deletion breaks.",
      intro:
        "A project contains actions/*.json and workflows/*.yaml. A workflow references notify-manager, but the action file is absent. Each remaining file is syntactically valid.",
      steps: [
        {
          title: "Route — planned",
          body: "The layout would identify each document's format and schema from its path and captures.",
        },
        {
          title: "Link — planned",
          body: "After decoding, a combined graph would resolve references against definitions across the project's files.",
        },
        {
          title: "Report — planned",
          body: "The unresolved reference would become a diagnostic at the workflow's source range. Format-preserving repair is a later phase.",
        },
      ],
    },
    composition: [
      {
        name: "algebra",
        body: "This is the proposed relationship engine underneath cross-file checks. The design needs a shared graph across routed documents; algebra's existing relation annotations describe the domain meaning.",
      },
      {
        name: "predicates",
        body: "A later phase proposes project constraints over decoded documents. Conditions could describe rules across the project, but constraint execution and serializable layouts are not implemented.",
      },
      {
        name: "logic",
        body: "Action definitions could be stored as schema-checked documents. A layout would validate the files; a separate permitted executor would run actions. The filesystem design does not execute code discovered in files.",
      },
      {
        name: "workflow",
        body: "Workflow definitions could live beside their referenced action and event definitions. Their long-running instance checkpoints would still need the workflow host's own persistence protocol.",
      },
      {
        name: "core",
        body: "Portable contracts could help other tools inspect stored program definitions. The initial proposed layout uses native Effect schemas; carrying a complete layout as JSON is a further design question.",
      },
    ],
    boundaries: [
      {
        title: "Specification and type model only",
        body: "There is no published filesystem package, working validator, CLI, watcher, or edit engine yet. Routing and validation are proposed first-phase work; edits and incremental tooling belong to later phases.",
      },
      {
        title: "An explicit layout, with independent host tooling",
        body: "The design does not infer schemas, merge configuration overlays, execute JS/TS files, or provide an editor UI. For shipped schema-routed documents and relation diagnostics today, use the Schematics playground.",
      },
    ],
    adoption:
      "Use this page to evaluate the proposed architecture. For a working product today, try Schematics; for a small custom checker, pair your own file routing and decoding with algebra. There is no filesystem install command to run yet.",
    effect:
      "Filesystem is a draft specification, not a released runtime. Its eventual dependencies and API remain part of the design.",
  },
};

// Browser-only simulations: Foldkit owns state and commands, Foldworks owns
// accessible controls. These illustrate the APIs; they do not execute them.
import { Button } from "@foldworks/ui";
import { Effect, Schema } from "effect";
import { Command, Runtime, type Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import "@foldworks/ui/base.css";

const Kind = Schema.Literals(["algebra", "predicates", "logic", "workflow", "core"]);
export type Kind = typeof Kind.Type;
const Role = Schema.Literals(["agent", "lead", "finance"]);
const Actor = Schema.Literals(["reviewer", "reader"]);
const Workflow = Schema.Struct({
  memory: Schema.Literals(["empty", "rebooting", "loaded"]),
  status: Schema.Literals(["idle", "waiting", "approved"]),
  journal: Schema.Array(Schema.String),
  log: Schema.Array(Schema.String),
  generation: Schema.Number,
});
const Model = Schema.Struct({
  kind: Kind,
  reducedMotion: Schema.Boolean,
  deleted: Schema.Array(Schema.String),
  role: Role,
  usd: Schema.Number,
  predicateView: Schema.Literals(["tree", "json"]),
  actor: Actor,
  runs: Schema.Number,
  workflow: Workflow,
  coreView: Schema.Literals(["json", "validate"]),
  sample: Schema.Number,
});
type Model = typeof Model.Type;

const Message = defineMessageUnion({
  ClickedAction: { id: Schema.String },
  ChangedRole: { role: Role },
  ChangedRefund: { usd: Schema.Number },
  ChangedPredicateView: { view: Schema.Literals(["tree", "json"]) },
  ChangedActor: { actor: Actor },
  ClickedRun: {},
  ClickedStart: {},
  ClickedDeploy: {},
  CompletedReboot: { generation: Schema.Number },
  ClickedResume: {},
  ClickedApprove: {},
  ClickedReset: {},
  ChangedCoreView: { view: Schema.Literals(["json", "validate"]) },
  ChangedSample: { sample: Schema.Number },
});
type Message = typeof Message.Type;
const {
  ClickedAction,
  ChangedRole,
  ChangedRefund,
  ChangedPredicateView,
  ChangedActor,
  ClickedRun,
  ClickedStart,
  ClickedDeploy,
  CompletedReboot,
  ClickedResume,
  ClickedApprove,
  ClickedReset,
  ChangedCoreView,
  ChangedSample,
} = Message;

const reboot = Command.define("RebootProcess", {
  args: { generation: Schema.Number, delay: Schema.Number },
  messages: [CompletedReboot],
  execute: ({ generation, delay }) =>
    Effect.sleep(delay).pipe(Effect.as(CompletedReboot({ generation }))),
});
const idle = (generation = 0): typeof Workflow.Type => ({
  memory: "empty",
  status: "idle",
  journal: [],
  log: [],
  generation,
});

const update = (model: Model, message: Message): Update.Return<Model, Message> => {
  const w = model.workflow;
  switch (message._tag) {
    case "ClickedAction":
      return {
        model: {
          ...model,
          deleted: model.deleted.includes(message.id)
            ? model.deleted.filter((id) => id !== message.id)
            : [...model.deleted, message.id],
        },
      };
    case "ChangedRole":
      return { model: { ...model, role: message.role } };
    case "ChangedRefund":
      return { model: { ...model, usd: message.usd } };
    case "ChangedPredicateView":
      return { model: { ...model, predicateView: message.view } };
    case "ChangedActor":
      return { model: { ...model, actor: message.actor, runs: model.runs + 1 } };
    case "ClickedRun":
      return { model: { ...model, runs: model.runs + 1 } };
    case "ClickedStart":
      if (w.status !== "idle") return { model };
      return {
        model: {
          ...model,
          workflow: {
            ...w,
            memory: "loaded",
            status: "waiting",
            journal: ['{ "tag": "result", "at": 120, "value": { "requestId": "r-7" } }'],
            log: [
              "Workflow.start → dispatch RequestReview",
              "Workflow.advance(result) → waiting for ReviewSubmitted",
              "checkpoint.json saved",
            ],
          },
        },
      };
    case "ClickedDeploy": {
      if (w.memory !== "loaded" || w.status !== "waiting") return { model };
      const generation = w.generation + 1;
      return {
        model: {
          ...model,
          workflow: {
            ...w,
            generation,
            memory: "rebooting",
            log: [...w.log, "deploy — the process restarts, memory is gone"],
          },
        },
        commands: [reboot({ generation, delay: model.reducedMotion ? 0 : 700 })],
      };
    }
    case "CompletedReboot":
      return {
        model:
          message.generation === w.generation && w.memory === "rebooting"
            ? { ...model, workflow: { ...w, memory: "empty" } }
            : model,
      };
    case "ClickedResume":
      if (w.memory !== "empty" || w.journal.length === 0) return { model };
      return {
        model: {
          ...model,
          workflow: {
            ...w,
            memory: "loaded",
            log: [
              ...w.log,
              `Workflow.resume(checkpoint) → replayed ${w.journal.length} stimulus, no handler re-run`,
              "still waiting for ReviewSubmitted",
            ],
          },
        },
      };
    case "ClickedApprove":
      if (w.memory !== "loaded" || w.status !== "waiting") return { model };
      return {
        model: {
          ...model,
          workflow: {
            ...w,
            status: "approved",
            journal: [
              ...w.journal,
              '{ "tag": "event", "at": 259200000, "event": "ReviewSubmitted", "payload": { "decision": "approved" } }',
            ],
            log: [
              ...w.log,
              "Workflow.advance(event) → branch on decision",
              '✓ completed "approved"',
            ],
          },
        },
      };
    case "ClickedReset":
      return { model: { ...model, workflow: idle(w.generation + 1) } };
    case "ChangedCoreView":
      return { model: { ...model, coreView: message.view } };
    case "ChangedSample":
      return { model: { ...model, sample: message.sample } };
  }
};

type H = HtmlBuilder<Message>;
type Children = ReadonlyArray<Html | string>;
const div = (h: H, cls: string, children: Children) => h.div([h.Class(cls)], children);
const span = (h: H, cls: string, children: Children) => h.span([h.Class(cls)], children);
const hint = (h: H, text: string) => h.p([h.Class("demo-hint")], [text]);
const consoleView = (h: H, children: Children) =>
  h.div([h.Class("demo-console"), h.AriaLive("polite")], children);
const button = (
  h: H,
  label: string,
  onClick: Message,
  options: {
    disabled?: boolean;
    pressed?: boolean;
    ariaLabel?: string;
    className?: string;
  } = {},
) =>
  Button.view(
    {
      label,
      onClick,
      variant: "outline",
      size: "sm",
      isDisabled: options.disabled ?? false,
      ...(options.ariaLabel ? { ariaLabel: options.ariaLabel } : {}),
      attributes: [
        ...(options.className ? [h.Class(options.className)] : []),
        ...(options.pressed === undefined ? [] : [h.AriaPressed(String(options.pressed))]),
      ],
    },
    h,
  );
const segmented = <T extends string>(
  h: H,
  label: string,
  options: readonly T[],
  value: T,
  toMessage: (value: T) => Message,
) =>
  h.div(
    [h.Class("segmented"), h.Role("group"), h.AriaLabel(label)],
    [
      span(h, "segmented-label", [label]),
      ...options.map((option) =>
        button(h, option, toMessage(option), { pressed: option === value }),
      ),
    ],
  );
const verdict = (h: H, ok: boolean, text: string) =>
  span(h, `verdict ${ok ? "is-ok" : "is-bad"}`, [text]);
const tabs = (h: H, label: string, children: Children) =>
  h.div([h.Class("demo-tabs"), h.Role("group"), h.AriaLabel(label)], children);

const ACTIONS = ["send-welcome-email", "order-laptop", "notify-manager"];
const WORKFLOWS = [
  { id: "onboarding", actionIds: ACTIONS },
  { id: "offboarding", actionIds: ["notify-manager"] },
];
const algebraView = (m: Model, h: H) => {
  const diagnostics = WORKFLOWS.flatMap((workflow, w) =>
    workflow.actionIds.flatMap((id, a) =>
      m.deleted.includes(id) ? [{ path: `workflows.${w}.actionIds.${a}`, id }] : [],
    ),
  );
  return [
    hint(h, "Delete an action. Watch who breaks."),
    div(h, "algebra-board", [
      div(h, "", [
        div(h, "demo-caption", ["actions/"]),
        h.ul(
          [h.Class("algebra-actions")],
          ACTIONS.map((id) => {
            const gone = m.deleted.includes(id);
            return h.li(
              [h.Class(gone ? "is-gone" : "")],
              [
                h.code([], [id]),
                button(h, gone ? "restore" : "× delete", ClickedAction({ id }), {
                  ariaLabel: `${gone ? "Restore" : "Delete"} ${id}`,
                }),
              ],
            );
          }),
        ),
      ]),
      div(h, "", [
        div(h, "demo-caption", ["workflows/"]),
        h.ul(
          [h.Class("algebra-workflows")],
          WORKFLOWS.map((workflow) =>
            h.li(
              [],
              [
                h.strong([], [workflow.id]),
                span(
                  h,
                  "algebra-refs",
                  workflow.actionIds.map((id) =>
                    span(h, `ref-chip ${m.deleted.includes(id) ? "is-broken" : ""}`, [
                      `${m.deleted.includes(id) ? "⚠ " : "→ "}${id}`,
                    ]),
                  ),
                ),
              ],
            ),
          ),
        ),
      ]),
    ]),
    consoleView(h, [
      div(h, "console-meta", [
        `${ACTIONS.length - m.deleted.length + WORKFLOWS.length} definitions · 4 references · `,
        verdict(
          h,
          diagnostics.length === 0,
          `${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"}`,
        ),
      ]),
      ...(diagnostics.length === 0
        ? [div(h, "tone-ok", ["✓ every reference resolves"])]
        : diagnostics.map((d) =>
            div(h, "tone-err", [
              "× unresolved-ref ",
              span(h, "console-path", [d.path]),
              h.br([]),
              span(h, "console-message", [`Unresolved Action reference "${d.id}"`]),
            ]),
          )),
    ]),
  ];
};

const PREDICATE_JSON = `{ "_tag": "Or", "predicates": [
  { "_tag": "Role", "is": "finance" },
  { "_tag": "And", "predicates": [
    { "_tag": "Role", "is": "lead" },
    { "_tag": "MaxAmount", "usd": 500 }
  ] }
] }`;
const predicatesView = (m: Model, h: H) => {
  const finance = m.role === "finance",
    lead = m.role === "lead",
    underLimit = m.usd <= 500;
  const allowed = finance || (lead && underLimit);
  const mark = (ok: boolean) => verdict(h, ok, ok ? "✓" : "×");
  return [
    hint(h, "Change who's asking. The rule answers — and explains itself."),
    div(h, "demo-controls", [
      segmented(h, "role", ["agent", "lead", "finance"], m.role, (role) => ChangedRole({ role })),
      h.label(
        [h.Class("slider")],
        [
          span(h, "segmented-label", ["refund"]),
          h.input([
            h.Type("range"),
            h.Min("20"),
            h.Max("1500"),
            h.Step("10"),
            h.Value(String(m.usd)),
            h.AriaLabel("Refund amount in dollars"),
            h.OnInput((value) => ChangedRefund({ usd: Number(value) })),
          ]),
          h.output([], [`$${m.usd}`]),
        ],
      ),
    ]),
    tabs(h, "Predicate view", [
      button(h, "evaluate", ChangedPredicateView({ view: "tree" }), {
        pressed: m.predicateView === "tree",
      }),
      button(h, "stored as JSON", ChangedPredicateView({ view: "json" }), {
        pressed: m.predicateView === "json",
      }),
    ]),
    m.predicateView === "json"
      ? h.pre([h.Class("demo-json")], [PREDICATE_JSON])
      : div(h, "predicate-tree", [
          div(h, "", [
            "Or ",
            mark(allowed),
            div(h, "branch", ['Role is "finance" ', mark(finance)]),
            div(h, "branch", [
              "And ",
              mark(lead && underLimit),
              div(h, "branch", ['Role is "lead" ', mark(lead)]),
              div(h, "branch", [
                "MaxAmount 500 ",
                mark(underLimit),
                " ",
                span(h, "console-path", [`$${m.usd} ${underLimit ? "≤" : ">"} $500`]),
              ]),
            ]),
          ]),
        ]),
    consoleView(h, [
      div(h, "console-meta", ["fold → a sentence for your admin UI"]),
      div(h, "", ["finance OR (lead AND refund ≤ $500)"]),
      div(h, allowed ? "tone-ok" : "tone-err", [
        `${allowed ? "✓ ALLOW" : "× DENY"} — ${m.role} asking for $${m.usd}`,
      ]),
    ]),
  ];
};

const logicView = (m: Model, h: H) => {
  const allowed = m.actor === "reviewer";
  const trace = allowed
    ? [
        ["require", 'actor.role == "reviewer"', "✓"],
        ["set", 'candidate.status = "approved"', "staged"],
        ["emit", 'candidate.approved { id: "c1" }', "staged"],
        ["get", "candidate.status", '"approved"'],
      ]
    : [["require", 'actor.role == "reviewer"', "× forbidden"]];
  return [
    hint(h, "Dry-run the action in memory. Nothing real happens."),
    div(h, "demo-controls", [
      segmented(h, "actor", ["reviewer", "reader"], m.actor, (actor) => ChangedActor({ actor })),
      button(h, "▶ Logic.run", ClickedRun(), { className: "demo-run" }),
    ]),
    h.ol(
      [h.Class("logic-trace"), h.Key(`${m.actor}-${m.runs}`)],
      trace.map(([op, what, result], i) =>
        h.li(
          [h.Style({ animationDelay: `${i * 140}ms` })],
          [
            span(h, "trace-op", [op ?? ""]),
            h.code([], [what ?? ""]),
            span(h, result?.startsWith("×") ? "tone-err" : "tone-ok", [result ?? ""]),
          ],
        ),
      ),
    ),
    consoleView(
      h,
      allowed
        ? [
            div(h, "", [span(h, "console-key", ["result"]), ' "approved"']),
            div(h, "", [
              span(h, "console-key", ["state"]),
              ' candidate.status: "pending" → ',
              span(h, "tone-ok", ['"approved"']),
            ]),
            div(h, "", [span(h, "console-key", ["events"]), ' candidate.approved { id: "c1" }']),
          ]
        : [
            div(h, "tone-err", ["× RequireFailed: forbidden"]),
            div(h, "", [span(h, "console-key", ["state"]), " unchanged"]),
            div(h, "", [span(h, "console-key", ["events"]), " none"]),
          ],
    ),
  ];
};

const workflowView = (m: Model, h: H) => {
  const w = m.workflow;
  const loaded = w.memory === "loaded",
    waiting = w.status === "waiting";
  return [
    hint(h, "Start the review, then ship a deploy halfway through."),
    div(h, "workflow-buttons", [
      button(h, "1 · start review", ClickedStart(), { disabled: w.status !== "idle" }),
      button(h, "2 · deploy mid-review", ClickedDeploy(), { disabled: !loaded || !waiting }),
      button(h, "3 · resume", ClickedResume(), {
        disabled: w.memory !== "empty" || w.journal.length === 0,
      }),
      button(h, "4 · reviewer approves", ClickedApprove(), { disabled: !loaded || !waiting }),
      button(h, "reset", ClickedReset(), {
        className: "demo-reset",
        ariaLabel: "reset the workflow demo",
      }),
    ]),
    div(h, "workflow-panes", [
      div(h, `process-pane memory-${w.memory}`, [
        div(h, "demo-caption", ["process memory"]),
        div(h, "process-state", [
          w.memory === "rebooting"
            ? "rebooting…"
            : w.memory === "empty"
              ? w.journal.length
                ? "empty — but the checkpoint survived"
                : "empty"
              : waiting
                ? "⏳ waiting for a reviewer"
                : `✓ ${w.status}`,
        ]),
      ]),
      div(h, "process-pane", [
        div(h, "demo-caption", ["checkpoint.json · on disk (simplified)"]),
        h.pre(
          [h.Class("demo-json")],
          [
            w.journal.length === 0
              ? "// nothing saved yet"
              : `{ "format": "schema-reflection/checkpoint",
  "instanceId": "review-1",
  "input": { "candidateId": "c1" },
  "history": [
${w.journal.map((entry) => `    ${entry}`).join(",\n")}
  ] }`,
          ],
        ),
      ]),
    ]),
    consoleView(
      h,
      w.log.length === 0
        ? [div(h, "console-meta", ["› press start"])]
        : w.log.map((line) => div(h, line.startsWith("✓") ? "tone-ok" : "", [line])),
    ),
  ];
};

const SAMPLES = [
  { label: "a valid candidate", value: '{ "id": "c1", "status": "pending" }', error: null },
  {
    label: "an unknown status",
    value: '{ "id": "c1", "status": "archived" }',
    error: 'status: expected "pending" | "approved"',
  },
  {
    label: "an extra key",
    value: '{ "id": "c1", "status": "pending", "admin": true }',
    error: "admin: unexpected key — objects are exact",
  },
];
const CONTRACT_JSON = `{
  "format": "schema-reflection/schema",
  "formatVersion": 1,
  "schema": {
    "kind": "object",
    "fields": {
      "id":     { "schema": { "kind": "string" }, "optional": false },
      "note":   { "schema": { "kind": "string" }, "optional": true },
      "status": { "schema": { "kind": "union", "members": [
        { "kind": "literal", "value": "pending" },
        { "kind": "literal", "value": "approved" }
      ] }, "optional": false }
    }
  }
}`;
const coreView = (m: Model, h: H) => {
  const current = SAMPLES[m.sample] ?? SAMPLES[0]!;
  return [
    hint(h, "The contract, as data anyone can read — no TypeScript required."),
    tabs(h, "Contract view", [
      button(h, "MetaSchema.encode", ChangedCoreView({ view: "json" }), {
        pressed: m.coreView === "json",
      }),
      button(h, "MetaSchema.validate", ChangedCoreView({ view: "validate" }), {
        pressed: m.coreView === "validate",
      }),
    ]),
    ...(m.coreView === "json"
      ? [h.pre([h.Class("demo-json")], [CONTRACT_JSON])]
      : [
          div(h, "demo-controls", [
            h.div(
              [h.Class("segmented"), h.Role("group"), h.AriaLabel("Sample value")],
              [
                span(h, "segmented-label", ["try"]),
                ...SAMPLES.map((sample, i) =>
                  button(h, sample.label, ChangedSample({ sample: i }), {
                    pressed: i === m.sample,
                  }),
                ),
              ],
            ),
          ]),
          consoleView(h, [
            div(h, "console-meta", [current.value]),
            div(h, current.error === null ? "tone-ok" : "tone-err", [
              current.error === null
                ? "✓ valid — returns a frozen JSON snapshot"
                : `× Diagnostic · ${current.error}`,
            ]),
          ]),
        ]),
  ];
};
const views = {
  algebra: algebraView,
  predicates: predicatesView,
  logic: logicView,
  workflow: workflowView,
  core: coreView,
};

export function mountDemo(container: HTMLElement) {
  const kind = Schema.decodeUnknownSync(Kind)(container.dataset["foldkitDemo"]);
  return Runtime.embed(
    Runtime.makeElement({
      Model,
      update,
      container,
      devTools: false,
      init: (): Update.Return<Model, Message> => ({
        model: {
          kind,
          reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
          deleted: [],
          role: "lead",
          usd: 320,
          predicateView: "tree",
          actor: "reviewer",
          runs: 0,
          workflow: idle(),
          coreView: "json",
          sample: 0,
        },
      }),
      view: (model, h) =>
        h.div(
          [
            h.Id(container.id),
            h.Class("demo"),
            h.DataAttribute("demo", kind),
            h.DataAttribute("foldkit-demo", kind),
          ],
          views[kind](model, h),
        ),
    }),
  );
}

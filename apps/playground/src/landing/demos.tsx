// Small, honest simulations of each package, built from plain React state.
// The landing page must not load Effect or the libraries themselves (the
// landing e2e asserts that), so each demo mirrors the behavior documented in
// the package README next to the real code it simulates.

import { useEffect, useRef, useState } from "react";

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      <span className="segmented-label">{label}</span>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function Verdict({ ok, children }: { ok: boolean; children: string }) {
  return <span className={`verdict ${ok ? "is-ok" : "is-bad"}`}>{children}</span>;
}

// ── algebra ────────────────────────────────────────────────────────────────

const ACTIONS = ["send-welcome-email", "order-laptop", "notify-manager"] as const;
const WORKFLOWS = [
  { id: "onboarding", actionIds: ["send-welcome-email", "order-laptop", "notify-manager"] },
  { id: "offboarding", actionIds: ["notify-manager"] },
] as const;

export function AlgebraDemo() {
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setDeleted((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const diagnostics = WORKFLOWS.flatMap((workflow, w) =>
    workflow.actionIds.flatMap((id, a) =>
      deleted.has(id) ? [{ path: `workflows.${w}.actionIds.${a}`, id }] : [],
    ),
  );
  const references = WORKFLOWS.reduce((n, workflow) => n + workflow.actionIds.length, 0);

  return (
    <div className="demo" data-demo="algebra">
      <p className="demo-hint">Delete an action. Watch who breaks.</p>
      <div className="algebra-board">
        <div>
          <div className="demo-caption">actions/</div>
          <ul className="algebra-actions">
            {ACTIONS.map((id) => {
              const gone = deleted.has(id);
              return (
                <li key={id} className={gone ? "is-gone" : undefined}>
                  <code>{id}</code>
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    aria-label={`${gone ? "Restore" : "Delete"} ${id}`}
                  >
                    {gone ? "restore" : "× delete"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <div className="demo-caption">workflows/</div>
          <ul className="algebra-workflows">
            {WORKFLOWS.map((workflow) => (
              <li key={workflow.id}>
                <strong>{workflow.id}</strong>
                <span className="algebra-refs">
                  {workflow.actionIds.map((id) => (
                    <span key={id} className={`ref-chip ${deleted.has(id) ? "is-broken" : ""}`}>
                      {deleted.has(id) ? "⚠ " : "→ "}
                      {id}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="demo-console" aria-live="polite">
        <div className="console-meta">
          {ACTIONS.length - deleted.size + WORKFLOWS.length} definitions · {references} references ·{" "}
          <Verdict ok={diagnostics.length === 0}>
            {`${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"}`}
          </Verdict>
        </div>
        {diagnostics.length === 0 ? (
          <div className="tone-ok">✓ every reference resolves</div>
        ) : (
          diagnostics.map((d) => (
            <div key={d.path} className="tone-err">
              ✗ unresolved-ref <span className="console-path">{d.path}</span>
              <br />
              <span className="console-message">Unresolved Action reference "{d.id}"</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── predicates ─────────────────────────────────────────────────────────────

const ROLES = ["agent", "lead", "finance"] as const;
type Role = (typeof ROLES)[number];

export function PredicatesDemo() {
  const [role, setRole] = useState<Role>("lead");
  const [usd, setUsd] = useState(320);
  const [view, setView] = useState<"tree" | "json">("tree");

  const isFinance = role === "finance";
  const isLead = role === "lead";
  const underLimit = usd <= 500;
  const leadBranch = isLead && underLimit;
  const allowed = isFinance || leadBranch;

  const mark = (ok: boolean) => <Verdict ok={ok}>{ok ? "✓" : "✗"}</Verdict>;

  return (
    <div className="demo" data-demo="predicates">
      <p className="demo-hint">Change who's asking. The rule answers — and explains itself.</p>
      <div className="demo-controls">
        <Segmented label="role" options={ROLES} value={role} onChange={setRole} />
        <label className="slider">
          <span className="segmented-label">refund</span>
          <input
            type="range"
            min={20}
            max={1500}
            step={10}
            value={usd}
            onChange={(event) => setUsd(Number(event.target.value))}
            aria-label="Refund amount in dollars"
          />
          <output>${usd}</output>
        </label>
      </div>
      <div className="demo-tabs" role="group" aria-label="Predicate view">
        <button type="button" aria-pressed={view === "tree"} onClick={() => setView("tree")}>
          evaluate
        </button>
        <button type="button" aria-pressed={view === "json"} onClick={() => setView("json")}>
          stored as JSON
        </button>
      </div>
      {view === "tree" ? (
        <div className="predicate-tree">
          <div>
            Or {mark(allowed)}
            <div className="branch">Role is "finance" {mark(isFinance)}</div>
            <div className="branch">
              And {mark(leadBranch)}
              <div className="branch">Role is "lead" {mark(isLead)}</div>
              <div className="branch">
                MaxAmount 500 {mark(underLimit)}{" "}
                <span className="console-path">
                  ${usd} {underLimit ? "≤" : ">"} $500
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <pre className="demo-json">{`{ "_tag": "Or", "predicates": [
  { "_tag": "Role", "is": "finance" },
  { "_tag": "And", "predicates": [
    { "_tag": "Role", "is": "lead" },
    { "_tag": "MaxAmount", "usd": 500 }
  ] }
] }`}</pre>
      )}
      <div className="demo-console" aria-live="polite">
        <div className="console-meta">fold → a sentence for your admin UI</div>
        <div>finance OR (lead AND refund ≤ $500)</div>
        <div className={allowed ? "tone-ok" : "tone-err"}>
          {allowed ? "✓ ALLOW" : "✗ DENY"} — {role} asking for ${usd}
        </div>
      </div>
    </div>
  );
}

// ── logic ──────────────────────────────────────────────────────────────────

const ACTORS = ["reviewer", "reader"] as const;
type Actor = (typeof ACTORS)[number];

export function LogicDemo() {
  const [actor, setActor] = useState<Actor>("reviewer");
  const [run, setRun] = useState(0);
  const allowed = actor === "reviewer";

  const trace: ReadonlyArray<readonly [op: string, what: string, result: string]> = allowed
    ? [
        ["require", 'actor.role == "reviewer"', "✓"],
        ["set", 'candidate.status = "approved"', "staged"],
        ["emit", 'candidate.approved { id: "c1" }', "staged"],
        ["get", "candidate.status", '"approved"'],
      ]
    : [["require", 'actor.role == "reviewer"', "✗ forbidden"]];

  return (
    <div className="demo" data-demo="logic">
      <p className="demo-hint">Dry-run the action in memory. Nothing real happens.</p>
      <div className="demo-controls">
        <Segmented
          label="actor"
          options={ACTORS}
          value={actor}
          onChange={(value) => {
            setActor(value);
            setRun((n) => n + 1);
          }}
        />
        <button type="button" className="demo-run" onClick={() => setRun((n) => n + 1)}>
          ▶ Logic.run
        </button>
      </div>
      <ol className="logic-trace" key={`${actor}-${run}`}>
        {trace.map(([op, what, result], i) => (
          <li key={op} style={{ animationDelay: `${i * 140}ms` }}>
            <span className="trace-op">{op}</span>
            <code>{what}</code>
            <span className={result.startsWith("✗") ? "tone-err" : "tone-ok"}>{result}</span>
          </li>
        ))}
      </ol>
      <div className="demo-console" aria-live="polite">
        {allowed ? (
          <>
            <div>
              <span className="console-key">result</span> "approved"
            </div>
            <div>
              <span className="console-key">state</span> candidate.status: "pending" →{" "}
              <span className="tone-ok">"approved"</span>
            </div>
            <div>
              <span className="console-key">events</span> candidate.approved {'{ id: "c1" }'}
            </div>
          </>
        ) : (
          <>
            <div className="tone-err">✗ RequireFailed: forbidden</div>
            <div>
              <span className="console-key">state</span> unchanged
            </div>
            <div>
              <span className="console-key">events</span> none
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── workflow ───────────────────────────────────────────────────────────────

// History entries follow the shape of workflow's Stimulus; fields are trimmed.
type Journal = ReadonlyArray<string>;
type Machine = {
  memory: "empty" | "rebooting" | "loaded";
  status: "idle" | "waiting" | "approved" | "rejected";
  journal: Journal;
  log: ReadonlyArray<string>;
};

const IDLE: Machine = { memory: "empty", status: "idle", journal: [], log: [] };

export function WorkflowDemo() {
  const [m, setM] = useState<Machine>(IDLE);
  const reboot = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(reboot.current), []);

  const start = () =>
    setM({
      memory: "loaded",
      status: "waiting",
      journal: ['{ "tag": "result", "at": 120, "value": { "requestId": "r-7" } }'],
      log: [
        "Workflow.start → dispatch RequestReview",
        "Workflow.advance(result) → waiting for ReviewSubmitted",
        "checkpoint.json saved",
      ],
    });

  const deploy = () => {
    setM((prev) => ({
      ...prev,
      memory: "rebooting",
      log: [...prev.log, "deploy — the process restarts, memory is gone"],
    }));
    window.clearTimeout(reboot.current);
    reboot.current = window.setTimeout(
      () => setM((prev) => ({ ...prev, memory: "empty" })),
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700,
    );
  };

  const resume = () =>
    setM((prev) => ({
      ...prev,
      memory: "loaded",
      log: [
        ...prev.log,
        `Workflow.resume(checkpoint) → replayed ${prev.journal.length} stimulus, no handler re-run`,
        "still waiting for ReviewSubmitted",
      ],
    }));

  const decide = (decision: "approved" | "rejected") =>
    setM((prev) => ({
      ...prev,
      status: decision,
      journal: [
        ...prev.journal,
        `{ "tag": "event", "at": 259200000, "event": "ReviewSubmitted", "payload": { "decision": "${decision}" } }`,
      ],
      log: [
        ...prev.log,
        "Workflow.advance(event) → branch on decision",
        `✓ completed "${decision}"`,
      ],
    }));

  const loaded = m.memory === "loaded";
  const waiting = m.status === "waiting";

  return (
    <div className="demo" data-demo="workflow">
      <p className="demo-hint">Start the review, then ship a deploy halfway through.</p>
      <div className="workflow-buttons">
        <button type="button" onClick={start} disabled={m.status !== "idle"}>
          1 · start review
        </button>
        <button type="button" onClick={deploy} disabled={!loaded || !waiting}>
          2 · deploy mid-review
        </button>
        <button
          type="button"
          onClick={resume}
          disabled={m.memory !== "empty" || m.journal.length === 0}
        >
          3 · resume
        </button>
        <button type="button" onClick={() => decide("approved")} disabled={!loaded || !waiting}>
          4 · reviewer approves
        </button>
        <button type="button" className="demo-reset" onClick={() => setM(IDLE)}>
          reset
          <span className="sr-only"> the workflow demo</span>
        </button>
      </div>
      <div className="workflow-panes">
        <div className={`process-pane memory-${m.memory}`}>
          <div className="demo-caption">process memory</div>
          <div className="process-state">
            {m.memory === "rebooting"
              ? "rebooting…"
              : m.memory === "empty"
                ? m.journal.length
                  ? "empty — but the checkpoint survived"
                  : "empty"
                : m.status === "waiting"
                  ? "⏳ waiting for a reviewer"
                  : `✓ ${m.status}`}
          </div>
        </div>
        <div className="process-pane">
          <div className="demo-caption">checkpoint.json · on disk (simplified)</div>
          <pre className="demo-json">
            {m.journal.length === 0
              ? "// nothing saved yet"
              : `{ "format": "schema-reflection/checkpoint",
  "instanceId": "review-1",
  "input": { "candidateId": "c1" },
  "history": [
${m.journal.map((entry) => `    ${entry}`).join(",\n")}
  ] }`}
          </pre>
        </div>
      </div>
      <div className="demo-console" aria-live="polite">
        {m.log.length === 0 ? (
          <div className="console-meta">› press start</div>
        ) : (
          m.log.map((line, i) => (
            <div key={i} className={line.startsWith("✓") ? "tone-ok" : undefined}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── core ───────────────────────────────────────────────────────────────────

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
] as const;

export function CoreDemo() {
  const [view, setView] = useState<"json" | "validate">("json");
  const [sample, setSample] = useState(0);
  const current = SAMPLES[sample] ?? SAMPLES[0];

  return (
    <div className="demo" data-demo="core">
      <p className="demo-hint">The contract, as data anyone can read — no TypeScript required.</p>
      <div className="demo-tabs" role="group" aria-label="Contract view">
        <button type="button" aria-pressed={view === "json"} onClick={() => setView("json")}>
          MetaSchema.encode
        </button>
        <button
          type="button"
          aria-pressed={view === "validate"}
          onClick={() => setView("validate")}
        >
          MetaSchema.validate
        </button>
      </div>
      {view === "json" ? (
        <pre className="demo-json">{`{
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
}`}</pre>
      ) : (
        <>
          <div className="demo-controls">
            <div className="segmented" role="group" aria-label="Sample value">
              <span className="segmented-label">try</span>
              {SAMPLES.map((s, i) => (
                <button
                  key={s.label}
                  type="button"
                  aria-pressed={i === sample}
                  onClick={() => setSample(i)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="demo-console" aria-live="polite">
            <div className="console-meta">{current.value}</div>
            {current.error === null ? (
              <div className="tone-ok">✓ valid — returns a frozen JSON snapshot</div>
            ) : (
              <div className="tone-err">✗ Diagnostic at {current.error}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

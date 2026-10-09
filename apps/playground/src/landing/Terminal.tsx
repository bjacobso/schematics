// The hero REPL. It types one real call per package — the same APIs shown in
// the package sections below — prints a result, and keeps a short scrollback so
// the session reads like someone poking at each library in turn. Reduced
// motion renders the whole session at once and never animates.

type Entry = {
  pkg: string;
  call: string;
  result: string;
  tone: "ok" | "err" | "info";
};

const SESSION: Entry[] = [
  {
    pkg: "algebra",
    call: "Relation.validate(Workspace, config)",
    result: '× unresolved-ref  Action "send-welcome-email"',
    tone: "err",
  },
  {
    pkg: "predicates",
    call: "Policy.evaluate(CanApproveRefund, check)",
    result: "true  — lead, $320 ≤ $500",
    tone: "ok",
  },
  {
    pkg: "logic",
    call: "await Logic.run(ApproveCandidate, input)",
    result: "✓ status → approved · emitted candidate.approved",
    tone: "ok",
  },
  {
    pkg: "workflow",
    call: "Workflow.resume(Review, checkpoint)",
    result: "▸ waiting for ReviewSubmitted · nothing lost",
    tone: "info",
  },
  {
    pkg: "core",
    call: "MetaSchema.encode(Candidate)",
    result: '{ "format": "schema-reflection/schema", … }',
    tone: "info",
  },
];

// Render the whole session at build time. The browser progressively animates
// these existing lines without loading a rendering framework.
export function Terminal() {
  return (
    <figure className="repl" aria-label="A REPL session calling each Schematics package in turn">
      <div className="repl-bar">
        <span className="repl-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="repl-title">
          repl — <strong>schema-reflection</strong>
        </span>
      </div>
      <div className="repl-body" aria-hidden="true">
        {SESSION.map((entry) => (
          <div className="repl-entry" data-package={entry.pkg} key={entry.pkg}>
            <div>
              <span className="repl-prompt">›</span> <span data-call>{entry.call}</span>
            </div>
            <div className={`repl-result tone-${entry.tone}`}>{entry.result}</div>
          </div>
        ))}
      </div>
    </figure>
  );
}

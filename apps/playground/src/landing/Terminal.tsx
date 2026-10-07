// The hero REPL. It types one real call per package — the same APIs shown in
// the package sections below — prints a result, and keeps a short scrollback so
// the session reads like someone poking at each library in turn. Reduced
// motion renders the whole session at once and never animates.

import { useEffect, useState } from "react";

const TYPE_MS = 30;
const HOLD_MS = 1500;
const SCROLLBACK = 3;

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
    result: '✗ unresolved-ref  Action "send-welcome-email"',
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

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type Phase = "call" | "result" | "hold";

function Line({ entry, typed, cursor }: { entry: Entry; typed?: string; cursor?: boolean }) {
  return (
    <div className="repl-entry">
      <div className={cursor && typed !== undefined ? "term-cursor" : undefined}>
        <span className="repl-prompt">›</span> {typed ?? entry.call}
      </div>
      {typed === undefined && (
        <div className={`repl-result tone-${entry.tone}`}>{entry.result}</div>
      )}
    </div>
  );
}

export function Terminal() {
  const [reduced] = useState(prefersReducedMotion);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("call");
  const [typed, setTyped] = useState("");

  const entry = SESSION[index] ?? SESSION[0]!;

  useEffect(() => {
    if (reduced) return;
    let timer: number;
    if (phase === "call") {
      timer =
        typed.length < entry.call.length
          ? window.setTimeout(() => setTyped(entry.call.slice(0, typed.length + 1)), TYPE_MS)
          : window.setTimeout(() => setPhase("result"), TYPE_MS * 8);
    } else if (phase === "result") {
      timer = window.setTimeout(() => setPhase("hold"), HOLD_MS);
    } else {
      timer = window.setTimeout(() => {
        setIndex((i) => (i + 1) % SESSION.length);
        setTyped("");
        setPhase("call");
      }, 250);
    }
    return () => window.clearTimeout(timer);
  }, [reduced, phase, typed, entry]);

  const history = reduced ? SESSION : SESSION.slice(Math.max(0, index - SCROLLBACK), index);
  const pkg = reduced ? "schema-reflection" : `@schema-reflection/${entry.pkg}`;

  return (
    <figure className="repl" aria-label="A REPL session calling each Schematics package in turn">
      <div className="repl-bar">
        <span className="repl-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="repl-title">
          repl — <strong>{pkg}</strong>
        </span>
      </div>
      <div className="repl-body" aria-hidden="true">
        {history.map((done) => (
          <Line key={done.pkg} entry={done} />
        ))}
        {!reduced &&
          (phase === "call" ? <Line entry={entry} typed={typed} cursor /> : <Line entry={entry} />)}
      </div>
    </figure>
  );
}

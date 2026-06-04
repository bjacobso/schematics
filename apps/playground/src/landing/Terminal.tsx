// A tiny faux-terminal for the hero. It cycles through the schematics workflow
// — validate, pull, plan, apply, diagnostics, reflect — typing each command and
// its output, holding, then advancing to the next. Reduced motion shows the
// anchor (reflect) stage whole and never animates.
// Note: this is intentionally NOT the pinned <h1> — the heading renders in full,
// static text elsewhere so the landing e2e assertion is never racing a typer.

import { useEffect, useState } from "react";

const TYPE_MS = 38;
const HOLD_MS = 1700;

// One turn through the loop walks the everyday lifecycle of a schematics file.
type Stage = {
  label: string;
  command: string;
  output: string;
  tone: "ok" | "warn" | "info";
};

const STAGES: Stage[] = [
  {
    label: "validate",
    command: "schematics validate users/alice.yaml",
    output: "✓ valid — conforms to UserSchema",
    tone: "ok",
  },
  {
    label: "pull",
    command: "schematics pull",
    output: "▸ synced 12 artifacts from origin",
    tone: "info",
  },
  {
    label: "plan",
    command: "schematics plan",
    output: "~ 3 to change · 1 to add · 0 to destroy",
    tone: "warn",
  },
  {
    label: "apply",
    command: "schematics apply",
    output: "✓ applied — the system matches the files",
    tone: "ok",
  },
  {
    label: "diagnostics",
    command: "schematics diagnostics forms/signup.yaml",
    output: "! 2 warnings · 0 errors",
    tone: "warn",
  },
  {
    label: "reflect",
    command: "schematics reflect users/alice.yaml",
    output: "▸ the schema is the contract",
    tone: "info",
  },
];

// reflect is the anchor: the line we leave on screen for reduced-motion readers.
const ANCHOR = STAGES.length - 1;

const TONE_CLASS: Record<Stage["tone"], string> = {
  ok: "text-chart-2",
  warn: "text-chart-4",
  info: "text-primary",
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type Phase = "command" | "output" | "hold";

export function Terminal() {
  const [stageIndex, setStageIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("command");
  const [typedCommand, setTypedCommand] = useState("");
  const [typedOutput, setTypedOutput] = useState("");

  const stage = STAGES[stageIndex];

  useEffect(() => {
    if (prefersReducedMotion()) {
      const anchor = STAGES[ANCHOR];
      setStageIndex(ANCHOR);
      setTypedCommand(anchor.command);
      setTypedOutput(anchor.output);
      setPhase("hold");
      return;
    }

    let timer: number;

    if (phase === "command") {
      if (typedCommand.length < stage.command.length) {
        timer = window.setTimeout(() => {
          setTypedCommand(stage.command.slice(0, typedCommand.length + 1));
        }, TYPE_MS);
      } else {
        timer = window.setTimeout(() => setPhase("output"), TYPE_MS * 4);
      }
    } else if (phase === "output") {
      if (typedOutput.length < stage.output.length) {
        timer = window.setTimeout(() => {
          setTypedOutput(stage.output.slice(0, typedOutput.length + 1));
        }, TYPE_MS);
      } else {
        timer = window.setTimeout(() => setPhase("hold"), HOLD_MS);
      }
    } else {
      // hold → advance to the next stage and reset the typers.
      timer = window.setTimeout(() => {
        setStageIndex((i) => (i + 1) % STAGES.length);
        setTypedCommand("");
        setTypedOutput("");
        setPhase("command");
      }, 300);
    }

    return () => window.clearTimeout(timer);
  }, [phase, typedCommand, typedOutput, stage]);

  const commandDone = typedCommand.length === stage.command.length;
  const outputDone = typedOutput.length === stage.output.length;
  const showCommandCursor = phase === "command" && !commandDone;
  const showOutputCursor = (phase === "output" && !outputDone) || phase === "hold";

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card font-mono text-sm shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-chart-5/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-chart-4/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-chart-2/70" />
        <span className="ml-2 text-xs text-muted-foreground">schematics — {stage.label}</span>
      </div>
      <div className="flex min-h-[3.25rem] flex-col gap-1 px-4 py-3">
        <div className={`text-foreground ${showCommandCursor ? "term-cursor" : ""}`}>
          <span className="text-muted-foreground">$</span> {typedCommand}
        </div>
        <div className={`${TONE_CLASS[stage.tone]} ${showOutputCursor ? "term-cursor" : ""}`}>
          {phase === "command" ? " " : typedOutput}
        </div>
      </div>
    </div>
  );
}

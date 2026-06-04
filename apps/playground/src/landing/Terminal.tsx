// A tiny faux-terminal for the hero. The command line is static; the output
// line types itself in, then a cursor blinks. Reduced-motion shows it whole.
// Note: this is intentionally NOT the pinned <h1> — the heading renders in full,
// static text elsewhere so the landing e2e assertion is never racing a typer.

import { useEffect, useState } from "react";

const TYPE_MS = 42;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function Terminal({ command, output }: { command: string; output: string }) {
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setTyped(output);
      setDone(true);
      return;
    }

    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(output.slice(0, i));
      if (i >= output.length) {
        window.clearInterval(id);
        setDone(true);
      }
    }, TYPE_MS);

    return () => window.clearInterval(id);
  }, [output]);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card font-mono text-sm shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-chart-5/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-chart-4/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-chart-2/70" />
        <span className="ml-2 text-xs text-muted-foreground">schematics — reflect</span>
      </div>
      <div className="flex flex-col gap-1 px-4 py-3">
        <div className="text-foreground">
          <span className="text-muted-foreground">$</span> {command}
        </div>
        <div className={`text-primary ${done ? "" : "term-cursor"}`}>▸ {typed}</div>
      </div>
    </div>
  );
}

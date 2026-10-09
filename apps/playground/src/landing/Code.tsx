// Tokenize the fixed TypeScript examples while Astro renders the homepage.
// Highlighted spans ship as HTML; the browser loads no syntax highlighter.

import type { ReactNode } from "react";

const TOKEN =
  /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*")|\b(import|from|const|await|export|return|true|false)\b|\b(\d[\d_]*)\b|\b([A-Z][A-Za-z]*)(?=\.)|(\.[a-z][A-Za-z]*)(?=\()/g;

const CLASSES = ["tok-comment", "tok-string", "tok-keyword", "tok-number", "tok-module", "tok-fn"];

function highlight(source: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of source.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) out.push(source.slice(last, index));
    const group = match.slice(1).findIndex((part) => part !== undefined);
    out.push(
      <span key={index} className={CLASSES[group]}>
        {match[0]}
      </span>,
    );
    last = index + match[0].length;
  }
  if (last < source.length) out.push(source.slice(last));
  return out;
}

export function Code({ children, label }: { children: string; label?: string }) {
  return (
    <pre className="code-block" aria-label={label}>
      <code>{highlight(children.trim())}</code>
    </pre>
  );
}

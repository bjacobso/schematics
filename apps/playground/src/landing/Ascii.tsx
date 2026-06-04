// A monospace canvas for the ASCII diagrams that carry the page. Marked as an
// image with an aria-label so screen readers get the one-line description
// instead of the box-drawing noise; the surrounding prose carries the meaning.

import type { ReactNode } from "react";

export function Ascii({
  children,
  label,
  className = "",
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <pre role="img" aria-label={label} className={`ascii ${className}`.trim()}>
      {children}
    </pre>
  );
}

// Highlighted token inside a diagram — the "subject" of each step.
export function Hi({ children }: { children: ReactNode }) {
  return <span className="hi">{children}</span>;
}

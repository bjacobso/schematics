import type { ReactNode } from "react";
import { Badge, ScrollArea } from "@schema-ide/ui";

export function ExamplePreviewShell({
  icon,
  title,
  subtitle,
  diagnostics,
  children,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly diagnostics: number;
  readonly children: ReactNode;
}) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="grid max-w-3xl gap-4 p-4">
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          <div className="font-medium">This is a custom render.</div>
          <div className="mt-1 text-muted-foreground">
            This preview is owned by the selected example workspace.
          </div>
        </div>

        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-md border bg-background p-2 text-primary">{icon}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold">{title}</div>
              {subtitle ? (
                <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
              ) : null}
            </div>
            {diagnostics ? (
              <Badge variant="destructive" className="text-[10px]">
                {diagnostics} issue{diagnostics === 1 ? "" : "s"}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">
                Valid
              </Badge>
            )}
          </div>
        </div>
        {children}
      </div>
    </ScrollArea>
  );
}

export function InfoGrid({ items }: { readonly items: readonly (readonly [string, string])[] }) {
  return (
    <div className="grid gap-2 md:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border bg-background p-3">
          <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
          <div className="mt-1 truncate text-sm font-medium">{value}</div>
        </div>
      ))}
    </div>
  );
}

export function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

export function PillList({
  title,
  values,
  empty,
}: {
  readonly title: string;
  readonly values: readonly string[];
  readonly empty: string;
}) {
  return (
    <Section title={title}>
      {values.length ? (
        <div className="flex flex-wrap gap-2">
          {values.map((value) => (
            <Badge key={value} variant="outline">
              {value}
            </Badge>
          ))}
        </div>
      ) : (
        <EmptyLine>{empty}</EmptyLine>
      )}
    </Section>
  );
}

export function EmptyLine({ children }: { readonly children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function ExampleIcon({ label }: { readonly label: string }) {
  return <span className="text-xs font-semibold uppercase">{label.slice(0, 2)}</span>;
}

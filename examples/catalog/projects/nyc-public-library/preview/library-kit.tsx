// Shared, dependency-light UI primitives for the NYC Public Library previews.
//
// These render a *read-only* public-catalog view of each resource — the kind of
// page a library patron would see on the website — so non-technical readers can
// understand a schematics resource at a glance. Editing happens elsewhere (via
// agents); nothing here mutates the file.
//
// Styling is plain Tailwind (classes must stay literal so the Tailwind scanner
// picks them up) plus a few inline SVG icons. No MUI / lucide imports, to keep
// the example free of extra dependencies.

import { useMemo, type ReactNode, type SVGProps } from "react";
import { parseDocument, type SourceFile } from "@schematics/core";
import type {
  AuthorConfig,
  BranchConfig,
  CatalogConfig,
  CollectionConfig,
  ItemConfig,
  LoanPolicyConfig,
  ShelfConfig,
} from "@schematics/example-catalog";

// ── cross-file resolution ────────────────────────────────────────────────────
//
// A preview only receives the file it is rendering, but a library page wants to
// show *names*, not ids ("by Toni Morrison", not "morrison"). We fold the whole
// workspace into a typed index so each component can resolve its references.

export interface CatalogIndex {
  readonly catalog: CatalogConfig | null;
  readonly branches: readonly BranchConfig[];
  readonly authors: readonly AuthorConfig[];
  readonly shelves: readonly ShelfConfig[];
  readonly items: readonly ItemConfig[];
  readonly collections: readonly CollectionConfig[];
  readonly policies: readonly LoanPolicyConfig[];
  readonly branchById: ReadonlyMap<string, BranchConfig>;
  readonly authorById: ReadonlyMap<string, AuthorConfig>;
  readonly shelfById: ReadonlyMap<string, ShelfConfig>;
  readonly itemById: ReadonlyMap<string, ItemConfig>;
}

function parseYaml<T>(file: SourceFile): T | null {
  const parsed = parseDocument(file.content, "yaml", file.path);
  return parsed.success ? (parsed.value as T) : null;
}

function indexById<T extends { readonly id: string }>(
  values: readonly T[],
): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const value of values) {
    if (value && typeof value.id === "string") map.set(value.id, value);
  }
  return map;
}

export function buildCatalogIndex(files: readonly SourceFile[]): CatalogIndex {
  const fromDir = <T,>(dir: string): readonly T[] =>
    files
      .filter((file) => file.path.startsWith(`${dir}/`) && file.path.endsWith(".yaml"))
      .map((file) => parseYaml<T>(file))
      .filter((value): value is T => value != null);

  const catalogFile = files.find(
    (file) => file.path === "catalog.yaml" || file.path.endsWith("/catalog.yaml"),
  );
  const branches = fromDir<BranchConfig>("branches");
  const authors = fromDir<AuthorConfig>("authors");
  const shelves = fromDir<ShelfConfig>("shelves");
  const items = fromDir<ItemConfig>("items");
  const collections = fromDir<CollectionConfig>("collections");
  const policies = fromDir<LoanPolicyConfig>("policies");

  return {
    catalog: catalogFile ? parseYaml<CatalogConfig>(catalogFile) : null,
    branches,
    authors,
    shelves,
    items,
    collections,
    policies,
    branchById: indexById(branches),
    authorById: indexById(authors),
    shelfById: indexById(shelves),
    itemById: indexById(items),
  };
}

export function useCatalogIndex(files: readonly SourceFile[]): CatalogIndex {
  return useMemo(() => buildCatalogIndex(files), [files]);
}

/** Resolve author ids to display names, falling back to the raw id. */
export function authorNames(
  index: CatalogIndex,
  ids: readonly string[] | undefined,
): readonly string[] {
  return (ids ?? []).map((id) => index.authorById.get(id)?.name ?? id);
}

/** "by A, B and C", or empty string when there are no authors. */
export function byline(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `by ${names[0]}`;
  if (names.length === 2) return `by ${names[0]} and ${names[1]}`;
  return `by ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

// ── tones ────────────────────────────────────────────────────────────────────
// One accent per resource type, so the system reads as a coherent set. Keep the
// class strings literal — Tailwind only emits classes it can see in source.

export type Tone = "indigo" | "sky" | "amber" | "emerald" | "violet" | "rose" | "teal";

const TONE_SOFT: Record<Tone, string> = {
  indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300",
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
  teal: "bg-teal-500/10 text-teal-600 dark:text-teal-300",
};

// ── layout primitives ─────────────────────────────────────────────────────────

export function LibraryCanvas({ children }: { readonly children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-background">
      <div className="mx-auto grid max-w-4xl gap-5 p-6">{children}</div>
    </div>
  );
}

export function ResourceHero({
  eyebrow,
  title,
  subtitle,
  tone,
  cover,
  aside,
  issues,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly subtitle?: ReactNode;
  readonly tone: Tone;
  readonly cover: ReactNode;
  readonly aside?: ReactNode;
  readonly issues: number;
}) {
  return (
    <header className="flex items-start gap-4 rounded-2xl border bg-card p-5">
      <div
        className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-xl ${TONE_SOFT[tone]}`}
      >
        {cover}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {eyebrow}
        </div>
        <h1 className="mt-0.5 truncate text-2xl font-semibold text-foreground">{title}</h1>
        {subtitle ? <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div> : null}
        {aside ? <div className="mt-3 flex flex-wrap items-center gap-2">{aside}</div> : null}
      </div>
      {issues ? (
        <span className="shrink-0 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
          {issues} issue{issues === 1 ? "" : "s"}
        </span>
      ) : null}
    </header>
  );
}

export function Panel({
  title,
  count,
  children,
}: {
  readonly title: string;
  readonly count?: number | undefined;
  readonly children: ReactNode;
}) {
  return (
    <section className="grid gap-3 rounded-2xl border bg-card p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {count != null ? <span className="text-xs text-muted-foreground">{count}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function StatGrid({
  stats,
}: {
  readonly stats: readonly { readonly label: string; readonly value: number | string }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-xl border bg-card p-4">
          <div className="text-2xl font-semibold text-foreground">{stat.value}</div>
          <div className="mt-0.5 text-xs uppercase tracking-wide text-muted-foreground">
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Stack({ children }: { readonly children: ReactNode }) {
  return <div className="grid gap-2">{children}</div>;
}

export function Row({
  icon,
  tone = "violet",
  title,
  subtitle,
  meta,
}: {
  readonly icon?: ReactNode;
  readonly tone?: Tone;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly meta?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-background p-3">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONE_SOFT[tone]}`}
      >
        {icon ?? <BookIcon className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{title}</div>
        {subtitle ? <div className="truncate text-xs text-muted-foreground">{subtitle}</div> : null}
      </div>
      {meta != null ? <div className="shrink-0 text-xs text-muted-foreground">{meta}</div> : null}
    </div>
  );
}

export function Detail({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-border/60 py-2 text-sm last:border-0">
      <div className="w-32 shrink-0 text-muted-foreground">{label}</div>
      <div className="min-w-0 flex-1 text-foreground">{value}</div>
    </div>
  );
}

export function Empty({ children }: { readonly children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-background p-4 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export type StatusTone = "good" | "warn" | "muted";

export function StatusBadge({
  tone,
  children,
}: {
  readonly tone: StatusTone;
  readonly children: ReactNode;
}) {
  const cls =
    tone === "good"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

export function Tag({ children }: { readonly children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border bg-background px-2.5 py-0.5 text-xs text-foreground">
      {children}
    </span>
  );
}

// ── icons (inline, currentColor) ───────────────────────────────────────────────

function svgBase(props: SVGProps<SVGSVGElement>) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export function BookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgBase(props)}>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z" />
      <path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20" />
    </svg>
  );
}

export function LibraryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgBase(props)}>
      <path d="M3 21h18" />
      <path d="M5 21V8l7-4 7 4v13" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

export function PinIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgBase(props)}>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function UserIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgBase(props)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  );
}

export function ShelfIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgBase(props)}>
      <path d="M4 4v16M9 4v16M14 4v16" />
      <rect x="17" y="6" width="4" height="14" rx="1" transform="rotate(12 19 13)" />
    </svg>
  );
}

export function CollectionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgBase(props)}>
      <rect x="3" y="4" width="6" height="16" rx="1" />
      <rect x="10" y="4" width="5" height="16" rx="1" />
      <path d="M17 5.5l3.5 1-3 14-3.4-1" />
    </svg>
  );
}

export function ClockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgBase(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

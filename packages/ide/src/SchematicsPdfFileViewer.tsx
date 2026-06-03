import { useEffect, useMemo, useState } from "react";
import type {
  SchematicsPdfInspection,
  SchematicsPdfTextExtraction,
  SourceFile,
} from "@schematics/core";

type PdfTab = "document" | "text" | "structure";

/**
 * Loads a PDF's typed artifact views (`inspect` / `extractText`) for a path.
 * Returns `(view) => Promise<value>`; the views are content-hash cached on the
 * server, so re-opening the same PDF is cheap.
 */
export type PdfReadView = (view: "inspect" | "extractText") => Promise<unknown>;

export function SchematicsPdfFileViewer({
  file,
  readView,
}: {
  readonly file: SourceFile;
  readonly readView?: PdfReadView | undefined;
}) {
  const dataUrl = useMemo(() => pdfContentToDataUrl(file.content), [file.content]);
  const [tab, setTab] = useState<PdfTab>("document");
  const [inspection, setInspection] = useState<SchematicsPdfInspection | null>(null);
  const [extraction, setExtraction] = useState<SchematicsPdfTextExtraction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the typed views whenever the open PDF changes. Stale responses from a
  // previous file are dropped via the `cancelled` guard.
  useEffect(() => {
    if (!readView) {
      setInspection(null);
      setExtraction(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([readView("inspect"), readView("extractText")]).then(
      ([inspect, text]) => {
        if (cancelled) return;
        setInspection(inspect as SchematicsPdfInspection);
        setExtraction(text as SchematicsPdfTextExtraction);
        setLoading(false);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [file.path, readView]);

  if (!dataUrl) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/20 p-6">
        <div className="max-w-sm rounded-md border bg-background p-4 text-sm text-muted-foreground">
          Unable to display PDF content.
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted/20">
      {readView ? (
        <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-background px-2 text-xs">
          <PdfTabButton tab="document" active={tab} onSelect={setTab}>
            Document
          </PdfTabButton>
          <PdfTabButton tab="text" active={tab} onSelect={setTab}>
            Text
            {extraction && !extraction.extractable ? (
              <span className="ml-1 text-muted-foreground">(none)</span>
            ) : null}
          </PdfTabButton>
          <PdfTabButton tab="structure" active={tab} onSelect={setTab}>
            Structure
          </PdfTabButton>
          {loading ? <span className="ml-auto text-muted-foreground">Analyzing…</span> : null}
        </div>
      ) : null}

      {tab === "document" ? (
        <iframe
          title={file.path}
          src={dataUrl}
          className="min-h-0 w-full flex-1 border-0 bg-background"
        />
      ) : null}

      {tab === "text" ? (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {error ? (
            <PdfNotice tone="error">{error}</PdfNotice>
          ) : !extraction ? (
            <PdfNotice>Loading extracted text…</PdfNotice>
          ) : extraction.extractable ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
              {extraction.text}
            </pre>
          ) : (
            <PdfNotice>
              No extractable text. This PDF may be image-only/scanned, or use fonts whose encoding
              can&apos;t be mapped to characters.
            </PdfNotice>
          )}
        </div>
      ) : null}

      {tab === "structure" ? (
        <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">
          {error ? (
            <PdfNotice tone="error">{error}</PdfNotice>
          ) : !inspection ? (
            <PdfNotice>Loading document structure…</PdfNotice>
          ) : (
            <PdfStructure inspection={inspection} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function PdfStructure({ inspection }: { readonly inspection: SchematicsPdfInspection }) {
  return (
    <div className="grid gap-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <PdfStat label="PDF version" value={inspection.headerVersion ?? "unknown"} />
        <PdfStat label="Pages" value={String(inspection.pageCount)} />
        <PdfStat label="Form fields" value={String(inspection.fields.length)} />
        <PdfStat label="Size" value={`${inspection.byteLength.toLocaleString()} bytes`} />
        <PdfStat label="Encrypted" value={inspection.encrypted ? "yes" : "no"} />
        {inspection.hasXFA ? <PdfStat label="XFA" value="present" /> : null}
      </dl>

      {inspection.pages.length > 0 ? (
        <section className="grid gap-1">
          <h4 className="text-xs font-medium text-muted-foreground">Page geometry</h4>
          <div className="grid gap-1 text-xs">
            {inspection.pages.map((page) => (
              <div key={page.page} className="flex gap-3 font-mono">
                <span className="text-muted-foreground">p{page.page}</span>
                <span>
                  {Math.round(page.width)}×{Math.round(page.height)}
                </span>
                {page.rotation ? <span>↻{page.rotation}°</span> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {inspection.fields.length > 0 ? (
        <section className="grid gap-1">
          <h4 className="text-xs font-medium text-muted-foreground">Form fields</h4>
          <div className="grid gap-1 text-xs">
            {inspection.fields.map((field) => (
              <div key={field.name} className="flex items-center gap-2 font-mono">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{field.type}</span>
                <span className="truncate">{field.name}</span>
                {field.required ? <span className="text-amber-600">required</span> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function PdfStat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </>
  );
}

function PdfTabButton({
  tab,
  active,
  onSelect,
  children,
}: {
  readonly tab: PdfTab;
  readonly active: PdfTab;
  readonly onSelect: (tab: PdfTab) => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(tab)}
      className={`rounded px-2 py-1 ${
        active === tab ? "bg-primary text-primary-foreground" : "hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function PdfNotice({
  children,
  tone,
}: {
  readonly children: React.ReactNode;
  readonly tone?: "error" | undefined;
}) {
  return (
    <div
      className={`max-w-prose rounded-md border bg-background p-3 text-xs ${
        tone === "error" ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {children}
    </div>
  );
}

export function isPdfPath(path: string | null | undefined): boolean {
  return path?.toLowerCase().endsWith(".pdf") ?? false;
}

export function pdfContentToDataUrl(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  if (/^data:application\/pdf[^,]*;base64,/i.test(trimmed)) return trimmed;

  if (trimmed.startsWith("%PDF")) {
    return binaryStringPdfToDataUrl(trimmed);
  }

  return `data:application/pdf;base64,${trimmed.replace(/\s+/g, "")}`;
}

function binaryStringPdfToDataUrl(content: string): string | null {
  if (typeof globalThis.btoa !== "function") return null;
  try {
    return `data:application/pdf;base64,${globalThis.btoa(content)}`;
  } catch {
    return null;
  }
}

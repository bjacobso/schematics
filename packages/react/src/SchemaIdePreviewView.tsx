import { parseDocument, type SchemaIdeDocumentFormat, type SourceFile } from "@schema-ide/core";
import { ScrollArea } from "@schema-ide/ui";
import type { createReflection } from "@schema-ide/core";
import type { SchemaIdePreviewRegistration, SchemaIdePreviewResolution } from "./preview";

export function SchemaIdePreviewView({
  file,
  files,
  format,
  reflection,
  resolution,
  previews,
  readOnly,
}: {
  readonly file: SourceFile;
  readonly files: readonly SourceFile[];
  readonly format: SchemaIdeDocumentFormat;
  readonly reflection: ReturnType<typeof createReflection>;
  readonly resolution: SchemaIdePreviewResolution | null;
  readonly previews: readonly SchemaIdePreviewRegistration<unknown, string>[];
  readonly readOnly: boolean;
}) {
  const parsed = parseDocument(file.content, format, file.path);
  const diagnostics = reflection.diagnostics.filter(
    (diagnostic) => diagnostic.path === file.path || diagnostic.documentPath === file.path,
  );
  const previewDiagnostics =
    parsed.success ||
    diagnostics.some((diagnostic) => diagnostic.message === parsed.diagnostic.message)
      ? diagnostics
      : [parsed.diagnostic, ...diagnostics];

  if (!resolution) {
    return (
      <SchemaPreviewNotFound
        file={file}
        files={files}
        format={format}
        reflection={reflection}
        value={parsed.success ? parsed.value : null}
        diagnostics={previewDiagnostics}
        previews={previews}
      />
    );
  }

  const Preview = resolution.selected.component;
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <Preview
        schemaId={resolution.schemaId}
        file={file}
        files={files}
        value={parsed.success ? parsed.value : null}
        jsonSchema={resolution.jsonSchema}
        format={format}
        reflection={reflection}
        diagnostics={previewDiagnostics}
        readOnly={readOnly}
      />
    </div>
  );
}

function SchemaPreviewNotFound({
  file,
  files,
  format,
  reflection,
  value,
  diagnostics,
  previews,
}: {
  readonly file: SourceFile;
  readonly files: readonly SourceFile[];
  readonly format: SchemaIdeDocumentFormat;
  readonly reflection: ReturnType<typeof createReflection>;
  readonly value: unknown;
  readonly diagnostics: readonly unknown[];
  readonly previews: readonly SchemaIdePreviewRegistration<unknown, string>[];
}) {
  const route = reflection.routeMatches.find((match) => match.path === file.path) ?? null;
  const jsonSchema =
    reflection.schemas.find((schema) => schema.id === route?.schemaId)?.jsonSchema ??
    reflection.activeJsonSchema;
  const debug = {
    reason: "No preview component registered for the selected file schema.",
    file: {
      path: file.path,
      format,
    },
    schemaId: route?.schemaId ?? null,
    availablePreviewSchemaIds: [...new Set(previews.map((preview) => preview.schemaId))],
    diagnostics,
    value,
    jsonSchema,
    workspace: {
      fileCount: files.length,
      files: files.map((workspaceFile) => workspaceFile.path),
    },
  };

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="grid max-w-3xl gap-4 p-4">
        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="text-sm font-medium">Preview component not found</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Register a preview for schema ID{" "}
            <span className="font-mono text-foreground">{route?.schemaId ?? "unknown"}</span> to
            render this file.
          </div>
        </div>

        <pre className="overflow-auto rounded-lg border bg-background p-3 text-xs leading-relaxed">
          {JSON.stringify(debug, null, 2)}
        </pre>
      </div>
    </ScrollArea>
  );
}

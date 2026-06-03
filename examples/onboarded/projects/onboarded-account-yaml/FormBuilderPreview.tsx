import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MuiCheckbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Drawer from "@mui/material/Drawer";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import MuiSelect, { type SelectChangeEvent } from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { stringifyDocument } from "@schematics/core";
import type { FormField, OnboardedFormConfig } from "@schematics/onboarded-config";
import type { SchematicsPreviewComponentProps } from "@schematics/ide";

type FormPage = OnboardedFormConfig["version"]["pages"][number];

type SheetState =
  | { readonly type: "form" }
  | { readonly type: "page"; readonly pageIndex: number | null }
  | {
      readonly type: "field";
      readonly pageIndex: number;
      readonly fieldPath: readonly number[] | null;
    };

const inputClass =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const labelClass = "grid gap-1.5 text-xs font-medium";
const fieldTypes = [
  "text",
  "textarea",
  "content",
  "radio",
  "select",
  "checkbox",
  "number",
  "date",
  "signature",
];
const assignees = ["employee", "employer", "system"] as const;
const statuses = ["draft", "published", "deprecated"] as const;
const owners = ["account", "library"] as const;

export function FormBuilderPreview(props: SchematicsPreviewComponentProps<OnboardedFormConfig>) {
  const form = props.value;
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const fieldCount = useMemo(() => (form ? countFields(form.version.pages) : 0), [form]);

  const submitForm = (next: OnboardedFormConfig) => {
    props.onChange(stringifyDocument(next, props.format));
    setSheet(null);
  };

  if (!form) {
    return (
      <Box className="min-h-0 flex-1" sx={{ overflow: "auto" }}>
        <div className="mx-auto grid max-w-5xl gap-4 p-4">
          <Panel title="Form preview" subtitle={props.file.path}>
            <div className="text-sm text-muted-foreground">
              The selected file could not be parsed as an onboarded form.
            </div>
          </Panel>
        </div>
      </Box>
    );
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <Box className="h-full" sx={{ overflow: "auto" }}>
        <div className="mx-auto grid max-w-5xl gap-4 p-4">
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="rounded-md border bg-background p-2 text-xs font-semibold uppercase text-primary">
                fo
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-semibold">{form.name}</div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">{form.id}</div>
              </div>
              {props.diagnostics.length ? (
                <Chip
                  className="text-[10px]"
                  color="error"
                  label={`${props.diagnostics.length} issue${
                    props.diagnostics.length === 1 ? "" : "s"
                  }`}
                  size="small"
                />
              ) : (
                <Chip className="text-[10px]" color="secondary" label="Valid" size="small" />
              )}
              <Button
                size="small"
                variant="outlined"
                disabled={props.readOnly}
                onClick={() => setSheet({ type: "form" })}
              >
                Edit form
              </Button>
              <Button
                size="small"
                disabled={props.readOnly}
                onClick={() => setSheet({ type: "page", pageIndex: null })}
              >
                Add page
              </Button>
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-4">
            <Metric label="Status" value={form.status} />
            <Metric label="Owner" value={form.owner ?? "account"} />
            <Metric label="Pages" value={String(form.version.pages.length)} />
            <Metric label="Fields" value={String(fieldCount)} />
          </div>

          <Panel title={form.version.name} subtitle={form.version.description ?? "No description"}>
            <div className="grid gap-3">
              {form.version.pages.length ? (
                form.version.pages.map((page, pageIndex) => (
                  <FormBuilderPage
                    key={`${pageIndex}:${page.description ?? "page"}`}
                    page={page}
                    pageIndex={pageIndex}
                    readOnly={props.readOnly}
                    onAddField={() => setSheet({ type: "field", pageIndex, fieldPath: null })}
                    onEditPage={() => setSheet({ type: "page", pageIndex })}
                    onDeletePage={() => {
                      submitForm({
                        ...form,
                        version: {
                          ...form.version,
                          pages: form.version.pages.filter((_, index) => index !== pageIndex),
                        },
                      });
                    }}
                    onEditField={(fieldPath) => setSheet({ type: "field", pageIndex, fieldPath })}
                    onDeleteField={(fieldPath) => {
                      submitForm({
                        ...form,
                        version: {
                          ...form.version,
                          pages: form.version.pages.map((candidate, index) =>
                            index === pageIndex
                              ? { ...candidate, fields: deleteFieldAt(candidate.fields, fieldPath) }
                              : candidate,
                          ),
                        },
                      });
                    }}
                  />
                ))
              ) : (
                <div className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
                  No pages configured.
                </div>
              )}
            </div>
          </Panel>
        </div>
      </Box>

      {sheet ? (
        <BuilderSheet title={sheetTitle(sheet)} onClose={() => setSheet(null)}>
          {sheet.type === "form" ? (
            <FormSettingsSheet form={form} onSubmit={submitForm} />
          ) : sheet.type === "page" ? (
            <PageSheet
              page={sheet.pageIndex === null ? null : (form.version.pages[sheet.pageIndex] ?? null)}
              onSubmit={(page) => {
                const pages =
                  sheet.pageIndex === null
                    ? [...form.version.pages, page]
                    : form.version.pages.map((candidate, index) =>
                        index === sheet.pageIndex ? page : candidate,
                      );
                submitForm({ ...form, version: { ...form.version, pages } });
              }}
            />
          ) : (
            <FieldSheet
              field={
                sheet.fieldPath
                  ? getFieldAt(form.version.pages[sheet.pageIndex]?.fields ?? [], sheet.fieldPath)
                  : null
              }
              onSubmit={(field) => {
                const pages = form.version.pages.map((page, index) => {
                  if (index !== sheet.pageIndex) return page;
                  return {
                    ...page,
                    fields: sheet.fieldPath
                      ? updateFieldAt(page.fields, sheet.fieldPath, () => field)
                      : [...page.fields, field],
                  };
                });
                submitForm({ ...form, version: { ...form.version, pages } });
              }}
            />
          )}
        </BuilderSheet>
      ) : null}
    </div>
  );
}

function FormBuilderPage({
  page,
  pageIndex,
  readOnly,
  onAddField,
  onEditPage,
  onDeletePage,
  onEditField,
  onDeleteField,
}: {
  readonly page: FormPage;
  readonly pageIndex: number;
  readonly readOnly: boolean;
  readonly onAddField: () => void;
  readonly onEditPage: () => void;
  readonly onDeletePage: () => void;
  readonly onEditField: (fieldPath: readonly number[]) => void;
  readonly onDeleteField: (fieldPath: readonly number[]) => void;
}) {
  return (
    <div className="rounded-lg border bg-background">
      <div className="flex flex-wrap items-start gap-3 border-b p-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium uppercase text-muted-foreground">
            Page {pageIndex + 1}
          </div>
          <div className="mt-1 text-sm font-medium">{page.description ?? "Untitled page"}</div>
          <div className="mt-1 text-xs text-muted-foreground">{page.assignee}</div>
        </div>
        <Button size="small" variant="outlined" disabled={readOnly} onClick={onEditPage}>
          Edit page
        </Button>
        <Button size="small" variant="outlined" disabled={readOnly} onClick={onAddField}>
          Add field
        </Button>
        <Button
          size="small"
          variant="text"
          color="inherit"
          disabled={readOnly}
          onClick={onDeletePage}
        >
          Delete
        </Button>
      </div>
      <div className="grid gap-2 p-3">
        {page.fields.length ? (
          page.fields.map((field, index) => (
            <FormBuilderField
              key={`${field.path}:${index}`}
              field={field}
              fieldPath={[index]}
              readOnly={readOnly}
              onEdit={onEditField}
              onDelete={onDeleteField}
            />
          ))
        ) : (
          <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
            No fields on this page.
          </div>
        )}
      </div>
    </div>
  );
}

function FormBuilderField({
  field,
  fieldPath,
  readOnly,
  onEdit,
  onDelete,
  depth = 0,
}: {
  readonly field: FormField;
  readonly fieldPath: readonly number[];
  readonly readOnly: boolean;
  readonly onEdit: (fieldPath: readonly number[]) => void;
  readonly onDelete: (fieldPath: readonly number[]) => void;
  readonly depth?: number | undefined;
}) {
  const label = fieldDisplayLabel(field);
  return (
    <div className="rounded-md border bg-muted/20 p-3" style={{ marginLeft: depth * 16 }}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-medium">{field.path}</span>
            <Chip className="text-[10px]" label={field.type} size="small" variant="outlined" />
            {field.required ? (
              <Chip className="text-[10px]" color="secondary" label="Required" size="small" />
            ) : null}
          </div>
          {label ? <div className="mt-2 text-sm">{label}</div> : null}
        </div>
        <Button
          size="small"
          variant="outlined"
          disabled={readOnly}
          onClick={() => onEdit(fieldPath)}
        >
          Edit
        </Button>
        <Button
          size="small"
          variant="text"
          color="inherit"
          disabled={readOnly}
          onClick={() => onDelete(fieldPath)}
        >
          Delete
        </Button>
      </div>
      <div className="mt-3">
        <FieldControlPreview field={field} />
      </div>
      {field.subfields?.length ? (
        <div className="mt-2 grid gap-2">
          {field.subfields.map((subfield, index) => (
            <FormBuilderField
              key={`${subfield.path}:${index}`}
              field={subfield}
              fieldPath={[...fieldPath, index]}
              readOnly={readOnly}
              onEdit={onEdit}
              onDelete={onDelete}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FieldControlPreview({ field }: { readonly field: FormField }) {
  if (field.type === "content") {
    return (
      <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground whitespace-pre-wrap">
        {fieldContent(field) || "Content block"}
      </div>
    );
  }
  if (field.type === "signature") {
    return (
      <div className="h-16 rounded-md border bg-background p-3 text-sm text-muted-foreground">
        Signature
      </div>
    );
  }
  if (field.type === "radio") {
    return (
      <div className="grid gap-2">
        {optionValues(field).map((option) => (
          <label key={option.id} className="flex items-center gap-2 text-sm">
            <input type="radio" disabled />
            {option.label}
          </label>
        ))}
      </div>
    );
  }
  if (field.type === "checkbox") {
    return (
      <FormControlLabel
        label={fieldDisplayLabel(field) || field.path}
        control={<MuiCheckbox checked={false} disabled size="small" />}
      />
    );
  }
  return <input className={inputClass} disabled placeholder={field.type} />;
}

function FormSettingsSheet({
  form,
  onSubmit,
}: {
  readonly form: OnboardedFormConfig;
  readonly onSubmit: (form: OnboardedFormConfig) => void;
}) {
  const [name, setName] = useState(form.name);
  const [status, setStatus] = useState<OnboardedFormConfig["status"]>(form.status);
  const [owner, setOwner] = useState<NonNullable<OnboardedFormConfig["owner"]>>(
    form.owner ?? "account",
  );
  const [versionName, setVersionName] = useState(form.version.name);
  const [description, setDescription] = useState(form.version.description ?? "");
  const [attributes, setAttributes] = useState((form.references?.attributes ?? []).join("\n"));

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const nextAttributes = lines(attributes);
        onSubmit({
          id: form.id,
          name,
          status,
          owner,
          ...(form.source ? { source: form.source } : {}),
          ...(nextAttributes.length ? { references: { attributes: nextAttributes } } : {}),
          version: {
            ...form.version,
            name: versionName,
            description: description.trim() ? description : null,
          },
        });
      }}
    >
      <TextInput label="Name" value={name} onChange={setName} required />
      <SelectInput
        label="Status"
        value={status}
        values={statuses}
        onChange={(value) => setStatus(value as OnboardedFormConfig["status"])}
      />
      <SelectInput
        label="Owner"
        value={owner}
        values={owners}
        onChange={(value) => setOwner(value as NonNullable<OnboardedFormConfig["owner"]>)}
      />
      <TextInput label="Version name" value={versionName} onChange={setVersionName} required />
      <TextAreaInput
        label="Version description"
        value={description}
        onChange={setDescription}
        rows={3}
      />
      <TextAreaInput
        label="Referenced attributes"
        value={attributes}
        onChange={setAttributes}
        rows={5}
      />
      <SheetActions submitLabel="Apply form changes" />
    </form>
  );
}

function PageSheet({
  page,
  onSubmit,
}: {
  readonly page: FormPage | null;
  readonly onSubmit: (page: FormPage) => void;
}) {
  const [description, setDescription] = useState(page?.description ?? "");
  const [assignee, setAssignee] = useState<FormPage["assignee"]>(page?.assignee ?? "employee");

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          description: description.trim() ? description : null,
          assignee,
          fields: page?.fields ?? [],
        });
      }}
    >
      <TextInput label="Page title" value={description} onChange={setDescription} />
      <SelectInput
        label="Assignee"
        value={assignee}
        values={assignees}
        onChange={(value) => setAssignee(value as FormPage["assignee"])}
      />
      <SheetActions submitLabel={page ? "Apply page changes" : "Create page"} />
    </form>
  );
}

function FieldSheet({
  field,
  onSubmit,
}: {
  readonly field: FormField | null;
  readonly onSubmit: (field: FormField) => void;
}) {
  const [path, setPath] = useState(field?.path ?? "form.new_field");
  const [type, setType] = useState(field?.type ?? "text");
  const [required, setRequired] = useState(Boolean(field?.required));
  const [label, setLabel] = useState(fieldDisplayLabel(field) || "New field");
  const [options, setOptions] = useState(
    field?.options == null ? "" : JSON.stringify(field.options, null, 2),
  );
  const [rule, setRule] = useState(field?.rule == null ? "" : JSON.stringify(field.rule, null, 2));
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsedOptions = parseOptionalJson(options, "options");
    if (!parsedOptions.ok) {
      setError(parsedOptions.message);
      return;
    }
    const parsedRule = parseOptionalJson(rule, "rule");
    if (!parsedRule.ok) {
      setError(parsedRule.message);
      return;
    }

    const translations =
      field?.translations && typeof field.translations === "object"
        ? { ...(field.translations as Record<string, unknown>) }
        : {};
    const en =
      translations["en"] && typeof translations["en"] === "object"
        ? { ...(translations["en"] as Record<string, unknown>) }
        : {};
    if (type === "content") {
      en["content"] = label;
      delete en["label"];
    } else {
      en["label"] = label;
      delete en["content"];
    }
    translations["en"] = en;

    onSubmit({
      ...field,
      path,
      type,
      required,
      rule: parsedRule.value as FormField["rule"],
      options: parsedOptions.value as FormField["options"],
      translations,
    });
  };

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <TextInput label="Path" value={path} onChange={setPath} required />
      <SelectInput label="Type" value={type} values={fieldTypes} onChange={setType} />
      <FormControlLabel
        label="Required"
        control={
          <MuiCheckbox
            checked={required}
            onChange={(event) => setRequired(event.target.checked)}
            size="small"
          />
        }
      />
      {type === "content" ? (
        <TextAreaInput label="Content" value={label} onChange={setLabel} rows={6} />
      ) : (
        <TextInput label="Label" value={label} onChange={setLabel} />
      )}
      <TextAreaInput label="Options JSON" value={options} onChange={setOptions} rows={5} />
      <TextAreaInput label="Rule JSON" value={rule} onChange={setRule} rows={5} />
      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      <SheetActions submitLabel={field ? "Apply field changes" : "Create field"} />
    </form>
  );
}

function BuilderSheet({
  title,
  children,
  onClose,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
}) {
  return (
    <Drawer anchor="right" open onClose={onClose}>
      <Box
        aria-label={title}
        component="section"
        role="dialog"
        sx={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          maxWidth: 448,
          minWidth: { xs: "100vw", sm: 448 },
        }}
      >
        <Box
          className="h-12 flex-row items-center gap-3 px-4 py-0"
          sx={{
            borderBottom: 1,
            borderColor: "divider",
            display: "flex",
          }}
        >
          <Typography className="min-w-0 flex-1 truncate" component="h2" variant="subtitle1">
            {title}
          </Typography>
          <Button size="small" variant="text" color="inherit" onClick={onClose}>
            Close
          </Button>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <Box className="h-full" sx={{ overflow: "auto" }}>
            <div className="p-4">{children}</div>
          </Box>
        </Box>
      </Box>
    </Drawer>
  );
}

function SheetActions({ submitLabel }: { readonly submitLabel: string }) {
  return (
    <div className="flex justify-end border-t pt-4">
      <Button type="submit">{submitLabel}</Button>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <section className="grid gap-3 rounded-lg border bg-muted/20 p-4">
      <div>
        <div className="text-sm font-semibold">{title}</div>
        {subtitle ? <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  required,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly required?: boolean | undefined;
}) {
  return (
    <label className={labelClass}>
      {label}
      <input
        className={inputClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
    </label>
  );
}

function TextAreaInput({
  label,
  value,
  onChange,
  rows,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly rows: number;
}) {
  return (
    <label className={labelClass}>
      {label}
      <TextField
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        fullWidth
        multiline
        size="small"
      />
    </label>
  );
}

function SelectInput({
  label,
  value,
  values,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly values: readonly string[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className={labelClass}>
      <span>{label}</span>
      <FormControl fullWidth size="small">
        <MuiSelect
          value={value}
          onChange={(event: SelectChangeEvent<string>) => onChange(event.target.value)}
        >
          {values.map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </MuiSelect>
      </FormControl>
    </div>
  );
}

function sheetTitle(sheet: SheetState): string {
  if (sheet.type === "form") return "Edit form";
  if (sheet.type === "page") return sheet.pageIndex === null ? "Add page" : "Edit page";
  return sheet.fieldPath ? "Edit field" : "Add field";
}

function countFields(pages: readonly FormPage[]): number {
  return pages.reduce((total, page) => total + countFieldList(page.fields), 0);
}

function countFieldList(fields: readonly FormField[]): number {
  return fields.reduce((total, field) => total + 1 + countFieldList(field.subfields ?? []), 0);
}

function getFieldAt(fields: readonly FormField[], path: readonly number[]): FormField | null {
  const [index, ...rest] = path;
  if (index === undefined) return null;
  const field = fields[index];
  if (!field) return null;
  return rest.length ? getFieldAt(field.subfields ?? [], rest) : field;
}

function updateFieldAt(
  fields: readonly FormField[],
  path: readonly number[],
  update: (field: FormField) => FormField,
): readonly FormField[] {
  const [index, ...rest] = path;
  if (index === undefined) return fields;
  return fields.map((field, candidate) => {
    if (candidate !== index) return field;
    return rest.length
      ? { ...field, subfields: updateFieldAt(field.subfields ?? [], rest, update) }
      : update(field);
  });
}

function deleteFieldAt(
  fields: readonly FormField[],
  path: readonly number[],
): readonly FormField[] {
  const [index, ...rest] = path;
  if (index === undefined) return fields;
  if (!rest.length) return fields.filter((_, candidate) => candidate !== index);
  return fields.map((field, candidate) =>
    candidate === index
      ? { ...field, subfields: deleteFieldAt(field.subfields ?? [], rest) }
      : field,
  );
}

function fieldDisplayLabel(field: FormField | null | undefined): string {
  const en =
    field?.translations && typeof field.translations === "object"
      ? (field.translations as Record<string, unknown>)["en"]
      : null;
  if (!en || typeof en !== "object") return "";
  const values = en as Record<string, unknown>;
  return typeof values["label"] === "string"
    ? values["label"]
    : typeof values["content"] === "string"
      ? values["content"]
      : "";
}

function fieldContent(field: FormField): string {
  return fieldDisplayLabel(field);
}

function optionValues(
  field: FormField,
): readonly { readonly id: string; readonly label: string }[] {
  if (!field.options || typeof field.options !== "object") return [];
  const values = (field.options as { readonly values?: unknown }).values;
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const entry = value as Record<string, unknown>;
    const id = typeof entry["id"] === "string" ? entry["id"] : "";
    const label = typeof entry["label"] === "string" ? entry["label"] : id;
    return id ? [{ id, label }] : [];
  });
}

function lines(value: string): readonly string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseOptionalJson(
  value: string,
  label: string,
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string } {
  if (!value.trim()) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch (error) {
    return {
      ok: false,
      message: `Invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

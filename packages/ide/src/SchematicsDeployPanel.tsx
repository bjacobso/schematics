import type {
  DeployChangeAction,
  DeployConnectionOptions,
  DeployConnectRequest,
  DeployPlan,
  DeployResourceChange,
  DeployRun,
  SchemaIdeDeployService,
} from "@schema-ide/protocol";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import { AlertTriangle, Download, FileWarning, Play, Plug, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSchemaIdeDeploy } from "./useSchemaIdeDeploy";

export interface SchemaIdeDeployPanelProps {
  readonly deploy: SchemaIdeDeployService;
  readonly consumer?: string | undefined;
  readonly readOnly?: boolean | undefined;
}

const ACTION_COLOR: Record<DeployChangeAction, string> = {
  create: "var(--primary, #16a34a)",
  update: "var(--primary, #2563eb)",
  delete: "var(--destructive, #dc2626)",
  noop: "var(--muted-foreground, #6b7280)",
};

const ACTION_SYMBOL: Record<DeployChangeAction, string> = {
  create: "+",
  update: "~",
  delete: "-",
  noop: "=",
};

export function SchemaIdeDeployPanel({ deploy, consumer, readOnly }: SchemaIdeDeployPanelProps) {
  const model = useSchemaIdeDeploy(deploy);
  const [confirmApply, setConfirmApply] = useState(false);
  const [allowDelete, setAllowDelete] = useState(false);

  const connected = model.connection?.connected ?? false;
  const disabled = !!model.busy || readOnly === true;

  const planGroups = useMemo(() => groupChanges(model.plan), [model.plan]);
  const planTotal = model.plan
    ? model.plan.summary.create + model.plan.summary.update + model.plan.summary.delete
    : 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {/* Connection bar */}
      <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex items-center gap-2 text-sm">
          <Plug className="size-4" />
          {connected ? (
            <span>
              Connected as <strong>{model.connection?.account ?? "unknown"}</strong>
              <span className="ml-1 opacity-60">
                ({model.connection?.env}
                {model.connection?.authMethod
                  ? ` · ${authMethodLabel(model.connectionOptions, model.connection.authMethod)}`
                  : ""}
                )
              </span>
            </span>
          ) : (
            <span className="opacity-70">Not connected</span>
          )}
        </div>
        {model.busy ? <span className="text-xs opacity-70">{model.busy}…</span> : null}
      </div>

      {model.error ? (
        <div className="flex items-center justify-between gap-2 border-b bg-[var(--destructive,#dc2626)]/10 px-4 py-2 text-sm text-[var(--destructive,#dc2626)]">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="size-4" />
            {model.error}
          </span>
          <Button size="small" onClick={model.dismissError}>
            Dismiss
          </Button>
        </div>
      ) : null}

      {!connected ? (
        <ConnectForm
          options={model.connectionOptions}
          consumer={consumer}
          busy={!!model.busy}
          onConnect={model.connect}
        />
      ) : (
        <>
          {/* Action toolbar */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
            <Button
              size="small"
              variant="outlined"
              startIcon={<Download className="size-4" />}
              disabled={disabled}
              onClick={model.pull}
            >
              Pull
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<RefreshCw className="size-4" />}
              disabled={disabled}
              onClick={model.plan_}
            >
              {model.plan ? "Re-plan" : "Plan"}
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<Play className="size-4" />}
              disabled={disabled || planTotal === 0}
              onClick={() => {
                setAllowDelete(false);
                setConfirmApply(true);
              }}
            >
              Apply{planTotal > 0 ? ` (${planTotal})` : ""}
            </Button>
            <div className="flex-1" />
            <Button
              size="small"
              color="error"
              startIcon={<Trash2 className="size-4" />}
              disabled={disabled}
              onClick={model.destroy}
            >
              Destroy
            </Button>
          </div>

          {model.sync && model.sync.total > 0 ? (
            <SyncProgress hydrated={model.sync.hydrated} total={model.sync.total} />
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto">
            <PlanView plan={model.plan} groups={planGroups} />
            <RunsTimeline runs={model.runs} />
          </div>
        </>
      )}

      <ApplyDialog
        open={confirmApply}
        plan={model.plan}
        allowDelete={allowDelete}
        onAllowDelete={setAllowDelete}
        onClose={() => setConfirmApply(false)}
        onConfirm={() => {
          setConfirmApply(false);
          model.apply(allowDelete);
        }}
      />
    </div>
  );
}

function ConnectForm(props: {
  options: DeployConnectionOptions | null;
  consumer?: string | undefined;
  busy: boolean;
  onConnect: (request: DeployConnectRequest) => void;
}) {
  const { options } = props;
  const [environment, setEnvironment] = useState("");
  const [authMethod, setAuthMethod] = useState("");
  const [credentials, setCredentials] = useState<Record<string, string>>({});

  // Seed the selectors from the descriptor's defaults once it arrives.
  useEffect(() => {
    if (!options) return;
    setEnvironment(
      (current) => current || options.defaultEnvironment || options.environments[0]?.id || "",
    );
    setAuthMethod(
      (current) => current || options.defaultAuthMethod || options.authMethods[0]?.id || "",
    );
  }, [options]);

  if (!options) {
    return <div className="p-4 text-sm opacity-60">Loading connection options…</div>;
  }

  const selectedEnv = options.environments.find((candidate) => candidate.id === environment);
  const selectedAuth = options.authMethods.find((candidate) => candidate.id === authMethod);
  const fields = selectedAuth?.fields ?? [];
  const ready = fields.every(
    (field) => !field.required || (credentials[field.key]?.trim() ?? "") !== "",
  );

  const submit = () => {
    if (!ready) return;
    props.onConnect({
      consumer: props.consumer ?? options.consumer,
      environment,
      authMethod,
      credentials,
    });
  };

  return (
    <div className="flex flex-col gap-4 overflow-auto p-4">
      <p className="text-sm opacity-70">
        Connect to <strong>{props.consumer ?? options.consumer}</strong>. Credentials are validated
        by a live probe and stored server-side — they never touch the browser store or the file
        tree.
      </p>

      <FormControl size="small" fullWidth>
        <InputLabel id="deploy-env-label">Environment</InputLabel>
        <Select
          labelId="deploy-env-label"
          label="Environment"
          value={environment}
          onChange={(event) => setEnvironment(event.target.value)}
        >
          {options.environments.map((env) => (
            <MenuItem key={env.id} value={env.id}>
              {env.label}
            </MenuItem>
          ))}
        </Select>
        {selectedEnv ? (
          <p className="mt-1 text-xs opacity-60">
            {selectedEnv.description}
            <span className="ml-1 font-mono opacity-80">{selectedEnv.baseUrl}</span>
          </p>
        ) : null}
      </FormControl>

      <FormControl size="small" fullWidth>
        <InputLabel id="deploy-auth-label">Authentication</InputLabel>
        <Select
          labelId="deploy-auth-label"
          label="Authentication"
          value={authMethod}
          onChange={(event) => {
            setAuthMethod(event.target.value);
            setCredentials({});
          }}
        >
          {options.authMethods.map((method) => (
            <MenuItem key={method.id} value={method.id}>
              {method.label}
            </MenuItem>
          ))}
        </Select>
        {selectedAuth ? (
          <p className="mt-1 text-xs opacity-60">{selectedAuth.description}</p>
        ) : null}
      </FormControl>

      {fields.map((field) => (
        <TextField
          key={field.key}
          type={field.type === "password" ? "password" : "text"}
          size="small"
          fullWidth
          label={field.label}
          required={field.required}
          autoComplete="off"
          placeholder={field.placeholder}
          helperText={field.description}
          value={credentials[field.key] ?? ""}
          onChange={(event) =>
            setCredentials((current) => ({ ...current, [field.key]: event.target.value }))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
      ))}

      <div>
        <Button
          variant="contained"
          startIcon={<Plug className="size-4" />}
          disabled={props.busy || !ready}
          onClick={submit}
        >
          Connect
        </Button>
      </div>
    </div>
  );
}

function authMethodLabel(options: DeployConnectionOptions | null, id: string): string {
  return options?.authMethods.find((method) => method.id === id)?.label ?? id;
}

function SyncProgress(props: { hydrated: number; total: number }) {
  const pct = props.total > 0 ? Math.min(100, Math.round((props.hydrated / props.total) * 100)) : 0;
  return (
    <div className="shrink-0 border-b px-4 py-2">
      <div className="mb-1 flex justify-between text-xs opacity-70">
        <span>Hydrating working tree</span>
        <span>
          {props.hydrated}/{props.total}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded bg-[var(--muted,#e5e7eb)]">
        <div
          className="h-full bg-[var(--primary,#2563eb)] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function PlanView(props: {
  plan: DeployPlan | null;
  groups: ReadonlyArray<readonly [string, readonly DeployResourceChange[]]>;
}) {
  if (!props.plan) {
    return (
      <div className="p-4 text-sm opacity-60">
        Run <strong>Plan</strong> to diff your working tree against the live remote.
      </div>
    );
  }
  const { create, update, delete: del } = props.plan.summary;
  if (create + update + del === 0) {
    return <div className="p-4 text-sm opacity-70">No changes. Working tree matches remote.</div>;
  }
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2 text-xs">
        <Chip size="small" label={`+${create} create`} />
        <Chip size="small" label={`~${update} update`} />
        <Chip size="small" label={`-${del} delete`} />
      </div>
      {props.groups.map(([kind, changes]) => (
        <div key={kind} className="rounded border">
          <div className="border-b bg-[var(--muted,#f3f4f6)]/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide opacity-70">
            {kind}
          </div>
          <ul className="divide-y">
            {changes.map((change) => (
              <ChangeRow key={`${change.kind}:${change.key}`} change={change} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ChangeRow({ change }: { change: DeployResourceChange }) {
  const [open, setOpen] = useState(false);
  const color = ACTION_COLOR[change.action];
  return (
    <li className="px-3 py-2 text-sm">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="w-4 font-mono font-bold" style={{ color }}>
          {ACTION_SYMBOL[change.action]}
        </span>
        <span className="font-mono">{change.key}</span>
        <span className="ml-2 text-xs opacity-50">{change.path}</span>
        <span className="ml-auto text-xs uppercase" style={{ color }}>
          {change.action}
        </span>
      </button>
      {open && change.fields.length > 0 ? (
        <table className="mt-2 w-full border-collapse text-xs">
          <tbody>
            {change.fields.map((field) => (
              <tr key={field.path} className="align-top">
                <td className="py-0.5 pr-3 font-mono opacity-60">{field.path}</td>
                <td className="py-0.5 pr-2 font-mono text-[var(--destructive,#dc2626)]">
                  {renderValue(field.before)}
                </td>
                <td className="py-0.5 font-mono text-[var(--primary,#16a34a)]">
                  {renderValue(field.after)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </li>
  );
}

function RunsTimeline({ runs }: { runs: readonly DeployRun[] }) {
  if (runs.length === 0) return null;
  const ordered = runs.slice().reverse();
  return (
    <div className="border-t p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">Runs</div>
      <ul className="flex flex-col gap-1">
        {ordered.map((run) => (
          <li key={run.id} className="flex items-center gap-2 text-sm">
            <RunStatusDot status={run.status} />
            <span className="font-medium capitalize">{run.kind}</span>
            <span className="text-xs opacity-50">{run.startedAt}</span>
            {run.error ? (
              <span className="ml-2 flex items-center gap-1 text-xs text-[var(--destructive,#dc2626)]">
                <FileWarning className="size-3" />
                {run.error}
              </span>
            ) : (
              <span className="ml-auto text-xs opacity-60">{summaryLabel(run)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RunStatusDot({ status }: { status: DeployRun["status"] }) {
  const color =
    status === "succeeded"
      ? "var(--primary, #16a34a)"
      : status === "failed"
        ? "var(--destructive, #dc2626)"
        : status === "aborted"
          ? "#d97706"
          : "var(--muted-foreground, #9ca3af)";
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
      title={status}
    />
  );
}

function ApplyDialog(props: {
  open: boolean;
  plan: DeployPlan | null;
  allowDelete: boolean;
  onAllowDelete: (value: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const summary = props.plan?.summary;
  const hasDeletes = (summary?.delete ?? 0) > 0;
  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Apply plan</DialogTitle>
      <DialogContent>
        <p className="text-sm">
          This applies the plan to the live remote: {summary?.create ?? 0} create,{" "}
          {summary?.update ?? 0} update, {summary?.delete ?? 0} delete.
        </p>
        {hasDeletes ? (
          <FormControlLabel
            control={
              <Checkbox
                checked={props.allowDelete}
                onChange={(event) => props.onAllowDelete(event.target.checked)}
              />
            }
            label="Allow deletes (resources removed from the working tree)"
          />
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button
          variant="contained"
          color={hasDeletes && props.allowDelete ? "error" : "primary"}
          disabled={hasDeletes && !props.allowDelete}
          onClick={props.onConfirm}
        >
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

function groupChanges(
  plan: DeployPlan | null,
): ReadonlyArray<readonly [string, readonly DeployResourceChange[]]> {
  if (!plan) return [];
  const byKind = new Map<string, DeployResourceChange[]>();
  for (const change of plan.changes) {
    if (change.action === "noop") continue;
    const list = byKind.get(change.kind);
    if (list) list.push(change);
    else byKind.set(change.kind, [change]);
  }
  return [...byKind.entries()];
}

function summaryLabel(run: DeployRun): string {
  const summary = run.summary;
  if (!summary || typeof summary !== "object") return run.status;
  const record = summary as Record<string, unknown>;
  if (typeof record["applied"] === "number") {
    return `applied ${record["applied"]}, aborted ${record["aborted"] ?? 0}, skipped ${record["skipped"] ?? 0}`;
  }
  if (typeof record["pulled"] === "number") return `pulled ${record["pulled"]}`;
  if (typeof record["create"] === "number") {
    return `+${record["create"]} ~${record["update"] ?? 0} -${record["delete"] ?? 0}`;
  }
  return run.status;
}

function renderValue(value: unknown): string {
  if (value === undefined) return "∅";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

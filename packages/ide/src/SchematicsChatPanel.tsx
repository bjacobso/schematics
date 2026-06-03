import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { AtomRef } from "effect/unstable/reactivity";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MuiCheckbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import MuiSelect, { type SelectChangeEvent } from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  RefreshCw,
  Send,
} from "lucide-react";
import type {
  SchematicsChatAdapter,
  SchematicsChatMessage,
  SchematicsHostRuntime,
  SchematicsToolCall,
} from "@schematics/agent";
import type { SchematicsReflection } from "@schematics/core";
import { combineRefs } from "./reactive-ref";

export interface SchematicsChatPanelProps {
  readonly chat: SchematicsChatAdapter;
  readonly reflection: SchematicsReflection;
  readonly tools: SchematicsHostRuntime;
  readonly readOnly: boolean;
}

type ChatTimelineItem =
  | { readonly id: string; readonly type: "message"; readonly message: SchematicsChatMessage }
  | { readonly id: string; readonly type: "tool"; readonly toolCall: SchematicsToolCall };

interface ChatTurnInput {
  readonly message: string;
  readonly reflection: SchematicsReflection;
  readonly tools: SchematicsHostRuntime;
  readonly model: string;
  readonly planMode: boolean;
}

interface ChatState {
  readonly timeline: readonly ChatTimelineItem[];
  readonly pending: boolean;
  readonly error: string | null;
}

interface SchematicsChatStore {
  readonly stateRef: AtomRef.ReadonlyRef<ChatState>;
  readonly send: (input: ChatTurnInput) => void;
  readonly cancel: () => void;
}

/**
 * Effect-reactive store for the chat turn lifecycle. `history`/`timeline`/
 * `pending`/`error` live in AtomRefs (the house pattern), mutated from the
 * `chat.send` callbacks; reads go through the refs so the send path has no
 * stale-closure dependency on the prior history.
 *
 * TODO: `SchematicsChatAdapter.send` is still a callback API (`onToolCall` +
 * `handle.promise`). Convert it to an Effect `Stream` of turn events and drive
 * this store from `Stream.runForEach` (mirroring `useSchematicsDeploy`'s watch),
 * so tool-call updates and the final message flow through one typed channel.
 */
function createSchematicsChatStore(chat: SchematicsChatAdapter): SchematicsChatStore {
  const historyRef = AtomRef.make<readonly SchematicsChatMessage[]>([]);
  const timelineRef = AtomRef.make<readonly ChatTimelineItem[]>([]);
  const pendingRef = AtomRef.make(false);
  const errorRef = AtomRef.make<string | null>(null);
  let currentHandle: { cancel: () => void } | null = null;
  let turnCounter = 0;

  const stateRef = combineRefs<ChatState>([timelineRef, pendingRef, errorRef], () => ({
    timeline: timelineRef.value,
    pending: pendingRef.value,
    error: errorRef.value,
  }));

  const send = (input: ChatTurnInput) => {
    const message = input.message.trim();
    if (!message || pendingRef.value) return;

    errorRef.set(null);
    pendingRef.set(true);
    turnCounter += 1;
    const turnId = `turn-${turnCounter}`;
    const userMessage: SchematicsChatMessage = { role: "user", content: message };
    const history = historyRef.value; // current value — no stale closure
    const nextHistory = [...history, userMessage];
    historyRef.set(nextHistory);
    timelineRef.set([
      ...timelineRef.value,
      { id: `${turnId}-user`, type: "message", message: userMessage },
    ]);

    const handle = chat.send({
      message,
      history,
      reflection: input.reflection,
      tools: input.tools,
      model: input.model,
      planMode: input.planMode,
      onToolCall: (toolCall) => {
        const itemId = `${turnId}-tool-${toolCall.id}`;
        const current = timelineRef.value;
        const existingIndex = current.findIndex((item) => item.id === itemId);
        timelineRef.set(
          existingIndex === -1
            ? [...current, { id: itemId, type: "tool", toolCall }]
            : current.map((item, index) =>
                index === existingIndex ? { ...item, toolCall } : item,
              ),
        );
      },
    });
    currentHandle = handle;
    handle.promise
      .then((result) => {
        historyRef.set([...nextHistory, result.message]);
        timelineRef.set([
          ...timelineRef.value,
          { id: `${turnId}-assistant`, type: "message", message: result.message },
        ]);
      })
      .catch((err: unknown) => errorRef.set(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        pendingRef.set(false);
        currentHandle = null;
      });
  };

  return { stateRef, send, cancel: () => currentHandle?.cancel() };
}

export function SchematicsChatPanel({
  chat,
  reflection,
  tools,
  readOnly,
}: SchematicsChatPanelProps) {
  const store = useMemo(() => createSchematicsChatStore(chat), [chat]);
  const { timeline, pending, error } = useSyncExternalStore(
    (listener) => store.stateRef.subscribe(() => listener()),
    () => store.stateRef.value,
    () => store.stateRef.value,
  );
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(chat.defaultModel ?? chat.models?.[0]?.id ?? "");
  const selectedModelLabel =
    chat.models?.find((candidate) => candidate.id === model)?.label ?? model;
  const [planMode, setPlanMode] = useState(false);

  const send = useCallback(() => {
    const message = draft.trim();
    if (!message || pending) return;
    setDraft("");
    store.send({ message, reflection, tools, model, planMode });
  }, [draft, model, pending, planMode, reflection, store, tools]);

  return (
    <div className="flex h-full min-h-0 flex-col border-r bg-muted/20">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <Bot className="size-4" />
        <span className="text-sm font-medium">Chat</span>
      </div>
      <Box className="min-h-0 flex-1" sx={{ overflow: "auto" }}>
        <div className="space-y-3 p-3">
          <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
            <div className="mb-1 flex items-center gap-1 font-medium text-foreground">
              {reflection.validationSummary.valid ? (
                <CheckCircle2 className="size-3.5 text-green-600" />
              ) : (
                <AlertTriangle className="size-3.5 text-destructive" />
              )}
              Workspace
            </div>
            {reflection.validationSummary.valid
              ? "Current files decode successfully."
              : `${reflection.validationSummary.errorCount} validation error(s).`}
          </div>
          {timeline.map((item) =>
            item.type === "message" ? (
              <ChatMessageCard key={item.id} message={item.message} />
            ) : (
              <ToolCallCard key={item.id} toolCall={item.toolCall} />
            ),
          )}
          {pending ? (
            <div className="flex items-center gap-2 rounded-md border bg-background p-3 text-xs text-muted-foreground">
              <RefreshCw className="size-3.5 animate-spin" />
              Waiting for assistant...
            </div>
          ) : null}
          {error ? (
            <div className="rounded-md border border-destructive/40 p-3 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </div>
      </Box>
      <div className="shrink-0 border-t bg-background p-3">
        <TextField
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") send();
          }}
          disabled={pending || readOnly}
          placeholder="Ask about the schema, validation errors, or desired edits..."
          fullWidth
          multiline
          size="small"
          className="mb-2 min-h-20 resize-none text-sm"
        />
        <div className="flex items-center justify-end gap-2">
          {chat.models ? (
            <Tooltip title={selectedModelLabel}>
              <FormControl className="mr-auto max-w-44" size="small">
                <MuiSelect
                  value={model}
                  onChange={(event: SelectChangeEvent<string>) => setModel(event.target.value)}
                  disabled={pending}
                  inputProps={{ "aria-label": "Chat model" }}
                  className="bg-muted/40 text-xs"
                  sx={{ "& .MuiSelect-select": { py: 0.5 } }}
                >
                  {chat.models.map((candidate) => (
                    <MenuItem key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </MenuItem>
                  ))}
                </MuiSelect>
              </FormControl>
            </Tooltip>
          ) : null}
          <FormControlLabel
            disabled={pending}
            label="Plan"
            control={
              <MuiCheckbox
                checked={planMode}
                onChange={(event) => setPlanMode(event.target.checked)}
                size="small"
              />
            }
          />
          {pending ? (
            <Button variant="outlined" size="small" onClick={store.cancel}>
              Cancel
            </Button>
          ) : null}
          <Button size="small" onClick={send} disabled={pending || !draft.trim() || readOnly}>
            <Send className="mr-1 size-3.5" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function ChatMessageCard({ message }: { readonly message: SchematicsChatMessage }) {
  return (
    <div
      className={`rounded-md border p-3 text-sm ${
        message.role === "user" ? "bg-primary text-primary-foreground" : "bg-background"
      }`}
    >
      <div className="mb-1 text-[10px] uppercase opacity-70">{message.role}</div>
      <div className="whitespace-pre-wrap">{message.content}</div>
    </div>
  );
}

function ToolCallCard({ toolCall }: { readonly toolCall: SchematicsToolCall }) {
  const status = getToolStatus(toolCall.status);
  const hasResult = "result" in toolCall;

  return (
    <details
      open={toolCall.status !== "success"}
      className="group overflow-hidden rounded-md border bg-background text-xs shadow-sm"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span
          className={`flex size-5 shrink-0 items-center justify-center rounded-full ${status.iconClass}`}
        >
          <status.Icon className={`size-3.5 ${status.spin ? "animate-spin" : ""}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-[11px] font-medium">{toolCall.name}</span>
            <Chip className="text-[10px]" color={status.color} label={status.label} size="small" />
          </div>
          <div className="truncate text-[10px] text-muted-foreground">Tool call {toolCall.id}</div>
        </div>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t bg-muted/20 p-3">
        <ToolJsonBlock label="Parameters" value={toolCall.args} />
        {hasResult ? (
          <ToolJsonBlock
            label={toolCall.status === "error" ? "Error" : "Result"}
            value={toolCall.result}
            tone={toolCall.status === "error" ? "error" : "default"}
          />
        ) : (
          <div className="rounded-md border border-dashed bg-background/70 p-3 text-muted-foreground">
            Waiting for tool output...
          </div>
        )}
      </div>
    </details>
  );
}

function ToolJsonBlock({
  label,
  value,
  tone = "default",
}: {
  readonly label: string;
  readonly value: unknown;
  readonly tone?: "default" | "error";
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
      <pre
        className={`max-h-48 overflow-auto rounded-md border p-2 font-mono text-[11px] leading-relaxed ${
          tone === "error"
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : "bg-background"
        }`}
      >
        {formatToolValue(value)}
      </pre>
    </div>
  );
}

function getToolStatus(status: SchematicsToolCall["status"]) {
  if (status === "pending") {
    return {
      label: "Running",
      color: "secondary" as const,
      Icon: RefreshCw,
      iconClass: "bg-muted text-muted-foreground",
      spin: true,
    };
  }
  if (status === "error") {
    return {
      label: "Error",
      color: "error" as const,
      Icon: AlertTriangle,
      iconClass: "bg-destructive/10 text-destructive",
      spin: false,
    };
  }
  return {
    label: "Completed",
    color: "secondary" as const,
    Icon: Check,
    iconClass: "bg-primary/10 text-primary",
    spin: false,
  };
}

function formatToolValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

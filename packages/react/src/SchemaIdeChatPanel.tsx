import { useCallback, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MuiCheckbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import MuiSelect, { type SelectChangeEvent } from "@mui/material/Select";
import TextField from "@mui/material/TextField";
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
  SchemaIdeChatAdapter,
  SchemaIdeChatMessage,
  SchemaIdeHostRuntime,
  SchemaIdeToolCall,
} from "@schema-ide/agent";
import type { SchemaIdeReflection } from "@schema-ide/core";

export interface SchemaIdeChatPanelProps {
  readonly chat: SchemaIdeChatAdapter;
  readonly reflection: SchemaIdeReflection;
  readonly tools: SchemaIdeHostRuntime;
  readonly readOnly: boolean;
}

type ChatTimelineItem =
  | { readonly id: string; readonly type: "message"; readonly message: SchemaIdeChatMessage }
  | { readonly id: string; readonly type: "tool"; readonly toolCall: SchemaIdeToolCall };

export function SchemaIdeChatPanel({ chat, reflection, tools, readOnly }: SchemaIdeChatPanelProps) {
  const [history, setHistory] = useState<readonly SchemaIdeChatMessage[]>([]);
  const [timeline, setTimeline] = useState<readonly ChatTimelineItem[]>([]);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(chat.defaultModel ?? chat.models?.[0]?.id ?? "");
  const [planMode, setPlanMode] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<{ cancel: () => void } | null>(null);

  const send = useCallback(() => {
    const message = draft.trim();
    if (!message || pending) return;

    setDraft("");
    setError(null);
    setPending(true);
    const turnId = `turn-${Date.now()}`;
    const userMessage: SchemaIdeChatMessage = { role: "user", content: message };
    const nextHistory = [...history, userMessage];
    setHistory(nextHistory);
    setTimeline((current) => [
      ...current,
      { id: `${turnId}-user`, type: "message", message: userMessage },
    ]);

    const handle = chat.send({
      message,
      history,
      reflection,
      tools,
      model,
      planMode,
      onToolCall: (toolCall) => {
        const itemId = `${turnId}-tool-${toolCall.id}`;
        setTimeline((current) => {
          const existingIndex = current.findIndex((item) => item.id === itemId);
          if (existingIndex === -1) {
            return [...current, { id: itemId, type: "tool", toolCall }];
          }
          return current.map((item, index) =>
            index === existingIndex ? { ...item, toolCall } : item,
          );
        });
      },
    });
    handleRef.current = handle;
    handle.promise
      .then((result) => {
        setHistory([...nextHistory, result.message]);
        setTimeline((current) => [
          ...current,
          { id: `${turnId}-assistant`, type: "message", message: result.message },
        ]);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setPending(false);
        handleRef.current = null;
      });
  }, [chat, draft, history, model, pending, planMode, reflection, tools]);

  return (
    <div className="flex h-full min-h-0 flex-col border-r bg-muted/20">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <Bot className="size-4" />
        <span className="text-sm font-medium">Chat</span>
        {chat.models ? (
          <FormControl className="ml-auto max-w-36" size="small">
            <MuiSelect
              value={model}
              onChange={(event: SelectChangeEvent<string>) => setModel(event.target.value)}
              disabled={pending}
              inputProps={{ "aria-label": "Chat model" }}
            >
              {chat.models.map((candidate) => (
                <MenuItem key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </MenuItem>
              ))}
            </MuiSelect>
          </FormControl>
        ) : null}
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
        <div className="flex justify-end gap-2">
          <FormControlLabel
            className="mr-auto"
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
            <Button variant="outlined" size="small" onClick={() => handleRef.current?.cancel()}>
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

function ChatMessageCard({ message }: { readonly message: SchemaIdeChatMessage }) {
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

function ToolCallCard({ toolCall }: { readonly toolCall: SchemaIdeToolCall }) {
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

function getToolStatus(status: SchemaIdeToolCall["status"]) {
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

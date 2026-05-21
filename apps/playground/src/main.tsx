import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createSchemaIdeChatAdapter } from "@schema-ide/agent";
import {
  randomSchemaIdeExample,
  schemaIdeExamples,
  type SchemaIdeExample,
} from "@schema-ide/examples";
import {
  createHttpWorkspaceClient,
  createMemoryWorkspaceClient,
  SchemaIdeWorkspaceView,
} from "@schema-ide/react";
import { Button } from "@schema-ide/ui";
import { Moon, Sun } from "lucide-react";
import "./styles.css";

type PlaygroundTheme = "dark" | "light";
type WorkspaceMode = "checking" | "local-filesystem" | "memory";

const themeStorageKey = "schema-ide-playground-theme";

function getInitialTheme(): PlaygroundTheme {
  const theme = document.documentElement.dataset["theme"];
  if (theme === "dark" || theme === "light") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: PlaygroundTheme) {
  document.documentElement.dataset["theme"] = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  try {
    localStorage.setItem(themeStorageKey, theme);
  } catch {
    // Ignore storage failures; the in-memory theme still applies.
  }
}

function App() {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("checking");
  const [example, setExample] = useState<SchemaIdeExample>(() => schemaIdeExamples[0]!);
  const [revision, setRevision] = useState(0);
  const [theme, setTheme] = useState<PlaygroundTheme>(getInitialTheme);
  const apiBaseUrl = import.meta.env.VITE_SCHEMA_IDE_API_BASE_URL ?? "";
  const chat = useMemo(
    () =>
      createSchemaIdeChatAdapter({
        baseUrl: apiBaseUrl,
      }),
    [apiBaseUrl],
  );
  const localWorkspaceClient = useMemo(() => createHttpWorkspaceClient(apiBaseUrl), [apiBaseUrl]);
  const memoryWorkspaceClient = useMemo(
    () =>
      createMemoryWorkspaceClient({
        schema: example.schema,
        initialFiles: example.files,
        defaultFormat: example.defaultFormat ?? "json",
        title: example.name,
      }),
    [example, revision],
  );
  const workspaceClient =
    workspaceMode === "local-filesystem" ? localWorkspaceClient : memoryWorkspaceClient;

  useEffect(() => {
    let cancelled = false;
    localWorkspaceClient
      .getCapabilities()
      .then(() => {
        if (!cancelled) setWorkspaceMode("local-filesystem");
      })
      .catch(() => {
        if (!cancelled) setWorkspaceMode("memory");
      });
    return () => {
      cancelled = true;
    };
  }, [localWorkspaceClient]);

  const loadExample = (nextExample: SchemaIdeExample) => {
    setExample(nextExample);
    setRevision((current) => current + 1);
  };

  const toggleTheme = () => {
    setTheme((current) => {
      const nextTheme = current === "dark" ? "light" : "dark";
      applyTheme(nextTheme);
      return nextTheme;
    });
  };

  return (
    <main className="flex h-svh min-h-0 flex-col bg-background text-foreground">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <div>
          <div className="text-sm font-semibold">Schema IDE Playground</div>
          <div className="text-xs text-muted-foreground">
            {workspaceMode === "local-filesystem"
              ? "Local filesystem workspace"
              : "Browser memory workspace"}
          </div>
        </div>

        {workspaceMode === "local-filesystem" ? null : (
          <>
            <select
              value={example.id}
              onChange={(event) => {
                const nextExample = schemaIdeExamples.find(
                  (candidate) => candidate.id === event.target.value,
                );
                if (nextExample) loadExample(nextExample);
              }}
              className="ml-auto h-8 min-w-56 rounded-md border border-border bg-background px-2 text-xs"
              aria-label="Schema IDE example"
              disabled={workspaceMode === "checking"}
            >
              {schemaIdeExamples.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>

            <Button
              size="sm"
              variant="outline"
              onClick={() => loadExample(randomSchemaIdeExample())}
              disabled={workspaceMode === "checking"}
            >
              Random
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => loadExample(example)}
              disabled={workspaceMode === "checking"}
            >
              Reset
            </Button>
          </>
        )}

        <Button
          size="icon"
          variant="outline"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          className={workspaceMode === "local-filesystem" ? "ml-auto" : undefined}
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        <SchemaIdeWorkspaceView
          key={workspaceMode === "local-filesystem" ? "local-filesystem" : `${example.id}:${revision}`}
          client={workspaceClient}
          chat={chat}
          title={workspaceMode === "local-filesystem" ? undefined : example.name}
          showDebug
        />
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

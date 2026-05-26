import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import Button from "@mui/material/Button";
import CssBaseline from "@mui/material/CssBaseline";
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import MuiSelect, { type SelectChangeEvent } from "@mui/material/Select";
import { ThemeProvider } from "@mui/material/styles";
import { createSchemaIdeChatAdapter } from "@schema-ide/agent";
import {
  randomSchemaIdeExample,
  schemaIdeExamples,
  type SchemaIdeExample,
} from "@schema-ide/examples";
import {
  createMemoryWorkspaceClient,
  createRpcWorkspaceClient,
  SchemaIdeWorkspaceView,
} from "@schema-ide/react";
import { Effect } from "effect";
import { Moon, Sun } from "lucide-react";
import { getPlaygroundPreviewNavigation, getPlaygroundPreviews } from "./previews";
import { applyPlaygroundThemeMode, createPlaygroundTheme, type PlaygroundThemeMode } from "./theme";
import "./styles.css";

type WorkspaceMode = "checking" | "local-filesystem" | "memory";

const themeStorageKey = "schema-ide-playground-theme";

function getInitialTheme(): PlaygroundThemeMode {
  const theme = document.documentElement.dataset["theme"];
  if (theme === "dark" || theme === "light") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function persistTheme(theme: PlaygroundThemeMode) {
  applyPlaygroundThemeMode(theme);
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
  const [theme, setTheme] = useState<PlaygroundThemeMode>(getInitialTheme);
  const apiBaseUrl = import.meta.env.VITE_SCHEMA_IDE_API_BASE_URL ?? "";
  const shouldProbeLocalWorkspace = apiBaseUrl === "";
  const chat = useMemo(
    () =>
      createSchemaIdeChatAdapter({
        baseUrl: apiBaseUrl,
      }),
    [apiBaseUrl],
  );
  const muiTheme = useMemo(() => createPlaygroundTheme(theme), [theme]);
  const localWorkspace = useMemo(() => createRpcWorkspaceClient(apiBaseUrl), [apiBaseUrl]);
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
  const workspace = workspaceMode === "local-filesystem" ? localWorkspace : memoryWorkspaceClient;

  useEffect(() => {
    if (!shouldProbeLocalWorkspace) {
      setWorkspaceMode("memory");
      return;
    }

    let cancelled = false;
    Effect.runPromise(localWorkspace.getCapabilities)
      .then(() => {
        if (!cancelled) setWorkspaceMode("local-filesystem");
      })
      .catch(() => {
        if (!cancelled) setWorkspaceMode("memory");
      });
    return () => {
      cancelled = true;
    };
  }, [localWorkspace, shouldProbeLocalWorkspace]);

  const loadExample = (nextExample: SchemaIdeExample) => {
    setExample(nextExample);
    setRevision((current) => current + 1);
  };

  const toggleTheme = () => {
    setTheme((current) => {
      const nextTheme = current === "dark" ? "light" : "dark";
      persistTheme(nextTheme);
      return nextTheme;
    });
  };

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <main className="flex h-svh min-h-0 flex-col bg-muted text-foreground">
        <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b border-border bg-secondary px-4 py-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Schema IDE Playground</div>
          </div>

          <div className="ml-auto flex min-w-0 items-center gap-3 max-[640px]:ml-0 max-[640px]:w-full max-[640px]:flex-wrap">
            {workspaceMode === "local-filesystem" ? null : (
              <>
                <FormControl
                  className="min-w-56 max-[640px]:min-w-0 max-[640px]:flex-1"
                  size="small"
                >
                  <MuiSelect
                    value={example.id}
                    onChange={(event: SelectChangeEvent<string>) => {
                      const nextExample = schemaIdeExamples.find(
                        (candidate) => candidate.id === event.target.value,
                      );
                      if (nextExample) loadExample(nextExample);
                    }}
                    inputProps={{ "aria-label": "Schema IDE example" }}
                    disabled={workspaceMode === "checking"}
                  >
                    {schemaIdeExamples.map((candidate) => (
                      <MenuItem key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </MenuItem>
                    ))}
                  </MuiSelect>
                </FormControl>

                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => loadExample(randomSchemaIdeExample())}
                  disabled={workspaceMode === "checking"}
                >
                  Random
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => loadExample(example)}
                  disabled={workspaceMode === "checking"}
                >
                  Reset
                </Button>
              </>
            )}

            <IconButton
              size="medium"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              className={workspaceMode === "local-filesystem" ? "ml-auto" : undefined}
              sx={{ border: 1, borderColor: "divider" }}
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </IconButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 p-3">
          <div className="h-full min-h-0 overflow-hidden rounded-lg border border-border bg-background shadow-sm">
            <SchemaIdeWorkspaceView
              key={
                workspaceMode === "local-filesystem"
                  ? "local-filesystem"
                  : `${example.id}:${revision}`
              }
              workspace={workspace}
              chat={chat}
              previews={getPlaygroundPreviews(example.id)}
              previewNavigation={getPlaygroundPreviewNavigation(example.id)}
              showDebug
            />
          </div>
        </div>
      </main>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

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
import { createMemoryArtifactStore } from "@schema-ide/artifacts";
import {
  randomSchemaIdeExample,
  schemaIdeExamples,
  type SchemaIdeExample,
} from "@schema-ide/examples";
import { makeOnboardedDeployService } from "@schema-ide/onboarded-config";
import {
  createSchemaIdeArtifactClient,
  createRpcArtifactProjectClient,
  SchemaIdeArtifactProjectView,
} from "@schema-ide/react";
import { Effect } from "effect";
import { Moon, Sun } from "lucide-react";
import { getPlaygroundPreviewNavigation, getPlaygroundPreviews } from "./previews";
import {
  applyPlaygroundThemeSettings,
  createPlaygroundTheme,
  defaultPlaygroundThemeSettings,
  playgroundRadiusOptions,
  playgroundThemeFamilyOptions,
  type PlaygroundRadius,
  type PlaygroundThemeFamily,
  type PlaygroundThemeMode,
  type PlaygroundThemeSettings,
} from "./theme";
import "./styles.css";

type WorkspaceMode = "checking" | "local-filesystem" | "memory" | "cloudflare";

const legacyThemeStorageKey = "schema-ide-playground-theme";
const themeSettingsStorageKey = "schema-ide-playground-theme-settings";

function getInitialThemeSettings(): PlaygroundThemeSettings {
  const storedSettings = readStoredThemeSettings();
  if (storedSettings) {
    applyPlaygroundThemeSettings(storedSettings);
    return storedSettings;
  }

  const legacyTheme = readLegacyThemeMode();
  const documentTheme = document.documentElement.dataset["theme"];
  const mode =
    legacyTheme ??
    (isPlaygroundThemeMode(documentTheme) ? documentTheme : undefined) ??
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const settings = { ...defaultPlaygroundThemeSettings, mode };
  applyPlaygroundThemeSettings(settings);
  return settings;
}

function persistThemeSettings(theme: PlaygroundThemeSettings) {
  applyPlaygroundThemeSettings(theme);
  try {
    localStorage.setItem(themeSettingsStorageKey, JSON.stringify(theme));
  } catch {
    // Ignore storage failures; the in-memory theme still applies.
  }
}

function App() {
  const hostedWorkspaceId = getHostedWorkspaceId(window.location.pathname);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(
    hostedWorkspaceId ? "cloudflare" : "checking",
  );
  const [example, setExample] = useState<SchemaIdeExample>(() => schemaIdeExamples[0]!);
  const [revision, setRevision] = useState(0);
  const [themeSettings, setThemeSettings] =
    useState<PlaygroundThemeSettings>(getInitialThemeSettings);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [createWorkspaceError, setCreateWorkspaceError] = useState<string | null>(null);
  const apiBaseUrl = import.meta.env["VITE_SCHEMA_IDE_API_BASE_URL"] ?? "";
  const shouldProbeLocalWorkspace = apiBaseUrl === "" && !hostedWorkspaceId;
  const canCreateHostedWorkspace = apiBaseUrl !== "";
  const chat = useMemo(
    () =>
      createSchemaIdeChatAdapter({
        baseUrl: apiBaseUrl,
      }),
    [apiBaseUrl],
  );
  const muiTheme = useMemo(() => createPlaygroundTheme(themeSettings), [themeSettings]);
  const localWorkspace = useMemo(() => createRpcArtifactProjectClient(apiBaseUrl), [apiBaseUrl]);
  const hostedWorkspace = useMemo(
    () =>
      hostedWorkspaceId
        ? createRpcArtifactProjectClient(
            apiBaseUrl,
            `/v1/workspaces/${encodeURIComponent(hostedWorkspaceId)}/rpc`,
          )
        : null,
    [apiBaseUrl, hostedWorkspaceId],
  );
  const memoryWorkspaceClient = useMemo(
    () =>
      createSchemaIdeArtifactClient({
        schema: example.schema,
        project: example.project,
        initialFiles: example.files,
        defaultFormat: example.defaultFormat ?? "json",
        title: example.name,
      }),
    [example, revision],
  );
  const workspace =
    workspaceMode === "cloudflare" && hostedWorkspace
      ? hostedWorkspace
      : workspaceMode === "local-filesystem"
        ? localWorkspace
        : memoryWorkspaceClient;
  // Local demo: run the deploy engine in-browser against the mock OnboardedApi.
  // (In production the engine runs server-side; the mock + memory store is safe
  // to run client-side for testing connect → pull → plan → apply → runs.)
  const deploy = useMemo(
    () => makeOnboardedDeployService({ store: createMemoryArtifactStore() }),
    [],
  );
  const workspaceModeDescription = workspaceModeLabel(workspaceMode);

  useEffect(() => {
    if (hostedWorkspaceId) {
      setWorkspaceMode("cloudflare");
      return;
    }

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
  }, [hostedWorkspaceId, localWorkspace, shouldProbeLocalWorkspace]);

  useEffect(() => {
    if (!hostedWorkspaceId) return;

    let cancelled = false;
    fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/workspaces/${encodeURIComponent(hostedWorkspaceId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((metadata: { templateId?: string } | null) => {
        if (cancelled || !metadata?.templateId) return;
        const template = schemaIdeExamples.find(
          (candidate) => candidate.id === metadata.templateId,
        );
        if (template) setExample(template);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, hostedWorkspaceId]);

  const loadExample = (nextExample: SchemaIdeExample) => {
    setExample(nextExample);
    setRevision((current) => current + 1);
  };

  const toggleTheme = () => {
    setThemeSettings((current) => {
      const nextSettings = { ...current, mode: current.mode === "dark" ? "light" : "dark" };
      persistThemeSettings(nextSettings);
      return nextSettings;
    });
  };

  const updateThemeFamily = (family: PlaygroundThemeFamily) => {
    setThemeSettings((current) => {
      const nextSettings = { ...current, family };
      persistThemeSettings(nextSettings);
      return nextSettings;
    });
  };

  const updateThemeRadius = (radius: PlaygroundRadius) => {
    setThemeSettings((current) => {
      const nextSettings = { ...current, radius };
      persistThemeSettings(nextSettings);
      return nextSettings;
    });
  };

  const createHostedWorkspace = async () => {
    if (!canCreateHostedWorkspace || creatingWorkspace) return;
    setCreatingWorkspace(true);
    setCreateWorkspaceError(null);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: example.id }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const result = (await response.json()) as { url?: string };
      if (!result.url) throw new Error("Workspace creation did not return a URL.");
      window.location.assign(result.url);
    } catch (error) {
      setCreateWorkspaceError(error instanceof Error ? error.message : String(error));
      setCreatingWorkspace(false);
    }
  };

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <main className="flex h-svh min-h-0 flex-col bg-muted text-foreground">
        <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b border-border bg-secondary px-4 py-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Schema IDE Playground</div>
            {workspaceModeDescription ? (
              <div className="text-xs text-muted-foreground">{workspaceModeDescription}</div>
            ) : null}
          </div>

          <div className="ml-auto flex min-w-0 items-center gap-3 max-[640px]:ml-0 max-[640px]:w-full max-[640px]:flex-wrap">
            {workspaceMode === "local-filesystem" || workspaceMode === "cloudflare" ? null : (
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

            <FormControl className="min-w-36 max-[640px]:min-w-0 max-[640px]:flex-1" size="small">
              <MuiSelect
                value={themeSettings.family}
                onChange={(event: SelectChangeEvent<PlaygroundThemeFamily>) => {
                  updateThemeFamily(event.target.value as PlaygroundThemeFamily);
                }}
                inputProps={{ "aria-label": "Theme preset" }}
              >
                {playgroundThemeFamilyOptions.map((option) => (
                  <MenuItem key={option.id} value={option.id}>
                    {option.label}
                  </MenuItem>
                ))}
              </MuiSelect>
            </FormControl>

            <FormControl className="min-w-28 max-[640px]:min-w-0 max-[640px]:flex-1" size="small">
              <MuiSelect
                value={themeSettings.radius}
                onChange={(event: SelectChangeEvent<PlaygroundRadius>) => {
                  updateThemeRadius(event.target.value as PlaygroundRadius);
                }}
                inputProps={{ "aria-label": "Element roundness" }}
              >
                {playgroundRadiusOptions.map((option) => (
                  <MenuItem key={option.id} value={option.id}>
                    {option.label}
                  </MenuItem>
                ))}
              </MuiSelect>
            </FormControl>

            {canCreateHostedWorkspace && workspaceMode !== "cloudflare" ? (
              <Button
                className={workspaceMode === "local-filesystem" ? "ml-auto" : undefined}
                size="small"
                variant="contained"
                onClick={() => void createHostedWorkspace()}
                disabled={workspaceMode === "checking" || creatingWorkspace}
              >
                {creatingWorkspace ? "Creating..." : "New hosted workspace"}
              </Button>
            ) : null}

            <IconButton
              size="medium"
              onClick={toggleTheme}
              aria-label={`Switch to ${themeSettings.mode === "dark" ? "light" : "dark"} theme`}
              title={`Switch to ${themeSettings.mode === "dark" ? "light" : "dark"} theme`}
              className={
                workspaceMode === "local-filesystem" && !canCreateHostedWorkspace
                  ? "ml-auto"
                  : undefined
              }
              sx={{ border: 1, borderColor: "divider" }}
            >
              {themeSettings.mode === "dark" ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </IconButton>
          </div>
        </div>

        {createWorkspaceError ? (
          <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
            {createWorkspaceError}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 p-3">
          <div className="h-full min-h-0 overflow-hidden rounded-lg border border-border bg-background shadow-sm">
            <SchemaIdeArtifactProjectView
              key={
                workspaceMode === "cloudflare"
                  ? `cloudflare:${hostedWorkspaceId}`
                  : workspaceMode === "local-filesystem"
                    ? "local-filesystem"
                    : `${example.id}:${revision}`
              }
              artifactProject={workspace}
              chat={chat}
              title={
                workspaceMode === "local-filesystem" || workspaceMode === "cloudflare"
                  ? undefined
                  : example.name
              }
              previews={getPlaygroundPreviews(example.id)}
              previewNavigation={getPlaygroundPreviewNavigation(example.id)}
              deploy={deploy}
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

function getHostedWorkspaceId(pathname: string): string | null {
  const match = /^\/w\/([^/]+)\/?$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function workspaceModeLabel(mode: WorkspaceMode): string {
  switch (mode) {
    case "checking":
      return "Checking workspace";
    case "local-filesystem":
      return "Local filesystem workspace";
    case "cloudflare":
      return "";
    case "memory":
      return "Browser memory workspace";
  }
}

function readStoredThemeSettings(): PlaygroundThemeSettings | null {
  try {
    const raw = localStorage.getItem(themeSettingsStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlaygroundThemeSettings>;
    if (
      isPlaygroundThemeFamily(parsed.family) &&
      isPlaygroundThemeMode(parsed.mode) &&
      isPlaygroundRadius(parsed.radius)
    ) {
      return {
        family: parsed.family,
        mode: parsed.mode,
        radius: parsed.radius,
      };
    }
  } catch {
    // Ignore invalid or unavailable storage.
  }
  return null;
}

function readLegacyThemeMode(): PlaygroundThemeMode | null {
  try {
    const raw = localStorage.getItem(legacyThemeStorageKey);
    return isPlaygroundThemeMode(raw) ? raw : null;
  } catch {
    return null;
  }
}

function isPlaygroundThemeMode(value: unknown): value is PlaygroundThemeMode {
  return value === "dark" || value === "light";
}

function isPlaygroundThemeFamily(value: unknown): value is PlaygroundThemeFamily {
  return playgroundThemeFamilyOptions.some((option) => option.id === value);
}

function isPlaygroundRadius(value: unknown): value is PlaygroundRadius {
  return playgroundRadiusOptions.some((option) => option.id === value);
}

import { useEffect, useMemo, useState } from "react";
import Button from "@mui/material/Button";
import CssBaseline from "@mui/material/CssBaseline";
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import MuiSelect, { type SelectChangeEvent } from "@mui/material/Select";
import { ThemeProvider } from "@mui/material/styles";
import { createSchematicsChatAdapter } from "@schematics/agent";
import { createMemoryArtifactStore } from "@schematics/artifacts";
import { createSchematicsArtifactRuntime } from "@schematics/core";
import {
  randomSchematicsExample,
  schematicsExamples,
  type SchematicsExample,
} from "@schematics/examples";
import { fixedClockFromIso } from "@schematics/git-artifacts";
import { makeOnboardedDeployService } from "@schematics/onboarded-config";
import {
  createSchematicsArtifactClient,
  createRpcArtifactProjectClient,
  SchematicsArtifactProjectView,
} from "@schematics/ide";
import { Effect } from "effect";
import { GitBranchPlus, GitMerge, Moon, Sun } from "lucide-react";
import {
  createHostedGitCommitter,
  withHostedGitCommits,
  withHostedGitDeployCommits,
  type HostedGitInfo,
} from "./hosted-git";
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

type WorkspaceMode = "checking" | "local-filesystem" | "memory" | "cloudflare";

const legacyThemeStorageKey = "schematics-playground-theme";
const themeSettingsStorageKey = "schematics-playground-theme-settings";
const hostedDraftBranch = "draft/mina-q3";

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

export default function PlaygroundApp() {
  const hostedWorkspaceId = getHostedWorkspaceId(window.location.pathname);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(
    hostedWorkspaceId ? "cloudflare" : "checking",
  );
  const [example, setExample] = useState<SchematicsExample>(() => schematicsExamples[0]!);
  const [revision, setRevision] = useState(0);
  const [themeSettings, setThemeSettings] =
    useState<PlaygroundThemeSettings>(getInitialThemeSettings);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [createWorkspaceError, setCreateWorkspaceError] = useState<string | null>(null);
  const [hostedGit, setHostedGit] = useState<HostedGitInfo | null>(null);
  const [hostedBranch, setHostedBranch] = useState<string | null>(null);
  const [hostedGitReady, setHostedGitReady] = useState(false);
  const [hostedBranchBusy, setHostedBranchBusy] = useState<"fork" | "merge" | null>(null);
  const [hostedBranchStatus, setHostedBranchStatus] = useState<string | null>(null);
  const [hostedBranchError, setHostedBranchError] = useState<string | null>(null);
  const apiBaseUrl = import.meta.env["VITE_SCHEMATICS_API_BASE_URL"] ?? "";
  const e2eClock = useMemo(() => fixedClockFromIso(import.meta.env["VITE_E2E_NOW"]), []);
  const shouldProbeLocalWorkspace = apiBaseUrl === "" && !hostedWorkspaceId;
  const canCreateHostedWorkspace = apiBaseUrl !== "";
  const chat = useMemo(
    () =>
      createSchematicsChatAdapter({
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
  const hostedGitCommitter = useMemo(
    () =>
      hostedGit
        ? createHostedGitCommitter(hostedGit, {
            branch: hostedBranch ?? hostedGit.defaultBranch,
            clock: e2eClock ?? undefined,
          })
        : null,
    [e2eClock, hostedBranch, hostedGit],
  );
  const hostedWorkspaceWithGit = useMemo(
    () =>
      hostedWorkspace && hostedGitCommitter
        ? withHostedGitCommits(hostedWorkspace, hostedGitCommitter)
        : hostedWorkspace,
    [hostedGitCommitter, hostedWorkspace],
  );
  const memoryWorkspaceClient = useMemo(
    () =>
      createSchematicsArtifactClient({
        schema: example.schema,
        project: example.project,
        initialFiles: example.files,
        defaultFormat: example.defaultFormat ?? "json",
        title: example.name,
      }),
    [example, revision],
  );
  // Deploy demo (Onboarded example only): the editor and the in-browser deploy
  // engine share ONE artifact store, starting from a blank tree. Connecting +
  // Pull imports the mock account into that store, so the files stream into the
  // file tree live; editing one then drives a real plan/apply. The engine runs
  // client-side here only because it targets the mock OnboardedApi — in
  // production it runs server-side via createRpcDeployClient.
  const isOnboardedExample = example.id === "onboarded-account-yaml";
  const deployProjectId = example.project?.name;
  const deployStore = useMemo(() => createMemoryArtifactStore(), [example.id, revision]);
  const deployWorkspaceClient = useMemo(
    () =>
      example.project
        ? createSchematicsArtifactClient({
            artifacts: createSchematicsArtifactRuntime({
              project: example.project,
              files: [],
              activeFile: null,
              activeFormat: example.defaultFormat ?? "yaml",
              ...(deployProjectId ? { projectId: deployProjectId } : {}),
              store: deployStore,
            }),
            title: example.name,
            ...(deployProjectId ? { projectId: deployProjectId } : {}),
          })
        : null,
    [deployProjectId, deployStore, example.defaultFormat, example.name, example.project],
  );
  const deploy = useMemo(
    () =>
      makeOnboardedDeployService({
        store: deployStore,
        now: playgroundNow,
        ...(deployProjectId ? { projectId: deployProjectId } : {}),
      }),
    [deployProjectId, deployStore],
  );
  const hostedDeploy = useMemo(
    () =>
      isOnboardedExample && hostedGitCommitter && hostedWorkspace
        ? withHostedGitDeployCommits(
            makeOnboardedDeployService({
              store: hostedGitCommitter.store,
              now: playgroundNow,
              ...(deployProjectId ? { projectId: deployProjectId } : {}),
            }),
            hostedWorkspace,
            hostedGitCommitter,
          )
        : null,
    [deployProjectId, hostedGitCommitter, hostedWorkspace, isOnboardedExample],
  );
  const useMemoryDeployDemo =
    isOnboardedExample && workspaceMode === "memory" && deployWorkspaceClient;
  const activeDeploy = useMemoryDeployDemo
    ? deploy
    : workspaceMode === "cloudflare"
      ? (hostedDeploy ?? undefined)
      : undefined;
  const workspace =
    workspaceMode === "cloudflare" && hostedWorkspaceWithGit
      ? hostedWorkspaceWithGit
      : workspaceMode === "local-filesystem"
        ? localWorkspace
        : useMemoryDeployDemo
          ? deployWorkspaceClient
          : memoryWorkspaceClient;
  const workspaceModeDescription = workspaceModeLabel(workspaceMode);
  const hostedActiveBranch = hostedBranch ?? hostedGit?.defaultBranch ?? null;
  const hostedOnDefaultBranch =
    !hostedGit || !hostedActiveBranch || hostedActiveBranch === hostedGit.defaultBranch;

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
      .then((metadata: { templateId?: string; git?: HostedGitInfo } | null) => {
        if (cancelled || !metadata?.templateId) return;
        setHostedGit(metadata.git ?? null);
        setHostedBranch(metadata.git?.defaultBranch ?? null);
        setHostedGitReady(false);
        const template = schematicsExamples.find(
          (candidate) => candidate.id === metadata.templateId,
        );
        if (template) setExample(template);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, hostedWorkspaceId]);

  useEffect(() => {
    if (!hostedWorkspace || !hostedGitCommitter) return;
    let cancelled = false;
    setHostedGitReady(false);
    Effect.runPromise(
      hostedWorkspace.getSnapshot.pipe(
        Effect.flatMap((snapshot) =>
          hostedGitCommitter.commitSnapshot(snapshot.files, {
            subject: "Initialize hosted workspace",
            provenance: { actor: "system" },
          }),
        ),
      ),
    )
      .then(() => {
        if (!cancelled) setHostedGitReady(true);
      })
      .catch((error) => {
        if (!cancelled) {
          setHostedGitReady(false);
          console.warn("Hosted git initial commit failed:", error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hostedGitCommitter, hostedWorkspace]);

  const forkHostedDraft = async () => {
    if (
      !hostedGit ||
      !hostedWorkspace ||
      !hostedGitCommitter ||
      hostedBranchBusy ||
      !hostedOnDefaultBranch
    ) {
      return;
    }
    setHostedBranchBusy("fork");
    setHostedBranchError(null);
    setHostedBranchStatus(null);
    try {
      await Effect.runPromise(
        hostedWorkspace.getSnapshot.pipe(
          Effect.flatMap((snapshot) =>
            hostedGitCommitter.commitSnapshot(snapshot.files, {
              subject: "Initialize hosted workspace",
              provenance: { actor: "system" },
            }),
          ),
        ),
      );
      const result = await Effect.runPromise(
        hostedGitCommitter.forkDraft({ branch: hostedDraftBranch }),
      );
      setHostedBranch(result.branch);
      setHostedBranchStatus(`Forked ${result.branch}`);
    } catch (error) {
      setHostedBranchError(error instanceof Error ? error.message : String(error));
    } finally {
      setHostedBranchBusy(null);
    }
  };

  const mergeHostedDraft = async () => {
    if (!hostedGit || !hostedGitCommitter || hostedBranchBusy || hostedOnDefaultBranch) return;
    const branch = hostedActiveBranch;
    if (!branch) return;
    setHostedBranchBusy("merge");
    setHostedBranchError(null);
    setHostedBranchStatus(null);
    try {
      const result = await Effect.runPromise(
        hostedGitCommitter.mergeDraft({ branch, into: hostedGit.defaultBranch }),
      );
      setHostedBranch(result.into);
      setHostedBranchStatus(`Merged ${result.branch} into ${result.into}`);
    } catch (error) {
      setHostedBranchError(error instanceof Error ? error.message : String(error));
    } finally {
      setHostedBranchBusy(null);
    }
  };

  const loadExample = (nextExample: SchematicsExample) => {
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
            <div className="text-sm font-semibold">Schematics Playground</div>
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
                      const nextExample = schematicsExamples.find(
                        (candidate) => candidate.id === event.target.value,
                      );
                      if (nextExample) loadExample(nextExample);
                    }}
                    inputProps={{ "aria-label": "Schematics example" }}
                    disabled={workspaceMode === "checking"}
                  >
                    {schematicsExamples.map((candidate) => (
                      <MenuItem key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </MenuItem>
                    ))}
                  </MuiSelect>
                </FormControl>

                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => loadExample(randomSchematicsExample())}
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

            {workspaceMode === "cloudflare" &&
            hostedGitReady &&
            hostedGitCommitter &&
            hostedActiveBranch ? (
              <div className="flex min-w-0 items-center gap-2 max-[640px]:w-full max-[640px]:flex-wrap">
                <div className="min-w-0 max-w-48 truncate rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                  {hostedActiveBranch}
                </div>
                {hostedOnDefaultBranch ? (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<GitBranchPlus className="size-4" />}
                    onClick={() => void forkHostedDraft()}
                    disabled={hostedBranchBusy !== null}
                  >
                    {hostedBranchBusy === "fork" ? "Forking..." : "Fork draft"}
                  </Button>
                ) : (
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<GitMerge className="size-4" />}
                    onClick={() => void mergeHostedDraft()}
                    disabled={hostedBranchBusy !== null}
                  >
                    {hostedBranchBusy === "merge" ? "Merging..." : "Merge draft"}
                  </Button>
                )}
              </div>
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
        {hostedBranchError ? (
          <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
            {hostedBranchError}
          </div>
        ) : null}
        {hostedBranchStatus ? (
          <div className="border-b border-border bg-secondary px-4 py-2 text-xs text-muted-foreground">
            {hostedBranchStatus}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 p-3">
          <div className="h-full min-h-0 overflow-hidden rounded-lg border border-border bg-background shadow-sm">
            <SchematicsArtifactProjectView
              key={
                workspaceMode === "cloudflare"
                  ? `cloudflare:${hostedWorkspaceId}:${hostedActiveBranch ?? "default"}`
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
              deploy={activeDeploy}
              showDebug
            />
          </div>
        </div>
      </main>
    </ThemeProvider>
  );
}

function getHostedWorkspaceId(pathname: string): string | null {
  const match = /^\/w\/([^/]+)\/?$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function playgroundNow(): string {
  const e2eNow = import.meta.env["VITE_E2E_NOW"];
  return typeof e2eNow === "string" && e2eNow ? e2eNow : new Date().toISOString();
}

function workspaceModeLabel(mode: WorkspaceMode): string {
  switch (mode) {
    case "checking":
      return "Checking workspace";
    case "local-filesystem":
      return "Local filesystem workspace";
    case "cloudflare":
      return "Cloudflare hosted workspace";
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

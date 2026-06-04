import { hasChanges, renderPlan } from "@schematics/alchemy";
import {
  buildGitCommitMessage,
  forkLocalGitBranch,
  makeLocalGitCommitter,
  mergeLocalGitBranch,
} from "@schematics/git-artifacts/node";
import { Effect } from "effect";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeOnboardedConfigDeploy } from "./deploy";
import { createFsArtifactStore } from "./fs-store";
import {
  makeMockOnboardedApi,
  seedOnboardedData,
  type MockOnboardedApi,
  type OnboardedApi,
  type OnboardedSeed,
} from "./mock";

// Node-using entry points (filesystem store + CLI) live here, off the main
// index, so node-less consumers (cloudflare/react) don't pull in node:fs.
export { createFsArtifactStore } from "./fs-store";

/**
 * A small `pull | plan | apply` CLI for the Onboarded config-as-code lifecycle,
 * operating on a directory of YAML files (+ a committed `config.lock.json`).
 *
 * Backed by the in-memory mock OnboardedApi by default, so it is runnable and
 * testable without a live backend; pass `api` to target a real adapter.
 */
export interface OnboardedDeployCliOptions {
  readonly api?: OnboardedApi | undefined;
}

export interface OnboardedDeployCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const USAGE = `Usage: onboarded-deploy <pull|plan|apply|destroy|fork|merge> --dir <dir> [--account <demo|mina>] [--commit] [--branch <name>] [--into <name>] [--mock-state <file>] [--auto-approve] [--allow-delete]`;

export async function runOnboardedDeployCli(
  argv: readonly string[],
  options: OnboardedDeployCliOptions = {},
): Promise<OnboardedDeployCliResult> {
  return Effect.runPromise(runOnboardedDeployCliEffect(argv, options));
}

export function runOnboardedDeployCliEffect(
  argv: readonly string[],
  options: OnboardedDeployCliOptions = {},
): Effect.Effect<OnboardedDeployCliResult> {
  return Effect.gen(function* () {
    const command = argv[0];
    const flags = parseFlags(argv.slice(1));
    const dir = flags.dir;

    if (!command || !["pull", "plan", "apply", "destroy", "fork", "merge"].includes(command)) {
      return {
        exitCode: command ? 1 : 0,
        stdout: command ? "" : USAGE,
        stderr: command ? USAGE : "",
      };
    }
    if (!dir) return { exitCode: 1, stdout: "", stderr: `Missing --dir\n${USAGE}` };

    const store = createFsArtifactStore(dir, { projectId: "onboarded-account-yaml" });
    let persistentMock: { readonly path: string; readonly api: MockOnboardedApi } | null = null;
    if (!options.api && flags.mockState) {
      persistentMock = yield* makePersistentMockApi(flags.mockState, flags.account);
    }
    const api =
      options.api ??
      persistentMock?.api ??
      (flags.account
        ? makeMockOnboardedApi({ seed: seedOnboardedData({ account: flags.account }) })
        : undefined);
    const deploy = makeOnboardedConfigDeploy({ store, api });
    const json = (value: unknown): string => JSON.stringify(value, null, 2);

    switch (command) {
      case "pull": {
        const result = yield* deploy.pull;
        let commitOid: string | null = null;
        if (flags.commit) {
          commitOid = yield* commitPulledSnapshot({
            dir,
            paths: result.pulled.map((p) => p.path),
            account: flags.account,
          });
        }
        if (flags.json) return ok(json({ ...result, commitOid }));
        const lines = result.pulled.map((p) => `  pulled ${p.kind}  ${p.key}  (${p.path})`);
        return ok(
          [
            `Pulled ${result.pulled.length} resource(s) into ${dir}`,
            ...lines,
            ...(flags.commit
              ? [
                  commitOid
                    ? `Committed pull snapshot ${commitOid.slice(0, 7)}`
                    : "No git commit created; pull snapshot matched HEAD.",
                ]
              : []),
          ].join("\n"),
        );
      }
      case "plan": {
        const plan = yield* deploy.plan;
        return ok(flags.json ? json(plan) : renderPlan(plan));
      }
      case "apply": {
        const plan = yield* deploy.plan;
        if (!hasChanges(plan)) {
          if (persistentMock) yield* savePersistentMockApi(persistentMock);
          return ok(
            flags.json
              ? json({ plan, applied: [], aborted: [], skipped: [] })
              : `${renderPlan(plan)}\n\nNothing to apply.`,
          );
        }
        if (!flags.autoApprove) {
          return flags.json
            ? ok(json({ plan, applied: false, reason: "requires --auto-approve" }))
            : ok(`${renderPlan(plan)}\n\nRe-run with --auto-approve to apply.`);
        }
        const result = yield* deploy.apply(plan, { allowDelete: flags.allowDelete });
        if (persistentMock) yield* savePersistentMockApi(persistentMock);
        const exitCode = result.aborted.length > 0 ? 1 : 0;
        if (flags.json) return { exitCode, stdout: json({ plan, ...result }), stderr: "" };
        const lines = [
          renderPlan(plan),
          "",
          `Applied ${result.applied.length}, aborted ${result.aborted.length}, skipped ${result.skipped.length}.`,
          ...result.aborted.map((a) => `  aborted ${a.change.kind} ${a.change.key} (${a.reason})`),
        ];
        return { exitCode, stdout: lines.join("\n"), stderr: "" };
      }
      case "destroy": {
        if (!flags.autoApprove) {
          return ok(
            flags.json
              ? json({ destroyed: false, reason: "requires --auto-approve" })
              : "destroy removes every config-managed resource. Re-run with --auto-approve.",
          );
        }
        const result = yield* deploy.destroy;
        if (persistentMock) yield* savePersistentMockApi(persistentMock);
        if (flags.json) return ok(json(result));
        return ok(
          `Destroyed ${result.applied.length}, aborted ${result.aborted.length}, skipped ${result.skipped.length}.`,
        );
      }
      case "fork": {
        if (!flags.branch) return { exitCode: 1, stdout: "", stderr: `Missing --branch\n${USAGE}` };
        const result = yield* forkLocalGitBranch({ directory: dir, branch: flags.branch });
        if (flags.json) return ok(json(result));
        return ok(`Forked draft branch ${result.branch} at ${result.oid.slice(0, 7)}`);
      }
      case "merge": {
        if (!flags.branch) return { exitCode: 1, stdout: "", stderr: `Missing --branch\n${USAGE}` };
        const result = yield* mergeLocalGitBranch({
          directory: dir,
          branch: flags.branch,
          into: flags.into ?? "main",
        });
        if (flags.json) return ok(json(result));
        return ok(
          result.alreadyMerged
            ? `${result.branch} is already merged into ${result.into} at ${result.oid?.slice(0, 7) ?? "unknown"}`
            : `Merged ${result.branch} into ${result.into} at ${result.oid?.slice(0, 7) ?? "unknown"}`,
        );
      }
      default:
        return { exitCode: 1, stdout: "", stderr: USAGE };
    }
  }).pipe(
    Effect.catch((error) => Effect.succeed({ exitCode: 1, stdout: "", stderr: String(error) })),
  );
}

interface Flags {
  readonly dir?: string | undefined;
  readonly account?: "demo" | "mina" | undefined;
  readonly autoApprove: boolean;
  readonly allowDelete: boolean;
  readonly commit: boolean;
  readonly json: boolean;
  readonly branch?: string | undefined;
  readonly into?: string | undefined;
  readonly mockState?: string | undefined;
}

function parseFlags(args: readonly string[]): Flags {
  let dir: string | undefined;
  let account: "demo" | "mina" | undefined;
  let autoApprove = false;
  let allowDelete = false;
  let commit = false;
  let json = false;
  let branch: string | undefined;
  let into: string | undefined;
  let mockState: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--dir") {
      dir = args[i + 1];
      i += 1;
    } else if (arg === "--account") {
      const value = args[i + 1];
      if (value === "demo" || value === "mina") account = value;
      i += 1;
    } else if (arg === "--branch") {
      branch = args[i + 1];
      i += 1;
    } else if (arg === "--into") {
      into = args[i + 1];
      i += 1;
    } else if (arg === "--mock-state") {
      mockState = args[i + 1];
      i += 1;
    } else if (arg === "--auto-approve") autoApprove = true;
    else if (arg === "--allow-delete") allowDelete = true;
    else if (arg === "--commit") commit = true;
    else if (arg === "--json") json = true;
  }
  return { dir, account, autoApprove, allowDelete, commit, json, branch, into, mockState };
}

const ok = (stdout: string): OnboardedDeployCliResult => ({ exitCode: 0, stdout, stderr: "" });

function commitPulledSnapshot({
  dir,
  paths,
  account,
}: {
  readonly dir: string;
  readonly paths: readonly string[];
  readonly account?: "demo" | "mina" | undefined;
}): Effect.Effect<string | null, unknown> {
  const committer = makeLocalGitCommitter({ directory: dir });
  if (!committer) {
    return Effect.fail(new Error("--commit requires --dir to be inside a git repository."));
  }
  const timestamp = commitTimestamp();
  return committer.commit({
    changed: [...new Set([...paths, "config.lock.json"])],
    message: buildGitCommitMessage(
      account === "mina" ? "Pull mina snapshot" : "Pull onboarded snapshot",
      { actor: "system" },
    ),
    author: {
      name: "Schematics",
      email: "schematics@localhost",
      timestamp,
    },
  });
}

function commitTimestamp(): number {
  const fixed = process.env["E2E_NOW"];
  if (fixed) {
    const parsed = Date.parse(fixed);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

function makePersistentMockApi(
  statePath: string,
  account: "demo" | "mina" | undefined,
): Effect.Effect<{ readonly path: string; readonly api: MockOnboardedApi }, unknown> {
  return readMockState(statePath).pipe(
    Effect.catch((error) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return Effect.succeed(seedOnboardedData({ account }));
      }
      return Effect.fail(error);
    }),
    Effect.map((seed) => ({ path: statePath, api: makeMockOnboardedApi({ seed }) })),
  );
}

function savePersistentMockApi(mock: {
  readonly path: string;
  readonly api: MockOnboardedApi;
}): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdir(dirname(mock.path), { recursive: true }),
      catch: (error) => error,
    });
    const snapshot = yield* mock.api.snapshot;
    yield* Effect.tryPromise({
      try: () => writeFile(mock.path, `${JSON.stringify(snapshot, null, 2)}\n`),
      catch: (error) => error,
    });
  });
}

function readMockState(path: string): Effect.Effect<OnboardedSeed, unknown> {
  return Effect.tryPromise({
    try: async () => JSON.parse(await readFile(path, "utf8")) as OnboardedSeed,
    catch: (error) => error,
  });
}

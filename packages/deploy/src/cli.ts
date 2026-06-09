import type { ArtifactStore } from "@schematics/artifacts";
import { hasChanges, renderPlan, type ConfigDeploy } from "@schematics/alchemy";
import {
  buildGitCommitMessage,
  currentGitTimestamp,
  forkLocalGitBranch,
  makeLocalGitCommitter,
  mergeLocalGitBranch,
} from "@schematics/git-artifacts/node";
import { Clock, Effect } from "effect";
import { createFsArtifactStore } from "./fs-store";

/**
 * A generic `pull | plan | apply | destroy | fork | merge` CLI for the
 * config-as-code lifecycle, operating on a directory of files (+ a committed
 * `config.lock.json`). Domain-agnostic: an example supplies `resolveDeploy` to
 * build its engine (live or mock) from the parsed flags, plus a project id and
 * commit label. The deploy/diff/plan/apply flow itself is identical everywhere.
 */
export interface DeployCliFlags {
  readonly dir?: string | undefined;
  readonly account?: string | undefined;
  readonly autoApprove: boolean;
  readonly allowDelete: boolean;
  readonly commit: boolean;
  readonly json: boolean;
  readonly branch?: string | undefined;
  readonly into?: string | undefined;
  /** Any flags the generic parser didn't recognize, as `--flag value` pairs. */
  readonly rest: Readonly<Record<string, string | boolean>>;
}

export interface DeployCliConfig {
  /** Project id used to address files in the working-tree store. */
  readonly projectId: string;
  /** Binary name shown in usage, e.g. "catalog-deploy". */
  readonly name: string;
  /** Build the engine for a working-tree store + parsed flags. */
  readonly resolveDeploy: (input: {
    readonly store: ArtifactStore;
    readonly flags: DeployCliFlags;
  }) => Effect.Effect<ConfigDeploy, unknown>;
  /** Commit message for `--commit` pull snapshots. Defaults to a generic line. */
  readonly commitMessage?: ((flags: DeployCliFlags) => string) | undefined;
  /**
   * Run after a successful `apply`/`destroy` (e.g. to persist a mock remote's
   * state to disk so subsequent invocations see the mutation).
   */
  readonly afterMutate?: ((flags: DeployCliFlags) => Effect.Effect<void>) | undefined;
}

export interface DeployCliOptions {
  readonly clock?: Clock.Clock | undefined;
}

export interface DeployCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const COMMANDS = ["pull", "plan", "apply", "destroy", "fork", "merge"] as const;

export function runDeployCli(
  argv: readonly string[],
  config: DeployCliConfig,
  options: DeployCliOptions = {},
): Promise<DeployCliResult> {
  return Effect.runPromise(runDeployCliEffect(argv, config, options));
}

export function runDeployCliEffect(
  argv: readonly string[],
  config: DeployCliConfig,
  options: DeployCliOptions = {},
): Effect.Effect<DeployCliResult> {
  const usage = `Usage: ${config.name} <${COMMANDS.join("|")}> --dir <dir> [--account <name>] [--commit] [--branch <name>] [--into <name>] [--auto-approve] [--allow-delete] [--json]`;
  const ok = (stdout: string): DeployCliResult => ({ exitCode: 0, stdout, stderr: "" });

  const program = Effect.gen(function* () {
    const command = argv[0];
    const flags = parseFlags(argv.slice(1));
    const dir = flags.dir;

    if (!command || !COMMANDS.includes(command as (typeof COMMANDS)[number])) {
      return {
        exitCode: command ? 1 : 0,
        stdout: command ? "" : usage,
        stderr: command ? usage : "",
      };
    }
    if (!dir) return { exitCode: 1, stdout: "", stderr: `Missing --dir\n${usage}` };

    const store = createFsArtifactStore(dir, { projectId: config.projectId });
    const json = (value: unknown): string => JSON.stringify(value, null, 2);

    // fork/merge are pure git operations that don't need the engine.
    if (command === "fork") {
      if (!flags.branch) return { exitCode: 1, stdout: "", stderr: `Missing --branch\n${usage}` };
      const result = yield* forkLocalGitBranch({ directory: dir, branch: flags.branch });
      return flags.json
        ? ok(json(result))
        : ok(`Forked draft branch ${result.branch} at ${result.oid.slice(0, 7)}`);
    }
    if (command === "merge") {
      if (!flags.branch) return { exitCode: 1, stdout: "", stderr: `Missing --branch\n${usage}` };
      const result = yield* mergeLocalGitBranch({
        directory: dir,
        branch: flags.branch,
        into: flags.into ?? "main",
      });
      if (flags.json) return ok(json(result));
      const oid = result.oid?.slice(0, 7) ?? "unknown";
      return ok(
        result.alreadyMerged
          ? `${result.branch} is already merged into ${result.into} at ${oid}`
          : `Merged ${result.branch} into ${result.into} at ${oid}`,
      );
    }

    const deploy = yield* config.resolveDeploy({ store, flags });

    switch (command) {
      case "pull": {
        const result = yield* deploy.pull;
        let commitOid: string | null = null;
        if (flags.commit) {
          commitOid = yield* commitPulledSnapshot({
            dir,
            paths: result.pulled.map((p) => p.path),
            message: config.commitMessage?.(flags) ?? "Pull config snapshot",
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
          // Still persist so a fresh `--mock-state` file is seeded on first run.
          if (config.afterMutate) yield* config.afterMutate(flags);
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
        if (config.afterMutate) yield* config.afterMutate(flags);
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
        if (config.afterMutate) yield* config.afterMutate(flags);
        if (flags.json) return ok(json(result));
        return ok(
          `Destroyed ${result.applied.length}, aborted ${result.aborted.length}, skipped ${result.skipped.length}.`,
        );
      }
      default:
        return { exitCode: 1, stdout: "", stderr: usage };
    }
  }).pipe(
    Effect.catch((error) => Effect.succeed({ exitCode: 1, stdout: "", stderr: String(error) })),
  );

  return options.clock ? program.pipe(Effect.provideService(Clock.Clock, options.clock)) : program;
}

function parseFlags(args: readonly string[]): DeployCliFlags {
  let dir: string | undefined;
  let account: string | undefined;
  let autoApprove = false;
  let allowDelete = false;
  let commit = false;
  let json = false;
  let branch: string | undefined;
  let into: string | undefined;
  const rest: Record<string, string | boolean> = {};
  const valued = new Set(["--dir", "--account", "--branch", "--into"]);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--dir") dir = args[(i += 1)];
    else if (arg === "--account") account = args[(i += 1)];
    else if (arg === "--branch") branch = args[(i += 1)];
    else if (arg === "--into") into = args[(i += 1)];
    else if (arg === "--auto-approve") autoApprove = true;
    else if (arg === "--allow-delete") allowDelete = true;
    else if (arg === "--commit") commit = true;
    else if (arg === "--json") json = true;
    else if (arg?.startsWith("--")) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--") && !valued.has(arg)) {
        rest[arg.slice(2)] = next;
        i += 1;
      } else rest[arg.slice(2)] = true;
    }
  }
  return { dir, account, autoApprove, allowDelete, commit, json, branch, into, rest };
}

function commitPulledSnapshot({
  dir,
  paths,
  message,
}: {
  readonly dir: string;
  readonly paths: readonly string[];
  readonly message: string;
}): Effect.Effect<string | null, unknown> {
  const committer = makeLocalGitCommitter({ directory: dir });
  if (!committer) {
    return Effect.fail(new Error("--commit requires --dir to be inside a git repository."));
  }
  return Effect.gen(function* () {
    const timestamp = yield* currentGitTimestamp;
    return yield* committer.commit({
      changed: [...new Set([...paths, "config.lock.json"])],
      message: buildGitCommitMessage(message, { actor: "system" }),
      author: { name: "Schematics", email: "schematics@localhost", timestamp },
    });
  });
}

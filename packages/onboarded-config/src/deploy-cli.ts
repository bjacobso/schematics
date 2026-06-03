import { hasChanges, renderPlan } from "@schema-ide/config-deploy";
import { Effect } from "effect";
import { makeOnboardedConfigDeploy } from "./deploy";
import { createFsArtifactStore } from "./fs-store";
import type { OnboardedApi } from "./mock";

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

const USAGE = `Usage: onboarded-deploy <pull|plan|apply> --dir <dir> [--auto-approve] [--allow-delete]`;

export async function runOnboardedDeployCli(
  argv: readonly string[],
  options: OnboardedDeployCliOptions = {},
): Promise<OnboardedDeployCliResult> {
  const command = argv[0];
  const flags = parseFlags(argv.slice(1));
  const dir = flags.dir;

  if (!command || !["pull", "plan", "apply"].includes(command)) {
    return { exitCode: command ? 1 : 0, stdout: command ? "" : USAGE, stderr: command ? USAGE : "" };
  }
  if (!dir) return { exitCode: 1, stdout: "", stderr: `Missing --dir\n${USAGE}` };

  const store = createFsArtifactStore(dir, { projectId: "onboarded-account-yaml" });
  const deploy = makeOnboardedConfigDeploy({ store, api: options.api });

  try {
    switch (command) {
      case "pull": {
        const result = await Effect.runPromise(deploy.pull);
        const lines = result.pulled.map((p) => `  pulled ${p.kind}  ${p.key}  (${p.path})`);
        return ok([`Pulled ${result.pulled.length} resource(s) into ${dir}`, ...lines].join("\n"));
      }
      case "plan": {
        const plan = await Effect.runPromise(deploy.plan);
        return ok(renderPlan(plan));
      }
      case "apply": {
        const plan = await Effect.runPromise(deploy.plan);
        if (!hasChanges(plan)) return ok(`${renderPlan(plan)}\n\nNothing to apply.`);
        if (!flags.autoApprove) {
          return ok(`${renderPlan(plan)}\n\nRe-run with --auto-approve to apply.`);
        }
        const result = await Effect.runPromise(
          deploy.apply(plan, { allowDelete: flags.allowDelete }),
        );
        const lines = [
          renderPlan(plan),
          "",
          `Applied ${result.applied.length}, aborted ${result.aborted.length}, skipped ${result.skipped.length}.`,
          ...result.aborted.map((a) => `  aborted ${a.change.kind} ${a.change.key} (${a.reason})`),
        ];
        return { exitCode: result.aborted.length > 0 ? 1 : 0, stdout: lines.join("\n"), stderr: "" };
      }
      default:
        return { exitCode: 1, stdout: "", stderr: USAGE };
    }
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: String(error) };
  }
}

interface Flags {
  readonly dir?: string | undefined;
  readonly autoApprove: boolean;
  readonly allowDelete: boolean;
}

function parseFlags(args: readonly string[]): Flags {
  let dir: string | undefined;
  let autoApprove = false;
  let allowDelete = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--dir") {
      dir = args[i + 1];
      i += 1;
    } else if (arg === "--auto-approve") autoApprove = true;
    else if (arg === "--allow-delete") allowDelete = true;
  }
  return { dir, autoApprove, allowDelete };
}

const ok = (stdout: string): OnboardedDeployCliResult => ({ exitCode: 0, stdout, stderr: "" });

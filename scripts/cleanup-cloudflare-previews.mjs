#!/usr/bin/env node
import { execFile } from "node:child_process";
import { parseArgs } from "node:util";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
const { values } = parseArgs({
  args,
  options: {
    days: { type: "string", default: "7" },
    "dry-run": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    stack: { type: "string", default: "schematics" },
    repo: { type: "string", default: process.env["GITHUB_REPOSITORY"] ?? "bjacobso/schematics" },
  },
});

const maxAgeDays = Number(values.days);
if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) {
  throw new Error(`--days must be a non-negative number, got ${JSON.stringify(values.days)}`);
}

const dryRun = Boolean(values["dry-run"]);
if (!dryRun && !values.yes) {
  throw new Error("Refusing to destroy deployments without --yes. Use --dry-run to preview.");
}

const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
const stages = await listAlchemyStages(String(values.stack));
const previewStages = stages
  .map((stage) => ({ stage, match: /^pr-(\d+)$/.exec(stage) }))
  .filter((entry) => entry.match !== null)
  .map(({ stage, match }) => ({ stage, pullRequest: Number(match?.[1]) }));

if (previewStages.length === 0) {
  console.log(`No PR preview stages found in stack ${values.stack}.`);
  process.exit(0);
}

let destroyed = 0;
let kept = 0;

for (const preview of previewStages) {
  const pr = await getPullRequest(String(values.repo), preview.pullRequest);
  if (!pr) {
    kept++;
    console.warn(`Keeping ${preview.stage}: unable to read PR #${preview.pullRequest}.`);
    continue;
  }

  if (pr.state !== "closed") {
    kept++;
    console.log(`Keeping ${preview.stage}: PR #${preview.pullRequest} is ${pr.state}.`);
    continue;
  }

  const closedAt = Date.parse(pr.closed_at ?? pr.updated_at ?? "");
  if (!Number.isFinite(closedAt)) {
    kept++;
    console.warn(
      `Keeping ${preview.stage}: PR #${preview.pullRequest} has no usable closed timestamp.`,
    );
    continue;
  }

  if (closedAt > cutoff) {
    kept++;
    console.log(
      `Keeping ${preview.stage}: PR #${preview.pullRequest} closed ${formatAge(closedAt)} ago.`,
    );
    continue;
  }

  const message = `${preview.stage}: PR #${preview.pullRequest} closed ${formatAge(closedAt)} ago`;
  if (dryRun) {
    kept++;
    console.log(`[dry-run] Would destroy ${message}.`);
    continue;
  }

  console.log(`Destroying ${message}.`);
  await run("pnpm", ["alchemy", "destroy", "--stage", preview.stage, "--yes"]);
  destroyed++;
}

console.log(
  `Cloudflare preview cleanup complete: ${destroyed} destroyed, ${kept} kept, ${previewStages.length} checked.`,
);

async function listAlchemyStages(stack) {
  const { stdout } = await run("pnpm", ["alchemy", "state", "stages", stack]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("("));
}

async function getPullRequest(repo, number) {
  try {
    const { stdout } = await run("gh", [
      "api",
      `repos/${repo}/pulls/${number}`,
      "--jq",
      "{number, state, closed_at, updated_at}",
    ]);
    return JSON.parse(stdout);
  } catch (error) {
    if (error && typeof error === "object" && "stderr" in error) {
      console.warn(String(error.stderr).trim());
    }
    return undefined;
  }
}

async function run(command, args) {
  return execFileAsync(command, args, {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function formatAge(timestamp) {
  const days = Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000));
  return `${days} day${days === 1 ? "" : "s"}`;
}

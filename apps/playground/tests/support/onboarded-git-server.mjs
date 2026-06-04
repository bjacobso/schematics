import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const playgroundRoot = process.cwd();
const repoRoot = resolve(playgroundRoot, "../..");
const workspaceDir = resolve(repoRoot, "tmp/onboarded-git-workspace");
const manifestPath = resolve(repoRoot, "tmp/onboarded-git-workspace.json");

await rm(workspaceDir, { recursive: true, force: true });
await mkdir(workspaceDir, { recursive: true });
await mkdir(dirname(manifestPath), { recursive: true });

run("git", ["init", "--initial-branch=main"], { cwd: workspaceDir });
run("git", ["config", "user.name", "Schematics E2E"], { cwd: workspaceDir });
run("git", ["config", "user.email", "schematics-e2e@localhost"], { cwd: workspaceDir });
run(
  "node",
  [
    resolve(repoRoot, "examples/onboarded/dist/deploy-cli-bin.js"),
    "pull",
    "--dir",
    workspaceDir,
    "--account",
    "mina",
    "--commit",
  ],
  { cwd: repoRoot },
);

await writeFile(manifestPath, `${JSON.stringify({ workspaceDir, port: 4320 }, null, 2)}\n`);

const server = spawn(
  "node",
  [
    resolve(repoRoot, "examples/onboarded/dist/cli.js"),
    "web",
    "--dir",
    workspaceDir,
    "--port",
    "4320",
    "--static-dir",
    resolve(playgroundRoot, "dist"),
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, SCHEMATICS_E2E_SCRIPTED_AGENT: "1" },
  },
);

const shutdown = () => {
  server.kill("SIGTERM");
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await new Promise((resolveProcess, reject) => {
  server.once("exit", (code, signal) => {
    if (signal === "SIGTERM" || signal === "SIGINT" || code === 0) resolveProcess(undefined);
    else reject(new Error(`onboarded-config server exited with code ${code ?? signal}`));
  });
});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status === 0) return;
  throw new Error(
    [`Command failed: ${command} ${args.join(" ")}`, result.stdout.trim(), result.stderr.trim()]
      .filter(Boolean)
      .join("\n"),
  );
}

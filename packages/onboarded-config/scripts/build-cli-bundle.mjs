#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = resolve(dirname(scriptPath), "..");
const repoRoot = resolve(packageRoot, "../..");
const playgroundDist = join(repoRoot, "apps/playground/dist");
const defaultBuildRoot = join(packageRoot, "dist/sea/.build/onboarded-config");
const defaultOutputPath = join(packageRoot, "dist/sea/onboarded-config");
const defaultBundlePath = join(packageRoot, "dist/bundle/onboarded-config.cjs");

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(helpText());
    return;
  }

  await assertPlaygroundDist();

  const buildRoot = resolveCliPath(options.buildDir, defaultBuildRoot);
  const bundlePath = resolveCliPath(options.bundleOut, defaultBundlePath);
  const outputPath = resolveOutputPath(options.out, options.name);
  const entryPath = join(buildRoot, "entry.ts");
  const assetsPath = join(buildRoot, "playground-assets.ts");
  const seaConfigPath = join(buildRoot, "sea-config.json");

  if (options.clean) {
    await rm(buildRoot, { recursive: true, force: true });
  }

  await mkdir(buildRoot, { recursive: true });
  await mkdir(dirname(bundlePath), { recursive: true });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(assetsPath, await renderPlaygroundAssets());
  await writeFile(entryPath, renderEntry({ cliName: options.name, entryPath, assetsPath }));

  await run(
    "pnpm",
    [
      "--dir",
      packageRoot,
      "exec",
      "esbuild",
      entryPath,
      "--bundle",
      "--platform=node",
      "--target=node20",
      "--format=cjs",
      `--outfile=${bundlePath}`,
      "--log-level=warning",
      "--log-override:empty-import-meta=silent",
      "--log-override:require-resolve-not-external=silent",
    ],
    { cwd: repoRoot },
  );

  await writeFile(
    seaConfigPath,
    `${JSON.stringify(
      {
        main: bundlePath,
        mainFormat: "commonjs",
        executable: options.node,
        output: outputPath,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
      },
      null,
      2,
    )}\n`,
  );

  if (!options.bundleOnly) {
    assertBuildSeaSupport();
    await removeStaleDirectoryOutput(outputPath);
    await run(options.node, ["--build-sea", seaConfigPath], { cwd: repoRoot });
    await chmod(outputPath, 0o755);
    if (options.sign) {
      await run("codesign", ["--sign", "-", outputPath], { cwd: repoRoot });
    }
  }

  if (!options.keepBuildDir && !options.bundleOnly) {
    await rm(buildRoot, { recursive: true, force: true });
  }

  process.stdout.write(
    [
      `Onboarded CLI bundle: ${relative(repoRoot, bundlePath)}`,
      `SEA config: ${relative(repoRoot, seaConfigPath)}`,
      options.bundleOnly
        ? "Skipped binary generation because --bundle-only was set."
        : `SEA binary: ${relative(repoRoot, outputPath)}`,
      "",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = {
    name: "onboarded-config",
    out: null,
    bundleOut: null,
    buildDir: null,
    node: process.execPath,
    clean: true,
    keepBuildDir: false,
    bundleOnly: false,
    sign: process.platform === "darwin",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--bundle-only") {
      options.bundleOnly = true;
      continue;
    }

    if (arg === "--keep-build-dir") {
      options.keepBuildDir = true;
      continue;
    }

    if (arg === "--no-clean") {
      options.clean = false;
      continue;
    }

    if (arg === "--no-sign") {
      options.sign = false;
      continue;
    }

    if (arg === "--name") {
      options.name = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--out") {
      options.out = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--bundle-out") {
      options.bundleOut = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--build-dir") {
      options.buildDir = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--node") {
      options.node = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function requireValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

async function assertPlaygroundDist() {
  try {
    const index = await stat(join(playgroundDist, "index.html"));
    if (index.isFile()) return;
  } catch {
    // Report the actionable error below.
  }

  throw new Error("Missing apps/playground/dist/index.html. Run pnpm playground:build first.");
}

async function renderPlaygroundAssets() {
  const files = await readAssetFiles(playgroundDist);
  const entries = await Promise.all(
    files.map(async (file) => {
      const content = await readFile(join(playgroundDist, file));
      return [file, content.toString("base64")];
    }),
  );

  entries.sort(([left], [right]) => left.localeCompare(right));

  return `export const playgroundAssets = ${JSON.stringify(Object.fromEntries(entries), null, 2)};\n`;
}

async function readAssetFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return readAssetFiles(root, path);
      if (!entry.isFile()) return [];
      return [relative(root, path).split(sep).join("/")];
    }),
  );
  return files.flat();
}

function renderEntry({ cliName, entryPath, assetsPath }) {
  const cliImport = toImportSpecifier(
    relative(dirname(entryPath), join(repoRoot, "packages/cli/src/index.ts")),
  );
  const workspaceImport = toImportSpecifier(
    relative(dirname(entryPath), join(packageRoot, "src/workspace-config.ts")),
  );
  const assetsImport = toImportSpecifier(relative(dirname(entryPath), assetsPath));

  return `#!/usr/bin/env node
import { createEmbeddedSchemaIdeCli } from "${cliImport}";
import { OnboardedConfigProject } from "${workspaceImport}";
import { playgroundAssets } from "${assetsImport}";

void createEmbeddedSchemaIdeCli({
  name: ${JSON.stringify(cliName)},
  project: OnboardedConfigProject,
  staticAssets: playgroundAssets,
}).main();
`;
}

function resolveOutputPath(out, cliName) {
  const output = resolveCliPath(out, defaultOutputPath);
  if (process.platform === "win32" && extname(output) !== ".exe") {
    return `${output}.exe`;
  }
  return output;
}

function resolveCliPath(path, fallback) {
  if (!path) return fallback;
  if (path.startsWith("packages/") || path.startsWith(`packages${sep}`)) {
    return resolve(repoRoot, path);
  }
  return resolve(path);
}

async function removeStaleDirectoryOutput(outputPath) {
  try {
    const output = await stat(outputPath);
    if (!output.isDirectory()) return;
  } catch {
    return;
  }

  if (outputPath !== defaultOutputPath) {
    throw new Error(
      `SEA output path is a directory: ${relative(repoRoot, outputPath)}. Pass a file path to --out.`,
    );
  }

  await rm(outputPath, { recursive: true, force: true });
}

function binaryName(cliName) {
  const base = basename(cliName).replace(/[^a-zA-Z0-9._-]/g, "-");
  return process.platform === "win32" ? `${base}.exe` : base;
}

function toImportSpecifier(path) {
  const normalized = path.split(sep).join("/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function assertBuildSeaSupport() {
  const [major = 0, minor = 0] = process.versions.node.split(".").map((part) => Number(part));
  if (major > 25 || (major === 25 && minor >= 5)) return;

  throw new Error(
    `Node ${process.versions.node} does not support --build-sea. Use Node 25.5.0 or newer, or run with --bundle-only to produce the bundled CLI and SEA config.`,
  );
}

async function run(command, args, options) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(
        new Error(`${command} ${args.join(" ")} failed with ${signal ?? `exit code ${code}`}`),
      );
    });
  });
}

function helpText() {
  return `Build the Onboarded workspace into a bundled CLI and Node SEA binary.

Usage:
  pnpm --dir packages/onboarded-config build:sea [options]

Options:
  --name <name>         CLI/binary command name. Defaults to onboarded-config.
  --out <path>          Binary output file. Defaults to dist/sea/onboarded-config.
  --bundle-out <path>   Bundled JS output path. Defaults to dist/bundle/onboarded-config.cjs.
  --build-dir <path>    Temporary build directory. Defaults to dist/sea/.build/onboarded-config.
  --node <path>         Node executable used for --build-sea. Defaults to current node.
  --bundle-only         Generate the bundled JS and SEA config without creating the binary.
  --keep-build-dir      Keep intermediate files after binary generation.
  --no-clean            Reuse the existing build directory.
  --no-sign             Skip ad-hoc codesigning on macOS.
  -h, --help            Show this help.

Examples:
  pnpm turbo run build:bundle --filter @schema-ide/onboarded-config
  pnpm turbo run build:sea --filter @schema-ide/onboarded-config -- --out dist/sea/onboarded-config
`;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

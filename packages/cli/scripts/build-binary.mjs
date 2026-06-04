#!/usr/bin/env node
// Build a consumer's Schematics project into a bundled CLI and a Node SEA binary.
//
// This is the framework-provided, monorepo-agnostic successor to the per-example
// build-cli-bundle.mjs. It makes no assumptions about repo layout and treats the
// web UI as opt-in: with no --assets-dir the binary ships validate/deploy/plan/
// apply only (zero UI). Pass --assets-dir <dist> to embed a consumer-built
// frontend (see docs/consuming-schematics.md).
import { spawn } from "node:child_process";
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(helpText());
    return;
  }

  if (!options.project) {
    throw new Error("Missing required --project <module>. See --help.");
  }

  const projectRoot = resolve(options.cwd ?? process.cwd());
  const buildRoot = resolveFrom(projectRoot, options.buildDir, "dist/sea/.build");
  const bundlePath = resolveFrom(projectRoot, options.bundleOut, `dist/bundle/${options.name}.cjs`);
  const outputPath = resolveOutputPath(projectRoot, options.out, options.name);
  const entryPath = join(buildRoot, "entry.ts");
  const seaConfigPath = join(buildRoot, "sea-config.json");

  if (options.clean) {
    await rm(buildRoot, { recursive: true, force: true });
  }

  await mkdir(buildRoot, { recursive: true });
  await mkdir(dirname(bundlePath), { recursive: true });
  await mkdir(dirname(outputPath), { recursive: true });

  let assetsImport = null;
  if (options.assetsDir) {
    const assetsDir = resolve(projectRoot, options.assetsDir);
    await assertAssetsDir(assetsDir);
    const assetsPath = join(buildRoot, "embedded-assets.ts");
    await writeFile(assetsPath, await renderAssets(assetsDir));
    assetsImport = toImportSpecifier(relative(dirname(entryPath), assetsPath));
  }

  await writeFile(
    entryPath,
    renderEntry({
      cliName: options.name,
      cliEntry: resolveSpecifier(dirname(entryPath), options.cliEntry),
      projectEntry: resolveSpecifier(dirname(entryPath), resolve(projectRoot, options.project)),
      projectExport: options.projectExport,
      assetsImport,
    }),
  );

  await run(
    "pnpm",
    [
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
    { cwd: projectRoot },
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
    await run(options.node, ["--build-sea", seaConfigPath], { cwd: projectRoot });
    await chmod(outputPath, 0o755);
    if (options.sign) {
      await run("codesign", ["--sign", "-", outputPath], { cwd: projectRoot });
    }
  }

  if (!options.keepBuildDir && !options.bundleOnly) {
    await rm(buildRoot, { recursive: true, force: true });
  }

  process.stdout.write(
    [
      `CLI bundle: ${relative(projectRoot, bundlePath)}`,
      assetsImport ? "Embedded web UI assets: yes" : "Embedded web UI assets: no (CLI-only binary)",
      `SEA config: ${relative(projectRoot, seaConfigPath)}`,
      options.bundleOnly
        ? "Skipped binary generation because --bundle-only was set."
        : `SEA binary: ${relative(projectRoot, outputPath)}`,
      "",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = {
    name: "schematics",
    project: null,
    projectExport: "default",
    cliEntry: "@schematics/cli",
    assetsDir: null,
    cwd: null,
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

    if (arg === "--") continue;

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

    const flags = {
      "--name": "name",
      "--project": "project",
      "--project-export": "projectExport",
      "--cli-entry": "cliEntry",
      "--assets-dir": "assetsDir",
      "--cwd": "cwd",
      "--out": "out",
      "--bundle-out": "bundleOut",
      "--build-dir": "buildDir",
      "--node": "node",
    };
    const key = flags[arg];
    if (key) {
      options[key] = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function requireValue(argv, index, name) {
  const value = argv[index + 1];
  if (value === undefined || (value.startsWith("-") && value !== "-")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

async function assertAssetsDir(assetsDir) {
  try {
    const index = await stat(join(assetsDir, "index.html"));
    if (index.isFile()) return;
  } catch {
    // fall through to the actionable error
  }
  throw new Error(`--assets-dir ${assetsDir} has no index.html. Build your frontend first.`);
}

async function renderAssets(assetsDir) {
  const files = await readAssetFiles(assetsDir);
  const entries = await Promise.all(
    files.map(async (file) => {
      const content = await readFile(join(assetsDir, file));
      return [file, content.toString("base64")];
    }),
  );
  entries.sort(([left], [right]) => left.localeCompare(right));
  return `export const embeddedAssets = ${JSON.stringify(Object.fromEntries(entries), null, 2)};\n`;
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

function renderEntry({ cliName, cliEntry, projectEntry, projectExport, assetsImport }) {
  const projectBinding =
    projectExport === "default"
      ? `import project from "${projectEntry}";`
      : `import { ${projectExport} as project } from "${projectEntry}";`;
  const assetsBinding = assetsImport ? `import { embeddedAssets } from "${assetsImport}";` : "";
  const staticAssetsField = assetsImport ? "\n  staticAssets: embeddedAssets," : "";

  return `#!/usr/bin/env node
import { createEmbeddedSchematicsCli } from "${cliEntry}";
${projectBinding}
${assetsBinding}
void createEmbeddedSchematicsCli({
  name: ${JSON.stringify(cliName)},
  project,${staticAssetsField}
}).main();
`;
}

function resolveOutputPath(projectRoot, out, cliName) {
  const output = resolveFrom(projectRoot, out, `dist/sea/${cliName}`);
  if (process.platform === "win32" && extname(output) !== ".exe") {
    return `${output}.exe`;
  }
  return output;
}

function resolveFrom(projectRoot, path, fallback) {
  if (!path) return resolve(projectRoot, fallback);
  return isAbsolute(path) ? path : resolve(projectRoot, path);
}

// A bare package specifier (e.g. "@schematics/cli") is passed through; a path is
// rewritten relative to the generated entry so esbuild resolves it correctly.
function resolveSpecifier(entryDir, specifier) {
  const looksLikePath =
    isAbsolute(specifier) || specifier.startsWith(".") || /\.(c|m)?[jt]sx?$/.test(specifier);
  if (!looksLikePath) return specifier;
  return toImportSpecifier(relative(entryDir, resolve(specifier)));
}

async function removeStaleDirectoryOutput(outputPath) {
  try {
    const output = await stat(outputPath);
    if (!output.isDirectory()) return;
  } catch {
    return;
  }
  await rm(outputPath, { recursive: true, force: true });
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
  return `Build a Schematics consumer project into a bundled CLI and Node SEA binary.

Usage:
  schematics-build-binary --project <module> [options]

Required:
  --project <module>      Path to the module exporting your defineSchematicsProject() config.

Options:
  --project-export <name> Named export to use from --project. Defaults to "default".
  --name <name>           CLI/binary command name. Defaults to schematics.
  --assets-dir <dir>      Embed a built web UI (must contain index.html). Omit for a CLI-only binary.
  --cli-entry <spec>      Module that exports createEmbeddedSchematicsCli. Defaults to @schematics/cli.
                          Pass a path (e.g. .context/schematics/packages/cli/src/index.ts) to bundle from source.
  --cwd <dir>             Project root. Defaults to the current directory.
  --out <path>            Binary output file. Defaults to dist/sea/<name>.
  --bundle-out <path>     Bundled JS output path. Defaults to dist/bundle/<name>.cjs.
  --build-dir <path>      Temporary build directory. Defaults to dist/sea/.build.
  --node <path>           Node executable used for --build-sea. Defaults to current node.
  --bundle-only           Generate the bundled JS and SEA config without creating the binary.
  --keep-build-dir        Keep intermediate files after binary generation.
  --no-clean              Reuse the existing build directory.
  --no-sign               Skip ad-hoc codesigning on macOS.
  -h, --help              Show this help.

Examples:
  # CLI-only binary (validate / deploy)
  schematics-build-binary --project ./src/workspace-config.ts --project-export MyProject --name my-config

  # Binary with an embedded frontend built from @schematics/ide
  schematics-build-binary --project ./src/workspace-config.ts --project-export MyProject \\
    --name my-config --assets-dir ./web/dist
`;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

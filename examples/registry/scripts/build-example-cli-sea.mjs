#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = resolve(dirname(scriptPath), "..");
const repoRoot = resolve(packageRoot, "../..");
const defaultBuildRoot = join(packageRoot, "dist/sea");
const exampleDirectories = [
  join(repoRoot, "examples/catalog/projects/nyc-public-library"),
  join(repoRoot, "examples/toy/projects/valid"),
  join(repoRoot, "examples/toy/projects/broken-refs"),
  join(repoRoot, "examples/toy/projects/duplicate-ids"),
];

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(helpText());
    return;
  }

  const examples = await readExamples();

  if (options.list) {
    process.stdout.write(`${examples.map((example) => example.id).join("\n")}\n`);
    return;
  }

  const example = examples.find((candidate) => candidate.id === options.example);
  if (!example) {
    throw new Error(
      `Unknown example "${options.example}". Available examples: ${examples
        .map((candidate) => candidate.id)
        .join(", ")}`,
    );
  }

  const cliName = options.name ?? example.id;
  const outputPath = resolveOutputPath(options.out, cliName);
  const buildRoot = resolve(options.buildDir ?? join(defaultBuildRoot, example.id));
  const bundleDir = join(buildRoot, "bundle");
  const entryPath = join(buildRoot, "entry.ts");
  const bundlePath = join(bundleDir, "entry.cjs");
  const seaConfigPath = join(buildRoot, "sea-config.json");

  if (options.clean) {
    await rm(buildRoot, { recursive: true, force: true });
  }

  await mkdir(bundleDir, { recursive: true });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(entryPath, renderEntry({ cliName, example, entryPath }));

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
    await run(options.node, ["--build-sea", seaConfigPath], { cwd: repoRoot });
    if (options.sign) {
      await run("codesign", ["--sign", "-", outputPath], { cwd: repoRoot });
    }
  }

  if (!options.keepBuildDir && !options.bundleOnly) {
    await rm(buildRoot, { recursive: true, force: true });
  }

  process.stdout.write(
    [
      `Example CLI bundle: ${relative(repoRoot, bundlePath)}`,
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
    example: "workflow-json",
    name: null,
    out: null,
    buildDir: null,
    node: process.execPath,
    clean: true,
    keepBuildDir: false,
    bundleOnly: false,
    sign: process.platform === "darwin",
    list: false,
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

    if (arg === "--list") {
      options.list = true;
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

    if (arg === "--example") {
      options.example = requireValue(argv, index, arg);
      index += 1;
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

async function readExamples() {
  const examples = await Promise.all(
    exampleDirectories.map(async (exampleDirectory) => {
      const example = JSON.parse(await readFile(join(exampleDirectory, "example.json"), "utf8"));
      return {
        ...example,
        directory: relative(repoRoot, exampleDirectory).split(sep).join("/"),
      };
    }),
  );

  return examples.sort((left, right) => left.id.localeCompare(right.id));
}

function resolveOutputPath(out, cliName) {
  const output = resolve(out ?? join(defaultBuildRoot, binaryName(cliName)));
  if (process.platform === "win32" && extname(output) !== ".exe") {
    return `${output}.exe`;
  }
  return output;
}

function binaryName(cliName) {
  const base = basename(cliName).replace(/[^a-zA-Z0-9._-]/g, "-");
  return process.platform === "win32" ? `${base}.exe` : base;
}

function renderEntry({ cliName, example, entryPath }) {
  const cliImport = toImportSpecifier(
    relative(dirname(entryPath), join(repoRoot, "packages/cli/src/index.ts")),
  );
  const schemaImport = toImportSpecifier(
    relative(dirname(entryPath), join(packageRoot, "src/schemas.ts")),
  );
  const include = includeForFormat(example.defaultFormat);

  return `#!/usr/bin/env node
import { createEmbeddedSchematicsCli } from "${cliImport}";
import { ${example.schema} } from "${schemaImport}";

const project = {
  id: ${JSON.stringify(example.id)},
  schema: ${example.schema},
  defaultFormat: ${JSON.stringify(example.defaultFormat)},
  include: ${JSON.stringify(include)},
};

void createEmbeddedSchematicsCli({
  name: ${JSON.stringify(cliName)},
  project,
}).main();
`;
}

function includeForFormat(format) {
  if (format === "json") return ["**/*.json"];
  if (format === "yaml") return ["**/*.yaml", "**/*.yml"];
  return ["**/*.json", "**/*.yaml", "**/*.yml"];
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
  return `Build an example workspace schema into a bundled CLI and Node SEA binary.

Usage:
  pnpm --dir examples/registry build:sea [options]

Options:
  --example <id>        Example workspace id. Defaults to workflow-json.
  --name <name>         CLI/binary command name. Defaults to the example id.
  --out <path>          Binary output path. Defaults to dist/sea/<name>.
  --build-dir <path>    Temporary build directory. Defaults to dist/sea/<example>.
  --node <path>         Node executable used for --build-sea. Defaults to current node.
  --bundle-only         Generate the bundled JS and SEA config without creating the binary.
  --keep-build-dir      Keep intermediate files after binary generation.
  --no-clean            Reuse the existing build directory.
  --no-sign             Skip ad-hoc codesigning on macOS.
  --list                Print available example ids.
  -h, --help            Show this help.

Examples:
  pnpm --dir examples/registry build:sea -- --example workflow-json --name workflow
  pnpm --dir examples/registry build:sea -- --example survey-yaml --bundle-only
`;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

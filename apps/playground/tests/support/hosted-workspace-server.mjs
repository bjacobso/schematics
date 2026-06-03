import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ArtifactRef } from "@schematics/artifacts";
import { createSchematicsArtifactRuntime } from "@schematics/core";
import { schematicsExamples } from "@schematics/examples";
import { SchematicsArtifactProjectError } from "@schematics/protocol";
import { makeSchematicsWebHandler } from "@schematics/server";
import { Effect, Stream } from "effect";

const execFileAsync = promisify(execFile);
const port = Number(process.env["PORT"] ?? 4317);
const apiPrefix = "/__schematics_e2e__";
const workspacePrefix = `${apiPrefix}/v1/workspaces`;
const root = await mkdtemp(join(tmpdir(), "schematics-hosted-e2e-"));
const gitRoot = join(root, "git");
const workspaces = new Map();

await mkdir(gitRoot, { recursive: true });

const server = createServer((request, response) => {
  handle(request).then(
    (handled) => writeWebResponse(response, handled),
    (error) =>
      writeWebResponse(
        response,
        Response.json(
          { error: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        ),
      ),
  );
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Hosted workspace e2e server listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => {
      rm(root, { recursive: true, force: true }).finally(() => process.exit(0));
    });
  });
}

async function handle(request) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `127.0.0.1:${port}`}`);
  if (url.pathname === `${apiPrefix}/health`) {
    return cors(Response.json({ ok: true }));
  }
  if (!url.pathname.startsWith(workspacePrefix)) {
    return cors(Response.json({ error: "Not found" }, { status: 404 }));
  }
  if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

  if (url.pathname === workspacePrefix && request.method === "POST") {
    return createWorkspace(request, url);
  }

  const rest = url.pathname.slice(`${workspacePrefix}/`.length);
  const match = /^([^/]+)(?:\/(rpc|git)(\/.*)?)?$/.exec(rest);
  if (!match) return cors(Response.json({ error: "Not found" }, { status: 404 }));
  const id = match[1];
  const workspace = workspaces.get(id);
  if (!workspace) return cors(Response.json({ error: "Workspace not found" }, { status: 404 }));
  const route = match[2] ?? "";
  const suffix = match[3] ?? "";

  if (route === "git") return handleGitRequest(workspace, request, suffix, url);
  if (route === "rpc") return proxyWorkspaceRpc(workspace, request);
  if (request.method === "GET") {
    return cors(
      Response.json({
        workspaceId: id,
        templateId: workspace.templateId,
        title: workspace.example.name,
        git: gitInfo(url, id),
      }),
    );
  }
  return cors(Response.json({ error: "Method not allowed" }, { status: 405 }));
}

async function createWorkspace(request, url) {
  const body = await readJson(request);
  const templateId =
    typeof body.templateId === "string" ? body.templateId : "onboarded-account-yaml";
  const example =
    schematicsExamples.find((candidate) => candidate.id === templateId) ??
    schematicsExamples.find((candidate) => candidate.id === "onboarded-account-yaml") ??
    schematicsExamples[0];
  if (!example) return cors(Response.json({ error: "No examples available" }, { status: 500 }));

  const id = crypto.randomUUID();
  const repoPath = join(gitRoot, `${id}.git`);
  await execFileAsync("git", ["init", "--bare", "--initial-branch=main", repoPath]);
  await execFileAsync("git", ["--git-dir", repoPath, "config", "http.receivepack", "true"]);

  const artifactProject = createHostedArtifactProjectService(example);
  const handler = makeSchematicsWebHandler({ artifactProject });
  workspaces.set(id, { id, templateId: example.id, example, handler, repoPath });

  return cors(
    Response.json(
      {
        workspaceId: id,
        url: `/w/${id}`,
        git: gitInfo(url, id),
      },
      { status: 201 },
    ),
  );
}

async function proxyWorkspaceRpc(workspace, request) {
  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await requestBody(request);
  const headers = new Headers(request.headers);
  const target = new URL("http://schematics.local/v1/artifact-project/rpc");
  const response = await workspace.handler.handler(
    new Request(target, {
      method: request.method,
      headers,
      body,
    }),
  );
  return cors(response);
}

async function handleGitRequest(workspace, request, suffix, url) {
  const pathInfo = `/${workspace.id}.git${suffix}`;
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? null
      : Buffer.from(await requestBody(request));
  const headers = await gitHttpBackend({
    gitRoot,
    pathInfo,
    method: request.method ?? "GET",
    query: url.search ? url.search.slice(1) : "",
    contentType: request.headers["content-type"],
    body,
  });
  return cors(new Response(headers.body, { status: headers.status, headers: headers.headers }));
}

function gitInfo(url, id) {
  return {
    remote: new URL(`${workspacePrefix}/${id}/git`, url).toString(),
    defaultBranch: "main",
  };
}

function createHostedArtifactProjectService(example) {
  const projectId = example.project?.name;
  const defaultFormat = example.defaultFormat ?? "yaml";
  let files = [...example.files].sort((left, right) => left.path.localeCompare(right.path));
  let revision = 0;

  const runtime = (requestFiles = files, activeFile = files[0]?.path ?? null) =>
    createSchematicsArtifactRuntime({
      project: example.project,
      files: requestFiles,
      activeFile,
      activeFormat: defaultFormat,
      projectId,
    });

  const snapshot = Effect.sync(() => ({ revision, files }));
  const capabilities = {
    mode: "remote",
    project: { id: projectId, title: example.name, readOnly: false },
    agent: { enabled: false, reason: "Hosted e2e server does not run chat." },
    features: {
      watch: true,
      write: true,
      rename: true,
      delete: true,
      history: true,
      previews: true,
    },
  };

  return {
    getCapabilities: Effect.succeed(capabilities),
    getSnapshot: snapshot,
    watchArtifactProject: Stream.fromIterable([
      { type: "capabilities", capabilities },
      { type: "snapshot", snapshot: { revision, files } },
    ]),
    getHistory: Effect.fail(
      new SchematicsArtifactProjectError(
        "Hosted e2e history is provided by browser git.",
        "unsupported",
      ),
    ),
    applyChange: (change) =>
      Effect.gen(function* () {
        const before = files;
        files = applyProjectChange(files, change);
        revision += 1;
        return {
          revision,
          changedPaths: changedPaths(before, files),
          validationSummary: yield* validationSummary(runtime(), projectId),
        };
      }),
    previewFiles: (request) =>
      runtime(request.files, request.activeFile ?? null)
        .preview(request.files, request.activeFile ?? null)
        .pipe(
          Effect.map((reflection) => ({ reflection })),
          Effect.mapError(toProjectError),
        ),
    listArtifactRefs: Effect.sync(() => ({
      artifacts: [
        ArtifactRef.project(projectId),
        ...files.map((file) => ArtifactRef.projectFile(file.path, projectId)),
      ],
      count: files.length + 1,
    })),
    getArtifactCapabilities: () =>
      Effect.succeed({
        capabilities: [],
      }),
    readArtifactView: (request) =>
      runtime()
        .view(request.ref, request.view)
        .pipe(
          Effect.map((value) => ({ ref: request.ref, view: request.view, value })),
          Effect.mapError(toProjectError),
        ),
    applyArtifactChange: (change) =>
      Effect.gen(function* () {
        const path =
          change.ref?._tag === "ProjectFile" || change.ref?._tag === "Path"
            ? change.ref.path
            : null;
        if (!path) {
          return yield* Effect.fail(
            new SchematicsArtifactProjectError("Unsupported artifact ref.", "unsupported"),
          );
        }
        const before = files;
        files = upsertFile(files, { path, content: String(change.content ?? "") });
        revision += 1;
        return {
          revision,
          changedPaths: changedPaths(before, files),
          validationSummary: yield* validationSummary(runtime(), projectId),
        };
      }),
  };
}

function applyProjectChange(files, change) {
  switch (change.type) {
    case "writeFile":
    case "createFile":
      return upsertFile(files, { path: change.path, content: change.content });
    case "deleteFile":
      return files.filter((file) => file.path !== change.path);
    case "renameFile": {
      const renamed = files.map((file) =>
        file.path === change.fromPath ? { ...file, path: change.toPath } : file,
      );
      return renamed.sort((left, right) => left.path.localeCompare(right.path));
    }
    case "replaceFiles":
      return [...change.files].sort((left, right) => left.path.localeCompare(right.path));
  }
}

function upsertFile(files, next) {
  const without = files.filter((file) => file.path !== next.path);
  return [...without, next].sort((left, right) => left.path.localeCompare(right.path));
}

function changedPaths(before, after) {
  const beforePaths = new Set(before.map((file) => file.path));
  const afterPaths = new Set(after.map((file) => file.path));
  return [...new Set([...beforePaths, ...afterPaths])].sort();
}

function validationSummary(artifacts, projectId) {
  return artifacts.view(ArtifactRef.project(projectId), "validationSummary").pipe(
    Effect.mapError(toProjectError),
    Effect.map((value) =>
      isValidationSummary(value)
        ? value
        : { valid: false, errorCount: 1, warningCount: 0, infoCount: 0 },
    ),
  );
}

function isValidationSummary(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.valid === "boolean" &&
    typeof value.errorCount === "number" &&
    typeof value.warningCount === "number" &&
    typeof value.infoCount === "number"
  );
}

function toProjectError(error) {
  if (error instanceof SchematicsArtifactProjectError) return error;
  return new SchematicsArtifactProjectError(
    error instanceof Error ? error.message : String(error),
    "storage",
  );
}

async function gitHttpBackend({ gitRoot, pathInfo, method, query, contentType, body }) {
  const child = spawn("git", ["http-backend"], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: gitRoot,
      GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: pathInfo,
      REQUEST_METHOD: method,
      QUERY_STRING: query,
      CONTENT_TYPE: contentType ?? "",
      CONTENT_LENGTH: body ? String(body.length) : "0",
      REMOTE_USER: "e2e",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (body) child.stdin.end(body);
  else child.stdin.end();

  const [stdout, stderr, code] = await Promise.all([
    collect(child.stdout),
    collect(child.stderr),
    new Promise((resolve) => child.on("close", resolve)),
  ]);
  if (code !== 0) {
    return {
      status: 500,
      headers: new Headers({ "content-type": "text/plain; charset=utf-8" }),
      body: stderr.length ? stderr : Buffer.from("git http-backend failed"),
    };
  }
  return parseCgiResponse(stdout);
}

function parseCgiResponse(buffer) {
  const separator = buffer.indexOf("\r\n\r\n");
  const headerEnd = separator >= 0 ? separator : buffer.indexOf("\n\n");
  const splitLength = separator >= 0 ? 4 : 2;
  const headerText = headerEnd >= 0 ? buffer.slice(0, headerEnd).toString("utf8") : "";
  const body = headerEnd >= 0 ? buffer.slice(headerEnd + splitLength) : buffer;
  const headers = new Headers();
  let status = 200;
  for (const line of headerText.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const name = line.slice(0, index);
    const value = line.slice(index + 1).trim();
    if (name.toLowerCase() === "status") status = Number(value.split(/\s+/, 1)[0]) || status;
    else headers.append(name, value);
  }
  return { status, headers, body };
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function readJson(request) {
  try {
    const body = await requestBody(request);
    return body.length ? JSON.parse(body.toString("utf8")) : {};
  } catch {
    return {};
  }
}

function collect(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function cors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Accept, Content-Type, Git-Protocol");
  headers.set("Access-Control-Expose-Headers", "content-type");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function writeWebResponse(response, webResponse) {
  response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()));
  if (!webResponse.body) {
    response.end();
    return;
  }
  webResponse.arrayBuffer().then((body) => response.end(Buffer.from(body)));
}

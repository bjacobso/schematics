import type { CloudflareArtifactsBinding } from "@schematics/git-artifacts";
import { provisionWorkspaceRepo, type WorkspaceGitInfo } from "./git-repos.ts";

export interface SchematicsCloudflareWorkerEnv {
  readonly SCHEMATICS_WORKSPACES?: DurableObjectNamespaceBinding | undefined;
  /**
   * Cloudflare Artifacts (Git) namespace binding. When present, workspaces are
   * mirrored to a per-workspace Git repo (durable, cloneable history). Optional
   * so deployments without the Artifacts beta keep working on Durable Objects.
   */
  readonly SCHEMATICS_ARTIFACTS?: CloudflareArtifactsBinding | undefined;
}

export interface DurableObjectNamespaceBinding {
  idFromName(name: string): DurableObjectIdBinding;
  get(id: DurableObjectIdBinding): DurableObjectStubBinding;
}

export interface DurableObjectIdBinding {}

export interface DurableObjectStubBinding {
  fetch(request: Request): Promise<Response>;
}

export interface HostedWorkspaceCreateResponse {
  readonly workspaceId: string;
  readonly url: string;
  /**
   * Present when the `SCHEMATICS_ARTIFACTS` binding is configured: a worker
   * Git smart-HTTP proxy remote for the workspace repo. The worker injects
   * short-lived Artifacts credentials server-side; tokens are not returned to
   * the browser.
   */
  readonly git?: WorkspaceGitInfo | undefined;
}

export interface HostedWorkspaceRouterOptions {
  readonly workspaceRoutePrefix?: string | undefined;
  readonly rpcPath?: string | undefined;
  readonly workspaceBindingName?: keyof SchematicsCloudflareWorkerEnv | string | undefined;
}

const defaultWorkspaceRoutePrefix = "/v1/workspaces";
const defaultRpcPath = "/v1/artifact-project/rpc";
const defaultWorkspaceBindingName = "SCHEMATICS_WORKSPACES";

export async function handleHostedWorkspaceRequest<Env extends SchematicsCloudflareWorkerEnv>(
  request: Request,
  env: Env,
  options: HostedWorkspaceRouterOptions = {},
): Promise<Response | null> {
  const workspaceRoutePrefix = normalizeRoutePrefix(
    options.workspaceRoutePrefix ?? defaultWorkspaceRoutePrefix,
  );
  const url = new URL(request.url);
  const pathname = normalizeRoutePath(url.pathname);
  if (!isHostedWorkspaceRoute(pathname, workspaceRoutePrefix)) return null;

  if (request.method === "OPTIONS") {
    return withWorkspaceCors(new Response(null, { status: 204 }));
  }

  if (pathname === workspaceRoutePrefix && request.method === "POST") {
    return createHostedWorkspace(request, env, options, workspaceRoutePrefix);
  }

  const workspacePath = pathname.slice(`${workspaceRoutePrefix}/`.length);
  const match = /^([^/]+)(?:\/(rpc|git)(\/.*)?)?$/.exec(workspacePath);
  if (!match) return withWorkspaceCors(jsonResponse({ error: "Not found" }, 404));

  const workspaceId = match[1] ?? "";
  const routeKind = match[2] ?? "";
  const routeSuffix = match[3] ?? "";
  if (!isWorkspaceId(workspaceId)) {
    return withWorkspaceCors(jsonResponse({ error: "Invalid workspace id." }, 400));
  }

  if (routeKind === "git") {
    return withWorkspaceCors(
      await proxyHostedWorkspaceGitRequest(request, env, workspaceId, routeSuffix),
    );
  }

  const workspace = getWorkspaceObject(env, workspaceId, options.workspaceBindingName);
  if (!workspace) {
    return withWorkspaceCors(jsonResponse({ error: "Hosted workspaces are not configured." }, 503));
  }

  if (routeKind === "rpc") {
    if (request.method !== "POST") {
      return withWorkspaceCors(jsonResponse({ error: "Method not allowed." }, 405));
    }
    const rpcUrl = new URL(request.url);
    rpcUrl.pathname = options.rpcPath ?? defaultRpcPath;
    return withWorkspaceCors(await workspace.fetch(new Request(rpcUrl.toString(), request)));
  }

  if (request.method === "GET") {
    const metadataResponse = await workspace.fetch(
      new Request("https://schematics.internal/internal/metadata"),
    );
    if (!metadataResponse.ok) return withWorkspaceCors(metadataResponse);
    const metadata = (await metadataResponse.json()) as Record<string, unknown>;
    const git = await getProxiedWorkspaceGit(env, workspaceId, request.url, workspaceRoutePrefix);
    return withWorkspaceCors(jsonResponse({ ...metadata, ...(git ? { git } : {}) }));
  }

  return withWorkspaceCors(jsonResponse({ error: "Method not allowed." }, 405));
}

export function isWorkspaceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function withWorkspaceCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Accept, Content-Type, Git-Protocol, Traceparent, Tracestate, b3, X-B3-TraceId, X-B3-SpanId, X-B3-Sampled, X-B3-Flags",
  );
  headers.set("Access-Control-Expose-Headers", "content-type, traceparent");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function createHostedWorkspace<Env extends SchematicsCloudflareWorkerEnv>(
  request: Request,
  env: Env,
  options: HostedWorkspaceRouterOptions,
  workspaceRoutePrefix: string,
): Promise<Response> {
  const workspaceId = crypto.randomUUID();
  const workspace = getWorkspaceObject(env, workspaceId, options.workspaceBindingName);
  if (!workspace) {
    return withWorkspaceCors(jsonResponse({ error: "Hosted workspaces are not configured." }, 503));
  }

  const body = await readJsonObject(request);
  const templateId = typeof body["templateId"] === "string" ? body["templateId"] : undefined;
  const initializeBody = JSON.stringify(templateId ? { workspaceId, templateId } : { workspaceId });
  const initializeResponse = await workspace.fetch(
    new Request("https://schematics.internal/internal/initialize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: initializeBody,
    }),
  );

  if (!initializeResponse.ok) return withWorkspaceCors(initializeResponse);

  // Provision a Cloudflare Artifacts Git repo for the workspace (best-effort).
  const proxiedGit = await getProxiedWorkspaceGit(
    env,
    workspaceId,
    request.url,
    workspaceRoutePrefix,
  );

  return withWorkspaceCors(
    jsonResponse(
      {
        workspaceId,
        url: `/w/${workspaceId}`,
        ...(proxiedGit ? { git: proxiedGit } : {}),
      } satisfies HostedWorkspaceCreateResponse,
      201,
    ),
  );
}

async function getProxiedWorkspaceGit<Env extends SchematicsCloudflareWorkerEnv>(
  env: Env,
  workspaceId: string,
  requestUrl: string,
  workspaceRoutePrefix: string,
): Promise<Pick<WorkspaceGitInfo, "remote" | "defaultBranch"> | null> {
  const artifactsBinding = env.SCHEMATICS_ARTIFACTS;
  const git = artifactsBinding ? await provisionWorkspaceRepo(artifactsBinding, workspaceId) : null;
  return git
    ? {
        remote: new URL(`${workspaceRoutePrefix}/${workspaceId}/git`, requestUrl).toString(),
        defaultBranch: git.defaultBranch,
      }
    : null;
}

async function proxyHostedWorkspaceGitRequest<Env extends SchematicsCloudflareWorkerEnv>(
  request: Request,
  env: Env,
  workspaceId: string,
  suffix: string,
): Promise<Response> {
  if (!["GET", "HEAD", "POST"].includes(request.method)) {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const binding = env.SCHEMATICS_ARTIFACTS;
  if (!binding) return jsonResponse({ error: "Hosted git is not configured." }, 503);

  const repo = await binding.get(workspaceId).catch((cause) => {
    console.warn("Artifacts repo lookup failed:", String(cause));
    return null;
  });
  if (!repo) return jsonResponse({ error: "Hosted git repo was not found." }, 404);

  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(repo.remote);
  targetUrl.pathname = `${targetUrl.pathname.replace(/\/$/, "")}${suffix}`;
  targetUrl.search = sourceUrl.search;

  const scope = gitRequestTokenScope(request.method, suffix, sourceUrl.searchParams);
  const token = await repo.createToken(scope, 3600).catch((cause) => {
    console.warn("Artifacts token mint failed:", String(cause));
    return null;
  });
  if (!token) return jsonResponse({ error: "Hosted git credential mint failed." }, 502);
  const password = token.plaintext.split("?")[0] ?? token.plaintext;
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Basic ${btoa(`x:${password}`)}`);
  headers.delete("Host");
  headers.delete("Origin");

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body as BodyInit | null;
  }
  return fetch(targetUrl.toString(), init).catch((cause) =>
    jsonResponse({ error: "Hosted git proxy request failed.", detail: String(cause) }, 502),
  );
}

function gitRequestTokenScope(
  method: string,
  suffix: string,
  searchParams: URLSearchParams,
): "read" | "write" {
  if (method !== "GET" && method !== "HEAD") return "write";
  const service = searchParams.get("service");
  return service === "git-receive-pack" || suffix.endsWith("/git-receive-pack") ? "write" : "read";
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const json = await request.json();
    return typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function getWorkspaceObject<Env extends SchematicsCloudflareWorkerEnv>(
  env: Env,
  workspaceId: string,
  bindingName: keyof Env | string | undefined,
): DurableObjectStubBinding | null {
  const namespace = env[(bindingName ?? defaultWorkspaceBindingName) as keyof Env] as
    | DurableObjectNamespaceBinding
    | undefined;
  if (!namespace) return null;
  return namespace.get(namespace.idFromName(workspaceId));
}

function isHostedWorkspaceRoute(pathname: string, routePrefix: string): boolean {
  return pathname === routePrefix || pathname.startsWith(`${routePrefix}/`);
}

function normalizeRoutePrefix(prefix: string): string {
  const normalized = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function normalizeRoutePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

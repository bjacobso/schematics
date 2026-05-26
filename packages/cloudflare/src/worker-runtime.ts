export interface SchemaIdeCloudflareWorkerEnv {
  readonly SCHEMA_IDE_WORKSPACES?: DurableObjectNamespaceBinding | undefined;
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
}

export interface HostedWorkspaceRouterOptions {
  readonly workspaceRoutePrefix?: string | undefined;
  readonly rpcPath?: string | undefined;
  readonly workspaceBindingName?: keyof SchemaIdeCloudflareWorkerEnv | string | undefined;
}

const defaultWorkspaceRoutePrefix = "/v1/workspaces";
const defaultRpcPath = "/v1/workspace/rpc";
const defaultWorkspaceBindingName = "SCHEMA_IDE_WORKSPACES";

export async function handleHostedWorkspaceRequest<Env extends SchemaIdeCloudflareWorkerEnv>(
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
    return createHostedWorkspace(request, env, options);
  }

  const workspacePath = pathname.slice(`${workspaceRoutePrefix}/`.length);
  const match = /^([^/]+)(?:\/rpc)?$/.exec(workspacePath);
  if (!match) return withWorkspaceCors(jsonResponse({ error: "Not found" }, 404));

  const workspaceId = match[1] ?? "";
  if (!isWorkspaceId(workspaceId)) {
    return withWorkspaceCors(jsonResponse({ error: "Invalid workspace id." }, 400));
  }

  const workspace = getWorkspaceObject(env, workspaceId, options.workspaceBindingName);
  if (!workspace) {
    return withWorkspaceCors(jsonResponse({ error: "Hosted workspaces are not configured." }, 503));
  }

  if (pathname.endsWith("/rpc")) {
    if (request.method !== "POST") {
      return withWorkspaceCors(jsonResponse({ error: "Method not allowed." }, 405));
    }
    const rpcUrl = new URL(request.url);
    rpcUrl.pathname = options.rpcPath ?? defaultRpcPath;
    return withWorkspaceCors(await workspace.fetch(new Request(rpcUrl.toString(), request)));
  }

  if (request.method === "GET") {
    return withWorkspaceCors(
      await workspace.fetch(new Request("https://schema-ide.internal/internal/metadata")),
    );
  }

  return withWorkspaceCors(jsonResponse({ error: "Method not allowed." }, 405));
}

export function isWorkspaceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
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
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Traceparent, Tracestate, b3, X-B3-TraceId, X-B3-SpanId, X-B3-Sampled, X-B3-Flags",
  );
  headers.set("Access-Control-Expose-Headers", "content-type, traceparent");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function createHostedWorkspace<Env extends SchemaIdeCloudflareWorkerEnv>(
  request: Request,
  env: Env,
  options: HostedWorkspaceRouterOptions,
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
    new Request("https://schema-ide.internal/internal/initialize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: initializeBody,
    }),
  );

  if (!initializeResponse.ok) return withWorkspaceCors(initializeResponse);

  return withWorkspaceCors(
    jsonResponse(
      {
        workspaceId,
        url: `/w/${workspaceId}`,
      } satisfies HostedWorkspaceCreateResponse,
      201,
    ),
  );
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const json = await request.json();
    return typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function getWorkspaceObject<Env extends SchemaIdeCloudflareWorkerEnv>(
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

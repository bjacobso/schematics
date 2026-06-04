#!/usr/bin/env node

const apiUrl = normalizeApiUrl(
  readFlag("--api-url") ??
    process.env["SCHEMATICS_PREVIEW_API_URL"] ??
    process.env["SCHEMATICS_API_BASE_URL"],
);

if (!apiUrl) {
  fail("Set SCHEMATICS_PREVIEW_API_URL, SCHEMATICS_API_BASE_URL, or pass --api-url <url>.");
}

const workspace = await requestJson(`${apiUrl}/v1/workspaces`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ templateId: "onboarded-account-yaml" }),
  expectedStatus: 201,
  label: "create hosted workspace",
});

const workspaceId = assertString(workspace.workspaceId, "workspaceId");
const git = assertGitInfo(workspace.git, "create response git");

if (!git.remote.includes(`/v1/workspaces/${workspaceId}/git`)) {
  fail(`Hosted git remote does not point at the workspace proxy: ${git.remote}`);
}

const metadata = await requestJson(`${apiUrl}/v1/workspaces/${workspaceId}`, {
  label: "read hosted workspace metadata",
});
assertGitInfo(metadata.git, "metadata git");

await assertGitDiscovery(git.remote, "git-upload-pack", "read");
await assertGitDiscovery(git.remote, "git-receive-pack", "write");

console.log(
  `Cloudflare hosted git smoke passed for ${workspaceId} (${git.defaultBranch}) at ${apiUrl}`,
);

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function normalizeApiUrl(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : "";
}

async function requestJson(url, options = {}) {
  const { expectedStatus = 200, label = url, ...init } = options;
  const response = await fetch(url, init);
  const text = await response.text();
  if (response.status !== expectedStatus) {
    fail(`${label} returned ${response.status}; expected ${expectedStatus}: ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    fail(`${label} returned invalid JSON: ${cause instanceof Error ? cause.message : cause}`);
  }
}

function assertGitInfo(value, label) {
  if (!value || typeof value !== "object") {
    fail(`${label} is missing. Is SCHEMATICS_ARTIFACTS bound on the deployed worker?`);
  }
  const remote = assertString(value.remote, `${label}.remote`);
  const defaultBranch = assertString(value.defaultBranch, `${label}.defaultBranch`);
  if (!remote.startsWith("http://") && !remote.startsWith("https://")) {
    fail(`${label}.remote is not an absolute URL: ${remote}`);
  }
  return { remote, defaultBranch };
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string.`);
  }
  return value;
}

async function assertGitDiscovery(remote, service, scope) {
  const url = `${remote.replace(/\/+$/, "")}/info/refs?service=${encodeURIComponent(service)}`;
  const response = await fetch(url, {
    headers: {
      Accept: `application/x-${service}-advertisement, */*`,
      "Git-Protocol": "version=2",
    },
  });
  const body = new Uint8Array(await response.arrayBuffer());
  const preview = new TextDecoder().decode(body.slice(0, 512));
  if (!response.ok) {
    fail(
      `${service} discovery through the deployed proxy returned ${response.status}; expected 2xx (${scope} token path): ${preview}`,
    );
  }
  if (body.length === 0) {
    fail(`${service} discovery through the deployed proxy returned an empty response.`);
  }
  if (!preview.includes(service)) {
    fail(`${service} discovery response did not advertise ${service}.`);
  }
}

function fail(message) {
  console.error(`Cloudflare hosted git smoke failed: ${message}`);
  process.exit(1);
}

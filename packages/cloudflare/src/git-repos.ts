import type { CloudflareArtifactsBinding } from "@schematics/git-artifacts";

/**
 * Per the Cloudflare Artifacts model, the Worker **provisions repos and mints
 * tokens** — it does not run a Git implementation itself (clone/fetch/push all
 * happen against the remote from a Git client). So this module talks to the
 * `env.SCHEMATICS_ARTIFACTS` binding directly and never imports isomorphic-git,
 * keeping that (and its `crc-32`/`buffer` deps) out of the Worker bundle.
 *
 * The git library (`@schematics/git-artifacts`) is for Node/CLI and browser
 * clients, not the Worker.
 */
export interface WorkspaceGitInfo {
  readonly remote: string;
  readonly defaultBranch: string;
  /** Short-lived credential, present only when `mintToken` was requested. */
  readonly token?: string | undefined;
  readonly expiresAt?: number | undefined;
}

export interface ProvisionWorkspaceRepoOptions {
  /** Also mint a scoped git credential and include it in the result. */
  readonly mintToken?: "read" | "write" | undefined;
  readonly tokenTtlSeconds?: number | undefined;
}

/**
 * Get-or-create the Artifacts repo for `workspaceId` and return its clone
 * remote (+ optional scoped token). Best-effort: returns `null` on any failure
 * so workspace creation never depends on the Artifacts beta being available.
 */
export async function provisionWorkspaceRepo(
  binding: CloudflareArtifactsBinding,
  workspaceId: string,
  options: ProvisionWorkspaceRepoOptions = {},
): Promise<WorkspaceGitInfo | null> {
  try {
    const repo =
      (await binding.get(workspaceId)) ??
      (await binding.create(workspaceId, {
        setDefaultBranch: "main",
        description: `Schematics workspace ${workspaceId}`,
      }));

    const info: WorkspaceGitInfo = {
      remote: repo.remote,
      defaultBranch: repo.defaultBranch,
    };

    if (!options.mintToken) return info;

    const token = await repo.createToken(options.mintToken, options.tokenTtlSeconds ?? 3600);
    // Token form is `art_v1_<hex>?expires=<unix>`; git Basic auth uses the
    // secret before `?expires=` as the password with username `x`.
    const password = token.plaintext.split("?")[0] ?? token.plaintext;
    return { ...info, token: password, expiresAt: token.expiresAt };
  } catch (cause) {
    console.warn("Artifacts repo provisioning failed (non-fatal):", String(cause));
    return null;
  }
}

import http from "isomorphic-git/http/web";
import {
  makeGitRepoBackend,
  type GitRepoBackend,
  type GitRepoBackendOptions,
} from "./git-repo-backend";

export interface BrowserGitRepoBackendOptions extends Omit<GitRepoBackendOptions, "remote"> {
  readonly remote: Omit<NonNullable<GitRepoBackendOptions["remote"]>, "http">;
}

export function makeBrowserGitRepoBackend(options: BrowserGitRepoBackendOptions): GitRepoBackend {
  return makeGitRepoBackend({
    ...options,
    remote: {
      ...options.remote,
      http,
    },
  });
}

import { describe, expect, it } from "@effect/vitest";
import { makeOAuthClient } from "alchemy/Auth/OAuthFlow";
import { PlatformServices } from "alchemy/Util/PlatformServices";
import { Effect, Redacted } from "effect";
import { createHash } from "node:crypto";

const spec = {
  clientId: "schematics-test",
  endpoints: {
    authorize: "https://provider.example/authorize",
    token: "https://provider.example/token",
  },
  redirectUri: "https://app.example/callback",
  localCallbackUri: "http://127.0.0.1:12345/callback",
};

describe("Alchemy on Effect 4.1", () => {
  it.effect("generates OAuth state and an S256 PKCE challenge with platform crypto", () =>
    Effect.gen(function* () {
      const client = makeOAuthClient({ ...spec, auth: { kind: "pkce" } });
      const first = yield* client.authorize(["read", "write"]);
      const second = yield* client.authorize();
      const url = new URL(first.url);
      expect(Buffer.from(first.state, "base64url")).toHaveLength(32);
      expect(first.state).not.toBe(second.state);
      expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{128}$/);
      expect(first.verifier).not.toBe(second.verifier);
      expect(url.searchParams.get("state")).toBe(first.state);
      expect(url.searchParams.get("scope")).toBe("read write");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("code_challenge")).toBe(
        createHash("sha256").update(first.verifier!).digest("base64url"),
      );
    }).pipe(Effect.provide(PlatformServices)),
  );

  it.effect("generates state without a PKCE challenge for client-secret authorization", () =>
    Effect.gen(function* () {
      const client = makeOAuthClient({
        ...spec,
        auth: { kind: "clientSecret", clientSecret: Redacted.make("test-only") },
      });
      const authorization = yield* client.authorize();
      const url = new URL(authorization.url);
      expect(Buffer.from(authorization.state, "base64url")).toHaveLength(32);
      expect(authorization.verifier).toBeUndefined();
      expect(url.searchParams.has("code_challenge")).toBe(false);
      expect(url.searchParams.get("client_id")).toBe(spec.clientId);
      expect(url.searchParams.get("redirect_uri")).toBe(spec.redirectUri);
    }).pipe(Effect.provide(PlatformServices)),
  );
});

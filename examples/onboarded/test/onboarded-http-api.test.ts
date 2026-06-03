import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { makeOnboardedHttpApi } from "../src/http/onboarded-http-api";
import { seedOnboardedData } from "../src/mock/seed";

const run = Effect.runPromise;

interface Recorded {
  url: string;
  method: string;
  authorization: string | undefined;
}

function fakeFetch(handler: (url: string, init: RequestInit) => unknown) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      method: init?.method ?? "GET",
      authorization: headers["authorization"],
    });
    const body = handler(url, init ?? {});
    return new Response(body === undefined ? "" : JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetchImpl, calls };
}

describe("makeOnboardedHttpApi", () => {
  it("lists accounts with a bearer token and decodes the DTOs", async () => {
    const seed = seedOnboardedData();
    const { fetchImpl, calls } = fakeFetch((url) =>
      url.endsWith("/api/v1/accounts") ? seed.accounts : undefined,
    );
    const api = makeOnboardedHttpApi({
      baseUrl: "https://api.onboarded.test/",
      token: "secret-token",
      fetch: fetchImpl,
    });

    const accounts = await run(api.accounts.list);
    expect(accounts.length).toBe(seed.accounts.length);
    expect(calls[0]?.url).toBe("https://api.onboarded.test/api/v1/accounts");
    expect(calls[0]?.authorization).toBe("Bearer secret-token");
    expect(api.calls).toEqual([{ group: "accounts", operation: "list" }]);
  });

  it("fails with OnboardedApiError on an undecodable response", async () => {
    const { fetchImpl } = fakeFetch(() => ({ not: "an account list" }));
    const api = makeOnboardedHttpApi({
      baseUrl: "https://api.onboarded.test",
      token: "t",
      fetch: fetchImpl,
    });
    await expect(run(api.accounts.list)).rejects.toMatchObject({ _tag: "OnboardedApiError" });
  });

  it("substitutes path params for resource-scoped routes", async () => {
    const seed = seedOnboardedData();
    const form = seed.forms[0]!;
    const { fetchImpl, calls } = fakeFetch(() => form);
    const api = makeOnboardedHttpApi({
      baseUrl: "https://api.onboarded.test",
      token: "t",
      fetch: fetchImpl,
    });
    await run(api.forms.get(form.uid));
    expect(calls[0]?.url).toBe(`https://api.onboarded.test/api/v1/forms/${form.uid}`);
  });
});

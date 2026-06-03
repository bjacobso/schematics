// Test stub for the `cloudflare:workers` runtime module, which only exists
// inside the Workers runtime. Tests exercise the portable service logic, not
// the Durable Object base class, so a no-op class is enough for imports.
export class DurableObject {
  // The real base class assigns ctx/env; tests construct the service directly
  // and never instantiate this, so the shape is intentionally empty.
  constructor(
    public ctx?: unknown,
    public env?: unknown,
  ) {}
}

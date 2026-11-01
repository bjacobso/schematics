import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const alchemyModule = import.meta.resolve("alchemy");
const alchemyRequire = createRequire(alchemyModule);
const alchemyCli = resolve(dirname(fileURLToPath(alchemyModule)), "../bin/cli.js");
const execFileAsync = promisify(execFile);

describe("Alchemy state reads on Effect 4.1", () => {
  it("accepts sparse and undefined S3 metadata values without optional index signatures", async () => {
    const { Metadata } = await import(alchemyRequire.resolve("@distilled.cloud/aws/s3"));
    const decode = Schema.decodeUnknownSync(Metadata);
    const encode = Schema.encodeSync(Metadata);

    for (const value of [{}, { label: "preview" }, { label: undefined }]) {
      expect(decode(value)).toEqual(value);
      expect(encode(value)).toEqual(value);
    }
    expect(() => decode({ label: 42 })).toThrow();
  });

  it("reads a preview API URL through the real state CLI without cloud credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "schematics-alchemy-state-"));
    const runtimeDir = join(directory, ".alchemy");
    const stateDir = join(runtimeDir, "state/schematics/pr-test");
    const resource = {
      kind: "resource",
      status: "created",
      fqn: "Api",
      logicalId: "Api",
      resourceType: "Cloudflare.Worker",
      props: {},
      attr: { url: "https://api.example.test" },
    };

    try {
      await mkdir(stateDir, { recursive: true });
      await writeFile(join(stateDir, "Api.json"), JSON.stringify(resource));
      // Keep Alchemy's optional npm update check offline for this subprocess.
      await writeFile(
        join(runtimeDir, "version-check.json"),
        JSON.stringify({ checkedAt: Date.now(), distTags: { beta: "2.0.0-beta.81" } }),
      );
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          alchemyCli,
          "state",
          "read",
          "schematics/pr-test/Api",
          "--backend",
          "local",
          "--log-level",
          "none",
          "--no-input",
        ],
        {
          cwd: directory,
          env: { ...process.env, ALCHEMY_TELEMETRY_DISABLED: "1" },
          timeout: 20_000,
        },
      );
      // Match the preview workflow's extraction of Alchemy's state JSON.
      const json = /^\{[\s\S]*^\}/m.exec(stdout);
      expect(json).not.toBeNull();
      expect(JSON.parse(json![0]).attr.url).toBe(resource.attr.url);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});

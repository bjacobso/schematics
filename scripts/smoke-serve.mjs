import { spawn } from "node:child_process";

const port = process.env["SCHEMATICS_SMOKE_PORT"] ?? "4329";
const origin = `http://127.0.0.1:${port}`;
const child = spawn("pnpm", ["serve"], {
  detached: process.platform !== "win32",
  env: {
    ...process.env,
    OPENROUTER_API_KEY: "",
    SCHEMATICS_OPENROUTER_API_KEY: "",
    SCHEMATICS_PORT: port,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
let stopping = false;
child.stdout?.on("data", (chunk) => {
  output += chunk;
  if (!stopping) process.stdout.write(chunk);
});
child.stderr?.on("data", (chunk) => {
  output += chunk;
  if (!stopping) process.stderr.write(chunk);
});

try {
  await waitForServer();
  await assertText("/", "<!doctype html>");
  await assertJson("/v1/healthz", { ok: true });
  await assertJson("/v1/models", {
    models: [{ id: "local-debug", label: "Local Debug" }],
  });
  console.log("Schematics serve smoke passed.");
} finally {
  await stopChild();
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Serve process exited early with code ${child.exitCode}.\n${output}`);
    }

    try {
      const response = await fetch(`${origin}/v1/healthz`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${origin}/v1/healthz.\n${output}`);
}

async function assertText(path, expectedPrefix) {
  const response = await fetch(`${origin}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }

  const text = await response.text();
  if (!text.startsWith(expectedPrefix)) {
    throw new Error(`${path} did not start with ${JSON.stringify(expectedPrefix)}`);
  }
}

async function assertJson(path, expected) {
  const response = await fetch(`${origin}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }

  const actual = await response.json();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${path} returned ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
    );
  }
}

async function stopChild() {
  if (child.exitCode !== null) return;
  stopping = true;

  if (process.platform === "win32") {
    child.kill("SIGTERM");
  } else {
    process.kill(-child.pid, "SIGTERM");
  }

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) {
        if (process.platform === "win32") {
          child.kill("SIGKILL");
        } else {
          process.kill(-child.pid, "SIGKILL");
        }
      }
      resolve();
    }, 5_000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

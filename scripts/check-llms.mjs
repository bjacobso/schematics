import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const publicDir = resolve(root, "apps/playground/public");
const source = await readFile(resolve(publicDir, "llms.txt"), "utf8");
const lines = source.trimEnd().split(/\r?\n/);
assert.equal(lines[0], "# Schematics", "llms.txt must start with the project H1");
const afterTitle = lines.slice(1).find((line) => line.trim());
assert(afterTitle?.startsWith("> "), "llms.txt needs a blockquote summary after its H1");
assert.match(afterTitle, /pre-1\.0|experimental/i, "Summary must state maturity");
assert.match(afterTitle, /pnpm install --frozen-lockfile/, "Summary must explain setup");
assert(!/<(?:!doctype|html|body)\b/i.test(source), "llms.txt must not be an HTML app shell");
const headers = await readFile(resolve(publicDir, "_headers"), "utf8");
assert.match(
  headers,
  /^\/llms\.txt\r?\n\s+Content-Type: text\/(plain|markdown)(?:;[^\r\n]*)?\r?$/m,
  "Cloudflare must serve /llms.txt with a text content type",
);

const sections = lines.filter((line) => line.startsWith("## "));
assert(sections.length >= 2, "llms.txt needs sections of links");
let section;
let linkCount = 0;
const localTargets = [];
for (const line of lines.slice(1)) {
  if (line.startsWith("## ")) {
    if (section) assert(linkCount > 0, `${section} needs links`);
    section = line;
    linkCount = 0;
  } else if (line.startsWith("- ")) {
    assert(section, "Links must belong to a section");
    const match = /^- \[([^\]]+)\]\(([^)]+)\): .+/.exec(line);
    assert(match, `Expected a titled link and note: ${line}`);
    const url = new URL(match[2]);
    assert.equal(url.protocol, "https:", `Use an absolute HTTPS link: ${url}`);
    linkCount++;

    let target;
    if (url.origin === "https://raw.githubusercontent.com") {
      const prefix = "/bjacobso/schematics/main/";
      assert(url.pathname.startsWith(prefix), `Link only to this public repository: ${url}`);
      target = resolve(root, decodeURIComponent(url.pathname.slice(prefix.length)));
      assert(target.startsWith(root), `Repository link escapes the checkout: ${url}`);
    } else if (url.origin === "https://schematics.run") {
      const path = decodeURIComponent(url.pathname);
      target =
        path === "/"
          ? resolve(root, "apps/playground/src/pages/index.astro")
          : resolve(publicDir, `.${path}`);
      assert(
        path === "/" || target.startsWith(`${publicDir}${sep}`),
        `Site link escapes the public directory: ${url}`,
      );
      localTargets.push(path);
    } else {
      assert.equal(url.href, "https://worldvm.com/", `Unexpected external link: ${url}`);
    }
    if (target) {
      assert((await stat(target)).isFile(), `Missing link target: ${url}`);
    }
  }
}
assert(linkCount > 0, `${section} needs links`);

if (process.argv.includes("--dist")) {
  const dist = resolve(root, "apps/playground/dist");
  assert.equal(
    await readFile(resolve(dist, "llms.txt"), "utf8"),
    source,
    "Astro must copy the exact llms.txt source; an app-shell fallback cannot pass",
  );
  assert.equal(
    await readFile(resolve(dist, "_headers"), "utf8"),
    headers,
    "Astro must copy the Cloudflare content-type headers",
  );
  for (const path of localTargets) {
    const target = resolve(dist, path === "/" ? "index.html" : `.${path}`);
    assert((await stat(target)).isFile(), `Missing built site link target: ${path}`);
  }
}

console.log("llms.txt structure, links, and requested build output passed.");

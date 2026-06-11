import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { PDFDocument } from "pdf-lib";
import {
  BrowserPageService,
  createCloudflareBrowserPageService,
  createPuppeteerBrowserPageService,
  createRemoteBrowserPageService,
  type BrowserPageLike,
  type BrowserSessionLike,
} from "../src";
import {
  createBrowserHtmlScreenshotCapability,
  createBrowserPdfRenderPageCapability,
  createRemoteBrowserHtmlScreenshotCapability,
  createRemoteBrowserPdfRenderPageCapability,
  createRemoteHtmlScreenshotCapability,
  createScreenshotBackedPdf,
} from "../src/node";

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

describe("media host capabilities", () => {
  it("renders PDF and HTML inputs through an injected browser service", async () => {
    const directory = await mkdtemp(join(tmpdir(), "schematics-media-"));
    const browser = BrowserPageService.of({
      renderPdfPage: (input) =>
        Effect.succeed({
          mediaType: "image/png",
          content: pngBase64,
          width: input.page * 100,
          height: 200,
        }),
      renderHtmlPageScreenshot: (input) =>
        Effect.succeed({
          mediaType: "image/png",
          content: pngBase64,
          width: input.viewport?.width,
          height: input.viewport?.height,
        }),
    });

    try {
      await writeFile(join(directory, "source.pdf"), "%PDF-1.7\n%%EOF\n");
      await writeFile(join(directory, "source.html"), "<main>Form</main>\n");

      const pdf = await Effect.runPromise(
        createBrowserPdfRenderPageCapability({ workspaceDirectory: directory, browser }).run({
          path: "source.pdf",
          page: 2,
          outputPath: "screenshots/page-02.png",
        }),
      );
      const html = await Effect.runPromise(
        createBrowserHtmlScreenshotCapability({ workspaceDirectory: directory, browser }).run({
          path: "source.html",
          viewport: { width: 1280, height: 720 },
          outputPath: "screenshots/page-01.png",
        }),
      );

      expect(pdf).toMatchObject({ page: 2, width: 200, outputPath: "screenshots/page-02.png" });
      expect(html).toMatchObject({ mediaType: "image/png", width: 1280, height: 720 });
      await expect(readFile(join(directory, "screenshots/page-02.png"))).resolves.toHaveLength(68);
      await expect(readFile(join(directory, "screenshots/page-01.png"))).resolves.toHaveLength(68);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects capability paths that escape the workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "schematics-media-"));
    const browser = BrowserPageService.of({
      renderPdfPage: () => Effect.succeed({ mediaType: "image/png", content: pngBase64 }),
      renderHtmlPageScreenshot: () =>
        Effect.succeed({ mediaType: "image/png", content: pngBase64 }),
    });

    try {
      await expect(
        Effect.runPromise(
          createBrowserHtmlScreenshotCapability({ workspaceDirectory: directory, browser }).run({
            html: "<main>Form</main>",
            outputPath: "../escape.png",
          }),
        ),
      ).rejects.toThrow(/Unsafe workspace path|escapes root/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("can resolve the browser page service from the Effect context", async () => {
    const directory = await mkdtemp(join(tmpdir(), "schematics-media-"));
    const browser = BrowserPageService.of({
      renderPdfPage: () =>
        Effect.succeed({
          mediaType: "image/png",
          content: pngBase64,
          width: 612,
          height: 792,
        }),
      renderHtmlPageScreenshot: () =>
        Effect.succeed({ mediaType: "image/png", content: pngBase64 }),
    });

    try {
      await writeFile(join(directory, "source.pdf"), "%PDF-1.7\n%%EOF\n");
      const capability = createBrowserPdfRenderPageCapability({ workspaceDirectory: directory });
      const rendered = await Effect.runPromise(
        capability
          .run({ path: "source.pdf", page: 1 })
          .pipe(Effect.provideService(BrowserPageService, browser)),
      );

      expect(rendered).toMatchObject({ mediaType: "image/png", width: 612, height: 792 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("renders through the Cloudflare browser service adapter", async () => {
    const browser = createCloudflareBrowserPageService({
      browserBinding: { name: "BROWSER" },
      puppeteer: makeStubPuppeteer({ pdfWidth: 612, pdfHeight: 792 }),
    });

    const pdf = await Effect.runPromise(
      browser.renderPdfPage({ pdf: "JVBERi0xLjcKJSVFT0YK", page: 1, scale: 1 }),
    );
    const html = await Effect.runPromise(
      browser.renderHtmlPageScreenshot({
        html: "<main>Form</main>",
        viewport: { width: 800, height: 600 },
      }),
    );

    expect(pdf).toMatchObject({
      mediaType: "image/png",
      content: pngBase64,
      width: 612,
      height: 792,
    });
    expect(html).toMatchObject({
      mediaType: "image/png",
      content: pngBase64,
      width: 800,
      height: 600,
    });
  });

  it("routes PDF and HTML rendering through the remote browser service adapter", async () => {
    const directory = await mkdtemp(join(tmpdir(), "schematics-remote-media-"));
    const originalFetch = globalThis.fetch;
    const requests: unknown[] = [];
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          output: { mediaType: "image/png", content: pngBase64, width: 321, height: 654 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      await writeFile(join(directory, "source.pdf"), "%PDF-1.7\n%%EOF\n");
      await writeFile(join(directory, "source.html"), "<main>Remote</main>\n");
      const browser = createRemoteBrowserPageService({ endpoint: "https://renderer.test/render" });

      const pdf = await Effect.runPromise(
        createBrowserPdfRenderPageCapability({ workspaceDirectory: directory, browser }).run({
          path: "source.pdf",
          page: 1,
          outputPath: "out/page.png",
        }),
      );
      const html = await Effect.runPromise(
        createBrowserHtmlScreenshotCapability({ workspaceDirectory: directory, browser }).run({
          path: "source.html",
          outputPath: "out/html.png",
        }),
      );

      expect(pdf).toMatchObject({ width: 321, height: 654, outputPath: "out/page.png" });
      expect(html).toMatchObject({ width: 321, height: 654, outputPath: "out/html.png" });
      expect(requests).toMatchObject([
        { capability: "pdf.renderPage" },
        { capability: "html.renderPageScreenshot" },
      ]);
      await expect(readFile(join(directory, "out/page.png"))).resolves.toHaveLength(68);
      await expect(readFile(join(directory, "out/html.png"))).resolves.toHaveLength(68);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("supports direct remote HTML and remote-browser capability factories", async () => {
    const directory = await mkdtemp(join(tmpdir(), "schematics-remote-capability-"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ mediaType: "image/png", content: pngBase64, width: 111, height: 222 }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    try {
      await writeFile(join(directory, "source.pdf"), "%PDF-1.7\n%%EOF\n");
      const html = await Effect.runPromise(
        createRemoteHtmlScreenshotCapability({
          workspaceDirectory: directory,
          endpoint: "https://renderer.test/html",
        }).run({
          html: "<main>Direct</main>",
          outputPath: "direct-html.png",
        }),
      );
      const pdf = await Effect.runPromise(
        createRemoteBrowserPdfRenderPageCapability({
          workspaceDirectory: directory,
          endpoint: "https://renderer.test/browser",
        }).run({
          path: "source.pdf",
          page: 1,
          outputPath: "browser-pdf.png",
        }),
      );
      const browserHtml = await Effect.runPromise(
        createRemoteBrowserHtmlScreenshotCapability({
          workspaceDirectory: directory,
          endpoint: "https://renderer.test/browser",
        }).run({
          html: "<main>Browser</main>",
          outputPath: "browser-html.png",
        }),
      );

      expect(html).toMatchObject({ width: 111, outputPath: "direct-html.png" });
      expect(pdf).toMatchObject({ width: 111, outputPath: "browser-pdf.png" });
      expect(browserHtml).toMatchObject({ width: 111, outputPath: "browser-html.png" });
    } finally {
      globalThis.fetch = originalFetch;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails with a clear message when the Puppeteer dependency is missing", async () => {
    const browser = createPuppeteerBrowserPageService({
      puppeteerSpecifier: "schematics-test-missing-puppeteer",
    });

    await expect(
      Effect.runPromise(browser.renderPdfPage({ pdf: "JVBERi0xLjcKJSVFT0YK", page: 1 })),
    ).rejects.toThrow(/Optional dependency schematics-test-missing-puppeteer is required/);
  });

  it("creates screenshot-backed PDFs with screenshot pixel page dimensions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "schematics-pdf-"));

    try {
      await writeFile(join(directory, "page-01.png"), Buffer.from(pngBase64, "base64"));

      const metadata = await Effect.runPromise(
        createScreenshotBackedPdf({
          workspaceDirectory: directory,
          pages: [{ screenshotPath: "page-01.png", width: 1280, height: 1800 }],
          outputPath: "annotation/source.pdf",
        }),
      );
      const pdf = await PDFDocument.load(await readFile(join(directory, "annotation/source.pdf")));
      const size = pdf.getPage(0).getSize();

      expect(metadata).toEqual({
        coordinateSystem: "screenshot-pixels",
        screenshotMode: "native-source",
        pages: [
          {
            page: 1,
            screenshotPath: "page-01.png",
            width: 1280,
            height: 1800,
            pdfWidth: 1280,
            pdfHeight: 1800,
          },
        ],
      });
      expect(size).toMatchObject({ width: 1280, height: 1800 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function makeStubPuppeteer({
  pdfWidth,
  pdfHeight,
}: {
  readonly pdfWidth: number;
  readonly pdfHeight: number;
}) {
  return {
    launch: async () =>
      ({
        newPage: async () => makeStubPage({ pdfWidth, pdfHeight }),
        close: async () => {},
      }) satisfies BrowserSessionLike,
  };
}

function makeStubPage({
  pdfWidth,
  pdfHeight,
}: {
  readonly pdfWidth: number;
  readonly pdfHeight: number;
}): BrowserPageLike {
  let viewport: { readonly width: number; readonly height: number } | null = null;
  return {
    setViewport: async (nextViewport) => {
      viewport = nextViewport;
    },
    setContent: async () => {},
    screenshot: async () => pngBase64,
    evaluate: async () => ({
      mediaType: "image/png" as const,
      content: pngBase64,
      width: pdfWidth,
      height: pdfHeight,
    }),
    viewport: () => viewport,
    close: async () => {},
  };
}

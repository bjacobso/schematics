import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { PDFDocument } from "pdf-lib";
import { BrowserPageService } from "../src";
import {
  createBrowserHtmlScreenshotCapability,
  createBrowserPdfRenderPageCapability,
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

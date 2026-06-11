import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as nodePath from "node:path";
import { Effect } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import { PDFDocument } from "pdf-lib";
import {
  bytesToBase64,
  createCloudflareBrowserPageService,
  createPuppeteerBrowserPageService,
  createRemoteBrowserPageService,
  postRemoteJson,
  type CloudflareBrowserPageServiceOptions,
  type PuppeteerBrowserPageServiceOptions,
  type RemoteCapabilityOptions,
} from "./browser-services";
import {
  BrowserPageService,
  HtmlRenderPageScreenshotCapability,
  OcrMarkdownFromImageCapability,
  PdfRenderPageCapability,
  type BrowserPageService as BrowserPageServiceShape,
  type HtmlRenderPageScreenshotInput,
  type HtmlRenderPageScreenshotOutput,
  type OcrMarkdownFromImageInput,
  type OcrMarkdownFromImageOutput,
  type PdfRenderPageInput,
  type PdfRenderPageOutput,
} from "./media-capabilities";
import type { ArtifactCapabilityImplementation } from "./workflow";

export {
  createCloudflareBrowserPageService,
  createPuppeteerBrowserPageService,
  createRemoteBrowserPageService,
  type BrowserPageLike,
  type BrowserSessionLike,
  type CloudflareBrowserPageServiceOptions,
  type CloudflarePuppeteerLauncherLike,
  type PuppeteerBrowserPageServiceOptions,
  type PuppeteerLauncherLike,
  type RemoteBrowserPageServiceOptions,
  type RemoteCapabilityOptions,
} from "./browser-services";

export interface WorkspaceCapabilityFactoryOptions {
  readonly workspaceDirectory: string;
}

export interface ScreenshotBackedPdfPageInput {
  readonly screenshotPath: string;
  readonly width: number;
  readonly height: number;
}

export interface CreateScreenshotBackedPdfOptions {
  readonly pages: readonly ScreenshotBackedPdfPageInput[];
  readonly outputPath: string;
  readonly workspaceDirectory?: string | undefined;
}

export interface ScreenshotBackedPdfMetadata {
  readonly coordinateSystem: "screenshot-pixels";
  readonly screenshotMode: "native-source";
  readonly pages: readonly {
    readonly page: number;
    readonly screenshotPath: string;
    readonly width: number;
    readonly height: number;
    readonly pdfWidth: number;
    readonly pdfHeight: number;
  }[];
}

export function createBrowserPdfRenderPageCapability({
  workspaceDirectory,
  browser,
}: WorkspaceCapabilityFactoryOptions & {
  readonly browser?: BrowserPageServiceShape | undefined;
}): ArtifactCapabilityImplementation<PdfRenderPageInput, PdfRenderPageOutput> {
  return {
    capability: PdfRenderPageCapability,
    run: (input) =>
      Effect.gen(function* () {
        const browserService = browser ?? (yield* BrowserPageService);
        const pdf = yield* readInputBytesOrString(workspaceDirectory, input.path, input.content);
        const rendered = yield* browserService.renderPdfPage({
          pdf,
          page: input.page,
          scale: input.scale,
        });
        yield* writeOptionalBase64File(workspaceDirectory, input.outputPath, rendered.content);
        return compact({
          path: input.path ?? "",
          page: input.page,
          mediaType: rendered.mediaType,
          content: rendered.content,
          outputPath: input.outputPath,
          width: rendered.width,
          height: rendered.height,
        });
      }),
  };
}

export function createBrowserHtmlScreenshotCapability({
  workspaceDirectory,
  browser,
}: WorkspaceCapabilityFactoryOptions & {
  readonly browser?: BrowserPageServiceShape | undefined;
}): ArtifactCapabilityImplementation<
  HtmlRenderPageScreenshotInput,
  HtmlRenderPageScreenshotOutput
> {
  return {
    capability: HtmlRenderPageScreenshotCapability,
    run: (input) =>
      Effect.gen(function* () {
        const browserService = browser ?? (yield* BrowserPageService);
        const html = yield* readInputText(workspaceDirectory, input.path, input.html);
        const rendered = yield* browserService.renderHtmlPageScreenshot({
          html,
          baseUrl: input.baseUrl,
          viewport: input.viewport,
          margin: input.margin,
        });
        yield* writeOptionalBase64File(workspaceDirectory, input.outputPath, rendered.content);
        return compact({
          path: input.path,
          mediaType: rendered.mediaType,
          content: rendered.content,
          outputPath: input.outputPath,
          width: rendered.width,
          height: rendered.height,
        });
      }),
  };
}

export function createPuppeteerPdfRenderPageCapability({
  workspaceDirectory,
  ...browserOptions
}: WorkspaceCapabilityFactoryOptions &
  PuppeteerBrowserPageServiceOptions): ArtifactCapabilityImplementation<
  PdfRenderPageInput,
  PdfRenderPageOutput
> {
  return createBrowserPdfRenderPageCapability({
    workspaceDirectory,
    browser: createPuppeteerBrowserPageService(browserOptions),
  });
}

export function createPuppeteerHtmlScreenshotCapability({
  workspaceDirectory,
  ...browserOptions
}: WorkspaceCapabilityFactoryOptions &
  PuppeteerBrowserPageServiceOptions): ArtifactCapabilityImplementation<
  HtmlRenderPageScreenshotInput,
  HtmlRenderPageScreenshotOutput
> {
  return createBrowserHtmlScreenshotCapability({
    workspaceDirectory,
    browser: createPuppeteerBrowserPageService(browserOptions),
  });
}

export function createCloudflareBrowserPdfRenderPageCapability({
  workspaceDirectory,
  ...browserOptions
}: WorkspaceCapabilityFactoryOptions &
  CloudflareBrowserPageServiceOptions): ArtifactCapabilityImplementation<
  PdfRenderPageInput,
  PdfRenderPageOutput
> {
  return createBrowserPdfRenderPageCapability({
    workspaceDirectory,
    browser: createCloudflareBrowserPageService(browserOptions),
  });
}

export function createCloudflareBrowserHtmlScreenshotCapability({
  workspaceDirectory,
  ...browserOptions
}: WorkspaceCapabilityFactoryOptions &
  CloudflareBrowserPageServiceOptions): ArtifactCapabilityImplementation<
  HtmlRenderPageScreenshotInput,
  HtmlRenderPageScreenshotOutput
> {
  return createBrowserHtmlScreenshotCapability({
    workspaceDirectory,
    browser: createCloudflareBrowserPageService(browserOptions),
  });
}

export function createRemotePdfRenderPageCapability({
  workspaceDirectory,
  endpoint,
  auth,
}: WorkspaceCapabilityFactoryOptions & RemoteCapabilityOptions): ArtifactCapabilityImplementation<
  PdfRenderPageInput,
  PdfRenderPageOutput
> {
  return {
    capability: PdfRenderPageCapability,
    run: (input) =>
      Effect.gen(function* () {
        const pdf = yield* readInputBytesOrString(workspaceDirectory, input.path, input.content);
        const response = yield* postRemoteJson(endpoint, auth, {
          pdf: typeof pdf === "string" ? pdf : bytesToBase64(pdf),
          page: input.page,
          scale: input.scale,
        });
        const rendered = response as {
          readonly mediaType?: string;
          readonly content?: string;
          readonly width?: number;
          readonly height?: number;
        };
        if (rendered.content === undefined) {
          return yield* Effect.fail(new Error("Remote pdf.renderPage response missing content."));
        }
        yield* writeOptionalBase64File(workspaceDirectory, input.outputPath, rendered.content);
        return compact({
          path: input.path ?? "",
          page: input.page,
          mediaType: rendered.mediaType ?? "image/png",
          content: rendered.content,
          outputPath: input.outputPath,
          width: rendered.width,
          height: rendered.height,
        });
      }),
  };
}

export function createRemoteHtmlScreenshotCapability({
  workspaceDirectory,
  endpoint,
  auth,
}: WorkspaceCapabilityFactoryOptions & RemoteCapabilityOptions): ArtifactCapabilityImplementation<
  HtmlRenderPageScreenshotInput,
  HtmlRenderPageScreenshotOutput
> {
  return {
    capability: HtmlRenderPageScreenshotCapability,
    run: (input) =>
      Effect.gen(function* () {
        const html = yield* readInputText(workspaceDirectory, input.path, input.html);
        const response = yield* postRemoteJson(endpoint, auth, {
          html,
          baseUrl: input.baseUrl,
          viewport: input.viewport,
          margin: input.margin,
        });
        const rendered = response as {
          readonly mediaType?: string;
          readonly content?: string;
          readonly width?: number;
          readonly height?: number;
        };
        if (rendered.content === undefined) {
          return yield* Effect.fail(
            new Error("Remote html.renderPageScreenshot response missing content."),
          );
        }
        yield* writeOptionalBase64File(workspaceDirectory, input.outputPath, rendered.content);
        return compact({
          path: input.path,
          mediaType: "image/png" as const,
          content: rendered.content,
          outputPath: input.outputPath,
          width: rendered.width,
          height: rendered.height,
        });
      }),
  };
}

export function createRemoteBrowserPdfRenderPageCapability({
  workspaceDirectory,
  endpoint,
  auth,
}: WorkspaceCapabilityFactoryOptions & RemoteCapabilityOptions): ArtifactCapabilityImplementation<
  PdfRenderPageInput,
  PdfRenderPageOutput
> {
  return createBrowserPdfRenderPageCapability({
    workspaceDirectory,
    browser: createRemoteBrowserPageService({ endpoint, auth }),
  });
}

export function createRemoteBrowserHtmlScreenshotCapability({
  workspaceDirectory,
  endpoint,
  auth,
}: WorkspaceCapabilityFactoryOptions & RemoteCapabilityOptions): ArtifactCapabilityImplementation<
  HtmlRenderPageScreenshotInput,
  HtmlRenderPageScreenshotOutput
> {
  return createBrowserHtmlScreenshotCapability({
    workspaceDirectory,
    browser: createRemoteBrowserPageService({ endpoint, auth }),
  });
}

export function createTesseractOcrMarkdownCapability({
  workspaceDirectory,
  binaryPath = "tesseract",
}: WorkspaceCapabilityFactoryOptions & {
  readonly binaryPath?: string | undefined;
}): ArtifactCapabilityImplementation<OcrMarkdownFromImageInput, OcrMarkdownFromImageOutput> {
  return {
    capability: OcrMarkdownFromImageCapability,
    run: (input) =>
      Effect.gen(function* () {
        const imagePath = input.path
          ? yield* safeWorkspacePath(workspaceDirectory, input.path)
          : yield* writeTemporaryImage(workspaceDirectory, input.content, input.mediaType);
        const markdown = yield* Effect.callback<string, unknown>((resume) => {
          execFile(binaryPath, [imagePath, "stdout"], { encoding: "utf8" }, (error, stdout) => {
            if (error) {
              resume(Effect.fail(error));
              return;
            }
            resume(Effect.succeed(stdout.trim()));
          });
        });
        return { markdown };
      }),
  };
}

export function createAiImageToMarkdownCapability({
  workspaceDirectory = ".",
  model,
  prompt = "Transcribe the provided image to Markdown. Return only Markdown.",
}: {
  readonly workspaceDirectory?: string | undefined;
  readonly model: LanguageModel.Service;
  readonly prompt?: string | undefined;
}): ArtifactCapabilityImplementation<OcrMarkdownFromImageInput, OcrMarkdownFromImageOutput> {
  return {
    capability: OcrMarkdownFromImageCapability,
    run: (input) =>
      Effect.gen(function* () {
        const content =
          input.content ?? (yield* readInputText(workspaceDirectory, input.path, undefined));
        const response = yield* model.generateText({
          prompt: {
            content: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  {
                    type: "file",
                    mediaType: input.mediaType ?? "image/png",
                    data: content,
                  },
                ],
              },
            ],
          },
        } as any);
        return { markdown: stripMarkdownFences(response.text.trim()) };
      }),
  };
}

export function createRemoteOcrMarkdownCapability({
  endpoint,
  auth,
}: RemoteCapabilityOptions): ArtifactCapabilityImplementation<
  OcrMarkdownFromImageInput,
  OcrMarkdownFromImageOutput
> {
  return {
    capability: OcrMarkdownFromImageCapability,
    run: (input) =>
      Effect.gen(function* () {
        const response = yield* postRemoteJson(endpoint, auth, input);
        const result = response as { readonly markdown?: string; readonly confidence?: number };
        if (result.markdown === undefined) {
          return yield* Effect.fail(
            new Error("Remote ocr.markdownFromImage response missing markdown."),
          );
        }
        return compact({ markdown: result.markdown, confidence: result.confidence });
      }),
  };
}

export function createScreenshotBackedPdf(
  options: CreateScreenshotBackedPdfOptions,
): Effect.Effect<ScreenshotBackedPdfMetadata, unknown> {
  return Effect.gen(function* () {
    const workspaceDirectory = options.workspaceDirectory ?? ".";
    const pdf = yield* Effect.promise(() => PDFDocument.create());
    const metadataPages: ScreenshotBackedPdfMetadata["pages"][number][] = [];
    for (const [index, pageInput] of options.pages.entries()) {
      const screenshotPath = yield* safeWorkspacePath(workspaceDirectory, pageInput.screenshotPath);
      const imageBytes = yield* readFileBytes(screenshotPath);
      const image = yield* Effect.promise(() => pdf.embedPng(imageBytes));
      const page = pdf.addPage([pageInput.width, pageInput.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: pageInput.width,
        height: pageInput.height,
      });
      metadataPages.push({
        page: index + 1,
        screenshotPath: pageInput.screenshotPath,
        width: pageInput.width,
        height: pageInput.height,
        pdfWidth: pageInput.width,
        pdfHeight: pageInput.height,
      });
    }
    const outputPath = yield* safeWorkspacePath(workspaceDirectory, options.outputPath);
    yield* ensureParentDirectory(outputPath);
    yield* writeFileBytes(outputPath, yield* Effect.promise(() => pdf.save()));
    return {
      coordinateSystem: "screenshot-pixels",
      screenshotMode: "native-source",
      pages: metadataPages,
    };
  });
}

function readInputText(
  workspaceDirectory: string,
  path: string | undefined,
  content: string | undefined,
): Effect.Effect<string, unknown> {
  if (content !== undefined) return Effect.succeed(content);
  if (!path) return Effect.fail(new Error("Capability input requires either path or content."));
  return safeWorkspacePath(workspaceDirectory, path).pipe(
    Effect.flatMap((absolutePath) => readFileText(absolutePath)),
  );
}

function readInputBytesOrString(
  workspaceDirectory: string,
  path: string | undefined,
  content: string | undefined,
): Effect.Effect<Uint8Array | string, unknown> {
  if (content !== undefined) return Effect.succeed(content);
  if (!path) return Effect.fail(new Error("Capability input requires either path or content."));
  return safeWorkspacePath(workspaceDirectory, path).pipe(
    Effect.flatMap((absolutePath) => readFileBytes(absolutePath)),
  );
}

function writeOptionalBase64File(
  workspaceDirectory: string,
  path: string | undefined,
  base64: string,
): Effect.Effect<void, unknown> {
  if (!path) return Effect.void;
  return safeWorkspacePath(workspaceDirectory, path).pipe(
    Effect.flatMap((absolutePath) =>
      ensureParentDirectory(absolutePath).pipe(
        Effect.flatMap(() => writeFileBytes(absolutePath, base64ToBytes(base64))),
      ),
    ),
  );
}

function safeWorkspacePath(root: string, filePath: string): Effect.Effect<string, unknown> {
  return Effect.sync(() => {
    if (nodePath.isAbsolute(filePath)) {
      throw new Error(`Absolute workspace paths are not allowed: ${filePath}`);
    }
    const normalized = filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
      throw new Error(`Unsafe workspace path: ${filePath}`);
    }
    const absoluteRoot = nodePath.resolve(root);
    const absolutePath = nodePath.resolve(absoluteRoot, normalized);
    const relativePath = nodePath.relative(absoluteRoot, absolutePath);
    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${nodePath.sep}`) ||
      nodePath.isAbsolute(relativePath)
    ) {
      throw new Error(`Workspace path escapes root: ${filePath}`);
    }
    return absolutePath;
  });
}

function readFileText(path: string): Effect.Effect<string, unknown> {
  return Effect.promise(() => readFile(path, "utf8"));
}

function readFileBytes(path: string): Effect.Effect<Uint8Array, unknown> {
  return Effect.promise(() => readFile(path));
}

function writeFileBytes(path: string, bytes: Uint8Array): Effect.Effect<void, unknown> {
  return Effect.promise(() => writeFile(path, bytes));
}

function ensureParentDirectory(path: string): Effect.Effect<void, unknown> {
  return Effect.promise(() => mkdir(nodePath.dirname(path), { recursive: true })).pipe(
    Effect.asVoid,
  );
}

function writeTemporaryImage(
  workspaceDirectory: string,
  content: string | undefined,
  mediaType: string | undefined,
): Effect.Effect<string, unknown> {
  if (!content) return Effect.fail(new Error("OCR input requires either path or content."));
  const extension = mediaType?.includes("jpeg") || mediaType?.includes("jpg") ? "jpg" : "png";
  const path = `.schematics/tmp/ocr-${Date.now().toString(36)}.${extension}`;
  return safeWorkspacePath(workspaceDirectory, path).pipe(
    Effect.flatMap((absolutePath) =>
      ensureParentDirectory(absolutePath).pipe(
        Effect.flatMap(() => writeFileBytes(absolutePath, base64ToBytes(content))),
        Effect.as(absolutePath),
      ),
    ),
  );
}

function stripMarkdownFences(markdown: string): string {
  const match = markdown.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? markdown;
}

function base64ToBytes(base64: string): Uint8Array {
  const dataUrl = base64.match(/^data:[^,]*;base64,([\s\S]*)$/i);
  const binary = atob((dataUrl?.[1] ?? base64).replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function compact<T extends Readonly<Record<string, unknown>>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as unknown as T;
}

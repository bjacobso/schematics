import { Effect } from "effect";
import {
  HTML_RENDER_PAGE_SCREENSHOT_CAPABILITY_ID,
  PDF_RENDER_PAGE_CAPABILITY_ID,
  BrowserPageService,
  type BrowserPageService as BrowserPageServiceShape,
} from "./media-capabilities";

const DEFAULT_PDF_JS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs";

export interface BrowserPageLike {
  readonly setViewport?: (viewport: {
    readonly width: number;
    readonly height: number;
  }) => Promise<void>;
  readonly setContent: (html: string, options?: Readonly<Record<string, unknown>>) => Promise<void>;
  readonly screenshot: (
    options?: Readonly<Record<string, unknown>>,
  ) => Promise<string | Uint8Array>;
  readonly evaluate: <Result, Arg>(
    pageFunction: (arg: Arg) => Result | Promise<Result>,
    arg: Arg,
  ) => Promise<Result>;
  readonly viewport?: () => { readonly width: number; readonly height: number } | null;
  readonly close?: () => Promise<void>;
}

export interface BrowserSessionLike {
  readonly newPage: () => Promise<BrowserPageLike>;
  readonly close: () => Promise<void>;
}

export interface PuppeteerLauncherLike {
  readonly launch: (options?: unknown) => Promise<BrowserSessionLike>;
}

export interface CloudflarePuppeteerLauncherLike {
  readonly launch: (binding: unknown) => Promise<BrowserSessionLike>;
}

export interface PuppeteerBrowserPageServiceOptions {
  readonly launchOptions?: unknown | undefined;
  readonly puppeteer?: PuppeteerLauncherLike | undefined;
  readonly puppeteerSpecifier?: string | undefined;
  readonly pdfJsUrl?: string | undefined;
}

export interface CloudflareBrowserPageServiceOptions {
  readonly browserBinding: unknown;
  readonly puppeteer?: CloudflarePuppeteerLauncherLike | undefined;
  readonly puppeteerSpecifier?: string | undefined;
  readonly pdfJsUrl?: string | undefined;
}

export interface RemoteCapabilityOptions {
  readonly endpoint: string;
  readonly auth?:
    | string
    | Readonly<Record<string, string>>
    | (() => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>)
    | undefined;
}

export interface RemoteBrowserPageServiceOptions extends RemoteCapabilityOptions {
  readonly htmlScreenshotEndpoint?: string | undefined;
  readonly pdfRenderEndpoint?: string | undefined;
}

export function createPuppeteerBrowserPageService({
  launchOptions,
  puppeteer,
  puppeteerSpecifier = "puppeteer",
  pdfJsUrl = DEFAULT_PDF_JS_URL,
}: PuppeteerBrowserPageServiceOptions = {}): BrowserPageServiceShape {
  return createLaunchingBrowserPageService({
    launch: async () =>
      (puppeteer ?? (await optionalImport(puppeteerSpecifier))).launch(launchOptions ?? {}),
    pdfJsUrl,
  });
}

export function createCloudflareBrowserPageService({
  browserBinding,
  puppeteer,
  puppeteerSpecifier = "@cloudflare/puppeteer",
  pdfJsUrl = DEFAULT_PDF_JS_URL,
}: CloudflareBrowserPageServiceOptions): BrowserPageServiceShape {
  return createLaunchingBrowserPageService({
    launch: async () =>
      (puppeteer ?? (await optionalImport(puppeteerSpecifier))).launch(browserBinding),
    pdfJsUrl,
  });
}

export function createRemoteBrowserPageService({
  endpoint,
  htmlScreenshotEndpoint,
  pdfRenderEndpoint,
  auth,
}: RemoteBrowserPageServiceOptions): BrowserPageServiceShape {
  return BrowserPageService.of({
    renderHtmlPageScreenshot: (input) =>
      postRemoteJson(htmlScreenshotEndpoint ?? endpoint, auth, {
        capability: HTML_RENDER_PAGE_SCREENSHOT_CAPABILITY_ID,
        input: {
          html: typeof input.html === "string" ? input.html : utf8(input.html),
          baseUrl: input.baseUrl,
          viewport: input.viewport,
          margin: input.margin,
        },
      }).pipe(
        Effect.flatMap((response) =>
          decodeRenderedImageResponse(response, "html.renderPageScreenshot"),
        ),
      ),
    renderPdfPage: (input) =>
      postRemoteJson(pdfRenderEndpoint ?? endpoint, auth, {
        capability: PDF_RENDER_PAGE_CAPABILITY_ID,
        input: {
          pdf: typeof input.pdf === "string" ? input.pdf : bytesToBase64(input.pdf),
          page: input.page,
          scale: input.scale,
        },
      }).pipe(
        Effect.flatMap((response) => decodeRenderedImageResponse(response, "pdf.renderPage")),
      ),
  });
}

export function postRemoteJson(
  endpoint: string,
  auth: RemoteCapabilityOptions["auth"],
  body: unknown,
): Effect.Effect<unknown, unknown> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(await authHeaders(auth)),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(
          `Remote capability request failed (${response.status}): ${await response.text()}`,
        );
      }
      return response.json();
    },
    catch: (error) => error,
  });
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function createLaunchingBrowserPageService({
  launch,
  pdfJsUrl,
}: {
  readonly launch: () => Promise<BrowserSessionLike>;
  readonly pdfJsUrl: string;
}): BrowserPageServiceShape {
  return BrowserPageService.of({
    renderHtmlPageScreenshot: (input) =>
      Effect.tryPromise({
        try: () =>
          withBrowserPage(launch, async (page) => {
            if (input.viewport) {
              await page.setViewport?.(input.viewport);
            }
            await page.setContent(
              prepareHtml(typeof input.html === "string" ? input.html : utf8(input.html), {
                baseUrl: input.baseUrl,
                margin: input.margin,
              }),
              { waitUntil: "networkidle0" },
            );
            const screenshot = await page.screenshot({
              type: "png",
              fullPage: input.viewport === undefined,
              encoding: "base64",
            });
            const viewport = page.viewport?.();
            return compact({
              mediaType: "image/png" as const,
              content: typeof screenshot === "string" ? screenshot : bytesToBase64(screenshot),
              width: viewport?.width,
              height: viewport?.height,
            });
          }),
        catch: (error) => error,
      }),
    renderPdfPage: (input) =>
      Effect.tryPromise({
        try: () =>
          withBrowserPage(launch, async (page) =>
            renderPdfPageWithPdfJs(page, {
              pdfBase64:
                typeof input.pdf === "string"
                  ? normalizeBase64(input.pdf)
                  : bytesToBase64(input.pdf),
              page: input.page,
              scale: input.scale ?? 1,
              pdfJsUrl,
            }),
          ),
        catch: (error) => error,
      }),
  });
}

async function withBrowserPage<T>(
  launch: () => Promise<BrowserSessionLike>,
  usePage: (page: BrowserPageLike) => Promise<T>,
): Promise<T> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    try {
      return await usePage(page);
    } finally {
      await page.close?.();
    }
  } finally {
    await browser.close();
  }
}

async function renderPdfPageWithPdfJs(
  page: BrowserPageLike,
  input: {
    readonly pdfBase64: string;
    readonly page: number;
    readonly scale: number;
    readonly pdfJsUrl: string;
  },
): Promise<{
  readonly mediaType: "image/png";
  readonly content: string;
  readonly width: number;
  readonly height: number;
}> {
  await page.setContent("<!doctype html><html><body></body></html>", { waitUntil: "load" });
  return page.evaluate(async ({ pdfBase64, page: pageNumber, scale, pdfJsUrl }) => {
    const pdfjs = await import(/* @vite-ignore */ pdfJsUrl);
    const binary = atob(pdfBase64);
    const data = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      data[index] = binary.charCodeAt(index) & 0xff;
    }
    const loadingTask = pdfjs.getDocument({ data, disableWorker: true });
    const document = await loadingTask.promise;
    if (pageNumber < 1 || pageNumber > document.numPages) {
      throw new Error(
        `PDF page ${pageNumber} is outside the document page range 1-${document.numPages}.`,
      );
    }
    const pdfPage = await document.getPage(pageNumber);
    const viewport = pdfPage.getViewport({ scale });
    const browserDocument = (
      globalThis as unknown as {
        readonly document: {
          readonly createElement: (tagName: "canvas") => {
            width: number;
            height: number;
            readonly getContext: (contextId: "2d") => unknown;
            readonly toDataURL: (mediaType: "image/png") => string;
          };
        };
      }
    ).document;
    const canvas = browserDocument.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Browser canvas 2D context is unavailable.");
    await pdfPage.render({ canvasContext: context, viewport }).promise;
    const dataUrl = canvas.toDataURL("image/png");
    return {
      mediaType: "image/png" as const,
      content: dataUrl.slice(dataUrl.indexOf(",") + 1),
      width: canvas.width,
      height: canvas.height,
    };
  }, input);
}

function prepareHtml(
  html: string,
  options: {
    readonly baseUrl?: string | undefined;
    readonly margin?: number | undefined;
  },
): string {
  const additions = [
    options.baseUrl ? `<base href="${escapeHtmlAttribute(options.baseUrl)}">` : "",
    options.margin !== undefined
      ? `<style>body{margin:${Math.max(0, options.margin)}px;}</style>`
      : "",
  ].join("");
  if (!additions) return html;
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${additions}`);
  return `<!doctype html><html><head>${additions}</head><body>${html}</body></html>`;
}

async function optionalImport(specifier: string): Promise<any> {
  try {
    return await import(/* @vite-ignore */ specifier);
  } catch (error) {
    throw new Error(
      `Optional dependency ${specifier} is required for this host capability: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function authHeaders(
  auth: RemoteCapabilityOptions["auth"],
): Promise<Readonly<Record<string, string>>> {
  if (!auth) return {};
  if (typeof auth === "string") return { Authorization: auth };
  if (typeof auth === "function") return auth();
  return auth;
}

function decodeRenderedImageResponse(
  response: unknown,
  capability: string,
): Effect.Effect<
  {
    readonly mediaType: "image/png";
    readonly content: string;
    readonly width?: number | undefined;
    readonly height?: number | undefined;
  },
  Error
> {
  return Effect.sync(() => {
    const rendered =
      isRecord(response) && isRecord(response["output"]) ? response["output"] : response;
    if (!isRecord(rendered) || typeof rendered["content"] !== "string") {
      throw new Error(`Remote ${capability} response missing content.`);
    }
    return compact({
      mediaType: "image/png" as const,
      content: rendered["content"],
      width: typeof rendered["width"] === "number" ? rendered["width"] : undefined,
      height: typeof rendered["height"] === "number" ? rendered["height"] : undefined,
    });
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function normalizeBase64(value: string): string {
  const dataUrl = value.match(/^data:[^,]*;base64,([\s\S]*)$/i);
  return (dataUrl?.[1] ?? value).replace(/\s+/g, "");
}

function utf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function compact<T extends Readonly<Record<string, unknown>>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as unknown as T;
}

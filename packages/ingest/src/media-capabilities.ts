import { Context, Effect, Schema } from "effect";
import { defineCapability } from "./workflow";

export const PDF_RENDER_PAGE_CAPABILITY_ID = "pdf.renderPage" as const;
export const HTML_RENDER_PAGE_SCREENSHOT_CAPABILITY_ID = "html.renderPageScreenshot" as const;
export const OCR_MARKDOWN_FROM_IMAGE_CAPABILITY_ID = "ocr.markdownFromImage" as const;
export const IMAGE_IDENTIFY_REGIONS_CAPABILITY_ID = "image.identifyRegions" as const;

export const PdfRenderPageInputSchema = Schema.Struct({
  path: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  page: Schema.Number,
  scale: Schema.optional(Schema.Number),
  outputPath: Schema.optional(Schema.String),
});

export const PdfRenderPageOutputSchema = Schema.Struct({
  path: Schema.String,
  page: Schema.Number,
  mediaType: Schema.String,
  content: Schema.String,
  outputPath: Schema.optional(Schema.String),
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
});

export type PdfRenderPageInput = typeof PdfRenderPageInputSchema.Type;
export type PdfRenderPageOutput = typeof PdfRenderPageOutputSchema.Type;

export const PdfRenderPageCapability = defineCapability<PdfRenderPageInput, PdfRenderPageOutput>({
  id: PDF_RENDER_PAGE_CAPABILITY_ID,
  input: PdfRenderPageInputSchema,
  output: PdfRenderPageOutputSchema,
});

export const HtmlRenderPageScreenshotInputSchema = Schema.Struct({
  path: Schema.optional(Schema.String),
  html: Schema.optional(Schema.String),
  baseUrl: Schema.optional(Schema.String),
  viewport: Schema.optional(
    Schema.Struct({
      width: Schema.Number,
      height: Schema.Number,
    }),
  ),
  margin: Schema.optional(Schema.Number),
  outputPath: Schema.optional(Schema.String),
});

export const HtmlRenderPageScreenshotOutputSchema = Schema.Struct({
  path: Schema.optional(Schema.String),
  mediaType: Schema.Literal("image/png"),
  content: Schema.String,
  outputPath: Schema.optional(Schema.String),
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
});

export type HtmlRenderPageScreenshotInput = typeof HtmlRenderPageScreenshotInputSchema.Type;
export type HtmlRenderPageScreenshotOutput = typeof HtmlRenderPageScreenshotOutputSchema.Type;

export const HtmlRenderPageScreenshotCapability = defineCapability<
  HtmlRenderPageScreenshotInput,
  HtmlRenderPageScreenshotOutput
>({
  id: HTML_RENDER_PAGE_SCREENSHOT_CAPABILITY_ID,
  input: HtmlRenderPageScreenshotInputSchema,
  output: HtmlRenderPageScreenshotOutputSchema,
});

export const OcrMarkdownFromImageInputSchema = Schema.Struct({
  path: Schema.optional(Schema.String),
  mediaType: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
});

export const OcrMarkdownFromImageOutputSchema = Schema.Struct({
  markdown: Schema.String,
  confidence: Schema.optional(Schema.Number),
});

export type OcrMarkdownFromImageInput = typeof OcrMarkdownFromImageInputSchema.Type;
export type OcrMarkdownFromImageOutput = typeof OcrMarkdownFromImageOutputSchema.Type;

export const OcrMarkdownFromImageCapability = defineCapability<
  OcrMarkdownFromImageInput,
  OcrMarkdownFromImageOutput
>({
  id: OCR_MARKDOWN_FROM_IMAGE_CAPABILITY_ID,
  input: OcrMarkdownFromImageInputSchema,
  output: OcrMarkdownFromImageOutputSchema,
});

export const ImageRegionSchema = Schema.Struct({
  label: Schema.String,
  confidence: Schema.optional(Schema.Number),
  bounds: Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
  }),
});

export const ImageIdentifyRegionsInputSchema = Schema.Struct({
  path: Schema.optional(Schema.String),
  mediaType: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
});

export const ImageIdentifyRegionsOutputSchema = Schema.Struct({
  regions: Schema.Array(ImageRegionSchema),
});

export type ImageIdentifyRegionsInput = typeof ImageIdentifyRegionsInputSchema.Type;
export type ImageIdentifyRegionsOutput = typeof ImageIdentifyRegionsOutputSchema.Type;

export const ImageIdentifyRegionsCapability = defineCapability<
  ImageIdentifyRegionsInput,
  ImageIdentifyRegionsOutput
>({
  id: IMAGE_IDENTIFY_REGIONS_CAPABILITY_ID,
  input: ImageIdentifyRegionsInputSchema,
  output: ImageIdentifyRegionsOutputSchema,
});

export interface BrowserPageService {
  readonly renderHtmlPageScreenshot: (input: {
    readonly html: string | Uint8Array;
    readonly baseUrl?: string | undefined;
    readonly viewport?: { readonly width: number; readonly height: number } | undefined;
    readonly margin?: number | undefined;
  }) => Effect.Effect<
    {
      readonly mediaType: "image/png";
      readonly content: string;
      readonly width?: number | undefined;
      readonly height?: number | undefined;
    },
    unknown
  >;

  readonly renderPdfPage: (input: {
    readonly pdf: Uint8Array | string;
    readonly page: number;
    readonly scale?: number | undefined;
  }) => Effect.Effect<
    {
      readonly mediaType: "image/png";
      readonly content: string;
      readonly width?: number | undefined;
      readonly height?: number | undefined;
    },
    unknown
  >;
}

export const BrowserPageService = Context.Service<BrowserPageService>(
  "schematics/BrowserPageService",
);

# Media Host Capabilities

Provider ingestion workflows can depend on stable capability IDs:

- `pdf.renderPage`
- `html.renderPageScreenshot`
- `ocr.markdownFromImage`

Hosts decide how those capabilities are implemented. The workflow should not branch on local
Node, an IDE/RPC process, Cloudflare Browser Rendering, or a remote renderer.

## Local Node

```ts
import {
  createPuppeteerHtmlScreenshotCapability,
  createPuppeteerPdfRenderPageCapability,
  createTesseractOcrMarkdownCapability,
} from "@schematics/ingest/node";

export default {
  workflowCapabilities: ({ directory, runtime }) => {
    if (runtime !== "node") return [];

    return [
      createPuppeteerPdfRenderPageCapability({ workspaceDirectory: directory }),
      createPuppeteerHtmlScreenshotCapability({ workspaceDirectory: directory }),
      createTesseractOcrMarkdownCapability({ workspaceDirectory: directory }),
    ];
  },
};
```

`puppeteer` is loaded dynamically by the host adapter. If it is not installed, the capability
fails with a message naming the missing optional dependency.

## Shared Browser Service

Use a single browser service when PDF pages and HTML screenshots should share the same host.

```ts
import { createPuppeteerBrowserPageService } from "@schematics/ingest";
import {
  createBrowserHtmlScreenshotCapability,
  createBrowserPdfRenderPageCapability,
} from "@schematics/ingest/node";

export default {
  workflowCapabilities: ({ directory }) => {
    const browser = createPuppeteerBrowserPageService();
    return [
      createBrowserPdfRenderPageCapability({ workspaceDirectory: directory, browser }),
      createBrowserHtmlScreenshotCapability({ workspaceDirectory: directory, browser }),
    ];
  },
};
```

## Cloudflare Browser Rendering

The Cloudflare adapter is structural, so core packages do not depend on Cloudflare types.
Pass the Browser Rendering binding from the worker environment.

```ts
import {
  createAiImageToMarkdownCapability,
  createCloudflareBrowserHtmlScreenshotCapability,
  createCloudflareBrowserPdfRenderPageCapability,
  createTesseractOcrMarkdownCapability,
  createPuppeteerPdfRenderPageCapability,
} from "@schematics/ingest/node";

export default {
  workflowCapabilities: ({ directory, runtime, env }) => {
    if (runtime === "node") {
      return [
        createPuppeteerPdfRenderPageCapability({ workspaceDirectory: directory }),
        createTesseractOcrMarkdownCapability({ workspaceDirectory: directory }),
      ];
    }

    if (runtime === "cloudflare") {
      return [
        createCloudflareBrowserPdfRenderPageCapability({
          workspaceDirectory: directory,
          browserBinding: env.BROWSER,
        }),
        createCloudflareBrowserHtmlScreenshotCapability({
          workspaceDirectory: directory,
          browserBinding: env.BROWSER,
        }),
        createAiImageToMarkdownCapability({ model: env.MODEL }),
      ];
    }

    return [];
  },
};
```

The Cloudflare adapter dynamically imports `@cloudflare/puppeteer`, so that package remains a
host dependency rather than a base ingestion dependency.

## Remote Renderer

Remote browser rendering can be wired either as direct capability endpoints or as a shared
browser service endpoint.

```ts
import { createRemoteBrowserPageService } from "@schematics/ingest";
import {
  createBrowserHtmlScreenshotCapability,
  createBrowserPdfRenderPageCapability,
} from "@schematics/ingest/node";

export default {
  workflowCapabilities: ({ directory, runtime, env }) => {
    if (runtime !== "rpc") return [];

    const browser = createRemoteBrowserPageService({
      endpoint: env.RENDERER_URL,
      auth: () => ({ Authorization: `Bearer ${env.RENDERER_TOKEN}` }),
    });

    return [
      createBrowserPdfRenderPageCapability({ workspaceDirectory: directory, browser }),
      createBrowserHtmlScreenshotCapability({ workspaceDirectory: directory, browser }),
    ];
  },
};
```

Remote browser service requests are JSON posts with `{ capability, input }`. Direct remote
capability factories are also available from `@schematics/ingest/node` when the host exposes
separate endpoints for each operation.

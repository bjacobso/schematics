import { expect, type Page, type TestInfo } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface WalkthroughCaption {
  readonly title: string;
  readonly body: string;
}

export interface WalkthroughCaptureOptions {
  readonly caption?: WalkthroughCaption | undefined;
  readonly maxDiffPixels?: number | undefined;
}

export function createWalkthrough(testInfo: TestInfo) {
  const captions: Record<string, WalkthroughCaption> = {};

  async function persistCaptions(snapshotPath: string): Promise<void> {
    const captionsPath = join(dirname(snapshotPath), "captions.json");
    const next = `${JSON.stringify(captions, null, 2)}\n`;
    let current = "";
    try {
      current = await readFile(captionsPath, "utf8");
    } catch {
      current = "";
    }

    if (current !== next) {
      await mkdir(dirname(captionsPath), { recursive: true });
      await writeFile(captionsPath, next);
    }
  }

  return {
    async capture(
      page: Page,
      name: string,
      options: WalkthroughCaptureOptions = {},
    ): Promise<void> {
      if (options.caption) {
        captions[name] = options.caption;
      }

      await expect(page).toHaveScreenshot(`${name}.png`, {
        fullPage: false,
        ...(options.maxDiffPixels != null ? { maxDiffPixels: options.maxDiffPixels } : {}),
      });

      await persistCaptions(testInfo.snapshotPath(`${name}.png`));
    },
  };
}

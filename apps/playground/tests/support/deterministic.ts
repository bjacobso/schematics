import type { Page } from "@playwright/test";

export async function installDeterministicBrowserEnvironment(page: Page): Promise<void> {
  await page.addInitScript(`
    (() => {
      const fixedTime = Date.parse("2026-02-25T12:00:00.000Z");
      const RealDate = Date;

      function FixedDate(...args) {
        if (this instanceof FixedDate) {
          return args.length === 0 ? new RealDate(fixedTime) : new RealDate(...args);
        }
        return new RealDate(fixedTime).toString();
      }

      Object.setPrototypeOf(FixedDate, RealDate);
      FixedDate.prototype = RealDate.prototype;
      FixedDate.now = () => fixedTime;
      FixedDate.parse = RealDate.parse;
      FixedDate.UTC = RealDate.UTC;
      globalThis.Date = FixedDate;

      let nextRandom = 0;
      Math.random = () => {
        nextRandom = (nextRandom + 1) % 1000;
        return nextRandom / 1000;
      };

      if (globalThis.crypto?.randomUUID) {
        let nextId = 0;
        globalThis.crypto.randomUUID = () => {
          nextId += 1;
          return "00000000-0000-4000-8000-" + String(nextId).padStart(12, "0");
        };
      }

      localStorage.setItem("schematics-playground-theme", "light");
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }),
      });

      const style = document.createElement("style");
      style.textContent = [
        "*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; caret-color: transparent !important; }",
        ".cm-cursor, .cm-dropCursor, .MuiTouchRipple-root { display: none !important; }",
      ].join("\\n");
      document.documentElement.appendChild(style);
    })();
  `);
}

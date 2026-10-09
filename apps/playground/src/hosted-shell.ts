// Load Astro's generated app entry while preserving the hosted /w/{id} URL.
// Keeping the entry out of the homepage's import graph also keeps the IDE's
// styles and React chunks out of Astro's homepage preloads.
export async function bootHostedWorkspace() {
  const appUrl = new URL(`${import.meta.env.BASE_URL}playground/`, location.origin);
  const response = await fetch(appUrl);
  if (!response.ok) throw new Error(`Could not load the playground (${response.status})`);
  const shell = new DOMParser().parseFromString(await response.text(), "text/html");
  const modules = shell.querySelectorAll<HTMLScriptElement>('script[type="module"]');
  if (modules.length === 0) throw new Error("The playground page has no browser entry");

  document.getElementById("root")!.replaceChildren();
  document.title = shell.title;
  document.body.removeAttribute("data-homepage");
  for (const stylesheet of shell.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL(stylesheet.getAttribute("href")!, appUrl).href;
    document.head.append(link);
  }
  // Preserve ordering for the Vite development preamble and the app entry.
  for (const source of modules) {
    const script = document.createElement("script");
    script.type = "module";
    script.async = false;
    const src = source.getAttribute("src");
    if (src) script.src = new URL(src, appUrl).href;
    else script.textContent = source.textContent;
    document.head.append(script);
  }
}

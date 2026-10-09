// The initial homepage entry uses only browser APIs. Foldkit, Effect, and
// Foldworks stay in a dynamic chunk until a demo approaches the viewport.
export function startHomepage() {
  const dispose: Array<() => void> = [];
  const mounted = new WeakSet<HTMLElement>();
  const pending = new WeakSet<HTMLElement>();
  let active = true;
  const mount = async (container: HTMLElement) => {
    if (mounted.has(container) || pending.has(container)) return;
    pending.add(container);
    try {
      const { mountDemo } = await import("./demos");
      if (!active || !container.isConnected) return;
      const handle = mountDemo(container);
      mounted.add(container);
      dispose.push(() => handle.dispose());
    } catch (error) {
      console.error("Could not load homepage simulation", error);
      container.textContent = "The simulation could not load. Reload the page to try again.";
    } finally {
      pending.delete(container);
    }
  };
  const containers = document.querySelectorAll<HTMLElement>("[data-foldkit-demo]");
  if (typeof IntersectionObserver === "undefined") {
    containers.forEach((container) => void mount(container));
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            observer.unobserve(entry.target);
            void mount(entry.target as HTMLElement);
          }
      },
      { rootMargin: "250px" },
    );
    containers.forEach((container) => observer.observe(container));
    dispose.push(() => observer.disconnect());
  }

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reducedMotion && typeof IntersectionObserver !== "undefined") {
    const reveals = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.remove("is-pending");
            entry.target.classList.add("is-visible");
            reveals.unobserve(entry.target);
          }
      },
      { threshold: 0.12 },
    );
    document.querySelectorAll<HTMLElement>(".reveal").forEach((element) => {
      element.classList.add("is-pending");
      reveals.observe(element);
    });
    dispose.push(() => reveals.disconnect());
  }
  if (!reducedMotion) dispose.push(animateTerminal());

  // pagehide includes bfcache navigation. Dispose commands and observers when
  // leaving, and reinitialize when the browser restores the cached document.
  const cleanup = () => {
    active = false;
    dispose.forEach((stop) => stop());
    window.addEventListener(
      "pageshow",
      (event) => {
        if (event.persisted) startHomepage();
      },
      { once: true },
    );
  };
  window.addEventListener("pagehide", cleanup, { once: true });
}

function animateTerminal(): () => void {
  const entries = [...document.querySelectorAll<HTMLElement>(".repl-entry")];
  const calls = entries.map((entry) => entry.querySelector<HTMLElement>("[data-call]")!);
  const results = entries.map((entry) => entry.querySelector<HTMLElement>(".repl-result")!);
  const fullCalls = calls.map((call) => call.textContent ?? "");
  const title = document.querySelector<HTMLElement>(".repl-title strong");
  let index = 0;
  let typed = 0;
  let timer = 0;
  const begin = () => {
    entries.forEach((entry, i) => {
      entry.hidden = i > index || i < index - 3;
    });
    calls[index]!.textContent = "";
    calls[index]!.classList.add("term-cursor");
    results[index]!.hidden = true;
    if (title) title.textContent = `@schema-reflection/${entries[index]!.dataset["package"]}`;
    tick();
  };
  const tick = () => {
    const full = fullCalls[index]!;
    calls[index]!.textContent = full.slice(0, typed++);
    if (typed <= full.length) timer = window.setTimeout(tick, 30);
    else
      timer = window.setTimeout(() => {
        calls[index]!.classList.remove("term-cursor");
        results[index]!.hidden = false;
        timer = window.setTimeout(() => {
          index = (index + 1) % entries.length;
          typed = 0;
          begin();
        }, 1750);
      }, 240);
  };
  if (entries.length) begin();
  return () => {
    window.clearTimeout(timer);
    entries.forEach((entry) => {
      entry.hidden = false;
    });
    calls.forEach((call, i) => {
      call.textContent = fullCalls[i]!;
      call.classList.remove("term-cursor");
    });
    results.forEach((result) => {
      result.hidden = false;
    });
  };
}

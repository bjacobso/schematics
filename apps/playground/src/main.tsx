import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import Landing from "./Landing";
import "./styles.css";

// The IDE is heavy (CodeMirror, MUI, Effect, git, examples). Keep it out of the
// landing-page bundle by lazy-loading it only for the app routes.
const PlaygroundApp = lazy(() => import("./PlaygroundApp"));

// Manual path routing matches the existing no-router style. The Cloudflare
// deployment serves every path from this single index.html
// (notFoundHandling: "single-page-application"), so routing is decided here.
//   /                  → marketing landing page
//   /playground[/]     → the in-browser IDE playground
//   /w/{id}            → a hosted Cloudflare workspace
function isPlaygroundRoute(pathname: string): boolean {
  return (
    pathname === "/playground" || pathname === "/playground/" || /^\/w\/[^/]+\/?$/.test(pathname)
  );
}

function Root() {
  if (isPlaygroundRoute(window.location.pathname)) {
    return (
      <Suspense fallback={null}>
        <PlaygroundApp />
      </Suspense>
    );
  }
  return <Landing />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

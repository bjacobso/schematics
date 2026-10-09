import { Code } from "./Code";
import type { Availability, Package } from "./packages";

export function StatusBadge({ availability }: { availability: Availability }) {
  switch (availability.kind) {
    case "published":
      return <span className="pkg-status is-published">Published · {availability.version}</span>;
    case "source":
      return <span className="pkg-status is-source">{availability.label} · source only</span>;
    case "planned":
      return <span className="pkg-status is-planned">Planned · spec only</span>;
  }
}

export function PackagePreview({ pkg }: { pkg: Package }) {
  return (
    <div className="pkg-window">
      <div className="window-bar">
        <span>{pkg.file}</span>
        <span>
          {pkg.availability.kind === "published"
            ? "npm API"
            : pkg.availability.kind === "planned"
              ? "proposed API"
              : "experimental source API"}
        </span>
      </div>
      <Code label={`${pkg.name} example`}>{pkg.code}</Code>
      <div className="window-bar window-bar-run">
        <span>{pkg.demo ? "▶ try it" : "▶ what you'd get"}</span>
        <span>{pkg.demo ? "simulated in your browser" : "illustration"}</span>
      </div>
      {pkg.demo ? (
        <div id={`demo-${pkg.demo}`} data-foldkit-demo={pkg.demo} className="demo demo-placeholder">
          <p>Interactive simulation loads when this panel comes into view.</p>
          <noscript>
            Enable JavaScript to try this simulation. The API example above is available without it.
          </noscript>
        </div>
      ) : (
        <div className="demo">{pkg.diagram}</div>
      )}
    </div>
  );
}

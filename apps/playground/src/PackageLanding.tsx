import { Mark } from "./landing/Mark";
import { Ascii } from "./landing/Ascii";
import { PackagePreview, StatusBadge } from "./landing/PackagePreview";
import { packages, type Package } from "./landing/packages";
import type { PackagePitch } from "./landing/pitches";

const sections = [
  ["why", "Why it matters"],
  ["unlocks", "What it unlocks"],
  ["usage", "How to use it"],
  ["composition", "How it composes"],
  ["boundaries", "Where it stops"],
] as const;

function SectionTitle({ index, title }: { index: string; title: string }) {
  return (
    <div className="package-section-title">
      <p className="eyebrow">
        <span className="eyebrow-index">{index}</span> {title}
      </p>
      <h2>{title}</h2>
    </div>
  );
}

export default function PackageLanding({ pkg, pitch }: { pkg: Package; pitch: PackagePitch }) {
  const published = pkg.availability.kind === "published";
  return (
    <div className={`suite-page package-page pkg-${pkg.name}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="suite-nav suite-container">
        <a className="suite-brand" href="/" aria-label="Schematics home">
          <Mark /> Schematics
        </a>
        <nav aria-label="Main navigation">
          <a href="/#packages">All packages</a>
          <a href="/#together">Example</a>
          <a href="/playground">Playground</a>
        </nav>
      </header>
      <main id="main">
        <section className="package-hero suite-container" aria-labelledby="package-title">
          <div className="package-hero-copy">
            <a className="package-back" href="/#packages">
              ← The library family
            </a>
            <p className="eyebrow">{pkg.kicker} as data</p>
            <p className="package-coordinate">
              <span>@schema-reflection/</span>
              {pkg.name}
            </p>
            <StatusBadge availability={pkg.availability} />
            <h1 id="package-title">{pkg.title}</h1>
            <p className="package-lede">{pitch.lede}</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#usage">
                {published ? "Start with an example" : "Explore the design"} ↓
              </a>
              <a className="button" href="#composition">
                See where it fits
              </a>
            </div>
          </div>
          <aside className="package-map" aria-label={`${pkg.name} at a glance`}>
            <p className="eyebrow">The piece it makes explicit</p>
            <Ascii label={`${pkg.name}: ${pitch.input} becomes ${pitch.output}.`}>
              {pitch.diagram}
            </Ascii>
            <dl>
              <div>
                <dt>Starts with</dt>
                <dd>{pitch.input}</dd>
              </div>
              <div>
                <dt>Gives you</dt>
                <dd>{pitch.output}</dd>
              </div>
            </dl>
          </aside>
        </section>
        <div className="package-toc suite-container">
          <nav aria-label="On this page">
            {sections.map(([id, label]) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
          </nav>
        </div>
        <div className="suite-container package-sections">
          <section className="package-section" id="why" aria-label="Why it matters">
            <SectionTitle index="01" title="Why it matters" />
            <div className="package-prose">
              <aside className="pkg-bug">
                <span className="bug-label">{pkg.storyLabel}</span>
                <p>{pkg.story}</p>
              </aside>
              {pitch.why.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </section>
          <section className="package-section" id="unlocks" aria-label="What it unlocks">
            <SectionTitle index="02" title="What it unlocks" />
            <div className="package-points">
              {pitch.unlocks.map((point, index) => (
                <article className="package-point" key={point.title}>
                  <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{point.title}</h3>
                    <p>{point.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
          <section className="package-section" id="usage" aria-label="How to use it">
            <SectionTitle index="03" title="How to use it" />
            <div className="package-prose">
              <p className="package-section-intro">{pitch.adoption}</p>
              <ol className="package-steps">
                {pitch.steps.map((step) => (
                  <li key={step.title}>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </li>
                ))}
              </ol>
              <div className="package-release">
                <StatusBadge availability={pkg.availability} />
                {published && pkg.availability.kind === "published" ? (
                  <>
                    <code className="install-command">
                      pnpm add @schema-reflection/{pkg.name}@{pkg.availability.version}
                    </code>
                    <a href={`https://www.npmjs.com/package/@schema-reflection/${pkg.name}`}>
                      View the npm release ↗
                    </a>
                  </>
                ) : (
                  <p>
                    {pkg.availability.kind === "planned"
                      ? "The example below is a proposed API. No implementation or npm release is available yet."
                      : "The example below describes the experimental source API. This package is not available on npm yet."}
                  </p>
                )}
                <p>{pitch.effect}</p>
              </div>
              <PackagePreview pkg={pkg} />
              <p className="package-demo-note">
                {pkg.demo
                  ? "The interactive panel is a Foldkit/Foldworks simulation of the behavior, not an execution of this package. The definition above is an API excerpt; supply your application's domain values and contracts."
                  : "The layout and output illustrate the specification. They do not execute a filesystem implementation."}
              </p>
            </div>
          </section>
          <section className="package-section" id="in-practice" aria-label="In practice">
            <SectionTitle index="04" title="In practice" />
            <div className="package-prose">
              <h3 className="package-scenario-title">{pitch.scenario.title}</h3>
              <p>{pitch.scenario.intro}</p>
              <ol className="package-scenario">
                {pitch.scenario.steps.map((step) => (
                  <li key={step.title}>
                    <h4>{step.title}</h4>
                    <p>{step.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>
          <section className="package-section" id="composition" aria-label="How it composes">
            <SectionTitle index="05" title="How it composes" />
            <div className="package-prose">
              <p className="package-section-intro">
                Each library owns one kind of meaning. Combine the ones your application needs, with
                an explicit boundary between their jobs.
              </p>
              <ul className="package-composition">
                {pitch.composition.map((peer) => (
                  <li key={peer.name}>
                    <a className={`package-peer pkg-${peer.name}`} href={`/packages/${peer.name}/`}>
                      <span>{pkg.name} +</span> {peer.name} <span aria-hidden="true">↗</span>
                    </a>
                    <p>{peer.body}</p>
                  </li>
                ))}
              </ul>
              <p className="package-composition-note">
                These are application composition patterns, not a promise of automatic adapters.
                Align Effect peers and artifact formats before combining runtimes; source prototypes
                can differ from published releases.
              </p>
              <a className="package-text-link" href="/#together">
                See the family's approval scenario →
              </a>
            </div>
          </section>
          <section className="package-section" id="boundaries" aria-label="Where it stops">
            <SectionTitle index="06" title="Where it stops" />
            <div className="package-prose">
              {pitch.boundaries.map((point) => (
                <article className="package-boundary" key={point.title}>
                  <h3>{point.title}</h3>
                  <p>{point.body}</p>
                </article>
              ))}
              <p className="package-maturity">
                All libraries are pre-1.0. Pin exact versions and plan for changes to APIs and
                artifact formats.
              </p>
            </div>
          </section>
        </div>
        <section className="package-next suite-container" aria-labelledby="package-next-title">
          <p className="eyebrow">Continue with the piece next to it</p>
          <h2 id="package-next-title">One library at a time.</h2>
          <div className="package-next-grid">
            {packages
              .filter((peer) => peer.name !== pkg.name)
              .map((peer) => (
                <a
                  key={peer.name}
                  className={`package-next-card pkg-${peer.name}`}
                  href={`/packages/${peer.name}/`}
                >
                  <span className="pkg-kicker">{peer.kicker}</span>
                  <strong>
                    {peer.name} <span aria-hidden="true">↗</span>
                  </strong>
                  <p>{peer.title}</p>
                  <StatusBadge availability={peer.availability} />
                </a>
              ))}
          </div>
          <a className="button button-primary" href="/playground">
            Try the Schematics playground →
          </a>
        </section>
      </main>
      <footer className="package-footer suite-container">
        <a href="/">Schematics</a>
        <p>Small libraries. Meaning you can inspect.</p>
        <a href="https://worldvm.com">WorldVM family ↗</a>
      </footer>
    </div>
  );
}

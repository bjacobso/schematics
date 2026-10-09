// The public homepage for the Schematics library family.
//
// It is built from first principles around one claim: every app hides a second
// program — its relationships, conditions, behavior, processes, contracts, and
// file layout — and each package pulls one of those out into data. The page
// opens with that claim, x-rays a familiar codebase to find each piece, then
// gives every package a spread: the real-world pain, the real API, and a small
// simulated demo. It closes with the packages composed, honest adoption notes,
// and the WorldVM family the project belongs to.
//
// The look descends from the original schematics.run: a blueprint grid, the
// stamped purple wordmark, a typing REPL, and monospace diagrams as art.
// Astro renders this JSX at build time; it is never hydrated with React.
// Foldkit demos and the React playground have separate browser entries.

import type { CSSProperties, ReactNode } from "react";
import { Ascii, Hi } from "./landing/Ascii";
import { Terminal } from "./landing/Terminal";
import { Reveal } from "./landing/Reveal";
import { packages, type Package } from "./landing/packages";
import { PackagePreview, StatusBadge } from "./landing/PackagePreview";
import { Mark } from "./landing/Mark";
import "./landing/landing.css";

const SOURCE = "https://github.com/bjacobso/schema-reflection";
const APPROVAL = `${SOURCE}/tree/main/packages/workflow/examples/approval`;
const WORLDVM = "https://worldvm.com";

// The x-ray: the same six kinds of knowledge, found where they usually hide.
const hiding = [
  {
    file: "db/migrations/0042.sql",
    line: "REFERENCES actions(id) ON DELETE ???",
    kind: "a relationship",
    pkg: "algebra",
  },
  {
    file: "routes/refunds.ts",
    line: 'if (user.role === "lead" && usd <= 500)',
    kind: "a condition",
    pkg: "predicates",
  },
  {
    file: "routes/approve.ts",
    line: 'c.status = "approved"; queue.push(evt)',
    kind: "a behavior",
    pkg: "logic",
  },
  {
    file: "jobs/review-reminder.ts",
    line: "setTimeout(remind, 3 * DAY) // pray",
    kind: "a process",
    pkg: "workflow",
  },
  {
    file: "types.ts",
    line: "interface Candidate { … } // TS only",
    kind: "a contract",
    pkg: "core",
  },
  {
    file: "config/**/*.yaml",
    line: "412 files, zero checks",
    kind: "a database",
    pkg: "filesystem",
  },
] as const;

const family = [
  {
    name: "Triplex",
    tagline: "A memory for your world.",
    body: "An embedded fact database that keeps time, rules, and provenance together.",
    href: "https://triplex.build",
    color: "#edba73",
  },
  {
    name: "Forma",
    tagline: "Little language. Big ideas.",
    body: "A typed Lisp for building domain-specific languages.",
    href: "https://github.com/bjacobso/forma",
    color: "#c6bed9",
  },
  {
    name: "Foldworks",
    tagline: "Give the machinery a face.",
    body: "Components and application primitives for Foldkit.",
    href: "https://foldworks.dev",
    color: "#9dbbbb",
  },
  {
    name: "Runfold",
    tagline: "Work that keeps unfolding.",
    body: "Typed programs as data, for durable and inspectable work.",
    href: "https://github.com/bjacobso/runfold",
    color: "#e9a08b",
  },
  {
    name: "Open Ontology",
    tagline: "Name the things. Connect the dots.",
    body: "A JSON-safe model of entities and relationships.",
    href: "https://open-ontology.com",
    color: "#b7c8a4",
  },
] as const;

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function SectionHead({
  index,
  label,
  title,
  children,
  id,
}: {
  index: string;
  label: string;
  title: ReactNode;
  children?: ReactNode;
  id: string;
}) {
  return (
    <div className="section-head">
      <p className="eyebrow">
        <span className="eyebrow-index">{index}</span> {label}
      </p>
      <h2 id={id}>{title}</h2>
      {children && <div className="section-lede">{children}</div>}
    </div>
  );
}

function Install({ pkg }: { pkg: Package }) {
  const scoped = `@schema-reflection/${pkg.name}`;
  const tree = `${SOURCE}/tree/main/packages/${pkg.name}`;
  switch (pkg.availability.kind) {
    case "published":
      return (
        <div className="pkg-install">
          <code className="install-command">
            <span aria-hidden="true">$ </span>pnpm add {scoped}
          </code>
          <a href={`https://www.npmjs.com/package/${scoped}`} aria-label={`${scoped} on npm`}>
            npm <Arrow />
          </a>
          <a href={tree} aria-label={`${scoped} source`}>
            Source <Arrow />
          </a>
        </div>
      );
    case "source":
      return (
        <div className="pkg-install">
          <span className="install-note">Not on npm yet.</span>
          <a href={tree} aria-label={`${scoped} source`}>
            Read the source <Arrow />
          </a>
        </div>
      );
    case "planned":
      return (
        <div className="pkg-install">
          <span className="install-note">Not implemented or installable yet.</span>
          <a href={`${tree}/SPEC.md`} aria-label={`${scoped} specification`}>
            Read the specification <Arrow />
          </a>
        </div>
      );
  }
}

function PackageSpread({ pkg, index }: { pkg: Package; index: number }) {
  return (
    <Reveal>
      <article className={`pkg pkg-${pkg.name}`} id={pkg.name} aria-labelledby={`${pkg.name}-name`}>
        <header className="pkg-head">
          <span className="pkg-index" aria-hidden="true">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="pkg-heading">
            <p className="pkg-kicker">{pkg.kicker}</p>
            <h3 id={`${pkg.name}-name`} className="pkg-name">
              <a href={`/packages/${pkg.name}/`}>
                <span className="pkg-scope">@schema-reflection/</span>
                {pkg.name}
              </a>
            </h3>
          </div>
          <StatusBadge availability={pkg.availability} />
        </header>
        <div className="pkg-body">
          <div className="pkg-story">
            <p className="pkg-title">{pkg.title}</p>
            <div className="pkg-bug">
              <span className="bug-label">{pkg.storyLabel}</span>
              <p>{pkg.story}</p>
            </div>
            <p className="pkg-does">{pkg.does}</p>
            <div className="pkg-uses">
              <span className="uses-label">Where it shows up</span>
              <ul>
                {pkg.uses.map((use) => (
                  <li key={use}>{use}</li>
                ))}
              </ul>
            </div>
            <Install pkg={pkg} />
            <a className="pkg-more" href={`/packages/${pkg.name}/`}>
              Explore {pkg.name} →
            </a>
          </div>
          <PackagePreview pkg={pkg} />
        </div>
      </article>
    </Reveal>
  );
}

export default function Landing() {
  return (
    <div className="suite-page">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="suite-nav suite-container">
        <a className="suite-brand" href="/" aria-label="Schematics home">
          <Mark />
          Schematics
        </a>
        <nav aria-label="Main navigation">
          <a href="#packages">Packages</a>
          <a href="#together">Example</a>
          <a href="/playground">Playground</a>
          <a className="family-pill" href={WORLDVM}>
            <span className="family-dot" aria-hidden="true" /> WorldVM family <Arrow />
          </a>
        </nav>
      </header>

      <main id="main">
        {/* ── Hero ────────────────────────────────────────────────────── */}
        <section className="hero" aria-labelledby="hero-title">
          <div className="blueprint-grid" aria-hidden="true" />
          <div className="hero-inner suite-container">
            <div className="hero-copy">
              <p className="eyebrow">
                <span className="live-dot" /> Small libraries for Effect Schema
              </p>
              <div className="brandmark" aria-hidden="true">
                Schematics
              </div>
              <h1 id="hero-title">Every app hides a second program.</h1>
              <p className="hero-lede">
                The rules about who may do what. Which records point at which. What happens next —
                and what happens when the server restarts halfway through. It&apos;s smeared across
                if-statements, foreign keys, and cron jobs, where no person or agent can read it.
              </p>
              <p className="hero-detail">
                Schematics is a family of small Effect libraries that pull that program out into{" "}
                <strong>data</strong>: something you can inspect, store, test, and explain.
              </p>
              <div className="hero-actions">
                <a className="button button-primary" href="#hidden">
                  Find your package <span aria-hidden="true">↓</span>
                </a>
                <a className="button" href="#together">
                  See them work together
                </a>
              </div>
            </div>
            <div className="hero-side">
              <Terminal />
              <p className="hero-note">
                ↑ one real call per package · <a href="#packages">all six below</a>
              </p>
            </div>
          </div>
        </section>

        {/* ── 00 · the x-ray ──────────────────────────────────────────── */}
        <section
          className="xray-section suite-container"
          id="hidden"
          aria-labelledby="hidden-title"
        >
          <SectionHead
            index="00"
            label="The hidden program"
            id="hidden-title"
            title="It's already in your codebase. It just can't talk."
          >
            <p>
              X-ray almost any app and you&apos;ll find the same six kinds of knowledge, stashed in
              files that were never meant to hold them. Each gets its own package.{" "}
              <strong>Start with the one that hurts.</strong>
            </p>
          </SectionHead>
          <Reveal>
            <ol
              className="xray"
              aria-label="Where the hidden program lives, and which package handles each part"
            >
              <li className="xray-root" aria-hidden="true">
                your-app/
              </li>
              {hiding.map((row, i) => (
                <li key={row.pkg} className={`xray-row pkg-${row.pkg}`}>
                  <a href={`#${row.pkg}`}>
                    <span className="xray-branch" aria-hidden="true">
                      {i === hiding.length - 1 ? "└──" : "├──"}
                    </span>
                    <span className="xray-file">{row.file}</span>
                    <code className="xray-line">{row.line}</code>
                    <span className="xray-kind">← {row.kind}</span>
                    <span className="xray-pkg">{row.pkg}</span>
                  </a>
                </li>
              ))}
            </ol>
          </Reveal>
        </section>

        {/* ── 01–06 · the packages ────────────────────────────────────── */}
        <section
          className="packages-section suite-container"
          id="packages"
          aria-labelledby="packages-title"
        >
          <SectionHead
            index="01–06"
            label="The packages"
            id="packages-title"
            title="Six packages. One idea: meaning belongs in data."
          >
            <p>
              Each package does one job and stands on Effect Schema. Every example below uses the
              real API — the npm release where one exists, the source where it doesn&apos;t yet.
            </p>
          </SectionHead>
          <div className="pkg-list">
            {packages.map((pkg, index) => (
              <PackageSpread key={pkg.name} pkg={pkg} index={index} />
            ))}
          </div>
        </section>

        {/* ── 07 · together ───────────────────────────────────────────── */}
        <section className="together-section" id="together" aria-labelledby="together-title">
          <div className="suite-container together-inner">
            <SectionHead
              index="07"
              label="All together"
              id="together-title"
              title={
                <>
                  One approval.
                  <br />
                  Four packages.
                  <br />
                  Just JSON.
                </>
              }
            >
              <p>
                The approval example is authored entirely as JSON. <Hi>core</Hi> describes the
                shapes, <Hi>predicates</Hi> decides who may approve, <Hi>logic</Hi> says what
                approving does, and <Hi>workflow</Hi> waits — across restarts — for a person to
                decide. An independent TypeScript definition produces exactly the same artifact.
              </p>
              <div className="together-actions">
                <a className="button button-primary" href={APPROVAL}>
                  Read the working example <Arrow />
                </a>
              </div>
            </SectionHead>
            <Reveal>
              <div className="together-art">
                <Ascii label="The approval bundle: core contracts, a CanApprove predicate, RequestReview and Approve logic actions, and a Review workflow that requests a review, waits at a checkpoint, then approves or rejects. Two CLI commands start the process and resume it from a file.">
                  {`approval/bundle.json — one portable file, no functions inside
┌───────────────────────────────────────────────────────────
│ `}
                  <Hi>{`core`}</Hi>
                  {`        Candidate · Role · ReviewSubmitted
│
│ `}
                  <Hi>{`predicates`}</Hi>
                  {`  CanApprove
│               role == "reviewer" && status == "pending"
│
│ `}
                  <Hi>{`logic`}</Hi>
                  {`       RequestReview   emit review.requested
│             Approve         require CanApprove
│                             set status = "approved"
│                             emit candidate.approved
│
│ `}
                  <Hi>{`workflow`}</Hi>
                  {`    Review
│               request ──> await review ──> approved? ──> Approve
│                           (checkpoint)              └──> reject
└───────────────────────────────────────────────────────────

$ node cli.ts start  /tmp/approval.json
$ node cli.ts resume /tmp/approval.json reviewer approved`}
                </Ascii>
              </div>
            </Reveal>
          </div>
          <div className="suite-container">
            <Reveal>
              <aside className="playground-callout" aria-labelledby="playground-title">
                <div>
                  <p className="eyebrow">Bonus round</p>
                  <h3 id="playground-title">Want a whole product built this way?</h3>
                  <p>
                    The Schematics playground is a config-as-code editor that runs on{" "}
                    <code>algebra</code>: schema-routed files, live relation diagnostics, an agent
                    with schema-checked tools, and a pull / plan / apply loop against a mock API —
                    entirely in your browser.
                  </p>
                </div>
                <a className="button button-primary" href="/playground">
                  Open the playground →
                </a>
              </aside>
            </Reveal>
          </div>
        </section>

        {/* ── 08 · notes ──────────────────────────────────────────────── */}
        <section className="notes-section suite-container" aria-labelledby="notes-title">
          <SectionHead
            index="08"
            label="Before you bet on it"
            id="notes-title"
            title="What you should know first."
          />
          <div className="notes-grid">
            <dl className="notes">
              <div>
                <dt>It is pre-1.0.</dt>
                <dd>
                  Every package is experimental and every artifact format is versioned. Pin exact
                  versions and expect breaking changes.
                </dd>
              </div>
              <div>
                <dt>It rides Effect 4 release candidates.</dt>
                <dd>
                  Each package pins an exact Effect 4 pre-release. Today&apos;s npm releases peer on
                  different ones (algebra on <code>4.0.0-beta.68</code>, predicates and logic on{" "}
                  <code>4.0.0-rc.113</code>), so check before mixing them in one runtime.
                </dd>
              </div>
              <div>
                <dt>Take only what you need.</dt>
                <dd>
                  Algebra stands alone. Core sits under predicates, logic, and workflow, and nothing
                  depends upward — using predicates never drags in an action language.
                </dd>
              </div>
              <div>
                <dt>The demos are simulations.</dt>
                <dd>
                  Each &ldquo;try it&rdquo; panel runs on Foldkit and Foldworks and mirrors behavior
                  documented in the package README; the code beside it is the real API.
                </dd>
              </div>
            </dl>
            <Ascii
              className="deps-art"
              label="Dependency map: algebra and core both build directly on Effect. Predicates and workflow build on core. Logic builds on core and predicates."
            >
              {`            effect
         ┌────┴─────┐
      `}
              <Hi>{`algebra`}</Hi>
              {`     `}
              <Hi>{`core`}</Hi>
              {`
   (stands alone)  │
          ┌────────┼─────────┐
     `}
              <Hi>{`predicates`}</Hi>
              {`    │      `}
              <Hi>{`workflow`}</Hi>
              {`
          └───▶ `}
              <Hi>{`logic`}</Hi>
              {` ◀─┘

  arrows point up the stack —
  nothing depends upward`}
            </Ascii>
          </div>
        </section>

        {/* ── 09 · the family ─────────────────────────────────────────── */}
        <section className="family-section" id="family" aria-labelledby="family-title">
          <div className="suite-container">
            <div className="family-head">
              <div>
                <p className="eyebrow">
                  <span className="eyebrow-index">09</span> Part of the WorldVM family
                </p>
                <h2 id="family-title">Small experiments. Bigger worlds.</h2>
              </div>
              <p>
                Schematics is one thread in a family of open experiments in software that can
                describe, remember, coordinate, and explain itself. WorldVM is where they meet: a
                runtime for operational worlds of entities, rules, goals, and actions.
              </p>
            </div>
            <ul className="family-grid">
              {family.map((project) => (
                <li
                  key={project.name}
                  style={{ "--project-color": project.color } as CSSProperties}
                >
                  <a href={project.href}>
                    <span className="family-swatch" aria-hidden="true" />
                    <strong>
                      {project.name} <Arrow />
                    </strong>
                    <em>{project.tagline}</em>
                    <span>{project.body}</span>
                  </a>
                </li>
              ))}
              <li className="family-here" style={{ "--project-color": "#e2d6b4" } as CSSProperties}>
                <div>
                  <span className="family-swatch" aria-hidden="true" />
                  <strong>Schematics</strong>
                  <em>Let your schemas tell you more.</em>
                  <span>You are here — the home of the @schema-reflection libraries.</span>
                </div>
              </li>
            </ul>
            <a className="family-cta" href={WORLDVM}>
              Meet the whole family at worldvm.com <Arrow />
            </a>
          </div>
        </section>
      </main>

      <footer className="suite-footer suite-container">
        <div>
          <a className="suite-brand" href="/" aria-label="Schematics home">
            <Mark />
            Schematics
          </a>
          <p>Every app hides a second program. Make it data.</p>
        </div>
        <nav className="footer-links" aria-label="Footer">
          <a href="https://www.npmjs.com/org/schema-reflection">
            npm <Arrow />
          </a>
          <a href={SOURCE}>
            Source <Arrow />
          </a>
          <a href="/playground">Playground</a>
          <a href={WORLDVM}>
            WorldVM <Arrow />
          </a>
        </nav>
      </footer>
    </div>
  );
}

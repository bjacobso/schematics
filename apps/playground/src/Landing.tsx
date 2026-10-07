// The public library-suite page. Keep editor/runtime imports in the lazy playground route.
import "./landing/landing.css";

const SOURCE = "https://github.com/bjacobso/schema-reflection";
const APPROVAL = `${SOURCE}/tree/main/packages/workflow/examples/approval`;

const packages = [
  {
    name: "core",
    title: "Structure, made portable.",
    description:
      "Schemas, contracts, and symbolic expressions that describe what your system knows.",
    status: "Experimental",
    version: "0.0.0",
    capability: "Contracts",
  },
  {
    name: "algebra",
    title: "Give your schemas relationships.",
    description:
      "Declare schema-native relations, extract a graph, and validate the connections between records.",
    status: "Published",
    version: "0.1.0",
    capability: "Relationships",
  },
  {
    name: "predicates",
    title: "Conditions you can read.",
    description:
      "Represent conditions as immutable, serializable data. Inspect the rule as well as its result.",
    status: "Published",
    version: "0.1.0",
    capability: "Conditions",
  },
  {
    name: "logic",
    title: "Make behavior explicit.",
    description:
      "Describe declarative behavior as typed, inspectable data, composed with core contracts and predicates.",
    status: "Published",
    version: "0.1.0",
    capability: "Behavior",
  },
  {
    name: "workflow",
    title: "Carry behavior through time.",
    description:
      "Compose serializable sequential workflows with deterministic checkpoint transitions.",
    status: "Experimental prototype",
    version: "0.0.0",
    capability: "Processes",
  },
  {
    name: "filesystem",
    title: "A place for structured files.",
    description:
      "A planned model for directories and files as schema-validated, cross-referenced data. Specification only; not yet implemented or installable.",
    status: "Planned",
    version: null,
    capability: "Files",
  },
] as const;

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function Mark() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className="schematics-mark">
      <path
        d="M4 4h10v10H4zM18 18h10v10H18zM18 4h10v10H18z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M9 14v9h9M14 9h4M23 14v4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function SystemDrawing() {
  return (
    <figure className="system-drawing">
      <div className="drawing-toolbar">
        <span>
          <span className="live-dot" /> SYSTEM DESCRIPTION
        </span>
        <span>FIG. 01</span>
      </div>
      <div className="drawing-body">
        <div className="drawing-label">COMPOSABLE CAPABILITIES</div>
        <div className="diagram-node contract-node">
          <span className="node-index">01</span>
          <div>
            <strong>Structure</strong>
            <code>core / contracts</code>
          </div>
          <span className="node-symbol">{"{ }"}</span>
        </div>
        <div className="diagram-connector" aria-hidden="true">
          ↓
        </div>
        <div className="diagram-pair">
          <div className="diagram-node">
            <span className="node-index">02</span>
            <div>
              <strong>Relationships</strong>
              <code>algebra / graphs</code>
            </div>
          </div>
          <div className="diagram-node">
            <span className="node-index">03</span>
            <div>
              <strong>Conditions</strong>
              <code>predicates / rules</code>
            </div>
          </div>
        </div>
        <div className="diagram-connector" aria-hidden="true">
          ↓
        </div>
        <div className="diagram-node behavior-node">
          <span className="node-index">04</span>
          <div>
            <strong>Behavior</strong>
            <code>logic / actions</code>
          </div>
          <span className="node-symbol">ƒ</span>
        </div>
        <div className="diagram-connector" aria-hidden="true">
          ↓
        </div>
        <div className="diagram-node">
          <span className="node-index">05</span>
          <div>
            <strong>Processes</strong>
            <code>workflow / checkpoints</code>
          </div>
          <span className="node-symbol">→</span>
        </div>
        <div className="effect-foundation">
          <span>BUILT ON</span>
          <strong>Effect</strong>
          <span>ONE SHARED FOUNDATION</span>
        </div>
      </div>
      <figcaption>
        A map of capabilities, not a dependency graph.
        <br />
        Compose the pieces your system needs.
      </figcaption>
    </figure>
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
          Schematics<span className="brand-period">.</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#packages">Packages</a>
          <a href={SOURCE}>
            Source <Arrow />
          </a>
          <a className="family-nav" href="https://worldvm.com">
            WorldVM <Arrow />
          </a>
        </nav>
      </header>

      <main id="main">
        <section className="suite-hero suite-container" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="live-dot" /> THE SCHEMATICS LIBRARY SUITE
            </p>
            <h1 id="hero-title">
              Describe the structure.
              <br />
              <span>Keep the behavior inspectable.</span>
            </h1>
            <p className="hero-description">
              Composable libraries for schemas, relationships, rules, and workflows, built on
              Effect.
            </p>
            <p className="hero-detail">
              Give your system a description you can inspect, validate, and compose — from its
              contracts to the processes that move it forward.
            </p>
            <div className="suite-actions">
              <a className="suite-button primary-button" href="#packages">
                Explore the packages <span aria-hidden="true">↓</span>
              </a>
              <a className="source-link" href={SOURCE}>
                Schema Reflection source <Arrow />
              </a>
            </div>
            <p className="hero-footnote">
              TypeScript libraries. Shared foundations. Distinct capabilities.
            </p>
          </div>
          <SystemDrawing />
        </section>

        <div className="principle-strip">
          <div className="suite-container">
            <span className="eyebrow">THE IDEA</span>
            <p>
              System meaning belongs in <strong>data you can inspect.</strong>
            </p>
            <span className="strip-cross" aria-hidden="true">
              +
            </span>
          </div>
        </div>

        <section
          className="packages-section suite-container"
          id="packages"
          aria-labelledby="packages-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">01 / THE BUILDING BLOCKS</p>
              <h2 id="packages-title">A suite, by composition.</h2>
            </div>
            <p>
              Start with the capability you need. Schematics brings together the{" "}
              <a href={SOURCE}>Schema Reflection libraries</a>, with their current package names and
              source.
            </p>
          </div>
          <div className="package-grid">
            {packages.map((pkg, index) => (
              <article
                className={`package-card ${pkg.status === "Planned" ? "planned-card" : ""}`}
                key={pkg.name}
              >
                <div className="package-topline">
                  <span className="package-number">
                    {String(index + 1).padStart(2, "0")} / {pkg.capability}
                  </span>
                  <span
                    className={`package-status ${pkg.status === "Published" ? "published-status" : ""}`}
                  >
                    {pkg.status}
                    {pkg.version ? ` · ${pkg.version}` : ""}
                  </span>
                </div>
                <code className="package-name">@schema-reflection/{pkg.name}</code>
                <h3>{pkg.title}</h3>
                <p>{pkg.description}</p>
                <div className="package-links">
                  <a
                    href={`${SOURCE}/tree/main/packages/${pkg.name}${pkg.status === "Planned" ? "/SPEC.md" : ""}`}
                  >
                    {pkg.status === "Planned" ? "Read the specification" : "Source & docs"}{" "}
                    <Arrow />
                  </a>
                  {pkg.status === "Published" && (
                    <a
                      href={`https://www.npmjs.com/package/@schema-reflection/${pkg.name}`}
                      aria-label={`@schema-reflection/${pkg.name} on npm`}
                    >
                      npm <Arrow />
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
          <p className="suite-note">
            <span aria-hidden="true">↳</span> Algebra stands independently. Predicates builds on
            core; logic adds behavior; workflow composes core and logic.
          </p>
        </section>

        <section className="inspect-section suite-container" aria-labelledby="inspect-title">
          <div className="inspect-copy">
            <p className="eyebrow">02 / INSPECTABLE BY DESIGN</p>
            <h2 id="inspect-title">
              Read the system.
              <br />
              Before you run it.
            </h2>
            <p>
              A condition can be a value you serialize. An action can describe its contracts and
              behavior. A workflow can describe its steps and checkpoints.
            </p>
            <p>
              When those descriptions are data, you can examine what a system means, validate how
              its pieces fit, and carry the description across a runtime boundary.
            </p>
            <a className="text-link" href={SOURCE}>
              Explore the approach <Arrow />
            </a>
          </div>
          <div className="inspection-panel">
            <div className="inspection-heading">
              <span className="eyebrow">SAME SYSTEM, DIFFERENT QUESTIONS</span>
              <span aria-hidden="true">⌘</span>
            </div>
            <dl>
              <div>
                <dt>Schema</dt>
                <dd>What shape does this value have?</dd>
              </div>
              <div>
                <dt>Relationship</dt>
                <dd>How do these records connect?</dd>
              </div>
              <div>
                <dt>Predicate</dt>
                <dd>Under what conditions is this allowed?</dd>
              </div>
              <div>
                <dt>Logic</dt>
                <dd>What does this action do?</dd>
              </div>
              <div>
                <dt>Workflow</dt>
                <dd>What happens next, and where can it resume?</dd>
              </div>
            </dl>
            <p>Distinct descriptions. Composable meaning.</p>
          </div>
        </section>

        <section className="example-section suite-container" aria-labelledby="example-title">
          <div className="example-copy">
            <p className="eyebrow">03 / SEE THE PIECES CONNECT</p>
            <h2 id="example-title">
              An approval process.
              <br />
              Authored as data.
            </h2>
            <p>
              The approval example combines core contracts, a predicate, logic actions, and a
              workflow in a JSON bundle — with an equivalent TypeScript definition.
            </p>
            <p>
              Request a review, wait for a decision, check the condition, and approve. The demo
              saves a checkpoint to disk and reloads it to resume.
            </p>
            <a className="suite-button primary-button" href={APPROVAL}>
              Read the working example <Arrow />
            </a>
            <span className="example-note">Experimental workflow · file-backed recovery demo</span>
          </div>
          <div
            className="approval-drawing"
            aria-label="Approval example: request review, wait for a decision, check reviewer role and pending status, then approve"
          >
            <div className="approval-heading">
              <span>approval / process</span>
              <span>JSON ↔ TS</span>
            </div>
            <ol>
              <li>
                <span className="approval-step">01</span>
                <div>
                  <strong>Request review</strong>
                  <span>Logic emits review.requested</span>
                </div>
              </li>
              <li>
                <span className="approval-step">02</span>
                <div>
                  <strong>Wait for a decision</strong>
                  <span>Workflow waits for a correlated event</span>
                </div>
                <span className="checkpoint-tag">checkpoint</span>
              </li>
              <li>
                <span className="approval-step">03</span>
                <div>
                  <strong>Check the condition</strong>
                  <code>role == "reviewer" &amp;&amp; status == "pending"</code>
                </div>
              </li>
              <li>
                <span className="approval-step">04</span>
                <div>
                  <strong>Approve the candidate</strong>
                  <span>Logic updates state and emits candidate.approved</span>
                </div>
              </li>
            </ol>
            <p>Approved path shown. The workflow also branches on rejection.</p>
          </div>
        </section>

        <section className="family-section suite-container" aria-labelledby="family-title">
          <div>
            <p className="eyebrow">PART OF THE WORLDVM FAMILY</p>
            <h2 id="family-title">Structure for a wider world.</h2>
            <p>
              Schematics sits alongside Triplex, Forma, Foldworks, and Runfold in the WorldVM
              family.
            </p>
          </div>
          <a className="text-link" href="https://worldvm.com">
            Meet WorldVM <Arrow />
          </a>
        </section>
      </main>

      <footer className="suite-footer suite-container">
        <div>
          <a className="suite-brand" href="/" aria-label="Schematics home">
            <Mark />
            Schematics<span className="brand-period">.</span>
          </a>
          <p>Describe the structure. Keep the behavior inspectable.</p>
        </div>
        <div className="footer-links">
          <a href={SOURCE}>
            Schema Reflection <Arrow />
          </a>
          <a href="/playground">
            Open the playground <Arrow />
          </a>
          <span>The existing schema-driven editor demo.</span>
        </div>
      </footer>
    </div>
  );
}

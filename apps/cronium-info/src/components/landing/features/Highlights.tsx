import Link from "next/link";
import { ArrowRight, KeyRound, ShieldCheck, UserCheck } from "lucide-react";
import WorkflowCanvasPreview from "./WorkflowCanvasPreview";
import IntegrationsWall from "./IntegrationsWall";

/**
 * Every claim below is verified against the codebase. Do not add uptime
 * figures, "enterprise-grade", or compliance badges — none of that is true.
 */
const SECURITY_TILES = [
  {
    icon: KeyRound,
    title: "Encrypted at rest",
    body: "Credentials, SSH keys, and environment variables are encrypted with AES-256-GCM.",
  },
  {
    icon: ShieldCheck,
    title: "Verified execution",
    body: "SSH host-key verification, Ed25519-signed execution payloads, and isolated containers.",
  },
  {
    icon: UserCheck,
    title: "Access control",
    body: "Admin, User, and Viewer roles, enforced on the server rather than hidden in the UI.",
  },
];

function HighlightLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="text-primary hover:text-primary/80 focus-visible:ring-ring focus-visible:ring-offset-background inline-flex items-center gap-1.5 rounded text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      {children}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

export default function Highlights() {
  return (
    <div className="space-y-24">
      {/* 1. Workflow builder — copy left, canvas right. */}
      <section
        aria-labelledby="highlight-workflows"
        className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12"
      >
        <div className="space-y-5 lg:col-span-5">
          <h3
            id="highlight-workflows"
            className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl"
          >
            Build workflows visually
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Chain events on a canvas with branches that fire on success, on
            failure, or on a condition your script sets. Independent branches
            run in parallel, and each step can pass data to the next. No YAML to
            hand-write.
          </p>
          <HighlightLink href="/docs/how-to/build-workflow">
            Build your first workflow
          </HighlightLink>
        </div>

        <div className="lg:col-span-7">
          <WorkflowCanvasPreview />
        </div>
      </section>

      {/* 2. Integrations — full-width band, visually distinct from the 2-col blocks. */}
      <section
        aria-labelledby="highlight-integrations"
        className="border-border bg-card/40 rounded-3xl border px-6 py-12 sm:px-10"
      >
        <div className="mb-10 space-y-4 text-center">
          <h3
            id="highlight-integrations"
            className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl"
          >
            Notify the tools you already use
          </h3>
          <p className="text-muted-foreground mx-auto max-w-2xl leading-relaxed">
            Send a message when a script succeeds or fails — no glue code. Every
            integration is configured once, stored encrypted, and testable from
            the dashboard before you rely on it.
          </p>
        </div>

        <IntegrationsWall />

        <div className="mt-10 text-center">
          <HighlightLink href="/docs/tools">
            Explore the integrations
          </HighlightLink>
        </div>
      </section>

      {/* 3. Security — 3-tile row, breaking the left/right rhythm once more. */}
      <section aria-labelledby="highlight-security" className="space-y-10">
        <div className="space-y-4 text-center">
          <h3
            id="highlight-security"
            className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl"
          >
            Secure by construction
          </h3>
          <p className="text-muted-foreground mx-auto max-w-2xl leading-relaxed">
            Cronium runs on your own infrastructure and executes code you wrote.
            The defaults are built for that.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {SECURITY_TILES.map((tile) => (
            <div
              key={tile.title}
              className="border-border bg-card rounded-2xl border p-6"
            >
              <div className="text-primary bg-primary/10 mb-4 flex h-11 w-11 items-center justify-center rounded-xl">
                <tile.icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <h4 className="text-card-foreground mb-2 font-semibold">
                {tile.title}
              </h4>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {tile.body}
              </p>
            </div>
          ))}
        </div>

        <div className="text-center">
          <HighlightLink href="/docs/features#security-features">
            Read about security
          </HighlightLink>
        </div>
      </section>
    </div>
  );
}

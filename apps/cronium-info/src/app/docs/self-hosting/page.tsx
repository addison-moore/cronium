import React from "react";
import DocsLayout from "@/components/docs/docs-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Alert,
  AlertDescription,
  AlertTitle,
} from "@cronium/ui";
import { SimpleCodeBlock } from "@/components/docs/api-code-examples";
import { Server, Layers, ShieldCheck, Wrench } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Self-Hosting Guide",
  description:
    "Deploy Cronium on your own infrastructure with Docker Compose. Covers images, environment variables, database setup, and post-deployment checks.",
  alternates: { canonical: "/docs/self-hosting" },
};

const tableOfContents = [
  { title: "Overview", href: "#overview", level: 2 },
  { title: "Prerequisites", href: "#prerequisites", level: 2 },
  { title: "Quick Install", href: "#quick-install", level: 2 },
  { title: "Container Images", href: "#container-images", level: 2 },
  {
    title: "Docker Compose Example",
    href: "#docker-compose-example",
    level: 2,
  },
  { title: "Environment Variables", href: "#environment-variables", level: 2 },
  { title: "Cronium App", href: "#app-env", level: 3 },
  { title: "Orchestrator", href: "#orchestrator-env", level: 3 },
  { title: "Runtime Service", href: "#runtime-env", level: 3 },
  { title: "Backing Services", href: "#backing-services-env", level: 3 },
  { title: "Deployment Workflow", href: "#deployment-workflow", level: 2 },
  { title: "Post-Deployment Checklist", href: "#post-deployment", level: 2 },
];

// Enable Partial Prerendering for this page
export const experimental_ppr = true;

// ISR configuration - revalidate every hour
export const revalidate = 3600; // 1 hour
export const dynamic = "force-static";

export default function SelfHostingPage() {
  return (
    <DocsLayout tableOfContents={tableOfContents}>
      <div className="mx-auto max-w-4xl">
        <div className="mb-12">
          <h1 className="mb-4 text-4xl font-bold tracking-tight">
            Self-Hosting Cronium
          </h1>
          <p className="text-muted-foreground text-xl">
            Deploy the Cronium application stack with Docker Compose. This guide
            covers the required services, recommended configuration, and the
            environment variables needed to run Cronium in your own
            infrastructure.
          </p>
        </div>

        <section id="overview" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Overview</h2>
          <p>
            A production Cronium deployment consists of the Next.js control
            plane (<code>cronium-app</code>), the scheduling worker (
            <code>cronium-worker</code> — dispatches due schedules, runs
            tool-action and HTTP jobs, and recovers stuck work), the secure job
            orchestrator (<code>cronium-orchestrator</code>), the runtime API
            used by containerised scripts, and supporting services (PostgreSQL
            for persistence and Valkey/Redis for caching). Docker Compose offers
            a simple way to run these services together.
          </p>
        </section>

        <section id="prerequisites" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Prerequisites</h2>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="text-primary h-5 w-5" />
                Infrastructure requirements
              </CardTitle>
              <CardDescription>
                Verify the following before launching the stack.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="text-muted-foreground list-disc space-y-2 pl-6">
                <li>Docker Engine 24.x+ and Docker Compose V2 installed</li>
                <li>
                  A domain name (optional, but recommended) to expose the
                  Next.js frontend
                </li>
                <li>
                  TLS termination via a reverse proxy such as Traefik, Caddy, or
                  Nginx if you are running in production
                </li>
                <li>
                  Secrets generated for <code>AUTH_SECRET</code>,
                  <code>ENCRYPTION_KEY</code>, a{" "}
                  <code>CRONIUM_ORCHESTRATOR_KEY</code> that the orchestrator
                  presents to the app, and a <code>SOCKET_BROADCAST_KEY</code>{" "}
                  for app/worker→socket-server broadcasts
                </li>
              </ul>
            </CardContent>
          </Card>
        </section>

        <section id="quick-install" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Quick Install</h2>
          <div className="space-y-4">
            <p>
              The fastest way to get running is the installer script. It checks
              your Docker setup, downloads the Compose file, generates every
              secret into a <code>.env</code> (chmod 600), starts the stack, and
              waits until Cronium is healthy:
            </p>
            <SimpleCodeBlock language="bash">
              {`curl -fsSL https://raw.githubusercontent.com/addison-moore/cronium/main/install.sh | bash`}
            </SimpleCodeBlock>
            <p className="text-muted-foreground text-sm">
              It asks one question — the URL where Cronium will be reached
              (defaults to <code>http://localhost:3000</code>; pass{" "}
              <code>--url https://cronium.example.com</code> for non-interactive
              installs). Re-running the installer upgrades in place without
              touching your secrets, and <code>--uninstall</code> stops the
              stack while keeping your data. Prefer to see every step? The
              manual path below does exactly what the installer automates.
            </p>
          </div>
        </section>

        <section id="env-setup" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Prepare Your Environment</h2>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="text-primary h-5 w-5" />
                Generate secrets & configure .env
              </CardTitle>
              <CardDescription>
                You only need a few long, random strings and a minimal{" "}
                <code>.env</code> file to get started.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ol className="text-muted-foreground list-decimal space-y-3 pl-6 text-sm">
                <li>
                  <strong>Download the example Docker compose file</strong>:
                  <SimpleCodeBlock language="bash" className="mt-2">
                    {`curl -O https://raw.githubusercontent.com/addison-moore/cronium/main/docker-compose.example.yml`}
                  </SimpleCodeBlock>
                </li>
                <li>
                  <strong>Generate secrets</strong> (repeat for each variable).
                  If <code>openssl</code> is not installed, use a password
                  manager to generate random strings of the same length:
                  <SimpleCodeBlock language="bash" className="mt-2">
                    {`# macOS / Linux / WSL
openssl rand -hex 32     # AUTH_SECRET, ENCRYPTION_KEY, JWT_SECRET
openssl rand -base64 32  # CRONIUM_ORCHESTRATOR_KEY
openssl rand -base64 32  # SOCKET_BROADCAST_KEY
openssl rand -hex 16     # POSTGRES_PASSWORD
openssl rand -hex 24     # VALKEY_PASSWORD`}
                  </SimpleCodeBlock>
                  <code>ENCRYPTION_KEY</code> must be exactly 64 hex characters
                  (<code>openssl rand -hex 32</code> produces that).
                </li>
                <li>
                  <strong>
                    Create a <code>.env</code> file
                  </strong>{" "}
                  next to the Compose file with the secrets you generated and
                  your public URL (use <code>http://localhost:3000</code> if you
                  are testing locally). The Compose file reads everything from{" "}
                  <code>.env</code> — you never need to edit the YAML — and it
                  refuses to start with a clear error if a required value is
                  missing:
                  <SimpleCodeBlock language="env" className="mt-2">
                    {`AUTH_URL=https://cronium.example.com
PUBLIC_APP_URL=https://cronium.example.com
SOCKET_ALLOWED_ORIGINS=https://cronium.example.com
AUTH_SECRET=<paste value>
ENCRYPTION_KEY=<paste value>
CRONIUM_ORCHESTRATOR_KEY=<paste value>
SOCKET_BROADCAST_KEY=<paste value>
JWT_SECRET=<paste value>
POSTGRES_PASSWORD=<paste value>
VALKEY_PASSWORD=<paste value>`}
                  </SimpleCodeBlock>
                </li>
              </ol>
              <Alert className="bg-card text-card-foreground">
                <AlertTitle>Tip</AlertTitle>
                <AlertDescription>
                  Store the generated secrets in a password manager so you can
                  reuse them when redeploying or scaling additional services.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </section>

        <section id="container-images" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Container Images</h2>
          <div className="space-y-6">
            <p>
              The Compose example below assumes the following images are
              available locally or in a registry you can pull from:
            </p>
            <ul className="text-muted-foreground list-disc space-y-2 pl-6">
              <li>
                <code>cronium-app</code> – Next.js control plane UI & API (the
                same image also runs the <code>cronium-worker</code> scheduling
                service with a different entrypoint)
              </li>
              <li>
                <code>cronium-orchestrator</code> – Go daemon that executes jobs
              </li>
              <li>
                <code>cronium-runtime</code> – Runtime API for container
                executions (optional if you only use SSH targets)
              </li>
            </ul>

            <Alert className="bg-card text-card-foreground">
              <AlertTitle>Local Builds</AlertTitle>
              <AlertDescription>
                If you prefer to build the images locally:
                <SimpleCodeBlock language="bash" className="my-2">
                  {`docker build -t cronium-app:latest -f apps/cronium-app/Dockerfile . 
docker build -t cronium-orchestrator:latest -f apps/orchestrator/Dockerfile .
docker build -t cronium-runtime:latest apps/runtime/cronium-runtime`}
                </SimpleCodeBlock>
                Then update the Compose file to reference your local tags.
              </AlertDescription>
            </Alert>
          </div>
        </section>

        <section id="docker-compose-example" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Docker Compose Example</h2>
          <div className="space-y-6">
            <p>
              The stack is defined by{" "}
              <a
                href="https://github.com/addison-moore/cronium/blob/main/docker-compose.example.yml"
                className="underline"
              >
                docker-compose.example.yml
              </a>{" "}
              in the repository — the same file the installer and the{" "}
              <code>curl</code> command above download. It runs PostgreSQL,
              Valkey, the Cronium app, the orchestrator, and the runtime service
              on a shared network with healthchecks, restart policies, and
              persistent volumes wired in. The file is commented and is the
              single source of truth; this page deliberately does not duplicate
              it. What you need to know:
            </p>
            <ul className="text-muted-foreground list-disc space-y-2 pl-6">
              <li>
                Every value is read from <code>.env</code> — a standard
                deployment never edits the YAML. Required secrets use the{" "}
                <code>{"${VAR:?error}"}</code> form, so a missing value stops{" "}
                <code>docker compose up</code> with the exact generation command
                in the error message:
              </li>
            </ul>
            <SimpleCodeBlock language="yaml">
              {`# excerpt — how configuration flows from .env
  cronium-app:
    image: ghcr.io/addison-moore/cronium-app:\${CRONIUM_IMAGE_TAG:-latest}
    environment:
      AUTH_URL: \${AUTH_URL:-http://localhost:3000}
      SOCKET_ALLOWED_ORIGINS: \${SOCKET_ALLOWED_ORIGINS:-}
      AUTH_SECRET: \${AUTH_SECRET:?generate with openssl rand -hex 32}
      DATABASE_URL: postgres://\${POSTGRES_USER:-cronium}:\${POSTGRES_PASSWORD:?generate with openssl rand -hex 16}@postgres:5432/\${POSTGRES_DB:-cronium}`}
            </SimpleCodeBlock>
            <ul className="text-muted-foreground list-disc space-y-2 pl-6">
              <li>
                Port <code>3000</code> is published for the web app; WebSocket
                port <code>5002</code> is bound only to host loopback for a
                reverse proxy. The orchestrator and runtime are internal-only
                and monitored via their container healthchecks (
                <code>docker compose ps</code>).
              </li>
              <li>
                For an Internet-facing deployment, route only the socket
                transport path (<code>/api/socketio</code>) through your TLS
                reverse proxy to <code>127.0.0.1:5002</code>. A proxy container
                can use <code>cronium-app:5002</code> on the Cronium network.
                Never proxy the service-only <code>/broadcast/*</code> routes;
                they also require
                <code>Authorization: Bearer $SOCKET_BROADCAST_KEY</code>.
              </li>
              <li>
                Optional features are enabled purely by adding variables to{" "}
                <code>.env</code>: <code>SMTP_HOST</code>/<code>SMTP_PORT</code>
                /<code>SMTP_USER</code>/<code>SMTP_PASSWORD</code>/
                <code>SMTP_FROM_EMAIL</code> for outbound email,{" "}
                <code>CRONIUM_IMAGE_TAG</code> to pin a release, and{" "}
                <code>APP_PORT</code> to move the public port or
                <code>SOCKET_PORT</code> to move the loopback proxy target. Use
                <code>SOCKET_ALLOWED_ORIGINS</code> only when trusted browser
                clients come from more than the canonical
                <code>PUBLIC_APP_URL</code>/<code>AUTH_URL</code> origins.
              </li>
            </ul>
            <p className="text-muted-foreground text-sm">
              Live-log and terminal clients automatically request a short-lived
              authenticated ticket before connecting. The server accepts each
              ticket once through shared Valkey, checks that the account is
              still active, and also requires console permission for terminal
              access. Authorization changes revoke live connections. Exact
              origin allowlisting adds a separate browser boundary.
            </p>
            <p className="text-muted-foreground text-sm">
              The bundled Valkey service uses <code>noeviction</code> because
              consumed ticket markers are security state. At its configured
              memory limit, new security writes fail closed instead of evicting
              replay protection.
            </p>
            <p className="text-muted-foreground text-sm">
              There are no default credentials: your first browser visit shows a
              one-time setup page where you create the admin account. For
              headless installs (CI, infrastructure-as-code), set{" "}
              <code>AUTO_SEED_ADMIN=true</code> plus <code>ADMIN_USERNAME</code>
              , <code>ADMIN_EMAIL</code>, and <code>ADMIN_PASSWORD</code> in{" "}
              <code>.env</code> to seed the admin on first boot instead.
            </p>
            <p className="text-muted-foreground text-sm">
              The Cronium app automatically runs database migrations on start.
              You can disable this behaviour by setting{" "}
              <code>AUTO_MIGRATE=false</code> if you prefer to manage the schema
              yourself.
            </p>
            <p className="text-muted-foreground text-xs">
              Leave the <code>/var/run/docker.sock</code> mount in place if you
              plan to run container jobs—the orchestrator needs access to the
              host Docker daemon. Remove it only when you exclusively use an
              externally isolated SSH execution topology.
            </p>
          </div>
        </section>

        <section id="environment-variables" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Environment Variables</h2>
          <div className="space-y-6">
            <p>
              The tables below summarise the key variables per service. Values
              marked as <strong>required</strong> must be set for a production
              deployment.
            </p>

            <div id="app-env" className="space-y-3">
              <h3 className="text-xl font-semibold">Cronium App</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Variable</TableHead>
                    <TableHead>Required</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      <code>PUBLIC_APP_URL</code>
                    </TableCell>
                    <TableCell>Yes</TableCell>
                    <TableCell>
                      Public base URL of the Next.js application (used by links,
                      auth callbacks, emails).
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>NEXT_PUBLIC_APP_URL</code>
                    </TableCell>
                    <TableCell>Optional</TableCell>
                    <TableCell>
                      Mirror of <code>PUBLIC_APP_URL</code> exposed to the
                      browser; set when serving the UI behind a proxy.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>AUTH_URL</code>
                    </TableCell>
                    <TableCell>Yes</TableCell>
                    <TableCell>
                      URL that NextAuth should consider as the canonical origin
                      for authentication.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>SOCKET_ALLOWED_ORIGINS</code>
                    </TableCell>
                    <TableCell>Optional</TableCell>
                    <TableCell>
                      Comma-separated exact browser origins permitted to open
                      live-log and terminal sockets. Defaults to{" "}
                      <code>PUBLIC_APP_URL</code> and <code>AUTH_URL</code>;
                      include the scheme and any non-default port. Wildcards and
                      URL paths are not supported.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>AUTH_SECRET</code>
                    </TableCell>
                    <TableCell>Yes</TableCell>
                    <TableCell>
                      Random 32-character string used by NextAuth to sign
                      session cookies (e.g. <code>openssl rand -hex 32</code>).
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>DATABASE_URL</code>
                    </TableCell>
                    <TableCell>Yes</TableCell>
                    <TableCell>
                      PostgreSQL connection string in the format{" "}
                      <code>postgres://user:pass@host:5432/db</code>; see the
                      Compose example for defaults.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>ENCRYPTION_KEY</code>
                    </TableCell>
                    <TableCell>Yes</TableCell>
                    <TableCell>
                      32-byte key (Base64 or hex) used to encrypt stored
                      secrets; generate with <code>openssl rand -hex 32</code>{" "}
                      or a password manager.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>CRONIUM_ORCHESTRATOR_KEY</code>
                    </TableCell>
                    <TableCell>Yes</TableCell>
                    <TableCell>
                      Orchestrator service-identity credential — the app
                      verifies it on the orchestrator-facing routes (claim,
                      heartbeat, health/metrics); generate with{" "}
                      <code>openssl rand -base64 32</code>. Never expose it to
                      browser clients.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>SOCKET_BROADCAST_KEY</code>
                    </TableCell>
                    <TableCell>Yes</TableCell>
                    <TableCell>
                      Authenticates internal broadcasts from the app/worker to
                      the socket server; generate with{" "}
                      <code>openssl rand -base64 32</code>. Never expose it to
                      browser clients.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>JWT_SECRET</code>
                    </TableCell>
                    <TableCell>Yes</TableCell>
                    <TableCell>
                      Token used for signing internal service-auth tokens and
                      WebSocket payloads; reuse this for the runtime service
                      (e.g. <code>openssl rand -hex 32</code>).
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>AUTO_MIGRATE</code>
                    </TableCell>
                    <TableCell>Optional</TableCell>
                    <TableCell>
                      Defaults to <code>true</code>. Leave enabled unless you
                      plan to run migrations yourself; set to <code>false</code>
                      if you need to manage schema updates manually.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>ORCHESTRATOR_URL</code>
                    </TableCell>
                    <TableCell>Optional</TableCell>
                    <TableCell>
                      Base URL for the orchestrator health endpoints. Defaults
                      to <code>http://cronium-orchestrator:8080</code> inside
                      Docker.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>VALKEY_URL</code>
                    </TableCell>
                    <TableCell>Optional</TableCell>
                    <TableCell>
                      Connection string for Valkey (use the
                      <code>valkey://</code> scheme). Falls back to in-memory
                      caching if omitted.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>SMTP_*</code>
                    </TableCell>
                    <TableCell>Optional</TableCell>
                    <TableCell>
                      Configure SMTP credentials when enabling email
                      notifications.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div id="orchestrator-env" className="space-y-3">
              <h3 className="text-xl font-semibold">Orchestrator</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Variable</TableHead>
                    <TableHead>Required</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      <code>CRONIUM_API_ENDPOINT</code>
                    </TableCell>
                    <TableCell>Yes</TableCell>
                    <TableCell>
                      Base URL of the Cronium app (internal service-to-service
                      address).
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>CRONIUM_API_TOKEN</code>
                    </TableCell>
                    <TableCell>Yes</TableCell>
                    <TableCell>
                      Must match <code>CRONIUM_ORCHESTRATOR_KEY</code> so the
                      orchestrator can authenticate with the app.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>CRONIUM_ORCHESTRATOR_ID</code>
                    </TableCell>
                    <TableCell>Yes</TableCell>
                    <TableCell>
                      Unique identifier for this orchestrator instance (used for
                      logging and job claims).
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>CRONIUM_CONTAINER_RUNTIME_JWT_SECRET</code>
                    </TableCell>
                    <TableCell>Yes*</TableCell>
                    <TableCell>
                      Shared secret between the orchestrator and the runtime API
                      for container job authentication. Required if you enable
                      the container executor.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>CRONIUM_CONTAINER_RUNTIME_BACKEND_URL</code>
                    </TableCell>
                    <TableCell>Optional</TableCell>
                    <TableCell>
                      Internal URL the runtime API should use to call back into
                      the Cronium app (defaults to{" "}
                      <code>http://cronium-app:3000</code>
                      ).
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>CRONIUM_CONTAINER_RUNTIME_VALKEY_URL</code>
                    </TableCell>
                    <TableCell>Optional</TableCell>
                    <TableCell>
                      Valkey connection string for coordinating container job
                      state (supports the <code>valkey://</code> scheme).
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>CRONIUM_SSH_EXECUTION_ISOLATION_MODE</code>
                    </TableCell>
                    <TableCell>Optional</TableCell>
                    <TableCell>
                      Defaults to <code>disabled</code>. Set to
                      <code>operator-enforced</code> only after a trusted
                      external launcher guarantees a separate UID or isolated
                      container for every mutually untrusted remote job. A
                      normal shared SSH account is not sufficient.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>LOG_LEVEL</code>
                    </TableCell>
                    <TableCell>Optional</TableCell>
                    <TableCell>
                      Overrides orchestrator logging verbosity. Defaults to
                      <code>info</code>.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <p className="text-muted-foreground text-xs">
                *Required when using container-based execution. An SSH-only
                environment must first satisfy and explicitly enable the
                external per-job isolation requirement.
              </p>
            </div>

            <div id="runtime-env" className="space-y-3">
              <h3 className="text-xl font-semibold">Runtime Service</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Variable</TableHead>
                    <TableHead>Required</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      <code>RUNTIME_BACKEND_URL</code>
                    </TableCell>
                    <TableCell>Yes</TableCell>
                    <TableCell>
                      Internal URL the runtime service should use to reach the
                      Cronium app (typically{" "}
                      <code>http://cronium-app:3000</code>).
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <em>(no backend token)</em>
                    </TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>
                      The runtime no longer holds a shared app credential. It
                      authenticates each callback with a per-job capability
                      token extracted from its execution JWT, so there is no{" "}
                      <code>RUNTIME_BACKEND_TOKEN</code> to configure.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>RUNTIME_VALKEY_URL</code>
                    </TableCell>
                    <TableCell>Yes</TableCell>
                    <TableCell>
                      Valkey connection string used for caching workflow state.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>RUNTIME_JWT_SECRET</code>
                    </TableCell>
                    <TableCell>Yes</TableCell>
                    <TableCell>
                      Same value as{" "}
                      <code>CRONIUM_CONTAINER_RUNTIME_JWT_SECRET</code>; used to
                      validate execution tokens.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>RUNTIME_PORT</code>
                    </TableCell>
                    <TableCell>Optional</TableCell>
                    <TableCell>
                      Port for the runtime API (defaults to <code>8081</code>).
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>RUNTIME_LOG_LEVEL</code>
                    </TableCell>
                    <TableCell>Optional</TableCell>
                    <TableCell>
                      Sets runtime logging verbosity. Defaults to{" "}
                      <code>info</code>.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div id="backing-services-env" className="space-y-3">
              <h3 className="text-xl font-semibold">Backing Services</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Variable</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>PostgreSQL</TableCell>
                    <TableCell>
                      <code>POSTGRES_USER</code>,<code>POSTGRES_PASSWORD</code>,
                      <code>POSTGRES_DB</code>
                    </TableCell>
                    <TableCell>
                      Standard PostgreSQL variables. Ensure they align with the
                      <code>DATABASE_URL</code> provided to the app.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Valkey</TableCell>
                    <TableCell>-</TableCell>
                    <TableCell>
                      No special variables required. Persistent volumes are
                      recommended for durability.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        </section>

        <section id="deployment-workflow" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Deployment Workflow</h2>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="text-primary h-5 w-5" />
                Step-by-step
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ol className="text-muted-foreground list-decimal space-y-2 pl-6">
                <li>
                  Provision infrastructure (virtual machines or Kubernetes
                  nodes) with enough CPU and memory for your anticipated
                  workload.
                </li>
                <li>
                  Complete the steps in{" "}
                  <a href="#env-setup" className="underline">
                    Prepare Your Environment
                  </a>{" "}
                  so you have a populated <code>.env</code> and the sample
                  Compose file ready to use.
                </li>
                <li>
                  Pull the <code>cronium-app</code>,{" "}
                  <code>cronium-orchestrator</code>, and{" "}
                  <code>cronium-runtime</code> images from GHCR, or build them
                  locally.
                </li>
                <li>
                  Run <code>docker compose up -d</code> and wait for all
                  containers to report healthy states.
                </li>
                <li>
                  Versioned database migrations are applied automatically every
                  time the app container starts, so there is nothing to run by
                  hand. If you set <code>AUTO_MIGRATE=false</code> to control
                  schema changes yourself, apply pending migrations from a clone
                  of the repository with <code>pnpm install</code> followed by{" "}
                  <code>
                    DATABASE_URL=... pnpm --filter @cronium/app db:migrate
                  </code>
                  .
                </li>
                <li>
                  Optional: add a custom orchestrator config (copy{" "}
                  <code>
                    apps/orchestrator/configs/cronium-orchestrator.yaml
                  </code>{" "}
                  from the repo) if you need advanced tuning for metrics, SSH
                  executors, or polling cadence.
                </li>
              </ol>
            </CardContent>
          </Card>
        </section>

        <section id="post-deployment" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Post-Deployment Checklist</h2>
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="text-primary h-5 w-5" />
                  Quick health checks
                </CardTitle>
                <CardDescription>
                  Confirm each service is reachable before inviting teammates.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-muted-foreground list-disc space-y-2 pl-6">
                  <li>
                    Web UI: visit <code>{`https://cronium.example.com`}</code>{" "}
                    (or your configured domain) – you should see the login
                    screen.
                  </li>
                  <li>
                    API health: run{" "}
                    <code>curl http://localhost:3000/api/health</code> from the
                    host running Docker.
                  </li>
                  <li>
                    Orchestrator and runtime: run <code>docker compose ps</code>{" "}
                    and confirm every service reports <code>healthy</code> —
                    both services are internal-only and are probed by their
                    container healthchecks.
                  </li>
                  <li>
                    Logs/WebSocket: tail{" "}
                    <code>docker compose logs cronium-app</code> while
                    triggering a job to verify live log streaming through the
                    proxied <code>/api/socketio</code> path.
                  </li>
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="text-primary h-5 w-5" />
                  Validate your installation
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-muted-foreground list-disc space-y-2 pl-6">
                  <li>
                    Visit <code>https://cronium.example.com</code> and create
                    the first admin account.
                  </li>
                  <li>
                    Monitor the orchestrator logs to ensure it is polling jobs
                    successfully.
                  </li>
                  <li>
                    Trigger a sample job from the dashboard and confirm the
                    workflow name appears in the Recent Activity table.
                  </li>
                  <li>
                    Configure SMTP credentials to enable password resets and
                    invitations.
                  </li>
                  <li>Set up TLS termination and rate limiting at the edge.</li>
                  <li>
                    Back up the PostgreSQL volume and orchestrator configuration
                    regularly.
                  </li>
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wrench className="text-primary h-5 w-5" />
                  Next steps
                </CardTitle>
                <CardDescription>
                  Keep your deployment healthy and secure.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-muted-foreground list-disc space-y-2 pl-6">
                  <li>
                    Set up monitoring for container health, orchestrator
                    metrics, and database performance.
                  </li>
                  <li>
                    Rotate secrets periodically and store them in a secrets
                    manager.
                  </li>
                  <li>
                    Configure automated rebuilds when new images of the app or
                    orchestrator are published.
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </section>

        <div className="border-info/40 from-info/10 to-primary/10 rounded-lg border bg-gradient-to-r p-6">
          <h3 className="mb-2 font-semibold">Need Help?</h3>
          <p className="text-muted-foreground mb-4 text-sm">
            Reach out to the Cronium community or open a discussion in the
            repository for assistance with your self-hosted deployment.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              href="/docs/quick-start"
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center justify-center rounded-md px-4 py-2 text-sm transition-colors"
            >
              Quick Start Guide
            </a>
            <a
              href="https://github.com/addison-moore/cronium/discussions"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
            >
              Community Discussions
            </a>
          </div>
        </div>
      </div>
    </DocsLayout>
  );
}

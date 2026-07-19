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
            plane (<code>cronium-app</code>), the secure job orchestrator (
            <code>cronium-orchestrator</code>), the runtime API used by
            containerised scripts, and supporting services (PostgreSQL for
            persistence and Valkey/Redis for caching). Docker Compose offers a
            simple way to run these services together.
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
                  <code>ENCRYPTION_KEY</code>, and a shared
                  <code>INTERNAL_API_KEY</code> between the app and orchestrator
                </li>
              </ul>
            </CardContent>
          </Card>
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
openssl rand -base64 32  # INTERNAL_API_KEY
openssl rand -hex 16     # POSTGRES_PASSWORD`}
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
AUTH_SECRET=<paste value>
ENCRYPTION_KEY=<paste value>
INTERNAL_API_KEY=<paste value>
JWT_SECRET=<paste value>
POSTGRES_PASSWORD=<paste value>
# Initial admin login (change it after first sign-in)
ADMIN_PASSWORD=<choose a password>`}
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
                <code>cronium-app</code> – Next.js control plane UI & API
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
docker build -t cronium-orchestrator:latest apps/orchestrator 
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
              Copy the following Compose file into{" "}
              <code>docker-compose.yml</code> — it is the same file the{" "}
              <code>curl</code> command above downloads. It deploys PostgreSQL,
              Valkey, the Cronium app, the orchestrator, and the runtime
              service. Every value is read from <code>.env</code> with sensible
              defaults, so a standard deployment never edits the YAML. To enable
              outbound email, add <code>SMTP_HOST</code>, <code>SMTP_PORT</code>
              , <code>SMTP_USER</code>, <code>SMTP_PASSWORD</code>, and{" "}
              <code>SMTP_FROM_EMAIL</code> to <code>.env</code>; without them
              email is disabled and the UI shows a warning.
            </p>
            <SimpleCodeBlock language="yaml">
              {`
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-cronium}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?generate with openssl rand -hex 16}
      POSTGRES_DB: \${POSTGRES_DB:-cronium}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-cronium}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - cronium

  valkey:
    image: valkey/valkey:7-alpine
    command: valkey-server --appendonly yes
    volumes:
      - valkey-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - cronium

  cronium-app:
    image: ghcr.io/addison-moore/cronium-app:latest
    env_file:
      - .env
    depends_on:
      postgres:
        condition: service_healthy
      valkey:
        condition: service_healthy
    environment:
      NODE_ENV: production
      AUTH_URL: \${AUTH_URL:-http://localhost:3000}
      PUBLIC_APP_URL: \${PUBLIC_APP_URL:-http://localhost:3000}
      NEXT_PUBLIC_APP_URL: \${PUBLIC_APP_URL:-http://localhost:3000}
      AUTH_SECRET: \${AUTH_SECRET:?generate with openssl rand -hex 32}
      ENCRYPTION_KEY: \${ENCRYPTION_KEY:?generate with openssl rand -hex 32 (must be 64 hex chars)}
      INTERNAL_API_KEY: \${INTERNAL_API_KEY:?generate with openssl rand -base64 32}
      JWT_SECRET: \${JWT_SECRET:?generate with openssl rand -hex 32}
      DATABASE_URL: postgres://\${POSTGRES_USER:-cronium}:\${POSTGRES_PASSWORD:?generate with openssl rand -hex 16}@postgres:5432/\${POSTGRES_DB:-cronium}
      ORCHESTRATOR_URL: http://cronium-orchestrator:8080
      VALKEY_URL: valkey://valkey:6379
      # Must be reachable from the user's browser (not a Docker service name).
      NEXT_PUBLIC_SOCKET_URL: \${NEXT_PUBLIC_SOCKET_URL:-http://localhost:5002}
      NEXT_PUBLIC_SOCKET_PORT: \${SOCKET_PORT:-5002}
      # Seeds the first admin user on boot so you can log in immediately.
      # Set AUTO_SEED_ADMIN=false in .env once set up.
      AUTO_SEED_ADMIN: \${AUTO_SEED_ADMIN:-true}
      ADMIN_USERNAME: \${ADMIN_USERNAME:-admin}
      ADMIN_EMAIL: \${ADMIN_EMAIL:-admin@example.com}
      ADMIN_PASSWORD: \${ADMIN_PASSWORD:?set the initial admin password in .env}
    ports:
      - "\${APP_PORT:-3000}:3000"
      - "\${SOCKET_PORT:-5002}:5002"
    restart: unless-stopped
    networks:
      - cronium

  cronium-orchestrator:
    image: ghcr.io/addison-moore/cronium-orchestrator:latest
    env_file:
      - .env
    depends_on:
      cronium-app:
        condition: service_healthy
      valkey:
        condition: service_healthy
      cronium-runtime:
        condition: service_healthy
    environment:
      CRONIUM_API_ENDPOINT: http://cronium-app:3000
      CRONIUM_API_TOKEN: \${INTERNAL_API_KEY:?generate with openssl rand -base64 32}
      CRONIUM_ORCHESTRATOR_ID: \${ORCHESTRATOR_ID:-orchestrator-1}
      CRONIUM_CONTAINER_RUNTIME_JWT_SECRET: \${JWT_SECRET:?generate with openssl rand -hex 32}
      CRONIUM_CONTAINER_RUNTIME_BACKEND_URL: http://cronium-app:3000
      CRONIUM_CONTAINER_RUNTIME_VALKEY_URL: valkey://valkey:6379
      # Per-job runtime sidecars join this network to reach the app and Valkey;
      # must match the network name declared at the bottom of this file.
      CRONIUM_CONTAINER_RUNTIME_SHARED_NETWORK: cronium
      # Remote (runner) execution tunnels to this shared runtime service; must
      # match the cronium-runtime service name:port below.
      RUNTIME_HOST: cronium-runtime
      RUNTIME_PORT: 8081
      LOG_LEVEL: \${LOG_LEVEL:-info}
    healthcheck:
      test: ["CMD", "/app/orchestrator", "healthcheck"]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      # Persists the payload signing key and SSH known_hosts across upgrades.
      - orchestrator-data:/app/data
    restart: unless-stopped
    user: "0:0"
    networks:
      - cronium

  cronium-runtime:
    image: ghcr.io/addison-moore/cronium-runtime:latest
    env_file:
      - .env
    depends_on:
      cronium-app:
        condition: service_healthy
      valkey:
        condition: service_healthy
    environment:
      RUNTIME_PORT: 8081
      RUNTIME_JWT_SECRET: \${JWT_SECRET:?generate with openssl rand -hex 32}
      RUNTIME_BACKEND_URL: http://cronium-app:3000
      RUNTIME_BACKEND_TOKEN: \${INTERNAL_API_KEY:?generate with openssl rand -base64 32}
      RUNTIME_VALKEY_URL: valkey://valkey:6379
      RUNTIME_LOG_LEVEL: \${LOG_LEVEL:-info}
    restart: unless-stopped
    networks:
      - cronium

volumes:
  postgres-data: {}
  valkey-data: {}
  orchestrator-data: {}

networks:
  # Explicitly named so it doesn't vary with the compose project name — the
  # orchestrator attaches per-job runtime sidecars to it by this exact name.
  cronium:
    name: cronium
`}
            </SimpleCodeBlock>
            <p className="text-muted-foreground text-sm">
              On first boot Cronium seeds an admin user (username{" "}
              <code>admin</code> unless you set <code>ADMIN_USERNAME</code>)
              with the <code>ADMIN_PASSWORD</code> from your <code>.env</code>.
              There is no default password — Compose refuses to start until you
              set one. After the initial setup, set{" "}
              <code>AUTO_SEED_ADMIN=false</code> in <code>.env</code>.
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
              host Docker daemon. Remove it only when you exclusively use SSH
              runners.
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
                      <code>INTERNAL_API_KEY</code>
                    </TableCell>
                    <TableCell>Yes</TableCell>
                    <TableCell>
                      Shared token that internal services (orchestrator,
                      runtime) must present when calling the app&apos;s internal
                      APIs; generate with <code>openssl rand -base64 32</code>.
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
                      Must match <code>INTERNAL_API_KEY</code> so the
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
                *Required when using container-based execution. For SSH-only
                environments you may omit the runtime service and related
                secrets.
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
                      <code>RUNTIME_BACKEND_TOKEN</code>
                    </TableCell>
                    <TableCell>Yes</TableCell>
                    <TableCell>
                      Must match <code>INTERNAL_API_KEY</code> to authenticate
                      runtime calls.
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
                  Database migrations are applied automatically the first time
                  the app container starts, so there is nothing to run by hand.
                  If you set <code>AUTO_MIGRATE=false</code> to manage the
                  schema yourself, apply it from a clone of the repository with{" "}
                  <code>pnpm install</code> followed by{" "}
                  <code>pnpm --filter @cronium/app db:push</code>.
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
                    triggering a job to verify live log streaming on port{" "}
                    <code>5002</code>.
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

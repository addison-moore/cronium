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
          <h1 className="mb-4 text-4xl font-bold">Self-Hosting Cronium</h1>
          <p className="text-muted-foreground text-xl">
            Deploy the Cronium application stack with Docker Compose. This guide
            covers the required services, recommended configuration, and the
            environment variables needed to run Cronium in your own
            infrastructure.
          </p>
        </div>

        <section id="overview" className="mb-12">
          <h2 className="mb-6 text-3xl font-bold">Overview</h2>
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
          <h2 className="mb-6 text-3xl font-bold">Prerequisites</h2>
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
          <h2 className="mb-6 text-3xl font-bold">Prepare Your Environment</h2>
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
                  manager with a 64-character random string:
                  <SimpleCodeBlock language="bash" className="mt-2">
                    {`# macOS / Linux / WSL
openssl rand -hex 32  # paste into AUTH_SECRET, ENCRYPTION_KEY, JWT_SECRET
openssl rand -base64 32  # paste into INTERNAL_API_KEY`}
                  </SimpleCodeBlock>
                </li>
                <li>
                  <strong>
                    Create a minimal <code>.env</code> file
                  </strong>{" "}
                  with the secrets you generated and your public domain (use{" "}
                  <code>http://localhost:3000</code> if you are testing
                  locally). Paste these values into the Compose file
                  placeholders or add <code>env_file: ['.env']</code> to reuse
                  them automatically:
                  <SimpleCodeBlock language="env" className="mt-2">
                    {`AUTH_URL=https://cronium.example.com
PUBLIC_APP_URL=https://cronium.example.com
AUTH_SECRET=<paste value>
ENCRYPTION_KEY=<paste value>
INTERNAL_API_KEY=<paste value>
JWT_SECRET=<paste value>`}
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
          <h2 className="mb-6 text-3xl font-bold">Container Images</h2>
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
          <h2 className="mb-6 text-3xl font-bold">Docker Compose Example</h2>
          <div className="space-y-6">
            <p>
              Copy the following Compose file into{" "}
              <code>docker-compose.yml</code> and adjust environment variables
              and volume mounts for your environment. The compose file deploys
              PostgreSQL, Valkey, the Cronium app, the orchestrator, and the
              runtime service. SMTP is automatically used whenever credentials
              are provided; missing credentials will disable outbound email and
              surface warnings in the UI.
            </p>
            <SimpleCodeBlock language="yaml">
              {`
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: cronium
      POSTGRES_PASSWORD: super-secure-password
      POSTGRES_DB: cronium
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cronium"]
      interval: 10s
      timeout: 5s
      retries: 5

  valkey:
    image: valkey/valkey:7-alpine
    command: valkey-server --appendonly yes
    volumes:
      - valkey-data:/data
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

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
      AUTO_SEED_ADMIN: "true"
      ADMIN_USERNAME: admin
      ADMIN_EMAIL: admin@example.com
      ADMIN_PASSWORD: admin
      SMTP_HOST: smtp.example.com
      SMTP_PORT: 587
      SMTP_USER: smtp_user
      SMTP_PASSWORD: smtp_password
      SMTP_FROM_EMAIL: admin@example.com
      NODE_ENV: production
      AUTH_URL: https://cronium.example.com
      PUBLIC_APP_URL: https://cronium.example.com
      NEXT_PUBLIC_APP_URL: https://cronium.example.com
      AUTH_SECRET: replace-with-random-string
      ENCRYPTION_KEY: replace-with-32-byte-key
      INTERNAL_API_KEY: replace-with-shared-internal-key
      JWT_SECRET: replace-with-runtime-jwt-secret
      DATABASE_URL: postgres://cronium:super-secure-password@postgres:5432/cronium
      ORCHESTRATOR_URL: http://cronium-orchestrator:8080
      VALKEY_URL: valkey://valkey:6379
      NEXT_PUBLIC_SOCKET_URL: http://cronium-app:5002
      NEXT_PUBLIC_SOCKET_PORT: 5002
    ports:
      - "3000:3000"
      - "5002:5002"

  cronium-orchestrator:
    image: ghcr.io/addison-moore/cronium-orchestrator:latest
    env_file:
      - .env
    depends_on:
      - cronium-app
      - valkey
    environment:
      CRONIUM_API_ENDPOINT: http://cronium-app:3000
      CRONIUM_API_TOKEN: replace-with-shared-internal-key
      CRONIUM_ORCHESTRATOR_ID: orchestrator-1
      CRONIUM_CONTAINER_RUNTIME_JWT_SECRET: replace-with-runtime-jwt-secret
      CRONIUM_CONTAINER_RUNTIME_BACKEND_URL: http://cronium-app:3000
      CRONIUM_CONTAINER_RUNTIME_VALKEY_URL: valkey://valkey:6379
      LOG_LEVEL: info
    ports:
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    user: "0:0"

  cronium-runtime:
    image: ghcr.io/addison-moore/cronium-runtime:latest
    env_file:
      - .env
    depends_on:
      - cronium-app
      - valkey
    environment:
      RUNTIME_PORT: 8081
      RUNTIME_JWT_SECRET: replace-with-runtime-jwt-secret
      RUNTIME_BACKEND_URL: http://cronium-app:3000
      RUNTIME_BACKEND_TOKEN: replace-with-shared-internal-key
      RUNTIME_VALKEY_URL: valkey://valkey:6379
      RUNTIME_LOG_LEVEL: info
    ports:
      - "8081:8081"

volumes:
  postgres-data: {}
  valkey-data: {}
`}
            </SimpleCodeBlock>
            <p className="text-muted-foreground text-sm">
              Replace the placeholder secrets in <code>.env</code> (or inline
              them if you prefer). The example already loads <code>.env</code>{" "}
              for each service. Setting <code>AUTO_SEED_ADMIN=true</code> seeds
              an admin user and default settings on first boot; change the
              <code>ADMIN_*</code> and SMTP values to your desired bootstrap
              credentials before deploying.
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
          <h2 className="mb-6 text-3xl font-bold">Environment Variables</h2>
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
          <h2 className="mb-6 text-3xl font-bold">Deployment Workflow</h2>
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
                  Apply database migrations from your workstation (requires
                  Node.js and pnpm): clone the Cronium repository, run{" "}
                  <code>pnpm install</code>, then execute{" "}
                  <code>pnpm --filter @cronium/app db:push</code>. The published
                  app image does not bundle pnpm, so migrations should run
                  outside the container or via your CI pipeline.
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
          <h2 className="mb-6 text-3xl font-bold">Post-Deployment Checklist</h2>
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
                    Orchestrator health:{" "}
                    <code>curl http://localhost:8080/health</code>; expect a
                    JSON payload with <code>status: "healthy"</code>.
                  </li>
                  <li>
                    Runtime API: <code>curl http://localhost:8081/health</code>{" "}
                    for a simple heartbeat.
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

        <div className="rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-6 dark:border-blue-800 dark:from-blue-950 dark:to-indigo-950">
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

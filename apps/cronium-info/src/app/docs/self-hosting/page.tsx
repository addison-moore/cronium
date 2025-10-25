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
      <div className="mx-auto max-w-4xl space-y-12">
        <header>
          <h1 className="mb-4 text-4xl font-bold">Self-Hosting Cronium</h1>
          <p className="text-muted-foreground text-xl">
            Deploy the Cronium application stack with Docker Compose. This guide
            covers the required services, recommended configuration, and the
            environment variables needed to run Cronium in your own
            infrastructure.
          </p>
        </header>

        <section id="overview" className="space-y-4">
          <h2 className="text-2xl font-bold">Overview</h2>
          <p>
            A production Cronium deployment consists of the Next.js control
            plane (<code>cronium-app</code>), the secure job orchestrator (
            <code>cronium-orchestrator</code>), the runtime API used by
            containerised scripts, and supporting services (PostgreSQL for
            persistence and Valkey/Redis for caching). Docker Compose offers a
            simple way to run these services together.
          </p>
          <Alert>
            <AlertTitle>Images required</AlertTitle>
            <AlertDescription>
              Build or pull the&nbsp;
              <code>cronium-app</code> and <code>cronium-orchestrator</code>{" "}
              images before continuing. If you have a registry, push the images
              there and update the sample Compose file accordingly.
            </AlertDescription>
          </Alert>
        </section>

        <section id="prerequisites" className="space-y-6">
          <h2 className="text-2xl font-bold">Prerequisites</h2>
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

        <section id="container-images" className="space-y-4">
          <h2 className="text-2xl font-bold">Container Images</h2>
          <p>
            The Compose example below assumes the following images are available
            locally or in a registry you can pull from:
          </p>
          <ul className="text-muted-foreground list-disc space-y-2 pl-6">
            <li>
              <code>cronium-app:latest</code> – Next.js control plane
            </li>
            <li>
              <code>cronium-orchestrator:latest</code> – Go daemon that executes
              jobs
            </li>
            <li>
              <code>cronium-runtime:latest</code> – Runtime API for container
              executions (optional if you only use SSH targets)
            </li>
          </ul>
          <p>
            Replace these tags with registry-qualified image references if you
            publish them to a private or public registry.
          </p>
        </section>

        <section id="docker-compose-example" className="space-y-6">
          <h2 className="text-2xl font-bold">Docker Compose Example</h2>
          <p>
            Copy the following Compose file into <code>docker-compose.yml</code>{" "}
            and adjust environment variables and volume mounts for your
            environment. The compose file deploys PostgreSQL, Valkey, the
            Cronium app, the orchestrator, and the runtime service.
          </p>
          <SimpleCodeBlock language="yaml">
            {`version: "3.9"

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
    image: cronium-app:latest
    depends_on:
      postgres:
        condition: service_healthy
      valkey:
        condition: service_healthy
    environment:
      NODE_ENV: production
      PUBLIC_APP_URL: https://cronium.example.com
      AUTH_URL: https://cronium.example.com
      AUTH_SECRET: replace-with-random-string
      DATABASE_URL: postgres://cronium:super-secure-password@postgres:5432/cronium
      ENCRYPTION_KEY: replace-with-32-byte-key
      INTERNAL_API_KEY: replace-with-shared-internal-key
      ORCHESTRATOR_URL: http://cronium-orchestrator:8080
      VALKEY_URL: redis://valkey:6379
    ports:
      - "3000:3000"
    command: ["node", "server.js"]

  cronium-orchestrator:
    image: cronium-orchestrator:latest
    depends_on:
      - cronium-app
      - valkey
    environment:
      CRONIUM_API_ENDPOINT: http://cronium-app:3000
      CRONIUM_API_TOKEN: replace-with-shared-internal-key
      CRONIUM_ORCHESTRATOR_ID: orchestrator-1
      CRONIUM_CONTAINER_RUNTIME_JWT_SECRET: replace-with-runtime-jwt-secret
      CRONIUM_CONTAINER_RUNTIME_BACKEND_URL: http://cronium-app:3000
      CRONIUM_CONTAINER_RUNTIME_VALKEY_URL: redis://valkey:6379
    volumes:
      - ./config/cronium-orchestrator.yaml:/app/config/cronium-orchestrator.yaml:ro

  cronium-runtime:
    image: cronium-runtime:latest
    depends_on:
      - cronium-app
      - valkey
    environment:
      PORT: 8089
      BACKEND_URL: http://cronium-app:3000
      BACKEND_TOKEN: replace-with-shared-internal-key
      VALKEY_URL: redis://valkey:6379
      JWT_SECRET: replace-with-runtime-jwt-secret
    ports:
      - "8089:8089"

volumes:
  postgres-data: {}
  valkey-data: {}`}
          </SimpleCodeBlock>
          <p className="text-muted-foreground text-sm">
            The example mounts an orchestrator configuration file from{" "}
            <code>./config/cronium-orchestrator.yaml</code>. Generate this file
            from the sample provided in the repository and update it for your
            environment (metrics, logging, SSH executor options, etc.).
          </p>
        </section>

        <section id="environment-variables" className="space-y-6">
          <h2 className="text-2xl font-bold">Environment Variables</h2>
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
                    Random string used by NextAuth to sign session cookies.
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>DATABASE_URL</code>
                  </TableCell>
                  <TableCell>Yes</TableCell>
                  <TableCell>
                    PostgreSQL connection string in the format{" "}
                    <code>postgres://user:pass@host:5432/db</code>.
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>ENCRYPTION_KEY</code>
                  </TableCell>
                  <TableCell>Yes</TableCell>
                  <TableCell>
                    32-byte key (Base64 or hex) used to encrypt stored secrets.
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>INTERNAL_API_KEY</code>
                  </TableCell>
                  <TableCell>Yes</TableCell>
                  <TableCell>
                    Shared token that internal services (orchestrator, runtime)
                    must present when calling the app&apos;s internal APIs.
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>ORCHESTRATOR_URL</code>
                  </TableCell>
                  <TableCell>Optional</TableCell>
                  <TableCell>
                    Base URL for the orchestrator health endpoints. Defaults to{" "}
                    <code>http://orchestrator:8080</code>.
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>VALKEY_URL</code>
                  </TableCell>
                  <TableCell>Optional</TableCell>
                  <TableCell>
                    Connection string for Valkey if you want to offload caching.
                    Defaults to in-memory if omitted.
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
                    Must match <code>INTERNAL_API_KEY</code> so the orchestrator
                    can authenticate with the app.
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
                    for container job authentication. Required if you enable the
                    container executor.
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>CRONIUM_CONTAINER_RUNTIME_BACKEND_URL</code>
                  </TableCell>
                  <TableCell>Optional</TableCell>
                  <TableCell>
                    URL that the runtime API should use to call back into the
                    Cronium app (defaults to{" "}
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
                    Valkey URL used for runtime job coordination.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="text-muted-foreground text-xs">
              *Required when using container-based execution. For SSH-only
              environments you may omit the runtime service and related secrets.
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
                    <code>BACKEND_URL</code>
                  </TableCell>
                  <TableCell>Yes</TableCell>
                  <TableCell>
                    Internal URL the runtime service should use to reach the
                    Cronium app.
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>BACKEND_TOKEN</code>
                  </TableCell>
                  <TableCell>Yes</TableCell>
                  <TableCell>
                    Must match <code>INTERNAL_API_KEY</code> to authenticate
                    runtime calls.
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>VALKEY_URL</code>
                  </TableCell>
                  <TableCell>Yes</TableCell>
                  <TableCell>
                    Valkey connection string used for caching workflow state.
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>JWT_SECRET</code>
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
                    <code>PORT</code>
                  </TableCell>
                  <TableCell>Optional</TableCell>
                  <TableCell>
                    Port for the runtime API (defaults to <code>8089</code>).
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
        </section>

        <section id="deployment-workflow" className="space-y-4">
          <h2 className="text-2xl font-bold">Deployment Workflow</h2>
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
                  Build or pull the <code>cronium-app</code>,
                  <code>cronium-orchestrator</code>, and
                  <code>cronium-runtime</code> images.
                </li>
                <li>
                  Generate secrets (<code>AUTH_SECRET</code>,
                  <code>ENCRYPTION_KEY</code>, <code>INTERNAL_API_KEY</code>,
                  runtime JWT secret) and store them securely.
                </li>
                <li>
                  Update the Compose file with the generated secrets, domain,
                  and registry image names.
                </li>
                <li>
                  Create the orchestrator config file (copy
                  <code>
                    apps/orchestrator/configs/cronium-orchestrator.yaml
                  </code>{" "}
                  as a starting point) and mount it into the orchestrator
                  container.
                </li>
                <li>
                  Run <code>docker compose up -d</code> and wait for all
                  containers to report healthy states.
                </li>
                <li>
                  Apply database migrations by running{" "}
                  <code>pnpm --filter @cronium/app db:push</code> inside the app
                  container, or execute the equivalent command through your CI.
                </li>
              </ol>
            </CardContent>
          </Card>
        </section>

        <section id="post-deployment" className="space-y-4">
          <h2 className="text-2xl font-bold">Post-Deployment Checklist</h2>
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
                  Visit <code>https://cronium.example.com</code> and create the
                  first admin account.
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
                  Set up monitoring for container health, orchestrator metrics,
                  and database performance.
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
        </section>

        <footer className="text-muted-foreground border-t border-gray-200 pt-6 text-sm dark:border-gray-800">
          Need help? Reach out to the Cronium community or open a discussion in
          the repository.
        </footer>
      </div>
    </DocsLayout>
  );
}

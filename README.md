<div align="center">

# <img src="apps/cronium-info/public/assets/logo-icon.svg" alt="Cronium Logo" width="42" height="42" style="vertical-align: middle;" /> Cronium

**Open-source automation platform for scheduled scripts and workflows**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org/)
[![Go](https://img.shields.io/badge/Go-1.21+-00ADD8.svg)](https://golang.org/)
[![AGPL License](https://img.shields.io/badge/license-AGPL-blue.svg)](LICENSE-AGPL.md)
[![Commercial License](https://img.shields.io/badge/license-Commercial-blue.svg)](COMMERCIAL-LICENSE.md)

[Website](https://cronium.app) • [Documentation](https://cronium.app/docs) • [Discord](https://discord.gg/cronium)
</div>

---

## ✨ Overview

Cronium is a powerful, self-hosted automation platform designed to simplify the scheduling and execution of scripts, workflows, and HTTP requests. Built with modern technologies and a focus on developer experience, Cronium provides a comprehensive solution for task automation with both local and remote execution capabilities.

## ⚡ Quick Start

Self-host Cronium with one command (Docker Engine 24+ with Compose V2 required):

```bash
curl -fsSL https://raw.githubusercontent.com/addison-moore/cronium/main/install.sh | bash
```

The installer generates all secrets, starts the stack, and waits until it is
healthy; your first browser visit walks you through creating the admin
account. Prefer to see every step? The manual path is two commands:

```bash
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/addison-moore/cronium/main/docker-compose.example.yml
docker compose up -d   # tells you exactly which .env values to generate
```

Full instructions, upgrades, and backups: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
or https://cronium.app/docs/self-hosting. For local development, see
[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md). For a public deployment,
route only `/api/socketio` through your TLS proxy to the loopback-bound port 5002. Cronium applies exact origin checks, shared one-time tickets, and active
authorization revocation to live logs and terminals.

## Key Features

### **Event Scheduling**

- Schedule scripts (Bash, Node.js, Python) and HTTP requests
- Flexible cron expressions with visual editor
- One-time and recurring schedules
- Timezone support

### **Workflow Automation**

- Chain multiple events into complex workflows
- Conditional logic and branching
- Data passing between workflow steps
- Visual workflow builder

### **Execution Environments**

- **Local Execution**: Isolated Docker containers for security
- **Remote Execution**: SSH execution gated on operator-enforced per-job isolation
- **Server Management**: Organize and manage multiple execution targets

### **Developer Tools**

- **Runtime Helpers**: Built-in functions for data management
  - `cronium.input()` / `cronium.output()` - Pass data between events
  - `cronium.getVariable()` / `cronium.setVariable()` - Manage runtime variables
  - `cronium.event()` - Access event metadata
- **Interactive Terminal**: Real-time script execution with xterm.js
- **Version Control**: Track changes and rollback when needed

### 📊 **Monitoring & Logging**

- Real-time execution logs via WebSockets
- Execution history and status tracking
- Performance metrics and analytics
- Error notifications and alerts

### **Integrations**

- **Communication**: Slack, Discord, Teams, Email notifications
- **Tools**: Extensible plugin system for custom integrations

### **Security & Access Control**

- Role-based permissions (Admin, User, Viewer)
- Encrypted storage for sensitive data
- SSH key management
- Isolated execution environments

### **Frontend Stack**

- **Next.js 15** with App Router for the web interface
- **TypeScript** for type safety
- **TailwindCSS 4** for styling
- **React Hook Form + Zod** for form validation
- **tRPC** for type-safe API communication

### **Backend Stack**

- **Go** microservices for orchestration and runtime
- **PostgreSQL** with Drizzle ORM
- **Docker** for containerized execution
- **WebSockets** for real-time features

### **Infrastructure**

- **Turborepo** for monorepo management
- **PNPM** for package management
- **Docker Compose** for local development
- Self-hosted deployment options

## Project Structure

```
cronium/
├── apps/
│   ├── cronium-app/      # Main web application
│   ├── cronium-info/     # Documentation site
│   ├── orchestrator/     # Go orchestration service
│   └── runtime/          # Go runtime service
├── packages/
│   ├── ui/               # Shared UI components
│   └── config-*/         # Shared configurations
├── infra/                # Infrastructure and deployment
└── docs/                 # Documentation
```

## Use Cases

- **DevOps Automation**: Scheduled backups, deployments, and maintenance tasks
- **Data Processing**: ETL pipelines, report generation, data synchronization
- **Monitoring**: Health checks, uptime monitoring, alert systems
- **Integration Workflows**: Connect multiple services and APIs
- **Testing**: Automated test runs, smoke tests, regression testing
- **Notifications**: Scheduled reminders, status updates, digest emails

## Why Cronium?

- **Self-Hosted**: Complete control over your data and infrastructure
- **Modern Stack**: Built with the latest technologies for performance and reliability
- **Developer-Friendly**: Intuitive UI with powerful scripting capabilities
- **Extensible**: Plugin system for custom integrations
- **Open Source**: Community-driven development and transparency

## Roadmap

- [ ] Advanced workflow templates
- [ ] Kubernetes support for execution
- [ ] Advanced monitoring dashboards

## Contributing

We welcome contributions! Cronium is in active development, and we're excited to work with the community to make it even better.

- Report bugs and request features through [GitHub Issues](https://github.com/addison-moore/cronium/issues)
- Join our [Discord community](https://discord.gg/cronium) for discussions
- Check our [Contributing Guide](CONTRIBUTING.md) (coming soon)

## License

Cronium is dual-licensed under:

- **GNU Affero General Public License v3.0 (AGPL-3.0)** You are free to use, modify, and redistribute Cronium, provided that any modifications you make and deploy (including over a network) are also released under the AGPL.
- **Commercial License** If you wish to use Cronium in a way that does not comply with the AGPL (for example, to offer it as a closed-source SaaS or embed it in a proprietary product), you must obtain a commercial license from us.

For commercial licensing inquiries, please contact **[addisondrewmoore@gmail.com](mailto:addisondrewmoore@gmail.com)**.

See [LICENSE-AGPL.md](LICENSE-AGPL.md) for the full AGPL text and [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) for commercial terms.

---

<div align="center">
  <strong>Cronium is in active development. Self-hosting is ready today.See the Quick Start above.</strong>
</div>

# Cronium Documentation

Cronium is an open-source, self-hosted automation platform. Schedule Python,
Node.js, and Bash scripts, build multi-step workflows, and run them on your own
servers.

User-facing guides also live at <https://cronium.app/docs>. The documents here
are aimed at people **running** or **developing** Cronium.

## Start here

| Guide                                          | Use it when                                            |
| ---------------------------------------------- | ------------------------------------------------------ |
| [GETTING_STARTED.md](./GETTING_STARTED.md)     | Setting up a local development environment             |
| [DEVELOPMENT_SETUP.md](./DEVELOPMENT_SETUP.md) | Detailed dev setup: Go services, Docker images, the DB |
| [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md) | Deploying with prebuilt images from ghcr.io            |
| [DEPLOYMENT.md](./DEPLOYMENT.md)               | Production deployment, secrets, and operations         |

## Concepts

| Guide                                    | Covers                                         |
| ---------------------------------------- | ---------------------------------------------- |
| [FEATURE_LIST.md](./FEATURE_LIST.md)     | Everything Cronium can do, feature by feature  |
| [EVENTS.md](./EVENTS.md)                 | Events — the unit of automation                |
| [WORKFLOWS.md](./WORKFLOWS.md)           | Chaining events into DAG pipelines             |
| [Execution_Flow.md](./Execution_Flow.md) | How a job travels from trigger to result       |
| [Integrations.md](./Integrations.md)     | Tools vs. integrations vs. plugins             |
| [AUTH.md](./AUTH.md)                     | Authentication, sessions, and roles            |
| [MCP.md](./MCP.md)                       | Create events & workflows from an AI app (MCP) |
| [TIMEOUTS.md](./TIMEOUTS.md)             | Timeout behavior across the stack              |

## Reference

| Guide                                                  | Covers                                |
| ------------------------------------------------------ | ------------------------------------- |
| [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md) | Every environment variable            |
| [tools/](./tools/)                                     | Tool actions: API, templates, testing |
| [containerized-execution/](./containerized-execution/) | Orchestrator environment variables    |

## Contributing

| Guide                                                        | Covers                             |
| ------------------------------------------------------------ | ---------------------------------- |
| [TRPC.md](./TRPC.md)                                         | tRPC router and procedure patterns |
| [TYPE_SAFETY.md](./TYPE_SAFETY.md)                           | End-to-end type-safety conventions |
| [RHF_GUIDE.md](./RHF_GUIDE.md)                               | React Hook Form + Zod patterns     |
| [STYLING.md](./STYLING.md)                                   | TailwindCSS conventions            |
| [UX_GUIDE.md](./UX_GUIDE.md)                                 | UI/UX conventions                  |
| [CACHING_STRATEGY.md](./CACHING_STRATEGY.md)                 | Caching layers                     |
| [QUERY_OPTIMIZATION_GUIDE.md](./QUERY_OPTIMIZATION_GUIDE.md) | Database query performance         |

See also the repository root: [CONTRIBUTING.md](../CONTRIBUTING.md) and
[SECURITY.md](../SECURITY.md).

## Internal notes

[`internal/`](./internal/) holds historical and unmaintained working notes.
They are kept for context only — prefer the documents above.

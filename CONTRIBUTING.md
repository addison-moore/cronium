# Contributing to Cronium

Thanks for your interest in contributing! Cronium is an open-source, self-hosted
automation platform. This guide covers how to get set up and the conventions we
follow.

## Getting started

See [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) for the full development
setup. In short:

```bash
pnpm install          # install all workspace dependencies
pnpm dev              # start all services
```

The repo is a Turborepo + pnpm workspace with a Go workspace for the
orchestrator, runtime, and runner services. See the README for the layout.

## Before you open a pull request

Run the same checks CI runs:

```bash
pnpm lint         # ESLint + golangci-lint
pnpm typecheck    # tsc --noEmit across TS packages
pnpm test         # Jest (TS) + go test (Go)
```

For the Go services:

```bash
cd apps/orchestrator && go vet ./... && go test ./...
```

All three must pass before a PR can merge.

## Conventions

- **Branches:** work on a feature branch, not `main`. Use a short descriptive
  name (`fix/webhook-payload`, `feat/discord-actions`).
- **Commits:** write clear, imperative-mood messages. Group related changes.
- **Changelog:** log user-facing changes to a dated file in `changelog/`
  (`changelog/YYYY-MM-DD.md`) in the format
  `- [YYYY-MM-DD] [Change Type] [Description]`. Change types: Feature, Bug Fix,
  Refactor, Documentation, Testing, Performance, etc.
- **Code style:** TypeScript with the shared ESLint/Prettier config; Go
  formatted with `gofmt`. Run `pnpm format` to auto-format.
- **UI/UX:** do not remove pages, components, features, or change styling
  without discussion — see the UI/UX guidelines in the project docs.

## Reporting issues

Use the issue templates. For security vulnerabilities, follow
[SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

By contributing, you agree that your contributions are licensed under the
project's AGPL-3.0 license (see [LICENSE](LICENSE) and
[LICENSE-AGPL.md](LICENSE-AGPL.md)).

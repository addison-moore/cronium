# Recommendation for Transitioning **Cronium** to a Monorepo

> **Audience:** Core engineering team, project stakeholders
> **Goal:** Provide a concrete, technology‑focused blueprint that guides Cronium’s move from multiple repos / scattered folders to a single, well‑structured monorepo.

---

## 1  Purpose & Scope

- **Purpose** – Consolidate Cronium’s dashboard (Next.js/TS), orchestrator & runtime services (Go), and all infrastructure manifests under one repository to improve developer velocity, consistency, and release management.
- **Out of Scope** – The public marketing / documentation site (to be built after the transition) is excluded. However, we plan for it to **consume shared packages** published from the monorepo.

## 2  Guiding Principles

1. **Clear domain boundaries** – “Deployables” live in **apps/**; pure libraries & configs live in **packages/**.
2. **Single‑source versioning** – One Git tag = one compatible release of _all_ services.
3. **Incremental builds** – Re‑build only what changed using Turborepo & Go cache.
4. **Low‑friction onboarding** – One‑command dev (`pnpm dev`) spins up everything via docker‑compose.
5. **History preservation** – Use `git mv` to retain commit history during migration.

## 3  Proposed Repository Layout

```
./
├─ apps/            # Deployable services & sites
│  ├─ cronium/      # Next.js 15 SaaS app (open source)
│  ├─ orchestrator/ # Go service
│  └─ runtime/      # Go service
├─ packages/        # Shareable libraries & configuration
│  ├─ ui/           # shadcn‑based design system
│  ├─ tailwind‑config/
│  ├─ eslint‑config/
│  ├─ tsconfig/
│  ├─ shared‑types/ # zod + protobuf/JSON schemas
│  └─ go‑common/    # Shared Go helpers (if needed)
├─ infra/           # **All** infra as code
│  ├─ compose/
│  └─ scripts/
├─ pnpm‑workspace.yaml
├─ turbo.json
├─ go.work
└─ README.md
```

### Rationale

- **apps/** vs **packages/** keeps boundaries explicit.
- **infra/** centralises DevOps files, removing YAML clutter from repo root.
- `go.work` allows multiple Go modules to share replace paths & build cache.

## 4  Technology Stack & Tooling

| Need                                 | Recommendation                            | Notes                                                                                      |
| ------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Workspace & package manager**      | **pnpm** + `pnpm‑workspace.yaml`          | Faster & disk‑efficient; works seamlessly with Turborepo.                                  |
| **Build graph & cache**              | **Turborepo**                             | Incremental builds, parallel tasks, remote caching optional.                               |
| **Go multi‑module support**          | **go.work**                               | Groups `apps/orchestrator`, `apps/runtime`, and `packages/go‑common`.                      |
| **Monorepo CI**                      | **GitHub Actions** matrix + Turbo caching | Lint → Test → Build for TS & Go in parallel; cache `~/.pnpm‑store`, Go build cache, Turbo. |
| **Type checking**                    | `tsc --build` per package + Go vet        | Ensures packages compile independently.                                                    |
| **Linting**                          | `eslint` (TS), `golangci‑lint` (Go)       | Central rules in `packages/eslint‑config`.                                                 |
| **Tests**                            | **Vitest** (TS) + `go test`               | Fast, watch‑mode in Vitest.                                                                |
| **Storybook**                        | In `packages/ui`                          | Develop UI in isolation; deploy to Chromatic later.                                        |
| **Semantic versioning & changelogs** | **Changesets**                            | Auto bump & publish `packages/*` to npm / GitHub Packages.                                 |
| **Depend‑abot / Renovate**           | Renovate                                  | Single PR stream across the monorepo.                                                      |
| **Container images**                 | GitHub Container Registry                 | Build & push orchestrator/runtime images in CI.                                            |

## 5  Developer Workflow (After Migration)

```bash
pnpm install        # installs all JS/TS deps
pnpm dev            # dashboard hot‑reload + Go services via compose
pnpm build          # turbo builds packages → apps
pnpm test           # vitest + go test
```

- **Local infra** – `docker compose -f infra/compose/dev.yaml up` spins Valkey, Postgres, etc.
- **Scripts** – Provide `scripts/*.sh` wrappers to abstract long Turborepo commands.

## 6  CI/CD Pipeline Overview

1. **Checkout & cache restore** (node_modules, pnpm‑store, Go cache).
2. **Install** – `pnpm install --frozen-lockfile`.
3. **Lint & tests** – Turbo run `lint` & `test` across all affected packages/apps.
4. **Build** – Turbo run `build` (Next.js, Go, Storybook).
5. **Publish packages** (if `changesets` finds version bumps).
6. **Build & push Docker images** for orchestrator & runtime (tagged with commit SHA & semver).
7. **Deploy** – trigger environment‑specific workflows or ArgoCD sync.

## 7  Migration Plan (Phased)

| Phase                       | Tasks                                                                                                     | Success Criteria                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **0 – Prep**                | • Branch `feat/monorepo` • Add `pnpm`, `turbo`, `go.work` • CI skeleton                                   | Branch compiles empty.                   |
| **1 – Scaffold**            | Create `apps/`, `packages/`, `infra/` dirs; commit baseline configs.                                      | Directory layout agreed & merged.        |
| **2 – Code Move**           | `git mv` dashboard → `apps/dashboard`; orchestrator & runtime → `apps/`; shared TS/Go code → `packages/`. | Tests still pass; history intact.        |
| **3 – Path Refactor**       | Update import aliases to package‑based (`@cronium/ui`, etc.).                                             | Builds green locally.                    |
| **4 – Infra Consolidation** | Move all compose / k8s files under `infra/`; update paths.                                                | `pnpm dev` spins full stack.             |
| **5 – CI Upgrade**          | Replace old pipelines with matrix & Turbo caching.                                                        | CI < 7 min, all checks green.            |
| **6 – Package Publishing**  | Integrate Changesets semantic‑release; publish `@cronium/ui` v1.0.0.                                      | Package available on npm/GHPR.           |
| **7 – Documentation**       | Update README, CONTRIBUTING, architecture diagrams.                                                       | New contributors can onboard in ≤30 min. |
| **8 – Tag & Release**       | Tag `v1.0.0-monorepo`; announce migration completion.                                                     | Production runs new images successfully. |

_Estimated timeline:_ 2–3 sprints (4–6 weeks) assuming two engineers focus part‑time.

## 8  Risk & Mitigation Matrix

| Risk                       | Impact | Mitigation                                                                         |
| -------------------------- | ------ | ---------------------------------------------------------------------------------- |
| Broken imports during move | High   | Move one app at a time; compile after each step; rely on TS path aliases & Go vet. |
| CI slowdowns               | Medium | Prototype Turbo cache early; profile pipeline; enable remote cache if necessary.   |
| Publish mis‑versioning     | Medium | Enforce PR check that Changesets file exists when packages change.                 |
| Developer friction         | Low    | Pair sessions, updated docs, VS Code workspace settings pushed to repo.            |

## 9  Future Considerations (Post‑Monorepo)

- **Marketing/Info Site** – Build in a separate private repo that **depends on** published `@cronium/ui` & `@cronium/tailwind‑config`.
- **Remote Cache** – Add Turborepo Remote Cache (Redis or Vercel) if CI times grow.
- **GraphQL / gRPC** – Centralise API schemas in `packages/shared‑types` and auto‑generate TS & Go clients.

---

© 2025 Cronium OSS • Draft v0.1

# Cronium Monorepo Restructure Brainstorm

## Current State Analysis

The current project is a single Next.js application with embedded Go services (orchestrator and runtime) mixed within the same directory structure. This creates challenges for:

- Code organization and maintainability
- Independent deployment of services
- Sharing code between the future info site and main app
- Clear separation of concerns between frontend and backend services

## Proposed Monorepo Structure

```
cronium/
├── apps/                    # Deployable applications and services
│   ├── web/                # Main Next.js 15 application (current app)
│   ├── docs/               # Documentation/marketing site (future)
│   ├── orchestrator/       # Go orchestrator service
│   └── runtime/            # Go runtime service
├── packages/               # Shared code and configurations
│   ├── ui/                # Shared UI components and design system
│   ├── config-tailwind/   # Shared Tailwind configuration
│   ├── config-eslint/     # Shared ESLint configuration
│   ├── config-typescript/ # Shared TypeScript configuration
│   ├── shared-types/      # Shared TypeScript types and Zod schemas
│   ├── database/          # Drizzle schema and database utilities
│   └── utils/             # Shared utility functions
├── infra/                # Infrastructure as code
│   ├── docker/           # Docker configurations
│   └── scripts/          # Deployment and utility scripts
├── docs/                 # Project-wide documentation
├── .github/              # GitHub workflows and templates
├── pnpm-workspace.yaml   # PNPM workspace configuration
├── turbo.json            # Turborepo configuration
├── go.work               # Go workspace configuration
├── package.json          # Root package.json
└── README.md

```

## Key Decisions to Make

### 1. Monorepo Tool Selection

**Option A: Turborepo (Recommended)**

- Pros:
  - Excellent caching and incremental builds
  - Great integration with Next.js and Vercel
  - Built-in task orchestration
  - Remote caching capabilities
- Cons:
  - Additional dependency
  - Learning curve for configuration

**Option B: Nx**

- Pros:
  - Powerful build system with great visualization tools
  - Excellent for large monorepos
  - Built-in generators for code scaffolding
- Cons:
  - More complex than needed for this project
  - Steeper learning curve

**Option C: PNPM Workspaces Only**

- Pros:
  - Simpler setup
  - No additional tooling
- Cons:
  - Manual task orchestration
  - No built-in caching
  - Less efficient builds

### 2. Shared UI Strategy

**Option A: Dedicated UI Package (Recommended)**

- Create a `packages/ui` with shadcn/ui components
- Export components that both apps can use
- Maintain consistent theming through shared Tailwind config
- Structure:
  ```
  packages/ui/
  ├── src/
  │   ├── components/     # Shared components
  │   ├── hooks/         # Shared hooks
  │   └── utils/         # UI utilities
  ├── package.json
  └── tsconfig.json
  ```

**Option B: Component Library with Storybook**

- Add Storybook for component documentation
- More setup but better for long-term maintenance
- Useful if planning to have many shared components

### 3. Database and Type Sharing

**Option A: Separate Database Package (Recommended)**

- Move Drizzle schema to `packages/database`
- Share generated types across apps
- Centralized migrations
- Structure:
  ```
  packages/database/
  ├── src/
  │   ├── schema/        # Drizzle schema files
  │   ├── migrations/    # Database migrations
  │   └── client.ts      # Database client setup
  ├── package.json
  └── drizzle.config.ts
  ```

**Option B: Keep in Main App**

- Simpler for now but limits reusability
- Would need refactoring when info site needs database access

### 4. Go Services Organization

**Option A: Separate Apps (Recommended)**

- Each Go service as a separate app
- Independent go.mod files
- Clear boundaries
- Structure:
  ```
  apps/orchestrator/
  ├── cmd/               # Main application entry
  ├── internal/          # Private packages
  ├── pkg/              # Public packages
  ├── go.mod
  └── Dockerfile
  ```

**Option B: Single Go Workspace**

- Use go.work for all Go code
- Shared dependencies
- Better for tightly coupled services

## Migration Strategy

### Phase 1: Setup Monorepo Structure (Week 1)

1. Initialize Turborepo with PNPM workspaces
2. Create basic folder structure
3. Setup shared configurations (ESLint, TypeScript, Tailwind)
4. Configure build pipelines

### Phase 2: Extract Shared Code (Week 2)

1. Move UI components to packages/ui
2. Extract shared types to packages/shared-types
3. Create database package with Drizzle schema
4. Update import paths

### Phase 3: Separate Go Services (Week 3)

1. Move orchestrator to apps/orchestrator
2. Move runtime to apps/runtime
3. Setup Go workspace configuration
4. Update Docker configurations

### Phase 4: Prepare for Info Site (Week 4)

1. Finalize shared UI components
2. Setup documentation structure
3. Create info site scaffold
4. Test monorepo workflows

## Benefits of This Structure

1. **Clear Separation of Concerns**
   - Frontend apps separate from backend services
   - Shared code in dedicated packages
   - Infrastructure code isolated

2. **Independent Development**
   - Teams can work on different apps without conflicts
   - Services can be deployed independently
   - Versioning can be managed per package

3. **Code Reusability**
   - UI components shared between web and docs
   - Types shared across all TypeScript code
   - Common utilities available everywhere

4. **Better Build Performance**
   - Turborepo caching reduces build times
   - Only affected packages rebuild
   - Parallel builds for independent services

5. **Scalability**
   - Easy to add new apps or services
   - Clear patterns for new packages
   - Consistent tooling across the monorepo

## Challenges and Mitigation

1. **Initial Setup Complexity**
   - Mitigation: Use templates and generators
   - Document setup process thoroughly

2. **Import Path Changes**
   - Mitigation: Use TypeScript path aliases
   - Automated refactoring tools

3. **CI/CD Complexity**
   - Mitigation: Use Turborepo's filtering
   - Implement smart deployment strategies

4. **Learning Curve**
   - Mitigation: Start simple, add complexity gradually
   - Provide clear documentation

## Next Steps

1. Review and finalize the structure
2. Create a detailed migration plan
3. Setup initial monorepo configuration
4. Begin incremental migration
5. Document new development workflows

## Alternative Considerations

### Micro-Frontend Architecture

- If the info site needs significant independence
- Consider Module Federation or similar approaches
- More complex but allows complete independence

### Serverless Deployment

- Consider if Go services could be serverless functions
- Might influence the monorepo structure
- Could simplify deployment strategies

### Multi-Repository with Shared Packages

- Keep repositories separate but share via NPM
- More overhead but complete independence
- Consider if teams are completely separate

# Cronium Monorepo Restructure Plan

## Overview

This plan outlines the migration of the current Cronium application to a monorepo structure using Turborepo. The goal is to reorganize the codebase without changing any functionality, pages, layouts, or UI components. All existing features must continue to work exactly as they do now.

## Target Structure

```
cronium/
├── apps/
│   ├── web/                # Main Next.js application (current app)
│   ├── orchestrator/       # Go orchestrator service
│   └── runtime/            # Go runtime service
├── packages/
│   ├── ui/                # Shared UI components and utilities
│   ├── config-tailwind/   # Shared Tailwind configuration
│   ├── config-eslint/     # Shared ESLint configuration
│   └── config-typescript/ # Shared TypeScript configuration
├── infra/                 # Infrastructure as code
│   ├── docker/           # Docker configurations
│   ├── scripts/          # Deployment and utility scripts
│   └── monitoring/       # Monitoring configurations
├── pnpm-workspace.yaml
├── turbo.json
├── go.work
└── package.json
```

## Migration Phases

### Phase 1: Initialize Monorepo Structure

**Objectives:**

- Set up Turborepo and PNPM workspaces
- Create base directory structure
- Configure root-level files

**Steps:**

- [x] Create new directory structure at project root
- [x] Initialize Turborepo with `npx create-turbo@latest` (use existing project option)
- [x] Configure pnpm-workspace.yaml to include apps/_ and packages/_
- [x] Set up root package.json with workspace scripts
- [x] Configure turbo.json with initial pipeline definitions
- [x] Create .gitignore entries for monorepo artifacts
- [x] Set up root-level TypeScript and ESLint configurations

**Human intervention required:**

- [x] Verify Git history preservation strategy
- [x] Backup current project state

### Phase 2: Extract Shared Configurations

**Objectives:**

- Create shared configuration packages
- Move common configs to packages directory

**Steps:**

- [x] Create packages/config-typescript directory
  - [x] Move base tsconfig.json settings
  - [x] Create extendable TypeScript configurations
- [x] Create packages/config-eslint directory
  - [x] Extract ESLint configuration from current project
  - [x] Set up as shareable ESLint config package
- [x] Create packages/config-tailwind directory
  - [x] Extract Tailwind configuration
  - [x] Create shareable Tailwind preset
- [x] Update all configuration references in the main app

### Phase 3: Create UI Package

**Objectives:**

- Set up shared UI package structure
- Prepare for future component extraction

**Steps:**

- [x] Create packages/ui directory structure
- [x] Initialize as TypeScript package with proper build configuration
- [x] Set up package.json with correct exports and dependencies
- [x] Configure TypeScript for component library
- [x] Add Tailwind CSS configuration that extends shared config
- [x] Create index.ts for exports (initially empty)
- [x] Set up build process for the UI package

### Phase 4: Migrate Next.js Application

**Objectives:**

- Move entire Next.js app to apps/web
- Update all paths and configurations

**Steps:**

- [x] Create apps/web directory
- [x] Move all Next.js application files maintaining structure:
  - [x] src/ directory and all contents
  - [x] public/ directory
  - [x] package.json (update name to @cronium/web)
  - [x] next.config.ts
  - [x] All root config files specific to Next.js
- [x] Update package.json dependencies and scripts
- [x] Update import paths for moved configuration files
- [x] Update next.config.ts for monorepo structure
- [x] Update all relative paths in the application
- [x] Configure Turborepo pipeline for Next.js app
- [x] Test all pages and features to ensure nothing is broken

### Phase 4.5: Create Infrastructure Directory

**Objectives:**

- Create infra directory for infrastructure-related files
- Move Docker configurations and scripts
- Update paths in moved files

**Steps:**

- [x] Create infra directory structure
- [x] Move Docker files to infra/docker
- [x] Move deployment and utility scripts to infra/scripts
- [x] Move monitoring configurations to infra/monitoring
- [x] Update paths in Docker Compose files
- [x] Update paths in script files

### Phase 5: Migrate Go Services

**Objectives:**

- Move Go services to apps directory
- Set up Go workspace

**Steps:**

- [x] Create apps/orchestrator directory
- [x] Move all orchestrator-related Go code maintaining structure
- [x] Create apps/runtime directory
- [x] Move all runtime-related Go code maintaining structure
- [x] Set up go.work file at root with both modules
- [x] Update Docker configurations for new paths
- [x] Update any build scripts for Go services
- [x] Configure Turborepo pipeline for Go services
- [x] Test orchestrator and runtime services functionality

### Phase 6: Update Build and Development Workflows

**Objectives:**

- Ensure all development commands work
- Update CI/CD configurations

**Steps:**

- [x] Update root package.json scripts:
  - [x] dev command to run all services
  - [x] build command for production builds
  - [x] test command to run all tests
- [x] Update Docker Compose configurations for new structure
- [x] Migrate database scripts and commands
- [x] Update any deployment scripts
- [x] Configure Turborepo caching strategies
- [x] Set up proper .env file handling for monorepo
- [x] Update development documentation in CLAUDE.md

**Human intervention required:**

- [ ] Update any hardcoded paths in deployment configurations
- [ ] Verify environment variable loading in all environments

### Phase 7: Final Migration Tasks

**Objectives:**

- Clean up old structure
- Verify everything works

**Steps:**

- [x] Remove old files from root that have been migrated
- [x] Update all documentation to reflect new structure
- [x] Update changelog with migration details
- [x] Run full test suite across all packages
- [ ] Verify all features work:
  - [ ] Authentication flows
  - [ ] Event creation and execution
  - [ ] Workflow management
  - [ ] Server connections
  - [ ] Variable management
  - [ ] Tool integrations
  - [ ] Admin features
- [x] Test development workflow (dev, build, lint, format)
- [x] Verify Docker builds work correctly
- [x] Clean up any temporary migration artifacts

**Human intervention required:**

- [ ] Final review of Git repository structure
- [ ] Verify no files were lost during migration

## Post-Migration Verification Checklist

- [ ] All pages load correctly
- [ ] Authentication works (login, logout, registration)
- [ ] Events can be created, edited, and executed
- [ ] Workflows function properly
- [ ] Server connections work via SSH
- [ ] Variables can be managed
- [ ] Tool integrations work
- [ ] Admin dashboard functions correctly
- [ ] WebSocket connections work
- [ ] Database operations work
- [ ] All API routes respond correctly
- [ ] Development commands work (dev, build, test, lint)
- [ ] Docker containers build and run
- [ ] No TypeScript errors
- [ ] No linting errors
- [ ] All tests pass

## Rollback Strategy

If issues arise during migration:

1. The entire migration is done in a separate branch
2. Each phase should be committed separately
3. Can revert to any phase if needed
4. Original structure remains in main branch until migration is complete and verified

## Success Criteria

- Zero functionality changes or regressions
- All existing features work identically
- Development experience is improved or unchanged
- Build times are similar or better
- Clear separation between apps and shared packages
- No user-visible changes to the application

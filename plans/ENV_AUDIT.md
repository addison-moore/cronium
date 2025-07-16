# Environment Variables Audit and Consolidation Plan

## Overview

This plan addresses the consolidation of environment variable documentation and the standardization of environment variables across the Cronium codebase. Currently, we have two overlapping documentation files (`docs/ENVIRONMENT_VARIABLES.md` and `docs/ENVIRONMENT.md`) and several inconsistencies in variable naming and usage.

## Current State Analysis

### Documentation Files

- **docs/ENVIRONMENT_VARIABLES.md**: More comprehensive, reflects microservices architecture with orchestrator
- **docs/ENVIRONMENT.md**: Better developer documentation with detailed explanations, but outdated

### Key Issues Identified

1. **Duplicate Documentation**: Two files with overlapping but inconsistent content
2. **Naming Inconsistencies**:
   - ENCRYPTION_KEY vs ENCRYPTION_MASTER_KEY vs CREDENTIAL_ENCRYPTION_KEY
   - AUTH*\* vs NEXTAUTH*\* prefixes
   - SMTP_FROM vs SMTP_FROM_EMAIL
3. **Missing Validations**: Critical variables used in code but not validated in env.mjs
4. **Unused Variables**: Several documented variables not actually used in code
5. **Service Boundary Confusion**: Variables meant for orchestrator included in Next.js docs

## Consolidation Plan

### Phase 1: Documentation Consolidation

#### Checklist:

- [ ] Create new consolidated `docs/ENVIRONMENT.md` using structure from ENVIRONMENT_VARIABLES.md
- [ ] Incorporate detailed descriptions from old ENVIRONMENT.md
- [ ] Organize by service/component:
  - [ ] Next.js Application Variables
  - [ ] Orchestrator Service Variables
  - [ ] Runtime Service Variables
  - [ ] Database Configuration
  - [ ] Optional Services (Redis/Valkey, Monitoring)
- [ ] Add clear indicators for which service uses each variable
- [ ] Include examples and validation requirements
- [ ] Delete old documentation files after consolidation
- [ ] Update changelog with documentation changes

### Phase 2: Environment Variable Standardization

#### Naming Standardization Checklist:

- [x] **Encryption Keys**:
  - [x] Rename all instances of `ENCRYPTION_MASTER_KEY` to `ENCRYPTION_KEY`
  - [x] Rename all instances of `CREDENTIAL_ENCRYPTION_KEY` to `ENCRYPTION_KEY`
  - [x] Update in: env.mjs, docker-compose files, code references
- [x] **Authentication Variables**:
  - [x] Standardize on `AUTH_` prefix for all auth-related variables
  - [x] Remove `NEXTAUTH_` prefix from any variables (e.g., NEXTAUTH_URL → AUTH_URL)
  - [x] Keep `AUTH_SECRET` as is (already using correct prefix)
  - [x] Keep `INTERNAL_API_KEY` for service-to-service auth
- [x] **SMTP Configuration**:
  - [x] Standardize on `SMTP_FROM_EMAIL` (not `SMTP_FROM`)
  - [x] Ensure consistency across all files

#### Code Updates Checklist:

- [x] **Update src/env.mjs**:
  - [x] Add `ORCHESTRATOR_URL` (with default: `http://orchestrator:8080`)
  - [x] Add any other missing variables actually used in Next.js app
  - [x] Remove any variables not used in Next.js app
  - [x] Update variable names to match standardization
- [x] **Update environment variable usage in code**:
  - [x] Search and replace all old variable names
  - [x] Update any hardcoded defaults to use env.mjs
  - [x] Ensure consistent access patterns (through env object)
- [x] **Update .env.example files**:
  - [x] Root .env.example
  - [x] Orchestrator .env.example (if exists)
  - [x] Remove unused variables
  - [x] Add clear comments for each variable

### Phase 3: Docker and Service Configuration

#### Docker Compose Checklist:

- [x] **Fix Orchestrator Environment Mapping**:
  - [x] Add proper `CRONIUM_` prefix mapping in docker-compose.yml
  - [x] Map unprefixed variables to CRONIUM\_ prefixed ones for Go code
  - [x] Example: `CRONIUM_POSTGRES_URL: ${POSTGRES_URL}`
- [x] **Consistency Check**:
  - [x] Ensure docker-compose.yml and docker-compose.dev.yml are aligned
  - [x] Verify all required variables are passed to correct services
  - [x] Remove any unused variable mappings
- [x] **Service Boundaries**:
  - [x] Ensure Next.js app only gets variables it needs
  - [x] Ensure orchestrator only gets variables it needs
  - [x] Avoid passing unnecessary variables between services

### Phase 4: Cleanup and Validation

#### Cleanup Checklist:

- [ ] **Remove Unused Variables** (from docs and .env files):
  - [ ] OPENAI_API_KEY (not referenced in code)
  - [ ] TIMEZONE (not referenced in code)
  - [ ] LOG_FORMAT (not referenced in code)
  - [ ] REDIS*\* variables (if using VALKEY*\*)
  - [ ] Any other variables identified as unused
- [ ] **Remove Deprecated Code**:
  - [ ] Search for any TODO comments about environment variables
  - [ ] Remove any legacy environment variable handling

#### Validation Checklist:

- [ ] **Create Tests**:
  - [ ] Add test to verify env.mjs matches actual usage
  - [ ] Add test to verify docker-compose has all required vars
  - [ ] Add test to check for undefined process.env access
- [ ] **Runtime Validation**:
  - [ ] Test Next.js app starts with minimal required variables
  - [ ] Test orchestrator starts with required variables
  - [ ] Test docker-compose up works with example values

### Phase 5: Developer Experience

#### Documentation Checklist:

- [ ] **Update README**:
  - [ ] Add quick start environment setup section
  - [ ] Reference the consolidated ENVIRONMENT.md
- [ ] **Update CLAUDE.md**:
  - [ ] Add note about environment variable conventions
  - [ ] Add common commands for env validation
- [ ] **Create Migration Guide**:
  - [ ] Document any breaking changes
  - [ ] Provide sed/replace commands for updates
  - [ ] Note any new required variables

## Variable Inventory

### Variables to Keep (Next.js App - env.mjs):

- DATABASE_URL / POSTGRES_URL
- AUTH_SECRET
- AUTH_URL (renamed from NEXTAUTH_URL)
- NODE_ENV
- PORT
- ENCRYPTION_KEY (standardized name)
- ORCHESTRATOR_URL
- EMAIL\_\* (SMTP configuration)
- STORAGE\_\* (local/S3 configuration)

### Variables to Keep (Orchestrator Only):

- JWT_SECRET
- INTERNAL_API_KEY
- CRONIUM\_\* prefixed versions of shared variables
- Container execution specific variables

### Variables to Remove:

- OPENAI_API_KEY
- TIMEZONE
- LOG_FORMAT
- BUILD_VERSION (if not used)
- Duplicate Redis/Valkey variables

## Success Criteria

1. Single source of truth for environment variable documentation
2. No naming inconsistencies across codebase
3. Clear service boundaries for variables
4. All used variables are documented
5. All documented variables are used
6. Proper validation for Next.js app variables
7. Working docker-compose with proper variable mapping

## Implementation Order

1. **Start with documentation consolidation** (low risk)
2. **Fix critical naming issues** (ENCRYPTION_KEY)
3. **Update env.mjs** with proper validations
4. **Fix docker-compose mappings**
5. **Clean up unused variables**
6. **Add tests and validation**

## Notes

- The `INTERNAL_API_KEY` and `JWT_SECRET` should NOT be added to env.mjs as they are not used by the Next.js application
- Keep service boundaries clear - don't mix orchestrator variables with app variables
- Consider using different .env files for different services in development
- The orchestrator expects `CRONIUM_` prefixed variables which need mapping in docker-compose

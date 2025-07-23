# Cronium App Separation Plan

## Overview

This plan outlines the separation of the current Cronium web application into two distinct apps:

- **cronium-app**: Self-hosted application with dashboard as landing page
- **cronium-info**: Public-facing marketing and documentation website

## Current Structure Analysis

### Existing Components to Separate

1. **Landing Page** (`apps/cronium-app/src/app/[lang]/page.tsx`) → Move to cronium-info
2. **Documentation Pages** (`apps/cronium-app/src/app/[lang]/docs/*`) → Move to cronium-info
3. **Landing Components** (`apps/cronium-app/src/components/landing/*`) → Move to cronium-info
   - hero.tsx
   - navbar.tsx
   - Features.tsx
   - footer.tsx
4. **Docs Components** (`apps/cronium-app/src/components/docs/*`) → Move to cronium-info
   - docs-layout.tsx
   - api-code-examples.tsx
5. **Auth Pages** → Keep in cronium-app
6. **Dashboard & App Features** → Keep in cronium-app

### Shared Resources

1. UI Components currently in `apps/cronium-app/src/components/ui/*` (to be moved to `@cronium/ui` package)
2. Tailwind configuration from `@cronium/config-tailwind`
3. TypeScript configuration from `@cronium/config-typescript`
4. Internationalization setup (next-intl)
5. Common styling and design tokens

## Phase 1: Project Setup

### Tasks

1. Create new Next.js app at `apps/cronium-info`
2. Configure cronium-info with:
   - Next.js 15 App Router
   - TypeScript
   - Tailwind CSS 4
   - next-intl for internationalization (matching cronium-app)
3. Update monorepo configuration:
   - Add cronium-info to pnpm-workspace.yaml
   - Update turbo.json with cronium-info pipeline
   - Configure shared package dependencies
4. Set up basic folder structure for cronium-info:
   - `app/[lang]/` for internationalized routes
   - `components/` for info-site specific components
   - `public/` for static assets
   - `messages/` for translation files
5. Copy necessary configuration files from cronium-app:
   - Internationalization setup
   - Middleware configuration for language routing
   - Environment variables structure

### Human intervention required

- None

## Phase 2: Shared Component Migration

### Tasks

1. Move UI components from `apps/cronium-app/src/components/ui/*` to `packages/ui/src`:
   - All existing UI components (button, card, badge, input, etc.)
   - Form components with react-hook-form integration
   - Complex components (command palette, data tables, etc.)
   - Update component imports to remove relative paths
2. Update packages/ui configuration:
   - Add necessary dependencies to package.json
   - Configure proper build setup with tsup
   - Export all components from index.ts
3. Update cronium-app imports:
   - Replace all `@/components/ui/*` imports with `@cronium/ui`
   - Update any component-specific imports
4. Test that all UI components work correctly in cronium-app after migration

### Human intervention required

- None

## Phase 3: Content Migration

### Tasks

1. Copy landing page from `apps/cronium-app/src/app/[lang]/page.tsx` to `apps/cronium-info/app/[lang]/page.tsx`
2. Copy documentation pages from `apps/cronium-app/src/app/[lang]/docs/*` to `apps/cronium-info/app/[lang]/docs/*`
3. Move landing components from `apps/cronium-app/src/components/landing/*` to `apps/cronium-info/components/landing/*`:
   - hero.tsx
   - navbar.tsx
   - Features.tsx
   - footer.tsx
4. Move docs components from `apps/cronium-app/src/components/docs/*` to `apps/cronium-info/components/docs/*`:
   - docs-layout.tsx
   - api-code-examples.tsx
5. Transfer relevant public assets (images, logos, fonts) from cronium-app to cronium-info
6. Copy translation files for landing and docs pages to cronium-info
7. Update component imports to use `@cronium/ui` for shared UI components
8. Remove sign-in/sign-up buttons and auth-related UI elements from:
   - navbar.tsx
   - Any other components that reference authentication

### Human intervention required

- None

## Phase 4: Routing and Navigation Updates

### Tasks

1. Update cronium-app (apps/cronium-app):
   - Remove `apps/cronium-app/src/app/[lang]/page.tsx` (landing page)
   - Remove `apps/cronium-app/src/app/[lang]/docs/*` directory
   - Update `apps/cronium-app/src/app/[lang]/layout.tsx` if needed
   - Create new root page that redirects to dashboard or shows dashboard directly
   - Update middleware.ts to handle new routing structure
   - Remove landing and docs components directories
   - Update any navigation components to remove docs/landing page links
2. Configure cronium-info routing:
   - Ensure landing page works at root route for each language
   - Set up docs routing structure matching original paths
   - Update internal navigation links within docs
   - Ensure language switching works correctly
3. Update shared navigation logic:
   - Remove auth-related navigation items from cronium-info
   - Add external links from cronium-app to cronium-info docs if needed

### Human intervention required

- None

## Phase 5: Build and Configuration Updates

### Tasks

1. Update cronium-app configuration:
   - Remove any unused dependencies related to landing/docs pages
   - Update environment variables to remove marketing-specific configs
   - Update package.json name to `@cronium/app`
   - Clean up any unused imports or configurations
2. Configure cronium-info build:
   - Set up package.json with name `@cronium/info`
   - Configure for static export with `output: 'export'` in next.config.js
   - Set up proper caching strategies
   - Add sitemap and robots.txt generation
   - Configure proper base paths if needed
3. Update monorepo scripts in root package.json:
   - Add `dev:info` script for cronium-info development
   - Add `build:info` script for cronium-info build
   - Update `dev` script to include both apps if desired
   - Update build pipeline to build both apps
4. Create separate environment configurations:
   - cronium-app: Database, auth, API keys
   - cronium-info: Public URLs, analytics (if any)

### Human intervention required

- None

## Phase 6: Testing and Cleanup

### Tasks

1. Test cronium-app:
   - Verify dashboard or auth page loads as landing page
   - Ensure all app features work correctly
   - Verify authentication flows
   - Check that no marketing/docs content remains
   - Test that all UI components from @cronium/ui work correctly
   - Verify internationalization still works for app pages
2. Test cronium-info:
   - Verify landing page renders correctly in all languages
   - Test documentation navigation and content display
   - Ensure no auth UI elements are present
   - Verify all assets (images, fonts) load properly
   - Test language switching functionality
   - Verify all links work correctly
3. Clean up cronium-app:
   - Remove unused dependencies
   - Delete components/landing and components/docs directories
   - Remove unused translation keys
   - Update README to reflect new structure
4. Clean up cronium-info:
   - Remove any accidentally copied app-specific code
   - Optimize bundle size for static export
5. Run quality checks:
   - `pnpm lint` for both apps
   - `pnpm typecheck` for both apps
   - `pnpm build` for both apps

### Human intervention required

- None

## Phase 7: Documentation and Deployment Preparation

### Tasks

1. Update deployment configurations:
   - Update Docker configurations to only include cronium-app
   - Create separate deployment guide for cronium-info static site
   - Update any CI/CD workflows to handle both apps
2. Update documentation:
   - Update main README.md to explain the two-app structure
   - Create `apps/cronium-app/README.md` for self-hosting instructions
   - Create `apps/cronium-info/README.md` for static site deployment
   - Update CLAUDE.md with new monorepo structure
   - Update changelog to document the separation
3. Configure hosting recommendations:
   - cronium-app: Document self-hosting requirements (database, environment vars)
   - cronium-info: Document static hosting options (Vercel, Netlify, GitHub Pages)
4. Create example environment files:
   - `apps/cronium-app/.env.example` with required variables
   - `apps/cronium-info/.env.example` with minimal public variables

### Human intervention required

- Deploy cronium-info to chosen hosting platform
- Update DNS/domain configuration if needed
- Configure production environment variables for both apps

## Implementation Order

1. **Phase 1**: Project Setup (1-2 hours)
2. **Phase 2**: Shared Component Migration (3-4 hours)
3. **Phase 3**: Content Migration (2-3 hours)
4. **Phase 4**: Routing and Navigation Updates (1-2 hours)
5. **Phase 5**: Build and Configuration Updates (1-2 hours)
6. **Phase 6**: Testing and Cleanup (2-3 hours)
7. **Phase 7**: Documentation and Deployment Preparation (1 hour)

Total estimated time: 11-17 hours

## Success Criteria

1. cronium-app runs independently with dashboard or auth page as landing
2. cronium-info displays marketing and documentation content without any authentication UI
3. Both apps share common UI components through @cronium/ui package
4. No duplicate code between apps
5. Both apps build successfully with `pnpm build`
6. All TypeScript and linting checks pass
7. Internationalization works correctly in both apps
8. Bundle sizes are optimized (cronium-info should be significantly smaller)

## Risk Mitigation

1. **Component Dependencies**: Carefully track which components depend on auth/app-specific features
2. **Translation Keys**: Ensure translation files are properly split between apps
3. **Asset References**: Update all image and asset paths to work in new structure
4. **Build Performance**: Monitor build times after separation
5. **Development Workflow**: Test that developers can work on both apps efficiently

## Post-Separation Maintenance

1. Establish guidelines for which components belong in @cronium/ui vs app-specific
2. Document the process for updating shared components
3. Set up separate deployment pipelines
4. Create clear documentation for self-hosting cronium-app
5. Maintain consistent design language across both apps through shared Tailwind config

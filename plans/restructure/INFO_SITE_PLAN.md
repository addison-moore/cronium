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

### Checklist

- [x] Run `pnpm create next-app@latest apps/cronium-info` with TypeScript and App Router
- [x] Add cronium-info to `pnpm-workspace.yaml` (already included via apps/\*)
- [x] Update `turbo.json` to include cronium-info in pipelines (already configured)
- [x] Install required dependencies in cronium-info: `next-intl`, shared packages
- [x] Create folder structure: `app/[lang]/`, `components/`, `public/`, `messages/`
- [x] Copy `i18n.ts` configuration from cronium-app
- [x] Copy `middleware.ts` for language routing
- [x] Create `.env.local` file with basic configuration
- [x] Update cronium-info `package.json` name to `@cronium/info`
- [x] Configure `tsconfig.json` to extend from `@cronium/typescript-config`
- [x] Configure `tailwind.config.ts` to use `@cronium/tailwind-config`
- [x] Test that `pnpm dev --filter @cronium/info` starts successfully

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

### Checklist

- [x] Create directories in `packages/ui/src` to match component organization
- [x] Move all files from `apps/cronium-app/src/components/ui/*` to `packages/ui/src/*`
- [x] Update imports within moved components to remove `@/` aliases
- [x] Add dependencies to `packages/ui/package.json`:
  - [x] `react`, `react-dom` as peer dependencies
  - [x] `react-hook-form`, `@radix-ui/*` components as dependencies
  - [x] `class-variance-authority`, `clsx`, `tailwind-merge` as dependencies
- [x] Configure `packages/ui/tsup.config.ts` for proper bundling
- [x] Create/update `packages/ui/src/index.ts` to export all components
- [x] Build packages/ui: `pnpm build --filter @cronium/ui`
- [x] Find and replace all imports in cronium-app:
  - [x] Replace `@/components/ui/button` with `@cronium/ui`
  - [x] Replace all other UI component imports similarly
- [x] Run `pnpm typecheck --filter @cronium/app` to verify imports
- [x] Run `pnpm dev --filter @cronium/app` to test functionality
- [x] Verify complex components (monaco-editor, data-table) work correctly

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

### Checklist

- [x] Copy `apps/cronium-app/src/app/[lang]/page.tsx` to `apps/cronium-info/app/[lang]/page.tsx`
- [x] Copy entire `apps/cronium-app/src/app/[lang]/docs/` directory to cronium-info
- [x] Copy `apps/cronium-app/src/app/[lang]/layout.tsx` and adapt for cronium-info
- [x] Move landing components to cronium-info:
  - [x] `hero.tsx`
  - [x] `navbar.tsx`
  - [x] `Features.tsx`
  - [x] `footer.tsx`
- [x] Move docs components to cronium-info:
  - [x] `docs-layout.tsx`
  - [x] `api-code-examples.tsx`
- [x] Copy public assets:
  - [x] Logo files
  - [x] Hero images
  - [x] Any fonts or icons used by landing/docs
- [x] Copy translation files:
  - [x] Identify keys used by landing/docs pages
  - [x] Create translation files in `apps/cronium-info/messages/`
- [x] Update all component imports:
  - [x] Change `@/components/ui/*` to `@cronium/ui`
  - [x] Update relative imports to match new structure
- [x] Remove auth elements from navbar.tsx:
  - [x] Remove sign-in button
  - [x] Remove sign-up button
  - [x] Remove user menu/avatar components
- [x] Update any links that pointed to app routes
- [x] Test all pages render correctly in cronium-info

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

### Checklist

- [x] Delete `apps/cronium-app/src/app/[lang]/page.tsx`
- [x] Delete entire `apps/cronium-app/src/app/[lang]/docs/` directory
- [x] Delete `apps/cronium-app/src/components/landing/` directory
- [x] Delete `apps/cronium-app/src/components/docs/` directory
- [x] Create new root page for cronium-app:
  - [x] Option 1: Redirect to `/[lang]/dashboard`
  - [x] Option 2: Redirect to `/[lang]/auth/sign-in`
  - [ ] Option 3: Show dashboard directly at root
- [x] Update `apps/cronium-app/src/middleware.ts`:
  - [x] Remove any special handling for docs routes
  - [x] Update root redirect logic
- [x] Update navigation in cronium-app:
  - [x] Remove docs links from any navigation menus
  - [x] Remove landing page links
  - [x] Add external link to docs if needed
- [x] Verify cronium-info routing:
  - [x] Test `/en` shows English landing page
  - [x] Test `/en/docs` shows documentation
  - [x] Test language switching works
  - [x] Test all internal links in docs
- [x] Update any hardcoded URLs:
  - [x] Search for `/docs` references
  - [x] Update or remove as appropriate
- [x] Test both apps run without conflicts

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

### Checklist

- [ ] Update `apps/cronium-app/package.json`:
  - [ ] Change name to `@cronium/app`
  - [ ] Remove unused dependencies if any
- [ ] Clean up cronium-app environment variables:
  - [ ] Review `.env.example`
  - [ ] Remove marketing-specific variables
- [ ] Configure `apps/cronium-info/package.json`:
  - [ ] Set name to `@cronium/info`
  - [ ] Add required scripts (dev, build, start)
- [ ] Create `apps/cronium-info/next.config.js`:
  - [ ] Add `output: 'export'` for static generation
  - [ ] Configure i18n settings
  - [ ] Add any required redirects
- [ ] Create static files for cronium-info:
  - [ ] `public/robots.txt`
  - [ ] `public/sitemap.xml` or dynamic generation
- [ ] Update root `package.json` scripts:
  - [ ] Add `"dev:info": "turbo dev --filter=@cronium/info"`
  - [ ] Add `"build:info": "turbo build --filter=@cronium/info"`
  - [ ] Add `"dev:all": "turbo dev --filter=@cronium/app --filter=@cronium/info"`
- [ ] Update `turbo.json` pipeline:
  - [ ] Ensure cronium-info is included in build pipeline
  - [ ] Set up proper dependencies between packages
- [ ] Create environment files:
  - [ ] `apps/cronium-app/.env.example` (production-ready)
  - [ ] `apps/cronium-info/.env.example` (minimal public vars)
- [ ] Test build process:
  - [ ] `pnpm build --filter=@cronium/app`
  - [ ] `pnpm build --filter=@cronium/info`
  - [ ] `pnpm build` (all packages)

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

### Checklist

- [ ] Test cronium-app functionality:
  - [ ] Navigate to root - should redirect to dashboard or auth
  - [ ] Test sign-in flow
  - [ ] Test sign-up flow
  - [ ] Verify dashboard loads correctly
  - [ ] Test a few key features (events, workflows, etc.)
  - [ ] Switch languages and verify UI updates
  - [ ] Check browser console for errors
- [ ] Test cronium-info functionality:
  - [ ] Navigate to `/en` - should show landing page
  - [ ] Navigate to `/en/docs` - should show documentation
  - [ ] Test all navigation links
  - [ ] Switch between languages
  - [ ] Verify no auth buttons appear
  - [ ] Check all images load
  - [ ] Test responsive design
- [ ] Clean up cronium-app:
  - [ ] Verify `components/landing/` is deleted
  - [ ] Verify `components/docs/` is deleted
  - [ ] Review `messages/` files for unused keys
  - [ ] Check for any remaining docs/landing imports
- [ ] Clean up cronium-info:
  - [ ] Remove any auth-related code
  - [ ] Remove unused API routes
  - [ ] Remove database configurations
  - [ ] Check bundle size with `pnpm build`
- [ ] Quality assurance:
  - [ ] Run `pnpm lint --filter=@cronium/app`
  - [ ] Run `pnpm lint --filter=@cronium/info`
  - [ ] Run `pnpm typecheck --filter=@cronium/app`
  - [ ] Run `pnpm typecheck --filter=@cronium/info`
  - [ ] Run `pnpm build` from root
  - [ ] Verify no errors in any command

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

### Checklist

- [ ] Update Docker configurations:
  - [ ] Review `infra/docker/` files
  - [ ] Remove cronium-info from Docker builds
  - [ ] Update docker-compose files if needed
- [ ] Create deployment documentation:
  - [ ] Write cronium-info static deployment guide
  - [ ] Update cronium-app self-hosting guide
  - [ ] Document environment variables for both
- [ ] Update main README.md:
  - [ ] Explain two-app architecture
  - [ ] Add links to both app READMEs
  - [ ] Update getting started instructions
- [ ] Create `apps/cronium-app/README.md`:
  - [ ] Self-hosting requirements
  - [ ] Environment variable documentation
  - [ ] Database setup instructions
  - [ ] Authentication configuration
- [ ] Create `apps/cronium-info/README.md`:
  - [ ] Static export instructions
  - [ ] Deployment to Vercel/Netlify
  - [ ] Custom domain setup
  - [ ] Environment variables (if any)
- [ ] Update CLAUDE.md:
  - [ ] Document new app structure
  - [ ] Update path references
  - [ ] Add notes about shared packages
- [ ] Create environment examples:
  - [ ] `apps/cronium-app/.env.example` with all required vars
  - [ ] `apps/cronium-info/.env.example` (likely minimal)
- [ ] Update changelog:
  - [ ] Create entry for app separation
  - [ ] Document breaking changes
  - [ ] Note migration steps

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

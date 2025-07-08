# Cleanup Plan: Remove Old Template System

## Overview

This plan outlines the systematic removal of all old template system code that has been replaced by the new tool action templates system.

## Phase 1: Discovery and Analysis

### 1.1 Identify All Old Template References

- [ ] Search for `templates` table references
- [ ] Search for `trpc.integrations.templates` usage
- [ ] Search for `TemplateManager` components
- [ ] Search for `TemplateForm` components
- [ ] Search for template-related types and interfaces
- [ ] Search for template seeding/migration scripts

### 1.2 Files to Review

Based on initial analysis:

#### Database/Schema Files:

- [ ] `/src/shared/schema.ts` - Contains commented templates table
- [ ] `/drizzle/0000_many_vengeance.sql` - Original migration with templates table
- [ ] Any migration files referencing templates

#### API/Router Files:

- [ ] `/src/server/api/routers/integrations.ts` - Contains commented templates router
- [ ] `/src/shared/schemas/integrations.ts` - May contain template schemas

#### Component Files:

- [ ] `/src/components/tools/template-form.tsx` - Old template form component
- [ ] `/src/components/tools/plugins/email/email-plugin.tsx` - Commented TemplateManager
- [ ] `/src/components/tools/plugins/slack/slack-plugin.tsx` - Commented TemplateManager
- [ ] `/src/components/tools/plugins/discord/discord-plugin.tsx` - Commented TemplateManager
- [ ] `/src/components/tools/modular-tools-manager.tsx` - May reference templates

#### Utility/Seeding Files:

- [ ] `/src/lib/template-seeding.ts` - Template seeding logic
- [ ] `/src/lib/default-templates.ts` - Default template definitions

#### Test Files:

- [ ] `/src/__tests__/utils/performance-baseline.ts` - References templates
- [ ] Any other test files with template references

#### Documentation:

- [ ] `/src/app/[lang]/docs/templates/page.tsx` - Old templates documentation

## Phase 2: Safe Removal Strategy

### 2.1 Create Backup Branch

```bash
git checkout -b backup/old-template-system
git add -A
git commit -m "Backup: State before removing old template system"
```

### 2.2 Remove Database References

1. Remove templates table from schema.ts
2. Create a migration to drop the templates table (if deployed)
3. Remove template relations from schema

### 2.3 Remove API Layer

1. Remove entire templates router from integrations.ts
2. Remove template-related schemas from integrations.ts
3. Remove getUserTemplates helper function

### 2.4 Remove Components

1. Delete template-form.tsx
2. Remove commented TemplateManager code from plugins
3. Remove any template-related imports

### 2.5 Remove Utilities

1. Delete template-seeding.ts
2. Delete default-templates.ts
3. Remove any template-related utilities

### 2.6 Update Tests

1. Remove or update tests that reference old templates
2. Ensure all tests pass after removal

### 2.7 Update Documentation

1. Update or remove old template documentation
2. Add migration guide if needed

## Phase 3: Verification

### 3.1 Build Verification

- [ ] Run `pnpm build` - ensure no compilation errors
- [ ] Run `pnpm typecheck` - ensure no type errors
- [ ] Run `pnpm lint` - ensure no linting errors

### 3.2 Runtime Verification

- [ ] Start development server
- [ ] Test all tool integrations
- [ ] Test conditional actions
- [ ] Test tool action templates

### 3.3 Search Verification

Final searches to ensure complete removal:

- [ ] Search for "templates" (excluding new tool action templates)
- [ ] Search for "Template" (case-sensitive)
- [ ] Search for "getUserTemplates"
- [ ] Search for "isSystemTemplate"

## Phase 4: Documentation

### 4.1 Update CHANGELOG

Document all removed files and components

### 4.2 Update README/Docs

Remove any references to old template system

## Implementation Order

1. **Start with non-critical files:**
   - Test files
   - Documentation
   - Seeding/utility files

2. **Move to core components:**
   - Remove commented code from plugins
   - Remove standalone template components

3. **Handle API/Database last:**
   - Remove API routes
   - Remove database schema
   - Create migration if needed

## Risk Assessment

### Low Risk:

- Removing commented code
- Removing unused utility files
- Removing test references

### Medium Risk:

- Removing API routes (ensure no hidden dependencies)
- Removing component files (ensure no imports)

### High Risk:

- Database schema changes (need migration if deployed)
- Removing core utilities (ensure no runtime dependencies)

## Rollback Plan

If issues arise:

1. Revert to backup branch
2. Cherry-pick specific removals that are safe
3. Address issues before proceeding

## Success Criteria

- [ ] All old template code removed
- [ ] No build errors
- [ ] No runtime errors
- [ ] All tests passing
- [ ] Tool action templates working correctly
- [ ] Conditional actions working correctly

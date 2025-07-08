# Template Migration Guide

This guide explains how to migrate from the old template system to the new Tool Action Templates system.

## Background

The old template system was limited to SEND_MESSAGE conditional actions for Discord, Slack, and Email. The new Tool Action Templates system is more flexible and supports all tool actions with full parameter configuration.

## Migration Steps

### 1. Run the Migration Script

The migration script will copy all existing templates to the new system:

```bash
# From the project root
npx tsx src/scripts/migrate-templates-to-tool-actions.ts
```

The script will:

- Read all templates from the old `templates` table
- Convert them to the new format
- Insert them into the `tool_action_templates` table
- Prefix migrated templates with "[Migrated]" for easy identification

### 2. Review Migrated Templates

After migration:

1. Navigate to **Tools > Templates** in the dashboard
2. Look for templates prefixed with "[Migrated]"
3. Review and test each template to ensure it works correctly
4. Update any placeholder values (especially email addresses)

### 3. Update Your Events

Events using conditional actions with templates will need to be updated manually:

1. Edit events that use SEND_MESSAGE conditional actions
2. If they reference old templates, update them to use the new tool action templates
3. Test the events to ensure they work correctly

### 4. Clean Up (Optional)

Once you've verified all templates work correctly:

1. Remove the "[Migrated]" prefix from template names
2. Delete any duplicate templates
3. The old templates table can be dropped in a future database migration

## Important Notes

### Email Templates

- Email templates will have a placeholder `{{cronium.user.adminEmail}}` for the "to" field
- Update this to the appropriate email address or variable

### Template Variables

- The new system uses the same Handlebars syntax for variables
- All existing variables ({{cronium.event.name}}, etc.) will continue to work

### Conditional Actions

- The ConditionalActionsSection component still uses the old template system
- A future update will modify it to use the new tool action templates
- For now, both systems will coexist

## Rollback

If you need to rollback:

1. The migration script does NOT delete old templates
2. Your existing conditional actions will continue to work
3. Simply delete the migrated templates from the tool_action_templates table

## Future Improvements

In future releases:

- ConditionalActionsSection will be updated to use tool action templates
- The old templates table will be deprecated
- Automatic migration during application startup

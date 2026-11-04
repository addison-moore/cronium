/**
 * Feature Flags for Tool Actions Phase 1 Implementation
 *
 * UPDATE 2025-07-07: All feature flags have been enabled permanently as Tool Actions
 * are now ready for production use. The environment variable checks have been removed
 * to simplify the codebase and ensure Tool Actions are available to all users.
 *
 * Original: These flags controlled the gradual rollout of tool action functionality.
 */

export const FeatureFlags = {
  // Master feature flag - controls all tool action functionality
  TOOL_ACTIONS_ENABLED: true, // Enabled for all users

  // UI feature flag - controls visibility of tool action components
  TOOL_ACTIONS_UI_ENABLED: true, // Enabled for all users

  // Execution feature flag - controls whether tool actions can be executed
  TOOL_ACTIONS_EXECUTION_ENABLED: true, // Enabled for all users

  // Workflow integration flag - controls tool actions in workflows
  TOOL_ACTIONS_WORKFLOWS_ENABLED: true, // Enabled for all users

  // Advanced features flag - controls real-time progress and advanced UI features
  TOOL_ACTIONS_ADVANCED_FEATURES_ENABLED: true, // Enabled for all users
} as const;

/**
 * Helper function to check if tool actions UI should be shown
 */
export const isToolActionsUIEnabled = () => {
  return (
    FeatureFlags.TOOL_ACTIONS_ENABLED && FeatureFlags.TOOL_ACTIONS_UI_ENABLED
  );
};

/**
 * Helper function to check if tool actions can be executed
 */
export const isToolActionsExecutionEnabled = () => {
  return (
    FeatureFlags.TOOL_ACTIONS_ENABLED &&
    FeatureFlags.TOOL_ACTIONS_EXECUTION_ENABLED
  );
};

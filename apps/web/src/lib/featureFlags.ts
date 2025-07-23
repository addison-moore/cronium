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
 * Helper function to check if tool actions are enabled
 */
export const isToolActionsEnabled = () => {
  return FeatureFlags.TOOL_ACTIONS_ENABLED;
};

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

/**
 * Helper function to check if tool actions are available in workflows
 */
export const isToolActionsWorkflowsEnabled = () => {
  return (
    FeatureFlags.TOOL_ACTIONS_ENABLED &&
    FeatureFlags.TOOL_ACTIONS_WORKFLOWS_ENABLED
  );
};

/**
 * Helper function to check if advanced tool action features are enabled
 */
export const isToolActionsAdvancedFeaturesEnabled = () => {
  return (
    FeatureFlags.TOOL_ACTIONS_ENABLED &&
    FeatureFlags.TOOL_ACTIONS_ADVANCED_FEATURES_ENABLED
  );
};

/**
 * Feature flag configuration for different deployment stages
 */
export const DEPLOYMENT_CONFIGS = {
  // Development - all features enabled for testing
  development: {
    TOOL_ACTIONS_ENABLED: "true",
    TOOL_ACTIONS_UI_ENABLED: "true",
    TOOL_ACTIONS_EXECUTION_ENABLED: "true",
    TOOL_ACTIONS_WORKFLOWS_ENABLED: "true",
    TOOL_ACTIONS_ADVANCED_FEATURES_ENABLED: "true",
  },

  // Alpha - basic features only, limited audience
  alpha: {
    TOOL_ACTIONS_ENABLED: "true",
    TOOL_ACTIONS_UI_ENABLED: "true",
    TOOL_ACTIONS_EXECUTION_ENABLED: "true",
    TOOL_ACTIONS_WORKFLOWS_ENABLED: "false",
    TOOL_ACTIONS_ADVANCED_FEATURES_ENABLED: "false",
  },

  // Beta - core features enabled, broader testing
  beta: {
    TOOL_ACTIONS_ENABLED: "true",
    TOOL_ACTIONS_UI_ENABLED: "true",
    TOOL_ACTIONS_EXECUTION_ENABLED: "true",
    TOOL_ACTIONS_WORKFLOWS_ENABLED: "true",
    TOOL_ACTIONS_ADVANCED_FEATURES_ENABLED: "false",
  },

  // Production - full features enabled
  production: {
    TOOL_ACTIONS_ENABLED: "true",
    TOOL_ACTIONS_UI_ENABLED: "true",
    TOOL_ACTIONS_EXECUTION_ENABLED: "true",
    TOOL_ACTIONS_WORKFLOWS_ENABLED: "true",
    TOOL_ACTIONS_ADVANCED_FEATURES_ENABLED: "true",
  },

  // Disabled - all features off
  disabled: {
    TOOL_ACTIONS_ENABLED: "false",
    TOOL_ACTIONS_UI_ENABLED: "false",
    TOOL_ACTIONS_EXECUTION_ENABLED: "false",
    TOOL_ACTIONS_WORKFLOWS_ENABLED: "false",
    TOOL_ACTIONS_ADVANCED_FEATURES_ENABLED: "false",
  },
} as const;

/**
 * Runtime feature flag check with fallback
 * Useful for server-side code that might not have access to all environment variables
 */
export const getFeatureFlag = (
  flagName: keyof typeof FeatureFlags,
  defaultValue = false,
): boolean => {
  const envValue = process.env[`NEXT_PUBLIC_${flagName}`];
  if (envValue !== undefined) {
    return envValue === "true";
  }
  return defaultValue;
};

/**
 * Development helper to log current feature flag state
 */
export const logFeatureFlags = () => {
  if (process.env.NODE_ENV === "development") {
    console.log("🚀 Tool Actions Feature Flags:", {
      TOOL_ACTIONS_ENABLED: FeatureFlags.TOOL_ACTIONS_ENABLED,
      TOOL_ACTIONS_UI_ENABLED: FeatureFlags.TOOL_ACTIONS_UI_ENABLED,
      TOOL_ACTIONS_EXECUTION_ENABLED:
        FeatureFlags.TOOL_ACTIONS_EXECUTION_ENABLED,
      TOOL_ACTIONS_WORKFLOWS_ENABLED:
        FeatureFlags.TOOL_ACTIONS_WORKFLOWS_ENABLED,
      TOOL_ACTIONS_ADVANCED_FEATURES_ENABLED:
        FeatureFlags.TOOL_ACTIONS_ADVANCED_FEATURES_ENABLED,
    });
  }
};

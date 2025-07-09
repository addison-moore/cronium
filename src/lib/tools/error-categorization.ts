/**
 * Advanced error categorization and handling
 */

export type ErrorCategory =
  | "network"
  | "authentication"
  | "authorization"
  | "rate_limit"
  | "validation"
  | "configuration"
  | "timeout"
  | "server_error"
  | "client_error"
  | "unknown";

export type ErrorSeverity = "low" | "medium" | "high" | "critical";

export interface CategorizedError {
  category: ErrorCategory;
  severity: ErrorSeverity;
  retryable: boolean;
  userMessage: string;
  technicalMessage: string;
  suggestedAction?: string;
  metadata?: Record<string, any>;
}

/**
 * Error patterns for categorization
 */
const errorPatterns: Array<{
  pattern: RegExp | ((error: Error) => boolean);
  category: ErrorCategory;
  severity: ErrorSeverity;
  retryable: boolean;
  userMessage: string;
  suggestedAction?: string;
}> = [
  // Network errors
  {
    pattern: /ECONNREFUSED|ENOTFOUND|ECONNRESET|EHOSTUNREACH/i,
    category: "network",
    severity: "medium",
    retryable: true,
    userMessage: "Network connection failed",
    suggestedAction: "Check your internet connection and try again",
  },
  {
    pattern: /ETIMEDOUT|ESOCKETTIMEDOUT|timeout/i,
    category: "timeout",
    severity: "medium",
    retryable: true,
    userMessage: "Request timed out",
    suggestedAction:
      "The service is slow to respond. Try again in a few moments",
  },

  // Authentication errors
  {
    pattern: /401|unauthorized|invalid.*credentials|authentication.*failed/i,
    category: "authentication",
    severity: "high",
    retryable: false,
    userMessage: "Authentication failed",
    suggestedAction: "Check your credentials and try again",
  },
  {
    pattern: /403|forbidden|access.*denied|permission.*denied/i,
    category: "authorization",
    severity: "high",
    retryable: false,
    userMessage: "Access denied",
    suggestedAction: "You don't have permission to perform this action",
  },

  // Rate limiting
  {
    pattern: /429|rate.*limit|too.*many.*requests/i,
    category: "rate_limit",
    severity: "low",
    retryable: true,
    userMessage: "Rate limit exceeded",
    suggestedAction: "Too many requests. Please wait before trying again",
  },

  // Validation errors
  {
    pattern: /400|bad.*request|invalid.*parameter|validation.*error/i,
    category: "validation",
    severity: "low",
    retryable: false,
    userMessage: "Invalid request",
    suggestedAction: "Check your input and try again",
  },

  // Server errors
  {
    pattern: /500|internal.*server.*error/i,
    category: "server_error",
    severity: "high",
    retryable: true,
    userMessage: "Server error",
    suggestedAction: "The service encountered an error. Try again later",
  },
  {
    pattern: /502|bad.*gateway/i,
    category: "server_error",
    severity: "high",
    retryable: true,
    userMessage: "Service unavailable",
    suggestedAction: "The service is temporarily unavailable",
  },
  {
    pattern: /503|service.*unavailable/i,
    category: "server_error",
    severity: "high",
    retryable: true,
    userMessage: "Service unavailable",
    suggestedAction: "The service is temporarily unavailable",
  },

  // Configuration errors
  {
    pattern:
      /configuration.*error|missing.*configuration|invalid.*configuration/i,
    category: "configuration",
    severity: "critical",
    retryable: false,
    userMessage: "Configuration error",
    suggestedAction: "Check your tool configuration settings",
  },
];

/**
 * Tool-specific error patterns
 */
const toolSpecificPatterns: Record<string, typeof errorPatterns> = {
  slack: [
    {
      pattern: /invalid_auth|not_authed/i,
      category: "authentication",
      severity: "high",
      retryable: false,
      userMessage: "Slack authentication failed",
      suggestedAction: "Reconnect your Slack workspace",
    },
    {
      pattern: /channel_not_found/i,
      category: "validation",
      severity: "medium",
      retryable: false,
      userMessage: "Slack channel not found",
      suggestedAction: "Check that the channel exists and the bot has access",
    },
  ],
  discord: [
    {
      pattern: /invalid.*webhook/i,
      category: "configuration",
      severity: "high",
      retryable: false,
      userMessage: "Invalid Discord webhook",
      suggestedAction: "Check your Discord webhook URL",
    },
  ],
  email: [
    {
      pattern: /invalid.*recipient|invalid.*email/i,
      category: "validation",
      severity: "low",
      retryable: false,
      userMessage: "Invalid email address",
      suggestedAction: "Check the recipient email address",
    },
    {
      pattern: /smtp.*error|mail.*server/i,
      category: "server_error",
      severity: "high",
      retryable: true,
      userMessage: "Email server error",
      suggestedAction: "Check your email server settings",
    },
  ],
};

/**
 * Error categorizer
 */
export class ErrorCategorizer {
  /**
   * Categorize an error
   */
  static categorize(
    error: Error,
    toolType?: string,
    context?: Record<string, any>,
  ): CategorizedError {
    // Check tool-specific patterns first
    if (toolType && toolSpecificPatterns[toolType]) {
      const match = this.findMatch(error, toolSpecificPatterns[toolType]);
      if (match) {
        return this.createCategorizedError(error, match, context);
      }
    }

    // Check general patterns
    const match = this.findMatch(error, errorPatterns);
    if (match) {
      return this.createCategorizedError(error, match, context);
    }

    // Default categorization
    const result: CategorizedError = {
      category: "unknown",
      severity: "medium",
      retryable: false,
      userMessage: "An unexpected error occurred",
      technicalMessage: error.message,
      suggestedAction: "Try again or contact support if the issue persists",
    };

    if (context) {
      result.metadata = context;
    }

    return result;
  }

  /**
   * Find matching error pattern
   */
  private static findMatch(
    error: Error,
    patterns: typeof errorPatterns,
  ): (typeof errorPatterns)[0] | null {
    for (const pattern of patterns) {
      if (typeof pattern.pattern === "function") {
        if (pattern.pattern(error)) {
          return pattern;
        }
      } else if (pattern.pattern.test(error.message)) {
        return pattern;
      }
    }
    return null;
  }

  /**
   * Create categorized error from pattern match
   */
  private static createCategorizedError(
    error: Error,
    match: (typeof errorPatterns)[0],
    context?: Record<string, any>,
  ): CategorizedError {
    const result: CategorizedError = {
      category: match.category,
      severity: match.severity,
      retryable: match.retryable,
      userMessage: match.userMessage,
      technicalMessage: error.message,
    };

    if (match.suggestedAction) {
      result.suggestedAction = match.suggestedAction;
    }

    result.metadata = {
      ...context,
      stack: error.stack,
      name: error.name,
    };

    return result;
  }

  /**
   * Get recovery suggestions for an error
   */
  static getRecoverySuggestions(
    error: CategorizedError,
    toolType?: string,
  ): string[] {
    const suggestions: string[] = [];

    // Add suggested action
    if (error.suggestedAction) {
      suggestions.push(error.suggestedAction);
    }

    // Add category-specific suggestions
    switch (error.category) {
      case "network":
        suggestions.push(
          "Check your internet connection",
          "Verify the service URL is correct",
          "Check if the service is down",
        );
        break;
      case "authentication":
        suggestions.push(
          "Verify your API key or credentials",
          "Regenerate your access token",
          "Check if your credentials have expired",
        );
        break;
      case "rate_limit":
        suggestions.push(
          "Wait a few minutes before retrying",
          "Consider upgrading your plan for higher limits",
          "Implement request batching",
        );
        break;
      case "configuration":
        suggestions.push(
          "Review your tool configuration",
          "Check the documentation for required settings",
          "Ensure all required fields are filled",
        );
        break;
    }

    // Add tool-specific suggestions
    if (toolType) {
      switch (toolType) {
        case "slack":
          if (error.category === "authentication") {
            suggestions.push("Reinstall the Slack app in your workspace");
          }
          break;
        case "discord":
          if (error.category === "configuration") {
            suggestions.push("Regenerate your Discord webhook URL");
          }
          break;
        case "email":
          if (error.category === "server_error") {
            suggestions.push(
              "Check SMTP server settings",
              "Verify port and security settings",
            );
          }
          break;
      }
    }

    return [...new Set(suggestions)]; // Remove duplicates
  }

  /**
   * Determine if error should trigger circuit breaker
   */
  static shouldTripCircuit(error: CategorizedError): boolean {
    // Don't trip circuit for client errors
    if (
      ["validation", "authentication", "authorization"].includes(error.category)
    ) {
      return false;
    }

    // Trip circuit for severe errors
    if (error.severity === "critical") {
      return true;
    }

    // Trip circuit for persistent server errors
    if (error.category === "server_error") {
      return true;
    }

    return false;
  }

  /**
   * Get user-friendly error message
   */
  static getUserMessage(error: CategorizedError, includeAction = true): string {
    let message = error.userMessage;

    if (includeAction && error.suggestedAction) {
      message += `. ${error.suggestedAction}`;
    }

    return message;
  }
}

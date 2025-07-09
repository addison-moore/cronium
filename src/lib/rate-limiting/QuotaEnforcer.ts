import { TRPCError } from "@trpc/server";
import { QuotaManager, type QuotaConfig } from "./QuotaManager";
import { RateLimiter, type RateLimitKey } from "./RateLimiter";
import { EventType } from "@/shared/schema";

export class QuotaEnforcer {
  private static instance: QuotaEnforcer;
  private quotaManager: QuotaManager;
  private rateLimiter: RateLimiter;

  private constructor() {
    this.quotaManager = QuotaManager.getInstance();
    this.rateLimiter = RateLimiter.getInstance();
  }

  static getInstance(): QuotaEnforcer {
    if (!QuotaEnforcer.instance) {
      QuotaEnforcer.instance = new QuotaEnforcer();
    }
    return QuotaEnforcer.instance;
  }

  /**
   * Check if tool action is allowed
   */
  async checkToolAction(userId: string, toolId: string): Promise<void> {
    // Check monthly quota
    const monthlyCheck = await this.quotaManager.checkQuota(
      userId,
      "toolActionsPerMonth",
    );
    if (!monthlyCheck.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Monthly tool action quota exceeded. Limit: ${monthlyCheck.limit}, Used: ${monthlyCheck.used}`,
      });
    }

    // Check daily quota
    const dailyCheck = await this.quotaManager.checkQuota(
      userId,
      "toolActionsPerDay",
    );
    if (!dailyCheck.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Daily tool action quota exceeded. Limit: ${dailyCheck.limit}, Used: ${dailyCheck.used}`,
      });
    }

    // Check rate limit
    const rateLimitKey: RateLimitKey = {
      type: "tool",
      identifier: userId,
      subIdentifier: toolId,
    };
    const rateLimit = await this.rateLimiter.checkLimit(rateLimitKey, {
      windowMs: 60000, // 1 minute
      maxRequests: 10, // 10 requests per minute per tool
    });
    if (!rateLimit.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Rate limit exceeded for tool ${toolId}. Try again in ${Math.ceil(
          (rateLimit.retryAfter ?? 0) / 1000,
        )} seconds`,
      });
    }
  }

  /**
   * Consume tool action quota
   */
  async consumeToolAction(userId: string, toolId: string): Promise<void> {
    await this.checkToolAction(userId, toolId);
    await this.quotaManager.consumeQuota(userId, "toolActionsPerMonth");
    await this.quotaManager.consumeQuota(userId, "toolActionsPerDay");
  }

  /**
   * Check if webhook is allowed
   */
  async checkWebhook(userId: string): Promise<void> {
    const check = await this.quotaManager.checkQuota(userId, "webhooksPerUser");
    if (!check.allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Webhook limit exceeded. Maximum ${check.limit} webhooks allowed`,
      });
    }
  }

  /**
   * Check webhook event
   */
  async checkWebhookEvent(userId: string, webhookId: string): Promise<void> {
    const check = await this.quotaManager.checkQuota(
      userId,
      "webhookEventsPerMonth",
    );
    if (!check.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Monthly webhook event quota exceeded. Limit: ${check.limit}, Used: ${check.used}`,
      });
    }

    // Rate limit per webhook
    const rateLimitKey: RateLimitKey = {
      type: "webhook",
      identifier: webhookId,
    };
    const rateLimit = await this.rateLimiter.checkLimit(rateLimitKey, {
      windowMs: 60000, // 1 minute
      maxRequests: 100, // 100 events per minute per webhook
    });
    if (!rateLimit.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Webhook rate limit exceeded",
      });
    }
  }

  /**
   * Check event/script creation
   */
  async checkEventCreation(userId: string): Promise<void> {
    const check = await this.quotaManager.checkQuota(userId, "eventsPerUser");
    if (!check.allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Event limit exceeded. Maximum ${check.limit} events allowed`,
      });
    }
  }

  /**
   * Check event execution
   */
  async checkEventExecution(
    userId: string,
    eventType: EventType,
  ): Promise<void> {
    const check = await this.quotaManager.checkQuota(
      userId,
      "eventExecutionsPerMonth",
    );
    if (!check.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Monthly event execution quota exceeded. Limit: ${check.limit}, Used: ${check.used}`,
      });
    }

    // Different rate limits for different event types
    const rateLimits: Record<EventType, { window: number; max: number }> = {
      [EventType.BASH]: { window: 60000, max: 20 },
      [EventType.NODEJS]: { window: 60000, max: 30 },
      [EventType.PYTHON]: { window: 60000, max: 30 },
      [EventType.HTTP_REQUEST]: { window: 60000, max: 100 },
      [EventType.TOOL_ACTION]: { window: 60000, max: 50 },
    };

    const limit = rateLimits[eventType];
    const rateLimitKey: RateLimitKey = {
      type: "custom",
      identifier: `event:${userId}`,
      subIdentifier: eventType,
    };

    const rateLimit = await this.rateLimiter.checkLimit(rateLimitKey, {
      windowMs: limit.window,
      maxRequests: limit.max,
    });

    if (!rateLimit.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Too many ${eventType} executions. Try again in ${Math.ceil(
          (rateLimit.retryAfter ?? 0) / 1000,
        )} seconds`,
      });
    }
  }

  /**
   * Check workflow creation
   */
  async checkWorkflowCreation(userId: string): Promise<void> {
    const check = await this.quotaManager.checkQuota(
      userId,
      "workflowsPerUser",
    );
    if (!check.allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Workflow limit exceeded. Maximum ${check.limit} workflows allowed`,
      });
    }
  }

  /**
   * Check workflow execution
   */
  async checkWorkflowExecution(
    userId: string,
    workflowId: string,
  ): Promise<void> {
    const check = await this.quotaManager.checkQuota(
      userId,
      "workflowExecutionsPerMonth",
    );
    if (!check.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Monthly workflow execution quota exceeded. Limit: ${check.limit}, Used: ${check.used}`,
      });
    }

    // Rate limit per workflow
    const rateLimitKey: RateLimitKey = {
      type: "custom",
      identifier: `workflow:${userId}`,
      subIdentifier: workflowId,
    };
    const rateLimit = await this.rateLimiter.checkLimit(rateLimitKey, {
      windowMs: 60000, // 1 minute
      maxRequests: 5, // 5 executions per minute per workflow
    });
    if (!rateLimit.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Workflow execution rate limit exceeded",
      });
    }
  }

  /**
   * Check API request
   */
  async checkAPIRequest(
    userId: string,
    endpoint: string,
    apiKey?: string,
  ): Promise<void> {
    // Check monthly quota
    const monthlyCheck = await this.quotaManager.checkQuota(
      userId,
      "apiRequestsPerMonth",
    );
    if (!monthlyCheck.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Monthly API quota exceeded. Limit: ${monthlyCheck.limit}, Used: ${monthlyCheck.used}`,
      });
    }

    // Check per-minute rate limit
    const rateLimitKey: RateLimitKey = {
      type: apiKey ? "api_key" : "user",
      identifier: apiKey ?? userId,
      subIdentifier: endpoint,
    };
    const rateLimit = await this.rateLimiter.checkLimit(rateLimitKey, {
      windowMs: 60000, // 1 minute
      maxRequests: 100, // 100 requests per minute
    });
    if (!rateLimit.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `API rate limit exceeded. Try again in ${Math.ceil(
          (rateLimit.retryAfter ?? 0) / 1000,
        )} seconds`,
      });
    }
  }

  /**
   * Check storage usage
   */
  async checkStorageUsage(userId: string, sizeMB: number): Promise<void> {
    const check = await this.quotaManager.checkQuota(
      userId,
      "totalStorageMB",
      sizeMB,
    );
    if (!check.allowed) {
      throw new TRPCError({
        code: "PAYLOAD_TOO_LARGE",
        message: `Storage limit exceeded. Used: ${check.used}MB, Limit: ${check.limit}MB`,
      });
    }
  }

  /**
   * Create tRPC middleware for quota enforcement
   */
  createTRPCMiddleware(resource: keyof QuotaConfig, amount = 1) {
    return async ({
      ctx,
      next,
    }: {
      ctx: { session: { user: { id: string } } | null };
      next: () => Promise<unknown>;
    }) => {
      if (!ctx.session?.user?.id) {
        return next();
      }

      const result = await this.quotaManager.consumeQuota(
        ctx.session.user.id,
        resource,
        amount,
      );

      if (!result.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Quota exceeded for ${resource}`,
        });
      }

      return next();
    };
  }

  /**
   * Get quota headers for response
   */
  getQuotaHeaders(result: {
    limit: number;
    used: number;
    remaining: number;
    resetAt?: Date;
  }): Record<string, string> {
    const headers: Record<string, string> = {
      "X-Quota-Limit": result.limit.toString(),
      "X-Quota-Used": result.used.toString(),
      "X-Quota-Remaining": result.remaining.toString(),
    };

    if (result.resetAt) {
      headers["X-Quota-Reset"] = result.resetAt.toISOString();
    }

    return headers;
  }
}

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { toolActionTemplates } from "@/shared/schema";
import { eq, and, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const toolActionTemplatesRouter = createTRPCRouter({
  // Create a new tool action template
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        toolType: z.string().min(1).max(50),
        actionId: z.string().min(1).max(100),
        parameters: z.record(z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      try {
        const [template] = await ctx.db
          .insert(toolActionTemplates)
          .values({
            userId,
            name: input.name,
            description: input.description,
            toolType: input.toolType,
            actionId: input.actionId,
            parameters: input.parameters,
          })
          .returning();

        return template;
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create tool action template",
        });
      }
    }),

  // Update an existing template
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        parameters: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Check if user owns the template
      const [existingTemplate] = await ctx.db
        .select()
        .from(toolActionTemplates)
        .where(
          and(
            eq(toolActionTemplates.id, input.id),
            eq(toolActionTemplates.userId, userId),
          ),
        );

      if (!existingTemplate) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Template not found or you don't have permission to update it",
        });
      }

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined)
        updateData.description = input.description;
      if (input.parameters !== undefined)
        updateData.parameters = input.parameters;

      const [updatedTemplate] = await ctx.db
        .update(toolActionTemplates)
        .set(updateData)
        .where(eq(toolActionTemplates.id, input.id))
        .returning();

      return updatedTemplate;
    }),

  // Delete a template
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Check if user owns the template
      const [existingTemplate] = await ctx.db
        .select()
        .from(toolActionTemplates)
        .where(
          and(
            eq(toolActionTemplates.id, input.id),
            eq(toolActionTemplates.userId, userId),
          ),
        );

      if (!existingTemplate) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Template not found or you don't have permission to delete it",
        });
      }

      await ctx.db
        .delete(toolActionTemplates)
        .where(eq(toolActionTemplates.id, input.id));

      return { success: true };
    }),

  // Get a single template by ID
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const [template] = await ctx.db
        .select()
        .from(toolActionTemplates)
        .where(
          and(
            eq(toolActionTemplates.id, input.id),
            or(
              eq(toolActionTemplates.userId, userId),
              eq(toolActionTemplates.isSystemTemplate, true),
            ),
          ),
        );

      if (!template) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Template not found",
        });
      }

      return template;
    }),

  // Get templates for a specific tool and action
  getByToolAction: protectedProcedure
    .input(
      z.object({
        toolType: z.string(),
        actionId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const templates = await ctx.db
        .select()
        .from(toolActionTemplates)
        .where(
          and(
            eq(toolActionTemplates.toolType, input.toolType),
            eq(toolActionTemplates.actionId, input.actionId),
            or(
              eq(toolActionTemplates.userId, userId),
              eq(toolActionTemplates.isSystemTemplate, true),
            ),
          ),
        )
        .orderBy(toolActionTemplates.name);

      return templates;
    }),

  // Get all user templates
  getUserTemplates: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const templates = await ctx.db
        .select()
        .from(toolActionTemplates)
        .where(eq(toolActionTemplates.userId, userId))
        .limit(input.limit)
        .offset(input.offset)
        .orderBy(toolActionTemplates.createdAt);

      const countResult = await ctx.db
        .select({ count: sql`count(*)::int` })
        .from(toolActionTemplates)
        .where(eq(toolActionTemplates.userId, userId));

      return {
        templates,
        total: countResult[0]?.count ?? 0,
      };
    }),

  // Get system templates
  getSystemTemplates: protectedProcedure
    .input(
      z.object({
        toolType: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const whereClause = eq(toolActionTemplates.isSystemTemplate, true);
      const conditions = [whereClause];

      if (input.toolType) {
        conditions.push(eq(toolActionTemplates.toolType, input.toolType));
      }

      const templates = await ctx.db
        .select()
        .from(toolActionTemplates)
        .where(and(...conditions))
        .limit(input.limit)
        .offset(input.offset)
        .orderBy(toolActionTemplates.name);

      const countResult = await ctx.db
        .select({ count: sql`count(*)::int` })
        .from(toolActionTemplates)
        .where(and(...conditions));

      return {
        templates,
        total: countResult[0]?.count ?? 0,
      };
    }),

  // Clone a template (create a copy)
  clone: protectedProcedure
    .input(
      z.object({
        templateId: z.number(),
        newName: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Get the original template
      const [originalTemplate] = await ctx.db
        .select()
        .from(toolActionTemplates)
        .where(
          and(
            eq(toolActionTemplates.id, input.templateId),
            or(
              eq(toolActionTemplates.userId, userId),
              eq(toolActionTemplates.isSystemTemplate, true),
            ),
          ),
        );

      if (!originalTemplate) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Template not found",
        });
      }

      // Create a copy
      const [clonedTemplate] = await ctx.db
        .insert(toolActionTemplates)
        .values({
          userId,
          name: input.newName,
          description: originalTemplate.description,
          toolType: originalTemplate.toolType,
          actionId: originalTemplate.actionId,
          parameters: originalTemplate.parameters,
          isSystemTemplate: false, // Cloned templates are always user templates
        })
        .returning();

      return clonedTemplate;
    }),
});

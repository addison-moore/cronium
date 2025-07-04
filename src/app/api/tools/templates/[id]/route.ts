import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/server/db";
import { templates, users } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { UserRole } from "@/shared/schema";

const updateTemplateSchema = z.object({
  name: z.string().min(1, "Template name is required"),
  content: z.string().min(1, "Content is required"),
  subject: z.string().optional(),
  type: z.string().min(1, "Type is required"),
  isSystemTemplate: z.boolean().optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;
    const templateId = parseInt(resolvedParams.id);
    if (isNaN(templateId) || templateId <= 0) {
      return NextResponse.json(
        { error: "Invalid template ID" },
        { status: 400 },
      );
    }

    const body = await request.json();
    const validation = updateTemplateSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid template data", details: validation.error.issues },
        { status: 400 },
      );
    }

    const { name, content, subject, type, isSystemTemplate } = validation.data;

    // Check template ownership and permissions
    const existingTemplate = await db
      .select()
      .from(templates)
      .where(eq(templates.id, templateId))
      .limit(1);

    if (existingTemplate.length === 0) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 },
      );
    }

    const template = existingTemplate[0];
    if (!template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 },
      );
    }

    // Check permissions for editing
    if (template.isSystemTemplate) {
      // Only admins can edit system templates
      const user = await db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);

      if (!user[0] || user[0].role !== UserRole.ADMIN) {
        return NextResponse.json(
          { error: "Only administrators can edit system templates" },
          { status: 403 },
        );
      }
    } else if (template.userId !== session.user.id) {
      // Users can only edit their own templates
      return NextResponse.json(
        { error: "You can only edit your own templates" },
        { status: 403 },
      );
    }

    // Check if user is trying to change system template status
    if (
      isSystemTemplate !== undefined &&
      isSystemTemplate !== template.isSystemTemplate
    ) {
      const user = await db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);

      if (!user[0] || user[0].role !== UserRole.ADMIN) {
        return NextResponse.json(
          { error: "Only administrators can change system template status" },
          { status: 403 },
        );
      }
    }

    // Update the template
    const updateData: any = {
      name,
      content,
      subject,
      type: type.toUpperCase(),
      updatedAt: new Date(),
    };

    // Handle system template status change
    if (isSystemTemplate !== undefined) {
      updateData.isSystemTemplate = isSystemTemplate;
      updateData.userId = isSystemTemplate ? null : session.user.id;
    }

    await db
      .update(templates)
      .set(updateData)
      .where(eq(templates.id, templateId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update template:", error);
    return NextResponse.json(
      { error: "Failed to update template" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const templateId = parseInt(params.id);
    if (isNaN(templateId) || templateId <= 0) {
      return NextResponse.json(
        { error: "Invalid template ID" },
        { status: 400 },
      );
    }

    // Delete the template (only if it belongs to the user)
    const result = await db
      .delete(templates)
      .where(
        and(
          eq(templates.id, templateId),
          eq(templates.userId, session.user.id),
        ),
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete template:", error);
    return NextResponse.json(
      { error: "Failed to delete template" },
      { status: 500 },
    );
  }
}

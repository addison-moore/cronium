import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/server/db";
import { templates, users } from "@/shared/schema";
import { eq, and, sql, or } from "drizzle-orm";
import { type ToolType, UserRole } from "@/shared/schema";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    if (!type) {
      return NextResponse.json(
        { error: "Type parameter is required" },
        { status: 400 },
      );
    }

    // Get system templates and user templates from database
    const allTemplates = await db
      .select()
      .from(templates)
      .where(
        and(
          sql`type = ${type.toUpperCase()}`,
          or(
            eq(templates.isSystemTemplate, true), // System templates visible to all
            eq(templates.userId, session.user.id), // User's own templates
          ),
        ),
      )
      .orderBy(templates.createdAt);

    return NextResponse.json(allTemplates);
  } catch (error) {
    console.error("Failed to fetch templates:", error);
    return NextResponse.json(
      { error: "Failed to fetch templates" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, type, content, subject, isSystemTemplate } = body;

    if (!name || !type || !content) {
      return NextResponse.json(
        { error: "Name, type, and content are required" },
        { status: 400 },
      );
    }

    // Validate tool type
    const validTypes = ["EMAIL", "SLACK", "DISCORD"];
    if (!validTypes.includes(type.toUpperCase())) {
      return NextResponse.json({ error: "Invalid tool type" }, { status: 400 });
    }

    // Check if user is admin when creating system templates
    if (isSystemTemplate) {
      const user = await db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);

      if (!user[0] || user[0].role !== UserRole.ADMIN) {
        return NextResponse.json(
          { error: "Only administrators can create system templates" },
          { status: 403 },
        );
      }
    }

    const template = await db
      .insert(templates)
      .values({
        userId: isSystemTemplate ? null : session.user.id,
        name,
        type: type.toUpperCase() as ToolType,
        content,
        subject: subject || null,
        isSystemTemplate: isSystemTemplate || false,
      })
      .returning();

    return NextResponse.json(template[0]);
  } catch (error) {
    console.error("Failed to create template:", error);
    return NextResponse.json(
      { error: "Failed to create template" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id || isNaN(Number(id))) {
      return NextResponse.json(
        { error: "Valid template ID is required" },
        { status: 400 },
      );
    }

    const templateId = Number(id);

    // Check template ownership and permissions
    const templateToDelete = await db
      .select()
      .from(templates)
      .where(eq(templates.id, templateId))
      .limit(1);

    if (templateToDelete.length === 0) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 },
      );
    }

    const template = templateToDelete[0];
    if (!template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 },
      );
    }

    // Check permissions for deletion
    if (template.isSystemTemplate) {
      // Only admins can delete system templates
      const user = await db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);

      if (!user[0] || user[0].role !== UserRole.ADMIN) {
        return NextResponse.json(
          { error: "Only administrators can delete system templates" },
          { status: 403 },
        );
      }
    } else if (template.userId !== session.user.id) {
      // Users can only delete their own templates
      return NextResponse.json(
        { error: "You can only delete your own templates" },
        { status: 403 },
      );
    }

    // Delete the template
    await db.delete(templates).where(eq(templates.id, templateId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete template:", error);
    return NextResponse.json(
      { error: "Failed to delete template" },
      { status: 500 },
    );
  }
}
